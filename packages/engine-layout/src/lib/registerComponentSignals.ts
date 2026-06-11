/**
 * Engine signal-feed registry (§8.5, narrowed to spine-only) — the signal sibling
 * of the value-feed (`registerComponentValues`) and the action-feed
 * (`registerComponentActions`). Where a value source pushes the latest NUMBER/STRING
 * and an action source carries `onpress` + live flags, a signal source is an EVENT
 * notifier: it fires when something happens in the game (a book event arrives, a
 * win lands, the round ends) with no payload. The engine `<ComponentInstance>`
 * subscribes it and, on each fire, swaps the animation a spine `cue` named for that
 * signal plays.
 *
 * Sibling discipline: the game wires book-event → signal ONCE at boot
 * (`registerComponentSignals({ win: source })`), keyed by SIGNAL NAME, not by
 * component — so one spine cue named `'win'` binds to the game's win signal across
 * every instance. The EDITOR only declares signal NAMES (a `ComponentDef.signals`
 * entry + a `SpineCue.signal`); it never references the game's wiring.
 *
 * Module-scoped (private to whichever bundled copy of this package the game pulls
 * in — pnpm gives each game its own copy, so no cross-game leakage). Svelte-free:
 * a signal source is just a minimal `subscribe(run)` event contract, so this module
 * is re-exported from the bare `engine-layout` (type-only) entry. No registered
 * signal ⇒ the spine falls back to `defaultAnimation` (parity).
 */

/**
 * Minimal event-notifier contract a signal source must satisfy — kept to bare
 * `subscribe` so this module stays Svelte-free. Unlike {@link ValueSource}, a
 * signal source need NOT fire synchronously on subscribe: it's an EVENT, not state,
 * so `run` is invoked each time the signal fires (the game maps a book event → this)
 * and there is no "current value" to seed at first paint.
 */
export interface SignalSource {
	/** Subscribe to the signal. `run` is invoked each time the signal fires (the
	 * game maps a book event → this). Returns an unsubscribe fn. Unlike a value
	 * source it need NOT fire synchronously on subscribe — it's an event, not state. */
	subscribe(run: () => void): () => void;
}

const registry = new Map<string, SignalSource>();

export function registerComponentSignals(sources: Record<string, SignalSource>): void {
	for (const [signal, source] of Object.entries(sources)) {
		registry.set(signal, source);
	}
}

export function getComponentSignal(key: string): SignalSource | undefined {
	return registry.get(key);
}

export function clearComponentSignals(): void {
	registry.clear();
}
