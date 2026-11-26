/**
 * Cost per body: what an arcade game's sim costs for each live body while it plays — `simMs` a
 * frame over its steps and its bodies (`arcadePerf.ts`), then that cost at the most bodies the
 * readings saw, against a 60 Hz frame (whose steps are the fixed rate ÷ 60). Per game and device
 * over the as-shipped arcade readings of the current build (`arcadePlayGroups`), when the field
 * holds at least 4 bodies and the sim takes at least 1 ms a frame; medium when the cost at the most
 * bodies is half the frame or more. Linear in bodies, so the line says "about"; the longest frame's
 * own sim time is beside it. No estimate: nothing measured what a cheaper sim saves.
 */

import {
	arcadePlayGroups,
	deviceOf,
	kindOwner,
	median,
	readingRef,
	round1,
	workMax,
	workMean,
	type Finding,
	type Rule,
} from '../finding';

export const BODY_COST = { bodies: 4, simMs: 1, medium: 0.5 } as const;

const FRAME_60_MS = 1000 / 60;
const round2 = (n: number) => Math.round(n * 100) / 100;

export const bodyCost: Rule = (ctx) => {
	const out: Finding[] = [];
	for (const [key, group] of arcadePlayGroups(ctx)) {
		const bodies = workMean(group, 'bodies');
		const simMs = workMean(group, 'simMs');
		if (bodies === null || simMs === null) continue;
		if (bodies < BODY_COST.bodies || simMs < BODY_COST.simMs) continue;
		const steps = workMean(group, 'simSteps');
		const perStep = steps && steps > 0 ? simMs / steps : simMs;
		const perBody = perStep / bodies;
		const most = workMax(group, 'bodies') ?? bodies;
		const fixedHz = median(
			group.map((x) => x.arcade.fixedHz).filter((v): v is number => v !== null),
		);
		const stepsPer60 = (fixedHz ?? 60) / 60;
		const atMost = perBody * most * stepsPer60;
		const share = atMost / FRAME_60_MS;
		const longest = workMax(group, 'simMs');
		const pairs = workMean(group, 'pairs');
		const detail = [
			`The sim takes ${round1(simMs)} ms a play frame` +
				(steps !== null ? ` over ${round1(steps)} steps` : '') +
				` and ${round1(bodies)} bodies on average: about ${round2(perBody)} ms a body a step.`,
			`At the ${most} bodies seen, a 60 Hz frame's ${round1(stepsPer60)} step${stepsPer60 === 1 ? '' : 's'} would take about ${round1(atMost)} ms — ${Math.round(share * 100)}% of its ${round1(FRAME_60_MS)} ms.`,
		];
		if (longest !== null) detail.push(`The longest frame's sim took ${round1(longest)} ms.`);
		if (pairs !== null) detail.push(`${round1(pairs)} collision pairs tested a frame.`);
		out.push({
			id: `bodyCost:${key}:${group[0].r.buildVersion ?? ''}`,
			rule: 'bodyCost',
			severity: share >= BODY_COST.medium ? 'medium' : 'low',
			title: `Sim ${round2(perBody)} ms a body a step on ${deviceOf(group[0].r)}`,
			detail,
			evidence: group.slice(0, 6).map((x) => readingRef(x.r)),
			estimate: null,
			owner: kindOwner(ctx.owners, 'arcade'),
			deviceClass: group[0].r.deviceClass,
			gameKey: group[0].r.gameKey,
		});
	}
	return out;
};
