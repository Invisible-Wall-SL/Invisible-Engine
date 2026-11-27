import {
	and,
	asc,
	eq,
	exists,
	gt,
	gte,
	inArray,
	isNotNull,
	isNull,
	lt,
	notExists,
	or,
	sql,
} from 'drizzle-orm';
import { alias, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { BUG_ACTIVE_STATUSES } from '$lib/bugReports';
import { ARCHIVE_RETENTION_MS, PERF_RETENTION_MS } from '$lib/profiler';
import { getDb } from '../db';
import {
	appSettings,
	bugReports,
	perfBuilds,
	perfFindingBugs,
	perfReports,
	projects,
} from '../db/schema';
import {
	perfBuildsPrefix,
	perfReportsPrefix,
	perfUploadsPrefix,
	UNASSIGNED_CLIENT,
} from '../projectPaths';
import {
	ConflictError,
	deleteObject,
	getObjectTextWithEtag,
	listAllObjects,
	putObjectText,
} from '../r2';
import { purgeExpired, sweepOrphanFiles, sweepStaleUploads, type PurgeStore } from './purge';
import { scrubStoredReadings, type TokenScrubStore } from './tokenScrub';

/**
 * The daily Invisible Profiler purge (`purge.ts`) — expired readings, expired build records, then
 * staged uploads never registered, then reading and build files no row points at — on Postgres and
 * R2. Started once from `hooks.server.ts#init` like the RunPod watchdog and the cost recorder: a first run a few minutes
 * after boot (a deploy restarts the clock, and the launcher deploys often), then every 24 hours.
 * Every step is idempotent, so a second instance running it at the same time only repeats work.
 */
const FIRST_RUN_MS = 5 * 60 * 1000;
const EVERY_MS = 24 * 60 * 60 * 1000;

let started = false;

/**
 * A row a filed bug cites (P5, `findingBugs.ts`) is never claimed, whatever its Keep says: Keep is
 * the mark the page shows, this is the guarantee.
 */
const uncited = (projectKey: AnyPgColumn, id: AnyPgColumn, list: AnyPgColumn) =>
	notExists(
		getDb()
			.select({ one: sql`1` })
			.from(perfFindingBugs)
			.where(and(eq(perfFindingBugs.projectKey, projectKey), sql`${id} = any(${list})`)),
	);

/**
 * When an archived row's hold ends, from the purge's own cutoff (`now − 15 days`): an archived row
 * is kept 90 days from its archiving (`ARCHIVE_RETENTION_DAYS`), whatever its age.
 */
const archiveCutoff = (cutoff: Date) =>
	new Date(cutoff.getTime() + PERF_RETENTION_MS - ARCHIVE_RETENTION_MS);

/** Past its retention: a live row 15 days from `at`, an archived one 90 days from its archiving. */
const expired = (
	at: AnyPgColumn,
	archivedAt: AnyPgColumn,
	cutoff: Date,
	/** An extra condition on the live branch only (a build must have a newer one). */
	live?: SQL,
) =>
	or(
		and(isNull(archivedAt), lt(at, cutoff), live),
		and(isNotNull(archivedAt), lt(archivedAt, archiveCutoff(cutoff))),
	);

export const claimableReport = (cutoff: Date) =>
	or(
		isNotNull(perfReports.purgingAt),
		and(
			eq(perfReports.keep, false),
			expired(perfReports.capturedAt, perfReports.archivedAt, cutoff),
			uncited(perfReports.projectKey, perfReports.id, perfFindingBugs.readingIds),
		),
	);

export const sqlPurgeStore: PurgeStore = {
	async claim(cutoff, now, limit) {
		const db = getDb();
		const candidates = db
			.select({ id: perfReports.id })
			.from(perfReports)
			.where(claimableReport(cutoff))
			.orderBy(perfReports.capturedAt)
			.limit(limit);
		// The outer condition is re-read on the locked row, so a Keep that committed after the
		// candidates were picked still wins.
		return (
			db
				.update(perfReports)
				// An ISO string, cast: postgres-js cannot bind a bare Date inside raw `sql`.
				.set({
					purgingAt: sql`coalesce(${perfReports.purgingAt}, ${now.toISOString()}::timestamptz)`,
				})
				.where(and(inArray(perfReports.id, candidates), claimableReport(cutoff)))
				.returning({ id: perfReports.id, r2Key: perfReports.r2Key })
		);
	},
	async deleteClaimed(id) {
		await getDb()
			.delete(perfReports)
			.where(and(eq(perfReports.id, id), isNotNull(perfReports.purgingAt)));
	},
};

const newer = alias(perfBuilds, 'newer_build');

/**
 * `buildPurgeable` in SQL: unkept, registered before the cutoff, and a newer LIVE (not archived)
 * build of the same game key and kind exists in the project — so the newest of each line is never
 * claimed, and the page, which lists live builds, agrees which that is. Ties on the time break on
 * the id, as `buildPurgeable` does. An archived build needs no newer one: it goes 90 days after
 * its archiving. A row already claimed is picked up again.
 */
export const claimableBuild = (cutoff: Date) =>
	or(
		isNotNull(perfBuilds.purgingAt),
		and(
			eq(perfBuilds.keep, false),
			uncited(perfBuilds.projectKey, perfBuilds.id, perfFindingBugs.buildIds),
			expired(
				perfBuilds.registeredAt,
				perfBuilds.archivedAt,
				cutoff,
				exists(
					getDb()
						.select({ one: sql`1` })
						.from(newer)
						.where(
							and(
								eq(newer.projectKey, perfBuilds.projectKey),
								eq(newer.gameKey, perfBuilds.gameKey),
								eq(newer.kind, perfBuilds.kind),
								isNull(newer.archivedAt),
								or(
									gt(newer.registeredAt, perfBuilds.registeredAt),
									and(eq(newer.registeredAt, perfBuilds.registeredAt), gt(newer.id, perfBuilds.id)),
								),
							),
						),
				),
			),
		),
	);

export const sqlBuildPurgeStore: PurgeStore = {
	async claim(cutoff, now, limit) {
		const db = getDb();
		const candidates = db
			.select({ id: perfBuilds.id })
			.from(perfBuilds)
			.where(claimableBuild(cutoff))
			.orderBy(perfBuilds.registeredAt)
			.limit(limit);
		return db
			.update(perfBuilds)
			.set({
				purgingAt: sql`coalesce(${perfBuilds.purgingAt}, ${now.toISOString()}::timestamptz)`,
			})
			.where(and(inArray(perfBuilds.id, candidates), claimableBuild(cutoff)))
			.returning({ id: perfBuilds.id, r2Key: perfBuilds.r2Key });
	},
	async deleteClaimed(id) {
		await getDb()
			.delete(perfBuilds)
			.where(and(eq(perfBuilds.id, id), isNotNull(perfBuilds.purgingAt)));
	},
};

export const sqlTokenScrubStore: TokenScrubStore = {
	rows(afterId, limit) {
		return getDb()
			.select({
				id: perfReports.id,
				r2Key: perfReports.r2Key,
				network: perfReports.network,
				facts: perfReports.facts,
			})
			.from(perfReports)
			.where(
				and(gte(perfReports.perfVersion, 9), afterId ? gt(perfReports.id, afterId) : undefined),
			)
			.orderBy(asc(perfReports.id))
			.limit(limit);
	},
	read: getObjectTextWithEtag,
	async write(key, text, etag) {
		if (!etag) return false;
		try {
			await putObjectText(key, text, 'application/json', { ifMatch: etag });
			return true;
		} catch (e) {
			if (e instanceof ConflictError) return false;
			throw e;
		}
	},
	async updateRow(id, set) {
		await getDb().update(perfReports).set(set).where(eq(perfReports.id, id));
	},
};

/** Set once a token scrub pass ({@link scrubStoredReadings}) skipped nothing. */
export const TOKEN_SCRUB_KEY = 'profilerTokenScrub';
const TOKEN_SCRUB_DONE = 'v1';

/**
 * The one-off clean of readings kept before #1949 redacted route tokens on receipt, run beside the
 * first purge after a boot (never holding it up) until a pass completes with nothing skipped.
 */
export async function runTokenScrubOnce(): Promise<void> {
	try {
		const [done] = await getDb()
			.select({ value: appSettings.value })
			.from(appSettings)
			.where(eq(appSettings.key, TOKEN_SCRUB_KEY));
		if (done?.value === TOKEN_SCRUB_DONE) return;
		const r = await scrubStoredReadings(sqlTokenScrubStore);
		console.log(
			`profiler token scrub: ${r.scanned} reading(s) read, ${r.files} file(s) and ${r.rows} row(s) ` +
				`cleaned, ${r.skipped} left for the next boot`,
		);
		if (r.skipped) return;
		await getDb()
			.insert(appSettings)
			.values({ key: TOKEN_SCRUB_KEY, value: TOKEN_SCRUB_DONE })
			.onConflictDoUpdate({
				target: appSettings.key,
				set: { value: TOKEN_SCRUB_DONE, updatedAt: new Date() },
			});
	} catch (e) {
		console.error('profiler token scrub: run failed; retried on the next boot', e);
	}
}

/** One purge pass. Exported so it can be run directly (a check, an operator) rather than waited for. */
export async function runPerfPurge(now = new Date()): Promise<void> {
	for (const [what, store] of [
		['reading', sqlPurgeStore],
		['build', sqlBuildPurgeStore],
	] as const) {
		try {
			const { deleted, failed } = await purgeExpired({ store, deleteObject, now, what });
			if (deleted || failed) {
				console.log(`profiler purge: ${deleted} ${what}(s) deleted, ${failed} left for next run`);
			}
		} catch (e) {
			console.error(`profiler purge: ${what} run failed`, e);
		}
	}
	let scopes: PerfScope[];
	try {
		scopes = await perfScopes();
	} catch (e) {
		console.error('profiler purge: could not list the projects to sweep', e);
		return;
	}
	try {
		const swept = await sweepStaleUploads({
			prefixes: scopes.map((s) => perfUploadsPrefix(s.client, s.project)),
			listObjects: listAllObjects,
			deleteObject,
			now,
		});
		if (swept) console.log(`profiler purge: ${swept} unregistered upload(s) swept`);
	} catch (e) {
		console.error('profiler purge: upload sweep failed', e);
	}
	try {
		const swept = await sweepOrphanFiles({
			prefixes: scopes.flatMap((s) => [
				perfReportsPrefix(s.client, s.project),
				perfBuildsPrefix(s.client, s.project),
			]),
			listObjects: listAllObjects,
			registered: registeredPerfKeys,
			deleteObject,
			now,
		});
		if (swept) console.log(`profiler purge: ${swept} file(s) with no row swept`);
	} catch (e) {
		console.error('profiler purge: orphan sweep failed', e);
	}
}

interface PerfScope {
	client: string;
	project: string;
}

/**
 * Every `<client>/<project>` a project's perf files may live under: each project row as it is now
 * (deleted ones too: a tombstoned project's R2 tree is still there), plus every client a reading or
 * build was kept under — moving a project to another client moves no R2 data, so its earlier files
 * and staged uploads stay under the old client's prefix.
 */
async function perfScopes(): Promise<PerfScope[]> {
	const db = getDb();
	const [now, readings, builds] = await Promise.all([
		db.select({ key: projects.key, clientKey: projects.clientKey }).from(projects),
		db
			.selectDistinct({ client: perfReports.clientKey, project: perfReports.projectKey })
			.from(perfReports),
		db
			.selectDistinct({ client: perfBuilds.clientKey, project: perfBuilds.projectKey })
			.from(perfBuilds),
	]);
	const scopes = new Map<string, PerfScope>();
	for (const s of [
		...now.map((p) => ({ client: p.clientKey ?? UNASSIGNED_CLIENT, project: p.key })),
		...readings,
		...builds,
	]) {
		scopes.set(`${s.client}/${s.project}`, s);
	}
	return [...scopes.values()];
}

/** Of these R2 keys, the ones a reading or build row (claimed ones included) points at. */
async function registeredPerfKeys(keys: string[]): Promise<Set<string>> {
	const known = new Set<string>();
	const db = getDb();
	for (let i = 0; i < keys.length; i += 500) {
		const batch = keys.slice(i, i + 500);
		const [readings, builds] = await Promise.all([
			db
				.select({ k: perfReports.r2Key })
				.from(perfReports)
				.where(inArray(perfReports.r2Key, batch)),
			db.select({ k: perfBuilds.r2Key }).from(perfBuilds).where(inArray(perfBuilds.r2Key, batch)),
		]);
		for (const r of [...readings, ...builds]) known.add(r.k);
	}
	return known;
}

export function startPerfPurge(): void {
	if (started) return;
	started = true;
	const first = setTimeout(() => {
		void runPerfPurge();
		void runTokenScrubOnce();
	}, FIRST_RUN_MS);
	const daily = setInterval(() => void runPerfPurge(), EVERY_MS);
	for (const timer of [first, daily]) if (typeof timer.unref === 'function') timer.unref();
}

/**
 * The bugs of a project that cite a row, as a SELECT to test with `exists`: by default any bug
 * (the purge's guard above), or only one still being worked (`open`, `working`) — what holds a
 * Delete (`manage.ts`): a bug that is closed lets its evidence go.
 */
const citedBy = (
	projectKey: AnyPgColumn,
	id: AnyPgColumn,
	list: AnyPgColumn,
	activeOnly: boolean,
) =>
	getDb()
		.select({ one: sql`1` })
		.from(perfFindingBugs)
		.innerJoin(bugReports, eq(bugReports.number, perfFindingBugs.bugNumber))
		.where(
			and(
				eq(perfFindingBugs.projectKey, projectKey),
				sql`${id} = any(${list})`,
				activeOnly ? inArray(bugReports.status, [...BUG_ACTIVE_STATUSES]) : undefined,
			),
		);

/**
 * What a person's Delete may claim (`manage.ts`), or a row already claimed (finished): the named
 * rows of the project that no OPEN bug cites, and are not kept — except a kept row a closed bug
 * cites, whose Keep was that bug's (Keep cannot be taken off while a bug exists). Re-read on the
 * locked row by the claim's UPDATE, so a bug filed or a Keep set meanwhile still wins.
 */
export const deletableReport = (projectKey: string, ids: readonly string[]) =>
	and(
		eq(perfReports.projectKey, projectKey),
		inArray(perfReports.id, [...ids]),
		or(
			isNotNull(perfReports.purgingAt),
			and(
				notExists(
					citedBy(perfReports.projectKey, perfReports.id, perfFindingBugs.readingIds, true),
				),
				or(
					eq(perfReports.keep, false),
					exists(
						citedBy(perfReports.projectKey, perfReports.id, perfFindingBugs.readingIds, false),
					),
				),
			),
		),
	);

export const deletableBuild = (projectKey: string, ids: readonly string[]) =>
	and(
		eq(perfBuilds.projectKey, projectKey),
		inArray(perfBuilds.id, [...ids]),
		or(
			isNotNull(perfBuilds.purgingAt),
			and(
				notExists(citedBy(perfBuilds.projectKey, perfBuilds.id, perfFindingBugs.buildIds, true)),
				or(
					eq(perfBuilds.keep, false),
					exists(citedBy(perfBuilds.projectKey, perfBuilds.id, perfFindingBugs.buildIds, false)),
				),
			),
		),
	);

/** A repeat send nobody pinned or cites: what a fuller send of its window replaces (`store.ts`). */
export const supersededReport = (projectKey: string, ids: readonly string[]) =>
	and(
		eq(perfReports.projectKey, projectKey),
		inArray(perfReports.id, [...ids]),
		eq(perfReports.keep, false),
		uncited(perfReports.projectKey, perfReports.id, perfFindingBugs.readingIds),
	);

/** The database or a transaction on it: a Delete locks its rows, then claims them, in one. */
export type Executor = Pick<ReturnType<typeof getDb>, 'update'>;

type Claim = (
	where: SQL | undefined,
	now: Date,
	db: Executor,
) => Promise<{ id: string; r2Key: string }[]>;

const claimReports: Claim = async (where, now, db) =>
	db
		.update(perfReports)
		.set({ purgingAt: sql`coalesce(${perfReports.purgingAt}, ${now.toISOString()}::timestamptz)` })
		.where(where)
		.returning({ id: perfReports.id, r2Key: perfReports.r2Key });

const claimBuilds: Claim = async (where, now, db) =>
	db
		.update(perfBuilds)
		.set({ purgingAt: sql`coalesce(${perfBuilds.purgingAt}, ${now.toISOString()}::timestamptz)` })
		.where(where)
		.returning({ id: perfBuilds.id, r2Key: perfBuilds.r2Key });

/** Claims, then removes, a person's Delete of readings or builds: the purge's own steps. */
export const sqlDeleteClaims = {
	reading: {
		claim: (projectKey: string, ids: readonly string[], now: Date, db: Executor = getDb()) =>
			claimReports(deletableReport(projectKey, ids), now, db),
		claimSuperseded: (projectKey: string, ids: readonly string[], now: Date) =>
			claimReports(supersededReport(projectKey, ids), now, getDb()),
		/** Takes the row locks a claim must wait on, so it reads the bugs filed up to then. */
		lock: (
			db: Pick<ReturnType<typeof getDb>, 'select'>,
			projectKey: string,
			ids: readonly string[],
		) =>
			db
				.select({ id: perfReports.id })
				.from(perfReports)
				.where(and(eq(perfReports.projectKey, projectKey), inArray(perfReports.id, [...ids])))
				.for('update'),
		store: sqlPurgeStore,
	},
	build: {
		claim: (projectKey: string, ids: readonly string[], now: Date, db: Executor = getDb()) =>
			claimBuilds(deletableBuild(projectKey, ids), now, db),
		lock: (
			db: Pick<ReturnType<typeof getDb>, 'select'>,
			projectKey: string,
			ids: readonly string[],
		) =>
			db
				.select({ id: perfBuilds.id })
				.from(perfBuilds)
				.where(and(eq(perfBuilds.projectKey, projectKey), inArray(perfBuilds.id, [...ids])))
				.for('update'),
		store: sqlBuildPurgeStore,
	},
} as const;
