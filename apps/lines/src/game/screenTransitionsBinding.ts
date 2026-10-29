import { elementFxHostFor } from 'pixi-svelte';
import { particleTimeScale } from 'pixi-svelte/particleClock';
import { playScreenTransition, waitForScreenTransition } from 'pixi-svelte/screenFx';
import { LAYER_BAND_SCREEN_TRANSITION } from 'engine-layout';

import type { ScreenTransitionsApi } from './screenTransitions';

type App = Parameters<typeof playScreenTransition>[0];

/**
 * The game's {@link ScreenTransitionsApi} over `pixi-svelte`'s transition runtime (Invisible Shader
 * Graph 8e.2): the still above every band the game draws, below the input mask, on the game's turbo
 * clock. The app is read on each call, so the binding can be made before the canvas is up.
 */
export const screenTransitionsOn = (app: () => App): ScreenTransitionsApi => ({
	play: (transition) => {
		const pixiApp = app();
		const handle = playScreenTransition(
			pixiApp,
			{ ...transition, zIndex: LAYER_BAND_SCREEN_TRANSITION },
			elementFxHostFor(pixiApp, particleTimeScale),
		);
		return { captured: handle.captured, done: handle.done };
	},
	wait: () => waitForScreenTransition(app()),
});
