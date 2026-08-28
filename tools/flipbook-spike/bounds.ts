/**
 * Invisible Flipbook — headless harness for the clip BOUNDS box (`engine-flipbook`'s
 * `applyClipBounds` / `fitClipBounds`):
 *
 *   pnpm --filter flipbook-spike run bounds
 *
 * The box is the flipbook twin of the Rigger's `skeleton.{x,y,width,height}`, and it reaches
 * pixels by RE-STATING each frame as `orig` (the declared box) + `trim` (the art inside it) —
 * the vocabulary PIXI already sizes and anchors every sprite in. So what has to hold is:
 *
 *  1. Every frame ends up with the SAME declared box. That is the anti-pulse property: frames
 *     that packed to different rects used to be contain-fitted independently, so the animation
 *     changed scale as it played.
 *  2. The art keeps its size and its position RELATIVE TO THE OTHER FRAMES. A box may move where
 *     the animation sits; it must never move one frame against another.
 *  3. A box SMALLER than the art is legal and produces a trim rect that sticks out of `orig`.
 *     That is the scatter-with-invisible-rays case — size by the part that reads, let the rest
 *     hang outside the cell — and PIXI draws it without complaint (`updateQuadBounds` positions
 *     the quad from `trim` and takes only the anchor from `orig`).
 *  4. An untouched frame + no box is byte-identical to before (parity).
 */

import { applyClipBounds, fitClipBounds, type FlipbookFrameBox } from 'engine-flipbook';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};

/** An UNTRIMMED frame: the art fills its declared canvas. */
const plain = (w: number, h: number): FlipbookFrameBox => ({
	origW: w,
	origH: h,
	offX: 0,
	offY: 0,
	artW: w,
	artH: h,
});

console.log('flipbook bounds — every frame ends up in the same declared box');
const boxed = [plain(100, 100), plain(60, 40)].map((f) =>
	applyClipBounds(f, { x: -50, y: -50, w: 100, h: 100 }),
);
assert(
	boxed.every((b) => b.origW === 100 && b.origH === 100),
	'two frames of different sizes declare the SAME box (the anti-pulse property)',
);
assert(
	boxed[0].offX === 0 && boxed[0].offY === 0,
	'a frame the size of the box sits at its origin',
);
assert(
	boxed[1].offX === 20 && boxed[1].offY === 30,
	'a smaller frame stays CENTRED against the larger one (60 wide in a 100 box ⇒ offset 20)',
);
assert(
	boxed[1].artW === 60 && boxed[1].artH === 40,
	'the art keeps its own size — a box declares space, it does not resize art',
);

console.log('flipbook bounds — an off-centre box moves the whole animation together');
const shifted = [plain(100, 100), plain(60, 40)].map((f) =>
	applyClipBounds(f, { x: -50, y: -80, w: 100, h: 100 }),
);
assert(
	shifted[0].offY - boxed[0].offY === 30 && shifted[1].offY - boxed[1].offY === 30,
	'both frames move by the SAME amount — a box never moves one frame against another',
);

console.log('flipbook bounds — a TRIMMED frame keeps its art where the packer put it');
const trimmed: FlipbookFrameBox = {
	origW: 684,
	origH: 684,
	offX: 105,
	offY: 99,
	artW: 487,
	artH: 487,
};
const t = applyClipBounds(trimmed, { x: -342, y: -342, w: 684, h: 684 });
assert(
	t.offX === 105 && t.offY === 99 && t.origW === 684,
	'a box identical to the frame’s own centred canvas is a no-op on the art position',
);

console.log('flipbook bounds — a box SMALLER than the art is legal (the invisible-rays case)');
const tight = applyClipBounds(plain(1000, 1000), { x: -100, y: -100, w: 200, h: 200 });
assert(tight.origW === 200 && tight.origH === 200, 'the declared box is what was asked for');
assert(
	tight.offX === -400 && tight.offY === -400,
	'the art hangs outside the box on every side (a negative trim offset)',
);
assert(
	tight.offX + tight.artW > tight.origW,
	'the art deliberately extends past the box — this is the point, not a bug',
);

console.log('flipbook bounds — auto-fit');
assert(
	JSON.stringify(fitClipBounds([plain(100, 100), plain(60, 40)])) ===
		JSON.stringify({ x: -50, y: -50, w: 100, h: 100 }),
	'the fit is the union of the frames’ art, origin-centred',
);
assert(
	JSON.stringify(fitClipBounds([trimmed])) === JSON.stringify({ x: -237, y: -243, w: 487, h: 487 }),
	'a trimmed frame fits to its ART, not to the padding the packer left around it',
);
assert(fitClipBounds([]) === undefined, 'nothing to fit ⇒ no box (never a zero-sized one)');
assert(
	fitClipBounds([{ ...plain(10, 10), artW: 0, artH: 0 }]) === undefined,
	'a frame with no art contributes nothing',
);

console.log('flipbook bounds — fitting then applying is a no-op on relative placement');
const frames = [plain(100, 100), { ...plain(60, 40), offX: 10, offY: 5, origW: 80, origH: 60 }];
const fit = fitClipBounds(frames);
const refitted = frames.map((f) => applyClipBounds(f, fit!));
assert(
	refitted[1].offX - refitted[0].offX ===
		frames[1].offX - frames[1].origW / 2 - (frames[0].offX - frames[0].origW / 2),
	'after the auto-fit, the frames sit exactly where they sat relative to each other',
);

console.log('');
if (failures > 0) {
	console.error(`FLIPBOOK BOUNDS: ${failures} FAILURE(S)`);
	process.exit(1);
}
console.log('FLIPBOOK BOUNDS: PASSED');
