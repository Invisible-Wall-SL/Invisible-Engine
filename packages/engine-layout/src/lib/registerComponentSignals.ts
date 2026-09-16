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
 * is re-exported from the bare `engine-layout` (type-only) entry. A signal nothing
 * ever fires ⇒ the spine falls back to `defaultAnimation` (parity).
 *
 * TWO buses live here. The `registry` is the closed, game-wired half described above.
 * The `open` bus below is the author-named half: a name the game never registered is
 * still subscribable, and the flow runtime fires every `fireCue` name into it — so a
 * cue signal an author types in the Scene Editor reaches the spine with no coded entry.
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

/**
 * The OPEN bus — subscribers for a signal name the game never registered, keyed by name.
 * Where the `registry` above is wired ONCE at boot (a fixed set of engine signals mapped from
 * book events), this is the author-named half: any name a scene's spine `cue` mentions gets a
 * live channel, and {@link emitComponentSignal} fires it. The game's flow runtime emits every
 * `fireCue` name here, so an author can invent `characterSpin` in the Scene Editor, fire it from
 * a Flow `fireCue` node, and have the spine react — WITHOUT a coded `registerComponentSignals`
 * entry per animation trigger.
 *
 * A registered name always WINS (see {@link getComponentSignal}), so the two names that are both
 * a vocab cue and a catalog signal (`specialBookReveal` / `specialBookHide`) resolve exactly as
 * before through their emitter subscription and cannot double-fire.
 */
const open = new Map<string, Set<() => void>>();

const openSource = (key: string): SignalSource => ({
	subscribe(run) {
		let subs = open.get(key);
		if (!subs) {
			subs = new Set();
			open.set(key, subs);
		}
		subs.add(run);
		return () => {
			const current = open.get(key);
			if (!current) return;
			current.delete(run);
			if (current.size === 0) open.delete(key);
		};
	},
});

export function registerComponentSignals(sources: Record<string, SignalSource>): void {
	for (const [signal, source] of Object.entries(sources)) {
		registry.set(signal, source);
	}
}

/**
 * Fire an OPEN-bus signal by name. A no-op when nothing subscribes that name — which is the
 * common case (the game broadcasts every flow cue through here, and only a handful are named by
 * a spine cue). Iterates a COPY so a subscriber that unsubscribes during the fire (a spine whose
 * cue swaps the mounted tree) can't corrupt the walk. Never touches the registry, so a
 * game-registered signal is unaffected.
 */
export function emitComponentSignal(key: string): void {
	const subs = open.get(key);
	if (!subs) return;
	for (const run of [...subs]) run();
}

/**
 * Resolve a signal name to its source. A GAME-REGISTERED source wins; anything else falls back to
 * the open bus, so an author-named cue signal is always subscribable. Always returns a source —
 * an unknown name yields a dormant open channel that simply never fires (the old `undefined`
 * meant "skip this cue", which is what made an author-named signal impossible).
 */
export function getComponentSignal(key: string): SignalSource {
	return registry.get(key) ?? openSource(key);
}

/**
 * Is `key` a GAME-REGISTERED signal (so {@link getComponentSignal} resolves it against the closed
 * registry and the open bus never drives it)? The distinction is invisible to a cue's author — the
 * two names that are BOTH a vocabulary cue and a catalog signal (`specialBookReveal` /
 * `specialBookHide`) look like any other — but it decides who reports completion: a registered
 * name's emitter subscriber returns a real completion promise, so a caller measuring the cue's
 * animation on top would stack a SECOND, longer wait onto a cue that already waits correctly.
 * Exposed for exactly that check (`flowV2Runtime`'s `cueAnimationMs`).
 */
export function isRegisteredComponentSignal(key: string): boolean {
	return registry.has(key);
}

/**
 * The one component-LIFECYCLE signal: fired by an instance itself on its visible edge and by no
 * source. It is in the catalog but NOT in the registry, so both subscribe loops skip it explicitly
 * — otherwise the open bus would hand it a subscription it never had, and an author naming a scene
 * cue `enter` could replay every mounted component's intro at once. Callers that reason about who
 * drives a cue must skip it for the same reason.
 */
export const ENTER_SIGNAL = 'enter';

export function clearComponentSignals(): void {
	registry.clear();
	open.clear();
}
