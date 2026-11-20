import {
	CHARACTER_FACINGS,
	characterViewFacings,
	type CharacterFacing,
	type CharacterRigSource,
	type CharacterSheet,
	type CharacterSource,
	type GameConfigDoc,
} from 'game-config';
import { editSheet, unreadCells, viewDrawing, type AnimCell } from './characterSheetEdit';
import { SOURCE_KIND_LABELS, SOURCE_KIND_WORDS, type SourceKind } from './sheetCore';

/**
 * How Invisible Characters chooses a sheet's ANIMATION SOURCE and edits a rig source
 * (`docs/design/character-pipeline.md` §12.4, step C6b): frame clips, a rig, or still images.
 *
 * A CHANGE OF KIND NEVER THROWS WORK AWAY SILENTLY. Two things are at stake:
 *
 *   - the cells. They are kept, whatever they hold: the ones the new source does not draw are not
 *     read by the game, the save's validator warns of each, and the edit answers them (`unread`,
 *     `characterSheetEdit.ts` `unreadCells`, with `dropUnreadCells` to remove them);
 *   - the old source's own fields (a prefix, its variants, a rig, the rigs per facing). Another
 *     kind cannot store them (the normalizer drops them), so they WOULD go. {@link sourceChangeLoss}
 *     says what, and {@link setSourceKind} refuses the change until it is told `confirmLoss`.
 *
 * Every edit goes through `editSheet`, so what is stored is what the normalizer makes of it.
 * Pure: `scripts/charactersTool/sources.ts` (§12 of `check:characters-tool`) runs each.
 */

const quoted = (name: string): string => `"${name}"`;

const counted = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** `a`, `a and b`, `a, b and c`. */
const listed = (parts: readonly string[]): string =>
	parts.length < 2
		? parts.join('')
		: `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

/** What a source names that another kind cannot keep. */
export interface SourceLoss {
	prefix?: string;
	rig?: string;
	/** The rigs per facing, in the facings' order. */
	rigs: [CharacterFacing, string][];
	/** `[status, prefix]` of frame clips, `[status, skin]` of a rig. */
	variants: [string, string][];
	/** All of it in words (`the prefix "bear" and 1 variant`); empty when nothing is lost. */
	text: string;
}

/**
 * What the sheet's source would lose if its kind became `kind` (`undefined`: if the source were
 * taken away): everything it names, since no other kind can store it. Nothing for the kind it
 * already is, for a sheet with no source, and for still images, which name nothing. The cells
 * are not part of it: they are kept.
 */
export function sourceChangeLoss(
	sheet: CharacterSheet | undefined,
	kind: SourceKind | undefined,
): SourceLoss {
	const source = sheet?.source;
	const loss: SourceLoss = { rigs: [], variants: [], text: '' };
	if (!source || source.kind === kind || source.kind === 'stills') return loss;
	loss.variants = Object.entries(source.variants ?? {});
	const parts: string[] = [];
	if (source.kind === 'clips') {
		loss.prefix = source.prefix;
		parts.push(`the prefix ${quoted(source.prefix)}`);
	} else {
		if (source.rig) {
			loss.rig = source.rig;
			parts.push(`the rig ${quoted(source.rig)}`);
		}
		loss.rigs = CHARACTER_FACINGS.flatMap((facing): [CharacterFacing, string][] => {
			const rig = source.rigs?.[facing];
			return rig ? [[facing, rig]] : [];
		});
		if (loss.rigs.length)
			parts.push(counted(loss.rigs.length, 'rig of a facing', 'rigs of a facing'));
	}
	if (loss.variants.length)
		parts.push(
			source.kind === 'clips'
				? counted(loss.variants.length, 'variant', 'variants')
				: counted(loss.variants.length, 'skin variant', 'skin variants'),
		);
	loss.text = listed(parts);
	return loss;
}

/** The source of `kind` an edit asks for, or why it cannot be made. Of the same kind, the old
 *  source keeps everything else it names. */
function sourceOfKind(
	was: CharacterSource | undefined,
	kind: SourceKind,
	named: { prefix?: string; rig?: string },
): CharacterSource | string {
	if (kind === 'stills') return { kind };
	if (kind === 'clips') {
		const prefix = named.prefix?.trim() ?? '';
		if (!prefix)
			return 'Frame clips need a prefix: their clips are named <prefix>_<action>_<facing>.';
		return { ...(was?.kind === 'clips' ? was : {}), kind, prefix };
	}
	const rig = named.rig?.trim() ?? '';
	const kept = was?.kind === 'rig' ? was : undefined;
	if (!rig && !kept) return 'A rig source needs a rig: pick one of the project’s rigs.';
	return { ...kept, kind, ...(rig ? { rig } : {}) };
}

/**
 * Choose the kind of the character's animation source: frame clips (with their `prefix`), a rig
 * (with the one `rig`), or still images (nothing more). On a character with no sheet it starts
 * one. Of the kind the source already is, it changes the prefix or the one rig and keeps the
 * rest.
 *
 * To ANOTHER kind, the old source's fields go ({@link sourceChangeLoss}): the change is refused,
 * naming them, unless `confirmLoss` is set, which the card sets after its confirmation. `lost` is
 * what went, in words. The cells are all kept; `unread` are the ones the new source does not draw.
 */
export function setSourceKind(
	doc: GameConfigDoc,
	id: string,
	kind: SourceKind,
	options: { prefix?: string; rig?: string; confirmLoss?: boolean } = {},
): { refused: string | null; lost: string; unread: AnimCell[] } {
	let lost = '';
	let unread: AnimCell[] = [];
	const refused = editSheet(doc, id, (sheet) => {
		const next = sourceOfKind(sheet.source, kind, options);
		if (typeof next === 'string') return next;
		const loss = sourceChangeLoss(sheet, kind).text;
		if (loss && !options.confirmLoss)
			return `Changing the source to ${SOURCE_KIND_WORDS[kind]} loses ${loss}: confirm it first.`;
		sheet.source = next;
		lost = loss;
		unread = unreadCells(sheet);
	});
	return refused ? { refused, lost: '', unread: [] } : { refused: null, lost, unread };
}

// ── a rig source ───────────────────────────────────────────────────────────────────────────────

/** The sheet's source when it is a rig. */
export const rigSourceOfSheet = (
	sheet: CharacterSheet | undefined,
): CharacterRigSource | undefined => (sheet?.source?.kind === 'rig' ? sheet.source : undefined);

const NOT_A_RIG = (sheet: CharacterSheet): string =>
	sheet.source
		? `The source is ${SOURCE_KIND_WORDS[sheet.source.kind]}, not a rig: choose ${SOURCE_KIND_LABELS.rig} as the source first.`
		: `Choose ${SOURCE_KIND_LABELS.rig} as the source first.`;

/** A rig source that names no rig is not a source (the normalizer drops it, and the validator
 *  refuses the save), so its last rig is not removed. */
const LAST_RIG =
	'A rig source needs a rig: this is its only one. Pick another, or take the source away (Clear source).';

const namesARig = (source: CharacterRigSource): boolean =>
	!!source.rig || Object.keys(source.rigs ?? {}).length > 0;

/** {@link editSheet} on the sheet's rig source; refused when the edit leaves it no rig. */
const editRigSource = (
	doc: GameConfigDoc,
	id: string,
	change: (source: CharacterRigSource, sheet: CharacterSheet) => string | null | void,
): string | null =>
	editSheet(doc, id, (sheet) => {
		const source = rigSourceOfSheet(sheet);
		if (!source) return NOT_A_RIG(sheet);
		const refused = change(source, sheet);
		if (refused) return refused;
		return namesARig(source) ? null : LAST_RIG;
	});

/** The one rig, drawn in every facing that has none of its own, by its bundle name. Blank takes
 *  it away, which leaves the rigs per facing; refused when there is none. */
export const setSourceRig = (doc: GameConfigDoc, id: string, rig: string): string | null =>
	editRigSource(doc, id, (source) => {
		const name = rig.trim();
		if (name) source.rig = name;
		else delete source.rig;
	});

/**
 * The rig of one facing (`rigs`: a front and a back rig), by its bundle name; blank takes it
 * away. Refused for a facing the view does not have: the game tries only the view's facings, so
 * it would never be drawn. A facing the view draws MIRRORED may have a rig: the game then draws
 * that rig there as made, instead of its twin's mirrored ({@link rigFacingsOf} says which those
 * are). Taking away the last rig is refused.
 */
export const setFacingRig = (
	doc: GameConfigDoc,
	id: string,
	facing: CharacterFacing,
	rig: string,
): string | null =>
	editRigSource(doc, id, (source, sheet) => {
		const name = rig.trim();
		if (!name) {
			if (source.rigs) delete source.rigs[facing];
			return null;
		}
		if (!characterViewFacings(sheet.view).includes(facing))
			return `The view has no facing "${facing}", so a rig for it would never be drawn.`;
		source.rigs = { ...source.rigs, [facing]: name };
	});

/** One facing of a rig source, for its row of the card. */
export interface RigFacing {
	facing: CharacterFacing;
	/** The rig of its own (`rigs`), if it has one. */
	own?: string;
	/** The rig drawn in it: its own, else the one rig. */
	rig?: string;
	/** The view draws this facing from its twin, mirrored, unless it has a rig or an animation of
	 *  its own. */
	mirrored: boolean;
	/** The view does not have this facing: its rig is stored and never drawn. */
	undrawn: boolean;
}

/** The facings of a rig source: the view's, clockwise from north, then any other a rig is stored
 *  for (a view changed since: kept, and the validator warns). */
export function rigFacingsOf(sheet: CharacterSheet | undefined): RigFacing[] {
	const source = rigSourceOfSheet(sheet);
	if (!sheet || !source) return [];
	const { facings, mirrored } = viewDrawing(sheet.view);
	const row = (facing: CharacterFacing, undrawn: boolean): RigFacing => {
		const own = source.rigs?.[facing];
		const rig = own ?? source.rig;
		return {
			facing,
			...(own ? { own } : {}),
			...(rig ? { rig } : {}),
			mirrored: mirrored.includes(facing),
			undrawn,
		};
	};
	return [
		...facings.map((facing) => row(facing, false)),
		...CHARACTER_FACINGS.filter((f) => !facings.includes(f) && source.rigs?.[f]).map((f) =>
			row(f, true),
		),
	];
}

/**
 * The rigs a sheet names, by bundle name, each once: its source's one rig, its rigs per facing
 * and the rig a cell names. As the ship chain reads them (`game-config`
 * `characterSheetRigRoots`): none for a sheet whose source is not a rig, whose cells are not
 * read.
 */
export function sheetRigNames(sheet: CharacterSheet | undefined): string[] {
	const source = rigSourceOfSheet(sheet);
	if (!sheet || !source) return [];
	const names = [
		source.rig,
		...CHARACTER_FACINGS.map((facing) => source.rigs?.[facing]),
		...(sheet.actions ?? []).flatMap((action) =>
			CHARACTER_FACINGS.map((facing) => action.anim?.[facing]?.rig),
		),
	];
	return [...new Set(names.filter((name): name is string => !!name))];
}
