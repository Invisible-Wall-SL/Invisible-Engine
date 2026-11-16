import { and, eq, inArray, isNotNull, lt, or, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { perfReports, projects } from '../db/schema';
import { perfUploadsPrefix, UNASSIGNED_CLIENT } from '../projectPaths';
import { deleteObject, listAllObjects } from '../r2';
import { purgeExpiredPerfReports, sweepStaleUploads, type PurgeStore } from './purge';

/**
 * The daily Invisible Profiler purge (`purge.ts`) — expired readings, then unregistered uploads —
 * on Postgres and R2. Started once from
 * `hooks.server.ts#init` like the RunPod watchdog and the cost recorder: a first run a few minutes
 * after boot (a deploy restarts the clock, and the launcher deploys often), then every 24 hours.
 * Every step is idempotent, so a second instance running it at the same time only repeats work.
 */
const FIRST_RUN_MS = 5 * 60 * 1000;
const EVERY_MS = 24 * 60 * 60 * 1000;

let started = false;

const claimable = (cutoff: Date) =>
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
			.where(claimable(cutoff))
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
				.where(and(inArray(perfReports.id, candidates), claimable(cutoff)))
				.returning({ id: perfReports.id, r2Key: perfReports.r2Key })
		);
	},
	async deleteClaimed(id) {
		await getDb()
			.delete(perfReports)
			.where(and(eq(perfReports.id, id), isNotNull(perfReports.purgingAt)));
	},
};

async function run(): Promise<void> {
	try {
		const { deleted, failed } = await purgeExpiredPerfReports({
			store: sqlPurgeStore,
			deleteObject,
		});
		if (deleted || failed) {
			console.log(`profiler purge: ${deleted} reading(s) deleted, ${failed} left for next run`);
		}
	} catch (e) {
		console.error('profiler purge: run failed', e);
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
		});
		if (swept) console.log(`profiler purge: ${swept} unregistered upload(s) swept`);
	} catch (e) {
		console.error('profiler purge: upload sweep failed', e);
	}
}

export function startPerfPurge(): void {
	if (started) return;
	started = true;
	const first = setTimeout(() => void run(), FIRST_RUN_MS);
	const daily = setInterval(() => void run(), EVERY_MS);
	for (const timer of [first, daily]) if (typeof timer.unref === 'function') timer.unref();
}
