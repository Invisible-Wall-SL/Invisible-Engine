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
 *
 * BUSY, NOT FPS (`perf: 10`). A frame's busy time is the main thread's work in it (`lateMs + tickMs
 * + afterMs`): what the game costs whatever the display's rate or a browser's cap does to the frame
 * interval (a device that misses 60 Hz by 1 ms reads 30 fps). Each phase reports it as p50 / p95
 * over the whole reading beside `budgetMs`, the display's frame period, so a reader judges
 * "busy / 16.7 ms", not fps. Frames while the page is hidden are not frames: they are counted in
 * `hiddenFrames` and the wall time hidden in `hiddenMs`, and a visible interval over
 * {@link THROTTLED_MS} is counted in `throttledFrames`: a throttled background tab reads 1000 ms
 * frames, which the launcher marks "not comparable". Every work counter reports its p95 beside its
 * mean and max, and the refresh the old probe called `refreshHz` is `achievedHz` (what the frames
 * ran at) beside `displayHz` (the fastest rate a side rAF loop ever saw, the display's when the page
 * ever idled).
 */

import type { SceneSample } from 'pixi-svelte';
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
/** A visible frame interval over this is a throttled one (a background or a suspended page). */
export const THROTTLED_MS = 250;
/** Samples kept of the side loop that reads the display's rate (about 8 s at 60 Hz). */
const DISPLAY_WINDOW = 500;
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
	/**
	 * Per frame: the mean (to 0.1), the 95th percentile over the whole reading (a log histogram,
	 * within ~2%) and the largest, for every key a frame reported.
	 */
	perFrame: Partial<Record<WorkKey, { mean: number; p95: number; max: number }>>;
};

/** How late an online arcade game's room states arrived (`arcadePerf.ts` `lates`), ms. */
export type LateSnapshot = { count: number; p50: number; p95: number; max: number };

/** A phase's busy time per frame (`lateMs + tickMs + afterMs`), over the whole reading. */
export type BusySnapshot = { frames: number; p50: number; p95: number; max: number };

/** A value sampled a few times a reading (a GPU timer query, ms): its spread, per phase. */
export type SampleSnapshot = LateSnapshot;

type CommonSnapshot = {
	seconds: number;
	/** The rate the frames ran at (the 10th-percentile interval, snapped): the achieved rate. */
	achievedHz: number | undefined;
	/** The fastest rate rAF ever ran at, from a side loop: the display's when the page ever idled. */
	displayHz: number | undefined;
	/** The frame period busy time is judged against, ms: the display's (60 Hz at least), or 30 Hz's. */
	budgetMs: number;
	/** Wall time the page was hidden, ms, and the frames that still came while it was. */
	hiddenMs: number;
	hiddenFrames: number;
	/** Visible frames whose interval was over {@link THROTTLED_MS}. */
	throttledFrames: number;
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
	busy: Record<SlotPhase, BusySnapshot>;
	/** GPU time per frame where the browser offers a timer query; absent otherwise. */
	gpuMs?: Record<SlotPhase, SampleSnapshot>;
};

export type ArcadeSnapshot = CommonSnapshot & {
	set: 'arcade';
	/** A level mounting and settling: its mount, its first ticked frame and the second after it. */
	loading: PerfBucketSnapshot;
	/** The field not playing: a title, a lobby, a countdown, a win screen. */
	lobby: PerfBucketSnapshot;
	/** The field playing: the loop moving bodies, the online room running with the player in it. */
	play: PerfBucketSnapshot;
	/** The online room running with the player out of it, watching. */
	spectate: PerfBucketSnapshot;
	work: Record<ArcadePhase, WorkSnapshot>;
	busy: Record<ArcadePhase, BusySnapshot>;
	lateMs: Record<ArcadePhase, LateSnapshot>;
	/** GPU time per frame where the browser offers a timer query; absent otherwise. */
	gpuMs?: Record<ArcadePhase, SampleSnapshot>;
	/** Where the scene's cost sits, sampled every {@link SCENE_EVERY} frames; absent when none was. */
	scene?: SceneSummary;
};

export type PerfSnapshot = SlotSnapshot | ArcadeSnapshot;

/** Layers kept in a scene summary (the first seen). */
const SCENE_LAYERS_KEPT = 12;

export type SceneLayerSummary = {
	label: string;
	/** Means over the samples. */
	nodes: number;
	renderables: number;
	visible: number;
	culled: number;
	/** The layer is its own render group: its draws and passes are exact (`sceneProbe.ts`). */
	renderGroup: boolean;
	draws?: number;
	passes?: number;
	filterPasses?: number;
	targetSwitches?: number;
};

/** The scene samples of a reading: the latest, and the means by layer. */
export type SceneSummary = {
	samples: number;
	latest: SceneSample;
	/** Means over the samples; `walkMs` is what walking the tree took (outside the busy time). */
	mean: { nodes: number; renderables: number; visible: number; culled: number; walkMs: number };
	layers: SceneLayerSummary[];
	/** The stage's own draws and passes (what no render-group layer accounts for), means. */
	rest: { draws: number; passes: number; filterPasses: number; targetSwitches: number };
};

class SceneAgg {
	private samples = 0;
	private latest: SceneSample | undefined;
	private readonly sum = { nodes: 0, renderables: 0, visible: 0, culled: 0, walkMs: 0 };
	private readonly rest = { draws: 0, passes: 0, filterPasses: 0, targetSwitches: 0 };
	private readonly layers = new Map<
		string,
		{ n: number; sums: Record<string, number>; renderGroup: boolean; cost: number }
	>();
	add(sample: SceneSample): void {
		this.samples++;
		this.latest = sample;
		for (const key of Object.keys(this.sum) as (keyof typeof this.sum)[])
			this.sum[key] += sample[key];
		for (const key of Object.keys(this.rest) as (keyof typeof this.rest)[])
			this.rest[key] += sample.rest?.[key] ?? 0;
		for (const layer of sample.layers) {
			let entry = this.layers.get(layer.label);
			if (!entry) {
				if (this.layers.size >= SCENE_LAYERS_KEPT) continue;
				entry = { n: 0, sums: {}, renderGroup: layer.renderGroup, cost: 0 };
				this.layers.set(layer.label, entry);
			}
			entry.n++;
			for (const key of ['nodes', 'renderables', 'visible', 'culled'] as const)
				entry.sums[key] = (entry.sums[key] ?? 0) + layer[key];
			if (layer.cost) {
				entry.cost++;
				for (const key of ['draws', 'passes', 'filterPasses', 'targetSwitches'] as const)
					entry.sums[key] = (entry.sums[key] ?? 0) + layer.cost[key];
			}
		}
	}
	summary(): SceneSummary | undefined {
		if (!this.latest) return undefined;
		const mean = (n: number, count = this.samples) => round1(n / count);
		return {
			samples: this.samples,
			latest: this.latest,
			mean: {
				nodes: mean(this.sum.nodes),
				renderables: mean(this.sum.renderables),
				visible: mean(this.sum.visible),
				culled: mean(this.sum.culled),
				walkMs: mean(this.sum.walkMs),
			},
			layers: [...this.layers].map(([label, e]): SceneLayerSummary => {
				const cost = e.cost
					? {
							draws: mean(e.sums.draws ?? 0, e.cost),
							passes: mean(e.sums.passes ?? 0, e.cost),
							filterPasses: mean(e.sums.filterPasses ?? 0, e.cost),
							targetSwitches: mean(e.sums.targetSwitches ?? 0, e.cost),
						}
					: {};
				return {
					label,
					nodes: mean(e.sums.nodes, e.n),
					renderables: mean(e.sums.renderables, e.n),
					visible: mean(e.sums.visible, e.n),
					culled: mean(e.sums.culled, e.n),
					renderGroup: e.renderGroup,
					...cost,
				};
			}),
			rest: {
				draws: mean(this.rest.draws),
				passes: mean(this.rest.passes),
				filterPasses: mean(this.rest.filterPasses),
				targetSwitches: mean(this.rest.targetSwitches),
			},
		};
	}
}

class Ring {
	private values: number[] = [];
	private next = 0;
	constructor(private readonly capacity = WINDOW) {}
	push(value: number): void {
		if (this.values.length < this.capacity) this.values.push(value);
		else this.values[this.next] = value;
		this.next = (this.next + 1) % this.capacity;
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

/**
 * Every value of a whole reading in log-spaced buckets (each {@link HIST_RATIO} wider than the one
 * before, from {@link HIST_MIN}), so a percentile over minutes of frames costs a fixed few KB and
 * lands within ~2% of the true one. The ring a `Bucket` keeps is the last {@link WINDOW} frames.
 */
const HIST_MIN = 0.01;
const HIST_RATIO = 1.04;
const HIST_BUCKETS = Math.ceil(Math.log(1e10) / Math.log(HIST_RATIO));
class Histogram {
	private readonly counts = new Uint32Array(HIST_BUCKETS + 1);
	n = 0;
	add(value: number): void {
		this.n++;
		this.counts[
			value <= HIST_MIN
				? 0
				: Math.min(HIST_BUCKETS, 1 + Math.floor(Math.log(value / HIST_MIN) / Math.log(HIST_RATIO)))
		]++;
	}
	/** The value a share `q` of the samples are at or under: a bucket's middle (0 for the first). */
	quantile(q: number): number {
		if (!this.n) return 0;
		const rank = Math.min(this.n, Math.floor(q * this.n) + 1);
		let seen = 0;
		for (let i = 0; i <= HIST_BUCKETS; i++) {
			seen += this.counts[i];
			if (seen >= rank) return i === 0 ? 0 : HIST_MIN * HIST_RATIO ** (i - 0.5);
		}
		return 0;
	}
}

class WorkBucket {
	frames = 0;
	private readonly sum: Partial<Record<WorkKey, number>> = {};
	private readonly max: Partial<Record<WorkKey, number>> = {};
	private readonly spread: Partial<Record<WorkKey, Histogram>> = {};
	add(work: PerfFrameWork): void {
		this.frames++;
		for (const key of BUCKET_KEYS) {
			const value = work[key];
			if (typeof value !== 'number' || !Number.isFinite(value)) continue;
			this.sum[key] = (this.sum[key] ?? 0) + value;
			this.max[key] = Math.max(this.max[key] ?? 0, value);
			(this.spread[key] ??= new Histogram()).add(value);
		}
	}
	snapshot(): WorkSnapshot {
		const perFrame: WorkSnapshot['perFrame'] = {};
		for (const key of BUCKET_KEYS) {
			const sum = this.sum[key];
			if (sum === undefined) continue;
			const max = this.max[key] ?? 0;
			perFrame[key] = {
				mean: round1(sum / this.frames),
				// A bucket's middle can sit above the largest value it holds.
				p95: round1(Math.min(max, this.spread[key]?.quantile(0.95) ?? 0)),
				max: round1(max),
			};
		}
		return { frames: this.frames, perFrame };
	}
}

/** A phase's busy time over the whole reading. */
class BusyBucket {
	private readonly spread = new Histogram();
	private max = 0;
	add(ms: number): void {
		if (!Number.isFinite(ms) || ms < 0) return;
		this.spread.add(ms);
		this.max = Math.max(this.max, ms);
	}
	snapshot(): BusySnapshot {
		return {
			frames: this.spread.n,
			p50: round1(Math.min(this.max, this.spread.quantile(0.5))),
			p95: round1(Math.min(this.max, this.spread.quantile(0.95))),
			max: round1(this.max),
		};
	}
}

/** rAF never ran faster than ~30 fps over these (sorted) intervals: a cap, if the work fit. */
const isCapped30 = (sorted: number[]) =>
	sorted.length >= 60 && quantile(sorted, 0.1) >= 30 && quantile(sorted, 0.5) <= 36;

/** The rate a frame interval is, snapped to a real display rate within 8%. */
function rateOf(intervalMs: number): number | undefined {
	if (!(intervalMs > 0)) return undefined;
	const hz = 1000 / intervalMs;
	const nearest = REFRESH_HZ.reduce((a, b) => (Math.abs(b - hz) < Math.abs(a - hz) ? b : a));
	return Math.abs(nearest - hz) / nearest <= 0.08 ? nearest : Math.round(hz);
}

/** The rate the shortest intervals point at (the 10th percentile), snapped to a real one. */
export function estimateRefreshHz(intervals: number[]): number | undefined {
	if (intervals.length < 30) return undefined;
	return rateOf(
		quantile(
			[...intervals].sort((a, b) => a - b),
			0.1,
		),
	);
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
	/**
	 * One Pixi tick of an arcade game: its frame timestamp, the phase the last tick was in and the
	 * room's phase (the spike records' state).
	 */
	arcadeFrame(time: number, phase: ArcadePhase, state?: string): void;
	/** What the frame just over did; it counts where that frame's interval did. */
	work(sample: PerfFrameWork): void;
	/** An online arcade game's room states since the last frame: how late each arrived, ms. */
	lates(ms: readonly number[]): void;
	/** A long task (Chrome's `longtask` entries), for the spike records. */
	longTask(start: number, duration: number): void;
	/** A tick's GPU time, ms (a timer query, read a few frames late), in the phase it is read in. */
	gpuTime(ms: number): void;
	/** A scene sample (`sceneProbe.ts`), every ~30 frames. */
	scene(sample: SceneSample): void;
	/**
	 * One tick of a side rAF loop that only reads the display's rate: its timestamp. Not cleared by
	 * Reset (it is the display's, not a slice of frames).
	 */
	displayFrame(time: number): void;
	/** The page was hidden: the frames from now are not frames until {@link resume}. */
	pause(): void;
	/** The page is visible again: the wall time since {@link pause} is `hiddenMs`. */
	resume(): void;
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
	let gpu = perPhase(() => new Ring());
	/** Busy time per phase over the whole reading, and recent frames' for the 30 fps cap check. */
	let busy = perPhase(() => new BusyBucket());
	let recentBusy = new Ring();
	let lastPhase: PerfPhase = phases[0];
	let hidden = false;
	let hiddenAt = 0;
	let hiddenMs = 0;
	let hiddenFrames = 0;
	let throttledFrames = 0;
	let scenes = new SceneAgg();
	let lastDisplay: number | undefined;
	const display = new Ring(DISPLAY_WINDOW);
	const spikes = createSpikeRecorder(phases);
	let framesSeen = 0;
	let threshold = spikeThresholdMs(displayPeriodMs(undefined, false));
	const intervals = () =>
		phases.flatMap((phase) => buckets[phase].intervals()).sort((a, b) => a - b);
	const capped30 = (sorted: number[]) => {
		if (!isCapped30(sorted)) return false;
		const frames = recentBusy.sorted();
		return !frames.length || quantile(frames, 0.5) < (CAP_BUSY_SHARE * 1000) / 60;
	};
	/** The fastest rate the side loop saw: its 2nd-percentile interval, snapped to a real rate. */
	const displayHz = (): number | undefined => {
		const sorted = display.sorted();
		if (sorted.length < 60) return undefined;
		return rateOf(quantile(sorted, 0.02));
	};

	const count = (time: number, phase: PerfPhase, state: string | undefined) => {
		const interval = lastTime === undefined ? undefined : time - lastTime;
		if (hidden) {
			hiddenFrames++;
			return undefined;
		}
		lastPhase = phase;
		if (++framesSeen % THRESHOLD_EVERY === 0) {
			const sorted = intervals();
			threshold = spikeThresholdMs(displayPeriodMs(estimateRefreshHz(sorted), capped30(sorted)));
		}
		if (interval !== undefined && interval > 0) {
			buckets[phase].add(interval);
			if (interval > THROTTLED_MS) throttledFrames++;
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
			spikes.work(sample);
			if (hidden) return;
			work[lastPhase].add(sample);
			const ms = sample.lateMs + sample.tickMs + sample.afterMs;
			busy[lastPhase].add(ms);
			recentBusy.push(ms);
		},
		lates(ms) {
			if (hidden) return;
			for (const value of ms) late[lastPhase].push(value);
		},
		longTask(start, duration) {
			spikes.longTask(start, duration);
		},
		gpuTime(ms) {
			if (!hidden) gpu[lastPhase].push(ms);
		},
		scene(sample) {
			if (!hidden) scenes.add(sample);
		},
		displayFrame(time) {
			const interval = lastDisplay === undefined ? undefined : time - lastDisplay;
			lastDisplay = time;
			// A hidden or suspended page's gap is not the display's period.
			if (interval !== undefined && interval > 0 && interval <= THROTTLED_MS)
				display.push(interval);
		},
		pause() {
			if (!hidden) {
				hidden = true;
				hiddenAt = now();
			}
			lastTime = undefined;
		},
		resume() {
			if (hidden) {
				hidden = false;
				hiddenMs += Math.max(0, now() - hiddenAt);
			}
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
			gpu = perPhase(() => new Ring());
			busy = perPhase(() => new BusyBucket());
			recentBusy = new Ring();
			hiddenAt = now();
			hiddenMs = 0;
			hiddenFrames = 0;
			throttledFrames = 0;
			scenes = new SceneAgg();
			spikes.reset();
		},
		snapshot(): PerfSnapshot {
			const sorted = intervals();
			const capped = capped30(sorted);
			const shown = displayHz();
			const hiddenNow = hidden ? Math.max(0, now() - hiddenAt) : 0;
			const common = {
				seconds: Math.round((now() - startedAt) / 1000),
				achievedHz: estimateRefreshHz(sorted),
				displayHz: shown,
				budgetMs: round1(displayPeriodMs(shown, capped)),
				capped30: capped,
				hiddenMs: Math.round(hiddenMs + hiddenNow),
				hiddenFrames,
				throttledFrames,
			};
			const gpuOf = () =>
				phases.some((phase) => gpu[phase].sorted().length)
					? { gpuMs: Object.fromEntries(phases.map((phase) => [phase, lateOf(gpu[phase])])) }
					: {};
			const scene = scenes.summary();
			if (set === 'arcade')
				return {
					set,
					...common,
					loading: buckets.loading.snapshot(),
					lobby: buckets.lobby.snapshot(),
					play: buckets.play.snapshot(),
					spectate: buckets.spectate.snapshot(),
					work: Object.fromEntries(phases.map((p) => [p, work[p].snapshot()])),
					busy: Object.fromEntries(phases.map((p) => [p, busy[p].snapshot()])),
					lateMs: Object.fromEntries(phases.map((p) => [p, lateOf(late[p])])),
					...gpuOf(),
					...(scene ? { scene } : {}),
					spikes: spikes.snapshot(threshold),
				} as ArcadeSnapshot;
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
				busy: {
					idle: busy.idle.snapshot(),
					spinning: busy.spinning.snapshot(),
					round: busy.round.snapshot(),
				},
				...gpuOf(),
				spikes: spikes.snapshot(threshold),
			} as SlotSnapshot;
		},
	};
	return stats as PerfStats<SnapshotOf<S>>;
}
