/**
 * Types for Salmons' rules modules (`salmonsRules.js`, P11.3). The behaviour is pinned by
 * `scripts/check-online-rules.mjs` on recorded traces.
 */

import type { RulesGame, RulesModule } from './onlineRules';

export const CLIMB: Readonly<{ radiusSq: number; step: number; slidePerSecond: number }>;
/** A waterfall zone's height, cells (the original's lowest when it carries none). */
export function fallHeight(zone: { height?: number }): number;
/** A game's waterfalls as the climb measures them. */
export type ClimbFall = {
	id: string;
	x: number;
	y: number;
	w: number;
	h: number;
	characters?: string[];
	/** The line it stands on, its height in cells (`top`) and px, and its column's water cells. */
	line: number;
	top: number;
	height: number;
	cells?: { left: number; count: number };
};
export function waterfallsOf(game: RulesGame): ClimbFall[];
/** How far a body is from a waterfall's nearest obstacle cell, cells² (the climb reaches < 4). */
export function fallReachSq(fall: ClimbFall, body: { x: number; y: number }): number;
export const JUMP: Readonly<{ launch: number; gravity: number }>;
/** Heights (cells) above which a leaping salmon is not grounded, hooked, or stopped by a move of 0. */
export const CLEAR: Readonly<{ sand: number; hook: number; steer: number }>;
/** How near a sand cell's centre a salmon is on it, cells. */
export const SAND_REACH: number;
/** How far a bridge's slopes run onto the banks, cells. */
export const BRIDGE_SLOPE: number;
/** Heights (cells) at which a salmon passes over a rock and is not pulled by a whirlpool. */
export const OVER: Readonly<{ rock: number; whirlpool: number }>;
/** The leap's direction: the tap's dead zone (cells), the scale along and across the river, the
 *  direction before any move, and the shortest move that is a direction (of a full one). */
export const LEAP_AIM: Readonly<{
	deadZone: number;
	along: number;
	across: number;
	fallback: Readonly<{ x: number; y: number }>;
	minMove: number;
}>;
/** The leap's move (input units) for a tap of `input` at `body`, the last move `last` (or none). */
export function leapMove(
	body: { x: number; y: number },
	input: { aimX?: number; aimY?: number },
	last: { x: number; y: number } | null | undefined,
): { moveX: number; moveY: number };
/** How many of a salmon's next inputs, one a step, find it above `CLEAR.steer`, from `z` / `vz`
 *  (px, px/s) after a step. */
export function stepsAloft(z: number, vz: number, tickHz: number): number;
export const salmonJump: RulesModule;
export const LINE: Readonly<{
	reelCellsPerSecond: number;
	landCells: number;
	minCastCells: number;
}>;
/** A fisherman's sight, as far as his line reaches: a standard screen (window px) with him at its
 *  centre, and a cell as that screen draws it (window px). */
export const SIGHT: Readonly<{
	screen: Readonly<{ w: number; h: number }>;
	tile: Readonly<{ w: number; h: number }>;
}>;
/** Whether a world point is in the sight of a fisherman at `from` (its edge included). */
export function inSight(from: { x: number; y: number }, at: { x: number; y: number }): boolean;
/** An aim pulled in along the line from the fisherman at `from` until it is in his sight: `aim`
 *  itself when it already is. */
export function pullIntoSight(
	from: { x: number; y: number },
	aim: { x: number; y: number },
): { x: number; y: number };
/** How a bot fisherman aims: how long a salmon must have been in his sight before he casts at it
 *  (ms, drawn between the two), the longest cast that lands on it (cells), and how far short of it
 *  a longer one may fall, as a share of what it is longer. */
export const BOT_AIM: Readonly<{
	reactMs: Readonly<{ min: number; max: number }>;
	sureCells: number;
	spread: number;
}>;
/** The most bloodstains a room keeps; the oldest goes past it. */
export const STAINS: Readonly<{ max: number }>;
export const SALMONS_RULES: Readonly<{
	waterfallClimb: RulesModule;
	sandbanks: RulesModule;
	fishingLine: RulesModule;
	goldenSalmon: RulesModule;
	salmons: RulesModule;
}>;
