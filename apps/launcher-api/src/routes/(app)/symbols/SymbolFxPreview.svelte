<script lang="ts">
	/**
	 * Autoplaying thumbnail of an Invisible FX effect, for the Book-symbol VFX panel's `fx` layer
	 * (the fourth kind, alongside the sprite/spine/flipbook previews). Fetches the effect's
	 * `EffectDoc` (`/api/editor/effect?id=…`, `symbols`-gated) and mounts the SAME live particle
	 * renderer the `/fx` tool uses ({@link FxStage}) — no second emitter implementation. `resolveArt`
	 * is the editor's region/asset seam, copied verbatim from the `/fx` page.
	 *
	 * Non-interactive by design: `pointer-events: none` on the frame so hovering/scrolling the panel
	 * is unaffected (FxStage's own pan/zoom + wheel-capture never fire here). It's a preview, not the
	 * FX editor — to tune the effect the author opens Invisible FX.
	 */
	import type { EffectDoc } from 'engine-fx';
	import FxStage, { type ResolvedArt } from '../fx/FxStage.svelte';
	import CellLoading from './CellLoading.svelte';

	interface Props {
		/** The `effectId` of the picked FX layer. */
		effectId: string;
		/** Square CSS size of the preview box. */
		size: number;
	}
	let { effectId, size }: Props = $props();

	let doc = $state<EffectDoc | null>(null);
	let status = $state<'loading' | 'ready' | 'error'>('loading');
	/** Attempt the doc load ONCE per id (the $effect re-runs on unrelated state changes). */
	let loadedId = '';

	// Art resolution — the editor's region + asset endpoints (same seam the /fx stage uses). The
	// `symbols` tool is in their altTools, so these reads are in-scope for this page.
	const artCache = new Map<string, Promise<ResolvedArt | null>>();
	function resolveArt(assetKey: string): Promise<ResolvedArt | null> {
		const hit = artCache.get(assetKey);
		if (hit) return hit;
		const p = (async (): Promise<ResolvedArt | null> => {
			const res = await fetch(`/api/editor/regions?sheet=${encodeURIComponent(assetKey)}`);
			if (!res.ok) return null;
			const set = (await res.json()) as {
				pageKey: string;
				pageVersion?: string;
				pageWidth: number;
				pageHeight: number;
				regions: { name: string; x: number; y: number; w: number; h: number; rotated?: boolean }[];
			};
			if (!set.pageKey) return null;
			const v = set.pageVersion ? `&v=${encodeURIComponent(set.pageVersion)}` : '';
			return {
				pageUrl: `/api/editor/asset?key=${encodeURIComponent(set.pageKey)}${v}`,
				pageWidth: set.pageWidth,
				pageHeight: set.pageHeight,
				regions: set.regions,
			};
		})();
		artCache.set(assetKey, p);
		return p;
	}

	$effect(() => {
		const id = effectId;
		if (!id) {
			doc = null;
			status = 'error';
			return;
		}
		if (id === loadedId) return;
		loadedId = id;
		status = 'loading';
		doc = null;
		void (async () => {
			try {
				const res = await fetch(`/api/editor/effect?id=${encodeURIComponent(id)}`);
				if (loadedId !== id) return; // a newer id superseded us
				if (!res.ok) {
					status = 'error';
					return;
				}
				const data = (await res.json()) as { doc: EffectDoc };
				if (loadedId !== id) return;
				doc = data.doc;
				status = data.doc.layers.length ? 'ready' : 'error';
			} catch {
				if (loadedId === id) status = 'error';
			}
		})();
	});
</script>

<div class="fx-preview" style="width:{size}px;height:{size}px">
	{#if status === 'loading'}
		<CellLoading />
	{:else if status === 'error' || !doc}
		<span class="fx-none">no preview</span>
	{:else}
		<div class="fx-canvas">
			{#key doc.id}
				<FxStage layers={doc.layers} playing {resolveArt} />
			{/key}
		</div>
	{/if}
</div>

<style>
	.fx-preview {
		position: relative;
		display: grid;
		place-items: center;
		overflow: hidden;
		border-radius: 6px;
		background: #0b0e13;
	}
	/* Fill the box and stay non-interactive — the panel scrolls/hovers normally over it. */
	.fx-canvas {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
	.fx-none {
		font-size: 12px;
		color: #6b6b78;
	}
</style>
