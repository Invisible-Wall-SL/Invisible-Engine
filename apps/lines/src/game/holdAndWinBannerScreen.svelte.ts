import { bannerScreenFor, bannerScreenShows } from 'engine-layout';
import { isComponentMounted, sceneMountKey } from 'engine-layout/svelte';

import { stateHoldAndWinBanner } from './holdAndWinBanner.svelte';
import { activeModeScreen } from './respinScreens.svelte';

/** Is banner screen `screen` mounted — for a mode screen, the active respin mode's copy? */
const mounted = (screen: string): boolean =>
	isComponentMounted(sceneMountKey(activeModeScreen(screen)));

/**
 * WHICH AUTHORED SCREEN DRAWS THE BANNER UP NOW (reactive), by its reference id; `undefined` when
 * none is mounted, or no banner is up, and the coded banner draws it. The coded banner steps aside
 * on it.
 */
export const bannerScreen = (): string | undefined => {
	const current = stateHoldAndWinBanner.current;
	return current ? bannerScreenFor(current.kind, mounted) : undefined;
};

/** A banner screen's visibility source (`HOLD_AND_WIN_BANNER_SHOW_SOURCES`, reactive). */
export const bannerShows = (screen: string): boolean => {
	const current = stateHoldAndWinBanner.current;
	return current ? bannerScreenShows(current.kind, screen, mounted) : false;
};
