import type { Scene } from 'engine-layout';

import { activeRespinMode } from './activeRespinMode.svelte';
import { modeScreenFor } from './respinModes';

/**
 * WHICH SCREEN DRAWS A RESPIN MODE'S BEAT, for the mode playing now. Each respin mode has its own copy
 * of the reference respin screens, so a second mode's beat is drawn by its own screen and not by the
 * first mode's (`modeScreenFor`).
 */

let scenes = $state.raw<readonly Scene[]>([]);

/** The game's screens, published by `Game.svelte` whenever its layout doc changes. */
export const publishRespinScreens = (next: readonly Scene[]): void => {
	scenes = next;
};

/** The id of the screen that draws `screen`'s beat for the active respin mode (reactive). */
export const activeModeScreen = (screen: string): string =>
	modeScreenFor(scenes, activeRespinMode()?.mode, screen);
