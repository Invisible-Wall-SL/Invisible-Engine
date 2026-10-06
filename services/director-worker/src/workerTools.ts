import type { TransactionSql } from 'postgres';
import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { ToolSpec } from './model.ts';
import { transition, type RunEvent } from './runState.ts';
import { appendMessage, applyTransition, insertEvent, runSpend, type LiveRun } from './store.ts';
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

const UNASSIGNABLE: ReadonlySet<string> = new Set(['coordinator', 'mockup-analyst']);

/** The specs, in a fixed order. `agentNames` fills `run.assign_task`'s enum. */
export function workerToolSpecs(agentNames: readonly string[]): Record<WorkerToolId, ToolSpec> {
	// The mockup analyst is run by the worker's own code, never as an assigned turn.
	const assignable = agentNames.filter((name) => !UNASSIGNABLE.has(name)).sort();
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
		'costs.get_run_spend': {
			id: 'costs.get_run_spend',
			description: "The run's spend so far, by agent, and its budget cap.",
			inputSchema: object({}, []),
		},
	};
}

type Input = Record<string, unknown>;
const str = (input: Input, key: string) => String(input[key] ?? '');

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
		case 'run.set_plan':
			await activity(ctx, id, { type: 'plan', summary: input.summary, batches: input.batches });
			return ok({ recorded: true });
		case 'run.post_activity':
			await activity(ctx, id, { type: 'note', text: str(input, 'text') });
			return ok({ posted: true });
		case 'run.ask_owner':
			await activity(ctx, id, { type: 'question', question: str(input, 'question') });
			return ok({ asked: true, note: 'The answer arrives as an owner message in a later turn.' });
		case 'run.request_pipeline_change':
			await activity(ctx, id, {
				type: 'pipeline_change_request',
				what: str(input, 'what'),
				reason: str(input, 'reason'),
			});
			return ok({ requested: true });
		case 'run.submit_review':
		case 'run.submit_qa':
			await activity(ctx, id, {
				type: id.slice('run.submit_'.length),
				summary: input.summary,
				findings: input.findings,
			});
			return ok({ submitted: true });
		case 'run.request_checkpoint': {
			const kind = input.kind === 'batch_done' ? 'batch_done' : 'step_done';
			const from = ctx.live.state;
			if (kind === 'step_done' && from.step === 'breakdown' && ctx.hasMockups) {
				return refused(
					'Refused: this run has mockups, so the worker produces the mockup breakdown itself and opens its checkpoint. You will be told the result.',
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
		case 'run.assign_task': {
			const agent = str(input, 'agent');
			if (agent === 'coordinator' || agent === ctx.agent)
				return refused('Assign to another agent.');
			if (agent === 'mockup-analyst') {
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
			await appendMessage(ctx.tx, ctx.live.id, agent, 'user', task);
			await activity(ctx, id, { type: 'assignment', to: agent, task: str(input, 'task') });
			return ok({ assigned: agent });
		}
	}
}
