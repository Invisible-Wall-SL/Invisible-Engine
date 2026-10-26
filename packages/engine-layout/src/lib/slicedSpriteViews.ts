/**
 * The PIXI views a 9-slice draws with — the game half of `nineSlice.ts`, kept out of
 * `SlicedSprite.svelte` so the editor-parity check (`tools/fx-spike/nine-slice-parity.mjs`) renders
 * exactly what the game does.
 *
 * The art is the packed frame, upright and untrimmed (`sliceArt`): a trim box or Art bounds size a
 * plain sprite, while a slice is sized by its node. `stretch` is one `NineSliceSprite`; `tile` is
 * four corner sprites and five `TilingSprite`s at the corner factor.
 */
import * as PIXI from 'pixi.js';
import { nineSlicePieces, packedSubRect, type SliceInsets, type SliceMode } from './nineSlice';

export interface SliceArt {
	texture: PIXI.Texture;
	w: number;
	h: number;
	insets: SliceInsets;
}

/** The art a texture slices: its kept (trimmed) rect, and its `defaultBorders` as insets. */
export function sliceArt(texture: PIXI.Texture): SliceArt {
	const b = texture.defaultBorders;
	return {
		texture,
		w: texture.trim?.width ?? texture.orig.width,
		h: texture.trim?.height ?? texture.orig.height,
		insets: { left: b?.left ?? 0, top: b?.top ?? 0, right: b?.right ?? 0, bottom: b?.bottom ?? 0 },
	};
}

/** A sub-rect of the art (upright pixels) as its own untrimmed texture. */
function artTexture(art: SliceArt, rect: { x: number; y: number; w: number; h: number }) {
	const t = art.texture;
	const page = packedSubRect(rect, art.h, t.rotate !== 0);
	return new PIXI.Texture({
		source: t.source,
		frame: new PIXI.Rectangle(t.frame.x + page.x, t.frame.y + page.y, page.w, page.h),
		orig: new PIXI.Rectangle(0, 0, rect.w, rect.h),
		rotate: t.rotate,
	});
}

/**
 * The views drawing `art` sliced into `width × height`, top-left at the origin, and the textures
 * made for them (the caller destroys those with `destroy(false)`: they share the sheet's source).
 */
export function buildSliceViews(
	art: SliceArt,
	width: number,
	height: number,
	mode: SliceMode,
): { views: PIXI.ViewContainer[]; textures: PIXI.Texture[] } {
	if (mode === 'stretch') {
		const whole = artTexture(art, { x: 0, y: 0, w: art.w, h: art.h });
		const sprite = new PIXI.NineSliceSprite({
			texture: whole,
			leftWidth: art.insets.left,
			topHeight: art.insets.top,
			rightWidth: art.insets.right,
			bottomHeight: art.insets.bottom,
			width,
			height,
		});
		return { views: [sprite], textures: [whole] };
	}
	const views: PIXI.ViewContainer[] = [];
	const textures: PIXI.Texture[] = [];
	for (const p of nineSlicePieces(art.w, art.h, art.insets, width, height, mode)) {
		const texture = artTexture(art, { x: p.sx, y: p.sy, w: p.sw, h: p.sh });
		textures.push(texture);
		const view = p.tile
			? new PIXI.TilingSprite({
					texture,
					width: p.dw,
					height: p.dh,
					tileScale: { x: p.scale, y: p.scale },
				})
			: new PIXI.Sprite({ texture, width: p.dw, height: p.dh });
		view.position.set(p.dx, p.dy);
		views.push(view);
	}
	return { views, textures };
}
