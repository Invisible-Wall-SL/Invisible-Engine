/**
 * The numbers behind the `?perf=1` frame-time readout (`PerfHud.svelte`): frame intervals split
 * into idle and spinning, hitches, the display's refresh, and how far each reel step is from the
 * step its speed and the frame's interval make. Plain functions over a frame feed, so a fixture can
 * drive them without a canvas (`perfStats.fixture.ts`).
 */

import type { FrameMotionView } from 'pixi-svelte/frameClock';

/** Frames kept per bucket for the percentiles: about 5 s at 120 Hz. */
const WINDOW = 600;
const HITCH_MS = [33, 50, 100] as const;
/** Refresh rates a display runs at; the estimate snaps to the nearest within 8%. */
const REFRESH_HZ = [24, 30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240];
/** Two reel segments within this share of each other's speed are one motion (a carried lap). */
const SAME_RATE = 0.05;

export type PerfBucketSnapshot = {
	frames: number;
	fps: number;
	p50: number;
	p95: number;
	max: number;
	hitches: Record<(typeof HITCH_MS)[number], number>;
};

export type PerfSnapshot = {
	seconds: number;
	refreshHz: number | undefined;
	/** rAF never ran faster than ~30 fps: the browser capped it (iOS Low Power Mode does). */
	capped30: boolean;
	idle: PerfBucketSnapshot;
	spinning: PerfBucketSnapshot;
	reel: { steps: number; mean: number; p95: number; max: number };
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

	return {
		/**
		 * One Pixi tick: its frame timestamp, whether the game says it is spinning, and every moving
		 * reel. A frame with a reel moving counts as spinning too (a Hold and Win respin's cells).
		 */
		frame(time: number, isSpinning: boolean, moving: Iterable<FrameMotionView>): void {
			const motions = [...moving];
			const interval = lastTime === undefined ? undefined : time - lastTime;
			if (interval !== undefined && interval > 0)
				(isSpinning || motions.length > 0 ? spinning : idle).add(interval);
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
		},
		snapshot(): PerfSnapshot {
			const all = [...idle.intervals(), ...spinning.intervals()];
			const refreshHz = estimateRefreshHz(all);
			const sorted = all.sort((a, b) => a - b);
			const reelSorted = reel.sorted();
			return {
				seconds: Math.round((now() - startedAt) / 1000),
				refreshHz,
				capped30: sorted.length >= 60 && quantile(sorted, 0.1) >= 30 && quantile(sorted, 0.5) <= 36,
				idle: idle.snapshot(),
				spinning: spinning.snapshot(),
				reel: {
					steps: reelSteps,
					mean: round1(reelSteps ? reelSum / reelSteps : 0),
					p95: round1(quantile(reelSorted, 0.95)),
					max: round1(reelMax),
				},
			};
		},
	};
}

export type PerfStats = ReturnType<typeof createPerfStats>;
