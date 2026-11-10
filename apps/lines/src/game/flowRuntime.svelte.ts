/**
 * Invisible Flow — the apps/lines runtime wiring (Phase 4, design doc §8, §9 row 4).
 *
 * Builds the engine-flow interpreter wired to THIS game's real primitives — the same
 * `eventEmitter`, `stateBetDerived.timeScale`, and `waitForTimeout` the coded path uses
 * (design doc §8 — "the game wires it to the same primitives the coded path uses at boot")
 * — and the live editor doc's scenes (for the generic mounter to resolve).
 *
 * LOADING IS NOW GENERIC (flow-driven-game §1): the coded `<LoadingScreen>` path was removed,
 * so an un-authored game no longer falls through to a coded splash. Instead `createLinesFlow`
 * SYNTHESIZES a default `loading → basegame` FlowDoc (`synthesizeDefaultFlowDoc`), so the
 * interpreter ALWAYS exists at boot, starts on `loading`, and advances to `basegame` on the
 * loading bar's `completeOnLoaded` capability (or a tap). The synthetic doc carries `events: []`,
 * so book events STILL fall through to the coded `bookEventHandlerMap` (the game's presentation
 * is otherwise unchanged — only the loading/dismiss display moved to the generic mounter).
 *
 * Authored presentation is a Flow v2 graph (`flowV2Runtime`); when one drives screens this
 * interpreter is not built at all (`Game.svelte`).
 *
 * It OBSERVES the XState platform FSM and book events; it NEVER drives a platform transition
 * (§12). The dispatcher's coded handlers are the un-authored fall-through.
 */

import type { FlowDoc, ScreenEntrance } from 'engine-flow';
import { createFlowInterpreter } from 'engine-flow';
import type { LayoutDoc, Scene } from 'engine-layout';
import { basegameSceneId, loadingSceneId, sceneByRole } from 'engine-layout';

import { freeSpinsRemaining, freeSpinsTotal } from 'engine-game';
import { stateBet, stateBetDerived } from 'state-shared';
import { BOOK_AMOUNT_MULTIPLIER } from 'constants-shared/bet';

import { awaitCue, waitPresentation } from './unskippablePresentation';

import type { ResolvedMeter } from 'game-config';
import { boardDimensions } from './gameConfig';
import type { LinesEngineKey } from './flowEngineKeys';
import { featureWorth, stateHoldAndWin } from './stateHoldAndWin.svelte';
import { jackpotMultiplier } from './holdAndWinJackpots.svelte';
import { configuredMeters, meterLevelShown } from './holdAndWinMeters.svelte';
import { platformJackpotValue } from './platformJackpot.svelte';
import { eventEmitter } from './eventEmitter';
import { getFlowInterpreter } from './flowInterpreterHolder';
import { stateGame } from './stateGame.svelte';
import { isFreeGameType, stateModes } from './stateModes.svelte';
import { bookEventHandlerMap } from './bookEventHandlerMap';
import { flowEffect } from './flowEffects';
import type { BookEvent, BookEventContext } from './typesBookEvent';

/**
 * Resolve a value display's engine FEED: the Flow interpreter's value-binding override
 * (`resolveValueSource`, design doc §11.4), else the display's own `source` verbatim (auto-bind by
 * name, §11.2 rule 3). Registered into engine-layout's `registerFlowValueSource` so
 * `<ComponentInstance>` calls it at the subscription site. Interpreter absent ⇒ `source` unchanged.
 */
export const linesValueResolver = (instanceId: string, source: string): string =>
	getFlowInterpreter()?.resolveValueSource(instanceId, source) ?? source;

/** A jackpot tier's prize in book-event units (× total bet, like `win`) — a progressive tier's live
 *  pool; 0 when the game's Game Config names no such tier. */
const jackpotAmount = (tier: string): number => jackpotMultiplier(tier) * BOOK_AMOUNT_MULTIPLIER;

/**
 * The bounded `$engine.*` reader (flow-driven-game §3, design doc §11.4) — a CLOSED key→value
 * map over LIVE engine state, NOT an expression VM. A `condition`/`bookEvent`/`complete` edge
 * guard (or a Branch) reads one of these keys via `{ kind: 'engine', key }`; the interpreter
 * resolves it through this getter when it evaluates the guard.
 *
 * Every value is sourced from the SAME live state singletons the four component registries read
 * (`registerComponentValues` / `registerComponentVisibility` in `Game.svelte`), so there is one
 * source of truth — a guard sees exactly what a bound readout/gate sees:
 *  - `balance` / `win` / `totalWin` / `bet` — the numeric value feeds (mirror `ENGINE_PARAM_CATALOG`).
 *  - `gameType` — `'basegame'` | `'freegame'` (the same field `baseGameShow`/`freeGameShow` gate on).
 *  - `freeSpinsRemaining` / `freeSpinsTotal` — the live free-spin counter (the `freeSpins` feed's parts).
 *  - `isFreeGame` — boolean convenience for the common base/free branch.
 *  - `reels` — the Flow v2 `reels` COLLECTION (`$engine.reels`): `[{ index }, …]`, one per board reel,
 *    so a v2 `forEach` (e.g. the `StaggerStop` per-reel stagger) can iterate the reels. Sourced from
 *    the live board length (falls back to the static reel count before the first spin lands).
 *  - Hold and Win — `respinsLeft` / `respinTotal` / `featureWorth` / `activeModifiers` /
 *    `enhancements` from
 *    `stateHoldAndWin`, and `jackpot.<tier>` from the Game Config's jackpot table.
 *  - `meter.<id>.level|max|stage|full` — a pot as it is drawn (`holdAndWinMeters`, the same reads as
 *    the HUD's `meter.<id>.*` sources, `full` a boolean here). A project's meters are config data, so
 *    these are a pattern ({@link METER_READS}), declared per meter by the pots overlay add-on.
 *
 * The fixed set is `LINES_ENGINE_KEYS` (`flowEngineKeys.ts`). Other keys resolve `undefined` (a
 * guard over an unknown key is simply false) — the bounded-accessor line we do not cross (no
 * arbitrary state reads, §11.4). Pure-read: calling it never mutates state, so it is harmless to
 * inject for every fixture (a doc with no `$engine.*` guard never calls it).
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

/**
 * The DEFAULT `loading → basegame` flow every game boots (the coded loading path is gone —
 * flow-driven-game §1).
 *
 * Active-SET semantics (the pin-driven model): `loading` is the `initial` (base) screen, so it —
 * and ONLY it — is active at boot; `basegame` is NOT yet active, so the reel board is HIDDEN
 * behind the loading splash (the board mount in `Game.svelte` gates on the base-game screen being
 * active). The `complete` edge (fired by the loading bar's `completeOnLoaded` capability, or a
 * tap) DEACTIVATES `loading` and ACTIVATES `basegame` — the splash unmounts and the reels appear
 * on the clean, undimmed background. `basegame` has no `complete`-triggered outgoing edge, so it
 * PERSISTS thereafter (celebration overlays layer over it and remove themselves on their Complete).
 * `events: []`, so book events fall through to the coded `bookEventHandlerMap`.
 *
 * Returns `undefined` (inert) if the loading or basegame scene can't be resolved, so nothing
 * crashes on a boot with no such scenes (keeps the coded path).
 */
const synthesizeDefaultFlowDoc = (editorDoc: LayoutDoc): FlowDoc | undefined => {
	const loadingId = loadingSceneId(editorDoc.scenes);
	const basegameId = basegameSceneId(editorDoc.scenes);
	const hasLoading =
		sceneByRole(editorDoc.scenes, 'loading') !== undefined ||
		editorDoc.scenes.some((scene) => scene.id === loadingId);
	const hasBasegame =
		sceneByRole(editorDoc.scenes, 'basegame') !== undefined ||
		editorDoc.scenes.some((scene) => scene.id === basegameId);
	if (!hasLoading || !hasBasegame) return undefined;

	return {
		version: 1,
		projectKey: editorDoc.projectKey ?? 'lines',
		screens: [{ id: loadingId, initial: true }, { id: basegameId }],
		transitions: [
			{
				id: `${loadingId}→${basegameId}`,
				from: loadingId,
				to: basegameId,
				trigger: { kind: 'complete' },
			},
		],
		events: [],
	};
};

/** The interpreter handle the game holds; `undefined` when the doc has no loading/basegame scene. */
export type LinesFlow = ReturnType<typeof createFlowInterpreter<BookEvent, BookEventContext>>;

/**
 * Build the interpreter from the default flow + the live editor doc. Returns `undefined` when
 * the doc has no loading/basegame scene — the game then runs entirely coded (parity).
 * `editorDoc` is the live LayoutDoc the game already loads; the generic mounter resolves a
 * screen id to its `Scene` from it, so an authored screen mounts the SAME scene the editor
 * authored (the real scenes, untouched).
 */
export const createLinesFlow = (
	editorDoc: LayoutDoc,
	/** Notified whenever the interpreter's active SET changes (a screen was added/removed —
	 *  the pin-driven active-SET model). The ids are render-ordered (base first, overlays on
	 *  top). The game uses it to drive a `$state` so the mounted scenes re-render — the
	 *  interpreter's internal active set is a plain array (not a rune), so a getter read alone
	 *  is not reactive. Absent ⇒ no notification (headless harnesses don't need it). `entrances`
	 *  lists the screens NEWLY activated by this change with the firing edge's entrance transition
	 *  (the droppable "Transition" node, design doc §6) — the game uses it to fade a screen in. */
	onActiveScreensChange?: (
		screenIds: readonly string[],
		entrances: readonly ScreenEntrance[],
	) => void,
	/** Invoke a game INTENT on a host screen (design doc §8.5) — the target of an `action → intent`
	 *  edge. Supplied by `Game.svelte` (it needs the live `context` state): dispatches each HUD intent
	 *  (`spin`/`increase`/`decrease`/`turbo`/`menu`) to that button's exact coded behaviour. An unknown
	 *  intent, or an absent bridge, is a safe no-op (parity §8.8). */
	invokeIntent?: (screenId: string, intent: string) => void,
): LinesFlow | undefined => {
	const flowDoc = synthesizeDefaultFlowDoc(editorDoc);
	if (!flowDoc) return undefined;

	const resolveScene = (screenId: string): Scene | undefined =>
		editorDoc.scenes.find((scene) => scene.id === screenId);

	return createFlowInterpreter<BookEvent, BookEventContext>({
		flowDoc,
		onActiveScreensChange,
		invokeIntent,
		// The bounded `$engine.*` reader (flow-driven-game §3) — sourced from the SAME live state
		// the component value/visibility registries read, so a `condition`/Branch guard sees the
		// same engine values a bound readout/gate does. Harmless to inject for every fixture: a
		// guard that reads no `$engine.*` key never calls it (parity). A guard over an `$engine.*`
		// key returns `undefined` (false) until `evaluate()` is pinged on a value change.
		engine: linesEngineReader,
		runtime: {
			emitter: {
				broadcast: (e) => eventEmitter.broadcast(e as never),
				broadcastAsync: (e) => awaitCue(e.type, eventEmitter.broadcastAsync(e as never)),
			},
			// The LIVE turbo scalar — the same `stateBetDerived.timeScale()` the coded
			// `waitForTimeout(ms / timeScale())` call sites read, so a turbo toggle mid-round
			// scales the interpreter's delays identically (design doc §8, speed).
			timeScale: stateBetDerived.timeScale,
			// Slam-aware delay: every authored Delay node and awaited Broadcast collapses when the
			// player slams the round, so a flow-driven presentation fast-forwards exactly like the
			// coded one — except inside an unskippable presentation (the book reveal / free-spin
			// intro), where a Delay paces a rig nothing cancels and so stays a real wait.
			// Un-slammed ⇒ identical to `waitForTimeout`.
			waitForTimeout: waitPresentation,
			// The game-side EFFECT registry — the `declare ≠ implement` bridge for the
			// non-emitter leaves (state mutations, board ops, win-level sound clusters). The
			// effect bodies are lifted VERBATIM from the coded handlers (`flowEffects.ts`), so
			// an authored `effect` node is byte-identical to its coded counterpart (§3, §11.4).
			effect: flowEffect,
		},
		resolveScene,
		codedHandlers: bookEventHandlerMap,
	});
};
