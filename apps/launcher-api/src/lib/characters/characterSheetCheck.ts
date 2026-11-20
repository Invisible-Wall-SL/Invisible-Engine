import {
	CHARACTER_FACINGS,
	characterActionPlay,
	characterActionPriority,
	characterTriggers,
	characterViewFacings,
	normalizeCharacterSheet,
	onlineClassSheetOf,
	type CharacterAction,
	type CharacterFacing,
	type CharacterSheet,
	type GameConfigDoc,
	type GameConfigIssue,
} from 'game-config';
import {
	resolveCharacterClip,
	resolveSheetClip,
	sheetFacings,
	sheetOfCharacterClips,
	sheetPlaysClips,
	type CharacterClips,
	type SceneProjection,
} from 'engine-layout';
import { CLIP_ID_MAX, clipIdOf, clipNameTooLong, isClipIdText } from '../flipbook/characterSet';
import { findCharacter } from './characterEdit';
import { findClass, sheetFieldsOf, undrawnAnimCells } from './characterSheetEdit';
import {
	classSheetRefusal,
	firstUnplayed,
	projectionOf,
	savedIssues,
	type SheetUnplayed,
} from './sheetCore';

/**
 * What Invisible Characters CHECKS about a character sheet (`docs/design/character-pipeline.md`
 * §9, §11, step C2b), beside the edits of `./characterSheetEdit`:
 *
 *   - how a class is drawn ({@link classDrawing}), in the runtime's order (`apps/lines`
 *     `online.ts` `lookOf`): its sheet when one is in force, else the block it plays;
 *   - *Compare with the saved config*: {@link compareCells} lists every cell whose clip or mirror
 *     differs between two drawings, and {@link compareSheets} what else differs between them;
 *   - the tool's own warnings ({@link sheetWarnings}, {@link classSheetStatus});
 *   - the page's issue list ({@link pageIssues}), which is the save's.
 *
 * Pure and read-only: it changes no doc. `scripts/check-characters-tool.ts` §8 runs each.
 */

// ── how a class is drawn ───────────────────────────────────────────────────────────────────────

/** What draws an online class: its sheet, a `characterClips` block, or neither (its component as
 *  authored, or the game's code look). */
export type ClassDrawing =
	| { kind: 'sheet'; sheet: CharacterSheet; character: string }
	| { kind: 'block'; look: CharacterClips }
	| { kind: 'none' };

/**
 * What draws the class `classId` of `doc` (the stored config, or the page's live one), in the
 * runtime's order: the sheet it names when that sheet is in force (it exists, uses the class's
 * component and is frame clips this build plays), else `look`, the block the class plays without
 * one (its component's `characterClips`, else Salmons' table: `projectCharacters` decides it, so
 * it is an argument here). Take `look` from `projectCharacters` of the SAME `doc`: for a class
 * whose sheet is in force its `look` is only the sheet in a block's shape, which is not read here.
 */
export function classDrawing(
	doc: unknown,
	classId: string,
	look: CharacterClips | undefined,
): ClassDrawing {
	const named = onlineClassSheetOf(doc, classId);
	if (named && sheetPlaysClips(named.sheet))
		return { kind: 'sheet', sheet: named.sheet, character: named.id };
	return look ? { kind: 'block', look } : { kind: 'none' };
}

/** Characters names a view with no facings before a missing source: the View card is first. */
const UNPLAYED_ORDER: readonly SheetUnplayed[] = ['empty', 'facings', 'source', 'draw', 'actions'];
const NOT_PLAYED = 'The sheet is not one this build plays.';

/** A class's `sheet`, whether it is in force, and why not (`sheetCore.ts` `classSheetRefusal`). */
export function classSheetStatus(
	doc: GameConfigDoc,
	classId: string,
): { sheet?: string; inForce: boolean; why?: string } {
	const cls = findClass(doc, classId);
	if (!cls) return { inForce: false, why: 'No such online class.' };
	if (!cls.sheet) return { inForce: false, why: 'It names no sheet.' };
	const named = { sheet: cls.sheet };
	const character = findCharacter(doc, cls.sheet);
	const refusal = classSheetRefusal(cls, character, sheetFieldsOf(character));
	const reason = refusal?.kind === 'sheet' ? firstUnplayed(refusal.why, UNPLAYED_ORDER) : undefined;
	const words: Record<SheetUnplayed, string> = {
		empty: `"${cls.sheet}" has no view, animation source, draw box or actions.`,
		facings: 'A 3D view has no facings, so no clip is drawn.',
		source: 'The sheet has no clip prefix.',
		draw: 'The draw box has no width.',
		actions: 'The sheet has no action.',
		build: NOT_PLAYED,
	};
	const why =
		refusal?.kind === 'noCharacter'
			? `No character is "${cls.sheet}".`
			: refusal?.kind === 'component'
				? `"${cls.sheet}" is drawn as "${refusal.component}", but the class is the body "${cls.body}": a class and its sheet use the same component.`
				: reason
					? words[reason]
					: classDrawing(doc, classId, undefined).kind !== 'sheet'
						? NOT_PLAYED
						: undefined;
	return why ? { ...named, inForce: false, why } : { ...named, inForce: true };
}

// ── compare with the saved config ──────────────────────────────────────────────────────────────

/** What a cell draws: the clip, whether it is mirrored, and the variant it is under (a `marked`
 *  clip is drawn as made, a base clip of a marked player is tinted). */
export type CellDrawn = { clipId: string; flipX: boolean; variant?: string };

export type CellDifference =
	/** An action or a facing only one of the two has. */
	| { kind: 'action' | 'facing'; id: string; only: 'before' | 'after' }
	/** A cell both have that draws differently while `statuses` hold: another clip (or none), the
	 *  same clip mirrored the other way, or under another variant. */
	| {
			kind: 'cell';
			action: string;
			facing: CharacterFacing;
			statuses: string[];
			differs: 'clip' | 'mirror' | 'variant';
			before: CellDrawn | undefined;
			after: CellDrawn | undefined;
	  };

type Reader = {
	actions: string[];
	facings: readonly CharacterFacing[];
	variants: string[];
	resolve(action: string, facing: CharacterFacing, statuses: string[]): CellDrawn | undefined;
};

const drawn = (clipId: string, flipX: boolean, variant: string | undefined): CellDrawn =>
	variant === undefined ? { clipId, flipX } : { clipId, flipX, variant };

/**
 * A drawing as the game resolves it. A sheet goes through `resolveSheetClip` and a block through
 * `resolveCharacterClip`: each through the function the runtime calls for it, so a list with no
 * difference says the two FUNCTIONS agree on these clips, not only that the converter repeats
 * itself. A block's rows and facings are the ones its conversion has (`sheetOfCharacterClips`:
 * the states it names and the ones their fallbacks reach).
 */
function reader(drawing: ClassDrawing, has: (clipId: string) => boolean): Reader {
	if (drawing.kind === 'none')
		return { actions: [], facings: [], variants: [], resolve: () => undefined };
	if (drawing.kind === 'sheet') {
		const { sheet } = drawing;
		return {
			actions: (sheet.actions ?? []).map((a) => a.id),
			facings: sheetFacings(sheet),
			variants: Object.keys(sheet.source?.variants ?? {}),
			resolve(action, facing, statuses) {
				const found = resolveSheetClip(sheet, action, facing, statuses, has);
				return found && drawn(found.clipId, found.flipX, found.variant);
			},
		};
	}
	const { look } = drawing;
	const rows = sheetOfCharacterClips(look);
	return {
		actions: (rows.actions ?? []).map((a) => a.id),
		facings: sheetFacings(rows),
		variants: look.prefixes.marked ? ['marked'] : [],
		resolve(action, facing, statuses) {
			const found = resolveCharacterClip(look, action, facing, statuses.includes('marked'), has);
			return found && drawn(found.clipId, found.flipX, found.marked ? 'marked' : undefined);
		},
	};
}

const union = <T>(a: readonly T[], b: readonly T[]): T[] => [
	...a,
	...b.filter((x) => !a.includes(x)),
];

/**
 * Every cell that draws differently between two drawings of one character, given the clips that
 * exist (`clipIds`, the project's): `before` is how the saved config draws it
 * ({@link classDrawing} of the config the page loaded or last saved), `after` the edited sheet. An action or a facing
 * only one side has is listed once, whatever clips exist. Each cell both have is resolved with no
 * status, under each variant's status alone, and under all of them together.
 *
 * An empty list: with these clips, every action in every facing draws the same clip, mirrored the
 * same way. It says nothing of clips not made yet, nor of WHEN an action plays or how big it is
 * drawn: {@link compareSheets} lists those.
 *
 * A tie between two stand-ins as near is broken by the facing last seen; cells are compared with
 * none seen. That loses nothing: every facing is tried first in its own cell, so a clip that
 * differs for a facing shows there.
 */
export function compareCells(
	before: ClassDrawing,
	after: ClassDrawing,
	clipIds: Iterable<string>,
): CellDifference[] {
	const have = new Set(clipIds);
	const has = (clipId: string): boolean => have.has(clipId);
	const a = reader(before, has);
	const b = reader(after, has);
	const out: CellDifference[] = [];
	const onlyOne = <T extends string>(
		kind: 'action' | 'facing',
		one: readonly T[],
		two: readonly T[],
	) => {
		for (const id of one) if (!two.includes(id)) out.push({ kind, id, only: 'before' });
		for (const id of two) if (!one.includes(id)) out.push({ kind, id, only: 'after' });
	};
	onlyOne('action', a.actions, b.actions);
	onlyOne('facing', a.facings, b.facings);
	const variants = union(a.variants, b.variants);
	const held: string[][] = [[], ...variants.map((status) => [status])];
	if (variants.length > 1) held.push(variants);
	for (const action of a.actions.filter((id) => b.actions.includes(id)))
		for (const facing of CHARACTER_FACINGS.filter(
			(f) => a.facings.includes(f) && b.facings.includes(f),
		))
			for (const statuses of held) {
				const was = a.resolve(action, facing, statuses);
				const is = b.resolve(action, facing, statuses);
				const differs =
					was?.clipId !== is?.clipId
						? 'clip'
						: was?.flipX !== is?.flipX
							? 'mirror'
							: was?.variant !== is?.variant
								? 'variant'
								: undefined;
				if (differs)
					out.push({ kind: 'cell', action, facing, statuses, differs, before: was, after: is });
			}
	return out;
}

/** One thing two sheets say differently: `where` is `view`, `source`, `draw`, `actions` or
 *  `action:<id>`; `before` and `after` are the values in words (`—` for none). */
export type SheetDifference = { where: string; field: string; before: string; after: string };

const NONE = '—';
const said = (value: unknown): string =>
	value === undefined ? NONE : typeof value === 'string' ? value : JSON.stringify(value);

/** A drawing as a sheet: a block through its conversion, which `check:character-sheet` holds
 *  equal to the block cell for cell and frame for frame. */
const asSheet = (drawing: ClassDrawing): CharacterSheet | undefined =>
	drawing.kind === 'sheet'
		? drawing.sheet
		: drawing.kind === 'block'
			? normalizeCharacterSheet(sheetOfCharacterClips(drawing.look))
			: undefined;

const actionSays = (action: CharacterAction): Record<string, string> => ({
	when: said(characterTriggers(action)),
	play: characterActionPlay(action),
	priority: String(characterActionPriority(action)),
	interrupt: said(action.interrupt),
	again: said(action.again),
	anim: said(action.anim),
	fallback: said(action.fallback),
});

/**
 * What two drawings say differently as SHEETS, whatever clips exist: the view (its kind, its
 * facings, its mirror), the prefix and the variants, the draw box, the order of the actions, and
 * per action what starts it, how it plays (its effective play and priority), what may cut it, its
 * `anim` cells and its fallback. An action only one side has is one row. Empty: the two are the
 * same sheet, so they draw the same with any clips.
 */
export function compareSheets(before: ClassDrawing, after: ClassDrawing): SheetDifference[] {
	const a = asSheet(before);
	const b = asSheet(after);
	const out: SheetDifference[] = [];
	const differ = (where: string, was: Record<string, string>, is: Record<string, string>) => {
		for (const field of union(Object.keys(was), Object.keys(is)))
			if (was[field] !== is[field])
				out.push({ where, field, before: was[field] ?? NONE, after: is[field] ?? NONE });
	};
	const viewSays = (sheet: CharacterSheet | undefined): Record<string, string> => {
		if (!sheet) return {};
		const view = sheet.view;
		return {
			kind: view?.kind ?? 'isometric',
			facings: characterViewFacings(view).join(' '),
			mirror: view && (view.kind === '3d' || view.mirror === false) ? 'off' : 'on',
		};
	};
	differ('view', viewSays(a), viewSays(b));
	const sourceSays = (sheet: CharacterSheet | undefined): Record<string, string> =>
		sheet?.source ? { prefix: sheet.source.prefix, variants: said(sheet.source.variants) } : {};
	differ('source', sourceSays(a), sourceSays(b));
	const drawSays = (sheet: CharacterSheet | undefined): Record<string, string> =>
		sheet?.draw
			? {
					width: String(sheet.draw.width),
					feet: String(sheet.draw.feet ?? 1),
					points: said(sheet.draw.points),
				}
			: {};
	differ('draw', drawSays(a), drawSays(b));
	const was = a?.actions ?? [];
	const is = b?.actions ?? [];
	const ids = (list: CharacterAction[]) => list.map((action) => action.id);
	const shared = ids(was).filter((id) => ids(is).includes(id));
	for (const action of was)
		if (!shared.includes(action.id))
			out.push({ where: `action:${action.id}`, field: 'action', before: action.id, after: NONE });
	for (const action of is)
		if (!shared.includes(action.id))
			out.push({ where: `action:${action.id}`, field: 'action', before: NONE, after: action.id });
	const order = ids(is).filter((id) => shared.includes(id));
	if (shared.join(' ') !== order.join(' '))
		out.push({
			where: 'actions',
			field: 'order',
			before: shared.join(' '),
			after: order.join(' '),
		});
	for (const id of shared)
		differ(
			`action:${id}`,
			actionSays(was.find((action) => action.id === id)!),
			actionSays(is.find((action) => action.id === id)!),
		);
	return out;
}

// ── the tool's warnings ────────────────────────────────────────────────────────────────────────

/** A warning of the tool's own, on the card that can fix it. */
export type SheetWarning = {
	on: 'source' | 'actions';
	/** The action it is about, when it is about one. */
	action?: string;
	message: string;
};

/** Why no stored clip matches a name with `text` in it. A clip's id is made from its name when it
 *  is saved, lower-cased with every other character turned to `_`, and the game looks a clip up
 *  by that id exactly, so a capital never matches. */
const cannotMatch = (what: string, text: string): string =>
	`${what} "${text}" has a capital or a character a clip id cannot have (ids are lower-case letters, digits and "_"), so no clip matches it. Flipbook stores that name as "${clipIdOf(text)}".`;

/**
 * What the tool says about a sheet beyond the save's own issues ({@link pageIssues}):
 *
 *   - a prefix, a variant's prefix, an `anim` cell's clip, or the id of an action found by name,
 *     that no stored clip can match;
 *   - a clip name longer than a clip id can be (both by `$lib/flipbook/characterSet`'s one rule,
 *     which Flipbook's Characters mode answers by too);
 *   - `anim` cells of facings the view does not draw.
 */
export function sheetWarnings(sheet: CharacterSheet | undefined): SheetWarning[] {
	if (!sheet) return [];
	const out: SheetWarning[] = [];
	const source = sheet.source;
	const prefixes = source ? [source.prefix, ...Object.values(source.variants ?? {})] : [];
	if (source && !isClipIdText(source.prefix))
		out.push({ on: 'source', message: cannotMatch('The prefix', source.prefix) });
	for (const [status, prefix] of Object.entries(source?.variants ?? {}))
		if (!isClipIdText(prefix))
			out.push({
				on: 'source',
				message: cannotMatch(`The prefix of the variant "${status}",`, prefix),
			});
	const facings = characterViewFacings(sheet.view);
	for (const action of sheet.actions ?? []) {
		const byName = prefixes.length > 1 || facings.some((facing) => !action.anim?.[facing]);
		if (source && byName && !isClipIdText(action.id))
			out.push({
				on: 'actions',
				action: action.id,
				message: `${cannotMatch('The action', action.id)} Its clips are found by name (${source.prefix}_${action.id}_<facing>): rename it, or name its clip in each facing.`,
			});
		else if (source && byName && clipNameTooLong(prefixes, action.id))
			out.push({
				on: 'actions',
				action: action.id,
				message: `A clip id holds ${CLIP_ID_MAX} characters, and "${source.prefix}_${action.id}_<facing>" is longer, so no clip matches it.`,
			});
		for (const facing of CHARACTER_FACINGS) {
			const clip = action.anim?.[facing]?.clip;
			if (clip && (!isClipIdText(clip) || clip.length > CLIP_ID_MAX))
				out.push({
					on: 'actions',
					action: action.id,
					message: isClipIdText(clip)
						? `A clip id holds ${CLIP_ID_MAX} characters, and "${clip}" (${action.id}, ${facing}) is longer, so no clip matches it.`
						: cannotMatch(`The clip of "${action.id}" facing ${facing},`, clip),
				});
		}
	}
	const undrawn = undrawnAnimCells(sheet);
	for (const action of new Set(undrawn.map((cell) => cell.action))) {
		const cells = undrawn.filter((cell) => cell.action === action);
		out.push({
			on: 'actions',
			action,
			message: `"${action}" names a clip for ${cells.map((cell) => cell.facing).join(', ')}, which the view does not draw: ${cells.length === 1 ? 'it is' : 'they are'} kept and never played.`,
		});
	}
	return out;
}

// ── the page's issues ──────────────────────────────────────────────────────────────────────────

/**
 * The one projection the validator is told, from the projections of the project's screens
 * (`sheetCore.ts` `projectionOf`). Not known (`undefined`, the screens are not loaded) ⇒
 * `undefined`, and no screen warning is made.
 */
export const sheetProjection = (
	projections: readonly SceneProjection[] | undefined,
): 'isometric' | 'flat' | undefined =>
	projections === undefined ? undefined : projectionOf(projections);

const sameIssue = (a: GameConfigIssue, b: GameConfigIssue): boolean =>
	a.severity === b.severity && a.path === b.path && a.message === b.message;

/**
 * The page's issue list. `issues` is exactly the save's (`sheetCore.ts` `savedIssues`, which
 * Game Config lists too). Its errors are what the save refuses (a 3D world's own errors aside,
 * which only the server reads). `screen` is what the page knows and the save does not: the view
 * warnings that need the screen's `projection`, for the View card.
 */
export function pageIssues(
	doc: GameConfigDoc,
	projection?: 'isometric' | 'flat',
): { issues: GameConfigIssue[]; screen: GameConfigIssue[] } {
	const issues = savedIssues(doc);
	const screen = projection
		? savedIssues(doc, projection).filter(
				(issue) => !issues.some((known) => sameIssue(known, issue)),
			)
		: [];
	return { issues, screen };
}

/** The issues of the class at `index` of `arcade.online.characters` (its `sheet`, its numbers). */
export const classIssues = (issues: GameConfigIssue[], index: number): GameConfigIssue[] =>
	issues.filter(
		(i) =>
			i.path === `arcade.online.characters[${index}]` ||
			i.path.startsWith(`arcade.online.characters[${index}].`),
	);

/** Of a character's issues (`characterEdit.ts` `characterIssues`), the ones of one card of its
 *  sheet. */
export const sheetCardIssues = (
	issues: GameConfigIssue[],
	index: number,
	card: 'view' | 'source' | 'draw' | 'actions',
): GameConfigIssue[] =>
	issues.filter(
		(i) =>
			i.path === `arcade.characters[${index}].${card}` ||
			i.path.startsWith(`arcade.characters[${index}].${card}.`) ||
			i.path.startsWith(`arcade.characters[${index}].${card}[`),
	);
