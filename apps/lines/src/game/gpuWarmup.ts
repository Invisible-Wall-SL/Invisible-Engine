import { prewarmCameraEffects, type GpuWarmup } from 'pixi-svelte';
import { prewarmElementFx } from 'pixi-svelte/elementFx';

import { bakedBundleData } from '../editor-scenes';
import { authoredFxUses } from './authoredFxUses';

/**
 * The game's half of the loader's GPU warm-up (`pixi-svelte` `gpuWarmup.ts`): compile every
 * Element FX and camera effect its docs can play, one program a step, so none stalls the frame it
 * first plays on. Read when the load ends, after the runtime bundle and the custom effects are in.
 */
export const gameFxWarmup: GpuWarmup = (renderer) => {
	const uses = authoredFxUses(bakedBundleData());
	return [
		...uses.elementFx.map((use) => () => prewarmElementFx(renderer, use)),
		() => prewarmCameraEffects(renderer, uses.camera),
	];
};
