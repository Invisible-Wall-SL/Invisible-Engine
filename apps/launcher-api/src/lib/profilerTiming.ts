/**
 * What a `perf: 10` reading says about time that its frame rate cannot (`perfStats.ts`): each
 * phase's BUSY time (the main thread's work in a frame: `lateMs + tickMs + afterMs`) as p50 / p95
 * against the display's frame period, the hidden and throttled time, the achieved and display
 * rates, and whether the reading can be compared at all. Pure: `check-profiler.ts` runs it on plain
 * JSON. Kept in a reading's `counts` column (`profilerLab.ts` `PerfCounts`), so no migration.
 *
 * THROTTLED. A page the browser throttles (a background tab, a dimmed or locked screen, a remote
 * browser's idle tab) draws one frame a second: its fps and p95 say nothing about the game, and a
 * comparison with it is a comparison with the browser. A reading is `throttled` when its busiest
 * phase's median frame is over {@link THROTTLED_P50_MS} (every version), or the page was hidden for
 * more than {@link HIDDEN_SHARE_MAX} of the reading (`perf: 10`). It is kept and shown, marked, and
 * left out of every budget verdict, finding and comparison.
 */

import type { PerfPhase } from './profiler';

/** A median frame over this is a throttled page: no game runs at under 4 fps by design. */
export const THROTTLED_P50_MS = 250;
/** More of a reading's wall time than this spent hidden makes it throttled. */
export const HIDDEN_SHARE_MAX = 0.05;

export interface BusySummary {
	frames: number;
	p50: number;
	p95: number;
	max: number;
}

export interface PerfTiming {
	/** The frame period busy time is judged against, ms (the display's, 60 Hz at least). */
	budgetMs: number | null;
	/** The rate the frames ran at, and the fastest rate the page's side rAF loop saw (the display's). */
	achievedHz: number | null;
	displayHz: number | null;
	/** Wall time hidden, ms, the frames that still came, the visible frames over 250 ms. */
	hiddenMs: number;
	hiddenFrames: number;
	throttledFrames: number;
	/** The page's visibility when it was sent. */
	visibilityState: string | null;
	/** `on`, or `n/a`: whether the browser offered a GPU timer query. */
	gpuTimer: string | null;
	/** Per phase of the set that has frames. */
	busy: Partial<Record<PerfPhase, BusySummary>>;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A `perf: 10` report's timing; null for an older one or one with no busy time. */
export function readTiming(
	report: Obj,
	version: number,
	phases: readonly PerfPhase[],
): PerfTiming | null {
	if (version < 10 || !isObj(report.busy)) return null;
	const busy: PerfTiming['busy'] = {};
	for (const phase of phases) {
		const b = report.busy[phase];
		if (!isObj(b)) continue;
		const frames = num(b.frames);
		if (!frames) continue;
		busy[phase] = {
			frames,
			p50: num(b.p50) ?? 0,
			p95: num(b.p95) ?? 0,
			max: num(b.max) ?? 0,
		};
	}
	const state = report.visibilityState;
	const gpu = report.gpuTimer;
	return {
		budgetMs: num(report.budgetMs),
		achievedHz: num(report.achievedHz),
		displayHz: num(report.displayHz),
		hiddenMs: num(report.hiddenMs) ?? 0,
		hiddenFrames: num(report.hiddenFrames) ?? 0,
		throttledFrames: num(report.throttledFrames) ?? 0,
		visibilityState: typeof state === 'string' ? state.slice(0, 20) : null,
		gpuTimer: typeof gpu === 'string' ? gpu.slice(0, 10) : null,
		busy,
	};
}

/**
 * Why a reading is not comparable, or null: the median frame of its phase with most frames is over
 * {@link THROTTLED_P50_MS}, or (`perf: 10`) the page was hidden for over {@link HIDDEN_SHARE_MAX}
 * of it.
 */
export function throttledReason(
	report: Obj,
	version: number,
	phases: readonly PerfPhase[],
): string | null {
	let busiest: { phase: PerfPhase; frames: number; p50: number } | null = null;
	for (const phase of phases) {
		const b = report[phase];
		if (!isObj(b)) continue;
		const frames = num(b.frames) ?? 0;
		if (frames > (busiest?.frames ?? 0)) busiest = { phase, frames, p50: num(b.p50) ?? 0 };
	}
	if (busiest && busiest.p50 > THROTTLED_P50_MS) {
		return `median frame ${Math.round(busiest.p50)} ms: the page was throttled (a background or idle tab)`;
	}
	if (version >= 10) {
		const hidden = num(report.hiddenMs) ?? 0;
		const seconds = num(report.seconds) ?? 0;
		if (seconds > 0 && hidden > HIDDEN_SHARE_MAX * seconds * 1000) {
			return `hidden ${Math.round(hidden / 100) / 10} s of ${seconds} s: the page was in the background`;
		}
	}
	return null;
}
