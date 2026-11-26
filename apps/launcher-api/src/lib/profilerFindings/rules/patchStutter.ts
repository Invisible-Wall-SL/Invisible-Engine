/**
 * Patch / jitter stutter (online arcade games only): how much later the room's states arrive in
 * play than the room's own clock says (`arcade.lateMs.play`: the gap between two states minus the
 * patch periods their steps span). Shown when the 95th percentile is at least max(20 ms, half the patch period)
 * — late enough that what moves hitches while the fps holds; medium from a whole patch period. The
 * room's bytes a second (patch bytes a frame × fps) and, when large, the time its messages take a
 * frame (`netMs`) come beside it. Per game and device over the as-shipped arcade readings of the
 * current build (`arcadePlayGroups`). No estimate: the network's share is not ours to measure.
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

export const PATCH_STUTTER = { lateMs: 20, netMs: 2 } as const;

export const patchStutter: Rule = (ctx) => {
	const out: Finding[] = [];
	for (const [key, all] of arcadePlayGroups(ctx)) {
		const group = all.filter((x) => x.arcade.online && (x.play.lateMs?.count ?? 0) > 0);
		if (!group.length) continue;
		const p95 = median(group.map((x) => x.play.lateMs?.p95 ?? 0)) ?? 0;
		const worst = Math.max(...group.map((x) => x.play.lateMs?.max ?? 0));
		const patchHz = median(
			group.map((x) => x.arcade.patchHz).filter((v): v is number => v !== null && v > 0),
		);
		const period = patchHz ? 1000 / patchHz : null;
		if (p95 < Math.max(PATCH_STUTTER.lateMs, period ? period / 2 : 0)) continue;
		const detail = [
			`Patches arrive up to ${Math.round(p95)} ms late (p95; ${Math.round(worst)} ms at worst) against the room's own clock: motion stutters while fps holds.`,
		];
		if (period !== null) {
			detail.push(
				`The room sends ${round1(patchHz ?? 0)} patches a second, one every ${Math.round(period)} ms.`,
			);
		}
		const bytes = workMean(group, 'patchBytes');
		const fps = median(group.map((x) => x.r.play?.fps ?? 0)) ?? 0;
		if (bytes !== null && fps > 0) {
			detail.push(
				`${round1((bytes * fps) / 1024)} KB a second of room state (${Math.round(bytes)} bytes a frame at ${round1(fps)} fps).`,
			);
		}
		const net = workMean(group, 'netMs');
		if (net !== null && net >= PATCH_STUTTER.netMs) {
			detail.push(
				`Handling the room's messages takes ${round1(net)} ms a frame (up to ${round1(workMax(group, 'netMs') ?? net)}).`,
			);
		}
		out.push({
			id: `patchStutter:${key}:${group[0].r.buildVersion ?? ''}`,
			rule: 'patchStutter',
			severity: period !== null && p95 >= period ? 'medium' : 'low',
			title: `Room patches up to ${Math.round(p95)} ms late on ${deviceOf(group[0].r)}`,
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
