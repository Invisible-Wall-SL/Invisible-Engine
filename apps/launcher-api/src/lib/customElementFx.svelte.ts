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
 * Replace the page's custom Element FX with `effects` (its `customElementFx` load data). Call it in
 * an `$effect.pre` on that data, so a project switched in place registers its own set.
 */
export function registerCustomElementFx(effects: readonly unknown[] | undefined): void {
	setCustomElementFx(effects ?? []);
	// Untracked, so an effect that registers does not also depend on the count it bumps.
	untrack(() => version++);
}
