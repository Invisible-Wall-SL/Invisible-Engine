import type { Scene } from './types';

/**
 * Cross-screen z-order from the editor's screen-list order (design doc §11.5 follow-up).
 *
 * A game's `Game.svelte` paints its LAYERABLE screens — the HUD chrome, the base-game
 * overlays, the special-book bonus, custom author overlays, and the flow's active-screen
 * takeover — in a FIXED markup sequence, so reordering them in the Scene Editor's screen
 * list would have no in-game effect. `sceneLayerZIndex` turns each scene's position in the
 * doc `scenes[]` array into an explicit `zIndex`, so the editor's list order drives the
 * paint order (PixiJS sorts a container's children by `zIndex`; equal zIndex keeps
 * insertion order).
 *
 * It is deliberately SCOPED: the reel board (`<MainContainer>`) and the engine-owned
 * full-screen free-spin gates + their `waitForResolve` subscriber are NOT layerable — they
 * stay at their fixed engine-owned z (outside the bands below), so no editor ordering can
 * move the board out from between the below/above-reel slices or duplicate a gate.
 * Background scenes also stay outside (behind the band).
 *
 * The bands: a screen gets `LAYER_BAND_BASE + docIndex`, which sits ABOVE the base game
 * (default 0) and BELOW the engine gates (`LAYER_BAND_TOP`). `docIndex` is the scene's
 * position in `scenes[]`, so the editor's top-to-bottom list order maps to back-to-front
 * paint order. A screen the author ticked "Always on top" ({@link Scene.alwaysOnTop})
 * instead gets `LAYER_BAND_TAKEOVER + docIndex` — above every list-ordered screen, still
 * ordered among its fellow pinned screens. A scene not in the doc contributes no override.
 *
 * PARITY: the reference/fallback LayoutDoc lists its layerable scenes in the SAME relative
 * order as the coded markup (HUD → basegameOverlays → specialBook), so a flow-less / un-
 * reordered boot assigns zIndexes that reproduce today's exact stacking — byte-identical.
 * Only an author who REORDERS these scenes in the editor changes the result.
 */

/** Base zIndex of the layerable band — above the base game (0), below the pinned band. */
export const LAYER_BAND_BASE = 100;
/** Base zIndex of the PINNED band — where a screen the author ticked "Always on top"
 *  ({@link Scene.alwaysOnTop}) mounts, above every list-ordered screen and below the engine
 *  top band. For a transient overlay that must never be buried (the loading splash at boot,
 *  a mid-round `bigWin` celebration). 1000 of headroom below {@link LAYER_BAND_TOP}, so a
 *  pinned screen still carries its doc index and pinned screens keep their list order. */
export const LAYER_BAND_TAKEOVER = 9_000;
/** Fixed z for the engine-owned top layer (free-spin gates, info overlay) — always above
 *  every list-ordered AND pinned screen, so no authoring can bury a round-blocking gate. */
export const LAYER_BAND_TOP = 10_000;

/**
 * The zIndex a screen mounts at — the SINGLE resolver every mount path uses, so one screen
 * has one z no matter which path renders it (the coded overlay mount, the HUD layer, the
 * flow's active-screen takeover, or a v2 flow container). The takeover path used to pin its
 * screen at a hard-coded {@link LAYER_BAND_TAKEOVER} while every other path read the doc
 * order — so the SAME screen layered differently depending on how it happened to be mounted,
 * and reordering a flow-active screen in the editor did nothing.
 *
 * - ticked "Always on top" ⇒ `LAYER_BAND_TAKEOVER + docIndex` (author opted OUT of list
 *   ordering; still ordered against other pinned screens).
 * - otherwise ⇒ `LAYER_BAND_BASE + docIndex` — the screen-list position drives the stacking.
 *
 * Returns `undefined` when the id isn't in the doc (no override — the mount keeps its
 * default z / markup insertion order), so a game with an un-authored scene is unaffected.
 */
export const sceneLayerZIndex = (
	scenes: Scene[],
	sceneId: string | undefined,
): number | undefined => {
	if (sceneId === undefined) return undefined;
	const index = scenes.findIndex((scene) => scene.id === sceneId);
	if (index < 0) return undefined;
	return (scenes[index].alwaysOnTop ? LAYER_BAND_TAKEOVER : LAYER_BAND_BASE) + index;
};

/** True when the screen is pinned above the list-ordered band ({@link sceneLayerZIndex}). */
export const isSceneLayerPinned = (z: number | undefined): boolean =>
	z !== undefined && z >= LAYER_BAND_TAKEOVER;
