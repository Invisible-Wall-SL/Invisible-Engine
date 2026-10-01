import {
	applyHoldAndWinEvent,
	emptyHoldAndWinState,
	type HoldAndWinEvent,
	type HoldAndWinMeterLevel,
} from 'engine-game';

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
