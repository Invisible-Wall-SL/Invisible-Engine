/**
 * A GAME'S PROP COLLIDERS (`arcade.online.props`; `docs/design/arcade-prop-components.md` §3): by
 * zone family (`zoneArt.ts` `zoneFamilyOf`, e.g. `bridge#`), the collider of the prop component a
 * family is drawn with, compiled to a `PropShape` (`engine-mechanics` `propShape.js`
 * `compilePropShape`). A room's generator lays each into its family's zones and zone rules
 * (`salmons.js` `salmonsGeometry`), so the room and every device play the shape the author drew.
 *
 * CARRIED, NOT NORMALIZED, as the levels' shape is (`levelsShape.ts`): the slot, match-3 and card
 * bundles keep `normalizeArcade` and must stay the same bytes (`check:runtime-bytes`), so
 * `normalizeGameConfigDoc` drops the block. The room and the device read it off the RAW doc
 * through `shapedOnlineGame` ({@link withOnlineProps}), which is what both give their generator.
 *
 * Normalized as the compile writes it: a field equal to today's rule
 * ({@link ONLINE_PROP_DEFAULTS}) is dropped, so a shape that only restates today's bridge leaves a
 * level, and its `levelHash`, as they were. A field that cannot be played is dropped too (its
 * default plays); an entry with no known zone kind, or no `from` stamp, is no entry.
 */

import type { PropShape, PropShapeSolid } from 'engine-mechanics/src/propShape.js';

/** `engine-mechanics` `propShape.js`'s lists and today's bridge, mirrored as the rest of this
 *  package mirrors the mechanics' (its module keeps the rules' constants, which a slot runtime's
 *  normalizer would then carry); `check:prop-shape` holds the two equal. */
export const ONLINE_PROP_ZONE_KINDS = Object.freeze(['bridge'] as const);
export const ONLINE_PROP_HOLES = Object.freeze(['deckAndRamps', 'deck', 'none'] as const);
export const ONLINE_PROP_SOLID_COLLIDES = Object.freeze(['solid', 'oneWay'] as const);
export const ONLINE_PROP_SOLID_SIDES = Object.freeze(['below', 'above', 'left', 'right'] as const);
export const ONLINE_PROP_MAX_SNAP = 1;
export const ONLINE_PROP_MAX_SOLIDS = 8;
export const ONLINE_PROP_MAX_CHARACTERS = 8;
export const ONLINE_PROP_MAX_ID = 32;
export const ONLINE_PROP_DEFAULTS = Object.freeze({
	bridge: Object.freeze({
		characters: Object.freeze(['fisherman']),
		height: 6,
		snap: 0.5,
		ramp: Object.freeze({ near: 2, far: 2 }),
		hole: 'deckAndRamps',
		sideExit: false,
	}),
});

/** `arcade.online.props`: a compiled collider per zone family. */
export type ArcadeOnlineProps = Record<string, PropShape>;

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const positive = (v: unknown): number | undefined =>
	typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined =>
	list.find((item) => item === v);
/** A list of character ids, each once, or `undefined` for none or anything else. */
const names = (v: unknown): string[] | undefined =>
	Array.isArray(v) &&
	v.length > 0 &&
	v.every((c) => typeof c === 'string' && c !== '' && c.length <= ONLINE_PROP_MAX_ID) &&
	new Set(v).size <= ONLINE_PROP_MAX_CHARACTERS
		? [...new Set(v as string[])]
		: undefined;
const sameSet = (a: readonly string[], b: readonly string[]) =>
	a.length === b.length && a.every((c) => b.includes(c));
/** A zone family: a zone id with its numbers as `#` (no digit), and no key of `Object`'s. */
const isFamily = (key: string) => key !== '' && !/\d/.test(key) && key !== '__proto__';

const normalizeSolid = (raw: unknown): PropShapeSolid | undefined => {
	if (!isObject(raw)) return undefined;
	const { x, y } = raw;
	const w = positive(raw.w);
	const h = positive(raw.h);
	const collide = oneOf(ONLINE_PROP_SOLID_COLLIDES, raw.collide);
	if (!finite(x) || !finite(y) || !w || !h || !collide) return undefined;
	const side = oneOf(ONLINE_PROP_SOLID_SIDES, raw.side);
	if (collide === 'oneWay' ? !side : raw.side !== undefined) return undefined;
	const solid: PropShapeSolid = { x, y, w, h, collide };
	if (side) solid.side = side;
	const characters = names(raw.characters);
	if (characters) solid.characters = characters;
	return solid;
};

/** One compiled collider, its defaults dropped, or `undefined` when it is none. */
export function normalizePropShape(raw: unknown): PropShape | undefined {
	if (!isObject(raw)) return undefined;
	const zoneKind = oneOf(ONLINE_PROP_ZONE_KINDS, raw.zoneKind);
	const from = isObject(raw.from) ? raw.from : undefined;
	const component = typeof from?.component === 'string' ? from.component : '';
	const version = from?.version;
	if (!zoneKind || !component || !Number.isInteger(version) || (version as number) < 1)
		return undefined;
	const d = ONLINE_PROP_DEFAULTS[zoneKind];
	const shape: PropShape = { from: { component, version: version as number }, zoneKind };
	const characters = names(raw.characters);
	if (characters && !sameSet(characters, d.characters)) shape.characters = characters;
	const height = positive(raw.height);
	if (height !== undefined && height !== d.height) shape.height = height;
	const snap = positive(raw.snap);
	if (snap !== undefined && snap <= ONLINE_PROP_MAX_SNAP && snap !== d.snap) shape.snap = snap;
	const ramp = isObject(raw.ramp) ? raw.ramp : undefined;
	const near = positive(ramp?.near);
	const far = positive(ramp?.far);
	if (near && far && (near !== d.ramp.near || far !== d.ramp.far)) shape.ramp = { near, far };
	const hole = oneOf(ONLINE_PROP_HOLES, raw.hole);
	if (hole && hole !== d.hole) shape.hole = hole;
	const solids = (Array.isArray(raw.solids) ? raw.solids : []).flatMap((s) => {
		const solid = normalizeSolid(s);
		return solid ? [solid] : [];
	});
	if (solids.length) shape.solids = solids.slice(0, ONLINE_PROP_MAX_SOLIDS);
	if (raw.sideExit === true) shape.sideExit = true;
	return shape;
}

/** Normalize `arcade.online.props`: an entry per zone family that is a collider; `undefined` for
 *  none. */
export function normalizeOnlineProps(raw: unknown): ArcadeOnlineProps | undefined {
	if (!isObject(raw)) return undefined;
	const props: ArcadeOnlineProps = {};
	for (const [family, value] of Object.entries(raw)) {
		const shape = isFamily(family) ? normalizePropShape(value) : undefined;
		if (shape) props[family] = shape;
	}
	return Object.keys(props).length ? props : undefined;
}

/** The prop colliders of a RAW config, normalized, or `undefined` for none. */
export function onlinePropsOf(rawDoc: unknown): ArcadeOnlineProps | undefined {
	const arcade = isObject(rawDoc) ? rawDoc.arcade : undefined;
	const online = isObject(arcade) ? arcade.online : undefined;
	return normalizeOnlineProps(isObject(online) ? online.props : undefined);
}

/**
 * A resolved online game (`onlineGameOf` of the normalized doc) with the prop colliders of the RAW
 * doc it came from on `online.props`, which its generator reads. `game` itself when there are
 * none, or when it is no game (`undefined`, a refusal).
 */
export function withOnlineProps<G extends object | undefined>(game: G, rawDoc: unknown): G {
	const props = onlinePropsOf(rawDoc);
	if (!props || !game || !('online' in game) || !isObject(game.online)) return game;
	return { ...game, online: { ...game.online, props } };
}

/**
 * The launcher's carry: the NORMALIZED config `doc` with the prop colliders of `rawDoc` put back on
 * its `arcade.online.props`. Returns `doc` itself when `rawDoc` has none or `doc` is not an online
 * game; neither argument is changed.
 */
export function withProps<T>(doc: T, rawDoc: unknown): T {
	const props = onlinePropsOf(rawDoc);
	const arcade = isObject(doc) ? doc.arcade : undefined;
	const online = isObject(arcade) ? arcade.online : undefined;
	if (!props || !isObject(arcade) || !isObject(online)) return doc;
	return { ...doc, arcade: { ...arcade, online: { ...online, props } } } as T;
}
