/**
 * Feature cost: a reading taken with ONE test switch (`particles=off`, `fx=0`, `aa=0` — the New
 * capture links) beside the as-shipped reading nearest in time on the same game, build stamp and
 * device (class, GPU, browser): the fps and the draws a frame the switch buys, per phase. Fps only
 * where both phases have enough frames and neither reading is a lab run (P6); draws from the
 * per-phase counts. Shown when the switch buys ≥ 2 fps or ≥ 10% of the draws (and ≥ 5).
 */

import { MIN_PHASE_FRAMES } from '../../profilerBudgets';
import { PERF_PHASES, type PerfReportListItem } from '../../profiler';
import {
	agent,
	currentReadings,
	deviceOf,
	readingRef,
	round1,
	stampOf,
	toolOwner,
	type Estimate,
	type Finding,
	type FindingOwner,
	type OwnerMap,
	type Rule,
} from '../finding';

export const FEATURE_SWITCHES: Record<
	string,
	{ value: string; what: string; owner: (o: OwnerMap) => FindingOwner }
> = {
	particles: { value: 'off', what: 'Particles', owner: (o) => toolOwner(o, 'fx', 'invisible-fx') },
	fx: {
		value: '0',
		what: 'Element FX passes',
		owner: (o) => toolOwner(o, 'shaders', 'invisible-shader-graph'),
	},
	aa: { value: '0', what: 'Antialiasing', owner: () => agent('engine-pixi-svelte') },
};

export const FEATURE_MIN = { fps: 2, drawsShare: 0.1, draws: 5 } as const;

const sameDevice = (a: PerfReportListItem, b: PerfReportListItem) =>
	a.deviceClass === b.deviceClass && a.gpu === b.gpu && a.uaFamily === b.uaFamily;

/** The switch a reading ran with, when it is exactly one of the feature switches. */
function switchOf(r: PerfReportListItem): string | null {
	const keys = Object.keys(r.flags);
	if (keys.length !== 1) return null;
	const s = FEATURE_SWITCHES[keys[0]];
	return s && r.flags[keys[0]] === s.value ? keys[0] : null;
}

const drawsOf = (r: PerfReportListItem, phase: string): number | null =>
	phase === 'idle' ||
	phase === 'spinning' ||
	phase === 'loading' ||
	phase === 'lobby' ||
	phase === 'menu' ||
	phase === 'play' ||
	phase === 'spectate'
		? (r.counts?.[phase]?.draws ?? null)
		: null;

export const featureCost: Rule = (ctx) => {
	const out: Finding[] = [];
	const readings = currentReadings(ctx.readings, ctx.builds);
	for (const switched of readings) {
		const name = switchOf(switched);
		if (!name) continue;
		const base = readings
			.filter(
				(r) =>
					Object.keys(r.flags).length === 0 &&
					r.source === switched.source &&
					stampOf(r) === stampOf(switched) &&
					sameDevice(r, switched),
			)
			.sort(
				(a, b) =>
					Math.abs(Date.parse(a.capturedAt) - Date.parse(switched.capturedAt)) -
					Math.abs(Date.parse(b.capturedAt) - Date.parse(switched.capturedAt)),
			)[0];
		if (!base) continue;
		const useFps = switched.source !== 'lab' && base.source !== 'lab';
		const detail: string[] = [];
		let bestFps: { phase: string; gain: number } | null = null;
		let bestDraws: { phase: string; saved: number; share: number } | null = null;
		for (const phase of PERF_PHASES) {
			const a = base[phase];
			const b = switched[phase];
			const parts: string[] = [];
			if (useFps && a && b && a.frames >= MIN_PHASE_FRAMES && b.frames >= MIN_PHASE_FRAMES) {
				const gain = round1(b.fps - a.fps);
				parts.push(`${round1(a.fps)} → ${round1(b.fps)} fps`);
				if (!bestFps || gain > bestFps.gain) bestFps = { phase, gain };
			}
			const da = drawsOf(base, phase);
			const db = drawsOf(switched, phase);
			if (da !== null && db !== null && da > 0) {
				const saved = round1(da - db);
				parts.push(`${round1(da)} → ${round1(db)} draws`);
				if (!bestDraws || saved > bestDraws.saved) bestDraws = { phase, saved, share: saved / da };
			}
			if (parts.length) detail.push(`${phase}: ${parts.join(', ')}.`);
		}
		const fpsWorth = bestFps && bestFps.gain >= FEATURE_MIN.fps;
		const drawsWorth =
			bestDraws &&
			bestDraws.saved >= FEATURE_MIN.draws &&
			bestDraws.share >= FEATURE_MIN.drawsShare;
		if (!fpsWorth && !drawsWorth) continue;
		const s = FEATURE_SWITCHES[name];
		const estimate: Estimate = fpsWorth
			? {
					value: bestFps!.gain,
					unit: 'fps',
					basis: `fps ${bestFps!.phase} gains with ${name}=${s.value}`,
				}
			: {
					value: bestDraws!.saved,
					unit: 'draws',
					basis: `draws a ${bestDraws!.phase} frame saves with ${name}=${s.value}`,
				};
		if (!useFps) detail.push('Lab readings: fps not compared, draws only.');
		out.push({
			id: `featureCost:${switched.id}`,
			rule: 'featureCost',
			severity: fpsWorth && bestFps!.gain >= 5 ? 'medium' : 'low',
			title: `${s.what} cost ${fpsWorth ? `${bestFps!.gain} fps ${bestFps!.phase}` : `${bestDraws!.saved} draws a frame`} on ${deviceOf(base)}`,
			detail,
			evidence: [readingRef(base), readingRef(switched)],
			estimate,
			owner: s.owner(ctx.owners),
			deviceClass: base.deviceClass,
			gameKey: base.gameKey,
		});
	}
	return out;
};
