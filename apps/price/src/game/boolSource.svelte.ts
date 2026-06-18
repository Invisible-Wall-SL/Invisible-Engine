import type { BoolSource } from 'engine-layout';

/**
 * Wrap a runes getter as a {@link BoolSource} — the boolean sibling of
 * {@link textSource}, the minimal Svelte-store `subscribe` contract the engine
 * visibility-feed registry consumes. On `subscribe(run)` it calls `run` with the
 * current value SYNCHRONOUSLY, then spins up an `$effect.root` whose `$effect`
 * re-reads `getter()` and pushes every change to `run`, returning the root's stop
 * fn as the unsubscribe. The `freeSpinCounter` componentInstance gates its whole
 * subtree on a source backed by one of these.
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
