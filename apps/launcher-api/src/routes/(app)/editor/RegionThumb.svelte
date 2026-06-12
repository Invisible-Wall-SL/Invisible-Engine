<script lang="ts" module>
	/** One shared <img> per page key, across all thumbnails — many reuse the same decode. */
	const pageImages = new Map<string, HTMLImageElement>();

	/** Bumped by "Reload art" (EditorCanvas.refreshAssets) — also feeds `?v=` so the
	 * HTTP cache is busted, mirroring the canvas's own `assetVersion` mechanism. */
	let pageVersion = $state(0);

	/** Drop the shared page decodes so Library thumbnails repaint from fresh R2 art. */
	export function clearPageImages(): void {
		pageImages.clear();
		pageVersion++;
	}
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
		img.src = `${regionAssetUrl(key)}&v=${pageVersion}`;
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
			// `w/h` are the upright (unrotated) size; fit that into the square.
			const scale = Math.min(size / region.w, size / region.h);
			const dw = region.w * scale;
			const dh = region.h * scale;
			const dx = (size - dw) / 2;
			const dy = (size - dh) / 2;
			// On-page packed rect: a `rotated` frame is stored (h × w) — swap, then
			// un-rotate (+90° clockwise) so the thumbnail shows it upright, matching
			// the slicer's PIL rotate(-90).
			const pw = region.rotated ? region.h : region.w;
			const ph = region.rotated ? region.w : region.h;
			if (region.rotated) {
				c.save();
				c.translate(dx + dw, dy);
				c.rotate(Math.PI / 2);
				c.drawImage(img, region.x, region.y, pw, ph, 0, 0, dh, dw);
				c.restore();
			} else {
				c.drawImage(img, region.x, region.y, pw, ph, dx, dy, dw, dh);
			}
		};
		if (img.complete && img.naturalWidth > 0) draw();
		else img.addEventListener('load', draw, { once: true });
	}

	$effect(() => {
		void set.pageKey;
		void region.name;
		void size; // resizing the canvas clears it → repaint at the new size
		void pageVersion; // "Reload art" bump → re-fetch the page + repaint
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
