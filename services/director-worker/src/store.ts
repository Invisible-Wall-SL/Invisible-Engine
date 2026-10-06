import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { Sql, TransactionSql } from 'postgres';
import { WAKING_KINDS, type ClaimedRun } from './lease.ts';
import type { AnalystOutput } from './mockups/schema.ts';
import type { BilledResponse } from './mockups/vision.ts';
import {
	checkpointSettings,
	type Checkpoint,
	type RunState,
	type RunStatus,
	type RunStep,
} from './runState.ts';

/**
 * The run tables as the turn loop reads and writes them (ADR-0003). Every write that depends on
 * holding the run goes through `withLease`, which locks the run row and checks the lease in the
 * same transaction, so a driver that lost its lease writes nothing at all.
 */

export type Db = Sql | TransactionSql;

/** A run as a driver sees it inside a lease-checked transaction. */
export interface LiveRun {
	id: string;
	state: RunState;
	budgetCapUsd: number | null;
	projectKey: string;
	clientKey: string | null;
	templateProjectKey: string;
	presetJson: unknown;
	startingPointJson: unknown;
}

export class LeaseLost extends Error {
	constructor(runId: string) {
		super(`lost the lease on run ${runId}`);
		this.name = 'LeaseLost';
	}
}

interface RunRow {
	id: string;
	status: RunStatus;
	step: RunStep;
	waiting_on: Checkpoint | null;
	checkpoints_json: unknown;
	budget_cap_usd: number | null;
	project_key: string;
	client_key: string | null;
	template_project_key: string;
	preset_json: unknown;
	starting_point_json: unknown;
}

/**
 * Run `fn` in one transaction that holds the run row locked, only while this claim still holds a
 * live lease. Throws `LeaseLost` (having written nothing) when it does not.
 */
export async function withLease<T>(
	sql: Sql,
	run: Pick<ClaimedRun, 'id' | 'lease'>,
	fn: (tx: TransactionSql, live: LiveRun) => Promise<T>,
): Promise<T> {
	const result = await sql.begin(async (tx) => {
		const [row] = await tx<RunRow[]>`
			select id, status, step, waiting_on, checkpoints_json, budget_cap_usd, project_key,
				client_key, template_project_key, preset_json, starting_point_json
			from director_runs
			where id = ${run.id} and lease_holder = ${run.lease} and lease_until > now()
			for update`;
		if (!row) return { lost: true as const };
		const live: LiveRun = {
			id: row.id,
			state: {
				status: row.status,
				step: row.step,
				waitingOn: row.waiting_on,
				checkpoints: checkpointSettings(row.checkpoints_json),
			},
			budgetCapUsd: row.budget_cap_usd,
			projectKey: row.project_key,
			clientKey: row.client_key,
			templateProjectKey: row.template_project_key,
			presetJson: row.preset_json,
			startingPointJson: row.starting_point_json,
		};
		return { lost: false as const, value: await fn(tx, live) };
	});
	if (result.lost) throw new LeaseLost(run.id);
	return result.value;
}

/** Write a transition with its `run_status` event. The caller holds the row (`withLease`). */
export async function applyTransition(
	tx: Db,
	runId: string,
	from: RunState,
	to: RunState,
	cause: string,
): Promise<boolean> {
	const rows = await tx`
		update director_runs
		set status = ${to.status}, step = ${to.step}, waiting_on = ${to.waitingOn}, updated_at = now()
		where id = ${runId}
			and status = ${from.status} and step = ${from.step}
			and waiting_on is not distinct from ${from.waitingOn}
		returning id`;
	if (rows.length !== 1) return false;
	await insertEvent(tx, runId, 'worker', 'run_status', {
		from: { status: from.status, step: from.step, waitingOn: from.waitingOn },
		to: { status: to.status, step: to.step, waitingOn: to.waitingOn },
		cause,
	});
	return true;
}

export type EventKind =
	| 'activity'
	| 'checkpoint_open'
	| 'region_status'
	| 'job_queued'
	| 'spend'
	| 'run_status'
	| 'error';

export async function insertEvent(
	tx: Db,
	runId: string,
	agent: string,
	kind: EventKind,
	payload: Record<string, unknown>,
	tool: string | null = null,
): Promise<void> {
	await tx`
		insert into director_events (run_id, agent, kind, tool, payload_json)
		values (${runId}, ${agent}, ${kind}, ${tool}, ${tx.json(payload as never)})`;
}

// ── Conversations ─────────────────────────────────────────────────────────────

export interface StoredMessage {
	seq: number;
	role: 'user' | 'assistant';
	content: BetaContentBlockParam[];
}

export async function loadMessages(db: Db, runId: string, agent: string): Promise<StoredMessage[]> {
	return db<StoredMessage[]>`
		select seq, role, content_json as content from director_messages
		where run_id = ${runId} and agent = ${agent}
		order by seq`;
}

/** Append one message to an agent's conversation; returns its `seq`. Never updates a row. */
export async function appendMessage(
	tx: Db,
	runId: string,
	agent: string,
	role: 'user' | 'assistant',
	content: BetaContentBlockParam[],
): Promise<number> {
	const [row] = await tx<{ seq: number }[]>`
		insert into director_messages (run_id, agent, seq, role, content_json)
		select ${runId}, ${agent}, coalesce(max(seq), -1) + 1, ${role}, ${tx.json(content as never)}
		from director_messages where run_id = ${runId} and agent = ${agent}
		returning seq`;
	return row.seq;
}

export const hasToolUse = (m: StoredMessage) =>
	m.role === 'assistant' && m.content.some((b) => b.type === 'tool_use');

/**
 * The agents with work: their last message is the user's (a model call is owed) or an assistant
 * message whose tool calls have no results yet (a crash between the two). Oldest first.
 */
export async function pendingAgents(db: Db, runId: string): Promise<string[]> {
	const rows = await db<(StoredMessage & { agent: string; id: number })[]>`
		select distinct on (agent) agent, id, seq, role, content_json as content
		from director_messages where run_id = ${runId}
		order by agent, seq desc`;
	return rows
		.filter((m) => m.role === 'user' || hasToolUse(m))
		.sort((a, b) => a.id - b.id)
		.map((m) => m.agent);
}

// ── Owner and job events ──────────────────────────────────────────────────────

export interface WakingEvent {
	id: number;
	agent: string;
	kind: (typeof WAKING_KINDS)[number];
	tool: string | null;
	payload: Record<string, unknown>;
}

export async function unhandledEvents(db: Db, runId: string): Promise<WakingEvent[]> {
	return db<WakingEvent[]>`
		select id::int as id, agent, kind, tool, payload_json as payload from director_events
		where run_id = ${runId} and handled_at is null
			and kind = any(string_to_array(${WAKING_KINDS.join(',')}, ','))
		order by id`;
}

export async function markHandled(tx: Db, eventId: number): Promise<void> {
	await tx`update director_events set handled_at = now() where id = ${eventId}`;
}

// ── The breakdown step ────────────────────────────────────────────────────────

export interface BreakdownRevisions {
	/** How many times the owner sent the breakdown back: the `run_status` rows of a revise that
	 *  returned the run to the breakdown step. The next analysis is attempt `revisions + 1`. */
	revisions: number;
	/** The owner's notes on those revisions, oldest first, blanks left out; they go into the prompt. */
	notes: string[];
}

export async function breakdownRevisions(db: Db, runId: string): Promise<BreakdownRevisions> {
	const [{ n }] = await db<{ n: number }[]>`
		select count(*)::int as n from director_events
		where run_id = ${runId} and kind = 'run_status'
			and payload_json->>'cause' = 'owner revise'
			and payload_json->'to'->>'step' = 'breakdown'`;
	const rows = await db<{ note: string | null }[]>`
		select payload_json->>'note' as note from director_events
		where run_id = ${runId} and kind = 'checkpoint_resolved' and handled_at is not null
			and payload_json->>'checkpoint' = 'breakdown' and payload_json->>'decision' = 'revise'
		order by id`;
	return { revisions: n, notes: rows.map((r) => r.note?.trim() ?? '').filter(Boolean) };
}

/**
 * How many analysis passes the run has started (`breakdown_pass` activity rows), finished or not:
 * a pass that died before its submission still counts, so the next one takes a new number — and
 * with it a new opId for its crops.
 */
export async function breakdownPasses(db: Db, runId: string): Promise<number> {
	const [row] = await db<{ n: number }[]>`
		select count(*)::int as n from director_events
		where run_id = ${runId} and kind = 'activity' and payload_json->>'type' = 'breakdown_pass'`;
	return row.n;
}

/** One answer the analyst's model gave for one image, as billed and as parsed. */
export interface CachedAnswer {
	response: BilledResponse;
	output: AnalystOutput;
}

/**
 * The answers already given for this run (`breakdown_image` rows), by the driver's key — the
 * attempt, the image and its bytes, the system block and prompt. A pass that stopped part-way (a
 * pause, the cap, a transient failure, a lost lease) asks again only for the images it lacks.
 */
export async function breakdownAnswers(db: Db, runId: string): Promise<Map<string, CachedAnswer>> {
	const rows = await db<{ payload: { key: string } & CachedAnswer }[]>`
		select payload_json as payload from director_events
		where run_id = ${runId} and kind = 'activity' and payload_json->>'type' = 'breakdown_image'
		order by id`;
	return new Map(
		rows.map((r) => [r.payload.key, { response: r.payload.response, output: r.payload.output }]),
	);
}

/**
 * What the launcher's gate recorded for a write's `opId` (`director_ops`, ADR-0002): `done` with
 * the op's stored result, `pending` while it runs (or since it was lost mid-run), or null when it
 * never completed — the gate releases a failed op's row, so no row means nothing to report.
 */
export async function opRecord(
	db: Db,
	opId: string,
): Promise<{ status: 'done'; result: unknown } | { status: 'pending' } | null> {
	const [row] = await db<{ status: 'pending' | 'done'; result: unknown }[]>`
		select status, result from director_ops where op_id = ${opId}`;
	if (!row) return null;
	return row.status === 'done' ? { status: 'done', result: row.result } : { status: 'pending' };
}

export async function queuedJobs(db: Db, runId: string): Promise<number> {
	const [row] = await db<{ n: number }[]>`
		select count(*)::int as n from director_atlas_jobs
		where run_id = ${runId} and status = 'queued'`;
	return row.n;
}

/**
 * Renders whose cost has not landed: still queued, or settled by the launcher with a `job_done`
 * this worker has not applied yet (the window between `settleAtlasJob` and `billJob`).
 */
export async function rendersInFlight(db: Db, runId: string): Promise<number> {
	const [row] = await db<{ n: number }[]>`
		select count(*)::int as n from director_atlas_jobs j
		where j.run_id = ${runId} and (j.status = 'queued' or exists (
			select 1 from director_events e
			where e.run_id = j.run_id and e.kind = 'job_done' and e.handled_at is null
				and e.payload_json->>'jobRef' = j.job_ref))`;
	return row.n;
}

/**
 * Renders billed as nothing since the owner last resumed the run: they reported GPU time with no
 * GPU to price it by, or finished reporting nothing (`billJob`'s `unbilled_job`). While there is
 * one, the cap is blind to GPU spend, so no GPU submit goes out until the owner has set the
 * endpoint's GPU and resumed.
 */
export async function unpricedSinceResume(db: Db, runId: string): Promise<number> {
	const [row] = await db<{ n: number }[]>`
		select count(*)::int as n from director_events
		where run_id = ${runId} and kind = 'error' and payload_json->>'type' = 'unbilled_job'
			and id > coalesce((
				select max(id) from director_events
				where run_id = ${runId} and kind = 'owner_request'
					and payload_json->>'action' = 'resume'), 0)`;
	return row.n;
}

export async function setBudgetCap(tx: Db, runId: string, usd: number): Promise<void> {
	await tx`update director_runs set budget_cap_usd = ${usd} where id = ${runId}`;
}

export async function appSetting(db: Db, key: string): Promise<string | undefined> {
	const [row] = await db<{ value: string }[]>`select value from app_settings where key = ${key}`;
	return row?.value;
}

// ── Spend ─────────────────────────────────────────────────────────────────────

export interface SpendRow {
	runId: string;
	agent: string;
	model: string;
	kind: 'claude' | 'runpod';
	requestId: string;
	usd: number;
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
}

/**
 * Record one billed unit. `requestId` is unique, so writing the same response (or job) again — a
 * retry after a crash — is ignored. True when this call wrote the row.
 */
export async function recordSpend(db: Db, row: SpendRow): Promise<boolean> {
	const inserted = await db`
		insert into director_spend (id, run_id, agent, model, kind, request_id, usd,
			input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
		values (${crypto.randomUUID()}, ${row.runId}, ${row.agent}, ${row.model}, ${row.kind},
			${row.requestId}, ${row.usd}, ${row.input ?? 0}, ${row.output ?? 0}, ${row.cacheRead ?? 0},
			${row.cacheWrite ?? 0})
		on conflict (request_id) do nothing
		returning id`;
	return inserted.length === 1;
}

export interface RunSpend {
	totalUsd: number;
	byAgent: Record<string, number>;
	/** The largest output of one call by each agent, for projecting its next call. */
	maxOutputByAgent: Record<string, number>;
	/** Mean cost of one GPU job so far; null before the first. */
	meanRunpodJobUsd: number | null;
	/** Renders whose cost is still to land: queued, or settled with a `job_done` not yet applied. */
	rendersInFlight: number;
}

export async function runSpend(db: Db, runId: string): Promise<RunSpend> {
	const rows = await db<{ agent: string; kind: string; usd: number; n: number; max_out: number }[]>`
		select agent, kind, sum(usd)::float8 as usd, count(*)::int as n,
			max(output_tokens)::int as max_out
		from director_spend where run_id = ${runId}
		group by agent, kind`;
	const spend: RunSpend = {
		totalUsd: 0,
		byAgent: {},
		maxOutputByAgent: {},
		meanRunpodJobUsd: null,
		rendersInFlight: await rendersInFlight(db, runId),
	};
	let gpuUsd = 0;
	let gpuJobs = 0;
	for (const row of rows) {
		spend.totalUsd += row.usd;
		spend.byAgent[row.agent] = (spend.byAgent[row.agent] ?? 0) + row.usd;
		if (row.kind === 'claude') spend.maxOutputByAgent[row.agent] = row.max_out;
		else {
			gpuUsd += row.usd;
			gpuJobs += row.n;
		}
	}
	if (gpuJobs > 0) spend.meanRunpodJobUsd = gpuUsd / gpuJobs;
	return spend;
}
