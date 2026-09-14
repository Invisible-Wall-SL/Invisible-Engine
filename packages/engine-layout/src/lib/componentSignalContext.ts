import { setContext, getContext } from 'svelte';

/**
 * Signal-anim context for `componentInstance` expansion (§8.5). The signal sibling of
 * `componentParamsContext`: `<ComponentInstance>` subscribes the game's registered signal
 * sources and, on each fire, writes what the cue asks for into a reactive
 * `nodeId → { animation | clipId, loop, fire }` map provided here; the cued node inside
 * `def.root` reads its own entry via {@link getComponentSignalAnims} and prefers it over its
 * static value — a spine over its `defaultAnimation`, a flipbook over its `clipId`. No provider
 * (a top-level scene node with no `componentInstance` ancestor) ⇒ `undefined`, and that node
 * falls back to its OWN scene-level subscription in `LayoutNodeView` instead.
 *
 * `fire` is a monotonic per-instance counter bumped on EVERY cue fire. A cue is an event but is
 * delivered here as state, so without it a second fire of the same cue (a second free-spin
 * feature in one session, a screen gate reopening) is value-identical to the first and the spine
 * never replays — it stays frozen on the finished track's last frame.
 */
const NS = '@@engine_layout_component_signal_anims';

/**
 * What a fired cue asks the node to play — exactly one field, chosen by the cued node's kind.
 * Split out from {@link ComponentSignalAnim} so a caller can build the payload where the node kind
 * is still narrowed, then stamp the bookkeeping (`fire`) on separately.
 */
export type ComponentCuePayload = { animation?: string; clipId?: string };

export type ComponentSignalAnim = {
	/** SPINE cue — the animation to play. Set for a spine node's cue; absent for a flipbook's. */
	animation?: string;
	/** FLIPBOOK cue — the clip to swap to. Set for a flipbook node's cue; absent for a spine's.
	 *  Exactly one of `animation` / `clipId` is populated per entry, decided by the cued node's
	 *  kind; the map is keyed by node id, so the two never collide on one entry. */
	clipId?: string;
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
