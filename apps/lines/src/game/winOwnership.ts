/**
 * Invisible Flow — WIN OVERLAY ownership (design doc §14, the win-overlay TWIN of the FS-7 outro).
 *
 * PURE + dependency-light (types only from `engine-layout`), so the SAME decision is shared by
 * `Game.svelte`'s win mount site AND a headless spike — no rune/state imports, so it runs identically
 * in a Node harness and in the game boot. Mirrors the outro helpers in `freeSpinOwnership.ts`
 * (`hasAuthoredFreeSpinOutro` / `resolveFreeSpinOutroMount`), reduced for the win overlay: there is no
 * per-step machinery and no v1 `ownsOutro` twin (the win overlay's v1 / non-flow path is the coded
 * composer `bind:Win`, which draws itself and is never an engine mount), so the mount is a single
 * `driver | gate | null` rather than a two-band shape.
 */

import type { Scene } from 'engine-layout';

/** The canonical WIN overlay screen/container id — the same `bigWin` `activeScreenId` the spin-button
 *  celebration lock keys off (`Game.svelte`), so an authored win container reuses it verbatim. */
export const WIN_SCREEN_ID = 'bigWin';

/** The coded WIN bind-anchor component names the reference / driven-seed `bigWin` scene carries — a
 *  node bound to any of them is coded scaffolding, NOT authored content. `WinVisual` is the
 *  positionable count/spine visual (the driven seed); `Win` is the OFF composer (gate + visual);
 *  `WinGate` is the bare full-screen gate. Mirrors `FS_OUTRO_CODED_ANCHORS`. */
const WIN_CODED_ANCHORS = ['Win', 'WinGate', 'WinVisual'] as const;

/** The coded WIN SUBSCRIBER-gate component names — a `bigWin` scene that binds one already owns the
 *  `winUpdate` count-up + round-block (it is the sole subscriber), so the engine gate must stand down.
 *  Subset of `WIN_CODED_ANCHORS` WITHOUT the pure `WinVisual` (which reads `winState` but does NOT
 *  subscribe `winUpdate`). Mirrors the `FreeSpinOutro`/`FreeSpinOutroGate` set in `freeSpinOwnership`. */
const WIN_CODED_GATES = ['Win', 'WinGate'] as const;

/**
 * Does the `bigWin` scene carry AUTHOR-REBUILT content (≥1 top-level node that is NOT a coded win
 * bind-anchor)? TRUE ⇒ the author has rebuilt the overlay from primitives (own dim / count text /
 * spine / tap), so the engine mounts the HEADLESS driver (count-up + `winState` publish only) and
 * lets the authored container own the dim / tap / art. FALSE — the driven seed binds only `WinVisual`
 * (or nothing, or no scene) — ⇒ the engine keeps the full `<WinGate>` (big-win dim + count-up), so the
 * driven-seed / Book of Borut presentation is byte-identical. Mirrors `hasAuthoredFreeSpinOutro`.
 */
export const hasAuthoredWin = (scenes: readonly Scene[]): boolean => {
	const scene = scenes.find((s) => s.id === WIN_SCREEN_ID);
	if (!scene) return false;
	return scene.nodes.some(
		(node) =>
			!(
				node.bind?.component &&
				(WIN_CODED_ANCHORS as readonly string[]).includes(node.bind.component)
			),
	);
};

/**
 * Does the authored `bigWin` scene itself bind a coded `Win`/`WinGate`? When TRUE that coded gate is
 * already the sole `winUpdate` subscriber, so the engine gate stands down (else two subscribers each
 * hold the round on `winUpdate` and HANG it). The analog of `basegameOverlaysHasCodedWinGate` for the
 * authored container band; the caller OR's the two so the engine mounts iff NEITHER scene binds one.
 * Mirrors `freeSpinOutroHasCodedGate`. No `bigWin` scene ⇒ `false` (parity).
 */
export const bigWinHasCodedWinGate = (scenes: readonly Scene[]): boolean => {
	const scene = scenes.find((s) => s.id === WIN_SCREEN_ID);
	if (!scene) return false;
	return scene.nodes.some(
		(node) =>
			node.bind?.component && (WIN_CODED_GATES as readonly string[]).includes(node.bind.component),
	);
};

/** What the engine mounts at the WIN band. `driver` = the HEADLESS `<WinGate headless>` (count-up +
 *  `winState` publish, NO dim) when the container is author-rebuilt; `gate` = the full `<WinGate>`
 *  (big-win dim + count-up) for the driven seed; `null` = nothing (a coded `Win`/`WinGate` already
 *  subscribes, or a non-flow game where the coded composer owns the overlay). */
export type WinMount = 'driver' | 'gate' | null;

/**
 * The SINGLE decision for which WIN surface mounts, so the mount site can't drift from the
 * exactly-one-`winUpdate`-subscriber invariant. The engine participates ONLY under a v2 flow that
 * DRIVES the screens (`flowV2DrivesScreens`) — a non-flow / book-events-only game never mounts the
 * engine gate (the coded composer owns it) ⇒ `null` ⇒ byte-identical to today. Under v2 it stands
 * DOWN when a coded gate already subscribes (`winHasCodedGate`, = `basegameOverlaysHasCodedWinGate ||
 * bigWinHasCodedWinGate`), else mounts the headless `driver` when the container is author-rebuilt
 * (`winAuthored`) or the full `gate` for the driven seed.
 *
 * The `winUpdate` SUBSCRIBER COUNT under v2 is `(mount ? 1 : 0) + (winHasCodedGate ? 1 : 0)`, which
 * this guarantees is exactly 1 for every combination (asserted headlessly, `fs7Win`). Mirrors
 * `resolveFreeSpinOutroMount`, reduced to one band.
 */
export const resolveWinMount = (ctx: {
	flowV2DrivesScreens: boolean;
	winHasCodedGate: boolean;
	winAuthored: boolean;
}): WinMount =>
	!ctx.flowV2DrivesScreens || ctx.winHasCodedGate ? null : ctx.winAuthored ? 'driver' : 'gate';
