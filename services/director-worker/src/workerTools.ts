import type { TransactionSql } from 'postgres';
import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { ToolSpec } from './model.ts';
import { MAX_PLAN_REGIONS, REGION_NAME, type RecipeInput } from 'director-costs/recipe';
import { ANALYST_AGENT } from './mockups/analyze.ts';
import {
	ART_NOT_REPAIRED,
	NO_AREA,
	PIPELINE_AREAS,
	REPAIR_ASSIGNABLE,
	SUBMIT_OUTCOMES,
	VERIFIED,
	checkSubmission,
	derivedVerified,
	leadOf,
	type RepairSubmission,
} from './repair.ts';
import {
	TECHNICIAN,
	defaultsBrief,
	forgetUnplanned,
	setRecipe,
	type RecipeDeps,
} from './recipes.ts';
import { transition, type RunEvent, type RunKind } from './runState.ts';
import {
	appendMessage,
	applyTransition,
	completedWrites,
	insertEvent,
	playsOfStep,
	rendersInFlight,
	runSpend,
	type LiveRun,
} from './store.ts';
import type { WORKER_TOOLS } from './tools.ts';

/**
 * The tools the worker serves itself (`WORKER_TOOLS`), from the run tables. Each runs inside the
 * lease-checked transaction that also stores the turn's tool results, so a tool's effect and the
 * record that it happened commit together: a crash before the commit leaves neither, and the
 * resumed turn runs it once.
 *
 * Agents ask; the worker decides. `run.request_checkpoint` is a request to `transition()` — the
 * state machine opens the checkpoint, and refuses a step the run is not in. When the run has
 * mockups, its breakdown step is the worker's own (`driver.ts` `breakdownStep`, ADR-0005): the
 * coordinator can neither open that checkpoint itself nor assign the mockup analyst, so the
 * checkpoint only ever opens with the breakdown the code rules passed.
 */

export type WorkerToolId = (typeof WORKER_TOOLS)[number];

export interface ToolContext {
	tx: TransactionSql;
	/** The run as locked by this transaction. A transition here updates `live.state`. */
	live: LiveRun;
	agent: string;
	/** For an agent, the tools it names that are not served now; empty = it can start. */
	missingTools: (agent: string) => string[];
	/** Whether the run has mockups: its breakdown step is then the worker's, not an agent's. */
	hasMockups: boolean;
	/** The reviewed cards and GPU price, fetched before the transaction when the turn sets a
	 *  recipe; undefined otherwise. */
	recipes?: RecipeDeps;
	/** The pipeline bug `bugs.file_pipeline_bug` filed for this `run.request_pipeline_change`,
	 *  before the transaction. */
	bug?: FiledBug;
}

/** What the launcher's `bugs.file_pipeline_bug` answers. */
export interface FiledBug {
	number: number;
	ref: string;
	path: string;
}

export interface ToolOutcome {
	content: string;
	isError?: true;
}

const ok = (value: unknown): ToolOutcome => ({ content: JSON.stringify(value) });
const refused = (message: string): ToolOutcome => ({ content: message, isError: true });

const text = (description: string, maxLength: number) => ({
	type: 'string',
	description,
	maxLength,
});
const object = (properties: Record<string, unknown>, required: string[], description?: string) => ({
	type: 'object',
	...(description ? { description } : {}),
	properties,
	required,
	additionalProperties: false,
});

const refChoice = (description: string) =>
	object(
		{
			source: { type: 'string', enum: ['keep', 'clear', 'key', 'variant', 'mockupCrop'] },
			value: text(
				'"" for keep, clear and mockupCrop; a sheets/… key; or for a variant step:<n> (the chosen variant of an earlier step) or <atlas>/<region>/<id>.',
				400,
			),
		},
		['source', 'value'],
		description,
	);

const findings = {
	type: 'array',
	description: 'One entry per item judged.',
	items: object(
		{
			subject: text('What this is about: a region, a mockup element, an asset, a screen.', 200),
			verdict: text('The verdict, e.g. pick / reject, pass / fail.', 40),
			note: text('One or two sentences: why, with measured values where there are any.', 2000),
		},
		['subject', 'verdict', 'note'],
	),
};

const LEADS: readonly string[] = [leadOf('create'), leadOf('repair')];
const UNASSIGNABLE: ReadonlySet<string> = new Set([...LEADS, ANALYST_AGENT]);

/**
 * The specs, in a fixed order. `agentNames` fills `run.assign_task`'s enum: in a repair run only the
 * agents that write a project's content, in a create run every agent but the leads.
 */
export function workerToolSpecs(
	agentNames: readonly string[],
	kind: RunKind = 'create',
): Record<WorkerToolId, ToolSpec> {
	// The mockup analyst is run by the worker's own code, never as an assigned turn.
	const assignable = agentNames
		.filter((name) =>
			kind === 'repair' ? REPAIR_ASSIGNABLE.includes(name) : !UNASSIGNABLE.has(name),
		)
		.sort();
	return {
		'run.get_state': {
			id: 'run.get_state',
			description: "The run's status, step, open checkpoint, budget cap and spend so far.",
			inputSchema: object({}, []),
		},
		'run.set_plan': {
			id: 'run.set_plan',
			description:
				'Record the run plan: the region batches in order. Shown to the owner; replaces the previous plan.',
			inputSchema: object(
				{
					summary: text('The plan in two or three sentences.', 2000),
					batches: {
						type: 'array',
						items: object(
							{
								name: text('The batch, e.g. "Symbols".', 120),
								regions: { type: 'array', items: text('A region name.', 120) },
							},
							['name', 'regions'],
						),
					},
				},
				['summary', 'batches'],
			),
		},
		'run.request_checkpoint': {
			id: 'run.request_checkpoint',
			description:
				"Say the current step's work is done (`step_done`) or, in the regions step, that a region batch is drafted and reviewed (`batch_done`). The worker opens the checkpoint the run's settings require and the owner reviews it; end your turn after calling this. Not for the breakdown of a run with mockups: the worker produces that breakdown and opens its checkpoint itself.",
			inputSchema: object(
				{
					kind: { type: 'string', enum: ['step_done', 'batch_done'] },
					summary: text('What the owner is asked to review, in plain words.', 4000),
				},
				['kind', 'summary'],
			),
		},
		'run.post_activity': {
			id: 'run.post_activity',
			description: "Add one entry to the run's Activity feed, which the owner reads live.",
			inputSchema: object({ text: text('The entry.', 2000) }, ['text']),
		},
		'run.ask_owner': {
			id: 'run.ask_owner',
			description:
				'Ask the owner a question. Their answer arrives later as a message; do not wait for it in this turn.',
			inputSchema: object({ question: text('The question.', 2000) }, ['question']),
		},
		'run.assign_task': {
			id: 'run.assign_task',
			description:
				'Give another agent a task. It starts working after your turn, and its report comes back to you as a message.',
			inputSchema: object(
				{
					agent: { type: 'string', enum: assignable },
					task: text('The task, with everything the agent needs to do it.', 8000),
				},
				['agent', 'task'],
			),
		},
		'run.request_pipeline_change': {
			id: 'run.request_pipeline_change',
			description:
				'Ask for a pipeline change when the template lacks something the run needs (a region, an FX slot). People decide; never work around it.',
			inputSchema: object(
				{
					what: text('What is missing.', 2000),
					reason: text('Why the run needs it.', 2000),
				},
				['what', 'reason'],
			),
		},
		'run.submit_review': {
			id: 'run.submit_review',
			description:
				'Submit your review of a region batch: the pick or rejection per region, with why.',
			inputSchema: object({ summary: text('The review in brief.', 4000), findings }, [
				'summary',
				'findings',
			]),
		},
		'run.submit_qa': {
			id: 'run.submit_qa',
			description: 'Submit QA results: pass or fail per asset or screen, with the measured values.',
			inputSchema: object({ summary: text('The results in brief.', 4000), findings }, [
				'summary',
				'findings',
			]),
		},
		'run.set_recipe': {
			id: 'run.set_recipe',
			description:
				"Store your recipe for one template region: the chain of Atlas Maker steps that makes it. Code validates it against the reviewed cards (pipelines, sizes, variants, settings and their ranges, sources, one size and per-atlas settings per atlas) and answers every problem; nothing invalid is stored. Send the whole recipe each time; it replaces the region's previous one. When every planned region has one, the worker opens the Art plan for the owner.",
			inputSchema: object(
				{
					region: text('The template region the recipe makes.', 120),
					atlas: text('The template atlas the region is on.', 120),
					group: text('The plan batch the region is in, as run.set_plan named it.', 120),
					steps: {
						type: 'array',
						description: 'The chain, in order, numbered from 1.',
						items: object(
							{
								n: { type: 'integer', description: 'The step number, 1, 2, 3…' },
								kind: { type: 'string', enum: ['generate', 'process', 'finish'] },
								pipeline: text('A reviewed card id; "" on finish.', 120),
								atlas: text(
									'The atlas the step renders on (a scratch atlas for process steps).',
									120,
								),
								region: text('The region the step renders.', 120),
								genPx: { type: 'integer', description: 'Generation size in px; 0 on finish.' },
								variants: { type: 'integer', description: 'Variants to render; 0 on finish.' },
								settings: {
									type: 'array',
									items: object(
										{
											key: text('A setting the card names.', 120),
											value: text('Its value, as text.', 200),
										},
										['key', 'value'],
									),
								},
								style: refChoice('The style reference (style_ref).'),
								shape: refChoice('The shape reference (shape_ref).'),
								note: text('Why this step; "" when obvious.', 500),
							},
							[
								'n',
								'kind',
								'pipeline',
								'atlas',
								'region',
								'genPx',
								'variants',
								'settings',
								'style',
								'shape',
								'note',
							],
						),
					},
				},
				['region', 'atlas', 'group', 'steps'],
			),
		},
		'run.submit_repair': {
			id: 'run.submit_repair',
			description:
				"Conclude the repair: what you found, what changed and whether you played it again. Code checks it: a fix is submitted only from the verify step, after a builder or animator change, and an escalation needs a real pipeline area and a title. The owner reviews every outcome at Repair review; end your turn after calling this. Write every field in your own words, never the reporter's.",
			inputSchema: object(
				{
					outcome: {
						type: 'string',
						enum: [...SUBMIT_OUTCOMES],
						description:
							'fixed: changed and played again. escalate: the cause is in the engine or a tool. needs_person: the cause is math, Game Config or art. not_reproduced: you could not make it happen.',
					},
					summary: text('The result in two or three sentences.', 2000),
					cause: text('What caused it, as far as you found out.', 2000),
					changes: text('What the builder or animator changed, or "none".', 2000),
					verified: {
						type: 'string',
						enum: [...VERIFIED],
						description:
							"Whether you played the game again after the change, and how it went. The worker overrides it with what this step's plays settled as.",
					},
					pipeline_area: {
						type: 'string',
						enum: [...PIPELINE_AREAS, NO_AREA],
						description: `The pipeline area when you escalate; "${NO_AREA}" otherwise.`,
					},
					pipeline_title: text('The pipeline bug title when you escalate; "" otherwise.', 200),
				},
				['outcome', 'summary', 'cause', 'changes', 'verified', 'pipeline_area', 'pipeline_title'],
			),
		},
		'costs.get_run_spend': {
			id: 'costs.get_run_spend',
			description: "The run's spend so far, by agent, and its budget cap.",
			inputSchema: object({}, []),
		},
	};
}

type Input = Record<string, unknown>;
const str = (input: Input, key: string) => String(input[key] ?? '');

/** The submission as stored: every field present, cut to the length the spec allows. */
export function submissionOf(input: Input): RepairSubmission | string {
	const outcome = str(input, 'outcome');
	const verified = str(input, 'verified');
	if (!(SUBMIT_OUTCOMES as readonly string[]).includes(outcome)) {
		return `outcome must be one of ${SUBMIT_OUTCOMES.join(', ')}.`;
	}
	if (!(VERIFIED as readonly string[]).includes(verified)) {
		return `verified must be one of ${VERIFIED.join(', ')}.`;
	}
	for (const field of ['summary', 'cause', 'changes', 'pipeline_area', 'pipeline_title']) {
		if (typeof input[field] !== 'string') return `${field} is required.`;
	}
	return {
		outcome: outcome as RepairSubmission['outcome'],
		summary: str(input, 'summary').slice(0, 2000),
		cause: str(input, 'cause').slice(0, 2000),
		changes: str(input, 'changes').slice(0, 2000),
		verified: verified as RepairSubmission['verified'],
		pipeline_area: str(input, 'pipeline_area'),
		pipeline_title: str(input, 'pipeline_title').slice(0, 200),
	};
}

async function activity(ctx: ToolContext, tool: string, payload: Record<string, unknown>) {
	await insertEvent(ctx.tx, ctx.live.id, ctx.agent, 'activity', payload, tool);
}

async function move(ctx: ToolContext, event: RunEvent, cause: string): Promise<string | null> {
	const result = transition(ctx.live.state, event);
	if (!result.ok) return result.error;
	if (!(await applyTransition(ctx.tx, ctx.live.id, ctx.live.state, result.state, cause))) {
		return 'the run changed while this turn ran';
	}
	ctx.live.state = result.state;
	return null;
}

/** Run one worker tool. Unknown ids are the caller's bug: `tools.ts` and these specs agree. */
export async function runWorkerTool(
	ctx: ToolContext,
	id: WorkerToolId,
	input: Input,
): Promise<ToolOutcome> {
	switch (id) {
		case 'run.get_state':
		case 'costs.get_run_spend': {
			const spend = await runSpend(ctx.tx, ctx.live.id);
			const base = { budgetCapUsd: ctx.live.budgetCapUsd, spentUsd: spend.totalUsd };
			if (id === 'costs.get_run_spend') return ok({ ...base, byAgent: spend.byAgent });
			const { status, step, waitingOn } = ctx.live.state;
			return ok({ ...base, status, step, waitingOn });
		}
		case 'run.set_plan': {
			// A plan the owner's Art plan approval could not name could never be approved.
			const batches = Array.isArray(input.batches)
				? (input.batches as { regions?: unknown }[])
				: [];
			const regions = new Set(batches.flatMap((b) => (Array.isArray(b.regions) ? b.regions : [])));
			const named = [...regions].filter((r) => typeof r !== 'string' || !REGION_NAME.test(r));
			if (named.length) {
				const listed = named
					.slice(0, 10)
					.map((r) => JSON.stringify(r))
					.join(', ');
				const what = named.length === 1 ? 'is not a region name' : 'are not region names';
				return refused(
					`Refused: ${listed} ${what} (letters, digits and _ . ( ) -, up to 120 characters, as Atlas Maker names a region). Send the whole plan again.`,
				);
			}
			if (regions.size > MAX_PLAN_REGIONS) {
				return refused(
					`Refused: the plan names ${regions.size} regions, more than the ${MAX_PLAN_REGIONS} one Art plan approval can name. Plan fewer.`,
				);
			}
			await activity(ctx, id, { type: 'plan', summary: input.summary, batches: input.batches });
			const dropped = await forgetUnplanned(ctx.tx, ctx.live.id);
			if (dropped.length) {
				await activity(ctx, id, {
					type: 'note',
					text: `The new plan leaves out ${dropped.join(', ')}: their approved recipes are no longer approved and render nothing.`,
				});
			}
			return ok({ recorded: true, ...(dropped.length ? { unapproved: dropped } : {}) });
		}
		case 'run.post_activity':
			await activity(ctx, id, { type: 'note', text: str(input, 'text') });
			return ok({ posted: true });
		case 'run.ask_owner':
			await activity(ctx, id, { type: 'question', question: str(input, 'question') });
			return ok({ asked: true, note: 'The answer arrives as an owner message in a later turn.' });
		case 'run.request_pipeline_change':
			// The driver files the bug first (`WORKER_TOOL_OPS`) and refuses to run this without it.
			if (!ctx.bug) return refused('Not run: no pipeline bug was filed for this request.');
			await activity(ctx, id, {
				type: 'pipeline_change_request',
				what: str(input, 'what'),
				reason: str(input, 'reason'),
				bug: ctx.bug.number,
			});
			return ok({
				requested: true,
				bug: ctx.bug.ref,
				note: 'Filed as a pipeline bug, Open and not sent: a triager decides whether it is fixed.',
			});
		case 'run.submit_review':
		case 'run.submit_qa': {
			await activity(ctx, id, {
				type: id.slice('run.submit_'.length),
				summary: input.summary,
				findings: input.findings,
			});
			// QA's failures go to the coordinator (qa.md), who is otherwise told only by QA's last
			// words. Not the coordinator's own submit: it would be told its own report.
			if (id === 'run.submit_qa' && ctx.agent !== 'coordinator') {
				await appendMessage(ctx.tx, ctx.live.id, 'coordinator', 'user', [
					{
						type: 'text',
						text: `QA results from ${ctx.agent}:\n\n${str(input, 'summary')}\n\nFindings: ${JSON.stringify(input.findings)}`,
					},
				]);
			}
			return ok({ submitted: true });
		}
		case 'run.request_checkpoint': {
			const kind = input.kind === 'batch_done' ? 'batch_done' : 'step_done';
			const from = ctx.live.state;
			if (from.kind === 'repair' && kind !== 'step_done') {
				return refused(
					'Refused: a repair run has no region batches. Say a step is done (step_done), or conclude with run.submit_repair.',
				);
			}
			if (kind === 'step_done' && from.step === 'breakdown' && ctx.hasMockups) {
				return refused(
					'Refused: this run has mockups, so the worker produces the mockup breakdown itself and opens its checkpoint. You will be told the result.',
				);
			}
			// A render's failures are put to the owner at the Art plan, which opens only up to the
			// region step: the step ends once nothing it queued can still fail.
			const inFlight =
				kind === 'step_done' && from.step === 'regions'
					? await rendersInFlight(ctx.tx, ctx.live.id)
					: 0;
			if (inFlight) {
				return refused(
					`Refused: ${inFlight} render${inFlight === 1 ? ' is' : 's are'} still in flight. The region step ends once every render has landed; you are told as each one finishes.`,
				);
			}
			const error = await move(ctx, { type: kind }, `${ctx.agent}: ${kind}`);
			if (error) return refused(`Refused: ${error}.`);
			const to = ctx.live.state;
			if (to.status === 'waiting') {
				await insertEvent(
					ctx.tx,
					ctx.live.id,
					ctx.agent,
					'checkpoint_open',
					{ checkpoint: to.waitingOn, step: from.step, summary: str(input, 'summary') },
					id,
				);
				return ok({ checkpoint: to.waitingOn, note: 'The owner reviews it now. End your turn.' });
			}
			return ok({ step: to.step, note: 'No checkpoint is set here; the run moved on.' });
		}
		case 'run.submit_repair': {
			const from = ctx.live.state;
			if (from.kind !== 'repair') return refused('Refused: this is not a repair run.');
			const claimed = submissionOf(input);
			if (typeof claimed === 'string') return refused(`Refused: ${claimed}`);
			const plays = await playsOfStep(ctx.tx, ctx.live.id, from.step);
			const why = checkSubmission(claimed, {
				step: from.step,
				fixWrites: await completedWrites(ctx.tx, ctx.live.id, REPAIR_ASSIGNABLE),
				plays,
			});
			if (why) return refused(`Refused: ${why}`);
			// What was played is what the plays settled as, never the doctor's claim.
			const submission = { ...claimed, verified: derivedVerified(plays) };
			const error = await move(ctx, { type: 'conclude' }, `${ctx.agent}: ${submission.outcome}`);
			if (error) return refused(`Refused: ${error}.`);
			await activity(ctx, id, { type: 'repair_submitted', step: from.step, ...submission });
			await insertEvent(
				ctx.tx,
				ctx.live.id,
				ctx.agent,
				'checkpoint_open',
				{
					checkpoint: 'repair_review',
					step: from.step,
					outcome: submission.outcome,
					summary: submission.summary,
				},
				id,
			);
			return ok({ checkpoint: 'repair_review', note: 'The owner reviews it now. End your turn.' });
		}
		case 'run.set_recipe': {
			if (!ctx.recipes) return refused('The blueprint catalogue could not be read. Try again.');
			const outcome = await setRecipe(
				ctx.tx,
				ctx.live,
				ctx.agent,
				input as unknown as RecipeInput,
				ctx.recipes,
			);
			return outcome.ok ? ok(outcome.value) : refused(outcome.message);
		}
		case 'run.assign_task': {
			const agent = str(input, 'agent');
			if (LEADS.includes(agent) || agent === ctx.agent) return refused('Assign to another agent.');
			if (ctx.live.state.kind === 'repair' && !REPAIR_ASSIGNABLE.includes(agent)) {
				return refused(
					`Refused: ${ART_NOT_REPAIRED}. In a repair run only ${REPAIR_ASSIGNABLE.join(' and ')} take tasks.`,
				);
			}
			if (agent === ANALYST_AGENT) {
				return refused(
					'Refused: the mockup analyst is not assigned. The worker runs the mockup breakdown itself when the run has mockups.',
				);
			}
			const missing = ctx.missingTools(agent);
			if (missing.length) {
				return refused(
					`${agent} cannot start: the platform does not serve ${missing.join(', ')} yet. Tell the owner.`,
				);
			}
			const task: BetaContentBlockParam[] = [
				{ type: 'text', text: `Task from ${ctx.agent}:\n\n${str(input, 'task')}` },
			];
			if (agent === TECHNICIAN) {
				task.push({ type: 'text', text: await defaultsBrief(ctx.tx, ctx.live) });
			}
			await appendMessage(ctx.tx, ctx.live.id, agent, 'user', task);
			await activity(ctx, id, { type: 'assignment', to: agent, task: str(input, 'task') });
			return ok({ assigned: agent });
		}
	}
}
