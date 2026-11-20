/**
 * THE CHARACTER SHEET (`docs/design/character-pipeline.md` §2, step C2a): how a character is
 * drawn, as data on its `arcade.characters` entry — its view, its animation source, its draw box
 * and its actions. An online class (`arcade.online.characters[]`) names its sheet by that entry's
 * id (`sheet`), and both must use the same component. SPARSE: a character with none of the four
 * fields has no sheet and plays as it always did, and a field at its default is not stored.
 *
 * CARRIED, NOT NORMALIZED. This package is in every runtime's bundle, and `normalizeArcade` and
 * `validateGameConfigDoc` are kept by the slot, match-3 and card bundles, which must stay the same
 * bytes (`check:runtime-bytes`). So neither learns the sheet: `normalizeGameConfigDoc` drops these
 * fields, as it drops `arcade.world3d`. Whoever needs a sheet reads it off the RAW doc with the
 * functions here, which only an arcade runtime, the launcher and the gates import. The launcher's
 * load and save put the fields back on the normalized doc ({@link withCharacterSheets}).
 */

import type { GameConfigIssue } from './validate';

/** The eight facings, clockwise from north as the screen draws them (`engine-layout`
 *  `CLIP_FACINGS`). */
export const CHARACTER_FACINGS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;
export type CharacterFacing = (typeof CHARACTER_FACINGS)[number];

export const CHARACTER_VIEW_KINDS = ['side', 'topDown', 'isometric', '3d'] as const;
export type CharacterViewKind = (typeof CHARACTER_VIEW_KINDS)[number];

/**
 * How the character is seen, chosen once per character. It fixes the facing list and the facing
 * rule: `side` is `e` `w`; `topDown` is `n` `e` `s` `w`, or all eight; `isometric` is the four
 * diagonals, or all eight; `3d` has none (the body's yaw turns the model).
 */
export type CharacterView =
	| {
			kind: 'side';
			/** Its art cannot be flipped: no facing is drawn mirrored. Absent ⇒ mirrored. */
			mirror?: false;
	  }
	| {
			kind: 'topDown' | 'isometric';
			/** Absent ⇒ 4. */
			facings?: 8;
			mirror?: false;
	  }
	| { kind: '3d' };

/**
 * Where the animations come from. Only frame clips are a sheet's source so far; a character with
 * no `source` keeps its component's own state machine. A source of a kind this build does not
 * know is not read, and the character plays as one with no sheet.
 */
export type CharacterSource = {
	kind: 'clips';
	/** Its clips are named `<prefix>_<action>_<facing>`. */
	prefix: string;
	/** A second art set, tried first while the status of its key holds (`marked`: Salmons' golden
	 *  salmon), by status name. */
	variants?: Record<string, string>;
};

/** The box the art is drawn in. */
export type CharacterDraw = {
	/** How wide the art's Bounds box is drawn, world px. */
	width: number;
	/** Where the ground is down the box, 0 (top) to 1 (bottom). Absent ⇒ 1. */
	feet?: number;
	/** Named points across and down the box (0 to 1), mirrored with the art: `hand` is where a held
	 *  line starts. */
	points?: Record<string, { x: number; y: number }>;
};

export const CHARACTER_MOTIONS = ['still', 'moving'] as const;
export type CharacterMotion = (typeof CHARACTER_MOTIONS)[number];

export const CHARACTER_ABILITY_BUTTONS = ['ability1', 'ability2'] as const;
export type CharacterAbilityButton = (typeof CHARACTER_ABILITY_BUTTONS)[number];

/** What starts an action. */
export type CharacterTrigger =
	/** Found from how the character moves as drawn. */
	| { motion: CharacterMotion }
	/** The character uses the ability on this button. */
	| { ability: CharacterAbilityButton }
	/** A rules event names the character: as its user, or as its `target`. */
	| { event: string; as?: 'target' }
	/** While a status holds (`holding`, `marked`, a room status' name). */
	| { status: string };

export const CHARACTER_PLAYS = ['loop', 'once'] as const;
export type CharacterPlay = (typeof CHARACTER_PLAYS)[number];

/** One thing the character can do. */
export type CharacterAction = {
	/** Unique in the sheet: the `<action>` of the clip name rule. */
	id: string;
	name?: string;
	/** Absent ⇒ nothing starts it: it only stands in for another action (`fallback`). */
	when?: CharacterTrigger | CharacterTrigger[];
	/** Absent ⇒ `once` when an ability or an event starts it, else `loop`. */
	play?: CharacterPlay;
	/** Of the actions whose trigger holds, the highest plays. Absent ⇒ 3 for an ability or an
	 *  event, 2 for a status, 1 for a motion. */
	priority?: number;
	/** What may cut it while it plays `once`: absent ⇒ any other `once`; `priority` ⇒ only one of
	 *  the same priority or higher; `none` ⇒ nothing. A loop never cuts a `once`. */
	interrupt?: 'priority' | 'none';
	/** Started again while it plays: absent ⇒ it restarts; `ignore` ⇒ it plays on. */
	again?: 'ignore';
	/** Per facing, the clip. A facing left out is found by name. */
	anim?: Partial<Record<CharacterFacing, { clip: string }>>;
	/** The action drawn in its place when it has no clip in any facing. */
	fallback?: string;
};

/** The sheet's four fields, as they sit on an `arcade.characters` entry. */
export type CharacterSheet = {
	view?: CharacterView;
	source?: CharacterSource;
	draw?: CharacterDraw;
	actions?: CharacterAction[];
};

export const CHARACTER_SHEET_FIELDS = ['view', 'source', 'draw', 'actions'] as const;

type Raw = Record<string, unknown>;

const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

const finite = (v: unknown): number | undefined =>
	typeof v === 'number' && Number.isFinite(v) ? v : undefined;

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

const includes = <T extends string>(list: readonly T[], v: unknown): v is T =>
	typeof v === 'string' && (list as readonly string[]).includes(v);

/** The triggers of an action: none when nothing starts it. */
export const characterTriggers = (action: Pick<CharacterAction, 'when'>): CharacterTrigger[] =>
	action.when === undefined ? [] : Array.isArray(action.when) ? action.when : [action.when];

const startsOnce = (trigger: CharacterTrigger): boolean =>
	'ability' in trigger || 'event' in trigger;

const defaultPlay = (triggers: CharacterTrigger[]): CharacterPlay =>
	triggers.some(startsOnce) ? 'once' : 'loop';

const triggerPriority = (trigger: CharacterTrigger): number =>
	startsOnce(trigger) ? 3 : 'status' in trigger ? 2 : 1;

const defaultPriority = (triggers: CharacterTrigger[]): number =>
	triggers.reduce((highest, trigger) => Math.max(highest, triggerPriority(trigger)), 0);

/** How an action plays: its own `play`, else `once` when an ability or an event is among its
 *  triggers, else `loop`. */
export const characterActionPlay = (
	action: Pick<CharacterAction, 'when' | 'play'>,
): CharacterPlay => action.play ?? defaultPlay(characterTriggers(action));

/** An action's priority: its own, else the highest of its triggers' (3 for an ability or an
 *  event, 2 for a status, 1 for a motion), and 0 for an action nothing starts. */
export const characterActionPriority = (
	action: Pick<CharacterAction, 'when' | 'priority'>,
): number => action.priority ?? defaultPriority(characterTriggers(action));

/**
 * The facings a view draws, clockwise from north. A character with no view is drawn as every
 * character was before the sheet: in the four isometric diagonals. A `3d` view has none.
 */
export const characterViewFacings = (
	view: CharacterView | undefined,
): readonly CharacterFacing[] => {
	if (!view) return ['ne', 'se', 'sw', 'nw'];
	if (view.kind === '3d') return [];
	if (view.kind === 'side') return ['e', 'w'];
	if (view.facings === 8) return CHARACTER_FACINGS;
	return view.kind === 'topDown' ? ['n', 'e', 's', 'w'] : ['ne', 'se', 'sw', 'nw'];
};

/** A sheet this build can play: frame clips, a width to draw them at, and an action. */
export type ClipSheet = CharacterSheet & {
	source: CharacterSource;
	draw: CharacterDraw;
	actions: CharacterAction[];
};

export const isClipSheet = (sheet: CharacterSheet | undefined): sheet is ClipSheet =>
	sheet?.source?.kind === 'clips' && !!sheet.draw && !!sheet.actions?.length;

const normalizeView = (raw: unknown): CharacterView | undefined => {
	if (!isObject(raw) || !includes(CHARACTER_VIEW_KINDS, raw.kind)) return undefined;
	if (raw.kind === '3d') return { kind: '3d' };
	if (raw.kind === 'side')
		return raw.mirror === false ? { kind: 'side', mirror: false } : { kind: 'side' };
	const view: CharacterView = { kind: raw.kind };
	if (raw.facings === 8) view.facings = 8;
	if (raw.mirror === false) view.mirror = false;
	return view;
};

const normalizeSource = (raw: unknown): CharacterSource | undefined => {
	if (!isObject(raw) || raw.kind !== 'clips') return undefined;
	const prefix = text(raw.prefix);
	if (!prefix) return undefined;
	const source: CharacterSource = { kind: 'clips', prefix };
	const variants: Record<string, string> = {};
	for (const [key, value] of Object.entries(isObject(raw.variants) ? raw.variants : {})) {
		const status = key.trim();
		const variant = text(value);
		if (status && variant && !(status in variants)) variants[status] = variant;
	}
	if (Object.keys(variants).length) source.variants = variants;
	return source;
};

const normalizeDraw = (raw: unknown): CharacterDraw | undefined => {
	if (!isObject(raw)) return undefined;
	const width = finite(raw.width);
	if (width === undefined || width <= 0) return undefined;
	const draw: CharacterDraw = { width };
	const feet = finite(raw.feet);
	if (feet !== undefined && feet !== 1) draw.feet = feet;
	const points: Record<string, { x: number; y: number }> = {};
	for (const [key, value] of Object.entries(isObject(raw.points) ? raw.points : {})) {
		const name = key.trim();
		const x = isObject(value) ? finite(value.x) : undefined;
		const y = isObject(value) ? finite(value.y) : undefined;
		if (name && x !== undefined && y !== undefined && !(name in points)) points[name] = { x, y };
	}
	if (Object.keys(points).length) draw.points = points;
	return draw;
};

/** One trigger, read by the first of `motion`, `ability`, `event`, `status` it has. */
const normalizeTrigger = (raw: unknown): CharacterTrigger | undefined => {
	if (!isObject(raw)) return undefined;
	if (raw.motion !== undefined)
		return includes(CHARACTER_MOTIONS, raw.motion) ? { motion: raw.motion } : undefined;
	if (raw.ability !== undefined)
		return includes(CHARACTER_ABILITY_BUTTONS, raw.ability) ? { ability: raw.ability } : undefined;
	if (raw.event !== undefined) {
		const event = text(raw.event);
		if (!event) return undefined;
		return raw.as === 'target' ? { event, as: 'target' } : { event };
	}
	const status = text(raw.status);
	return status ? { status } : undefined;
};

const rawTriggers = (raw: unknown): unknown[] =>
	raw === undefined || raw === null ? [] : Array.isArray(raw) ? raw : [raw];

const sameTrigger = (a: CharacterTrigger, b: CharacterTrigger): boolean =>
	JSON.stringify(a) === JSON.stringify(b);

const normalizeTriggers = (raw: unknown): CharacterTrigger[] => {
	const triggers: CharacterTrigger[] = [];
	for (const entry of rawTriggers(raw)) {
		const trigger = normalizeTrigger(entry);
		if (trigger && !triggers.some((kept) => sameTrigger(kept, trigger))) triggers.push(trigger);
	}
	return triggers;
};

const normalizeAnim = (raw: unknown): CharacterAction['anim'] => {
	if (!isObject(raw)) return undefined;
	const anim: NonNullable<CharacterAction['anim']> = {};
	for (const facing of CHARACTER_FACINGS) {
		const cell = raw[facing];
		const clip = isObject(cell) ? text(cell.clip) : '';
		if (clip) anim[facing] = { clip };
	}
	return Object.keys(anim).length ? anim : undefined;
};

/**
 * One action. A trigger this build cannot read is dropped and the rest are kept: an action starts
 * on ANY of its triggers, so losing one only narrows when it plays. When none is left the action
 * is kept with no `when`: nothing starts it, and it still stands in for the actions that name it
 * as their `fallback`.
 */
const normalizeAction = (raw: unknown): CharacterAction | undefined => {
	if (!isObject(raw)) return undefined;
	const id = text(raw.id);
	if (!id) return undefined;
	const action: CharacterAction = { id };
	const name = text(raw.name);
	if (name) action.name = name;
	const triggers = normalizeTriggers(raw.when);
	if (triggers.length) action.when = triggers.length === 1 ? triggers[0] : triggers;
	if (includes(CHARACTER_PLAYS, raw.play) && raw.play !== defaultPlay(triggers))
		action.play = raw.play;
	const priority = finite(raw.priority);
	if (priority !== undefined && priority !== defaultPriority(triggers)) action.priority = priority;
	if (raw.interrupt === 'priority' || raw.interrupt === 'none') action.interrupt = raw.interrupt;
	if (raw.again === 'ignore') action.again = 'ignore';
	const anim = normalizeAnim(raw.anim);
	if (anim) action.anim = anim;
	const fallback = text(raw.fallback);
	if (fallback) action.fallback = fallback;
	return action;
};

/** The actions kept, each with the raw entry it was read from; a repeated id keeps the first. */
const readActions = (raw: unknown): { raw: Raw; action: CharacterAction }[] => {
	const kept: { raw: Raw; action: CharacterAction }[] = [];
	for (const entry of Array.isArray(raw) ? raw : []) {
		const action = normalizeAction(entry);
		if (action && !kept.some((k) => k.action.id === action.id))
			kept.push({ raw: entry as Raw, action });
	}
	return kept;
};

/**
 * The sheet of a raw `arcade.characters` entry (or of a bare sheet object), or `undefined` when
 * none of its four fields is usable. Canonical and sparse: ids and names are trimmed, a field at
 * its default is not stored, an empty map or list is dropped, and a field or a value this build
 * does not know is dropped. A `source` that is not frame clips with a prefix is dropped, and so is
 * a `draw` with no positive width. Its own output comes back the same, key for key.
 */
export function normalizeCharacterSheet(raw: unknown): CharacterSheet | undefined {
	if (!isObject(raw)) return undefined;
	const sheet: CharacterSheet = {};
	const view = normalizeView(raw.view);
	if (view) sheet.view = view;
	const source = normalizeSource(raw.source);
	if (source) sheet.source = source;
	const draw = normalizeDraw(raw.draw);
	if (draw) sheet.draw = draw;
	const actions = readActions(raw.actions).map((kept) => kept.action);
	if (actions.length) sheet.actions = actions;
	return Object.keys(sheet).length ? sheet : undefined;
}

const arcadeOf = (rawDoc: unknown): Raw | undefined =>
	isObject(rawDoc) && isObject(rawDoc.arcade) ? rawDoc.arcade : undefined;

type RawCharacter = { id: string; component: string; raw: Raw };

/** The entries of `arcade.characters` the config's normalizer keeps, in its order: one with no id
 *  or no component is dropped, and a repeated id keeps the first. */
const rawCharacters = (rawDoc: unknown): RawCharacter[] => {
	const list = arcadeOf(rawDoc)?.characters;
	const kept: RawCharacter[] = [];
	for (const raw of Array.isArray(list) ? list : []) {
		if (!isObject(raw)) continue;
		const id = text(raw.id);
		const component = text(raw.component);
		if (id && component && !kept.some((k) => k.id === id)) kept.push({ id, component, raw });
	}
	return kept;
};

type RawClass = { id: string; body: string; sheet: string };

/** The entries of `arcade.online.characters` the config's normalizer keeps, in its order: one
 *  with no id, no body or no positive speed is dropped, and a repeated id keeps the first. */
const rawClasses = (rawDoc: unknown): RawClass[] => {
	const online = arcadeOf(rawDoc)?.online;
	const list = isObject(online) ? online.characters : undefined;
	const kept: RawClass[] = [];
	for (const raw of Array.isArray(list) ? list : []) {
		if (!isObject(raw)) continue;
		const id = text(raw.id);
		const body = text(raw.body);
		const speed = finite(raw.speed);
		if (!id || !body || speed === undefined || speed <= 0 || kept.some((k) => k.id === id))
			continue;
		kept.push({ id, body, sheet: text(raw.sheet) });
	}
	return kept;
};

/** The sheet of the character `characterId` in a RAW config (one the normalizer has not been
 *  through, or one the launcher put the sheets back on), or `undefined` when it has none. */
export function characterSheetOf(rawDoc: unknown, characterId: string): CharacterSheet | undefined {
	const character = rawCharacters(rawDoc).find((c) => c.id === characterId.trim());
	return character && normalizeCharacterSheet(character.raw);
}

/**
 * The sheet the online class `classId` names in a RAW config, with the id of the character that
 * holds it. `undefined` unless the class names a character that exists, has a sheet and uses the
 * class's component: such a class plays as one with no sheet.
 */
export function onlineClassSheetOf(
	rawDoc: unknown,
	classId: string,
): { id: string; sheet: CharacterSheet } | undefined {
	const cls = rawClasses(rawDoc).find((c) => c.id === classId.trim());
	if (!cls?.sheet) return undefined;
	const character = rawCharacters(rawDoc).find((c) => c.id === cls.sheet);
	if (!character || character.component !== cls.body) return undefined;
	const sheet = normalizeCharacterSheet(character.raw);
	return sheet && { id: character.id, sheet };
}

/**
 * The clips a RAW config's sheets name, for the ship chain (rule 8): every sheet's prefix and its
 * variants' prefixes (each ships every clip named `<prefix>_…`), and every clip an `anim` cell
 * names. Read from every character with frame clips, whether or not a class names it. Distinct, in
 * authored order; both empty for a config with no sheet.
 */
export function characterSheetClipRoots(rawDoc: unknown): {
	prefixes: string[];
	clipIds: string[];
} {
	const prefixes: string[] = [];
	const clipIds: string[] = [];
	const add = (list: string[], value: string) => {
		if (!list.includes(value)) list.push(value);
	};
	for (const character of rawCharacters(rawDoc)) {
		const sheet = normalizeCharacterSheet(character.raw);
		if (!sheet?.source) continue;
		add(prefixes, sheet.source.prefix);
		for (const prefix of Object.values(sheet.source.variants ?? {})) add(prefixes, prefix);
		for (const action of sheet.actions ?? [])
			for (const cell of Object.values(action.anim ?? {})) add(clipIds, cell.clip);
	}
	return { prefixes, clipIds };
}

const withoutSheet = (entry: Raw): Raw => {
	const out: Raw = {};
	for (const [key, value] of Object.entries(entry))
		if (!(CHARACTER_SHEET_FIELDS as readonly string[]).includes(key)) out[key] = value;
	return out;
};

/** `list` with each entry of an id in `byId` replaced by what `put` makes of it; `list` itself
 *  when no entry is. */
const putById = <V>(list: unknown, byId: Map<string, V>, put: (entry: Raw, value: V) => Raw) => {
	if (!Array.isArray(list) || !byId.size) return list;
	let changed = false;
	const out = list.map((entry: unknown) => {
		const value = isObject(entry) ? byId.get(text(entry.id)) : undefined;
		if (!isObject(entry) || value === undefined) return entry;
		changed = true;
		return put(entry, value);
	});
	return changed ? out : list;
};

/**
 * The launcher's carry: the NORMALIZED config `doc` with the sheets of `rawDoc` put back. Each raw
 * character's normalized sheet goes on the character of the same id, after its other fields, and
 * each raw class's `sheet` on the class of the same id. An entry the normalizer dropped gets
 * nothing. Returns `doc` itself when there is nothing to put back, so a config with no sheet is
 * untouched; neither argument is changed.
 */
export function withCharacterSheets<T>(doc: T, rawDoc: unknown): T {
	const arcade = arcadeOf(doc);
	if (!arcade) return doc;
	const sheets = new Map<string, CharacterSheet>();
	for (const character of rawCharacters(rawDoc)) {
		const sheet = normalizeCharacterSheet(character.raw);
		if (sheet) sheets.set(character.id, sheet);
	}
	const named = new Map<string, string>();
	for (const cls of rawClasses(rawDoc)) if (cls.sheet) named.set(cls.id, cls.sheet);
	const characters = putById(arcade.characters, sheets, (entry, sheet) => ({
		...withoutSheet(entry),
		...sheet,
	}));
	const online = isObject(arcade.online) ? arcade.online : undefined;
	const classes = putById(online?.characters, named, (entry, sheet) => ({ ...entry, sheet }));
	if (characters === arcade.characters && classes === online?.characters) return doc;
	const out: Raw = { ...arcade };
	if (characters !== arcade.characters) out.characters = characters;
	if (online && classes !== online.characters) out.online = { ...online, characters: classes };
	return { ...(doc as Raw), arcade: out } as T;
}

const quoted = (ids: string[]): string => ids.map((id) => `"${id}"`).join(' and ');

/**
 * What is wrong with a RAW config's sheets, for a save: `validateGameConfigDoc` does not know
 * them. Paths count the entries the normalizer keeps, so they point into the normalized doc. An
 * error is a sheet that could not be drawn as authored; a warning is one that plays but not as it
 * reads. `context.projection` is the projection of the screen the characters are drawn on, when
 * the caller knows it.
 *
 * Not checked: a view left out (it is drawn in the four isometric diagonals, as before the
 * sheet), a `fallback` loop (two actions may stand in for each other), and the names of statuses
 * and events, which a rules module may add.
 */
export function validateCharacterSheets(
	rawDoc: unknown,
	context: { projection?: 'isometric' | 'flat' } = {},
): GameConfigIssue[] {
	const issues: GameConfigIssue[] = [];
	const error = (path: string, message: string) =>
		issues.push({ severity: 'error', path, message });
	const warn = (path: string, message: string) =>
		issues.push({ severity: 'warning', path, message });
	const characters = rawCharacters(rawDoc);
	const has3dWorld = arcadeOf(rawDoc)?.world3d !== undefined;

	rawClasses(rawDoc).forEach((cls, index) => {
		if (!cls.sheet) return;
		const path = `arcade.online.characters[${index}].sheet`;
		const character = characters.find((c) => c.id === cls.sheet);
		if (!character) return error(path, `No character is "${cls.sheet}".`);
		if (!normalizeCharacterSheet(character.raw))
			error(
				path,
				`The character "${cls.sheet}" has no view, animation source, draw box or actions, so it is not a sheet.`,
			);
		if (character.component !== cls.body)
			error(
				path,
				`The character "${cls.sheet}" is drawn as "${character.component}", but "${cls.id}" is the body "${cls.body}": a class and its sheet use the same component.`,
			);
	});

	characters.forEach((character, index) => {
		const at = `arcade.characters[${index}]`;
		const sheet = normalizeCharacterSheet(character.raw);
		if (!sheet) return;
		const view = sheet.view?.kind;
		if (view === 'isometric' && context.projection === 'flat')
			warn(
				`${at}.view`,
				'An isometric view on a flat screen: its facings will not match how it moves.',
			);
		if ((view === 'topDown' || view === 'side') && context.projection === 'isometric')
			warn(
				`${at}.view`,
				`A ${view === 'side' ? 'side' : 'top-down'} view on an isometric screen: its facings will not match how it moves.`,
			);
		if (view === '3d' && !has3dWorld)
			warn(`${at}.view`, 'A 3D view, but the game has no 3D world (arcade.world3d).');
		const controller = isObject(character.raw.controller) ? character.raw.controller.kind : '';
		if (view === 'side' && controller === 'topDown')
			warn(
				`${at}.view`,
				'A side view under a top-down controller: it faces only left or right while it moves up and down.',
			);
		if (sheet.source && view === '3d')
			warn(`${at}.source`, 'A 3D view has no facings, so its frame clips are not drawn.');
		if (sheet.source && !sheet.draw)
			error(`${at}.draw`, 'Frame clips need a width to be drawn at: give the draw box a width.');
		if (sheet.source && !sheet.actions)
			error(`${at}.actions`, 'The character has frame clips but no action, so nothing is drawn.');

		const kept = readActions(character.raw.actions);
		const ids = kept.map((k) => k.action.id);
		kept.forEach(({ raw, action }, i) => {
			const path = `${at}.actions[${i}]`;
			if (action.fallback === action.id)
				warn(
					`${path}.fallback`,
					`The action "${action.id}" stands in for itself, which does nothing.`,
				);
			else if (action.fallback && !ids.includes(action.fallback))
				warn(
					`${path}.fallback`,
					`No action is "${action.fallback}", so nothing stands in for "${action.id}".`,
				);
			const authored = rawTriggers(raw.when);
			const read = authored.filter((trigger) => normalizeTrigger(trigger)).length;
			if (authored.length && !read)
				warn(
					`${path}.when`,
					`The trigger of "${action.id}" is not one this build knows, so nothing starts it.`,
				);
			else if (read < authored.length)
				warn(
					`${path}.when`,
					`A trigger of "${action.id}" is not one this build knows, so it does not start it.`,
				);
			if (characterActionPlay(action) !== 'loop') return;
			const first = kept
				.slice(0, i)
				.find(
					({ action: other }) =>
						characterActionPlay(other) === 'loop' &&
						characterActionPriority(other) === characterActionPriority(action) &&
						characterTriggers(other).some((a) =>
							characterTriggers(action).some((b) => sameTrigger(a, b)),
						),
				);
			if (first)
				warn(
					path,
					`${quoted([first.action.id, action.id])} loop on the same trigger at the same priority, so only "${first.action.id}" plays.`,
				);
		});
		const stands = kept.some(({ action }) =>
			characterTriggers(action).some((t) => 'motion' in t && t.motion === 'still'),
		);
		if (sheet.source && kept.length && !stands)
			warn(
				`${at}.actions`,
				'No action starts when the character is still (motion: still), so nothing is drawn while it stands.',
			);
	});
	return issues;
}

/** The lasting words of the validator's warning that an online game has a character no bot plays
 *  (`familyValidate.ts`, at `arcade.characters`). `check:game-config-family` holds the two equal. */
export const UNPLAYED_CHARACTER_WARNING = 'a character no bot plays does not run in a room';

/**
 * `issues` without the validator's "a character no bot plays does not run in a room" warning,
 * when every such character of `rawDoc` is the sheet of an online class: a sheet is drawn by its
 * class, so it need not run. Otherwise `issues` itself. `rawDoc` is the config the issues were
 * made from, with its sheets on.
 */
export function sheetAwareIssues(issues: GameConfigIssue[], rawDoc: unknown): GameConfigIssue[] {
	const isWarning = (issue: GameConfigIssue) =>
		issue.severity === 'warning' &&
		issue.path === 'arcade.characters' &&
		issue.message.includes(UNPLAYED_CHARACTER_WARNING);
	if (!issues.some(isWarning)) return issues;
	const online = arcadeOf(rawDoc)?.online;
	const bots = isObject(online) && isObject(online.bots) ? online.bots.characters : undefined;
	const played = (Array.isArray(bots) ? bots : []).map((bot) =>
		isObject(bot) ? text(bot.brain) : '',
	);
	const sheets = rawClasses(rawDoc).map((cls) => cls.sheet);
	const unplayed = rawCharacters(rawDoc).filter((c) => !played.includes(c.id));
	return unplayed.every((c) => sheets.includes(c.id))
		? issues.filter((issue) => !isWarning(issue))
		: issues;
}
