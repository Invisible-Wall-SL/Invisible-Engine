/** Types for `salmonsMap.js`, Salmons' original level generator. Pinned by `scripts/check-salmons-levels.mjs`. */

import type { SalmonsRect, SalmonsRiver } from './salmons';

export const SALMONS_MAP: Readonly<Record<string, number>>;
export const CELL: 48;
export const SALMONS_MAP_SEED: 1;
export const OVERLAY_KINDS: readonly ['rock', 'whirlpool', 'sandbank', 'waterfall'];

export type SalmonsObstacleKind = (typeof OVERLAY_KINDS)[number];
export type SalmonsObstacle = {
	x: number;
	y: number;
	z: 0;
	type: SalmonsObstacleKind;
	height?: number;
};
export type SalmonsBridge = { gx: number; gyStart: number; gyEnd: number; height: number };
export type SalmonsMap = { obstacles: SalmonsObstacle[]; bridges: SalmonsBridge[] };

/** A grid cell of the original's map: `[gx, gy]`, gx down the river from the source, gy across it. */
export type SalmonsCell = [number, number];
/** Authored pieces on top of a generated level, by grid cell; stored apart from the base. */
export type SalmonsOverlay = {
	add?: { cell: SalmonsCell; kind: SalmonsObstacleKind; height?: number }[];
	remove?: SalmonsCell[];
	set?: { cell: SalmonsCell; height: number }[];
};
/** An overlay entry the level it was applied to has no place for: kept, not applied. */
export type SalmonsOrphan = { op: 'add' | 'remove' | 'set'; cell: SalmonsCell; kind?: string };
/** A config's `arcade.online.levels`: pinned seeds, and overlays by seed (`'*'`: every level). */
export type SalmonsLevels = {
	seeds?: number[];
	overlays?: Record<string, SalmonsOverlay>;
	river?: { winding?: number; sharpestTurn?: number; sourceBias?: number };
	waterfalls?: { count?: number; heightMin?: number; heightMax?: number };
};
/** `levels` as the generator reads it: every river field set, heights whole and ordered. */
export type SalmonsShape = {
	river?: { winding: number; sharpestTurn: number; sourceBias: number };
	waterfalls?: { count?: number; heightMin?: number; heightMax?: number };
};
export const RIVER_SHAPE: Readonly<{ winding: number; sharpestTurn: number; sourceBias: number }>;
export const RIVER_SHAPE_LIMITS: Readonly<
	Record<
		'winding' | 'sharpestTurn' | 'sourceBias' | 'waterfallCount' | 'waterfallHeight',
		readonly [number, number]
	>
>;
export function levelShape(levels: SalmonsLevels | undefined): SalmonsShape | undefined;
/** Where a river's water is, column by column (`salmonsMap.js` `riverCourse`). */
export type SalmonsCourse = {
	winding: boolean;
	/** A winding course's turns, from the source down: where, and by how many degrees. */
	bends?: { gx: number; deg: number }[];
	lo(gx: number): number;
	hi(gx: number): number;
	axis(u: number): number;
	edge(u: number, side: number): number;
	past(u: number, side: number, by: number, more: number): number;
};
export function riverCourse(seed: string | number, shape?: SalmonsShape): SalmonsCourse;
export function inCourse(course: SalmonsCourse, gx: number, gy: number): boolean;
export type SalmonsCourseFacts = {
	sharpest: number;
	turns: { gx: number; deg: number }[];
	across: { from: number; to: number; side: 1 | -1; cells: number }[];
	screen: Record<'mirrored' | 'plain', { leftToRight: number; rightToLeft: number }>;
	length: number;
	narrowest: number;
	passage: number;
};
export function courseFacts(river: Pick<SalmonsRiver, 'bands'>): SalmonsCourseFacts;

export type SalmonsMapRiver = SalmonsRiver & {
	generator: 'salmonsMap';
	bridges: (SalmonsRect & { height: number })[];
	waterfalls: (SalmonsRect & { height: number })[];
	/** The original's salmon spawn line (column 390, ±0.4 of its half width), a cell apart. */
	salmonSpawns: { x: number; y: number }[];
	/** World px of grid cell (gx, gy): x = (gy − gyMin) · cell, y = (gx + sourceRows) · cell. */
	grid: { cell: number; gyMin: number; sourceRows: number };
	orphans: SalmonsOrphan[];
};

export function buildMeanderTable(seed: string | number): Float32Array;
export function riverHalfWidth(u: number): number;
export function meanderAt(table: Float32Array, u: number): number;
export function generateSalmonsMap(seed: string | number, shape?: SalmonsShape): SalmonsMap;
export function inRiver(meander: Float32Array, gx: number, gy: number): boolean;
export function applySalmonsOverlay(
	map: SalmonsMap,
	overlay: SalmonsOverlay | undefined,
	seed: string | number,
	shape?: SalmonsShape,
): { map: SalmonsMap; orphans: SalmonsOrphan[] };
export function levelOverlay(
	levels: SalmonsLevels | undefined,
	seed: string | number,
): SalmonsOverlay | undefined;
export function salmonsMapRiver(
	seed?: string | number,
	overlay?: SalmonsOverlay,
	shape?: SalmonsShape,
): SalmonsMapRiver;
