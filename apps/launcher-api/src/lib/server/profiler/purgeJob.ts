import {
	and,
	asc,
	eq,
	exists,
	gt,
	gte,
	inArray,
	isNotNull,
	lt,
	notExists,
	or,
	sql,
} from 'drizzle-orm';
import { alias, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { getDb } from '../db';
import { appSettings, perfBuilds, perfFindingBugs, perfReports, projects } from '../db/schema';
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

export const claimableReport = (cutoff: Date) =>
	or(
		isNotNull(perfReports.purgingAt),
		and(
			eq(perfReports.keep, false),
			lt(perfReports.capturedAt, cutoff),
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
 * `buildPurgeable` in SQL: unkept, registered before the cutoff, and a newer build of the same
 * game key and kind exists in the project — so the newest of each line is never claimed. Ties on
 * the time break on the id, as `buildPurgeable` does. A row already claimed is picked up again.
 */
export const claimableBuild = (cutoff: Date) =>
	or(
		isNotNull(perfBuilds.purgingAt),
		and(
			eq(perfBuilds.keep, false),
			lt(perfBuilds.registeredAt, cutoff),
			uncited(perfBuilds.projectKey, perfBuilds.id, perfFindingBugs.buildIds),
			exists(
				getDb()
					.select({ one: sql`1` })
					.from(newer)
					.where(
						and(
							eq(newer.projectKey, perfBuilds.projectKey),
							eq(newer.gameKey, perfBuilds.gameKey),
							eq(newer.kind, perfBuilds.kind),
							or(
								gt(newer.registeredAt, perfBuilds.registeredAt),
								and(eq(newer.registeredAt, perfBuilds.registeredAt), gt(newer.id, perfBuilds.id)),
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
		await getDb()
			.update(perfReports)
			.set(set as Partial<typeof perfReports.$inferInsert>)
			.where(eq(perfReports.id, id));
	},
};

/** Set once a token scrub pass ({@link scrubStoredReadings}) skipped nothing. */
export const TOKEN_SCRUB_KEY = 'profilerTokenScrub';
const TOKEN_SCRUB_DONE = 'v1';

/**
 * The one-off clean of readings kept before #1949 redacted route tokens on receipt, run before the
 * first purge after a boot until a pass completes with nothing skipped.
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
	const first = setTimeout(() => void runTokenScrubOnce().then(() => runPerfPurge()), FIRST_RUN_MS);
	const daily = setInterval(() => void runPerfPurge(), EVERY_MS);
	for (const timer of [first, daily]) if (typeof timer.unref === 'function') timer.unref();
}
