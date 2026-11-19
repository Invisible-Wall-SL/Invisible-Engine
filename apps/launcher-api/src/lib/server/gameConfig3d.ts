import { world3dOf } from 'engine-mechanics/src/online3d.js';
import type { GameConfigDoc, GameConfigIssue } from 'game-config';
import { normalizeGameConfigModels, type GameConfigModels } from './modelConfig';

/**
 * A 3D game's two Game Config blocks that `game-config` does not know: `arcade.world3d` (the level,
 * motion and spawns `engine-mechanics` `world3dOf` reads, on the device and in the game server's
 * `arcade3d` room) and `models` (the per-class model tier overrides `modelExport.ts` reads).
 *
 * `game-config` ships in every runtime, so it never learns them (`docs/knowledge/families/3d.md`):
 * its normalizer drops both, and the launcher carries them past it — read off the raw doc, put
 * back on the normalized one — through every save and load, and so into the runtime bundle's
 * `config`. A doc with neither comes back as the same object, so a 2D config is unchanged.
 *
 * `world3d` is kept as authored (each reader runs `world3dOf` itself) and a save refuses one
 * `world3dOf` refuses; `models` is kept as `normalizeGameConfigModels` reads it.
 */
export interface GameConfig3dBlocks {
	world3d?: unknown;
	models?: GameConfigModels;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);

/** The 3D blocks of a raw (un-normalized) Game Config doc. */
export function gameConfig3dBlocksOf(raw: unknown): GameConfig3dBlocks {
	if (!isObject(raw)) return {};
	const world3d = isObject(raw.arcade) ? raw.arcade.world3d : undefined;
	const models = normalizeGameConfigModels(raw.models);
	return {
		...(world3d === undefined ? {} : { world3d: structuredClone(world3d) }),
		...(models ? { models } : {}),
	};
}

/** Why the blocks cannot be saved: a `world3d` the 3D room and the device would refuse. */
export function gameConfig3dErrors(blocks: GameConfig3dBlocks): GameConfigIssue[] {
	if (blocks.world3d === undefined) return [];
	try {
		world3dOf(blocks.world3d);
		return [];
	} catch (error) {
		return [
			{
				severity: 'error',
				path: 'arcade.world3d',
				message: `The 3D world cannot be played: ${(error as Error).message}`,
			},
		];
	}
}

/** `doc` with the blocks put back; `doc` itself when there are none. */
export function withGameConfig3dBlocks(
	doc: GameConfigDoc,
	blocks: GameConfig3dBlocks,
): GameConfigDoc {
	if (blocks.world3d === undefined && !blocks.models) return doc;
	const out: GameConfigDoc & { models?: GameConfigModels } = { ...doc };
	if (blocks.world3d !== undefined)
		out.arcade = { ...doc.arcade, world3d: blocks.world3d } as GameConfigDoc['arcade'];
	if (blocks.models) out.models = blocks.models;
	return out;
}
