<script lang="ts" module>
	/** One shared <img> per page key, across all thumbnails — many reuse the same decode. */
	const pageImages = new Map<string, HTMLImageElement>();

	/** Bumped by "Reload art" (EditorCanvas.refreshAssets) — feeds the `?v=` content
	 * token, which stays constant across renders (the ETag-cacheable asset endpoint
	 * revalidates cheaply) and changes only on reload, mirroring the canvas's own
	 * `assetVersion` mechanism. */
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

	function loadPage(url: string): HTMLImageElement {
		const hit = pageImages.get(url);
		if (hit) return hit;
		const img = new Image();
		img.src = url;
		pageImages.set(url, img);
		return img;
	}

	function paint(): void {
		if (!canvas || !set.pageKey) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		// Content-versioned URL: a re-authored atlas changes `pageVersion` → a fresh
		// decode automatically, without the "Reload art" counter having to fire.
		const img = loadPage(regionAssetUrl(set.pageKey, set.pageVersion));
		const draw = (): void => {
			if (!canvas || img.naturalWidth === 0) return;
			const c = canvas.getContext('2d');
			if (!c) return;
			c.clearRect(0, 0, canvas.width, canvas.height);
			// A TRIMMED frame is smaller than its original: `w/h` is the tight packed rect,
			// `origW/origH` is the untrimmed canvas, and `offX/offY` is where the packed rect
			// sits inside it. Contain-fitting the TRIMMED rect (the old behaviour) scaled every
			// frame to fill the box independently, so a frame trimmed to a small bright core
			// ballooned while a loosely-trimmed one shrank — the animation "pulsed" and drifted.
			// Fit the ORIGINAL canvas instead and place the packed rect at its offset, so every
			// frame is anchored in the same space. For an untrimmed frame (origW==w, off==0) this
			// is byte-identical to the old centring.
			const ow = region.origW ?? region.w;
			const oh = region.origH ?? region.h;
			const offX = region.offX ?? 0;
			const offY = region.offY ?? 0;
			const scale = Math.min(size / ow, size / oh);
			// Top-left of the centred original canvas, then the trimmed rect's place within it.
			const baseX = (size - ow * scale) / 2;
			const baseY = (size - oh * scale) / 2;
			const dw = region.w * scale;
			const dh = region.h * scale;
			const dx = baseX + offX * scale;
			const dy = baseY + offY * scale;
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
		void set.pageVersion; // content change (re-authored atlas) → fresh decode + repaint
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
