/**
 * Spawn churn: bodies an arcade game spawns and despawns while it plays (`arcadePerf.ts` `spawns`
 * + `despawns` a frame) — each one a body and its display object built or destroyed mid-play,
 * which pooling avoids. Per game and device over the as-shipped arcade readings of the current
 * build (`arcadePlayGroups`). Shown from 0.5 a frame on average, or 12 in one frame (the larger of
 * the two counts' own peaks — measured, so never above the frame's real total); medium once the
 * same readings recorded `spawn burst` spikes. No estimate: what pooling saves is not measured.
 */

import { SPIKE_MIN } from './spikes';
import {
	arcadePlayGroups,
	deviceOf,
	factsOf,
	kindOwner,
	median,
	readingRef,
	round1,
	workMax,
	type Finding,
	type Rule,
} from '../finding';

export const SPAWN_CHURN = { mean: 0.5, peak: 12 } as const;

export const spawnChurn: Rule = (ctx) => {
	const out: Finding[] = [];
	for (const [key, group] of arcadePlayGroups(ctx)) {
		const churn = median(
			group
				.filter((x) => x.play.work.spawns || x.play.work.despawns)
				.map((x) => (x.play.work.spawns?.mean ?? 0) + (x.play.work.despawns?.mean ?? 0)),
		);
		const peak = Math.max(workMax(group, 'spawns') ?? 0, workMax(group, 'despawns') ?? 0);
		if (churn === null || (churn < SPAWN_CHURN.mean && peak < SPAWN_CHURN.peak)) continue;
		const fps = median(group.map((x) => x.r.play?.fps ?? 0)) ?? 0;
		const bursts = group.reduce(
			(n, x) => n + (factsOf(ctx, x.r)?.spikeCauses?.play?.['spawn burst'] ?? 0),
			0,
		);
		const detail = [
			`${round1(churn)} bodies spawned or despawned a play frame on average` +
				(fps > 0 ? ` (${round1(churn * fps)} a second)` : '') +
				`, up to ${peak} in one frame.`,
			'Pool bodies: reuse a despawned body and its display object instead of building a new one.',
		];
		if (bursts) detail.push(`${bursts} play spikes were spawn bursts.`);
		out.push({
			id: `spawnChurn:${key}:${group[0].r.buildVersion ?? ''}`,
			subject: `spawnChurn:${key}`,
			rule: 'spawnChurn',
			severity: bursts >= SPIKE_MIN.count ? 'medium' : 'low',
			title: `${round1(churn)} spawns a play frame (up to ${peak}) on ${deviceOf(group[0].r)}`,
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
