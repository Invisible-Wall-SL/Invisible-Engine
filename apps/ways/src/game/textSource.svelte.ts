import type { TextSource } from 'engine-layout';

/**
 * Wrap a runes getter as a {@link TextSource} — the minimal Svelte-store
 * `subscribe` contract the engine value-feed registry consumes for a STRING feed.
 * On `subscribe(run)` it calls `run` with the current value SYNCHRONOUSLY (the
 * store contract — first paint has a real string), then spins up an `$effect.root`
 * whose `$effect` re-reads `getter()` and pushes every change to `run`, returning
 * the root's stop fn as the unsubscribe. The `freeSpinCounter` componentInstance
 * binds its value node to a source backed by one of these.
 */
export function textSource(getter: () => string): TextSource {
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
