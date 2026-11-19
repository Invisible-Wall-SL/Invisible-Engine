/**
 * Types for the nav graph of a grid level (`levelNav3d.js`). Pinned by `scripts/check-arena-3d.mjs`.
 */

import type { Collider3dSpec, Motion3dSpec, Zone3dSpec } from './motion3d';
import type { Marker3d } from './online3d';

export declare const NAV_WALK: number;
export declare const NAV_DROP: number;
export declare const NAV_TRAMPOLINE: number;

export type LevelSpec3d = {
	colliders?: readonly Collider3dSpec[];
	zones?: readonly Zone3dSpec[];
	cellSize?: number;
	killY?: number;
};

/** A surface to stand on at a column's centre; `pad` is its trampoline zone's id, or −1. */
export type NavNode3d = {
	readonly id: number;
	readonly i: number;
	readonly j: number;
	readonly x: number;
	readonly y: number;
	readonly z: number;
	readonly collider: number;
	readonly pad: number;
};

export type NavEdge3d = {
	readonly from: number;
	readonly to: number;
	readonly kind: 'walk' | 'drop' | 'trampoline';
	readonly cost: number;
};

export type NavGraph3d = {
	readonly cellSize: number;
	readonly nodes: readonly NavNode3d[];
	readonly edges: readonly NavEdge3d[];
	/** Edge ids leaving / reaching each node. */
	readonly out: readonly (readonly number[])[];
	readonly into: readonly (readonly number[])[];
};

export declare function navGrid3d(
	level: LevelSpec3d,
	options?: { cellSize?: number; motion?: Motion3dSpec },
): NavGraph3d;

export declare function nodeAt3d(
	graph: NavGraph3d,
	x: number,
	y: number,
	z: number,
	tolerance?: number,
): number;

export declare function navCosts3d(
	graph: NavGraph3d,
	targets: readonly number[],
	options?: { backward?: boolean },
): Int32Array;

export declare function navPath3d(
	graph: NavGraph3d,
	from: number,
	targets: readonly number[],
): number[] | null;

export declare function nodesAround3d(
	graph: NavGraph3d,
	zone: Zone3dSpec,
	motion?: Motion3dSpec,
): number[];

export declare function validateLevel3d(
	world: {
		level: LevelSpec3d;
		spawns: readonly { x: number; y: number; z: number; team?: number }[];
		markers?: readonly Marker3d[];
	},
	options?: { motion?: Motion3dSpec; balance?: number },
): { ok: boolean; problems: string[]; graph: NavGraph3d; costs: number[] };
