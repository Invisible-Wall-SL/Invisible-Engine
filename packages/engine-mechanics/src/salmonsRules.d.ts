/**
 * Types for Salmons' rules modules (`salmonsRules.js`, P11.3). The behaviour is pinned by
 * `scripts/check-online-rules.mjs` on recorded traces.
 */

import type { RulesModule } from './onlineRules';

export const CLIMB: Readonly<{ radiusSq: number; step: number; slidePerSecond: number }>;
/** A waterfall zone's height, cells (the original's lowest when it carries none). */
export function fallHeight(zone: { height?: number }): number;
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
