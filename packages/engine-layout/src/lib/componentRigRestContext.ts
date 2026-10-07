import { setContext, getContext } from 'svelte';

import type { RigRestOverride } from './types';

/**
 * Per-instance RESTING rig overrides for `componentInstance` expansion — the
 * at-rest sibling of `componentStateAnimContext`. `<ComponentInstance>` provides
 * the placement's `spineRestOverrides` map (`rigNodeId → { defaultAnimation,
 * loop, skin }`) here; the rig node inside `def.root` reads its own entry via
 * {@link getComponentRigRest} and prefers each present field over its static
 * value. No provider (a scene-level rig, or a placement with no overrides) ⇒
 * `undefined`, so that rig is byte-identical to today (it uses the def's
 * `defaultAnimation` / `loop` / `skin`).
 */
const NS = '@@engine_layout_component_rig_rest';

export function setComponentRigRest(map: Record<string, RigRestOverride>): void {
	setContext(NS, map);
}

export function getComponentRigRest(): Record<string, RigRestOverride> | undefined {
	return getContext(NS);
}
