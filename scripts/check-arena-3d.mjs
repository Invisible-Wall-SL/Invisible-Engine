// The seeded Crash arena (`docs/design/3d-games.md` Phase 3 step 6, gameplay evaluation §5;
// `packages/engine-mechanics/src/crashArena.js`, `levelNav3d.js`, `onlineGenerators3d.js`):
//
// - the generator and the nav use nothing implementation-defined, and nothing 2D imports them;
// - a seed makes the same bytes every time, pinned for seeds 0..31 (the fixture; the browser page
//   `scripts/arena-3d-page.mjs` holds Chrome and WebKit to the same code);
// - 500 seeds each make a valid arena: no overlapping colliders, every spawn and marker reaches the
//   pit and is reached from it, the teams equal in number and in mean path cost to the pit;
// - the validator catches a planted overlap, an unreachable spawn, a spawn off the floor, an
//   unbalanced team and a missing pit; the nav sees walls, ceilings and drops;
// - every trampoline edge of 12 arenas is flown in `motion3d` and lands where the graph says;
// - the replay: on seed 5's arena every team spawn walks its nav path to the pit's rim through
//   `motion3d` (ramps, drops and trampolines), its checkpoint hashes pinned;
// - the config path: `arcade.world3d.generator` through `world3dOf` and `generatedWorld3d` makes the
//   arena, and a 3D room (`services/game-server` `createRoomSim3d`) plays the one its seed makes.
//
// Run: pnpm check:arena-3d            (--update rewrites the fixture)

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeGameConfigDoc, onlineGameOf } from '../packages/game-config/index.ts';
import {
	CRASH_CELL,
	CRASH_STEP,
	CRASH_TEAM_SPAWNS,
	crashArena,
} from '../packages/engine-mechanics/src/crashArena.js';
import {
	navGrid3d,
	nodeAt3d,
	validateLevel3d,
} from '../packages/engine-mechanics/src/levelNav3d.js';
import { world3dOf } from '../packages/engine-mechanics/src/online3d.js';
import { generatedWorld3d } from '../packages/engine-mechanics/src/onlineGenerators3d.js';
import { createRoomSim3d } from '../services/game-server/src/roomSim3d.ts';
import {
	ARENA_SEEDS,
	arenaSeedsCode,
	flyArenaTrampolines,
	walkArenaRoutes,
} from './arena-3d-scenario.mjs';
import { buildArena3dPage } from './arena-3d-page.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(ROOT, 'packages/engine-mechanics/fixtures/arena-3d.json');
const UPDATE = process.argv.includes('--update');
const REPLAY_SEED = 5;
const VALID_SEEDS = 500;

const read = (file) => readFileSync(join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
let passed = 0;
const check = async (name, fn) => {
	try {
		await fn();
		passed += 1;
	} catch (e) {
		console.error(`✗ ${name}`);
		throw e;
	}
};

const seeds = arenaSeedsCode();
const replay = walkArenaRoutes(REPLAY_SEED);
const fixture = {
	note: 'check:arena-3d — level hashes of crashArena(0..31) and the motion3d replay on seed 5',
	seeds: { code: seeds.code, hashes: seeds.hashes },
	replay: {
		seed: REPLAY_SEED,
		code: replay.code,
		routes: replay.routes,
		steps: replay.steps,
		ramp: replay.ramp,
		drops: replay.drops,
		trampolines: replay.trampolines,
		bounces: replay.bounces,
	},
};
if (UPDATE) {
	writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, '\t')}\n`);
	console.log(`wrote ${FIXTURE}`);
}
const pinned = JSON.parse(read('packages/engine-mechanics/fixtures/arena-3d.json'));

await check('the generator and the nav use only exact arithmetic and a seeded stream', () => {
	for (const file of [
		'packages/engine-mechanics/src/crashArena.js',
		'packages/engine-mechanics/src/levelNav3d.js',
		'packages/engine-mechanics/src/onlineGenerators3d.js',
	]) {
		const code = read(file)
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.replace(/\/\/.*$/gm, '');
		const found = code.match(
			/Math\.(random|sin|cos|tan|asin|acos|atan2?|sinh|cosh|tanh|hypot|pow|exp|expm1|log\w*|cbrt)\b|\*\*|Date\b|performance\b|crypto\b/,
		);
		assert.equal(found, null, `${file} uses ${found?.[0]}`);
	}
});

await check('nothing 2D reaches the 3D generator', () => {
	const imports3d = /from '[^']*(crashArena|levelNav3d|onlineGenerators3d)(\.js)?'/;
	for (const file of [
		'packages/engine-mechanics/index.ts',
		'packages/engine-mechanics/src/onlineGenerators.js',
		'packages/engine-mechanics/src/online3d.js',
		'packages/game-config/index.ts',
		'apps/lines/src/game/online.ts',
	])
		assert.doesNotMatch(read(file), imports3d, file);
});

await check('a seed makes the same bytes every time (seeds 0..31 pinned)', () => {
	assert.equal(seeds.hashes.length, ARENA_SEEDS);
	assert.deepEqual(arenaSeedsCode(), seeds);
	assert.deepEqual(crashArena(9), crashArena(9));
	assert.deepEqual(crashArena('nine'), crashArena('nine'));
	assert.notDeepEqual(crashArena(9).level, crashArena(10).level);
	assert.deepEqual(pinned.seeds, fixture.seeds, 'the level bytes moved: --update if meant');
});

await check(`${VALID_SEEDS} seeds each make a valid arena`, () => {
	const attempts = [];
	let colliders = 0;
	const tiers = new Set();
	for (let s = 0; s < VALID_SEEDS; s++) {
		const arena = crashArena(s);
		const v = validateLevel3d(arena);
		assert.ok(v.ok, `seed ${s}: ${v.problems.join('; ')}`);
		assert.equal(arena.spawns.length, 2 * CRASH_TEAM_SPAWNS);
		for (const k of ['chest', 'pieceSpawner', 'prop'])
			assert.ok(
				arena.markers.some((m) => m.kind === k),
				`seed ${s} has no ${k}`,
			);
		assert.ok(
			arena.level.zones.some((z) => z.kind === 'trampoline'),
			`seed ${s}: no trampoline`,
		);
		assert.ok(
			arena.level.colliders.some((c) => c.kind === 'ramp'),
			`seed ${s}: no ramp`,
		);
		attempts[arena.attempt] = (attempts[arena.attempt] ?? 0) + 1;
		colliders = Math.max(colliders, arena.level.colliders.length);
		for (const c of arena.level.colliders)
			if (c.kind === 'box' && c.maxY - c.minY === 0.5) tiers.add(c.maxY / CRASH_STEP);
	}
	assert.ok(tiers.size >= 5, `tiers used: ${[...tiers]}`);
	console.log(
		`  rolls kept: ${attempts.map((n, k) => `#${k} ${n ?? 0}`).join(', ')}; at most ${colliders} colliders; tiers ${[...tiers].sort((a, b) => a - b).join(' ')}`,
	);
});

await check('the validator catches what it is for', () => {
	const arena = crashArena(3);
	const floor = arena.level.colliders.find((c) => c.kind === 'box');
	const broken = (change) => {
		const world = structuredClone({
			level: arena.level,
			spawns: arena.spawns,
			markers: arena.markers,
		});
		change(world);
		return validateLevel3d(world).problems.join('; ');
	};
	assert.match(
		broken((w) => w.level.colliders.push({ ...floor, minX: floor.minX + 1 })),
		/overlap/,
	);
	assert.match(
		broken((w) => Object.assign(w.spawns[0], { x: 0, z: 0 })),
		/no walkable top/,
	);
	assert.match(
		broken((w) => {
			w.level.colliders = w.level.colliders.filter((c) => c.kind !== 'ramp');
			w.level.zones = w.level.zones.filter((z) => z.kind !== 'trampoline');
		}),
		/cannot reach the pit|cannot be reached/,
	);
	assert.match(
		broken((w) => {
			for (const s of w.spawns)
				if (s.team === 1) Object.assign(s, { x: 2 * CRASH_CELL, y: 0, z: 0 });
		}),
		/unbalanced/,
	);
	assert.match(
		broken((w) => (w.spawns[1].team = 0)),
		/unequal/,
	);
	assert.match(
		broken((w) => (w.level.zones = w.level.zones.filter((z) => z.kind !== 'pit'))),
		/no pit/,
	);
	assert.equal(
		broken(() => {}),
		'',
	);
});

await check('the nav: walls and ceilings close a way, a fall opens one down only', () => {
	const box = (minX, minY, minZ, maxX, maxY, maxZ) => ({
		kind: 'box',
		minX,
		minY,
		minZ,
		maxX,
		maxY,
		maxZ,
	});
	const two = (extra = []) =>
		navGrid3d({
			cellSize: 5,
			colliders: [box(-2.5, -0.5, -2.5, 2.5, 0, 2.5), box(2.5, -0.5, -2.5, 7.5, 0, 2.5), ...extra],
		});
	const kinds = (g) =>
		g.edges.map((e) => `${g.nodes[e.from].x}>${g.nodes[e.to].x}:${e.kind}`).sort();
	assert.deepEqual(kinds(two()), ['0>5:walk', '5>0:walk']);
	assert.deepEqual(kinds(two([box(2, 0, -2.5, 2.5, 4, 2.5)])), []);
	assert.deepEqual(kinds(two([box(2, 1, -2.5, 3, 1.5, 2.5)])), [], 'a 1 m gap under a lintel');
	const drop = navGrid3d({
		cellSize: 5,
		colliders: [box(-2.5, 3, -2.5, 2.5, 3.5, 2.5), box(2.5, -0.5, -2.5, 7.5, 0, 2.5)],
	});
	assert.deepEqual(kinds(drop), ['0>5:drop']);
	const ramp = navGrid3d({
		cellSize: 5,
		colliders: [
			box(-2.5, -0.5, -2.5, 2.5, 0, 2.5),
			{
				kind: 'ramp',
				facing: '+x',
				minX: 2.5,
				minY: 0,
				minZ: -2.5,
				maxX: 7.5,
				maxY: 3.5,
				maxZ: 2.5,
			},
			box(7.5, 3, -2.5, 12.5, 3.5, 2.5),
		],
	});
	assert.deepEqual(kinds(ramp), ['0>5:walk', '10>5:walk', '5>0:walk', '5>10:walk']);
	const g = navGrid3d(crashArena(4).level);
	for (const e of g.edges)
		if (e.kind === 'walk')
			assert.ok(
				g.edges.some((o) => o.kind === 'walk' && o.from === e.to && o.to === e.from),
				'a walk goes both ways',
			);
	assert.ok(nodeAt3d(g, 0, 0, 0) < 0, 'the pit is no floor');
});

await check('every trampoline edge of 12 arenas is flown in motion3d', () => {
	let flown = 0;
	for (let s = 0; s < 12; s++) {
		const r = flyArenaTrampolines(s);
		assert.deepEqual(r.misses, [], `seed ${s}`);
		flown += r.flown;
	}
	assert.ok(flown > 500, `${flown}`);
	console.log(`  ${flown} trampoline flights landed`);
});

await check(`the replay: seed ${REPLAY_SEED}'s team spawns walk to the pit in motion3d`, () => {
	assert.deepEqual(replay.failures, []);
	assert.equal(replay.routes, 2 * CRASH_TEAM_SPAWNS);
	assert.ok(replay.ramp > 0 && replay.drops > 0 && replay.trampolines > 0, JSON.stringify(replay));
	assert.deepEqual(walkArenaRoutes(REPLAY_SEED), replay);
	assert.deepEqual(pinned.replay, fixture.replay, 'the replay moved: --update if meant');
	for (let s = 0; s < 24; s++) assert.deepEqual(walkArenaRoutes(s).failures, [], `seed ${s}`);
	console.log(
		`  ${replay.routes} routes, ${replay.steps} steps, ${replay.ramp} on ramps, ${replay.drops} drops, ${replay.trampolines} trampolines; code ${replay.code}; 24 seeds × 16 routes walked`,
	);
});

await check('arcade.world3d.generator makes the arena on the server and the device alike', () => {
	const authored = world3dOf({ generator: 'crashArena', motion: { speed: 6 } });
	assert.equal(authored.generator, 'crashArena');
	const { world, made } = generatedWorld3d(authored, 21);
	assert.deepEqual(made, crashArena(21));
	assert.deepEqual(world.level, made.level);
	assert.deepEqual(world.spawns, made.spawns);
	assert.deepEqual(world.markers, made.markers);
	assert.equal(world.motion.speed, 6);
	const reread = world3dOf({ level: made.level, spawns: made.spawns });
	assert.deepEqual(reread.spawns, made.spawns, 'the spawns survive the wire (float32) exactly');
	const plain = world3dOf({});
	assert.equal(generatedWorld3d(plain, 21).world, plain);
	assert.throws(() => generatedWorld3d(world3dOf({ generator: 'nope' }), 1), /no generator "nope"/);
	assert.throws(() => world3dOf({ generator: 3 }), /generator: a generator id/);
	assert.throws(() => world3dOf({ spawns: [{ team: 2 }] }), /team: 0 \(red\) or 1 \(blue\)/);

	const config = {
		family: 'arcade',
		outcome: 'rules',
		gameName: 'Arena 3D',
		arcade: {
			field: { w: 40, h: 40 },
			bodies: { hero: { shape: 'circle', r: 0.4, tags: ['player'] } },
			online: { characters: [{ id: 'hero', body: 'hero', speed: 5 }] },
			world3d: { generator: 'crashArena' },
		},
	};
	const game = onlineGameOf(normalizeGameConfigDoc(config));
	assert.ok(game && !('refused' in game), JSON.stringify(game));
	const room = createRoomSim3d(game, world3dOf(config.arcade.world3d), { seed: 21 });
	assert.deepEqual(room.world.level, made.level);
	assert.equal(room.level.colliders.length, made.level.colliders.length);
	for (let k = 0; k < 4; k++) {
		const p = room.join(`p${k}`, {});
		const home = made.spawns[k];
		assert.deepEqual([p.body.x, p.body.y, p.body.z], [home.x, home.y, home.z]);
		assert.equal(p.team, home.team, 'joins in turn land on their team’s spawns');
	}
});

await check('the browser page inlines a runnable copy', () => {
	const { html, code } = buildArena3dPage(pinned);
	assert.match(html, new RegExp(fixture.seeds.code));
	assert.doesNotMatch(code, /^\s*import /m);
	const ran = new Function(`${code}
return { seeds: arenaSeedsCode(), replay: walkArenaRoutes(${REPLAY_SEED}) };`)();
	assert.equal(ran.seeds.code, fixture.seeds.code);
	assert.equal(ran.replay.code, fixture.replay.code);
});

console.log(`✓ check:arena-3d — ${passed} checks; seeds code ${seeds.code}, replay ${replay.code}`);
