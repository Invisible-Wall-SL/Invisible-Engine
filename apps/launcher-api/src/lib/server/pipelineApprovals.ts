import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Role } from '$lib/roles';
import { getDb } from './db';
import { pipelineApprovals, users, type PipelineApproval } from './db/schema';

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

export interface ApproverAccount {
	role: Role;
	active: boolean;
	expiresAt: Date | null;
}

/** Every approval on this head, newest first. A head the harness never ran on has none. */
export async function listApprovals(headSha: string): Promise<PipelineApproval[]> {
	return getDb()
		.select()
		.from(pipelineApprovals)
		.where(eq(pipelineApprovals.headSha, headSha))
		.orderBy(desc(pipelineApprovals.at));
}

/** The accounts behind approvals, as they stand now, by id; a deleted account is absent. */
export async function getApprovers(userIds: string[]): Promise<Map<string, ApproverAccount>> {
	if (!userIds.length) return new Map();
	const rows = await getDb()
		.select({ id: users.id, role: users.role, active: users.active, expiresAt: users.expiresAt })
		.from(users)
		.where(inArray(users.id, userIds));
	return new Map(rows.map(({ id, ...account }) => [id, account]));
}

/**
 * Record an approval. One row per diff per approver: the same approver's second click returns
 * their first row unchanged, while another approver adds a row of their own.
 */
export async function recordApproval(input: NewApproval): Promise<PipelineApproval> {
	const db = getDb();
	const [inserted] = await db
		.insert(pipelineApprovals)
		.values(input)
		.onConflictDoNothing({ target: [pipelineApprovals.diffId, pipelineApprovals.approverId] })
		.returning();
	if (inserted) return inserted;
	const [existing] = await db
		.select()
		.from(pipelineApprovals)
		.where(
			and(
				eq(pipelineApprovals.diffId, input.diffId),
				eq(pipelineApprovals.approverId, input.approverId),
			),
		);
	if (!existing) throw new Error(`approval of ${input.diffId} vanished between insert and read`);
	return existing;
}
