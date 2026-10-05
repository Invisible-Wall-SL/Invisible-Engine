import { and, asc, desc, eq, gt, lt, lte } from 'drizzle-orm';
import { getDb } from '../db';
import {
	directorAtlasJobs,
	directorEvents,
	directorOps,
	directorRuns,
	users,
	type DirectorAtlasJob,
	type DirectorEvent,
	type DirectorOp,
	type DirectorRun,
} from '../db/schema';

/**
 * Postgres access for the Director adapter gate (ADR-0002): the run stub, the run owner the
 * adapters act as, and the `director_ops` idempotency ledger. Kept in one module so the gate's
 * fixture can replace the database at a single seam.
 */

export async function getRun(runId: string): Promise<DirectorRun | null> {
	const [row] = await getDb().select().from(directorRuns).where(eq(directorRuns.id, runId));
	return row ?? null;
}

/**
 * The run owner as a session user — the identity every adapter call acts as (Q5). `null` when the
 * account is gone, disabled or past its expiry: the same accounts `validateSession` refuses, so a
 * disabled owner's run can do nothing a disabled owner could not.
 */
export async function getRunOwner(userId: string): Promise<NonNullable<App.Locals['user']> | null> {
	const [row] = await getDb()
		.select({
			id: users.id,
			email: users.email,
			name: users.name,
			role: users.role,
			active: users.active,
			expiresAt: users.expiresAt,
		})
		.from(users)
		.where(eq(users.id, userId));
	if (!row || !row.active) return null;
	if (row.expiresAt !== null && row.expiresAt.getTime() < Date.now()) return null;
	return { id: row.id, email: row.email, name: row.name, role: row.role };
}

/** Claim the run's project key for this run, before `create_from_template` copies anything. */
export async function markProjectCreateStarted(runId: string): Promise<void> {
	await getDb()
		.update(directorRuns)
		.set({ projectCreateStartedAt: new Date(), updatedAt: new Date() })
		.where(eq(directorRuns.id, runId));
}

/** Record the math-lock ETags on the run when its project is copied from the template (Q3). */
export async function setRunConfigEtags(
	runId: string,
	etags: { template: string | null; project: string | null },
): Promise<void> {
	await getDb()
		.update(directorRuns)
		.set({
			templateConfigEtag: etags.template,
			projectConfigEtag: etags.project,
			updatedAt: new Date(),
		})
		.where(eq(directorRuns.id, runId));
}

export type OpClaim = { claimed: true } | { claimed: false; existing: DirectorOp };

/**
 * How long a `pending` claim holds before the next call with its `opId` may reclaim it. Longer than
 * any adapter call runs (a full duplicate is capped at 4,000 objects), so a live call is never
 * taken over; a claim left by a crash stops wedging its `opId` after this.
 */
export const STALE_CLAIM_MS = 10 * 60_000;

/**
 * Claim `opId` before running a write op. The insert is the lock: of two concurrent calls with the
 * same `opId`, exactly one inserts. The other gets the row it lost to — `pending` while the first is
 * still running, `done` with the stored result after.
 */
export async function claimOp(row: {
	opId: string;
	runId: string;
	agent: string;
	op: string;
	inputHash: string;
}): Promise<OpClaim> {
	await getDb()
		.delete(directorOps)
		.where(
			and(
				eq(directorOps.opId, row.opId),
				eq(directorOps.status, 'pending'),
				lt(directorOps.createdAt, new Date(Date.now() - STALE_CLAIM_MS)),
			),
		);
	const inserted = await getDb()
		.insert(directorOps)
		.values({ ...row, status: 'pending' })
		.onConflictDoNothing({ target: directorOps.opId })
		.returning({ opId: directorOps.opId });
	if (inserted.length > 0) return { claimed: true };
	const [existing] = await getDb().select().from(directorOps).where(eq(directorOps.opId, row.opId));
	// Released between our insert and this read: nothing stored, so it is the caller's to retry.
	if (!existing) return claimOp(row);
	return { claimed: false, existing };
}

export async function completeOp(opId: string, result: unknown): Promise<void> {
	await getDb()
		.update(directorOps)
		.set({ status: 'done', result, completedAt: new Date() })
		.where(eq(directorOps.opId, opId));
}

/** Drop a claim whose op failed, so a retry runs it again rather than replaying the failure. */
export async function releaseOp(opId: string): Promise<void> {
	await getDb()
		.delete(directorOps)
		.where(and(eq(directorOps.opId, opId), eq(directorOps.status, 'pending')));
}

/** Record a still render a run queued, as atlas-tool named it. */
export async function insertAtlasJob(row: {
	jobRef: string;
	runId: string;
	agent: string;
	atlas: string;
	regions: string[];
}): Promise<void> {
	await getDb().transaction(async (tx) => {
		const inserted = await tx
			.insert(directorAtlasJobs)
			.values({ ...row, status: 'queued' })
			.onConflictDoNothing({ target: directorAtlasJobs.jobRef })
			.returning({ jobRef: directorAtlasJobs.jobRef });
		if (inserted.length === 0) return;
		await tx.insert(directorEvents).values({
			runId: row.runId,
			agent: row.agent,
			kind: 'job_queued',
			tool: 'atlas.queue_variants',
			payloadJson: { jobRef: row.jobRef, atlas: row.atlas, regions: row.regions },
		});
	});
}

export async function getAtlasJob(jobRef: string): Promise<DirectorAtlasJob | null> {
	const [row] = await getDb()
		.select()
		.from(directorAtlasJobs)
		.where(eq(directorAtlasJobs.jobRef, jobRef));
	return row ?? null;
}

/**
 * The run's `job_done`: move a queued render of `runId` to its terminal status and append the
 * `job_done` event that wakes the worker, in one transaction. Conditional on it still being
 * `queued`, so of the callback, its redeliveries and the `/progress` fallback, exactly one records
 * it. Returns the settled row to that one caller, and `null` to every other.
 */
export async function settleAtlasJob(done: {
	jobRef: string;
	runId: string;
	status: 'finished' | 'failed' | 'cancelled';
	result: unknown;
	via: 'callback' | 'poll';
}): Promise<DirectorAtlasJob | null> {
	return getDb().transaction(async (tx) => {
		const [row] = await tx
			.update(directorAtlasJobs)
			.set({ status: done.status, result: done.result, doneVia: done.via, doneAt: new Date() })
			.where(
				and(
					eq(directorAtlasJobs.jobRef, done.jobRef),
					eq(directorAtlasJobs.runId, done.runId),
					eq(directorAtlasJobs.status, 'queued'),
				),
			)
			.returning();
		if (!row) return null;
		await tx.insert(directorEvents).values({
			runId: row.runId,
			agent: row.agent,
			kind: 'job_done',
			tool: 'atlas.queue_variants',
			payloadJson: {
				jobRef: row.jobRef,
				atlas: row.atlas,
				regions: row.regions,
				status: row.status,
				via: done.via,
				result: done.result,
			},
		});
		return row;
	});
}

/** The run's events after `afterId`, oldest first — the live stream's catch-up read. */
export async function listEventsAfter(
	runId: string,
	afterId: number,
	limit: number,
): Promise<DirectorEvent[]> {
	return getDb()
		.select()
		.from(directorEvents)
		.where(and(eq(directorEvents.runId, runId), gt(directorEvents.id, afterId)))
		.orderBy(asc(directorEvents.id))
		.limit(limit);
}

/**
 * The id just before the run's `count` most recent events with `id <= upTo`, or 0 when there are no
 * more than `count` — the stream's look-back start, counted in THIS run's rows (`id` is shared by
 * every run).
 */
export async function eventAnchor(runId: string, upTo: number, count: number): Promise<number> {
	const [row] = await getDb()
		.select({ id: directorEvents.id })
		.from(directorEvents)
		.where(and(eq(directorEvents.runId, runId), lte(directorEvents.id, upTo)))
		.orderBy(desc(directorEvents.id))
		.offset(count)
		.limit(1);
	return row?.id ?? 0;
}

/** One event of the run, or null — a NOTIFY names it and the stream fetches it. */
export async function getEvent(runId: string, id: number): Promise<DirectorEvent | null> {
	const [row] = await getDb()
		.select()
		.from(directorEvents)
		.where(and(eq(directorEvents.runId, runId), eq(directorEvents.id, id)));
	return row ?? null;
}
