/**
 * What the `/characters` page decides about a character sheet beyond one edit
 * (`docs/design/character-pipeline.md` §5, §9, step C2b): which character and card a link opens,
 * which online classes have no character yet, what *Make this a sheet* is made from, what
 * *Compare* compares, the value of one cell of the actions grid, and the words for what a rename,
 * a removal or a look change did to the classes.
 *
 * The page and its cards hold no logic of their own: they call these, the edits of
 * `./characterSheetEdit` and `./characterSheetActions`, and the checks of `./characterSheetCheck`.
 *
 * Pure: `scripts/check-characters-tool.ts` §9 runs each.
 */
import type { CharacterClips } from 'engine-layout';
import type { CharacterFacing, CharacterSheet, GameConfigDoc } from 'game-config';
import { projectCharacters, type ProjectCharacter } from '../flipbook/projectCharacters';
import { classesNamingSheet, findCharacter } from './characterEdit';
import { setActionAnim } from './characterSheetActions';
import {
	classDrawing,
	compareCells,
	compareSheets,
	type CellDifference,
	type CellDrawn,
	type ClassDrawing,
	type SheetDifference,
} from './characterSheetCheck';
import { classesOfComponent, findClass, sheetOf } from './characterSheetEdit';
import type { WholeComponent } from './characterWhole';

// ── the link that opens a card ─────────────────────────────────────────────────────────────────

/** The sheet's cards, by the id a link names (`&card=`), in the order the page shows them. */
export const SHEET_CARDS = ['sheet', 'view', 'source', 'draw', 'actions', 'online'] as const;
export type SheetCard = (typeof SHEET_CARDS)[number];

/** What each card is called. */
export const SHEET_CARD_TITLES: Record<SheetCard, string> = {
	sheet: 'Character sheet',
	view: 'View',
	source: 'Animation source',
	draw: 'Draw box and points',
	actions: 'Actions',
	online: 'Online class',
};

/** The card's id on its `SectionCard`, and the id of the element a link scrolls to. */
export const sheetCardId = (card: SheetCard): string => `sheet-${card}`;

/**
 * What `?character=<id>&card=<card>` opens: the character of that id, and the card to unfold and
 * scroll to. An id the config does not have is ignored (the first character is selected, as with
 * no query), and then so is the card; so is a card that is not one of {@link SHEET_CARDS}.
 */
export function parseSheetQuery(
	params: URLSearchParams,
	doc: GameConfigDoc,
): { characterId: string | null; card?: SheetCard } {
	const characters = doc.arcade?.characters ?? [];
	const asked = params.get('character')?.trim() ?? '';
	const found = asked ? characters.find((c) => c.id === asked) : undefined;
	if (!found) return { characterId: characters[0]?.id ?? null };
	const card = SHEET_CARDS.find((c) => c === params.get('card'));
	return { characterId: found.id, ...(card ? { card } : {}) };
}

// ── the classes and what they play ─────────────────────────────────────────────────────────────

/** The online classes no config character is drawn as (Salmons' `salmon`): the ones only
 *  *Make this a sheet* or Add character can give a sheet. */
export const classesWithoutCharacter = (doc: GameConfigDoc): string[] => {
	const looks = new Set((doc.arcade?.characters ?? []).map((c) => c.component));
	return (doc.arcade?.online?.characters ?? []).filter((c) => !looks.has(c.body)).map((c) => c.id);
};

/** The project's characters that play clips, as Flipbook lists them for `doc`. */
export const castOf = (
	components: readonly WholeComponent[],
	doc: GameConfigDoc,
): ProjectCharacter[] => projectCharacters(components, doc);

/** The block the class `classId` plays without a sheet (its component's, else the game's own), or
 *  `undefined` when it plays a sheet or nothing. */
export const classBlock = (
	cast: readonly ProjectCharacter[],
	classId: string,
): CharacterClips | undefined =>
	cast.find((c) => c.inConfig && c.key === classId && c.source !== 'sheet')?.look;

/**
 * What *Make this a sheet* writes for the character `characterId`, which has no sheet: the block
 * the first class drawn as its component plays (then the class is linked too), else its
 * component's own block when no class is drawn as it. `undefined`: nothing to make it from.
 */
export function sheetSourceFor(
	cast: readonly ProjectCharacter[],
	doc: GameConfigDoc,
	characterId: string,
): { classId?: string; look: CharacterClips } | undefined {
	const character = findCharacter(doc, characterId);
	if (!character || sheetOf(doc, characterId)) return undefined;
	const classes = classesOfComponent(doc, character.component);
	for (const classId of classes) {
		const look = classBlock(cast, classId);
		const names = findClass(doc, classId)?.sheet;
		if (look && (!names || names === characterId)) return { classId, look };
	}
	if (classes.length) return undefined;
	const own = cast.find(
		(c) => !c.inConfig && c.source === 'component' && c.component?.id === character.component,
	);
	return own ? { look: own.look } : undefined;
}

/** The key Flipbook's Characters mode lists the character under (`/flipbook?mode=characters
 *  &character=<key>`): the row that plays its sheet, else the row of a class drawn as it, else of
 *  its component's block. */
export function flipbookKeyFor(
	cast: readonly ProjectCharacter[],
	doc: GameConfigDoc,
	characterId: string,
): string | undefined {
	const character = findCharacter(doc, characterId);
	if (!character) return undefined;
	const classes = classesOfComponent(doc, character.component);
	return (
		cast.find((c) => c.sheetId === characterId) ??
		cast.find((c) => c.inConfig && classes.includes(c.key)) ??
		cast.find((c) => !c.inConfig && c.component?.id === character.component)
	)?.key;
}

// ── compare with the saved config ──────────────────────────────────────────────────────────────

/** The classes a comparison of the character's sheet is made for: the ones that name it, in
 *  either config, and the ones drawn as its component. */
export function comparedClasses(
	stored: GameConfigDoc,
	live: GameConfigDoc,
	characterId: string,
): string[] {
	const component = findCharacter(live, characterId)?.component;
	const ids = [
		...classesNamingSheet(live, characterId),
		...classesNamingSheet(stored, characterId),
		...(component ? classesOfComponent(live, component) : []),
	];
	return [...new Set(ids)].filter((id) => findClass(live, id) || findClass(stored, id));
}

export interface ClassComparison {
	classId: string;
	/** How the saved config draws the class, and how the page's does. */
	before: ClassDrawing;
	after: ClassDrawing;
	/** Every action and facing whose clip or mirror differs, with the project's clips. */
	cells: CellDifference[];
	/** What else the two say differently as sheets, whatever clips exist. */
	sheets: SheetDifference[];
	/** Nothing differs: saving draws this class exactly as before. */
	safe: boolean;
}

/**
 * *Compare* for one class: `before` is how the STORED config draws it (what the page loaded or
 * last saved), `after` how the page's live one does, each read in the runtime's order
 * (`classDrawing`) with the block the class plays in that same config.
 */
export function compareClass(
	stored: GameConfigDoc,
	live: GameConfigDoc,
	components: readonly WholeComponent[],
	classId: string,
	clipIds: Iterable<string>,
): ClassComparison {
	const before = classDrawing(stored, classId, classBlock(castOf(components, stored), classId));
	const after = classDrawing(live, classId, classBlock(castOf(components, live), classId));
	const cells = compareCells(before, after, clipIds);
	const sheets = compareSheets(before, after);
	return { classId, before, after, cells, sheets, safe: !cells.length && !sheets.length };
}

const DRAWING_WORDS: Record<ClassDrawing['kind'], string> = {
	sheet: 'a character sheet',
	block: 'a clip block',
	none: 'no clips',
};

/** A drawing in words: `the sheet of "bearBot"`, `a clip block`, `no clips`. */
export const drawingText = (drawing: ClassDrawing): string =>
	drawing.kind === 'sheet' ? `the sheet of "${drawing.character}"` : DRAWING_WORDS[drawing.kind];

const drawnText = (cell: CellDrawn | undefined): string =>
	cell
		? `${cell.clipId}${cell.flipX ? ', mirrored' : ''}${cell.variant ? ` (${cell.variant})` : ''}`
		: 'nothing';

/** One difference of {@link compareCells} in words. */
export function cellDifferenceText(d: CellDifference): string {
	if (d.kind !== 'cell') {
		const what = d.kind === 'action' ? 'The action' : 'The facing';
		return `${what} "${d.id}" is only in ${d.only === 'before' ? 'the saved config' : 'this sheet'}.`;
	}
	const held = d.statuses.length ? ` while ${d.statuses.join(' and ')}` : '';
	return `${d.action}, facing ${d.facing}${held}: ${drawnText(d.before)} → ${drawnText(d.after)}.`;
}

/** One difference of {@link compareSheets} in words. */
export function sheetDifferenceText(d: SheetDifference): string {
	const where = d.where.replace(/^action:/, 'action ');
	if (d.field === 'action')
		return `${where}: ${d.after === '—' ? 'only in the saved config' : 'only in this sheet'}.`;
	return `${where}, ${d.field}: ${d.before} → ${d.after}.`;
}

// ── one cell of the actions grid ───────────────────────────────────────────────────────────────

/**
 * What the sheet stores for one action and facing. Today a cell names a frame clip; another kind
 * of value is another member here, read by {@link cellValueOf} and written by
 * {@link setCellValue}, and nothing else on the page reads `anim`.
 */
export type CellValue = { kind: 'clip'; clip: string };

/** The value the sheet stores for a cell, or `undefined` when it is left to the name rule. */
export function cellValueOf(
	sheet: CharacterSheet | undefined,
	actionId: string,
	facing: CharacterFacing,
): CellValue | undefined {
	const clip = sheet?.actions?.find((a) => a.id === actionId)?.anim?.[facing]?.clip;
	return clip ? { kind: 'clip', clip } : undefined;
}

/** Store `value` for a cell; `undefined` leaves it to the name rule
 *  (`<prefix>_<action>_<facing>`). Returns why it is refused, or `null`. */
export const setCellValue = (
	doc: GameConfigDoc,
	id: string,
	actionId: string,
	facing: CharacterFacing,
	value: CellValue | undefined,
): string | null => setActionAnim(doc, id, actionId, facing, value?.clip ?? '');

// ── what an edit of the character did to the classes ───────────────────────────────────────────

const listed = (ids: readonly string[]): string => ids.map((id) => `"${id}"`).join(', ');
const classes = (ids: readonly string[]): string =>
	`${ids.length === 1 ? 'The class' : 'The classes'} ${listed(ids)}`;

/** What a rename did: the classes that followed, and the ones the new id adopted. Empty when it
 *  touched none. */
export function renamedNote(
	next: string,
	{ followed, adopted }: { followed: readonly string[]; adopted: readonly string[] },
): string {
	const parts = [
		...(followed.length
			? [
					`${classes(followed)} ${followed.length === 1 ? 'names' : 'name'} "${next}" as ${followed.length === 1 ? 'its' : 'their'} sheet now.`,
				]
			: []),
		...(adopted.length
			? [
					`${classes(adopted)} already named "${next}", a character the config did not have: ${adopted.length === 1 ? 'it is' : 'they are'} drawn from this sheet from now on.`,
				]
			: []),
	];
	return parts.join(' ');
}

/** What a look change did: the classes that are another body and so lost their link. */
export const lookChangedNote = (unlinked: readonly string[]): string =>
	unlinked.length
		? `${classes(unlinked)} ${unlinked.length === 1 ? 'is' : 'are'} another body, so ${unlinked.length === 1 ? 'it no longer names' : 'they no longer name'} this sheet: a class and its sheet use the same component.`
		: '';

/** What the confirmation of a removal says of the classes that name the character's sheet. */
export function removalNote(doc: GameConfigDoc, id: string): string {
	const naming = classesNamingSheet(doc, id);
	if (!naming.length) return sheetOf(doc, id) ? ' Its character sheet goes with it.' : '';
	return ` Its character sheet goes with it, and ${classes(naming).replace(/^T/, 't')} ${naming.length === 1 ? 'loses its link' : 'lose their links'} to it: ${naming.length === 1 ? 'it is' : 'they are'} drawn as before the sheet.`;
}
