/**
 * TOUCH CONTROL SCHEMES (`docs/design/arcade-touch-controls.md`): what a finger's hold, tap and
 * drag do for an online character, as data. `arcade.online.touch` holds the project's named
 * schemes and names one per online class, so two classes that name the same scheme share it. The
 * device plays it with `engine-mechanics` `touchControl.js`; the room never reads it.
 *
 * It refines `arcade.online.pointer` (mouse and touch on, the tap button of each class): a class
 * with no scheme, and the mouse always, play as that block alone says. SPARSE: an absent field is
 * its default ({@link ARCADE_TOUCH_DEFAULTS}; `deadZone` and `tapPx` default to the pointer
 * block's).
 *
 * CARRIED, NOT NORMALIZED, as the character sheets are (`characterSheet.ts`): the slot, match-3
 * and card bundles keep `normalizeArcade` and must stay the same bytes (`check:runtime-bytes`), so
 * `normalizeGameConfigDoc` drops the block. Whoever needs it reads it off the RAW doc with the
 * functions here, which only an arcade runtime, the launcher and the gates import. The launcher's
 * load and save put it back on the normalized doc ({@link withTouchSchemes}).
 */

import type { GameConfigIssue } from './validate';

export const ARCADE_TOUCH_GESTURES = ['hold', 'tap', 'both'] as const;
export const ARCADE_TOUCH_STEERS = ['finger', 'stick'] as const;
export const ARCADE_TOUCH_ABILITY_PRESSES = ['tap', 'target', 'secondFinger', 'button'] as const;
export const ARCADE_TOUCH_AIMS = ['point', 'ahead'] as const;

export type ArcadeTouchScheme = {
	/** `hold`: a held finger steers; `tap`: a tap sets a heading that is kept; `both`. */
	gestures?: (typeof ARCADE_TOUCH_GESTURES)[number];
	/** `finger`: towards the finger; `stick`: the way the finger was dragged from where it went
	 *  down. */
	steer?: (typeof ARCADE_TOUCH_STEERS)[number];
	/** Around the player, field px: a finger inside it keeps the heading, a tap inside it stops.
	 *  Absent ⇒ the pointer block's. */
	deadZone?: number;
	/** How far a press may move, canvas px, and still be a tap. Absent ⇒ the pointer block's. */
	tapPx?: number;
	/** How long a press may last, ms, and still be a tap. 0: any length. */
	tapMs?: number;
	/** `false`: lifting a held finger leaves the player going. Absent ⇒ lifting stops it. */
	releaseStops?: false;
	/** How the class's tap button is pressed: `tap` any tap; `target` a tap on a target of the
	 *  ability; `secondFinger` another finger's tap while one is down; `button` its on-screen
	 *  button. */
	ability?: (typeof ARCADE_TOUCH_ABILITY_PRESSES)[number];
	/** `point`: the press is aimed where tapped; `ahead`: aimed as a key press is. */
	aim?: (typeof ARCADE_TOUCH_AIMS)[number];
	/** How near a target a tap must land for `ability: 'target'`, field px. */
	targetRadius?: number;
};

export type ArcadeOnlineTouch = {
	/** The project's schemes by name. */
	schemes: Record<string, ArcadeTouchScheme>;
	/** The scheme of each online class, by class id. A class not named has none. */
	characters?: Record<string, string>;
};

export type ResolvedTouchScheme = Required<Omit<ArcadeTouchScheme, 'releaseStops'>> & {
	releaseStops: boolean;
};

/** What a scheme names when it names nothing (`engine-mechanics` `TOUCH_DEFAULTS`). */
export const ARCADE_TOUCH_DEFAULTS: Readonly<ResolvedTouchScheme> = Object.freeze({
	gestures: 'hold',
	steer: 'finger',
	deadZone: 24,
	tapPx: 12,
	tapMs: 300,
	releaseStops: true,
	ability: 'tap',
	aim: 'point',
	targetRadius: 72,
});

export const ARCADE_TOUCH_LIMITS = Object.freeze({
	deadZone: { min: 0, max: 1000 },
	tapPx: { min: 0, max: 100 },
	tapMs: { min: 0, max: 2000 },
	targetRadius: { min: 0, max: 1000 },
	schemes: 16,
} as const);

/**
 * The built-in schemes a project starts one from (the tool copies the fields; a stored scheme does
 * not name its preset). `steer` is a new scheme's own defaults.
 */
export const ARCADE_TOUCH_PRESETS: Readonly<
	Record<string, { label: string; about: string; scheme: ArcadeTouchScheme }>
> = Object.freeze({
	steer: {
		label: 'Hold to steer',
		about: 'A held finger steers for as long as it is down; lifting stops. A tap is the ability.',
		scheme: {},
	},
	heading: {
		label: 'Hold or tap to head',
		about:
			'A held finger steers; a tap sets a heading that is kept, and is the ability too (a salmon leaps the way it is sent).',
		scheme: { gestures: 'both' },
	},
	targets: {
		label: 'Tap a target to act',
		about:
			'A held finger steers and a tap sets a heading, except a tap on a target of the ability, which acts there and does not move.',
		scheme: { gestures: 'both', ability: 'target' },
	},
	button: {
		label: 'Move by touch, act by button',
		about: 'A held finger steers and a tap sets a heading; the ability has its on-screen button.',
		scheme: { gestures: 'both', ability: 'button', aim: 'ahead' },
	},
	stick: {
		label: 'Virtual stick',
		about:
			'The player goes the way the finger is dragged from where it went down; a tap is the ability.',
		scheme: { steer: 'stick' },
	},
});

type Raw = Record<string, unknown>;

const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

const pick = <T extends string>(list: readonly T[], v: unknown): T | undefined =>
	list.find((entry) => entry === v);

const bounded = (v: unknown, limit: { min: number; max: number }): number | undefined =>
	typeof v === 'number' && Number.isFinite(v) && v >= limit.min
		? Math.min(v, limit.max)
		: undefined;

const onlineOf = (rawDoc: unknown): Raw | undefined => {
	const arcade = isObject(rawDoc) && isObject(rawDoc.arcade) ? rawDoc.arcade : undefined;
	return arcade && isObject(arcade.online) ? arcade.online : undefined;
};

/** One scheme as it is stored: known values only, a default left out. */
export function normalizeTouchScheme(raw: unknown): ArcadeTouchScheme {
	const scheme: ArcadeTouchScheme = {};
	if (!isObject(raw)) return scheme;
	const d = ARCADE_TOUCH_DEFAULTS;
	const L = ARCADE_TOUCH_LIMITS;
	const gestures = pick(ARCADE_TOUCH_GESTURES, raw.gestures);
	if (gestures && gestures !== d.gestures) scheme.gestures = gestures;
	const steer = pick(ARCADE_TOUCH_STEERS, raw.steer);
	if (steer && steer !== d.steer) scheme.steer = steer;
	const deadZone = bounded(raw.deadZone, L.deadZone);
	if (deadZone !== undefined) scheme.deadZone = deadZone;
	const tapPx = bounded(raw.tapPx, L.tapPx);
	if (tapPx !== undefined) scheme.tapPx = tapPx;
	const tapMs = bounded(raw.tapMs, L.tapMs);
	if (tapMs !== undefined && tapMs !== d.tapMs) scheme.tapMs = tapMs;
	if (raw.releaseStops === false) scheme.releaseStops = false;
	const ability = pick(ARCADE_TOUCH_ABILITY_PRESSES, raw.ability);
	if (ability && ability !== d.ability) scheme.ability = ability;
	const aim = pick(ARCADE_TOUCH_AIMS, raw.aim);
	if (aim && aim !== d.aim) scheme.aim = aim;
	const targetRadius = bounded(raw.targetRadius, L.targetRadius);
	if (targetRadius !== undefined && targetRadius !== d.targetRadius)
		scheme.targetRadius = targetRadius;
	return scheme;
}

/**
 * `arcade.online.touch` of a RAW config as it is stored, or `undefined` for a config with no
 * scheme: schemes with a name (the first {@link ARCADE_TOUCH_LIMITS}.schemes), and each class
 * naming one of them.
 */
export function touchOf(rawDoc: unknown): ArcadeOnlineTouch | undefined {
	const raw = onlineOf(rawDoc)?.touch;
	if (!isObject(raw) || !isObject(raw.schemes)) return undefined;
	const schemes: Record<string, ArcadeTouchScheme> = {};
	for (const [name, scheme] of Object.entries(raw.schemes)) {
		if (Object.keys(schemes).length >= ARCADE_TOUCH_LIMITS.schemes) break;
		if (text(name) === name && name && name !== '__proto__' && isObject(scheme))
			schemes[name] = normalizeTouchScheme(scheme);
	}
	if (!Object.keys(schemes).length) return undefined;
	const characters: Record<string, string> = {};
	if (isObject(raw.characters))
		for (const [id, name] of Object.entries(raw.characters))
			if (
				text(id) === id &&
				id &&
				id !== '__proto__' &&
				typeof name === 'string' &&
				Object.hasOwn(schemes, name)
			)
				characters[id] = name;
	return { schemes, ...(Object.keys(characters).length ? { characters } : {}) };
}

/**
 * The scheme the online class `classId` plays with every field named, or `undefined` for a class
 * with none. `pointer` is the game's resolved pointer block: its `deadZone` and `tapPx` stand in
 * where the scheme names none.
 */
export function touchSchemeOf(
	rawDoc: unknown,
	classId: string,
	pointer?: { deadZone: number; tapPx: number },
): ResolvedTouchScheme | undefined {
	const touch = touchOf(rawDoc);
	const characters = touch?.characters;
	const name = characters && Object.hasOwn(characters, classId) ? characters[classId] : undefined;
	const scheme =
		touch && name !== undefined && Object.hasOwn(touch.schemes, name)
			? touch.schemes[name]
			: undefined;
	if (!scheme) return undefined;
	const d = ARCADE_TOUCH_DEFAULTS;
	return {
		gestures: scheme.gestures ?? d.gestures,
		steer: scheme.steer ?? d.steer,
		deadZone: scheme.deadZone ?? pointer?.deadZone ?? d.deadZone,
		tapPx: scheme.tapPx ?? pointer?.tapPx ?? d.tapPx,
		tapMs: scheme.tapMs ?? d.tapMs,
		releaseStops: scheme.releaseStops !== false,
		ability: scheme.ability ?? d.ability,
		aim: scheme.aim ?? d.aim,
		targetRadius: scheme.targetRadius ?? d.targetRadius,
	};
}

/**
 * The launcher's carry: the NORMALIZED config `doc` with the touch schemes of `rawDoc` put back
 * on its `arcade.online`, after its other fields. Returns `doc` itself when `rawDoc` has none or
 * `doc` is not an online game, so a config with no scheme is untouched; neither argument is
 * changed.
 */
export function withTouchSchemes<T>(doc: T, rawDoc: unknown): T {
	const touch = touchOf(rawDoc);
	const online = onlineOf(doc);
	if (!touch || !online) return doc;
	const { touch: _dropped, ...rest } = online;
	const arcade = (doc as Raw).arcade as Raw;
	return { ...(doc as Raw), arcade: { ...arcade, online: { ...rest, touch } } } as T;
}

/**
 * What is wrong with a RAW config's touch schemes, for a save: `validateGameConfigDoc` does not
 * know them. All warnings: a scheme that cannot be played as it reads is played as its defaults,
 * and never stops a save.
 */
export function validateTouchSchemes(rawDoc: unknown): GameConfigIssue[] {
	const online = onlineOf(rawDoc);
	const raw = online?.touch;
	if (raw === undefined) return [];
	const issues: GameConfigIssue[] = [];
	const warn = (path: string, message: string) =>
		issues.push({ severity: 'warning', path: `arcade.online.touch${path}`, message });
	const touch = touchOf(rawDoc);
	if (!touch) {
		warn('', 'names no scheme: it does nothing');
		return issues;
	}
	const pointer = isObject(online?.pointer) ? online.pointer : undefined;
	if (!pointer)
		warn('', 'mouse and touch is off (no arcade.online.pointer): the schemes do nothing');
	const taps = pointer && isObject(pointer.taps) ? pointer.taps : {};
	const classes = new Set(
		(Array.isArray(online?.characters) ? online.characters : [])
			.map((c) => (isObject(c) ? text(c.id) : ''))
			.filter(Boolean),
	);
	const rawCharacters = isObject(raw) && isObject(raw.characters) ? raw.characters : {};
	for (const [id, name] of Object.entries(rawCharacters)) {
		if (!classes.has(id)) warn(`.characters.${id}`, 'is not an online character');
		else if (typeof name !== 'string' || !Object.hasOwn(touch.schemes, name))
			warn(`.characters.${id}`, `names no scheme of this game ("${String(name)}")`);
	}
	for (const [id, name] of Object.entries(touch.characters ?? {})) {
		if (!classes.has(id)) continue;
		const scheme = touch.schemes[name];
		const press = scheme.ability ?? ARCADE_TOUCH_DEFAULTS.ability;
		if (press !== 'tap' && !Object.hasOwn(taps, id))
			warn(
				`.characters.${id}`,
				`"${name}" presses the ability by ${press}, but "${id}" has no tap button`,
			);
		if (press === 'secondFinger' && scheme.gestures === 'tap')
			warn(
				`.schemes.${name}`,
				'a second finger needs a first one held, and this scheme has no hold',
			);
	}
	return issues;
}
