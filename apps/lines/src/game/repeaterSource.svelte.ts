import type { RepeaterItem, RepeaterSource } from 'engine-layout';

/**
 * Wrap a runes getter as a {@link RepeaterSource} — the list sibling of `valueSource`. On
 * `subscribe(run)` it calls `run` with the current items SYNCHRONOUSLY (the store contract —
 * first paint has a real list), then spins up an `$effect.root` whose `$effect` re-reads
 * `getter()` (capturing its reactive deps) and pushes every change to `run`, returning the
 * root's stop fn as the unsubscribe. So a registered source replays the live selector
 * (`stateMeta.betModeMeta` × `stateBet.betAmount`) to whichever `repeater` node binds it.
 */
export function repeaterSource(getter: () => RepeaterItem[]): RepeaterSource {
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
