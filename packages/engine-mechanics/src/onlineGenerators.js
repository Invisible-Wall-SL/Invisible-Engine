/**
 * A FIELD MADE PER ROOM (`docs/design/realtime-multiplayer.md` §14 #4, P11.2 (e)): an online game
 * whose config names a generator (`arcade.online.generator`) plays, in each room, a field of its
 * own made from the room's seed. The room picks the seed and carries it in its state; the server
 * (`services/game-server` `createRoomSim`) and every device (`apps/lines` `game/online.ts`) run
 * {@link generatedOnlineGame} on it, so both step the same field, and the device draws what the
 * generator made (`engine-layout` `FIELD_DRAWINGS`, by the same id).
 *
 * A generator decides the field's geometry only: its size, its zones and their rules, and where
 * players and bots start. Everything else (characters, speeds, abilities, the round, bots) stays
 * as the config says. Its zones and zone rules REPLACE the authored ones, whose river the editor
 * shows. Its field size may differ from the authored one: the device sizes the world scene that
 * holds the drawing to it (`online.ts` `withRoomField`). Plain ESM, like the rest of the package.
 */

import { salmonsGeometry, salmonsRiver } from './salmons.js';
import { levelOverlay, salmonsMapRiver } from './salmonsMap.js';

/**
 * The generators a config can name, by id (`game-config` `ONLINE_GENERATOR_IDS` lists them).
 * `make(seed, levels)` gets the config's `arcade.online.levels`, whose overlays it lays on top;
 * `salmonsRiver` (P10.16's band river) takes none and is kept for the recorded traces.
 */
export const ONLINE_GENERATORS = {
	salmonsRiver: { make: (seed) => salmonsRiver(seed), geometry: salmonsGeometry },
	salmonsMap: {
		make: (seed, levels) => salmonsMapRiver(seed, levelOverlay(levels, seed)),
		geometry: salmonsGeometry,
	},
};

/**
 * The seed a new room plays (`docs/design/salmons-levels.md` §2 b): the next of the config's pinned
 * `levels.seeds`, by the room's count, or, with none pinned, `random` (the original's behaviour: a
 * new level per room).
 */
export function roomLevelSeed(levels, roomCount, random) {
	const seeds = levels?.seeds;
	if (seeds?.length) return seeds[roomCount % seeds.length];
	return random();
}

/**
 * `game` as a room seeded `seed` plays it, and what its generator made from the seed (for the
 * device to draw); a game that names no generator comes back as it is, with nothing made.
 */
export function generatedOnlineGame(game, seed) {
	const id = game.online.generator;
	const generator = id ? ONLINE_GENERATORS[id] : undefined;
	if (!generator) return { game, made: undefined };
	const made = generator.make(seed, game.online.levels);
	const g = generator.geometry(made);
	const { online } = game;
	return {
		game: {
			...game,
			field: g.field,
			zones: g.zones,
			online: {
				...online,
				spawn: g.spawn,
				characters: online.characters.map((c) =>
					g.spawns[c.id] ? { ...c, spawns: g.spawns[c.id] } : c,
				),
				rules: { ...online.rules, zones: g.zoneRules },
				bots: { ...online.bots, spawns: g.botSpawns },
			},
		},
		made,
	};
}
