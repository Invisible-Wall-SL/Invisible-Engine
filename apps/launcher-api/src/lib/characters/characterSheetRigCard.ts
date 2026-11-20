import { clipMirrorOf } from 'engine-layout';
import type { CharacterSheet } from 'game-config';
import { bonesOf, pointsOf } from './characterSheetEdit';
import type { CellValue } from './characterSheetPage';
import { rigCellText, type RigGridCell } from './characterSheetRigGrid';
import { rigSourceOfSheet, sheetRigNames } from './characterSheetSources';
import type { RigFacts, RigFactsByName } from './rigFacts';

/**
 * WHAT THE CARDS OF A RIG SOURCE LIST (`docs/design/character-pipeline.md` §12.4, §12.7, step
 * C6b): the rigs a sheet names with what the page has read of each, the skins and the bones a
 * picker offers, the rows of the Draw card's bone pickers, and how a cell of the rig grid looks.
 * The cards hold none of it.
 *
 * Pure: `scripts/charactersTool/page.ts` (§15 of `check:characters-tool`) runs each.
 */

/** A rig a sheet names, as the page knows it: its facts once read, else that it is being read
 *  or why it could not be. */
export type RigShown =
	| { name: string; state: 'read'; facts: RigFacts }
	| { name: string; state: 'reading' }
	| { name: string; state: 'failed'; why: string };

/**
 * The rigs a sheet names (`sheetRigNames`: the one rig, the rigs per facing, a cell's), each with
 * what the page has read of it. A rig not read yet is `reading`, never "has no animation": the
 * page says so instead of calling its cells empty.
 */
export function rigsShown(
	sheet: CharacterSheet | undefined,
	rigs: RigFactsByName,
	failed: Readonly<Record<string, string>> = {},
): RigShown[] {
	return sheetRigNames(sheet).map((name): RigShown => {
		if (Object.hasOwn(rigs, name)) return { name, state: 'read', facts: rigs[name] };
		if (Object.hasOwn(failed, name)) return { name, state: 'failed', why: failed[name] };
		return { name, state: 'reading' };
	});
}

/** Whether a rig the sheet names is still being read: its cells are not "nothing plays" yet. */
export const rigsReading = (
	sheet: CharacterSheet | undefined,
	rigs: RigFactsByName,
	failed: Readonly<Record<string, string>> = {},
): boolean => rigsShown(sheet, rigs, failed).some((rig) => rig.state === 'reading');

const union = (lists: readonly (readonly string[])[]): string[] => [...new Set(lists.flat())];

const sourceRigs = (sheet: CharacterSheet | undefined, rigs: RigFactsByName): RigFacts[] => {
	const source = rigSourceOfSheet(sheet);
	if (!source) return [];
	const names = [source.rig, ...Object.values(source.rigs ?? {})];
	return [...new Set(names)].flatMap((name) =>
		name && Object.hasOwn(rigs, name) ? [rigs[name]] : [],
	);
};

/** The skins a variant can name: those of the source's rigs the page has read (the one rig and
 *  the rigs per facing), each once, in the rigs' order. */
export const sheetSkins = (sheet: CharacterSheet | undefined, rigs: RigFactsByName): string[] =>
	union(sourceRigs(sheet, rigs).map((rig) => rig.skins));

/** The bones a point can follow: those of the source's rigs the page has read, each once. */
export const sheetBones = (sheet: CharacterSheet | undefined, rigs: RigFactsByName): string[] =>
	union(sourceRigs(sheet, rigs).map((rig) => rig.bones));

/** One row of the Draw card's bone pickers. */
export interface BonePointRow {
	point: string;
	/** The bone it follows, if any. */
	bone?: string;
	/** It is also a point of the box, which the game falls back to on a rig without the bone. */
	onBox: boolean;
	/** The game reads this point from a bone today (`engine-layout` `sheetRigPoints`). */
	read: boolean;
}

/** The point the game reads off a bone today. */
export const BONE_POINT_READ = 'hand';

/** What the bone picker says of itself. */
export const BONE_TIP =
	'The point follows this bone of the rig instead of its place on the box. The game reads only the "hand" point from a bone today (where a carried thing is held); a rig without the bone falls back to the point on the box.';

/**
 * The rows of the bone pickers: every point of the box, then every other name a bone is stored
 * for (a point need not be on the box to follow a bone), then `hand` when neither has it, since
 * it is the one the game reads.
 */
export function bonePointRows(sheet: CharacterSheet | undefined): BonePointRow[] {
	const bones = new Map(bonesOf(sheet));
	const onBox = pointsOf(sheet).map((point) => point.name);
	const names = [...new Set([...onBox, ...bones.keys(), BONE_POINT_READ])];
	return names.map((point) => {
		const bone = bones.get(point);
		return {
			point,
			...(bone ? { bone } : {}),
			onBox: onBox.includes(point),
			read: point === BONE_POINT_READ,
		};
	});
}

/** An animation as a picker lists it: `walk (0.8 s)`; a pose of one key is `walk (a pose)`. */
export const animationLabel = (animation: { name: string; durationMs: number }): string =>
	animation.durationMs > 0
		? `${animation.name} (${Number((animation.durationMs / 1000).toFixed(2))} s)`
		: `${animation.name} (a pose)`;

/** How a cell of the rig grid is drawn, in the clips grid's own four looks. */
export type RigCellLook = 'made' | 'mirrored' | 'standIn' | 'none';

/**
 * The look of a rig cell, as the clips grid shows a clip cell: `made` when the facing has its
 * animation (named in the cell or found by name) drawn as made, `mirrored` when what is drawn is
 * mirrored (the one rig in a west facing, or its twin's), `standIn` when another facing's or
 * another action's stands in unmirrored, `none` when nothing is drawn.
 */
export function rigCellLook(cell: RigGridCell): RigCellLook {
	if (cell.how === 'none') return 'none';
	if (cell.how === 'fallback') return 'standIn';
	if (cell.how === 'standIn')
		return cell.flipX && cell.from === clipMirrorOf(cell.facing) ? 'mirrored' : 'standIn';
	return cell.flipX ? 'mirrored' : 'made';
}

/** The glyph of each look, the clips grid's. */
export const RIG_CELL_MARKS: Record<RigCellLook, string> = {
	made: '✓',
	mirrored: '⇋',
	standIn: '≈',
	none: '—',
};

/** What an EMPTY cell looks for, in the game's order: `walk_ne, then walk on otterRig`. Empty
 *  when the cell names its animation or no rig is asked. */
export function rigCellDefault(cell: RigGridCell): string {
	if (cell.holds || !cell.looksOn || !cell.looksFor.length) return '';
	return `${cell.looksFor.join(', then ')} on ${cell.looksOn}`;
}

/**
 * A cell in a sentence, for its tooltip and its editor: what it looks for and what the game
 * draws. `reading` (a rig the sheet names is not read yet) says so instead of "nothing".
 */
export function rigCellTitle(cell: RigGridCell, reading = false): string {
	const asked = cell.holds
		? `Named here: ${cell.holds.anim}${cell.holds.rig ? ` on ${cell.holds.rig}` : ''}.`
		: cell.unread
			? `Holds a ${cell.unread.toLowerCase()}, which a rig does not draw.`
			: rigCellDefault(cell)
				? `By name: ${rigCellDefault(cell)}.`
				: 'No rig is asked for this facing.';
	const drawn =
		cell.how === 'none'
			? reading
				? 'Reading the rig…'
				: 'Nothing is drawn: the look’s own animation shows.'
			: `Draws ${rigCellText(cell)}.`;
	return `${cell.state}, facing ${cell.facing}. ${asked} ${drawn}`;
}

/** The rig whose animations a cell's picker lists: the one it names, else the one asked first
 *  for its facing. */
export const rigCellRig = (cell: RigGridCell, picked = ''): string | undefined =>
	picked || cell.holds?.rig || cell.looksOn;

/** The animation and the rig a cell value names, when it is a rig's. */
export const rigCellStored = (
	value: CellValue | undefined,
): { animation: string; rig?: string } | undefined =>
	value?.kind === 'rig'
		? { animation: value.anim, ...(value.rig ? { rig: value.rig } : {}) }
		: undefined;

/** The value a rig cell stores for an animation, on another rig when `rig` is given; `undefined`
 *  (the cell is emptied, found by name) for no animation: a rig alone is not stored. */
export const rigCellValue = (animation: string, rig = ''): CellValue | undefined =>
	animation.trim()
		? { kind: 'rig', anim: animation.trim(), ...(rig.trim() ? { rig: rig.trim() } : {}) }
		: undefined;
