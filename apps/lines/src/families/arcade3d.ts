/**
 * The arcade seam of the `arcade3d` runtime (`docs/design/3d-games.md`): the arcade family as it is,
 * with its play field drawn in 3D. `config-vite` `familySeams()` resolves `families/arcade` to this
 * module only in a build with `PUBLIC_IE_3D=1`, so no other runtime compiles it or anything it
 * imports.
 */
import { registerCamera3dFlow } from '../game/camera3dFlow';
import { reserveWorld3dCanvas } from '../game/world3dCanvas';

// Before the Pixi context exists, so its auto-opaque check sees a world under it (`world3dCanvas.ts`).
reserveWorld3dCanvas();
// The camera's Flow words are backed from boot: a call before the field mounts waits for it.
registerCamera3dFlow();

export * from './arcade';
export { default as ArcadeStage } from '../components/ArcadeStage3D.svelte';
// A 3D game joins the 3D room; any other online game the 2D one (`game/online3d.ts`).
export { joinOnlineRoom } from '../game/online3d';
// The arcade vocabulary with the 3D camera's words in place of the 2D world camera's.
export {
	ARCADE3D_FLOW_ACTIONS as flowBoardActions,
	ARCADE3D_FLOW_VOCABULARIES as flowVocabularies,
} from '../game/camera3dFlow';
