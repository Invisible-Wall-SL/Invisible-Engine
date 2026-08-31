/**
 * Shared Invisible Flipbook frame→texture helper for the launcher's live Pixi overlays.
 *
 * The clip twin of `effectEmitter.client.ts`'s `framesToTextures`. An FX layer's art is a bag of
 * particle frames sliced off ONE page, so that helper can be careless about geometry: a particle is
 * drawn at whatever size the rect happens to be, and neither trim nor atlas rotation changes what a
 * spray of sparks looks like. An ordered ANIMATION cannot be careless about any of it —
 *
 *  - **rotation**: a frame packed sideways drawn upright is 90° wrong, once, mid-animation;
 *  - **trim**: frames of one animation are trimmed to DIFFERENT rects, so ignoring the trim offset
 *    makes the art jump around its own origin frame to frame (the "pulsing" `editorRegions.ts`
 *    documents for un-trimmed imports, but per-frame);
 *  - **bounds**: a clip's declared box is what stops it changing scale between frames at all.
 *
 * So this resolves each frame the way the GAME does: `<Flipbook>` re-states every texture's
 * `orig`/`trim` through `applyClipBounds`, and `resolveClipFrames` walks `playbackIndices` for the
 * direction. Same two functions, same order, from the same package — the preview and the game
 * cannot disagree about which pixels a frame is or which frame is showing.
 *
 * It differs from the game in exactly one way, and only because it must: the game looks frames up in
 * `loadedAssets` (textures the loader already built), while a launcher stage has an atlas PAGE and a
 * list of rects from `/api/editor/regions`, so the textures are cut here. That cut is the whole
 * content of this module.
 */
import { Rectangle, Texture, type TextureSource } from 'pixi.js';
import { applyClipBounds, parseFrameRef, playbackIndices } from 'engine-flipbook';

import { loadPageSource, type ResolveArt, type ResolvedArt } from './effectEmitter.client';

/** One authored clip as an overlay consumes it — structurally `engine-flipbook`'s `FlipbookClip`
 * (and `engine-layout`'s `FlipbookClipEntry`), restated so this module needs neither. */
export interface OverlayClip {
	id: string;
	/** Manifest key of the clip's PRIMARY sheet — what a bare frame name resolves against. */
	assetKey: string;
	/** ORDERED frames: a bare region name, or an `<assetKey>::<region>` ref for a multi-sheet clip. */
	frames: string[];
	fps?: number;
	loop?: boolean;
	direction?: 'forward' | 'reverse' | 'pingpong';
	flipX?: boolean;
	flipY?: boolean;
	bounds?: { x: number; y: number; w: number; h: number };
}

/** A region rect as `/api/editor/regions` returns it. `w`/`h` are the UPRIGHT size — the house
 * convention (`editorRegions.ts` `uprightWH`, `regionCrop.ts`): a `rotated` frame sits on the page
 * as `(h × w)`, turned 90° clockwise. `offX`/`offY`/`origW`/`origH` are the trim (TexturePacker's
 * `spriteSourceSize` / `sourceSize`); an untrimmed frame simply omits them. */
interface RegionRect {
	name: string;
	x: number;
	y: number;
	w: number;
	h: number;
	rotated?: boolean;
	offX?: number;
	offY?: number;
	origW?: number;
	origH?: number;
}

/** Cut one region out of its page as a PIXI texture, honouring atlas rotation, the frame's own trim,
 * and the clip's declared box.
 *
 * `frame` is always the rect as it sits ON THE PAGE (swapped for a rotated frame) and `rotate: 2` is
 * PIXI's groupD8 for the 90° packing TexturePacker applies — the same pair `Spritesheet` builds, so
 * nothing downstream needs to know the frame was packed sideways. `orig` is the declared box and
 * `trim` where the art sits inside it, which is exactly the vocabulary `applyClipBounds` re-states,
 * so a clip with a box and one without differ only in these two rects. */
function regionTexture(
	source: TextureSource,
	region: RegionRect,
	bounds: OverlayClip['bounds'],
): Texture {
	const artW = region.w;
	const artH = region.h;
	const pageFrame = region.rotated
		? new Rectangle(region.x, region.y, artH, artW)
		: new Rectangle(region.x, region.y, artW, artH);
	// An untrimmed frame's declared box IS its art, at offset 0 — which is what `applyClipBounds`
	// expects for one, so there is no second branch for the un-trimmed case.
	const box = {
		origW: region.origW && region.origW > 0 ? region.origW : artW,
		origH: region.origH && region.origH > 0 ? region.origH : artH,
		offX: region.offX ?? 0,
		offY: region.offY ?? 0,
		artW,
		artH,
	};
	const applied = bounds && bounds.w > 0 && bounds.h > 0 ? applyClipBounds(box, bounds) : box;
	return new Texture({
		source,
		frame: pageFrame,
		rotate: region.rotated ? 2 : 0,
		orig: new Rectangle(0, 0, applied.origW, applied.origH),
		trim: new Rectangle(applied.offX, applied.offY, applied.artW, applied.artH),
		label: region.name,
	});
}

/**
 * Resolve a clip's authored frames to textures in PLAYBACK ORDER.
 *
 * Resolution runs ONCE per AUTHORED frame and the direction walk then indexes that array, so a
 * ping-pong reuses each texture object rather than cutting it twice — the same shape (and the same
 * reason) as `resolveClipFrames`.
 *
 * A frame whose sheet or region is missing is DROPPED, never substituted: there is deliberately no
 * whole-sheet fallback, because for an ordered animation that renders a scramble of unrelated art
 * instead of an honest gap (the rule `<Flipbook>` states). An empty result means the caller renders
 * nothing.
 */
export async function clipToTextures(
	clip: OverlayClip,
	resolveArt: ResolveArt,
	sourceCache: Map<string, TextureSource>,
): Promise<Texture[]> {
	const frames = clip.frames ?? [];
	if (frames.length === 0) return [];

	// One resolve + one page decode per distinct SHEET, not per frame: a real multipacked export
	// interleaves an animation across pages, so a 49-frame clip can touch four of them and would
	// otherwise re-fetch each page dozens of times.
	const refs = frames.map((entry) => {
		const ref = parseFrameRef(entry);
		return { sheet: ref.assetKey ?? clip.assetKey, region: ref.region };
	});
	const sheets = [...new Set(refs.map((r) => r.sheet))];
	const pages = new Map<string, { source: TextureSource; byName: Map<string, RegionRect> }>();
	for (const sheet of sheets) {
		const art = (await resolveArt(sheet)) as (ResolvedArt & { regions: RegionRect[] }) | null;
		if (!art) continue;
		let source: TextureSource;
		try {
			source = await loadPageSource(art.pageUrl, sourceCache);
		} catch (err) {
			console.warn('flipbookFrames: page image load failed', art.pageUrl, err);
			continue;
		}
		pages.set(sheet, { source, byName: new Map(art.regions.map((r) => [r.name, r])) });
	}

	const resolved: (Texture | undefined)[] = refs.map(({ sheet, region }) => {
		const page = pages.get(sheet);
		const rect = page?.byName.get(region);
		if (!page || !rect) return undefined;
		return regionTexture(page.source, rect, clip.bounds);
	});

	const out: Texture[] = [];
	for (const i of playbackIndices(frames.length, clip.direction)) {
		const tex = resolved[i];
		if (tex) out.push(tex);
	}
	return out;
}
