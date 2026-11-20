/**
 * HOW A CHARACTER'S CLIP STANDS ON ITS PLACE, for the Characters mode's directions preview: the
 * game's own rule (`engine-layout` `<SpawnLayer>` and `clipBox`), in the launcher's terms.
 *
 * The game draws a clip with its box `displayWidth` wide and the point `anchorY` down the middle
 * of that box (the feet) on the character's place. The box is the clip's Bounds; a clip with none
 * is sized by its first frame's canvas and each frame stands on its own. Art that reaches outside
 * the box is drawn all the same.
 *
 * Pure: `scripts/check-flipbook-characters.ts` holds the scale to `clipBox`'s.
 */
import {
	fitClipBounds,
	isFlipbookBounds,
	parseFrameRef,
	type FlipbookBounds,
	type FlipbookClip,
	type FlipbookFrameBox,
} from 'engine-flipbook';
import { clipBox } from 'engine-layout';

import { characterDraw, feetOf, type CharacterArt } from './characterSet';

export interface ClipStage {
	/** The box the clip is sized by: its Bounds, or with none its first frame's canvas. */
	box: FlipbookBounds;
	/** `box` is the clip's Bounds. Without one, each frame stands on its own canvas. */
	boxed: boolean;
	/** Drawn px per art px. */
	scale: number;
	/** The art-space window that holds the box and every frame's art, centred on the art's origin
	 *  like a Bounds box. */
	view: FlipbookBounds;
}

/** A frame's own canvas as a box about the art's origin. */
const canvasOf = (frame: FlipbookFrameBox): FlipbookBounds => ({
	x: -frame.origW / 2,
	y: -frame.origH / 2,
	w: frame.origW,
	h: frame.origH,
});

function union(boxes: readonly FlipbookBounds[]): FlipbookBounds {
	const left = Math.min(...boxes.map((b) => b.x));
	const top = Math.min(...boxes.map((b) => b.y));
	const right = Math.max(...boxes.map((b) => b.x + b.w));
	const bottom = Math.max(...boxes.map((b) => b.y + b.h));
	return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * The stage of a clip drawn for `look`, `zoom` times the game's size. `frames` are the clip's
 * frames whose regions are loaded, in order; `undefined` until its first is. `bounds` stands in
 * for the clip's own (a box the author is about to apply).
 */
export function clipStage(
	look: CharacterArt,
	clip: Pick<FlipbookClip, 'id' | 'name' | 'assetKey' | 'frames' | 'bounds'>,
	frames: readonly FlipbookFrameBox[],
	zoom = 1,
	bounds: FlipbookBounds | undefined = clip.bounds,
): ClipStage | undefined {
	const first = frames[0];
	if (!first || !clip.frames[0]) return undefined;
	const sized = clipBox(
		{ ...clip, bounds },
		{ [parseFrameRef(clip.frames[0]).region]: { width: first.origW, height: first.origH } },
	);
	if (!sized) return undefined;
	const boxed = isFlipbookBounds(bounds);
	const box = boxed ? bounds : canvasOf(first);
	const art = fitClipBounds([...frames]);
	return {
		box,
		boxed,
		scale: (characterDraw(look).width * zoom) / sized.w,
		view: union([box, ...(art ? [art] : []), ...(boxed ? [] : frames.map(canvasOf))]),
	};
}

/** Where the feet are while `frame` shows, in art px about the art's origin. */
export function stageFeet(
	look: CharacterArt,
	stage: ClipStage,
	frame: FlipbookFrameBox,
): { x: number; y: number } {
	return feetOf(look, stage.boxed ? stage.box : canvasOf(frame));
}
