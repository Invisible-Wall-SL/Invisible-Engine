/**
 * The arcade seam of the `arcade3d` runtime (`docs/design/3d-games.md`): the arcade family as it is,
 * with its play field drawn in 3D. `config-vite` `familySeams()` resolves `families/arcade` to this
 * module only in a build with `PUBLIC_IE_3D=1`, so no other runtime compiles it or anything it
 * imports.
 */
import { VIEW_3D_ACTION_NAMES, withView3d, type TemplateVocabulary } from 'engine-flow-v2';

import { ARCADE3D_FLOW_ACTIONS, ARCADE3D_VOCAB, registerCamera3dFlow } from '../game/camera3dFlow';
import { reserveWorld3dCanvas } from '../game/world3dCanvas';

// Before the Pixi context exists, so its auto-opaque check sees a world under it (`world3dCanvas.ts`).
reserveWorld3dCanvas();
// The camera's Flow words are backed from boot: a call before the field mounts waits for it.
registerCamera3dFlow();

export * from './arcade';
export { default as ArcadeStage } from '../components/ArcadeStage3D.svelte';
// A 3D game joins the 3D room; any other online game the 2D one (`game/online3d.ts`).
export { joinOnlineRoom } from '../game/online3d';

/** The arcade vocabulary with the 3D camera's words in place of the 2D world camera's, plus the 3D
 *  view's own actions (`openGraphics`, `withView3d`). */
export const flowVocabularies: Readonly<Record<string, TemplateVocabulary>> = {
	[ARCADE3D_VOCAB.templateId]: withView3d(ARCADE3D_VOCAB, true),
};
/** The Flow actions the family backs: the arcade loop's, the 3D camera's and the 3D view's. */
export const flowBoardActions: readonly string[] = [
	...ARCADE3D_FLOW_ACTIONS,
	...VIEW_3D_ACTION_NAMES,
];
