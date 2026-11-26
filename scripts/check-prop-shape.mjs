// A prop component's collider compiled for the rules (`engine-mechanics` `propShape.js`,
// docs/design/arcade-prop-components.md §2–§3, P1):
// - the defaults ARE today's rule: the bridge's ramps are `BRIDGE_SLOPE`, its height the
//   generator's `BRIDGE_HEIGHT` (and every generated bridge's), and its characters the bridge zone
//   rule `salmonsGeometry` writes;
// - a def written as today's bridge compiles to `{ from, zoneKind }` alone, however its lengths are
//   spelled (numbers or params with today's defaults), and a repeated or reordered character list
//   equal to today's is dropped too;
// - each non-default field survives on its own (characters, height, snap, an asymmetric ramp, the
//   hole, a railing solid), and nothing else is added beside it;
// - a bad def is refused with every problem named: no prop, an unknown zone kind, a zone param
//   that is missing or not engine-provided, a deck that does not span its zone, a ramp following
//   the zone's length, a zero or negative or non-numeric length, a param with no default, a snap
//   out of range, an unknown hole, a malformed solid.
//
// §2 (P2) the rules read the shape, in a real room (`services/game-server` `createRoomSim`) of a
// config carrying `arcade.online.props` (`game-config` `onlineProps.ts`, through `shapedOnlineGame`
// as the room and the device resolve it):
// - a device reads a room's props (`readPropShapes`) as the config is normalized, and read again
//   they are themselves;
// - `normalizeOnlineProps` keeps what the compile writes and drops a default, a bad field, an
//   entry with no stamp or kind, and a key that is no zone family; its lists and defaults (mirrored,
//   so a slot runtime's normalizer carries none of the rules' constants) are `propShape.js`'s;
// - with no props, and with a shape that only restates today's bridge, the level is the same; the
//   lift at every eighth of a cell along the row, over both ramps and the deck and past them, is
//   today's formula's (`height · (1 − off / BRIDGE_SLOPE)`, pinned here as it was), to the bit;
// - an asymmetric ramp (near 3, far 2) lifts each end over its own length, and the water opens to
//   fishermen exactly over the deck and those ramps (and over the deck alone, or not at all, by
//   `hole`); a snap narrows who is put on the deck; a height raises it;
// - a solid in the deck's cells stops a fisherman, and one for bears stops a bear and not him.
//
// §3 (P4) the seed `bridgeProp` (`engine-layout` `propComponents.ts`):
// - it compiles to `{ from, zoneKind }` (today's bridge), with no problem named, and so does the
//   normalizer's reading of that shape;
// - its zone params are engine-provided numbers, its scope param an engine-provided `zone`, its
//   inputs `PROP_INPUTS`, its sizes `salmonsElevation.ts`'s (both written out in the def, so it
//   imports nothing a runtime carries), its preview a 6-cell deck 6 high;
// - its bands are §5's at the code's depths: reflections `water`, pillars `behind` at 400, slopes
//   `behind` at 500, deck `sorted` at 1100, every node of every seed def in a band;
// - its deck is a count-mode repeater of near / middle / far cells, and the cells with a pillar are
//   the code's (`river.ts`: both ends and every third) for every deck of 1 … 30 cells;
// - every state plays a timeline of its own def, every timeline keys nodes the def has, and each
//   state machine validates with no issue;
// - it is in the launcher's built-ins and not in the lists every runtime carries, internal, and no
//   other built-in places it.
//
// Run: pnpm check:prop-shape

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
	PROP_HOLES,
	PROP_MAX_SNAP,
	PROP_SHAPE_DEFAULTS,
	PROP_SOLID_COLLIDES,
	PROP_SOLID_SIDES,
	PROP_ZONE_KINDS,
	PropShapeError,
	compilePropShape,
	propShapeErrors,
	readPropShapes,
} from '../packages/engine-mechanics/src/propShape.js';
import {
	BRIDGE_SLOPE,
	bridgeOccupancy,
	occupancySteps,
} from '../packages/engine-mechanics/src/salmonsRules.js';
import {
	SALMONS_MAP,
	SALMONS_MAP_SEED,
	salmonsMapRiver,
} from '../packages/engine-mechanics/src/salmonsMap.js';
import { salmonsConfig, salmonsGeometry } from '../packages/engine-mechanics/src/salmons.js';
import { CELL } from '../packages/engine-mechanics/src/salmonsMap.js';
import { MOVE_SCALE, clampInput } from '../packages/engine-mechanics/src/online.js';
import { generatedOnlineGame } from '../packages/engine-mechanics/src/onlineGenerators.js';
import {
	ONLINE_PROP_DEFAULTS,
	ONLINE_PROP_HOLES,
	ONLINE_PROP_MAX_SNAP,
	ONLINE_PROP_SOLID_COLLIDES,
	ONLINE_PROP_SOLID_SIDES,
	ONLINE_PROP_ZONE_KINDS,
	normalizeOnlineProps,
	playedOnlineGame,
	shapedOnlineGame,
} from '../packages/game-config/index.ts';
import { createRoomSim } from '../services/game-server/src/roomSim.ts';
import {
	BRIDGE_PROP_DEF,
	BRIDGE_PROP_IDS,
	BRIDGE_PROP_SIZES,
	PROP_COMPONENTS,
	PROP_TIMELINES,
} from '../packages/engine-layout/src/lib/propComponents.ts';
import {
	BUILTIN_COMPONENTS,
	RUNTIME_BUILTIN_COMPONENTS,
} from '../packages/engine-layout/src/lib/builtinComponents.ts';
import {
	BUILTIN_TIMELINES,
	RUNTIME_BUILTIN_TIMELINES,
} from '../packages/engine-layout/src/lib/builtinTimelines.ts';
import { PROP_INPUTS } from '../packages/engine-layout/src/lib/componentInterface.ts';
import { validateStateMachine } from '../packages/engine-layout/src/lib/stateMachine.ts';
import { validateNodeActors } from '../packages/engine-layout/src/lib/cinematicNodes.ts';
import { collectComponentIds } from '../packages/engine-layout/src/lib/collectComponentIds.ts';
import {
	CELL as ART_CELL,
	HEIGHT_UNIT,
	K,
} from '../packages/engine-layout/src/lib/referenceLayouts/salmonsElevation.ts';

let passed = 0;
const check = (name, fn) => {
	try {
		fn();
		passed++;
	} catch (e) {
		console.error(`FAIL  ${name}\n      ${e.message}`);
		process.exitCode = 1;
	}
};

/** Today's bridge as a prop def: a deck as long as its zone, today's ramps, snap, hole. */
const bridge = (collider = {}, extra = {}) => ({
	id: 'bridgeProp',
	version: 2,
	params: [
		{ key: 'length', kind: 'number', default: 6, engineProvided: true },
		{ key: 'height', kind: 'number', default: 6, engineProvided: true },
		{ key: 'ramp', kind: 'number', default: 2 },
		{ key: 'label', kind: 'string', default: 'x' },
	],
	prop: {
		zoneKind: 'bridge',
		fromZone: { length: 'length', height: 'height' },
		collider: {
			deck: { from: 0, to: { param: 'length', plus: -1 }, height: 6 },
			snap: 0.5,
			ramps: { near: { length: 2 }, far: { length: 2 } },
			hole: 'deckAndRamps',
			...collider,
		},
		...extra,
	},
});
const FROM = { from: { component: 'bridgeProp', version: 2 }, zoneKind: 'bridge' };
const compiled = (collider, extra) => compilePropShape(bridge(collider, extra));
const refused = (def) => {
	assert.throws(() => compilePropShape(def), PropShapeError);
	return propShapeErrors(def);
};
const refusedFor = (def, pattern) => {
	const errors = refused(def);
	assert.ok(
		errors.some((e) => pattern.test(e)),
		`expected an error matching ${pattern}, got ${JSON.stringify(errors)}`,
	);
};

// ── §1 the defaults are today's rule ─────────────────────────────────────────────────────────

check("the default ramps are the rule's BRIDGE_SLOPE, both ends", () => {
	assert.deepEqual(PROP_SHAPE_DEFAULTS.bridge.ramp, { near: BRIDGE_SLOPE, far: BRIDGE_SLOPE });
	assert.equal(BRIDGE_SLOPE, 2);
});

check("the default height is the generator's, and every generated bridge's", () => {
	assert.equal(PROP_SHAPE_DEFAULTS.bridge.height, SALMONS_MAP.BRIDGE_HEIGHT);
	assert.equal(PROP_SHAPE_DEFAULTS.bridge.height, 6);
	for (const seed of [SALMONS_MAP_SEED, 2, 3, 7, 42]) {
		for (const b of salmonsMapRiver(seed).bridges ?? []) assert.equal(b.height, 6, `seed ${seed}`);
	}
});

check("the default characters are the bridge zone rule's", () => {
	const { zoneRules: rules } = salmonsGeometry(salmonsMapRiver(SALMONS_MAP_SEED));
	const bridgeRules = rules.filter((r) => r.kind === 'bridge');
	assert.ok(bridgeRules.length > 0, 'the seed river has a bridge');
	for (const rule of bridgeRules) {
		assert.deepEqual(rule.characters, [...PROP_SHAPE_DEFAULTS.bridge.characters]);
	}
});

check('the default snap is half a cell and the hole is the deck and its ramps', () => {
	assert.equal(PROP_SHAPE_DEFAULTS.bridge.snap, 0.5);
	assert.equal(PROP_SHAPE_DEFAULTS.bridge.hole, 'deckAndRamps');
	assert.ok(PROP_HOLES.includes(PROP_SHAPE_DEFAULTS.bridge.hole));
});

// ── §1 a def written as today's bridge compiles to { from, zoneKind } ────────────────────────

check("today's bridge compiles to { from, zoneKind } alone", () => {
	assert.deepEqual(compiled(), FROM);
	assert.deepEqual(propShapeErrors(bridge()), []);
});

check('…with its lengths spelled as params at their defaults', () => {
	assert.deepEqual(
		compiled({
			deck: { from: 0, to: { param: 'length', plus: -1 }, height: { param: 'height' } },
			ramps: { near: { length: { param: 'ramp' } }, far: { length: { param: 'ramp', plus: 0 } } },
		}),
		FROM,
	);
});

check("…with today's characters, repeated or not", () => {
	assert.deepEqual(compiled({ characters: ['fisherman'] }), FROM);
	assert.deepEqual(compiled({ characters: ['fisherman', 'fisherman'] }), FROM);
});

check('…with an empty solids list and an editor preview', () => {
	assert.deepEqual(compiled({ solids: [] }, { preview: { length: 9, height: 4 } }), FROM);
});

check('the shape is plain JSON, a fresh object each time', () => {
	const a = compiled();
	assert.deepEqual(JSON.parse(JSON.stringify(a)), a);
	assert.notEqual(a, compiled());
});

// ── §1 each non-default field survives, alone ────────────────────────────────────────────────

check('characters', () => {
	assert.deepEqual(compiled({ characters: ['fisherman', 'bear'] }), {
		...FROM,
		characters: ['fisherman', 'bear'],
	});
});

check('the height, as a number or as a param with a plus', () => {
	assert.deepEqual(compiled({ deck: { from: 0, to: { param: 'length', plus: -1 }, height: 4 } }), {
		...FROM,
		height: 4,
	});
	assert.deepEqual(
		compiled({
			deck: { from: 0, to: { param: 'length', plus: -1 }, height: { param: 'ramp', plus: 1.5 } },
		}),
		{ ...FROM, height: 3.5 },
	);
});

check('the snap', () => {
	assert.deepEqual(compiled({ snap: 0.25 }), { ...FROM, snap: 0.25 });
	assert.deepEqual(compiled({ snap: 1 }), { ...FROM, snap: 1 });
});

check('an asymmetric ramp (near 3, far 2) carries both ends', () => {
	assert.deepEqual(compiled({ ramps: { near: { length: 3 }, far: { length: 2 } } }), {
		...FROM,
		ramp: { near: 3, far: 2 },
	});
	assert.deepEqual(
		compiled({ ramps: { near: { length: 2 }, far: { length: { param: 'ramp', plus: 0.5 } } } }),
		{ ...FROM, ramp: { near: 2, far: 2.5 } },
	);
});

check('the hole', () => {
	assert.deepEqual(compiled({ hole: 'deck' }), { ...FROM, hole: 'deck' });
	assert.deepEqual(compiled({ hole: 'none' }), { ...FROM, hole: 'none' });
});

check('a railing solid (one-way from below) and a post (solid, for bears)', () => {
	const solids = [
		{ x: 0, y: -0.6, w: 6, h: 0.2, collide: 'oneWay', side: 'below' },
		{ x: 2, y: 0, w: 0.5, h: 0.5, collide: 'solid', characters: ['bear', 'bear'] },
	];
	assert.deepEqual(compiled({ solids }), {
		...FROM,
		solids: [solids[0], { x: 2, y: 0, w: 0.5, h: 0.5, collide: 'solid', characters: ['bear'] }],
	});
});

check('the stamp is the def it came from', () => {
	assert.deepEqual(compilePropShape({ ...bridge(), id: 'myBridge', version: 7 }).from, {
		component: 'myBridge',
		version: 7,
	});
});

// ── §1 a bad def is refused, every problem named ─────────────────────────────────────────────

check('no prop, no collider, no id, no version', () => {
	refusedFor({ id: 'x', version: 1 }, /no prop block/);
	refusedFor({ ...bridge(), prop: { ...bridge().prop, collider: undefined } }, /no collider/);
	refusedFor({ ...bridge(), id: '' }, /no id/);
	refusedFor({ ...bridge(), version: 0 }, /no version/);
	refusedFor(null, /not an object/);
});

check('a zone kind with no rule that reads a shape', () => {
	refusedFor({ ...bridge(), prop: { ...bridge().prop, zoneKind: 'log' } }, /zone of kind/);
	refusedFor({ ...bridge(), prop: { ...bridge().prop, zoneKind: 'toString' } }, /zone of kind/);
});

check('a zone param that is missing, not a number, or not engine-provided', () => {
	const def = bridge();
	refusedFor({ ...def, prop: { ...def.prop, fromZone: {} } }, /fromZone\.length/);
	refusedFor({ ...def, prop: { ...def.prop, fromZone: { length: 'label' } } }, /fromZone\.length/);
	refusedFor({ ...def, prop: { ...def.prop, fromZone: { length: 'ramp' } } }, /fromZone\.length/);
	refusedFor(
		{ ...def, prop: { ...def.prop, fromZone: { length: 'length', height: 'nope' } } },
		/fromZone\.height/,
	);
});

check('a deck that does not span its zone', () => {
	const deck = (from, to) => ({ deck: { from, to, height: 6 } });
	refusedFor(bridge(deck(1, { param: 'length', plus: -1 })), /deck runs from 0/);
	refusedFor(bridge(deck(0, { param: 'length' })), /deck runs from 0/);
	refusedFor(bridge(deck(0, 5)), /deck runs from 0/);
	refusedFor(bridge(deck(0, { param: 'height', plus: -1 })), /deck runs from 0/);
});

check(
	'a bad length: zero, negative, not a number, the zone length, a param with no default',
	() => {
		const near = (length) => ({ ramps: { near: { length }, far: { length: 2 } } });
		refusedFor(bridge(near(0)), /near ramp must be more than 0/);
		refusedFor(bridge(near(-1)), /near ramp must be more than 0/);
		refusedFor(bridge(near('2')), /near ramp must be a number/);
		refusedFor(bridge(near(Infinity)), /near ramp must be a number/);
		refusedFor(bridge(near({ param: 'length' })), /cannot follow the zone's length/);
		refusedFor(bridge(near({ param: 'label' })), /not a number param with a default/);
		refusedFor(bridge(near({ param: 'missing' })), /not a number param with a default/);
		refusedFor(bridge(near({ param: 'ramp', plus: 'x' })), /plus must be a number/);
		refusedFor(bridge(near({ param: 'ramp', plus: -2 })), /near ramp must be more than 0/);
		refusedFor(bridge({ ramps: { near: { length: 2 } } }), /far ramp/);
		refusedFor(
			bridge({ deck: { from: 0, to: { param: 'length', plus: -1 }, height: 0 } }),
			/deck height must be more than 0/,
		);
		refusedFor(
			bridge({
				deck: { from: 0, to: { param: 'length', plus: -1 }, height: { param: 'height', plus: 1 } },
			}),
			/takes no plus/,
		);
	},
);

check('a snap out of range, an unknown hole, bad characters', () => {
	for (const snap of [0, -0.5, 1.5, NaN, '0.5', undefined]) {
		refusedFor(bridge({ snap }), /snap/);
	}
	refusedFor(bridge({ hole: 'all' }), /hole/);
	refusedFor(bridge({ characters: [] }), /characters/);
	refusedFor(bridge({ characters: ['fisherman', ''] }), /characters/);
});

check('a malformed solid', () => {
	const one = (s) => bridge({ solids: [s] });
	const box = { x: 0, y: 0, w: 1, h: 1 };
	refusedFor(bridge({ solids: {} }), /solids are a list/);
	refusedFor(one('post'), /Solid 1 is not an object/);
	refusedFor(one({ ...box, w: 0, collide: 'solid' }), /positive w and h/);
	refusedFor(one({ ...box, x: NaN, collide: 'solid' }), /positive w and h/);
	refusedFor(one({ ...box, collide: 'spiky' }), /collides as/);
	refusedFor(one({ ...box, collide: 'oneWay' }), /names its side/);
	refusedFor(one({ ...box, collide: 'oneWay', side: 'up' }), /names its side/);
	refusedFor(one({ ...box, collide: 'solid', side: 'below' }), /names its side/);
	refusedFor(one({ ...box, collide: 'solid', characters: 'bear' }), /characters/);
});

check('every problem is named at once', () => {
	const errors = refused(bridge({ snap: 0, hole: 'all', ramps: { near: { length: 0 } } }));
	assert.equal(errors.length, 4, JSON.stringify(errors));
});

// ── §2 the normalizer keeps what the rules read ──────────────────────────────────────────────

check("game-config's mirror of the lists and defaults is propShape.js's", () => {
	assert.deepEqual(ONLINE_PROP_ZONE_KINDS, PROP_ZONE_KINDS);
	assert.deepEqual(ONLINE_PROP_HOLES, PROP_HOLES);
	assert.deepEqual(ONLINE_PROP_SOLID_COLLIDES, PROP_SOLID_COLLIDES);
	assert.deepEqual(ONLINE_PROP_SOLID_SIDES, PROP_SOLID_SIDES);
	assert.equal(ONLINE_PROP_MAX_SNAP, PROP_MAX_SNAP);
	assert.deepEqual(ONLINE_PROP_DEFAULTS, PROP_SHAPE_DEFAULTS);
});

check('normalizeOnlineProps keeps a compiled shape and drops its defaults', () => {
	const full = compiled({
		characters: ['fisherman', 'bear'],
		deck: { from: 0, to: { param: 'length', plus: -1 }, height: 4 },
		snap: 0.25,
		ramps: { near: { length: 3 }, far: { length: 2 } },
		hole: 'deck',
		solids: [{ x: 7, y: 0, w: 0.5, h: 1, collide: 'oneWay', side: 'left', characters: ['bear'] }],
	});
	assert.deepEqual(normalizeOnlineProps({ 'bridge#': full }), { 'bridge#': full });
	assert.deepEqual(normalizeOnlineProps({ 'bridge#': compiled() }), { 'bridge#': FROM });
	const restated = {
		...FROM,
		characters: ['fisherman'],
		height: 6,
		snap: 0.5,
		ramp: { near: 2, far: 2 },
		hole: 'deckAndRamps',
		solids: [],
	};
	assert.deepEqual(normalizeOnlineProps({ 'bridge#': restated }), { 'bridge#': FROM });
});

check('normalizeOnlineProps drops what cannot be played', () => {
	for (const raw of [undefined, null, [], 'x', {}])
		assert.equal(normalizeOnlineProps(raw), undefined);
	const bad = {
		...FROM,
		characters: [],
		height: 0,
		snap: 1.5,
		ramp: { near: 3 },
		hole: 'all',
		solids: [
			{ x: 0, y: 0, w: 0, h: 1, collide: 'solid' },
			{ x: 0, y: 0, w: 1, h: 1, collide: 'oneWay' },
		],
	};
	assert.deepEqual(normalizeOnlineProps({ 'bridge#': bad }), { 'bridge#': FROM });
	for (const entry of [
		{ zoneKind: 'bridge' },
		{ ...FROM, zoneKind: 'log' },
		{ ...FROM, from: { component: '', version: 1 } },
		{ ...FROM, from: { component: 'x', version: 0 } },
	])
		assert.equal(normalizeOnlineProps({ 'bridge#': entry }), undefined, JSON.stringify(entry));
	assert.equal(
		normalizeOnlineProps({ bridge0: FROM, '': FROM }),
		undefined,
		'a zone id, not a family',
	);
	const proto = JSON.parse(`{"__proto__": ${JSON.stringify(FROM)}}`);
	assert.equal(normalizeOnlineProps(proto), undefined);
});

check("a device's reading (readPropShapes) is the config's (normalizeOnlineProps)", () => {
	const shapes = [
		FROM,
		compiled({ ramps: { near: { length: 3 }, far: { length: 2 } }, snap: 0.25, hole: 'none' }),
		{ ...FROM, characters: ['fisherman', 'bear', 'bear'], height: 6, snap: 2, ramp: { near: 2 } },
		{ ...FROM, solids: [{ x: 1, y: 0, w: 1, h: 1, collide: 'oneWay', side: 'left' }, 'post', {}] },
		{ ...FROM, from: { component: 'x', version: 1.5 } },
		{ zoneKind: 'log', from: FROM.from },
	];
	const raws = [
		undefined,
		null,
		[],
		'x',
		...shapes.map((shape) => ({ 'bridge#': shape })),
		{ 'bridge#': FROM, bridge0: FROM, '': FROM },
		JSON.parse(`{"__proto__": ${JSON.stringify(FROM)}}`),
	];
	for (const raw of raws) {
		assert.deepEqual(readPropShapes(raw), normalizeOnlineProps(raw), JSON.stringify(raw));
		const read = readPropShapes(raw);
		if (read)
			assert.deepEqual(readPropShapes(JSON.parse(JSON.stringify(read))), read, 'read again');
	}
});

// ── §2 the rules read the shape ──────────────────────────────────────────────────────────────

const SEED = 1;
const river = salmonsMapRiver(SEED);
const BRIDGE = river.bridges[1];
const PLANK = BRIDGE.y + CELL / 2;
const FISHER = { x: 28, y: 44 };
/** `walkTrace(undefined)`'s hash on the rule before the side exit existed. */
const TODAYS_WALK = 'e1501b998ee0c84a62485e0754d0b794a96321969693cb5c0dd9dfdb6ead0e0f'; // pragma: allowlist secret (a trace hash)

/** Salmons on the original's level of `SEED`, its config carrying `props` (none: as it ships). */
const docWith = (props) => {
	const doc = salmonsConfig(river);
	delete doc.arcade.online.bots;
	if (props) doc.arcade.online.props = props;
	return doc;
};
const gameWith = (props) => {
	const doc = docWith(props);
	return shapedOnlineGame(playedOnlineGame(doc), doc);
};
const bridgeProps = (fields) => ({ 'bridge#': { ...FROM, ...fields } });
/** What a room collides against and spawns by, as `levelHash` hashes it. */
const levelOf = (props) => {
	const { game } = generatedOnlineGame(gameWith(props), SEED);
	return {
		field: game.field,
		zones: game.zones,
		online: { rules: { zones: game.online.rules.zones } },
	};
};

/** A room of the level, one player of `character` in it. */
const roomWith = (props, character) => {
	const sim = createRoomSim(gameWith(props), { seed: SEED });
	const p = sim.join('p', { character });
	let seq = 0;
	const run = (n, move = { moveX: 0, moveY: 0 }) => {
		for (let i = 0; i < n; i++) {
			seq += 1;
			sim.step(() => [clampInput({ seq, view: sim.steps, ...move, buttons: 0 }, sim.game.field)]);
		}
	};
	return { sim, p, run };
};

/** A fisherman put at (`x`, `y`) for one still step: the lift the rule gave him, cells, and the
 *  `x` it found him at (where a solid touching the deck's row, a rock, nudged him first). */
const stepAt = (room, [x, y]) => {
	Object.assign(room.p.body, { x, y, vx: 0, vy: 0 });
	room.p.z = 0;
	room.p.memo.bridge = 0;
	room.p.memo.vz = 0;
	room.run(1);
	return { lift: room.p.z / CELL, x: room.p.body.x };
};
const liftsAt = (room, points) => points.map((point) => stepAt(room, point).lift);

/** Today's rule, as it was before props (`bridges.deckOf` at 93bd20e), pinned here. */
const todaysLift = (x, y, d) => {
	if (Math.abs(y - (d.y + CELL / 2)) > CELL / 2) return 0;
	const from = d.x + CELL / 2;
	const to = d.x + d.w - CELL / 2;
	const off = Math.max(0, from - x, x - to) / CELL;
	return off <= BRIDGE_SLOPE ? (d.height * (1 - off / BRIDGE_SLOPE) * CELL) / CELL : 0;
};

/** Every eighth of a cell along the deck's row, from 4 cells before it to 4 past it. */
const ROW = Array.from(
	{ length: Math.round(((BRIDGE.w + 8 * CELL) / CELL) * 8) + 1 },
	(_, i) => BRIDGE.x - 4 * CELL + (i * CELL) / 8,
);

check('no props, or a shape of only defaults: the level is the same', () => {
	assert.ok(river.bridges.length >= 2, 'the level has bridges');
	const plain = levelOf(undefined);
	for (const props of [bridgeProps({}), { 'bridge#': compiled(), 'rock#': FROM }])
		assert.ok(isDeepStrictEqual(levelOf(props), plain), JSON.stringify(props));
	assert.ok(
		isDeepStrictEqual(salmonsGeometry(river, bridgeProps({})), salmonsGeometry(river)),
		'the geometry itself',
	);
	const rules = plain.online.rules.zones.filter((r) => r.kind === 'bridge');
	for (const r of rules) assert.deepEqual(Object.keys(r).sort(), ['characters', 'kind', 'zone']);
});

check("no props: the lift at every eighth of a cell is today's, to the bit", () => {
	const room = roomWith(undefined, 'fisherman');
	let ramp = 0;
	let deck = 0;
	for (const dy of [-CELL / 2, -CELL / 4, 0, CELL / 8, CELL / 2]) {
		const points = ROW.map((x) => [x, PLANK + dy]);
		points.forEach(([x, y]) => {
			const at = stepAt(room, [x, y]);
			const want = todaysLift(at.x, y, BRIDGE);
			assert.equal(at.lift, want, `at ${x - BRIDGE.x}, ${dy}: ${at.lift} vs ${want}`);
			if (want === BRIDGE.height) deck += 1;
			else if (want > 0) ramp += 1;
		});
	}
	assert.ok(deck > 20 && ramp > 40, `over the deck (${deck}) and both ramps (${ramp})`);
});

check('near 3, far 2: each end ramps over its own length', () => {
	const room = roomWith(bridgeProps({ ramp: { near: 3, far: 2 } }), 'fisherman');
	const from = BRIDGE.x + CELL / 2;
	const to = BRIDGE.x + BRIDGE.w - CELL / 2;
	/** Cells off the deck's end and the ramp there: the near one before it, the far one after. */
	const offOf = (x) => (x < from ? [(from - x) / CELL, 3] : x > to ? [(x - to) / CELL, 2] : [0, 1]);
	let near = 0;
	let far = 0;
	for (const x of ROW) {
		const at = stepAt(room, [x, PLANK]);
		const [off, ramp] = offOf(at.x);
		const want = off <= ramp ? BRIDGE.height * (1 - off / ramp) : 0;
		assert.ok(Math.abs(at.lift - want) < 1e-12, `at ${x - BRIDGE.x}: ${at.lift} vs ${want}`);
		if (want > 0 && at.x < from) near += 1;
		if (want > 0 && at.x > to) far += 1;
	}
	assert.equal(near, 3 * 8 - 1, 'lifted up to 3 cells before the deck (23 eighths, 0 at the foot)');
	assert.equal(far, 2 * 8 - 1, 'and up to 2 cells after it (15 eighths)');
});

/** The fisherman's water solids of a level, and its bridges' zones. */
const waterOf = (game) => {
	const ids = new Set(
		game.online.rules.zones
			.filter(
				(r) =>
					r.solid === true &&
					r.characters?.join() === 'fisherman' &&
					/Water\d*Fisherman$/.test(r.zone),
			)
			.map((r) => r.zone),
	);
	return game.zones.filter((z) => ids.has(z.id));
};
const area = (r) => r.w * r.h;
const overlap = (a, b) => {
	const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
	const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
	return w > 0 && h > 0 ? w * h : 0;
};
/** Each band's water, less the solids, is exactly the holes' part of it: the holes are cut there. */
const assertHoles = (game, holes, what) => {
	const solids = waterOf(game);
	for (const h of holes)
		for (const s of solids) assert.equal(overlap(s, h), 0, `${what}: ${s.id} in a hole`);
	river.bands.forEach((band, i) => {
		const water = { x: band.left, y: band.y, w: band.right - band.left, h: band.h };
		const solid = solids
			.filter((s) => s.id.startsWith(`band${i}Water`))
			.reduce((a, s) => a + area(s), 0);
		const open = holes.reduce((a, h) => a + overlap(water, h), 0);
		assert.ok(Math.abs(solid + open - area(water)) < 1e-6, `${what}: band ${i}`);
	});
};
const holeOf = (b, near, far) => ({
	x: b.x - near * CELL,
	y: b.y - FISHER.y,
	w: b.w + (near + far) * CELL,
	h: CELL + 2 * FISHER.y,
});

check('the water opens over the deck and its ramps: 2 and 2, 3 and 2, the deck, none', () => {
	assertHoles(
		levelOf(undefined),
		river.bridges.map((b) => holeOf(b, 2, 2)),
		'today',
	);
	const asym = levelOf(bridgeProps({ ramp: { near: 3, far: 2 } }));
	assertHoles(
		asym,
		river.bridges.map((b) => holeOf(b, 3, 2)),
		'near 3, far 2',
	);
	for (const r of asym.online.rules.zones.filter((z) => z.kind === 'bridge'))
		assert.deepEqual(r.ramp, { near: 3, far: 2 }, 'on the zone rule');
	assertHoles(levelOf(bridgeProps({ hole: 'none' })), [], 'none');
	const deck = levelOf(bridgeProps({ hole: 'deck' }));
	assertHoles(
		deck,
		river.bridges.map((b) => holeOf(b, 0, 0)),
		'the deck',
	);
	// A generated bridge spans its water, so a ramp's hole is on the bank; a bridge shorter than
	// its water (four cells in from each bank) has its ramps over the water, and there the longer
	// near ramp opens a cell more of it.
	const short = {
		...river,
		bridges: river.bridges.map((b) => ({ ...b, x: b.x + 4 * CELL, w: b.w - 8 * CELL })),
	};
	const cut = (props) => {
		const g = salmonsGeometry(short, props);
		return { zones: g.zones, online: { rules: { zones: g.zoneRules } } };
	};
	const holesOf = (near, far) => short.bridges.map((b) => holeOf(b, near, far));
	const shortWith = (fields) => cut(bridgeProps(fields));
	assertHoles(cut(), holesOf(2, 2), 'a short bridge, today');
	assertHoles(shortWith({ ramp: { near: 3, far: 2 } }), holesOf(3, 2), 'a short bridge, 3 and 2');
	assertHoles(shortWith({ ramp: { near: 2, far: 3 } }), holesOf(2, 3), 'a short bridge, 2 and 3');
	const solidArea = (game) => waterOf(game).reduce((a, z) => a + area(z), 0);
	const opened = solidArea(cut()) - solidArea(shortWith({ ramp: { near: 3, far: 2 } }));
	assert.ok(opened > 0, `the near ramp's extra cell is opened (${opened} px²)`);
	assertHoles(shortWith({ hole: 'deck' }), holesOf(0, 0), 'a short bridge, the deck');
	assert.ok(solidArea(cut()) < solidArea(shortWith({ hole: 'deck' })), 'the deck alone opens less');
	assert.ok(solidArea(shortWith({ hole: 'deck' })) < solidArea(shortWith({ hole: 'none' })));
});

check('a snap and a height', () => {
	const tight = roomWith(bridgeProps({ snap: 0.25 }), 'fisherman');
	const mid = BRIDGE.x + BRIDGE.w / 2;
	assert.deepEqual(
		liftsAt(tight, [
			[mid, PLANK + CELL / 4],
			[mid, PLANK + CELL / 4 + 1],
		]),
		[6, 0],
	);
	const plain = roomWith(undefined, 'fisherman');
	assert.deepEqual(liftsAt(plain, [[mid, PLANK + CELL / 4 + 1]]), [6]);
	const low = roomWith(bridgeProps({ height: 3 }), 'fisherman');
	assert.deepEqual(liftsAt(low, [[mid, PLANK]]), [3]);
	assert.ok(
		levelOf(bridgeProps({ height: 3 }))
			.zones.filter((z) => /^bridge\d+$/.test(z.id))
			.every((z) => z.height === 3),
	);
});

check('a solid in the deck’s cells stops a fisherman; one for bears stops a bear, not him', () => {
	const n = Math.round(BRIDGE.w / CELL);
	// A post on the row, a cell past the far end of the deck: on the far ramp.
	const post = { x: n + 1, y: 0, w: 0.5, h: 1, collide: 'solid' };
	const walk = (props, character, at, move, steps) => {
		const room = roomWith(props, character);
		Object.assign(room.p.body, at);
		room.run(steps, move);
		return room.p.body;
	};
	const across = (props) =>
		walk(props, 'fisherman', { x: BRIDGE.x + CELL, y: PLANK }, { moveX: MOVE_SCALE, moveY: 0 }, 200)
			.x;
	const wall = BRIDGE.x + (n + 1) * CELL - FISHER.x;
	assert.ok(across(undefined) > wall + 2 * CELL, 'with none he walks off the far ramp');
	assert.ok(Math.abs(across(bridgeProps({ solids: [post] })) - wall) < 1e-6, 'the post stops him');
	assert.ok(
		across(bridgeProps({ solids: [{ ...post, characters: ['bear'] }] })) > wall + 2 * CELL,
		'a bears-only post does not',
	);
	const level = levelOf(bridgeProps({ solids: [post] }));
	const zone = level.zones.find((z) => z.id === 'bridge1Solid0');
	assert.deepEqual(zone, {
		id: 'bridge1Solid0',
		x: BRIDGE.x + (n + 1) * CELL,
		y: BRIDGE.y,
		w: CELL / 2,
		h: CELL,
	});
	assert.deepEqual(
		level.online.rules.zones.find((r) => r.zone === 'bridge1Solid0'),
		{ zone: 'bridge1Solid0', solid: true, characters: ['fisherman'] },
	);
	// Q4: a low bridge a bear cannot pass under, by `solids[].characters`.
	const low = { x: 0, y: 0, w: n, h: 1, collide: 'solid', characters: ['bear'] };
	const up = (props) =>
		walk(
			props,
			'bear',
			{ x: BRIDGE.x + BRIDGE.w / 2, y: PLANK + 4 * CELL },
			{ moveX: 0, moveY: -MOVE_SCALE },
			120,
		).y;
	assert.ok(up(undefined) < BRIDGE.y, 'with none a bear passes under');
	assert.ok(
		Math.abs(up(bridgeProps({ solids: [low] })) - (BRIDGE.y + CELL + 46)) < 1e-6,
		'the low bridge stops it',
	);
});

// ── §3 the seed bridge ───────────────────────────────────────────────────────────────────────

const seedDef = (id) => PROP_COMPONENTS.find((d) => d.id === id);
/** Every node of a def's tree with the band it draws in (its own, else its parent's). */
const banded = (root) => {
	const out = [];
	const walk = (node, inherited) => {
		const band = node.propDepth ?? inherited;
		out.push({ node, band });
		for (const child of node.children ?? []) walk(child, band);
	};
	for (const child of root.children) walk(child, root.propDepth);
	return out;
};
const byLabel = (def, label) => banded(def.root).find(({ node }) => node.label === label);

check("the seed compiles to today's bridge, { from, zoneKind }", () => {
	assert.deepEqual(compilePropShape(BRIDGE_PROP_DEF), {
		from: { component: BRIDGE_PROP_IDS.prop, version: BRIDGE_PROP_DEF.version },
		zoneKind: 'bridge',
	});
	assert.deepEqual(propShapeErrors(BRIDGE_PROP_DEF), []);
	assert.deepEqual(normalizeOnlineProps({ 'bridge#': compilePropShape(BRIDGE_PROP_DEF) }), {
		'bridge#': compilePropShape(BRIDGE_PROP_DEF),
	});
});

check(
	"its zone params are engine-provided, its scope the zone, its inputs and sizes the engine's",
	() => {
		const params = new Map(BRIDGE_PROP_DEF.params.map((p) => [p.key, p]));
		const { fromZone } = BRIDGE_PROP_DEF.prop;
		for (const key of [fromZone.length, fromZone.height]) {
			assert.equal(params.get(key)?.kind, 'number', key);
			assert.equal(params.get(key)?.engineProvided, true, key);
			assert.equal(params.get(key)?.default, 6, key);
		}
		assert.equal(BRIDGE_PROP_DEF.signalScope, 'zone');
		assert.deepEqual(
			[params.get('zone')?.kind, params.get('zone')?.engineProvided],
			['string', true],
		);
		assert.deepEqual(
			BRIDGE_PROP_DEF.inputs,
			PROP_INPUTS.map((i) => ({ ...i })),
		);
		assert.deepEqual(BRIDGE_PROP_SIZES, { cell: ART_CELL, k: K, heightUnit: HEIGHT_UNIT });
		assert.deepEqual(BRIDGE_PROP_DEF.prop.preview, { length: 6, height: 6 });
	},
);

check("its bands are §5's at the code bridge's depths", () => {
	const at = (def, label) => {
		const hit = byLabel(def, label);
		return [hit?.band, hit?.node.propZOffset];
	};
	const near = seedDef(BRIDGE_PROP_IDS.deckNear);
	assert.deepEqual(at(BRIDGE_PROP_DEF, 'Reflections'), ['water', undefined]);
	assert.deepEqual(at(BRIDGE_PROP_DEF, 'Near slope'), ['behind', 500]);
	assert.deepEqual(at(BRIDGE_PROP_DEF, 'Far slope'), ['behind', 500]);
	assert.deepEqual(at(BRIDGE_PROP_DEF, 'Deck'), ['sorted', 1100]);
	assert.deepEqual(at(near, 'Pillar'), ['behind', 400]);
	assert.deepEqual(at(near, 'Pillar reflection'), ['water', undefined]);
	assert.deepEqual(at(near, 'Tile'), ['sorted', 1100]);
	assert.deepEqual(at(seedDef(BRIDGE_PROP_IDS.reflection), 'Reflection'), ['water', undefined]);
	for (const def of PROP_COMPONENTS) {
		const loose = banded(def.root).filter(({ band }) => !band);
		assert.deepEqual(
			loose.map(({ node }) => node.id),
			[],
			`${def.id}: every node is in a band`,
		);
	}
});

check("its deck is near / middle / far cells, pillared as the code's", () => {
	const deck = BRIDGE_PROP_DEF.root.children.find((n) => n.label === 'Deck');
	assert.equal(deck.kind, 'repeater');
	assert.equal(deck.count.preview, 6);
	assert.deepEqual(deck.variants, {
		first: BRIDGE_PROP_IDS.deckNear,
		middle: BRIDGE_PROP_IDS.deckMiddle,
		last: BRIDGE_PROP_IDS.deckFar,
	});
	const middle = seedDef(BRIDGE_PROP_IDS.deckMiddle);
	const layer = middle.stateMachine.layers[0];
	const pillaredMiddle = new Set(
		layer.transitions.filter((t) => t.to === 'pillar').map((t) => t.conditions[0].value),
	);
	const ends = [deck.variants.first, deck.variants.last].map(seedDef);
	assert.ok(
		ends.every((d) => byLabel(d, 'Pillar')),
		'both ends have a pillar',
	);
	for (let n = 1; n <= 30; n++) {
		const seed = [];
		const code = [];
		for (let i = 0; i < n; i++) {
			const index = i + 1;
			const end = index === 1 || index === n;
			if (end || pillaredMiddle.has(index)) seed.push(i);
			if (i === 0 || i === n - 1 || i % 3 === 0) code.push(i);
		}
		assert.deepEqual(seed, code, `a deck of ${n}`);
	}
	assert.deepEqual(
		collectComponentIds([BRIDGE_PROP_DEF.root]).sort(),
		PROP_COMPONENTS.filter((d) => d !== BRIDGE_PROP_DEF)
			.map((d) => d.id)
			.sort(),
	);
});

check('its machines play their own timelines, which key nodes they have', () => {
	const ids = PROP_TIMELINES.map((t) => t.id);
	for (const def of PROP_COMPONENTS) {
		assert.deepEqual(validateStateMachine(def, ids), [], `${def.id}'s machine`);
		for (const layer of def.stateMachine?.layers ?? []) {
			for (const state of layer.states) {
				const doc = PROP_TIMELINES.find((t) => t.id === state.timeline);
				assert.equal(doc?.host?.componentId, def.id, `${def.id}.${state.id}`);
				const host = { id: def.id, name: def.name, nodes: [def.root] };
				assert.deepEqual(validateNodeActors(doc, host), [], doc.id);
			}
		}
	}
	const machine = BRIDGE_PROP_DEF.stateMachine.layers.map((l) => [
		l.entry,
		l.states.map((s) => s.id),
	]);
	assert.deepEqual(machine, [
		['idle', ['idle', 'occupied']],
		['still', ['still', 'stepOn', 'stepOff']],
	]);
	assert.equal(BRIDGE_PROP_DEF.stateMachine.layers[0].states[0].loop, true, 'the ambience loops');
});

check('it is a launcher built-in, not a runtime one, internal, placed by no other built-in', () => {
	const ids = PROP_COMPONENTS.map((d) => d.id);
	const has = (list, id) => list.some((d) => d.id === id);
	assert.ok(ids.every((id) => has(BUILTIN_COMPONENTS, id)));
	assert.ok(ids.every((id) => !has(RUNTIME_BUILTIN_COMPONENTS, id)));
	assert.ok(PROP_TIMELINES.every((t) => has(BUILTIN_TIMELINES, t.id)));
	assert.ok(PROP_TIMELINES.every((t) => !has(RUNTIME_BUILTIN_TIMELINES, t.id)));
	assert.ok(PROP_COMPONENTS.every((d) => d.internal === true && d.scope === 'shared'));
	assert.ok(PROP_COMPONENTS.every((d) => d.category === 'scenery'));
	const placing = RUNTIME_BUILTIN_COMPONENTS.filter((d) =>
		collectComponentIds([d.root]).some((id) => ids.includes(id)),
	);
	assert.deepEqual(
		placing.map((d) => d.id),
		[],
	);
	assert.equal(new Set(BUILTIN_COMPONENTS.map((d) => d.id)).size, BUILTIN_COMPONENTS.length);
});

// ── §2 the side exit (owner, 2026-11-26: a switch, off unless a prop turns it on) ───────────

/** A fisherman's scripted walk: from the near bank across the deck, weaving across the row (two
 *  steps down, two up, three straight, all the while along it), then one pushing off the deck's
 *  side mid-deck. Each step's place and height, to the micro-px. */
const walkTrace = (props) => {
	const room = roomWith(props, 'fisherman');
	const M = MOVE_SCALE;
	const trace = [];
	const note = () =>
		trace.push([room.p.body.x, room.p.body.y, room.p.z].map((v) => Math.round(v * 1e6)));
	Object.assign(room.p.body, { x: BRIDGE.x - 3 * CELL, y: PLANK });
	for (let i = 0; i < 300; i++) {
		const k = i % 7;
		room.run(1, { moveX: M, moveY: k < 2 ? M : k < 4 ? -M : 0 });
		note();
	}
	Object.assign(room.p.body, { x: BRIDGE.x + BRIDGE.w / 2, y: PLANK });
	for (let i = 0; i < 60; i++) {
		room.run(1, { moveX: 0, moveY: M });
		note();
	}
	return trace;
};
const traceHash = (trace) => createHash('sha256').update(JSON.stringify(trace)).digest('hex');

check('side exit off: the walk is today’s, step for step', () => {
	const today = walkTrace(undefined);
	// Recorded with the rule before the switch existed (ca5763e's `bridges`).
	assert.equal(traceHash(today), TODAYS_WALK);
	assert.ok(
		today.some(([, , z]) => z > 0),
		'he was on the bridge',
	);
	for (const props of [bridgeProps({ sideExit: false }), bridgeProps({})])
		assert.ok(isDeepStrictEqual(walkTrace(props), today), JSON.stringify(props));
	assert.deepEqual(compiled({ sideExit: false }), FROM, 'off compiles away');
	assert.deepEqual(compiled({ sideExit: true }), { ...FROM, sideExit: true });
	refusedFor(bridge({ sideExit: 'yes' }), /side exit/);
	assert.deepEqual(normalizeOnlineProps(bridgeProps({ sideExit: false })), bridgeProps({}));
	assert.deepEqual(readPropShapes(bridgeProps({ sideExit: 1 })), bridgeProps({}));
	assert.deepEqual(
		readPropShapes(bridgeProps({ sideExit: true })),
		bridgeProps({ sideExit: true }),
	);
	const rules = levelOf(bridgeProps({ sideExit: true })).online.rules.zones;
	assert.ok(rules.filter((r) => r.kind === 'bridge').every((r) => r.sideExit === true));
	assert.ok(levelOf(undefined).online.rules.zones.every((r) => !('sideExit' in r)));
});

/** A fisherman on the near ramp, a cell and a half before the deck, pushing across the row. */
const pushOffRamp = (props, steps = 40) => {
	const room = roomWith(props, 'fisherman');
	const x = BRIDGE.x - CELL;
	Object.assign(room.p.body, { x, y: PLANK });
	const zs = [];
	for (let i = 0; i < steps; i++) {
		room.run(1, { moveX: 0, moveY: MOVE_SCALE });
		zs.push(room.p.z);
	}
	return { room, zs };
};

check('side exit on: a railing stops him at the rail; none, he steps off and lands', () => {
	// Held: today he never leaves the row, whatever he presses.
	const held = pushOffRamp(undefined);
	assert.equal(held.room.p.body.y, PLANK, 'today: put back on the row');
	assert.ok(held.zs.every((z) => z > 0));
	// Off the side, no railing: he walks off, and is on the ground once past the snap.
	const off = pushOffRamp(bridgeProps({ sideExit: true }));
	assert.ok(off.room.p.body.y > PLANK + CELL, `off the row (${off.room.p.body.y - PLANK})`);
	assert.equal(off.room.p.z, 0, 'landed');
	assert.equal(off.room.p.memo.bridge, 0);
	assert.ok(off.zs[0] > 0, 'on the ramp at first');
	// A railing along the lower side of the deck and both ramps (a tenth of a cell below his body
	// on the row), run on past them further than Salmons' slide carries a body round an end.
	const n = Math.round(BRIDGE.w / CELL);
	const y = (CELL / 2 + FISHER.y) / CELL + 0.1;
	const rail = { x: -8, y, w: n + 16, h: 0.2, collide: 'solid' };
	const railed = pushOffRamp(bridgeProps({ sideExit: true, solids: [rail] }));
	const stop = BRIDGE.y + rail.y * CELL - FISHER.y;
	assert.ok(
		Math.abs(railed.room.p.body.y - stop) < 1e-6,
		`at the rail (${railed.room.p.body.y - stop})`,
	);
	assert.ok(railed.room.p.z > 0, 'still on the ramp');
	// Let go, he is put back on the row.
	railed.room.run(1, { moveX: 0, moveY: 0 });
	assert.equal(railed.room.p.body.y, PLANK);
	// Along the row (moveY 0) he is held on it as ever.
	const along = roomWith(bridgeProps({ sideExit: true }), 'fisherman');
	Object.assign(along.p.body, { x: BRIDGE.x - 3 * CELL, y: PLANK + CELL / 4 });
	along.run(90, { moveX: MOVE_SCALE, moveY: 0 });
	assert.equal(along.p.body.y, PLANK);
});

// ── §4 the prop's inputs from the room's state (`occupied`, `stepOn`, `stepOff`) ──────────────

check(
	'occupied is who the rule carries, from the synced x y z; a step on and off fire once',
	() => {
		for (const props of [undefined, bridgeProps({ ramp: { near: 3, far: 2 }, snap: 0.25 })]) {
			const room = roomWith(props, 'fisherman');
			const said = () => [
				{ x: room.p.body.x, y: room.p.body.y, z: room.p.z, character: 'fisherman' },
			];
			Object.assign(room.p.body, { x: BRIDGE.x - 4 * CELL, y: PLANK });
			let before;
			const fired = { on: [], off: [] };
			for (let i = 0; i < 400 && room.p.body.x < BRIDGE.x + BRIDGE.w + 4 * CELL; i++) {
				room.run(1, { moveX: MOVE_SCALE, moveY: 0 });
				const now = bridgeOccupancy(room.sim.game, said());
				const on = room.p.z > 0 && room.p.memo.bridge === 1;
				assert.equal(now.get('bridge1'), on ? 1 : 0, `step ${i}`);
				for (const [zone, n] of now) if (zone !== 'bridge1') assert.equal(n, 0, zone);
				const steps = occupancySteps(before, now);
				fired.on.push(...steps.on);
				fired.off.push(...steps.off);
				before = now;
			}
			assert.deepEqual(fired, { on: ['bridge1'], off: ['bridge1'] }, JSON.stringify(props));
		}
		// A salmon leaping over the deck is not on it; a fisherman on the ground under it is not either.
		const game = roomWith(undefined, 'fisherman').sim.game;
		const mid = { x: BRIDGE.x + BRIDGE.w / 2, y: PLANK };
		assert.equal(
			bridgeOccupancy(game, [{ ...mid, z: 300, character: 'salmon' }]).get('bridge1'),
			0,
		);
		assert.equal(
			bridgeOccupancy(game, [{ ...mid, z: 0, character: 'fisherman' }]).get('bridge1'),
			0,
		);
		assert.equal(
			bridgeOccupancy(game, [{ ...mid, z: 288, character: 'fisherman' }]).get('bridge1'),
			1,
		);
	},
);

console.log(
	process.exitCode ? `check:prop-shape FAILED` : `check:prop-shape: all ${passed} checks pass`,
);
