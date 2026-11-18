/**
 * Regression: this build against the previous one.
 * - **Size**: a game's newest build against the build before it of the same game and kind
 *   (`profilerBuilds.ts` `previousBuild` / `buildDiff`): shipped bytes up ≥ max(1 MB, 5%), or the
 *   GPU estimate up ≥ max(10 MB, 5%), with the categories that grew.
 * - **Fps**: per game, the as-shipped device readings of its newest build (`stampsNewestFirst`:
 *   by build, never by capture time) against the build before it, per device (class and GPU) and
 *   phase — the median as-shipped fps down ≥ max(3 fps, 5%), both sides
 *   with enough frames. Never lab readings (P6).
 * - **Counts**: the newest lab reading on the newest stamp against the newest on the stamp before:
 *   a count up past `LAB_TOLERANCE` (`profilerLab.ts`).
 * The categories that grew come from the build records the two stamps join, when they have them.
 */

import { MIN_PHASE_FRAMES } from '../../profilerBudgets';
import { PERF_PHASES, type PerfReportListItem } from '../../profiler';
import { buildDiff, previousBuild, readingOnBuild } from '../../profilerBuilds';
import { labComparison } from '../../profilerLab';
import { mbOf } from '../facts';
import {
	BUILD_CHANGES,
	buildRef,
	deviceOf,
	groupBy,
	median,
	newestBuilds,
	readingRef,
	round1,
	stampsNewestFirst,
	type Finding,
	type FindingContext,
	type Rule,
} from '../finding';

export const REGRESSION_MIN = {
	shippedBytes: 1048576,
	gpuBytes: 10 * 1048576,
	share: 0.05,
	fps: 3,
} as const;

const asShipped = (r: PerfReportListItem) => Object.keys(r.flags).length === 0;

/** The categories that grew between the build records two sets of readings were taken on. */
function grown(ctx: FindingContext, now: PerfReportListItem, before: PerfReportListItem): string[] {
	const a = ctx.builds.find((b) => readingOnBuild(now, b));
	const b = ctx.builds.find((x) => readingOnBuild(before, x));
	if (!a || !b) return [];
	return buildDiff(a, b)
		.categories.filter((c) => c.delta > 0)
		.slice(0, 3)
		.map((c) => `${c.label} +${mbOf(c.delta)} MB`);
}

const stampLabel = (r: PerfReportListItem) => (r.buildVersion ? `v${r.buildVersion}` : 'no stamp');

export const regression: Rule = (ctx) => {
	const out: Finding[] = [];

	for (const b of newestBuilds(ctx.builds)) {
		const prev = previousBuild(b, ctx.builds);
		if (!prev) continue;
		const diff = buildDiff(b, prev);
		const categories = diff.categories
			.filter((c) => c.delta > 0)
			.slice(0, 4)
			.map((c) => `${c.label} +${mbOf(c.delta)} MB`);
		const sizes = [
			{
				id: 'shipped',
				delta: diff.shipped,
				before: prev.shippedBytes,
				min: REGRESSION_MIN.shippedBytes,
				unit: 'MB' as const,
				what: 'shipped',
			},
			{
				id: 'gpu',
				delta: diff.gpu,
				before: prev.gpuBytes,
				min: REGRESSION_MIN.gpuBytes,
				unit: 'GPU MB' as const,
				what: 'GPU estimate',
			},
		];
		for (const s of sizes) {
			// A breakdown that names no size reads 0: no data, never growth from nothing.
			if (s.before <= 0 || s.before + s.delta <= 0) continue;
			if (s.delta < Math.max(s.min, REGRESSION_MIN.share * s.before)) continue;
			out.push({
				id: `regression:${s.id}:${b.id}`,
				rule: 'regression',
				severity: 'medium',
				title: `v${b.build} ${s.what} +${mbOf(s.delta)} MB over v${prev.build} (${b.gameKey})`,
				detail: categories.length ? [`Grew: ${categories.join(', ')}.`] : [],
				evidence: [buildRef(b), buildRef(prev)],
				estimate: {
					value: mbOf(s.delta),
					unit: s.unit,
					basis: `${s.what} growth since v${prev.build}`,
				},
				owner: BUILD_CHANGES,
				deviceClass: null,
				gameKey: b.gameKey,
			});
		}
	}

	for (const [game, readings] of groupBy(ctx.readings.filter(asShipped), (r) => r.gameKey ?? '')) {
		// Fps between the two newest builds a device measured; lab counts between the two newest builds
		// the lab measured — each its own pair, so a lab run on a build between does not hide a phone's.
		const phones = stampsNewestFirst(
			readings.filter((r) => r.source !== 'lab'),
			ctx.builds,
		);
		const labs = stampsNewestFirst(
			readings.filter((r) => r.source === 'lab' && r.counts),
			ctx.builds,
		);
		const fpsNow = groupBy(phones[0]?.readings ?? [], deviceOf);
		const fpsBefore = groupBy(phones[1]?.readings ?? [], deviceOf);
		for (const [device, list] of fpsNow) {
			const old = fpsBefore.get(device);
			if (!old) continue;
			for (const phase of PERF_PHASES) {
				const med = (rs: PerfReportListItem[]) =>
					median(
						rs
							.map((r) => r[phase])
							.filter((p) => !!p && p.frames >= MIN_PHASE_FRAMES)
							.map((p) => p!.fps),
					);
				const a = med(list);
				const b = med(old);
				if (a === null || b === null) continue;
				const drop = round1(b - a);
				if (drop < Math.max(REGRESSION_MIN.fps, REGRESSION_MIN.share * b)) continue;
				const g = grown(ctx, list[0], old[0]);
				out.push({
					id: `regression:fps:${game}:${old[0].buildVersion}>${list[0].buildVersion}:${device}:${phase}`,
					rule: 'regression',
					severity: 'high',
					title: `${phase} fps ${round1(b)} → ${round1(a)} on ${device} (${stampLabel(old[0])} → ${stampLabel(list[0])})`,
					detail: [
						`Median of ${list.length} reading${list.length === 1 ? '' : 's'} now, ${old.length} before.`,
						...(g.length ? [`Grew: ${g.join(', ')}.`] : []),
					],
					evidence: [...list.slice(0, 3), ...old.slice(0, 3)].map(readingRef),
					estimate: { value: drop, unit: 'fps', basis: `fps lost since ${stampLabel(old[0])}` },
					owner: BUILD_CHANGES,
					deviceClass: list[0].deviceClass,
					gameKey: game || null,
				});
			}
		}
		const newest = (rs: PerfReportListItem[] | undefined) =>
			rs && [...rs].sort((x, y) => y.capturedAt.localeCompare(x.capturedAt))[0];
		const labNow = newest(labs[0]?.readings);
		const labBefore = newest(labs[1]?.readings);
		if (labNow?.counts && labBefore?.counts) {
			const up = labComparison(labNow.counts, labBefore.counts).filter(
				(row) => row.changed && (row.delta ?? 0) > 0,
			);
			if (up.length) {
				const draws =
					up.find((row) => row.key === 'draws' && row.phase === 'spinning') ??
					up.find((row) => row.key === 'draws');
				const g = grown(ctx, labNow, labBefore);
				out.push({
					id: `regression:counts:${game}:${labBefore.buildVersion}>${labNow.buildVersion}`,
					rule: 'regression',
					severity: 'medium',
					title: `Lab counts up in ${stampLabel(labNow)} over ${stampLabel(labBefore)}${game ? ` (${game})` : ''}`,
					detail: [
						...up.map((row) => `${row.phase} ${row.label}: ${row.previous} → ${row.value}`),
						...(g.length ? [`Grew: ${g.join(', ')}.`] : []),
					],
					evidence: [readingRef(labNow), readingRef(labBefore)],
					estimate: draws
						? {
								value: draws.delta ?? 0,
								unit: 'draws',
								basis: `${draws.phase} draws a frame added since ${stampLabel(labBefore)}`,
							}
						: null,
					owner: BUILD_CHANGES,
					deviceClass: labNow.deviceClass,
					gameKey: game || null,
				});
			}
		}
	}
	return out;
};
