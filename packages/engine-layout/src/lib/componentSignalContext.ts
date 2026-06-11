import { setContext, getContext } from 'svelte';

/**
 * Signal-anim context for `componentInstance` expansion (§8.5, spine-only). The
 * signal sibling of `componentParamsContext`: `<ComponentInstance>` subscribes the
 * game's registered signal sources and, on each fire, writes the cue's animation
 * into a reactive `nodeId → { animation, loop }` map provided here; the spine node
 * inside `def.root` reads its own entry via {@link getComponentSignalAnims} and
 * prefers it over its static `defaultAnimation`. No provider (a top-level scene
 * spine with no `componentInstance` ancestor) ⇒ `undefined`, so that spine is
 * byte-identical to today — it just uses `defaultAnimation` (parity).
 */
const NS = '@@engine_layout_component_signal_anims';

export function setComponentSignalAnims(
	map: Record<string, { animation: string; loop?: boolean }>,
): void {
	setContext(NS, map);
}

export function getComponentSignalAnims():
	| Record<string, { animation: string; loop?: boolean }>
	| undefined {
	return getContext(NS);
}
