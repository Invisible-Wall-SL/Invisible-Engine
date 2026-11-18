// SALMONS' LEVELS (docs/design/salmons-levels.md): the original game's generator, ported, makes the
// original's level for a seed; a room, a device and `/editor` make the same level from the same seed;
// an authored overlay lands on top, survives a reseed and is never changed by one; pinned seeds are
// taken in turn and none pinned means a new level per room. A room plays the original's rules on its
// levels: its speeds, a bank that stops a salmon by its centre, a salmon grounded each time it comes
// down on sand, bears in the water stopped by waterfalls, the bank limit and the ends, fishermen
// over bridges, and salmon and catchers spawned at the original's places, picked by the room.
//
//   pnpm check:salmons-levels
//
// The original's output is recorded in `packages/engine-mechanics/fixtures/salmons-map-original.json`
// from `GuiltyForever/Salmon-` 41811c2 with the real `seedrandom` 3.0.5.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { seedRandom } from '../packages/engine-mechanics/src/seedrandom.js';
import {
	CELL,
	SALMONS_MAP_SEED,
	applySalmonsOverlay,
	buildMeanderTable,
	generateSalmonsMap,
	inRiver,
	levelOverlay,
	meanderAt as meanderAtOf,
	riverHalfWidth,
	salmonsMapRiver,
} from '../packages/engine-mechanics/src/salmonsMap.js';
import { salmonsConfig } from '../packages/engine-mechanics/src/salmons.js';
import {
	ONLINE_GENERATORS,
	generatedOnlineGame,
	roomLevelSeed,
} from '../packages/engine-mechanics/src/onlineGenerators.js';
import { FIELD_DRAWINGS } from '../packages/engine-layout/src/lib/referenceLayouts/salmonsRiver.ts';
import { drawGeneratedLevel } from '../apps/launcher-api/src/lib/editor/generatedLevelCore.ts';
import { normalizeGameConfigDoc, onlineGameOf } from '../packages/game-config/index.ts';
import { normalizeLevels } from '../packages/game-config/src/family.ts';
import { validateFamily } from '../packages/game-config/src/familyValidate.ts';
import { createRoomSim } from '../services/game-server/src/roomSim.ts';
import { BUTTONS, MOVE_SCALE, clampInput } from '../packages/engine-mechanics/src/online.js';
import { STATUS } from '../packages/engine-mechanics/src/onlineRules.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = JSON.parse(
	readFileSync(join(ROOT, 'packages/engine-mechanics/fixtures/salmons-map-original.json'), 'utf8'),
);
const sha = (v) => createHash('sha256').update(v).digest('hex').slice(0, 32);

let passed = 0;
const check = (name, fn) => {
	fn();
	passed++;
	console.log(`  ok  ${name}`);
};

const deepFreeze = (o) => {
	if (o && typeof o === 'object') {
		Object.freeze(o);
		for (const v of Object.values(o)) deepFreeze(v);
	}
	return o;
};

check('seedRandom is seedrandom 3.0.5 on the recorded streams', () => {
	for (const [seed, stream] of Object.entries(FIXTURE.streams)) {
		const r = seedRandom(seed);
		assert.deepEqual(
			stream.map(() => r()),
			stream,
			`stream "${seed}"`,
		);
	}
});

check("a seed makes the original's map, piece for piece (and its meander)", () => {
	for (const [seed, want] of Object.entries(FIXTURE.maps)) {
		const map = generateSalmonsMap(seed);
		assert.equal(sha(JSON.stringify(map)), want.sha256, `map "${seed}"`);
		assert.equal(
			sha(JSON.stringify(Array.from(buildMeanderTable(seed)))),
			want.meanderSha256,
			`meander "${seed}"`,
		);
		assert.deepEqual(map.bridges, want.bridges);
	}
	assert.notEqual(
		sha(JSON.stringify(generateSalmonsMap('1'))),
		sha(JSON.stringify(generateSalmonsMap('2'))),
	);
	assert.deepEqual(generateSalmonsMap(7), generateSalmonsMap('7'), 'a number seed is its string');
});

check('the generator is pure: no Math.random, no I/O', () => {
	for (const file of ['salmonsMap.js', 'seedrandom.js']) {
		const code = readFileSync(join(ROOT, 'packages/engine-mechanics/src', file), 'utf8')
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.replace(/\/\/.*$/gm, '');
		assert.doesNotMatch(code, /Math\.random|Date\.now|performance\.now|\bimport\(|node:/, file);
	}
});

const authored = normalizeGameConfigDoc(salmonsConfig(salmonsMapRiver(SALMONS_MAP_SEED)));

check('the Salmons config plays the original generator and validates clean', () => {
	assert.equal(authored.arcade.online.generator, 'salmonsMap');
	const errors = validateFamily(authored).filter((i) => i.severity === 'error');
	assert.deepEqual(errors, []);
});

check('the river sits in the original grid: water is the original water, the spawn swims', () => {
	const river = salmonsMapRiver(42);
	const meander = buildMeanderTable('42');
	const { gyMin, sourceRows } = river.grid;
	const cellAt = (x, y) => [Math.floor(y / CELL) - sourceRows, Math.floor(x / CELL) + gyMin];
	for (const band of river.bands) {
		const [gx0] = cellAt(band.left, band.y);
		for (let gx = gx0; gx < gx0 + band.h / CELL; gx++) {
			assert.ok(inRiver(meander, gx, cellAt(band.left, 0)[1]), `left water ${gx}`);
			assert.ok(inRiver(meander, gx, cellAt(band.right - 1, 0)[1]), `right water ${gx}`);
			assert.ok(!inRiver(meander, gx, cellAt(band.right, 0)[1]), `bank past right ${gx}`);
		}
	}
	const [sgx, sgy] = cellAt(river.spawn.x, river.spawn.y);
	assert.ok(inRiver(meander, sgx, sgy), 'salmon spawn in the water');
	for (const fall of river.waterfalls)
		assert.ok(
			river.bands.some((b) => b.y === fall.y + fall.h / 2),
			'a waterfall sits on a band top (the drawing finds its band)',
		);
	const counts = FIXTURE.maps['42'].counts;
	assert.equal(river.rocks.length, counts.rock);
	assert.equal(river.whirlpools.length, counts.whirlpool);
	assert.equal(
		river.sandbanks.reduce((n, r) => n + r.w / CELL, 0),
		counts.sandbank,
		'every sand cell is in a sandbank',
	);
});

check('a room, a device and /editor make the same level from the same seed', () => {
	const game = onlineGameOf(authored);
	for (const seed of [0, 9, 123456789]) {
		const sim = createRoomSim(game, { seed });
		const device = generatedOnlineGame(game, seed);
		assert.deepEqual(sim.game.zones, device.game.zones, `room vs device zones, seed ${seed}`);
		assert.deepEqual(sim.game.online.rules.zones, device.game.online.rules.zones);
		const editor = drawGeneratedLevel(
			ONLINE_GENERATORS,
			FIELD_DRAWINGS,
			'salmonsMap',
			seed,
			game.online.levels,
		);
		assert.deepEqual(editor.made, device.made, `editor vs device level, seed ${seed}`);
		assert.deepEqual(editor.node, FIELD_DRAWINGS.salmonsMap(device.made), 'drawn alike');
		assert.deepEqual(editor.node.generated, { generator: 'salmonsMap', seed });
		assert.equal(editor.node.locked, true, 'read-only in /editor');
	}
});

const meander = buildMeanderTable('5');
const water = (gx) => {
	for (let gy = -60; gy <= 60; gy++) if (inRiver(meander, gx, gy)) return gy;
	throw new Error(`no water at ${gx}`);
};

check('an overlay adds, removes and re-heights on top of the generated level', () => {
	const base = generateSalmonsMap('5');
	const rock = base.obstacles.find((o) => o.type === 'rock');
	const fall = base.obstacles.find((o) => o.type === 'waterfall');
	const add = [100, water(100) + 1];
	const overlay = deepFreeze({
		add: [{ cell: add, kind: 'whirlpool' }],
		remove: [[rock.x, rock.y]],
		set: [{ cell: [fall.x, fall.y], height: 9 }],
	});
	const { map, orphans } = applySalmonsOverlay(base, overlay, '5');
	assert.deepEqual(orphans, []);
	assert.ok(!map.obstacles.some((o) => o.x === rock.x && o.y === rock.y), 'removed');
	assert.ok(map.obstacles.some((o) => o.x === add[0] && o.y === add[1] && o.type === 'whirlpool'));
	assert.equal(map.obstacles.find((o) => o.x === fall.x && o.y === fall.y).height, 9);
	const plain = salmonsMapRiver(5);
	const over = salmonsMapRiver(5, overlay);
	assert.equal(over.rocks.length, plain.rocks.length - 1);
	assert.equal(over.whirlpools.length, plain.whirlpools.length + 1);
});

check('a waterfall is a whole column: remove, re-height and add act on its column', () => {
	const base = generateSalmonsMap('5');
	const fall = base.obstacles.find((o) => o.type === 'waterfall');
	const column = (map) => map.obstacles.filter((o) => o.type === 'waterfall' && o.x === fall.x);
	const plain = salmonsMapRiver(5);
	const gone = applySalmonsOverlay(base, { remove: [[fall.x, fall.y]] }, '5');
	assert.deepEqual(gone.orphans, []);
	assert.equal(column(gone.map).length, 0, 'one cell removes the column');
	assert.equal(
		salmonsMapRiver(5, { remove: [[fall.x, fall.y]] }).waterfalls.length,
		plain.waterfalls.length - 1,
	);
	const low = applySalmonsOverlay(base, { set: [{ cell: [fall.x, fall.y], height: 1 }] }, '5');
	assert.ok(
		column(low.map).every((o) => o.height === 1),
		'one cell re-heights the column',
	);
	const gx = 150;
	const added = applySalmonsOverlay(
		base,
		{ add: [{ cell: [gx, water(gx)], kind: 'waterfall', height: 3 }] },
		'5',
	);
	const across = added.map.obstacles.filter((o) => o.type === 'waterfall' && o.x === gx);
	assert.equal(across.length, 2 * riverHalfWidth(gx) + 1, 'an added waterfall crosses the river');
	assert.ok(across.every((o) => o.height === 3));
	const river = salmonsMapRiver(5, {
		add: [{ cell: [gx, water(gx)], kind: 'waterfall', height: 3 }],
	});
	assert.equal(river.waterfalls.length, plain.waterfalls.length + 1);
	assert.ok(river.waterfalls.every((f) => river.bands.some((b) => b.y === f.y + f.h / 2)));
});

check('a reseed keeps the overlay: its misses come back as orphans, the overlay unchanged', () => {
	const overlay = deepFreeze({
		add: [
			{ cell: [100, water(100)], kind: 'rock' },
			{ cell: [10, 500], kind: 'rock' },
		],
		remove: [[0, 0]],
	});
	const before = JSON.stringify(overlay);
	const other = salmonsMapRiver(6, overlay);
	assert.equal(JSON.stringify(overlay), before, 'the overlay is never changed');
	assert.ok(
		other.orphans.some((o) => o.op === 'add' && o.cell[1] === 500),
		'off-river add listed',
	);
	assert.ok(
		other.orphans.some((o) => o.op === 'remove'),
		'a removal with nothing there listed',
	);
	const levels = deepFreeze({
		overlays: { '*': overlay, 6: { add: [{ cell: [200, water(200)], kind: 'sandbank' }] } },
	});
	const game = { ...onlineGameOf(authored) };
	game.online = { ...game.online, levels };
	const a = generatedOnlineGame(game, 6).made;
	const b = generatedOnlineGame(game, 7).made;
	assert.deepEqual(a, salmonsMapRiver(6, levelOverlay(levels, 6)), 'seed 6 gets "*" and its own');
	assert.deepEqual(b, salmonsMapRiver(7, overlay), 'seed 7 gets "*" only');
	assert.equal(JSON.stringify(game.online.levels), JSON.stringify(levels));
});

check('pinned seeds are taken in turn; none pinned is a new random level per room', () => {
	const seeds = [11, 22, 33];
	assert.deepEqual(
		[0, 1, 2, 3, 4].map((n) => roomLevelSeed({ seeds }, n, () => -1)),
		[11, 22, 33, 11, 22],
	);
	let calls = 0;
	assert.equal(
		roomLevelSeed(undefined, 3, () => (calls++, 77)),
		77,
	);
	assert.equal(
		roomLevelSeed({ overlays: {} }, 0, () => 78),
		78,
	);
	assert.equal(calls, 1);
});

check("Game Config keeps a level's valid entries and drops the rest", () => {
	assert.deepEqual(
		normalizeLevels({
			seeds: [1, -1, 2.5, 3, 2 ** 33],
			overlays: {
				'*': {
					add: [
						{ cell: [1, 2], kind: 'rock' },
						{ cell: [1], kind: 'rock' },
						{ cell: [1, 2], kind: 'tree' },
					],
				},
				7: {
					remove: [[3, 4], 'x'],
					set: [
						{ cell: [5, 6], height: 2 },
						{ cell: [5, 6], height: 0 },
					],
				},
				bad: { add: [{ cell: [1, 2], kind: 'rock' }] },
				'007': { add: [{ cell: [1, 2], kind: 'rock' }] },
				4294967296: { add: [{ cell: [1, 2], kind: 'rock' }] },
				8: {},
			},
		}),
		{
			seeds: [1, 3],
			overlays: {
				'*': { add: [{ cell: [1, 2], kind: 'rock' }] },
				7: { remove: [[3, 4]], set: [{ cell: [5, 6], height: 2 }] },
			},
		},
	);
	assert.equal(normalizeLevels({}), undefined);
	const doc = normalizeGameConfigDoc({
		...salmonsConfig(salmonsMapRiver(1)),
		arcade: {
			...salmonsConfig(salmonsMapRiver(1)).arcade,
			online: { ...salmonsConfig(salmonsMapRiver(1)).arcade.online, levels: { seeds: [4] } },
		},
	});
	assert.deepEqual(doc.arcade.online.levels, { seeds: [4] }, 'levels survive normalisation');
	assert.deepEqual(onlineGameOf(doc).online.levels, { seeds: [4] }, 'and resolution');
});

check("a salmon swims the original's level from the sea to the source, climbing, and wins", () => {
	const game = onlineGameOf(authored);
	const sim = createRoomSim(game, { seed: 2024 });
	const river = salmonsMapRiver(2024);
	const me = sim.join('me', { character: 'salmon' });
	const bots = () => [...sim.players.values()].filter((p) => p.bot);
	let end;
	let low = me.body.y;
	const steps = 400 * game.online.tickHz;
	for (let i = 0; i < steps && !end; i++) {
		const events = sim.step((id) => {
			const { x, y } = sim.players.get(id).body;
			const ahead = y - 120;
			const band =
				river.bands.find((b) => ahead >= b.y && ahead < b.y + b.h) ??
				(ahead < river.bands[0].y ? river.bands[0] : river.bands.at(-1));
			let aim = (band.left + band.right) / 2;
			const rock = river.rocks.find(
				(r) => x > r.x - 60 && x < r.x + r.w + 60 && r.y + r.h > y - 200 && r.y + r.h < y,
			);
			if (rock)
				aim =
					rock.x - band.left > band.right - rock.x - rock.w ? rock.x - 70 : rock.x + rock.w + 70;
			const move = {
				moveX: Math.max(-1, Math.min(1, (aim - x) / 60)) * 90,
				moveY: -MOVE_SCALE,
				buttons: i % 2 ? BUTTONS.jump : 0,
				seq: i + 1,
			};
			return [clampInput(move, sim.game.field)];
		});
		for (const bot of bots()) bot.status = STATUS.stunned;
		low = Math.min(low, me.body.y);
		end = events.find((e) => e.type === 'roundEnd');
	}
	assert.ok(
		end,
		`the salmon reached the source (it got to y = ${Math.round(low)} of ${river.world.h})`,
	);
	assert.equal(end.winner, 'me');
});

// --- The original's rules on its own levels (`server/index.js` `update`, `isInWater`,
// `isCatcherInBounds`, the spawns): what a room of `salmonsMap` plays. ---------------------------

/** A room of seed `seed`'s level with no bots, and a player of `character` at `at`. */
function originalRoom(seed, character, at) {
	const doc = salmonsConfig(salmonsMapRiver(seed));
	doc.arcade.online.bots.fillTo = 0;
	const sim = createRoomSim(onlineGameOf(normalizeGameConfigDoc(doc)), { seed });
	const p = sim.join('p', { character });
	if (at) Object.assign(p.body, at);
	let seq = 0;
	/** `n` steps of one input a step: `move` ({ moveX, moveY }, whole units) and `buttons`. */
	const run = (n, move, buttons = () => 0) => {
		for (let i = 0; i < n; i++) {
			seq += 1;
			const input = { seq, view: sim.steps, ...move, buttons: buttons(i) };
			sim.step(() => [clampInput(input, sim.game.field)]);
		}
		return p;
	};
	return { sim, p, run, river: salmonsMapRiver(seed) };
}

const M = MOVE_SCALE;
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const bandAt = (river, y) => river.bands.find((b) => y >= b.y && y < b.y + b.h);

check(
	"the original's speeds: salmon 6, bear 4.5, fisherman 5 cells/s (P10.16's river keeps its)",
	() => {
		const speeds = (doc) =>
			Object.fromEntries(doc.arcade.online.characters.map((c) => [c.id, c.speed]));
		assert.deepEqual(speeds(salmonsConfig(salmonsMapRiver(1))), {
			salmon: 6 * CELL,
			bear: 4.5 * CELL,
			fisherman: 5 * CELL,
		});
		assert.deepEqual(speeds(salmonsConfig()), { salmon: 240, bear: 190, fisherman: 140 });
	},
);

check('a bank stops a salmon by its centre at the water’s edge: no push, never on the land', () => {
	const { sim, p, run, river } = originalRoom(2024, 'salmon');
	assert.ok(
		!sim.game.online.rules.zones.some((r) => r.force && r.force.x !== 0),
		'no bank force on an original level',
	);
	const band = river.bands.find((b) => b.h >= 6 * CELL && b.y > 100 * CELL);
	const y = band.y + band.h / 2;
	for (const [dir, edge] of [
		[-1, band.left + CELL / 2],
		[1, band.right - CELL / 2],
	]) {
		Object.assign(p.body, { x: (band.left + band.right) / 2, y });
		let beyond = 0;
		for (let i = 0; i < 90; i++) {
			run(1, { moveX: dir * M, moveY: -M });
			if (bandAt(river, p.body.y) === band) beyond = Math.max(beyond, dir * (p.body.x - edge));
		}
		assert.ok(beyond <= 1e-6, `side ${dir}: its centre stays on the water (${beyond} px past)`);
		Object.assign(p.body, { x: (band.left + band.right) / 2, y });
		run(60, { moveX: dir * M, moveY: 0 });
		assert.ok(
			Math.abs(p.body.x - edge) < 1e-6,
			`side ${dir}: stopped at ${p.body.x}, edge ${edge}`,
		);
	}
});

check(
	'a salmon is grounded each time it comes down on sand, within 0.8 cells of a sand cell',
	() => {
		const { sim, p, run, river } = originalRoom(2024, 'salmon');
		// A run of sand with none in the row above it.
		const apart = (o, s) => o.y !== s.y - CELL || o.x > s.x + s.w + CELL || o.x + o.w < s.x - CELL;
		const sand = river.sandbanks.find(
			(s) => s.w >= 3 * CELL && river.sandbanks.every((o) => o === s || apart(o, s)),
		);
		const centre = { x: sand.x + 1.5 * CELL, y: sand.y + CELL / 2 };
		const rest = { moveX: 0, moveY: 0 };
		// At rest the current carries it 1.5 cells/s down the river.
		const drift = (1.5 * CELL) / sim.game.online.tickHz;
		Object.assign(p.body, { x: centre.x, y: centre.y - 0.85 * CELL - drift });
		run(1, rest);
		assert.equal(p.status, STATUS.free, '0.85 cells off: not on it');
		Object.assign(p.body, { x: centre.x, y: centre.y - 0.75 * CELL - drift });
		run(1, rest);
		assert.equal(p.status, STATUS.grounded, '0.75 cells off a sand cell: grounded');
		for (let leap = 0; leap < 3; leap++) {
			run(1, rest, () => BUTTONS.jump);
			assert.equal(p.status, STATUS.free, `leap ${leap}: a tap frees it`);
			assert.ok(p.z > 0, `leap ${leap}: in the air`);
			while (p.z > 0) {
				run(1, rest);
				Object.assign(p.body, centre);
				assert.ok(p.z === 0 || p.status === STATUS.free, 'not grounded in the air');
			}
			run(1, rest);
			assert.equal(p.status, STATUS.grounded, `leap ${leap}: down on the sand, grounded again`);
		}
	},
);

check('bears walk into the water; a waterfall, the bank limit and the ends stop them', () => {
	const { p, run, river } = originalRoom(1, 'bear');
	const band = river.bands.find((b) => b.h >= 4 * CELL && b.y > 60 * CELL && b.y < 300 * CELL);
	const y = band.y + band.h / 2;
	Object.assign(p.body, { x: band.left - 3 * CELL, y });
	run(30, { moveX: M, moveY: 0 });
	assert.ok(p.body.x > band.left + CELL, `into the water (${p.body.x} > ${band.left})`);
	run(150, { moveX: -M, moveY: 0 });
	near(p.body.x, band.left + CELL / 2 - 12 * CELL, 1e-6, 'left: 12 cells past the water at most');
	Object.assign(p.body, { x: band.right - 3 * CELL, y });
	run(150, { moveX: M, moveY: 0 });
	near(p.body.x, band.right - CELL / 2 + 12 * CELL, 1e-6, 'right: 12 cells past the water at most');
	const fall = river.waterfalls[1];
	const line = fall.y + fall.h / 2;
	const water = river.bands.find((b) => b.y === line);
	const x = (water.left + water.right) / 2;
	Object.assign(p.body, { x, y: line + 5 * CELL });
	run(90, { moveX: 0, moveY: -M });
	near(p.body.y, line + 1.5 * CELL, 1e-6, 'from below: 1.5 cells from the waterfall');
	Object.assign(p.body, { x, y: line - 5 * CELL });
	run(90, { moveX: 0, moveY: M });
	near(p.body.y, line - 1.5 * CELL, 1e-6, 'from above too');
	const top = river.bands[0];
	Object.assign(p.body, { x: (top.left + top.right) / 2, y: (5 + 15) * CELL + CELL / 2 });
	run(90, { moveX: 0, moveY: -M });
	near(p.body.y, (5 + 5) * CELL + CELL / 2, 1e-6, 'the source: 5 columns off');
	const last = river.bands.at(-1);
	Object.assign(p.body, { x: (last.left + last.right) / 2, y: (5 + 385) * CELL });
	run(90, { moveX: 0, moveY: M });
	near(p.body.y, (5 + 395) * CELL + CELL / 2, 1e-6, 'the sea: 5 columns off');
});

check(
	'a fisherman stays out of the water but crosses a bridge, on its deck and up its slopes',
	() => {
		const { p, run, river } = originalRoom(1, 'fisherman');
		const bridge = river.bridges[1];
		const plank = bridge.y + CELL / 2;
		const band = bandAt(river, plank);
		Object.assign(p.body, { x: band.left - 4 * CELL, y: plank + 3 * CELL });
		run(60, { moveX: M, moveY: 0 });
		assert.ok(p.body.x < band.left, `off the bridge the water stops it (${p.body.x})`);
		Object.assign(p.body, { x: bridge.x - 4 * CELL, y: plank });
		const lifts = [];
		for (let i = 0; i < 400 && p.body.x < bridge.x + bridge.w + 4 * CELL; i++) {
			run(1, { moveX: M, moveY: i % 3 ? 0 : 60 });
			lifts.push([p.body.x, p.z, p.body.y]);
		}
		assert.ok(p.body.x > bridge.x + bridge.w + 3 * CELL, `across the river (${p.body.x})`);
		const deck = lifts.filter(([x]) => x > bridge.x + CELL && x < bridge.x + bridge.w - CELL);
		assert.ok(deck.length > 5, 'it walked the deck');
		for (const [x, z, y] of deck) {
			near(z, bridge.height * CELL, 1e-9, `on the deck at ${x}: as high as the bridge`);
			near(y, plank, 1e-9, `on the deck at ${x}: on its row`);
		}
		const slope = lifts.find(([x]) => x > bridge.x - 1.5 * CELL && x < bridge.x - 0.5 * CELL);
		assert.ok(slope && slope[1] > 0 && slope[1] < bridge.height * CELL, 'part way up the slope');
		run(30, { moveX: 0, moveY: M });
		assert.equal(p.z, 0, 'off the bridge: on the ground');
	},
);

check(
	'salmon start across the spawn line and catchers at the original’s places, by the room',
	() => {
		for (const seed of [1, 7, 2024]) {
			const river = salmonsMapRiver(seed);
			const meander = buildMeanderTable(String(seed));
			const { gyMin, sourceRows } = river.grid;
			const cellOf = (p) => ({ gx: p.y / CELL - sourceRows - 0.5, gy: p.x / CELL + gyMin - 0.5 });
			const spread = 0.4 * riverHalfWidth(390);
			for (const s of river.salmonSpawns) {
				const { gx, gy } = cellOf(s);
				near(gx, 390, 1e-9, 'on the spawn line');
				assert.ok(Math.abs(gy - meanderAtOf(meander, 390)) <= spread + 0.5, `within ±0.4·halfW`);
			}
			for (const [i, c] of river.botSpawns.entries()) {
				const { gx, gy } = cellOf(c);
				const off = Math.abs(gy - meanderAtOf(meander, gx));
				const halfW = riverHalfWidth(gx);
				assert.ok(gx >= 29.5 && gx <= 370.5, `catcher ${i} at column ${gx}`);
				assert.ok(off >= halfW + 3 - 0.6 && off <= halfW + 8 + 0.6, `catcher ${i}: ${off} off`);
				for (const d of river.botSpawns.slice(0, i)) {
					const o = cellOf(d);
					assert.ok(Math.hypot(o.gx - gx, o.gy - gy) >= 15 - 0.05, 'catchers 15 cells apart');
				}
			}
			assert.ok(river.botSpawns.length >= 20, `seed ${seed}: ${river.botSpawns.length} places`);
		}
		const places = (seed) => {
			const { sim } = originalRoom(seed, 'salmon');
			const at = [];
			for (let i = 0; i < 12; i++) {
				const s = sim.join(`s${i}`, { character: 'salmon' });
				at.push(`${s.body.x},${s.body.y}`);
			}
			const b = sim.join('b', { character: 'bear' });
			at.push(`${b.body.x},${b.body.y}`);
			return at;
		};
		const once = places(2024);
		assert.deepEqual(places(2024), once, 'the room picks from its seed: it replays');
		assert.ok(new Set(once.slice(0, 12)).size >= 6, `salmon are spread (${new Set(once).size})`);
		const river = salmonsMapRiver(2024);
		const key = (p) => `${p.x},${p.y}`;
		assert.ok(once.slice(0, 12).every((k) => river.salmonSpawns.some((s) => key(s) === k)));
		assert.ok(
			river.botSpawns.some((s) => key(s) === once[12]),
			'a bear at a catcher place',
		);
	},
);

console.log(`check:salmons-levels — ${passed} checks passed`);
