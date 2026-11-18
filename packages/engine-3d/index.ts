/**
 * Invisible Engine's 3D view (`docs/design/3d-games.md`): a three.js world drawn in its own canvas
 * UNDER the game's transparent Pixi canvas, so the HUD stays on top and takes the input.
 *
 * Only the `arcade3d` runtime reaches this package, through a dynamic import in
 * `apps/lines/src/components/ArcadeStage3D.svelte`, so three.js is one lazy chunk of that runtime and
 * absent from every other (`pnpm check:runtime-bytes`). It declares `three`; nothing else may.
 */
export * from './pure';
export { GRAPHICS_SETTING_KEY, readGpu3d, readGraphicsSetting } from './src/device';
export { listenKeys3d, type Keys3d } from './src/input';
export {
	mountWorld3d,
	type BodyLooks3d,
	type View3d,
	type World3d,
	type World3dOptions,
} from './src/world';
export {
	createCharacterModels3d,
	type Character3d,
	type CharacterModels3d,
} from './src/characters';
export { createCast3d, type Cast3d } from './src/cast';
