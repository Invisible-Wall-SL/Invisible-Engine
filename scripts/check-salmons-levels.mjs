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
	SALMONS_MAP,
	SALMONS_MAP_SEED,
	applySalmonsOverlay,
	buildMeanderTable,
	generateSalmonsMap,
	SALMONS_GENERATOR,
	SALMONS_GENERATOR_LIMITS,
	biomeOrphans,
	generatorParams,
	inRiver,
	levelOverlay,
	levelShape,
	meanderAt as meanderAtOf,
	riverHalfWidth,
	salmonsMapRiver,
	seedLevels,
} from '../packages/engine-mechanics/src/salmonsMap.js';
import {
	SALMONS_BIOMES,
	biomeAt,
	biomeStretches,
	resolveBiomes,
} from '../packages/engine-mechanics/src/salmonsBiomes.js';
import { salmonsConfig } from '../packages/engine-mechanics/src/salmons.js';
import { BRIDGE_SLOPE } from '../packages/engine-mechanics/src/salmonsRules.js';
import {
	BRIDGE,
	aloftDepth,
	aloftLift,
	deckLift,
} from '../packages/engine-layout/src/lib/salmonsArt/bridge.ts';
import { BRIDGE_PROP_DEF } from '../packages/engine-layout/src/lib/propComponents.ts';
import { propPieces } from '../packages/engine-layout/src/lib/propPieces.ts';
import {
	ISO_DEPTH_SPREAD,
	isoDepth,
	isoDepthOrder,
} from '../packages/engine-layout/src/lib/projection.ts';
import { riverElevation } from '../packages/engine-layout/src/lib/referenceLayouts/salmonsElevation.ts';
import {
	ONLINE_GENERATORS,
	generatedOnlineGame,
	roomLevelSeed,
} from '../packages/engine-mechanics/src/onlineGenerators.js';
import { FIELD_DRAWINGS } from '../packages/engine-layout/src/lib/referenceLayouts/salmonsRiver.ts';
import { drawGeneratedLevel } from '../apps/launcher-api/src/lib/editor/generatedLevelCore.ts';
import {
	LEVELS_GENERATOR_DEFAULTS,
	normalizeGameConfigDoc,
	normalizeLevelsBiomes,
	normalizeLevelsGenerator,
	normalizeShapedLevels,
	onlineGameOf,
	playedOnlineGame,
	shapedOnlineGame,
	validateLevelsShape,
	withLevelsShape,
} from '../packages/game-config/index.ts';
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
	for (const file of ['salmonsMap.js', 'salmonsBiomes.js', 'seedrandom.js']) {
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

// --- The generator's settings and the biomes, from the config (2026-11-26) ---------------------

/** A river without the field only an authored biomes block adds. */
const bare = (river) => {
	const plain = { ...river };
	delete plain.biomes;
	return plain;
};
/** What a seed's level is made of: the generator's map, and the river the engine plays. */
const levelOf = (seed, levels) => {
	const shape = levelShape(levels, seed);
	return {
		map: sha(JSON.stringify(generateSalmonsMap(String(seed), shape))),
		river: sha(JSON.stringify(bare(salmonsMapRiver(seed, levelOverlay(levels, seed), shape)))),
	};
};

check('every generator setting defaults to the original’s: the recorded maps do not move', () => {
	assert.deepEqual(generatorParams({}), { ...SALMONS_GENERATOR });
	assert.deepEqual(generatorParams(undefined), { ...SALMONS_GENERATOR });
	assert.equal(LEVELS_GENERATOR_DEFAULTS, SALMONS_GENERATOR, 'Game Config reads the same table');
	const M = SALMONS_MAP;
	const G = SALMONS_GENERATOR;
	assert.deepEqual(
		[G.riverLength, G.sourceHalfWidth, G.mouthHalfWidth, G.deltaStart, G.meanderAmp],
		[
			M.RIVER_LENGTH,
			M.RIVER_WIDTH_END,
			M.RIVER_WIDTH_START,
			M.DELTA_START_FRAC,
			M.RIVER_MEANDER_AMP,
		],
	);
	assert.deepEqual(
		[G.meanderFreq, G.waterfallClearance, G.bridgeCount, G.bridgeHeight, G.bridgeFallClearance],
		[
			M.RIVER_MEANDER_FREQ,
			M.WATERFALL_CLEARANCE,
			M.BRIDGE_MAX_COUNT,
			M.BRIDGE_HEIGHT,
			M.BRIDGE_WATERFALL_CLEARANCE,
		],
	);
	assert.equal(G.bridgeSpacing, M.BRIDGE_MIN_SPACING);
	for (const [key, [lo, hi]] of Object.entries(SALMONS_GENERATOR_LIMITS))
		assert.ok(lo <= SALMONS_GENERATOR[key] && SALMONS_GENERATOR[key] <= hi, `${key} in its limits`);
	assert.deepEqual(Object.keys(SALMONS_GENERATOR_LIMITS), Object.keys(SALMONS_GENERATOR));
	const every = { generator: { ...SALMONS_GENERATOR } };
	for (const [seed, want] of Object.entries(FIXTURE.maps)) {
		for (const levels of [{ generator: {} }, every, { biomes: {} }, { generator: {}, biomes: {} }])
			assert.equal(
				levelOf(seed, levels).map,
				want.sha256,
				`map "${seed}" with ${JSON.stringify(levels).slice(0, 40)}`,
			);
		assert.equal(levelOf(seed, every).river, levelOf(seed, undefined).river, `river "${seed}"`);
	}
	// A winding river (Salmons' shipped one) too.
	const shipped = { river: {}, waterfalls: { count: 6, heightMin: 5, heightMax: 10 } };
	for (const seed of [3, 77])
		assert.deepEqual(
			levelOf(seed, { ...shipped, ...every, biomes: {} }),
			levelOf(seed, shipped),
			`winding seed ${seed}`,
		);
});

check('authored generator settings take effect, deterministically, held to their limits', () => {
	const tuned = {
		riverLength: 300,
		sourceHalfWidth: 5,
		obstacleChance: 0.6,
		whirlpoolShare: 0.5,
		rockSize: 2,
		whirlpoolRadius: 60,
		bridgeCount: 0,
		sourceRows: 8,
		seaRows: 9,
		bankCells: 20,
		sandSeed: 0.4,
		salmonSpawnAbove: 20,
		catcherPlaces: 5,
	};
	const make = (seed) => ONLINE_GENERATORS.salmonsMap.make(seed, { generator: tuned });
	const river = make(11);
	const original = salmonsMapRiver(11);
	assert.deepEqual(make(11), river, 'the same settings make the same level');
	assert.equal(river.world.h, (8 + 300 + 9) * CELL);
	assert.equal(river.grid.sourceRows, 8);
	assert.equal(river.sea.y, (8 + 300) * CELL);
	assert.equal(river.bridges.length, 0);
	assert.ok(
		river.rocks.every((r) => r.w === 2 * CELL && r.h === 2 * CELL),
		'rocks 2 cells',
	);
	assert.ok(
		river.whirlpools.every((w) => w.r === 60),
		'whirlpools of radius 60',
	);
	const pieces = (r) => r.rocks.length + r.whirlpools.length;
	assert.ok(pieces(river) > pieces(original), 'a higher chance, more pieces');
	assert.ok(river.whirlpools.length > original.whirlpools.length, 'a larger share, more pools');
	assert.ok(river.botSpawns.length <= 5, 'at most 5 catcher places');
	assert.equal(river.spawn.y, (300 - 20 + 8) * CELL, 'the salmon line 20 above the sea');
	assert.equal(river.bands[0].right - river.bands[0].left, (2 * 5 + 1) * CELL, 'a wider source');
	// The rules' bounds follow the river's own length.
	const game = generatedOnlineGame(onlineGameOf(authored), 11);
	const shaped = generatedOnlineGame(
		{
			...onlineGameOf(authored),
			online: { ...onlineGameOf(authored).online, levels: { generator: tuned } },
		},
		11,
	);
	const seaBear = (g) => g.zones.find((z) => z.id === 'seabear');
	assert.ok(seaBear(shaped.game).y < seaBear(game.game).y, 'the sea bound moves up the world');
	// Out of the limits: held to them, never broken.
	const held = generatorParams({ riverLength: 5, sandSeed: 9, fallRunMin: 9, fallRunMax: 2 });
	assert.equal(held.riverLength, SALMONS_GENERATOR_LIMITS.riverLength[0]);
	assert.equal(held.sandSeed, 1);
	assert.deepEqual([held.fallRunMin, held.fallRunMax], [2, 9], 'a pair the wrong way is swapped');
	assert.deepEqual(normalizeLevelsGenerator({ riverLength: 5, sandSeed: 0.5, bankCells: 13.5 }), {
		sandSeed: 0.5,
	});
	const doc = {
		arcade: {
			online: { generator: 'salmonsMap', levels: { generator: { riverLength: 5, nope: 1 } } },
		},
	};
	assert.deepEqual(
		validateLevelsShape(doc).map((i) => i.path),
		['arcade.online.levels.generator.riverLength', 'arcade.online.levels.generator.nope'],
	);
	// At the limits' corners the level is still made whole.
	for (const pick of [0, 1]) {
		const corner = Object.fromEntries(
			Object.entries(SALMONS_GENERATOR_LIMITS).map(([k, l]) => [k, l[pick]]),
		);
		for (const levels of [{ generator: corner }, { generator: corner, river: {} }]) {
			const r = ONLINE_GENERATORS.salmonsMap.make(5, levels);
			assert.ok(r.bands.length > 0 && r.salmonSpawns.length > 0 && r.botSpawns.length > 0);
		}
	}
});

/** The original's forest, as `salmonsArt/river.ts` drew it before biomes were data (a404522). */
const OLD_PAIRS = [
	[0, 1],
	[2, 3],
	[4, 5],
	[0, 3],
	[1, 4],
	[2, 5],
];
const OLD_RIVERBED = [
	0xb89968, 0xc4a576, 0xa88858, 0xd0b487, 0xb09060, 0xc8a878, 0xa07050, 0xb88f5d, 0xc59f70,
];

check('the default biomes are the original’s cycle: six pairs of trees, every 35 columns', () => {
	const biomes = resolveBiomes({}, 1);
	assert.equal(biomes.cycle, 35);
	assert.equal(biomes.sequence, undefined);
	for (let gx = -120; gx < 700; gx++) {
		const old = OLD_PAIRS[((Math.floor(gx / 35) % 6) + 6) % 6];
		assert.deepEqual(biomeAt(biomes, gx).trees, old, `column ${gx}`);
	}
	for (const kind of biomes.kinds) {
		assert.equal(kind.forestFloor, '#28591e');
		assert.deepEqual(
			kind.riverbed.map((c) => parseInt(c.slice(1), 16)),
			OLD_RIVERBED,
		);
		assert.deepEqual(
			[kind.treeChance, kind.grass, kind.grass + 1, kind.grass + kind.forest, kind.grassTint],
			[0.07, 5, 6, 17, '#ffffff'],
			'TREE_CHANCE, GRASS_CELLS, FOREST_FROM, FOREST_TO, no tint',
		);
		assert.deepEqual(
			[kind.rocks, kind.whirlpools, kind.sand, kind.waterfalls, kind.bridges],
			[1, 1, 1, 1, true],
		);
	}
	assert.deepEqual(
		biomes.kinds.map((k) => k.id),
		SALMONS_BIOMES.map((b) => b.id),
	);
	assert.equal(resolveBiomes(undefined, 1), undefined, 'no block: no biomes');
});

/** Two authored biomes and their sequence along the river. */
const BIOMES = {
	kinds: [
		{ id: 'rapids', rocks: 3, whirlpools: 3, trees: [2], forestFloor: '#3A2F1E' },
		{ id: 'meadow', rocks: 0, whirlpools: 0, sand: 0, waterfalls: 0, bridges: false },
		{ id: 'forest1', treeChance: 0.2 },
	],
	sequences: {
		'*': [
			{ from: 150, biome: 'meadow' },
			{ from: 0, biome: 'rapids' },
			{ from: 270, biome: 'forest1' },
			{ from: 300, biome: 'nowhere' },
		],
		12: [{ from: 0, biome: 'meadow' }],
	},
};

check('biomes set each stretch’s density: rocks, whirlpools, sand, waterfalls, bridges', () => {
	const biomes = resolveBiomes(BIOMES, 5);
	assert.deepEqual(biomes.sequence, [
		{ from: 0, biome: 'rapids' },
		{ from: 150, biome: 'meadow' },
		{ from: 270, biome: 'forest1' },
	]);
	assert.deepEqual(resolveBiomes(BIOMES, 12).sequence, [{ from: 0, biome: 'meadow' }]);
	assert.equal(biomeAt(biomes, -40).id, 'rapids', 'above the first entry: the first');
	assert.equal(biomeAt(biomes, 2000).id, 'forest1');
	const kind = biomes.kinds.find((k) => k.id === 'forest1');
	assert.deepEqual(kind.trees, [0, 1], 'a built-in id keeps the rest of its own');
	assert.equal(kind.treeChance, 0.2);
	assert.equal(biomes.kinds[0].forestFloor, '#3a2f1e');
	const counts = { rapids: 0, meadow: 0, base: 0 };
	for (const seed of [1, 2, 3, 4, 5, 6]) {
		const levels = { biomes: BIOMES };
		const river = ONLINE_GENERATORS.salmonsMap.make(seed, levels);
		assert.deepEqual(ONLINE_GENERATORS.salmonsMap.make(seed, levels), river, 'deterministic');
		const original = salmonsMapRiver(seed);
		const gxOf = (y) => Math.floor(y / CELL) - river.grid.sourceRows;
		/** A piece's column, by its centre (a rock's box starts above its cell). */
		const colOf = (p) => gxOf(p.y + (p.h ?? 0) / 2);
		const at = (pieces, from, to) => pieces.filter((p) => colOf(p) >= from && colOf(p) < to).length;
		const pieces = (r) => [...r.rocks, ...r.whirlpools];
		counts.rapids += at(pieces(river), 0, 150);
		counts.base += at(pieces(original), 0, 150);
		counts.meadow += at(pieces(river), 150, 270);
		assert.equal(at(river.waterfalls, 151, 270), 0, 'the meadow keeps none of its waterfalls');
		assert.equal(at(river.bridges, 150, 270), 0, 'no bridge crosses the meadow');
		assert.equal(at(river.sandbanks, 150, 270), 0, 'no sand in the meadow');
		assert.equal(
			sha(JSON.stringify(river.sandbanks.filter((b) => gxOf(b.y) >= 270))),
			sha(JSON.stringify(original.sandbanks.filter((b) => gxOf(b.y) >= 270))),
			'below the meadow, the sand of the original',
		);
	}
	assert.equal(counts.meadow, 0, 'the meadow has no rocks or whirlpools');
	assert.ok(
		counts.rapids > 2 * counts.base,
		`${counts.rapids} pieces in the rapids, ${counts.base}`,
	);
	// Densities of 1 are the generator's own: looks alone move nothing a room plays.
	const looks = {
		kinds: [
			{ id: 'pale', trees: [3], forestFloor: '#101010', grassTint: '#ffeecc', grass: 2 },
			{ id: 'dark', riverbed: ['#000000'], forest: 3 },
		],
		cycle: 20,
	};
	for (const [seed, want] of Object.entries(FIXTURE.maps))
		assert.equal(levelOf(seed, { biomes: looks }).map, want.sha256, `looks only, "${seed}"`);
});

check('tuning one stretch’s density leaves every other stretch’s pieces where they were', () => {
	const stretchA = (rocks, whirlpools) => ({
		kinds: [{ id: 'a', rocks, whirlpools }, { id: 'b', rocks: 0.5 }, { id: 'c' }],
		sequences: {
			'*': [
				{ from: 0, biome: 'a' },
				{ from: 60, biome: 'b' },
				{ from: 150, biome: 'c' },
			],
		},
	});
	const outside = (map) =>
		JSON.stringify(map.obstacles.filter((o) => o.type !== 'sandbank' && o.x >= 60));
	for (const seed of [3, 8, 21]) {
		const make = (biomes) => generateSalmonsMap(String(seed), levelShape({ biomes }, seed));
		const base = make(stretchA(1, 1));
		for (const [rocks, whirlpools] of [
			[0, 0],
			[3, 1],
			[0.2, 2.5],
		]) {
			const tuned = make(stretchA(rocks, whirlpools));
			assert.equal(outside(tuned), outside(base), `seed ${seed}: ${rocks}, ${whirlpools}`);
			assert.notEqual(JSON.stringify(tuned), JSON.stringify(base), 'and stretch a did change');
		}
	}
});

check('a generated rock always leaves water to pass beside it', () => {
	const levels = {
		generator: { sourceHalfWidth: 2, mouthHalfWidth: 4, rockSize: 4, whirlpoolRadius: 120 },
	};
	for (const seed of [2, 5, 9]) {
		const river = ONLINE_GENERATORS.salmonsMap.make(seed, levels);
		assert.ok(river.rocks.length > 10, `seed ${seed}: ${river.rocks.length} rocks`);
		for (const rock of river.rocks) {
			const row = rock.y + rock.h / 2;
			const band = river.bands.find((b) => row >= b.y && row < b.y + b.h);
			const gap = Math.max(rock.x - band.left, band.right - (rock.x + rock.w));
			assert.ok(gap >= 2 * CELL - 1e-9, `seed ${seed}: ${gap} px beside a rock`);
		}
		assert.ok(
			river.rocks.some((r) => r.w < 4 * CELL),
			'some are drawn smaller',
		);
	}
	const issues = validateLevelsShape({
		arcade: { online: { generator: 'salmonsMap', levels } },
	}).map((i) => i.path);
	assert.deepEqual(issues, [
		'arcade.online.levels.generator.rockSize',
		'arcade.online.levels.generator.whirlpoolRadius',
	]);
	// The original's rocks are never held.
	assert.deepEqual(
		salmonsMapRiver(4).rocks.map((r) => r.w),
		salmonsMapRiver(4).rocks.map(() => 1.5 * CELL),
	);
});

check('a level at every limit plays in a room: bounded, stepped, no throw', () => {
	const top = Object.fromEntries(
		Object.entries(SALMONS_GENERATOR_LIMITS).map(([k, [, hi]]) => [k, hi]),
	);
	const biomes = {
		kinds: [
			{ id: 'max', rocks: 3, whirlpools: 3, sand: 3, waterfalls: 1, grass: 12, forest: 24 },
			{ id: 'none', rocks: 0, whirlpools: 0, sand: 0, waterfalls: 0, bridges: false },
		],
		cycle: 1,
	};
	const online = onlineGameOf(authored).online;
	for (const levels of [
		{ generator: top, biomes },
		{ generator: top, biomes, river: {}, waterfalls: { count: 12, heightMax: 16 } },
	]) {
		const game = { ...onlineGameOf(authored), online: { ...online, levels } };
		const sim = createRoomSim(game, { seed: 17 });
		assert.ok(sim.game.zones.length > 0);
		for (let i = 0; i < 120; i++) sim.step(() => []);
		assert.equal(sim.made.world.h, (20 + 800 + 20) * CELL);
	}
});

check('a biome’s density the level has no room for is told as an orphan, never dropped', () => {
	const shape = levelShape(
		{
			biomes: {
				kinds: [
					{ id: 'top', sand: 3 },
					{ id: 'delta', rocks: 3, whirlpools: 2 },
					{ id: 'flood', sand: 3 },
					{ id: 'plain' },
				],
				sequences: {
					'*': [
						{ from: 0, biome: 'top' },
						{ from: 250, biome: 'plain' },
						{ from: 300, biome: 'delta' },
						{ from: 350, biome: 'flood' },
					],
				},
			},
			generator: { sandSeed: 0.5 },
		},
		1,
	);
	assert.deepEqual(biomeOrphans(shape), [
		{ op: 'biome', biome: 'top', kind: 'sandbank', rows: [0, 249], reason: 'no-room' },
		{ op: 'biome', biome: 'delta', kind: 'rock', rows: [300, 349], reason: 'no-room' },
		{ op: 'biome', biome: 'delta', kind: 'whirlpool', rows: [300, 349], reason: 'no-room' },
		{ op: 'biome', biome: 'flood', kind: 'sandbank', rows: [350, 399], reason: 'capped' },
	]);
	const river = salmonsMapRiver(1, undefined, shape);
	assert.deepEqual(
		river.orphans.filter((o) => o.op === 'biome'),
		biomeOrphans(shape),
		'the level lists them with the overlay’s',
	);
	assert.deepEqual(salmonsMapRiver(1).orphans, [], 'none without biomes');
	// The generator's own settings place none: a density above 1 multiplies nothing.
	const off = levelShape(
		{
			generator: { whirlpoolShare: 0, sandSeed: 0 },
			biomes: { kinds: [{ id: 'wild', whirlpools: 3, sand: 3 }] },
		},
		3,
	);
	assert.deepEqual(biomeOrphans(off), [
		{ op: 'biome', biome: 'wild', kind: 'whirlpool', rows: [0, 399], reason: 'generator-off' },
		{ op: 'biome', biome: 'wild', kind: 'sandbank', rows: [0, 399], reason: 'generator-off' },
	]);
	assert.deepEqual(
		salmonsMapRiver(3, undefined, off).orphans.map((o) => o.reason),
		['generator-off', 'generator-off'],
	);
	// One cause, one orphan: stretches of one kind in a row are one run.
	const twice = levelShape(
		{
			biomes: {
				kinds: [{ id: 'top', sand: 3 }],
				cycle: 20,
			},
			generator: { sandSeed: 0.5 },
		},
		3,
	);
	assert.deepEqual(
		biomeOrphans(twice).map((o) => [o.kind, o.rows, o.reason]),
		[['sandbank', [0, 399], 'capped']],
	);
	const stretches = biomeStretches(shape.biomes, 0, 400).map(({ from, to, kind }) => [
		from,
		to,
		kind.id,
	]);
	assert.deepEqual(stretches, [
		[0, 250, 'top'],
		[250, 300, 'plain'],
		[300, 350, 'delta'],
		[350, 400, 'flood'],
	]);
});

check('a room, a device and /editor make the same level and biomes for authored settings', () => {
	const raw = salmonsConfig(salmonsMapRiver(SALMONS_MAP_SEED), {
		levels: { generator: { riverLength: 280, bridgeCount: 2 }, biomes: BIOMES },
	});
	const doc = normalizeGameConfigDoc(raw);
	const game = shapedOnlineGame(onlineGameOf(doc), raw);
	// The launcher's load (normalized, carried back), the editor's own read of it.
	const stored = withLevelsShape(doc, raw);
	const editorLevels = normalizeShapedLevels(stored.arcade.online.levels);
	assert.deepEqual(editorLevels.generator, { riverLength: 280, bridgeCount: 2 });
	assert.deepEqual(editorLevels.biomes, normalizeLevelsBiomes(BIOMES));
	for (const seed of [0, 12, 99]) {
		const sim = createRoomSim(game, { seed });
		const device = generatedOnlineGame(game, seed);
		assert.deepEqual(sim.game.zones, device.game.zones, `room vs device zones, seed ${seed}`);
		assert.deepEqual(sim.made.biomes, device.made.biomes, `room vs device biomes, seed ${seed}`);
		const editor = drawGeneratedLevel(
			ONLINE_GENERATORS,
			FIELD_DRAWINGS,
			'salmonsMap',
			seed,
			editorLevels,
		);
		assert.deepEqual(editor.made, device.made, `editor vs device level, seed ${seed}`);
		assert.ok(
			editor.node.children.some((c) => c.id === 'river-biome-0-left'),
			'the editor marks the stretches',
		);
		// What a room says is itself again: a device reading it makes the very same level.
		const said = JSON.parse(JSON.stringify(seedLevels(game.online.levels, seed)));
		assert.deepEqual(levelShape(said, seed), levelShape(game.online.levels, seed));
		assert.deepEqual(ONLINE_GENERATORS.salmonsMap.make(seed, said), device.made);
	}
	assert.deepEqual(
		validateLevelsShape({
			arcade: { online: { generator: 'salmonsMap', levels: { biomes: BIOMES } } },
		}).map((i) => i.path),
		['arcade.online.levels.biomes.sequences.*'],
		'a sequence entry naming no biome is warned of',
	);
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
	delete doc.arcade.online.bots;
	const sim = createRoomSim(playedOnlineGame(doc), { seed });
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
	// Pushed straight at the limit, the slide may carry it round a step of it to the band beside,
	// whose limit is a cell or two off: it rests on the tightest limit of the bands it stands in.
	const limit = 12 * CELL - CELL / 2;
	const stoodIn = () => river.bands.filter((b) => p.body.y + 46 > b.y && p.body.y - 46 < b.y + b.h);
	run(150, { moveX: -M, moveY: 0 });
	let past = Math.max(...stoodIn().map((b) => b.left - p.body.x));
	near(past, limit, 1e-6, 'left: 12 cells past the water at most');
	Object.assign(p.body, { x: band.right - 3 * CELL, y });
	run(150, { moveX: M, moveY: 0 });
	past = Math.max(...stoodIn().map((b) => p.body.x - b.right));
	near(past, limit, 1e-6, 'right: 12 cells past the water at most');
	const fall = river.waterfalls[1];
	const line = fall.y + fall.h / 2;
	const water = river.bands.find((b) => b.y === line);
	const x = (water.left + water.right) / 2;
	Object.assign(p.body, { x, y: line + 6 * CELL });
	run(90, { moveX: 0, moveY: -M });
	near(p.body.y, line + 2 * CELL, 1e-6, 'from below: 1.5 cells from the waterfall cells');
	Object.assign(p.body, { x, y: line - 5 * CELL });
	run(90, { moveX: 0, moveY: M });
	near(p.body.y, line - CELL, 1e-6, 'from above too');
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
		// Further from the bridge than the slide's corner distance: within it, a push at the water
		// carries him along the edge and onto the bridge.
		const off = plank + 7 * CELL;
		Object.assign(p.body, { x: bandAt(river, off).left - 4 * CELL, y: off });
		run(60, { moveX: M, moveY: 0 });
		const stood = river.bands.filter((b) => p.body.y + 44 > b.y && p.body.y - 44 < b.y + b.h);
		assert.ok(
			stood.every((b) => p.body.x + 28 <= b.left + 1e-6),
			`off the bridge the water stops it (${p.body.x})`,
		);
		assert.ok(Math.abs(p.body.y - plank) > 2 * CELL, 'and he is not on the bridge');
		// Within the corner distance the slide carries him along the edge: onto the bridge or held
		// at the water, never into it.
		Object.assign(p.body, {
			x: bandAt(river, plank + 3 * CELL).left - 4 * CELL,
			y: plank + 3 * CELL,
		});
		for (let i = 0; i < 90; i++) {
			run(1, { moveX: M, moveY: 0 });
			const { x, y } = p.body;
			const wet = river.bands.some(
				(b) => y + 44 > b.y && y - 44 < b.y + b.h && x + 28 > b.left + 1e-6 && x - 28 < b.right,
			);
			const bridged = x + 28 > bridge.x - 2 * CELL && Math.abs(y - plank) <= CELL / 2 + 44;
			assert.ok(!wet || bridged, `3 cells off: in the water at ${x}, ${y}`);
		}
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
	"the bridge as drawn is the room's: the fisherman drawn on the deck, its slopes the rule's, over the deck",
	() => {
		assert.equal(BRIDGE.height, SALMONS_MAP.BRIDGE_HEIGHT, "the art's deck height is the map's");
		const { p, run, river } = originalRoom(1, 'fisherman');
		const bridge = river.bridges[1];
		const n = Math.round(bridge.w / CELL);
		const plank = bridge.y + CELL / 2;
		const xOf = (i) => bridge.x + (i + 0.5) * CELL;
		const deck = deckLift(bridge.height);
		assert.equal(deck, bridge.height * 16 * (CELL / 32), 'the deck: 16 old px a cell, × K');
		// The seed prop's slopes (`propComponents.ts`), as `propPieces` stands them: each from its
		// land cell `run` cells to the deck (its ramp's foot and length).
		const ends = propPieces(BRIDGE_PROP_DEF, { id: 'bridge1', ...bridge }, CELL)
			.filter((piece) => piece.componentId === 'bridgePropSlope')
			.map((piece) => ({ land: piece.cell, end: piece.cell + piece.params.run }));
		assert.deepEqual(
			ends.map(({ end }) => end).sort((a, b) => a - b),
			[0, n - 1],
			'both ends',
		);
		for (const { land, end } of ends)
			assert.equal(Math.abs(land - end), BRIDGE_SLOPE, `a slope runs ${BRIDGE_SLOPE} cells`);
		// The height the art draws at x: the deck, and each slope straight from its foot to it.
		const drawnAt = (x) => {
			if (x >= xOf(0) && x <= xOf(n - 1)) return deck;
			for (const { land, end } of ends) {
				const t = (x - xOf(land)) / (xOf(end) - xOf(land));
				if (t >= 0 && t <= 1) return deck * t;
			}
			return 0;
		};
		// Every tile's deck, at the original's z (`sy + 1100`: 100 old px over a player, 3 depth each).
		const decks = Array.from(
			{ length: n },
			(_, i) => (Math.floor(isoDepth(xOf(i), plank)) + 300) * ISO_DEPTH_SPREAD,
		);
		const ground = riverElevation(river.waterfalls).at(plank);
		Object.assign(p.body, { x: bridge.x - 4 * CELL, y: plank });
		let onDeck = 0;
		let onSlope = 0;
		for (let i = 0; i < 400 && p.body.x < bridge.x + bridge.w + 4 * CELL; i++) {
			run(1, { moveX: M, moveY: 0 });
			const lift = aloftLift('fisherman', p.z ?? 0);
			near(lift, drawnAt(p.body.x), 1e-6, `drawn at the art's height at ${p.body.x}`);
			if (lift === deck) onDeck += 1;
			else if (lift > 0) onSlope += 1;
			if (lift > 0) {
				// Drawn raised by its place (`online.ts` `raisedPlace`), sorted with its bias.
				const raise = ground + lift;
				const z = isoDepthOrder(p.body.x - raise, p.body.y - raise, 0, aloftDepth(lift));
				assert.ok(
					decks.every((d) => z > d),
					`over every tile of the deck at ${p.body.x}`,
				);
			}
		}
		assert.ok(onDeck > 5 && onSlope > 2, `walked the slopes and the deck (${onSlope}, ${onDeck})`);
		assert.equal(aloftLift('salmon', bridge.height * CELL), 0, "a salmon's look draws its own z");
		assert.equal(aloftDepth(0), 0, 'on the ground: no bias');
		// A salmon under the deck (on its row, at a tile's middle) stays under it.
		for (let i = 0; i < n; i++)
			assert.ok(isoDepthOrder(xOf(i) - ground, plank - ground, 0) < decks[i], 'a salmon under');
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
