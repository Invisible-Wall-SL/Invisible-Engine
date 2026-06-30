/**
 * Invisible Flow — the apps/lines runtime wiring (Phase 4, design doc §8, §9 row 4).
 *
 * Builds the engine-flow interpreter wired to THIS game's real primitives — the same
 * `eventEmitter`, `stateBetDerived.timeScale`, and `waitForTimeout` the coded path uses
 * (design doc §8 — "the game wires it to the same primitives the coded path uses at boot")
 * — and the live editor doc's scenes (for the generic mounter to resolve).
 *
 * PARITY-FIRST (the §7 invariant, non-negotiable): the FlowDoc source is ABSENT by default,
 * so the interpreter is INERT and the game mounts + animates ENTIRELY via its coded path —
 * byte-identical to current `main`. A FlowDoc reaches the game only via:
 *   - the baked `flow` slot in `BakedBundle` (Phase 6 — the real ship source), filled by the
 *     export→deploy→bake→register chain; absent for an un-baked `apps/lines` dev boot;
 *   - dev-only escape hatches on top: `window.__IE_FLOW_DOC__` (an arbitrary FlowDoc, the
 *     Phase-4 ad-hoc live-verify hook), `window.__IE_FLOW_LOADING__` (the committed
 *     `LINES_FLOW_LOADING_DOC` loading→basegame entry-leg fixture, flow-driven-game §1),
 *     `window.__IE_FLOW_WIN__` (the committed `LINES_FLOW_WIN_DOC` win-presentation-transitions
 *     fixture, flow-driven-game §2), and `window.__IE_FLOW_LINES__` (the committed full
 *     `LINES_FLOW_DOC` fixture), none set on a normal boot.
 * With none of these present this module is a pure no-op, byte-identical to current `main`.
 *
 * It OBSERVES the XState platform FSM and book events; it NEVER drives a platform transition
 * (§12). The dispatcher's coded handlers are the un-authored fall-through.
 */

import type { FlowDoc } from 'engine-flow';
import { createFlowInterpreter } from 'engine-flow';
import type { LayoutDoc, Scene } from 'engine-layout';
import { stateBet, stateBetDerived, stateUi } from 'state-shared';
import { waitForTimeout } from 'utils-shared/wait';

import { bakedFlowDoc } from '../editor-scenes';
import { eventEmitter } from './eventEmitter';
import { stateGame } from './stateGame.svelte';
import { bookEventHandlerMap } from './bookEventHandlerMap';
import { flowEffect } from './flowEffects';
import {
	LINES_FLOW_COND_DOC,
	LINES_FLOW_DOC,
	LINES_FLOW_LOADING_DOC,
	LINES_FLOW_WIN_DOC,
} from './flowDoc';
import type { BookEvent, BookEventContext } from './typesBookEvent';

declare global {
	// eslint-disable-next-line no-var
	var __IE_FLOW_DOC__: FlowDoc | undefined;
	// eslint-disable-next-line no-var
	var __IE_FLOW_LINES__: boolean | undefined;
	// eslint-disable-next-line no-var
	var __IE_FLOW_LOADING__: boolean | undefined;
	// eslint-disable-next-line no-var
	var __IE_FLOW_WIN__: boolean | undefined;
	// eslint-disable-next-line no-var
	var __IE_FLOW_COND__: boolean | undefined;
}

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
 *
 * Keys outside this set resolve `undefined` (a guard over an unknown key is simply false) — the
 * bounded-accessor line we do not cross (no arbitrary state reads, §11.4). Pure-read: calling it
 * never mutates state, so it is harmless to inject for every fixture (a doc with no `$engine.*`
 * guard never calls it).
 */
const linesEngineReader = (key: string): unknown => {
	switch (key) {
		case 'balance':
			return stateBet.balanceAmount;
		case 'win':
		case 'totalWin':
			return stateBet.winBookEventAmount;
		case 'bet':
			return stateBetDerived.betCost();
		case 'gameType':
			return stateGame.gameType;
		case 'isFreeGame':
			return stateGame.gameType === 'freegame';
		case 'freeSpinsRemaining':
			return Math.max(stateUi.freeSpinCounterTotal - stateUi.freeSpinCounterCurrent, 0);
		case 'freeSpinsTotal':
			return stateUi.freeSpinCounterTotal;
		default:
			return undefined;
	}
};

/** The closed set of `$engine.*` keys the lines reader exposes (the bounded vocabulary, §11.4).
 *  Exported so the game can drive `evaluate()` only on changes to these — and so a harness can
 *  assert the vocabulary is closed. */
export const LINES_ENGINE_KEYS = [
	'balance',
	'win',
	'totalWin',
	'bet',
	'gameType',
	'isFreeGame',
	'freeSpinsRemaining',
	'freeSpinsTotal',
] as const;

/**
 * Source the authored FlowDoc. ABSENT by default ⇒ the interpreter is inert (parity, §7).
 *
 * Precedence — dev escape hatches FIRST (so a live-verify override always wins), then the
 * REAL ship source, the baked `BakedBundle.flow` slot:
 *  - `window.__IE_FLOW_DOC__` — an arbitrary FlowDoc injected at runtime (the Phase-4 hook,
 *    kept for ad-hoc single-screen/event live-verify);
 *  - `window.__IE_FLOW_LINES__` — load the COMMITTED, complete apps/lines FlowDoc
 *    (`LINES_FLOW_DOC` in `flowDoc.ts`) — the Phase-5 full-migration fixture, for live-verify
 *    without a deploy/bake;
 *  - `bakedFlowDoc()` — the FlowDoc embedded in the baked bundle by the export→deploy→bake
 *    chain (Phase 6, the real ship path). UNDEFINED on an un-baked / un-authored boot — incl.
 *    `apps/lines` dev with no globals set — so `loadFlowDoc()` returns `undefined`, the
 *    interpreter is inert, and the game is byte-identical to current `main` (§7).
 */
export const loadFlowDoc = (): FlowDoc | undefined => {
	if (typeof globalThis !== 'undefined') {
		if (globalThis.__IE_FLOW_DOC__) return globalThis.__IE_FLOW_DOC__;
		// Phase 1 (flow-driven-game §1) — the loading→basegame entry-leg fixture, for live-verify
		// of the tap-to-enter leg without a deploy/bake. Checked BEFORE the full `LINES_FLOW_DOC`
		// so a loading-leg verify wins. Unset on a normal boot ⇒ inert (parity, §7).
		if (globalThis.__IE_FLOW_LOADING__) return LINES_FLOW_LOADING_DOC;
		// Phase 2 (flow-driven-game §2) — the win-presentation-transitions fixture, for
		// live-verify of the win-branch leg (big-win + free-spin-intro as exclusive screen nodes,
		// small win as a feed-driven overlay) without a deploy/bake. Checked before the full
		// `LINES_FLOW_DOC` so a win-branch verify wins. Unset on a normal boot ⇒ inert (parity, §7).
		if (globalThis.__IE_FLOW_WIN__) return LINES_FLOW_WIN_DOC;
		// Phase 3 (flow-driven-game §3) — the engine-state `condition`-transition fixture, for
		// live-verify of branching on LIVE engine state (a `$engine.*` guard) without a deploy/bake.
		// Checked before the full `LINES_FLOW_DOC`. Unset on a normal boot ⇒ inert (parity, §7).
		if (globalThis.__IE_FLOW_COND__) return LINES_FLOW_COND_DOC;
		if (globalThis.__IE_FLOW_LINES__) return LINES_FLOW_DOC;
	}
	return bakedFlowDoc();
};

/** The interpreter handle the game holds (or `undefined` when no FlowDoc ⇒ pure coded path). */
export type LinesFlow = ReturnType<typeof createFlowInterpreter<BookEvent, BookEventContext>>;

/**
 * Build the interpreter from the (optional) FlowDoc + the live editor doc. Returns
 * `undefined` when no FlowDoc is authored — the game then runs entirely coded (parity).
 * `editorDoc` is the live LayoutDoc the game already loads; the generic mounter resolves a
 * screen id to its `Scene` from it, so an authored screen mounts the SAME scene the editor
 * authored (the real scenes, untouched).
 */
export const createLinesFlow = (
	editorDoc: LayoutDoc,
	/** Notified whenever the interpreter's active screen swaps (Phase 1 loading↔basegame). The
	 *  game uses it to drive a `$state` so the mounted scene re-renders — the interpreter's
	 *  internal `activeScreenId` is a plain variable (not a rune), so a getter read alone is not
	 *  reactive. Absent ⇒ no notification (headless harnesses don't need it). */
	onActiveScreenChange?: (screenId: string | undefined) => void,
): LinesFlow | undefined => {
	const flowDoc = loadFlowDoc();
	if (!flowDoc) return undefined;

	const resolveScene = (screenId: string): Scene | undefined =>
		editorDoc.scenes.find((scene) => scene.id === screenId);

	return createFlowInterpreter<BookEvent, BookEventContext>({
		flowDoc,
		onActiveScreenChange,
		// The bounded `$engine.*` reader (flow-driven-game §3) — sourced from the SAME live state
		// the component value/visibility registries read, so a `condition`/Branch guard sees the
		// same engine values a bound readout/gate does. Harmless to inject for every fixture: a
		// guard that reads no `$engine.*` key never calls it (parity). A guard over an `$engine.*`
		// key returns `undefined` (false) until `evaluate()` is pinged on a value change.
		engine: linesEngineReader,
		runtime: {
			emitter: {
				broadcast: (e) => eventEmitter.broadcast(e as never),
				broadcastAsync: (e) => eventEmitter.broadcastAsync(e as never),
			},
			// The LIVE turbo scalar — the same `stateBetDerived.timeScale()` the coded
			// `waitForTimeout(ms / timeScale())` call sites read, so a turbo toggle mid-round
			// scales the interpreter's delays identically (design doc §8, speed).
			timeScale: stateBetDerived.timeScale,
			waitForTimeout,
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
