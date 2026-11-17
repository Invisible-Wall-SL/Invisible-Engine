// SALMONS' LEVELS (docs/design/salmons-levels.md): the original game's generator, ported, makes the
// original's level for a seed; a room, a device and `/editor` make the same level from the same seed;
// an authored overlay lands on top, survives a reseed and is never changed by one; pinned seeds are
// taken in turn and none pinned means a new level per room.
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

console.log(`check:salmons-levels — ${passed} checks passed`);
