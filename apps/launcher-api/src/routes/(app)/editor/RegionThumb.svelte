<script lang="ts" module>
	/** One shared <img> per page key, across all thumbnails — many reuse the same decode. */
	const pageImages = new Map<string, HTMLImageElement>();
</script>

<script lang="ts">
	import { regionAssetUrl, type EditorRegion, type RegionSet } from './editorRegions.client';

	interface Props {
		set: RegionSet;
		region: EditorRegion;
		size: number;
	}
	let { set, region, size }: Props = $props();

	let canvas: HTMLCanvasElement | null = $state(null);

	function loadPage(key: string): HTMLImageElement {
		const hit = pageImages.get(key);
		if (hit) return hit;
		const img = new Image();
		img.src = regionAssetUrl(key);
		pageImages.set(key, img);
		return img;
	}

	function paint(): void {
		if (!canvas || !set.pageKey) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		const img = loadPage(set.pageKey);
		const draw = (): void => {
			if (!canvas || img.naturalWidth === 0) return;
			const c = canvas.getContext('2d');
			if (!c) return;
			c.clearRect(0, 0, canvas.width, canvas.height);
			const scale = Math.min(size / region.w, size / region.h);
			const dw = region.w * scale;
			const dh = region.h * scale;
			const dx = (size - dw) / 2;
			const dy = (size - dh) / 2;
			c.drawImage(img, region.x, region.y, region.w, region.h, dx, dy, dw, dh);
		};
		if (img.complete && img.naturalWidth > 0) draw();
		else img.addEventListener('load', draw, { once: true });
	}

	$effect(() => {
		void set.pageKey;
		void region.name;
		paint();
	});
</script>

{#if set.pageKey}
	<canvas
		bind:this={canvas}
		width={size}
		height={size}
		style:width="{size}px"
		style:height="{size}px"
	></canvas>
{:else}
	<div class="ph" style:width="{size}px" style:height="{size}px">?</div>
{/if}

<style>
	canvas {
		display: block;
		border-radius: 4px;
		background: #0b0b10;
		image-rendering: pixelated;
	}
	.ph {
		display: grid;
		place-items: center;
		border-radius: 4px;
		background: #16161c;
		border: 1px solid #2a2a33;
		color: #555;
		font-size: 16px;
	}
</style>
