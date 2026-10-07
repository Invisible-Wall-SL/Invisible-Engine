// if you want to generate a static html file
// for your page.
// Documentation: https://kit.svelte.dev/docs/page-options#prerender
export const prerender = true;

// if you want to Generate a SPA
// you have to set ssr to false.
// This is not the case (so set as true or comment the line)
// Documentation: https://kit.svelte.dev/docs/page-options#ssr
export const ssr = false;

// How to manage the trailing slashes in the URLs
// the URL for about page witll be /about with 'ignore' (default)
// the URL for about page witll be /about/ with 'always'
// https://kit.svelte.dev/docs/page-options#trailingslash
export const trailingSlash = 'ignore';

import { prepareRuntimeBundle } from '../editor-scenes';
import { exposeBuildInfo } from '../game/buildInfo';
import { startErrorTracking } from '../game/errorTracking';
import {
	publishExpandMinReelsToFacade,
	publishWinLevelsToFacade,
	resetGameConfigCache,
} from '../game/gameConfig';

/**
 * Live runtime (Invisible Game Maker, Phase 0). OPT-IN via `?runtime=1`: fetch the
 * project's complete runtime bundle (doc + assets) BEFORE the page component (and
 * therefore the pixi `AssetsLoader`) mounts, so the game registers live assets from
 * the launcher instead of the empty baked placeholder. A no-op (instant resolve)
 * when the param is absent, so byte-identical to today for baked + live-doc dev.
 *
 * The delivery profile is NOT loaded here — it is awaited in `<Authenticate>`, which every app
 * mounts, not only `apps/lines` (a game repo compiles these routes too, via `config-svelte`).
 */
export const load = async () => {
	exposeBuildInfo();
	startErrorTracking();
	await prepareRuntimeBundle();
	// Before `<Authenticate>` mounts: a round left open is translated inside `requestAuthenticate`,
	// and the facade stamps its `winLevel`s (and gates a Book-of expansion) from whatever it has been
	// given by then. The memo is dropped first, since a module may have read the config before the
	// runtime bundle landed.
	resetGameConfigCache();
	publishWinLevelsToFacade();
	publishExpandMinReelsToFacade();
	return {};
};
