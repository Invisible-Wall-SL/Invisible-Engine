/**
 * The numbers behind the `?perf=1` frame-time readout (`PerfHud.svelte`): frame intervals split
 * into phases (idle, spinning, and a round's frames with the reels at rest: wins, features,
 * banners), hitches, the display's refresh, how far each reel step is from the step its speed and
 * the frame's interval make, what each frame asked of the GPU, what its particles and rigs did and
 * what it built and threw away (`pixi-svelte` `glCounters.ts`, `churnProbe.ts`), as a mean and a
 * max per frame, and a record of each spike (`perfSpikes.ts`). Plain functions over a frame feed,
 * so a fixture can drive them without a canvas (`perfStats.fixture.ts`).
 *
 * PHASE SETS. A reading is split by the game's family (`PHASE_SETS`): a slot's frames into idle /
 * spinning / round ({@link framePhase}), an arcade game's into `menu` / `play` (`arcadePerf.ts`
 * says which, a frame late: the tick that decides it runs after the frame's timestamp is taken), with
 * its fixed steps, bodies and room messages counted in `work` beside the renderer's counts and, for
 * an online game, how late each room state arrived. A slot reading is the same as before arcade
 * phases existed.
 */

import type { FrameMotionView } from 'pixi-svelte/frameClock';

import { ARCADE_WORK_KEYS, type ArcadePhase } from './arcadePerf';
import {
	PHASE_SETS,
	createSpikeRecorder,
	displayPeriodMs,
	spikeThresholdMs,
	type PerfFrameWork,
	type PerfPhase,
	type PhaseSet,
	type SlotPhase,
	type SpikeSummary,
} from './perfSpikes';

declare global {
	/** `?perf=1` only: the readout's Copy report as data, for a script driving the page. */
	var __IE_PERF__: ((action?: 'reset' | 'take') => string | undefined) | undefined;
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
/**
 * A 30 fps cap is the browser's only when the frames' main-thread work (before, in and after the
 * tick: `lateMs + tickMs + afterMs`, the median) fits this share of a 60 Hz frame. Busier frames
 * cannot run at 60: on a 60 Hz display each one waits a second vsync, which reads as exactly 30 fps
 * with no cap at all (the owner's Salmons reading on a Galaxy S24 Ultra, 2026-11-26: ~25 ms a frame).
 */
const CAP_BUSY_SHARE = 0.75;
/**
 * The game's top-level states a round is played in (`utils-xstate` `STATE_BET`, `STATE_AUTOBET`,
 * `STATE_RESUME_BET`): the win presentation and a feature run inside them, reels at rest.
 */
const ROUND_STATES = new Set(['bet', 'autoBet', 'resumeBet']);

/** The phase a frame counts in: spinning when a reel moves, else round or idle by the state. */
export function framePhase(spinning: boolean, state: string | undefined): SlotPhase {
	if (spinning) return 'spinning';
	return state !== undefined && ROUND_STATES.has(state.split(/[.,]/)[0]) ? 'round' : 'idle';
}

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
	'created',
	'createdContainers',
	'createdSprites',
	'createdParticles',
	'createdTexts',
	'createdGraphics',
	'createdMeshes',
	'createdOther',
	'destroyed',
	'destroyedContainers',
	'destroyedSprites',
	'destroyedParticles',
	'destroyedTexts',
	'destroyedGraphics',
	'destroyedMeshes',
	'destroyedOther',
	'rigsBuilt',
	'rigsDestroyed',
	'textRenders',
	'textMs',
	'domAdded',
	'domRemoved',
] as const satisfies readonly (keyof PerfFrameWork)[];

/** Every key a frame's work is bucketed on: the renderer's, then an arcade frame's own. */
const BUCKET_KEYS = [...WORK_KEYS, ...ARCADE_WORK_KEYS] as const;

export type WorkKey = (typeof BUCKET_KEYS)[number];

export type WorkSnapshot = {
	frames: number;
	/** Per frame: the mean (to 0.1) and the largest, for every key a frame reported. */
	perFrame: Partial<Record<WorkKey, { mean: number; max: number }>>;
};

/** How late an online arcade game's room states arrived (`arcadePerf.ts` `lates`), ms. */
export type LateSnapshot = { count: number; p50: number; p95: number; max: number };

type CommonSnapshot = {
	seconds: number;
	refreshHz: number | undefined;
	/**
	 * rAF never ran faster than ~30 fps while the frames' work would have fit a 60 Hz frame: the
	 * browser capped it (iOS Low Power Mode does).
	 */
	capped30: boolean;
	spikes: SpikeSummary;
};

export type SlotSnapshot = CommonSnapshot & {
	set: 'slot';
	idle: PerfBucketSnapshot;
	spinning: PerfBucketSnapshot;
	/** A round's frames with the reels at rest: the win presentation, a feature's screens. */
	round: PerfBucketSnapshot;
	reel: { steps: number; mean: number; p95: number; max: number };
	work: Record<SlotPhase, WorkSnapshot>;
};

export type ArcadeSnapshot = CommonSnapshot & {
	set: 'arcade';
	/** The field not playing: a title, a lobby, a countdown, a win screen. */
	menu: PerfBucketSnapshot;
	/** The field playing: the loop moving bodies, the online room running. */
	play: PerfBucketSnapshot;
	work: Record<ArcadePhase, WorkSnapshot>;
	lateMs: Record<ArcadePhase, LateSnapshot>;
};

export type PerfSnapshot = SlotSnapshot | ArcadeSnapshot;

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
	add(work: PerfFrameWork): void {
		this.frames++;
		for (const key of BUCKET_KEYS) {
			const value = work[key];
			if (typeof value !== 'number' || !Number.isFinite(value)) continue;
			this.sum[key] = (this.sum[key] ?? 0) + value;
			this.max[key] = Math.max(this.max[key] ?? 0, value);
		}
	}
	snapshot(): WorkSnapshot {
		const perFrame: WorkSnapshot['perFrame'] = {};
		for (const key of BUCKET_KEYS) {
			const sum = this.sum[key];
			if (sum === undefined) continue;
			perFrame[key] = { mean: round1(sum / this.frames), max: round1(this.max[key] ?? 0) };
		}
		return { frames: this.frames, perFrame };
	}
}

/** rAF never ran faster than ~30 fps over these (sorted) intervals: a cap, if the work fit. */
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

const lateOf = (ring: Ring): LateSnapshot => {
	const sorted = ring.sorted();
	return {
		count: sorted.length,
		p50: round1(quantile(sorted, 0.5)),
		p95: round1(quantile(sorted, 0.95)),
		max: round1(sorted.at(-1) ?? 0),
	};
};

export interface PerfStats<S extends PerfSnapshot = PerfSnapshot> {
	/**
	 * One Pixi tick of a slot: its frame timestamp, whether the game says it is spinning, every
	 * moving reel, and the game's state. A frame with a reel moving counts as spinning too (a Hold
	 * and Win respin's cells); one in a round with every reel at rest, as the round's.
	 */
	frame(time: number, isSpinning: boolean, moving: Iterable<FrameMotionView>, state?: string): void;
	/** One Pixi tick of an arcade game: its frame timestamp and the phase the last tick was in. */
	arcadeFrame(time: number, phase: ArcadePhase, state?: string): void;
	/** What the frame just over did; it counts where that frame's interval did. */
	work(sample: PerfFrameWork): void;
	/** An online arcade game's room states since the last frame: how late each arrived, ms. */
	lates(ms: readonly number[]): void;
	/** A long task (Chrome's `longtask` entries), for the spike records. */
	longTask(start: number, duration: number): void;
	/** The page was hidden: the next interval is the pause, not a frame. */
	pause(): void;
	reset(): void;
	snapshot(): S;
}

/** The snapshot a phase set's readings give. */
export type SnapshotOf<S extends PhaseSet> = S extends 'arcade' ? ArcadeSnapshot : SlotSnapshot;

/** The readout's numbers for a slot (the default) or an arcade game (`set` `arcade`). */
export function createPerfStats<S extends PhaseSet = 'slot'>(
	now: () => number = () => performance.now(),
	set: S = 'slot' as S,
): PerfStats<SnapshotOf<S>> {
	const phases: readonly PerfPhase[] = PHASE_SETS[set];
	/** One per phase of the set: the only phases a frame of this reading is put in. */
	const perPhase = <T>(make: () => T) =>
		Object.fromEntries(phases.map((phase) => [phase, make()])) as Record<PerfPhase, T>;
	let startedAt = now();
	let lastTime: number | undefined;
	let buckets = perPhase(() => new Bucket());
	let reel = new Ring();
	let reelSteps = 0;
	let reelSum = 0;
	let reelMax = 0;
	let previous = new WeakMap<object, { visual: number; rate: number; time: number }>();
	let work = perPhase(() => new WorkBucket());
	let late = perPhase(() => new Ring());
	let busy = new Ring();
	let lastPhase: PerfPhase = phases[0];
	const spikes = createSpikeRecorder(phases);
	let framesSeen = 0;
	let threshold = spikeThresholdMs(displayPeriodMs(undefined, false));
	const intervals = () =>
		phases.flatMap((phase) => buckets[phase].intervals()).sort((a, b) => a - b);
	const capped30 = (sorted: number[]) => {
		if (!isCapped30(sorted)) return false;
		const frames = busy.sorted();
		return !frames.length || quantile(frames, 0.5) < (CAP_BUSY_SHARE * 1000) / 60;
	};

	const count = (time: number, phase: PerfPhase, state: string | undefined) => {
		const interval = lastTime === undefined ? undefined : time - lastTime;
		lastPhase = phase;
		if (++framesSeen % THRESHOLD_EVERY === 0) {
			const sorted = intervals();
			threshold = spikeThresholdMs(displayPeriodMs(estimateRefreshHz(sorted), capped30(sorted)));
		}
		if (interval !== undefined && interval > 0) {
			buckets[phase].add(interval);
			const at = Math.round((time - startedAt) / 100) / 10;
			spikes.frame(time, interval, threshold, phase, state, at);
		}
		return interval;
	};

	const stats: PerfStats = {
		frame(time, isSpinning, moving, state) {
			const motions = [...moving];
			const interval = count(time, framePhase(isSpinning || motions.length > 0, state), state);
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
		arcadeFrame(time, phase, state) {
			count(time, phase, state);
			lastTime = time;
		},
		work(sample) {
			work[lastPhase].add(sample);
			busy.push(sample.lateMs + sample.tickMs + sample.afterMs);
			spikes.work(sample);
		},
		lates(ms) {
			for (const value of ms) late[lastPhase].push(value);
		},
		longTask(start, duration) {
			spikes.longTask(start, duration);
		},
		pause() {
			lastTime = undefined;
		},
		reset() {
			startedAt = now();
			lastTime = undefined;
			buckets = perPhase(() => new Bucket());
			reel = new Ring();
			reelSteps = 0;
			reelSum = 0;
			reelMax = 0;
			previous = new WeakMap();
			work = perPhase(() => new WorkBucket());
			late = perPhase(() => new Ring());
			busy = new Ring();
			spikes.reset();
		},
		snapshot(): PerfSnapshot {
			const sorted = intervals();
			const common = {
				seconds: Math.round((now() - startedAt) / 1000),
				refreshHz: estimateRefreshHz(sorted),
				capped30: capped30(sorted),
			};
			if (set === 'arcade')
				return {
					set,
					...common,
					menu: buckets.menu.snapshot(),
					play: buckets.play.snapshot(),
					work: { menu: work.menu.snapshot(), play: work.play.snapshot() },
					lateMs: { menu: lateOf(late.menu), play: lateOf(late.play) },
					spikes: spikes.snapshot(threshold),
				};
			const reelSorted = reel.sorted();
			return {
				set,
				...common,
				idle: buckets.idle.snapshot(),
				spinning: buckets.spinning.snapshot(),
				round: buckets.round.snapshot(),
				reel: {
					steps: reelSteps,
					mean: round1(reelSteps ? reelSum / reelSteps : 0),
					p95: round1(quantile(reelSorted, 0.95)),
					max: round1(reelMax),
				},
				work: {
					idle: work.idle.snapshot(),
					spinning: work.spinning.snapshot(),
					round: work.round.snapshot(),
				},
				spikes: spikes.snapshot(threshold),
			};
		},
	};
	return stats as PerfStats<SnapshotOf<S>>;
}
