// THE SLIDE (owner, 2026-11-24: "add slide to the collision, so a player is not getting stuck"):
// `engine-mechanics` `motion.js` `stepSlide`, the online player's step against a level's solids
// when the game carries `arcade.online.slide`. A body stopped by a solid that ends within
// `slide.corner` of it is carried round that end, so it follows a bank drawn as a stair of boxes and
// rounds a prop's corner; against a flat wall it keeps `stepSolid`'s slide (the part of its move
// along the wall, nothing straight in). It is never carried into a solid, through a one-way solid
// or past the field. The room and a predicting device step the same function on the same level, so
// they agree to the bit. Without the setting every online game plays as before.
//
//   pnpm check:arcade-slide
//
// The drawn half is `scripts/playtest/salmons-slide-play.mjs`.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRng } from '../packages/engine-mechanics/src/board.js';
import { aabbOf, stepSlide, stepSolid } from '../packages/engine-mechanics/src/motion.js';
import { createPredictor, reconcilerOptions } from '../packages/engine-mechanics/src/netcode.js';
import { generatedOnlineGame } from '../packages/engine-mechanics/src/onlineGenerators.js';
import {
	MOVE_SCALE,
	characterBody,
	clampInput,
	moveAgainstSolids,
	onlineLevel,
	stepContext,
	stepPlayer,
} from '../packages/engine-mechanics/src/online.js';
import {
	SALMONS_SLIDE,
	salmonsConfig,
	salmonsRiver,
} from '../packages/engine-mechanics/src/salmons.js';
import { CELL, salmonsMapRiver } from '../packages/engine-mechanics/src/salmonsMap.js';
import {
	ARCADE_SLIDE_LIMITS,
	normalizeGameConfigDoc,
	onlineGameOf,
	playedOnlineGame,
	resolveSlide,
	slideOf,
	validateSlide,
	withSlide,
} from '../packages/game-config/index.ts';
import { createRoomSim } from '../services/game-server/src/roomSim.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
const check = (name, fn) => {
	fn();
	passed++;
	console.log(`  ok  ${name}`);
};

const DT = 1 / 60;
const FIELD = { w: 2000, h: 2000 };
const SLIDE = { corner: 96 };
const wall = (id, x0, y0, x1, y1) => ({
	id,
	shape: 'box',
	x: (x0 + x1) / 2,
	y: (y0 + y1) / 2,
	w: x1 - x0,
	h: y1 - y0,
	solid: true,
});
const swimmer = (x, y) => ({ id: 'b', shape: 'box', x, y, w: 90, h: 44 });
const EPS = 1e-6;
const overlap = (body, solids) => {
	const a = aabbOf(body);
	return solids.find((s) => {
		const b = aabbOf(s);
		return a.x0 + 1e-4 < b.x1 && b.x0 + 1e-4 < a.x1 && a.y0 + 1e-4 < b.y1 && b.y0 + 1e-4 < a.y1;
	});
};

/** `n` steps of a body pushed at `(vx, vy)` px/s: its places, and that it was never in a solid nor
 *  moved further in a step than its push. */
function push(body, vx, vy, n, solids, slide = SLIDE, dt = DT) {
	const path = [];
	const reach = Math.hypot(vx, vy) * dt;
	for (let i = 0; i < n; i++) {
		const from = { x: body.x, y: body.y };
		body.vx = vx;
		body.vy = vy;
		stepSlide(body, dt, solids, FIELD, slide);
		const hit = overlap(body, solids);
		assert.equal(hit, undefined, `step ${i}: inside ${hit?.id} at ${body.x},${body.y}`);
		const moved = Math.hypot(body.x - from.x, body.y - from.y);
		assert.ok(moved <= reach + EPS, `step ${i}: moved ${moved} px on a push of ${reach}`);
		path.push({ x: body.x, y: body.y });
	}
	return path;
}

/** How often a path turned back along an axis. */
const reversals = (path, axis) => {
	let turns = 0;
	let last = 0;
	for (let i = 1; i < path.length; i++) {
		const d = path[i][axis] - path[i - 1][axis];
		if (Math.abs(d) < EPS) continue;
		if (last && Math.sign(d) !== last) turns++;
		last = Math.sign(d);
	}
	return turns;
};

// --- Off: today's output exactly -----------------------------------------------------------------

/** `stepSolid` over seeded scenes of boxes and circles, as recorded on `main` before the slide. */
const STEP_SOLID_ON_MAIN = '4783a653c333db1f300206cf0d7c0cfd';

function solidScenes(stepOf) {
	const rng = createRng('slide-off');
	const hash = createHash('sha256');
	for (let scene = 0; scene < 200; scene++) {
		const solids = Array.from({ length: 6 }, (_, i) =>
			rng() < 0.3
				? {
						id: `s${i}`,
						shape: 'circle',
						x: rng() * 600,
						y: rng() * 600,
						r: 10 + rng() * 40,
						solid: true,
					}
				: wall(`s${i}`, rng() * 500, rng() * 500, 500 + rng() * 100, 500 + rng() * 100),
		);
		const body = {
			id: 'b',
			shape: 'box',
			x: rng() * 600,
			y: rng() * 600,
			w: 20 + rng() * 60,
			h: 20 + rng() * 60,
		};
		const vx = (rng() - 0.5) * 800;
		const vy = (rng() - 0.5) * 800;
		for (let i = 0; i < 40; i++) {
			body.vx = vx;
			body.vy = vy;
			const hit = stepOf(body, DT, solids, { w: 600, h: 600 });
			hash.update(`${body.x},${body.y},${hit.hitX},${hit.hitY};`);
		}
	}
	return hash.digest('hex').slice(0, 32);
}

check(
	'off: stepSolid gives what it gave on main, and stepSlide without a corner is stepSolid',
	() => {
		assert.equal(solidScenes(stepSolid), STEP_SOLID_ON_MAIN, 'stepSolid changed');
		for (const slide of [undefined, {}, { corner: 0 }, { corner: -5 }, { corner: NaN }]) {
			assert.equal(
				solidScenes((b, dt, s, f) => stepSlide(b, dt, s, f, slide)),
				STEP_SOLID_ON_MAIN,
				`stepSlide with ${JSON.stringify(slide)}`,
			);
		}
	},
);

check(
	'off: a level without a slide moves a player as stepSolid does, on the solids in its path',
	() => {
		const zones = [
			{ id: 'a', x: 300, y: 0, w: 60, h: 400 },
			{ id: 'b', x: 300, y: 380, w: 300, h: 60 },
		];
		const rules = zones.map((z) => ({ zone: z.id, solid: true }));
		const level = onlineLevel(zones, rules, 'p', FIELD);
		assert.equal('slide' in level, false, 'no slide on the level');
		assert.equal('slide' in onlineLevel(zones, rules, 'p', FIELD, { corner: 0 }), false);
		const solids = level.solids.shapes.map((s) => s.body);
		const rng = createRng('slide-level');
		for (let i = 0; i < 300; i++) {
			const at = { x: 100 + rng() * 500, y: 100 + rng() * 500 };
			const v = { vx: (rng() - 0.5) * 900, vy: (rng() - 0.5) * 900 };
			const a = { ...swimmer(at.x, at.y), ...v };
			const b = { ...swimmer(at.x, at.y), ...v };
			moveAgainstSolids(a, DT, level.solids, FIELD);
			stepSolid(b, DT, solids, FIELD);
			assert.deepEqual([a.x, a.y], [b.x, b.y], `case ${i}`);
		}
	},
);

// --- A flat wall: the tangential part, and nothing straight in ------------------------------------

/** A wall longer than the corner distance either way of the body. */
const LONG = [wall('long', 0, 0, 2000, 500)];

check('a flat wall: a diagonal push keeps the part along the wall, a straight push stops', () => {
	const v = 300;
	const d = v / Math.SQRT2;
	for (const slide of [SLIDE, { corner: 512 }]) {
		const diag = swimmer(1000, 522);
		const path = push(diag, d, -d, 60, LONG, slide);
		assert.ok(Math.abs(diag.y - 522) < EPS, 'held at the wall');
		assert.ok(
			Math.abs(diag.x - (1000 + d)) < 1e-6,
			`slid ${diag.x - 1000} px in a second, not ${d}`,
		);
		assert.equal(reversals(path, 'x'), 0);
		const flat = swimmer(1000, 522);
		const solid = swimmer(1000, 522);
		push(flat, d, -d, 60, LONG, slide);
		for (let i = 0; i < 60; i++) {
			solid.vx = d;
			solid.vy = -d;
			stepSolid(solid, DT, LONG, FIELD);
		}
		assert.deepEqual([flat.x, flat.y], [solid.x, solid.y], 'as stepSolid slides');
		const straight = swimmer(1000, 522);
		push(straight, 0, -v, 60, LONG, slide);
		assert.deepEqual([straight.x, straight.y], [1000, 522], 'a straight push does not move');
	}
});

check(
	'a wall ahead: a body sliding along a face reaches it, and is not carried back round the end',
	() => {
		// The face's end is within the corner distance behind the body, the wall within it ahead.
		const solids = [wall('floor', 100, 200, 1000, 300), wall('wall', 400, 0, 420, 200)];
		for (const corner of [96, 168, 250]) {
			const body = swimmer(150, 178);
			const path = push(body, 204, 204, 400, solids, { corner });
			assert.deepEqual([body.x, body.y], [355, 178], `corner ${corner}: rests against the wall`);
			assert.equal(reversals(path, 'x') + reversals(path, 'y'), 0, `corner ${corner}: turned back`);
		}
		// From the other side, along a wall towards a floor.
		const upright = [wall('side', 300, 100, 400, 1000), wall('lid', 400, 400, 600, 420)];
		const body = swimmer(445, 950);
		const path = push(body, -204, -204, 400, upright, { corner: 168 });
		assert.deepEqual([body.x, body.y], [445, 442], 'rests under the lid');
		assert.equal(reversals(path, 'x') + reversals(path, 'y'), 0);
	},
);

check(
	'the way round must be free, and an open end ahead is slid to rather than turned from',
	() => {
		// A post stands between the body and the ledge's end; past it the place is free. The other
		// end is further than the corner distance: the body stays where it is.
		const ledge = wall('ledge', 900, 900, 1100, 1000);
		const held = swimmer(1040, 1022);
		push(held, 0, -240, 90, [ledge, wall('post', 1090, 1001, 1096, 1044)], { corner: 168 });
		assert.deepEqual([held.x, held.y], [1040, 1022], 'a post in the way: not carried through it');
		// The ledge ends ahead of a leaning push, a post stands past that end, and the end behind is
		// nearer than the post: the body still slides on to the open end and up past it.
		const short = wall('short', 1000, 900, 1100, 1000);
		const body = swimmer(1010, 1022);
		const path = push(body, 200, -200, 120, [short, wall('far', 1200, 1001, 1206, 1044)], {
			corner: 250,
		});
		const beside = path.find((p) => p.y < 950);
		assert.ok(beside && beside.x >= 1145 - EPS, `passed the ledge at ${beside?.x.toFixed(0)}`);
		assert.equal(reversals(path, 'x'), 0, 'without turning back');
	},
);

check('seeded scenes in a walled box: no body ends up turning back and forth in place', () => {
	const rng = createRng('slide-cycles');
	const box = [
		wall('n', 0, 0, 600, 20),
		wall('s', 0, 580, 600, 600),
		wall('w', 0, 0, 20, 600),
		wall('e', 580, 0, 600, 600),
	];
	let scenes = 0;
	for (let scene = 0; scene < 1500; scene++) {
		const solids = [...box];
		for (let i = 0; i < 6; i++) {
			const x = 20 + Math.floor(rng() * 20) * 24;
			const y = 20 + Math.floor(rng() * 20) * 24;
			const w = 24 * (1 + Math.floor(rng() * 6));
			const h = 24 * (1 + Math.floor(rng() * 6));
			solids.push(wall(`s${i}`, x, y, Math.min(580, x + w), Math.min(580, y + h)));
		}
		const body = { id: 'b', shape: 'box', x: 40 + rng() * 520, y: 40 + rng() * 520, w: 30, h: 20 };
		if (overlap(body, solids)) continue;
		scenes++;
		const dirs = [-1, 0, 1];
		const vx = dirs[Math.floor(rng() * 3)] * 200 + (rng() - 0.5) * 60;
		const vy = dirs[Math.floor(rng() * 3)] * 200 + (rng() - 0.5) * 60;
		const corner = 8 + rng() * 160;
		const path = push(body, vx, vy, 400, solids, { corner });
		// A body that is getting nowhere is at rest, not treading back and forth; one that is
		// getting somewhere does not keep turning back on the way.
		const tail = path.slice(-100);
		const net = Math.hypot(tail.at(-1).x - tail[0].x, tail.at(-1).y - tail[0].y);
		let trod = 0;
		for (let i = 1; i < tail.length; i++)
			trod += Math.hypot(tail[i].x - tail[i - 1].x, tail[i].y - tail[i - 1].y);
		const what = `scene ${scene} (corner ${corner.toFixed(0)}, push ${vx.toFixed(0)},${vy.toFixed(0)})`;
		if (net < 1) assert.ok(trod < 1, `${what}: ${trod.toFixed(1)} px trodden at rest`);
		const turns = reversals(tail, 'x') + reversals(tail, 'y');
		assert.ok(turns <= 4, `${what}: turned back ${turns} times in 100 steps`);
	}
	assert.ok(scenes > 800, `${scenes} scenes played`);
});

// --- A diagonal bank: a stair of boxes -------------------------------------------------------------

/** A left bank that narrows the water going up: step `i` reaches `run` further right, `rise` tall. */
const stair = (run, rise, steps = 12) =>
	Array.from({ length: steps }, (_, i) =>
		wall(`step${i}`, 0, 1900 - (i + 1) * rise - 1, 300 + i * run, 1900 - i * rise),
	);

check('a diagonal bank: pushed up or into it, a body follows the stair at its own speed', () => {
	const v = 288;
	for (const [run, rise] of [
		[48, 48],
		[48, 96],
		[48, 144],
		[24, 48],
	]) {
		const bank = stair(run, rise);
		const slope = Math.hypot(run, rise) / (run + rise);
		for (const [name, vx, vy] of [
			['up', 0, -v],
			['into it', -v / Math.SQRT2, -v / Math.SQRT2],
		]) {
			const body = swimmer(300 + 45, 1900 - rise + 26);
			const from = { x: body.x, y: body.y };
			const path = push(body, vx, vy, 120, bank);
			const gone = Math.hypot(body.x - from.x, body.y - from.y);
			const pushY = Math.abs(vy) * 2;
			assert.ok(
				gone >= pushY * slope * 0.9,
				`${run}/${rise} ${name}: ${gone.toFixed(0)} px in 2 s, under ${(pushY * slope * 0.9).toFixed(0)}`,
			);
			assert.ok(gone <= v * 2 + EPS, `${run}/${rise} ${name}: faster than its push`);
			assert.equal(reversals(path, 'y'), 0, `${run}/${rise} ${name}: turned back along the bank`);
			assert.equal(reversals(path, 'x'), 0, `${run}/${rise} ${name}: turned back across it`);
			const still = swimmer(300 + 45, 1900 - rise + 26);
			push(still, vx, vy, 120, bank, null);
			assert.ok(
				Math.hypot(still.x - from.x, still.y - from.y) < rise + 1,
				`${run}/${rise} ${name}: without the slide it stops under the first step`,
			);
		}
	}
});

check(
	'a bank that faces the push (flatter than 45°) holds a diagonal push, and lets go of a straight one',
	() => {
		const bank = [...stair(96, 48), wall('floor', 0, 1900, 2000, 2000)];
		const into = swimmer(300 + 45, 1900 - 26);
		const path = push(into, -200, -200, 120, bank);
		assert.ok(Math.hypot(into.x - 345, into.y - 1874) < 48, 'held in the corner');
		assert.equal(reversals(path, 'x') + reversals(path, 'y'), 0, 'and not turned back and forth');
		const up = swimmer(300 + 45, 1900 - 26);
		push(up, 0, -288, 120, bank);
		assert.ok(1874 - up.y > 150, `a straight push follows it (${(1874 - up.y).toFixed(0)} px up)`);
	},
);

// --- A prop: its corner, and a round one ------------------------------------------------------------

check('corner rounding: within its distance a body is carried round, beyond it it stops', () => {
	const rock = [wall('rock', 900, 900, 1100, 1000)];
	// The rock's box for the body's centre is 855..1145 across: its right end is 1145.
	for (const [x, rounds] of [
		[1145 - 95, true],
		[1145 - 97, false],
		[855 + 95, true],
		[855 + 97, false],
	]) {
		const body = swimmer(x, 1022);
		push(body, 0, -240, 90, rock);
		assert.equal(
			body.y < 900,
			rounds,
			`from ${x}: ended at ${body.x.toFixed(0)},${body.y.toFixed(0)}`,
		);
		if (!rounds) assert.deepEqual([body.x, body.y], [x, 1022], 'and did not move');
	}
	const clip = swimmer(1145 - 6, 1022);
	const path = push(clip, 0, -240, 30, rock);
	assert.ok(clip.y < 1022 - 240 * 0.5 + 12, 'a clipped corner costs only the way round it');
	assert.ok(path.every((p, i) => !i || Math.abs(p.x - path[i - 1].x) <= 240 * DT + EPS));
	const side = { id: 'b', shape: 'box', x: 1145, y: 1022 - 90, w: 90, h: 44 };
	push(side, -240, 0, 90, rock);
	assert.ok(side.x < 855, 'and from the side, round the nearer end');
});

check('a round prop: a body pushed at it anywhere goes round it, no faster than its push', () => {
	const prop = [{ id: 'log', shape: 'circle', x: 1000, y: 1000, r: 40, solid: true }];
	for (const off of [-80, -40, -1, 0, 1, 40, 80]) {
		const body = swimmer(1000 + off, 1100);
		const path = push(body, 0, -240, 90, prop);
		assert.ok(body.y < 900, `from ${off}: ended at ${body.x.toFixed(0)},${body.y.toFixed(0)}`);
		assert.ok(reversals(path, 'x') <= 0, `from ${off}: turned back`);
		assert.equal(Math.sign(body.x - 1000) || 1, off < 0 ? -1 : 1, 'round the nearer side');
	}
	const diag = swimmer(1100, 1100);
	const path = push(diag, -200, -200, 90, prop);
	assert.ok(diag.x < 915 && diag.y < 1000, 'a diagonal push slides along it and on');
	assert.equal(reversals(path, 'x') + reversals(path, 'y'), 0);
});

check(
	'a drift does not pick the way: a push straight in rounds the nearer end whatever leans on it',
	() => {
		const rock = [wall('rock', 900, 900, 1100, 1000)];
		for (const drift of [-60, 60]) {
			const body = swimmer(1145 - 30, 1022);
			const path = push(body, drift, -240, 90, rock);
			const beside = path.find((p) => p.y < 950);
			assert.ok(
				beside && beside.x >= 1145 - EPS,
				`drift ${drift}: passed at ${beside?.x.toFixed(0)}`,
			);
		}
		// A body carried along a wall by a drift alone is not turned round its end.
		const drifting = swimmer(1145 - 30, 1022);
		push(drifting, -240, -40, 30, rock);
		assert.ok(Math.abs(drifting.y - 1022) < EPS && drifting.x < 1115 - 100, 'it slides on');
	},
);

// --- Never through ---------------------------------------------------------------------------------

check('a large step is taken in parts: no body passes a solid, however long the step', () => {
	const thin = [wall('thin', 0, 990, 2000, 1000)];
	for (const dt of [1 / 60, 0.25, 1, 5]) {
		const body = swimmer(1000, 1200);
		push(body, 0, -600, 3, thin, SLIDE, dt);
		assert.ok(body.y >= 1022 - EPS, `dt ${dt}: at ${body.y}`);
		const diag = swimmer(1000, 1200);
		push(diag, 500, -600, 3, thin, SLIDE, dt);
		assert.ok(diag.y >= 1022 - EPS, `dt ${dt}, diagonal: at ${diag.y}`);
	}
	const edge = swimmer(60, 60);
	push(edge, -900, -900, 5, [], SLIDE, 1);
	assert.deepEqual([edge.x, edge.y], [45, 22], 'held to the field');
});

check(
	'seeded scenes: never inside a solid, never further than the push, never off the field',
	() => {
		const rng = createRng('slide-scenes');
		for (let scene = 0; scene < 300; scene++) {
			const solids = Array.from({ length: 10 }, (_, i) => {
				const x = 200 + Math.floor(rng() * 30) * 48;
				const y = 200 + Math.floor(rng() * 30) * 48;
				return wall(
					`s${i}`,
					x,
					y,
					x + 48 * (1 + Math.floor(rng() * 4)),
					y + 48 * (1 + Math.floor(rng() * 4)),
				);
			});
			const body = swimmer(100 + rng() * 1800, 100 + rng() * 1800);
			if (overlap(body, solids)) continue;
			const dirs = [-1, 0, 1];
			const vx = dirs[Math.floor(rng() * 3)] * 288;
			const vy = dirs[Math.floor(rng() * 3)] * 288;
			const drift = (rng() - 0.5) * 150;
			push(body, vx, vy + drift, 240, solids, { corner: 24 + rng() * 200 });
			const { x0, y0, x1, y1 } = aabbOf(body);
			assert.ok(x0 >= -EPS && y0 >= -EPS && x1 <= FIELD.w + EPS && y1 <= FIELD.h + EPS);
		}
	},
);

// --- Salmons: the level, the room and the device -----------------------------------------------------

const roomOf = (seed, slide = true) => {
	const doc = salmonsConfig(salmonsMapRiver(seed));
	delete doc.arcade.online.bots;
	if (!slide) delete doc.arcade.online.slide;
	return playedOnlineGame(doc);
};
const M = MOVE_SCALE;
const D = Math.round(M * Math.SQRT1_2);
const MOVES = {
	up: [0, -M],
	upLeft: [-D, -D],
	upRight: [D, -D],
	left: [-M, 0],
	right: [M, 0],
	downLeft: [-D, D],
	downRight: [D, D],
	down: [0, M],
};

/** A player of `character` put at `at` in a room of `game`, held on `move` for `seconds`: the px
 *  it made in each second after the first 0.4 s, and where it ended. */
function hold(game, seed, character, at, move, seconds = 3, each = undefined) {
	const sim = createRoomSim(game, { seed });
	const p = sim.join('p', { character });
	Object.assign(p.body, at);
	let seq = 0;
	const run = (n) => {
		for (let i = 0; i < n; i++) {
			seq += 1;
			const [moveX, moveY] = MOVES[move];
			sim.step(() => [clampInput({ seq, view: sim.steps, moveX, moveY, buttons: 0 }, game.field)]);
			each?.(p.body);
		}
	};
	const hz = game.online.tickHz;
	run(Math.round(hz * 0.4));
	const made = [];
	for (let s = 0; s < seconds; s++) {
		const { x, y } = p.body;
		run(hz);
		made.push(Math.hypot(p.body.x - x, p.body.y - y));
	}
	return { made, p, stuck: made.filter((d) => d < CELL / 2).length >= 2 };
}

check(
	"Salmons: the slide is on the original's levels only, and held to the config's limits",
	() => {
		const original = salmonsConfig(salmonsMapRiver(1)).arcade.online;
		assert.deepEqual(original.slide, { corner: SALMONS_SLIDE.corner });
		assert.equal(SALMONS_SLIDE.corner, 3.5 * CELL);
		assert.equal(
			'slide' in salmonsConfig(salmonsRiver(1)).arcade.online,
			false,
			'not the band river',
		);
		assert.deepEqual(roomOf(1).online.slide, { corner: 168 }, 'the game a room plays has it');
		assert.equal('slide' in roomOf(1, false).online, false);
		// The shared normalizer ships in every runtime and drops the block: the slide is read off
		// the raw doc, carried on a save and put on the played game.
		const doc = salmonsConfig(salmonsMapRiver(1));
		const normal = normalizeGameConfigDoc(doc);
		assert.equal('slide' in normal.arcade.online, false, 'the normalizer drops it');
		assert.equal('slide' in onlineGameOf(normal).online, false, 'and the plain game has none');
		assert.deepEqual(withSlide(normal, doc).arcade.online.slide, { corner: 168 }, 'carried');
		assert.equal(withSlide(normal, {}), normal, 'nothing to carry: the doc itself');
		assert.deepEqual(playedOnlineGame(withSlide(normal, doc)).online.slide, { corner: 168 });
		const { min, max } = ARCADE_SLIDE_LIMITS.corner;
		for (const [corner, kept, played] of [
			[0, undefined, undefined],
			[-3, undefined, undefined],
			['12', undefined, undefined],
			[NaN, undefined, undefined],
			[0.5, { corner: 0.5 }, { corner: min }],
			[40, { corner: 40 }, { corner: 40 }],
			[9000, { corner: 9000 }, { corner: max }],
		]) {
			doc.arcade.online.slide = { corner };
			assert.deepEqual(slideOf(doc), kept, `stored ${corner}`);
			assert.deepEqual(resolveSlide(doc), played, `resolved ${corner}`);
			assert.deepEqual(playedOnlineGame(doc).online.slide, played, `played ${corner}`);
			const warned = validateSlide(doc).some((i) => i.path === 'arcade.online.slide.corner');
			assert.equal(warned, corner === 9000 || corner === 0.5, `a warning for ${corner}`);
		}
		for (const none of [undefined, null, {}, { arcade: {} }, { arcade: { online: { slide: 7 } } }])
			assert.equal(slideOf(none), undefined);
	},
);

check(
	'Salmons: a salmon held against a bank or under a rock gets on, where it stuck without the slide',
	() => {
		const tally = (slide) => {
			const count = { bank: 0, bankStuck: 0, rock: 0, rockStuck: 0 };
			for (const seed of [2024, 99]) {
				const river = salmonsMapRiver(seed);
				const game = roomOf(seed, slide);
				const falls = river.waterfalls ?? [];
				const clear = (y, x) =>
					!falls.some((f) => Math.abs(f.y + f.h / 2 - y) < 6 * CELL) &&
					!river.whirlpools.some((w) => Math.hypot(w.x - x, w.y - y) < 6 * CELL) &&
					!river.sandbanks.some(
						(s) => x > s.x - 150 && x < s.x + s.w + 150 && Math.abs(s.y - y) < 300,
					);
				// Above the delta, where the banks are steeper than 45°.
				for (let i = 8; i < river.bands.length - 30; i += 4) {
					const b = river.bands[i];
					for (const [side, move] of [
						['left', 'up'],
						['left', 'upLeft'],
						['right', 'up'],
						['right', 'upRight'],
					]) {
						const x = side === 'left' ? b.left + CELL / 2 + 2 : b.right - CELL / 2 - 2;
						const y = b.y + b.h / 2;
						if (!clear(y - 200, x) || !clear(y, x)) continue;
						const t = hold(game, seed, 'salmon', { x, y }, move, 2);
						if (!clear(t.p.body.y, t.p.body.x)) continue;
						count.bank++;
						if (t.stuck) count.bankStuck++;
					}
				}
				for (const r of river.rocks) {
					const x = r.x + r.w / 2;
					if (!clear(r.y, x) || !clear(r.y - 250, x)) continue;
					for (const off of [0, 30, r.w / 2 + 33]) {
						const t = hold(game, seed, 'salmon', { x: x + off, y: r.y + r.h + 60 }, 'up', 2);
						if (!clear(t.p.body.y, t.p.body.x)) continue;
						count.rock++;
						if (t.stuck) count.rockStuck++;
					}
				}
			}
			return count;
		};
		const off = tally(false);
		const on = tally(true);
		assert.ok(off.bank > 60 && off.rock > 30, `enough cases: ${JSON.stringify(off)}`);
		assert.ok(
			off.bankStuck > off.bank * 0.3,
			`without the slide it sticks: ${JSON.stringify(off)}`,
		);
		assert.ok(off.rockStuck > off.rock * 0.8, `and under rocks: ${JSON.stringify(off)}`);
		assert.ok(on.bankStuck <= on.bank * 0.03, `with it: ${JSON.stringify(on)}`);
		assert.ok(on.rockStuck <= on.rock * 0.05, `with it, rocks: ${JSON.stringify(on)}`);
	},
);

check(
	'Salmons: the slide carries nobody past a waterfall, into the water, over the limit or off the field',
	() => {
		for (const seed of [2024, 7]) {
			const river = salmonsMapRiver(seed);
			const game = roomOf(seed);
			const half = { bear: 46, fisherman: 28 };
			for (const fall of river.waterfalls) {
				const line = fall.y + fall.h / 2;
				const band = river.bands.find((b) => b.y === line);
				if (!band) continue;
				const places = [
					band.left + CELL / 2 + 2,
					(band.left + band.right) / 2,
					band.right - CELL / 2 - 2,
				];
				for (const x of places) {
					for (const move of ['up', 'upLeft', 'upRight', 'left', 'right']) {
						const t = hold(game, seed, 'salmon', { x, y: line + 2 * CELL }, move, 2);
						assert.ok(
							t.p.body.y >= fall.y + fall.h + 22 - 1e-6,
							`seed ${seed}: a salmon held ${move} passed the waterfall at ${line} (y ${t.p.body.y})`,
						);
					}
				}
				const block = game.zones.find(
					(z) => z.id === `waterfall${river.waterfalls.indexOf(fall)}Bear`,
				);
				assert.ok(block, "the bear's block at the waterfall");
				for (const x of [band.left + 40, (band.left + band.right) / 2, band.right - 40]) {
					for (const move of ['up', 'upLeft', 'upRight']) {
						hold(game, seed, 'bear', { x, y: line + 5 * CELL }, move, 3, (body) => {
							const inside =
								body.x + 46 > block.x + 1e-4 &&
								body.x - 46 < block.x + block.w - 1e-4 &&
								body.y + 46 > block.y + 1e-4 &&
								body.y - 46 < block.y + block.h - 1e-4;
							assert.ok(!inside, `seed ${seed}: a bear held ${move} is in the block at ${line}`);
							assert.ok(body.x - 46 >= -EPS && body.y - 46 >= -EPS, 'on the field');
						});
					}
				}
			}
			for (let i = 10; i < river.bands.length - 10; i += 9) {
				const b = river.bands[i];
				for (const [side, s] of [
					['left', -1],
					['right', 1],
				]) {
					const edge = side === 'left' ? b.left : b.right;
					const inward =
						side === 'left' ? ['upRight', 'right', 'downRight'] : ['upLeft', 'left', 'downLeft'];
					const outward =
						side === 'left' ? ['upLeft', 'left', 'downLeft'] : ['upRight', 'right', 'downRight'];
					for (const move of inward) {
						const t = hold(
							game,
							seed,
							'fisherman',
							{ x: edge + s * 80, y: b.y + b.h / 2 },
							move,
							2,
						);
						const { x, y } = t.p.body;
						const at = river.bands.find((k) => y >= k.y && y < k.y + k.h);
						const wet =
							at && x + half.fisherman > at.left + 1e-6 && x - half.fisherman < at.right - 1e-6;
						const bridged = (river.bridges ?? []).some((g) => Math.abs(g.y - y) < 4 * CELL);
						assert.ok(
							!wet || bridged,
							`seed ${seed}: a fisherman held ${move} is in the water at ${x},${y}`,
						);
					}
					for (const character of ['bear', 'fisherman']) {
						for (const move of outward) {
							const start = { x: edge + s * 11 * CELL, y: b.y + b.h / 2 };
							const t = hold(game, seed, character, start, move, 2);
							const { x, y } = t.p.body;
							const at = river.bands.find((k) => y >= k.y && y < k.y + k.h);
							if (!at) continue;
							const limit = 12 * CELL + CELL / 2 + 1e-6;
							const past = side === 'left' ? at.left - x : x - at.right;
							assert.ok(past <= limit, `seed ${seed}: a ${character} is ${past} px past the water`);
						}
					}
				}
			}
		}
	},
);

check(
	'the room and the device step the same slide: a predictor follows the room to the bit',
	() => {
		const seed = 2024;
		const river = salmonsMapRiver(seed);
		const authored = roomOf(seed);
		// The level as a device makes it from the room's seed: every zone rule, where the authored
		// doc is held to the config's limit.
		const { game } = generatedOnlineGame(authored, seed);
		const { online, field } = game;
		assert.deepEqual(online.slide, { corner: 168 }, 'a generated level keeps the slide');
		for (const [character, start, moves] of [
			[
				'salmon',
				(b) => ({ x: b.left + CELL / 2 + 2, y: b.y + b.h / 2 }),
				['upLeft', 'up', 'left', 'upLeft'],
			],
			[
				'salmon',
				(b) => ({ x: b.right - CELL / 2 - 2, y: b.y + b.h / 2 }),
				['upRight', 'up', 'downRight'],
			],
			['fisherman', (b) => ({ x: b.right + 80, y: b.y + b.h / 2 }), ['upLeft', 'downLeft', 'left']],
			['bear', (b) => ({ x: b.right + 11 * CELL, y: b.y + b.h / 2 }), ['upRight', 'downRight']],
		]) {
			for (const i of [20, 41, 62]) {
				const sim = createRoomSim(authored, { seed });
				const p = sim.join('p', { character });
				Object.assign(p.body, start(river.bands[i]));
				const spec = online.characters.find((c) => c.id === character);
				const predictor = createPredictor({
					body: characterBody('p', game.bodies[spec.body], p.body),
					speed: spec.speed,
					ctx: stepContext(online.tickHz, online.subSteps),
					field,
					level: onlineLevel(game.zones, online.rules.zones, character, field, online.slide),
				});
				let seq = 0;
				let rounded = 0;
				for (const move of moves) {
					for (let n = 0; n < 45; n++) {
						seq += 1;
						const [moveX, moveY] = MOVES[move];
						const input = clampInput({ seq, view: sim.steps, moveX, moveY, buttons: 0 }, field);
						sim.step(() => [input]);
						predictor.input(input);
						if (p.status !== 0 || p.held) break;
						const result = predictor.reconcile({
							x: p.body.x,
							y: p.body.y,
							ack: seq,
							step: sim.steps,
						});
						assert.equal(result, 'match', `${character}, band ${i}, ${move}, input ${seq}`);
						rounded += 1;
					}
				}
				assert.ok(rounded > 40, `${character}, band ${i}: compared ${rounded} steps`);
				assert.equal(predictor.corrections, 0);
			}
		}
		// The Colyseus netcode's step takes the level with the slide too.
		const p = { x: 3000, y: 5000, character: 'salmon' };
		const options = reconcilerOptions(game, 'p', p);
		const state = { x: river.bands[20].left + CELL / 2 + 2, y: river.bands[20].y + 30, status: 0 };
		const room = { ...swimmer(state.x, state.y) };
		const level = onlineLevel(game.zones, online.rules.zones, 'salmon', field, online.slide);
		for (let seq = 1; seq <= 60; seq++) {
			const input = clampInput({ seq, moveX: -D, moveY: -D }, field);
			options.step(undefined, state, input);
			stepPlayer(room, input, 288, stepContext(online.tickHz, online.subSteps), field, level);
			assert.deepEqual([state.x, state.y], [room.x, room.y], `reconciler step ${seq}`);
		}
		assert.ok(state.y < river.bands[20].y - 100, 'and it followed the bank');
		for (const [file, used] of [
			['apps/lines/src/game/online.ts', 'game.online.slide'],
			['services/game-server/src/roomSim.ts', 'online.slide'],
			['packages/engine-mechanics/src/netcode.js', 'online.slide'],
		]) {
			assert.ok(readFileSync(join(ROOT, file), 'utf8').includes(used), `${file} passes ${used}`);
		}
	},
);

console.log(`check:arcade-slide — ${passed} checks passed`);
