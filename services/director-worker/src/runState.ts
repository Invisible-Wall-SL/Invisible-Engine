/**
 * The Director run state machine (ADR-0003), as a pure function. The worker is the only writer of a
 * run's status; it asks `transition` first and persists only what comes back.
 *
 * ```
 * draft ─start→ running ─(gated step / batch done)→ waiting ─owner approve|revise→ running
 * running ─owner pause / budget cap→ paused ─resume→ running
 * any live ─stop→ stopping ─(in-flight GPU jobs cancelled)→ stopped
 * build done → waiting(before_publish, always) ─approve→ handed_off
 * ```
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

export const RUN_STEPS = ['breakdown', 'style_pack', 'regions', 'build', 'handoff'] as const;
export type RunStep = (typeof RUN_STEPS)[number];

/** `breakdown` is the mockup breakdown, or the style board when the run has no mockups. */
export const CHECKPOINTS = ['breakdown', 'region_batch', 'before_publish'] as const;
export type Checkpoint = (typeof CHECKPOINTS)[number];

export const TERMINAL_STATUSES: readonly RunStatus[] = ['stopped', 'failed', 'handed_off'];

/** The owner's checkpoint settings as the run carries them (`director_runs.checkpoints_json`). */
export interface CheckpointSettings {
	breakdown: boolean;
	regionBatch: boolean;
	/** Always true: `checkpointSettings` sets it whatever the stored JSON says. */
	beforePublish: true;
}

/** Read stored settings. Unknown or missing optional checkpoints default ON (SPEC §1.1). */
export function checkpointSettings(raw: unknown): CheckpointSettings {
	const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
	return {
		breakdown: record.breakdown !== false,
		regionBatch: record.regionBatch !== false,
		beforePublish: true,
	};
}

export interface RunState {
	status: RunStatus;
	step: RunStep;
	/** The open checkpoint while `waiting`; null in every other status. */
	waitingOn: Checkpoint | null;
	checkpoints: CheckpointSettings;
}

export type RunEvent =
	/** The owner's start request on a draft. */
	| { type: 'start' }
	/** The current step's work is finished (breakdown, style_pack, regions or build). */
	| { type: 'step_done' }
	/** One batch of regions is drafted and reviewed (only in `regions`). */
	| { type: 'batch_done' }
	/** The owner resolves the open checkpoint. `revise` sends the step back to work. */
	| { type: 'resolve'; checkpoint: Checkpoint; decision: 'approve' | 'revise' }
	| { type: 'pause'; reason: 'owner' | 'budget_cap' }
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

/** Where finishing `step` leads: the next step, or the checkpoint that gates it. */
function afterStep(state: RunState): RunState {
	switch (state.step) {
		case 'breakdown':
			return state.checkpoints.breakdown
				? waiting(state, 'breakdown')
				: running(state, 'style_pack');
		case 'style_pack':
			return running(state, 'regions');
		case 'regions':
			return running(state, 'build');
		case 'build':
		case 'handoff':
			return waiting(state, 'before_publish', 'handoff');
	}
}

/** Where approving `checkpoint` leads. */
function afterApproval(state: RunState, checkpoint: Checkpoint): RunState {
	switch (checkpoint) {
		case 'breakdown':
			return running(state, 'style_pack');
		case 'region_batch':
			return running(state, 'regions');
		case 'before_publish':
			return { ...state, status: 'handed_off', step: 'handoff', waitingOn: null };
	}
}

/** The step a `revise` decision sends the run back to. */
const reviseStep: Record<Checkpoint, RunStep> = {
	breakdown: 'breakdown',
	region_batch: 'regions',
	before_publish: 'build',
};

export function transition(state: RunState, event: RunEvent): TransitionResult {
	if (TERMINAL_STATUSES.includes(state.status)) return illegal(state, event, 'the run has ended');

	switch (event.type) {
		case 'start':
			return state.status === 'draft' ? ok(running(state)) : illegal(state, event);

		case 'step_done':
			if (state.status !== 'running') return illegal(state, event);
			if (state.step === 'handoff') return illegal(state, event, 'hand-off has no work');
			return ok(afterStep(state));

		case 'batch_done':
			if (state.status !== 'running' || state.step !== 'regions') return illegal(state, event);
			return ok(state.checkpoints.regionBatch ? waiting(state, 'region_batch') : state);

		case 'resolve':
			if (state.status !== 'waiting') return illegal(state, event);
			if (event.checkpoint !== state.waitingOn) {
				return illegal(state, event, `the open checkpoint is ${state.waitingOn}`);
			}
			return ok(
				event.decision === 'approve'
					? afterApproval(state, event.checkpoint)
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
