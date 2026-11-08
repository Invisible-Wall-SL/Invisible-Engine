/**
 * The FRAME CLOCK: a reel's motion sampled at the frame's own timestamp.
 *
 * A reel's strip is a Svelte `Tween`. Svelte's frame callback samples every tween at
 * `performance.now()` when the callback runs, which is the frame's start only if it runs first. In
 * the game it often runs after the Pixi ticker has rendered, so how late it samples depends on how
 * long that frame's render took. For a reel moving at 3–5 px/ms that is tens of px of difference
 * between frames that should step the same: judder at full frame rate.
 *
 * {@link FrameTween} is that same `Tween` — the same `current`, which everything reads and the
 * board draws, updated at the same point in the frame; the same promise, settling on the same
 * frame; the same interruption — with one change: its interpolator samples at the frame's own
 * timestamp, `document.timeline.currentTime`, which the browser fixes for the whole rendering step
 * whatever order its callbacks run in. Every step is then a frame's interval times the speed.
 *
 * Nothing else moves, by design. A reel's position decides which cells exist and when their art
 * starts (a rider's sparkle, a rig's first tick, the particle seeds drawn after them), so a reel
 * drawn ahead of that position — even by a frame — changes what the game draws later. Under
 * `?ie_determinism` the document timeline reads the same virtual clock as `performance.now()`, so a
 * seeded run is identical to plain `Tween`'s, frame for frame. Where there is no document timeline
 * (Node), the sample is `performance.now()`, as `Tween`'s is.
 *
 * No Pixi import: a plain `.ts` module, so a fixture and the Node gates load it without a canvas.
 */

import { untrack } from 'svelte';
import { linear } from 'svelte/easing';
import { Tween } from 'svelte/motion';

export type FrameEasing = (t: number) => number;

/** What a probe reads off a moving reel at render time (`?perf=1`). */
export interface FrameMotionView {
	/** Where this frame draws it. */
	readonly drawn: number;
	/** Every jump a duration-0 `set` made, summed: `drawn - shift` runs on through a relayout. */
	readonly shift: number;
	/** Units per ms of the running segment when it is linear, else `undefined`. */
	readonly rate: number | undefined;
}

/** Called once per Pixi tick, before it renders, with the frame's timestamp and every moving reel. */
export type FrameProbe = (time: number, moving: Iterable<FrameMotionView>) => void;

const moving = new Set<FrameTween>();
let probe: FrameProbe | undefined;

/** The frame's own timestamp, fixed for the whole rendering step; `performance.now()` without one. */
function frameTime(): number {
	const time = typeof document === 'undefined' ? null : document.timeline?.currentTime;
	return typeof time === 'number' ? time : performance.now();
}

/**
 * The Pixi ticker listener (`InitialiseApplication`): hands the probe every moving reel. Inside a
 * listener `ticker.lastTime` is still the previous frame's — Pixi assigns it after its listeners —
 * so this frame's timestamp is `lastTime + elapsedMS`.
 */
export function frameClockTick(ticker: { lastTime: number; elapsedMS: number }): void {
	probe?.(ticker.lastTime + ticker.elapsedMS, moving);
}

/** Read every moving reel once per Pixi tick (`?perf=1`); `undefined` removes it. */
export function setFrameProbe(next: FrameProbe | undefined): void {
	probe = next;
}

type Segment = { from: number; to: number; duration: number; easing: FrameEasing };

/**
 * A Svelte `Tween<number>` sampled at each frame's timestamp (see the module note). Same surface:
 * reactive `current` and `target`; `set(value, { duration, easing })` resolves once `current` arrives,
 * places it at once for `duration: 0`, and never settles if a later `set` cuts it off.
 */
export class FrameTween implements FrameMotionView {
	shift = 0;
	readonly #tween: Tween<number>;
	#segment: Segment | undefined;

	constructor(value: number) {
		this.#tween = new Tween(value);
	}

	get current(): number {
		return this.#tween.current;
	}

	get target(): number {
		return this.#tween.target;
	}

	get drawn(): number {
		return untrack(() => this.#tween.current);
	}

	get rate(): number | undefined {
		const s = this.#segment;
		return s && s.easing === linear ? (s.to - s.from) / s.duration : undefined;
	}

	set(value: number, options: { duration?: number; easing?: FrameEasing } = {}): Promise<void> {
		const duration = options.duration ?? 400;
		const easing = options.easing ?? linear;
		// Read as `Tween` reads its own start value: untracked, so a `set` inside an effect does not
		// make that effect depend on the motion.
		const from = untrack(() => this.#tween.current);
		moving.delete(this);
		this.#segment = undefined;
		if (!(duration > 0)) {
			if (duration === 0) this.shift += value - from;
			return this.#tween.set(value, { duration, easing });
		}
		const segment: Segment = { from, to: value, duration, easing };
		const start = performance.now();
		this.#segment = segment;
		moving.add(this);
		const done = this.#tween.set(value, {
			duration,
			// `Tween` hands the interpolator its own eased progress; this one works out its own, from
			// the frame's timestamp, with the same formula `Tween` uses for numbers.
			easing: linear,
			interpolate: (a, b) => {
				if (a === b || a !== a) return () => a;
				const delta = b - a;
				return () => a + easing(Math.min(1, Math.max(0, (frameTime() - start) / duration))) * delta;
			},
		});
		void done.then(() => {
			if (this.#segment !== segment) return;
			this.#segment = undefined;
			moving.delete(this);
		});
		return done;
	}
}
