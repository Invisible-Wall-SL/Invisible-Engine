/**
 * Types for Salmons' rules modules (`salmonsRules.js`, P11.3). The behaviour is pinned by
 * `scripts/check-online-rules.mjs` on recorded traces.
 */

import type { RulesModule } from './onlineRules';

export const CLIMB: Readonly<{ tap: number; drainPerSecond: number; footPx: number }>;
export const LINE: Readonly<{ reelPxPerSecond: number; landPx: number; escapeTaps: number }>;
export const GOLDEN_WORTH: number;
export const SALMONS_RULES: Readonly<{
	waterfallClimb: RulesModule;
	sandbanks: RulesModule;
	fishingLine: RulesModule;
	goldenSalmon: RulesModule;
	salmons: RulesModule;
}>;
