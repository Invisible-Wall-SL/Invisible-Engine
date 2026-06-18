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
		/** Optional non-square box (defaults to `size`×`size`). The frame is contain-fit
		 *  (aspect preserved, centred) into `w`×`h` — used by the symbol size gauge to show
		 *  a frame at a width/height ratio of one reel cell. */
		w?: number;
		h?: number;
	}
	let { set, region, size, w, h }: Props = $props();

	const cw = $derived(w ?? size);
	const ch = $derived(h ?? size);

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
			// `region.w/h` are the upright (unrotated) size; contain-fit into the cw×ch box.
			const scale = Math.min(cw / region.w, ch / region.h);
			const dw = region.w * scale;
			const dh = region.h * scale;
			const dx = (cw - dw) / 2;
			const dy = (ch - dh) / 2;
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
		void cw; // resizing the canvas clears it → repaint at the new size
		void ch;
		void pageVersion; // "Reload art" bump → re-fetch the page + repaint
		paint();
	});
</script>

{#if set.pageKey}
	<canvas
		bind:this={canvas}
		width={cw}
		height={ch}
		style:width="{cw}px"
		style:height="{ch}px"
	></canvas>
{:else}
	<div class="ph" style:width="{cw}px" style:height="{ch}px">?</div>
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
