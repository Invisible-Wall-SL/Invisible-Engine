// A ROOM AND ITS DEVICES PLAY ONE LEVEL (owner, 2026-11-25: "changing the seed generates a new
// level, but does not update collisions"). The game server makes a room's level from the published
// config; a device makes its own from the config it booted with, and a launcher link boots the
// project's LIVE config. With `arcade.online.levels` saved in `/editor` and not yet published, the
// two were different rivers of one seed: the picture was not the collisions, and nothing said so.
//
// The room's state now says the levels its generator read and a fingerprint of the level it made;
// the device plays the room's levels and leaves a room whose level it cannot make
// (`engine-mechanics` `roomLevelState`, `roomLevelGame`). THIS GATE FAILS IF A DEVICE AND ITS ROOM
// CAN MAKE DIFFERENT LEVELS WITHOUT THE DEVICE NOTICING: over pairs of configs and seeds, after the
// device's decision its level is the room sim's own (field, zones, zone rules, spawns) with the
// parts that differed named, or the decision is a refusal. Never different and not refused.
//
// The room's side is the game server's own code: its config reader (`configSource.ts`), its room
// (`createRoomSim`) and, in the live half, a real Colyseus room with a real SDK client. The
// device's side is the decision `apps/lines` `online.ts` wires, on a game resolved its way;
// the source pins at the end hold `online.ts` and `arcadeRoom.ts` to it.
//
//   pnpm check:room-levels

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import {
	ONLINE_GENERATORS,
	ROOM_LEVELS_MAX,
	generatedOnlineGame,
	levelHash,
	roomLevelGame,
	roomLevelState,
	roomLevels,
} from '../packages/engine-mechanics/src/onlineGenerators.js';
import { SALMONS_LEVELS, salmonsConfig } from '../packages/engine-mechanics/src/salmons.js';
import {
	CELL,
	SALMONS_MAP,
	SALMONS_MAP_SEED,
	salmonsMapRiver,
	seedLevels,
} from '../packages/engine-mechanics/src/salmonsMap.js';
import {
	normalizeGameConfigDoc,
	onlineGameOf,
	onlineTestSizeRange,
	shapedOnlineGame,
	withOnlineSlide,
} from '../packages/game-config/index.ts';
import { createConfigSource } from '../services/game-server/src/configSource.ts';
import { createRoomSim } from '../services/game-server/src/roomSim.ts';
import { NearbyRoomState, RoomState } from '../services/game-server/src/schema.ts';
import { ROOM_NAME, createGameServer } from '../services/game-server/src/server.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const gameServerRequire = createRequire(join(ROOT, 'services/game-server/package.json'));
const { Client } = await import(pathToFileURL(gameServerRequire.resolve('@colyseus/sdk')).href);
const { matchMaker } = await import(
	pathToFileURL(gameServerRequire.resolve('@colyseus/core')).href
);

let passed = 0;
const check = async (name, fn) => {
	await fn();
	passed++;
	console.log(`  ok  ${name}`);
};

// --- The configs --------------------------------------------------------------------------------

/** Salmons' config as its export writes it, with `levels` as its `arcade.online.levels`. */
const rawOf = (levels, change = (online) => online) => {
	const doc = salmonsConfig(salmonsMapRiver(SALMONS_MAP_SEED), { levels });
	doc.arcade.online = change(doc.arcade.online);
	return doc;
};

/** Pieces an author laid on a level: two additions in the water of every seed here, a removal. */
const PIECES = {
	add: [
		{ cell: [100, 0], kind: 'rock' },
		{ cell: [150, 0], kind: 'waterfall', height: 3 },
	],
	remove: [[40, 0]],
};
const SEEDS = [7, 9, 31337, 123456789];

/** Every generator setting an author may give, a few of them off their defaults (2026-11-26). */
const TUNED = {
	riverLength: 320,
	obstacleChance: 0.45,
	bridgeCount: 1,
	rockSize: 2,
	bankCells: 18,
};
/** Authored biomes that change what a level plays (densities) and draws (looks), with one seed's
 *  own sequence. */
const BIOMES = {
	kinds: [
		{ id: 'rapids', rocks: 2.5, whirlpools: 2, trees: [2, 5], forestFloor: '#3a2f1e' },
		{ id: 'meadow', rocks: 0, whirlpools: 0, sand: 2, waterfalls: 0.5, bridges: false },
	],
	sequences: {
		'*': [
			{ from: 0, biome: 'rapids' },
			{ from: 150, biome: 'meadow' },
		],
		9: [{ from: 0, biome: 'meadow' }],
	},
};

/**
 * Each config's `levels`, and what they say part by part (`parts`: a tag per part, by seed when it
 * depends on one), written by hand so the parts the decision names are held to them and not to the
 * function under test. `published` and `live` are THE REAL PAIR of 2026-11-25: the published
 * snapshot had no `levels`, the live config Salmons' winding river and tall waterfalls.
 */
const CONFIGS = {
	published: { levels: undefined, parts: {} },
	live: { levels: SALMONS_LEVELS, parts: { river: 'salmons', waterfalls: 'tall' } },
	pinned: { levels: { seeds: [7, 9] }, parts: {} },
	straighter: { levels: { river: { winding: 0.4 } }, parts: { river: 'straighter' } },
	nine: { levels: { waterfalls: { count: 9 } }, parts: { waterfalls: 'nine' } },
	pieces: { levels: { overlays: { '*': PIECES } }, parts: { overlays: 'pieces' } },
	tuned: { levels: { generator: TUNED }, parts: { generator: 'tuned' } },
	biomed: {
		levels: { ...SALMONS_LEVELS, biomes: BIOMES },
		parts: {
			river: 'salmons',
			waterfalls: 'tall',
			biomes: (seed) => (seed === 9 ? 'biomed-9' : 'biomed'),
		},
	},
	seven: {
		levels: { ...SALMONS_LEVELS, overlays: { 7: PIECES } },
		parts: {
			river: 'salmons',
			waterfalls: 'tall',
			overlays: (seed) => (seed === 7 ? 'pieces' : undefined),
		},
	},
};
const tagOf = (name, part, seed) => {
	const tag = CONFIGS[name].parts[part];
	return typeof tag === 'function' ? tag(seed) : tag;
};
/** The parts of two configs' levels that differ for a room of `seed`, in name order. */
const partsThatDiffer = (a, b, seed) =>
	['biomes', 'generator', 'overlays', 'river', 'waterfalls'].filter(
		(p) => tagOf(a, p, seed) !== tagOf(b, p, seed),
	);

/** A game as a device resolves the config it booted with (`online.ts` `joinOnlineRoom`). */
const deviceGame = (baked) =>
	shapedOnlineGame(
		withOnlineSlide(onlineGameOf(normalizeGameConfigDoc(baked) ?? null), baked),
		baked,
	);

/** What a room and a device collide against and spawn by: the parts a generator makes. */
const levelOf = (game) => ({
	field: game.field,
	zones: game.zones,
	zoneRules: game.online.rules.zones,
	spawn: game.online.spawn,
	spawns: Object.fromEntries(game.online.characters.map((c) => [c.id, c.spawns])),
	botSpawns: game.online.bots.spawns,
});

/**
 * Whether two levels, games or made rivers are the same, and a failure that names where they are
 * not. Never `assert.deepEqual`: a level is thousands of zones, and the diff of two would be all
 * the gate printed.
 */
const whereNot = (a, b) =>
	Object.keys({ ...a, ...b })
		.filter((key) => !isDeepStrictEqual(a[key], b[key]))
		.join(', ');
const assertSame = (a, b, what) =>
	assert.ok(isDeepStrictEqual(a, b), `${what}: not the same (${whereNot(a, b)})`);

const dir = mkdtempSync(join(tmpdir(), 'room-levels-'));
/** A huge overlay, more than a room's state carries: a waterfall, and removals down the river. */
const LONG = {
	overlays: {
		'*': {
			add: [{ cell: [150, 0], kind: 'waterfall', height: 3 }],
			remove: Array.from({ length: 2000 }, (_, i) => [390 - (i % 200), i]),
		},
	},
};
/** Salmons with no generator (its authored river) and no nearby box (the plain room state). */
const NO_GENERATOR = rawOf(undefined, (online) => {
	const plain = { ...online };
	delete plain.generator;
	delete plain.nearby;
	return plain;
});
const SERVED = {
	...Object.fromEntries(Object.entries(CONFIGS).map(([name, { levels }]) => [name, rawOf(levels)])),
	long: rawOf(LONG),
	band: salmonsConfig(),
	plain: NO_GENERATOR,
};
for (const [name, doc] of Object.entries(SERVED))
	writeFileSync(join(dir, `${name}.json`), JSON.stringify(doc));

/** The game server's own read of a published config. */
const loadGame = createConfigSource({ dir });

/** A room of `name`'s config seeded `seed`, and what it writes in its state: once each. */
const rooms = new Map();
const roomOf = async (name, seed) => {
	const key = `${name}:${seed}`;
	if (!rooms.has(key)) {
		const sim = createRoomSim(await loadGame(name), { seed });
		rooms.set(key, { sim, said: roomLevelState(sim.game, seed, sim.made) });
	}
	return rooms.get(key);
};

const HEX16 = /^[0-9a-f]{16}$/;

try {
	// --- 1. Every pair of configs, every seed: the device's level is the room's ------------------

	await check(
		'device and room: after the decision the level is the room sim’s own, or it is refused',
		async () => {
			let pairs = 0;
			let drifted = 0;
			let adopted = 0;
			for (const roomName of Object.keys(CONFIGS))
				for (const deviceName of Object.keys(CONFIGS))
					for (const seed of SEEDS) {
						const { sim, said } = await roomOf(roomName, seed);
						const own = deviceGame(SERVED[deviceName]);
						const decided = roomLevelGame(own, seed, said);
						const what = `room "${roomName}", device "${deviceName}", seed ${seed}`;
						pairs += 1;
						// The same generator on both sides: every one of these can be played.
						assert.ok(!('refused' in decided), `${what}: refused (${decided.refused})`);
						assertSame(
							levelOf(decided.game),
							levelOf(sim.game),
							`${what}: the device plays another level than its room, and was not refused`,
						);
						const differs = partsThatDiffer(roomName, deviceName, seed);
						assert.deepEqual(decided.differs, differs, `${what}: the parts named`);
						assert.deepEqual(
							decided.made.biomes,
							sim.made.biomes,
							`${what}: the biomes the device draws are the room's`,
						);
						assert.equal(decided.adopted, differs.length > 0, `${what}: adopted`);
						assert.equal(decided.levelHash, said.levelHash, `${what}: its fingerprint`);
						assert.equal(decided.roomLevelHash, said.levelHash);
						// Nothing adopted: the game it plays is made from its own config, as before.
						if (!decided.adopted)
							assert.equal(
								decided.game.online.levels,
								own.online.levels,
								`${what}: its own levels`,
							);
						if (decided.adopted) adopted += 1;
						// What the device made before this change: its own config's level.
						const before = generatedOnlineGame(own, seed);
						if (!isDeepStrictEqual(levelOf(before.game), levelOf(sim.game))) {
							drifted += 1;
							assert.ok(decided.adopted, `${what}: a level that differed was not adopted`);
						}
					}
			assert.equal(pairs, Object.keys(CONFIGS).length ** 2 * SEEDS.length);
			assert.ok(drifted >= pairs / 2, `only ${drifted} of ${pairs} pairs made different levels`);
			console.log(
				`      ${pairs} decisions: ${drifted} would have played another level than their room, ` +
					`${adopted} adopted the room's levels, none refused`,
			);
		},
	);

	await check(
		'a room plays the stored config’s generator settings and biomes, and says them',
		async () => {
			for (const seed of SEEDS) {
				const tuned = await roomOf('tuned', seed);
				const P = JSON.parse(tuned.said.levels).generator;
				assert.deepEqual(
					Object.keys(P).length,
					Object.keys(JSON.parse(JSON.stringify(seedLevels({ generator: {} }, seed).generator)))
						.length,
					'every setting, said whole',
				);
				for (const [key, value] of Object.entries(TUNED)) assert.equal(P[key], value, key);
				assert.equal(tuned.sim.made.world.h, (P.sourceRows + 320 + P.seaRows) * CELL);
				assert.equal(tuned.sim.made.bridges.length, 1);
				assert.ok(tuned.sim.made.rocks.every((r) => r.w === 2 * CELL));
				const biomed = await roomOf('biomed', seed);
				const said = JSON.parse(biomed.said.levels).biomes;
				assert.deepEqual(
					said.sequences['*'],
					seed === 9 ? BIOMES.sequences[9] : BIOMES.sequences['*'],
					`seed ${seed}: the room says the seed's own sequence`,
				);
				assert.deepEqual(
					said.kinds.map((k) => k.id),
					['rapids', 'meadow'],
				);
				assert.deepEqual(biomed.sim.made.biomes.kinds, said.kinds);
				const plain = await roomOf('live', seed);
				assert.notEqual(
					biomed.said.levelHash,
					plain.said.levelHash,
					`seed ${seed}: the biomes' densities move the level`,
				);
			}
		},
	);

	await check('the real pair: a published room, a live device (and the reverse)', async () => {
		for (const seed of SEEDS) {
			const { sim, said } = await roomOf('published', seed);
			assert.deepEqual(said, { levels: '{}', levelHash: said.levelHash });
			assert.match(said.levelHash, HEX16);
			const live = deviceGame(SERVED.live);
			// Before: the device drew the live config's river in a room colliding against the original's.
			const before = generatedOnlineGame(live, seed);
			const columns = (made) =>
				made.bands.flatMap((b) =>
					Array.from({ length: b.h / CELL }, () => `${b.left / CELL}:${b.right / CELL}`),
				);
			const [drawn, played] = [columns(before.made), columns(sim.made)];
			assert.equal(drawn.length, SALMONS_MAP.RIVER_LENGTH);
			const other = drawn.filter((c, gx) => c !== played[gx]).length;
			assert.ok(other >= 390, `seed ${seed}: ${other} of 400 columns of water differed`);
			const decided = roomLevelGame(live, seed, said);
			assert.deepEqual(decided.differs, ['river', 'waterfalls']);
			assert.equal(decided.adopted, true);
			assertSame(decided.made, sim.made, `seed ${seed}: what it draws against what the room made`);
			assert.deepEqual(decided.game.online.levels, {}, 'the room’s levels: the original’s');
			const back = await roomOf('live', seed);
			assert.equal(
				back.said.levels,
				JSON.stringify({ river: SALMONS_LEVELS.river, waterfalls: SALMONS_LEVELS.waterfalls }),
			);
			const reverse = roomLevelGame(deviceGame(SERVED.published), seed, back.said);
			assert.deepEqual(reverse.differs, ['river', 'waterfalls']);
			assertSame(reverse.made, back.sim.made, `seed ${seed}, the reverse`);
			assert.notEqual(back.said.levelHash, said.levelHash, 'the two levels’ fingerprints differ');
		}
	});

	await check(
		'equal levels: nothing adopted, the device’s own game, whatever else differs',
		async () => {
			for (const seed of SEEDS) {
				const { sim, said } = await roomOf('live', seed);
				const same = roomLevelGame(deviceGame(SERVED.live), seed, said);
				assert.deepEqual([same.adopted, same.differs], [false, []]);
				assertSame(
					same.game,
					generatedOnlineGame(deviceGame(SERVED.live), seed).game,
					'its own game',
				);
				// Pinned seeds are the room's to pick from, not part of a level.
				const pinned = roomLevelGame(
					deviceGame(SERVED.pinned),
					seed,
					(await roomOf('published', seed)).said,
				);
				assert.deepEqual([pinned.adopted, pinned.differs], [false, []]);
				assert.deepEqual(pinned.game.online.levels, { seeds: [7, 9] });
				// A device whose config differs OUTSIDE its levels is not this gate's business: the
				// fingerprint is of the level alone, so it plays.
				const elsewhere = deviceGame(
					rawOf(SALMONS_LEVELS, (online) => ({
						...online,
						rejoinSeconds: 9,
						characters: online.characters.map((c) => ({ ...c, speed: c.speed + 11 })),
						pointer: { ...online.pointer, deadZone: 2 * CELL },
					})),
				);
				const drift = roomLevelGame(elsewhere, seed, said);
				assert.ok(!('refused' in drift), 'a config that differs outside its levels is not refused');
				assert.deepEqual([drift.adopted, drift.levelHash], [false, said.levelHash]);
				assertSame(
					levelOf(drift.game),
					levelOf(sim.game),
					`seed ${seed}, a config that differs elsewhere`,
				);
			}
		},
	);

	// --- 2. A level the device cannot make is refused --------------------------------------------

	await check('a room whose generator is not the device’s is refused, by one pixel', async () => {
		const seed = 31337;
		const original = ONLINE_GENERATORS.salmonsMap;
		const live = deviceGame(SERVED.live);
		let said;
		let sim;
		// The game server on another release of the generator: one rock, one pixel over.
		ONLINE_GENERATORS.salmonsMap = {
			...original,
			make: (...args) => {
				const made = original.make(...args);
				return { ...made, rocks: made.rocks.map((r, i) => (i ? r : { ...r, x: r.x + 1 })) };
			},
		};
		try {
			sim = createRoomSim(await loadGame('live'), { seed });
			said = roomLevelState(sim.game, seed, sim.made);
		} finally {
			ONLINE_GENERATORS.salmonsMap = original;
		}
		const mine = generatedOnlineGame(live, seed);
		assert.equal(whereNot(levelOf(mine.game), levelOf(sim.game)), 'zones', 'one zone differs');
		for (const device of [live, deviceGame(SERVED.published)]) {
			const decided = roomLevelGame(device, seed, said);
			assert.equal(decided.refused, 'generator');
			assert.ok(!('game' in decided), 'a refusal hands over no game to play');
			assert.equal(decided.roomLevelHash, said.levelHash);
			assert.match(decided.levelHash, HEX16);
			assert.notEqual(decided.levelHash, said.levelHash);
		}
		// And the room's fingerprint alone, with the right levels beside it.
		const honest = (await roomOf('live', seed)).said;
		const forged = {
			...honest,
			levelHash: honest.levelHash.replace(/.$/, (d) => (d === '0' ? '1' : '0')),
		};
		assert.equal(roomLevelGame(live, seed, forged).refused, 'generator');
		assert.ok(!('refused' in roomLevelGame(live, seed, honest)));
	});

	await check('levels too long to send: the fingerprint alone decides', async () => {
		const seed = 9;
		const { sim, said } = await roomOf('long', seed);
		assert.ok(JSON.stringify(roomLevels(sim.game, seed)).length > ROOM_LEVELS_MAX);
		assert.equal(said.levels, '', 'not sent');
		assert.match(said.levelHash, HEX16);
		const same = roomLevelGame(deviceGame(SERVED.long), seed, said);
		assert.ok(!('refused' in same), 'the same config still plays');
		assert.deepEqual([same.adopted, same.differs], [false, []]);
		assertSame(levelOf(same.game), levelOf(sim.game), 'the same long config');
		const other = roomLevelGame(deviceGame(SERVED.published), seed, said);
		assert.equal(other.refused, 'levels', 'another config cannot make it, and is told why');
		// What Salmons ships is nowhere near the limit.
		const shipped = (await roomOf('live', seed)).said.levels;
		assert.ok(shipped.length < 200 && ROOM_LEVELS_MAX >= 8192, `${shipped.length} characters`);
		// Levels that do not read as levels are levels not sent.
		for (const levels of ['{', '[1', 'null', '7', '{"overlays":{"*":{"add":[{}]}}}']) {
			const odd = roomLevelGame(deviceGame(SERVED.long), seed, { ...said, levels });
			assert.ok(!('refused' in odd) && !odd.adopted, `levels ${levels}`);
		}
		// The limit is the device's too: more than it, whoever sent it, is not read (were these
		// other levels read, the device would adopt them and no longer make the room's level).
		const flood = JSON.stringify(roomLevels(sim.game, seed));
		const live = await roomOf('live', seed);
		const flooded = roomLevelGame(deviceGame(SERVED.live), seed, { ...live.said, levels: flood });
		assert.ok(!('refused' in flooded), 'levels past the limit are not read');
		assert.deepEqual([flooded.adopted, flooded.levelHash], [false, live.said.levelHash]);
	});

	await check(
		'another generator on one side: refused, whichever side, and never played',
		async () => {
			const seed = 7;
			const map = await roomOf('live', seed);
			const band = await roomOf('band', seed);
			assert.notEqual(map.said.levelHash, band.said.levelHash);
			// A device of the band river in a room of the map: it cannot read the room's levels.
			// A device of the map in a room of the band river: the room sent none.
			for (const [device, room] of [
				[deviceGame(SERVED.band), map],
				[deviceGame(SERVED.live), band],
				[deviceGame(SERVED.published), band],
			]) {
				const decided = roomLevelGame(device, seed, room.said);
				assert.equal(decided.refused, 'levels');
				assert.ok(!('game' in decided), 'a refusal hands over no game to play');
				assert.deepEqual([decided.adopted, decided.differs], [false, []]);
				assert.notEqual(decided.levelHash, room.said.levelHash);
			}
		},
	);

	await check('a test room (its own size): the device adopts its levels all the same', async () => {
		const { min, max } = onlineTestSizeRange(deviceGame(SERVED.live).online);
		assert.ok(min < max, `a test room holds ${min} to ${max}`);
		for (const size of [min, Math.floor((min + max) / 2)])
			for (const seed of SEEDS.slice(0, 2)) {
				const sim = createRoomSim(await loadGame('live', size), { seed });
				const said = roomLevelState(sim.game, seed, sim.made);
				const decided = roomLevelGame(deviceGame(SERVED.published), seed, said);
				const what = `a test room of ${size}, seed ${seed}`;
				assert.ok(!('refused' in decided), `${what}: refused`);
				assert.deepEqual(decided.differs, ['river', 'waterfalls'], what);
				assert.equal(decided.levelHash, said.levelHash, what);
				assertSame(levelOf(decided.game), levelOf(sim.game), what);
				assertSame(decided.made, sim.made, `${what}: what it draws`);
			}
	});

	await check('a generator that reads no levels says its fingerprint and no levels', async () => {
		const seed = 7;
		const { sim, said } = await roomOf('band', seed);
		assert.equal(sim.game.online.generator, 'salmonsRiver');
		assert.equal(roomLevels(sim.game, seed), undefined);
		assert.equal(said.levels, '');
		assert.match(said.levelHash, HEX16);
		const decided = roomLevelGame(deviceGame(SERVED.band), seed, said);
		assert.deepEqual(
			[decided.adopted, decided.differs, decided.levelHash],
			[false, [], said.levelHash],
		);
		assertSame(levelOf(decided.game), levelOf(sim.game), 'the band river');
		// Levels a room should never have sent it are not read.
		const told = roomLevelGame(deviceGame(SERVED.band), seed, { ...said, levels: '{"river":{}}' });
		assert.deepEqual([told.adopted, told.differs], [false, []]);
	});

	// --- 3. What must not change ------------------------------------------------------------------

	await check(
		'an older game server (no fields): the device plays its own level, unchecked',
		async () => {
			for (const seed of SEEDS)
				for (const said of [undefined, {}, { seed }, { levels: undefined, levelHash: undefined }]) {
					const own = deviceGame(SERVED.live);
					const decided = roomLevelGame(own, seed, said);
					const { game, made, ...report } = decided;
					assert.deepEqual(report, {
						adopted: false,
						differs: [],
						levelHash: '',
						roomLevelHash: '',
					});
					const before = generatedOnlineGame(own, seed);
					assertSame(game, before.game, 'the game it played before the two fields');
					assertSame(made, before.made, 'what it drew before them');
				}
		},
	);

	await check('a game with no generator: nothing read, made, said or checked', async () => {
		const plain = await loadGame('plain');
		assert.equal(plain.online.generator, undefined);
		const sim = createRoomSim(plain, { seed: 5 });
		assert.equal(sim.made, undefined);
		assert.equal(sim.game, plain, 'the room plays the game as loaded');
		assert.equal(roomLevelState(sim.game, 5, sim.made), undefined, 'its state says nothing');
		const own = deviceGame(NO_GENERATOR);
		for (const said of [undefined, {}, { levels: '{"river":{}}', levelHash: 'ffffffffffffffff' }]) {
			const decided = roomLevelGame(own, 5, said);
			assert.equal(decided.game, own, 'the device plays its game as it is');
			const rest = { ...decided };
			delete rest.game;
			assert.deepEqual(rest, {
				made: undefined,
				adopted: false,
				differs: [],
				levelHash: '',
				roomLevelHash: '',
			});
		}
		assert.equal(levelHash(own, undefined), '');
		assert.equal(roomLevels(own, 5), undefined);
	});

	// --- 4. The levels a room says, and its fingerprint ------------------------------------------

	await check('the levels a room says are in one form: read again they are themselves', () => {
		const odd = {
			seeds: [3],
			river: { winding: 5, sharpestTurn: -3 },
			waterfalls: { count: 5.5, heightMin: 9, heightMax: 4 },
			overlays: { '*': { add: [{ kind: 'rock', cell: [100, 0] }], set: [] }, 9: PIECES, 8: PIECES },
		};
		const all = [...Object.values(CONFIGS).map((c) => c.levels), LONG, odd, { waterfalls: {} }, {}];
		for (const levels of all)
			for (const seed of SEEDS) {
				const read = seedLevels(levels, seed);
				assert.deepEqual(seedLevels(read, seed), read, 'read again: itself');
				assert.deepEqual(JSON.parse(JSON.stringify(read)), read, 'and after the wire');
				assert.ok(!('seeds' in read), 'no pinned seeds');
				for (const part of Object.values(read))
					assert.ok(Object.keys(part).length, 'no empty part');
				const make = ONLINE_GENERATORS.salmonsMap.make;
				assertSame(make(seed, read), make(seed, levels), `seed ${seed}: the level it makes`);
			}
		assert.deepEqual(seedLevels(odd, 9), {
			river: { winding: 1, sharpestTurn: 0, sourceBias: 0.6 },
			waterfalls: { count: 6, heightMin: 4, heightMax: 9 },
			overlays: {
				'*': {
					add: [{ cell: [100, 0], kind: 'rock' }, ...PIECES.add],
					remove: PIECES.remove,
				},
			},
		});
		assert.deepEqual(seedLevels(undefined, 9), {});
		assert.deepEqual(seedLevels({ seeds: [1], waterfalls: {} }, 9), {});
	});

	await check(
		'the fingerprint: equal for equal levels, of the level alone, the same anywhere',
		async () => {
			const names = Object.keys(CONFIGS);
			let alike = 0;
			for (const seed of SEEDS)
				for (const [i, name] of names.entries()) {
					const { sim, said } = await roomOf(name, seed);
					const again = generatedOnlineGame(deviceGame(SERVED[name]), seed);
					assert.equal(levelHash(again.game, again.made), said.levelHash, `${name} ${seed}: again`);
					// Two configs' rooms of one seed have one fingerprint exactly when they play one level.
					for (const other of names.slice(i + 1)) {
						const b = await roomOf(other, seed);
						const same = isDeepStrictEqual(levelOf(sim.game), levelOf(b.sim.game));
						assert.equal(
							said.levelHash === b.said.levelHash,
							same,
							`${name} / ${other}, seed ${seed}`,
						);
						if (same) alike += 1;
					}
					// A Salmons level is whole px all through: an engine's last bit of `Math.sin` or `cos`
					// can move its fingerprint only by moving a cell of the level.
					const walk = (v, at) => {
						if (typeof v === 'number')
							assert.ok(Number.isInteger(v), `${name} ${seed}: ${at} = ${v}`);
						else if (v && typeof v === 'object')
							for (const [k, child] of Object.entries(v)) walk(child, `${at}.${k}`);
					};
					walk(ONLINE_GENERATORS.salmonsMap.geometry(sim.made), 'geometry');
				}
			assert.ok(alike >= SEEDS.length, 'some configs here do play one level (pinned seeds apart)');
			// Of what was made, in any key order; a number that is not whole to the thousandth.
			const made = (nudge, flip) => ({ nudge, flip });
			ONLINE_GENERATORS.gate = {
				make: () => made(0, false),
				geometry: ({ nudge, flip }) => {
					const zone = flip
						? { h: 9, w: 8, y: 2, x: 1.5 + nudge, id: 'a' }
						: { id: 'a', x: 1.5 + nudge, y: 2, w: 8, h: 9 };
					return {
						field: { w: 64, h: 64 },
						zones: [zone],
						zoneRules: [{ zone: 'a', solid: true }],
					};
				},
			};
			ONLINE_GENERATORS.gateToo = ONLINE_GENERATORS.gate;
			try {
				const game = { online: { generator: 'gate' } };
				const print = levelHash(game, made(0, false));
				assert.match(print, HEX16);
				assert.equal(levelHash(game, made(0, true)), print, 'key order');
				assert.equal(levelHash(game, made(2 ** -40, false)), print, 'a last bit');
				assert.equal(levelHash(game, made(-(2 ** -40), true)), print);
				assert.notEqual(levelHash(game, made(0.01, false)), print, 'a hundredth of a px');
				assert.notEqual(levelHash({ online: { generator: 'gateToo' } }, made(0, false)), print);
			} finally {
				delete ONLINE_GENERATORS.gate;
				delete ONLINE_GENERATORS.gateToo;
			}
			const code = readFileSync(
				join(ROOT, 'packages/engine-mechanics/src/onlineGenerators.js'),
				'utf8',
			)
				.replace(/\/\*[\s\S]*?\*\//g, '')
				.replace(/\/\/.*$/gm, '');
			assert.doesNotMatch(code, /Math\.random|Date\.now|performance\.now|\bimport\(|node:|crypto/);
		},
	);

	// --- 5. Live: a real Colyseus room, a real SDK client ----------------------------------------

	const port = await new Promise((resolve) => {
		const probe = createServer();
		probe.listen(0, () => {
			const { port: free } = probe.address();
			probe.close(() => resolve(free));
		});
	});
	const server = createGameServer({
		loadGame,
		maxRooms: 4,
		commit: 'roomlevels00',
		gracefullyShutdown: false,
	});
	await server.listen(port);
	/** Join a room of `game` as the runtime does (no state class of its own: the SDK decodes by the
	 *  schema the server sends), and wait for the first state, which carries the seed. */
	const joinRoom = async (game) => {
		const room = await new Client(`ws://127.0.0.1:${port}`).joinOrCreate(ROOM_NAME, {
			game,
			character: 'salmon',
		});
		room.onMessage('*', () => {});
		for (let i = 0; i < 500 && typeof room.state?.seed !== 'number'; i++)
			await new Promise((r) => setTimeout(r, 10));
		return room;
	};
	try {
		await check(
			'live: the room’s state carries its levels and fingerprint to a device',
			async () => {
				// The published config's room; the device booted the live one (an authoring boot).
				const room = await joinRoom('published');
				const { state } = room;
				const { sim, state: held } = matchMaker.getLocalRoomById(room.roomId);
				assert.ok(held instanceof NearbyRoomState, 'Salmons’ rooms send the nearby state');
				assert.equal(state.seed, sim.seed);
				assert.equal(state.levels, '{}');
				assert.equal(state.levelHash, levelHash(sim.game, sim.made));
				const decided = roomLevelGame(deviceGame(SERVED.live), state.seed, state);
				assert.deepEqual(decided.differs, ['river', 'waterfalls']);
				assert.equal(decided.adopted, true);
				assertSame(
					levelOf(decided.game),
					levelOf(sim.game),
					'the device’s level against the room’s',
				);
				assert.equal(decided.levelHash, state.levelHash);
				// A device from before the two fields reads the state as it did (the SDK decodes by the
				// schema the server sends at the handshake, so fields it does not know cost it nothing):
				// its seed, and with the room's own config, the room's level.
				const older = generatedOnlineGame(deviceGame(SERVED.published), state.seed);
				assertSame(
					levelOf(older.game),
					levelOf(sim.game),
					'an older device with the room’s config',
				);
				await room.leave();
				// And the reverse, so levels that say something cross the wire: the live config's room,
				// a device of the published one.
				const winding = await joinRoom('live');
				const there = matchMaker.getLocalRoomById(winding.roomId).sim;
				assert.equal(
					winding.state.levels,
					JSON.stringify({ river: SALMONS_LEVELS.river, waterfalls: SALMONS_LEVELS.waterfalls }),
				);
				const back = roomLevelGame(deviceGame(SERVED.published), winding.state.seed, winding.state);
				assert.deepEqual([back.adopted, back.differs], [true, ['river', 'waterfalls']]);
				assert.equal(back.levelHash, winding.state.levelHash);
				assertSame(levelOf(back.game), levelOf(there.game), 'the winding river, over the wire');
				await winding.leave();
			},
		);

		await check('live: a room of a game with no generator sends neither', async () => {
			const room = await joinRoom('plain');
			const { state } = room;
			const { state: held } = matchMaker.getLocalRoomById(room.roomId);
			assert.ok(held instanceof RoomState, 'a room with no nearby box sends the plain state');
			assert.equal(typeof state.seed, 'number');
			assert.equal(state.levels, undefined);
			assert.equal(state.levelHash, undefined);
			await room.leave();
		});
	} finally {
		await server.close();
	}

	// --- 6. The two sides are wired to it ---------------------------------------------------------

	await check('source: the room writes both fields, the device goes through the decision', () => {
		const read = (path) => readFileSync(join(ROOT, path), 'utf8');
		const room = read('services/game-server/src/arcadeRoom.ts');
		// From the sim's own game and what its own generator made, into both fields.
		assert.match(
			room,
			/const level = roomLevelState\(sim\.game, seed, sim\.made\);\s+if \(level\) \{\s+this\.state\.levels = level\.levels;\s+this\.state\.levelHash = level\.levelHash;\s+\}/,
		);
		assert.match(
			read('services/game-server/src/roomSim.ts'),
			/const \{ game, made \} = generatedOnlineGame\(authored, seed\);/,
		);
		// Both state classes carry them: the plain one and the nearby one spread the same fields.
		const schema = read('services/game-server/src/schema.ts');
		assert.match(
			schema,
			/const roomFields = \{[\s\S]*?\n\tlevels: t\.string\(\),[\s\S]*?\n\tlevelHash: t\.string\(\),\n\};/,
		);
		assert.match(schema, /export const RoomState = schema\(\{ \.\.\.roomFields,/);
		assert.match(schema, /export const NearbyRoomState = schema\(\{\s*\.\.\.roomFields,/);

		const online = read('apps/lines/src/game/online.ts');
		// The device resolves its game as `deviceGame` above does.
		assert.match(
			online,
			/const resolved = shapedOnlineGame\(\s+withOnlineSlide\(onlineGameOf\(normalizeGameConfigDoc\(baked\) \?\? null\), baked\),\s+baked,\s+\);/,
		);
		// Its level is the decision's and nothing else's: it never generates from its own config.
		assert.match(
			online,
			/const level = seed === undefined \? undefined : roomLevelGame\(resolved, seed, stateOf\(room\)\);/,
		);
		assert.match(online, /const played = level \?\? \{ game: resolved, made: undefined \};/);
		// What it predicts on, draws and loads its art from is that decision's, not its own config's.
		assert.match(online, /const current: Session = \{\s+room,\s+game: played\.game,/);
		assert.match(online, /const field = played\.made && draw\?\.\(played\.made\);/);
		assert.match(online, /loadArt\(played\.made, seed, /);
		assert.doesNotMatch(online, /generatedOnlineGame|ONLINE_GENERATORS|salmonsMapRiver|seedLevels/);
		// A refusal leaves the room first and is the join's answer: a boot's join stops on the
		// error screen with it, a leave for a new room loads the page again (`failSwitch`).
		assert.match(
			online,
			/if \(level && 'refused' in level\) \{\s+room\.leave\(\)[^;]*;\s+return otherLevel\(level, authoring\);\s+\}/,
		);
		assert.match(online, /if \(refused !== undefined\) return refuseOnlineBoot\(refused\);/);
		assert.match(online, /if \(refused !== undefined\) failSwitch\(launch, join, refused\);/);
		// Only an authoring boot is told, and only when it adopted.
		assert.match(online, /authoring: params\.get\(AUTHORING_PARAM\) === '1',/);
		assert.match(
			online,
			/if \(level\?\.adopted && authoring\) showLevelsNotice\(level\.differs\);/,
		);
		assert.equal(online.match(/showLevelsNotice\(/g).length, 2, 'shown from that one place');
		// The probe says what was decided (`scripts/playtest/salmons-room-levels-play.mjs`).
		assert.match(online, /level: current\.level \?\? null,/);
	});
} finally {
	rmSync(dir, { recursive: true, force: true });
}

console.log(`check:room-levels — ${passed} checks passed`);
process.exit(0);
