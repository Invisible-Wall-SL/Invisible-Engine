/**
 * 9-SLICE — the one layout both the Scene / Component Editor canvas and the game draw a sliced
 * sprite by (game-families §5.2 "N-slice", P10.9).
 *
 * The insets belong to the ART: a panel frame's corners are where its painter put them, whatever
 * the placement. They are stored per `<assetKey>::<region>` (the launcher's art-slices doc) and
 * ship as the TexturePacker frame's `borders`, which PIXI already reads into
 * `Texture.defaultBorders`. The NODE only chooses to draw sliced, and how ({@link SliceMode}).
 *
 * Insets are measured in the region's packed art pixels, upright: a sliced draw uses the art the
 * packer kept, never a trim box or an Art bounds box (those size a plain sprite; a slice is sized
 * by its node). Corners draw at their art size; only the edges and the centre stretch or tile.
 * When the box is smaller than two corners, every corner shrinks by one factor — PIXI's
 * `NineSliceGeometry` rule, kept here so the editor's corners match the game's.
 */

export const SLICE_MODES = ['stretch', 'tile'] as const;
export type SliceMode = (typeof SLICE_MODES)[number];

export function isSliceMode(v: unknown): v is SliceMode {
	return SLICE_MODES.some((m) => m === v);
}

export interface SliceInsets {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface SlicePiece {
	/** Source rect in upright art pixels. */
	sx: number;
	sy: number;
	sw: number;
	sh: number;
	/** Destination rect in the box's own space, origin at its top-left. */
	dx: number;
	dy: number;
	dw: number;
	dh: number;
	/** Repeat the source across the destination at `scale`, instead of stretching it. */
	tile: boolean;
	/** The corner factor; a tile repeats every `sw·scale` × `sh·scale`. */
	scale: number;
}

const finite = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);

/** Insets clamped to the art, so opposite insets never cross. */
export function clampSliceInsets(insets: SliceInsets, artW: number, artH: number): SliceInsets {
	const left = Math.min(finite(insets.left), artW);
	const top = Math.min(finite(insets.top), artH);
	return {
		left,
		top,
		right: Math.min(finite(insets.right), artW - left),
		bottom: Math.min(finite(insets.bottom), artH - top),
	};
}

/** The factor every corner is drawn at: 1 unless the box is smaller than two corners. */
export function sliceCornerScale(insets: SliceInsets, width: number, height: number): number {
	const w = insets.left + insets.right;
	const h = insets.top + insets.bottom;
	const sw = w > 0 && width <= w ? width / w : 1;
	const sh = h > 0 && height <= h ? height / h : 1;
	return Math.max(0, Math.min(sw, sh));
}

/**
 * The (up to) nine pieces of `artW × artH` art sliced by `insets` into a `width × height` box.
 * Empty pieces (a zero inset, a zero-size box) are left out. Corners never tile.
 */
export function nineSlicePieces(
	artW: number,
	artH: number,
	rawInsets: SliceInsets,
	width: number,
	height: number,
	mode: SliceMode,
): SlicePiece[] {
	if (!(artW > 0) || !(artH > 0) || !(width > 0) || !(height > 0)) return [];
	const insets = clampSliceInsets(rawInsets, artW, artH);
	const k = sliceCornerScale(insets, width, height);
	const srcX = [0, insets.left, artW - insets.right, artW];
	const srcY = [0, insets.top, artH - insets.bottom, artH];
	const dstX = [0, insets.left * k, width - insets.right * k, width];
	const dstY = [0, insets.top * k, height - insets.bottom * k, height];
	const pieces: SlicePiece[] = [];
	for (let row = 0; row < 3; row++) {
		for (let col = 0; col < 3; col++) {
			const sw = srcX[col + 1] - srcX[col];
			const sh = srcY[row + 1] - srcY[row];
			const dw = dstX[col + 1] - dstX[col];
			const dh = dstY[row + 1] - dstY[row];
			if (!(sw > 0) || !(sh > 0) || !(dw > 0) || !(dh > 0)) continue;
			const corner = col !== 1 && row !== 1;
			pieces.push({
				sx: srcX[col],
				sy: srcY[row],
				sw,
				sh,
				dx: dstX[col],
				dy: dstY[row],
				dw,
				dh,
				tile: mode === 'tile' && !corner,
				scale: k,
			});
		}
	}
	return pieces;
}

/**
 * The page rect holding an upright art sub-rect, for a frame packed rotated 90° clockwise (the
 * atlas tool's and TexturePacker's `rotated: true`). `artH` is the upright art height, which is
 * the packed rect's width. An unrotated frame's sub-rect is the sub-rect itself.
 */
export function packedSubRect(
	rect: { x: number; y: number; w: number; h: number },
	artH: number,
	rotated: boolean,
): { x: number; y: number; w: number; h: number } {
	if (!rotated) return rect;
	return { x: artH - rect.y - rect.h, y: rect.x, w: rect.h, h: rect.w };
}
