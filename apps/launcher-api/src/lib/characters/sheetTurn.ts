import {
	createSheetAnimator,
	createSheetRigAnimator,
	fadeAlphas,
	frameKept,
	sheetPlaysClips,
	sheetPlaysRig,
	sheetStillClips,
	type ClipFacing,
	type SheetClipFrame,
	type SheetRigFrame,
	type SheetRigSource,
	type SheetSample,
} from 'engine-layout';
import { characterTurnSector, type CharacterSheet } from 'game-config';

/**
 * THE TURN PREVIEW of Invisible Characters' View card (`SheetTurnPreview.svelte`,
 * `docs/design/character-pipeline.md` §13): one character walking round a slow circle, drawn by
 * what the GAME's animator answers (`engine-layout` `createSheetAnimator` /
 * `createSheetRigAnimator`), fed as a room feeds it: a velocity sample a frame. With the sheet's
 * smooth turn off the picture snaps from facing to facing; with it on it sweeps through the facings
 * in between, each change of picture a blend of the two, and leans where its sheet has a lean, which
 * *Turn about* (the heading turned about at once) shows best.
 *
 * Here: the sample of a heading, the animator of a sheet, what a frame of it reads as, and the
 * frames two clips mixed are on ({@link createTurnClipLayers}). Pure, no Svelte and no Pixi:
 * `scripts/check-characters-tool.ts` drives it.
 */

/** How fast the previewed character moves, world px a second: well past the speed it counts as
 *  moving at. */
export const TURN_PREVIEW_SPEED = 120;
/** How long its heading takes to go once round. */
export const TURN_PREVIEW_CIRCLE_MS = 12_000;

/** What draws a sheet in the preview, or `undefined` for one the game draws nothing for yet (no
 *  source, no draw width or no action) or that has no facings. */
export const turnPreviewKind = (sheet: CharacterSheet | undefined): 'rig' | 'clips' | undefined =>
	sheetPlaysRig(sheet) ? 'rig' : sheetPlaysClips(sheet) ? 'clips' : undefined;

/**
 * The sample of a character moving along `heading` (radians on the ground, clockwise from north)
 * at `atMs`. A top-down view's world is the screen's; an isometric one is drawn on the 2:1 screen,
 * so its world velocity is the one that screen draws along the heading.
 */
export function turnSample(sheet: CharacterSheet, heading: number, atMs: number): SheetSample {
	const sx = Math.sin(heading);
	const sy = -Math.cos(heading);
	if (sheet.view?.kind !== 'isometric')
		return { atMs, vx: sx * TURN_PREVIEW_SPEED, vy: sy * TURN_PREVIEW_SPEED };
	const vx = sx / 2 + sy / 2;
	const vy = sy / 2 - sx / 2;
	const length = Math.hypot(vx, vy);
	return {
		atMs,
		vx: (vx / length) * TURN_PREVIEW_SPEED,
		vy: (vy / length) * TURN_PREVIEW_SPEED,
	};
}

/** What the preview draws this frame, and says of it. */
export type TurnReading = {
	/** The facing drawn (`animator.facing`). */
	facing: ClipFacing;
	/** The lean the picture is drawn at, radians clockwise; 0 for a sheet that does not turn. */
	lean: number;
	/** The clip's id, or `rig/animation`. */
	plays: string;
	/** The picture it is turning from while two are mixed (a clip's id, or `rig/animation`), and
	 *  how much of its own is drawn, 0 to 1. */
	blend?: { from: string; weight: number };
	frame: { clip: SheetClipFrame } | { rig: SheetRigFrame };
};

export type TurnAnimator = {
	/** The frame of a sample, or `undefined` when the sheet has nothing to draw for it. */
	read(sample: SheetSample): TurnReading | undefined;
	readonly facing: ClipFacing;
};

/**
 * The game's animator of `sheet`, started facing `facing`. `clipIds` are the clips there are (the
 * project's; a sheet's still images are added, as the game registers them) and `rigs` what is
 * known of its rigs. The preview raises no signal, so nothing plays once and no clip's length is
 * asked.
 */
export function turnAnimator(
	sheet: CharacterSheet,
	clipIds: Iterable<string>,
	rigs: SheetRigSource,
	facing?: ClipFacing,
): TurnAnimator | undefined {
	const kind = turnPreviewKind(sheet);
	if (kind === 'rig') {
		const animator = createSheetRigAnimator(sheet, rigs, facing);
		return {
			read(sample) {
				const frame = animator.frame(sample);
				return (
					frame && {
						facing: animator.facing,
						lean: frame.lean ?? 0,
						plays: `${frame.rig}/${frame.animation}`,
						...(frame.blend
							? {
									blend: {
										from: `${frame.blend.from.rig}/${frame.blend.from.animation}`,
										weight: frame.blend.weight,
									},
								}
							: {}),
						frame: { rig: frame },
					}
				);
			},
			get facing() {
				return animator.facing;
			},
		};
	}
	if (kind !== 'clips') return undefined;
	const have = new Set([...clipIds, ...sheetStillClips(sheet).map((clip) => clip.id)]);
	const animator = createSheetAnimator(
		sheet,
		{ has: (clipId) => have.has(clipId), cycleMs: () => undefined },
		facing,
	);
	return {
		read(sample) {
			const frame = animator.frame(sample);
			return (
				frame && {
					facing: animator.facing,
					lean: frame.lean ?? 0,
					plays: frame.clipId,
					...(frame.blend
						? { blend: { from: frame.blend.from.clipId, weight: frame.blend.weight } }
						: {}),
					frame: { clip: frame },
				}
			);
		},
		get facing() {
			return animator.facing;
		},
	};
}

/** One clip of the preview as drawn this frame: the frame of its cycle it is on (a place in the
 *  order its frames play in) and how opaque it is. */
export type TurnClipLayer = {
	clipId: string;
	flipX: boolean;
	/** Radians clockwise, about the sheet's pivot. */
	lean: number;
	step: number;
	alpha: number;
};

/** How many frames a clip plays through and how fast, or `undefined` until it can be drawn. */
export type TurnClipCycle = (clipId: string) => { count: number; fps: number } | undefined;

export type TurnClipLayers = {
	/** The clip of `frame` at `atMs`, and under it the one it is turning from while two are mixed. */
	read(
		frame: SheetClipFrame | undefined,
		atMs: number,
		cycleOf: TurnClipCycle,
	): { front: TurnClipLayer; back?: TurnClipLayer } | undefined;
};

type Playing = { key: string; at: number; from: number; count: number; fps: number; loop: boolean };

const stepOf = (playing: Playing, atMs: number): number => {
	const ticks = Math.max(Math.floor(((atMs - playing.at) * playing.fps) / 1000), 0);
	return playing.loop ? (playing.from + ticks) % playing.count : Math.min(ticks, playing.count - 1);
};

/**
 * The frames a sheet's clips are on in the preview, which plays them on its own clock: what the
 * game's look does with its sprites (`engine-layout` `sheetClipLook.ts`). A clip that starts (it,
 * its mirror, its loop or its `play` changed) starts at its first frame. While the frame mixes two
 * (`frame.blend`) both play, cross-faded (`fadeAlphas`), and the one taken starts at the frame the
 * one left had reached (`frameKept`); turned back, the two change places and neither starts again.
 */
export function createTurnClipLayers(): TurnClipLayers {
	let front: Playing | undefined;
	let back: Playing | undefined;
	const keyOf = (f: SheetClipFrame): string => `${f.clipId}|${f.flipX}|${f.loop}|${f.play}`;
	const reached = (playing: Playing | undefined, atMs: number) =>
		playing && { frame: stepOf(playing, atMs), frames: playing.count };
	const play = (
		was: Playing | undefined,
		f: SheetClipFrame,
		atMs: number,
		cycleOf: TurnClipCycle,
		after?: { frame: number; frames: number },
	): Playing | undefined => {
		const cycle = cycleOf(f.clipId);
		if (!cycle || !(cycle.count > 0)) return undefined;
		const key = keyOf(f);
		if (was && was.key === key && was.count === cycle.count) return { ...was, fps: cycle.fps };
		return {
			key,
			at: atMs,
			from: after && f.loop ? frameKept(after.frame, after.frames, cycle.count) : 0,
			count: cycle.count,
			fps: cycle.fps,
			loop: f.loop,
		};
	};
	const layerOf = (f: SheetClipFrame, playing: Playing, atMs: number, alpha: number) => ({
		clipId: f.clipId,
		flipX: f.flipX,
		lean: f.lean ?? 0,
		step: stepOf(playing, atMs),
		alpha,
	});
	return {
		read(frame, atMs, cycleOf) {
			if (!frame) {
				front = back = undefined;
				return undefined;
			}
			const { blend } = frame;
			if (!blend) {
				back = undefined;
				front = play(front, frame, atMs, cycleOf);
				return front && { front: layerOf(frame, front, atMs, 1) };
			}
			if (front?.key !== keyOf(frame)) [front, back] = [back, front];
			front = play(front, frame, atMs, cycleOf, reached(back, atMs));
			back = play(back, blend.from, atMs, cycleOf, reached(front, atMs));
			const alpha = fadeAlphas(blend.weight);
			return (
				front && {
					front: layerOf(frame, front, atMs, back ? alpha.to : 1),
					...(back ? { back: layerOf(blend.from, back, atMs, alpha.from) } : {}),
				}
			);
		},
	};
}

/** A lean in degrees to one decimal, as the preview states it (`data-turn-lean`). */
export function leanDegrees(lean: number): string {
	const text = ((lean * 180) / Math.PI).toFixed(1);
	return text === '-0.0' ? '0.0' : text;
}

/** The blend of a reading as the preview states it (`data-turn-blend`): the picture left and how
 *  much of the one taken is drawn, to two decimals; `''` while one picture is drawn. */
export const blendSays = (reading: TurnReading | undefined): string =>
	reading?.blend ? `${reading.blend.from} ${reading.blend.weight.toFixed(2)}` : '';

/** A heading in whole degrees from north, 0 to 359. */
export const headingDegrees = (heading: number): number =>
	((Math.round((heading * 180) / Math.PI) % 360) + 360) % 360;

/**
 * The stage one character turns on: room for its drawing (`reach`, px from its place) leaned
 * either way by half the angle between two facings of its view, the most a sheet can lean it,
 * about its feet and about its middle (`middle` px above its place). So the stage is the same with
 * the option on or off, and whatever lean and pivot are chosen.
 */
export function turnStageBox(
	sheet: CharacterSheet,
	reach: { side: number; up: number; down: number },
	middle = 0,
): { width: number; height: number; placeX: number; placeY: number } {
	const MAX = 420;
	const PAD = 10;
	const view = sheet.view;
	const half = (characterTurnSector(view && 'facings' in view ? view : {}) / 2) * (Math.PI / 180);
	const cos = Math.cos(half);
	const sin = Math.sin(half);
	let { side, up, down } = reach;
	for (const about of [0, middle]) {
		const above = reach.up - about;
		const below = reach.down + about;
		side = Math.max(side, reach.side * cos + Math.max(Math.abs(above), Math.abs(below)) * sin);
		up = Math.max(up, about + above * cos + reach.side * sin);
		down = Math.max(down, below * cos + reach.side * sin - about);
	}
	const width = Math.min(MAX, Math.ceil(side * 2) + PAD * 2);
	const height = Math.min(MAX, Math.ceil(up + down) + PAD * 2);
	return { width, height, placeX: width / 2, placeY: Math.min(height - PAD, PAD + up) };
}
