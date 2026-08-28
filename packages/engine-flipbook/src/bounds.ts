/**
 * Invisible Flipbook — CLIP BOUNDS (design doc `invisible-flipbook.md`).
 *
 * The frame-animation twin of the Rigger's Bounds box. A rig declares
 * `skeleton.{x,y,width,height}` and every consumer contain-fits THAT box rather than the pixels
 * the pose happens to cover, which is why a too-big spine symbol is fixed by tightening the rig
 * and not by a size number. A clip had no such declaration: each frame was fitted on its own
 * trim rect, so a clip whose frames pack to different sizes changes scale as it plays (the
 * "pulsing" `editorRegions.ts` already documents for un-trimmed plist imports), and a clip whose
 * art is mostly empty margin draws small next to everything around it.
 *
 * The box is expressed in ART PIXELS, ORIGIN-CENTRED — `x`/`y` are the box's top-left relative to
 * the clip's origin, so a centred box is `x = -w/2, y = -h/2`. That matches the Rigger's
 * origin-centred extent, and it is the one space every frame shares: frames are drawn anchored on
 * their own declared box, so their CENTRES coincide even when their sizes do not.
 *
 * How it reaches pixels is deliberately NOT new maths. A bounds is exactly what PIXI already
 * calls a texture's `orig` (the declared box) plus its `trim` (where the art sits inside it), so
 * applying one is a re-statement of those two rects — {@link applyClipBounds} — after which
 * sizing, anchoring, `contain`-fitting and cover-fitting all behave as they do for any trimmed
 * sprite, in the game and in both editors. Nothing downstream learns a new concept.
 */

/** A declared box in ART PIXELS, top-left relative to the clip's origin (centre). */
export interface FlipbookBounds {
	x: number;
	y: number;
	w: number;
	h: number;
}

/**
 * One frame's geometry in the terms PIXI and TexturePacker already use:
 * `orig*` is the declared box (TP `sourceSize`), `off*`/`art*` the art's rect inside it
 * (TP `spriteSourceSize`). An UNTRIMMED frame has `off = 0` and `art == orig`.
 */
export interface FlipbookFrameBox {
	origW: number;
	origH: number;
	offX: number;
	offY: number;
	artW: number;
	artH: number;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A usable box: finite everywhere and positive in both dimensions. A zero/negative box would
 * divide by zero in every contain-fit downstream, so it is refused rather than shipped. */
export const isFlipbookBounds = (v: unknown): v is FlipbookBounds => {
	if (typeof v !== 'object' || v === null) return false;
	const b = v as Record<string, unknown>;
	return (
		isFiniteNumber(b.x) &&
		isFiniteNumber(b.y) &&
		isFiniteNumber(b.w) &&
		isFiniteNumber(b.h) &&
		b.w > 0 &&
		b.h > 0
	);
};

/**
 * Re-state one frame against a clip's declared box: the box BECOMES the frame's `orig`, and the
 * art keeps its size at its own position inside it.
 *
 * The art is deliberately NOT clamped to the box. A box SMALLER than the art is the useful case,
 * not a mistake — it is how a symbol whose art carries a wide invisible flourish is sized by the
 * part that reads as the symbol, with the rest allowed to hang outside the cell. PIXI draws a
 * trim rect that exceeds `orig` without complaint (`updateQuadBounds` positions the quad from
 * `trim` and takes only the anchor from `orig`), which is the same freedom the Rigger's box has.
 */
export function applyClipBounds(frame: FlipbookFrameBox, bounds: FlipbookBounds): FlipbookFrameBox {
	return {
		origW: bounds.w,
		origH: bounds.h,
		// The art's top-left relative to the ORIGIN, re-based onto the box's top-left.
		offX: frame.offX - frame.origW / 2 - bounds.x,
		offY: frame.offY - frame.origH / 2 - bounds.y,
		artW: frame.artW,
		artH: frame.artH,
	};
}

/**
 * The box that just contains every frame's ART — what the tool's "Fit" offers as a starting
 * point, and the analogue of the Rigger's auto-fit.
 *
 * The union of the ART rects, not of the declared boxes: a frame's declared box is often padding
 * the packer chose, and fitting to padding would reproduce the very margin the author reached for
 * this feature to remove. Frames with no trim have art == box, so an untrimmed clip fits to its
 * largest frame, centred.
 *
 * `undefined` for an empty list \u2014 there is nothing to fit, and a zero box is not a valid bounds.
 */
export function fitClipBounds(frames: FlipbookFrameBox[]): FlipbookBounds | undefined {
	let left = Infinity;
	let top = Infinity;
	let right = -Infinity;
	let bottom = -Infinity;
	for (const f of frames) {
		const l = f.offX - f.origW / 2;
		const t = f.offY - f.origH / 2;
		if (!(f.artW > 0) || !(f.artH > 0)) continue;
		left = Math.min(left, l);
		top = Math.min(top, t);
		right = Math.max(right, l + f.artW);
		bottom = Math.max(bottom, t + f.artH);
	}
	if (!(right > left) || !(bottom > top)) return undefined;
	const round = (n: number): number => Math.round(n * 100) / 100;
	return { x: round(left), y: round(top), w: round(right - left), h: round(bottom - top) };
}
