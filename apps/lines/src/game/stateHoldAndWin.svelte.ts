import { applyHoldAndWinEvent, emptyHoldAndWinState, type HoldAndWinEvent } from 'engine-game';

/**
 * The client's picture of a Hold and Win feature and the persistent meters — what the respin board,
 * the counter and the pots read. Written ONLY by {@link recordHoldAndWinEvent}, from the book events
 * the server sent; a game that never receives one keeps the empty state forever.
 */
export const stateHoldAndWin = $state(emptyHoldAndWinState());

export const recordHoldAndWinEvent = (event: HoldAndWinEvent) => {
	Object.assign(stateHoldAndWin, applyHoldAndWinEvent($state.snapshot(stateHoldAndWin), event));
};
