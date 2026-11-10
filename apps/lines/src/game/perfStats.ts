/**
 * The numbers behind the `?perf=1` frame-time readout (`PerfHud.svelte`): frame intervals split
 * into idle and spinning, hitches, the display's refresh, how far each reel step is from the step
 * its speed and the frame's interval make, what each frame asked of the GPU and what its particles
 * and rigs did (`pixi-svelte` `glCounters.ts`), as a mean and a max per frame, and a record of each
 * spike (`perfSpikes.ts`). Plain functions over a frame feed, so a fixture can drive them without a
 * canvas (`perfStats.fixture.ts`).
 */

import type { FrameMotionView } from 'pixi-svelte/frameClock';
import type { FrameWork } from 'pixi-svelte';

import {
	createSpikeRecorder,
	displayPeriodMs,
	spikeThresholdMs,
	type SpikeSummary,
} from './perfSpikes';

declare global {
	/** `?perf=1` only: the readout's Copy report as data, for a script driving the page. */
	var __IE_PERF__: ((action?: 'reset') => string | undefined) | undefined;
}

/** Frames kept per bucket for the percentiles: about 5 s at 120 Hz. */
const WINDOW = 600;
const HITCH_MS = [33, 50, 100] as const;
/** Refresh rates a display runs at; the estimate snaps to the nearest within 8%. */
const REFRESH_HZ = [24, 30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240];
/** Two reel segments within this share of each other's speed are one motion (a carried lap). */
const SAME_RATE = 0.05;
/** Frames between two reads of the display's refresh for the spike threshold. */
const THRESHOLD_EVERY = 60;

export type PerfBucketSnapshot = {
	frames: number;
	fps: number;
	p50: number;
	p95: number;
	max: number;
	hitches: Record<(typeof HITCH_MS)[number], number>;
};

/** The per-frame work the readout reports, in this order. */
export const WORK_KEYS = [
	'draws',
	'vertices',
	'passes',
	'targetSwitches',
	'resolves',
	'invalidations',
	'filterPasses',
	'filterGroups',
	'copies',
	'textureUploads',
	'uploadBytes',
	'compiles',
	'bufferBytes',
	'roundTrips',
	'programs',
	'calls',
	'renderMs',
	'tickMs',
	'lateMs',
	'afterMs',
	'jsMs',
	'gpuWaitMs',
	'particleMs',
	'particles',
	'emitters',
	'baked',
	'rigMs',
	'rigSyncMs',
	'rigs',
] as const satisfies readonly (keyof FrameWork)[];

export type WorkKey = (typeof WORK_KEYS)[number];

export type WorkSnapshot = {
	frames: number;
	/** Per frame: the mean (to 0.1) and the largest, for every key a frame reported. */
	perFrame: Partial<Record<WorkKey, { mean: number; max: number }>>;
};

export type PerfSnapshot = {
	seconds: number;
	refreshHz: number | undefined;
	/** rAF never ran faster than ~30 fps: the browser capped it (iOS Low Power Mode does). */
	capped30: boolean;
	idle: PerfBucketSnapshot;
	spinning: PerfBucketSnapshot;
	reel: { steps: number; mean: number; p95: number; max: number };
	work: { idle: WorkSnapshot; spinning: WorkSnapshot };
	spikes: SpikeSummary;
};

class Ring {
	private values: number[] = [];
	private next = 0;
	push(value: number): void {
		if (this.values.length < WINDOW) this.values.push(value);
		else this.values[this.next] = value;
		this.next = (this.next + 1) % WINDOW;
	}
	sorted(): number[] {
		return [...this.values].sort((a, b) => a - b);
	}
}

const quantile = (sorted: number[], q: number) =>
	sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0;
const round1 = (n: number) => Math.round(n * 10) / 10;

class Bucket {
	frames = 0;
	readonly hitches = { 33: 0, 50: 0, 100: 0 };
	private readonly window = new Ring();
	add(interval: number): void {
		this.frames++;
		this.window.push(interval);
		for (const ms of HITCH_MS) if (interval > ms) this.hitches[ms]++;
	}
	intervals(): number[] {
		return this.window.sorted();
	}
	snapshot(): PerfBucketSnapshot {
		const sorted = this.intervals();
		const mean = sorted.reduce((s, v) => s + v, 0) / (sorted.length || 1);
		return {
			frames: this.frames,
			fps: sorted.length ? round1(1000 / mean) : 0,
			p50: round1(quantile(sorted, 0.5)),
			p95: round1(quantile(sorted, 0.95)),
			max: round1(sorted.at(-1) ?? 0),
			hitches: { ...this.hitches },
		};
	}
}

class WorkBucket {
	frames = 0;
	private readonly sum: Partial<Record<WorkKey, number>> = {};
	private readonly max: Partial<Record<WorkKey, number>> = {};
	add(work: FrameWork): void {
		this.frames++;
		for (const key of WORK_KEYS) {
			const value = work[key];
			if (typeof value !== 'number' || !Number.isFinite(value)) continue;
			this.sum[key] = (this.sum[key] ?? 0) + value;
			this.max[key] = Math.max(this.max[key] ?? 0, value);
		}
	}
	snapshot(): WorkSnapshot {
		const perFrame: WorkSnapshot['perFrame'] = {};
		for (const key of WORK_KEYS) {
			const sum = this.sum[key];
			if (sum === undefined) continue;
			perFrame[key] = { mean: round1(sum / this.frames), max: round1(this.max[key] ?? 0) };
		}
		return { frames: this.frames, perFrame };
	}
}

/** rAF never ran faster than ~30 fps over these (sorted) intervals: a browser cap. */
const isCapped30 = (sorted: number[]) =>
	sorted.length >= 60 && quantile(sorted, 0.1) >= 30 && quantile(sorted, 0.5) <= 36;

/** The refresh rate the shortest intervals point at (the 10th percentile), snapped to a real one. */
export function estimateRefreshHz(intervals: number[]): number | undefined {
	if (intervals.length < 30) return undefined;
	const fast = quantile(
		[...intervals].sort((a, b) => a - b),
		0.1,
	);
	if (!(fast > 0)) return undefined;
	const hz = 1000 / fast;
	const nearest = REFRESH_HZ.reduce((a, b) => (Math.abs(b - hz) < Math.abs(a - hz) ? b : a));
	return Math.abs(nearest - hz) / nearest <= 0.08 ? nearest : Math.round(hz);
}

export function createPerfStats(now: () => number = () => performance.now()) {
	let startedAt = now();
	let lastTime: number | undefined;
	let idle = new Bucket();
	let spinning = new Bucket();
	let reel = new Ring();
	let reelSteps = 0;
	let reelSum = 0;
	let reelMax = 0;
	let previous = new WeakMap<object, { visual: number; rate: number; time: number }>();
	let idleWork = new WorkBucket();
	let spinningWork = new WorkBucket();
	let lastSpinning = false;
	const spikes = createSpikeRecorder();
	let framesSeen = 0;
	let threshold = spikeThresholdMs(displayPeriodMs(undefined, false));
	const intervals = () => [...idle.intervals(), ...spinning.intervals()].sort((a, b) => a - b);

	return {
		/**
		 * One Pixi tick: its frame timestamp, whether the game says it is spinning, every moving
		 * reel, and the game's state. A frame with a reel moving counts as spinning too (a Hold and
		 * Win respin's cells).
		 */
		frame(
			time: number,
			isSpinning: boolean,
			moving: Iterable<FrameMotionView>,
			state?: string,
		): void {
			const motions = [...moving];
			const interval = lastTime === undefined ? undefined : time - lastTime;
			lastSpinning = isSpinning || motions.length > 0;
			if (++framesSeen % THRESHOLD_EVERY === 0) {
				const sorted = intervals();
				threshold = spikeThresholdMs(
					displayPeriodMs(estimateRefreshHz(sorted), isCapped30(sorted)),
				);
			}
			if (interval !== undefined && interval > 0) {
				(lastSpinning ? spinning : idle).add(interval);
				const at = Math.round((time - startedAt) / 100) / 10;
				spikes.frame(time, interval, threshold, lastSpinning, state, at);
			}
			for (const motion of motions) {
				const rate = motion.rate;
				const visual = motion.drawn - motion.shift;
				const before = previous.get(motion);
				if (
					rate !== undefined &&
					before &&
					interval !== undefined &&
					before.time === lastTime &&
					Math.abs(rate - before.rate) <= SAME_RATE * Math.abs(rate)
				) {
					const deviation = Math.abs(visual - before.visual - rate * interval);
					reel.push(deviation);
					reelSteps++;
					reelSum += deviation;
					reelMax = Math.max(reelMax, deviation);
				}
				if (rate === undefined) previous.delete(motion);
				else previous.set(motion, { visual, rate, time });
			}
			lastTime = time;
		},
		/** What the frame just over did; it counts where that frame's interval did. */
		work(sample: FrameWork): void {
			(lastSpinning ? spinningWork : idleWork).add(sample);
			spikes.work(sample);
		},
		/** A long task (Chrome's `longtask` entries), for the spike records. */
		longTask(start: number, duration: number): void {
			spikes.longTask(start, duration);
		},
		/** The page was hidden: the next interval is the pause, not a frame. */
		pause(): void {
			lastTime = undefined;
		},
		reset(): void {
			startedAt = now();
			lastTime = undefined;
			idle = new Bucket();
			spinning = new Bucket();
			reel = new Ring();
			reelSteps = 0;
			reelSum = 0;
			reelMax = 0;
			previous = new WeakMap();
			idleWork = new WorkBucket();
			spinningWork = new WorkBucket();
			spikes.reset();
		},
		snapshot(): PerfSnapshot {
			const sorted = intervals();
			const refreshHz = estimateRefreshHz(sorted);
			const reelSorted = reel.sorted();
			return {
				seconds: Math.round((now() - startedAt) / 1000),
				refreshHz,
				capped30: isCapped30(sorted),
				idle: idle.snapshot(),
				spinning: spinning.snapshot(),
				reel: {
					steps: reelSteps,
					mean: round1(reelSteps ? reelSum / reelSteps : 0),
					p95: round1(quantile(reelSorted, 0.95)),
					max: round1(reelMax),
				},
				work: { idle: idleWork.snapshot(), spinning: spinningWork.snapshot() },
				spikes: spikes.snapshot(threshold),
			};
		},
	};
}

export type PerfStats = ReturnType<typeof createPerfStats>;
