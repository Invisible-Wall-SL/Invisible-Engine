/**
 * Types for a field made per room (`onlineGenerators.js`, P11.2 (e)). Pinned by
 * `scripts/check-room-bots.mjs`, `scripts/check-room-sim.mjs` and `scripts/check-room-levels.mjs`.
 */

import type { SalmonsGeometry, SalmonsProps, SalmonsRiver } from './salmons';
import type { SalmonsLevels, SalmonsSeedLevels } from './salmonsMap';

/** The part of a game (`game-config` `OnlineGame`) a generator reads and replaces. */
export type GeneratedGame = {
	field: { w: number; h: number };
	zones: readonly { id: string; x: number; y: number; w: number; h: number }[];
	online: {
		generator?: string;
		levels?: SalmonsLevels;
		/** The prop colliders its generator lays into the level, by zone family. */
		props?: SalmonsProps;
		spawn: { x: number; y: number };
		characters: readonly { id: string; spawns?: { x: number; y: number }[] }[];
		rules: { zones: readonly unknown[] };
		bots: { spawns: readonly { x: number; y: number }[] };
	};
};

export const ONLINE_GENERATORS: Readonly<
	Record<
		string,
		{
			make(seed: number | string, levels?: SalmonsLevels): SalmonsRiver;
			geometry(made: SalmonsRiver, props?: SalmonsProps): SalmonsGeometry;
			/** The config's levels as the level of `seed` reads them; a generator that reads none
			 *  has no such reader. */
			levels?(levels: SalmonsLevels | undefined, seed: number | string): SalmonsSeedLevels;
		}
	>
>;

export function generatedOnlineGame<G extends GeneratedGame>(
	game: G,
	seed: number,
): { game: G; made: SalmonsRiver | undefined };

export function roomLevelSeed(
	levels: SalmonsLevels | undefined,
	roomCount: number,
	random: () => number,
): number;

export const ROOM_LEVELS_MAX: number;

export function roomLevels(game: GeneratedGame, seed: number): SalmonsSeedLevels | undefined;

export function levelHash(game: GeneratedGame, made: SalmonsRiver | undefined): string;

/** The two fields a room's state carries beside its seed (`services/game-server` `schema.ts`). */
export type RoomLevelState = { levels: string; levelHash: string };

export function roomLevelState(
	game: GeneratedGame,
	seed: number,
	made: SalmonsRiver | undefined,
): RoomLevelState | undefined;

/** What a device read of them in a room's state: either is missing from an older game server. */
export type RoomLevelSaid = { levels?: unknown; levelHash?: unknown };

/** What a device did about its room's level (`roomLevelGame`). */
export type RoomLevelReport = {
	/** It plays the room's levels in place of its own config's. */
	adopted: boolean;
	/** The parts of its own config's levels that are not the room's, in name order. */
	differs: string[];
	/** Its fingerprint of the level it made when the room said one ('' otherwise), and the room's. */
	levelHash: string;
	roomLevelHash: string;
};

/** The device cannot make the room's level: from the room's own levels (`generator`), or from its
 *  own config's because it had none of the room's to read (`levels`). */
export type RoomLevelRefusal = RoomLevelReport & { refused: 'generator' | 'levels' };

export function roomLevelGame<G extends GeneratedGame>(
	game: G,
	seed: number,
	said: RoomLevelSaid | undefined,
): ({ game: G; made: SalmonsRiver | undefined } & RoomLevelReport) | RoomLevelRefusal;
