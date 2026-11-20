/**
 * WHICH CHARACTERS OF A PROJECT PLAY CLIPS, and what each plays, for Invisible Flipbook's
 * Characters mode. Decided as the online runtime decides it (`apps/lines` `online.ts`), in its
 * order (`docs/design/character-pipeline.md` §9):
 *
 *  1. THE SHEET. A class of the game's config that names a character sheet
 *     (`arcade.online.characters[].sheet`) plays it when the sheet is one the game plays
 *     (`onlineClassSheetOf`, `sheetPlaysClips`): then its component's block is not read at all.
 *     A sheet drawn as a RIG or as STILL IMAGES is in force too, and its character is NOT LISTED:
 *     it plays no frame clip by name, so Flipbook has nothing to make for it, and the block of
 *     its component (or the game's) is not read either ({@link notClipCharacters} names them).
 *  2. THE COMPONENT'S BLOCK. Otherwise the class is drawn as its `body` component, whose
 *     `characterClips` it plays (`clipLookOf`).
 *  3. THE GAME'S TABLE. In a game drawn in Salmons' art a class whose component names none plays
 *     the game's own block, and a block that names no `facings` takes the game's
 *     (`engine-layout` `characterClipsIn`).
 *
 * Wider than the runtime in three ways, each so that a character can be given clips before the
 * rest of the game is wired: the game's built-in characters are listed for a Salmons config that
 * does not list them (their clips ship either way, `clipReachability` `builtinClipPrefixes`), so
 * is a component that carries a block no character of the config is drawn as, and so is a
 * character of the config whose sheet has frame clips but which no class plays yet (its clips ship
 * too: `characterSheetClipRoots` reads every sheet). A sheet of frame clips may hold a still image
 * or a rig's animation in a cell: `characterSet.ts` shows the cell as that.
 *
 * `config` must carry its sheets: the normalizer drops them, and the launcher's own load
 * (`gameConfigStorage` `loadGameConfigDocWithEtag`) puts them back.
 *
 * Pure: the endpoint and `scripts/check-flipbook-characters.ts` both run it.
 */
import {
	CHARACTER_CLIP_EVENTS,
	SALMONS_CHARACTER_CLIPS,
	characterClipsIn,
	sheetDraw,
	sheetFacings,
	sheetPlaysClips,
	type CharacterClips,
	type ComponentDef,
} from 'engine-layout';
import {
	characterSheetOf,
	characterTriggers,
	onlineClassSheetOf,
	usesSalmonsArt,
	type CharacterSheet,
	type CharacterTrigger,
	type GameConfigDoc,
} from 'game-config';

import {
	classSheetRefusal,
	firstUnplayed,
	sheetDrawnAs,
	sheetUnplayed,
	type SheetUnplayed,
} from '../characters/sheetCore';
import type { CharacterArt } from './characterSet';

export interface ProjectCharacter {
	/** Unique in the project's list: the character's id in the config, else its component's. */
	key: string;
	label: string;
	/**
	 * The block it plays. For a character that plays a sheet (`source: 'sheet'`) this is only the
	 * sheet in a block's shape, for a reader that has not learned the sheet: its prefixes, width,
	 * feet and hand are the sheet's, but a block has seven slots and two facing lists, so it cannot
	 * hold a sheet's actions or its view. Read {@link characterArt}.
	 */
	look: CharacterClips;
	/** The game's config lists it as a character a player can be. `false` for a sheet no class
	 *  names yet. */
	inConfig: boolean;
	/** Where what it plays is written: its sheet in the game's config, the component's own block,
	 *  or the game's built-in one. */
	source: 'sheet' | 'component' | 'game';
	/** Where a block's `facings` come from: the component's block, the game's, or neither (four).
	 *  A sheet's come from its view: `default` here. */
	facingsFrom: 'component' | 'game' | 'default';
	/** The component it is drawn as, when the project has it. */
	component?: { id: string; name: string; scope: ComponentDef['scope']; hasBlock: boolean };
	/** The sheet it plays (`source: 'sheet'`). */
	sheet?: CharacterSheet;
	/** The `arcade.characters` entry that holds `sheet`. */
	sheetId?: string;
	/** A sheet the game does not play, and why: the one its class names (it then plays the block
	 *  or the table listed here), or its own (`source: 'sheet'`, no class yet). */
	sheetProblem?: string;
}

/** What a listed character plays, for `characterSet.ts`: its sheet, else its block. */
export const characterArt = (character: ProjectCharacter): CharacterArt =>
	character.sheet ?? character.look;

type CharacterComponent = Pick<ComponentDef, 'id' | 'name' | 'scope' | 'characterClips'>;

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

const arcadeOf = (config: GameConfigDoc | null | undefined): Record<string, unknown> => {
	const arcade: unknown = (config as { arcade?: unknown } | null | undefined)?.arcade;
	return isObject(arcade) ? arcade : {};
};

/** The config's online characters as `{ id, body, sheet }`, read off a doc that may be
 *  unrepaired. */
function onlineCharacters(
	config: GameConfigDoc | null | undefined,
): { id: string; body: string; sheet: string }[] {
	const { online } = arcadeOf(config);
	const characters = isObject(online) ? online.characters : undefined;
	if (!Array.isArray(characters)) return [];
	return characters.flatMap((c) =>
		isObject(c) && typeof c.id === 'string' && typeof c.body === 'string'
			? [{ id: c.id, body: c.body, sheet: typeof c.sheet === 'string' ? c.sheet.trim() : '' }]
			: [],
	);
}

/** The config's own characters as `{ id, name, component }`, each id once. */
function configCharacters(
	config: GameConfigDoc | null | undefined,
): { id: string; name: string; component: string }[] {
	const { characters } = arcadeOf(config);
	const out: { id: string; name: string; component: string }[] = [];
	for (const c of Array.isArray(characters) ? characters : []) {
		if (!isObject(c) || typeof c.id !== 'string' || typeof c.component !== 'string') continue;
		const id = c.id.trim();
		const component = c.component.trim();
		if (!id || !component || out.some((o) => o.id === id)) continue;
		out.push({ id, name: typeof c.name === 'string' ? c.name.trim() : '', component });
	}
	return out;
}

const titled = (id: string): string => id.charAt(0).toUpperCase() + id.slice(1);

/** Flipbook names a missing source before a view with no facings: with no frame clips there is
 *  nothing for it to make. */
const UNPLAYED_ORDER: readonly SheetUnplayed[] = ['empty', 'source', 'facings', 'draw', 'actions'];
const UNPLAYED_WORDS: Record<SheetUnplayed, string> = {
	empty: 'it has no view, animation source, draw box or actions',
	source: 'it has no animation source',
	facings: 'a 3D view has no facings, so no frame clip is drawn',
	draw: 'its draw box has no width',
	actions: 'it has no action',
	build: 'this build does not play it',
};

/** Why the game does not draw a sheet, or `undefined` when it does (`sheetUnplayed`). */
export function sheetProblemOf(sheet: CharacterSheet | undefined): string | undefined {
	const why = firstUnplayed(sheetUnplayed(sheet), UNPLAYED_ORDER);
	return why && UNPLAYED_WORDS[why];
}

/**
 * Why a class that names a sheet does not play it, or `undefined` when it does or names none
 * (`classSheetRefusal`).
 */
function classSheetProblem(
	config: GameConfigDoc | null | undefined,
	cls: { id: string; body: string; sheet: string },
): string | undefined {
	if (!cls.sheet) return undefined;
	const character = configCharacters(config).find((c) => c.id === cls.sheet);
	const sheet = characterSheetOf(config, cls.sheet);
	const refusal = classSheetRefusal(cls, character, sheet);
	const names = `The class "${cls.id}" names the sheet of "${cls.sheet}"`;
	if (refusal?.kind === 'noCharacter') return `${names}, but the config has no such character.`;
	if (refusal?.kind === 'component')
		return (
			`${names}, which is drawn as "${refusal.component}" while the class is the body ` +
			`"${cls.body}": a class and its sheet use the same component.`
		);
	const why = sheetProblemOf(sheet) ?? 'the config does not keep the class';
	return `${names}, which is not played: ${why}.`;
}

/**
 * A sheet in a block's shape ({@link ProjectCharacter} `look`): the slots of a block filled from
 * the first action each of its triggers starts.
 */
function blockShapeOf(sheet: CharacterSheet): CharacterClips {
	const actions = sheet.actions ?? [];
	const first = (is: (trigger: CharacterTrigger) => boolean): string | undefined =>
		actions.find((action) => characterTriggers(action).some(is))?.id;
	const on: NonNullable<CharacterClips['on']> = {};
	for (const event of CHARACTER_CLIP_EVENTS) {
		const state = first((t) =>
			event === 'ability' ? 'ability' in t : 'event' in t && t.event === event,
		);
		if (state) on[event] = state;
	}
	const walk = first((t) => 'motion' in t && t.motion === 'moving');
	const holding = first((t) => 'status' in t && t.status === 'holding');
	const source = sheet.source?.kind === 'clips' ? sheet.source : undefined;
	const marked = source?.variants?.marked;
	const hand = sheet.draw?.points?.hand;
	const { width, anchorY } = sheetDraw(sheet);
	return {
		prefixes: { base: source?.prefix ?? '', ...(marked ? { marked } : {}) },
		displayWidth: width,
		...(anchorY !== 1 ? { anchorY } : {}),
		...(sheetFacings(sheet).length === 8 ? { facings: 8 as const } : {}),
		...(hand ? { hand: { x: hand.x, y: hand.y } } : {}),
		idle: first((t) => 'motion' in t && t.motion === 'still') ?? actions[0]?.id ?? 'idle',
		...(walk ? { walk } : {}),
		...(holding ? { holding } : {}),
		...(Object.keys(on).length ? { on } : {}),
	};
}

/** Whether a sheet's source is a rig or still images: its character plays no frame clip by name. */
const notClips = (sheet: CharacterSheet | undefined): boolean =>
	sheet?.source?.kind === 'rig' || sheet?.source?.kind === 'stills';

export interface NotClipCharacter {
	key: string;
	/** The `arcade.characters` entry that holds the sheet. */
	sheetId: string;
	kind: 'rig' | 'stills';
	/** An online class is drawn from it. */
	played: boolean;
	sheet: CharacterSheet;
}

/**
 * The characters {@link projectCharacters} leaves out because a rig or still images draw them:
 * the online classes whose sheet is in force as one (`key` the class's id, `played`), and the
 * config's characters whose sheet is one that no class plays (`key` the character's id).
 */
export function notClipCharacters(config: GameConfigDoc | null | undefined): NotClipCharacter[] {
	const out: NotClipCharacter[] = [];
	for (const { id } of onlineCharacters(config)) {
		const named = onlineClassSheetOf(config, id);
		const as = named && sheetDrawnAs(named.sheet);
		if (named && (as === 'rig' || as === 'stills') && !out.some((c) => c.key === id))
			out.push({ key: id, sheetId: named.id, kind: as, played: true, sheet: named.sheet });
	}
	for (const { id } of configCharacters(config)) {
		const sheet = characterSheetOf(config, id);
		const kind = sheet?.source?.kind;
		if (sheet && (kind === 'rig' || kind === 'stills') && !out.some((c) => c.sheetId === id))
			out.push({ key: id, sheetId: id, kind, played: false, sheet });
	}
	return out;
}

/** The project's characters that play clips, the config's own first. */
export function projectCharacters(
	components: readonly CharacterComponent[],
	config: GameConfigDoc | null | undefined,
): ProjectCharacter[] {
	const defs = new Map(components.map((def) => [def.id, def]));
	const builtin: Readonly<Record<string, CharacterClips>> = usesSalmonsArt(config)
		? SALMONS_CHARACTER_CLIPS
		: {};
	const out: ProjectCharacter[] = [];
	const drawnAs = new Set<string>();
	const componentOf = (def: CharacterComponent | undefined): Pick<ProjectCharacter, 'component'> =>
		def
			? {
					component: {
						id: def.id,
						name: def.name,
						scope: def.scope,
						hasBlock: !!def.characterClips,
					},
				}
			: {};
	const add = (
		key: string,
		inConfig: boolean,
		def: CharacterComponent | undefined,
		game: CharacterClips | undefined,
		sheetProblem?: string,
	): void => {
		const own = def?.characterClips;
		const look = characterClipsIn(own, game);
		if (!look || out.some((c) => c.key === key) || drawnOtherwise.has(key)) return;
		out.push({
			key,
			label: def?.name ?? titled(key),
			look,
			inConfig,
			source: own ? 'component' : 'game',
			facingsFrom: own?.facings ? 'component' : look.facings ? 'game' : 'default',
			...componentOf(def),
			...(sheetProblem ? { sheetProblem } : {}),
		});
		if (def) drawnAs.add(def.id);
	};
	const addSheet = (
		key: string,
		inConfig: boolean,
		label: string,
		def: CharacterComponent | undefined,
		sheetId: string,
		sheet: CharacterSheet,
		sheetProblem?: string,
	): void => {
		out.push({
			key,
			label,
			look: blockShapeOf(sheet),
			inConfig,
			source: 'sheet',
			facingsFrom: 'default',
			...componentOf(def),
			sheet,
			sheetId,
			...(sheetProblem ? { sheetProblem } : {}),
		});
	};
	const classes = onlineCharacters(config);
	/** The classes a rig or still images draw: not listed, under any key. */
	const drawnOtherwise = new Set<string>();
	for (const cls of classes) {
		const { id, body } = cls;
		if (out.some((c) => c.key === id) || drawnOtherwise.has(id)) continue;
		const def = defs.get(body);
		const named = onlineClassSheetOf(config, id);
		if (named && notClips(named.sheet) && sheetDrawnAs(named.sheet)) {
			drawnOtherwise.add(id);
			// Its component's block is not read while the sheet is in force.
			if (def) drawnAs.add(def.id);
			continue;
		}
		if (named && sheetPlaysClips(named.sheet)) {
			addSheet(id, true, def?.name ?? titled(id), def, named.id, named.sheet);
			// Its component's block is not read while the sheet is in force.
			if (def) drawnAs.add(def.id);
			continue;
		}
		const game = Object.hasOwn(builtin, id) ? builtin[id] : undefined;
		add(id, true, def, game, classSheetProblem(config, cls));
	}
	for (const [id, game] of Object.entries(builtin)) add(id, false, undefined, game);
	for (const def of components) {
		if (!def.characterClips || drawnAs.has(def.id)) continue;
		// A component may share its id with a character of the config that is drawn as another one.
		const taken = out.some((c) => c.key === def.id);
		add(taken ? `component:${def.id}` : def.id, false, def, undefined);
	}
	for (const { id, name, component } of configCharacters(config)) {
		if (out.some((c) => c.sheetId === id)) continue;
		const sheet = characterSheetOf(config, id);
		if (!sheet?.source || notClips(sheet) || !sheetFacings(sheet).length) continue;
		const def = defs.get(component);
		const taken = out.some((c) => c.key === id);
		const namedBy = classes.find((cls) => cls.sheet === id);
		const unplayed = sheetProblemOf(sheet);
		addSheet(
			taken ? `sheet:${id}` : id,
			false,
			name || def?.name || titled(id),
			def,
			id,
			sheet,
			(namedBy && classSheetProblem(config, namedBy)) ??
				(unplayed ? `Its sheet is not played: ${unplayed}.` : undefined),
		);
	}
	return out;
}
