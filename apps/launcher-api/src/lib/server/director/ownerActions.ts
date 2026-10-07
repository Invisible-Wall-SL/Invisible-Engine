import { clampDirectorBudget } from 'director-costs';
import type { StepInput } from 'director-costs/recipe';
import type { DirectorRun } from '../db/schema';
import {
	checkpointSettings,
	transition,
	type Checkpoint,
	type RunEvent,
	type RunState,
} from '../../../../../../services/director-worker/src/runState';

/**
 * The owner's actions on a run (ADR-0003 "Owner actions"), as the rows the launcher appends to
 * `director_events` and the worker consumes (`driver.ts` `applyEvent`): `owner_request` for start /
 * pause / resume / stop, `checkpoint_resolved` for approve / revise, `owner_message` for a message
 * to the coordinator. The page never moves a run itself.
 *
 * Whether an action is allowed is asked of the worker's OWN state machine (`runState.ts`
 * `transition`, imported from the worker's source, the way `pricing.json` is), so the launcher
 * refuses up front exactly what the worker would refuse with an error event — and nothing else. A
 * message has no transition: it is allowed while the run is live.
 */

export const OWNER_ACTIONS = [
	'start',
	'pause',
	'resume',
	'stop',
	'approve',
	'revise',
	'message',
] as const;
export type OwnerAction = (typeof OWNER_ACTIONS)[number];
export const isOwnerAction = (value: unknown): value is OwnerAction =>
	typeof value === 'string' && (OWNER_ACTIONS as readonly string[]).includes(value);

/** A client-supplied id per write, replayed to the same answer. */
export const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
export const MAX_NOTE_LENGTH = 4000;
export const MAX_MESSAGE_LENGTH = 4000;

/** Statuses a message to the coordinator can reach: the run is live and someone will read it. */
const MESSAGE_STATUSES: readonly RunState['status'][] = ['running', 'waiting', 'paused'];

export interface Stamp {
	uid: string;
	name: string;
}

export interface OwnerActionRequest {
	action: OwnerAction;
	requestId: string;
	/** approve / revise: the checkpoint being resolved. Defaults to the open one. */
	checkpoint?: Checkpoint;
	/** approve / revise: the owner's note to the coordinator. */
	note?: string;
	/** message: the text. */
	text?: string;
	/** resume: the cap raised to this, within Settings' bounds; never lowered. */
	budgetCapUsd?: number;
	/** approve `art_plan`: the revision of every recipe the owner saw, by region. The worker
	 *  refuses the approval when any differs, so a changed plan never runs on it. */
	recipeRevs?: Record<string, number>;
	/** revise `art_plan`: the owner's edited chains, each region's steps whole with the revision it
	 *  was edited on, for the worker to validate and store as the next revisions (ADR-0008 §5). */
	recipeEdits?: { region: string; rev: number; steps: StepInput[] }[];
}

/** The state-machine view of a stored run, as the worker reads it (`lease.ts` `toClaimed`). */
export function runStateOf(
	run: Pick<DirectorRun, 'status' | 'step' | 'waitingOn' | 'checkpointsJson'>,
): RunState {
	return {
		status: run.status,
		step: run.step,
		waitingOn: run.waitingOn,
		checkpoints: checkpointSettings(run.checkpointsJson),
	};
}

/** The event an action asks the worker to apply; null for a message, which moves nothing. */
export function runEventOf(action: OwnerAction, checkpoint: Checkpoint | null): RunEvent | null {
	switch (action) {
		case 'start':
			return { type: 'start' };
		case 'pause':
			return { type: 'pause', reason: 'owner' };
		case 'resume':
			return { type: 'resume' };
		case 'stop':
			return { type: 'stop' };
		case 'approve':
		case 'revise':
			// Without an open checkpoint the worker refuses `resolve` whatever is named; `breakdown`
			// is only a placeholder so the refusal is the machine's, not a missing argument.
			return { type: 'resolve', checkpoint: checkpoint ?? 'breakdown', decision: action };
		case 'message':
			return null;
	}
}

/** Why `action` may not be sent to a run in `state`, or null when it may. */
export function actionRefusal(
	state: RunState,
	action: OwnerAction,
	checkpoint: Checkpoint | null = state.waitingOn,
): string | null {
	if (action === 'message') {
		return MESSAGE_STATUSES.includes(state.status)
			? null
			: `a message cannot reach a ${state.status} run`;
	}
	const result = transition(state, runEventOf(action, checkpoint)!);
	return result.ok ? null : result.error;
}

/** The actions the owner may take now, for the page's buttons. */
export function allowedOwnerActions(state: RunState): OwnerAction[] {
	return OWNER_ACTIONS.filter((action) => actionRefusal(state, action) === null);
}

/**
 * The cap a resume may set: the requested figure clamped to Settings' bounds, or null when it
 * would not raise the run's current cap (the worker never lowers a cap on resume either).
 */
export function raisedCap(currentUsd: number | null, requested: number): number | null {
	const clamped = clampDirectorBudget(requested);
	if (clamped === null) return null;
	return currentUsd === null || clamped > currentUsd ? clamped : null;
}

export interface OwnerEventRow {
	kind: 'owner_request' | 'owner_message' | 'checkpoint_resolved';
	payload: Record<string, unknown>;
}

/** The one `director_events` row an action appends, carrying what the worker reads. */
export function ownerEventRow(req: OwnerActionRequest, by: Stamp): OwnerEventRow {
	const base = { requestId: req.requestId, by };
	switch (req.action) {
		case 'start':
		case 'pause':
		case 'stop':
			return { kind: 'owner_request', payload: { ...base, action: req.action } };
		case 'resume':
			return {
				kind: 'owner_request',
				payload: {
					...base,
					action: 'resume',
					...(req.budgetCapUsd === undefined ? {} : { budgetCapUsd: req.budgetCapUsd }),
				},
			};
		case 'message':
			return { kind: 'owner_message', payload: { ...base, text: req.text ?? '' } };
		case 'approve':
		case 'revise':
			return {
				kind: 'checkpoint_resolved',
				payload: {
					...base,
					checkpoint: req.checkpoint,
					decision: req.action,
					...(req.note ? { note: req.note } : {}),
					...(req.recipeRevs ? { recipeRevs: req.recipeRevs } : {}),
					...(req.recipeEdits ? { recipeEdits: req.recipeEdits } : {}),
				},
			};
	}
}
