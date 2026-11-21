/**
 * What a room's bots are called (`game-config` `ArcadeOnlineBotCharacter.names`): each class's
 * names in an order drawn from the room's seed, so a room replays. A bot takes the first name of
 * its class's order that no player in the room holds (letter case aside); once every one is held,
 * the first that is free with a number after it (" 2", " 3", …), the name cut so the whole stays
 * within a person's name length. So no two players in a room share a name, whatever the room's
 * size, and a person keeps the name it typed: the room renames a bot that holds it
 * (`services/game-server` `roomSim.ts`). A class with no names is left to the room ("Bot N").
 *
 * Plain, dependency-free ESM, deterministic: no clock and no `Math.random`.
 */

import { createRng } from './board.js';
import { NAME_LENGTH, cleanName } from './online.js';

/** The key two names are the same by: letter case aside. */
export const nameKey = (name) => name.toLocaleLowerCase('en');

/** `name` with `n` after it, cut so the whole is at most {@link NAME_LENGTH} characters. */
const numbered = (name, n) => {
	const tail = ` ${n}`;
	return `${[...name]
		.slice(0, NAME_LENGTH - tail.length)
		.join('')
		.trimEnd()}${tail}`;
};

/**
 * The namer of one room: `names` by character id (each class's list, as its bots entries give
 * them), `seed` the room's. `next(character, taken)` is the name for a new bot of `character`
 * that is not in `taken` (a set of {@link nameKey}s: every player's in the room), or `undefined`
 * for a class with no names.
 */
export function createBotNamer(names, seed) {
	const orders = new Map();
	const orderOf = (character) => {
		let order = orders.get(character);
		if (order) return order;
		const seen = new Set();
		order = [];
		for (const raw of names[character] ?? []) {
			const name = cleanName(raw);
			if (!name || seen.has(nameKey(name))) continue;
			seen.add(nameKey(name));
			order.push(name);
		}
		const rng = createRng(`${seed}:names:${character}`);
		for (let i = order.length - 1; i > 0; i--) {
			const j = Math.floor(rng() * (i + 1));
			[order[i], order[j]] = [order[j], order[i]];
		}
		orders.set(character, order);
		return order;
	};
	return {
		next(character, taken) {
			const order = orderOf(character);
			if (!order.length) return undefined;
			for (const name of order) if (!taken.has(nameKey(name))) return name;
			for (let n = 2; ; n++)
				for (const name of order) {
					const candidate = numbered(name, n);
					if (!taken.has(nameKey(candidate))) return candidate;
				}
		},
	};
}
