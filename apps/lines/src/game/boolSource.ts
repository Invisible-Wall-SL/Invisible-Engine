import type { BoolSource } from 'engine-layout';

/**
 * Wrap a runes getter as a {@link BoolSource} (§16.3) — the boolean sibling of
 * {@link valueSource}, the minimal Svelte-store `subscribe` contract the engine
 * action-feed registry consumes for a button's live `disabled`/`active` flags. On
 * `subscribe(run)` it calls `run` with the current value SYNCHRONOUSLY (the store
 * contract — first paint has a real flag), then spins up an `$effect.root` whose
 * `$effect` re-reads `getter()` (capturing its reactive deps) and pushes every
 * change to `run`, returning the root's stop fn as the unsubscribe. So a registered
 * action replays the live selector (`stateXstateDerived.isIdle()` / `stateBet.*`) to
 * whichever `button` instance binds it.
 */
export function boolSource(getter: () => boolean): BoolSource {
	return {
		subscribe(run) {
			run(getter());
			return $effect.root(() => {
				$effect(() => {
					run(getter());
				});
			});
		},
	};
}
