// Salmons' waterfall heights, the height-aware climb and the raised river, against the original
// game (`GuiltyForever/Salmon-` 41811c2; docs/status/salmons.md):
// - heights: each seed's waterfalls are the original's (`server/mapGenerator.js`: H in 1..8, capped
//   lower towards the sea), recomputed here from the original's formula, and the room's waterfall
//   zones carry them (an overlay `set` re-heights a column);
// - the climb (`engine-mechanics` `salmonsRules`): step for step the original's jump handler and
//   `update` (a tap within 2 cells on the downstream side and below the top lifts 2.4 cells and
//   climbs; while climbing it slides back 0.8 cells/s, is let go at the top, out of reach or at the
//   bottom; otherwise it falls at 20 cells/s²), so the taps to the top of each height 1..8 are the
//   original's at 30 and 60 Hz and three tap rates; no teleport; a room holds a climbing salmon still
//   and lets one at least as high as the waterfall pass over it;
// - the elevation (`engine-layout` `referenceLayouts/salmonsElevation.ts`): the ground at each row
//   is raised by the original's `riverElev(gx)` (the sum of `elevStepFor(H) = 32 + 16·H − 16` old
//   px over the waterfalls at W > gx), × K, for several seeds and after an overlay `set`; `/editor`'s
//   drawing shows each waterfall's step.
//
// Run: pnpm check:salmons-heights

import assert from 'node:assert/strict';

import { seedRandom } from '../packages/engine-mechanics/src/seedrandom.js';
import {
	CELL,
	SALMONS_MAP,
	generateSalmonsMap,
	riverHalfWidth,
	salmonsMapRiver,
} from '../packages/engine-mechanics/src/salmonsMap.js';
import {
	salmonsConfig,
	salmonsGeometry,
	salmonsRiver,
} from '../packages/engine-mechanics/src/salmons.js';
import { BUTTONS, MOVE_SCALE, clampInput } from '../packages/engine-mechanics/src/online.js';
import { STATUS } from '../packages/engine-mechanics/src/abilities.js';
import {
	CLIMB,
	SALMONS_RULES,
	fallHeight,
	fallReachSq,
	waterfallsOf,
} from '../packages/engine-mechanics/src/salmonsRules.js';
import { ONLINE_GENERATORS } from '../packages/engine-mechanics/src/onlineGenerators.js';
import { normalizeGameConfigDoc, onlineGameOf } from '../packages/game-config/index.ts';
import { createRoomSim } from '../services/game-server/src/roomSim.ts';
import {
	HEIGHT_UNIT,
	TILE_H,
	cliffPxFor,
	elevStepFor,
	riverElevation,
} from '../packages/engine-layout/src/lib/referenceLayouts/salmonsElevation.ts';
import { K } from '../packages/engine-layout/src/lib/salmonsArt/scale.ts';
import { FIELD_DRAWINGS } from '../packages/engine-layout/src/lib/referenceLayouts/salmonsRiver.ts';
import { drawGeneratedLevel } from '../apps/launcher-api/src/lib/editor/generatedLevelCore.ts';

let passed = 0;
const check = (name, fn) => {
	try {
		fn();
		passed += 1;
		console.log(`  ok  ${name}`);
	} catch (error) {
		console.error(`✗ ${name}\n${error.message}`);
		process.exitCode = 1;
	}
};
const near = (a, b, eps, what) =>
	assert.ok(Math.abs(a - b) <= eps, `${what}: ${a} is not within ${eps} of ${b}`);

const SEEDS = ['1', '7', '42', 'k3j5h2a1', '2024'];

/** The original's waterfall heights by column (`generateMap`'s `_waterfallH` stream). */
function originalHeights(seed) {
	const rng = seedRandom(`${seed}_waterfallH`);
	const { WATERFALL_HEIGHT_MIN: lo, WATERFALL_HEIGHT_MAX: hi, RIVER_LENGTH } = SALMONS_MAP;
	const columns = [];
	for (let gx = 21; gx < Math.floor(RIVER_LENGTH * 0.7); gx++) if (gx % 40 === 0) columns.push(gx);
	const range = Math.max(1, columns.at(-1) - columns[0]);
	return new Map(
		columns.map((gx) => {
			const cap = Math.max(lo, Math.round(hi - (hi - lo) * ((gx - columns[0]) / range)));
			const min = Math.max(lo, cap - 4);
			return [gx, min + Math.floor(rng() * (cap - min + 1))];
		}),
	);
}

/** Column → height of a map's waterfalls (every cell of a column has its column's). */
const heightsOf = (map) => {
	const out = new Map();
	for (const o of map.obstacles)
		if (o.type === 'waterfall') {
			assert.ok(!out.has(o.x) || out.get(o.x) === o.height, `column ${o.x} has one height`);
			out.set(o.x, o.height);
		}
	return out;
};

/** A cell of the waterfall at column `gx` of `seed`'s level: where an overlay `set` names it. */
const fallCell = (seed, gx) => {
	const o = generateSalmonsMap(String(seed)).obstacles.find(
		(x) => x.type === 'waterfall' && x.x === gx,
	);
	return [o.x, o.y];
};

/** The engine's y of the original's column `gx` (`salmonsMapRiver`'s `yOf`). */
const yOf = (river, gx) => (gx + river.grid.sourceRows) * CELL;

check("each seed's waterfalls are the original's heights, rising towards the source", () => {
	for (const seed of SEEDS) {
		const want = originalHeights(seed);
		assert.deepEqual([...heightsOf(generateSalmonsMap(seed))], [...want], `seed ${seed}`);
		for (const h of want.values()) assert.ok(h >= 1 && h <= 8);
		const gxs = [...want.keys()];
		assert.ok(want.get(gxs[0]) >= 4, `seed ${seed}: the uppermost is at least 8 − 4`);
		assert.ok(want.get(gxs.at(-1)) <= 5, `seed ${seed}: the lowest is at most 1 + 4`);
		const river = salmonsMapRiver(seed);
		assert.deepEqual(
			river.waterfalls.map((f) => [f.y + f.h / 2, f.height]),
			gxs.map((gx) => [yOf(river, gx), want.get(gx)]),
			`seed ${seed}: the engine's river carries them on their lines`,
		);
		const zones = salmonsGeometry(river).zones.filter((z) => z.id.startsWith('waterfall'));
		assert.deepEqual(
			zones.map((z) => fallHeight(z)),
			gxs.map((gx) => want.get(gx)),
			`seed ${seed}: the room's waterfall zones carry them`,
		);
	}
	assert.equal(fallHeight({}), SALMONS_MAP.WATERFALL_HEIGHT_MIN, 'none: the lowest');
});

check('an overlay `set` re-heights a column in the room too', () => {
	const gx = [...originalHeights('7').keys()][1];
	const river = ONLINE_GENERATORS.salmonsMap.make(7, {
		overlays: { 7: { set: [{ cell: fallCell(7, gx), height: 8 }] } },
	});
	const fall = river.waterfalls.find((f) => f.y + f.h / 2 === yOf(river, gx));
	assert.equal(fall.height, 8);
});

// ---------------------------------------------------------------------------------------------
// The climb.

/** The original's climb and fall for one salmon in reach of a waterfall of height `H` (cells),
 *  tapping every `every` ticks: its height after each tick, and the taps it took to the top. */
function originalClimb(H, tickHz, every, ticks) {
	const dt = 1 / tickHz;
	let z = 0;
	let vz = 0;
	let climbing = 0;
	let taps = 0;
	let top;
	const heights = [];
	for (let t = 1; t <= ticks; t++) {
		if (t % every === 0 && z < H) {
			z = Math.min(H, z + 2.4);
			vz = 0;
			climbing = 1;
			taps += 1;
		}
		if (climbing) {
			if (z >= H) {
				z = H;
				vz = 0;
				climbing = 0;
				top ??= taps;
			} else {
				z -= 0.8 * dt;
				vz = 0;
				if (z <= 0) {
					z = 0;
					climbing = 0;
				}
			}
		} else if (z > 0 || vz !== 0) {
			z += vz * dt;
			vz -= 20 * dt;
			if (z <= 0) {
				z = 0;
				vz = 0;
			}
		}
		heights.push(z);
	}
	return { heights, top };
}

const api = {
	STATUS,
	free: (p) => {
		p.status = STATUS.free;
	},
	release: (p) => {
		p.status = STATUS.free;
		p.until = 0;
	},
	score: () => {},
	worth: (_p, points) => points,
};

/** A salmon a cell below a waterfall of height `H` in a room of Salmons' rules, and its events. */
function atFoot(H, tickHz) {
	return atFalls([{ id: 'fall', line: 20, height: H }], tickHz);
}

/** The same, below waterfalls `{ id, line, height }` (in their order), the salmon a cell below
 *  the first's line. */
function atFalls(falls, tickHz = 30) {
	const game = {
		zones: falls.map((f) => ({ id: f.id, x: 0, y: f.line - 20, w: 2000, h: 40, height: f.height })),
		online: {
			tickHz,
			rules: { zones: falls.map((f) => ({ kind: 'waterfall', zone: f.id, solid: 'below' })) },
		},
	};
	const rules = SALMONS_RULES.salmons.create(game, api);
	const salmon = {
		id: 's',
		character: { id: 'salmon' },
		body: { x: 500, y: falls[0].line + CELL, w: 90, h: 44 },
		connected: true,
		status: STATUS.free,
		until: 0,
		mark: false,
		memo: {},
		cooldowns: {},
	};
	const events = [];
	let stamp = 0;
	const world = () => ({
		players: [salmon],
		stamp,
		tickHz,
		round: 1,
		seed: 1,
		emit: (e) => events.push({ stamp, ...e }),
	});
	const step = (down) => {
		stamp += 1;
		rules.input(salmon, { buttons: down ? BUTTONS.jump : 0, moveX: 0, moveY: 0 }, world());
		rules.step(world());
	};
	return { salmon, events, step, rules };
}

for (const tickHz of [30, 60]) {
	for (const every of [2, tickHz / 2, tickHz]) {
		check(
			`at ${tickHz} Hz, a tap every ${every} steps: each height 1..8 climbs as the original's`,
			() => {
				const ticks = tickHz * 8;
				for (let H = 1; H <= 8; H++) {
					const want = originalClimb(H, tickHz, every, ticks);
					const r = atFoot(H, tickHz);
					const heights = [];
					for (let t = 1; t <= ticks; t++) {
						r.step(t % every === 0);
						heights.push((r.salmon.z ?? 0) / CELL);
					}
					heights.forEach((z, i) => near(z, want.heights[i], 1e-9, `H ${H}, step ${i + 1}`));
					const climbed = r.events.filter((e) => e.type === 'climbed');
					if (want.top === undefined) assert.equal(climbed.length, 0, `H ${H}: never tops`);
					else {
						const taps = Math.floor(climbed[0].stamp / every);
						assert.equal(taps, want.top, `H ${H}: the taps to the top`);
					}
					assert.equal(r.salmon.body.y, 20 + CELL, `H ${H}: no teleport`);
					assert.equal(
						r.events.filter((e) => e.type === 'jumped').length,
						0,
						'a climb never leaps',
					);
				}
			},
		);
	}
}

check("the original's numbers, and the taps to the top as fast as one can tap (30 Hz)", () => {
	assert.deepEqual({ ...CLIMB }, { radiusSq: 4, step: 2.4, slidePerSecond: 0.8 });
	const taps = [1, 2, 3, 4, 5, 6, 7, 8].map((H) => originalClimb(H, 30, 2, 300).top);
	assert.deepEqual(taps, [1, 1, 2, 2, 3, 3, 3, 4]);
});

check('a climb left alone slides back to the water at 0.8 cells/s and is let go', () => {
	const r = atFoot(8, 30);
	r.step(true);
	assert.equal(r.salmon.memo.climbing, 1);
	let steps = 1;
	while (r.salmon.memo.climbing === 1 && steps < 1000) {
		r.step(false);
		steps += 1;
	}
	assert.equal(r.salmon.z, 0, 'back on the water');
	let z = 2.4;
	let slides = 0;
	do {
		z -= 0.8 / 30;
		slides += 1;
	} while (z > 0);
	assert.equal(steps, slides, 'the steps of the original slide, from 2.4 cells');
	near(steps, 2.4 / (0.8 / 30), 2, 'about 3 s of slide');
	assert.ok(r.rules.holds(r.salmon) === false, 'let go');
});

check('out of reach it is let go, and falls; on the upstream side a tap does not climb', () => {
	const r = atFoot(8, 30);
	r.step(true);
	r.salmon.body.y = 20 + 3 * CELL;
	r.step(false);
	assert.equal(r.salmon.memo.climbing, 0, 'let go out of reach');
	const z = r.salmon.z;
	r.step(false);
	r.step(false);
	assert.ok(r.salmon.z < z, 'it falls');
	const up = atFoot(8, 30);
	up.salmon.body.y = -CELL / 2;
	up.step(true);
	assert.equal(up.salmon.memo.climbing ?? 0, 0, 'upstream: no climb');
	assert.ok((up.salmon.z ?? 0) > 0, 'it leaps instead');
});

check('a climber is held; one at least as high as a waterfall passes over it', () => {
	const r = atFoot(3, 30);
	const level = {
		currents: { shapes: [] },
		solids: {
			shapes: [
				{ id: 'fall', x: 0, y: 0, w: 2000, h: 40 },
				{ id: 'rock', x: 0, y: 200, w: 40, h: 40 },
			],
			cellSize: 128,
			cells: new Map(),
		},
	};
	assert.equal(r.rules.holds(r.salmon), false);
	assert.equal(r.rules.level(r.salmon, level), level, 'on the water: every solid');
	r.step(true);
	assert.equal(r.rules.holds(r.salmon), true, 'climbing: held still');
	r.salmon.z = 3 * CELL - 1;
	assert.equal(r.rules.level(r.salmon, level), level, 'below the top: still blocked');
	r.salmon.z = 3 * CELL;
	assert.deepEqual(
		r.rules.level(r.salmon, level).solids.shapes.map((s) => s.id),
		['rock'],
		'at the top: the waterfall is not a solid for it',
	);
	const topped = atFoot(3, 30);
	topped.step(true);
	topped.step(false);
	topped.step(true);
	assert.ok(
		topped.events.some((e) => e.type === 'climbed'),
		'topped out',
	);
	topped.step(false);
	topped.step(false);
	assert.ok(topped.salmon.z > 0 && topped.salmon.z < 3 * CELL, 'falling, below the top');
	assert.deepEqual(
		topped.rules.level(topped.salmon, level).solids.shapes.map((s) => s.id),
		['rock'],
		'let go at its top, it passes the waterfall until it is back on the water',
	);
	topped.salmon.z = 0;
	assert.equal(topped.rules.level(topped.salmon, level), level, 'on the water: blocked again');
});

/** A room of Salmons on `seed`'s level, no bots, with the overlay's heights. */
function salmonsRoom(seed, overlay) {
	const doc = salmonsConfig(salmonsMapRiver(seed));
	doc.arcade.online.bots.fillTo = 0;
	if (overlay) doc.arcade.online.levels = { overlays: { [seed]: overlay } };
	const sim = createRoomSim(onlineGameOf(normalizeGameConfigDoc(doc)), { seed });
	sim.join('s', { character: 'salmon' });
	return sim;
}

check('in a room: held at the foot, the taps climb in place, and over it goes', () => {
	const seed = 2024;
	const plain = salmonsMapRiver(seed);
	const gx = [...originalHeights(String(seed)).keys()].at(-1);
	for (const H of [plain.waterfalls.at(-1).height, 8]) {
		const overlay = { set: [{ cell: fallCell(seed, gx), height: H }] };
		const sim = salmonsRoom(seed, overlay);
		const fall = sim.game.zones.find((z) => z.id === `waterfall${plain.waterfalls.length - 1}`);
		assert.equal(fallHeight(fall), H);
		const line = fall.y + fall.h / 2;
		const band = salmonsMapRiver(seed, overlay).bands.find((b) => b.y === line);
		const p = sim.players.get('s');
		Object.assign(p.body, {
			x: Math.round((band.left + band.right) / 2 / CELL) * CELL,
			y: line + 120,
		});
		let seq = 0;
		const run = (steps, buttons) => {
			const events = [];
			for (let i = 0; i < steps; i++) {
				seq += 1;
				const press = typeof buttons === 'function' ? buttons(i) : buttons;
				events.push(
					...sim.step(() => [
						clampInput(
							{ seq, view: sim.steps, moveX: 0, moveY: -MOVE_SCALE, buttons: press },
							sim.game.field,
						),
					]),
				);
			}
			return events;
		};
		run(60, 0);
		const foot = fall.y + fall.h + p.body.h / 2;
		near(p.body.y, foot, 1e-6, `H ${H}: held up at the foot`);
		const events = [];
		let taps = 0;
		while (!events.some((e) => e.type === 'climbed') && taps < 20) {
			events.push(...run(1, BUTTONS.jump));
			taps += 1;
			near(p.body.y, foot, 1e-6, `H ${H}: in place on its tap ${taps}`);
			if (events.some((e) => e.type === 'climbed')) break;
			events.push(...run(1, 0));
			near(p.body.y, foot, 1e-6, `H ${H}: held in place while it climbs (tap ${taps})`);
		}
		assert.equal(taps, originalClimb(H, 30, 2, 300).top, `H ${H}: the original's taps`);
		near(p.z, H * CELL, 1e-9, `H ${H}: let go at the top`);
		run(60, (i) => (i % 2 ? BUTTONS.jump : 0));
		assert.ok(p.body.y < line, `H ${H}: over the waterfall (${p.body.y} < ${line})`);
	}
});

// ---------------------------------------------------------------------------------------------
// The elevation.

/** The original's `riverElev(gx)`: the steps of the waterfalls at W > gx, old px. */
const originalElev = (heights, gx) => {
	let sum = 0;
	for (const [W, H] of heights) if (W > gx) sum += cliffPxFor(H) - TILE_H / 2;
	return sum;
};

check("the old client's sizes: a cliff of 32 + 16·H, a step of half a tile less", () => {
	assert.equal(HEIGHT_UNIT, 16);
	assert.equal(TILE_H, 32);
	assert.equal(cliffPxFor(1), 48);
	assert.equal(elevStepFor(1), 32);
	assert.equal(elevStepFor(8), 144);
	assert.equal(K, 1.5);
});

for (const [name, overlay] of [
	['the generated levels', undefined],
	['an overlay `set` of one waterfall', 'set'],
]) {
	check(`every row is raised as the original's riverElev × K: ${name}`, () => {
		for (const seed of SEEDS) {
			const heights = originalHeights(seed);
			let o;
			if (overlay) {
				const gx = [...heights.keys()][2];
				const was = heights.get(gx);
				heights.set(gx, was === 8 ? 1 : 8);
				o = { set: [{ cell: fallCell(seed, gx), height: heights.get(gx) }] };
			}
			const river = salmonsMapRiver(seed, o);
			const elevation = riverElevation(river.waterfalls);
			for (let gx = -5; gx < SALMONS_MAP.RIVER_LENGTH + 5; gx++) {
				const want = originalElev(heights, gx) * K;
				near(elevation.at(yOf(river, gx)), want, 1e-9, `seed ${seed}, row ${gx}`);
				near(elevation.at(yOf(river, gx) + CELL / 2), want, 1e-9, `seed ${seed}, in row ${gx}`);
			}
			near(elevation.total, originalElev(heights, -1) * K, 1e-9, `seed ${seed}: the source`);
		}
	});
}

check("/editor draws each waterfall's step, and an overlay `set` re-steps it", () => {
	const seed = 42;
	const gx = [...originalHeights(String(seed)).keys()][0];
	const levels = (height) => ({
		overlays: { '*': { set: [{ cell: fallCell(seed, gx), height }] } },
	});
	const cliffs = (height) => {
		const { node } = drawGeneratedLevel(
			ONLINE_GENERATORS,
			FIELD_DRAWINGS,
			'salmonsMap',
			seed,
			levels(height),
		);
		return node.children.filter((c) => c.id.startsWith('river-cliff-')).map((c) => c.height);
	};
	const river = salmonsMapRiver(seed);
	const plain = cliffs(river.waterfalls[0].height);
	assert.deepEqual(
		plain,
		river.waterfalls.map((f) => elevStepFor(f.height) * K),
	);
	const low = cliffs(1);
	assert.equal(low[0], elevStepFor(1) * K);
	assert.deepEqual(low.slice(1), plain.slice(1));
	assert.equal(cliffs(8)[0], elevStepFor(8) * K);
});

check(
	"the climb's cells are the waterfall's column: one per water cell, measured from centres",
	() => {
		for (const seed of [1, 42]) {
			const game = salmonsRoom(seed).game;
			const river = salmonsMapRiver(seed);
			const falls = waterfallsOf(game);
			assert.equal(falls.length, river.waterfalls.length);
			for (const fall of falls) {
				const band = river.bands.find((b) => b.y === fall.line);
				const gx = fall.line / CELL - river.grid.sourceRows;
				assert.deepEqual(fall.cells, { left: band.left, count: 2 * riverHalfWidth(gx) + 1 });
				const y = fall.line + CELL;
				const at = (x) => fallReachSq(fall, { x, y });
				near(at(band.left + CELL / 2), 1, 1e-9, 'on the first cell centre');
				near(at(band.left + 3.5 * CELL), 1, 1e-9, 'on another cell centre');
				near(at(band.left + 3 * CELL), 1.25, 1e-9, 'between two centres');
				near(at(band.left), 1.25, 1e-9, 'the left bank edge, half a cell out');
				near(at(band.right), 1.25, 1e-9, 'the right bank edge, half a cell out');
				near(at(band.left - CELL), 1 + 1.5 ** 2, 1e-9, 'a cell into the left bank: in reach');
				assert.ok(
					at(band.left - 2 * CELL) >= CLIMB.radiusSq,
					'two cells into the bank: out of reach',
				);
				assert.ok(at(band.right + 2 * CELL) >= CLIMB.radiusSq, 'and on the right');
				near(
					fallReachSq(fall, { x: band.left + CELL / 2, y: fall.line + 2 * CELL }),
					4,
					1e-9,
					'along',
				);
			}
		}
	},
);

check('a tap mid-leap within reach climbs from its height: z + 2.4', () => {
	const r = atFoot(8, 30);
	r.salmon.z = 1.3 * CELL;
	r.salmon.memo.vz = 5 * CELL;
	r.step(true);
	near(r.salmon.z / CELL, 1.3 + 2.4 - 0.8 / 30, 1e-9, 'lifted from where it was, then one slide');
	assert.equal(r.salmon.memo.vz, 0, 'the leap is over');
	assert.equal(r.salmon.memo.climbing, 1);
});

check('two waterfalls in reach: the first listed below its top is climbed, then the next', () => {
	const r = atFalls([
		{ id: 'low', line: 20, height: 2 },
		{ id: 'high', line: 44, height: 5 },
	]);
	r.salmon.body.y = 44 + CELL;
	r.step(true);
	assert.deepEqual(
		r.events.filter((e) => e.type === 'climbed').map((e) => e.zone),
		['low'],
		'the low one (listed first) is topped at once',
	);
	r.step(false);
	r.step(true);
	near(r.salmon.z / CELL, 2 + 2.4 - 0.8 / 30, 1e-9, 'the next tap climbs the high one from 2');
	assert.equal(r.salmon.memo.climbing, 1);
});

check('`level` drops the waterfalls a height clears and the one it topped, and no other', () => {
	const r = atFalls([
		{ id: 'a', line: 20, height: 3 },
		{ id: 'b', line: 400, height: 1 },
		{ id: 'c', line: 800, height: 5 },
	]);
	const shapes = ['a', 'b', 'c', 'rock'].map((id, i) => ({ id, x: 0, y: i * 400, w: 2000, h: 40 }));
	const level = { currents: { shapes: [] }, solids: { shapes, cellSize: 128, cells: new Map() } };
	const ids = () => r.rules.level(r.salmon, level).solids.shapes.map((x) => x.id);
	r.step(true);
	r.step(false);
	r.step(true);
	assert.ok(
		r.events.some((e) => e.type === 'climbed' && e.zone === 'a'),
		'topped a',
	);
	r.salmon.z = 1.5 * CELL;
	assert.deepEqual(ids(), ['c', 'rock'], 'b by its height, a as topped');
	r.salmon.z = 0.5 * CELL;
	assert.deepEqual(ids(), ['b', 'c', 'rock'], 'below b: a only');
	r.salmon.memo.vz = -CELL;
	for (let i = 0; i < 30 && r.salmon.z > 0; i++) r.step(false);
	assert.equal(r.salmon.z, 0);
	assert.equal(r.salmon.memo.over, 0, 'landed: the topped one is cleared by the fall');
	assert.deepEqual(ids(), ['a', 'b', 'c', 'rock']);
});

check('a climb when the round ends: let go, on the water, free to swim in the break', () => {
	const doc = salmonsConfig(salmonsMapRiver(2024));
	doc.arcade.online.bots.fillTo = 0;
	const game = onlineGameOf(normalizeGameConfigDoc(doc));
	game.online.rules.round.seconds = 3;
	const sim = createRoomSim(game, { seed: 2024 });
	sim.join('s', { character: 'salmon' });
	const fall = waterfallsOf(sim.game)[0];
	const p = sim.players.get('s');
	Object.assign(p.body, { x: fall.cells.left + 4.5 * CELL, y: fall.line + 120 });
	let seq = 0;
	const run = (n, buttons, moveX = 0, moveY = -MOVE_SCALE) => {
		for (let i = 0; i < n; i++) {
			seq += 1;
			const input = { seq, view: sim.steps, moveX, moveY, buttons };
			sim.step(() => [clampInput(input, sim.game.field)]);
		}
	};
	run(30, 0);
	run(1, BUTTONS.jump);
	assert.equal(p.memo.climbing, 1, 'climbing');
	while (sim.rules.phase === 'running' && sim.steps < 400) run(1, 0, 0, 0);
	assert.equal(sim.rules.phase, 'ended');
	assert.equal(p.memo.climbing ?? 0, 0, 'no longer climbing');
	assert.equal(p.z ?? 0, 0, 'on the water');
	assert.equal(sim.rules.holds(p), false, 'not held');
	const x = p.body.x;
	run(30, 0, MOVE_SCALE, 0);
	assert.ok(p.body.x > x + 100, `it swims (moved ${p.body.x - x} px)`);
});

/** A room of `game`, the salmon at the foot of waterfall `i`: taps to its top and swims on. */
function climbsOver(game, seed, i, river) {
	const sim = createRoomSim(game, { seed });
	sim.join('s', { character: 'salmon' });
	const fall = waterfallsOf(sim.game)[i];
	const band = river.bands.find((b) => b.y === fall.line);
	const rocks = (river.rocks ?? []).filter((r) => r.y < fall.line + 300 && r.y + r.h > fall.line);
	const clear = (x) => rocks.every((r) => x < r.x - 70 || x > r.x + r.w + 70);
	let x = (band.left + band.right) / 2;
	for (let k = 0; !clear(x) && k < 40; k++)
		x = band.left + 60 + ((k * 37) % (band.right - band.left - 120));
	const p = sim.players.get('s');
	Object.assign(p.body, { x, y: fall.line + 120 });
	let seq = 0;
	let climbed = false;
	for (let step = 0; step < 300 && p.body.y > fall.line - 60; step++) {
		seq += 1;
		const input = {
			seq,
			view: sim.steps,
			moveX: 0,
			moveY: -MOVE_SCALE,
			buttons: step >= 40 && step % 2 ? BUTTONS.jump : 0,
		};
		const events = sim.step(() => [clampInput(input, sim.game.field)]);
		climbed ||= events.some((e) => e.type === 'climbed' && e.zone === fall.id);
	}
	return { climbed, over: p.body.y <= fall.line - 60, y: p.body.y, line: fall.line };
}

check('every waterfall of the band river and of the original levels is passed once topped', () => {
	for (const seed of ['salmons-1', 3, 11, 12]) {
		const river = salmonsRiver(seed);
		const doc = salmonsConfig(river);
		doc.arcade.online.bots.fillTo = 0;
		const game = onlineGameOf(normalizeGameConfigDoc(doc));
		river.waterfalls.forEach((_, i) => {
			const r = climbsOver(game, seed, i, river);
			assert.ok(r.climbed && r.over, `salmonsRiver ${seed}, waterfall ${i}: ${JSON.stringify(r)}`);
		});
	}
	for (const seed of [1, 7, 2024]) {
		const river = salmonsMapRiver(seed);
		const game = salmonsRoom(seed).game;
		river.waterfalls.forEach((_, i) => {
			const r = climbsOver(game, seed, i, river);
			assert.ok(r.climbed && r.over, `salmonsMap ${seed}, waterfall ${i}: ${JSON.stringify(r)}`);
		});
	}
});

console.log(`check:salmons-heights — ${passed} checks passed`);
