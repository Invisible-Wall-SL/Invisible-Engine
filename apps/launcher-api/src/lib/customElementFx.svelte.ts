import { browser } from '$app/environment';
import { setCustomElementFx } from 'constants-shared/elementFx';
import { untrack } from 'svelte';

/**
 * The project's compiled shader effects as an editor page registers them, so its Element FX pickers
 * list them, its rows read them and its ▶ plays them (`docs/design/invisible-shader-graph.md` §8
 * step 4). The registry in `constants-shared/elementFx` is a plain module value; a `$derived` that
 * reads it also reads {@link customElementFxVersion}, which every registration bumps.
 */
let version = $state(0);

export const customElementFxVersion = (): number => version;

/**
 * Replace the page's custom Element FX with `effects` (its `customElementFx` load data): once at
 * init on a page that reloads when its project changes, in an `$effect.pre` on that data on one
 * that follows it in place. In the browser only: the registry is module state, which a server
 * render would share across requests.
 */
export function registerCustomElementFx(effects: readonly unknown[] | undefined): void {
	if (!browser) return;
	setCustomElementFx(effects ?? []);
	// Untracked, so an effect that registers does not also depend on the count it bumps.
	untrack(() => version++);
}
