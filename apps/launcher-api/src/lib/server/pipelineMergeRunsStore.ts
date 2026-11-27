import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
	LIVE_MERGE_RUN_STATUSES,
	WORKING_MERGE_RUN_STATUSES,
	mergeRunSpendId,
	type MergeRunExplanation,
	type MergeRunFile,
	type MergeRunRefusal,
	type MergeRunStatus,
} from '$lib/mergeMainRuns';
import { getDb } from './db';
import { directorSpend, mergeMainRuns, type MergeMainRun } from './db/schema';

/**
 * Postgres access for Resolve conflict runs (ADR-0015 §8), kept to this one module so the merge-runs
 * fixture can replace the database at a single seam. Every change of a run's state is a conditional
 * update that applies only from the states it names, so two writers that race (the job's result, a
 * person's Accept or Discard, the backstop) settle a run once. The decisions are the callers'.
 */

export type { MergeMainRun };

const LIVE = [...LIVE_MERGE_RUN_STATUSES];
const WORKING = [...WORKING_MERGE_RUN_STATUSES];
const LIVE_INDEX = 'merge_main_runs_live_idx';
const GH_RUN_INDEX = 'merge_main_runs_gh_run_id_idx';
/** A run's spend names at most this many models over all its posts, as a fix run's does. */
export const MAX_MERGE_SPEND_MODELS = 10;

function uniqueViolation(e: unknown, index: string): boolean {
	const cause = (e as { cause?: { code?: string; constraint_name?: string } }).cause;
	const code = cause?.code ?? (e as { code?: string }).code;
	const constraint = cause?.constraint_name ?? (e as { constraint_name?: string }).constraint_name;
	return code === '23505' && constraint === index;
}

export async function getMergeRun(id: string): Promise<MergeMainRun | null> {
	const [run] = await getDb().select().from(mergeMainRuns).where(eq(mergeMainRuns.id, id));
	return run ?? null;
}

export async function getMergeRunByRequest(requestId: string): Promise<MergeMainRun | null> {
	const [run] = await getDb()
		.select()
		.from(mergeMainRuns)
		.where(eq(mergeMainRuns.requestId, requestId));
	return run ?? null;
}

/** A change's runs, newest first. */
export async function mergeRunsOfPr(prNumber: number, limit = 10): Promise<MergeMainRun[]> {
	return getDb()
		.select()
		.from(mergeMainRuns)
		.where(eq(mergeMainRuns.prNumber, prNumber))
		.orderBy(desc(mergeMainRuns.createdAt))
		.limit(limit);
}

/** Every run whose job has not posted (what the backstop settles), oldest first. */
export async function workingMergeRuns(): Promise<MergeMainRun[]> {
	return getDb()
		.select()
		.from(mergeMainRuns)
		.where(inArray(mergeMainRuns.status, WORKING))
		.orderBy(asc(mergeMainRuns.createdAt));
}

export interface NewMergeRun {
	id: string;
	prNumber: number;
	branch: string;
	headSha: string;
	mainSha: string;
	requestId: string;
	startedById: string;
	startedBy: string;
}

export type StartOutcome =
	| { kind: 'created'; run: MergeMainRun }
	| { kind: 'exists'; run: MergeMainRun }
	| { kind: 'refused'; code: MergeRunRefusal };

/**
 * Start a run: the request replayed to the run it made, the change's live run read under the
 * transaction and handed to `decide`, then the run inserted `dispatched`. A start that loses a race
 * is told by the partial unique index.
 */
export async function insertMergeRun(
	values: NewMergeRun,
	decide: (liveRun: string | null) => MergeRunRefusal | null,
): Promise<StartOutcome> {
	try {
		return await getDb().transaction(async (tx): Promise<StartOutcome> => {
			const [prior] = await tx
				.select()
				.from(mergeMainRuns)
				.where(eq(mergeMainRuns.requestId, values.requestId));
			if (prior) return { kind: 'exists', run: prior };
			const [live] = await tx
				.select({ id: mergeMainRuns.id })
				.from(mergeMainRuns)
				.where(
					and(eq(mergeMainRuns.prNumber, values.prNumber), inArray(mergeMainRuns.status, LIVE)),
				);
			const refused = decide(live?.id ?? null);
			if (refused) return { kind: 'refused', code: refused };
			const [run] = await tx
				.insert(mergeMainRuns)
				.values({ ...values, status: 'dispatched' })
				.returning();
			return { kind: 'created', run };
		});
	} catch (e) {
		if (uniqueViolation(e, LIVE_INDEX)) return { kind: 'refused', code: 'merge_run_live' };
		throw e;
	}
}

/**
 * Bind the Actions run to a run still `dispatched` and unbound. `taken`: that Actions run is
 * another merge run's; `stale`: this run is bound already, or no longer dispatched.
 */
export async function bindMergeRun(
	id: string,
	ghRunId: number,
): Promise<'bound' | 'taken' | 'stale'> {
	try {
		const rows = await getDb()
			.update(mergeMainRuns)
			.set({ ghRunId, updatedAt: new Date() })
			.where(
				and(
					eq(mergeMainRuns.id, id),
					isNull(mergeMainRuns.ghRunId),
					eq(mergeMainRuns.status, 'dispatched'),
				),
			)
			.returning({ id: mergeMainRuns.id });
		return rows.length ? 'bound' : 'stale';
	} catch (e) {
		if (uniqueViolation(e, GH_RUN_INDEX)) return 'taken';
		throw e;
	}
}

/** `dispatched → running`, once the backstop sees the Actions run going. */
export async function markMergeRunRunning(id: string): Promise<void> {
	await getDb()
		.update(mergeMainRuns)
		.set({ status: 'running', updatedAt: new Date() })
		.where(and(eq(mergeMainRuns.id, id), eq(mergeMainRuns.status, 'dispatched')));
}

/** How a run ends: its status and what it is shown with. */
export interface MergeRunEnd {
	status: Exclude<MergeRunStatus, 'dispatched' | 'running'>;
	reason?: string;
	files?: MergeRunFile[] | null;
	explanation?: MergeRunExplanation | null;
	mergeSha?: string;
	baseSha?: string;
	acceptedBy?: { id: string; name: string };
}

/**
 * Move a run from one of the states `from` to its end, in one conditional update; null when it was
 * not in one of them (someone else settled it). A job's result is the only writer of `result_at`,
 * and only from `dispatched`/`running`, so a second result finds the run already moved. A run that
 * ends still `dispatched` never ran Claude Code: its spend is $0, not unknown.
 */
export async function settleMergeRun(
	id: string,
	from: readonly MergeRunStatus[],
	end: MergeRunEnd,
	opts: { result?: boolean } = {},
): Promise<MergeMainRun | null> {
	const now = new Date();
	const proposing = end.status === 'proposed';
	const [run] = await getDb()
		.update(mergeMainRuns)
		.set({
			status: end.status,
			reason: end.reason ?? null,
			...(end.files === undefined ? {} : { files: end.files }),
			...(end.explanation === undefined ? {} : { explanation: end.explanation }),
			...(end.mergeSha === undefined ? {} : { mergeSha: end.mergeSha }),
			...(end.baseSha === undefined ? {} : { baseSha: end.baseSha }),
			...(end.acceptedBy
				? { acceptedById: end.acceptedBy.id, acceptedBy: end.acceptedBy.name }
				: {}),
			...(opts.result ? { resultAt: now } : {}),
			spendUsd: sql`case when ${mergeMainRuns.status} = 'dispatched'
				then coalesce(${mergeMainRuns.spendUsd}, 0) else ${mergeMainRuns.spendUsd} end`,
			finishedAt: proposing ? null : now,
			updatedAt: now,
		})
		.where(and(eq(mergeMainRuns.id, id), inArray(mergeMainRuns.status, [...from])))
		.returning();
	return run ?? null;
}

/** One model's priced usage for the ledger. */
export interface MergeRunSpendRow {
	model: string;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	usd: number;
}

/**
 * Record a run's spend, one `director_spend` row per model (`run_id` `merge:<id>`, agent
 * `merge-main`, `request_id` `merge:<id>:<model>`, so a replayed result bills once), and put the
 * run's total on it, under the run's row lock. Answers the total, or null (nothing written) when the
 * run would name more than {@link MAX_MERGE_SPEND_MODELS} models in all.
 */
export async function recordMergeRunSpend(
	id: string,
	agent: string,
	rows: MergeRunSpendRow[],
): Promise<number | null> {
	const runId = mergeRunSpendId(id);
	return getDb().transaction(async (tx) => {
		await tx
			.select({ id: mergeMainRuns.id })
			.from(mergeMainRuns)
			.where(eq(mergeMainRuns.id, id))
			.for('update');
		const known = await tx
			.selectDistinct({ model: directorSpend.model })
			.from(directorSpend)
			.where(eq(directorSpend.runId, runId));
		const models = new Set([...known.map((k) => k.model), ...rows.map((r) => r.model)]);
		if (models.size > MAX_MERGE_SPEND_MODELS) return null;
		if (rows.length) {
			await tx
				.insert(directorSpend)
				.values(
					rows.map((r) => ({
						runId,
						agent,
						model: r.model,
						inputTokens: r.inputTokens,
						outputTokens: r.outputTokens,
						cacheReadTokens: r.cacheReadTokens,
						cacheWriteTokens: r.cacheWriteTokens,
						usd: r.usd,
						kind: 'claude' as const,
						requestId: `${runId}:${r.model}`,
					})),
				)
				.onConflictDoNothing({ target: directorSpend.requestId });
		}
		const [{ usd }] = await tx
			.select({ usd: sql<number>`coalesce(sum(${directorSpend.usd}), 0)`.mapWith(Number) })
			.from(directorSpend)
			.where(eq(directorSpend.runId, runId));
		await tx
			.update(mergeMainRuns)
			.set({ spendUsd: usd, updatedAt: new Date() })
			.where(eq(mergeMainRuns.id, id));
		return usd;
	});
}
