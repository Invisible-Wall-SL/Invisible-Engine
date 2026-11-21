// WHAT A ROOM'S BOTS ARE CALLED (docs/status/salmons.md, 2026-11-21; `game-config`
// `ArcadeOnlineBotCharacter.names`, `engine-mechanics` `botNames.js`, `services/game-server`
// `roomSim.ts`). Headless over the room's own code. The normalizer keeps a class's names (trimmed,
// none empty, none past a person's name length, none twice); in Salmons' room of 100 every player's
// name is its own, every bot's is from its class's list and has no "bot" in it; a room's names
// replay from its seed; a person keeps the name it typed, and a bot that held it takes another;
// past a list's end a name takes a number and still fits; a game with no names keeps "Bot N".
//
// Run: pnpm check:bot-names

import assert from 'node:assert/strict';

import { NAME_LENGTH, cleanName } from '../packages/engine-mechanics/src/online.js';
import { nameKey } from '../packages/engine-mechanics/src/botNames.js';
import { SALMONS_BOT_NAMES, salmonsConfig } from '../packages/engine-mechanics/src/salmons.js';
import { SALMONS_MAP_SEED, salmonsMapRiver } from '../packages/engine-mechanics/src/salmonsMap.js';
import { normalizeGameConfigDoc, onlineGameOf } from '../packages/game-config/index.ts';
import { createRoomSim } from '../services/game-server/src/roomSim.ts';

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

const gameOf = (doc, options) => {
	const game = onlineGameOf(normalizeGameConfigDoc(doc), options);
	assert.ok(game && !('refused' in game), JSON.stringify(game));
	return game;
};
const salmons = gameOf(salmonsConfig(salmonsMapRiver(SALMONS_MAP_SEED)));
const botsOf = (sim) => [...sim.players.values()].filter((p) => p.bot);
const namesOf = (sim) => Object.fromEntries([...sim.players.values()].map((p) => [p.id, p.name]));
/** Whether every player in the room has a name of its own, letter case aside. */
const unique = (sim) => {
	const keys = [...sim.players.values()].map((p) => nameKey(p.name));
	return new Set(keys).size === keys.length;
};
const fits = (name) => cleanName(name) === name && [...name].length <= NAME_LENGTH;

/** A plain game of one class, `fish`, whose bots are called `names` (none: no list), kept at
 *  `fillTo`. */
const fishDoc = (names, fillTo = 6) => ({
	family: 'arcade',
	outcome: 'rules',
	gameName: 'Names',
	arcade: {
		field: { w: 1600, h: 1200 },
		bodies: { look: { shape: 'circle', r: 12, tags: ['fish'] } },
		characters: [
			{
				id: 'still',
				component: 'look',
				brain: { initial: 'rest', states: [{ id: 'rest', behaviour: 'idle' }], transitions: [] },
			},
		],
		online: {
			maxPlayers: 20,
			characters: [{ id: 'fish', body: 'look', speed: 200 }],
			spawn: { x: 800, y: 600 },
			bots: {
				characters: [{ character: 'fish', brain: 'still', ...(names ? { names } : {}) }],
				fillTo,
			},
		},
	},
});

check('the normalizer keeps a class’s names: trimmed, none empty, too long or twice', () => {
	const long = 'x'.repeat(NAME_LENGTH + 1);
	const doc = normalizeGameConfigDoc(
		fishDoc(['  Finn  ', '', 'finn', 'Gill', long, 7, 'x'.repeat(NAME_LENGTH)]),
	);
	assert.deepEqual(doc.arcade.online.bots.characters[0].names, [
		'Finn',
		'Gill',
		'x'.repeat(NAME_LENGTH),
	]);
	const many = normalizeGameConfigDoc(fishDoc(Array.from({ length: 600 }, (_, i) => `F${i}`)));
	assert.equal(many.arcade.online.bots.characters[0].names.length, 500);
	assert.equal(normalizeGameConfigDoc(fishDoc()).arcade.online.bots.characters[0].names, undefined);
	assert.equal(
		normalizeGameConfigDoc(fishDoc([])).arcade.online.bots.characters[0].names,
		undefined,
	);
});

check(
	'Salmons’ lists: each longer than its class’s places at 100, fitting, none twice, no “bot”',
	() => {
		const counts = salmons.online.bots.counts;
		const every = [];
		for (const [character, names] of Object.entries(SALMONS_BOT_NAMES)) {
			assert.ok(names.length > counts[character], `${character}: ${names.length} names`);
			every.push(...names);
			for (const name of names) {
				assert.ok(fits(name), `"${name}" fits a person's name rules`);
				assert.ok(!/bot/i.test(name), `"${name}" has no "bot"`);
			}
		}
		assert.equal(new Set(every.map(nameKey)).size, every.length, 'no name in two lists or twice');
		assert.deepEqual(
			salmons.online.bots.characters.map((c) => [c.character, c.names]),
			Object.entries(SALMONS_BOT_NAMES).map(([character, names]) => [character, [...names]]),
			'the config carries them (the export with it)',
		);
	},
);

check('a Salmons room of 100: every name its own, every bot’s from its class’s list', () => {
	for (let seed = 1; seed <= 12; seed++) {
		for (const character of ['salmon', 'fisherman', 'bear']) {
			const sim = createRoomSim(salmons, { seed });
			sim.join('me', { character, name: 'Lia' });
			assert.equal(sim.players.size, 100);
			assert.ok(unique(sim), `room ${seed} (${character}): two players share a name`);
			for (const bot of botsOf(sim)) {
				assert.ok(
					SALMONS_BOT_NAMES[bot.character.id].includes(bot.name),
					`room ${seed}: ${bot.id}, a ${bot.character.id}, is "${bot.name}"`,
				);
				assert.ok(!/bot/i.test(bot.name) && fits(bot.name));
			}
			assert.equal(sim.players.get('me').name, 'Lia');
		}
	}
});

check('a room’s names replay from its seed, and another seed draws others', () => {
	const roomOf = (seed) => {
		const sim = createRoomSim(salmons, { seed });
		sim.join('me', { character: 'salmon', name: 'Lia' });
		return namesOf(sim);
	};
	assert.deepEqual(roomOf(5), roomOf(5));
	assert.notDeepEqual(roomOf(5), roomOf(6));
});

check('a person keeps the name it typed: the bot that held it takes another', () => {
	const sim = createRoomSim(salmons, { seed: 3 });
	sim.join('a', { character: 'bear', name: 'Lia' });
	const held = botsOf(sim).find((p) => p.character.id === 'salmon');
	const typed = held.name.toUpperCase();
	sim.join('b', { character: 'fisherman', name: typed });
	assert.equal(sim.players.get('b').name, typed, 'the person keeps the name as typed');
	assert.notEqual(nameKey(held.name), nameKey(typed), 'the bot is called something else');
	assert.ok(SALMONS_BOT_NAMES.salmon.includes(held.name), 'another of its class’s names');
	assert.ok(unique(sim));
	// A person who comes in with a name a bot could draw: the room's bots draw around it.
	const first = createRoomSim(salmons, { seed: 3 });
	const drawn = (() => {
		first.join('x', { character: 'bear', name: 'Lia' });
		return botsOf(first).map((p) => p.name);
	})();
	for (const name of drawn.slice(0, 5)) {
		const room = createRoomSim(salmons, { seed: 3 });
		room.join('x', { character: 'bear', name });
		assert.ok(unique(room), `"${name}" typed: still one each`);
		assert.equal(room.players.get('x').name, name);
	}
});

check('past a list’s end a name takes a number, and still fits a person’s name', () => {
	const long = 'Salmon of Great Renown!!';
	assert.equal([...long].length, NAME_LENGTH);
	const sim = createRoomSim(gameOf(fishDoc(['Finn', long], 9)), { seed: 1 });
	sim.join('me', { name: 'finn 2' });
	const names = botsOf(sim).map((p) => p.name);
	assert.equal(names.length, 8);
	assert.ok(unique(sim), JSON.stringify(names));
	for (const name of names) assert.ok(fits(name), `"${name}" fits`);
	assert.ok(names.includes('Finn') && names.includes(long));
	assert.ok(names.includes('Finn 3'), 'a person’s "finn 2" is skipped');
	assert.ok(names.some((n) => n.endsWith(' 2') && n.startsWith('Salmon of Great Renown')));
});

check('a game whose bots name no list keeps “Bot N”', () => {
	const sim = createRoomSim(gameOf(fishDoc(undefined, 4)), { seed: 1 });
	sim.join('me', { name: 'Bot 2' });
	assert.deepEqual(
		botsOf(sim).map((p) => p.name),
		['Bot 1', 'Bot 2', 'Bot 3'],
		'as before: no list, no renaming',
	);
});

console.log(`check:bot-names — ${passed} checks passed`);
