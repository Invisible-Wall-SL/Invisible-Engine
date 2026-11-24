import {
	createSheetAnimator,
	createSheetRigAnimator,
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
 * smooth turn off the picture snaps from facing to facing; with it on it leans and sweeps, which
 * *Reverse* (the heading turned about at once) shows best.
 *
 * Here: the sample of a heading, the animator of a sheet and what a frame of it reads as. Pure, no
 * Svelte and no Pixi: `scripts/check-characters-tool.ts` drives it.
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
					frame: { clip: frame },
				}
			);
		},
		get facing() {
			return animator.facing;
		},
	};
}

/** A lean in degrees to one decimal, as the preview states it (`data-turn-lean`). */
export function leanDegrees(lean: number): string {
	const text = ((lean * 180) / Math.PI).toFixed(1);
	return text === '-0.0' ? '0.0' : text;
}

/** A heading in whole degrees from north, 0 to 359. */
export const headingDegrees = (heading: number): number =>
	((Math.round((heading * 180) / Math.PI) % 360) + 360) % 360;

/**
 * The stage one character turns on: room for its drawing (`reach`, px from its place) leaned
 * either way by half the angle between two facings of its view, the most a sheet can lean it. So
 * the stage is the same with the option on or off, and whatever lean is typed.
 */
export function turnStageBox(
	sheet: CharacterSheet,
	reach: { side: number; up: number; down: number },
): { width: number; height: number; placeX: number; placeY: number } {
	const MAX = 420;
	const PAD = 10;
	const view = sheet.view;
	const half = (characterTurnSector(view && 'facings' in view ? view : {}) / 2) * (Math.PI / 180);
	const tall = Math.max(reach.up, reach.down);
	const side = reach.side * Math.cos(half) + tall * Math.sin(half);
	const up = Math.max(reach.up, reach.up * Math.cos(half) + reach.side * Math.sin(half));
	const down = Math.max(reach.down, reach.down * Math.cos(half) + reach.side * Math.sin(half));
	const width = Math.min(MAX, Math.ceil(Math.max(side, reach.side) * 2) + PAD * 2);
	const height = Math.min(MAX, Math.ceil(up + down) + PAD * 2);
	return { width, height, placeX: width / 2, placeY: Math.min(height - PAD, PAD + up) };
}
