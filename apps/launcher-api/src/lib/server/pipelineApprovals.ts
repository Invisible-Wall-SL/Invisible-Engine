import { desc, eq } from 'drizzle-orm';
import { getDb } from './db';
import { pipelineApprovals, type PipelineApproval } from './db/schema';

/**
 * Postgres access for diff approvals (ADR-0007, `pipeline_approvals`). Kept to this one module so
 * the pipeline-changes fixture can replace the database at a single seam.
 */

export type { PipelineApproval };

export interface NewApproval {
	diffId: string;
	prNumber: number;
	headSha: string;
	approverId: string;
	approver: string;
	note: string | null;
}

/** Every approval on this head, newest first. A head the harness never ran on has none. */
export async function listApprovals(headSha: string): Promise<PipelineApproval[]> {
	return getDb()
		.select()
		.from(pipelineApprovals)
		.where(eq(pipelineApprovals.headSha, headSha))
		.orderBy(desc(pipelineApprovals.at));
}

/**
 * Record an approval. A diff is approved once: a second approval of the same id — a double click,
 * a second approver — returns the first, unchanged.
 */
export async function recordApproval(input: NewApproval): Promise<PipelineApproval> {
	const db = getDb();
	const [inserted] = await db
		.insert(pipelineApprovals)
		.values(input)
		.onConflictDoNothing({ target: pipelineApprovals.diffId })
		.returning();
	if (inserted) return inserted;
	const [existing] = await db
		.select()
		.from(pipelineApprovals)
		.where(eq(pipelineApprovals.diffId, input.diffId));
	return existing;
}
