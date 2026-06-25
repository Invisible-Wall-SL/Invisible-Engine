import { setContext, getContext } from 'svelte';

/**
 * Button-state-anim context for `componentInstance` expansion — the INTERACTION
 * sibling of `componentSignalContext`. `<ComponentInstance>` resolves the current
 * button state (hover / press / selected / disabled / spinning) for every spine node
 * carrying a `stateAnimations` map and writes the cascaded `{ animation, loop }` into
 * a reactive `nodeId → …` map provided here; the spine node inside `def.root` reads
 * its own entry via {@link getComponentStateAnims} and prefers it over both the
 * signal-cue override and its static `defaultAnimation`. No provider (a scene-level
 * spine, or a non-interactive component) ⇒ `undefined`, so that spine is
 * byte-identical to today — it just uses the signal cue / `defaultAnimation` (parity).
 */
const NS = '@@engine_layout_component_state_anims';

export function setComponentStateAnims(
	map: Record<string, { animation: string; loop?: boolean }>,
): void {
	setContext(NS, map);
}

export function getComponentStateAnims():
	| Record<string, { animation: string; loop?: boolean }>
	| undefined {
	return getContext(NS);
}
