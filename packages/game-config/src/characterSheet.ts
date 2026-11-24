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
			/** Absent ⇒ the picture changes at once when the facing does. */
			turn?: CharacterTurn;
	  }
	| { kind: '3d' };

/**
 * A smooth turn between the facings of a view of four or eight. Three things, each its own field:
 *
 * - the BLEND: when the picture drawn changes with the facing, the picture it leaves and the one
 *   it takes are mixed for `blend` ms, the walk carried on where it was, so the directions merge
 *   as they are drawn;
 * - the SWEEP: the character's drawn heading follows where it moves at `speed`, and its picture is
 *   the facing that heading is in, so an about-turn is drawn through the facings in between;
 * - the LEAN: the picture is rotated, about its `pivot`, by how far the heading is from its
 *   facing's middle. That is how a subject SEEN FROM ABOVE turns; an upright character seen from
 *   the side or in three-quarter view turns about its own height, and a rotation of its picture
 *   tips it over. So an isometric view has none unless the sheet asks for some.
 *
 * It is how the character is drawn only: nothing of how it moves reads it. `{}` is the option on
 * at its defaults. A side view has two facings and a `3d` one none, so neither has it.
 */
export type CharacterTurn = {
	/** How long two pictures are mixed when the facing drawn changes, ms; 0 ⇒ the picture changes
	 *  at once. Absent ⇒ {@link CHARACTER_TURN_BLEND}. */
	blend?: number;
	/** The most the picture leans from its facing, degrees: 0 to half the angle between two
	 *  facings (22.5 of eight, 45 of four). Absent ⇒ that half for a top-down view, and none for
	 *  an isometric one ({@link characterTurnLean}). */
	lean?: number;
	/** What the lean turns the picture about: the middle of its box, or its feet (the character's
	 *  place). Absent ⇒ the middle. */
	pivot?: CharacterTurnPivot;
	/** How fast the drawn heading follows, degrees a second; 0 ⇒ at once. Absent
	 *  ⇒ {@link CHARACTER_TURN_SPEED}. */
	speed?: number;
};

export const CHARACTER_TURN_PIVOTS = ['middle', 'feet'] as const;
export type CharacterTurnPivot = (typeof CHARACTER_TURN_PIVOTS)[number];

/** A smooth turn's `speed` when it names none, and the most it can be, degrees a second. */
export const CHARACTER_TURN_SPEED = 360;
export const CHARACTER_TURN_SPEED_MAX = 3600;

/** A smooth turn's `blend` when it names none, and the most it can be, ms. */
export const CHARACTER_TURN_BLEND = 160;
export const CHARACTER_TURN_BLEND_MAX = 1000;

/** The angle between two facings of a view that can turn smoothly, degrees. */
export const characterTurnSector = (view: { facings?: 8 }): number =>
	view.facings === 8 ? 45 : 90;

/** A view's `lean` when its turn names none, degrees: half the angle between two facings seen
 *  from above (where both pictures then point the same way as one becomes the other), and none
 *  for an isometric view, whose upright character a lean would tip over. */
export const characterTurnLean = (view: { kind: 'topDown' | 'isometric'; facings?: 8 }): number =>
	view.kind === 'isometric' ? 0 : characterTurnSector(view) / 2;

/**
 * A view's smooth turn as it is drawn, defaults filled in (degrees, degrees a second and ms), or
 * `undefined` for a view with none.
 */
export function characterTurnOf(view: CharacterView | undefined):
	| {
			blend: number;
			lean: number;
			pivot: CharacterTurnPivot;
			speed: number;
			sector: number;
	  }
	| undefined {
	if (!view || view.kind === 'side' || view.kind === '3d' || !view.turn) return undefined;
	return {
		blend: view.turn.blend ?? CHARACTER_TURN_BLEND,
		lean: view.turn.lean ?? characterTurnLean(view),
		pivot: view.turn.pivot ?? 'middle',
		speed: view.turn.speed ?? CHARACTER_TURN_SPEED,
		sector: characterTurnSector(view),
	};
}

/**
 * Frame clips (Invisible Flipbook). A cell left empty is the clip `<prefix>_<action>_<facing>`; a
 * cell may name another clip, or a still image ({@link CharacterStill}).
 */
export type CharacterClipSource = {
	kind: 'clips';
	/** Its clips are named `<prefix>_<action>_<facing>`. */
	prefix: string;
	/** A second art set, tried first while the status of its key holds (`marked`: Salmons' golden
	 *  salmon), by status name. */
	variants?: Record<string, string>;
};

/**
 * A rig (`.irig`, Invisible Rigger), named as a rig node names it: by its bundle name. `rig` is
 * the one rig of every facing: an animation named for a facing (`<action>_<facing>`) is drawn as
 * made, and one named for the action alone (`<action>`) is drawn mirrored in the facings that
 * look west. `rigs` is a rig per drawn facing (front and back), each stood in for as a clip is. A
 * cell may name the animation, and another rig.
 */
export type CharacterRigSource = {
	kind: 'rig';
	rig?: string;
	rigs?: Partial<Record<CharacterFacing, string>>;
	/** A skin worn while the status of its key holds, by status name: the first that holds and
	 *  that the rig has. */
	variants?: Record<string, string>;
};

/** Still images only: every cell names its image, and nothing is found by name. */
export type CharacterStillSource = { kind: 'stills' };

/**
 * Where the animations come from. A character with no `source` keeps its component's own state
 * machine. A source of a kind this build does not know is not read, and the character plays as
 * one with no sheet.
 */
export type CharacterSource = CharacterClipSource | CharacterRigSource | CharacterStillSource;

/** One image of a project sheet, named as a sprite node names it: the sheet's manifest key and
 *  the frame in it. */
export type CharacterStill = { assetKey: string; region: string };

/**
 * What an action draws in one facing: a clip, a still image (both for a `clips` source, the still
 * for a `stills` one too), or a rig's animation (`rig` when it is not the facing's own).
 */
export type CharacterCell =
	| { clip: string; still?: undefined; anim?: undefined; rig?: undefined }
	| { still: CharacterStill; clip?: undefined; anim?: undefined; rig?: undefined }
	| { anim: string; rig?: string; clip?: undefined; still?: undefined };

/** The box the art is drawn in. */
export type CharacterDraw = {
	/** How wide the art's Bounds box is drawn, world px. */
	width: number;
	/** Where the ground is down the box, 0 (top) to 1 (bottom). Absent ⇒ 1. */
	feet?: number;
	/** Named points across and down the box (0 to 1), mirrored with the art: `hand` is where a held
	 *  line starts. */
	points?: Record<string, { x: number; y: number }>;
	/** A point that follows a bone of a rig, by point name: read before `points`. */
	bones?: Record<string, string>;
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

export const CHARACTER_PLAYS = ['loop', 'once', 'hold'] as const;
export type CharacterPlay = (typeof CHARACTER_PLAYS)[number];

/** One thing the character can do. */
export type CharacterAction = {
	/** Unique in the sheet: the `<action>` of the clip name rule. */
	id: string;
	name?: string;
	/** Absent ⇒ nothing starts it: it only stands in for another action (`fallback`). */
	when?: CharacterTrigger | CharacterTrigger[];
	/** Absent ⇒ `once` when an ability or an event starts it, else `loop`. `hold`: played once,
	 *  then on its last frame for as long as it is in force (a status trigger while it holds; an
	 *  ability or an event until another once cuts it). Never a default. */
	play?: CharacterPlay;
	/** Of the actions whose trigger holds, the highest plays. Absent ⇒ 3 for an ability or an
	 *  event, 2 for a status, 1 for a motion. */
	priority?: number;
	/** What may cut it while it plays `once`: absent ⇒ any other `once`; `priority` ⇒ only one of
	 *  the same priority or higher; `none` ⇒ nothing. A loop never cuts a `once`. */
	interrupt?: 'priority' | 'none';
	/** Started again while it plays: absent ⇒ it restarts; `ignore` ⇒ it plays on. */
	again?: 'ignore';
	/** Per facing, what is drawn. A facing left out is found by name. */
	anim?: Partial<Record<CharacterFacing, CharacterCell>>;
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

/**
 * How much of a sheet is read: the first of each, as authored. A device reads the sheet off the
 * config it is sent, so a config with more must not cost it more.
 */
export const CHARACTER_SHEET_LIMITS = {
	actions: 64,
	/** Per action. */
	triggers: 8,
	variants: 8,
	points: 16,
} as const;

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

/** A sheet of frame clips this build can play: a width to draw them at, and an action. */
export type ClipSheet = CharacterSheet & {
	source: CharacterClipSource;
	draw: CharacterDraw;
	actions: CharacterAction[];
};

export const isClipSheet = (sheet: CharacterSheet | undefined): sheet is ClipSheet =>
	sheet?.source?.kind === 'clips' && !!sheet.draw && !!sheet.actions?.length;

/** A smooth turn: a `lean` held in 0 to half the sector, a `speed` and a `blend` in 0 to their
 *  most and a `pivot` of the list, each kept only when it is not the default. Anything but an
 *  object is no turn. */
const normalizeTurn = (
	raw: unknown,
	view: { kind: 'topDown' | 'isometric'; facings?: 8 },
): CharacterTurn | undefined => {
	if (!isObject(raw)) return undefined;
	const turn: CharacterTurn = {};
	const blend = finite(raw.blend);
	if (blend !== undefined && blend !== CHARACTER_TURN_BLEND)
		turn.blend = Math.min(Math.max(blend, 0), CHARACTER_TURN_BLEND_MAX);
	const lean = finite(raw.lean);
	if (lean !== undefined) {
		const held = Math.min(Math.max(lean, 0), characterTurnSector(view) / 2);
		if (held !== characterTurnLean(view)) turn.lean = held;
	}
	if (raw.pivot === 'feet') turn.pivot = 'feet';
	const speed = finite(raw.speed);
	if (speed !== undefined && speed !== CHARACTER_TURN_SPEED)
		turn.speed = Math.min(Math.max(speed, 0), CHARACTER_TURN_SPEED_MAX);
	return turn;
};

const normalizeView = (raw: unknown): CharacterView | undefined => {
	if (!isObject(raw) || !includes(CHARACTER_VIEW_KINDS, raw.kind)) return undefined;
	if (raw.kind === '3d') return { kind: '3d' };
	if (raw.kind === 'side')
		return raw.mirror === false ? { kind: 'side', mirror: false } : { kind: 'side' };
	const view: CharacterView = { kind: raw.kind };
	if (raw.facings === 8) view.facings = 8;
	if (raw.mirror === false) view.mirror = false;
	const turn = normalizeTurn(raw.turn, view);
	if (turn) view.turn = turn;
	return view;
};

/** A map of names to names: trimmed, the first of a repeated key, at most `max`. */
const normalizeNames = (raw: unknown, max: number): Record<string, string> | undefined => {
	const names: Record<string, string> = {};
	for (const [key, value] of Object.entries(isObject(raw) ? raw : {})) {
		const name = key.trim();
		const named = text(value);
		if (!name || !named || name === '__proto__' || Object.hasOwn(names, name)) continue;
		names[name] = named;
		if (Object.keys(names).length === max) break;
	}
	return Object.keys(names).length ? names : undefined;
};

const normalizeRigSource = (raw: Raw): CharacterRigSource | undefined => {
	const source: CharacterRigSource = { kind: 'rig' };
	const rig = text(raw.rig);
	if (rig) source.rig = rig;
	const rigs: NonNullable<CharacterRigSource['rigs']> = {};
	for (const facing of CHARACTER_FACINGS) {
		const named = isObject(raw.rigs) ? text(raw.rigs[facing]) : '';
		if (named) rigs[facing] = named;
	}
	if (Object.keys(rigs).length) source.rigs = rigs;
	if (!source.rig && !source.rigs) return undefined;
	const variants = normalizeNames(raw.variants, CHARACTER_SHEET_LIMITS.variants);
	if (variants) source.variants = variants;
	return source;
};

const normalizeSource = (raw: unknown): CharacterSource | undefined => {
	if (!isObject(raw)) return undefined;
	if (raw.kind === 'rig') return normalizeRigSource(raw);
	if (raw.kind === 'stills') return { kind: 'stills' };
	if (raw.kind !== 'clips') return undefined;
	const prefix = text(raw.prefix);
	if (!prefix) return undefined;
	const source: CharacterSource = { kind: 'clips', prefix };
	const variants = normalizeNames(raw.variants, CHARACTER_SHEET_LIMITS.variants);
	if (variants) source.variants = variants;
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
		if (!name || x === undefined || y === undefined) continue;
		if (name === '__proto__' || Object.hasOwn(points, name)) continue;
		points[name] = { x, y };
		if (Object.keys(points).length === CHARACTER_SHEET_LIMITS.points) break;
	}
	if (Object.keys(points).length) draw.points = points;
	const bones = normalizeNames(raw.bones, CHARACTER_SHEET_LIMITS.points);
	if (bones) draw.bones = bones;
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
		if (!trigger || triggers.some((kept) => sameTrigger(kept, trigger))) continue;
		triggers.push(trigger);
		if (triggers.length === CHARACTER_SHEET_LIMITS.triggers) break;
	}
	return triggers;
};

/** One cell, read by the first of `clip`, `still`, `anim` it has. A still needs its sheet and its
 *  frame, and a rig's cell its animation. */
const normalizeCell = (raw: unknown): CharacterCell | undefined => {
	if (!isObject(raw)) return undefined;
	const clip = text(raw.clip);
	if (clip) return { clip };
	if (isObject(raw.still)) {
		const assetKey = text(raw.still.assetKey);
		const region = text(raw.still.region);
		return assetKey && region ? { still: { assetKey, region } } : undefined;
	}
	const anim = text(raw.anim);
	if (!anim) return undefined;
	const rig = text(raw.rig);
	return rig ? { anim, rig } : { anim };
};

const normalizeAnim = (raw: unknown): CharacterAction['anim'] => {
	if (!isObject(raw)) return undefined;
	const anim: NonNullable<CharacterAction['anim']> = {};
	for (const facing of CHARACTER_FACINGS) {
		const cell = normalizeCell(raw[facing]);
		if (cell) anim[facing] = cell;
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

/** The actions kept, each with the raw entry it was read from: a repeated id keeps the first, and
 *  no more than {@link CHARACTER_SHEET_LIMITS} `actions` are read. */
const readActions = (raw: unknown): { raw: Raw; action: CharacterAction }[] => {
	const kept: { raw: Raw; action: CharacterAction }[] = [];
	const ids = new Set<string>();
	for (const entry of Array.isArray(raw) ? raw : []) {
		const action = normalizeAction(entry);
		if (!action || ids.has(action.id)) continue;
		ids.add(action.id);
		kept.push({ raw: entry as Raw, action });
		if (kept.length === CHARACTER_SHEET_LIMITS.actions) break;
	}
	return kept;
};

/**
 * The sheet of a raw `arcade.characters` entry (or of a bare sheet object), or `undefined` when
 * none of its four fields is usable. Canonical and sparse: ids and names are trimmed, a field at
 * its default is not stored, an empty map or list is dropped, and a field or a value this build
 * does not know is dropped. A `source` that is not frame clips with a prefix, a rig that names a
 * rig, or still images is dropped, and so is a `draw` with no positive width. No more than
 * {@link CHARACTER_SHEET_LIMITS} of its actions, an
 * action's triggers, its variants and its points are kept: the first, as authored. Its own output
 * comes back the same, key for key.
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
		const source = sheet?.source;
		if (!sheet || !source || source.kind === 'rig') continue;
		if (source.kind === 'clips') {
			add(prefixes, source.prefix);
			for (const prefix of Object.values(source.variants ?? {})) add(prefixes, prefix);
		}
		for (const action of sheet.actions ?? [])
			for (const cell of Object.values(action.anim ?? {})) if (cell.clip) add(clipIds, cell.clip);
	}
	return { prefixes, clipIds };
}

/**
 * The rigs a RAW config's sheets name, for the ship chain (rule 8), by bundle name: every rig
 * source's `rig` and `rigs`, and the rig a cell of its names. Distinct, in authored order; empty
 * for a config with no rig on a sheet.
 */
export function characterSheetRigRoots(rawDoc: unknown): string[] {
	const rigs: string[] = [];
	const add = (rig: string | undefined) => {
		if (rig && !rigs.includes(rig)) rigs.push(rig);
	};
	for (const character of rawCharacters(rawDoc)) {
		const sheet = normalizeCharacterSheet(character.raw);
		const source = sheet?.source;
		if (!sheet || source?.kind !== 'rig') continue;
		add(source.rig);
		for (const rig of Object.values(source.rigs ?? {})) add(rig);
		for (const action of sheet.actions ?? [])
			for (const cell of Object.values(action.anim ?? {})) add(cell.rig);
	}
	return rigs;
}

/**
 * The still images a RAW config's sheets name, for the ship chain (rule 8): the image of every
 * still cell of a sheet of frame clips or of still images. Distinct, in authored order; empty for
 * a config with no still on a sheet.
 */
export function characterSheetStillRoots(rawDoc: unknown): CharacterStill[] {
	const stills: CharacterStill[] = [];
	for (const character of rawCharacters(rawDoc)) {
		const sheet = normalizeCharacterSheet(character.raw);
		const kind = sheet?.source?.kind;
		if (!sheet || (kind !== 'clips' && kind !== 'stills')) continue;
		for (const action of sheet.actions ?? [])
			for (const { still } of Object.values(action.anim ?? {}))
				if (
					still &&
					!stills.some((s) => s.assetKey === still.assetKey && s.region === still.region)
				)
					stills.push(still);
	}
	return stills;
}

/**
 * The art a RAW config's sheets name, as the names a published bundle lists it by
 * (`characterArt`): each rig's bundle name, and each still image as `<assetKey>::<region>`, the
 * scoped name its frame is registered under. The game config is read by the runtime only after
 * the normalizer, which drops a sheet, so without this list the boot would leave the rig and the
 * sheet unloaded as art nothing names (`apps/lines` `stockAssets.ts`). Empty for a config with no
 * rig and no still on a sheet.
 */
export function characterSheetArtNames(rawDoc: unknown): string[] {
	return [
		...characterSheetRigRoots(rawDoc),
		...characterSheetStillRoots(rawDoc).map((still) => `${still.assetKey}::${still.region}`),
	];
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
 * error is a source that could not be drawn at all (no width, no action, a rig source that names
 * no rig, still images with no image); a warning is a
 * sheet that plays but not as it reads, and a class whose `sheet` cannot be used, which is drawn
 * as it was before the sheet (so a renamed or removed character never stops a save). `context.projection` is the projection of the screen the characters are drawn on, when
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
		const asBefore = `so "${cls.id}" is drawn as it was before`;
		const character = characters.find((c) => c.id === cls.sheet);
		if (!character) return warn(path, `No character is "${cls.sheet}", ${asBefore}.`);
		const sheet = normalizeCharacterSheet(character.raw);
		if (character.component !== cls.body)
			warn(
				path,
				`The character "${cls.sheet}" is drawn as "${character.component}", but "${cls.id}" is the body "${cls.body}": a class and its sheet use the same component, ${asBefore}.`,
			);
		else if (!sheet)
			warn(
				path,
				`The character "${cls.sheet}" has no view, animation source, draw box or actions, ${asBefore}.`,
			);
		else if (!sheet.source && sheet.view?.kind !== '3d')
			warn(
				path,
				`The sheet of "${cls.sheet}" has no frame clips, so "${cls.id}" plays the clips it did before.`,
			);
	});

	characters.forEach((character, index) => {
		const at = `arcade.characters[${index}]`;
		const sheet = normalizeCharacterSheet(character.raw);
		const rawSource = isObject(character.raw.source) ? character.raw.source : undefined;
		if (rawSource?.kind === 'rig' && !sheet?.source)
			error(`${at}.source`, 'A rig source names no rig: give it a rig, or a rig per facing.');
		if (!sheet) return;
		const view = sheet.view?.kind;
		const kind = sheet.source?.kind;
		const art =
			kind === 'rig'
				? { needs: 'A rig needs', has: 'a rig', not: 'rig is' }
				: kind === 'stills'
					? { needs: 'Still images need', has: 'still images', not: 'still images are' }
					: { needs: 'Frame clips need', has: 'frame clips', not: 'frame clips are' };
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
		const rawView = isObject(character.raw.view) ? character.raw.view : undefined;
		const rawTurn = rawView?.turn;
		if (rawTurn !== undefined && rawTurn !== null) {
			const path = `${at}.view.turn`;
			if (view === 'side')
				warn(path, 'A side view has two facings and nothing to turn through: this is not read.');
			else if (view === '3d')
				warn(path, 'A 3D view has no facings (the body turns the model): this is not read.');
			else if (!isObject(rawTurn))
				warn(
					path,
					'A smooth turn is its blend, its speed, its lean and its pivot: this is not read.',
				);
			else if (sheet.view) {
				const half = characterTurnSector(sheet.view) / 2;
				const read = characterTurnOf(sheet.view);
				const outside = (value: unknown, most: number): boolean => {
					const n = finite(value);
					return value !== undefined && (n === undefined || n < 0 || n > most);
				};
				if (outside(rawTurn.lean, half))
					warn(
						`${path}.lean`,
						`The lean is 0 to ${half} degrees (half the angle between two facings): it is read as ${read?.lean}.`,
					);
				if (outside(rawTurn.blend, CHARACTER_TURN_BLEND_MAX))
					warn(
						`${path}.blend`,
						`The blend is 0 to ${CHARACTER_TURN_BLEND_MAX} ms: it is read as ${read?.blend}.`,
					);
				if (rawTurn.pivot !== undefined && !includes(CHARACTER_TURN_PIVOTS, rawTurn.pivot))
					warn(
						`${path}.pivot`,
						`The lean turns the picture about its ${CHARACTER_TURN_PIVOTS.join(' or its ')}: this is read as ${read?.pivot}.`,
					);
				if (outside(rawTurn.speed, CHARACTER_TURN_SPEED_MAX))
					warn(
						`${path}.speed`,
						`The turn speed is 0 to ${CHARACTER_TURN_SPEED_MAX} degrees a second: it is read as ${read?.speed}.`,
					);
			}
		}
		const controller = isObject(character.raw.controller) ? character.raw.controller.kind : '';
		if (view === 'side' && controller === 'topDown')
			warn(
				`${at}.view`,
				'A side view under a top-down controller: it faces only left or right while it moves up and down.',
			);
		if (sheet.source && view === '3d')
			warn(`${at}.source`, `A 3D view has no facings, so its ${art.not} not drawn.`);
		if (sheet.source && !sheet.draw)
			error(`${at}.draw`, `${art.needs} a width to be drawn at: give the draw box a width.`);
		if (sheet.source && !sheet.actions)
			error(`${at}.actions`, `The character has ${art.has} but no action, so nothing is drawn.`);
		if (sheet.source?.kind === 'rig' && sheet.view) {
			const drawn = characterViewFacings(sheet.view);
			for (const facing of Object.keys(sheet.source.rigs ?? {}))
				if (!(drawn as readonly string[]).includes(facing))
					warn(
						`${at}.source.rigs.${facing}`,
						`The view has no facing "${facing}", so its rig is never drawn.`,
					);
		}
		if (sheet.draw?.bones && kind !== 'rig' && rawSource?.kind !== 'rig')
			warn(`${at}.draw.bones`, 'A point follows a bone only on a rig: these are not read.');
		if (
			kind === 'stills' &&
			sheet.actions &&
			!sheet.actions.some((action) => Object.values(action.anim ?? {}).some((cell) => cell.still))
		)
			error(`${at}.actions`, 'Still images, but no action names an image, so nothing is drawn.');

		const L = CHARACTER_SHEET_LIMITS;
		const over = (path: string, count: number, max: number, what: string, lost: string) => {
			if (count > max) warn(path, `A sheet reads at most ${max} ${what}; the rest are ${lost}.`);
		};
		const count = (v: unknown) => (isObject(v) ? Object.keys(v).length : 0);
		const authoredActions = Array.isArray(character.raw.actions) ? character.raw.actions : [];
		over(`${at}.actions`, authoredActions.length, L.actions, 'actions', 'not played');
		if (isObject(character.raw.source))
			over(
				`${at}.source.variants`,
				count(character.raw.source.variants),
				L.variants,
				'variants',
				'not drawn',
			);
		if (isObject(character.raw.draw)) {
			over(`${at}.draw.points`, count(character.raw.draw.points), L.points, 'points', 'not read');
			over(`${at}.draw.bones`, count(character.raw.draw.bones), L.points, 'bones', 'not read');
		}

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
			for (const facing of CHARACTER_FACINGS) {
				const cellPath = `${path}.anim.${facing}`;
				const rawCell = isObject(raw.anim) ? raw.anim[facing] : undefined;
				const cell = action.anim?.[facing];
				if (rawCell !== undefined && !cell) {
					const still = isObject(rawCell) && isObject(rawCell.still);
					const rig = isObject(rawCell) && text(rawCell.rig) !== '';
					warn(
						cellPath,
						still
							? 'A still image needs its sheet (assetKey) and its frame (region): this one is not drawn.'
							: rig
								? 'The cell names a rig but no animation, so it is found by name.'
								: 'The cell names no clip, still image or animation this build knows, so it is found by name.',
					);
				}
				if (!cell || !kind) continue;
				if (
					cell.still &&
					!(cell.still.assetKey.includes('/') && cell.still.assetKey.endsWith('.json'))
				)
					warn(
						cellPath,
						'A still image names its sheet by its manifest key (…/manifests/atlas_manifest_<name>.json): this one cannot ship.',
					);
				const fits =
					kind === 'rig'
						? !!cell.anim
						: kind === 'stills'
							? !!cell.still
							: !!cell.clip || !!cell.still;
				if (!fits)
					warn(
						cellPath,
						kind === 'rig'
							? 'The source is a rig, so a clip or a still image is not drawn: the animation is found by name.'
							: kind === 'stills'
								? 'The source is still images, so only a still image is drawn here.'
								: 'The source is frame clips, so a rig animation is not drawn: the clip is found by name.',
					);
			}
			const authored = rawTriggers(raw.when);
			if (authored.length > L.triggers)
				warn(
					`${path}.when`,
					`An action reads at most ${L.triggers} triggers; the rest do not start "${action.id}".`,
				);
			const read = authored.filter((trigger) => normalizeTrigger(trigger)).length;
			if (authored.length > L.triggers) return;
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
			const play = characterActionPlay(action);
			if (play === 'hold' && characterTriggers(action).some(startsOnce)) {
				const cut = kept.some(
					({ action: other }) =>
						other.id !== action.id &&
						characterTriggers(other).some(startsOnce) &&
						(action.interrupt === undefined ||
							(action.interrupt === 'priority' &&
								characterActionPriority(other) >= characterActionPriority(action))),
				);
				if (!cut)
					warn(
						`${path}.play`,
						`No other action played once may cut "${action.id}", so once an ability or an event starts it, it stays on its last frame until the character is drawn afresh.`,
					);
			}
			if (play === 'once') return;
			const first = kept
				.slice(0, i)
				.find(
					({ action: other }) =>
						characterActionPlay(other) !== 'once' &&
						characterActionPriority(other) === characterActionPriority(action) &&
						characterTriggers(other).some((a) =>
							characterTriggers(action).some((b) => sameTrigger(a, b)),
						),
				);
			if (first)
				warn(
					path,
					play === 'loop' && characterActionPlay(first.action) === 'loop'
						? `${quoted([first.action.id, action.id])} loop on the same trigger at the same priority, so only "${first.action.id}" plays.`
						: `${quoted([first.action.id, action.id])} are drawn on the same trigger at the same priority, so only "${first.action.id}" plays.`,
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
