import { nineSlicePieces, packedSubRect, type SliceInsets, type SliceMode } from 'engine-layout';

/** A packed region on its page: `w × h` is the upright art; a `rotated` one is stored `h × w`. */
export interface PackedRegion {
	x: number;
	y: number;
	w: number;
	h: number;
	rotated?: boolean;
}

/**
 * Draw `region` as a 9-slice filling `width × height` at the context's origin — the 2D twin of the
 * game's `SlicedSprite`, from the same `nineSlicePieces`. A tiled piece repeats from its own
 * top-left and is clipped at its far edges, as a PIXI `TilingSprite` at `tilePosition` 0 does.
 */
export function drawNineSlice(
	ctx: CanvasRenderingContext2D,
	page: CanvasImageSource,
	region: PackedRegion,
	insets: SliceInsets,
	width: number,
	height: number,
	mode: SliceMode,
): void {
	const blit = (
		src: { x: number; y: number; w: number; h: number },
		dx: number,
		dy: number,
		dw: number,
		dh: number,
	): void => {
		const p = packedSubRect(src, region.h, region.rotated === true);
		if (!region.rotated) {
			ctx.drawImage(page, region.x + p.x, region.y + p.y, p.w, p.h, dx, dy, dw, dh);
			return;
		}
		// Packed 90° clockwise; drawn back counter-clockwise, as `drawArtRegionSprite` does.
		ctx.save();
		ctx.translate(dx, dy + dh);
		ctx.rotate(-Math.PI / 2);
		ctx.drawImage(page, region.x + p.x, region.y + p.y, p.w, p.h, 0, 0, dh, dw);
		ctx.restore();
	};
	for (const piece of nineSlicePieces(region.w, region.h, insets, width, height, mode)) {
		const src = { x: piece.sx, y: piece.sy, w: piece.sw, h: piece.sh };
		if (!piece.tile) {
			blit(src, piece.dx, piece.dy, piece.dw, piece.dh);
			continue;
		}
		const tw = piece.sw * piece.scale;
		const th = piece.sh * piece.scale;
		if (!(tw > 0) || !(th > 0)) continue;
		ctx.save();
		ctx.beginPath();
		ctx.rect(piece.dx, piece.dy, piece.dw, piece.dh);
		ctx.clip();
		for (let y = 0; y < piece.dh; y += th) {
			for (let x = 0; x < piece.dw; x += tw) blit(src, piece.dx + x, piece.dy + y, tw, th);
		}
		ctx.restore();
	}
}
