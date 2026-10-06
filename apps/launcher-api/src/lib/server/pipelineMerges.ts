import { desc, eq, inArray } from 'drizzle-orm';
import { getDb } from './db';
import { pipelineMerges, type MergeApproval, type PipelineMerge } from './db/schema';

/**
 * Postgres access for the merges Invisible Pipeline Changes made (ADR-0007, `pipeline_merges`).
 * Kept to this one module so the pipeline-changes fixture can replace the database at a single
 * seam, as it does for `pipelineApprovals.ts`.
 */

export type { MergeApproval, PipelineMerge };

export interface NewMerge {
	requestId: string;
	prNumber: number;
	title: string;
	headSha: string;
	mergeSha: string;
	mergedById: string;
	mergedBy: string;
	approvals: MergeApproval[];
	revertOf: number | null;
}

/** History holds this many merges at most; the launcher merges a few a day. */
export const HISTORY_LIMIT = 200;

/** The newest merges first. */
export async function listMerges(limit: number = HISTORY_LIMIT): Promise<PipelineMerge[]> {
	return getDb().select().from(pipelineMerges).orderBy(desc(pipelineMerges.at)).limit(limit);
}

/** The merge of one pull request, or `null` when the launcher never merged it. */
export async function findMerge(prNumber: number): Promise<PipelineMerge | null> {
	const [row] = await getDb()
		.select()
		.from(pipelineMerges)
		.where(eq(pipelineMerges.prNumber, prNumber));
	return row ?? null;
}

/** The merge a request already made, so a resend answers the same row. */
export async function findMergeByRequest(requestId: string): Promise<PipelineMerge | null> {
	const [row] = await getDb()
		.select()
		.from(pipelineMerges)
		.where(eq(pipelineMerges.requestId, requestId));
	return row ?? null;
}

/** The merged reverts of these pull requests, by the number each one undoes. */
export async function revertsOf(prNumbers: number[]): Promise<Map<number, PipelineMerge>> {
	if (!prNumbers.length) return new Map();
	const rows = await getDb()
		.select()
		.from(pipelineMerges)
		.where(inArray(pipelineMerges.revertOf, prNumbers))
		.orderBy(desc(pipelineMerges.at));
	const byTarget = new Map<number, PipelineMerge>();
	for (const row of rows) {
		if (row.revertOf !== null && !byTarget.has(row.revertOf)) byTarget.set(row.revertOf, row);
	}
	return byTarget;
}

/**
 * Record a merge. One row per pull request: a second record of the same number (a retry that
 * raced another) returns the row already there rather than failing, so the caller's answer is
 * the merge as recorded whichever request wrote it.
 */
export async function recordMerge(input: NewMerge): Promise<PipelineMerge> {
	const db = getDb();
	const [inserted] = await db
		.insert(pipelineMerges)
		.values(input)
		.onConflictDoNothing({ target: pipelineMerges.prNumber })
		.returning();
	if (inserted) return inserted;
	const existing = await findMerge(input.prNumber);
	if (!existing)
		throw new Error(`the merge of #${input.prNumber} vanished between insert and read`);
	return existing;
}
