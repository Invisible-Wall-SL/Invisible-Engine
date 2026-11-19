/**
 * Types for bot navigation on a 3D level (`nav3d.js`, `docs/design/3d/gameplay-evaluation.md` §3).
 * Pinned by `scripts/check-bots-3d.mjs`.
 */

import type { Body3d, Level3d, Motion3dSpec } from './motion3d';

export type NavEdgeKind = 'walk' | 'drop' | 'jump' | 'bounce';
export declare const NAV_EDGES: readonly NavEdgeKind[];

export type Nav3dOptions = {
	cell?: number;
	maxDrop?: number;
	probe?: number;
	jumpReach?: number;
	jumpReachRatio?: number;
	bounceReachRatio?: number;
	trampolineCost?: number;
	jumpCost?: number;
	dropCost?: number;
};
export declare const NAV3D_DEFAULTS: Readonly<Required<Omit<Nav3dOptions, 'jumpReach'>>>;

export type NavNode3d = {
	id: number;
	ix: number;
	iz: number;
	x: number;
	y: number;
	z: number;
	ramp: boolean;
	/** The trampoline zone's id, or −1. */
	trampoline: number;
};
/** `cost` in whole mm. */
export type NavEdge3d = { to: number; kind: NavEdgeKind; cost: number };

export type NavGrid3d = {
	cell: number;
	nodes: NavNode3d[];
	columns: Map<string, number[]>;
	edges: NavEdge3d[][];
	spec: Readonly<Motion3dSpec>;
	jumpReach: number;
};

export declare function createNavGrid3d(
	level: Level3d,
	spec: Readonly<Motion3dSpec>,
	opts?: Nav3dOptions,
): NavGrid3d;
export declare function nearestNode3d(
	nav: NavGrid3d,
	x: number,
	y: number,
	z: number,
	options?: { above?: number; reach?: number },
): number;

export type NavPath3d = {
	steps: { node: number; kind: NavEdgeKind }[];
	reached: boolean;
	cost: number;
};
export declare function findPath3d(
	nav: NavGrid3d,
	from: number,
	to: number,
	rng: () => number,
	options?: { partial?: boolean; maxNodes?: number },
): NavPath3d | null;

export type PathFollower3d = {
	steps: NavPath3d['steps'];
	i: number;
	goal: { x: number; z: number } | null;
	best: number;
	idle: number;
	lost: boolean;
};
export declare function createPathFollower3d(): PathFollower3d;
export declare function setPath3d(
	follower: PathFollower3d,
	path: NavPath3d | null,
	goal?: { x: number; z: number } | null,
): void;
export declare function pathDone3d(follower: PathFollower3d): boolean;
export declare function followPath3d(
	follower: PathFollower3d,
	body: Body3d,
	nav: NavGrid3d,
	dt: number,
): { vx: number; vz: number; jump: boolean };

export declare function segmentHit3d(
	level: Level3d,
	ax: number,
	ay: number,
	az: number,
	bx: number,
	by: number,
	bz: number,
): number;
export declare function lineOfSight3d(
	level: Level3d,
	ax: number,
	ay: number,
	az: number,
	bx: number,
	by: number,
	bz: number,
): boolean;
