/**
 * The Director run state machine (ADR-0003), as a pure function. The worker is the only writer of a
 * run's status; it asks `transition` first and persists only what comes back.
 *
 * ```
 * draft ─start→ running ─(gated step / batch done)→ waiting ─owner approve|revise→ running
 * running ─owner pause / budget cap / refusal / error→ paused ─resume→ running
 * any live ─stop→ stopping ─(in-flight GPU jobs cancelled)→ stopped
 * build done → waiting(before_publish, always) ─approve→ handed_off
 * style_pack|regions ─plan_ready→ waiting(art_plan, when on) ─approve|revise→ running (same step)
 * ```
 *
 * A repair run (ADR-0012) is the same machine with its own steps and one checkpoint:
 *
 * ```
 * draft ─start→ running(reproduce) ─step_done→ running(fix) ─step_done→ running(verify)
 * running(reproduce|fix|verify) ─conclude→ waiting(repair_review, always) ─approve→ handed_off
 * waiting(repair_review) ─revise→ running(fix)
 * ```
 *
 * `conclude` is the worker's alone, sent when the lead agent submits its repair (`run.submit_repair`);
 * `verify` has no `step_done`, so the only way out of a repair is through the owner's review.
 *
 * Checkpoints are opened BY the machine, never requested into it: finishing a gated step (or a region
 * batch) is what opens one, so there is no event an agent could send to step past it. The breakdown
 * and region-batch checkpoints follow the run's settings; `before_publish` is not a setting — the only
 * way from `build` to `handed_off` is an owner approving it.
 */

export const RUN_STATUSES = [
	'draft',
	'running',
	'waiting',
	'paused',
	'stopping',
	'stopped',
	'failed',
	'handed_off',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** A create run makes a project from a template; a repair run fixes one game bug in its own
 *  project (ADR-0012). `director_runs.kind`, default `create`. */
export const RUN_KINDS = ['create', 'repair'] as const;
export type RunKind = (typeof RUN_KINDS)[number];

/** How a repair run ended (`director_runs.repair_outcome`), null until hand-off. */
export const REPAIR_OUTCOMES = ['fixed', 'escalated', 'needs_person', 'not_reproduced'] as const;
export type RepairOutcome = (typeof REPAIR_OUTCOMES)[number];

export const CREATE_STEPS = ['breakdown', 'style_pack', 'regions', 'build'] as const;
export const REPAIR_STEPS = ['reproduce', 'fix', 'verify'] as const;
/** `handoff` is shared: both kinds end in it. */
export const RUN_STEPS = [...CREATE_STEPS, ...REPAIR_STEPS, 'handoff'] as const;
export type RunStep = (typeof RUN_STEPS)[number];
type CreateStep = (typeof CREATE_STEPS)[number];
type RepairStep = (typeof REPAIR_STEPS)[number];

const isCreateStep = (step: RunStep): step is CreateStep =>
	(CREATE_STEPS as readonly string[]).includes(step);
const isRepairStep = (step: RunStep): step is RepairStep =>
	(REPAIR_STEPS as readonly string[]).includes(step);

/** The step a draft of this kind starts in. */
export const startStep = (kind: RunKind): RunStep =>
	kind === 'repair' ? 'reproduce' : 'breakdown';

/** `breakdown` is the mockup breakdown, or the style board when the run has no mockups.
 *  `art_plan` is the owner's review of the technician's recipes (ADR-0008 §7). `repair_review` is
 *  the owner's review of a repair run's outcome (ADR-0012), always on, the repair run's only one. */
export const CHECKPOINTS = [
	'breakdown',
	'art_plan',
	'region_batch',
	'before_publish',
	'repair_review',
] as const;
export type Checkpoint = (typeof CHECKPOINTS)[number];

export const TERMINAL_STATUSES: readonly RunStatus[] = ['stopped', 'failed', 'handed_off'];

/** The owner's checkpoint settings as the run carries them (`director_runs.checkpoints_json`). */
export interface CheckpointSettings {
	breakdown: boolean;
	regionBatch: boolean;
	/** The Art plan (ADR-0008 §7). Off: the plan is stored and shown, and the worker approves it
	 *  itself once its projection fits the cap. */
	artPlan: boolean;
	/** Always true: `checkpointSettings` sets it whatever the stored JSON says. */
	beforePublish: true;
}

/** Read stored settings. Unknown or missing optional checkpoints default ON (SPEC §1.1). */
export function checkpointSettings(raw: unknown): CheckpointSettings {
	const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
	return {
		breakdown: record.breakdown !== false,
		regionBatch: record.regionBatch !== false,
		artPlan: record.artPlan !== false,
		beforePublish: true,
	};
}

export interface RunState {
	kind: RunKind;
	status: RunStatus;
	step: RunStep;
	/** The open checkpoint while `waiting`; null in every other status. */
	waitingOn: Checkpoint | null;
	checkpoints: CheckpointSettings;
}

export type RunEvent =
	/** The owner's start request on a draft. */
	| { type: 'start' }
	/** The current step's work is finished (breakdown, style_pack, regions or build; in a repair run
	 *  reproduce or fix). */
	| { type: 'step_done' }
	/** One batch of regions is drafted and reviewed (only in `regions`). */
	| { type: 'batch_done' }
	/** Every region the plan names has a stored recipe that is not approved yet (worker code only,
	 *  ADR-0008 §7). `ownerOnly`: what waits is a step past its retries, which only the owner
	 *  approves again, so the Art plan opens whatever its setting. */
	| { type: 'plan_ready'; ownerOnly?: boolean }
	/** A repair run's lead agent has submitted its outcome (worker code only, `run.submit_repair`). */
	| { type: 'conclude' }
	/** The owner resolves the open checkpoint. `revise` sends the step back to work. */
	| { type: 'resolve'; checkpoint: Checkpoint; decision: 'approve' | 'revise' }
	/** `refusal`: the model's final answer was a refusal; `error`: the worker cannot go on (a
	 *  missing tool, an unpriced model) until someone fixes it. */
	| { type: 'pause'; reason: 'owner' | 'budget_cap' | 'refusal' | 'error' }
	| { type: 'resume' }
	| { type: 'stop' }
	/** Every in-flight GPU job of a stopping run is cancelled. */
	| { type: 'stopped' }
	| { type: 'fail'; reason: string };

export type RunEventType = RunEvent['type'];
export const RUN_EVENT_TYPES: readonly RunEventType[] = [
	'start',
	'step_done',
	'batch_done',
	'plan_ready',
	'conclude',
	'resolve',
	'pause',
	'resume',
	'stop',
	'stopped',
	'fail',
];

export type TransitionResult = { ok: true; state: RunState } | { ok: false; error: string };

const ok = (state: RunState): TransitionResult => ({ ok: true, state });
const illegal = (state: RunState, event: RunEvent, why = ''): TransitionResult => ({
	ok: false,
	error: `${event.type} is not allowed while ${state.status}${state.status === 'waiting' ? ` on ${state.waitingOn}` : ''} (step ${state.step})${why ? `: ${why}` : ''}`,
});

const running = (state: RunState, step: RunStep = state.step): RunState => ({
	...state,
	status: 'running',
	step,
	waitingOn: null,
});
const waiting = (
	state: RunState,
	checkpoint: Checkpoint,
	step: RunStep = state.step,
): RunState => ({
	...state,
	status: 'waiting',
	step,
	waitingOn: checkpoint,
});

/** Where finishing `step` of a create run leads: the next step, or the checkpoint that gates it. */
function afterStep(state: RunState, step: CreateStep): RunState {
	switch (step) {
		case 'breakdown':
			return state.checkpoints.breakdown
				? waiting(state, 'breakdown')
				: running(state, 'style_pack');
		case 'style_pack':
			return running(state, 'regions');
		case 'regions':
			return running(state, 'build');
		case 'build':
			return waiting(state, 'before_publish', 'handoff');
	}
}

/** Where approving `checkpoint` leads. */
function afterApproval(state: RunState, checkpoint: Checkpoint): RunState {
	switch (checkpoint) {
		case 'breakdown':
			return running(state, 'style_pack');
		case 'art_plan':
			return running(state);
		case 'region_batch':
			return running(state, 'regions');
		case 'before_publish':
		case 'repair_review':
			return { ...state, status: 'handed_off', step: 'handoff', waitingOn: null };
	}
}

/** The step a `revise` decision sends the run back to. */
const reviseStep: Record<Exclude<Checkpoint, 'art_plan'>, RunStep> = {
	breakdown: 'breakdown',
	region_batch: 'regions',
	before_publish: 'build',
	repair_review: 'fix',
};

export function transition(state: RunState, event: RunEvent): TransitionResult {
	if (TERMINAL_STATUSES.includes(state.status)) return illegal(state, event, 'the run has ended');

	switch (event.type) {
		case 'start':
			return state.status === 'draft'
				? ok(running(state, startStep(state.kind)))
				: illegal(state, event);

		case 'step_done':
			if (state.status !== 'running') return illegal(state, event);
			if (state.step === 'handoff') return illegal(state, event, 'hand-off has no work');
			if (state.kind === 'repair') {
				if (state.step === 'reproduce') return ok(running(state, 'fix'));
				if (state.step === 'fix') return ok(running(state, 'verify'));
				return illegal(state, event, 'conclude with run.submit_repair');
			}
			if (!isCreateStep(state.step)) return illegal(state, event, 'a repair step');
			return ok(afterStep(state, state.step));

		case 'batch_done':
			if (state.kind !== 'create' || state.status !== 'running' || state.step !== 'regions') {
				return illegal(state, event);
			}
			return ok(state.checkpoints.regionBatch ? waiting(state, 'region_batch') : state);

		case 'plan_ready':
			if (
				state.kind !== 'create' ||
				state.status !== 'running' ||
				(state.step !== 'style_pack' && state.step !== 'regions')
			) {
				return illegal(state, event);
			}
			return ok(state.checkpoints.artPlan || event.ownerOnly ? waiting(state, 'art_plan') : state);

		case 'conclude':
			return state.kind === 'repair' && state.status === 'running' && isRepairStep(state.step)
				? ok(waiting(state, 'repair_review', 'handoff'))
				: illegal(state, event);

		case 'resolve':
			if (state.status !== 'waiting') return illegal(state, event);
			if ((event.checkpoint === 'repair_review') !== (state.kind === 'repair')) {
				return illegal(state, event, `not a checkpoint of a ${state.kind} run`);
			}
			if (event.checkpoint !== state.waitingOn) {
				return illegal(state, event, `the open checkpoint is ${state.waitingOn}`);
			}
			return ok(
				event.decision === 'approve'
					? afterApproval(state, event.checkpoint)
					: event.checkpoint === 'art_plan'
						? running(state)
						: running(state, reviseStep[event.checkpoint]),
			);

		case 'pause':
			return state.status === 'running'
				? ok({ ...state, status: 'paused', waitingOn: null })
				: illegal(state, event);

		case 'resume':
			return state.status === 'paused' ? ok(running(state)) : illegal(state, event);

		case 'stop':
			return state.status === 'stopping'
				? illegal(state, event, 'already stopping')
				: ok({ ...state, status: 'stopping', waitingOn: null });

		case 'stopped':
			return state.status === 'stopping'
				? ok({ ...state, status: 'stopped' })
				: illegal(state, event, 'only a stopping run can finish stopping');

		case 'fail':
			return ok({ ...state, status: 'failed', waitingOn: null });
	}
}
