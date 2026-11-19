/**
 * The arcade seam of the `arcade3d` runtime (`docs/design/3d-games.md`): the arcade family as it is,
 * with its play field drawn in 3D. `config-vite` `familySeams()` resolves `families/arcade` to this
 * module only in a build with `PUBLIC_IE_3D=1`, so no other runtime compiles it or anything it
 * imports.
 */
import {
	ARCADE_LOOP_ACTIONS,
	ARCADE_VOCAB,
	VIEW_3D_ACTION_NAMES,
	withView3d,
	type TemplateVocabulary,
} from 'engine-flow-v2';

import { reserveWorld3dCanvas } from '../game/world3dCanvas';

// Before the Pixi context exists, so its auto-opaque check sees a world under it (`world3dCanvas.ts`).
reserveWorld3dCanvas();

export * from './arcade';
export { default as ArcadeStage } from '../components/ArcadeStage3D.svelte';
// A 3D game joins the 3D room; any other online game the 2D one (`game/online3d.ts`).
export { joinOnlineRoom } from '../game/online3d';

/** The arcade vocabulary plus the 3D view's own actions (`openGraphics`, `withView3d`). */
export const flowVocabularies: Readonly<Record<string, TemplateVocabulary>> = {
	[ARCADE_VOCAB.templateId]: withView3d(ARCADE_VOCAB, true),
};
/** The Flow actions the family backs: the arcade loop's, and the 3D view's (`ArcadeStage3D`). */
export const flowBoardActions: readonly string[] = [
	...ARCADE_LOOP_ACTIONS,
	...VIEW_3D_ACTION_NAMES,
];
