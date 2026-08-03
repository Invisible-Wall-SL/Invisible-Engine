<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	import { getContextApp } from '../context.svelte';

	/**
	 * On-device memory readout, shown ONLY when the game URL carries `?memhud=1`.
	 *
	 * Purpose: a leak that OOM-crashes iOS shows as steadily-climbing memory on ANY device
	 * (a phone with more RAM just doesn't crash), so this turns a Samsung / desktop into a
	 * profiler — play features and watch whether the numbers only ever go up. Zero cost when
	 * the flag is absent (renders nothing, samples nothing).
	 *
	 *  - `tex`   = `renderer.texture.managedTextures.length` — GPU texture-source count, the
	 *    best VRAM proxy. THIS is the number to watch across feature cycles; a monotonic climb
	 *    (never dropping back after returning to base game) is the leak.
	 *  - `heap`  = `performance.memory.usedJSHeapSize` (Chromium only; blank on Safari).
	 *  - `nodes` = live display-object count in the scene graph (orphaned nodes leak too).
	 *  - `max`   = the largest `tex` seen this session, so a transient peak is visible after it drops.
	 */
	const context = getContextApp();

	const enabled =
		typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('memhud') === '1';

	let heap = $state('—');
	let tex = $state(0);
	let maxTex = $state(0);
	let nodes = $state(0);
	let timer: ReturnType<typeof setInterval> | undefined;

	const countNodes = (n: { children?: unknown[] } | undefined): number => {
		if (!n) return 0;
		let c = 1;
		const kids = n.children;
		if (Array.isArray(kids)) for (const k of kids) c += countNodes(k as { children?: unknown[] });
		return c;
	};

	const sample = () => {
		const app = context.stateApp.pixiApplication as
			| { renderer?: { texture?: { managedTextures?: unknown[] } }; stage?: { children?: unknown[] } }
			| undefined;
		if (!app) return;
		const managed = app.renderer?.texture?.managedTextures;
		tex = Array.isArray(managed) ? managed.length : 0;
		if (tex > maxTex) maxTex = tex;
		nodes = countNodes(app.stage);
		const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
		heap = mem ? `${Math.round(mem.usedJSHeapSize / 1048576)}MB` : '—';
	};

	onMount(() => {
		if (!enabled) return;
		sample();
		timer = setInterval(sample, 1000);
	});
	onDestroy(() => clearInterval(timer));
</script>

{#if enabled}
	<div class="ie-memhud">
		tex <b class:grow={tex >= maxTex && tex > 0}>{tex}</b> (max {maxTex}) · heap {heap} · nodes {nodes}
	</div>
{/if}

<style>
	.ie-memhud {
		position: fixed;
		top: 0;
		left: 0;
		z-index: 2147483647;
		padding: 3px 7px;
		font: 12px/1.4 ui-monospace, monospace;
		color: #0f0;
		background: rgba(0, 0, 0, 0.72);
		pointer-events: none;
		white-space: nowrap;
	}
	.ie-memhud b {
		color: #fff;
	}
	.ie-memhud b.grow {
		color: #ff5252;
	}
</style>
