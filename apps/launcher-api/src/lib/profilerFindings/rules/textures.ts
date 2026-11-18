/**
 * Textures: what the art costs in GPU memory and download.
 * - **Over the GPU budget**: a device's texture MB (the probe's `textures`, median over its
 *   as-shipped readings of the current build) past its `gpuMb` line; the estimate is the MB its
 *   five largest textures hold (`textureList`) — the most cutting them can save.
 * - **KTX2 fell back**: KTX2 assets a device loaded as their WebP/PNG twin (`ktx2Fallbacks`).
 *   Unmeasured: a fallback names the loader's asset key, not the page file `textureList` lists, so
 *   no texture's memory can be pinned on it.
 * - **Oversize pages**: pages over 4096 px on a side in a game's newest build (the breakdown), which
 *   many phones cannot load. Unmeasured: splitting a page ships about the same bytes.
 * Texture counts are not timing, so lab readings count here (P6).
 */

import { judge, readingDeviceClass } from '../../profilerBudgets';
import type { TextureFact } from '../facts';
import {
	buildFactsOf,
	buildRef,
	currentReadings,
	deviceOf,
	factsOf,
	groupBy,
	median,
	newestBuilds,
	readingRef,
	round1,
	toolOwner,
	type Finding,
	type Rule,
} from '../finding';

export const textures: Rule = (ctx) => {
	const out: Finding[] = [];
	const owner = toolOwner(ctx.owners, 'atlasTool', 'atlas-python-tools');
	const shipped = currentReadings(ctx.readings, ctx.builds).filter(
		(r) => Object.keys(r.flags).length === 0,
	);

	for (const [key, group] of groupBy(shipped, (r) => `${r.gameKey ?? ''}|${deviceOf(r)}`)) {
		const deviceClass = readingDeviceClass(group[0]);
		const newest = [...group].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
		const listed = newest.find((r) => factsOf(ctx, r)?.textures);
		const list: TextureFact[] = (listed && factsOf(ctx, listed)?.textures) || [];

		const mb = median(group.map((r) => r.textureMb).filter((v): v is number => v !== null));
		const line = ctx.budgets.find(
			(b) => b.deviceClass === deviceClass && b.metric === 'gpuMb' && b.phase === '',
		);
		const verdict = deviceClass ? judge('gpuMb', mb, line) : 'none';
		if (mb !== null && (verdict === 'warn' || verdict === 'fail')) {
			const top = list.slice(0, 5);
			out.push({
				id: `textures:gpu:${key}:${listed?.buildVersion ?? newest[0].buildVersion ?? ''}`,
				rule: 'textures',
				severity: verdict === 'fail' ? 'high' : 'medium',
				title: `${round1(mb)} MB of textures on ${deviceOf(group[0])}`,
				detail: [
					`Budget: fail > ${line?.fail ?? '—'} MB, warn > ${line?.warn ?? '—'} MB.`,
					...top.map(
						(t) => `${t.src} — ${t.width}×${t.height} ${t.format} (${t.kind}), ${t.mb} MB`,
					),
					...(top.length ? [] : ['No texture list in these readings (sent trimmed).']),
				],
				evidence: [listed ?? newest[0]].map(readingRef),
				estimate: top.length
					? {
							value: round1(top.reduce((n, t) => n + t.mb, 0)),
							unit: 'GPU MB',
							basis: `held by the ${top.length} largest textures`,
						}
					: null,
				owner,
				deviceClass: group[0].deviceClass,
				gameKey: group[0].gameKey,
			});
		}

		const fellBack = newest.find((r) => factsOf(ctx, r)?.ktx2Fallbacks.length);
		if (fellBack) {
			const f = factsOf(ctx, fellBack)!;
			out.push({
				id: `textures:ktx2:${key}:${fellBack.buildVersion ?? ''}`,
				rule: 'textures',
				severity: 'medium',
				title: `${f.ktx2Fallbacks.length} KTX2 asset${f.ktx2Fallbacks.length === 1 ? '' : 's'} fell back to WebP/PNG on ${deviceOf(fellBack)}`,
				detail: f.ktx2Fallbacks.slice(0, 5).map((x) => `${x.key}: ${x.reason}`),
				evidence: [readingRef(fellBack)],
				estimate: null,
				owner,
				deviceClass: fellBack.deviceClass,
				gameKey: fellBack.gameKey,
			});
		}
	}

	for (const b of newestBuilds(ctx.builds)) {
		const facts = buildFactsOf(ctx, b);
		if (!facts?.oversized.length) continue;
		out.push({
			id: `textures:oversize:${b.id}`,
			rule: 'textures',
			severity: 'medium',
			title: `${facts.oversized.length} page${facts.oversized.length === 1 ? '' : 's'} over 4096 px in v${b.build}`,
			detail: facts.oversized.slice(0, 5).map((f) => `${f.rel} — ${f.w}×${f.h}`),
			evidence: [buildRef(b)],
			estimate: null,
			owner,
			deviceClass: null,
			gameKey: b.gameKey,
		});
	}
	return out;
};
