import { PERF_REPORT_MAX_BYTES, PERF_RETENTION_MS } from '$lib/profiler';

/**
 * Invisible Profiler retention (owner decision 2026-11-16): a reading or a build record older than
 * 15 days is deleted — its R2 file and its row together — unless it is marked Keep. The newest build
 * of each game key and kind is never claimed (`buildPurgeable`): that rule is the build store's
 * claim, so this loop is the same for both tables.
 *
 * Three steps, each safe to repeat, so a purge cut short anywhere finishes on the next run:
 *
 * 1. **Claim**: stamp `purging_at` on every unkept reading past the cutoff (and pick up any row a
 *    run before this one claimed but did not finish). Keep's update requires `purging_at IS NULL`,
 *    so once a row is claimed nobody can pin it, and a row pinned first is never claimed — the
 *    two updates serialise on the row.
 * 2. **Delete the file.** A file already gone counts as deleted.
 * 3. **Delete the row**, only once its file is gone. A failed file delete leaves the row claimed
 *    (hidden from the page) for the next run, so a row is never dropped while its file stays.
 *
 * The store is injected so `scripts/check-profiler.ts` runs this over an in-memory table.
 */
export interface ClaimedRow {
	id: string;
	r2Key: string;
}

export interface PurgeStore {
	/** Step 1: claim unkept rows made before `cutoff`, plus rows already claimed. */
	claim(cutoff: Date, now: Date, limit: number): Promise<ClaimedRow[]>;
	/** Step 3: delete a claimed row (a row that is not claimed is left alone). */
	deleteClaimed(id: string): Promise<void>;
}

export interface PurgeResult {
	deleted: number;
	failed: number;
}

const BATCH = 200;

export async function purgeExpired({
	store,
	deleteObject,
	now = new Date(),
	what = 'reading',
}: {
	store: PurgeStore;
	deleteObject: (key: string) => Promise<void>;
	now?: Date;
	/** What a row is, for the log line. */
	what?: 'reading' | 'build';
}): Promise<PurgeResult> {
	const cutoff = new Date(now.getTime() - PERF_RETENTION_MS);
	const result: PurgeResult = { deleted: 0, failed: 0 };
	const failed = new Set<string>();
	for (;;) {
		const claimed = (await store.claim(cutoff, now, BATCH + failed.size)).filter(
			(c) => !failed.has(c.id),
		);
		if (!claimed.length) return result;
		for (const row of claimed) {
			try {
				await deleteObject(row.r2Key);
			} catch (e) {
				console.error(`profiler purge: file of ${what} ${row.id} not deleted; retried next run`, e);
				failed.add(row.id);
				result.failed++;
				continue;
			}
			await store.deleteClaimed(row.id);
			result.deleted++;
		}
	}
}

/** A staged upload is registered within its 10-minute URL; a day later it never will be. */
export const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;

/**
 * The other half of retention: presigned uploads that were never registered (a sender that gave
 * up, a refused report, a staged copy whose delete failed) sit under each project's
 * `perf/uploads/` with no row, so the row-driven purge above never sees them. Nothing there is a
 * reading — registering copies it out — so anything older than a day is deleted, and anything over
 * the largest report kept at once (a presigned PUT cannot be size-limited on R2).
 */
export async function sweepStaleUploads({
	prefixes,
	listObjects,
	deleteObject,
	now = new Date(),
}: {
	prefixes: string[];
	listObjects: (prefix: string) => Promise<{ key: string; size: number; lastModified: number }[]>;
	deleteObject: (key: string) => Promise<void>;
	now?: Date;
}): Promise<number> {
	let swept = 0;
	for (const prefix of prefixes) {
		for (const obj of await listObjects(prefix)) {
			if (!obj.key.startsWith(prefix)) continue;
			const stale = now.getTime() - obj.lastModified >= STALE_UPLOAD_MS;
			if (!stale && obj.size <= PERF_REPORT_MAX_BYTES) continue;
			await deleteObject(obj.key);
			swept++;
		}
	}
	return swept;
}

/**
 * The files the row-driven purge cannot see: a reading or build file whose row never landed (a
 * crash, or an insert that failed with an unsure answer, between the file write and the row). A
 * file under a project's `perf/reports/` or `perf/builds/` older than a day that no row — claimed
 * ones included — points at is deleted. The day keeps a file whose row is being inserted right now.
 */
export async function sweepOrphanFiles({
	prefixes,
	listObjects,
	registered,
	deleteObject,
	now = new Date(),
}: {
	prefixes: string[];
	listObjects: (prefix: string) => Promise<{ key: string; size: number; lastModified: number }[]>;
	/** Of these keys, the ones a `perf_reports` or `perf_builds` row names. */
	registered: (keys: string[]) => Promise<Set<string>>;
	deleteObject: (key: string) => Promise<void>;
	now?: Date;
}): Promise<number> {
	let swept = 0;
	for (const prefix of prefixes) {
		const old = (await listObjects(prefix)).filter(
			(o) => o.key.startsWith(prefix) && now.getTime() - o.lastModified >= STALE_UPLOAD_MS,
		);
		if (!old.length) continue;
		const known = await registered(old.map((o) => o.key));
		for (const o of old) {
			if (known.has(o.key)) continue;
			await deleteObject(o.key);
			swept++;
		}
	}
	return swept;
}
