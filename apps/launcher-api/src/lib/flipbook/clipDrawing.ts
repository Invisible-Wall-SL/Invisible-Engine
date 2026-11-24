/**
 * A CHARACTER'S CLIP READY TO DRAW ON ITS PLACE, for the previews that draw one with
 * `RegionThumb`: the Characters mode's directions preview (`CharacterDirections.svelte`, every
 * facing at once) and Invisible Characters' turn preview (`SheetTurnPreview.svelte`, one
 * character). Each frame is stated against the clip's stage (`characterStage.ts`: the game's own
 * size and feet), with where the feet are on the drawn canvas, so a host lays the canvas with its
 * feet on the place and mirrors about them.
 */
import { boxFit, boxRect } from '../boundsFit';
import {
	DEFAULT_FLIPBOOK_FPS,
	applyClipBounds,
	clipSheetKeys,
	parseFrameRef,
	playbackIndices,
	type FlipbookBounds,
	type FlipbookClip,
	type FlipbookFrameBox,
} from 'engine-flipbook';

import type { EditorRegion, RegionSet } from '../../routes/(app)/editor/editorRegions.client';
import type { CharacterArt } from './characterSet';
import { clipStage, stageFeet } from './characterStage';

/** One authored frame, ready to draw: its region, the box `RegionThumb` fits and where the feet
 *  are on the drawn canvas. */
export interface ClipDraw {
	set: RegionSet;
	record: EditorRegion;
	box: { origW: number; origH: number; offX: number; offY: number };
	feetX: number;
	feetY: number;
}

export interface ClipDrawing {
	/** The side of the square canvas every frame is drawn on, px; 0 when nothing is drawn. */
	size: number;
	/** A frame per authored frame; `null` for one whose region is not found. */
	draws: (ClipDraw | null)[];
	/** The order the frames play in (`playbackIndices`). */
	walk: number[];
	fps: number;
	/** The Bounds overlay on the drawn canvas, and whether it is the clip's own box. */
	overlay: { left: number; top: number; width: number; height: number } | undefined;
	boxed: boolean;
	/** How far the drawing reaches from the feet, px. */
	reach: { side: number; up: number; down: number };
	/** Why nothing is drawn though the clip is there. */
	problem: string;
}

/** A clip that draws nothing, for the reason given. */
export const noClipDrawing = (problem = ''): ClipDrawing => ({
	size: 0,
	draws: [],
	walk: [],
	fps: DEFAULT_FLIPBOOK_FPS,
	overlay: undefined,
	boxed: false,
	reach: { side: 0, up: 0, down: 0 },
	problem,
});

const frameBox = (r: EditorRegion): FlipbookFrameBox => ({
	origW: r.origW ?? r.w,
	origH: r.origH ?? r.h,
	offX: r.offX ?? 0,
	offY: r.offY ?? 0,
	artW: r.w,
	artH: r.h,
});

/**
 * `clip` as `art` draws it, `zoom` times the game's size, out of the sheets read so far
 * (`regionSets`, by key). `bounds` stands in for the clip's own box.
 */
export function clipDrawing(
	art: CharacterArt,
	clip: FlipbookClip,
	regionSets: Readonly<Record<string, RegionSet>>,
	zoom: number,
	bounds: FlipbookBounds | undefined = clip.bounds,
): ClipDrawing {
	const found = clip.frames.map((entry) => {
		const ref = parseFrameRef(entry);
		const set = regionSets[ref.assetKey ?? clip.assetKey];
		const record = set?.regions.find((r) => r.name === ref.region);
		return set && record ? { set, record } : null;
	});
	const loaded = clipSheetKeys(clip).every((key) => !!regionSets[key]);
	if (!found[0]) return noClipDrawing(loaded ? 'Its first frame is not in its sheet.' : '');
	const boxes = found.flatMap((f) => (f ? [frameBox(f.record)] : []));
	const stage = clipStage(art, clip, boxes, zoom, bounds);
	if (!stage) return noClipDrawing();
	const size = Math.max(1, Math.round(stage.scale * Math.max(stage.view.w, stage.view.h)));
	const fit = boxFit(size, stage.view);
	if (!fit) return noClipDrawing();
	const reach = { side: 0, up: 0, down: 0 };
	const draws = found.map((f): ClipDraw | null => {
		if (!f) return null;
		const frame = frameBox(f.record);
		const feet = stageFeet(art, stage, frame);
		const feetX = fit.originX + feet.x * fit.scale;
		const feetY = fit.originY + feet.y * fit.scale;
		const view = boxRect(fit, stage.view);
		reach.side = Math.max(reach.side, feetX - view.left, view.left + view.width - feetX);
		reach.up = Math.max(reach.up, feetY - view.top);
		reach.down = Math.max(reach.down, view.top + view.height - feetY);
		const { origW, origH, offX, offY } = applyClipBounds(frame, stage.view);
		return { ...f, box: { origW, origH, offX, offY }, feetX, feetY };
	});
	return {
		size,
		draws,
		walk: playbackIndices(clip.frames.length, clip.direction),
		fps: clip.fps ?? DEFAULT_FLIPBOOK_FPS,
		overlay: boxRect(fit, stage.box),
		boxed: stage.boxed,
		reach,
		problem: '',
	};
}

/** The scale a clip is drawn at about its place: the game mirrors it (`flipX`), and the clip's own
 *  saved Mirror X turns that over, as in the game. */
export const clipMirror = (
	clip: Pick<FlipbookClip, 'flipX' | 'flipY'>,
	flipX: boolean,
): { sx: number; sy: number } => ({
	sx: (clip.flipX === true) !== flipX ? -1 : 1,
	sy: clip.flipY === true ? -1 : 1,
});
