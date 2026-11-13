import {
	LOCKED_CELL_OPEN_SIGNAL,
	LOCKED_CELL_SCOPE_KIND,
	componentTimelinesFor,
	cueHolds,
	emitComponentSignal,
	getComponent,
	stateMachineTimelines,
} from 'engine-layout';
import { scopeOf } from 'utils-event-emitter';
import { roundSkip } from 'utils-shared/skipToken';

/**
 * A COMPONENT OPENING of an expanding board's locked row (Game Config `openStyle: 'component'`): the
 * locked cells' component (the Locked Row's `lockedComponent`) plays its `open` on the row's cells,
 * and the beat waits for it. Waited for by what the component authors — a timeline on `open` that
 * holds the cue is observed to its end; failing that, the longest timeline it plays on `open`, or in
 * a state machine state named `open`, is measured — and never longer than
 * {@link LOCKED_OPEN_CAP_MS}, so a component with no `open` cannot hang the round.
 */

/** The longest a row's `open` is waited for. */
export const LOCKED_OPEN_CAP_MS = 4000;

/** How long `componentId`'s `open` runs, measured off its timelines (ms); 0 ⇒ it has none. */
export const lockedOpenMs = (componentId: string): number => {
	const onOpen = componentTimelinesFor(componentId)
		.filter((doc) => doc.playOn === LOCKED_CELL_OPEN_SIGNAL)
		.map((doc) => Math.max(doc.duration || 0, 0));
	const machine = getComponent(componentId)?.stateMachine;
	const { durations } = stateMachineTimelines(machine);
	const inOpenState = (machine?.layers ?? []).flatMap((layer) =>
		layer.disabled
			? []
			: layer.states
					.filter((s) => s.id === LOCKED_CELL_OPEN_SIGNAL || s.name === LOCKED_CELL_OPEN_SIGNAL)
					.map((s) => (durations.get(s.timeline) ?? 0) / (s.speed && s.speed > 0 ? s.speed : 1)),
	);
	return Math.max(0, ...onOpen, ...inOpenState) * 1000;
};

/** Play `open` on every locked cell of data row `row` (drawn as `componentId`) and wait for it. */
export const playLockedRowOpen = async (row: number, componentId: string): Promise<void> => {
	const before = new Set(cueHolds(LOCKED_CELL_OPEN_SIGNAL));
	emitComponentSignal(LOCKED_CELL_OPEN_SIGNAL, scopeOf(LOCKED_CELL_SCOPE_KIND, row));
	if (roundSkip.isSkipped()) return;
	// The holds THIS fire opened — a row before it whose hold outlived the cap must not be waited
	// for again.
	const held = cueHolds(LOCKED_CELL_OPEN_SIGNAL).filter((hold) => !before.has(hold));
	const done = held.length
		? roundSkip.race(Promise.all(held))
		: roundSkip.wait(Math.min(lockedOpenMs(componentId), LOCKED_OPEN_CAP_MS));
	await Promise.race([done, roundSkip.wait(LOCKED_OPEN_CAP_MS)]);
};
