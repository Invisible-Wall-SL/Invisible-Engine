/**
 * GPU-bound or CPU-bound: for a device whose phase fps misses its budget, which side of the frame
 * to cut. The frame's JS (`work.<phase>.perFrame.jsMs`: every animation-frame callback), split into
 * the render submit (`renderMs`), the rest of the Pixi tick (`tickMs − renderMs`: game code) and JS
 * outside the tick (`jsMs − tickMs`: Svelte, tweens), is judged against the frame the budget asks
 * for — the display period `1000 / max(60, refreshHz)` (`perfSpikes.ts` `displayPeriodMs`: a device
 * that cannot keep up still reads 60 Hz), never the slower interval it achieved. JS alone past that
 * frame is CPU-bound (every frame waits a second vsync); with `perfSpikes.ts`'s shares, JS ≥ 60% is
 * CPU-bound and < 40% is not our JS — the GPU or the browser, which only a `?perfgpu=1` reading's GPU
 * wait tells apart. A `?perfgpu=1` reading's fps is never read (the wait stalls the pipeline); its
 * GPU wait is read against the display frame. Lab readings and readings at a browser's 30 fps cap
 * never count (P3 judges neither's fps). No estimate: it names the side, not a saving.
 */

import {
	judge,
	MIN_PHASE_FRAMES,
	readingDeviceClass,
	type BudgetDeviceClass,
} from '../../profilerBudgets';
import { phasesOf, type PerfReportListItem } from '../../profiler';
import {
	agent,
	currentReadings,
	deviceOf,
	factsOf,
	fpsReadings,
	groupBy,
	median,
	readingRef,
	round1,
	type Finding,
	type Rule,
} from '../finding';

export const BOUND_SHARES = { cpu: 0.6, outside: 0.4, gpu: 0.6 } as const;

const ENGINE = agent('engine-pixi-svelte');

/** The frame the budget asks of a display: 60 Hz, or its own period when it is faster. */
export const budgetFrameMs = ({ refreshHz }: FrameOf): number =>
	1000 / Math.max(60, refreshHz ?? 60);

/** What a reading's frame is worked out from: its phase's fps and its display's rate. */
export interface FrameOf {
	fps: number;
	refreshHz: number | null;
}

/** The rule, judging our JS against `frameMs` of each reading. */
export const gpuCpuBoundAgainst =
	(frameMs: (reading: FrameOf) => number): Rule =>
	(ctx) => {
		const out: Finding[] = [];
		const readings = currentReadings(fpsReadings(ctx.readings), ctx.builds).filter(
			(r) => !r.capped30,
		);
		const line = (deviceClass: BudgetDeviceClass, phase: string) =>
			ctx.budgets.find(
				(b) => b.deviceClass === deviceClass && b.metric === 'fps' && b.phase === phase,
			);
		const groups = groupBy(
			readings.filter((r) => readingDeviceClass(r) && factsOf(ctx, r)),
			(r) => `${r.gameKey ?? ''}|${deviceOf(r)}`,
		);
		for (const [key, group] of groups) {
			const deviceClass = readingDeviceClass(group[0]) as BudgetDeviceClass;
			const shipped = group.filter((r) => Object.keys(r.flags).length === 0);
			const gpuRuns = group.filter((r) => r.flags.perfgpu === '1');
			for (const phase of phasesOf(group)) {
				// An arcade reading that reports busy time is judged on that (`fpsBelowBudget`), not on
				// the fps its display and browser leave it.
				const rows = shipped
					.filter((r) => !(r.phaseSet === 'arcade' && r.counts?.timing))
					.map((r) => ({ r, p: r[phase], t: factsOf(ctx, r)?.timing[phase] }))
					.filter(
						(
							x,
						): x is {
							r: PerfReportListItem;
							p: NonNullable<typeof x.p>;
							t: NonNullable<typeof x.t>;
						} =>
							!!x.p && x.p.frames >= MIN_PHASE_FRAMES && x.p.fps > 0 && !!x.t && x.t.jsMs !== null,
					);
				const fps = median(rows.map((x) => x.p.fps));
				if (fps === null) continue;
				const verdict = judge('fps', fps, line(deviceClass, phase));
				if (verdict !== 'warn' && verdict !== 'fail') continue;
				const interval = 1000 / fps;
				const frame =
					median(
						rows.map((x) =>
							frameMs({ fps: x.p.fps, refreshHz: factsOf(ctx, x.r)?.refreshHz ?? null }),
						),
					) ?? 1000 / 60;
				const js = median(rows.map((x) => x.t.jsMs ?? 0)) ?? 0;
				const render = median(rows.map((x) => x.t.renderMs ?? 0)) ?? 0;
				const tick = median(rows.map((x) => x.t.tickMs ?? 0)) ?? 0;
				const share = js / frame;
				const waits = gpuRuns
					.map((r) => factsOf(ctx, r)?.timing[phase]?.gpuWaitMs)
					.filter((v): v is number => typeof v === 'number');
				const gpuWait = median(waits);
				const parts: [string, number][] = [
					['the render submit', render],
					['game code in the tick', Math.max(0, tick - render)],
					['JS outside the Pixi tick (Svelte, tweens)', Math.max(0, js - tick)],
				];
				const [biggest, biggestMs] = parts.reduce((a, b) => (b[1] > a[1] ? b : a));
				let side: string;
				const detail = [
					`${phase} ${round1(fps)} fps = ${round1(interval)} ms a frame; our JS ${round1(js)} ms is ${Math.round(share * 100)}% of the ${round1(frame)} ms frame the budget asks for: render ${round1(render)}, tick ${round1(tick)}.`,
				];
				if (gpuWait !== null && gpuWait >= BOUND_SHARES.gpu * frame) {
					side = 'GPU-bound';
					detail.push(
						`?perfgpu=1: the GPU still works ${round1(gpuWait)} ms after each submit, of a ${round1(frame)} ms display frame — cut draws, passes, overdraw or resolution.`,
					);
				} else if (js >= frame) {
					side = 'CPU-bound';
					detail.push(
						`Our JS alone is longer than the ${round1(frame)} ms frame: every frame waits a second vsync.`,
						`The largest part is ${biggest} (${round1(biggestMs)} ms).`,
					);
				} else if (share >= BOUND_SHARES.cpu) {
					side = 'CPU-bound';
					detail.push(`The largest part is ${biggest} (${round1(biggestMs)} ms).`);
				} else if (share < BOUND_SHARES.outside) {
					side = gpuWait !== null ? 'bound outside our JS (not the GPU)' : 'bound outside our JS';
					detail.push(
						gpuWait !== null
							? `?perfgpu=1 GPU wait is ${round1(gpuWait)} ms: the browser's own work (style, paint, commit) or another task.`
							: 'The GPU or the browser — take a ?perfgpu=1 reading on this device to tell which.',
					);
				} else {
					side = 'between CPU and GPU';
					detail.push(
						`Neither side dominates; the largest JS part is ${biggest} (${round1(biggestMs)} ms).`,
					);
				}
				out.push({
					id: `gpuCpuBound:${key}:${group[0].buildVersion ?? ''}:${phase}`,
					rule: 'gpuCpuBound',
					severity: verdict === 'fail' ? 'medium' : 'low',
					title: `${phase} is ${side} on ${deviceOf(group[0])}`,
					detail,
					evidence: [...rows.map((x) => x.r), ...gpuRuns].slice(0, 6).map(readingRef),
					estimate: null,
					owner: ENGINE,
					deviceClass,
					gameKey: group[0].gameKey,
				});
			}
		}
		return out;
	};

export const gpuCpuBound: Rule = gpuCpuBoundAgainst(budgetFrameMs);
