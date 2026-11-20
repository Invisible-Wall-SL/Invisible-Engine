import type { CharacterAction, CharacterRigSource, CharacterSheet } from 'game-config';
import { clipMirrorOf, resolveSheetRig, type ClipFacing } from 'engine-layout';
import { characterFacings, characterStates, type CharacterState } from '../flipbook/characterSet';
import { rigSourceOf, type RigFactsByName } from './rigFacts';
import { CELL_KIND_LABELS, cellKindOf, cellText } from './sheetCore';

/**
 * WHAT THE ACTIONS GRID SHOWS FOR A RIG (`docs/design/character-pipeline.md` §12.4, step C6b):
 * per action and facing of the view, the rig animation the game draws, found by the game's own
 * resolver (`engine-layout` `resolveSheetRig`) over the rigs the page has read
 * (`rigFacts.ts`), so the grid cannot disagree with the room. Shaped as Flipbook's clips grid
 * (`$lib/flipbook/characterSet` `characterGrid`): the same rows, the same split of the facings
 * into drawn and mirrored, one cell per facing in that order.
 *
 * Pure: `scripts/charactersTool/sources.ts` holds every cell equal to the resolver's answer.
 */

/** How a cell came by what it draws. */
export type RigCellHow =
	/** The sheet names the animation in this cell. */
	| 'cell'
	/** Left empty, and found by name: `<action>_<facing>`, or `<action>` on the facing's own rig,
	 *  or the one rig's `<action>` drawn in this facing (mirrored when it looks west). */
	| 'byName'
	/** Another facing's animation of this action: its twin's mirrored, or the nearest outward. */
	| 'standIn'
	/** Another action's (`fallback`): this one has no animation in any facing. */
	| 'fallback'
	/** Nothing: the look's own tree is drawn. */
	| 'none';

export interface RigGridCell {
	state: string;
	facing: ClipFacing;
	/** The view draws this facing as made (its twin's is mirrored into the others). */
	drawn: boolean;
	/** What the sheet stores here, when it is a rig's animation. */
	holds?: { anim: string; rig?: string };
	/** What the sheet stores here that a rig does not draw (a clip, a still image), in words. */
	unread?: string;
	/** The rig asked first for this facing: the cell's, else the facing's own, else the one rig. */
	looksOn?: string;
	/** The animation names asked of it, in the game's order. */
	looksFor: string[];
	how: RigCellHow;
	/** What is drawn (absent for `none`). */
	rig?: string;
	animation?: string;
	flipX: boolean;
	/** The facing the animation was found for, when it stands in for this one. */
	from?: ClipFacing;
	/** The action drawn in this one's place (`fallback`). */
	action?: string;
	/** The skin worn while the statuses asked hold. */
	skin?: string;
}

export interface RigGrid {
	drawn: ClipFacing[];
	mirrored: ClipFacing[];
	/** Actions down; each row's cells follow `drawn` then `mirrored`. */
	rows: (CharacterState & { cells: RigGridCell[] })[];
}

/** What the game asks first for one facing of an action (`resolveRigIn`'s choice of rig and
 *  names, read here only to say HOW a cell was found; what is drawn is the resolver's). */
function askedFirst(
	source: CharacterRigSource,
	action: CharacterAction,
	facing: ClipFacing,
): { rig: string | undefined; names: string[]; later: string[] } {
	const cell = action.anim?.[facing];
	const own = source.rigs?.[facing];
	const named = cell?.anim;
	const rig = (named !== undefined && cell?.rig) || own || source.rig;
	if (named !== undefined) return { rig, names: [named], later: [] };
	const byFacing = `${action.id}_${facing}`;
	return own
		? { rig, names: [byFacing, action.id], later: [] }
		: { rig, names: [byFacing], later: source.rig ? [action.id] : [] };
}

/**
 * The grid of a character drawn as a rig, while `statuses` hold (they pick the skin). A sheet with
 * no draw width yet is asked with one, which decides no animation, so its grid reads as it will
 * play. A sheet whose source is not a rig, or a rig the page has not read, draws nothing: every
 * cell is `none`.
 */
export function rigGrid(
	sheet: CharacterSheet,
	rigs: RigFactsByName,
	statuses: readonly string[] = [],
): RigGrid {
	const asked: CharacterSheet =
		sheet.draw && sheet.draw.width > 0 ? sheet : { ...sheet, draw: { ...sheet.draw, width: 1 } };
	const source = sheet.source?.kind === 'rig' ? sheet.source : undefined;
	const facts = rigSourceOf(rigs);
	const { drawn, mirrored } = characterFacings(sheet);
	const first = new Map<string, CharacterAction>();
	for (const action of sheet.actions ?? []) if (!first.has(action.id)) first.set(action.id, action);
	const has = (action: CharacterAction, facing: ClipFacing): boolean => {
		const { rig, names } = source ? askedFirst(source, action, facing) : { rig: '', names: [] };
		return !!rig && names.some((name) => facts.has(rig, name));
	};
	const cell = (state: string, facing: ClipFacing): RigGridCell => {
		const action = first.get(state);
		const stored = action?.anim?.[facing];
		const looks = source && action ? askedFirst(source, action, facing) : undefined;
		const base: Omit<RigGridCell, 'how' | 'flipX'> = {
			state,
			facing,
			drawn: drawn.includes(facing),
			...(stored?.anim
				? { holds: { anim: stored.anim, ...(stored.rig ? { rig: stored.rig } : {}) } }
				: stored
					? { unread: `${CELL_KIND_LABELS[cellKindOf(stored)]}: ${cellText(stored)}` }
					: {}),
			...(looks?.rig ? { looksOn: looks.rig } : {}),
			looksFor: looks ? [...looks.names, ...looks.later] : [],
		};
		const found = action && resolveSheetRig(asked, state, facing, statuses, facts);
		if (!action || !found) return { ...base, how: 'none', flipX: false };
		const plays = {
			rig: found.rig,
			animation: found.animation,
			flipX: found.flipX,
			...(found.skin ? { skin: found.skin } : {}),
		};
		if (found.action !== state) return { ...base, ...plays, how: 'fallback', action: found.action };
		if (has(action, facing)) return { ...base, ...plays, how: stored?.anim ? 'cell' : 'byName' };
		const from = found.flipX ? (clipMirrorOf(found.facing) ?? found.facing) : found.facing;
		// The one rig's `<action>`, drawn in the facing asked: no facing had an animation.
		const oneRig = from === facing || (found.facing === facing && !has(action, from));
		return oneRig
			? { ...base, ...plays, how: 'byName' }
			: { ...base, ...plays, how: 'standIn', from };
	};
	return {
		drawn,
		mirrored,
		rows: characterStates(sheet).map((row) => ({
			...row,
			cells: [...drawn, ...mirrored].map((facing) => cell(row.state, facing)),
		})),
	};
}

/** A cell of the grid in words: `walk (otterRig), mirrored`, `idle_se (otterRig), from se`,
 *  `nothing`. */
export function rigCellText(cell: RigGridCell): string {
	if (cell.how === 'none') return 'nothing';
	const drawn = `${cell.animation} (${cell.rig})${cell.flipX ? ', mirrored' : ''}`;
	const skin = cell.skin ? `, skin ${cell.skin}` : '';
	const how =
		cell.how === 'cell'
			? ', named here'
			: cell.how === 'byName'
				? ', by name'
				: cell.how === 'standIn'
					? `, from ${cell.from}`
					: `, the action ${cell.action}`;
	return `${drawn}${how}${skin}`;
}
