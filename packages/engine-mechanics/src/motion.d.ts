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
