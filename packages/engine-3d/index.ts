/**
 * Invisible Engine's 3D view (`docs/design/3d-games.md`): a three.js world drawn in its own canvas
 * UNDER the game's transparent Pixi canvas, so the HUD stays on top and takes the input.
 *
 * Only the `arcade3d` runtime reaches this package, through a dynamic import in
 * `apps/lines/src/components/ArcadeStage3D.svelte`, so three.js is one lazy chunk of that runtime and
 * absent from every other (`pnpm check:runtime-bytes`). It declares `three`; nothing else may.
 */
export * from './pure';
export {
	GRAPHICS_SETTING_KEY,
	readGpu3d,
	readGraphicsSetting,
	writeGraphicsSetting,
} from './src/device';
export { cameraMovesOf, loadCameraMoves3d } from './src/cameraMoves';
export { listenKeys3d, type Keys3d } from './src/input';
// The placeholder arena's camera moves (`tools/blender/ie_camera_move.py --sample`), shipped like
// the arena itself until levels and their moves are authored data.
export { default as SAMPLE_CAMERA_MOVES_URL } from './fixtures/cameras/sample.glb?url';
export { mountWorld3d, type View3d, type World3d, type World3dOptions } from './src/world';
