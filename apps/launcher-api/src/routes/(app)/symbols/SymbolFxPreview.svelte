<script lang="ts">
	/**
	 * Autoplaying thumbnail of an Invisible FX effect, for the Book-symbol VFX panel's `fx` layer
	 * (the fourth kind, alongside the sprite/rig/flipbook previews). Fetches the effect's
	 * `EffectDoc` (`/api/editor/effect?id=…`, `symbols`-gated) and mounts the SAME live particle
	 * renderer the `/fx` tool uses ({@link FxStage}) — no second emitter implementation. The doc and
	 * art reads are `fxPreview.client.ts`'s, shared with the flight preview.
	 *
	 * Non-interactive by design: `pointer-events: none` on the frame so hovering/scrolling the panel
	 * is unaffected (FxStage's own pan/zoom + wheel-capture never fire here). It's a preview, not the
	 * FX editor — to tune the effect the author opens Invisible FX.
	 */
	import type { EffectDoc } from 'engine-fx';
	import FxStage from '../fx/FxStage.svelte';
	import CellLoading from './CellLoading.svelte';
	import { createFxArtResolver, fetchEffectDoc } from './fxPreview.client';

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

	const resolveArt = createFxArtResolver();

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
		void fetchEffectDoc(id).then((loaded) => {
			if (loadedId !== id) return; // a newer id superseded us
			doc = loaded;
			status = loaded?.layers.length ? 'ready' : 'error';
		});
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
