/**
 * Crop ONE atlas region out of its page as a PNG, at NATIVE resolution.
 *
 * `RegionThumb` draws the same geometry but CONTAIN-FITS it into a square preview box; a crop
 * that is going to be fed to an image model must be the art at its own size, so the two cannot
 * share a draw call. What they DO share is the geometry contract, and that is the part worth
 * stating once: a frame is placed by its UNTRIMMED canvas (`origW/origH`) with the packed rect
 * at `offX/offY` inside it, and a `rotated` frame is stored 90° CW on the page and therefore
 * un-rotated CCW — the single convention every producer in this repo writes (pinned by
 * `services/sheet-tool/rot_convention_check.py`). Keeping the untrimmed canvas matters here:
 * it is the frame the game shows, so what the model animates is what the author sees.
 *
 * The page comes from `/api/editor/asset` (same origin), so the canvas is never tainted and
 * `toBlob` works. A cross-origin page would silently fail the export instead — hence the
 * explicit null check rather than a cast.
 */
import { regionAssetUrl, type EditorRegion, type RegionSet } from './editorRegions.client';

/** One decode per page URL, shared by every crop taken from it. */
const pages = new Map<string, Promise<HTMLImageElement>>();

function loadPage(url: string): Promise<HTMLImageElement> {
	const hit = pages.get(url);
	if (hit) return hit;
	const p = new Promise<HTMLImageElement>((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('Could not load the atlas page image.'));
		img.src = url;
	});
	pages.set(url, p);
	return p;
}

/**
 * Drop the decoded pages so the next crop re-reads them from R2. A crop is uploaded as a
 * GENERATION source, so a stale decode here does not merely mislead the eye — it feeds the old
 * art to a paid GPU run. Called by Invisible Flipbook's ↻ Refresh from R2 alongside
 * `clearRegionCache` / `clearPageImages`; this cache is keyed by the same versioned URL, so it
 * only ever goes stale together with them.
 */
export function clearCropPages(): void {
	pages.clear();
}

/** Pixel size of the PNG a crop of `region` produces — its untrimmed frame. */
export function regionCropSize(region: EditorRegion): { w: number; h: number } {
	return { w: region.origW ?? region.w, h: region.origH ?? region.h };
}

/** Crop `region` out of `set`'s page into a PNG blob at its untrimmed native size. */
export async function cropRegionToPng(set: RegionSet, region: EditorRegion): Promise<Blob> {
	if (!set.pageKey) throw new Error('That atlas has no page image to crop from.');
	const img = await loadPage(regionAssetUrl(set.pageKey, set.pageVersion));

	const { w: ow, h: oh } = regionCropSize(region);
	if (ow <= 0 || oh <= 0) throw new Error(`Region "${region.name}" has no size.`);

	const canvas = document.createElement('canvas');
	canvas.width = ow;
	canvas.height = oh;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('This browser refused a 2D canvas.');

	const dx = region.offX ?? 0;
	const dy = region.offY ?? 0;
	// On-page packed rect: a rotated frame is stored (h × w).
	const pw = region.rotated ? region.h : region.w;
	const ph = region.rotated ? region.w : region.h;
	if (region.rotated) {
		ctx.save();
		ctx.translate(dx, dy + region.h);
		ctx.rotate(-Math.PI / 2);
		ctx.drawImage(img, region.x, region.y, pw, ph, 0, 0, region.h, region.w);
		ctx.restore();
	} else {
		ctx.drawImage(img, region.x, region.y, pw, ph, dx, dy, region.w, region.h);
	}

	return await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the crop as PNG.'))),
			'image/png',
		);
	});
}
