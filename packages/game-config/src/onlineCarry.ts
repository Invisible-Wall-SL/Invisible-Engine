/**
 * HELD, THEN THROWN, and how a room's marks are drawn (owner, 2026-11-24; Salmons' fisherman and
 * its pools of blood): two blocks of an online game's rules.
 *
 * - `arcade.online.rules.abilities[].carry`, on a `hook` ability: the target its line lands is not
 *   out. It is alive in its user's hands, where nobody else can hit it. The user's next press of
 *   the ability throws it to the press's aim, at most `throwPx` away; it flies there over
 *   `flightMs`, lands, and only there is it out and the ability scored. Not thrown within
 *   `holdMs`, or its holder caught or gone, it is dropped where it is and is out the same way.
 *   Every field has a default ({@link ARCADE_ONLINE_CARRY_DEFAULTS}): `{}` turns it on. Absent ⇒
 *   it is out when it is landed, as before. The room plays it (`engine-mechanics`
 *   `salmonsRules.js` `fishingLine`).
 * - `arcade.online.rules.stains`: how see-through the marks the rules module leaves on the field
 *   are drawn (a pool of blood, the trail of a fish that swam through one), on top of the water.
 *   Presentation only: a device reads it, the room does not.
 *
 * CARRIED, NOT NORMALIZED, as the touch schemes are (`touchScheme.ts`): the slot, match-3 and card
 * bundles keep `normalizeArcade` and must stay the same bytes (`check:runtime-bytes`), so
 * `normalizeGameConfigDoc` drops both blocks. Whoever needs them reads them off the RAW doc with
 * the functions here, which only an arcade runtime, the game server, the launcher and the gates
 * import. The game server puts the carry on the game it plays ({@link onlineGameWithCarry}); the
 * launcher's load and save put both back on the normalized doc ({@link withOnlineCarry}).
 */

import type { GameConfigIssue } from './validate';

export type ArcadeOnlineCarry = {
	/** How long it is held before it is dropped, ms. */
	holdMs?: number;
	/** The furthest it is thrown, px from the user's centre (an aim past it lands this far). */
	throwPx?: number;
	/** How long it flies, ms, whatever the distance. */
	flightMs?: number;
	/** false ⇒ the user stands still while it holds. Absent ⇒ it walks as ever. */
	walk?: false;
};

/** A `carry` with every field named, held to its limits. */
export type ResolvedArcadeCarry = {
	holdMs: number;
	throwPx: number;
	flightMs: number;
	walk: boolean;
};

/** What a `carry` names when it names nothing: 4 s held, 8 cells of 48 px thrown. */
export const ARCADE_ONLINE_CARRY_DEFAULTS: Readonly<ResolvedArcadeCarry> = Object.freeze({
	holdMs: 4000,
	throwPx: 384,
	flightMs: 600,
	walk: true,
});

/** The bounds a room holds a `carry` to (its throw: an ability's reach). */
export const ARCADE_ONLINE_CARRY_LIMITS = Object.freeze({
	holdMs: { min: 500, max: 60_000 },
	throwPx: { min: 1, max: 2000 },
	flightMs: { min: 100, max: 5000 },
} as const);

export type ArcadeOnlineStains = {
	/** A mark's opacity, 0 (not drawn) to 1 (solid). */
	opacity?: number;
	/** The trail's opacity where it is shed (it fades from there). */
	trailOpacity?: number;
};

/** What `rules.stains` names when it names nothing: 70 % transparent. */
export const ARCADE_ONLINE_STAIN_DEFAULTS: Readonly<Required<ArcadeOnlineStains>> = Object.freeze({
	opacity: 0.3,
	trailOpacity: 0.3,
});

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const positive = (v: unknown): number | undefined =>
	typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
const within = (v: number, range: { min: number; max: number }) =>
	Math.min(range.max, Math.max(range.min, v));

const rulesOf = (doc: unknown): Raw | undefined => {
	const arcade = isObject(doc) ? doc.arcade : undefined;
	const online = isObject(arcade) ? arcade.online : undefined;
	return isObject(online) && isObject(online.rules) ? online.rules : undefined;
};
const abilitiesOf = (rules: Raw | undefined): Raw[] =>
	Array.isArray(rules?.abilities) ? rules.abilities.filter(isObject) : [];

/** One `carry` as it is stored: positive numbers only, `walk` only when it is off. */
export function normalizeCarry(raw: unknown): ArcadeOnlineCarry | undefined {
	if (!isObject(raw)) return undefined;
	const carry: ArcadeOnlineCarry = {};
	for (const key of ['holdMs', 'throwPx', 'flightMs'] as const) {
		const value = positive(raw[key]);
		if (value !== undefined) carry[key] = value;
	}
	if (raw.walk === false) carry.walk = false;
	return carry;
}

/** A `carry` with its defaults, held to {@link ARCADE_ONLINE_CARRY_LIMITS}. */
export function resolveCarry(carry: ArcadeOnlineCarry): ResolvedArcadeCarry {
	const d = ARCADE_ONLINE_CARRY_DEFAULTS;
	const L = ARCADE_ONLINE_CARRY_LIMITS;
	return {
		holdMs: within(carry.holdMs ?? d.holdMs, L.holdMs),
		throwPx: within(carry.throwPx ?? d.throwPx, L.throwPx),
		flightMs: within(carry.flightMs ?? d.flightMs, L.flightMs),
		walk: carry.walk !== false,
	};
}

/** `rules.stains` of a RAW config with its defaults, each opacity held to 0–1. */
export function onlineStainsOf(rawDoc: unknown): Required<ArcadeOnlineStains> {
	const raw = rulesOf(rawDoc)?.stains;
	const d = ARCADE_ONLINE_STAIN_DEFAULTS;
	const unit = (v: unknown, fallback: number) =>
		typeof v === 'number' && Number.isFinite(v) ? within(v, { min: 0, max: 1 }) : fallback;
	return isObject(raw)
		? {
				opacity: unit(raw.opacity, d.opacity),
				trailOpacity: unit(raw.trailOpacity, d.trailOpacity),
			}
		: { ...d };
}

/** `rules.stains` of a RAW config as it is stored (opacities from 0, at most 1), or `undefined`
 *  when it names none. */
const storedStains = (rawDoc: unknown): ArcadeOnlineStains | undefined => {
	const raw = rulesOf(rawDoc)?.stains;
	if (!isObject(raw)) return undefined;
	const stains: ArcadeOnlineStains = {};
	for (const key of ['opacity', 'trailOpacity'] as const) {
		const value = raw[key];
		if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
			stains[key] = Math.min(1, value);
	}
	return Object.keys(stains).length ? stains : undefined;
};

/** An ability's place in a config: its character and its button (a class has one ability a
 *  button). */
const slotOf = (ability: Raw) => `${String(ability.character)}\n${String(ability.button)}`;

/** The `carry` of each `hook` ability of a RAW config that has one, by {@link slotOf}. */
const carriesOf = (rawDoc: unknown): Map<string, ArcadeOnlineCarry> => {
	const carries = new Map<string, ArcadeOnlineCarry>();
	for (const ability of abilitiesOf(rulesOf(rawDoc))) {
		const carry = ability.effect === 'hook' ? normalizeCarry(ability.carry) : undefined;
		if (carry && !carries.has(slotOf(ability))) carries.set(slotOf(ability), carry);
	}
	return carries;
};

/**
 * The launcher's carry: the NORMALIZED config `doc` with the `carry` of each `hook` ability and
 * the `stains` of `rawDoc` put back on its rules. Returns `doc` itself when `rawDoc` has neither
 * or `doc` has no online rules; neither argument is changed.
 */
export function withOnlineCarry<T>(doc: T, rawDoc: unknown): T {
	const rules = rulesOf(doc);
	const carries = carriesOf(rawDoc);
	const stains = storedStains(rawDoc);
	if (!rules || (!carries.size && !stains)) return doc;
	const abilities = Array.isArray(rules.abilities)
		? rules.abilities.map((ability: unknown) => {
				const carry =
					isObject(ability) && ability.effect === 'hook' ? carries.get(slotOf(ability)) : undefined;
				return carry ? { ...(ability as Raw), carry } : ability;
			})
		: undefined;
	const { stains: _dropped, ...rest } = rules;
	const arcade = (doc as Raw).arcade as Raw;
	const online = arcade.online as Raw;
	return {
		...(doc as Raw),
		arcade: {
			...arcade,
			online: {
				...online,
				rules: { ...rest, ...(abilities ? { abilities } : {}), ...(stains ? { stains } : {}) },
			},
		},
	} as T;
}

/** What {@link onlineGameWithCarry} needs of a resolved online game (`OnlineGame`). */
type GameWithAbilities = {
	online: {
		rules: { abilities: readonly { character: string; button: string; effect: string }[] };
	};
};

/**
 * The game a room plays: the resolved `game` (`onlineGameOf` of the normalized doc) with the
 * resolved `carry` of `rawDoc` on each `hook` ability that has one. `game` itself when none has.
 */
export function onlineGameWithCarry<G extends GameWithAbilities>(game: G, rawDoc: unknown): G {
	const carries = carriesOf(rawDoc);
	if (!carries.size) return game;
	const abilities = game.online.rules.abilities.map((ability) => {
		const carry = ability.effect === 'hook' ? carries.get(slotOf(ability)) : undefined;
		return carry ? { ...ability, carry: resolveCarry(carry) } : ability;
	});
	return { ...game, online: { ...game.online, rules: { ...game.online.rules, abilities } } };
}

/**
 * What is wrong with a RAW config's `carry` and `stains`, for a save: `validateGameConfigDoc` does
 * not know them. All warnings: a value out of its bounds is held to them, a `carry` on an ability
 * that is no hook does nothing, and none stops a save.
 */
export function validateOnlineCarry(rawDoc: unknown): GameConfigIssue[] {
	const rules = rulesOf(rawDoc);
	const issues: GameConfigIssue[] = [];
	const warn = (path: string, message: string) =>
		issues.push({ severity: 'warning', path: `arcade.online.rules.${path}`, message });
	(Array.isArray(rules?.abilities) ? rules.abilities : []).forEach(
		(ability: unknown, i: number) => {
			if (!isObject(ability) || ability.carry === undefined) return;
			const path = `abilities[${i}].carry`;
			if (ability.effect !== 'hook' || !isObject(ability.carry)) {
				warn(path, 'Only a hook holds and throws what its line lands; this carry does nothing.');
				return;
			}
			for (const key of ['holdMs', 'throwPx', 'flightMs'] as const) {
				const value = ability.carry[key];
				const range = ARCADE_ONLINE_CARRY_LIMITS[key];
				if (value === undefined) continue;
				if (typeof value !== 'number' || value < range.min || value > range.max)
					warn(
						`${path}.${key}`,
						`${key} is ${String(value)}; a room holds it to ${range.min}–${range.max}.`,
					);
			}
		},
	);
	const stains = rules?.stains;
	if (isObject(stains))
		for (const key of ['opacity', 'trailOpacity'] as const) {
			const value = stains[key];
			if (value === undefined) continue;
			if (typeof value !== 'number' || value < 0 || value > 1)
				warn(
					`stains.${key}`,
					`${key} is ${String(value)}; an opacity is 0 (not drawn) to 1 (solid).`,
				);
		}
	return issues;
}
