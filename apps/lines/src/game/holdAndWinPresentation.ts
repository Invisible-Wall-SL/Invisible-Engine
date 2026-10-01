import { cubicOut } from 'svelte/easing';
import type { Tween } from 'svelte/motion';
import {
	countSteps,
	respinCellKey,
	staggerDelays,
	type CountStep,
	type HoldAndWinCell,
	type HoldAndWinCoinChange,
	type HoldAndWinEvent,
	type Position,
	type SymbolState,
} from 'engine-game';
import { showMessage } from 'state-shared';
import { bookEventAmountToCurrencyString } from 'utils-shared/amount';
import { roundSkip } from 'utils-shared/skipToken';

import { eventEmitter } from './eventEmitter';
import { playSymbolLandSound } from './soundBindings';
import {
	armHeldBeat,
	hideRespinBoard,
	holdHeldDisplay,
	releaseHeldDisplay,
	settleHeldBeats,
	showRespinBoard,
	spinRespinCells,
	startHeldBeat,
	stateRespinBoard,
	syncHeldCells,
} from './stateRespinBoard.svelte';
import { awaitSymbolBeat, TRANSIT_BEAT_CAP_MS } from './symbolBeat';
import { waitPresentation } from './unskippablePresentation';

/**
 * THE HOLD AND WIN BEATS the respin board presents (design §4.2 / Phases 4c–4d) — ONE function per
 * beat, called by both drivers: the coded `bookEventHandlerMap` handler and the flow's effect of the
 * same beat (`flowEffects.ts`), so the two cannot disagree about what a beat does.
 *
 * A beat never RECORDS its event: the play seam has already folded it into `stateHoldAndWin`
 * (`createPlayBook`'s `recordBookEvent`) before any path presents it, so the coded handler and a
 * flow that owns the event read the same picture, and nothing applies twice. A value a special
 * changed is therefore ALREADY final in the picture when its beat starts; the beat shows it rising
 * through the held layer's display override (`holdHeldDisplay`), never by writing the picture.
 *
 * SLAM: a slam compresses every wait and every count-up and skips no state change — the held layer
 * still syncs, a mystery still becomes what it revealed, a count still ends on its final value.
 * Every wait goes through the slam token, and every symbol beat is capped. The respin's own roll is
 * the one wait that is not raced — it settles on its own, faster when slammed
 * (`createRespinBoard.spin`).
 *
 * The coded defaults are deliberately plain (a symbol state, a counting label, a toast): Phases 5–7
 * author the beats, and the flights (§4.4) carry the coins somewhere.
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
/** The shortest a highlight (`win` on a held cell) is on screen — a sprite reports at once. */
const HIGHLIGHT_MIN_MS = 400;
/** One coin's label counting from its old value to its new one. */
const COUNT_MS = 600;
/** The gap between two coins starting their count, and the most the whole stagger may span. */
const COUNT_STAGGER_MS = 120;
const COUNT_SPAN_MS = 900;
/** One collected coin's moment: the gap between two coins, the most they may span, the rise. */
const COLLECT_STAGGER_MS = 220;
const COLLECT_SPAN_MS = 1_400;
const COLLECT_COUNT_MS = 350;
/** How long an "UNLOCKED" or a banked jackpot's toast holds the board before the next beat. */
const TOAST_HOLD_MS = 900;

const updateCounter = ({ left, start }: { left: number; start: number }) => {
	stateRespinBoard.counter.left = left;
	stateRespinBoard.counter.start = start;
};

const cellOf = ({ reel, row, symbol }: HoldAndWinCell): HoldAndWinCell => ({ reel, row, symbol });

/**
 * Play `state` on the held cells at these positions and wait for them — capped, raced against the
 * slam, and held at least `minMs` (also slammable) so a sprite that reports at once is still seen.
 * A non-terminal state settles back to `static`; a terminal one (`explosion`, `clearReel`) is left
 * for the sync that follows to replace or remove.
 */
const playHeldBeat = async (
	cells: Position[],
	state: SymbolState,
	{ capMs = TRANSIT_BEAT_CAP_MS, minMs = 0 }: { capMs?: number; minMs?: number } = {},
) => {
	const keys = startHeldBeat(cells, state);
	if (keys.length === 0) return;
	await roundSkip.race(
		Promise.all([
			...keys.map((key) => awaitSymbolBeat((resolve) => armHeldBeat(key, resolve), capMs)),
			roundSkip.wait(minMs),
		]),
	);
	settleHeldBeats(keys);
};

/** Move a counting label to `to` over `durationMs` (at once under a slam), then wait that long. */
const countTo = async (tween: Tween<number>, to: number, durationMs: number) => {
	void tween.set(to, { duration: roundSkip.isSkipped() ? 0 : durationMs, easing: cubicOut });
	await roundSkip.wait(durationMs);
};

type HeldCount = { key: string; change: HoldAndWinCoinChange; tween: Tween<number> };

/**
 * Pin every changed coin's label at its OLD value — called BEFORE the held layer syncs, in the same
 * tick, so no frame ever shows the new value ahead of its count. A jackpot coin's factor is held the
 * same way and steps (`MINI` → `MINI ×2`) when its turn comes rather than counting.
 */
const holdCounts = (changes: HoldAndWinCoinChange[]): HeldCount[] =>
	changes.map((change) => {
		const key = respinCellKey(change.reel, change.row);
		const field = change.jackpot === undefined ? 'value' : 'factor';
		return { key, change, tween: holdHeldDisplay(key, field, change.from) };
	});

/** Count every pinned label up to its new value, staggered; resolves when the last has landed. */
const runCounts = (counts: HeldCount[]) => {
	const delays = staggerDelays(counts.length, COUNT_STAGGER_MS, COUNT_SPAN_MS);
	return Promise.all(
		counts.map(async ({ key, change, tween }, i) => {
			await roundSkip.wait(delays[i]);
			if (change.jackpot === undefined) await countTo(tween, change.to, COUNT_MS);
			else await roundSkip.wait(COUNT_MS / 2);
			releaseHeldDisplay(key, tween);
		}),
	);
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
	event.cells.forEach((cell) => playSymbolLandSound(cell.symbol.name, 1));
	eventEmitter.broadcast({ type: 'respinCoinsLand', cells: event.cells });
	await playHeldBeat(event.cells, 'land');
};

/**
 * `coinPay` — a PAYER applies: it plays `win` where it stands, then every cash coin's label counts
 * up from `from` to `to` (staggered), so the player watches the value rise.
 */
export const presentCoinPay = async (event: Beat<'coinPay'>) => {
	if (!stateRespinBoard.shown) return;
	const counts = holdCounts(event.cells);
	syncHeldCells();
	eventEmitter.broadcast({
		type: 'respinCoinPay',
		payer: cellOf(event.payer),
		value: event.value,
		cells: event.cells,
	});
	await playHeldBeat([event.payer], 'win', { minMs: HIGHLIGHT_MIN_MS });
	await runCounts(counts);
};

/**
 * `coinBoost` — a MULTIPLIER applies (`source: 'special'`, the booster plays `win` first) or the
 * pre-feature wheel's boost does (`'wheel'`, no cell of its own): every coin's label counts up from
 * `from` to `to`, and a jackpot coin's factor steps (`MINI` → `MINI ×2`).
 */
export const presentCoinBoost = async (event: Beat<'coinBoost'>) => {
	if (!stateRespinBoard.shown) return;
	const counts = holdCounts(event.cells);
	syncHeldCells();
	eventEmitter.broadcast({
		type: 'respinCoinBoost',
		source: event.source,
		booster: event.booster && cellOf(event.booster),
		multiplier: event.multiplier,
		cells: event.cells,
	});
	if (event.booster) await playHeldBeat([event.booster], 'win', { minMs: HIGHLIGHT_MIN_MS });
	await runCounts(counts);
};

/** `specialBecomesCoin` — a multiplier that has applied turns into a coin: it lands as one. */
export const presentSpecialBecomesCoin = async (event: Beat<'specialBecomesCoin'>) => {
	if (!stateRespinBoard.shown) return;
	syncHeldCells();
	playSymbolLandSound(event.symbol.name, 1);
	eventEmitter.broadcast({
		type: 'respinSpecialBecomesCoin',
		cell: cellOf(event),
		from: event.from,
	});
	await playHeldBeat([event], 'land');
};

/**
 * ONE coin's moment of a collect — THE SEAM A FLIGHT REPLACES. Today the coin pulses (`win`) where
 * it stands and the collector's label rises by that coin's share (`step`). When `flyTo` ships
 * (design §4.4), this is the one function that changes: the coin's head travels to the collector and
 * the rise lands on its `flightArrive`. Never lowers the label, so steps that finish out of order
 * still read as one climb.
 */
export const presentCollectStep = async ({
	cell,
	collector,
	step,
	collectorLabel,
	index,
}: {
	cell: HoldAndWinCell;
	collector: HoldAndWinCell;
	step: CountStep;
	collectorLabel: Tween<number>;
	index: number;
}) => {
	eventEmitter.broadcast({
		type: 'respinCollectStep',
		cell: cellOf(cell),
		collector: cellOf(collector),
		index,
	});
	await playHeldBeat([cell], 'win', { minMs: HIGHLIGHT_MIN_MS });
	if (step.to > collectorLabel.target) await countTo(collectorLabel, step.to, COLLECT_COUNT_MS);
};

/**
 * `coinCollect` — a COLLECTOR takes the coins: each one's moment ({@link presentCollectStep}) runs
 * in turn (staggered), and the collector's label climbs from what it showed to its new `value`. A
 * streak's coins then leave the board on the `cellsCleared` that follows.
 */
export const presentCoinCollect = async (event: Beat<'coinCollect'>) => {
	if (!stateRespinBoard.shown) return;
	const key = respinCellKey(event.collector.reel, event.collector.row);
	const shown = stateRespinBoard.held.find(
		(cell) => cell.reel === event.collector.reel && cell.row === event.collector.row,
	);
	const from = Math.min(shown?.symbol.value ?? 0, event.value);
	const collectorLabel = holdHeldDisplay(key, 'value', from);
	syncHeldCells();
	eventEmitter.broadcast({
		type: 'respinCoinCollect',
		collector: cellOf(event.collector),
		level: event.level,
		cells: event.cells,
		value: event.value,
	});
	const steps = countSteps(
		from,
		event.value,
		event.cells.map((cell) => cell.amount),
	);
	const delays = staggerDelays(steps.length, COLLECT_STAGGER_MS, COLLECT_SPAN_MS);
	await Promise.all(
		steps.map(async (step, index) => {
			await roundSkip.wait(delays[index]);
			await presentCollectStep({
				cell: event.cells[index],
				collector: event.collector,
				step,
				collectorLabel,
				index,
			});
		}),
	);
	releaseHeldDisplay(key, collectorLabel);
};

/** The coded name of a special kind in the "UNLOCKED" toast. */
const SPECIAL_NAMES: Record<string, string> = {
	collector: 'COLLECTOR',
	multiplier: 'MULTIPLIER',
	payer: 'PAYER',
	mystery: 'MYSTERY',
};

/**
 * `mysteryReveal` — each mystery opens (`explosion`, where it stands), then becomes what it revealed
 * (a coin with its value, a jackpot, a special) and lands as it. A reveal that UNLOCKS a modifier
 * not active at entry says so ("UNLOCKED: PAYER") and broadcasts `respinModifierUnlock`. A revealed
 * special applies at its own place in the order, through the events that follow.
 */
export const presentMysteryReveal = async (event: Beat<'mysteryReveal'>) => {
	if (!stateRespinBoard.shown) return;
	eventEmitter.broadcast({
		type: 'respinMysteryReveal',
		cells: event.cells,
		activates: event.activates,
	});
	await playHeldBeat(event.cells, 'explosion');
	syncHeldCells();
	event.cells.forEach((cell) => playSymbolLandSound(cell.symbol.name, 1));
	await playHeldBeat(event.cells, 'land');
	if (event.activates.length === 0) return;
	showMessage(
		`UNLOCKED: ${event.activates.map((kind) => SPECIAL_NAMES[kind] ?? kind.toUpperCase()).join(', ')}`,
		{ kind: 'info' },
	);
	eventEmitter.broadcast({ type: 'respinModifierUnlock', activates: event.activates });
	await waitPresentation(TOAST_HOLD_MS);
};

/** `cellsCleared` — a streak's collected cells leave the board: each plays `clearReel`, then goes. */
export const presentCellsCleared = async (event: Beat<'cellsCleared'>) => {
	if (!stateRespinBoard.shown) return;
	eventEmitter.broadcast({ type: 'respinCellsCleared', cells: event.cells });
	await playHeldBeat(event.cells, 'clearReel');
	syncHeldCells();
	settleHeldBeats(
		event.cells.map((cell) => respinCellKey(cell.reel, cell.row)),
		{ terminal: true },
	);
};

/**
 * `jackpotWin` — presentation only (the money is already counted elsewhere, wire doc "Money"): a
 * jackpot COIN highlights where it stands, and a BANKED jackpot (wheel, letters, full board) gets a
 * toast. The full jackpot celebration is a later step.
 */
export const presentJackpotWin = async (event: Beat<'jackpotWin'>) => {
	if (stateRespinBoard.shown) syncHeldCells();
	eventEmitter.broadcast({
		type: 'respinJackpotWin',
		tier: event.tier,
		amount: event.amount,
		source: event.source,
		banked: event.banked,
	});
	if (event.source === 'coin' && event.cell && stateRespinBoard.shown) {
		await playHeldBeat([event.cell], 'win', { minMs: HIGHLIGHT_MIN_MS });
	}
	if (!event.banked) return;
	showMessage(`${event.tier} JACKPOT ${bookEventAmountToCurrencyString(event.amount)}`, {
		kind: 'win',
	});
	await waitPresentation(TOAST_HOLD_MS);
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
 * Every Hold and Win event whose beat is not presented yet (meters, column letters, the wheel, the
 * base-game instant collect — the next PRs): the held layer follows the recorded picture at once,
 * so the board reads right even before the beat has an animation.
 */
export const syncHoldAndWin = async () => {
	if (stateRespinBoard.shown) syncHeldCells();
};

/**
 * `holdAndWinEnd` — the final board holds for a moment, then the reel board comes back. The tally
 * (`payload.cells`) and the total are the next PRs' beats (flights into the total, count-up); the
 * round's own `setWin` / `setTotalWin` that follow present the money as for any other win.
 */
export const presentHoldAndWinEnd = async (_event: Beat<'holdAndWinEnd'>) => {
	if (!stateRespinBoard.shown) return;
	await waitPresentation(END_HOLD_MS);
	hideRespinBoard();
};
