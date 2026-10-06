import { and, desc, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import { getDb } from './db';
import { pipelineMerges, type MergeApproval, type PipelineMerge } from './db/schema';

/**
 * Postgres access for the merges Invisible Pipeline Changes made (ADR-0007, `pipeline_merges`).
 * Kept to this one module so the pipeline-changes fixture can replace the database at a single
 * seam, as it does for `pipelineApprovals.ts`.
 */

export type { MergeApproval, PipelineMerge };

/** A row whose merge GitHub made: not a claim. */
export type CompletedMerge = PipelineMerge & { mergeSha: string };

/** A claim: everything about a merge but its commit, which GitHub has not made yet. */
export interface NewClaim {
	requestId: string;
	prNumber: number;
	title: string;
	headSha: string;
	mergedById: string;
	mergedBy: string;
	approvals: MergeApproval[];
	revertOf: number | null;
}

/** History holds this many merges at most; the launcher merges a few a day. */
const HISTORY_LIMIT = 200;

const completed = isNotNull(pipelineMerges.mergeSha);
const isCompleted = (row: PipelineMerge): row is CompletedMerge => row.mergeSha !== null;

/** The newest merges first; claims are merges in flight, not merges, and are left out. */
export async function listMerges(): Promise<CompletedMerge[]> {
	const rows = await getDb()
		.select()
		.from(pipelineMerges)
		.where(completed)
		.orderBy(desc(pipelineMerges.at))
		.limit(HISTORY_LIMIT);
	return rows.filter(isCompleted);
}

/** The row of one pull request — a completed merge or a claim — or `null`. */
export async function findMerge(prNumber: number): Promise<PipelineMerge | null> {
	const [row] = await getDb()
		.select()
		.from(pipelineMerges)
		.where(eq(pipelineMerges.prNumber, prNumber));
	return row ?? null;
}

/** The row a request wrote — a completed merge or a claim — so a resend answers or reuses it. */
export async function findMergeByRequest(requestId: string): Promise<PipelineMerge | null> {
	const [row] = await getDb()
		.select()
		.from(pipelineMerges)
		.where(eq(pipelineMerges.requestId, requestId));
	return row ?? null;
}

/** The merged reverts of these pull requests, by the number each one undoes. */
export async function revertsOf(prNumbers: number[]): Promise<Map<number, CompletedMerge>> {
	if (!prNumbers.length) return new Map();
	const rows = await getDb()
		.select()
		.from(pipelineMerges)
		.where(and(inArray(pipelineMerges.revertOf, prNumbers), completed))
		.orderBy(desc(pipelineMerges.at));
	const byTarget = new Map<number, CompletedMerge>();
	for (const row of rows.filter(isCompleted)) {
		if (row.revertOf !== null && !byTarget.has(row.revertOf)) byTarget.set(row.revertOf, row);
	}
	return byTarget;
}

/**
 * Claim the merge of a pull request, before GitHub is asked. `null` when ANY unique key is taken —
 * the pull request already has a row (a merge, or another request's claim), or this request id
 * already wrote one — so two requests, in one process or two, never both go on to merge.
 */
export async function claimMerge(input: NewClaim): Promise<PipelineMerge | null> {
	const [row] = await getDb()
		.insert(pipelineMerges)
		.values({ ...input, mergeSha: null })
		.onConflictDoNothing()
		.returning();
	return row ?? null;
}

/**
 * A claim completed with the commit GitHub's merge made. A claim that is gone — settled as never
 * merged by a reconcile that ran while this merge was in flight — is written again whole, as the
 * completed row: GitHub did merge, so the record must exist whatever happened to the claim.
 */
export async function completeMerge(
	claim: PipelineMerge,
	mergeSha: string,
): Promise<CompletedMerge> {
	const db = getDb();
	const [updated] = await db
		.update(pipelineMerges)
		.set({ mergeSha })
		.where(eq(pipelineMerges.id, claim.id))
		.returning();
	if (updated) return { ...updated, mergeSha };
	const [inserted] = await db
		.insert(pipelineMerges)
		.values({ ...claim, mergeSha })
		.onConflictDoNothing()
		.returning();
	if (inserted) return { ...inserted, mergeSha };
	const existing = await findMerge(claim.prNumber);
	if (existing && isCompleted(existing)) return existing;
	throw new Error(`the merge of #${claim.prNumber} (${mergeSha}) could not be recorded`);
}

/** Drop a claim whose merge did not happen. A completed merge is never dropped. */
export async function dropClaim(id: string): Promise<void> {
	await getDb()
		.delete(pipelineMerges)
		.where(and(eq(pipelineMerges.id, id), isNull(pipelineMerges.mergeSha)));
}

/** The claims older than this: requests that died, or that GitHub never answered. */
export async function listClaims(olderThanMs: number): Promise<PipelineMerge[]> {
	return getDb()
		.select()
		.from(pipelineMerges)
		.where(
			and(
				isNull(pipelineMerges.mergeSha),
				lt(pipelineMerges.at, new Date(Date.now() - olderThanMs)),
			),
		);
}
