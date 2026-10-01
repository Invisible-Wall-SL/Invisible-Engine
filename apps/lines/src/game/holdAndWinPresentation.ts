import type { HoldAndWinEvent } from 'engine-game';
import { roundSkip } from 'utils-shared/skipToken';

import { eventEmitter } from './eventEmitter';
import { playSymbolLandSound } from './soundBindings';
import {
	armHeldBeat,
	hideRespinBoard,
	settleHeldLand,
	showRespinBoard,
	spinRespinCells,
	startHeldLand,
	stateRespinBoard,
	syncHeldCells,
} from './stateRespinBoard.svelte';
import { awaitSymbolBeat, TRANSIT_BEAT_CAP_MS } from './symbolBeat';
import { waitPresentation } from './unskippablePresentation';

/**
 * THE HOLD AND WIN BEATS the respin board presents (design §4.2 / Phase 4c) — ONE function per beat,
 * called by both drivers: the coded `bookEventHandlerMap` handler and the flow's effect of the same
 * beat (`flowEffects.ts`), so the two cannot disagree about what a beat does.
 *
 * A beat never RECORDS its event: the play seam has already folded it into `stateHoldAndWin`
 * (`createPlayBook`'s `recordBookEvent`) before any path presents it, so the coded handler and a
 * flow that owns the event read the same picture, and nothing applies twice.
 *
 * SLAM: every state change happens BEFORE any wait, and every wait goes through the slam token, so
 * a slam compresses the beat and never skips what it changes. The respin's own roll is the one wait
 * that is not raced — it settles on its own, faster when slammed (`createRespinBoard.spin`).
 *
 * The coded defaults are deliberately plain (a short hold, the counter's pulse): Phases 5–7 author
 * the beats, and the flights (§4.4) carry the coins somewhere at the end.
 */

type Beat<K extends HoldAndWinEvent['type']> = Extract<HoldAndWinEvent, { type: K }>;

/** The swap settles before the first respin rolls. */
const TRIGGER_HOLD_MS = 500;
/** The pause between two respins that changed nothing, so the board reads between rolls. */
const RESPIN_PAUSE_MS = 250;
/** How long the counter holds on its reset pulse — the beat that tells the player "back to 3". */
const RESET_BEAT_MS = 600;
/** The final board stays up this long before the reel board comes back. */
const END_HOLD_MS = 900;

const updateCounter = ({ left, start }: { left: number; start: number }) => {
	stateRespinBoard.counter.left = left;
	stateRespinBoard.counter.start = start;
};

/**
 * `holdAndWinTrigger` — the board swaps to the respin board with the triggering coins held exactly
 * where they landed, and the counter shows the respins awarded.
 */
export const presentHoldAndWinTrigger = async (event: Beat<'holdAndWinTrigger'>) => {
	showRespinBoard({ seedFromBaseBoard: true });
	updateCounter({ left: event.payload.respins, start: event.payload.respins });
	stateRespinBoard.counter.show = true;
	eventEmitter.broadcast({ type: 'respinBoardShow' });
	await waitPresentation(TRIGGER_HOLD_MS);
};

/** `respinReveal` — every free cell spins and lands on the symbol the server names for it. */
export const presentRespinReveal = async (event: Beat<'respinReveal'>) => {
	// A respin with no board up (a book that skipped its trigger) still has to land somewhere.
	if (!stateRespinBoard.shown) showRespinBoard({ seedFromBaseBoard: false });
	eventEmitter.broadcast({ type: 'respinBoardSpin', cells: event.cells });
	await spinRespinCells(event.cells);
};

/** `coinsLand` — the cells that landed stick: they move into the held layer and play `land`. */
export const presentCoinsLand = async (event: Beat<'coinsLand'>) => {
	syncHeldCells();
	const keys = startHeldLand(event.cells);
	event.cells.forEach((cell) => playSymbolLandSound(cell.symbol.name, 1));
	eventEmitter.broadcast({ type: 'respinCoinsLand', cells: event.cells });
	await roundSkip.race(
		Promise.all(
			keys.map((key) =>
				awaitSymbolBeat((resolve) => armHeldBeat(key, resolve), TRANSIT_BEAT_CAP_MS),
			),
		),
	);
	settleHeldLand();
};

/**
 * `respinUpdate` — the counter moves. A RESET is its own visible beat (the counter pulses and
 * holds); a plain decrement is a short pause so consecutive empty respins do not run together.
 */
export const presentRespinUpdate = async (event: Beat<'respinUpdate'>) => {
	updateCounter(event);
	if (event.reset) stateRespinBoard.counter.resets += 1;
	eventEmitter.broadcast({
		type: 'respinCounterUpdate',
		left: event.left,
		start: event.start,
		reset: event.reset,
	});
	await waitPresentation(event.reset ? RESET_BEAT_MS : RESPIN_PAUSE_MS);
};

/**
 * `holdAndWinState` — the server's whole picture of the open feature. Enough on its own to put the
 * board up from nothing (a resume replays only this), with no intro: the held layer and the counter
 * are rebuilt from it and every free cell is blank. On a board that is already up it is the
 * self-correction point — the held layer is re-synced, so a misread step lasts one respin at most.
 */
export const presentHoldAndWinState = async (event: Beat<'holdAndWinState'>) => {
	const opening = !stateRespinBoard.shown;
	showRespinBoard({ seedFromBaseBoard: false });
	updateCounter(event.snapshot);
	stateRespinBoard.counter.show = true;
	if (opening) eventEmitter.broadcast({ type: 'respinBoardShow' });
};

/**
 * Every Hold and Win event whose beat is not presented yet (the specials, jackpots, meters, column
 * letters — the next PRs): the held layer follows the recorded picture at once, so a value a payer
 * raised, a mystery that became a coin or a streak's cleared cells read right on the board even
 * before their beat has an animation.
 */
export const syncHoldAndWin = async () => {
	if (stateRespinBoard.shown) syncHeldCells();
};

/**
 * `holdAndWinEnd` — the final board holds for a moment, then the reel board comes back. The tally
 * (`payload.cells`) and the total are the next PRs' beats (flights into the total, count-up); the
 * round's own `setWin` / `setTotalWin` that follow present the money as for any other win.
 */
export const presentHoldAndWinEnd = async (event: Beat<'holdAndWinEnd'>) => {
	if (!stateRespinBoard.shown) return;
	await waitPresentation(END_HOLD_MS);
	hideRespinBoard();
	eventEmitter.broadcast({ type: 'respinBoardHide' });
};
