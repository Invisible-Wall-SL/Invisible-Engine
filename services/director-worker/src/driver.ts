import type {
	BetaContentBlockParam,
	BetaMessage,
	BetaMessageParam,
	BetaToolResultBlockParam,
	BetaToolUseBlock,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { createHash } from 'node:crypto';
import type { Sql } from 'postgres';
import {
	budgetFromSetting,
	clampDirectorBudget,
	costOfResponse,
	costOfRunpodJob,
	DIRECTOR_RUN_BUDGET_DEFAULT_USD,
	DIRECTOR_RUN_BUDGET_KEY,
	pricingRate,
	seedRenderUsd,
	type DirectorPricing,
} from 'director-costs';
import { adapterClient } from './adapters.ts';
import type { AgentDefinition } from './agents.ts';
import {
	overCap,
	projectCall,
	projectQueuedGpu,
	projectVisionCall,
	unreportedSeconds,
} from './budget.ts';
import type { AdapterSpec, Launcher } from './launcher.ts';
import { deferLease, LEASE_MS, releaseLease, renewLease, type ClaimedRun } from './lease.ts';
import { log } from './log.ts';
import {
	AnalysisRefused,
	analyzeMockups,
	ANALYST_AGENT,
	ownershipRefusal,
	type Breakdown,
	type MockupListing,
} from './mockups/analyze.ts';
import { submitBreakdown } from './mockups/checkpoint.ts';
import {
	summarizeUsage,
	VISION_MAX_TOKENS,
	VisionError,
	type BilledResponse,
	type VisionAnswer,
	type VisionRequest,
	type VisionTransport,
} from './mockups/vision.ts';
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
	breakdownAnswers,
	breakdownPasses,
	breakdownRevisions,
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
	unpricedSinceResume,
	withLease,
	type CachedAnswer,
	type Db,
	type LiveRun,
	type StoredMessage,
	type WakingEvent,
} from './store.ts';
import { floorOf, RETRIES_PER_APPROVAL } from 'director-costs/recipe';
import {
	MAX_RECIPE_EDITS,
	applyRecipeEdits,
	approveArtPlan,
	artPlanApprovalRefusal,
	loadTimings,
	markChosen,
	markCommitted,
	markQueued,
	recordTiming,
	reviewPlanGate,
	settleJob,
	type RecipeDeps,
	type RecipeEdit,
} from './recipes.ts';
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
 * While the run is `running` in the `breakdown` step and has mockups, the step is the worker's, not
 * an agent's (ADR-0005): `breakdownStep` runs the analysis — the model proposes, the code rules
 * decide — and submits it as the `breakdown` checkpoint before any agent takes a turn. Only a run
 * without mockups reaches the coordinator in that step, for the style board.
 *
 * A run with nothing pending — waiting on the owner, on a GPU job, paused — makes no model call:
 * the only way to a call is a pending conversation in a `running` run, or the breakdown step of a
 * run with mockups.
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
	/** The mockup analysis's vision calls (`mockups/vision.ts`), one per image. */
	vision: VisionTransport;
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
	/** The run's mockup listing, read once per drive (`mockupListing`). */
	mockups?: Promise<MockupSummary>;
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
			if (await breakdownStep(ctx, live)) {
				await handleEvents(ctx);
				continue;
			}
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
	const { state } = await withLease(ctx.sql, ctx.run, async (_tx, l) => l);
	const status = state.status;
	const served = status === 'running' ? await catalog(ctx) : new Map<string, AdapterSpec>();
	// In the breakdown step the tools must know whose step it is before the turn's calls run.
	const hasMockups =
		status === 'running' && state.step === 'breakdown' ? await runHasMockups(ctx) : false;
	const results = new Map<string, BetaToolResultBlockParam>();
	let budgetStop: BudgetFigures | null = null;
	const chosen: { atlas: string; region: string; id: string }[] = [];
	const committed: { atlas: string; region: string; from: string }[] = [];
	const recipes =
		status === 'running' &&
		agent.tools.includes('run.set_recipe') &&
		calls.some((c) => toolId(c.name) === 'run.set_recipe')
			? await recipeDeps(ctx)
			: undefined;

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
			const live = await withLease(ctx.sql, ctx.run, async (_tx, l) => l);
			const spend = await runSpend(ctx.sql, ctx.run.id);
			const unpriced = await unpricedSinceResume(ctx.sql, ctx.run.id);
			// A render billed as nothing leaves the cap blind to GPU spend: no submit until the owner
			// has named the endpoint's GPU and resumed.
			if (unpriced > 0) {
				budgetStop = {
					reason: 'unpriced_gpu',
					spentUsd: spend.totalUsd,
					projectedUsd: 0,
					rendersInFlight: spend.rendersInFlight,
					queuedGpuUsd: 0,
					capUsd: capOf(live),
					unpriced,
				};
				results.set(
					call.id,
					resultBlock(
						call.id,
						'Not run: a render of this run reported GPU time with no GPU to price it by, so GPU submits are blocked until the owner sets RUNPOD_ENDPOINT_GPU on atlas-tool and resumes the run.',
						true,
					),
				);
				continue;
			}
			// This render and the ones in flight: none is billed before its job_done, and before the
			// first is, each projects at the seed.
			const seed = seedRenderUsd(await ctx.pricing());
			const queuedGpuUsd = projectQueuedGpu(spend.rendersInFlight, spend.meanRunpodJobUsd, seed);
			const projectedUsd = queuedGpuUsd + projectQueuedGpu(1, spend.meanRunpodJobUsd, seed);
			if (overCap(spend.totalUsd, projectedUsd, capOf(live))) {
				budgetStop = {
					reason: 'cap',
					spentUsd: spend.totalUsd,
					projectedUsd,
					rendersInFlight: spend.rendersInFlight,
					queuedGpuUsd,
					capUsd: capOf(live),
				};
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
		if (id === 'atlas.choose_variant' && answer.status === 200) {
			const pick = answer.body as { atlas?: unknown; region?: unknown; chosen?: unknown };
			if (
				typeof pick.atlas === 'string' &&
				typeof pick.region === 'string' &&
				typeof pick.chosen === 'string'
			) {
				chosen.push({ atlas: pick.atlas, region: pick.region, id: pick.chosen });
			}
		}
		if (id === 'atlas.set_output' && answer.status === 200) {
			const input = call.input as {
				atlas?: unknown;
				region?: unknown;
				from?: { atlas?: unknown; region?: unknown; id?: unknown };
			};
			const from = input.from;
			if (
				typeof input.atlas === 'string' &&
				typeof input.region === 'string' &&
				typeof from?.atlas === 'string' &&
				typeof from.region === 'string' &&
				typeof from.id === 'string'
			) {
				committed.push({
					atlas: input.atlas,
					region: input.region,
					from: `${from.atlas}/${from.region}/${from.id}`,
				});
			}
		}
		// Marked at once, in its own lease-checked write, so a second queue call later in this turn
		// already finds the step queued and the launcher's gate refuses it. A replayed call returns
		// the stored result and marks nothing new. A render the launcher could not record
		// (`tracked: false`) has no job row and no watch to settle it: its steps stay planned.
		if (id === 'atlas.queue_variants' && answer.status === 200) {
			const job = answer.body as { steps?: unknown; jobRef?: unknown; tracked?: unknown };
			if (
				Array.isArray(job.steps) &&
				job.steps.length &&
				typeof job.jobRef === 'string' &&
				job.tracked !== false
			) {
				const steps = job.steps as { recipe: string; n: number }[];
				const jobRef = job.jobRef;
				await withLease(ctx.sql, ctx.run, (tx, live) => markQueued(tx, live.id, steps, jobRef));
			}
		}
		results.set(call.id, resultBlock(call.id, JSON.stringify(answer.body), answer.status !== 200));
	}

	await withLease(ctx.sql, ctx.run, async (tx, live) => {
		// The pause first, so a worker tool later in the turn (a checkpoint request) sees it.
		if (budgetStop) await pauseForBudget(tx, live, agent.name, budgetStop, 'gpu_submit');
		for (const pick of chosen) {
			await markChosen(tx, live.id, agent.name, pick.atlas, pick.region, pick.id);
		}
		for (const tile of committed) {
			await markCommitted(tx, live.id, agent.name, tile.atlas, tile.region, tile.from);
		}
		const toolCtx = {
			tx,
			live,
			agent: agent.name,
			hasMockups,
			recipes,
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
 * The reviewed cards and the endpoint GPU's price, read through the launcher (`atlas.list_blueprints`
 * as the worker) before a turn that sets a recipe; validation runs inside the transaction on them.
 */
async function recipeDeps(ctx: Ctx): Promise<RecipeDeps | undefined> {
	const answer = await ctx.launcher.call(
		'atlas.list_blueprints',
		{ runId: ctx.run.id, agent: 'worker', input: {} },
		ctx.signal,
	);
	if (unsettled(answer.status, answer.body)) {
		throw new RetryLater(`atlas.list_blueprints answered ${answer.status}`);
	}
	if (answer.status !== 200) return undefined;
	const catalogue = answer.body as RecipeDeps['catalogue'];
	const pricing = await ctx.pricing();
	return {
		catalogue,
		usdPerSecond: pricingRate(pricing, catalogue),
		timings: await loadTimings(ctx.sql),
		// A guessed card never projects below the seed per render; a job's delay is the measured
		// one where the timings have it, else this seed.
		floor: floorOf(pricing.runpod),
	};
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

/**
 * What a budget pause tells the owner: `projectedUsd` includes the `queuedGpuUsd` in flight. The
 * reason is the cap, or GPU spend the cap cannot see (`unpriced` renders billed as nothing since
 * the last resume).
 */
interface BudgetFigures {
	reason: 'cap' | 'unpriced_gpu';
	spentUsd: number;
	projectedUsd: number;
	rendersInFlight: number;
	queuedGpuUsd: number;
	capUsd: number;
	unpriced?: number;
}

async function pauseForBudget(
	tx: Db,
	live: LiveRun,
	agent: string,
	figures: BudgetFigures,
	before: 'model_call' | 'gpu_submit',
): Promise<void> {
	const cause =
		figures.reason === 'cap'
			? `budget cap before ${agent}'s ${before}`
			: `unpriced GPU spend before ${agent}'s ${before}`;
	if (!(await pause(tx, live, 'budget_cap', cause))) return;
	if (figures.reason === 'unpriced_gpu') {
		await insertEvent(tx, live.id, 'worker', 'error', {
			type: 'gpu_submit_blocked',
			agent,
			unpriced: figures.unpriced,
			message: `${agent}'s GPU submit was not sent: ${figures.unpriced} render(s) of this run reported GPU time with no GPU to price it by, so the cap cannot see GPU spend. Set RUNPOD_ENDPOINT_GPU on atlas-tool to a GPU pricing.json prices.`,
		});
	}
	await insertEvent(tx, live.id, 'worker', 'checkpoint_open', {
		checkpoint: 'budget',
		agent,
		before,
		...figures,
		message:
			figures.reason === 'cap'
				? 'The run reached its budget cap. Raise the cap and resume, or stop the run.'
				: 'A render reported GPU time with no GPU to price it by, so its spend cannot count toward the cap. Set RUNPOD_ENDPOINT_GPU on atlas-tool to a GPU pricing.json prices, then resume; or stop the run.',
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
	// The call, plus the renders in flight: a run at its cap must not keep talking while their
	// cost is still to land.
	const queuedGpuUsd = projectQueuedGpu(
		spend.rendersInFlight,
		spend.meanRunpodJobUsd,
		seedRenderUsd(pricing),
	);
	const projectedUsd = projectCall(request, pricing, spend.maxOutputByAgent[name]) + queuedGpuUsd;
	const stopped = await withLease(ctx.sql, ctx.run, async (tx, live) => {
		if (live.state.status !== 'running') return true;
		if (!overCap(spend.totalUsd, projectedUsd, capOf(live))) return false;
		await pauseForBudget(
			tx,
			live,
			name,
			{
				reason: 'cap',
				spentUsd: spend.totalUsd,
				projectedUsd,
				rendersInFlight: spend.rendersInFlight,
				queuedGpuUsd,
				capUsd: capOf(live),
			},
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
 * money, and the error carries the usage so it can still be priced by hand. A turn's message and
 * the analysis's vision answers are billed alike.
 *
 * `alsoWrite` runs in the same transaction on the happy path, inside a savepoint: if it throws, only
 * its own writes are undone, the bill still commits, and the error is rethrown after the commit.
 * A re-ask after a failed answer write is unavoidable, but it is always billed — a rolled-back bill
 * would leave the money spent unrecorded, and the cap blind to it if the write kept failing.
 */
async function billResponse(
	ctx: Ctx,
	agent: string,
	response: BilledResponse,
	pricing: DirectorPricing,
	alsoWrite?: (tx: Db) => Promise<void>,
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
	let writeFailure: unknown = null;
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
		if (alsoWrite) {
			try {
				await tx.savepoint((sp) => alsoWrite(sp));
			} catch (error) {
				writeFailure = error;
			}
		}
	});
	if (writeFailure) throw writeFailure;
	return true;
}

// ── The breakdown step ────────────────────────────────────────────────────────

type MockupSummary = Pick<MockupListing, 'images' | 'ownershipConfirmed'>;

/**
 * The run's mockup listing, read once per drive through `mockups.list` in the analyst's name. A
 * listing that cannot be read is not "no mockups": the drive fails and is retried, because a style
 * board opened in its place would be a breakdown the rules never saw.
 */
function mockupListing(ctx: Ctx): Promise<MockupSummary> {
	ctx.mockups ??= adapterClient(
		ctx.launcher,
		{ runId: ctx.run.id, agent: ANALYST_AGENT },
		ctx.signal,
	).call<MockupSummary>('mockups', 'list', {});
	return ctx.mockups;
}

const runHasMockups = async (ctx: Ctx) => (await mockupListing(ctx)).images.length > 0;

/** The step stopped before it was done: the run was paused or stopped under it. */
class StepStopped extends Error {
	constructor(why: string) {
		super(`the breakdown step stopped: ${why}`);
		this.name = 'StepStopped';
	}
}

/**
 * The run's breakdown step when it has mockups (ADR-0005): the worker's own code — not an agent's
 * turn — runs the analysis and submits the result as the `breakdown` checkpoint. The model proposes
 * inside `analyzeMockups`, `rules.ts` decides every status, and `submitBreakdown` opens the
 * checkpoint in one lease-checked transaction, only from `running` in `breakdown` — so it opens
 * once per attempt, and a pass that died before its submission leaves the run where it was: the
 * next claim runs it again under a new pass number (new crops opId). Every answer the model gives
 * is stored as it arrives (`breakdown_image`, see `visionFor`), so a pass that stopped part-way —
 * the owner's pause, the cap, a transient failure, a lost lease — asks again only for the images
 * it lacks, and the stored answers go back through the rules with the template as it is now. An
 * owner who has not confirmed the mockups' ownership pauses the run before any model call, and
 * before the pass is announced. A run without mockups is the coordinator's, which builds the style
 * board and asks for the checkpoint itself.
 *
 * True when the step was the worker's here (the run moved, paused, or kept its state for a retry);
 * false when it is not — the loop then gives an agent its turn.
 */
async function breakdownStep(ctx: Ctx, live: LiveRun): Promise<boolean> {
	if (live.state.step !== 'breakdown') return false;
	const listing = await mockupListing(ctx);
	if (listing.images.length === 0) return false;
	const refusal = ownershipRefusal(listing);
	if (refusal) {
		await pauseWithError(ctx, 'worker', {
			type: 'ownership_unconfirmed',
			message: `${refusal} Then resume the run.`,
		});
		return true;
	}
	const analyst = ctx.agents.get(ANALYST_AGENT);
	if (!analyst) {
		await pauseWithError(ctx, 'worker', { type: 'unknown_agent', agent: ANALYST_AGENT });
		return true;
	}
	const { revisions, notes } = await breakdownRevisions(ctx.sql, ctx.run.id);
	const attempt = revisions + 1;
	const pass = (await breakdownPasses(ctx.sql, ctx.run.id)) + 1;
	const answers = await breakdownAnswers(ctx.sql, ctx.run.id);
	await withLease(ctx.sql, ctx.run, (tx, l) =>
		insertEvent(tx, l.id, 'worker', 'activity', {
			type: 'breakdown_pass',
			attempt,
			pass,
			message:
				attempt > 1
					? `Analysing the mockups again with the owner's notes (attempt ${attempt}).`
					: answers.size
						? 'Analysing the mockups, reusing the answers already given.'
						: 'Analysing the mockups.',
		}),
	);
	const client = (agent: string) =>
		adapterClient(ctx.launcher, { runId: ctx.run.id, agent }, ctx.signal);
	let breakdown: Breakdown;
	try {
		breakdown = await analyzeMockups({
			adapters: { analyst: client(ANALYST_AGENT), worker: client('worker') },
			model: visionFor(ctx, analyst, attempt, answers),
			agent: analyst,
			run: { id: ctx.run.id, templateProjectKey: live.templateProjectKey },
			pass,
			notes,
		});
	} catch (error) {
		if (error instanceof StepStopped) return true;
		// The listing changed between this drive's read and the analysis's own.
		if (error instanceof AnalysisRefused) {
			if (error.code === 'no_mockups') {
				ctx.mockups = Promise.resolve({ images: [], ownershipConfirmed: null });
				return false;
			}
			await pauseWithError(ctx, 'worker', {
				type: 'ownership_unconfirmed',
				message: `${error.message} Then resume the run.`,
			});
			return true;
		}
		// Anything else — the launcher unreachable, a transient API failure — is retried by the
		// drive's failure path (the answers already stored are reused) and pauses the run after
		// MAX_FAILURES in a row.
		throw error;
	}
	// A pause or stop pressed during the last image applies before the submission, as it would
	// before a turn's tool calls; the answers are stored, so the resume rebuilds the breakdown from
	// them without asking the model again.
	await handleEvents(ctx, { ownerRequestsOnly: true });
	const result = await submitBreakdown(ctx.sql, ctx.run, breakdown, attempt);
	if (!result.ok) {
		await withLease(ctx.sql, ctx.run, (tx, l) =>
			insertEvent(tx, l.id, 'worker', 'activity', {
				type: 'breakdown_held',
				attempt,
				pass,
				message: `The breakdown is ready but was not submitted (${result.error}). It is produced again from the stored answers, without asking the model again, once the run is running in the breakdown step.`,
			}),
		);
	}
	return true;
}

const digest = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/**
 * What a stored answer is keyed by: the attempt (a revise asks for a fresh look), the image and
 * its bytes as the model saw them, and the system block plus prompt — the agent's definition, the
 * template's catalogue, the owner's notes, the tag, the size and the fidelity. Anything that would
 * change what the model is asked is a new key, so a stale answer is never reused.
 */
const answerKey = (attempt: number, request: VisionRequest) =>
	`${attempt}:${request.image.id}:${digest(request.image.base64)}:${digest(`${request.system}\n${request.prompt}`)}`;

const answerFrom = (cached: CachedAnswer): VisionAnswer => ({
	...cached.response,
	output: cached.output,
	usageSummary: summarizeUsage(cached.response.usage),
});

/**
 * The analyst's vision calls as the driver makes them. An image whose answer the run already
 * holds (`answers`, by `answerKey`) is not asked again. Otherwise each call goes out only while the
 * run is still running (an owner's pause or stop pressed since the last call applies first), only
 * under the cap, and with the drive's signal; the answer is billed as soon as it arrives — a
 * refused or malformed answer included, since its tokens are spent all the same — and, in the same
 * transaction, stored as a `breakdown_image` row for the passes to come (if that write fails the bill
 * stands and the drive is retried, which asks again and bills again). A refusal, an answer that
 * cannot be used, or an API error a retry cannot fix pauses the run here, once, for a person.
 */
function visionFor(
	ctx: Ctx,
	analyst: AgentDefinition,
	attempt: number,
	answers: Map<string, CachedAnswer>,
): VisionTransport {
	return {
		async analyze(request) {
			await handleEvents(ctx, { ownerRequestsOnly: true });
			const key = answerKey(attempt, request);
			const cached = answers.get(key);
			if (cached) {
				const stop = await withLease(ctx.sql, ctx.run, async (_tx, live) =>
					live.state.status === 'running' ? null : `the run is ${live.state.status}`,
				);
				if (stop) throw new StepStopped(stop);
				return answerFrom(cached);
			}
			const pricing = await ctx.pricing();
			const spend = await runSpend(ctx.sql, ctx.run.id);
			const queuedGpuUsd = projectQueuedGpu(
				spend.rendersInFlight,
				spend.meanRunpodJobUsd,
				seedRenderUsd(pricing),
			);
			const projectedUsd =
				projectVisionCall(
					request,
					VISION_MAX_TOKENS,
					pricing,
					spend.maxOutputByAgent[analyst.name],
				) + queuedGpuUsd;
			const stop = await withLease(ctx.sql, ctx.run, async (tx, live) => {
				if (live.state.status !== 'running') return `the run is ${live.state.status}`;
				if (!overCap(spend.totalUsd, projectedUsd, capOf(live))) return null;
				await pauseForBudget(
					tx,
					live,
					analyst.name,
					{
						reason: 'cap',
						spentUsd: spend.totalUsd,
						projectedUsd,
						rendersInFlight: spend.rendersInFlight,
						queuedGpuUsd,
						capUsd: capOf(live),
					},
					'model_call',
				);
				return 'the budget cap';
			});
			if (stop) throw new StepStopped(stop);
			try {
				const answer = await ctx.vision.analyze(request, ctx.signal);
				const stored: CachedAnswer = {
					response: { id: answer.id, model: answer.model, usage: answer.usage },
					output: answer.output,
				};
				// Stored with the bill, and kept whatever happens next: the answer is paid for, and a pass
				// that dies after this finds it and does not ask again.
				const billed = await billResponse(ctx, analyst.name, answer, pricing, (tx) =>
					insertEvent(tx, ctx.run.id, analyst.name, 'activity', {
						type: 'breakdown_image',
						attempt,
						imageId: request.image.id,
						key,
						...stored,
						message: `Mockup ${request.image.id} analysed.`,
					}),
				);
				if (!billed) throw new StepStopped('an unpriced response');
				answers.set(key, stored);
				return answer;
			} catch (error) {
				if (error instanceof StepStopped) throw error;
				// Billed first, whatever happens next: an answer that arrived was paid for.
				if (
					error instanceof VisionError &&
					error.response &&
					!(await billResponse(ctx, analyst.name, error.response, pricing))
				) {
					throw new StepStopped('an unpriced response');
				}
				if (ctx.signal.aborted) throw error;
				if (error instanceof VisionError) {
					const model = error.response?.model ?? analyst.model;
					await withLease(ctx.sql, ctx.run, async (tx, live) => {
						// An owner's pause during the call already took the run out of `running`.
						if (live.state.status !== 'running') return;
						await insertEvent(
							tx,
							live.id,
							analyst.name,
							'error',
							error.code === 'refusal'
								? {
										type: 'refusal',
										model,
										message: `The mockup analyst's call was refused: ${error.message}`,
									}
								: {
										type: 'bad_answer',
										code: error.code,
										model,
										message: `The mockup analyst's answer for a mockup could not be used (${error.code}): ${error.message} Resume the run to analyse the mockups again.`,
									},
						);
						await pause(
							tx,
							live,
							error.code === 'refusal' ? 'refusal' : 'error',
							`${analyst.name}: ${error.code}`,
						);
					});
					throw new StepStopped(error.code);
				}
				const status = permanentApiError(error);
				if (status !== null) {
					await pauseWithError(ctx, analyst.name, {
						type: 'api_error',
						status,
						message: `${analyst.name}'s call was rejected (${status}): ${(error as Error).message}`,
					});
					throw new StepStopped(`a ${status} from the API`);
				}
				throw error;
			}
		},
	};
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
		// An Art plan decision is priced and validated on the catalogue and the timings, read
		// before the transaction for the same reason. When they cannot be read the decision is
		// refused, never retried: a retry would hold every later row of the owner's (a stop
		// included) behind the launcher.
		const deps = decidesArtPlan(event) ? await recipeDepsOrNull(ctx) : undefined;
		await withLease(ctx.sql, ctx.run, async (tx, live) => {
			await applyEvent(ctx, tx, live, event, pricing, deps);
			await markHandled(tx, event.id);
		});
	}
}

const decidesArtPlan = (event: WakingEvent): boolean =>
	event.kind === 'checkpoint_resolved' &&
	event.payload.checkpoint === 'art_plan' &&
	(event.payload.decision === 'approve' ||
		(event.payload.decision === 'revise' && event.payload.recipeEdits !== undefined));

async function recipeDepsOrNull(ctx: Ctx): Promise<RecipeDeps | null> {
	try {
		return (await recipeDeps(ctx)) ?? null;
	} catch (error) {
		// Any failure to read them (an answer saying so, or no answer at all: a launcher that cannot
		// be reached throws) refuses the decision. Only the drive stopping (shutdown, a lost lease)
		// is not an answer: the event then waits for the next drive.
		if (ctx.signal.aborted) throw error;
		return null;
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
	deps?: RecipeDeps | null,
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
				// The owner's resume is their approval of what the plan still waits for, except a step
				// past its retries, which the Art plan then asks them about.
				await reviewPlanGate(tx, live, ownerOf(p));
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
			// The owner approves the plan they saw: a revision since, or a plan with no price, is
			// refused before the run moves, and the Art plan stays open.
			const unreadable =
				'the blueprint catalogue could not be read, so the Art plan cannot be priced now; send it again in a moment';
			const approvingPlan =
				checkpoint === 'art_plan' && decision === 'approve' && live.state.waitingOn === 'art_plan';
			if (approvingPlan) {
				if (!deps) return refuse(unreadable);
				const why = await artPlanApprovalRefusal(tx, live.id, p.recipeRevs, deps);
				if (why) return refuse(why);
			}
			const edits =
				checkpoint === 'art_plan' && decision === 'revise' ? recipeEditsOf(p.recipeEdits) : null;
			if (edits === undefined) return refuse('the recipe edits are not a list of region chains');
			if (edits?.length && !deps) return refuse(unreadable);
			const error = await move(
				tx,
				live,
				{ type: 'resolve', checkpoint, decision },
				`owner ${decision}`,
			);
			if (error) return refuse(error);
			const owner = ownerOf(p);
			if (approvingPlan && deps) await approveArtPlan(tx, live, owner, deps);
			if (edits?.length && deps) {
				// The owner's own edits go back to the owner, not to an agent: stored as the next
				// revisions and the Art plan re-opened on them, or refused with every reason and the
				// plan re-opened unchanged.
				const applied = await applyRecipeEdits(tx, live, owner, edits, deps);
				const text = applied.ok
					? `Your Art plan edits to ${applied.regions.join(', ')} are stored; approve the plan as it now stands.`
					: `Your Art plan edits were not stored:\n- ${applied.errors.join('\n- ')}`;
				await insertEvent(tx, live.id, 'worker', 'activity', { type: 'note', text });
				await reviewPlanGate(tx, live);
				// A note with the edits is kept for the coordinator, who reads it once the owner
				// approves the plan: the run waits on the owner until then.
				if (p.note) {
					await appendMessage(
						tx,
						live.id,
						COORDINATOR,
						'user',
						userText(
							`The owner edited the Art plan (${applied.ok ? 'stored; it waits for their approval again' : 'not stored'}). Their note: ${String(p.note)}`,
						),
					);
				}
				return;
			}
			// What failed past its retries while another checkpoint was open is put to the owner now,
			// rather than waiting for the technician's next recipe. Not after an Art plan revise: the
			// plan goes back to the technician first.
			if (checkpoint !== 'art_plan') await reviewPlanGate(tx, live);
			const reopened =
				checkpoint !== 'art_plan' && live.state.waitingOn === 'art_plan'
					? ' The Art plan is open again for the owner: a step failed past its retries.'
					: '';
			const note = p.note ? `\nTheir note: ${String(p.note)}` : '';
			const what = decision === 'approve' ? 'approved' : 'asked for revisions at';
			await appendMessage(
				tx,
				live.id,
				COORDINATOR,
				'user',
				userText(
					`The owner ${what} the ${checkpoint} checkpoint. The run is now in the ${live.state.step} step.${reopened}${note}`,
				),
			);
			return;
		}
		case 'job_done': {
			const billed = await billJob(tx, live, event, pricing);
			const result = isRecord(p.result) ? p.result : {};
			const variants = (Array.isArray(result.variants) ? result.variants : [])
				.filter(isRecord)
				.map((v) => ({ region: String(v.region ?? ''), id: String(v.variant ?? v.id ?? '') }))
				.filter((v) => v.region && v.id);
			const { settled, withdrawn } = await settleJob(
				tx,
				live.id,
				String(p.jobRef),
				p.status === 'finished',
				variants,
			);
			if (billed) await recordTiming(tx, settled, billed);
			// An ended run has nobody left to tell; its job is only billed.
			if (TERMINAL_STATUSES.includes(live.state.status)) return;
			const spent = withdrawn.map((w) => `${w.region} step ${w.steps.join(', ')}`).join('; ');
			// The gate names the step wherever it asks or pauses; the note stands in for it only
			// when it could not (the plan is incomplete), and a stopping run is told nothing.
			const told = withdrawn.length > 0 && (await reviewPlanGate(tx, live)).told;
			if (withdrawn.length && !told && live.state.status !== 'stopping') {
				await insertEvent(tx, live.id, 'worker', 'activity', {
					type: 'note',
					text: `${spent} failed again after ${RETRIES_PER_APPROVAL} retries: its recipe renders nothing more until the plan is approved again.`,
				});
			}
			const to = ctx.agents.has(event.agent) ? event.agent : COORDINATOR;
			const body = JSON.stringify({ jobRef: p.jobRef, status: p.status, result: p.result });
			const held = withdrawn.length
				? ` ${spent} has used its ${RETRIES_PER_APPROVAL} retries: the owner approves it again before it renders.`
				: '';
			await appendMessage(
				tx,
				live.id,
				to,
				'user',
				userText(`GPU job ${String(p.jobRef)} (${event.tool ?? 'job'}) finished: ${body}${held}`),
			);
			return finishStop(tx, live);
		}
	}
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** Who an owner's row came from, as the launcher stamps it (`by`). */
function ownerOf(p: Record<string, unknown>): string {
	const by = isRecord(p.by) ? p.by : {};
	return String(by.uid ?? by.name ?? 'owner');
}

/**
 * The owner's Art plan edits as the launcher wrote them (`runs.ts` checks the same shape): null
 * when there are none, undefined when they are not a list of region chains, each with the
 * revision it was edited on. Every step is parsed by the recipe rules before anything is stored
 * (`applyRecipeEdits`), so a malformed one is a reason, never a throw.
 */
function recipeEditsOf(raw: unknown): RecipeEdit[] | null | undefined {
	if (raw === undefined || raw === null) return null;
	if (!Array.isArray(raw) || raw.length > MAX_RECIPE_EDITS) return undefined;
	const edits: RecipeEdit[] = [];
	for (const e of raw) {
		if (!isRecord(e) || typeof e.region !== 'string' || !Array.isArray(e.steps)) return undefined;
		if (!Number.isInteger(e.rev) || e.steps.length > 8) return undefined;
		edits.push({ region: e.region, rev: e.rev as number, steps: e.steps });
	}
	return edits;
}

const finiteCount = (v: unknown): number | null =>
	typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;

/**
 * The RunPod rows for a settled render (ADR-0006), from what atlas-tool reports
 * (`result.runpod = { gpu, seconds, jobs, unreported }`: the billed seconds, execution plus
 * delay, read off RunPod's own job status, and the GPU from the endpoint's `RUNPOD_ENDPOINT_GPU`)
 * at `pricing.json`'s $/s, never a price from the wire. Keyed `runpod:<jobRef>` so a redelivered
 * `job_done` is billed once. Jobs that ended without reporting a time (`unreported`) are billed
 * too, as an estimate flagged as such (`unreportedSeconds`): under-counting is what lets a run
 * past its cap. A render with no GPU to price by gets no row — a figure made up here could not
 * be told from a real one — and is an `unbilled_job` error event, which blocks the run's GPU
 * submits until the owner resumes (`unpricedSinceResume`); a render that reported nothing and
 * did not finish is only logged, since nothing is known to have been spent.
 */
async function billJob(
	tx: Db,
	live: LiveRun,
	event: WakingEvent,
	pricing: DirectorPricing,
): Promise<{ jobs: number; executionSeconds: number; delaySeconds: number } | null> {
	const raw = (event.payload.result as { runpod?: Record<string, unknown> } | null)?.runpod;
	const jobRef = String(event.payload.jobRef);
	const gpu = typeof raw?.gpu === 'string' && raw.gpu ? raw.gpu : null;
	const seconds = finiteCount(raw?.seconds);
	const jobs = finiteCount(raw?.jobs) ?? 0;
	const unreported = finiteCount(raw?.unreported) ?? 0;
	if (gpu === null || seconds === null) {
		log.warn('GPU job not billed: no usage reported', {
			runId: live.id,
			jobRef,
			status: event.payload.status,
			gpu,
			seconds,
		});
		// Time was spent (or jobs ran unseen) with nothing to price it by, or a finished render
		// reported nothing at all: the cap is blind to it, and the owner is told.
		const spent = raw !== undefined && ((seconds ?? 0) > 0 || unreported > 0);
		if (spent || event.payload.status === 'finished') {
			await insertEvent(tx, live.id, 'worker', 'error', {
				type: 'unbilled_job',
				jobRef,
				seconds,
				message:
					seconds === null
						? `Render ${jobRef} ended without reporting its GPU time, so it does not count toward the cap.`
						: `Render ${jobRef} reports ${seconds} s of GPU time but no GPU to price it by (RUNPOD_ENDPOINT_GPU on atlas-tool), so it does not count toward the cap. GPU submits are blocked until it is set and the run resumed.`,
			});
		}
		return null;
	}
	const estimate = unreportedSeconds(
		unreported,
		jobs,
		seconds,
		pricing.runpod.seedSecondsPerRender,
	);
	let usd: number;
	let estimateUsd: number;
	try {
		usd = costOfRunpodJob(gpu, seconds, pricing);
		estimateUsd = costOfRunpodJob(gpu, estimate, pricing);
	} catch (error) {
		await insertEvent(tx, live.id, 'worker', 'error', {
			type: 'unpriced',
			jobRef,
			message: (error as Error).message,
		});
		return null;
	}
	const bill = async (requestId: string, amount: number, extra: Record<string, unknown>) => {
		const written = await recordSpend(tx, {
			runId: live.id,
			agent: event.agent,
			model: gpu,
			kind: 'runpod',
			requestId,
			usd: amount,
		});
		if (written) {
			await insertEvent(tx, live.id, event.agent, 'spend', {
				kind: 'runpod',
				model: gpu,
				usd: amount,
				requestId,
				...extra,
			});
		}
		return written;
	};
	const first = seconds > 0 && (await bill(`runpod:${jobRef}`, usd, { seconds }));
	if (unreported > 0) {
		const written = await bill(`runpod:${jobRef}:unreported`, estimateUsd, {
			estimated: true,
			unreported,
			seconds: estimate,
		});
		if (written) {
			await insertEvent(tx, live.id, 'worker', 'error', {
				type: 'estimated_gpu_time',
				jobRef,
				unreported,
				seconds: estimate,
				usd: estimateUsd,
				message: `${unreported} job(s) of render ${jobRef} ended without reporting their GPU time (lost, abandoned or timed out); billed as an estimate of ${Math.round(estimate)} s on ${gpu}.`,
			});
		}
	}
	// The measured split (#1064), for the timings: only on the job's first bill, so a redelivered
	// `job_done` is counted once.
	const execution = finiteCount(raw?.executionSeconds);
	const delay = finiteCount(raw?.delaySeconds);
	return first && execution !== null && delay !== null && jobs > 0
		? { jobs, executionSeconds: execution, delaySeconds: delay }
		: null;
}
