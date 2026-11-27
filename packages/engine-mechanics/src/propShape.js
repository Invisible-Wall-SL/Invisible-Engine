/**
 * A PROP's collider as the rules read it (`docs/design/arcade-prop-components.md` §2–§3): a
 * component's `prop` block compiled to a plain `PropShape`, with no art and no nodes. The game
 * server, the device and the launcher share this one function, so the def the author draws and
 * the shape the room plays cannot drift. The input is read structurally (a `ComponentDef` from
 * `engine-layout`, which this package does not import).
 *
 * A field equal to today's rule is DROPPED: a def that reproduces today's bridge compiles to
 * `{ from, zoneKind }` alone, which is what keeps a game's zones, zone rules and `levelHash`
 * byte-identical until an author changes the collision.
 */
import { BRIDGE_SLOPE } from './salmonsRules.js';

/** The zone kinds a prop compiles to: the ones with a rule that reads a shape. */
export const PROP_ZONE_KINDS = Object.freeze(['bridge']);
/** How the water under a prop opens to the characters it carries. */
export const PROP_HOLES = Object.freeze(['deckAndRamps', 'deck', 'none']);
/** How a prop's extra solid meets a character: `TileCollide`'s solid and one-way. */
export const PROP_SOLID_COLLIDES = Object.freeze(['solid', 'oneWay']);
/** The side a one-way solid stops a character coming from (a zone rule's `solid` sides). */
export const PROP_SOLID_SIDES = Object.freeze(['below', 'above', 'left', 'right']);
/** The widest snap to the deck's row, cells: beyond a cell it would take a body off the next row. */
export const PROP_MAX_SNAP = 1;
/**
 * The most extra solids a prop's collider holds, the most character ids a list of it names and the
 * longest id: what keeps a room's props, sent whole in its state (`onlineGenerators.js`
 * `roomLevelState`), far under `ROOM_LEVELS_MAX`, so a device always gets the collider its room
 * plays. `check:prop-shape` sizes a worst-case collider against it.
 */
export const PROP_MAX_SOLIDS = 8;
export const PROP_MAX_CHARACTERS = 8;
export const PROP_MAX_ID = 32;

/**
 * Today's rule per zone kind, which a compiled shape leaves out: the bridge's ramps
 * (`salmonsRules.js` `BRIDGE_SLOPE`), its height (`salmonsMap.js` `BRIDGE_HEIGHT`), the half-cell
 * snap of `bridges.deckOf`, the hole `salmons.js` `originalBounds` cuts, and the characters of the
 * bridge zone rule `salmonsGeometry` writes (`check:prop-shape` pins that these are the rule's).
 * The height is written out, not read off `SALMONS_MAP`: a property read in this frozen object
 * keeps it in every runtime that reaches the package (the slot runtime too, +55 B gzip measured).
 */
export const PROP_SHAPE_DEFAULTS = Object.freeze({
	bridge: Object.freeze({
		characters: Object.freeze(['fisherman']),
		height: 6,
		snap: 0.5,
		ramp: Object.freeze({ near: BRIDGE_SLOPE, far: BRIDGE_SLOPE }),
		hole: 'deckAndRamps',
		sideExit: false,
	}),
});

/** A prop the rules cannot play: every problem, in `errors`. */
export class PropShapeError extends Error {
	constructor(errors) {
		super(`Not a playable prop: ${errors.join(' ')}`);
		this.name = 'PropShapeError';
		this.errors = errors;
	}
}

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const names = (v) =>
	Array.isArray(v) &&
	v.length > 0 &&
	v.every((c) => typeof c === 'string' && c !== '' && c.length <= PROP_MAX_ID) &&
	new Set(v).size <= PROP_MAX_CHARACTERS;
const sameSet = (a, b) => a.length === b.length && a.every((c) => b.includes(c));

/**
 * The problems that stop `def` compiling, `[]` when it compiles. The deck must span its zone (from
 * cell 0 to `{ param: <fromZone.length>, plus: -1 }`), as the rule's deck is the zone's; a ramp or
 * the height is a number or a param with a number default, never the per-zone length; the height,
 * the ramps and the snap are positive (the snap at most {@link PROP_MAX_SNAP}); a solid has a
 * positive size, a known `collide`, and a `side` exactly when it is one-way.
 */
export function propShapeErrors(def) {
	return compile(def).errors;
}

/**
 * `def.prop` as the rules read it: `{ from: { component, version }, zoneKind }` plus every field
 * that differs from today's rule ({@link PROP_SHAPE_DEFAULTS}). Throws a {@link PropShapeError}
 * listing every problem {@link propShapeErrors} finds.
 */
export function compilePropShape(def) {
	const { shape, errors } = compile(def);
	if (errors.length) throw new PropShapeError(errors);
	return shape;
}

function compile(def) {
	const errors = [];
	const fail = (message) => {
		errors.push(message);
		return undefined;
	};
	if (!isRecord(def)) return { errors: ['The component is not an object.'] };
	if (typeof def.id !== 'string' || !def.id) fail('The component has no id.');
	if (!Number.isInteger(def.version) || def.version < 1) fail('The component has no version.');
	const prop = def.prop;
	if (!isRecord(prop)) return { errors: [...errors, 'The component has no prop block.'] };
	const defaults = PROP_ZONE_KINDS.includes(prop.zoneKind)
		? PROP_SHAPE_DEFAULTS[prop.zoneKind]
		: undefined;
	if (!defaults) {
		fail(
			`A prop compiles to a zone of kind ${PROP_ZONE_KINDS.join(', ')}, not "${prop.zoneKind}".`,
		);
	}
	const collider = isRecord(prop.collider) ? prop.collider : fail('The prop has no collider.');
	const fromZone = isRecord(prop.fromZone) ? prop.fromZone : {};
	const params = new Map(
		(Array.isArray(def.params) ? def.params : []).filter(isRecord).map((p) => [p.key, p]),
	);
	const zoneParam = (field) => {
		const key = fromZone[field];
		if (key === undefined && field === 'height') return undefined;
		const param = typeof key === 'string' ? params.get(key) : undefined;
		if (!param || param.kind !== 'number' || param.engineProvided !== true) {
			return fail(`fromZone.${field} must name an engine-provided number param of the def.`);
		}
		return key;
	};
	const lengthParam = zoneParam('length');
	const heightParam = zoneParam('height');
	if (!collider) return { errors };

	/** A length in cells, resolved by its param's default; never the zone's length. */
	const cells = (value, what) => {
		if (finite(value)) return value;
		if (!isRecord(value) || typeof value.param !== 'string') {
			return fail(`${what} must be a number of cells or { param, plus }.`);
		}
		const plus = value.plus ?? 0;
		if (!finite(plus)) return fail(`${what}'s plus must be a number.`);
		if (value.param === lengthParam) return fail(`${what} cannot follow the zone's length.`);
		if (value.param === heightParam && plus !== 0) {
			return fail(`${what} follows the zone's height, so it takes no plus.`);
		}
		const param = params.get(value.param);
		if (!param || param.kind !== 'number' || !finite(param.default)) {
			return fail(`${what} names "${value.param}", not a number param with a default.`);
		}
		return param.default + plus;
	};
	const positive = (value, what) => {
		const n = cells(value, what);
		return n === undefined || n > 0 ? n : fail(`${what} must be more than 0 cells.`);
	};

	const deck = isRecord(collider.deck) ? collider.deck : {};
	const spans =
		deck.from === 0 && isRecord(deck.to) && deck.to.param === lengthParam && deck.to.plus === -1;
	if (lengthParam && !spans) {
		fail(`The deck runs from 0 to { param: '${lengthParam}', plus: -1 }: the zone's own cells.`);
	}
	const height = positive(deck.height, 'The deck height');
	const ramps = isRecord(collider.ramps) ? collider.ramps : {};
	const near = positive(isRecord(ramps.near) ? ramps.near.length : undefined, 'The near ramp');
	const far = positive(isRecord(ramps.far) ? ramps.far.length : undefined, 'The far ramp');
	const { snap } = collider;
	if (!finite(snap) || snap <= 0 || snap > PROP_MAX_SNAP) {
		fail(`The snap must be more than 0 and at most ${PROP_MAX_SNAP} cell.`);
	}
	if (!PROP_HOLES.includes(collider.hole)) fail(`The hole is one of ${PROP_HOLES.join(', ')}.`);
	if (collider.characters !== undefined && !names(collider.characters)) {
		fail(
			`The characters are a list of at most ${PROP_MAX_CHARACTERS} character ids of at most ${PROP_MAX_ID} letters.`,
		);
	}
	if (collider.solids !== undefined && !Array.isArray(collider.solids))
		fail('The solids are a list.');
	if (Array.isArray(collider.solids) && collider.solids.length > PROP_MAX_SOLIDS)
		fail(`A prop has at most ${PROP_MAX_SOLIDS} solids.`);
	if (collider.sideExit !== undefined && typeof collider.sideExit !== 'boolean')
		fail('The side exit is on or off.');
	const solids = (Array.isArray(collider.solids) ? collider.solids : []).map((s, i) =>
		solid(s, `Solid ${i + 1}`, fail),
	);
	if (errors.length) return { errors };

	const shape = { from: { component: def.id, version: def.version }, zoneKind: prop.zoneKind };
	const characters = collider.characters ? [...new Set(collider.characters)] : undefined;
	if (characters && !sameSet(characters, defaults.characters)) shape.characters = characters;
	if (height !== defaults.height) shape.height = height;
	if (snap !== defaults.snap) shape.snap = snap;
	if (near !== defaults.ramp.near || far !== defaults.ramp.far) shape.ramp = { near, far };
	if (collider.hole !== defaults.hole) shape.hole = collider.hole;
	if (solids.length) shape.solids = solids;
	if (collider.sideExit === true) shape.sideExit = true;
	return { shape, errors };
}

function solid(s, what, fail) {
	if (!isRecord(s)) return fail(`${what} is not an object.`);
	if (![s.x, s.y, s.w, s.h].every(finite) || !(s.w > 0 && s.h > 0)) {
		return fail(`${what} needs a finite x and y and a positive w and h, in cells.`);
	}
	if (!PROP_SOLID_COLLIDES.includes(s.collide)) {
		return fail(`${what} collides as ${PROP_SOLID_COLLIDES.join(' or ')}.`);
	}
	if (s.collide === 'oneWay' ? !PROP_SOLID_SIDES.includes(s.side) : s.side !== undefined) {
		return fail(
			`${what}: a one-way solid names its side (${PROP_SOLID_SIDES.join(', ')}); a solid none.`,
		);
	}
	if (s.characters !== undefined && !names(s.characters)) {
		return fail(`${what}'s characters are a list of character ids.`);
	}
	const out = { x: s.x, y: s.y, w: s.w, h: s.h, collide: s.collide };
	if (s.side) out.side = s.side;
	if (s.characters) out.characters = [...new Set(s.characters)];
	return out;
}

/** A zone family: a zone id with its numbers as `#` (no digit), and no key of `Object`'s. */
const isFamily = (key) => key !== '' && !/\d/.test(key) && key !== '__proto__';
const positive = (v) => (finite(v) && v > 0 ? v : undefined);
const oneOf = (list, v) => list.find((item) => item === v);
const idsOf = (v) => (names(v) ? [...new Set(v)] : undefined);

function readSolid(raw) {
	if (!isRecord(raw)) return undefined;
	const { x, y } = raw;
	const w = positive(raw.w);
	const h = positive(raw.h);
	const collide = oneOf(PROP_SOLID_COLLIDES, raw.collide);
	if (!finite(x) || !finite(y) || !w || !h || !collide) return undefined;
	const side = oneOf(PROP_SOLID_SIDES, raw.side);
	if (collide === 'oneWay' ? !side : raw.side !== undefined) return undefined;
	const out = { x, y, w, h, collide };
	if (side) out.side = side;
	const characters = idsOf(raw.characters);
	if (characters) out.characters = characters;
	return out;
}

function readShape(raw) {
	if (!isRecord(raw)) return undefined;
	const zoneKind = oneOf(PROP_ZONE_KINDS, raw.zoneKind);
	const from = isRecord(raw.from) ? raw.from : undefined;
	const component = typeof from?.component === 'string' ? from.component : '';
	if (!zoneKind || !component || !Number.isInteger(from.version) || from.version < 1)
		return undefined;
	const d = PROP_SHAPE_DEFAULTS[zoneKind];
	const shape = { from: { component, version: from.version }, zoneKind };
	const characters = idsOf(raw.characters);
	if (characters && !sameSet(characters, d.characters)) shape.characters = characters;
	const height = positive(raw.height);
	if (height !== undefined && height !== d.height) shape.height = height;
	const snap = positive(raw.snap);
	if (snap !== undefined && snap <= PROP_MAX_SNAP && snap !== d.snap) shape.snap = snap;
	const ramp = isRecord(raw.ramp) ? raw.ramp : undefined;
	const near = positive(ramp?.near);
	const far = positive(ramp?.far);
	if (near && far && (near !== d.ramp.near || far !== d.ramp.far)) shape.ramp = { near, far };
	const hole = oneOf(PROP_HOLES, raw.hole);
	if (hole && hole !== d.hole) shape.hole = hole;
	const solids = (Array.isArray(raw.solids) ? raw.solids : []).flatMap((s) => {
		const solid = readSolid(s);
		return solid ? [solid] : [];
	});
	if (solids.length) shape.solids = solids.slice(0, PROP_MAX_SOLIDS);
	if (raw.sideExit === true) shape.sideExit = true;
	return shape;
}

/**
 * Compiled shapes by zone family (`arcade.online.props`) as the rules read them, from anything: a
 * room's state, a config. A field equal to today's rule, or one that cannot be played, is dropped;
 * an entry with no known zone kind or no `from` stamp, and a key that is no zone family, is none.
 * `undefined` for none at all. The same reading as `game-config` `normalizeOnlineProps`, which
 * mirrors it (`check:prop-shape` holds the two equal), so what a room played and sends is, read
 * again on a device, itself.
 */
export function readPropShapes(raw) {
	if (!isRecord(raw)) return undefined;
	const props = {};
	for (const [family, value] of Object.entries(raw)) {
		const shape = isFamily(family) ? readShape(value) : undefined;
		if (shape) props[family] = shape;
	}
	return Object.keys(props).length ? props : undefined;
}
