import { and, eq, lt } from 'drizzle-orm';
import { getDb } from '../db';
import {
	directorAtlasJobs,
	directorOps,
	directorRuns,
	users,
	type DirectorAtlasJob,
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
	await getDb()
		.insert(directorAtlasJobs)
		.values({ ...row, status: 'queued' })
		.onConflictDoNothing({ target: directorAtlasJobs.jobRef });
}

export async function getAtlasJob(jobRef: string): Promise<DirectorAtlasJob | null> {
	const [row] = await getDb()
		.select()
		.from(directorAtlasJobs)
		.where(eq(directorAtlasJobs.jobRef, jobRef));
	return row ?? null;
}

/**
 * The run's `job_done`: move a queued render of `runId` to its terminal status. Conditional on it
 * still being `queued`, so of the callback, its redeliveries and the `/progress` fallback, exactly
 * one records it. Returns the settled row to that one caller, and `null` to every other.
 */
export async function settleAtlasJob(done: {
	jobRef: string;
	runId: string;
	status: 'finished' | 'failed' | 'cancelled';
	result: unknown;
	via: 'callback' | 'poll';
}): Promise<DirectorAtlasJob | null> {
	const [row] = await getDb()
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
	return row ?? null;
}
