import {
	applyHoldAndWinEvent,
	drainMeters,
	emptyHoldAndWinState,
	type HoldAndWinEvent,
	type HoldAndWinMeterLevel,
} from 'engine-game';

import { modifierLineText } from './holdAndWinText';

/**
 * The client's picture of a Hold and Win feature and the persistent meters — what the respin board,
 * the counter and the pots read. Written ONLY by {@link recordHoldAndWinEvent}, from the book events
 * the server sent; a game that never receives one keeps the empty state forever.
 */
export const stateHoldAndWin = $state(emptyHoldAndWinState());

/** The meters as they stood before the last recorded event — the level a pot was showing when an
 *  update arrived, which the update itself cannot say (a capped level hides how many fitted). */
let metersBefore: HoldAndWinMeterLevel[] = [];

export const meterLevelBefore = (id: string): number | undefined =>
	metersBefore.find((meter) => meter.id === id)?.level;

export const recordHoldAndWinEvent = (event: HoldAndWinEvent) => {
	const before = $state.snapshot(stateHoldAndWin);
	metersBefore = before.meters;
	Object.assign(stateHoldAndWin, applyHoldAndWinEvent(before, event));
};

/** A mode a full pot started emptied those pots (`drainedMeters`) — Hold and Win's own trigger
 *  does it in its reducer. The drain beat runs from each pot's maximum, as Hold and Win's does. */
export const drainHoldAndWinMeters = (ids: readonly string[]) => {
	if (ids.length === 0) return;
	stateHoldAndWin.meters = drainMeters($state.snapshot(stateHoldAndWin.meters), ids);
};

/**
 * What the board SHOWS of the feature where a beat must reveal it first: the collector level the
 * wheel raised is recorded at the play seam before the wheel even spins, so the wheel's beat pins
 * the old level here until its prize is announced (`presentWheel`). Null ⇒ show the recorded one.
 */
export const stateHoldAndWinShown = $state({ collectorLevel: null as number | null });

/** The collector level the board shows — a beat's pinned value, else the recorded one. */
export const shownCollectorLevel = (): number =>
	stateHoldAndWinShown.collectorLevel ?? stateHoldAndWin.collectorLevel;

/**
 * The modifiers active in the feature as one line ("PAYER · MULTIPLIER"), with a raised collector
 * named by its level ("DOUBLE COLLECTOR") — what the coded counter's second line shows and the
 * `activeModifiers` value source carries.
 */
export const activeModifiersText = (): string =>
	modifierLineText(stateHoldAndWin.activeModifiers, shownCollectorLevel());
