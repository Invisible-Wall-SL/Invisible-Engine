<script lang="ts">
	import { onMount } from 'svelte';
	import {
		BOOT_SPLASH_INDEX_FILE,
		type BootSplashEntry,
		type BootSplashIndex,
	} from 'constants-shared/bootSplash';
	import LoaderSpine from './LoaderSpine.svelte';

	/**
	 * The pre-game splash SEQUENCE: the engine mark, then the game's own mark, each a spine
	 * exported to `deploy/_boot/` (see `constants-shared/bootSplash`). Replaces the pair of
	 * hardcoded gif loaders — `LoaderStakeEngine` (the old vendor mark, shipped in every app's
	 * `static/`) and `LoaderExample` ("Add Your Loader").
	 *
	 * ORDERING — why this waits instead of mounting straight away. `apps/lines` paints the
	 * `#ie-boot` overlay from the HTML shell at `z-index: 99999`, and holds it until every
	 * asset is loaded. The old gif loaders sat UNDER it at `z-index: 999` and burned their
	 * 2s timers unseen, which is why that mark is invisible online and only shows in the
	 * dev games (whose `app.html` has no shell). Running a spine ANIMATION under an opaque
	 * overlay would be pointless in exactly the same way, so the sequence starts only once
	 * the boot overlay is done — giving the honest order: progress bar → engine mark → game
	 * mark → game. Hosts with no shell (the five dev games, Storybook) start immediately.
	 *
	 * Every failure is a SKIP, never a stall: no index, an empty index, a tier that won't
	 * render — each falls through to `oncomplete` and the game shows.
	 */
	type Props = {
		/** Deploy-tree URL prefix, ending in `/`. Defaults to the baked page-relative mirror;
		 * `apps/lines` passes the launcher's absolute base when booting in runtime mode. */
		assetBase?: string;
		oncomplete?: () => void;
	};

	const { assetBase = 'assets/', oncomplete }: Props = $props();

	type BootShell = { whenDone?: (cb: () => void) => void };

	let queue = $state<BootSplashEntry[]>([]);
	let index = $state(0);
	let started = $state(false);

	const current = $derived(started ? queue[index] : undefined);

	function next() {
		if (index >= queue.length - 1) {
			queue = [];
			oncomplete?.();
			return;
		}
		index += 1;
	}

	onMount(() => {
		let cancelled = false;

		void (async () => {
			let tiers: BootSplashEntry[] = [];
			try {
				const res = await fetch(`${assetBase}${BOOT_SPLASH_INDEX_FILE}`, { cache: 'no-store' });
				if (res.ok) {
					const parsed = (await res.json()) as BootSplashIndex;
					// Engine mark first, then the game's own — the tier order IS the splash order.
					tiers = [parsed?.engine, parsed?.game].filter((t): t is BootSplashEntry => !!t?.atlas);
				}
			} catch {
				// No index (never exported, offline dev, a 404 behind the token) ⇒ no splash.
			}
			if (cancelled) return;
			if (tiers.length === 0) {
				oncomplete?.();
				return;
			}
			queue = tiers;

			// Wait out the HTML-shell boot overlay where one exists, so the marks are actually
			// seen rather than played underneath it.
			const shell = (window as unknown as { __ieBoot?: BootShell }).__ieBoot;
			if (typeof shell?.whenDone === 'function')
				shell.whenDone(() => !cancelled && (started = true));
			else started = true;
		})();

		return () => {
			cancelled = true;
		};
	});
</script>

{#if current}
	{#key index}
		<LoaderSpine entry={current} {assetBase} oncomplete={next} />
	{/key}
{/if}
