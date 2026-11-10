import { declareRenderNeeds, needsBackdropBlend } from 'pixi-svelte';

import { bakedBundleData } from '../editor-scenes';

/**
 * Tell the renderer, before `<App>` creates it, whether this game's authored content can draw a
 * blend mode that reads the backdrop, so `pixi-svelte`'s `renderOptions.ts` can leave out the back
 * buffer only such a mode needs. A boot with no authored data yet (a dev or live-doc boot) says
 * nothing, which keeps it.
 */
export function declareGameRenderNeeds(): void {
	const data = bakedBundleData();
	declareRenderNeeds(data === undefined ? {} : { backdropBlend: needsBackdropBlend(data) });
}
