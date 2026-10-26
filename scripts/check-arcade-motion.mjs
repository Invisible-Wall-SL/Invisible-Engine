// Arcade motion (packages/engine-mechanics/src/motion.js; docs/design/game-families.md §4.2, P10.8):
// the fixed timestep replays the same numbers at any frame rate, overlaps are filtered by tag,
// bodies keep to the field's edges, the broad-phase grid finds exactly what a full test finds, and
// the static index finds the same shapes as a full scan — against the committed trace in
// packages/engine-mechanics/fixtures/arcade-replay.json.
//
// Run: pnpm check:arcade-motion            (--update rewrites the replay fixture)

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRng } from '../packages/engine-mechanics/src/board.js';
import {
	BROAD_PHASE_ABOVE,
	MAX_STEPS_PER_FRAME,
	aabbOf,
	createFixedStep,
	createStaticIndex,
	inZone,
	outsideEdge,
	overlaps,
	queryStatic,
	scanStatic,
	step,
	stepBody,
	touching,
	zonesOf,
} from '../packages/engine-mechanics/src/motion.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPLAY_FIXTURE = join(ROOT, 'packages/engine-mechanics/fixtures/arcade-replay.json');
const UPDATE = process.argv.includes('--update');

let passed = 0;
const check = (name, fn) => {
	try {
		fn();
		passed += 1;
	} catch (e) {
		console.error(`✗ ${name}`);
		throw e;
	}
};

const box = (id, x, y, w, h, extra = {}) => ({
	id,
	shape: 'box',
	w,
	h,
	x,
	y,
	vx: 0,
	vy: 0,
	tags: [],
	...extra,
});
const circle = (id, x, y, r, extra = {}) => ({
	id,
	shape: 'circle',
	r,
	x,
	y,
	vx: 0,
	vy: 0,
	tags: [],
	...extra,
});
const FIELD = { w: 800, h: 600 };

// --- the fixed timestep ---------------------------------------------------------------------

check('fixed step: whole steps only, the rest carried', () => {
	const clock = createFixedStep({ hz: 60 });
	let ran = 0;
	assert.equal(
		clock.advance(10, () => ran++),
		0,
	);
	assert.equal(
		clock.advance(10, () => ran++),
		1,
	);
	assert.equal(ran, 1);
	assert.ok(Math.abs(clock.alpha - (20 - 1000 / 60) / (1000 / 60)) < 1e-9);
	assert.equal(clock.steps, 1);
});

check('fixed step: a hitch runs at most MAX_STEPS_PER_FRAME and drops the backlog', () => {
	const clock = createFixedStep({ hz: 60 });
	let ran = 0;
	assert.equal(
		clock.advance(5000, () => ran++),
		MAX_STEPS_PER_FRAME,
	);
	assert.ok(clock.alpha < 1);
	assert.equal(
		clock.advance(0, () => ran++),
		0,
	);
});

check('fixed step: a bad rate throws; a bad frame adds nothing', () => {
	assert.throws(() => createFixedStep({ hz: 0 }));
	const clock = createFixedStep({ hz: 30 });
	assert.equal(
		clock.advance(Number.NaN, () => {}),
		0,
	);
	assert.equal(
		clock.advance(-50, () => {}),
		0,
	);
});

/**
 * A scripted session: falling hazards and pickups, a player that turns at set steps, on a
 * field of FIELD. Inputs are keyed by STEP, so the same script must reach the same state whatever
 * frame rate feeds the clock.
 */
function session(frameMs, steps = 600, hz = 60) {
	const rng = createRng('arcade-replay');
	const bodies = [box('player', 400, 560, 160, 40, { tags: ['player'] })];
	const clock = createFixedStep({ hz, maxSteps: 1000 });
	const trace = [];
	let serial = 0;
	const touchingNow = new Set();
	const run = (n) => {
		if (n % 12 === 1) {
			serial += 1;
			const kind = serial % 3 === 0 ? 'pickup' : 'hazard';
			bodies.push(
				circle(`${kind}${serial}`, Math.floor(rng() * FIELD.w), -20, 18, {
					tags: [kind],
					vy: 180 + Math.floor(rng() * 120),
					edges: 'pass',
				}),
			);
		}
		const player = bodies[0];
		if (n === 1) player.vx = -260;
		if (n === 90) player.vx = 320;
		if (n === 170) player.vx = 0;
		if (n === 300) player.vx = -150;
		step(bodies, clock.dt, FIELD);
		const hits = overlaps(bodies, [
			['player', 'hazard'],
			['player', 'pickup'],
		]);
		for (const hit of hits) {
			const key = `${hit.a.id}|${hit.b.id}`;
			if (touchingNow.has(key)) continue;
			touchingNow.add(key);
			trace.push({ step: n, hit: key, tagB: hit.tagB });
		}
		for (let i = bodies.length - 1; i >= 1; i--) {
			const edge = outsideEdge(bodies[i], FIELD);
			if (edge) {
				trace.push({ step: n, left: bodies[i].id, edge });
				bodies.splice(i, 1);
			}
		}
	};
	while (clock.steps < steps) {
		const remaining = (steps - clock.steps) * clock.stepMs;
		clock.advance(Math.min(frameMs, remaining + 1e-6), run);
	}
	return {
		steps: clock.steps,
		player: { x: bodies[0].x, y: bodies[0].y },
		alive: bodies.slice(1).map((b) => ({ id: b.id, x: b.x, y: b.y })),
		trace,
	};
}

check('determinism: 30, 60, 144 fps and an uneven frame feed reach the same state', () => {
	const at60 = session(1000 / 60);
	assert.equal(at60.steps, 600);
	for (const frame of [1000 / 30, 1000 / 144, 7.3]) assert.deepEqual(session(frame), at60);
});

check('determinism: the session matches the committed replay', () => {
	const run = session(1000 / 60);
	if (UPDATE) {
		writeFileSync(REPLAY_FIXTURE, `${JSON.stringify(run, null, '\t')}\n`);
		console.log(`wrote ${REPLAY_FIXTURE}`);
		return;
	}
	assert.deepEqual(run, JSON.parse(readFileSync(REPLAY_FIXTURE, 'utf8')));
	assert.ok(run.trace.some((t) => t.hit && t.tagB === 'hazard'));
	assert.ok(run.trace.some((t) => t.hit && t.tagB === 'pickup'));
	assert.ok(run.trace.some((t) => t.left && t.edge === 'bottom'));
});

check('determinism: a different rate steps a different dt, the same number of steps', () => {
	const at120 = session(1000 / 120, 600, 120);
	assert.equal(at120.steps, 600);
	assert.notDeepEqual(at120.trace, session(1000 / 60).trace);
});

// --- bounds -----------------------------------------------------------------------------------

check('bounds: clamp (default) keeps a box and a circle wholly inside', () => {
	const b = stepBody(box('b', 790, 5, 40, 20, { vx: 500, vy: -500 }), 1, FIELD);
	assert.deepEqual([b.x, b.y], [780, 10]);
	assert.equal(b.vx, 500);
	const c = stepBody(circle('c', 10, 590, 15, { vx: -100, vy: 100 }), 1, FIELD);
	assert.deepEqual([c.x, c.y], [15, 585]);
	const wide = stepBody(box('w', 0, 300, 2000, 10), 0, FIELD);
	assert.equal(wide.x, 400);
});

check('bounds: wrap carries the centre to the far edge', () => {
	const b = stepBody(box('b', 790, 300, 20, 20, { vx: 20, edges: 'wrap' }), 1, FIELD);
	assert.equal(b.x, 10);
	const c = stepBody(circle('c', 5, 5, 4, { vx: -15, vy: -1210, edges: 'wrap' }), 1, FIELD);
	assert.deepEqual([c.x, c.y], [790, 595]);
});

check(
	'bounds: pass lets a body leave, and outsideEdge names the edge once it is wholly out',
	() => {
		const b = circle('b', 400, 590, 10, { vy: 15, edges: 'pass' });
		stepBody(b, 1, FIELD);
		assert.equal(b.y, 605);
		assert.equal(outsideEdge(b, FIELD), undefined);
		stepBody(b, 1, FIELD);
		assert.equal(outsideEdge(b, FIELD), 'bottom');
		assert.equal(outsideEdge(box('l', -11, 300, 20, 20), FIELD), 'left');
		assert.equal(outsideEdge(box('r', 811, 300, 20, 20), FIELD), 'right');
		assert.equal(outsideEdge(box('t', 300, -11, 20, 20), FIELD), 'top');
	},
);

check('bounds: no field moves freely; no velocity stays put', () => {
	const b = stepBody(box('b', -50, -50, 10, 10, { vx: -10 }), 1);
	assert.deepEqual([b.x, b.y], [-60, -50]);
	const still = stepBody({ id: 's', shape: 'point', x: 3, y: 4, tags: [] }, 1, FIELD);
	assert.deepEqual([still.x, still.y], [3, 4]);
});

// --- touching and overlap by tag ----------------------------------------------------------------

check('touching: box/box, circle/circle, circle/box, point; edges meeting count', () => {
	assert.ok(touching(box('a', 0, 0, 10, 10), box('b', 10, 0, 10, 10)));
	assert.ok(!touching(box('a', 0, 0, 10, 10), box('b', 10.01, 0, 10, 10)));
	assert.ok(touching(circle('a', 0, 0, 5), circle('b', 10, 0, 5)));
	assert.ok(!touching(circle('a', 0, 0, 5), circle('b', 7.1, 7.1, 5)));
	assert.ok(touching(circle('a', 0, 0, 5), box('b', 9, 0, 8, 8)));
	assert.ok(!touching(circle('a', 0, 0, 5), box('b', 9, 9, 8, 8)));
	assert.ok(touching(box('b', 9, 0, 8, 8), circle('a', 0, 0, 5)));
	const point = { id: 'p', shape: 'point', x: 1, y: 1, vx: 0, vy: 0, tags: [] };
	assert.ok(touching(point, box('b', 0, 0, 4, 4)));
	assert.ok(!touching(point, box('b', 10, 10, 4, 4)));
});

check('overlap by tag: only the asked pairs, a = the tagA body, ordered by pair then body', () => {
	const bodies = [
		box('e1', 100, 100, 20, 20, { tags: ['enemy'] }),
		box('p', 110, 100, 20, 20, { tags: ['player'] }),
		box('c', 120, 100, 20, 20, { tags: ['pickup'] }),
		box('e2', 105, 105, 20, 20, { tags: ['enemy'] }),
		box('far', 500, 500, 20, 20, { tags: ['enemy'] }),
	];
	const hits = overlaps(bodies, [
		['player', 'enemy'],
		['player', 'pickup'],
	]);
	assert.deepEqual(
		hits.map((h) => [h.a.id, h.b.id, h.tagA, h.tagB]),
		[
			['p', 'e1', 'player', 'enemy'],
			['p', 'e2', 'player', 'enemy'],
			['p', 'c', 'player', 'pickup'],
		],
	);
	assert.deepEqual(overlaps(bodies, []), []);
	assert.deepEqual(overlaps(bodies, [['player', 'ghost']]), []);
});

check('overlap by tag: a same-tag pair reports each couple once; a body with many tags', () => {
	const bodies = [
		box('a', 0, 0, 10, 10, { tags: ['enemy'] }),
		box('b', 5, 0, 10, 10, { tags: ['enemy', 'pickup'] }),
		box('c', 8, 0, 10, 10, { tags: ['enemy'] }),
	];
	assert.deepEqual(
		overlaps(bodies, [['enemy', 'enemy']]).map((h) => `${h.a.id}${h.b.id}`),
		['ab', 'ac', 'bc'],
	);
	assert.deepEqual(
		overlaps(bodies, [['pickup', 'enemy']]).map((h) => `${h.a.id}${h.b.id}`),
		['ba', 'bc'],
	);
});

/** A crowd for the broad phase: n seeded bodies of mixed shapes and tags. */
function crowd(n, seed) {
	const rng = createRng(seed);
	const tags = ['player', 'enemy', 'pickup'];
	return Array.from({ length: n }, (_, i) => {
		const x = rng() * 1600 - 200;
		const y = rng() * 1200 - 200;
		const tag = [tags[Math.floor(rng() * 3)]];
		return rng() < 0.5
			? circle(`c${i}`, x, y, 4 + rng() * 40, { tags: tag })
			: box(`b${i}`, x, y, 4 + rng() * 90, 4 + rng() * 90, { tags: tag });
	});
}
const PAIRS = [
	['player', 'enemy'],
	['player', 'pickup'],
	['enemy', 'enemy'],
];
const hitIds = (hits) => hits.map((h) => `${h.tagA}:${h.a.id}|${h.tagB}:${h.b.id}`);

check('broad phase: above the threshold the grid finds exactly the full test', () => {
	for (const [n, seed] of [
		[BROAD_PHASE_ABOVE + 1, 'g1'],
		[200, 'g2'],
		[600, 'g3'],
	]) {
		const bodies = crowd(n, seed);
		const grid = overlaps(bodies, PAIRS);
		const full = overlaps(bodies, PAIRS, { broadPhaseAbove: Infinity });
		assert.ok(full.length > 0, `${seed} has touches`);
		assert.deepEqual(hitIds(grid), hitIds(full), seed);
		for (const cellSize of [8, 50, 400])
			assert.deepEqual(
				hitIds(overlaps(bodies, PAIRS, { cellSize })),
				hitIds(full),
				`${seed}@${cellSize}`,
			);
	}
});

check('broad phase: a body spanning many cells is paired once', () => {
	const bodies = [
		box('wall', 400, 300, 800, 20, { tags: ['enemy'] }),
		...crowd(BROAD_PHASE_ABOVE + 10, 'g4').map((b) => ({ ...b, tags: ['player'] })),
	];
	const grid = overlaps(bodies, [['player', 'enemy']], { cellSize: 16 });
	const full = overlaps(bodies, [['player', 'enemy']], { broadPhaseAbove: Infinity });
	assert.deepEqual(hitIds(grid), hitIds(full));
	assert.equal(new Set(hitIds(grid)).size, grid.length);
});

// --- static shapes: zones and the grid index ----------------------------------------------------

check('zones: inZone for a box and a circle; zonesOf lists them in index order', () => {
	const zones = [
		{ id: 'bank', x: 0, y: 500, w: 800, h: 100 },
		{ id: 'pool', x: 300, y: 400, w: 200, h: 150 },
	];
	const index = createStaticIndex(zones, 64);
	const salmon = circle('s', 350, 520, 10);
	assert.ok(inZone(salmon, zones[0]) && inZone(salmon, zones[1]));
	assert.deepEqual(zonesOf(salmon, index), ['bank', 'pool']);
	assert.deepEqual(zonesOf(box('b', 100, 300, 10, 10), index), []);
	assert.ok(!inZone(circle('corner', 296, 396, 5), zones[1]));
	assert.ok(inZone(box('edge', 295, 395, 10, 10), zones[1]));
});

check('static index: every query finds the same shapes as a full scan', () => {
	const rng = createRng('static');
	const shapes = Array.from({ length: 1700 }, (_, i) => ({
		id: `s${i}`,
		x: Math.floor(rng() * 6000),
		y: Math.floor(rng() * 4000),
		w: 8 + Math.floor(rng() * 300),
		h: 8 + Math.floor(rng() * 120),
	}));
	for (const cellSize of [32, 128, 500]) {
		const index = createStaticIndex(shapes, cellSize);
		for (let q = 0; q < 300; q++) {
			const body =
				rng() < 0.5
					? circle('q', rng() * 6400 - 200, rng() * 4400 - 200, 2 + rng() * 60)
					: box('q', rng() * 6400 - 200, rng() * 4400 - 200, 2 + rng() * 200, 2 + rng() * 200);
			const area = aabbOf(body);
			assert.deepEqual(
				queryStatic(index, area).map((s) => s.id),
				scanStatic(shapes, area).map((s) => s.id),
				`query ${q} @${cellSize}`,
			);
		}
	}
	assert.throws(() => createStaticIndex(shapes, 0));
});

check('static index: a query touches only the cells it covers', () => {
	const shapes = [
		{ id: 'near', x: 0, y: 0, w: 10, h: 10 },
		{ id: 'far', x: 5000, y: 5000, w: 10, h: 10 },
	];
	const index = createStaticIndex(shapes, 100);
	assert.equal(index.cells.get('0,0')?.length, 1);
	assert.deepEqual(
		queryStatic(index, { x0: 0, y0: 0, x1: 5, y1: 5 }).map((s) => s.id),
		['near'],
	);
});

console.log(`check:arcade-motion — ${passed} checks passed`);
