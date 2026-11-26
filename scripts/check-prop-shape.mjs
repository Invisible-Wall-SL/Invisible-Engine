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
// Run: pnpm check:prop-shape

import assert from 'node:assert/strict';

import {
	PROP_HOLES,
	PROP_SHAPE_DEFAULTS,
	PropShapeError,
	compilePropShape,
	propShapeErrors,
} from '../packages/engine-mechanics/src/propShape.js';
import { BRIDGE_SLOPE } from '../packages/engine-mechanics/src/salmonsRules.js';
import {
	SALMONS_MAP,
	SALMONS_MAP_SEED,
	salmonsMapRiver,
} from '../packages/engine-mechanics/src/salmonsMap.js';
import { salmonsGeometry } from '../packages/engine-mechanics/src/salmons.js';

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

console.log(
	process.exitCode ? `check:prop-shape FAILED` : `check:prop-shape: all ${passed} checks pass`,
);
