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
	costOfResponse,
	costOfRunpodJob,
	DIRECTOR_RUN_BUDGET_KEY,
	type DirectorPricing,
} from 'director-costs';
import type { AgentDefinition } from './agents.ts';
import { overCap, projectCall } from './budget.ts';
import type { AdapterSpec, Launcher } from './launcher.ts';
import { LEASE_MS, releaseLease, renewLease, type ClaimedRun } from './lease.ts';
import { log } from './log.ts';
import {
	buildRequest,
	echoable,
	permanentApiError,
	toolId,
	type ModelTransport,
	type ToolSpec,
} from './model.ts';
import { transition, type RunEvent } from './runState.ts';
import {
	appendMessage,
	appSetting,
	applyTransition,
	hasToolUse,
	insertEvent,
	LeaseLost,
	loadMessages,
	markHandled,
	pendingAgents,
	queuedJobs,
	recordSpend,
	runSpend,
	setBudgetCap,
	unhandledEvents,
	withLease,
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
 * What cannot be finished now is left for the next wake rather than guessed at: a model call that
 * failed transiently, or an adapter call whose outcome is unknown (`RetryLater`), stores nothing,
 * so the next claim repeats it — the adapter call with the same `opId`.
 */

export interface DriverDeps {
	sql: Sql;
	transport: ModelTransport;
	launcher: Launcher;
	agents: ReadonlyMap<string, AgentDefinition>;
	pricing: () => Promise<DirectorPricing>;
	leaseMs?: number;
	/** Turns one claim may take before it lets go of the run (the next sweep picks it back up). */
	maxTurns?: number;
	/** Test seam: runs after each adapter call returns, before its result is stored. */
	afterAdapterCall?: (opId: string) => void | Promise<void>;
}

/** Ops that submit GPU work: the budget is checked before each (ADR-0006). */
export const GPU_OPS: ReadonlySet<string> = new Set(['atlas.queue_variants']);

const WORKER_TOOL_IDS: ReadonlySet<string> = new Set(WORKER_TOOLS);
const COORDINATOR = 'coordinator';
const MAX_TURNS = 40;
const MAX_RESULT_CHARS = 60_000;

/**
 * An adapter answer that says nothing about whether the op ran, or that the launcher could not be
 * asked: the turn's results are not stored, and the next claim sends the same calls again.
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
	const heartbeat = setInterval(
		async () => {
			try {
				if (!(await renewLease(deps.sql, claimed, leaseMs)))
					controller.abort(new LeaseLost(claimed.id));
			} catch (error) {
				controller.abort(error);
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
	} catch (error) {
		if (error instanceof LeaseLost || controller.signal.aborted) {
			log.warn('run dropped: lease lost', { runId: claimed.id });
			return;
		}
		if (error instanceof RetryLater) {
			log.warn('run left for the next wake', { runId: claimed.id, reason: error.message });
			return;
		}
		throw error;
	} finally {
		clearInterval(heartbeat);
		await releaseLease(deps.sql, claimed).catch(() => {});
	}
}

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

async function catalog(ctx: Ctx): Promise<ReadonlyMap<string, AdapterSpec>> {
	try {
		return await ctx.launcher.catalog();
	} catch (error) {
		log.warn('adapter catalog unavailable: offering no adapter ops', { error });
		return new Map();
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
 * them safe to repeat); worker tools, the results and any pause commit together after.
 */
async function settle(
	ctx: Ctx,
	agent: AgentDefinition,
	turnSeq: number,
	content: BetaContentBlockParam[],
) {
	const calls = content.filter((b): b is BetaToolUseBlock => b.type === 'tool_use');
	const served = await catalog(ctx);
	const results = new Map<string, BetaToolResultBlockParam>();
	let budgetStop: { spentUsd: number; projectedUsd: number; capUsd: number } | null = null;
	// Nothing of this turn was sent unless the run was running when it was stored and still is: an
	// owner's pause or stop is applied before a turn's calls go out, and nothing else moves a run
	// between storing a turn and settling it.
	const { status } = (await withLease(ctx.sql, ctx.run, async (_tx, l) => l)).state;

	for (const [index, call] of calls.entries()) {
		const id = toolId(call.name);
		if (status !== 'running') {
			results.set(call.id, resultBlock(call.id, `Not run: the run is ${status}.`, true));
			continue;
		}
		if (WORKER_TOOL_IDS.has(id) && agent.tools.includes(id)) continue;
		if (budgetStop) {
			results.set(
				call.id,
				resultBlock(call.id, 'Not run: the run paused at its budget cap.', true),
			);
			continue;
		}
		const spec = served.get(id);
		if (!agent.tools.includes(id) || !spec) {
			results.set(call.id, resultBlock(call.id, `${id} is not one of your tools.`, true));
			continue;
		}
		if (GPU_OPS.has(id)) {
			const [live, spend] = await Promise.all([
				withLease(ctx.sql, ctx.run, async (_tx, l) => l),
				runSpend(ctx.sql, ctx.run.id),
			]);
			const projectedUsd = spend.meanRunpodJobUsd ?? 0;
			if (overCap(spend.totalUsd, projectedUsd, live.budgetCapUsd)) {
				budgetStop = { spentUsd: spend.totalUsd, projectedUsd, capUsd: live.budgetCapUsd! };
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
		if (budgetStop) await pauseForBudget(tx, live, agent.name, budgetStop, 'gpu_submit');
		await appendMessage(
			tx,
			live.id,
			agent.name,
			'user',
			calls.map((c) => results.get(c.id)!),
		);
	});
}

async function settleAll(ctx: Ctx): Promise<void> {
	for (const name of await pendingAgents(ctx.sql, ctx.run.id)) {
		const agent = ctx.agents.get(name);
		const last = (await loadMessages(ctx.sql, ctx.run.id, name)).at(-1);
		if (agent && last && hasToolUse(last)) await settle(ctx, agent, last.seq, last.content);
	}
}

// ── Pauses ────────────────────────────────────────────────────────────────────

async function pause(
	tx: Parameters<typeof applyTransition>[0],
	live: LiveRun,
	reason: Extract<RunEvent, { type: 'pause' }>['reason'],
	cause: string,
): Promise<void> {
	const result = transition(live.state, { type: 'pause', reason });
	if (result.ok && (await applyTransition(tx, live.id, live.state, result.state, cause))) {
		live.state = result.state;
	}
}

async function pauseForBudget(
	tx: Parameters<typeof applyTransition>[0],
	live: LiveRun,
	agent: string,
	figures: { spentUsd: number; projectedUsd: number; capUsd: number },
	before: 'model_call' | 'gpu_submit',
): Promise<void> {
	await pause(tx, live, 'budget_cap', `budget cap before ${agent}'s ${before}`);
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
		if (!overCap(spend.totalUsd, projectedUsd, live.budgetCapUsd)) return false;
		await pauseForBudget(
			tx,
			live,
			name,
			{ spentUsd: spend.totalUsd, projectedUsd, capUsd: live.budgetCapUsd! },
			'model_call',
		);
		return true;
	});
	if (stopped) return false;

	let response: BetaMessage;
	try {
		response = await ctx.transport.send(request, ctx.signal);
	} catch (error) {
		const status = permanentApiError(error);
		if (status === null) throw error;
		await pauseWithError(ctx, name, {
			type: 'api_error',
			status,
			message: `${name}'s call was rejected (${status}): ${(error as Error).message}`,
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

	const content = echoable(response.content as BetaContentBlockParam[]);
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
 * Write the response's spend row and `spend` event. Written whatever happens next, lease or not:
 * the money is spent. The response id is the row's `requestId`, so a repeat is ignored. False when
 * the response can't be priced; the run pauses rather than spend unrecorded money.
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
			message: `${agent}'s call (${response.id}) could not be priced: ${(error as Error).message}. Add the model to pricing.json.`,
		});
		return false;
	}
	const written = await recordSpend(ctx.sql, {
		runId: ctx.run.id,
		agent,
		model: response.model,
		kind: 'claude',
		requestId: response.id,
		...cost,
	});
	if (written) {
		await insertEvent(ctx.sql, ctx.run.id, agent, 'spend', {
			kind: 'claude',
			model: response.model,
			usd: cost.usd,
			requestId: response.id,
		});
	}
	return true;
}

// ── Owner rows and finished jobs ──────────────────────────────────────────────

const userText = (text: string): BetaContentBlockParam[] => [{ type: 'text', text }];

/**
 * Apply the unhandled waking events in order. `ownerRequestsOnly` applies just the leading owner
 * requests (pause, stop, …) — what may change while a turn's tool calls are unsettled, since those
 * only move the run and never write to a conversation — and stops at the first other event, so
 * events still apply in the order they were inserted.
 */
async function handleEvents(ctx: Ctx, { ownerRequestsOnly = false } = {}): Promise<void> {
	for (const event of await unhandledEvents(ctx.sql, ctx.run.id)) {
		if (ownerRequestsOnly && event.kind !== 'owner_request') return;
		await withLease(ctx.sql, ctx.run, async (tx, live) => {
			await applyEvent(ctx, tx, live, event);
			await markHandled(tx, event.id);
		});
	}
}

async function move(
	tx: Parameters<typeof applyTransition>[0],
	live: LiveRun,
	event: RunEvent,
	cause: string,
): Promise<string | null> {
	const result = transition(live.state, event);
	if (!result.ok) return result.error;
	if (!(await applyTransition(tx, live.id, live.state, result.state, cause))) return 'stale state';
	live.state = result.state;
	return null;
}

/** Finish a stop once no GPU job of the run is still in flight. */
async function finishStop(tx: Parameters<typeof applyTransition>[0], live: LiveRun) {
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
	tx: Parameters<typeof applyTransition>[0],
	live: LiveRun,
	event: WakingEvent,
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
				const raised = Number(p.budgetCapUsd);
				if (Number.isFinite(raised) && raised > (live.budgetCapUsd ?? 0)) {
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
			const checkpoint = p.checkpoint as Extract<RunEvent, { type: 'resolve' }>['checkpoint'];
			const decision = p.decision === 'revise' ? 'revise' : 'approve';
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
			await billJob(ctx, tx, live, event);
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
	ctx: Ctx,
	tx: Parameters<typeof applyTransition>[0],
	live: LiveRun,
	event: WakingEvent,
): Promise<void> {
	const runpod = (event.payload.result as { runpod?: { gpu?: unknown; seconds?: unknown } } | null)
		?.runpod;
	if (typeof runpod?.gpu !== 'string' || typeof runpod.seconds !== 'number') return;
	let usd: number;
	try {
		usd = costOfRunpodJob(runpod.gpu, runpod.seconds, await ctx.pricing());
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
