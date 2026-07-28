import { setContext, getContext } from 'svelte';

/**
 * Signal-anim context for `componentInstance` expansion (§8.5, spine-only). The
 * signal sibling of `componentParamsContext`: `<ComponentInstance>` subscribes the
 * game's registered signal sources and, on each fire, writes the cue's animation
 * into a reactive `nodeId → { animation, loop, fire }` map provided here; the spine
 * node inside `def.root` reads its own entry via {@link getComponentSignalAnims} and
 * prefers it over its static `defaultAnimation`. No provider (a top-level scene
 * spine with no `componentInstance` ancestor) ⇒ `undefined`, so that spine is
 * byte-identical to today — it just uses `defaultAnimation` (parity).
 *
 * `fire` is a monotonic per-instance counter bumped on EVERY cue fire. A cue is an event but is
 * delivered here as state, so without it a second fire of the same cue (a second free-spin
 * feature in one session, a screen gate reopening) is value-identical to the first and the spine
 * never replays — it stays frozen on the finished track's last frame.
 */
const NS = '@@engine_layout_component_signal_anims';

export type ComponentSignalAnim = {
	animation: string;
	loop?: boolean;
	fire: number;
	/** Author-named signal to FIRE when this (non-looping) cue animation completes — the one-shot →
	 *  idle hand-off moment. Carried through so `LayoutNodeView` can wire the spine's `oncomplete` to
	 *  the instance's fired-signal bus (reveals `hiddenUntilSignal` siblings, arms the tap). Absent ⇒
	 *  nothing fires on completion (parity). */
	completeSignal?: string;
};

export function setComponentSignalAnims(map: Record<string, ComponentSignalAnim>): void {
	setContext(NS, map);
}

export function getComponentSignalAnims(): Record<string, ComponentSignalAnim> | undefined {
	return getContext(NS);
}
