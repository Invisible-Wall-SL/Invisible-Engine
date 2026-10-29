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
 * shows. Plain ESM, like the rest of the package.
 */

import { salmonsGeometry, salmonsRiver } from './salmons.js';

/** The generators a config can name, by id (`game-config` `ONLINE_GENERATOR_IDS` lists the same). */
export const ONLINE_GENERATORS = {
	salmonsRiver: { make: salmonsRiver, geometry: salmonsGeometry },
};

/**
 * `game` as a room seeded `seed` plays it, and what its generator made from the seed (for the
 * device to draw); a game that names no generator comes back as it is, with nothing made.
 */
export function generatedOnlineGame(game, seed) {
	const id = game.online.generator;
	const generator = id ? ONLINE_GENERATORS[id] : undefined;
	if (!generator) return { game, made: undefined };
	const made = generator.make(seed);
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
