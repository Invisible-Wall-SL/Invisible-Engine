/**
 * The three facts about a character sheet that Game Config, Invisible Characters and Flipbook's
 * Characters mode each need and must not decide twice (`docs/design/character-pipeline.md` step
 * C2b):
 *
 *   - what is wrong with a config, as the save says it ({@link savedIssues});
 *   - the one projection a sheet's view is checked against ({@link projectionOf});
 *   - why the game does not play a sheet ({@link sheetUnplayed}), and why a class does not play
 *     the sheet it names ({@link classSheetRefusal}).
 *
 * Each tool keeps its own words and its own list shape, and calls these for the answer. A leaf
 * module: it imports only `game-config` and `engine-layout`, so every tool's helpers can.
 *
 * Pure. `check:characters-tool`, `check:config-character-sheets` and `check:flipbook-characters`
 * run it through its callers.
 */
import {
	sheetAwareIssues,
	validateCharacterSheets,
	validateGameConfigDoc,
	type CharacterSheet,
	type GameConfigDoc,
	type GameConfigIssue,
} from 'game-config';
import { sheetFacings, sheetPlaysClips } from 'engine-layout';

/** The projection the validator is told: isometric when a screen of the project is, else flat. */
export const projectionOf = (projections: readonly (string | undefined)[]): 'isometric' | 'flat' =>
	projections.includes('isometric') ? 'isometric' : 'flat';

/**
 * What a save says of `doc` (`$lib/server/gameConfigStorage` `prepareGameConfigDoc`, a 3D world's
 * own errors aside, which only the server reads): the validator's issues and the sheets', without
 * the "no bot plays it" warning for a character that is a class's sheet. The save knows no
 * `projection`; with one, the view warnings that need a screen are listed too, where the
 * validator puts them.
 */
export const savedIssues = (
	doc: GameConfigDoc,
	projection?: 'isometric' | 'flat',
): GameConfigIssue[] =>
	sheetAwareIssues(
		[...validateGameConfigDoc(doc), ...validateCharacterSheets(doc, { projection })],
		doc,
	);

/** Something that keeps the game from playing a sheet's clips. */
export type SheetUnplayed =
	/** It has none of the four fields. */
	| 'empty'
	/** Its animation source is not frame clips. */
	| 'source'
	/** Its view has no facings (3D). */
	| 'facings'
	/** Its draw box has no width. */
	| 'draw'
	/** It has no action. */
	| 'actions'
	/** Nothing above, and this build still does not play it. */
	| 'build';

/**
 * Everything that keeps the game from playing a sheet's clips (`sheetPlaysClips`); empty when it
 * plays them. All of them, not the first: Flipbook names the source before the view and
 * Characters the view before the source, so each caller picks in its own order.
 */
export function sheetUnplayed(sheet: CharacterSheet | undefined): SheetUnplayed[] {
	const played: boolean = sheetPlaysClips(sheet);
	if (played) return [];
	if (!sheet) return ['empty'];
	const why: SheetUnplayed[] = [];
	if (!sheet.source) why.push('source');
	if (!sheetFacings(sheet).length) why.push('facings');
	if (!sheet.draw || !(sheet.draw.width > 0)) why.push('draw');
	if (!sheet.actions?.length) why.push('actions');
	return why.length ? why : ['build'];
}

/** The first of `order` among `why`, else the first of `why`. */
export const firstUnplayed = (
	why: readonly SheetUnplayed[],
	order: readonly SheetUnplayed[],
): SheetUnplayed | undefined => order.find((reason) => why.includes(reason)) ?? why[0];

/** Why a class does not play the sheet it names. */
export type ClassSheetRefusal =
	/** No character of the config has that id. */
	| { kind: 'noCharacter' }
	/** The character is drawn as another component than the class's body. */
	| { kind: 'component'; component: string }
	/** The sheet is not one the game plays; `why` is empty when only the class is at fault (the
	 *  config does not keep it). */
	| { kind: 'sheet'; why: SheetUnplayed[] };

/**
 * Why the class `cls` does not play the sheet it names (the reasons `onlineClassSheetOf` and
 * `sheetPlaysClips` refuse one for), or `undefined` when its sheet plays. `character` is the
 * config character of that id and `sheet` its sheet, each as the caller reads them.
 */
export function classSheetRefusal(
	cls: { body: string },
	character: { component: string } | undefined,
	sheet: CharacterSheet | undefined,
): ClassSheetRefusal | undefined {
	if (!character) return { kind: 'noCharacter' };
	if (character.component !== cls.body)
		return { kind: 'component', component: character.component };
	const why = sheetUnplayed(sheet);
	return why.length ? { kind: 'sheet', why } : undefined;
}
