import type {
	BetaContentBlockParam,
	BetaMessage,
	BetaMessageParam,
	BetaToolResultBlockParam,
	BetaToolUseBlock,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { Sql } from 'postgres';
import {
	budgetFromSetting,
	clampDirectorBudget,
	costOfResponse,
	costOfRunpodJob,
	DIRECTOR_RUN_BUDGET_DEFAULT_USD,
	DIRECTOR_RUN_BUDGET_KEY,
	type DirectorPricing,
} from 'director-costs';
import type { AgentDefinition } from './agents.ts';
import { overCap, projectCall } from './budget.ts';
import type { AdapterSpec, Launcher } from './launcher.ts';
import { deferLease, LEASE_MS, releaseLease, renewLease, type ClaimedRun } from './lease.ts';
import { log } from './log.ts';
import {
	buildRequest,
	echoable,
	PartialResponse,
	permanentApiError,
	toolId,
	type ModelTransport,
	type ToolSpec,
} from './model.ts';
import { TERMINAL_STATUSES, transition, type Checkpoint, type RunEvent } from './runState.ts';
import {
	appendMessage,
	appSetting,
	applyTransition,
	hasToolUse,
	insertEvent,
	LeaseLost,
	loadMessages,
	markHandled,
	opRecord,
	pendingAgents,
	queuedJobs,
	recordSpend,
	runSpend,
	setBudgetCap,
	unhandledEvents,
	withLease,
	type Db,
	type LiveRun,
	type StoredMessage,
	type WakingEvent,
} from './store.ts';
import { WORKER_TOOLS } from './tools.ts';
import { runWorkerTool, workerToolSpecs, type WorkerToolId } from './workerTools.ts';

/**
 * Drives one claimed run (ADR-0001, ADR-0003): the turn loop.
 *
 * 1. **Settle.** An agent whose last stored message is an assistant turn with tool calls but no
 *    results (the worker died between the two) gets them now. Each call carries a deterministic
 *    `opId` — `<runId>:<agent>-t<turn seq>:<call index>` — so an adapter write that already ran
 *    returns its stored result from the launcher instead of running again, and worker tools commit
 *    with the results, so they either both happened or neither did.
 * 2. **Events.** Unhandled owner rows and `job_done` rows, oldest first, each in one transaction
 *    with its `handled_at` stamp: transitions go through `transition()`, and what an agent must
 *    hear is appended to its conversation as a user message.
 * 3. **Turns.** While the run is `running`, the agent with the oldest pending conversation (its last
 *    message is the user's) takes one turn: the budget check, one streamed Messages call, its spend
 *    row, then the assistant message and the tool results. The history is append-only and written
 *    after every turn, so a restart rebuilds the next request from the rows — nothing is replayed.
 *
 * A run with nothing pending — waiting on the owner, on a GPU job, paused — makes no model call:
 * the only way to a call is a pending conversation in a `running` run.
 *
 * What cannot be finished now is retried, never guessed at: a model call that failed transiently,
 * an adapter call whose outcome is unknown (`RetryLater`), or the launcher unreachable stores
 * nothing, and the run is held back for a growing delay before the next claim repeats it — the
 * adapter call with the same `opId`. After `MAX_FAILURES` failed drives in a row the run pauses with
 * the error, so no failure is retried forever.
 */

export interface DriverDeps {
	sql: Sql;
	transport: ModelTransport;
	launcher: Launcher;
	agents: ReadonlyMap<string, AgentDefinition>;
	pricing: () => Promise<DirectorPricing>;
	/** Failed drives in a row, per run, in this process. A successful drive clears its entry. */
	retries: Map<string, number>;
	leaseMs?: number;
	/** Turns one claim may take before it lets go of the run (the next wake picks it back up). */
	maxTurns?: number;
	/** The first retry delay; it doubles per failure in a row, up to `RETRY_MAX_MS`. */
	retryBaseMs?: number;
	/** Aborted when the worker shuts down: every drive stops and gives its run back. */
	shutdown?: AbortSignal;
	/** Test seam: runs after each adapter call returns, before its result is stored. */
	afterAdapterCall?: (opId: string) => void | Promise<void>;
}

/** Ops that submit GPU work: the budget is checked before each (ADR-0006). */
export const GPU_OPS: ReadonlySet<string> = new Set(['atlas.queue_variants']);

/** Failed drives in a row after which the run pauses with the error for a person to look at. */
export const MAX_FAILURES = 6;
const RETRY_BASE_MS = 15_000;
const RETRY_MAX_MS = 120_000;

const WORKER_TOOL_IDS: ReadonlySet<string> = new Set(WORKER_TOOLS);
const COORDINATOR = 'coordinator';
const MAX_TURNS = 40;
const MAX_RESULT_CHARS = 60_000;

/**
 * An answer that says nothing about whether an op ran, or a launcher that could not be asked: the
 * turn's results are not stored, and a later claim sends the same calls again.
 */
export class RetryLater extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RetryLater';
	}
}

/** The gate's answers that leave an op's outcome unknown or unreached (ADR-0002). */
function unsettled(status: number, body: unknown): boolean {
	const error = (body as { error?: unknown } | null)?.error;
	return (
		status === 401 ||
		status === 500 ||
		status === 502 ||
		status === 503 ||
		(status === 409 && error === 'in_progress')
	);
}

interface Ctx extends DriverDeps {
	run: Pick<ClaimedRun, 'id' | 'lease'>;
	signal: AbortSignal;
	workerSpecs: ReturnType<typeof workerToolSpecs>;
}

export async function driveRun(deps: DriverDeps, claimed: ClaimedRun): Promise<void> {
	const leaseMs = deps.leaseMs ?? LEASE_MS;
	const controller = new AbortController();
	const onShutdown = () => controller.abort(deps.shutdown?.reason);
	deps.shutdown?.addEventListener('abort', onShutdown, { once: true });
	const heartbeat = setInterval(
		async () => {
			try {
				if (!(await renewLease(deps.sql, claimed, leaseMs))) {
					controller.abort(new LeaseLost(claimed.id));
				}
			} catch (error) {
				// Not a lost lease: the next renewal may land, and a write after a real expiry is
				// refused by its own guard. Aborting here would throw away a call already paid for.
				log.warn('lease renewal failed', { runId: claimed.id, error });
			}
		},
		Math.max(10, Math.floor(leaseMs / 3)),
	);
	const ctx: Ctx = {
		...deps,
		run: claimed,
		signal: controller.signal,
		workerSpecs: workerToolSpecs([...deps.agents.keys()]),
	};
	let deferMs: number | null = null;
	try {
		await settleAll(ctx);
		await handleEvents(ctx);
		for (let turns = 0; turns < (deps.maxTurns ?? MAX_TURNS); turns++) {
			if (controller.signal.aborted) throw controller.signal.reason;
			const live = await withLease(ctx.sql, ctx.run, async (_tx, l) => l);
			if (live.state.status !== 'running') break;
			const [agent] = await pendingAgents(ctx.sql, ctx.run.id);
			if (!agent || !(await takeTurn(ctx, agent))) break;
			await handleEvents(ctx);
		}
		deps.retries.delete(claimed.id);
	} catch (error) {
		if (error instanceof LeaseLost || controller.signal.aborted) {
			log.warn('run dropped', {
				runId: claimed.id,
				reason: error instanceof LeaseLost ? 'lease lost' : 'shutting down',
			});
			return;
		}
		deferMs = await failed(ctx, error);
	} finally {
		clearInterval(heartbeat);
		deps.shutdown?.removeEventListener('abort', onShutdown);
		await (
			deferMs === null ? releaseLease(deps.sql, claimed) : deferLease(deps.sql, claimed, deferMs)
		).catch((error) => log.warn('could not give the run back', { runId: claimed.id, error }));
	}
}

/**
 * Record a failed drive and return how long to hold the run back. The run is left exactly as it
 * was; an `error` event tells the owner a retry is coming, and the failure that makes
 * `MAX_FAILURES` in a row pauses the run instead. Past that, retries continue at the longest delay
 * without adding events, for a run the pause could not stop (one waiting on the owner).
 */
async function failed(ctx: Ctx, error: unknown): Promise<number> {
	const attempt = (ctx.retries.get(ctx.run.id) ?? 0) + 1;
	ctx.retries.set(ctx.run.id, attempt);
	const reason = error instanceof Error ? error.message : String(error);
	const delayMs = Math.min(RETRY_MAX_MS, (ctx.retryBaseMs ?? RETRY_BASE_MS) * 2 ** (attempt - 1));
	log.warn('drive failed', { runId: ctx.run.id, attempt, delayMs, error });
	try {
		if (attempt === MAX_FAILURES) {
			await pauseWithError(ctx, 'worker', {
				type: 'retries_exhausted',
				attempts: attempt,
				message: `The run stopped after ${attempt} failed attempts in a row: ${reason}`,
			});
		} else if (attempt < MAX_FAILURES) {
			await insertEvent(ctx.sql, ctx.run.id, 'worker', 'error', {
				type: 'retrying',
				attempt,
				inSeconds: Math.round(delayMs / 1000),
				message: reason,
			});
		}
	} catch (writeError) {
		log.warn('could not record the failure', { runId: ctx.run.id, error: writeError });
	}
	return delayMs;
}

/** The run's cap. Null only for a run that never started through the worker: the default applies. */
const capOf = (live: LiveRun) => live.budgetCapUsd ?? DIRECTOR_RUN_BUDGET_DEFAULT_USD;

// ── Tools ─────────────────────────────────────────────────────────────────────

/** The tool specs `agent` would be offered now, in its definition's order, and what is missing. */
function toolsFor(ctx: Ctx, agent: AgentDefinition, served: ReadonlyMap<string, AdapterSpec>) {
	const specs: ToolSpec[] = [];
	const missing: string[] = [];
	for (const id of agent.tools) {
		const spec = WORKER_TOOL_IDS.has(id) ? ctx.workerSpecs[id as WorkerToolId] : served.get(id);
		if (spec) specs.push({ id, description: spec.description, inputSchema: spec.inputSchema });
		else missing.push(id);
	}
	return { specs, missing };
}

/** The ops the launcher serves now. Unreachable is not "serves none": the drive is retried. */
async function catalog(ctx: Ctx): Promise<ReadonlyMap<string, AdapterSpec>> {
	try {
		return await ctx.launcher.catalog();
	} catch (error) {
		throw new RetryLater(`the adapter catalog is unavailable: ${(error as Error).message}`);
	}
}

const resultBlock = (id: string, content: string, isError = false): BetaToolResultBlockParam => ({
	type: 'tool_result',
	tool_use_id: id,
	content:
		content.length > MAX_RESULT_CHARS
			? `${content.slice(0, MAX_RESULT_CHARS)}…[truncated]`
			: content,
	...(isError ? { is_error: true } : {}),
});

const opIdOf = (runId: string, agent: string, turnSeq: number, index: number) =>
	`${runId}:${agent}-t${turnSeq}:${index}`;

/**
 * Run the tool calls of `agent`'s assistant message `turnSeq` and store their results as one user
 * message. Adapter calls run first, in order, outside any transaction (the launcher's `opId` makes
 * them safe to repeat); a budget pause, the worker tools and the results commit together after.
 */
async function settle(
	ctx: Ctx,
	agent: AgentDefinition,
	turnSeq: number,
	content: BetaContentBlockParam[],
) {
	const calls = content.filter((b): b is BetaToolUseBlock => b.type === 'tool_use');
	const { status } = (await withLease(ctx.sql, ctx.run, async (_tx, l) => l)).state;
	const served = status === 'running' ? await catalog(ctx) : new Map<string, AdapterSpec>();
	const results = new Map<string, BetaToolResultBlockParam>();
	let budgetStop: { spentUsd: number; projectedUsd: number; capUsd: number } | null = null;

	for (const [index, call] of calls.entries()) {
		const id = toolId(call.name);
		if (status !== 'running') {
			const opId = opIdOf(ctx.run.id, agent.name, turnSeq, index);
			results.set(call.id, await recordedOutcome(ctx, call, opId, status));
			continue;
		}
		if (!agent.tools.includes(id)) {
			results.set(call.id, resultBlock(call.id, `${id} is not one of your tools.`, true));
			continue;
		}
		if (WORKER_TOOL_IDS.has(id)) continue;
		if (budgetStop) {
			results.set(
				call.id,
				resultBlock(call.id, 'Not run: the run paused at its budget cap.', true),
			);
			continue;
		}
		const spec = served.get(id);
		// It was served when the turn was asked for: a launcher rolled back since is retried, never
		// answered with an error the model would work around by calling again under a new opId.
		if (!spec) throw new RetryLater(`${id} is not served by the launcher now`);
		if (GPU_OPS.has(id)) {
			const [live, spend] = await Promise.all([
				withLease(ctx.sql, ctx.run, async (_tx, l) => l),
				runSpend(ctx.sql, ctx.run.id),
			]);
			const projectedUsd = spend.meanRunpodJobUsd ?? 0;
			if (overCap(spend.totalUsd, projectedUsd, capOf(live))) {
				budgetStop = { spentUsd: spend.totalUsd, projectedUsd, capUsd: capOf(live) };
				results.set(
					call.id,
					resultBlock(call.id, 'Not run: the run paused at its budget cap.', true),
				);
				continue;
			}
		}
		const opId = opIdOf(ctx.run.id, agent.name, turnSeq, index);
		const answer = await ctx.launcher.call(
			id,
			{
				runId: ctx.run.id,
				agent: agent.name,
				opId: spec.write ? opId : undefined,
				input: call.input,
			},
			ctx.signal,
		);
		await ctx.afterAdapterCall?.(opId);
		if (unsettled(answer.status, answer.body)) {
			throw new RetryLater(`${id} answered ${answer.status}`);
		}
		results.set(call.id, resultBlock(call.id, JSON.stringify(answer.body), answer.status !== 200));
	}

	await withLease(ctx.sql, ctx.run, async (tx, live) => {
		// The pause first, so a worker tool later in the turn (a checkpoint request) sees it.
		if (budgetStop) await pauseForBudget(tx, live, agent.name, budgetStop, 'gpu_submit');
		const toolCtx = {
			tx,
			live,
			agent: agent.name,
			missingTools: (name: string) => {
				const other = ctx.agents.get(name);
				return other ? toolsFor(ctx, other, served).missing : [name];
			},
		};
		for (const call of calls) {
			const id = toolId(call.name);
			if (results.has(call.id)) continue;
			if (live.state.status !== 'running') {
				results.set(
					call.id,
					resultBlock(call.id, `Not run: the run is ${live.state.status}.`, true),
				);
				continue;
			}
			const outcome = await runWorkerTool(
				toolCtx,
				id as WorkerToolId,
				call.input as Record<string, unknown>,
			);
			results.set(call.id, resultBlock(call.id, outcome.content, outcome.isError));
		}
		await appendMessage(
			tx,
			live.id,
			agent.name,
			'user',
			calls.map((c) => results.get(c.id)!),
		);
	});
}

/**
 * The answer to a call of a turn settled while the run is not running. Nothing is sent then, but
 * the call may have gone out before: a run paused after repeated failures leaves its last turn
 * unsettled, its calls' outcomes unknown. So the answer is what the launcher recorded for the
 * call's opId, never a guess — a write that completed gets its stored result, so the model does
 * not issue it again; one still in progress is retried later; and one that never completed (or a
 * read, or a worker tool, which commits with the results) is reported as not run.
 */
async function recordedOutcome(
	ctx: Ctx,
	call: BetaToolUseBlock,
	opId: string,
	status: string,
): Promise<BetaToolResultBlockParam> {
	if (WORKER_TOOL_IDS.has(toolId(call.name))) {
		return resultBlock(call.id, `Not run: the run is ${status}.`, true);
	}
	const record = await opRecord(ctx.sql, opId);
	if (record?.status === 'pending') throw new RetryLater(`${opId} is still in progress`);
	return record
		? resultBlock(call.id, JSON.stringify(record.result))
		: resultBlock(call.id, `Not run: the run is ${status}.`, true);
}

async function settleAll(ctx: Ctx): Promise<void> {
	for (const name of await pendingAgents(ctx.sql, ctx.run.id)) {
		const agent = ctx.agents.get(name);
		const last = (await loadMessages(ctx.sql, ctx.run.id, name)).at(-1);
		if (agent && last && hasToolUse(last)) await settle(ctx, agent, last.seq, last.content);
	}
}

// ── Pauses ────────────────────────────────────────────────────────────────────

/** Pause a running run. False when the run was not running (it stays as it was). */
async function pause(
	tx: Db,
	live: LiveRun,
	reason: Extract<RunEvent, { type: 'pause' }>['reason'],
	cause: string,
): Promise<boolean> {
	const result = transition(live.state, { type: 'pause', reason });
	if (!result.ok || !(await applyTransition(tx, live.id, live.state, result.state, cause))) {
		return false;
	}
	live.state = result.state;
	return true;
}

async function pauseForBudget(
	tx: Db,
	live: LiveRun,
	agent: string,
	figures: { spentUsd: number; projectedUsd: number; capUsd: number },
	before: 'model_call' | 'gpu_submit',
): Promise<void> {
	if (!(await pause(tx, live, 'budget_cap', `budget cap before ${agent}'s ${before}`))) return;
	await insertEvent(tx, live.id, 'worker', 'checkpoint_open', {
		checkpoint: 'budget',
		agent,
		before,
		...figures,
		message: 'The run reached its budget cap. Raise the cap and resume, or stop the run.',
	});
}

async function pauseWithError(ctx: Ctx, agent: string, error: Record<string, unknown>) {
	await withLease(ctx.sql, ctx.run, async (tx, live) => {
		await insertEvent(tx, live.id, agent, 'error', error);
		await pause(tx, live, 'error', `${agent}: ${String(error.type)}`);
	});
}

// ── One turn ──────────────────────────────────────────────────────────────────

const toParams = (messages: StoredMessage[]): BetaMessageParam[] =>
	messages.map((m) => ({ role: m.role, content: m.content }));

const finalText = (content: BetaContentBlockParam[]) =>
	content
		.filter((b) => b.type === 'text')
		.map((b) => (b as { text: string }).text)
		.join('\n')
		.trim();

/**
 * What a reply is stored as. The API refuses an empty message anywhere but last, and the history is
 * append-only, so an empty reply (the model had nothing to add) is stored as a short text instead.
 */
const storable = (content: BetaContentBlockParam[]): BetaContentBlockParam[] =>
	content.length ? content : [{ type: 'text', text: '(no reply)' }];

/** One turn for `name`. False when the loop should stop (paused, or nothing could be done). */
async function takeTurn(ctx: Ctx, name: string): Promise<boolean> {
	const agent = ctx.agents.get(name);
	if (!agent) {
		await pauseWithError(ctx, 'worker', { type: 'unknown_agent', agent: name });
		return false;
	}
	const history = await loadMessages(ctx.sql, ctx.run.id, name);
	const last = history.at(-1);
	if (!last) return false;
	if (hasToolUse(last)) {
		await settle(ctx, agent, last.seq, last.content);
		return true;
	}

	const { specs, missing } = toolsFor(ctx, agent, await catalog(ctx));
	if (missing.length) {
		await pauseWithError(ctx, name, {
			type: 'missing_tools',
			missing,
			message: `${name} cannot run: the platform does not serve ${missing.join(', ')}.`,
		});
		return false;
	}

	const pricing = await ctx.pricing();
	const request = buildRequest(agent, specs, toParams(history));
	const spend = await runSpend(ctx.sql, ctx.run.id);
	const projectedUsd = projectCall(request, pricing, spend.maxOutputByAgent[name]);
	const stopped = await withLease(ctx.sql, ctx.run, async (tx, live) => {
		if (live.state.status !== 'running') return true;
		if (!overCap(spend.totalUsd, projectedUsd, capOf(live))) return false;
		await pauseForBudget(
			tx,
			live,
			name,
			{ spentUsd: spend.totalUsd, projectedUsd, capUsd: capOf(live) },
			'model_call',
		);
		return true;
	});
	if (stopped) return false;

	let response: BetaMessage;
	try {
		response = await ctx.transport.send(request, ctx.signal);
	} catch (error) {
		// Tokens streamed before a failure or a cut-off are billed: record them, then handle the cause.
		const cause = error instanceof PartialResponse ? error.cause : error;
		if (error instanceof PartialResponse) await billResponse(ctx, name, error.partial, pricing);
		const status = permanentApiError(cause);
		if (status === null || ctx.signal.aborted) throw cause;
		await pauseWithError(ctx, name, {
			type: 'api_error',
			status,
			message: `${name}'s call was rejected (${status}): ${(cause as Error).message}`,
		});
		return false;
	}
	if (!(await billResponse(ctx, name, response, pricing))) return false;

	if (response.stop_reason === 'refusal') {
		await withLease(ctx.sql, ctx.run, async (tx, live) => {
			await insertEvent(tx, live.id, name, 'error', {
				type: 'refusal',
				model: response.model,
				category: response.stop_details?.category ?? null,
				explanation: response.stop_details?.explanation ?? null,
				message: `${name}'s turn was refused${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : '.'}`,
			});
			await pause(tx, live, 'refusal', `${name}: refusal`);
		});
		return false;
	}

	const content = storable(echoable(response.content as BetaContentBlockParam[]));
	const calls = content.filter((b): b is BetaToolUseBlock => b.type === 'tool_use');
	const truncated = response.stop_reason === 'max_tokens';
	const turnSeq = await withLease(ctx.sql, ctx.run, async (tx, live) => {
		const seq = await appendMessage(tx, live.id, name, 'assistant', content);
		if (truncated) {
			// A cut-off reply may hold a half-written call: answer every call unrun, and ask for more.
			const note = 'Your reply hit the output limit, so no tool ran. Continue, more briefly.';
			await appendMessage(tx, live.id, name, 'user', [
				...calls.map((c) => resultBlock(c.id, 'Not run: the reply was cut off.', true)),
				{ type: 'text', text: note },
			]);
		} else if (calls.length === 0 && name !== COORDINATOR) {
			const report = finalText(content) || '(no report)';
			await appendMessage(tx, live.id, COORDINATOR, 'user', [
				{ type: 'text', text: `Report from ${name}:\n\n${report}` },
			]);
		}
		return seq;
	});
	if (calls.length && !truncated) {
		await handleEvents(ctx, { ownerRequestsOnly: true });
		await settle(ctx, agent, turnSeq, content);
	}
	return true;
}

/**
 * Write the response's spend row and its `spend` event, together. Written whatever happens next,
 * lease or not: the money is spent. The response id is the row's `requestId`, so a repeat is
 * ignored. False when the response can't be priced; the run pauses rather than spend unrecorded
 * money, and the error carries the usage so it can still be priced by hand.
 */
async function billResponse(
	ctx: Ctx,
	agent: string,
	response: BetaMessage,
	pricing: DirectorPricing,
) {
	let cost;
	try {
		cost = costOfResponse(response, pricing);
	} catch (error) {
		await pauseWithError(ctx, agent, {
			type: 'unpriced',
			model: response.model,
			requestId: response.id,
			usage: response.usage,
			message: `${agent}'s call (${response.id}) could not be priced: ${(error as Error).message}. Add the model to pricing.json.`,
		});
		return false;
	}
	await ctx.sql.begin(async (tx) => {
		const written = await recordSpend(tx, {
			runId: ctx.run.id,
			agent,
			model: response.model,
			kind: 'claude',
			requestId: response.id,
			...cost,
		});
		if (written) {
			await insertEvent(tx, ctx.run.id, agent, 'spend', {
				kind: 'claude',
				model: response.model,
				usd: cost.usd,
				requestId: response.id,
			});
		}
	});
	return true;
}

// ── Owner rows and finished jobs ──────────────────────────────────────────────

const userText = (text: string): BetaContentBlockParam[] => [{ type: 'text', text }];

/**
 * Apply the unhandled waking events in order. `ownerRequestsOnly` applies just the owner's requests
 * (pause, stop, …), skipping the rest for a later pass: it runs while a turn's tool calls are
 * unsettled and the run is running, when only those may apply — they move the run and never write
 * to a conversation — and they are what must take effect before the calls go out. Pricing is read
 * first, so no transaction waits on a second pool connection.
 */
async function handleEvents(ctx: Ctx, { ownerRequestsOnly = false } = {}): Promise<void> {
	const events = (await unhandledEvents(ctx.sql, ctx.run.id)).filter(
		(e) => !ownerRequestsOnly || e.kind === 'owner_request',
	);
	if (events.length === 0) return;
	const pricing = await ctx.pricing();
	for (const event of events) {
		await withLease(ctx.sql, ctx.run, async (tx, live) => {
			await applyEvent(ctx, tx, live, event, pricing);
			await markHandled(tx, event.id);
		});
	}
}

async function move(tx: Db, live: LiveRun, event: RunEvent, cause: string): Promise<string | null> {
	const result = transition(live.state, event);
	if (!result.ok) return result.error;
	if (!(await applyTransition(tx, live.id, live.state, result.state, cause))) return 'stale state';
	live.state = result.state;
	return null;
}

/** Finish a stop once no GPU job of the run is still in flight. */
async function finishStop(tx: Db, live: LiveRun) {
	if (live.state.status === 'stopping' && (await queuedJobs(tx, live.id)) === 0) {
		await move(tx, live, { type: 'stopped' }, 'no GPU job in flight');
	}
}

function brief(live: LiveRun): string {
	return [
		'A new Invisible Director run. Plan it and start it.',
		'',
		JSON.stringify(
			{
				runId: live.id,
				project: live.projectKey,
				client: live.clientKey,
				template: live.templateProjectKey,
				preset: live.presetJson,
				startingPoint: live.startingPointJson,
				checkpoints: live.state.checkpoints,
				budgetCapUsd: live.budgetCapUsd,
			},
			null,
			2,
		),
	].join('\n');
}

async function applyEvent(
	ctx: Ctx,
	tx: Db,
	live: LiveRun,
	event: WakingEvent,
	pricing: DirectorPricing,
): Promise<void> {
	const p = event.payload;
	const refuse = (error: string) =>
		insertEvent(tx, live.id, 'worker', 'error', {
			type: 'refused_request',
			eventId: event.id,
			error,
		});

	switch (event.kind) {
		case 'owner_request': {
			const action = String(p.action ?? '');
			if (action === 'start') {
				const error = await move(tx, live, { type: 'start' }, 'owner start');
				if (error) return refuse(error);
				if (live.budgetCapUsd === null) {
					live.budgetCapUsd = budgetFromSetting(await appSetting(tx, DIRECTOR_RUN_BUDGET_KEY));
					await setBudgetCap(tx, live.id, live.budgetCapUsd);
				}
				await appendMessage(tx, live.id, COORDINATOR, 'user', userText(brief(live)));
				return;
			}
			if (action === 'pause') {
				const error = await move(tx, live, { type: 'pause', reason: 'owner' }, 'owner pause');
				return error ? refuse(error) : undefined;
			}
			if (action === 'resume') {
				const error = await move(tx, live, { type: 'resume' }, 'owner resume');
				if (error) return refuse(error);
				// Raised within the same bounds Settings allows, never lowered here.
				const raised =
					p.budgetCapUsd === undefined ? null : clampDirectorBudget(Number(p.budgetCapUsd));
				if (raised !== null && raised > capOf(live)) {
					live.budgetCapUsd = raised;
					await setBudgetCap(tx, live.id, raised);
				}
				return;
			}
			if (action === 'stop') {
				const error = await move(tx, live, { type: 'stop' }, 'owner stop');
				if (error) return refuse(error);
				return finishStop(tx, live);
			}
			return refuse(`unknown owner request "${action}"`);
		}
		case 'owner_message':
			await appendMessage(
				tx,
				live.id,
				COORDINATOR,
				'user',
				userText(`Owner: ${String(p.text ?? '')}`),
			);
			return;
		case 'checkpoint_resolved': {
			const decision = p.decision;
			// Only an explicit decision moves the run: anything else could hand a draft off unapproved.
			if (decision !== 'approve' && decision !== 'revise') {
				return refuse(`unknown checkpoint decision "${String(decision)}"`);
			}
			const checkpoint = p.checkpoint as Checkpoint;
			const error = await move(
				tx,
				live,
				{ type: 'resolve', checkpoint, decision },
				`owner ${decision}`,
			);
			if (error) return refuse(error);
			const note = p.note ? `\nTheir note: ${String(p.note)}` : '';
			const what = decision === 'approve' ? 'approved' : 'asked for revisions at';
			await appendMessage(
				tx,
				live.id,
				COORDINATOR,
				'user',
				userText(
					`The owner ${what} the ${checkpoint} checkpoint. The run is now in the ${live.state.step} step.${note}`,
				),
			);
			return;
		}
		case 'job_done': {
			await billJob(tx, live, event, pricing);
			// An ended run has nobody left to tell; its job is only billed.
			if (TERMINAL_STATUSES.includes(live.state.status)) return;
			const to = ctx.agents.has(event.agent) ? event.agent : COORDINATOR;
			const body = JSON.stringify({ jobRef: p.jobRef, status: p.status, result: p.result });
			await appendMessage(
				tx,
				live.id,
				to,
				'user',
				userText(`GPU job ${String(p.jobRef)} (${event.tool ?? 'job'}) finished: ${body}`),
			);
			return finishStop(tx, live);
		}
	}
}

/**
 * The RunPod row for a finished job (ADR-0006): its execution seconds × the GPU's $/s, keyed
 * `runpod:<jobRef>` so a redelivered `job_done` is billed once. Written only when the job reports
 * both (`result.runpod = { gpu, seconds }`); atlas-tool does not report them yet.
 */
async function billJob(
	tx: Db,
	live: LiveRun,
	event: WakingEvent,
	pricing: DirectorPricing,
): Promise<void> {
	const runpod = (event.payload.result as { runpod?: { gpu?: unknown; seconds?: unknown } } | null)
		?.runpod;
	if (typeof runpod?.gpu !== 'string' || typeof runpod.seconds !== 'number') return;
	let usd: number;
	try {
		usd = costOfRunpodJob(runpod.gpu, runpod.seconds, pricing);
	} catch (error) {
		await insertEvent(tx, live.id, 'worker', 'error', {
			type: 'unpriced',
			jobRef: event.payload.jobRef,
			message: (error as Error).message,
		});
		return;
	}
	const requestId = `runpod:${String(event.payload.jobRef)}`;
	if (
		await recordSpend(tx, {
			runId: live.id,
			agent: event.agent,
			model: runpod.gpu,
			kind: 'runpod',
			requestId,
			usd,
		})
	) {
		await insertEvent(tx, live.id, event.agent, 'spend', {
			kind: 'runpod',
			model: runpod.gpu,
			usd,
			requestId,
		});
	}
}
