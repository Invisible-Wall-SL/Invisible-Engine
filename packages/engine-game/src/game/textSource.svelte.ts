import type { TextSource } from 'engine-layout';

/**
 * Wrap a runes getter as a {@link TextSource} (§16.4 B6.4) — the STRING sibling of
 * {@link boolSource}/{@link valueSource}, the minimal Svelte-store `subscribe`
 * contract the engine action-feed registry consumes for a button's live LABEL. On
 * `subscribe(run)` it calls `run` with the current value SYNCHRONOUSLY (the store
 * contract — first paint has a real caption), then spins up an `$effect.root` whose
 * `$effect` re-reads `getter()` (capturing its reactive deps) and pushes every
 * change to `run`, returning the root's stop fn as the unsubscribe. So a registered
 * action replays the live caption (the spin button's `bet()`↔`stop()` flip) to
 * whichever `button` instance binds it.
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
