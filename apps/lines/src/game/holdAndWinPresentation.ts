import { cubicOut } from 'svelte/easing';
import type { Tween } from 'svelte/motion';
import {
	cellWorth,
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
import { RESPIN_COUNTER_ANCHOR } from 'engine-layout';
import { holdAndWinIsOverlayBonus } from 'game-config';
import { showMessage, stateBet } from 'state-shared';
import { bookEventAmountToCurrencyString } from 'utils-shared/amount';
import { roundSkip } from 'utils-shared/skipToken';
import { scopeOf } from 'utils-event-emitter';
import { waitForTimeout } from 'utils-shared/wait';

import { coinLabelCountMs } from './coinLabel';
import { eventEmitter } from './eventEmitter';
import { FLIGHT_TARGET_TOTAL, flyTo } from './flights.svelte';
import { getActiveGameConfig } from './gameConfig';
import { hideHoldAndWinBanner, showHoldAndWinBanner } from './holdAndWinBanner.svelte';
import {
	featureIntroText,
	featureOutroText,
	featureTotalText,
	instantCollectText,
	jackpotBannerText,
	jackpotCoinText,
	jackpotUpgradeText,
	luckySpinText,
	meterFullText,
	modifiersActiveText,
	modifiersUnlockedText,
	respinsAddedText,
	rowUnlockedText,
	upgradeText,
	wheelPrizeDetailText,
	wheelPrizeText,
} from './holdAndWinText';
import {
	FLIGHT_BOOST_BEAM,
	FLIGHT_TO_COLLECTOR,
	FLIGHT_TO_COUNTER,
	FLIGHT_TO_TOTAL,
	FLIGHT_UNLOCK_ROW,
	FLIGHT_UPGRADE_BEAM,
	flyCoinsToTotal,
} from './holdAndWinFlights';
import { lightLetter, syncLetters } from './holdAndWinLetters.svelte';
import {
	configuredMeters,
	holdMeterDisplay,
	meterAnchor,
	meterFlight,
	meterMax,
	meterStage,
	pulseMeter,
	releaseMeterDisplay,
} from './holdAndWinMeters.svelte';
import { hideWheel, showWheel, spinWheelTo, wheelSegments } from './holdAndWinWheel.svelte';
import { armLuckySpinReveal } from './luckySpin';
import { playSymbolLandSound } from './soundBindings';
import { getSymbolSeat, stateGame } from './stateGame.svelte';
import { meterLevelBefore, stateHoldAndWin, stateHoldAndWinShown } from './stateHoldAndWin.svelte';
import { leavingToken, liftToken, overlayTokenSymbol } from './stateOverlay.svelte';
import {
	armHeldBeat,
	hideRespinBoard,
	holdHeldDisplay,
	openRespinRows,
	openRespinRowsTo,
	respinUnlockFade,
	holdHeldJackpot,
	releaseHeldDisplay,
	releaseHeldJackpot,
	settleHeldBeats,
	settleReelsOnHeldCells,
	showRespinBoard,
	spinRespinCells,
	startHeldBeat,
	stateRespinBoard,
	syncHeldCells,
} from './stateRespinBoard.svelte';
import { awaitSymbolBeat, TRANSIT_BEAT_CAP_MS } from './symbolBeat';
import { SLAM_MESSAGE_HOLD_MS, slamHold, waitPresentation } from './unskippablePresentation';

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
/** An authored feature intro / outro line holds this long over the board. */
const FEATURE_LINE_MS = 1_600;
/** A random metre firing: its banner over the base board, the coins it added lit. */
const RANDOM_METRE_MS = 1_600;
/** The pause between two respins that changed nothing, so the board reads between rolls. */
const RESPIN_PAUSE_MS = 250;
/** How long the counter holds on its reset pulse — the beat that tells the player "back to 3". */
const RESET_BEAT_MS = 600;
/** A locked row fading open, and the hold on the "ROW UNLOCKED" banner. */
const ROW_UNLOCK_FADE_MS = 450;
const ROW_UNLOCK_HOLD_MS = 900;
/** How long the counter holds after an add-respins special's respins land in it. */
const COUNTER_STEP_MS = 450;
/** The final board stays up this long before the reel board comes back. */
const END_HOLD_MS = 900;
/** The shortest a highlight (a win-highlight state on a held cell) is on screen — a sprite reports
 *  at once. */
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
/** The beat between the bar landing on the last coin and the banked jackpots joining it. */
const BANKED_BEAT_MS = 350;
/**
 * The Total Win bar's last step landing, then holding, before the respin board goes. The bar COUNTS
 * to each value it is handed (the win readout's 500 ms count-up), so the board waits that out and
 * then lets the player read the landed total — hiding it any sooner swapped the board in the frame
 * the total arrived.
 */
const TALLY_LAND_MS = 500;
const TALLY_HOLD_MS = 700;
/** The base-game "INSTANT WIN" banner, once every coin has reached its special. */
const INSTANT_BANNER_MS = 1_300;
/** The wheel popping up before it turns. */
const WHEEL_INTRO_MS = 450;
/** The landed segment held on screen, and the prize banner after it. A slam shortens either to
 *  {@link WHEEL_RESULT_MIN_MS}, never below: the wheel's RESULT is not skippable. */
const WHEEL_LANDED_MS = 1_300;
const WHEEL_PRIZE_MS = 1_400;
const WHEEL_RESULT_MIN_MS = 700;

/**
 * What the feature has already counted INTO the Total Win bar on the way — swept columns
 * ({@link presentColumnComplete}). The end's tally subtracts it, so the bar lands on the feature
 * total once, not twice. Reset when a feature opens; a flow that never runs the sweep leaves it at
 * 0 and the end adds the whole banked part, as before.
 */
let featureCountedIntoBar = 0;

/**
 * Hold a banner on screen for `ms`, or — under a slam — for the slam's message hold, so a beat a
 * player slams through (a base-game reveal, a respin) still shows its line instead of hiding it in
 * the tick it went up. The celebrations need none of this: their slam is re-armed before them.
 */
const holdBanner = (ms: number) =>
	roundSkip.isSkipped() ? slamHold(SLAM_MESSAGE_HOLD_MS) : roundSkip.wait(ms);

const updateCounter = ({ left, start }: { left: number; start: number }) => {
	stateRespinBoard.counter.left = left;
	stateRespinBoard.counter.start = start;
};

const cellOf = ({ reel, row, symbol }: HoldAndWinCell): HoldAndWinCell => ({ reel, row, symbol });

/**
 * Play `state` on the held cells at these positions and wait for them — capped, raced against the
 * slam, and held at least `minMs` (also slammable) so a sprite that reports at once is still seen.
 * A non-terminal state settles back to `coinIdle`; a terminal one (`mysteryReveal`, `clearReel`) is
 * left for the sync that follows to replace or remove.
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

/**
 * Count every pinned label up to its new value, staggered; resolves when the last has landed. A
 * jackpot coin does not count — its factor STEPS on its turn (`MINI` → `MINI ×2`) and the coin
 * lights as it does, so the step is seen rather than flickering past among the counting coins.
 */
const runCounts = (counts: HeldCount[]) => {
	const delays = staggerDelays(counts.length, COUNT_STAGGER_MS, COUNT_SPAN_MS);
	return Promise.all(
		counts.map(async ({ key, change, tween }, i) => {
			await roundSkip.wait(delays[i]);
			if (change.jackpot === undefined) {
				await countTo(tween, change.to, coinLabelCountMs(COUNT_MS));
				releaseHeldDisplay(key, tween);
				return;
			}
			releaseHeldDisplay(key, tween);
			await playHeldBeat([change], 'jackpotReveal', { minMs: HIGHLIGHT_MIN_MS });
		}),
	);
};

/**
 * Light a base-board cell on `state` while it flies — `flyToMeter` for a special filling its pot,
 * `coinCollect` for an instant collect. The base reels carry a padding row above the window, so
 * visible row `r` is the reel's symbol `r + 1`. Returns the undo.
 */
const lightBaseCell = (cell: HoldAndWinCell, state: SymbolState) => {
	const symbol = stateGame.board[cell.reel]?.reelState.symbols[cell.row + 1];
	if (!symbol || symbol.rawSymbol.name !== cell.symbol.name) return () => {};
	symbol.symbolState = state;
	return () => {
		if (symbol.symbolState === state) symbol.symbolState = 'static';
	};
};

/**
 * A pot's level rose from `from` to `to`: `potLevelUp`, and `potStageUp` when the rise crossed one of
 * the meter's size stages (the step the coded pot grows by). Both are scoped by the meter, so a
 * component placed on that pot hears its own pot only.
 */
const announceMeterRise = (event: Beat<'meterUpdate'>, from: number, to: number) => {
	if (to <= from) return;
	const scope = scopeOf('meter', event.meter);
	eventEmitter.broadcast({
		type: 'potLevelUp',
		meter: event.meter,
		level: to,
		max: event.max,
		scope,
	});
	const meter = configuredMeters().find((m) => m.id === event.meter);
	if (!meter) return;
	const stage = meterStage(meter, to);
	if (stage > meterStage(meter, from)) {
		eventEmitter.broadcast({ type: 'potStageUp', meter: event.meter, stage, level: to, scope });
	}
};

/**
 * `meterUpdate` — a special landed in the BASE game and fills its pot (3 Pots). Each special in
 * `from` lights where it landed and flies into its pot (`flyTo(cell, 'meter:<id>', 'toMeter:<id>')`);
 * the pot's level ticks up by one on each arrival, from the level before (`level − from.length`) to
 * the server's `level`, and a meter the update FILLED pulses. The level is the server's: the beat
 * only shows it arriving, never computes it (the play seam recorded it before the beat started).
 * Every cue it sends is scoped by the meter (Phase 12a), arrivals included. A pots overlay's token
 * is its own flight's head: it waits in its cell, lifts as its flight leaves, and the cell under it
 * (the host's symbol) is not lit.
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
	const scope = scopeOf('meter', event.meter);
	eventEmitter.broadcast({
		type: 'potFill',
		meter: event.meter,
		level: event.level,
		max: event.max,
		full: event.full,
		cells: event.from.map(cellOf),
		scope,
	});
	let reached = before;
	await Promise.all(
		event.from.map(async (cell, index) => {
			const token = stateRespinBoard.shown
				? undefined
				: leavingToken(cell.reel, cell.row, event.meter);
			const unlight =
				stateRespinBoard.shown || token ? () => {} : lightBaseCell(cell, 'flyToMeter');
			await flyTo(
				{ reel: cell.reel, row: cell.row },
				meterAnchor(event.meter),
				meterFlight(event.meter),
				token
					? {
							index,
							symbol: overlayTokenSymbol(token),
							symbolScale: getSymbolSeat(token.reel, token.row).scale,
							onStart: () => liftToken(token),
						}
					: { index },
			);
			unlight();
			const from = reached;
			reached = Math.min(event.level, reached + 1);
			void shown.set(reached, { duration: roundSkip.isSkipped() ? 0 : METER_TICK_MS });
			announceMeterRise(event, from, reached);
		}),
	);
	// A level the arrivals did not account for (more than one per special) still rises — once.
	announceMeterRise(event, reached, event.level);
	// Let the last tick play out before the display hands back to the recorded level — releasing at
	// once snapped the pot on the final arrival. Bounded: a tick a later one interrupted never settles.
	const tickMs = roundSkip.isSkipped() ? 0 : METER_TICK_MS;
	await Promise.race([shown.set(event.level, { duration: tickMs }), waitPresentation(tickMs + 50)]);
	releaseMeterDisplay(event.meter, shown);
	if (!event.full) return;
	pulseMeter(event.meter);
	eventEmitter.broadcast({ type: 'potFull', meter: event.meter, scope });
	const meter = configuredMeters().find((m) => m.id === event.meter);
	const title = meter ? meterFullText(meter.id, meter.bonus.activates) : '';
	const banner = title ? showHoldAndWinBanner({ kind: 'meterFull', title, size: 'small' }) : 0;
	await (banner ? holdBanner(METER_FULL_MS) : waitPresentation(METER_FULL_MS));
	hideHoldAndWinBanner(banner);
};

/**
 * The FULL meters a `meter` cause consumed drain to empty, and the modifier each one buys is
 * announced ("PAYER ACTIVE"). Any mode a pot starts plays it (`docs/design/pots-overlay.md` §3.4):
 * Hold and Win before its board swaps; free spins and another mode at the start of their coded
 * entry beat. The mode layer has already entered the mode by then (`modes.before`), so its tagged
 * screens and music are up while the pots drain. What each pot activates is the Game Config's (`resolveMeters` — a meter's or a pot's
 * `bonus.activates`); the server already emptied the meters (recorded at the play seam), so the
 * drain runs from each pot's maximum down to the recorded 0.
 */
export const presentMeterConsume = async (ids: readonly string[]) => {
	if (ids.length === 0) return;
	const declared = configuredMeters();
	const activates = ids.flatMap(
		(id) => declared.find((meter) => meter.id === id)?.bonus.activates ?? [],
	);
	const scope = ids.flatMap((id) => scopeOf('meter', id) ?? []);
	eventEmitter.broadcast({ type: 'potsConsume', meters: [...ids], activates, scope });
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
	showMessage(modifiersActiveText(activates), { kind: 'info' });
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
	const banner = showHoldAndWinBanner({ kind: 'luckySpin', title: luckySpinText(), size: 'large' });
	await waitPresentation(LUCKY_INTRO_MS);
	hideHoldAndWinBanner(banner);
};

/**
 * `holdAndWinTrigger` — the board swaps to the respin board with the triggering coins held exactly
 * where they landed, and the counter shows the respins awarded. A `meter` cause first drains the
 * meters it consumed and announces what they activated.
 */
export const presentHoldAndWinTrigger = async (event: Beat<'holdAndWinTrigger'>) => {
	if (event.cause === 'meter') await presentMeterConsume(event.payload.meters ?? []);
	featureCountedIntoBar = 0;
	showRespinBoard();
	syncLetters();
	updateCounter({ left: event.payload.respins, start: event.payload.respins });
	stateRespinBoard.counter.note = 'award';
	stateRespinBoard.counter.show = true;
	eventEmitter.broadcast({ type: 'respinBoardShow' });
	const intro = featureIntroText(event.payload.respins);
	if (!intro) {
		await waitPresentation(TRIGGER_HOLD_MS);
		return;
	}
	const banner = showHoldAndWinBanner({ kind: 'featureIntro', title: intro, size: 'large' });
	await holdBanner(FEATURE_LINE_MS);
	hideHoldAndWinBanner(banner);
};

/**
 * `randomMetreTrigger` — base game: the random metre (Grand's Diamond Metre, Hotfire's Extra Bonus
 * Game) fired and ADDED the coins the trigger needed (they are on the revealed board). Its banner —
 * the config's metre name, as authored: config text, not a Win Text template — holds over the base
 * board while those coins play `coinStick` where they landed; the trigger beat follows.
 */
export const presentRandomMetreTrigger = async (event: Beat<'randomMetreTrigger'>) => {
	eventEmitter.broadcast({
		type: 'randomMetreFire',
		name: event.name,
		cells: event.cells.map(cellOf),
	});
	const unlight = event.cells.map((cell) => lightBaseCell(cell, 'coinStick'));
	const banner = event.name
		? showHoldAndWinBanner({ kind: 'randomMetre', title: event.name, size: 'small' })
		: 0;
	await (banner ? holdBanner(RANDOM_METRE_MS) : waitPresentation(RANDOM_METRE_MS));
	hideHoldAndWinBanner(banner);
	unlight.forEach((undo) => undo());
};

/** `respinReveal` — every free cell spins and lands on the symbol the server names for it. */
export const presentRespinReveal = async (event: Beat<'respinReveal'>) => {
	// A respin with no board up (a book that skipped its trigger) still has to land somewhere.
	if (!stateRespinBoard.shown) showRespinBoard();
	if (stateRespinBoard.counter.note === 'award') stateRespinBoard.counter.note = null;
	eventEmitter.broadcast({ type: 'respinBoardSpin', cells: event.cells });
	await spinRespinCells(event.cells);
};

/** `coinsLand` — the cells that landed stick: they move into the held layer and play
 *  `coinStick`. */
export const presentCoinsLand = async (event: Beat<'coinsLand'>) => {
	syncHeldCells();
	event.cells.forEach((cell) => playSymbolLandSound(cell.symbol.name, 1));
	eventEmitter.broadcast({ type: 'respinCoinsLand', cells: event.cells });
	await playHeldBeat(event.cells, 'coinStick');
};

/**
 * `coinPay` — a PAYER applies: it plays `coinBoost` where it stands, then every cash coin's label
 * counts up from `from` to `to` (staggered), so the player watches the value rise.
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
	await playHeldBeat([event.payer], 'coinBoost', { minMs: HIGHLIGHT_MIN_MS });
	await runCounts(counts);
};

/**
 * `coinBoost` — a MULTIPLIER applies (`source: 'special'`, the booster plays `coinBoost` first) or
 * the pre-feature wheel's boost does (`'wheel'`, no cell of its own): every coin's label counts up
 * from `from` to `to`, and a jackpot coin's factor steps (`MINI` → `MINI ×2`). A booster first
 * fires a beam to each coin it boosts (`flyTo` kind `boostBeam` — the coded glow unless the Symbols
 * doc authors one), and the counts start once every beam has landed.
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
	const booster = event.booster;
	if (booster) {
		await playHeldBeat([booster], 'coinBoost', { minMs: HIGHLIGHT_MIN_MS });
		await Promise.all(
			event.cells.map((cell, index) =>
				flyTo(
					{ reel: booster.reel, row: booster.row },
					{ reel: cell.reel, row: cell.row },
					FLIGHT_BOOST_BEAM,
					{ index },
				),
			),
		);
	}
	await runCounts(counts);
};

/**
 * `respinsAdded` — an ADD-RESPINS special applies: it plays `respinsAdd` where it stands while a
 * "+2 RESPINS" toast goes up, then its "+N" flies into the respin counter (`flyTo(cell,
 * 'respinCounter', 'toCounter')` — the board's bottom centre when no counter anchor is on screen),
 * and the counter steps to `left` (its cap to `total`) and pulses ON THE ARRIVAL, then holds a beat
 * so the new count reads. A non-sticky special then leaves on the `cellsCleared {reason:
 * 'applied'}` that follows.
 */
export const presentRespinsAdded = async (event: Beat<'respinsAdded'>) => {
	if (!stateRespinBoard.shown) return;
	syncHeldCells();
	eventEmitter.broadcast({
		type: 'respinAddRespins',
		cell: cellOf(event.cell),
		added: event.added,
		left: event.left,
		total: event.total,
	});
	const toast = respinsAddedText(event.added);
	if (toast) showMessage(toast, { kind: 'info' });
	await playHeldBeat([event.cell], 'respinsAdd', { minMs: HIGHLIGHT_MIN_MS });
	await flyTo(
		{ reel: event.cell.reel, row: event.cell.row },
		RESPIN_COUNTER_ANCHOR,
		FLIGHT_TO_COUNTER,
		{ label: `+${event.added}` },
	);
	updateCounter({ left: event.left, start: event.total });
	stateRespinBoard.counter.adds += 1;
	await roundSkip.wait(COUNTER_STEP_MS);
};

/**
 * `coinUpgrade` — an UPGRADE special applies: it plays `coinUpgrade` where it stands; an upgrade
 * that raised nothing (`cells` empty) stops there. Otherwise an "UPGRADE" toast goes up and a beam
 * flies to each coin it raises (`flyTo` kind `upgradeBeam` — the coded glow unless the Symbols doc
 * authors one); once every beam has landed, each cash coin's label counts up from `from` to `to`
 * (staggered) and a jackpot coin's label switches to its new tier as it plays `jackpotReveal` under a
 * "MINOR UPGRADE" banner. Every label is pinned at its old value / tier before the held layer syncs,
 * so no frame shows the result ahead of its beam.
 */
export const presentCoinUpgrade = async (event: Beat<'coinUpgrade'>) => {
	if (!stateRespinBoard.shown) return;
	const cashChanges: HoldAndWinCoinChange[] = [];
	const tierChanges: (Position & { to: string })[] = [];
	for (const change of event.cells) {
		if (change.kind === 'value') {
			cashChanges.push({ reel: change.reel, row: change.row, from: change.from, to: change.to });
		} else {
			tierChanges.push({ reel: change.reel, row: change.row, to: change.to });
			holdHeldJackpot(respinCellKey(change.reel, change.row), change.from);
		}
	}
	const counts = holdCounts(cashChanges);
	syncHeldCells();
	eventEmitter.broadcast({
		type: 'respinCoinUpgrade',
		upgrader: cellOf(event.upgrader),
		target: event.target,
		step: event.step,
		cells: event.cells,
	});
	const upgrader = event.upgrader;
	await playHeldBeat([upgrader], 'coinUpgrade', { minMs: HIGHLIGHT_MIN_MS });
	if (event.cells.length === 0) return;
	const toast = upgradeText();
	if (toast) showMessage(toast, { kind: 'info' });
	await Promise.all(
		event.cells.map((cell, index) =>
			flyTo(
				{ reel: upgrader.reel, row: upgrader.row },
				{ reel: cell.reel, row: cell.row },
				FLIGHT_UPGRADE_BEAM,
				{ index },
			),
		),
	);
	await Promise.all([
		runCounts(counts),
		...tierChanges.map(async (change) => {
			releaseHeldJackpot(respinCellKey(change.reel, change.row));
			const title = jackpotUpgradeText(change.to);
			const banner = title
				? showHoldAndWinBanner({ kind: 'jackpotUpgrade', title, size: 'small' })
				: 0;
			await Promise.all([
				playHeldBeat([change], 'jackpotReveal', { minMs: HIGHLIGHT_MIN_MS }),
				holdBanner(COIN_JACKPOT_MS),
			]);
			hideHoldAndWinBanner(banner);
		}),
	]);
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
	await playHeldBeat([event], 'coinStick');
};

/**
 * ONE coin's moment of a collect: the coin pulses (`coinCollect`) where it stands while its head
 * flies into the collector (`flyTo(cell, collector, 'toCollector')`), and the collector's label
 * rises by that coin's share (`step`) on the ARRIVAL, not when the coin takes off. Never lowers the
 * label, so steps that land out of order still read as one climb. The stagger is the caller's
 * ({@link presentCoinCollect}), so the flight adds none of its own.
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
	const flight = flyTo(
		{ reel: cell.reel, row: cell.row },
		{ reel: collector.reel, row: collector.row },
		FLIGHT_TO_COLLECTOR,
		{ index, stagger: 0 },
	).then(() =>
		step.to > collectorLabel.target
			? countTo(collectorLabel, step.to, coinLabelCountMs(COLLECT_COUNT_MS, COUNT_MS))
			: undefined,
	);
	await Promise.all([playHeldBeat([cell], 'coinCollect', { minMs: HIGHLIGHT_MIN_MS }), flight]);
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
 * `mysteryReveal` — each mystery opens (`mysteryReveal`, where it stands), then becomes what it
 * revealed (a coin with its value, a jackpot, a special) and lands as it. A reveal that UNLOCKS a
 * modifier not active at entry says so ("UNLOCKED: PAYER") and broadcasts `respinModifierUnlock`. A
 * revealed special applies at its own place in the order, through the events that follow.
 */
export const presentMysteryReveal = async (event: Beat<'mysteryReveal'>) => {
	if (!stateRespinBoard.shown) return;
	eventEmitter.broadcast({
		type: 'respinMysteryReveal',
		cells: event.cells,
		activates: event.activates,
	});
	await playHeldBeat(event.cells, 'mysteryReveal');
	syncHeldCells();
	event.cells.forEach((cell) => playSymbolLandSound(cell.symbol.name, 1));
	await playHeldBeat(event.cells, 'coinStick');
	if (event.activates.length === 0) return;
	showMessage(modifiersUnlockedText(event.activates), { kind: 'info' });
	eventEmitter.broadcast({ type: 'respinModifierUnlock', activates: event.activates });
	await waitPresentation(TOAST_HOLD_MS);
};

/**
 * `rowsUnlocked` — an expanding board opens rows (design §7 11b). An unlock symbol that opened them
 * plays `rowUnlock` where it stands and flies into the middle of the first row it opens (`flyTo`
 * kind `unlockRow` — the coded glow unless the Symbols doc authors one); a full row or a coin count
 * opens them with no flight. Then the locked cells of the opened rows fade away under a "ROW
 * UNLOCKED · 5 ROWS" banner, and the rows are open from the next respin. The unlock symbols leave
 * on the `cellsCleared {reason: 'applied'}` that follows; any counter reset is the respin's own
 * `respinUpdate`.
 */
export const presentRowsUnlocked = async (event: Beat<'rowsUnlocked'>) => {
	if (!stateRespinBoard.shown) return;
	syncHeldCells();
	eventEmitter.broadcast({
		type: 'respinRowsUnlocked',
		from: event.from,
		rows: event.rows,
		cause: event.cause,
		unlockers: event.unlockers.map(cellOf),
	});
	if (event.unlockers.length) {
		await playHeldBeat(event.unlockers, 'rowUnlock', { minMs: HIGHLIGHT_MIN_MS });
		const reels = stateGame.board.length;
		await Promise.all(
			event.unlockers.map((cell, index) =>
				flyTo(
					{ reel: cell.reel, row: cell.row },
					{ reel: Math.floor(reels / 2), row: Math.min(event.from + index, event.rows - 1) },
					FLIGHT_UNLOCK_ROW,
					{ index },
				),
			),
		);
	}
	const text = rowUnlockedText(event.rows);
	const banner = text.title
		? showHoldAndWinBanner({
				kind: 'rowUnlocked',
				title: text.title,
				detail: text.detail,
				size: 'small',
			})
		: 0;
	stateRespinBoard.unlockingTo = Math.max(event.rows, openRespinRows());
	respinUnlockFade.set(1, { duration: 0 });
	await Promise.all([
		respinUnlockFade.set(0, { duration: roundSkip.isSkipped() ? 0 : ROW_UNLOCK_FADE_MS }),
		banner ? holdBanner(ROW_UNLOCK_HOLD_MS) : roundSkip.wait(ROW_UNLOCK_FADE_MS),
	]);
	openRespinRowsTo(event.rows);
	stateRespinBoard.unlockingTo = 0;
	hideHoldAndWinBanner(banner);
};

/** `cellsCleared` — a streak's collected cells, or a non-sticky special that has applied, leave the
 *  board: each plays `clearReel`, then goes. */

export const presentCellsCleared = async (event: Beat<'cellsCleared'>) => {
	if (!stateRespinBoard.shown) return;
	eventEmitter.broadcast({ type: 'respinCellsCleared', reason: event.reason, cells: event.cells });
	await playHeldBeat(event.cells, 'clearReel');
	syncHeldCells();
	settleHeldBeats(
		event.cells.map((cell) => respinCellKey(cell.reel, cell.row)),
		{ terminal: true },
	);
};

/**
 * `columnComplete` — Grand's column letters (design §1.2). The column's letter lights and pulses
 * while its coins light; when the column is `cleared`, every coin in it flies into the Total Win bar
 * (staggered) and the bar counts up by the column's `amount` as they land — each coin adding its
 * share by worth, the last landing the bar exactly on `amount` more — and then the cells leave the
 * board (`clearReel`, then gone). A column that stays (`cleared: false`) only lights its letter.
 *
 * The play seam has already recorded the column as gone and its amount as banked; the held layer is
 * a copy, so the coins stay drawn until their flights land. What reaches the bar here is remembered
 * ({@link featureCountedIntoBar}) so the feature end does not add it again. Every letter lit is the
 * `jackpotWin {source: 'letters'}` that follows — the banked-jackpot celebration.
 */
export const presentColumnComplete = async (event: Beat<'columnComplete'>) => {
	if (!stateRespinBoard.shown) return;
	eventEmitter.broadcast({
		type: 'respinColumnComplete',
		reel: event.reel,
		letter: event.letter,
		newlyLit: event.newlyLit,
		cleared: event.cleared,
		amount: event.amount,
		cells: event.cells,
		scope: scopeOf('reel', event.reel),
	});
	lightLetter(event.reel);
	await playHeldBeat(event.cells, 'coinCollect', { minMs: HIGHLIGHT_MIN_MS });
	if (!event.cleared) return;
	const jackpots = getActiveGameConfig().holdAndWin?.jackpots ?? [];
	const order = [...event.cells].sort((a, b) => a.row - b.row);
	const weights = order.map((cell) => {
		const held = stateRespinBoard.held.find((h) => h.reel === cell.reel && h.row === cell.row);
		return held ? cellWorth(held.symbol, jackpots) : 0;
	});
	const start = stateBet.winBookEventAmount;
	const shares = countSteps(0, event.amount, weights).map((leg) => Math.round(leg.to - leg.from));
	const tally = tallyCountUp({ start, amounts: shares, banked: 0, total: event.amount });
	await Promise.all(
		order.map(async (cell, index) => {
			await flyTo({ reel: cell.reel, row: cell.row }, FLIGHT_TARGET_TOTAL, FLIGHT_TO_TOTAL, {
				index,
			});
			stateBet.winBookEventAmount = tally.arrive(index);
			eventEmitter.broadcast({
				type: 'respinColumnStep',
				reel: event.reel,
				index,
				total: stateBet.winBookEventAmount,
			});
		}),
	);
	stateBet.winBookEventAmount = tally.final;
	featureCountedIntoBar += event.amount;
	await playHeldBeat(order, 'clearReel');
	syncHeldCells();
	settleHeldBeats(
		order.map((cell) => respinCellKey(cell.reel, cell.row)),
		{ terminal: true },
	);
};

/**
 * `coinInstantCollect` — the BASE game's instant win (Grand's BOOST star, Hotfire's COLLECT
 * diamond, beside coins and no trigger). The specials light where they landed; every coin lights and
 * its head flies INTO the nearest special — the special is what gathers them, so that is where they
 * go, and the Total Win bar is left to the round's own `setWin` / `setTotalWin`, which follow and
 * count this amount with the line wins (flying into the bar here would count it up once and then
 * see the win presentation count it again). Then a short "INSTANT WIN" banner names the amount (and
 * the multiplier when one applied).
 *
 * Positions are visible rows; a base reel carries a padding row above the window, so the lighting
 * reads row + 1 (`lightBaseCell`) and a flight seat takes the visible row. Slammable: the flights
 * compress, the banner keeps the slam's minimum message hold.
 */
export const presentInstantCollect = async (event: Beat<'coinInstantCollect'>) => {
	if (stateRespinBoard.shown) return;
	eventEmitter.broadcast({
		type: 'instantCollectWin',
		specials: event.specials.map(cellOf),
		multiplier: event.multiplier,
		times: event.times,
		cells: event.cells,
		amount: event.amount,
	});
	const unlightSpecials = event.specials.map((special) => lightBaseCell(special, 'coinCollect'));
	const nearest = (cell: Position) =>
		event.specials.reduce((best, special) =>
			Math.hypot(special.reel - cell.reel, special.row - cell.row) <
			Math.hypot(best.reel - cell.reel, best.row - cell.row)
				? special
				: best,
		);
	if (event.specials.length > 0) {
		await Promise.all(
			event.cells.map(async (cell, index) => {
				const unlight = lightBaseCell(cell, 'coinCollect');
				const special = nearest(cell);
				await flyTo(
					{ reel: cell.reel, row: cell.row },
					{ reel: special.reel, row: special.row },
					FLIGHT_TO_COLLECTOR,
					{ index },
				);
				unlight();
			}),
		);
	}
	const factors = [event.multiplier, event.times].filter((factor) => factor > 1);
	const banner = showHoldAndWinBanner({
		kind: 'instantWin',
		title: instantCollectText(),
		detail: [
			...factors.map((factor) => `×${factor}`),
			bookEventAmountToCurrencyString(event.amount),
		].join('  '),
		size: 'small',
	});
	await (roundSkip.isSkipped()
		? slamHold(SLAM_MESSAGE_HOLD_MS)
		: roundSkip.wait(INSTANT_BANNER_MS));
	hideHoldAndWinBanner(banner);
	unlightSpecials.forEach((unlight) => unlight());
};

/** Hold a wheel result: never less than {@link WHEEL_RESULT_MIN_MS} (a bare timer — the slam cannot
 *  shorten it, and it settles on its own), the rest of `ms` slammable. */
const holdWheelResult = async (ms: number) => {
	await waitForTimeout(WHEEL_RESULT_MIN_MS);
	await roundSkip.wait(Math.max(0, ms - WHEEL_RESULT_MIN_MS));
};

/**
 * `holdAndWinWheel` — Super Hotfire's pre-feature wheel. A segmented wheel of the configured prizes
 * pops up over the board, spins and lands EXACTLY on the server's `segment` (a deterministic ease; the
 * geometry is `engine-game` `holdAndWinWheel.ts`), holds the landed segment, and goes. Then the
 * prize: `COIN BOOST ×2` and `+1 COLLECT` get a banner (the latter with the collector level the
 * server now holds: "DOUBLE COLLECT" — the counter's "DOUBLE COLLECTOR" line is held at the old
 * level until the wheel has landed); the coins then count up on the `coinBoost {source: 'wheel'}`
 * that follows. A jackpot prize gets no banner of its own — the `jackpotWin {source: 'wheel'}` that
 * follows is the banked-jackpot celebration.
 *
 * SLAM, like the free-spin intro it stands in for: the slam is re-armed before it
 * (`startsCelebration`), so a press that slammed the trigger's reels does not snap the wheel; a
 * press WHILE it turns lands it at once on the same segment; and its RESULT is never skipped — the
 * landed segment and the prize each hold at least {@link WHEEL_RESULT_MIN_MS} on a bare timer.
 */
export const presentWheel = async (event: Beat<'holdAndWinWheel'>) => {
	const { prizes, index } = wheelSegments(event.segment, event.prize);
	// The play seam has already raised the level; the counter shows the old one until the wheel lands.
	if (event.prize.type === 'extraCollect') {
		stateHoldAndWinShown.collectorLevel = Math.max(
			1,
			stateHoldAndWin.collectorLevel - event.prize.count,
		);
	}
	const wheel = showWheel(prizes);
	try {
		eventEmitter.broadcast({ type: 'wheelShow', prizes });
		await waitPresentation(WHEEL_INTRO_MS);
		// The segment DRAWN — a drifted config falls back to a one-segment wheel, where that is 0.
		eventEmitter.broadcast({ type: 'wheelSpin', segment: index, prize: event.prize });
		await spinWheelTo(index);
		eventEmitter.broadcast({ type: 'wheelLand', segment: index, prize: event.prize });
		await holdWheelResult(WHEEL_LANDED_MS);
	} finally {
		hideWheel(wheel);
		stateHoldAndWinShown.collectorLevel = null;
	}
	if (event.prize.type === 'jackpot') return;
	const banner = showHoldAndWinBanner({
		kind: 'wheelPrize',
		title: wheelPrizeText(event.prize),
		detail: wheelPrizeDetailText(event.prize, stateHoldAndWin.collectorLevel),
		size: 'small',
	});
	await holdWheelResult(WHEEL_PRIZE_MS);
	hideHoldAndWinBanner(banner);
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
		scope: scopeOf('tier', event.tier),
	});
	const amount = bookEventAmountToCurrencyString(event.amount);
	if (event.banked) {
		eventEmitter.broadcast({
			type: 'jackpotCelebration',
			tier: event.tier,
			amount: event.amount,
			source: event.source,
			scope: scopeOf('tier', event.tier),
		});
		const banner = showHoldAndWinBanner({
			kind: 'jackpot',
			...jackpotBannerText(event.tier, amount, event.source === 'fullBoard'),
			size: 'large',
		});
		await Promise.all([
			waitPresentation(JACKPOT_HOLD_MS),
			event.source === 'fullBoard' && stateRespinBoard.shown
				? playHeldBeat(stateRespinBoard.held, 'jackpotReveal', { minMs: HIGHLIGHT_MIN_MS })
				: undefined,
		]);
		hideHoldAndWinBanner(banner);
		return;
	}
	if (event.source !== 'coin' || !event.cell || !stateRespinBoard.shown) return;
	const banner = showHoldAndWinBanner({
		kind: 'coinJackpot',
		title: jackpotCoinText(event.tier),
		detail: amount,
		size: 'small',
	});
	await Promise.all([
		playHeldBeat([event.cell], 'jackpotReveal', { minMs: HIGHLIGHT_MIN_MS }),
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
	if (event.reset) {
		stateRespinBoard.counter.resets += 1;
		stateRespinBoard.counter.note = 'reset';
	}
	eventEmitter.broadcast({
		type: 'respinCounterUpdate',
		left: event.left,
		start: event.start,
		reset: event.reset,
	});
	await waitPresentation(event.reset ? RESET_BEAT_MS : RESPIN_PAUSE_MS);
	if (stateRespinBoard.counter.note === 'reset') stateRespinBoard.counter.note = null;
};

/**
 * `holdAndWinState` — the server's whole picture of the open feature. Enough on its own to put the
 * board up from nothing (a resume replays only this), with no intro: the held layer and the counter
 * are rebuilt from it and every free cell is blank. On a board that is already up it is the
 * self-correction point — the held layer is re-synced, so a misread step lasts one respin at most.
 */
export const presentHoldAndWinState = async (event: Beat<'holdAndWinState'>) => {
	const opening = !stateRespinBoard.shown;
	if (opening) featureCountedIntoBar = 0;
	showRespinBoard();
	syncLetters();
	updateCounter(event.snapshot);
	// An expanding board's open rows are the server's from here on — a resume opens them at once.
	if (event.snapshot.rows !== undefined) openRespinRowsTo(event.snapshot.rows);
	stateRespinBoard.counter.show = true;
	if (opening) eventEmitter.broadcast({ type: 'respinBoardShow' });
};

/**
 * `meterLevels` — the pots read the recorded levels themselves; the held layer follows the recorded
 * picture at once.
 */
export const syncHoldAndWin = async () => {
	if (stateRespinBoard.shown) syncHeldCells();
};

/**
 * `holdAndWinEnd` — the final board holds for a moment, then every tallied coin flies into the Total
 * Win bar (`flyCoinsToTotal`) and the bar COUNTS UP as each lands: that coin's amount is added on its
 * `flightArrive`, whatever order the flights finish in (`tallyCountUp`). What was banked on the way
 * (jackpots; swept columns, unless their own beat already counted them into the bar) is added once
 * the last coin is in, and the bar settles on what it read before the feature plus `total` —
 * exactly, whatever the rounded per-coin amounts sum to. Once the bar has landed and held, the reel
 * board comes back on the feature's final board, the trigger spin's wins cleared AND forgotten
 * (`winPresentationForget`) so the round's resting cycle and pop cannot replay them over the coins.
 * The round's own `setWin` (big-win tier) / `setTotalWin`, which follow unchanged, play over what
 * it ended on.
 *
 * A celebration (`startsCelebration`): the slam is re-armed before it and the button is inert
 * through it. Should a slam reach it anyway, the flights compress and every landing value is still
 * written — nothing is skipped but time.
 */
export const presentHoldAndWinEnd = async (event: Beat<'holdAndWinEnd'>) => {
	if (!stateRespinBoard.shown) return;
	await waitPresentation(END_HOLD_MS);
	const order = [...event.payload.cells].sort((a, b) => a.reel - b.reel || a.row - b.row);
	// Swept columns already reached the bar during the feature; only the rest of `banked` is left.
	const counted = Math.min(featureCountedIntoBar, event.payload.banked);
	featureCountedIntoBar = 0;
	const banked = event.payload.banked - counted;
	const tally = tallyCountUp({
		start: stateBet.winBookEventAmount,
		amounts: order.map((cell) => cell.amount),
		banked,
		total: event.total - counted,
	});
	const step = (index: number, amount: number, shown: number) => {
		stateBet.winBookEventAmount = shown;
		eventEmitter.broadcast({ type: 'respinTallyStep', index, amount, total: shown });
	};
	await flyCoinsToTotal(order, (index) => step(index, order[index].amount, tally.arrive(index)));
	if (stateBet.winBookEventAmount !== tally.final) {
		// The bar is still counting to the last coin's value: let it land, THEN hold the beat, or the
		// banked part joins mid-count and the beat is never seen.
		if (banked > 0) await waitPresentation(TALLY_LAND_MS + BANKED_BEAT_MS);
		step(order.length, tally.final - stateBet.winBookEventAmount, tally.final);
	}
	const amount = bookEventAmountToCurrencyString(event.total);
	const total = featureTotalText(amount);
	const totalBanner = total
		? showHoldAndWinBanner({ kind: 'featureTotal', title: total, size: 'small' })
		: 0;
	await waitPresentation(TALLY_LAND_MS + TALLY_HOLD_MS);
	hideHoldAndWinBanner(totalBanner);
	const outro = featureOutroText(amount);
	if (outro) {
		const banner = showHoldAndWinBanner({ kind: 'featureOutro', title: outro, size: 'large' });
		await waitPresentation(FEATURE_LINE_MS);
		hideHoldAndWinBanner(banner);
	}
	eventEmitter.broadcast({ type: 'winPresentationForget' });
	// A Hold and Win GAME's reels rest on the feature's final board. On a pots overlay host the feature
	// is a bonus, and the base board returns with the host's symbols as the trigger spin left them
	// (design §3.4): its final board is mostly `blank`, which a host has no art for, so the reels
	// would read as empty.
	if (!holdAndWinIsOverlayBonus(getActiveGameConfig())) settleReelsOnHeldCells();
	hideRespinBoard();
};
