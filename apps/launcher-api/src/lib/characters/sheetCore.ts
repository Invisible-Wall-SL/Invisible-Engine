/**
 * The three facts about a character sheet that Game Config, Invisible Characters and Flipbook's
 * Characters mode each need and must not decide twice (`docs/design/character-pipeline.md` step
 * C2b):
 *
 *   - what is wrong with a config, as the save says it ({@link savedIssues});
 *   - the one projection a sheet's view is checked against ({@link projectionOf});
 *   - what a sheet is drawn as ({@link sheetDrawnAs}), why the game does not draw one
 *     ({@link sheetUnplayed}), and why a class does not play the sheet it names
 *     ({@link classSheetRefusal}).
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
	type CharacterCell,
	type CharacterSheet,
	type CharacterSource,
	type GameConfigDoc,
	type GameConfigIssue,
} from 'game-config';
import { sheetFacings, sheetPlaysClips, sheetPlaysRig } from 'engine-layout';

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

export type SourceKind = CharacterSource['kind'];

/** What each kind of animation source is called. */
export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
	clips: 'Frame clips',
	rig: 'Rig',
	stills: 'Still images',
};

/** The kinds of animation source a sheet can have, in the order they are offered, each with what
 *  it is in one line (the card's choice and the Whole view show it). */
export const SOURCE_KINDS: readonly { value: SourceKind; label: string; description: string }[] = [
	{
		value: 'clips',
		label: SOURCE_KIND_LABELS.clips,
		description:
			'Flipbook clips, found by name: <prefix>_<action>_<facing>. Made in Invisible Flipbook.',
	},
	{
		value: 'rig',
		label: SOURCE_KIND_LABELS.rig,
		description:
			'A rig from Invisible Rigger: one for every facing, or one per facing. Its animations are found by the action’s name.',
	},
	{
		value: 'stills',
		label: SOURCE_KIND_LABELS.stills,
		description:
			'Single images of a project sheet, one picked per action and facing. Nothing is found by name.',
	},
];

/** Each kind in a sentence: `the source is a rig`. */
export const SOURCE_KIND_WORDS: Record<SourceKind, string> = {
	clips: 'frame clips',
	rig: 'a rig',
	stills: 'still images',
};

/** A sheet's source in words, with what it names: `a rig (otterRig; ne: otterBack)`. */
export function sourceText(source: CharacterSource): string {
	if (source.kind === 'clips') return `${SOURCE_KIND_WORDS.clips} (${source.prefix})`;
	if (source.kind === 'stills') return SOURCE_KIND_WORDS.stills;
	const rigs = [
		...(source.rig ? [source.rig] : []),
		...Object.entries(source.rigs ?? {}).map(([facing, rig]) => `${facing}: ${rig}`),
	];
	return `${SOURCE_KIND_WORDS.rig} (${rigs.join('; ')})`;
}

/** What a cell of `anim` holds, by kind. */
export type CellKind = 'clip' | 'still' | 'rig';
export const CELL_KIND_LABELS: Record<CellKind, string> = {
	clip: 'Clip',
	still: 'Still image',
	rig: 'Rig animation',
};

/** The kind of a stored cell, as the normalizer reads it: the first of `clip`, `still`, `anim`. */
export const cellKindOf = (cell: CharacterCell): CellKind =>
	cell.clip ? 'clip' : cell.still ? 'still' : 'rig';

/**
 * The kinds of cell a source draws (`engine-layout` `characterSheet.ts`, §12.4): frame clips a
 * clip or a still image, a rig its animations, still images a still. With no source nothing is
 * drawn yet, and a cell of any kind is kept for the source to come.
 */
export const cellKindsRead = (source: CharacterSource | undefined): readonly CellKind[] =>
	!source
		? ['clip', 'still', 'rig']
		: source.kind === 'rig'
			? ['rig']
			: source.kind === 'stills'
				? ['still']
				: ['clip', 'still'];

/** A stored cell's value in words: the clip's id, `region (assetKey)`, `animation (rig)`. */
export const cellText = (cell: CharacterCell): string =>
	cell.clip
		? cell.clip
		: cell.still
			? `${cell.still.region} (${cell.still.assetKey})`
			: `${cell.anim}${cell.rig ? ` (${cell.rig})` : ''}`;

/**
 * What the game draws a sheet as (`apps/lines` `online.ts`: `sheetPlaysRig`, else
 * `sheetPlaysClips`, which draws still images too, each as a clip of one frame), or `undefined`
 * when it draws the character as one with no sheet.
 */
export function sheetDrawnAs(
	sheet: CharacterSheet | undefined,
): CharacterSource['kind'] | undefined {
	const rig: boolean = sheetPlaysRig(sheet);
	const clips: boolean = sheetPlaysClips(sheet);
	if (rig) return 'rig';
	return clips ? (sheet?.source?.kind === 'stills' ? 'stills' : 'clips') : undefined;
}

/** Something that keeps the game from drawing a sheet. */
export type SheetUnplayed =
	/** It has none of the four fields. */
	| 'empty'
	/** It has no animation source. */
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
 * Everything that keeps the game from drawing a sheet ({@link sheetDrawnAs}); empty when it
 * draws it. All of them, not the first: Flipbook names the source before the view and
 * Characters the view before the source, so each caller picks in its own order.
 */
export function sheetUnplayed(sheet: CharacterSheet | undefined): SheetUnplayed[] {
	if (sheetDrawnAs(sheet)) return [];
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
 * {@link sheetDrawnAs} refuse one for), or `undefined` when its sheet plays. `character` is the
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
