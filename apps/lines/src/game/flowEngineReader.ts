import { freeSpinsRemaining, freeSpinsTotal } from 'engine-game';
import type { ResolvedMeter } from 'game-config';
import { stateBet, stateBetDerived } from 'state-shared';
import { BOOK_AMOUNT_MULTIPLIER } from 'constants-shared/bet';

import { boardDimensions } from './gameConfig';
import type { LinesEngineKey } from './flowEngineKeys';
import { featureWorth, stateHoldAndWin } from './stateHoldAndWin.svelte';
import { jackpotMultiplier } from './holdAndWinJackpots.svelte';
import { configuredMeters, meterLevelShown } from './holdAndWinMeters.svelte';
import { platformJackpotValue } from './platformJackpot.svelte';
import { stateGame } from './stateGame.svelte';
import { isFreeGameType, stateModes } from './stateModes.svelte';

/** A jackpot tier's prize in book-event units (× total bet, like `win`) — a progressive tier's live
 *  pool; 0 when the game's Game Config names no such tier. */
const jackpotAmount = (tier: string): number => jackpotMultiplier(tier) * BOOK_AMOUNT_MULTIPLIER;

/**
 * The bounded `$engine.*` reader (flow-driven-game §3, design doc §11.4) — a CLOSED key→value
 * map over LIVE engine state, NOT an expression VM. A Flow v2 `$engine.<key>` read, a branch over
 * one and the `$engine.reels` collection resolve through it (`flowV2Runtime.svelte.ts`).
 *
 * Every value is sourced from the SAME live state singletons the four component registries read
 * (`registerComponentValues` / `registerComponentVisibility` in `Game.svelte`), so there is one
 * source of truth — a flow sees exactly what a bound readout/gate sees:
 *  - `balance` / `win` / `totalWin` / `bet` — the numeric value feeds (mirror `ENGINE_PARAM_CATALOG`).
 *  - `gameType` — `'basegame'` | `'freegame'` (the same field `baseGameShow`/`freeGameShow` gate on).
 *  - `freeSpinsRemaining` / `freeSpinsTotal` — the live free-spin counter (the `freeSpins` feed's parts).
 *  - `isFreeGame` — boolean convenience for the common base/free branch.
 *  - `reels` — the `reels` COLLECTION (`$engine.reels`): `[{ index }, …]`, one per board reel, so a
 *    `forEach` (e.g. the `StaggerStop` per-reel stagger) can iterate the reels. Sourced from the live
 *    board length (falls back to the static reel count before the first spin lands).
 *  - Hold and Win — `respinsLeft` / `respinTotal` / `featureWorth` / `activeModifiers` /
 *    `enhancements` from `stateHoldAndWin`, and `jackpot.<tier>` from the Game Config's jackpot table.
 *  - `meter.<id>.level|max|stage|full` — a pot as it is drawn (`holdAndWinMeters`, the same reads as
 *    the HUD's `meter.<id>.*` sources, `full` a boolean here). A project's meters are config data, so
 *    these are a pattern ({@link METER_READS}), declared per meter by the pots overlay add-on.
 *
 * The fixed set is `LINES_ENGINE_KEYS` (`flowEngineKeys.ts`). Other keys resolve `undefined` — the
 * bounded-accessor line we do not cross (no arbitrary state reads, §11.4). Pure-read: calling it
 * never mutates state.
 */
const ENGINE_READS: Record<LinesEngineKey, () => unknown> = {
	balance: () => stateBet.balanceAmount,
	win: () => stateBet.winBookEventAmount,
	totalWin: () => stateBet.winBookEventAmount,
	bet: () => stateBetDerived.betCost(),
	gameType: () => stateGame.gameType,
	isFreeGame: () => isFreeGameType(stateGame.gameType),
	activeMode: () => stateModes.active(),
	modeDepth: () => stateModes.state.stack.length,
	queuedModes: () => stateModes.state.queue.length,
	freeSpinsRemaining: () => freeSpinsRemaining(),
	freeSpinsTotal: () => freeSpinsTotal(),
	// Autoplay, so an authored auto-spin screen can reproduce what the coded button does. The
	// HUD auto-spin button is DUAL — open the menu when idle, STOP a live run otherwise — and a
	// flow that owns its press suppresses that coded body, so without a readable counter the
	// stop half would be unauthorable. Branch on `isAutoSpinning` to route the press to
	// `stopAutoSpins` instead of `Show`.
	autoSpinsRemaining: () => stateBet.autoSpinsCounter,
	isAutoSpinning: () => stateBet.autoSpinsCounter !== 0,
	// The `reels` collection: one `{ index }` per board reel. Prefer the live board length
	// (post-spin), else the static reel count (boardDimensions().x) so `$engine.reels` is a
	// usable list even before the first reveal.
	reels: () => {
		const count = stateGame.board?.length || boardDimensions().x;
		return Array.from({ length: count }, (_unused, index) => ({ index }));
	},
	// Hold and Win: the server's picture (`stateHoldAndWin`), recorded at the play seam BEFORE an
	// event is presented, so a guard in an event's chain already reads that event's outcome.
	respinsLeft: () => stateHoldAndWin.left,
	respinTotal: () => stateHoldAndWin.start,
	featureWorth,
	activeModifiers: () => [...stateHoldAndWin.activeModifiers],
	enhancements: () => [...(stateHoldAndWin.enhancements ?? [])],
	'jackpot.mini': () => jackpotAmount('mini'),
	'jackpot.minor': () => jackpotAmount('minor'),
	'jackpot.major': () => jackpotAmount('major'),
	'jackpot.grand': () => jackpotAmount('grand'),
	// The operator platform jackpot (any kind): money, like `balance`.
	'platformJackpot.mini': () => platformJackpotValue('mini'),
	'platformJackpot.minor': () => platformJackpotValue('minor'),
	'platformJackpot.major': () => platformJackpotValue('major'),
	'platformJackpot.grand': () => platformJackpotValue('grand'),
};

/**
 * `meter.<id>.*` for every meter `resolveMeters` lists — the Hold and Win block's AND the pots
 * overlay's, so an overlay pot answers its config max and stages before any server level is
 * recorded. An id the config does not declare reads `undefined`, like any other unknown key.
 */
const meterMaxOf = (meter: ResolvedMeter): number =>
	stateHoldAndWin.meters.find((m) => m.id === meter.id)?.max ?? meter.maxLevel;
const METER_READS: Record<
	'level' | 'max' | 'stage' | 'full',
	(meter: ResolvedMeter) => number | boolean
> = {
	level: (meter) => meterLevelShown(meter.id),
	max: meterMaxOf,
	stage: (meter) => meter.sizeStages.filter((stage) => meterLevelShown(meter.id) >= stage).length,
	full: (meter) => meterMaxOf(meter) > 0 && meterLevelShown(meter.id) >= meterMaxOf(meter),
};
const METER_KEY = /^meter\.(.+)\.(level|max|stage|full)$/;

export const linesEngineReader = (key: string): unknown => {
	if (Object.hasOwn(ENGINE_READS, key)) return ENGINE_READS[key as LinesEngineKey]();
	const match = METER_KEY.exec(key);
	const meter = match && configuredMeters().find((m) => m.id === match[1]);
	return meter ? METER_READS[match[2] as keyof typeof METER_READS](meter) : undefined;
};
