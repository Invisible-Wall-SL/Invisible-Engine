/**
 * A 3D LEVEL MADE PER ROOM: the `arcade.world3d` counterpart of `onlineGenerators.js`. A 3D config
 * names a generator in its raw block (`arcade.world3d.generator`, read by `online3d.js`
 * `world3dOf`); the room (`services/game-server` `createRoomSim3d`) and every device
 * (`engine-3d` `playField3d`, `ArcadeStage3D.svelte`) run {@link generatedWorld3d} on the room's
 * seed, so both step the same level.
 *
 * Kept apart from `ONLINE_GENERATORS` on purpose: that registry is in the 2D `arcade` runtime
 * (`apps/lines` `game/online.ts`) and its ids are validated by `game-config`, which every runtime
 * bundles, so a 3D generator there would change the bytes of 2D runtimes. Nothing 2D imports this
 * file. Plain ESM, like the rest of the package.
 */

import { crashArena } from './crashArena.js';

/** The 3D generators a config can name, by id. `make(seed)` returns `{ level, spawns, markers }`. */
export const WORLD3D_GENERATORS = Object.freeze({
	crashArena: { make: (seed) => crashArena(seed) },
});

/**
 * `world` (a `world3dOf` result) as a room seeded `seed` plays it, and what its generator made; a
 * world that names no generator comes back as it is, with nothing made. The generator replaces
 * the level and the spawns, and adds the markers; motion and characters stay the config's. An
 * unknown generator throws, naming it.
 */
export function generatedWorld3d(world, seed) {
	if (!world.generator) return { world, made: undefined };
	const generator = WORLD3D_GENERATORS[world.generator];
	if (!generator) throw new Error(`arcade.world3d.generator: no generator "${world.generator}"`);
	const made = generator.make(seed);
	return {
		world: Object.freeze({
			...world,
			level: made.level,
			spawns: Object.freeze(made.spawns.map((s) => Object.freeze({ ...s }))),
			markers: Object.freeze(made.markers),
		}),
		made,
	};
}
