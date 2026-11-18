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
export const salmonJump: RulesModule;
export const LINE: Readonly<{ reelPxPerSecond: number; landPx: number; escapeTaps: number }>;
export const GOLDEN_WORTH: number;
export const SALMONS_RULES: Readonly<{
	waterfallClimb: RulesModule;
	sandbanks: RulesModule;
	fishingLine: RulesModule;
	goldenSalmon: RulesModule;
	salmons: RulesModule;
}>;
