import type { Scene } from './types';

/**
 * Cross-screen z-order from the editor's screen-list order (design doc §11.5 follow-up).
 *
 * A game's `Game.svelte` paints its LAYERABLE screens — the HUD chrome, the base-game
 * overlays, the special-book bonus, custom author overlays, and the flow takeover — in a
 * FIXED markup sequence, so reordering them in the Scene Editor's screen list has no
 * in-game effect. This helper turns each layerable scene's position in the doc `scenes[]`
 * array into an explicit `zIndex`, so the editor's list order drives the paint order
 * (PixiJS sorts a container's children by `zIndex`; equal zIndex keeps insertion order).
 *
 * It is deliberately SCOPED: the reel board (`<MainContainer>`) and the engine-owned
 * full-screen free-spin gates + their `waitForResolve` subscriber are NOT layerable — they
 * stay at their fixed engine-owned z (outside the band below), so no editor ordering can move
 * the board out from between the below/above-reel slices or duplicate a gate. Background
 * scenes and the loading splash also stay outside (behind / above the band).
 *
 * The band: layerable scenes get `LAYER_BAND_BASE + docIndex`, which sits ABOVE the base
 * game (default 0) and BELOW the engine gates/loading (`LAYER_BAND_TOP`). `docIndex` is the
 * scene's position in `scenes[]`, so the editor's top-to-bottom list order maps to
 * back-to-front paint order. A scene not in the doc contributes no override.
 *
 * PARITY: the reference/fallback LayoutDoc lists its layerable scenes in the SAME relative
 * order as the coded markup (HUD → basegameOverlays → specialBook), so a flow-less / un-
 * reordered boot assigns zIndexes that reproduce today's exact stacking — byte-identical.
 * Only an author who REORDERS these scenes in the editor changes the result.
 */

/** Base zIndex of the layerable band — above the base game (0), below the engine top band. */
export const LAYER_BAND_BASE = 100;
/** Fixed z for the TRANSIENT active-screen takeover (the loading splash at boot + mid-round
 *  celebrations like `bigWin`). Above every doc-ordered layerable scene (so the boot splash is
 *  never buried under `basegameOverlays`/`specialBook`, matching the old markup where the
 *  takeover sat OVER the base + HUD + overlays) and below the engine top band. A takeover is a
 *  transient overlay, not an author-placed persistent layer, so it sits at one fixed band rather
 *  than a doc-ordered z. */
export const LAYER_BAND_TAKEOVER = 9_000;
/** Fixed z for the engine-owned top layer (free-spin gates, info overlay) — always above every
 *  doc-ordered layerable scene AND the takeover, so a reorder can never bury a blocking gate. */
export const LAYER_BAND_TOP = 10_000;

/**
 * The zIndex a layerable scene should mount at, from its position in the doc `scenes[]`.
 * Returns `undefined` when the id isn't in the doc (no override — the mount keeps its default
 * z / markup insertion order), so a game with an un-authored scene is unaffected (parity).
 */
export const docLayerZIndex = (
	scenes: Scene[],
	sceneId: string | undefined,
): number | undefined => {
	if (sceneId === undefined) return undefined;
	const index = scenes.findIndex((scene) => scene.id === sceneId);
	return index < 0 ? undefined : LAYER_BAND_BASE + index;
};
