/**
 * Sim catch-up: how often an arcade game's play frames ran more than one fixed sim step — the loop
 * catching up after a long frame (`arcadePerf.ts` `simCatchUp` is 1 on such a frame, so its mean
 * is the share of frames) — with the steps a frame, the time in them, and the frame time the sim
 * dropped (motion slowed). Per game and device over the as-shipped arcade readings of the current
 * build (`arcadePlayGroups`). Shown from 10% of play frames; medium from 25%, or once the sim drops
 * time. No estimate: what a fix buys depends on what made the frames long.
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

export const SIM_CATCH_UP = { low: 0.1, medium: 0.25 } as const;

export const simCatchUp: Rule = (ctx) => {
	const out: Finding[] = [];
	for (const [key, group] of arcadePlayGroups(ctx)) {
		const share = workMean(group, 'simCatchUp');
		if (share === null || share < SIM_CATCH_UP.low) continue;
		const steps = workMean(group, 'simSteps');
		const simMs = workMean(group, 'simMs');
		const dropped = workMean(group, 'simDroppedMs') ?? 0;
		const droppedMax = workMax(group, 'simDroppedMs') ?? 0;
		const fps = median(group.map((x) => x.r.play?.fps ?? 0));
		const fixedHz = median(
			group.map((x) => x.arcade.fixedHz).filter((v): v is number => v !== null),
		);
		const pct = Math.round(share * 100);
		const detail = [
			`${pct}% of play frames ran more than one sim step` +
				(steps !== null
					? `: ${round1(steps)} a frame on average, up to ${workMax(group, 'simSteps')}.`
					: '.'),
		];
		if (simMs !== null) detail.push(`The steps took ${round1(simMs)} ms a frame.`);
		if (fixedHz !== null && fps !== null && fps > 0 && fps < fixedHz * 0.95) {
			detail.push(
				`A ${fixedHz} Hz fixed step at ${round1(fps)} fps is ${round1(fixedHz / fps)} steps a frame: below ${fixedHz} fps every frame catches up.`,
			);
		}
		if (droppedMax > 0) {
			detail.push(
				`The sim dropped ${round1(dropped)} ms a frame (up to ${round1(droppedMax)} ms): motion slowed where it could not catch up.`,
			);
		}
		out.push({
			id: `simCatchUp:${key}:${group[0].r.buildVersion ?? ''}`,
			rule: 'simCatchUp',
			severity: share >= SIM_CATCH_UP.medium || droppedMax > 0 ? 'medium' : 'low',
			title: `${pct}% of play frames catch up the sim on ${deviceOf(group[0].r)}`,
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
