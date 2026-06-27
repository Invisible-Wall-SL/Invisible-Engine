import { setContext, getContext } from 'svelte';

import type { SpineRestOverride } from './types';

/**
 * Per-instance RESTING spine overrides for `componentInstance` expansion — the
 * at-rest sibling of `componentStateAnimContext`. `<ComponentInstance>` provides
 * the placement's `spineRestOverrides` map (`spineNodeId → { defaultAnimation,
 * loop, skin }`) here; the spine node inside `def.root` reads its own entry via
 * {@link getComponentSpineRest} and prefers each present field over its static
 * value. No provider (a scene-level spine, or a placement with no overrides) ⇒
 * `undefined`, so that spine is byte-identical to today (it uses the def's
 * `defaultAnimation` / `loop` / `skin`).
 */
const NS = '@@engine_layout_component_spine_rest';

export function setComponentSpineRest(map: Record<string, SpineRestOverride>): void {
	setContext(NS, map);
}

export function getComponentSpineRest(): Record<string, SpineRestOverride> | undefined {
	return getContext(NS);
}
