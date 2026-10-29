/**
 * Types for a field made per room (`onlineGenerators.js`, P11.2 (e)). Pinned by
 * `scripts/check-room-bots.mjs` and `scripts/check-room-sim.mjs`.
 */

import type { SalmonsGeometry, SalmonsRiver } from './salmons';

/** The part of a game (`game-config` `OnlineGame`) a generator reads and replaces. */
export type GeneratedGame = {
	field: { w: number; h: number };
	zones: readonly { id: string; x: number; y: number; w: number; h: number }[];
	online: {
		generator?: string;
		spawn: { x: number; y: number };
		characters: readonly { id: string; spawns?: { x: number; y: number }[] }[];
		rules: { zones: readonly unknown[] };
		bots: { spawns: readonly { x: number; y: number }[] };
	};
};

export const ONLINE_GENERATORS: Readonly<
	Record<
		string,
		{ make(seed: number | string): SalmonsRiver; geometry(made: SalmonsRiver): SalmonsGeometry }
	>
>;

export function generatedOnlineGame<G extends GeneratedGame>(
	game: G,
	seed: number,
): { game: G; made: SalmonsRiver | undefined };
