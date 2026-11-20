/**
 * A CHARACTER'S CLIP SET, as Invisible Flipbook's Characters mode shows it: which clips an arcade
 * character needs, which are there, what the game would draw for a missing one, which clips are
 * misnamed, what breaks the character in game, and which clips a sheet's runs would make.
 *
 * A character's ART is what it plays: a `characterClips` block, or a character sheet whose source
 * is frame clips (`docs/design/character-pipeline.md` §2). The game's rule for a block is
 * `engine-layout` `characterClips.ts` and for a sheet `characterSheet.ts`, and nothing of either is
 * restated here. A name is whatever the game's resolver ({@link resolveCharacterClip},
 * {@link resolveSheetClip}) ASKS for: its first question for a state and a facing is the clip's
 * own name (for a sheet, the clip its `anim` cell names), and the questions that follow are its
 * stand-ins in the game's order. So the grid, the list of valid names and the stand-in of a missing
 * cell are read off the resolver itself, and a change to the naming or to the stand-in order there
 * moves this panel with it.
 *
 * Pure and Svelte-free: `scripts/check-flipbook-characters.ts` runs it in Node.
 */
import {
	DEFAULT_FLIPBOOK_FPS,
	detectSequencesAcross,
	type DetectedSequenceAcross,
	type FlipbookBounds,
	type FlipbookClip,
	type SheetRegions,
} from 'engine-flipbook';
import {
	CHARACTER_CLIP_EVENTS,
	CLIP_FACINGS,
	CLIP_MIRROR,
	clipMirrorOf,
	resolveCharacterClip,
	resolveSheetClip,
	sheetDraw,
	sheetFacings,
	sheetStillClipId,
	sheetStillClips,
	type CharacterClips,
	type ClipFacing,
} from 'engine-layout';
import {
	characterActionPlay,
	characterTriggers,
	type CharacterAction,
	type CharacterSheet,
	type CharacterTrigger,
} from 'game-config';
import { cellText } from '../characters/sheetCore';

/** The longest id a clip is stored under. */
export const CLIP_ID_MAX = 60;

/**
 * A clip's id as the save makes it from a name (`$lib/server/projectPaths` `r2Slug`, which a
 * client module cannot import; the gate holds the two equal).
 */
export const clipIdOf = (name: string): string =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '_')
		.slice(0, CLIP_ID_MAX) || 'default';

/** Whether `text` could be part of a stored clip's id: lower-case letters, digits and `_`. */
export const isClipIdText = (text: string): boolean => /^[a-z0-9_]+$/.test(text);

/** Whether a clip can be stored under `name` exactly: the one answer Flipbook's Characters mode
 *  and Invisible Characters both give for a prefix, an action or a clip a cell names. */
export const isClipId = (name: string): boolean => isClipIdText(name) && name.length <= CLIP_ID_MAX;

/** Whether the longest name `<prefix>_<action>_<facing>` an action is found under (the longest of
 *  `prefixes`, a two-letter facing) is longer than a clip id can be, so no clip matches it. */
export const clipNameTooLong = (prefixes: readonly string[], action: string): boolean =>
	Math.max(0, ...prefixes.map((prefix) => prefix.length)) + action.length + 4 > CLIP_ID_MAX;

/** {@link clipIdOf} with runs of `_` folded and the ends trimmed: what two spellings of one name
 *  share. */
const folded = (name: string): string => clipIdOf(name).replace(/_+/g, '_').replace(/^_|_$/g, '');

const at = (facing: ClipFacing): number => CLIP_FACINGS.indexOf(facing);

/** What a character plays: its `characterClips` block, or its sheet. */
export type CharacterArt = CharacterClips | CharacterSheet;

/** Whether an art is a sheet (a block always names its `prefixes`; a sheet has no such field). */
export const isSheetArt = (art: CharacterArt): art is CharacterSheet => !('prefixes' in art);

/**
 * Whose clips are asked about: `false` an unmarked player's, `true` a marked one's (the status
 * `marked`), or the name of the status whose variant holds (a sheet's `source.variants`).
 */
export type ArtVariant = boolean | string;

const statusOf = (variant: ArtVariant): string | undefined =>
	variant === true ? 'marked' : variant || undefined;

/** A state a look names, and what plays it. */
export interface CharacterState {
	state: string;
	/** The name the sheet gives the action, when it gives one. */
	name?: string;
	/** Played as a loop (the look's `idle`, `walk` or `holding`; a sheet's action that loops on a
	 *  motion or a status). */
	loop: boolean;
	/** Played once, on a room event (the look's `on`; a sheet's ability or event trigger). */
	once: boolean;
	/** `idle` / `walk` / `holding`, or the room events; a sheet's triggers. None for a sheet's
	 *  action nothing starts: it only stands in for another. */
	plays: string[];
}

type Found = { clipId: string; flipX: boolean; state: string; variant: string | undefined };

/**
 * What a cell of a sheet of frame clips holds when it is not a clip (`game-config`
 * `CharacterCell`), with its value in words. A `still` image is drawn there, as the clip of one
 * frame the game registers for it (`engine-layout` `sheetStillClips`): no Flipbook clip is looked
 * for or made. A `rig` animation is not drawn by frame clips, so the game finds the cell's clip by
 * name; the cell says so, and no clip is planned for it.
 */
export type CellHolds =
	| {
			kind: 'still';
			text: string;
			/** The id its one-frame clip is registered under. */ clipId: string;
	  }
	| { kind: 'rig'; text: string };

/** An art as this module reads it: the block's or the sheet's own answers, in one shape. */
interface Reading {
	facings: readonly ClipFacing[];
	/** Whether a facing with a twin is drawn from the twin's clip, mirrored. */
	mirrors: boolean;
	states: CharacterState[];
	/** The base prefix, then each variant's. */
	base: string;
	variants: { status: string; prefix: string }[];
	/** The state a `<prefix>_<facing>` still is the one-frame clip of. */
	still: string | undefined;
	/** The clips the sheet names in a cell, by state and facing. */
	named: (state: string, facing: ClipFacing) => string | undefined;
	/** What a sheet's cell holds that is not a clip: a still image, or a rig's animation. */
	holds: (state: string, facing: ClipFacing) => CellHolds | undefined;
	resolve: (
		state: string,
		facing: ClipFacing,
		status: string | undefined,
		has: (clipId: string) => boolean,
	) => Found | undefined;
	width: number;
	anchorY: number;
}

/** Whether a clip id is a sheet's still image (`engine-layout` `sheetStillClipId`), which no
 *  Flipbook clip's id can be: an id has no colon. */
export const isStillId = (clipId: string): boolean => clipId.startsWith('still::');

function blockStates(look: CharacterClips): CharacterState[] {
	const out = new Map<string, CharacterState>();
	const add = (state: string | undefined, role: string, loop: boolean): void => {
		if (!state) return;
		const known = out.get(state);
		if (!known) {
			out.set(state, { state, loop, once: !loop, plays: [role] });
			return;
		}
		known.plays.push(role);
		if (loop) known.loop = true;
		else known.once = true;
	};
	add(look.idle, 'idle', true);
	add(look.walk, 'walk', true);
	add(look.holding, 'holding', true);
	for (const event of CHARACTER_CLIP_EVENTS) add(look.on?.[event], event, false);
	return [...out.values()];
}

const startsOnce = (trigger: CharacterTrigger): boolean =>
	'ability' in trigger || 'event' in trigger;

/** A trigger in words: `moving`, `ability 1`, `caught (to it)`, `while holding`. The one wording
 *  Flipbook's rows and Invisible Characters' triggers both show. */
export function triggerText(trigger: CharacterTrigger): string {
	if ('motion' in trigger) return trigger.motion;
	if ('ability' in trigger) return trigger.ability === 'ability1' ? 'ability 1' : 'ability 2';
	if ('event' in trigger)
		return trigger.as === 'target' ? `${trigger.event} (to it)` : trigger.event;
	return `while ${trigger.status}`;
}

/** A sheet's actions as rows, in the sheet's order; of two with one id the first, as the game
 *  reads them. An ability or an event plays its action once whatever its `play`; a motion or a
 *  status loops only an action that loops. */
function sheetStates(sheet: CharacterSheet): CharacterState[] {
	const out = new Map<string, CharacterState>();
	for (const action of sheet.actions ?? []) {
		if (!action.id || out.has(action.id)) continue;
		const triggers = characterTriggers(action);
		out.set(action.id, {
			state: action.id,
			...(action.name ? { name: action.name } : {}),
			loop: characterActionPlay(action) === 'loop' && triggers.some((t) => !startsOnce(t)),
			once: triggers.some(startsOnce),
			plays: triggers.map(triggerText),
		});
	}
	return [...out.values()];
}

function readBlock(look: CharacterClips): Reading {
	const { marked } = look.prefixes;
	return {
		facings: look.facings === 8 ? CLIP_FACINGS : CLIP_FACINGS.filter((f) => f in CLIP_MIRROR),
		mirrors: true,
		states: blockStates(look),
		base: look.prefixes.base,
		variants: marked ? [{ status: 'marked', prefix: marked }] : [],
		still: look.idle,
		named: () => undefined,
		holds: () => undefined,
		resolve: (state, facing, status, has) => {
			const found = resolveCharacterClip(look, state, facing, status !== undefined, has);
			return (
				found && {
					clipId: found.clipId,
					flipX: found.flipX,
					state: found.state,
					variant: found.marked ? 'marked' : undefined,
				}
			);
		},
		width: look.displayWidth,
		anchorY: look.anchorY ?? 1,
	};
}

/**
 * A sheet is asked as the game asks it. One the game does not play yet for want of a draw width
 * (a sheet still being written) is asked with a width, which decides no clip, so its grid reads as
 * it will play.
 */
function readSheetArt(sheet: CharacterSheet): Reading {
	const asked: CharacterSheet =
		sheet.draw && sheet.draw.width > 0 ? sheet : { ...sheet, draw: { ...sheet.draw, width: 1 } };
	const first = new Map<string, CharacterAction>();
	for (const action of sheet.actions ?? []) if (!first.has(action.id)) first.set(action.id, action);
	const source = sheet.source?.kind === 'clips' ? sheet.source : undefined;
	const stills = new Set(sheetStillClips(asked).map((clip) => clip.id));
	return {
		facings: sheetFacings(sheet),
		mirrors: !(sheet.view && 'mirror' in sheet.view && sheet.view.mirror === false),
		states: sheetStates(sheet),
		base: source?.prefix ?? '',
		variants: Object.entries(source?.variants ?? {}).map(([status, prefix]) => ({
			status,
			prefix,
		})),
		still: (sheet.actions ?? []).find((action) =>
			characterTriggers(action).some((t) => 'motion' in t && t.motion === 'still'),
		)?.id,
		named: (state, facing) => first.get(state)?.anim?.[facing]?.clip,
		holds: (state, facing) => {
			const cell = first.get(state)?.anim?.[facing];
			if (!cell || cell.clip) return undefined;
			return cell.still
				? { kind: 'still', text: cellText(cell), clipId: sheetStillClipId(cell.still) }
				: { kind: 'rig', text: cellText(cell) };
		},
		// A still image is registered by the game itself, so it is there whatever clips exist.
		resolve: (state, facing, status, has) => {
			const found = resolveSheetClip(
				asked,
				state,
				facing,
				status ? [status] : [],
				(clipId) => stills.has(clipId) || has(clipId),
			);
			return (
				found && {
					clipId: found.clipId,
					flipX: found.flipX,
					state: found.action,
					variant: found.variant,
				}
			);
		},
		width: sheetDraw(sheet).width,
		anchorY: sheetDraw(sheet).anchorY,
	};
}

const readings = new WeakMap<CharacterArt, Reading>();
function read(art: CharacterArt): Reading {
	let reading = readings.get(art);
	if (!reading) readings.set(art, (reading = isSheetArt(art) ? readSheetArt(art) : readBlock(art)));
	return reading;
}

/**
 * The facings an art plays, apart: the ones it is `drawn` in and the ones the game `mirrored`s
 * from a drawn twin. Of a mirror pair the eastern one is drawn, as the game's own tie-break has
 * it; `n` and `s` have no twin. A block has eight with `facings: 8`, else the four diagonals; a
 * sheet has its view's, and one whose view does not mirror draws them all.
 */
export function characterFacings(art: CharacterArt): {
	drawn: ClipFacing[];
	mirrored: ClipFacing[];
} {
	const { facings, mirrors } = read(art);
	const isMirrored = (facing: ClipFacing): boolean => {
		const twin = clipMirrorOf(facing);
		return mirrors && twin !== undefined && facings.includes(twin) && at(twin) < at(facing);
	};
	return { drawn: facings.filter((f) => !isMirrored(f)), mirrored: facings.filter(isMirrored) };
}

/** The states an art names, each once: a block's loops first, a sheet's actions in its order. */
export const characterStates = (art: CharacterArt): CharacterState[] => read(art).states;

/** The statuses an art has clips of its own for, in its order: `marked` for a block with a marked
 *  prefix (the golden salmon), a sheet's `source.variants`. */
export const characterVariants = (art: CharacterArt): { status: string; prefix: string }[] =>
	read(art).variants;

/** An art's prefixes: the base one, then each variant's. */
export const characterPrefixes = (art: CharacterArt): string[] => {
	const { base, variants } = read(art);
	return [...(base ? [base] : []), ...variants.map((v) => v.prefix)];
};

/**
 * The clips a preview draws an art from: the project's, and for a sheet each of its still images
 * as the clip of one frame the game registers for it (`engine-layout` `sheetStillClips`), so a
 * still is drawn as the game draws it. A sheet with no draw width yet is asked with one, as its
 * grid is (the width decides no image). A block has no still image: its clips as they are.
 */
export function clipsWithStills(
	art: CharacterArt,
	clips: Readonly<Record<string, FlipbookClip>>,
): Record<string, FlipbookClip> {
	if (!isSheetArt(art)) return { ...clips };
	const asked: CharacterSheet =
		art.draw && art.draw.width > 0 ? art : { ...art, draw: { ...art.draw, width: 1 } };
	return {
		...clips,
		...Object.fromEntries(sheetStillClips(asked).map((clip) => [clip.id, clip])),
	};
}

/** How wide the game draws an art's clips and where its feet are down their box. */
export const characterDraw = (art: CharacterArt): { width: number; anchorY: number } => {
	const { width, anchorY } = read(art);
	return { width, anchorY };
};

/** A clip id without its character's prefix: `walk_e`. The id itself for a clip under none, and
 *  for a sheet's still image (`still::<assetKey>::<region>`) its frame. */
export function clipTail(art: CharacterArt, clipId: string): string {
	if (isStillId(clipId)) return clipId.slice(clipId.lastIndexOf('::') + 2);
	const prefix = characterPrefixes(art)
		.sort((a, b) => b.length - a.length)
		.find((p) => clipId.startsWith(`${p}_`));
	return prefix ? clipId.slice(prefix.length + 1) : clipId;
}

/** Every clip id the game asks for while it resolves `state` facing `facing`, in its order. */
export function characterClipCandidates(
	art: CharacterArt,
	state: string,
	facing: ClipFacing,
	marked: ArtVariant = false,
): string[] {
	const asked: string[] = [];
	read(art).resolve(state, facing, statusOf(marked), (clipId) => {
		asked.push(clipId);
		return false;
	});
	return asked;
}

/** The name the game looks for first for a state and a facing: the clip's own. `''` when the
 *  game asks for none (a sheet with no frame clips). */
export const characterClipName = (
	art: CharacterArt,
	state: string,
	facing: ClipFacing,
	marked: ArtVariant = false,
): string => characterClipCandidates(art, state, facing, marked)[0] ?? '';

/** Whether a look has clips of its own for a marked player (the golden salmon). */
export const hasMarkedClips = (art: CharacterArt): boolean =>
	read(art).variants.some((v) => v.status === 'marked');

/** A name a character's clip can have, and what it is the clip of. */
export interface CharacterClipName {
	id: string;
	state: string;
	facing: ClipFacing;
	/** Under a variant's prefix (a block's marked one). */
	marked: boolean;
	/** In a drawn facing: one the author makes, not one the game mirrors. */
	drawn: boolean;
}

/** `[false, …each variant's status]`: every set of clips an art has names in. */
const variantViews = (art: CharacterArt): ArtVariant[] => [
	false,
	...read(art).variants.map((v) => v.status),
];

/** Every name an art's states and facings give a Flipbook clip, the base prefix's first. A cell
 *  of a sheet that holds a still image or a rig's animation gives none ({@link CellHolds}). */
export function characterClipNames(art: CharacterArt): CharacterClipName[] {
	const { drawn, mirrored } = characterFacings(art);
	const { holds } = read(art);
	const out = new Map<string, CharacterClipName>();
	for (const marked of variantViews(art))
		for (const { state } of characterStates(art))
			for (const facing of [...drawn, ...mirrored]) {
				const id = characterClipName(art, state, facing, marked);
				if (isStillId(id) || (marked === false && holds(state, facing))) continue;
				if (id && !out.has(id))
					out.set(id, {
						id,
						state,
						facing,
						marked: marked !== false,
						drawn: drawn.includes(facing),
					});
			}
	return [...out.values()];
}

/**
 * Every clip id the game can ask for on this character's behalf: its names, and the names of the
 * states it falls back to (a salmon with no `swim` clip is asked for `idle`). A clip under the
 * character's prefix that is not one of these is never played.
 */
export function lookedForClipIds(art: CharacterArt): Set<string> {
	const { drawn, mirrored } = characterFacings(art);
	const out = new Set<string>();
	for (const marked of variantViews(art))
		for (const { state } of characterStates(art))
			for (const facing of [...drawn, ...mirrored])
				for (const id of characterClipCandidates(art, state, facing, marked)) out.add(id);
	return out;
}

/** Whether a clip id sits under one of an art's prefixes, whatever its case or separators. */
export function underCharacterPrefix(art: CharacterArt, clipId: string): boolean {
	const id = clipIdOf(clipId);
	return characterPrefixes(art).some((prefix) => id.startsWith(`${clipIdOf(prefix)}_`));
}

/** How long the prefix of `art` is that `clipId` sits under (its longest); 0 for none. */
const ownedBy = (art: CharacterArt, clipId: string): number => {
	const id = clipIdOf(clipId);
	return Math.max(
		0,
		...characterPrefixes(art)
			.map(clipIdOf)
			.filter((prefix) => id.startsWith(`${prefix}_`))
			.map((prefix) => prefix.length),
	);
};

/**
 * The clips a character's one Bounds box is WRITTEN to, of the clips the game can play for it
 * (`played`: {@link lookedForClipIds}). Only its `own`: the ones under its prefixes. A sheet's
 * `anim` cell can name any clip of the project, so a clip it plays may be another character's
 * (`others`: under a prefix of theirs at least as exact) or under no prefix of this one's; those
 * are `leftOut`, and their box is set where they belong.
 */
export function boundsTargets<T extends { id: string }>(
	art: CharacterArt,
	played: readonly T[],
	others: readonly CharacterArt[] = [],
): { own: T[]; leftOut: T[] } {
	const own: T[] = [];
	const leftOut: T[] = [];
	for (const clip of played) {
		const mine = ownedBy(art, clip.id);
		const theirs = Math.max(0, ...others.map((other) => ownedBy(other, clip.id)));
		(mine > 0 && mine >= theirs ? own : leftOut).push(clip);
	}
	return { own, leftOut };
}

/**
 * What *Apply* of a character's one Bounds box writes: of the clips the game can play for it
 * (`played`), the ones of its `own` ({@link boundsTargets}) that carry no box or another
 * (`toBox`); `leftOut` are the played clips that are not its own, which Apply never writes.
 */
export function boundsPlan<T extends CharacterClipInfo>(
	art: CharacterArt,
	clips: readonly T[],
	others: readonly CharacterArt[],
	box: FlipbookBounds | undefined,
): { played: T[]; toBox: T[]; leftOut: T[] } {
	const lookedFor = lookedForClipIds(art);
	const played = clips.filter((clip) => lookedFor.has(clip.id));
	const { own, leftOut } = boundsTargets(art, played, others);
	const toBox = box
		? own.filter((clip) => !clip.bounds || boundsDiffer(clip.bounds, box).length > 0)
		: [];
	return { played, toBox, leftOut };
}

/** Why Apply leaves `leftOut` alone, for the panel; empty for none. */
export const leftOutText = (leftOut: readonly { id: string }[]): string =>
	leftOut.length
		? `${leftOut.length} clip${leftOut.length === 1 ? '' : 's'} this character plays ${leftOut.length === 1 ? 'is' : 'are'} left out (${leftOut.map((clip) => clip.id).join(', ')}): a cell of its sheet names ${leftOut.length === 1 ? 'it, and it is' : 'them, and they are'} not under this character's prefix, so ${leftOut.length === 1 ? 'it may be' : 'they may be'} another character's. Set ${leftOut.length === 1 ? 'its' : 'their'} box in Clips or on the character ${leftOut.length === 1 ? 'it belongs' : 'they belong'} to.`
		: '';

/** A part of an art's clip names that no saved clip's id can hold. */
export interface NameProblem {
	/** A sheet's prefix, a variant's prefix, an action's id (a block's state), a clip a cell
	 *  names, or the `name` an action is found under (`<prefix>_<action>_<facing>`), each part of
	 *  which can be stored but which is too long put together. */
	what: 'prefix' | 'variant' | 'action' | 'clip' | 'name';
	value: string;
	/** It has a capital letter (else another character an id cannot hold, or it is too long). */
	capital: boolean;
	/** What it would be as a saved clip's id. */
	stored: string;
}

/**
 * The parts of an art's names that can never match a saved clip. A clip's id is made by the save
 * ({@link clipIdOf}: lower case, a-z 0-9 and `_`, 60 at most), and the game asks for a name
 * letter for letter, so a prefix, an action or a named clip written any other way finds nothing.
 */
export function nameProblems(art: CharacterArt): NameProblem[] {
	const out: NameProblem[] = [];
	const check = (what: NameProblem['what'], value: string | undefined): void => {
		if (!value || isClipId(value)) return;
		if (out.some((p) => p.what === what && p.value === value)) return;
		out.push({ what, value, capital: /[A-Z]/.test(value), stored: clipIdOf(value) });
	};
	const { base, variants, states, facings, named, holds } = read(art);
	check('prefix', base);
	for (const { prefix } of variants) check('variant', prefix);
	for (const { state } of states) check('action', state);
	if (isSheetArt(art))
		for (const action of art.actions ?? [])
			for (const cell of Object.values(action.anim ?? {})) check('clip', cell.clip);
	// Parts that can each be stored, in a name too long to be: said once per action, as
	// Invisible Characters says it.
	const prefixes = characterPrefixes(art);
	const longest = [...prefixes].sort((a, b) => b.length - a.length)[0];
	if (longest !== undefined && prefixes.every(isClipId))
		for (const { state } of states) {
			const byName =
				variants.length > 0 ||
				facings.some((facing) => !named(state, facing) && holds(state, facing)?.kind !== 'still');
			if (!byName || !isClipId(state) || !clipNameTooLong(prefixes, state)) continue;
			const value = `${longest}_${state}_<facing>`;
			out.push({ what: 'name', value, capital: false, stored: clipIdOf(value) });
		}
	return out;
}

const NAME_PART: Record<Exclude<NameProblem['what'], 'name'>, string> = {
	prefix: 'The prefix',
	variant: 'The variant prefix',
	action: 'The action',
	clip: 'The clip named in a cell,',
};

/** A {@link NameProblem} in words. */
export const nameProblemText = ({ what, value, capital, stored }: NameProblem): string =>
	what === 'name'
		? `A clip id holds ${CLIP_ID_MAX} characters, and "${value}" is longer, so no clip matches it. Shorten the prefix or the action.`
		: `${NAME_PART[what]} "${value}" ${
				capital ? 'has a capital letter' : 'is not written as a clip’s id is'
			}. A clip is saved under a lower-case id (a-z, 0-9 and _), so no clip can match it and the ` +
			`game finds none. Write it "${stored}".`;

/** What the game draws for one state and facing. */
export type CellStatus =
	/** Its own clip, as made. */
	| { kind: 'made' }
	/** No clip of its own: its mirror twin's, drawn mirrored. */
	| { kind: 'mirrored'; clipId: string }
	/** Another facing's, another state's or (for a marked player) the base prefix's clip. `marked`:
	 *  the clip is under a variant's prefix. */
	| { kind: 'standIn'; clipId: string; flipX: boolean; state: string; marked: boolean }
	/** Nothing: the component's own tree is drawn. */
	| { kind: 'none' };

export interface GridCell {
	/** The name the game looks for first; for a cell that holds a still image, that image's id. */
	name: string;
	state: string;
	facing: ClipFacing;
	drawn: boolean;
	/** The sheet names this clip for the cell (`anim`), so it is not found by the name rule. */
	named?: true;
	/** The sheet's cell holds a still image or a rig's animation, not a clip (the base grid's
	 *  cells only: a variant's clips are found by name alone). */
	holds?: CellHolds;
	status: CellStatus;
}

export interface CharacterGrid {
	drawn: ClipFacing[];
	mirrored: ClipFacing[];
	/** States down; each row's cells follow `drawn` then `mirrored`. */
	rows: (CharacterState & { cells: GridCell[] })[];
}

/** What tells one cell of a grid from another: its state and its facing. */
export const cellKey = (cell: Pick<GridCell, 'state' | 'facing'>): string =>
	`${cell.state}|${cell.facing}`;

/**
 * The grid of a character: per state and facing, the clip the game draws out of `clipIds` (the
 * project's), by the game's own resolver ({@link resolveCharacterClip} for a block,
 * {@link resolveSheetClip} for a sheet). `marked` is the grid of a marked player, or of a player
 * the named status holds for. A character of eight facings breaks a tie between two stand-ins as
 * near by the facing it was last seen in; the grid shows the game's choice with no facing seen
 * yet. A sheet's action with no clip yet is a row of empty cells, each with the name its clip is
 * made under.
 */
export function characterGrid(
	art: CharacterArt,
	clipIds: Iterable<string>,
	marked: ArtVariant = false,
): CharacterGrid {
	const have = new Set(clipIds);
	const has = (clipId: string): boolean => have.has(clipId);
	const reading = read(art);
	const status = statusOf(marked);
	const { drawn, mirrored } = characterFacings(art);
	const held = (state: string, facing: ClipFacing): CellHolds | undefined =>
		status === undefined ? reading.holds(state, facing) : undefined;
	/** What a cell draws first: the still image it holds, else the clip the game asks for first. */
	const nameOf = (state: string, facing: ClipFacing): string => {
		const holds = held(state, facing);
		return holds?.kind === 'still' ? holds.clipId : characterClipName(art, state, facing, marked);
	};
	const cell = (state: string, facing: ClipFacing): GridCell => {
		const name = nameOf(state, facing);
		const holds = held(state, facing);
		const base: Omit<GridCell, 'status'> = {
			name,
			state,
			facing,
			drawn: drawn.includes(facing),
			...(name && reading.named(state, facing) === name ? { named: true } : {}),
			...(holds ? { holds } : {}),
		};
		const found = reading.resolve(state, facing, status, has);
		if (!found) return { ...base, status: { kind: 'none' } };
		if (found.clipId === name && !found.flipX) return { ...base, status: { kind: 'made' } };
		const twin = clipMirrorOf(facing);
		if (twin && found.flipX && found.clipId === nameOf(state, twin))
			return { ...base, status: { kind: 'mirrored', clipId: found.clipId } };
		const { clipId, flipX, state: plays, variant } = found;
		return {
			...base,
			status: { kind: 'standIn', clipId, flipX, state: plays, marked: variant !== undefined },
		};
	};
	return {
		drawn,
		mirrored,
		rows: reading.states.map((row) => ({
			...row,
			cells: [...drawn, ...mirrored].map((facing) => cell(row.state, facing)),
		})),
	};
}

/**
 * The CSS `grid-template-areas` of a compass that holds `facings`, each in the area `f-<facing>`,
 * north up: only the rows and columns a facing sits in, with `mid` in the centre when the centre
 * is kept. Four diagonals are a square, eight a ring, a side view one row.
 */
export function compassAreas(facings: readonly ClipFacing[]): string {
	const ring: (ClipFacing | 'mid')[][] = [
		['nw', 'n', 'ne'],
		['w', 'mid', 'e'],
		['sw', 's', 'se'],
	];
	const kept = (cell: ClipFacing | 'mid'): boolean => cell !== 'mid' && facings.includes(cell);
	const rows = ring.filter((row) => row.some(kept));
	const columns = [0, 1, 2].filter((column) => ring.some((row) => kept(row[column])));
	return ring
		.filter((row) => rows.includes(row))
		.map(
			(row) =>
				`"${columns
					.map((column) => row[column])
					.map((cell) => (cell === 'mid' ? 'mid' : kept(cell) ? `f-${cell}` : '.'))
					.join(' ')}"`,
		)
		.join(' ');
}

/** The clip a cell draws and whether the game mirrors it, or `undefined` when nothing plays. */
export function cellPlays({
	name,
	status,
}: GridCell): { clipId: string; flipX: boolean } | undefined {
	if (status.kind === 'none') return undefined;
	if (status.kind === 'made') return { clipId: name, flipX: false };
	if (status.kind === 'mirrored') return { clipId: status.clipId, flipX: true };
	return { clipId: status.clipId, flipX: status.flipX };
}

/** How many of a grid's drawn cells have their own clip, and how many cells draw nothing. A cell
 *  that holds a still image or a rig's animation needs no clip made, so it is not counted. */
export function gridCounts(grid: CharacterGrid): { made: number; needed: number; empty: number } {
	const cells = grid.rows.flatMap((row) => row.cells);
	const needed = cells.filter((c) => c.drawn && !c.holds);
	return {
		made: needed.filter((c) => c.status.kind === 'made').length,
		needed: needed.length,
		empty: cells.filter((c) => c.status.kind === 'none').length,
	};
}

/** How a misspelt name differs from the valid one nearest it. */
export type NearWhy =
	/** Only its case or its separators differ. */
	| 'spelling'
	/** The valid name, with something after it. */
	| 'suffix'
	/** Its facing is a compass word (`east` for `e`). */
	| 'facing'
	/** One or two letters off. */
	| 'typo'
	/** Nothing close: only the least far. */
	| 'guess';

const COMPASS: readonly [string, ClipFacing][] = [
	['north_east', 'ne'],
	['north_west', 'nw'],
	['south_east', 'se'],
	['south_west', 'sw'],
	['northeast', 'ne'],
	['northwest', 'nw'],
	['southeast', 'se'],
	['southwest', 'sw'],
	['north', 'n'],
	['east', 'e'],
	['south', 's'],
	['west', 'w'],
];

function editDistance(a: string, b: string): number {
	let row = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const next = [i];
		for (let j = 1; j <= b.length; j++)
			next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		row = next;
	}
	return row[b.length];
}

/** The most letters a name may be off by and still be read as a typo of a valid one. */
const TYPO_LETTERS = 2;

/** The valid name nearest `name`, and how `name` differs from it; `undefined` with no names. */
export function nearestClipName(
	name: string,
	names: readonly string[],
): { name: string; why: NearWhy } | undefined {
	if (!names.length) return undefined;
	const id = folded(name);
	if (names.includes(id)) return { name: id, why: 'spelling' };
	for (const [word, facing] of COMPASS) {
		if (!id.endsWith(`_${word}`)) continue;
		const spelt = `${id.slice(0, -word.length)}${facing}`;
		if (names.includes(spelt)) return { name: spelt, why: 'facing' };
	}
	const stem = names
		.filter((valid) => id.startsWith(`${valid}_`))
		.sort((a, b) => b.length - a.length)[0];
	if (stem) return { name: stem, why: 'suffix' };
	let best = names[0];
	let least = Infinity;
	for (const valid of names) {
		const distance = editDistance(id, valid);
		if (distance < least) {
			least = distance;
			best = valid;
		}
	}
	return { name: best, why: least <= TYPO_LETTERS ? 'typo' : 'guess' };
}

/** A project clip under a character's prefix that is not one of its names. */
export interface StrayClip {
	id: string;
	/** `misnamed`: the game never asks for it. `standInOnly`: asked for only when another state has
	 *  no clip (a state the look does not name). */
	kind: 'misnamed' | 'standInOnly';
	/** The valid name nearest it (`misnamed` only). */
	nearest?: string;
	why?: NearWhy;
}

/**
 * The project's clips under a character's prefixes that are not its names. A clip another
 * character of the project plays (`others`: one whose prefix starts with this one's) is not this
 * character's stray.
 */
export function strayClips(
	look: CharacterArt,
	clipIds: Iterable<string>,
	others: readonly CharacterArt[] = [],
): StrayClip[] {
	const names = characterClipNames(look).map((n) => n.id);
	const valid = new Set(names);
	const lookedFor = lookedForClipIds(look);
	const theirs = new Set(others.flatMap((other) => [...lookedForClipIds(other)]));
	const out: StrayClip[] = [];
	for (const id of clipIds) {
		if (valid.has(id) || theirs.has(id) || !underCharacterPrefix(look, id)) continue;
		if (lookedFor.has(id)) {
			out.push({ id, kind: 'standInOnly' });
			continue;
		}
		const near = nearestClipName(id, names);
		out.push({ id, kind: 'misnamed', nearest: near?.name, why: near?.why });
	}
	return out.sort((a, b) => a.id.localeCompare(b.id));
}

const BOUNDS_FIELDS = ['x', 'y', 'w', 'h'] as const;
export type BoundsField = (typeof BOUNDS_FIELDS)[number];

/** The fields two boxes differ in. */
export const boundsDiffer = (a: FlipbookBounds, b: FlipbookBounds): BoundsField[] =>
	BOUNDS_FIELDS.filter((field) => a[field] !== b[field]);

/** What the panel reads of a clip. */
export type CharacterClipInfo = Pick<FlipbookClip, 'id' | 'bounds' | 'flipX' | 'loop'>;

export interface CharacterBounds {
	/** The box most of the character's clips carry; `undefined` when none carries one. */
	reference: FlipbookBounds | undefined;
	/** Each distinct box and the clips carrying it, the most used first. */
	boxes: { bounds: FlipbookBounds; clipIds: string[] }[];
	/** The clips with no box. */
	missing: string[];
}

/** The boxes a character's clips carry. `clips` are the ones the game can play for it. */
export function characterBounds(clips: readonly CharacterClipInfo[]): CharacterBounds {
	const boxes: CharacterBounds['boxes'] = [];
	const missing: string[] = [];
	for (const { id, bounds } of clips) {
		if (!bounds) {
			missing.push(id);
			continue;
		}
		const same = boxes.find((box) => boundsDiffer(box.bounds, bounds).length === 0);
		if (same) same.clipIds.push(id);
		else boxes.push({ bounds, clipIds: [id] });
	}
	boxes.sort((a, b) => b.clipIds.length - a.clipIds.length);
	return { reference: boxes[0]?.bounds, boxes, missing };
}

/** Something about a saved clip that draws the character wrongly, or not as the author set it. */
export type ClipProblem =
	/** No Bounds box: the game sizes it by its first frame, so its scale is its own. */
	| { kind: 'noBounds'; clipId: string }
	/** Its box is not the character's: a `w` apart changes its size, an `h` or `y` its feet, an
	 *  `x` its centre. */
	| { kind: 'boundsDiffer'; clipId: string; differs: BoundsField[] }
	/** Saved with Mirror X on a facing the game mirrors: the game's mirroring is turned over. */
	| { kind: 'mirrorX'; clipId: string; facing: ClipFacing }
	/** A state the game plays once, saved as a loop. */
	| { kind: 'savedAsLoop'; clipId: string; state: string }
	/** A state the game loops, saved to play once. */
	| { kind: 'savedAsOnce'; clipId: string; state: string };

/**
 * What is wrong with a character's saved clips. `clips` are the project's; only the ones the game
 * can play for this character are read. `reference` is the character's box ({@link
 * characterBounds}'s unless the author picked another).
 */
export function characterProblems(
	look: CharacterArt,
	clips: readonly CharacterClipInfo[],
	reference?: FlipbookBounds,
): ClipProblem[] {
	const lookedFor = lookedForClipIds(look);
	const played = clips.filter((clip) => lookedFor.has(clip.id));
	const box = reference ?? characterBounds(played).reference;
	const names = new Map(characterClipNames(look).map((n) => [n.id, n]));
	const states = new Map(characterStates(look).map((s) => [s.state, s]));
	const { mirrored } = characterFacings(look);
	/** A facing the game mirrors, or the twin it is mirrored from. */
	const inMirrorPair = (facing: ClipFacing): boolean => {
		const twin = clipMirrorOf(facing);
		return twin !== undefined && (mirrored.includes(facing) || mirrored.includes(twin));
	};
	const out: ClipProblem[] = [];
	for (const clip of played) {
		if (!clip.bounds) out.push({ kind: 'noBounds', clipId: clip.id });
		else if (box) {
			const differs = boundsDiffer(clip.bounds, box);
			if (differs.length) out.push({ kind: 'boundsDiffer', clipId: clip.id, differs });
		}
		const name = names.get(clip.id);
		if (!name) continue;
		if (clip.flipX === true && inMirrorPair(name.facing))
			out.push({ kind: 'mirrorX', clipId: clip.id, facing: name.facing });
		const state = states.get(name.state);
		const loops = clip.loop !== false;
		if (state?.once && !state.loop && loops)
			out.push({ kind: 'savedAsLoop', clipId: clip.id, state: name.state });
		if (state?.loop && !state.once && !loops)
			out.push({ kind: 'savedAsOnce', clipId: clip.id, state: name.state });
	}
	return out;
}

/**
 * The runs a sheet's regions make, for clip-making: every consecutively-numbered run whatever
 * its length (`detectSequencesAcross` with no minimum, so a multipacked animation still merges
 * across its pages), and each region with no number as a run of one, since a single still is a
 * one-frame clip. A region is unnumbered exactly when no numbered run took it.
 */
export function detectClipRuns(sheets: readonly SheetRegions[]): DetectedSequenceAcross[] {
	const runs = detectSequencesAcross([...sheets], 1);
	const taken = new Set<string>();
	for (const run of runs)
		for (const frame of run.frames)
			taken.add(frame.includes('::') ? frame : `${run.primary}::${frame}`);
	for (const { assetKey, regions } of sheets)
		for (const region of regions ?? []) {
			if (typeof region !== 'string' || !region || taken.has(`${assetKey}::${region}`)) continue;
			runs.push({ stem: region, primary: assetKey, frames: [region], sheets: [assetKey] });
		}
	return runs;
}

/** How a run's name gave the clip's. */
export type RunMatch =
	/** The run's name is the clip's, as the save would slug it. */
	| 'exact'
	/** `<prefix>_<facing>`, one frame: that facing's still, the idle state's one-frame clip. */
	| 'still'
	/** A misspelt name: offered, never made unasked. */
	| 'near';

export interface PlanRow {
	run: DetectedSequenceAcross;
	/** The clip it would make. */
	name: string;
	state: string;
	facing: ClipFacing;
	marked: boolean;
	match: RunMatch;
	/** How the run's name differs (`near` only). */
	why?: NearWhy;
	/** `create`: no such clip yet. `exists`: there is one, and it is left alone. `duplicate`:
	 *  another run of this plan already makes that clip. */
	action: 'create' | 'exists' | 'duplicate';
}

export interface ClipPlan {
	rows: PlanRow[];
	/** Runs under the character's prefix that give no name. */
	unmatched: DetectedSequenceAcross[];
}

const MATCH_RANK: Record<RunMatch, number> = { exact: 0, still: 1, near: 2 };

/**
 * Which clips a sheet's `runs` would make for a character: each run matched to one of its names,
 * a clip already in `existingIds` left alone, and of several runs with one name the longest
 * taken (a gap in the numbering splits an animation in two). A cell of a sheet that holds a still
 * image or a rig's animation ({@link CellHolds}) is given no clip. `others` are the project's other
 * characters, whose runs are not this one's misspellings.
 */
export function planCharacterClips(
	look: CharacterArt,
	runs: readonly DetectedSequenceAcross[],
	existingIds: Iterable<string>,
	others: readonly CharacterArt[] = [],
): ClipPlan {
	const names = characterClipNames(look);
	const byId = new Map(names.map((n) => [n.id, n]));
	const ids = names.map((n) => n.id);
	const lookedFor = lookedForClipIds(look);
	const theirs = new Set(others.flatMap((other) => [...lookedForClipIds(other)]));
	const existing = new Set(existingIds);
	const { drawn, mirrored } = characterFacings(look);
	const stills = new Map<string, CharacterClipName>();
	const { base, variants, still: idle, states, holds } = read(look);
	// The name a cell that holds a still image or a rig's animation would have had: a run under
	// it makes no clip, and is no misspelling of another cell's.
	const held = new Set(
		states.flatMap(({ state }) =>
			[...drawn, ...mirrored]
				.filter((facing) => holds(state, facing))
				.map((facing) => clipIdOf(`${base}_${state}_${facing}`)),
		),
	);
	if (idle !== undefined)
		for (const [marked, prefix] of [
			[false, base] as const,
			...variants.map((v) => [v.status, v.prefix] as const),
		])
			for (const facing of [...drawn, ...mirrored]) {
				const name = byId.get(characterClipName(look, idle, facing, marked));
				// A clip the sheet names for the cell is not found by the name rule, so it has no still.
				if (name && name.state === idle && name.marked === (marked !== false))
					stills.set(folded(`${prefix}_${facing}`), name);
			}

	const matched: Omit<PlanRow, 'action'>[] = [];
	const unmatched: DetectedSequenceAcross[] = [];
	const row = (
		run: DetectedSequenceAcross,
		{ id, state, facing, marked }: CharacterClipName,
		match: RunMatch,
		why?: NearWhy,
	): Omit<PlanRow, 'action'> => ({
		run,
		name: id,
		state,
		facing,
		marked,
		match,
		...(why ? { why } : {}),
	});
	for (const run of runs) {
		const id = clipIdOf(run.stem);
		const exact = byId.get(id);
		if (exact) {
			matched.push(row(run, exact, 'exact'));
			continue;
		}
		if (theirs.has(id) || !underCharacterPrefix(look, run.stem)) continue;
		if (held.has(id)) {
			unmatched.push(run);
			continue;
		}
		const still = run.frames.length === 1 ? stills.get(folded(run.stem)) : undefined;
		if (still) {
			matched.push(row(run, still, 'still'));
			continue;
		}
		const near = lookedFor.has(id) ? undefined : nearestClipName(run.stem, ids);
		const name = near && near.why !== 'guess' ? byId.get(near.name) : undefined;
		if (near && name) matched.push(row(run, name, 'near', near.why));
		else unmatched.push(run);
	}

	const order = new Map(ids.map((id, index) => [id, index]));
	matched.sort(
		(a, b) =>
			(order.get(a.name) ?? 0) - (order.get(b.name) ?? 0) ||
			MATCH_RANK[a.match] - MATCH_RANK[b.match] ||
			b.run.frames.length - a.run.frames.length ||
			a.run.frames[0].localeCompare(b.run.frames[0]),
	);
	const claimed = new Set<string>();
	const rows = matched.map((made): PlanRow => {
		if (existing.has(made.name)) return { ...made, action: 'exists' };
		if (claimed.has(made.name)) return { ...made, action: 'duplicate' };
		claimed.add(made.name);
		return { ...made, action: 'create' };
	});
	return { rows, unmatched };
}

/** How a state's new clips play. */
export interface StateSettings {
	fps: number;
	loop: boolean;
}

/** Each state's settings for a new clip: the tool's frame rate, a loop unless the game plays the
 *  state once. */
export function defaultStateSettings(look: CharacterArt): Record<string, StateSettings> {
	return Object.fromEntries(
		characterStates(look).map(({ state, loop, once }) => [
			state,
			{ fps: DEFAULT_FLIPBOOK_FPS, loop: loop || !once },
		]),
	);
}

/** The clip a plan row makes: named as the game looks for it, with the character's box if it has
 *  one. */
export function plannedClip(
	row: Pick<PlanRow, 'name' | 'run'>,
	settings: StateSettings,
	bounds?: FlipbookBounds,
): FlipbookClip {
	return {
		id: row.name,
		name: row.name,
		assetKey: row.run.primary,
		frames: [...row.run.frames],
		fps: settings.fps,
		loop: settings.loop,
		...(bounds ? { bounds: { ...bounds } } : {}),
	};
}

/** Where a character's feet are on a box, in the box's own art px: the middle of the line
 *  `anchorY` down it (its bottom edge unless the look says otherwise). */
export function feetOf(look: CharacterArt, box: FlipbookBounds): { x: number; y: number } {
	return { x: box.x + box.w / 2, y: box.y + box.h * characterDraw(look).anchorY };
}
