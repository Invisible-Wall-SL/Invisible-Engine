/** Types for the seeded Crash arena (`crashArena.js`). Pinned by `scripts/check-arena-3d.mjs`. */

import type { Collider3dSpec, Zone3dSpec } from './motion3d';
import type { Marker3d } from './online3d';

export declare const CRASH_CELL: number;
export declare const CRASH_STEP: number;
export declare const CRASH_SLAB: number;
export declare const CRASH_WALL: number;
export declare const CRASH_TRAMPOLINE_HEIGHT: number;
export declare const CRASH_TEAM_SPAWNS: number;
export declare const CRASH_ARENA_KINDS: Readonly<{
	pit: 'pit';
	trampoline: 'trampoline';
	chest: 'chest';
	prop: 'prop';
	pieceSpawner: 'pieceSpawner';
	pickupSpawner: 'pickupSpawner';
}>;

export type CrashArena = {
	generator: 'crashArena';
	seed: number | string;
	/** Which roll of the seed was kept (0 unless the first broke a rule). */
	attempt: number;
	level: { colliders: Collider3dSpec[]; zones: Zone3dSpec[]; cellSize: number; killY: number };
	/** Red (`team` 0) and blue (1) in turn, facing the pit. */
	spawns: { x: number; y: number; z: number; yaw: number; team: 0 | 1 }[];
	markers: Marker3d[];
};

export declare function crashArena(seed: number | string): CrashArena;
