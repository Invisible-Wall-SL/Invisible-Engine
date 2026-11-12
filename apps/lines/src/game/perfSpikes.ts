/**
 * SPIKE RECORDS for the `?perf=1` readout (`PerfHud.svelte`, fed through `perfStats.ts`): each
 * frame whose interval is a spike, what the frame before it and the frame itself did (`pixi-svelte`
 * `glCounters.ts` `FrameWork`, with its particle and rig probe), and a likely cause. Plain functions
 * over the frame feed, so a fixture drives them without a canvas (`perfSpikes.fixture.ts`).
 *
 * WHICH FRAME. A frame's interval runs back to the previous frame's timestamp, and what ran inside
 * it is the PREVIOUS frame's work: its callbacks and tick (which started at that timestamp), the
 * main thread's work after them, then the wait for the next frame. So the cause is read off `prev`;
 * the frame itself (`cur`) is kept beside it, and arrives a frame later (its tick has to end first).
 *
 * JS, NOT BUSY. The main thread can be busy without running our JS: in the browser's style, layout,
 * paint and frame commit, and the commit WAITS while the GPU is behind (headless Chrome drawing on
 * the CPU shows ~140 ms of it after every tick, gone into the GPU wait under `?perfgpu=1`). So the
 * rules read the frame's JS (`jsMs`: every animation-frame callback with its microtasks), and the
 * rest of the busy time is reported as the browser's.
 *
 * THE CAUSE ({@link classifySpike}, in this order; the thresholds are {@link SPIKE_RULES}):
 * 1. `first use`: `prev` or `cur` compiled a shader or uploaded over ~1 MB of texture data. First
 *    uses come in runs (a new effect's programs, then its textures), so either side marks one.
 * 2. When the frame's JS took ≥ 60% of the interval, its biggest part: `particles`
 *    (`emitter.update`) or `rigs` (updates and mesh rebuilds) when that part is also ≥ 40% of the
 *    JS; else `churn` when the frame built and destroyed many display objects, or inserted and
 *    removed many of Svelte's DOM anchors (`pixi-svelte` `churnProbe.ts`: mounting and unmounting
 *    components, the JS that costs JavaScriptCore most); else `page JS` when more of it ran outside
 *    the Pixi tick (Svelte's effects and tweens, the frame clock) than in the tick's own code and
 *    render; else `game code` (the rest of the tick).
 * 3. `GC (likely)`: the JS heap fell by over ~5 MB across the interval. Only where the browser
 *    reports the heap (Chrome's `performance.memory`, and precisely only on desktop: a phone's
 *    Chrome rounds it and refreshes it rarely, so it reads no drop there).
 * 4. `outside the game`: the JS took < 40% of the interval, so the frame waited on the GPU, the
 *    compositor, the browser's own work or another task. Safari tells none of these apart (no long
 *    tasks, no heap): read `?perfgpu=1` and the switches for which. The reason says how long the
 *    main thread was busy outside the JS, if long.
 * 5. `mixed`: JS for 40–60% of it, no part above.
 * Chrome's long tasks (≥ 50 ms of the main thread, a long frame included) that overlap the interval
 * are given beside, as a check: a long task over most of the interval with little JS or browser time
 * seen means the main thread was busy before the frame's callbacks began.
 */

import type { FrameWork } from 'pixi-svelte';

export const SPIKE_RULES = {
	/** A spike is longer than this and than `periods` display frames. */
	minMs: 33,
	periods: 2.5,
	/** Records kept: the latest. */
	keep: 30,
	/** First use: more texture data than this uploaded by a frame, bytes. */
	uploadBytes: 1e6,
	/** The frame's JS for at least this share of the interval made the spike… */
	jsShare: 0.6,
	/** …and for less than this share did not. */
	outsideShare: 0.4,
	/** Particles or rigs: the largest part and at least this share of the frame's JS. */
	partShare: 0.4,
	/** The main thread busy outside the JS for this share of the interval is named in the reason. */
	browserShare: 0.4,
	/** GC: the heap fell by more than this, MB. */
	gcDropMb: 5,
	/** Churn: the frame built and destroyed at least this many display objects, rigs included… */
	churnObjects: 60,
	/** …or inserted and removed at least this many DOM nodes beside the canvas. */
	churnDomNodes: 300,
	/** Long tasks remembered, to measure their overlap with the kept spikes. */
	longTasks: 200,
} as const;

export const SPIKE_CAUSES = [
	'first use',
	'particles',
	'rigs',
	'churn',
	'page JS',
	'game code',
	'GC (likely)',
	'outside the game',
	'mixed',
] as const;

export type SpikeCause = (typeof SPIKE_CAUSES)[number];

export type SpikeCauseCounts = Partial<Record<SpikeCause, number>>;

/**
 * Where a frame was: `spinning` (a reel moving), `round` (in a round with every reel at rest: the
 * win presentation, a feature's screens and banners) or `idle`.
 */
export type PerfPhase = 'idle' | 'spinning' | 'round';

export const PERF_PHASES = ['idle', 'spinning', 'round'] as const satisfies readonly PerfPhase[];

/** A frame's work in the records: ms to 0.1, upload in KB, zero fields left out. */
export type SpikeFrame = Partial<Record<(typeof COMPACT)[number][1], number>>;

export type SpikeRecord = {
	/** Seconds since Reset. */
	at: number;
	/** The interval, ms. */
	ms: number;
	spin?: true;
	/** In a round with the reels at rest. */
	round?: true;
	/** The game's state machine at the frame. */
	state?: string;
	cause: SpikeCause;
	/** The numbers the cause was read from. */
	why: string;
	/** The frame before: its work ran inside the interval. */
	prev: SpikeFrame;
	/** The frame itself, once its tick has run. */
	cur?: SpikeFrame;
	/** Chrome: long tasks overlapping the interval, ms. */
	longtask?: number;
	/** Chrome: how far the JS heap fell across it, MB. */
	heapDropMb?: number;
};

export type SpikeSummary = {
	/** Frames longer than this are spikes, ms. */
	overMs: number;
	records: SpikeRecord[];
	causes: Record<PerfPhase, SpikeCauseCounts>;
};

/** [`FrameWork` key, record key, kept as a whole number]. */
const COMPACT = [
	['lateMs', 'late', false],
	['tickMs', 'tick', false],
	['renderMs', 'render', false],
	['afterMs', 'after', false],
	['jsMs', 'js', false],
	['gpuWaitMs', 'gpuWait', false],
	['particleMs', 'particleMs', false],
	['particles', 'particles', true],
	['emitters', 'emitters', true],
	['emitterStarts', 'starts', true],
	['baked', 'baked', true],
	['rigMs', 'rigMs', false],
	['rigSyncMs', 'rigSyncMs', false],
	['rigs', 'rigs', true],
	['compiles', 'compiles', true],
	['uploadBytes', 'uploadKb', true],
	['draws', 'draws', true],
	['created', 'made', true],
	['destroyed', 'freed', true],
	['rigsBuilt', 'rigsBuilt', true],
	['rigsDestroyed', 'rigsFreed', true],
	['textRenders', 'texts', true],
	['textMs', 'textMs', false],
	['domAdded', 'domAdded', true],
	['domRemoved', 'domRemoved', true],
] as const satisfies readonly (readonly [keyof FrameWork, string, boolean])[];

const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (part: number, of: number) => `${Math.round((part / of) * 100)}%`;

/**
 * The display's frame period: at least 60 Hz's (a device that cannot keep up reads its own slow
 * rate, not the display's), or 30 Hz's when the browser caps the frame rate there.
 */
export function displayPeriodMs(refreshHz: number | undefined, capped30: boolean): number {
	return capped30 ? 1000 / 30 : 1000 / Math.max(60, refreshHz ?? 60);
}

export const spikeThresholdMs = (periodMs: number): number =>
	Math.max(SPIKE_RULES.minMs, SPIKE_RULES.periods * periodMs);

/**
 * A frame's JS in parts that add up to it, and the main thread's time outside it. Rigs update on
 * Pixi's shared ticker, outside the app's tick, and rebuild their meshes inside its render.
 */
export function spikeParts(w: FrameWork) {
	const js = Math.max(w.jsMs, w.tickMs);
	return {
		js,
		particles: w.particleMs,
		rigs: w.rigMs + w.rigSyncMs,
		render: Math.max(0, w.renderMs - w.rigSyncMs),
		tick: Math.max(0, w.tickMs - w.renderMs - w.particleMs),
		page: Math.max(0, js - w.tickMs - w.rigMs),
		browser: Math.max(0, w.lateMs + w.tickMs + w.afterMs - js),
	};
}

const KIND_NAMES = [
	['Containers', 'containers'],
	['Sprites', 'sprites'],
	['Particles', 'particles'],
	['Texts', 'texts'],
	['Graphics', 'graphics'],
	['Meshes', 'meshes'],
	['Other', 'other views'],
] as const;

/** The display objects and DOM nodes a frame churned. */
export function churnOf(w: FrameWork) {
	return { objects: w.created + w.destroyed, dom: w.domAdded + w.domRemoved };
}

/** What a frame built and threw away, for a reason: the totals and the kind most of it was. */
export function churnReason(w: FrameWork): string {
	let top: [string, number] | undefined;
	for (const [kind, name] of KIND_NAMES) {
		const n = w[`created${kind}`] + w[`destroyed${kind}`];
		if (n && (!top || n > top[1])) top = [name, n];
	}
	const parts = [
		`built ${w.created}, destroyed ${w.destroyed} objects` + (top ? ` (${top[0]} ${top[1]})` : ''),
		...(w.rigsBuilt + w.rigsDestroyed
			? [`rigs ${w.rigsBuilt} built, ${w.rigsDestroyed} destroyed`]
			: []),
		...(w.domAdded + w.domRemoved ? [`DOM ${w.domAdded} in, ${w.domRemoved} out`] : []),
		...(w.textRenders ? [`${w.textRenders} text renders ${round1(w.textMs)} ms`] : []),
	];
	return parts.join(', ');
}

export type SpikeInput = {
	intervalMs: number;
	prev: FrameWork;
	cur?: FrameWork;
	heapDropMb?: number;
};

/** The likely cause of a spike, and the numbers it was read from (rules: the module comment). */
export function classifySpike({ intervalMs, prev, cur, heapDropMb }: SpikeInput): {
	cause: SpikeCause;
	why: string;
} {
	const frames = cur ? [prev, cur] : [prev];
	if (frames.some((w) => w.compiles > 0 || w.uploadBytes > SPIKE_RULES.uploadBytes)) {
		const compiles = frames.reduce((n, w) => n + w.compiles, 0);
		const mb = frames.reduce((n, w) => n + w.uploadBytes, 0) / 1e6;
		return { cause: 'first use', why: `${compiles} compiles, ${round1(mb)} MB uploaded` };
	}
	const p = spikeParts(prev);
	const js = `JS ${pct(p.js, intervalMs)} of it`;
	if (p.js >= SPIKE_RULES.jsShare * intervalMs) {
		const largest = Math.max(p.particles, p.rigs, p.render, p.tick, p.page);
		const leads = (part: number) => part === largest && part >= SPIKE_RULES.partShare * p.js;
		if (leads(p.particles))
			return { cause: 'particles', why: `${js}, particles ${pct(p.particles, p.js)} of that` };
		if (leads(p.rigs)) return { cause: 'rigs', why: `${js}, rigs ${pct(p.rigs, p.js)} of that` };
		const churn = churnOf(prev);
		if (churn.objects >= SPIKE_RULES.churnObjects || churn.dom >= SPIKE_RULES.churnDomNodes)
			return { cause: 'churn', why: `${js}, ${churnReason(prev)}` };
		if (p.page > p.tick + p.render)
			return { cause: 'page JS', why: `${js}, ${round1(p.page)} ms outside the Pixi tick` };
		return {
			cause: 'game code',
			why: `${js}, tick code ${round1(p.tick)} ms, render ${round1(p.render)} ms`,
		};
	}
	const browser =
		p.browser >= SPIKE_RULES.browserShare * intervalMs
			? `, main thread busy ${round1(p.browser)} ms outside JS (browser or GPU wait)`
			: '';
	if (heapDropMb !== undefined && heapDropMb > SPIKE_RULES.gcDropMb)
		return { cause: 'GC (likely)', why: `heap fell ${round1(heapDropMb)} MB, ${js}${browser}` };
	if (p.js < SPIKE_RULES.outsideShare * intervalMs)
		return { cause: 'outside the game', why: `${js}${browser}` };
	return { cause: 'mixed', why: `${js}${browser}` };
}

/** A frame's work as a record keeps it. */
export function compactFrame(w: FrameWork): SpikeFrame {
	const out: SpikeFrame = {};
	for (const [key, name, whole] of COMPACT) {
		const raw = w[key];
		if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
		const value = name === 'uploadKb' ? Math.round(raw / 1000) : whole ? raw : round1(raw);
		if (value) out[name] = value;
	}
	return out;
}

type StateLike = string | { [key: string]: StateLike | undefined };

/** An xstate state value as one line: `bet`, `bet.spinning`. */
export function stateLabel(value: StateLike): string {
	if (typeof value === 'string') return value;
	return Object.entries(value)
		.map(([key, inner]) => (inner ? `${key}.${stateLabel(inner)}` : key))
		.join(',');
}

type Spike = {
	at: number;
	start: number;
	end: number;
	ms: number;
	phase: PerfPhase;
	state?: string;
	prev: FrameWork;
	/** The heap at the start of `prev`. */
	heapBefore?: number;
	cur?: FrameWork;
};

const heapDrop = (s: Spike): number | undefined => {
	const after = [s.prev.heapMb, s.cur?.heapMb].filter((v): v is number => v !== undefined);
	return s.heapBefore === undefined || !after.length
		? undefined
		: Math.max(0, s.heapBefore - Math.min(...after));
};

const verdict = (s: Spike) =>
	classifySpike({ intervalMs: s.ms, prev: s.prev, cur: s.cur, heapDropMb: heapDrop(s) });

const noCauses = (): Record<PerfPhase, SpikeCauseCounts> => ({ idle: {}, spinning: {}, round: {} });

export function createSpikeRecorder() {
	let spikes: Spike[] = [];
	let counts = noCauses();
	/** The latest spike, waiting for its own frame's work. */
	let open: Spike | undefined;
	/** The latest frame's work, and the heap at its start (the frame before's end). */
	let last: FrameWork | undefined;
	let heapAtLast: number | undefined;
	let longTasks: { start: number; end: number }[] = [];

	const tally = (into: typeof counts, s: Spike) => {
		const bucket = into[s.phase];
		const { cause } = verdict(s);
		bucket[cause] = (bucket[cause] ?? 0) + 1;
	};

	return {
		/**
		 * A frame at `time`, `intervalMs` after the one before, in `phase`; a spike over
		 * `thresholdMs`. `at` is its seconds since Reset. A spike before any frame's work has come in
		 * is not recorded.
		 */
		frame(
			time: number,
			intervalMs: number,
			thresholdMs: number,
			phase: PerfPhase,
			state: string | undefined,
			at: number,
		): void {
			if (!(intervalMs > thresholdMs) || !last) return;
			if (open) tally(counts, open);
			open = {
				at,
				start: time - intervalMs,
				end: time,
				ms: intervalMs,
				phase,
				state,
				prev: last,
				heapBefore: heapAtLast,
			};
			spikes.push(open);
			if (spikes.length > SPIKE_RULES.keep) spikes.shift();
		},
		/** One frame's work, handed over once its frame is over. */
		work(sample: FrameWork): void {
			if (open) {
				open.cur = sample;
				tally(counts, open);
				open = undefined;
			}
			heapAtLast = last?.heapMb;
			last = sample;
		},
		/** A long task (Chrome), as its observer reports it. */
		longTask(start: number, duration: number): void {
			longTasks.push({ start, end: start + duration });
			if (longTasks.length > SPIKE_RULES.longTasks) longTasks.shift();
		},
		reset(): void {
			spikes = [];
			counts = noCauses();
			open = undefined;
			longTasks = [];
		},
		snapshot(thresholdMs: number): SpikeSummary {
			const causes = {
				idle: { ...counts.idle },
				spinning: { ...counts.spinning },
				round: { ...counts.round },
			};
			if (open) tally(causes, open);
			const records = spikes.map((s): SpikeRecord => {
				const { cause, why } = verdict(s);
				const overlap = longTasks.reduce(
					(ms, t) => ms + Math.max(0, Math.min(t.end, s.end) - Math.max(t.start, s.start)),
					0,
				);
				const drop = heapDrop(s);
				return {
					at: s.at,
					ms: round1(s.ms),
					...(s.phase === 'spinning' ? { spin: true as const } : {}),
					...(s.phase === 'round' ? { round: true as const } : {}),
					...(s.state ? { state: s.state } : {}),
					cause,
					why,
					prev: compactFrame(s.prev),
					...(s.cur ? { cur: compactFrame(s.cur) } : {}),
					...(overlap > 0 ? { longtask: round1(overlap) } : {}),
					...(drop ? { heapDropMb: round1(drop) } : {}),
				};
			});
			return { overMs: round1(thresholdMs), records, causes };
		},
	};
}

export type SpikeRecorder = ReturnType<typeof createSpikeRecorder>;

/** The most common cause, with its count. */
export function topCause(causes: SpikeSummary['causes']): [SpikeCause, number] | undefined {
	let top: [SpikeCause, number] | undefined;
	for (const cause of SPIKE_CAUSES) {
		const n = PERF_PHASES.reduce((sum, phase) => sum + (causes[phase][cause] ?? 0), 0);
		if (n && (!top || n > top[1])) top = [cause, n];
	}
	return top;
}
