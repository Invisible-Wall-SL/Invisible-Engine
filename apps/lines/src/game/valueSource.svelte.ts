import type { ValueSource } from 'engine-layout';

/**
 * Wrap a runes getter as a {@link ValueSource} (§14.2 B4.2) — the minimal
 * Svelte-store `subscribe` contract the engine value-feed registry consumes. On
 * `subscribe(run)` it calls `run` with the current value SYNCHRONOUSLY (the
 * store contract — first paint has a real number), then spins up an
 * `$effect.root` whose `$effect` re-reads `getter()` (capturing its reactive
 * deps) and pushes every change to `run`, returning the root's stop fn as the
 * unsubscribe. So a registered source replays the live selector (`stateBet.*` /
 * `betCost()`) to whichever `HudReadout` instance binds it.
 */
export function valueSource(getter: () => number, format?: (value: number) => string): ValueSource {
	return {
		format,
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
