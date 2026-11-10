import { RigView, type RigViewProbe } from 'engine-rig/pixi';

/**
 * The `?perf=1` PROBE: what the particles, the baked effects and the rigs did in a frame, and how
 * much JS the frame ran, handed to the readout with the frame's GL work (`glCounters.ts`
 * `instrumentApp`, which turns it on and off). On, each `<ParticleEmitter>` times its
 * `emitter.update`, each `<BakedEffect>` counts the frames it plays, every `RigView` times its
 * updates and mesh rebuilds (`RigView.probe`), and every animation-frame callback is timed with
 * the microtasks it queued ({@link frameJsMs}). Off, an emitter or a baked effect pays one
 * `perfProbe.on` check a frame and a rig one `RigView.probe` check: nothing is timed, counted,
 * wrapped or allocated.
 */

export interface PerfProbeCounts {
	/** Ms inside `emitter.update`, every emitter summed (a rig particle's pose included). */
	particleMs: number;
	/** Live particles after the update, every emitter summed. */
	particles: number;
	/** Emitters emitting or holding live particles. */
	emitters: number;
	/** Emitters (re)started: emission turned on. */
	emitterStarts: number;
	/** Baked effects that played. */
	baked: number;
	/** Ms of rig updates (animation and pose), a rig particle's left to the particles. */
	rigMs: number;
	/** Rig updates. */
	rigs: number;
	/** Ms rebuilding the meshes of the rigs drawn, inside Pixi's render. */
	rigSyncMs: number;
}

export const emptyPerfProbeCounts = (): PerfProbeCounts => ({
	particleMs: 0,
	particles: 0,
	emitters: 0,
	emitterStarts: 0,
	baked: 0,
	rigMs: 0,
	rigs: 0,
	rigSyncMs: 0,
});

export const perfProbe = {
	on: false,
	counts: emptyPerfProbeCounts(),
	/** Inside an emitter's update: a rig updated there is a particle's. */
	inParticles: false,
};

const rigProbe: RigViewProbe = {
	updated(ms) {
		if (perfProbe.inParticles) return;
		perfProbe.counts.rigMs += ms;
		perfProbe.counts.rigs++;
	},
	synced(ms) {
		perfProbe.counts.rigSyncMs += ms;
	},
};

/** JS run by animation-frame callbacks, by the frame they ran for: the latest and the one before. */
const frameJs = { at: Number.NaN, ms: 0, beforeAt: Number.NaN, beforeMs: 0 };
let nativeRequestFrame: typeof requestAnimationFrame | undefined;
let timedRequestFrame: typeof requestAnimationFrame | undefined;

const frameCallbackStarts = (at: number): void => {
	if (at === frameJs.at) return;
	frameJs.beforeAt = frameJs.at;
	frameJs.beforeMs = frameJs.ms;
	frameJs.at = at;
	frameJs.ms = 0;
};

const frameCallbackEnds = (at: number, ms: number): void => {
	if (at === frameJs.at) frameJs.ms += ms;
	else if (at === frameJs.beforeAt) frameJs.beforeMs += ms;
};

/**
 * Every callback the page asks a frame for (Pixi's tickers, Svelte's tweens, the frame clock) runs
 * inside a timer until the microtasks it queued have run: Svelte's effects flush there. Every
 * callback of a frame gets the frame's timestamp, which keys its time.
 */
function timeFrameCallbacks(on: boolean): void {
	if (typeof window === 'undefined') return;
	if (on && !nativeRequestFrame) {
		const native = window.requestAnimationFrame;
		nativeRequestFrame = native;
		timedRequestFrame = (callback) =>
			native.call(window, (at) => {
				frameCallbackStarts(at);
				const start = performance.now();
				try {
					callback(at);
				} finally {
					queueMicrotask(() => frameCallbackEnds(at, performance.now() - start));
				}
			});
		window.requestAnimationFrame = timedRequestFrame;
	} else if (!on && nativeRequestFrame) {
		if (window.requestAnimationFrame === timedRequestFrame)
			window.requestAnimationFrame = nativeRequestFrame;
		nativeRequestFrame = undefined;
		timedRequestFrame = undefined;
	}
}

/** The timestamp of the frame whose callbacks are running (or ran last). */
export const currentFrameAt = (): number => frameJs.at;

/**
 * Ms of JS the frame at `at` ran in its animation-frame callbacks, with their microtasks; known
 * for the latest frame and the one before, once their callbacks have run.
 */
export const frameJsMs = (at: number): number | undefined =>
	at === frameJs.at ? frameJs.ms : at === frameJs.beforeAt ? frameJs.beforeMs : undefined;

export function setPerfProbe(on: boolean): void {
	perfProbe.on = on;
	perfProbe.counts = emptyPerfProbeCounts();
	RigView.probe = on ? rigProbe : undefined;
	timeFrameCallbacks(on);
}

/** The counts since the last call, and a fresh start. */
export function takePerfProbeCounts(): PerfProbeCounts {
	const counts = perfProbe.counts;
	perfProbe.counts = emptyPerfProbeCounts();
	return counts;
}

/** What `probeParticleUpdate` reads off an emitter. */
export interface ProbedEmitter {
	update(seconds: number): void;
	readonly particleCount: number;
	readonly emit: boolean;
}

/** `emitter.update(seconds)`, timed and counted into the frame's particles. */
export function probeParticleUpdate(emitter: ProbedEmitter, seconds: number): void {
	const start = performance.now();
	perfProbe.inParticles = true;
	try {
		emitter.update(seconds);
	} finally {
		perfProbe.inParticles = false;
	}
	const counts = perfProbe.counts;
	counts.particleMs += performance.now() - start;
	counts.particles += emitter.particleCount;
	if (emitter.emit || emitter.particleCount > 0) counts.emitters++;
}
