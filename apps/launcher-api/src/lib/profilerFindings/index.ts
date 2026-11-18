/**
 * The Findings tab's list (P4, `docs/design/invisible-profiler.md` §4): every rule over one
 * project's readings and builds, ranked by severity then estimated saving. Pure — the page's
 * server load and `scripts/check-profiler.ts` run the same functions.
 */

import {
	rankFindings,
	type Finding,
	type FindingContext,
	type FindingRule,
	type Rule,
} from './finding';
import { featureCost } from './rules/featureCost';
import { fpsBelowBudget } from './rules/fpsBelowBudget';
import { gpuCpuBound } from './rules/gpuCpuBound';
import { optimizeOff } from './rules/optimizeOff';
import { regression } from './rules/regression';
import { spikes } from './rules/spikes';
import { textures } from './rules/textures';
import { unusedBytes } from './rules/unusedBytes';

export const RULES: Record<FindingRule, Rule> = {
	fpsBelowBudget,
	gpuCpuBound,
	featureCost,
	spikes,
	textures,
	unusedBytes,
	optimizeOff,
	regression,
};

export function findings(ctx: FindingContext): Finding[] {
	return rankFindings(Object.values(RULES).flatMap((rule) => rule(ctx)));
}

export * from './finding';
export { compareReadings, type CompareRow } from './compare';
