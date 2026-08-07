/**
 * The generic SCENE CAMERA-TRANSFORM bridge (`declare ≠ implement`, mirroring
 * `registerComponentVisibility` / `registerComponentValues`). A scene opts into the shared camera
 * move with `Scene.zoomWithAnticipation`; engine-layout stays generic — it knows only that "there
 * is one registered world-space transform a `game`-space screen may follow", never what the game
 * zooms about.
 *
 * The game (e.g. `apps/lines`) registers ONE source that returns the current `{ scale, x, y }` in
 * main-layout world space — the SAME transform its reel-anticipation camera applies. `<LayoutScene>`
 * reads it and wraps an opted-in `game`-space screen's content INSIDE its `MainContainer`, so the
 * screen scales + pans about the identical focal point as the board (one coherent camera move, not
 * two independent zooms).
 *
 * Unregistered ⇒ `getSceneCameraTransform()` is `undefined` ⇒ `<LayoutScene>` adds NO wrapper, so a
 * game with no camera renders byte-identically. The source is expected to return identity
 * (`{ scale: 1, x: 0, y: 0 }`) whenever the move is inactive, so an opted-in screen also renders
 * unchanged while nothing is armed.
 */

/** A world-space camera transform: a uniform `scale` about the child origin plus a pan `{ x, y }`
 *  that keeps the focal point fixed (`x = focalX·(1 − scale)`), in main-layout coordinates. */
export type SceneCameraTransform = { scale: number; x: number; y: number };

/** Reads the LIVE transform (called per render, so a reactive source's tween tracks). */
export type SceneCameraTransformSource = () => SceneCameraTransform;

let source: SceneCameraTransformSource | undefined;

/** Register the game's world-space camera transform source (once, at boot). */
export const registerSceneCameraTransform = (fn: SceneCameraTransformSource): void => {
	source = fn;
};

/** The registered source, or `undefined` when the game registered none (⇒ no scene follows). */
export const getSceneCameraTransform = (): SceneCameraTransformSource | undefined => source;
