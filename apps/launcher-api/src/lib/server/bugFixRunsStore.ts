import { and, asc, count, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import {
	LIVE_FIX_RUN_STATUSES,
	fixRunSpendId,
	type FixRunOutcome,
	type FixRunRefusal,
	type FixRunSecondBug,
	type FixRunStatus,
} from '$lib/bugFixRuns';
import type { Actor } from './bugReportsStore';
import { getDb } from './db';
import {
	bugFixRuns,
	bugReportEvents,
	bugReportLinks,
	bugReports,
	clients,
	directorSpend,
	projects,
	users,
	type BugFixRun,
	type BugReport,
} from './db/schema';

/**
 * Postgres access for fix runs on pipeline bugs (ADR-0013), kept to this one module so the fix-runs
 * fixture can replace the database at a single seam. Every change of a run's state is a conditional
 * update — it applies only while the run is still live (and, where it says so, while no result has
 * been claimed) — written in one transaction with the bug's `fix_run` event, so two writers that
 * race (the job's result, a person's Stop, the backstop) settle a run once. The decisions are the
 * callers' (`bugFixRuns.ts`), never made here.
 */

export type { BugFixRun };

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

const LIVE = [...LIVE_FIX_RUN_STATUSES];
const live = () => inArray(bugFixRuns.status, LIVE);

/** A start that loses a race on one bug is told by the partial unique index. */
const LIVE_INDEX = 'bug_fix_runs_live_idx';
/** One Actions run binds one fix run. */
const GH_RUN_INDEX = 'bug_fix_runs_gh_run_id_idx';
/**
 * The one advisory lock every start takes, so two starts on different bugs read the live count one
 * after the other. A fixed key, written into the SQL: `0x0013_0013` (ADR-0013), used by nothing else.
 */
const LIVE_LOCK_KEY = 0x0013_0013;
/** A run's spend names at most this many models over all its posts: the ledger is not a dump. */
export const MAX_SPEND_MODELS = 10;

function uniqueViolation(e: unknown, index: string): boolean {
	const cause = (e as { cause?: { code?: string; constraint_name?: string } }).cause;
	const code = cause?.code ?? (e as { code?: string }).code;
	const constraint = cause?.constraint_name ?? (e as { constraint_name?: string }).constraint_name;
	return code === '23505' && constraint === index;
}

/** One `fix_run` event on the run's bug, which the bug's activity shows; the bug is touched. */
async function recordEvent(
	tx: Tx,
	bugNumber: number,
	actor: Actor,
	data: Record<string, unknown>,
): Promise<void> {
	const now = new Date();
	await tx.insert(bugReportEvents).values({
		bugNumber,
		kind: 'fix_run',
		actorId: actor.id,
		actor: actor.name,
		data,
	});
	await tx.update(bugReports).set({ updatedAt: now }).where(eq(bugReports.number, bugNumber));
}

export async function getFixRun(id: string): Promise<BugFixRun | null> {
	const [run] = await getDb().select().from(bugFixRuns).where(eq(bugFixRuns.id, id));
	return run ?? null;
}

export async function getFixRunByRequest(requestId: string): Promise<BugFixRun | null> {
	const [run] = await getDb().select().from(bugFixRuns).where(eq(bugFixRuns.requestId, requestId));
	return run ?? null;
}

/** A bug's runs, newest first. Its live run, if any, is the newest: none starts beside it. */
export async function fixRunsOfBug(number: number, limit = 10): Promise<BugFixRun[]> {
	return getDb()
		.select()
		.from(bugFixRuns)
		.where(eq(bugFixRuns.bugNumber, number))
		.orderBy(desc(bugFixRuns.createdAt))
		.limit(limit);
}

/** Every live run over every bug, oldest first. */
export async function liveFixRuns(): Promise<BugFixRun[]> {
	return getDb().select().from(bugFixRuns).where(live()).orderBy(asc(bugFixRuns.createdAt));
}

export async function liveFixRunCount(): Promise<number> {
	const [{ n }] = await getDb().select({ n: count() }).from(bugFixRuns).where(live());
	return Number(n);
}

/** What fix runs have spent since `since` (`director_spend`, agent `bug-fix`). */
export async function fixSpendSince(since: Date, agent: string): Promise<number> {
	const [{ usd }] = await getDb()
		.select({ usd: sql<number>`coalesce(sum(${directorSpend.usd}), 0)`.mapWith(Number) })
		.from(directorSpend)
		.where(and(eq(directorSpend.agent, agent), gte(directorSpend.at, since)));
	return usd;
}

export interface NewFixRun {
	id: string;
	bugNumber: number;
	baseSha: string;
	requestId: string;
	startedById: string;
	startedBy: string;
}

/** What a start re-reads under the bug's lock and the live-count lock. */
export interface LockedStartFacts {
	bug: BugReport;
	openPr: number | null;
	liveRun: string | null;
	liveTotal: number;
}

export type StartOutcome =
	| { kind: 'created'; run: BugFixRun }
	| { kind: 'exists'; run: BugFixRun }
	| { kind: 'refused'; code: FixRunRefusal; facts: LockedStartFacts | null }
	| { kind: 'missing' };

/**
 * Start a run, in one transaction: the bug's row locked (as `mutateBug` does) and every start
 * serialised on one advisory lock, so the live count two people read at once is the count; the
 * facts re-read and handed to `decide`, which refuses or lets it in; the run inserted `dispatched`
 * (a replayed `request_id` answers the run it made); an unsent bug sent first (`sent` event), then
 * the `fix_run` event — both by `actor`, the person.
 */
export async function insertFixRun(
	values: NewFixRun,
	actor: Actor,
	decide: (facts: LockedStartFacts) => FixRunRefusal | null,
): Promise<StartOutcome> {
	try {
		return await getDb().transaction(async (tx): Promise<StartOutcome> => {
			const [bug] = await tx
				.select()
				.from(bugReports)
				.where(eq(bugReports.number, values.bugNumber))
				.for('update');
			if (!bug) return { kind: 'missing' };
			await tx.execute(sql`select pg_advisory_xact_lock(${sql.raw(String(LIVE_LOCK_KEY))})`);
			const [prior] = await tx
				.select()
				.from(bugFixRuns)
				.where(eq(bugFixRuns.requestId, values.requestId));
			if (prior) return { kind: 'exists', run: prior };
			const [open] = await tx
				.select({ pr: bugReportLinks.prNumber })
				.from(bugReportLinks)
				.where(and(eq(bugReportLinks.bugNumber, bug.number), eq(bugReportLinks.state, 'open')))
				.orderBy(asc(bugReportLinks.prNumber))
				.limit(1);
			const going = await tx
				.select({ id: bugFixRuns.id, bugNumber: bugFixRuns.bugNumber })
				.from(bugFixRuns)
				.where(live());
			const facts: LockedStartFacts = {
				bug,
				openPr: open?.pr ?? null,
				liveRun: going.find((r) => r.bugNumber === bug.number)?.id ?? null,
				liveTotal: going.length,
			};
			const refused = decide(facts);
			if (refused) return { kind: 'refused', code: refused, facts };
			const [run] = await tx
				.insert(bugFixRuns)
				.values({ ...values, status: 'dispatched' })
				.onConflictDoNothing({ target: bugFixRuns.requestId })
				.returning();
			if (!run) {
				const [again] = await tx
					.select()
					.from(bugFixRuns)
					.where(eq(bugFixRuns.requestId, values.requestId));
				return { kind: 'exists', run: again };
			}
			const who = { actorId: actor.id, actor: actor.name };
			const now = new Date();
			if (!bug.sentAt) {
				await tx
					.update(bugReports)
					.set({ sentAt: now, sentBy: actor.name, updatedAt: now })
					.where(eq(bugReports.number, bug.number));
				await tx
					.insert(bugReportEvents)
					.values({ bugNumber: bug.number, kind: 'sent', ...who, data: {} });
			}
			await recordEvent(tx, bug.number, actor, { run: run.id, status: 'dispatched' });
			return { kind: 'created', run };
		});
	} catch (e) {
		if (uniqueViolation(e, LIVE_INDEX))
			return { kind: 'refused', code: 'fix_run_live', facts: null };
		throw e;
	}
}

/**
 * Bind the Actions run to a run still `dispatched` and unbound. `taken`: that Actions run is
 * another fix run's; `stale`: this run is bound already, or no longer dispatched.
 */
export async function bindFixRun(
	id: string,
	ghRunId: number,
): Promise<'bound' | 'taken' | 'stale'> {
	try {
		const rows = await getDb()
			.update(bugFixRuns)
			.set({ ghRunId, updatedAt: new Date() })
			.where(
				and(eq(bugFixRuns.id, id), isNull(bugFixRuns.ghRunId), eq(bugFixRuns.status, 'dispatched')),
			)
			.returning({ id: bugFixRuns.id });
		return rows.length ? 'bound' : 'stale';
	} catch (e) {
		if (uniqueViolation(e, GH_RUN_INDEX)) return 'taken';
		throw e;
	}
}

/** `dispatched → running` once the job has read its bug; null when it was not dispatched. */
export async function markFixRunRunning(id: string, actor: Actor): Promise<BugFixRun | null> {
	return getDb().transaction(async (tx) => {
		const [run] = await tx
			.update(bugFixRuns)
			.set({ status: 'running', updatedAt: new Date() })
			.where(and(eq(bugFixRuns.id, id), eq(bugFixRuns.status, 'dispatched')))
			.returning();
		if (!run) return null;
		await recordEvent(tx, run.bugNumber, actor, { run: id, status: 'running' });
		return run;
	});
}

/**
 * Claim the run's one result, as a lease: `result_at` set while the run is live and unclaimed, or
 * claimed before `staleBefore` (the request holding it died; this one finishes its work). Null when
 * a fresh claim holds it or the run has ended — one result at a time opens the PR.
 */
export async function claimFixRunResult(id: string, staleBefore: Date): Promise<BugFixRun | null> {
	const now = new Date();
	const [run] = await getDb()
		.update(bugFixRuns)
		.set({ resultAt: now, updatedAt: now })
		.where(
			and(
				eq(bugFixRuns.id, id),
				live(),
				or(isNull(bugFixRuns.resultAt), lt(bugFixRuns.resultAt, staleBefore)),
			),
		)
		.returning();
	return run ?? null;
}

/**
 * Renew the claim a request holds — the `result_at` it was given, still the run's, the run still
 * live — and answer the new one; null when another request took it over or the run has ended.
 */
export async function renewFixRunClaim(id: string, heldAt: Date): Promise<Date | null> {
	const now = new Date();
	const [run] = await getDb()
		.update(bugFixRuns)
		.set({ resultAt: now, updatedAt: now })
		.where(and(eq(bugFixRuns.id, id), live(), eq(bugFixRuns.resultAt, heldAt)))
		.returning({ resultAt: bugFixRuns.resultAt });
	return run?.resultAt ?? null;
}

/** How a run ends: its final status and what it is shown with. */
export interface FixRunEnd {
	status: Exclude<FixRunStatus, 'dispatched' | 'running'>;
	outcome?: FixRunOutcome;
	reason?: string;
	summary?: string;
	secondBug?: FixRunSecondBug | null;
	prNumber?: number;
	branch?: string;
}

/**
 * End a live run and record its `fix_run` event `{ run, status, pr?, outcome?, reason? }` plus
 * `extra`, in one transaction. `withoutResult`: only while no result is claimed, so neither a Stop
 * nor the backstop ends a run whose result is being opened. `heldAt`: only while the claim is
 * still that one — the request that holds it, or the backstop that read it. Null when it was no
 * longer live (or its claim moved): someone else ended it, or holds it.
 */
export async function settleFixRun(
	id: string,
	end: FixRunEnd,
	actor: Actor,
	opts: { withoutResult?: boolean; heldAt?: Date; extra?: Record<string, unknown> } = {},
): Promise<BugFixRun | null> {
	return getDb().transaction(async (tx) => {
		const now = new Date();
		const [run] = await tx
			.update(bugFixRuns)
			.set({
				status: end.status,
				outcome: end.outcome ?? null,
				reason: end.reason ?? null,
				summary: end.summary ?? null,
				secondBug: end.secondBug ?? null,
				prNumber: end.prNumber ?? null,
				branch: end.branch ?? null,
				finishedAt: now,
				updatedAt: now,
			})
			.where(
				and(
					eq(bugFixRuns.id, id),
					live(),
					opts.withoutResult ? isNull(bugFixRuns.resultAt) : undefined,
					opts.heldAt ? eq(bugFixRuns.resultAt, opts.heldAt) : undefined,
				),
			)
			.returning();
		if (!run) return null;
		await recordEvent(tx, run.bugNumber, actor, {
			run: id,
			status: end.status,
			...(end.prNumber === undefined ? {} : { pr: end.prNumber }),
			...(end.outcome === undefined ? {} : { outcome: end.outcome }),
			...(end.reason === undefined ? {} : { reason: end.reason }),
			...opts.extra,
		});
		return run;
	});
}

/** One model's priced usage for the ledger. */
export interface FixRunSpendRow {
	model: string;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	usd: number;
}

/**
 * Record a run's spend, one `director_spend` row per model (`run_id` `fix:<id>`, `request_id`
 * `fix:<id>:<model>`, so a replayed result bills once), and put the run's total on it — under the
 * run's row lock, so two posts at once sum what both wrote. Answers the total, or null (nothing
 * written) when the run would name more than {@link MAX_SPEND_MODELS} models in all.
 */
export async function recordFixRunSpend(
	id: string,
	agent: string,
	rows: FixRunSpendRow[],
): Promise<number | null> {
	const runId = fixRunSpendId(id);
	return getDb().transaction(async (tx) => {
		await tx
			.select({ id: bugFixRuns.id })
			.from(bugFixRuns)
			.where(eq(bugFixRuns.id, id))
			.for('update');
		const known = await tx
			.selectDistinct({ model: directorSpend.model })
			.from(directorSpend)
			.where(eq(directorSpend.runId, runId));
		const models = new Set([...known.map((k) => k.model), ...rows.map((r) => r.model)]);
		if (models.size > MAX_SPEND_MODELS) return null;
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
			.update(bugFixRuns)
			.set({ spendUsd: usd, updatedAt: new Date() })
			.where(eq(bugFixRuns.id, id));
		return usd;
	});
}

/**
 * What the bug's project is called, and its client: the names a fix run's public text must not
 * carry. Nulls when the project row is gone (its key still names it).
 */
export async function privateNamesOf(projectKey: string): Promise<{
	projectName: string | null;
	clientKey: string | null;
	clientName: string | null;
}> {
	const [row] = await getDb()
		.select({ projectName: projects.name, clientKey: projects.clientKey, clientName: clients.name })
		.from(projects)
		.leftJoin(clients, eq(clients.key, projects.clientKey))
		.where(eq(projects.key, projectKey));
	return {
		projectName: row?.projectName ?? null,
		clientKey: row?.clientKey ?? null,
		clientName: row?.clientName ?? null,
	};
}

/** The account's own name, or null when it has none: a pull request never names anyone by email. */
export async function accountName(userId: string): Promise<string | null> {
	const [row] = await getDb().select({ name: users.name }).from(users).where(eq(users.id, userId));
	return row?.name?.trim() || null;
}
