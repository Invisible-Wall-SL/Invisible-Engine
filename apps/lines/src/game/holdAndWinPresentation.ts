import { cubicOut } from 'svelte/easing';
import type { Tween } from 'svelte/motion';
import {
	countSteps,
	respinCellKey,
	staggerDelays,
	tallyCountUp,
	type CountStep,
	type HoldAndWinCell,
	type HoldAndWinCoinChange,
	type HoldAndWinEvent,
	type Position,
	type SymbolState,
} from 'engine-game';
import { showMessage, stateBet } from 'state-shared';
import { bookEventAmountToCurrencyString } from 'utils-shared/amount';
import { roundSkip } from 'utils-shared/skipToken';

import { eventEmitter } from './eventEmitter';
import { flyTo } from './flights.svelte';
import { hideHoldAndWinBanner, showHoldAndWinBanner } from './holdAndWinBanner.svelte';
import { flyCoinsToTotal } from './holdAndWinFlights';
import {
	configuredMeters,
	holdMeterDisplay,
	meterAnchor,
	meterFlight,
	meterMax,
	pulseMeter,
	releaseMeterDisplay,
} from './holdAndWinMeters.svelte';
import { armLuckySpinReveal } from './luckySpin';
import { playSymbolLandSound } from './soundBindings';
import { stateGame } from './stateGame.svelte';
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
import { meterLevelBefore } from './stateHoldAndWin.svelte';
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
/** How long an "UNLOCKED" or "<KIND> ACTIVE" toast holds the board before the next beat. */
const TOAST_HOLD_MS = 900;
/** One level of a pot ticking up as a special lands in it. */
const METER_TICK_MS = 180;
/** A full pot's pulse, held before the round moves on. */
const METER_FULL_MS = 700;
/** A consumed pot draining to empty as the feature it bought starts. */
const METER_DRAIN_MS = 500;
/** The Lucky Spin intro banner, before its reveal rolls. */
const LUCKY_INTRO_MS = 1_600;
/** A banked jackpot's celebration (full board, letters, the wheel). */
const JACKPOT_HOLD_MS = 2_600;
/** A coin jackpot's highlight during the tally. */
const COIN_JACKPOT_MS = 900;
/** The beat between the last coin landing and the banked jackpots joining the Total Win bar. */
const BANKED_BEAT_MS = 350;
/** The Total Win bar settling on its last value before the respin board goes. */
const TALLY_SETTLE_MS = 500;

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

/** The coded name of a special kind in the "UNLOCKED" / "ACTIVE" toasts. */
const SPECIAL_NAMES: Record<string, string> = {
	collector: 'COLLECTOR',
	multiplier: 'MULTIPLIER',
	payer: 'PAYER',
	mystery: 'MYSTERY',
};
const specialName = (kind: string) => SPECIAL_NAMES[kind] ?? kind.toUpperCase();

/**
 * Light a base-board cell (`win`) while its special flies. The base reels carry a padding row above
 * the window, so visible row `r` is the reel's symbol `r + 1`. Returns the undo.
 */
const lightBaseCell = (cell: HoldAndWinCell) => {
	const symbol = stateGame.board[cell.reel]?.reelState.symbols[cell.row + 1];
	if (!symbol || symbol.rawSymbol.name !== cell.symbol.name) return () => {};
	symbol.symbolState = 'win';
	return () => {
		if (symbol.symbolState === 'win') symbol.symbolState = 'static';
	};
};

/**
 * `meterUpdate` — a special landed in the BASE game and fills its pot (3 Pots). Each special in
 * `from` lights where it landed and flies into its pot (`flyTo(cell, 'meter:<id>', 'toMeter:<id>')`);
 * the pot's level ticks up by one on each arrival, from the level before (`level − from.length`) to
 * the server's `level`, and a meter the update FILLED pulses. The level is the server's: the beat
 * only shows it arriving, never computes it (the play seam recorded it before the beat started).
 *
 * No avoidance: the update comes straight after the reveal, before any win is shown. A slam
 * compresses the flights (`flights.svelte.ts`) and never skips an arrival or the final level.
 */
export const presentMeterUpdate = async (event: Beat<'meterUpdate'>) => {
	const before = Math.min(
		event.level,
		meterLevelBefore(event.meter) ?? Math.max(0, event.level - event.from.length),
	);
	const shown = holdMeterDisplay(event.meter, before);
	eventEmitter.broadcast({
		type: 'potFill',
		meter: event.meter,
		level: event.level,
		max: event.max,
		full: event.full,
		cells: event.from.map(cellOf),
	});
	let reached = before;
	await Promise.all(
		event.from.map(async (cell, index) => {
			const unlight = stateRespinBoard.shown ? () => {} : lightBaseCell(cell);
			await flyTo(
				{ reel: cell.reel, row: cell.row },
				meterAnchor(event.meter),
				meterFlight(event.meter),
				{ index },
			);
			unlight();
			reached = Math.min(event.level, reached + 1);
			void shown.set(reached, { duration: roundSkip.isSkipped() ? 0 : METER_TICK_MS });
		}),
	);
	void shown.set(event.level, { duration: 0 });
	releaseMeterDisplay(event.meter, shown);
	if (!event.full) return;
	pulseMeter(event.meter);
	eventEmitter.broadcast({ type: 'potFull', meter: event.meter });
	await waitPresentation(METER_FULL_MS);
};

/**
 * The FULL meters a `meter` trigger consumed drain to empty, and the modifier each one buys is
 * announced ("PAYER ACTIVE") before the board swaps. What each pot activates is the Game Config's
 * (`meters[].activates`); the server already emptied the meters (recorded at the play seam), so the
 * drain runs from each pot's maximum down to the recorded 0.
 */
const presentMeterConsume = async (event: Beat<'holdAndWinTrigger'>) => {
	const ids = event.payload.meters ?? [];
	if (ids.length === 0) return;
	const declared = configuredMeters();
	const activates = ids.flatMap((id) => declared.find((meter) => meter.id === id)?.activates ?? []);
	eventEmitter.broadcast({ type: 'potsConsume', meters: ids, activates });
	await Promise.all(
		ids.map(async (id) => {
			const shown = holdMeterDisplay(id, meterMax(id));
			pulseMeter(id);
			void shown.set(0, {
				duration: roundSkip.isSkipped() ? 0 : METER_DRAIN_MS,
				easing: cubicOut,
			});
			await waitPresentation(METER_DRAIN_MS);
			releaseMeterDisplay(id, shown);
		}),
	);
	if (activates.length === 0) return;
	showMessage(`${activates.map(specialName).join(', ')} ACTIVE`, { kind: 'info' });
	await waitPresentation(TOAST_HOLD_MS);
};

/**
 * `luckySpin` — this base spin is a guaranteed trigger. A "LUCKY SPIN" banner holds over the rolling
 * reels, and the reveal that follows is armed (`luckySpin.ts`) to anticipate on every reel and to run
 * unskippable. The intro is unskippable itself (`UNSKIPPABLE_BOOK_EVENTS`), with the slam re-armed
 * before it, so a press made while the round was being requested cannot cut it short.
 */
export const presentLuckySpin = async () => {
	armLuckySpinReveal();
	eventEmitter.broadcast({ type: 'luckySpinIntro' });
	const banner = showHoldAndWinBanner({ title: 'LUCKY SPIN', size: 'large' });
	await waitPresentation(LUCKY_INTRO_MS);
	hideHoldAndWinBanner(banner);
};

/**
 * `holdAndWinTrigger` — the board swaps to the respin board with the triggering coins held exactly
 * where they landed, and the counter shows the respins awarded. A `meter` cause first drains the
 * meters it consumed and announces what they activated.
 */
export const presentHoldAndWinTrigger = async (event: Beat<'holdAndWinTrigger'>) => {
	if (event.cause === 'meter') await presentMeterConsume(event);
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
	showMessage(`UNLOCKED: ${event.activates.map(specialName).join(', ')}`, { kind: 'info' });
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
 * `jackpotWin` — presentation only (the money is already counted elsewhere, wire doc "Money").
 *
 * - A BANKED jackpot (full board, letters, the wheel) is a CELEBRATION: a large banner with its tier
 *   and amount holds over the board (a full board also lights every held cell). The play seam re-arms
 *   the slam before it and keeps the spin button inert through it (`startsCelebration` +
 *   `unskippablePresentation.ts`), as for the big win and the free-spin outro.
 * - A COIN jackpot (the tally names every jackpot coin before `holdAndWinEnd`) gets a smaller
 *   highlight: the coin lights and a small banner names it. A slam compresses it.
 * - Any other source (a collect, a column, an instant collect) presents nothing of its own.
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
	const amount = bookEventAmountToCurrencyString(event.amount);
	if (event.banked) {
		eventEmitter.broadcast({
			type: 'jackpotCelebration',
			tier: event.tier,
			amount: event.amount,
			source: event.source,
		});
		const banner = showHoldAndWinBanner({
			title: `${event.tier} JACKPOT`,
			detail: event.source === 'fullBoard' ? `FULL BOARD  ${amount}` : amount,
			size: 'large',
		});
		await Promise.all([
			waitPresentation(JACKPOT_HOLD_MS),
			event.source === 'fullBoard' && stateRespinBoard.shown
				? playHeldBeat(stateRespinBoard.held, 'win', { minMs: HIGHLIGHT_MIN_MS })
				: undefined,
		]);
		hideHoldAndWinBanner(banner);
		return;
	}
	if (event.source !== 'coin' || !event.cell || !stateRespinBoard.shown) return;
	const banner = showHoldAndWinBanner({ title: event.tier, detail: amount, size: 'small' });
	await Promise.all([
		playHeldBeat([event.cell], 'win', { minMs: HIGHLIGHT_MIN_MS }),
		waitPresentation(COIN_JACKPOT_MS),
	]);
	hideHoldAndWinBanner(banner);
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
 * Every Hold and Win event whose beat is not presented yet (column letters, the wheel, the
 * base-game instant collect, the random metre — the next PRs) and `meterLevels` (the pots read the
 * recorded levels themselves): the held layer follows the recorded picture at once, so the board
 * reads right even before the beat has an animation.
 */
export const syncHoldAndWin = async () => {
	if (stateRespinBoard.shown) syncHeldCells();
};

/**
 * `holdAndWinEnd` — the final board holds for a moment, then every tallied coin flies into the Total
 * Win bar (`flyCoinsToTotal`) and the bar COUNTS UP as each lands: that coin's amount is added on its
 * `flightArrive`, whatever order the flights finish in (`tallyCountUp`). What was banked on the way
 * (jackpots, swept columns) is added once the last coin is in, and the bar settles on what it read
 * before the tally plus `total` — exactly, whatever the rounded per-coin amounts sum to. Then the reel
 * board comes back; the round's own `setWin` (big-win tier) / `setTotalWin` follow unchanged.
 *
 * A celebration (`startsCelebration`): the slam is re-armed before it and the button is inert
 * through it. Should a slam reach it anyway, the flights compress and every landing value is still
 * written — nothing is skipped but time.
 */
export const presentHoldAndWinEnd = async (event: Beat<'holdAndWinEnd'>) => {
	if (!stateRespinBoard.shown) return;
	await waitPresentation(END_HOLD_MS);
	const order = [...event.payload.cells].sort((a, b) => a.reel - b.reel || a.row - b.row);
	const tally = tallyCountUp({
		start: stateBet.winBookEventAmount,
		amounts: order.map((cell) => cell.amount),
		banked: event.payload.banked,
		total: event.total,
	});
	const step = (index: number, amount: number, shown: number) => {
		stateBet.winBookEventAmount = shown;
		eventEmitter.broadcast({ type: 'respinTallyStep', index, amount, total: shown });
	};
	await flyCoinsToTotal(order, (index) => step(index, order[index].amount, tally.arrive(index)));
	if (stateBet.winBookEventAmount !== tally.final) {
		if (event.payload.banked > 0) await waitPresentation(BANKED_BEAT_MS);
		step(order.length, tally.final - stateBet.winBookEventAmount, tally.final);
	}
	await waitPresentation(TALLY_SETTLE_MS);
	hideRespinBoard();
};
