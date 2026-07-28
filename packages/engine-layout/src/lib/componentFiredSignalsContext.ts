import { getContext, setContext } from 'svelte';

import type { FiredSignalCounts } from './signalGates';

/**
 * Fired-signal context for `componentInstance` expansion (Invisible Flow — intro-complete
 * sequencing). The reveal/arm sibling of `componentSignalContext` (which carries the animation a
 * spine plays): this carries WHICH component-scoped signals have FIRED for the instance, and a
 * `fire` callback a descendant can call.
 *
 * `<ComponentInstance>` owns a reactive `counts` map (a `$state` proxy) and bumps a signal's count
 * whenever it fires — `enter` on the visible edge, a game-registered signal when its book event
 * arrives, or a spine one-shot's authored `completeSignal` on completion (the descendant spine calls
 * `fire`). Nodes gated by `hiddenUntilSignal` read `counts` to reveal (via {@link isNodeRevealed}),
 * and the instance's own tap surface reads it to arm (`tapArmAfterSignal`). Because `counts` is the
 * instance's own reactive proxy, reads across the component boundary stay reactive.
 *
 * No provider (a top-level scene node with no `componentInstance` ancestor) ⇒ `undefined`, so those
 * gates default OPEN and `fire` is a no-op — byte-identical to today (parity).
 */
const NS = '@@engine_layout_component_fired_signals';

export interface ComponentFiredSignals {
	/** Reactive per-instance fire-count per component-scoped signal (read to gate reveal/arm). */
	counts: FiredSignalCounts;
	/** Fire a component-scoped signal for this instance (bumps its count). No-op for an empty name. */
	fire: (signal: string | undefined) => void;
}

export function setComponentFiredSignals(value: ComponentFiredSignals): void {
	setContext(NS, value);
}

export function getComponentFiredSignals(): ComponentFiredSignals | undefined {
	return getContext(NS);
}
