import type { StagePicture } from '$lib/editor/propStage';
import { clipFrameAt, fetchClips, type EditorClip } from './editorFlipbooks.client';
import { fetchRegions, regionAssetUrl, type EditorRegion } from './editorRegions.client';

/**
 * The prop view's PAINTED ART (`docs/design/arcade-prop-components.md` §7 P7): a piece's sprite (an
 * atlas region) or clip (its first frame) drawn on the stage's 2D canvas, from the same region sets
 * and page images the node canvas reads (`editorRegions.client.ts`, `editorFlipbooks.client.ts`).
 * The geometry is the canvas's (`EditorCanvas` `drawArtRegionSprite`): a frame stands in its
 * untrimmed box (`origW × origH`) at its trim offset, and a `rotated` frame is stored 90° CW on the
 * page and drawn back CCW. A picture still loading draws nothing and asks for a redraw when ready.
 */

type Found = { region: EditorRegion; img: HTMLImageElement };

const images = new Map<string, HTMLImageElement>();
const regions = new Map<string, Promise<void>>();
const found = new Map<string, Found | null>();
let clips: Map<string, EditorClip> | null = null;
let clipsLoading: Promise<void> | null = null;

function image(url: string, ready: () => void): HTMLImageElement {
	let img = images.get(url);
	if (!img) {
		img = new Image();
		img.onload = ready;
		img.src = url;
		images.set(url, img);
	}
	return img;
}

/** `<assetKey>::<region>` resolved to its region and page image; `undefined` while loading. */
function resolveRef(ref: string, ready: () => void): Found | null | undefined {
	if (found.has(ref)) return found.get(ref);
	const at = ref.indexOf('::');
	const assetKey = ref.slice(0, at);
	if (!regions.has(assetKey)) {
		regions.set(
			assetKey,
			fetchRegions(assetKey).then((set) => {
				for (const region of set.regions) {
					const img = set.pageKey
						? image(regionAssetUrl(set.pageKey, set.pageVersion), ready)
						: null;
					found.set(`${assetKey}::${region.name}`, img ? { region, img } : null);
				}
				ready();
			}),
		);
		return undefined;
	}
	return found.get(ref);
}

/** A clip's first frame as `<assetKey>::<region>`; `undefined` while the clips load. */
function clipRef(clipId: string, ready: () => void): string | null | undefined {
	if (!clips) {
		clipsLoading ??= fetchClips().then((list) => {
			clips = new Map(list.map((c) => [c.id, c]));
			ready();
		});
		return undefined;
	}
	const clip = clips.get(clipId);
	if (!clip) return null;
	const frame = clipFrameAt(clip, 0);
	return `${frame.assetKey}::${frame.region}`;
}

/** Draw `picture` at `x, y` on `ctx` (the stage's world-projected frame); `ready` redraws once a
 *  sheet, a page or the clips have loaded. */
export function drawPicture(
	ctx: CanvasRenderingContext2D,
	picture: StagePicture,
	x: number,
	y: number,
	ready: () => void,
): void {
	const ref = picture.kind === 'flipbook' ? clipRef(picture.ref, ready) : picture.ref;
	if (!ref) return;
	const hit = resolveRef(ref, ready);
	if (!hit || !hit.img.complete || hit.img.naturalWidth === 0) return;
	const { region, img } = hit;
	const natW = region.origW ?? region.w;
	const natH = region.origH ?? region.h;
	let dw = picture.width ?? natW;
	let dh = picture.height ?? natH;
	if (picture.width !== undefined && picture.height === undefined) dh = (natH * dw) / natW;
	if (picture.height !== undefined && picture.width === undefined) dw = (natW * dh) / natH;
	if (picture.keepAspect && picture.width !== undefined && picture.height !== undefined) {
		const k = Math.min(picture.width / natW, picture.height / natH);
		dw = natW * k;
		dh = natH * k;
	}
	const sx = dw / natW;
	const sy = dh / natH;
	const cw = region.w * sx;
	const ch = region.h * sy;
	const cx = -dw * picture.anchor.x + (region.offX ?? 0) * sx;
	const cy = -dh * picture.anchor.y + (region.offY ?? 0) * sy;
	const pw = region.rotated ? region.h : region.w;
	const ph = region.rotated ? region.w : region.h;
	ctx.save();
	ctx.translate(x, y);
	if (picture.rotation) ctx.rotate(picture.rotation);
	ctx.scale(picture.scale.x, picture.scale.y);
	ctx.globalAlpha *= picture.alpha;
	const source = tinted(img, region.x, region.y, pw, ph, picture.tint);
	const [ox, oy] = source === img ? [region.x, region.y] : [0, 0];
	if (region.rotated) {
		ctx.translate(cx, cy + ch);
		ctx.rotate(-Math.PI / 2);
		ctx.drawImage(source, ox, oy, pw, ph, 0, 0, ch, cw);
	} else ctx.drawImage(source, ox, oy, pw, ph, cx, cy, cw, ch);
	ctx.restore();
}

/** The page rect multiplied by `tint` (alpha kept), as a sprite's tint draws; the page itself
 *  when untinted. A fresh canvas per draw: the prop view redraws only on an edit. */
function tinted(
	img: HTMLImageElement,
	x: number,
	y: number,
	w: number,
	h: number,
	tint: number | undefined,
): CanvasImageSource {
	if (tint === undefined || tint === 0xffffff) return img;
	const off = document.createElement('canvas');
	off.width = Math.max(1, w);
	off.height = Math.max(1, h);
	const octx = off.getContext('2d');
	if (!octx) return img;
	octx.drawImage(img, x, y, w, h, 0, 0, w, h);
	octx.globalCompositeOperation = 'multiply';
	octx.fillStyle = `#${tint.toString(16).padStart(6, '0')}`;
	octx.fillRect(0, 0, w, h);
	octx.globalCompositeOperation = 'destination-in';
	octx.drawImage(img, x, y, w, h, 0, 0, w, h);
	return off;
}
