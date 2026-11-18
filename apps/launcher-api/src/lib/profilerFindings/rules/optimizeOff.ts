/**
 * Optimize off: a game's newest build was made without 🗜 Optimize. The estimate is only what the
 * breakdown measures Optimize would drop — a PNG beside its WebP twin, audio beside its mp3 (the
 * build's facts) — never the PNG → WebP re-encode, which no build measured. When the same game has
 * an Optimize build, its shipped size is given beside, as evidence.
 */

import { evaluateBuildSize } from '../../profilerBudgets';
import { mbOf } from '../facts';
import {
	buildFactsOf,
	buildRef,
	newestBuilds,
	PUBLISHER,
	type Finding,
	type Rule,
} from '../finding';

export const optimizeOff: Rule = (ctx) => {
	const out: Finding[] = [];
	for (const b of newestBuilds(ctx.builds)) {
		if (b.optimize) continue;
		const facts = buildFactsOf(ctx, b);
		const twins = facts?.optimizeTwinBytes ?? 0;
		const optimized = ctx.builds
			.filter((x) => x.gameKey === b.gameKey && x.optimize)
			.sort((x, y) => y.registeredAt.localeCompare(x.registeredAt))[0];
		const verdict = evaluateBuildSize(b, ctx.budgets).find(
			(m) => m.metric === 'shippedMb',
		)?.verdict;
		const detail = [
			...(facts ? [] : ['The build’s file list was not read: nothing measured.']),
			...(facts?.optimizeTwins ?? [])
				.slice(0, 5)
				.map((t) => `${t.rel} beside ${t.twin} (${mbOf(t.bytes)} MB)`),
			...(optimized
				? [
						`v${optimized.build} with Optimize shipped ${mbOf(optimized.shippedBytes)} MB; this one ${mbOf(b.shippedBytes)} MB.`,
					]
				: []),
		];
		out.push({
			id: `optimizeOff:${b.id}`,
			rule: 'optimizeOff',
			severity: verdict === 'fail' || verdict === 'warn' ? 'medium' : 'low',
			title: `v${b.build} (${b.gameKey}) was built without 🗜 Optimize`,
			detail,
			evidence: [buildRef(b), ...(optimized ? [buildRef(optimized)] : [])],
			estimate:
				twins > 0
					? {
							value: mbOf(twins),
							unit: 'MB',
							basis: 'twin images and extra audio formats Optimize drops',
						}
					: null,
			owner: PUBLISHER,
			deviceClass: null,
			gameKey: b.gameKey,
		});
	}
	return out;
};
