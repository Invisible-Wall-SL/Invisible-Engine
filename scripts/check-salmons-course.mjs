// SALMONS' RIVER, SHAPED FROM THE CONFIG (`docs/design/salmons-levels.md` §5): the winding course
// and the waterfalls a config's `arcade.online.levels.river` and `.waterfalls` ask for
// (`engine-mechanics` `salmonsMap.js` `riverCourse`, `levelShape`), over many seeds. A config with
// neither block keeps the river it had, to the byte (hashes recorded from the code before the
// shape existed). Run by `pnpm check:salmons-course`.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { STATUS } from '../packages/engine-mechanics/src/onlineRules.js';
import { BUTTONS, MOVE_SCALE, clampInput } from '../packages/engine-mechanics/src/online.js';
import {
	ONLINE_GENERATORS,
	generatedOnlineGame,
} from '../packages/engine-mechanics/src/onlineGenerators.js';
import {
	SALMONS_BOUNDS,
	SALMONS_LEVELS,
	salmonsConfig,
} from '../packages/engine-mechanics/src/salmons.js';
import {
	CELL,
	RIVER_SHAPE,
	RIVER_SHAPE_LIMITS,
	SALMONS_MAP,
	courseFacts,
	levelOverlay,
	levelShape,
	riverCourse,
	riverHalfWidth,
	salmonsMapRiver,
} from '../packages/engine-mechanics/src/salmonsMap.js';
import { waterfallsOf } from '../packages/engine-mechanics/src/salmonsRules.js';
import { FIELD_DRAWINGS } from '../packages/engine-layout/src/lib/referenceLayouts/salmonsRiver.ts';
import { riverElevation } from '../packages/engine-layout/src/lib/referenceLayouts/salmonsElevation.ts';
import { drawGeneratedLevel } from '../apps/launcher-api/src/lib/editor/generatedLevelCore.ts';
import {
	normalizeGameConfigDoc,
	onlineGameOf as resolveOnlineGame,
} from '../packages/game-config/index.ts';
import { normalizeLevels } from '../packages/game-config/src/family.ts';
import {
	LEVELS_RIVER_DEFAULTS,
	LEVELS_SHAPE_LIMITS,
	levelsShapeOf,
	normalizeShapedLevels,
	shapedOnlineGame,
	validateLevelsShape,
	withLevelsShape,
} from '../packages/game-config/src/levelsShape.ts';
import { onlineGameWithCarry, withOnlineCarry } from '../packages/game-config/src/onlineCarry.ts';
import { createConfigSource } from '../services/game-server/src/configSource.ts';
import { createRoomSim } from '../services/game-server/src/roomSim.ts';

/** A stored config as a room and a device read it: normalized, the levels' shape carried back on
 *  (`levelsShape.ts`), and the game resolved with it. */
const stored = (authored) =>
	withLevelsShape(withOnlineCarry(normalizeGameConfigDoc(authored), authored), authored);
const onlineGameOf = (doc, options) =>
	onlineGameWithCarry(shapedOnlineGame(resolveOnlineGame(doc, options), doc), doc);

let checks = 0;
const check = (name, fn) => {
	fn();
	checks += 1;
	console.log(`  ok  ${name}`);
};
const sha = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);
/** The level a seed makes with `levels` (Salmons' own when none is passed; `null`: no levels). */
const make = (seed, levels = SALMONS_LEVELS) =>
	ONLINE_GENERATORS.salmonsMap.make(seed, levels ?? undefined);

/** A column this many times wider than one slanted reach of the river holds two of them. */
const MERGED = 1.5;

/** The levels the gates run over, each made once. */
const SEEDS = Array.from({ length: 48 }, (_, i) => i + 1);
const rivers = SEEDS.map((seed) => ({ seed, river: make(seed) }));
const facts = rivers.map(({ seed, river }) => ({ seed, river, facts: courseFacts(river) }));
/** A river's columns: its water's first cell and the cell past its last, by column from the source. */
const columnsOf = (river) => {
	const cols = [];
	for (const band of river.bands)
		for (let k = 0; k < band.h / CELL; k++)
			cols.push({ lo: band.left / CELL, hi: band.right / CELL, y: band.y + k * CELL });
	return cols;
};

check('a config from before the shape keeps its river to the byte', () => {
	// Recorded on main at 36b42be, before `riverCourse`: `salmonsMapRiver(seed)`.
	const recorded = {
		1: '75c027348c0b4f2f',
		2: '58d401bbee4d0bba',
		7: 'c02ee1e22b7a0916',
		42: 'd178ca6a86c8924d',
		2024: 'b4bdce0219d3a517',
		31337: 'b1a9454e86947466',
		1959509236: 'd5aa970583e6de0c',
	};
	for (const [seed, hash] of Object.entries(recorded)) {
		assert.equal(sha(salmonsMapRiver(Number(seed))), hash, `seed ${seed}`);
		assert.equal(sha(make(Number(seed), null)), hash, `seed ${seed}, by the generator`);
		assert.equal(sha(make(Number(seed), { seeds: [9] })), hash, `seed ${seed}, seeds pinned`);
	}
	const all = createHash('sha256');
	for (let seed = 100; seed < 400; seed++) all.update(JSON.stringify(salmonsMapRiver(seed)));
	assert.equal(all.digest('hex').slice(0, 16), 'e80679f65eab0937', 'seeds 100 to 399');
	const overlay = {
		add: [
			{ cell: [100, 0], kind: 'waterfall', height: 3 },
			{ cell: [150, 1], kind: 'rock' },
		],
		remove: [[40, 0]],
	};
	assert.equal(sha(salmonsMapRiver(5, overlay)), 'd2f29220ea35a9c3', 'with an overlay');
	assert.equal(levelShape(undefined), undefined);
	assert.equal(levelShape({ seeds: [1], overlays: { '*': overlay } }), undefined);
});

check('a seed makes one river: the same every time, another for another seed', () => {
	for (const { seed, river } of rivers.slice(0, 8)) assert.deepEqual(make(seed), river);
	assert.equal(new Set(rivers.map(({ river }) => sha(river.bands))).size, rivers.length);
	assert.deepEqual(make(7), salmonsMapRiver(7, undefined, levelShape(SALMONS_LEVELS)));
});

check('the river is one run of water a column, 400 columns from the source to the sea', () => {
	for (const { seed, river } of rivers) {
		const cols = columnsOf(river);
		assert.equal(cols.length, SALMONS_MAP.RIVER_LENGTH, `seed ${seed}`);
		cols.forEach((col, i) => {
			assert.equal(col.y, (i + river.grid.sourceRows) * CELL, `seed ${seed}: column ${i} in place`);
			assert.ok(col.hi > col.lo && col.lo * CELL >= 0 && col.hi * CELL <= river.world.w);
		});
	}
});

check('a reach is as wide across its flow as the original river there, bends and all', () => {
	const original = Math.min(...[1, 2, 3, 4].map((s) => courseFacts(salmonsMapRiver(s)).narrowest));
	for (const { seed, facts: f } of facts) {
		assert.ok(
			f.narrowest >= original,
			`seed ${seed}: ${f.narrowest} of the original's width; the original's own river is ${original}`,
		);
		assert.ok(f.passage >= 5, `seed ${seed}: neighbouring columns share ${f.passage} cells`);
	}
});

check(
	'two reaches never merge: a column holds one reach’s water, no wider than its slant makes it',
	() => {
		let worst = 0;
		for (const { seed, river, facts: f } of facts) {
			const cols = columnsOf(river);
			const mid = (i) => (cols[i].lo + cols[i].hi) / 2;
			const slant = (i) => {
				const a = Math.max(0, i - 2);
				const b = Math.min(cols.length - 1, i + 2);
				return Math.hypot(1, (mid(a) - mid(b)) / (b - a));
			};
			for (let i = 0; i < cols.length; i++) {
				// The steepest the river runs within a width of this column: a bend's corner is as wide
				// as the reach that leaves it.
				const reach = riverHalfWidth(i) + 2;
				let most = 1;
				for (let k = Math.max(0, i - reach); k <= Math.min(cols.length - 1, i + reach); k++)
					most = Math.max(most, slant(k));
				const share = (cols[i].hi - cols[i].lo) / ((2 * riverHalfWidth(i) + 1) * most + 2);
				worst = Math.max(worst, share);
				assert.ok(share <= MERGED, `seed ${seed}: column ${i} is ${share.toFixed(2)} of one reach`);
			}
			assert.ok(f.length >= 440 && f.length <= 600, `seed ${seed}: ${f.length} cells long`);
		}
		console.log(`      (the widest column is ${worst.toFixed(2)} of one reach's water)`);
	},
);

check('every seed has reaches that run the other way across the screen', () => {
	for (const { seed, facts: f } of facts) {
		assert.ok(
			f.screen.mirrored.leftToRight >= 30,
			`seed ${seed}: ${f.screen.mirrored.leftToRight} cells left to right, mirrored`,
		);
		assert.ok(
			f.screen.plain.rightToLeft >= 30,
			`seed ${seed}: ${f.screen.plain.rightToLeft} cells right to left, unmirrored`,
		);
		assert.ok(
			f.across.some((a) => a.cells >= 14),
			`seed ${seed}: a whole reach of it`,
		);
	}
	// The original's river never does.
	for (const seed of [1, 2, 3, 4]) {
		const f = courseFacts(salmonsMapRiver(seed));
		assert.equal(f.screen.mirrored.leftToRight + f.screen.plain.rightToLeft, 0, `seed ${seed}`);
	}
});

check('the bends reach about 140° and are sharpest and densest round the source', () => {
	let most = 0;
	const sharp = { up: 0, down: 0 };
	for (const { seed } of rivers) {
		const { bends } = riverCourse(seed, levelShape(SALMONS_LEVELS));
		const top = Math.max(...bends.map((b) => b.deg));
		assert.ok(top <= 140 + 1e-9, `seed ${seed}: no bend past the sharpest turn (${top})`);
		assert.ok(top >= 125, `seed ${seed}: its sharpest bend turns ${top}°`);
		assert.ok(bends.find((b) => b.deg === top).gx < 120, `seed ${seed}: it is in the upper river`);
		most = Math.max(most, top);
		for (const b of bends) if (b.deg >= 100) sharp[b.gx < 150 ? 'up' : 'down'] += 1;
	}
	assert.ok(most >= 135, `the sharpest of all turns ${most}°`);
	assert.ok(
		sharp.up >= 4 * sharp.down,
		`${sharp.up} sharp bends above column 150, ${sharp.down} below`,
	);
	// As the banks show it (the water rounds a bend's corner): 100° and more on every seed.
	const drawn = facts.map((f) => f.facts.sharpest).sort((a, b) => a - b);
	assert.ok(drawn[0] >= 100 && drawn[drawn.length >> 1] >= 115, `banks: ${drawn[0]}° at least`);
	for (const { seed, facts: f } of facts) {
		const up = f.turns.filter((t) => t.deg >= 90 && t.gx < 150).length;
		const down = f.turns.filter((t) => t.deg >= 90 && t.gx >= 150).length;
		assert.ok(up > down, `seed ${seed}: ${up} sharp bends above column 150, ${down} below`);
	}
});

check(
	'the shape follows its settings: no winding is nearly straight, a gentler turn is gentler',
	() => {
		for (const seed of [1, 2, 3]) {
			const quiet = courseFacts(make(seed, { river: { winding: 0 } }));
			const soft = courseFacts(make(seed, { river: { sharpestTurn: 60 } }));
			const even = riverCourse(seed, levelShape({ river: { sourceBias: 0 } })).bends;
			const shipped = courseFacts(make(seed));
			assert.ok(quiet.length < shipped.length, `seed ${seed}: fewer bends is a shorter swim`);
			assert.equal(soft.across.length, 0, `seed ${seed}: 60° turns never cross the diagonal`);
			assert.ok(soft.sharpest <= 70, `seed ${seed}: ${soft.sharpest}°`);
			assert.ok(
				even.some((b) => b.gx > 200 && b.deg >= 110),
				`seed ${seed}: with no bias the lower river bends as sharply`,
			);
		}
		const shape = levelShape({ river: {} });
		assert.deepEqual(shape.river, { ...RIVER_SHAPE });
		assert.deepEqual(levelShape({ river: { winding: 9, sharpestTurn: -3 } }).river, {
			winding: 1,
			sharpestTurn: 0,
			sourceBias: RIVER_SHAPE.sourceBias,
		});
	},
);

check('waterfalls are as many and as high as the config says, and reach the tall end', () => {
	const { count, heightMin, heightMax } = SALMONS_LEVELS.waterfalls;
	const seen = new Set();
	for (const { seed, river } of rivers) {
		assert.equal(river.waterfalls.length, count, `seed ${seed}`);
		for (const fall of river.waterfalls) {
			assert.ok(
				fall.height >= heightMin && fall.height <= heightMax,
				`seed ${seed}: ${fall.height}`,
			);
			seen.add(fall.height);
		}
	}
	for (let h = heightMin; h <= heightMax; h++) assert.ok(seen.has(h), `a waterfall ${h} high`);
	// The lowest shipped waterfall's cliff is drawn taller than the original's median one.
	const cliff = (h) => riverElevation([{ y: 0, h: 40, height: h }]).steps[0].cliff;
	assert.equal(cliff(heightMin), 168);
	assert.equal(cliff(heightMax), 288);
	// Any count and height the limits allow, on the original's course too.
	for (const seed of [1, 2, 3]) {
		const tall = make(seed, { waterfalls: { count: 3, heightMin: 12, heightMax: 16 } });
		assert.equal(tall.waterfalls.length, 3);
		assert.ok(tall.waterfalls.every((f) => f.height >= 12 && f.height <= 16));
		assert.deepEqual(
			columnsOf(tall).map((c) => [c.lo, c.hi]),
			columnsOf(salmonsMapRiver(seed)).map((c) => [c.lo, c.hi]),
			`seed ${seed}: waterfalls alone leave the original's course`,
		);
		assert.equal(make(seed, { waterfalls: { count: 0 } }).waterfalls.length, 0);
		// A count alone keeps the original's heights; six are the original's own columns.
		assert.deepEqual(
			make(seed, { waterfalls: { count: 6 } }).waterfalls,
			salmonsMapRiver(seed).waterfalls,
		);
		const one = make(seed, { waterfalls: { heightMin: 7, heightMax: 7 } });
		assert.ok(one.waterfalls.every((f) => f.height === 7));
	}
	assert.deepEqual(levelShape({ waterfalls: { heightMin: 9 } }).waterfalls, {
		heightMin: 9,
		heightMax: 9,
	});
	assert.deepEqual(levelShape({ waterfalls: { heightMax: 4 } }).waterfalls, {
		heightMin: 1,
		heightMax: 4,
	});
});

check('a waterfall stands square across a straight run, a band starting on its line', () => {
	let widest = 0;
	for (const { seed, river } of rivers) {
		const cols = columnsOf(river);
		for (const fall of river.waterfalls) {
			const line = fall.y + fall.h / 2;
			assert.ok(
				river.bands.some((b) => b.y === line),
				`seed ${seed}: a band at ${line}`,
			);
			assert.deepEqual([fall.x, fall.w], [0, river.world.w]);
			const gx = line / CELL - river.grid.sourceRows;
			const mid = (i) => (cols[i].lo + cols[i].hi) / 2;
			for (const i of [gx - 1, gx])
				assert.ok(Math.abs(mid(i) - mid(i + 1)) <= 1.5, `seed ${seed}: straight at column ${i}`);
			const wide = (cols[gx].hi - cols[gx].lo) / (2 * riverHalfWidth(gx) + 1);
			widest = Math.max(widest, wide);
			assert.ok(
				wide <= 1.6,
				`seed ${seed}: the waterfall at ${gx} is ${wide.toFixed(2)} widths across`,
			);
		}
	}
	console.log(`      (the widest waterfall is ${widest.toFixed(2)} of the river's width there)`);
});

check('the rules that read a waterfall hold for a tall one', () => {
	const levels = { ...SALMONS_LEVELS, waterfalls: { count: 6, heightMin: 16, heightMax: 16 } };
	const doc = stored(salmonsConfig(salmonsMapRiver(1), { levels }));
	const { game, made } = generatedOnlineGame(onlineGameOf(doc), 3);
	const falls = waterfallsOf(game);
	assert.equal(falls.length, 6);
	for (const fall of falls) {
		assert.equal(fall.top, 16);
		assert.equal(fall.height, 16 * CELL);
		assert.ok(fall.cells && fall.cells.count >= 7, 'its cells across the water');
	}
	// A bear is stopped 1.5 cells from each, whatever its height.
	const bears = game.zones.filter((z) => /^waterfall\d+Bear$/.test(z.id));
	assert.equal(bears.length, 6);
	const tall = bears.map((z) => z.h);
	const { game: low } = generatedOnlineGame(
		onlineGameOf(stored(salmonsConfig(salmonsMapRiver(1), { levels: SALMONS_LEVELS }))),
		3,
	);
	assert.deepEqual(
		tall,
		low.zones.filter((z) => /^waterfall\d+Bear$/.test(z.id)).map((z) => z.h),
	);
	assert.equal(tall[0], 2 * SALMONS_BOUNDS.fallReach * CELL - 2 * 46);
	// The river is raised by every step: 16 cells is a cliff of 432 px and a step of 408.
	const elevation = riverElevation(made.waterfalls);
	assert.equal(elevation.steps[0].cliff, 432);
	assert.equal(elevation.total, 6 * 408);
});

check('salmon start on the water, and bears and fishermen on the banks within their limit', () => {
	for (const { seed, river } of rivers) {
		const cols = columnsOf(river);
		const colAt = (y) => cols[Math.floor(y / CELL) - river.grid.sourceRows];
		assert.ok(river.salmonSpawns.length >= 20, `seed ${seed}: ${river.salmonSpawns.length} places`);
		for (const p of river.salmonSpawns) {
			const col = colAt(p.y);
			assert.ok(p.x > col.lo * CELL + CELL / 2 && p.x < col.hi * CELL - CELL / 2, `seed ${seed}`);
		}
		assert.ok(
			river.botSpawns.length >= 8,
			`seed ${seed}: ${river.botSpawns.length} catcher places`,
		);
		for (const p of river.botSpawns) {
			const col = colAt(p.y);
			const off = Math.max(col.lo * CELL - p.x, p.x - col.hi * CELL) / CELL;
			assert.ok(off > 0, `seed ${seed}: a catcher place on land (${off})`);
			assert.ok(off <= SALMONS_BOUNDS.bank, `seed ${seed}: within the bank limit (${off})`);
			assert.ok(p.x > 0 && p.x < river.world.w, `seed ${seed}: in the world`);
		}
	}
});

check('every cell of the water is reached from where salmon start, a cell at a time', () => {
	for (const { seed, river } of rivers) {
		const cols = columnsOf(river);
		const base = Math.min(...cols.map((c) => c.lo));
		const wide = Math.max(...cols.map((c) => c.hi)) - base;
		const water = (i, y) => i >= 0 && i < cols.length && y >= cols[i].lo && y < cols[i].hi;
		const seen = new Uint8Array(cols.length * wide);
		const start = Math.floor(river.salmonSpawns[0].y / CELL) - river.grid.sourceRows;
		const queue = [[start, Math.floor(river.salmonSpawns[0].x / CELL)]];
		assert.ok(water(...queue[0]), `seed ${seed}: the first spawn is on water`);
		seen[start * wide + queue[0][1] - base] = 1;
		let reached = 0;
		while (queue.length) {
			const [i, y] = queue.pop();
			reached += 1;
			for (const [di, dy] of [
				[1, 0],
				[-1, 0],
				[0, 1],
				[0, -1],
			]) {
				const at = (i + di) * wide + y + dy - base;
				if (!water(i + di, y + dy) || seen[at]) continue;
				seen[at] = 1;
				queue.push([i + di, y + dy]);
			}
		}
		const all = cols.reduce((sum, c) => sum + c.hi - c.lo, 0);
		assert.equal(reached, all, `seed ${seed}: ${reached} of ${all} cells of water reached`);
	}
});

check('rocks, whirlpools, sand and bridges lie in the water of their columns', () => {
	for (const { seed, river } of rivers) {
		const cols = columnsOf(river);
		const colAt = (y) => cols[Math.floor(y / CELL) - river.grid.sourceRows];
		const within = (x, y, what) => {
			const col = colAt(y);
			assert.ok(x >= col.lo * CELL && x <= col.hi * CELL, `seed ${seed}: ${what} at ${x}, ${y}`);
		};
		for (const r of river.rocks) within(r.x + r.w / 2, r.y + r.h / 2, 'a rock');
		for (const p of river.whirlpools) within(p.x, p.y, 'a whirlpool');
		for (const s of river.sandbanks) {
			within(s.x, s.y, 'sand');
			within(s.x + s.w, s.y, 'sand');
		}
		assert.ok(river.bridges.length >= 1, `seed ${seed}: a bridge`);
		for (const b of river.bridges) {
			const col = colAt(b.y);
			assert.deepEqual([b.x, b.x + b.w], [col.lo * CELL, col.hi * CELL], `seed ${seed}: a bridge`);
			assert.ok(
				b.w <= 1.5 * (2 * riverHalfWidth(b.y / CELL - river.grid.sourceRows) + 1) * CELL + CELL,
			);
		}
	}
});

check('an overlay is laid on the shaped level, in its water', () => {
	const levels = {
		...SALMONS_LEVELS,
		overlays: { '*': { add: [{ cell: [100, 0], kind: 'rock' }] } },
	};
	let placed = 0;
	for (const seed of SEEDS.slice(0, 12)) {
		const river = make(seed, levels);
		const course = riverCourse(seed, levelShape(levels));
		const inWater = course.lo(100) <= 0 && course.hi(100) >= 0;
		assert.equal(river.orphans.length, inWater ? 0 : 1, `seed ${seed}`);
		assert.equal(river.rocks.length, make(seed).rocks.length + (inWater ? 1 : 0), `seed ${seed}`);
		placed += inWater ? 1 : 0;
		assert.deepEqual(river, salmonsMapRiver(seed, levelOverlay(levels, seed), levelShape(levels)));
	}
	assert.ok(placed > 0 && placed < 12, 'the cell is water on some seeds and bank on others');
	const fall = make(1, {
		...SALMONS_LEVELS,
		overlays: {
			1: {
				add: [
					{
						cell: [150, riverCourse(1, levelShape(SALMONS_LEVELS)).lo(150)],
						kind: 'waterfall',
						height: 12,
					},
				],
			},
		},
	});
	assert.equal(fall.waterfalls.length, 7);
	assert.ok(fall.waterfalls.some((f) => f.height === 12));
});

check('Game Config carries a valid shape past its normalizer, and ships Salmons’', () => {
	assert.deepEqual({ ...LEVELS_RIVER_DEFAULTS }, { ...RIVER_SHAPE });
	assert.deepEqual(
		JSON.parse(JSON.stringify(LEVELS_SHAPE_LIMITS)),
		JSON.parse(JSON.stringify(RIVER_SHAPE_LIMITS)),
	);
	const plain = JSON.parse(JSON.stringify(SALMONS_LEVELS));
	assert.deepEqual(normalizeShapedLevels(SALMONS_LEVELS), plain);
	assert.deepEqual(normalizeShapedLevels({ river: {} }), { river: {} });
	assert.deepEqual(
		normalizeShapedLevels({
			seeds: [3],
			river: { winding: 2, sharpestTurn: 90, sourceBias: 'x' },
			waterfalls: { count: 2.5, heightMin: 0, heightMax: 12 },
		}),
		{ seeds: [3], river: { sharpestTurn: 90 }, waterfalls: { heightMax: 12 } },
	);
	assert.equal(normalizeShapedLevels({ waterfalls: { count: 99 } }), undefined);
	// The shared normalizer (in every runtime's bundle) drops the shape: it is carried back on.
	assert.equal(normalizeLevels(SALMONS_LEVELS), undefined);
	const authored = salmonsConfig(salmonsMapRiver(1, undefined, levelShape(SALMONS_LEVELS)), {
		levels: { ...SALMONS_LEVELS, seeds: [4] },
	});
	const dropped = normalizeGameConfigDoc(authored);
	assert.deepEqual(dropped.arcade.online.levels, { seeds: [4] });
	const doc = stored(authored);
	assert.deepEqual(doc.arcade.online.levels, { seeds: [4], ...plain });
	assert.deepEqual(stored(doc), doc, 'a stored config read again is the same');
	assert.deepEqual(levelsShapeOf(doc), plain);
	assert.deepEqual(validateLevelsShape(doc), []);
	assert.equal(onlineGameOf(doc).online.levels.river.sharpestTurn, 140);
	assert.deepEqual(resolveOnlineGame(dropped).online.levels, { seeds: [4] });
	// A config with no shape is untouched by the carry.
	const before = normalizeGameConfigDoc(salmonsConfig(salmonsMapRiver(1)));
	assert.equal(withLevelsShape(before, before), before);
	assert.equal(shapedOnlineGame(resolveOnlineGame(before), before).online.levels, undefined);
	const upside = structuredClone(doc);
	upside.arcade.online.levels.waterfalls = { heightMin: 9, heightMax: 3 };
	upside.arcade.online.levels.river.winding = 7;
	const issues = validateLevelsShape(upside).map((i) => i.path);
	assert.deepEqual(issues, [
		'arcade.online.levels.river.winding',
		'arcade.online.levels.waterfalls',
	]);
});

check('a room, a device and /editor make the same shaped level for a seed', () => {
	const doc = stored(salmonsConfig(salmonsMapRiver(1), { levels: SALMONS_LEVELS }));
	const game = onlineGameOf(doc);
	const sim = createRoomSim(game, { seed: 77 });
	const { game: device, made } = generatedOnlineGame(game, 77);
	assert.deepEqual(sim.game.zones, device.zones);
	assert.deepEqual(made, make(77));
	const drawn = drawGeneratedLevel(
		ONLINE_GENERATORS,
		FIELD_DRAWINGS,
		'salmonsMap',
		77,
		game.online.levels,
	);
	assert.deepEqual(drawn.made, made);
	assert.equal(
		drawn.node.children.filter((n) => /^river-waterfall-/.test(n.id)).length,
		made.waterfalls.length,
	);
	// A config without the shape: the same room plays the original's level.
	const before = onlineGameOf(stored(salmonsConfig(salmonsMapRiver(1))));
	assert.deepEqual(generatedOnlineGame(before, 77).made, salmonsMapRiver(77));
});

check(
	'at every corner of the limits a level is whole: water, a bridge, places within the bank limit',
	() => {
		const corners = [];
		for (const winding of [0, 1])
			for (const sharpestTurn of [0, 150])
				for (const sourceBias of [0, 1])
					for (const waterfalls of [{ count: 0 }, { count: 12, heightMin: 16, heightMax: 16 }])
						corners.push({ river: { winding, sharpestTurn, sourceBias }, waterfalls });
		for (const levels of corners)
			for (const seed of [1, 2, 3, 4, 5, 6]) {
				const river = make(seed, levels);
				const what = `${JSON.stringify(levels)} seed ${seed}`;
				const cols = columnsOf(river);
				assert.equal(cols.length, SALMONS_MAP.RIVER_LENGTH, what);
				cols.forEach((col, i) => {
					assert.ok(Number.isFinite(col.lo) && Number.isFinite(col.hi), `${what}: column ${i}`);
					assert.ok(col.hi - col.lo >= 2 * riverHalfWidth(i) + 1 - 1, `${what}: column ${i} wide`);
					if (i)
						assert.ok(
							Math.min(col.hi, cols[i - 1].hi) - Math.max(col.lo, cols[i - 1].lo) >= 5,
							`${what}: columns ${i - 1} and ${i} share water`,
						);
				});
				assert.equal(river.waterfalls.length, levels.waterfalls.count, what);
				assert.ok(river.bridges.length >= 1, `${what}: a bridge`);
				const colAt = (y) => cols[Math.floor(y / CELL) - river.grid.sourceRows];
				for (const p of river.botSpawns) {
					const col = colAt(p.y);
					const off = Math.max(col.lo * CELL - p.x, p.x - col.hi * CELL) / CELL;
					assert.ok(off > 0 && off <= SALMONS_BOUNDS.bank, `${what}: a catcher place ${off} off`);
				}
				for (const p of river.salmonSpawns) {
					const col = colAt(p.y);
					assert.ok(p.x > col.lo * CELL && p.x < col.hi * CELL, `${what}: a salmon place`);
				}
			}
	},
);

await (async () => {
	// The game server's own reader (`configSource.ts`), on the config as the export stores it.
	const dir = mkdtempSync(join(tmpdir(), 'salmons-course-'));
	try {
		const authored = salmonsConfig(salmonsMapRiver(1, undefined, levelShape(SALMONS_LEVELS)), {
			levels: SALMONS_LEVELS,
		});
		writeFileSync(join(dir, 'shaped.json'), JSON.stringify(stored(authored)));
		writeFileSync(
			join(dir, 'plain.json'),
			JSON.stringify(normalizeGameConfigDoc(salmonsConfig(salmonsMapRiver(1)))),
		);
		const load = createConfigSource({ dir });
		const shaped = { game: await load('shaped'), sized: await load('shaped', 10) };
		const plain = { game: await load('plain') };
		check('the game server reads the shape off the stored config, for a test room too', () => {
			const want = JSON.parse(JSON.stringify(SALMONS_LEVELS));
			assert.deepEqual(shaped.game.online.levels, want);
			assert.deepEqual(shaped.sized.online.levels, want);
			assert.equal(plain.game.online.levels, undefined);
			assert.deepEqual(generatedOnlineGame(shaped.game, 9).made, make(9));
			assert.deepEqual(generatedOnlineGame(shaped.sized, 9).made, make(9));
			assert.deepEqual(generatedOnlineGame(plain.game, 9).made, salmonsMapRiver(9));
		});
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
})();

/** A room of 10 as it ships on `seed`, played until a salmon wins or `seconds` pass. */
const playRoom = (seed, levels, seconds) => {
	const doc = stored(salmonsConfig(salmonsMapRiver(1), { levels }));
	const game = onlineGameOf(doc, { size: 10 });
	const sim = createRoomSim(game, { seed });
	const me = sim.join('me', { character: 'bear' });
	let won;
	let stalled = 0;
	let swum = 0;
	const last = new Map();
	for (let i = 0; i < seconds * game.online.tickHz && !won; i++) {
		const events = sim.step(() => [
			clampInput({ seq: i + 1, moveX: 0, moveY: 0, buttons: 0, view: sim.steps }, sim.game.field),
		]);
		won = events.find((e) => e.type === 'roundEnd' && e.winner);
		if (i % game.online.tickHz) continue;
		for (const p of sim.players.values()) {
			if (!p.bot || p.character.id !== 'salmon' || p.status !== STATUS.free || (p.z ?? 0) > 0)
				continue;
			const was = last.get(p.id);
			last.set(p.id, { x: p.body.x, y: p.body.y });
			if (!was) continue;
			swum += 1;
			if (Math.hypot(p.body.x - was.x, p.body.y - was.y) < CELL / 2) stalled += 1;
		}
	}
	return { won, me, sim, stalled: stalled / Math.max(1, swum) };
};

check(
	'bot salmon swim the winding river with its tall waterfalls to the source, and one wins',
	() => {
		for (const seed of [1, 4, 7]) {
			const { won, sim, stalled } = playRoom(seed, SALMONS_LEVELS, 300);
			assert.ok(won, `seed ${seed}: a salmon reached the source within 300 s`);
			assert.ok(sim.players.get(won.winner)?.bot, `seed ${seed}: a bot won`);
			assert.ok(
				stalled < 0.05,
				`seed ${seed}: bot salmon stalled ${(stalled * 100).toFixed(1)} % of the time`,
			);
		}
	},
);

check('a salmon climbs a waterfall 16 cells high by tapping, and swims on over it', () => {
	const levels = { seeds: [5], waterfalls: { count: 1, heightMin: 16, heightMax: 16 } };
	const doc = salmonsConfig(salmonsMapRiver(1), { levels });
	delete doc.arcade.online.bots;
	const sim = createRoomSim(onlineGameOf(stored(doc)), { seed: 5 });
	const river = make(5, levels);
	const fall = river.waterfalls[0];
	assert.equal(fall.height, 16);
	const line = fall.y + fall.h / 2;
	const band = river.bands.find((b) => b.y === line);
	const p = sim.join('p', { character: 'salmon' });
	Object.assign(p.body, { x: (band.left + band.right) / 2, y: line + 2 * CELL });
	let peak = 0;
	let held = true;
	for (let i = 0; i < 20 * sim.game.online.tickHz && p.body.y > line - CELL; i++) {
		// A tap every sixth input: five a second.
		const buttons = i % 6 === 0 ? BUTTONS.jump : 0;
		sim.step(() => [
			clampInput(
				{ seq: i + 1, moveX: 0, moveY: -MOVE_SCALE, buttons, view: sim.steps },
				sim.game.field,
			),
		]);
		peak = Math.max(peak, p.z ?? 0);
		if (p.body.y < line && (p.z ?? 0) < 16 * CELL - 1 && peak < 16 * CELL) held = false;
	}
	assert.ok(held, 'it never passed the line lower than the waterfall');
	assert.ok(peak >= 16 * CELL, `it climbed ${peak / CELL} cells`);
	assert.ok(p.body.y <= line - CELL, `it swam over (y ${p.body.y}, the line ${line})`);
});

console.log(`check:salmons-course — ${checks} checks passed`);
