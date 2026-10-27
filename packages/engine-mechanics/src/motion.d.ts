/**
 * Types for arcade motion (`motion.js`, `docs/design/game-families.md` §4.2). The module is plain
 * JS — see the package's `index.ts` for why — so its contract is declared here. The behaviour is
 * pinned by `scripts/check-arcade-motion.mjs`.
 */

/** How a body meets the field's edges: held inside, carried round, or let out. */
export type BodyEdges = 'clamp' | 'wrap' | 'pass';

/** A body's collision shape; `point` has no size and touches only what covers it. */
export type BodyShape =
	{ shape: 'box'; w: number; h: number } | { shape: 'circle'; r: number } | { shape: 'point' };

/** A moving body. `x` / `y` is its centre, in field px; `vx` / `vy` in px/s. Mutated in place. */
export type Body = BodyShape & {
	id: string;
	x: number;
	y: number;
	vx: number;
	vy: number;
	tags: string[];
	/** Absent ⇒ `clamp`. */
	edges?: BodyEdges;
	/** Blocks a body stepped by {@link stepSolid}. */
	solid?: boolean;
};

/** The play field: `w` × `h` px from (0, 0). */
export type Field = { w: number; h: number };

export type Aabb = { x0: number; y0: number; x1: number; y1: number };

export type Edge = 'left' | 'right' | 'top' | 'bottom';

/** A static rectangle of a level (a zone), top-left. */
export type StaticShape = { id: string; x: number; y: number; w: number; h: number };

export type StaticIndex<S extends StaticShape = StaticShape> = {
	readonly shapes: readonly S[];
	readonly cellSize: number;
	readonly cells: ReadonlyMap<string, readonly number[]>;
};

export type Overlap<B extends Body = Body> = { a: B; b: B; tagA: string; tagB: string };

export type OverlapOptions = {
	/** Use the grid above this many bodies. Default {@link BROAD_PHASE_ABOVE}. */
	broadPhaseAbove?: number;
	/** The grid's cell, px. Default twice the largest body. */
	cellSize?: number;
};

export type FixedStep = {
	readonly stepMs: number;
	/** One step, in seconds. */
	readonly dt: number;
	/** Steps run since the start. */
	readonly steps: number;
	readonly alpha: number;
	/** Add a frame's time; run `onStep` once per whole step held. Returns the steps run. */
	advance(frameMs: number, onStep: (step: number) => void): number;
};

export const DEFAULT_FIXED_HZ: 60;
export const BROAD_PHASE_ABOVE: 64;
export const MAX_STEPS_PER_FRAME: 5;

export function createFixedStep(options?: { hz?: number; maxSteps?: number }): FixedStep;
export function aabbOf(body: Body): Aabb;
export function stepBody<B extends Body>(body: B, dt: number, field?: Field): B;
export function step<B extends Body>(bodies: B[], dt: number, field?: Field): B[];
export function outsideEdge(body: Body, field: Field): Edge | undefined;
export function touching(a: Body, b: Body): boolean;
export function overlaps<B extends Body>(
	bodies: readonly B[],
	pairs: readonly (readonly [string, string])[],
	options?: OverlapOptions,
): Overlap<B>[];
export function inZone(body: Body, zone: StaticShape): boolean;
export function createStaticIndex<S extends StaticShape>(
	shapes: readonly S[],
	cellSize?: number,
): StaticIndex<S>;
export function queryStatic<S extends StaticShape>(index: StaticIndex<S>, box: Aabb): S[];
export function scanStatic<S extends StaticShape>(shapes: readonly S[], box: Aabb): S[];
export function zonesOf(body: Body, index: StaticIndex): string[];

/** How a body speeds up, slows and turns (a character's `movement`). Every field is optional. */
export type Movement = {
	/** px/s² towards the desired velocity; absent ⇒ at once. */
	accel?: number;
	/** px/s² when slowing, reversing or turning; absent ⇒ `accel`. */
	decel?: number;
	/** Cap on |v|, px/s; absent ⇒ none. */
	maxSpeed?: number;
	/** Degrees/s the heading may turn; absent ⇒ at once. */
	turnRate?: number;
	/** px/s², down (P10.13); absent ⇒ none, or the jump's own pull. */
	gravity?: number;
	/** px/s cap on a fall; absent ⇒ none. */
	maxFall?: number;
};

export type Velocity = { vx: number; vy: number };

export type Point = { x: number; y: number };

/** A path as authored: points in field px, open unless `closed`, `smoothing` 0..1. */
export type PathSpec = { points: readonly Point[]; closed?: boolean; smoothing?: number };

/** A path ready to walk; `cum[i]` is the arc distance at `points[i]`. */
export type SampledPath = {
	readonly points: Point[];
	readonly closed: boolean;
	readonly length: number;
	readonly cum: number[];
};

/** Whether {@link stepSolid} stopped the body at a solid on each axis this step. */
export type SolidHit = { hitX: boolean; hitY: boolean };

export const PATH_SUBDIVISIONS: 12;

export function steer<B extends Body>(
	body: B,
	desired: Velocity,
	movement: Movement | undefined,
	dt: number,
): B;
export function stepSolid(body: Body, dt: number, solids: readonly Body[], field?: Field): SolidHit;
export function samplePath(spec: PathSpec): SampledPath;
export function pointAt(path: SampledPath, distance: number): Point;
export function nearestDistance(path: SampledPath, x: number, y: number): number;

/** A body a {@link stepPlatform} body lands on only from above, while falling (P10.13). */
export type OneWay = { oneWay?: boolean };

/** A level's tiles: top-left in field px, a tile's size, one solidity code per tile, row by row. */
export type TileGrid = {
	x: number;
	y: number;
	tileW: number;
	tileH: number;
	cols: number;
	rows: number;
	/** {@link TILE_NONE}, {@link TILE_SOLID} or {@link TILE_ONE_WAY} per tile. */
	cells: ArrayLike<number>;
};

export type PlatformOptions = {
	/** Bodies that block: `solid` on every side, `oneWay` from above. */
	solids?: readonly (Body & OneWay)[];
	tiles?: readonly TileGrid[];
	field?: Field;
	/** px/s², down; absent or ≤ 0 ⇒ none. */
	gravity?: number;
	/** px/s cap on the fall; absent ⇒ none. */
	maxFall?: number;
};

export type PlatformHit = SolidHit & {
	/** A fall was stopped from below this step. */
	grounded: boolean;
	/** The horizontal move was stopped. */
	onWall: boolean;
};

export const TILE_NONE: 0;
export const TILE_SOLID: 1;
export const TILE_ONE_WAY: 2;
export const TILE_SOLIDITY: ['none', 'solid', 'oneWay'];
export const MAX_SUB_STEPS: 64;

export function tilesIn(grid: TileGrid, box: Aabb): (Body & OneWay)[];
export function stepPlatform(body: Body, dt: number, options?: PlatformOptions): PlatformHit;
