import { and, eq, exists, gt, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getDb } from '../db';
import { perfBuilds, perfReports, projects } from '../db/schema';
import { perfUploadsPrefix, UNASSIGNED_CLIENT } from '../projectPaths';
import { deleteObject, listAllObjects } from '../r2';
import { purgeExpired, sweepStaleUploads, type PurgeStore } from './purge';

/**
 * The daily Invisible Profiler purge (`purge.ts`) — expired readings, expired build records, then
 * unregistered uploads — on Postgres and R2. Started once from
 * `hooks.server.ts#init` like the RunPod watchdog and the cost recorder: a first run a few minutes
 * after boot (a deploy restarts the clock, and the launcher deploys often), then every 24 hours.
 * Every step is idempotent, so a second instance running it at the same time only repeats work.
 */
const FIRST_RUN_MS = 5 * 60 * 1000;
const EVERY_MS = 24 * 60 * 60 * 1000;

let started = false;

const claimableReport = (cutoff: Date) =>
	or(
		isNotNull(perfReports.purgingAt),
		and(eq(perfReports.keep, false), lt(perfReports.capturedAt, cutoff)),
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
const claimableBuild = (cutoff: Date) =>
	or(
		isNotNull(perfBuilds.purgingAt),
		and(
			eq(perfBuilds.keep, false),
			lt(perfBuilds.registeredAt, cutoff),
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
	try {
		// Every project row, deleted ones too: a tombstoned project's R2 tree is still there.
		const rows = await getDb()
			.select({ key: projects.key, clientKey: projects.clientKey })
			.from(projects);
		const swept = await sweepStaleUploads({
			prefixes: rows.map((p) => perfUploadsPrefix(p.clientKey ?? UNASSIGNED_CLIENT, p.key)),
			listObjects: listAllObjects,
			deleteObject,
			now,
		});
		if (swept) console.log(`profiler purge: ${swept} unregistered upload(s) swept`);
	} catch (e) {
		console.error('profiler purge: upload sweep failed', e);
	}
}

export function startPerfPurge(): void {
	if (started) return;
	started = true;
	const first = setTimeout(() => void runPerfPurge(), FIRST_RUN_MS);
	const daily = setInterval(() => void runPerfPurge(), EVERY_MS);
	for (const timer of [first, daily]) if (typeof timer.unref === 'function') timer.unref();
}
