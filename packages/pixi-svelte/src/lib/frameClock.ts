/**
 * The FRAME CLOCK: a reel's motion, sampled at the frame's own timestamp and DRAWN in that frame.
 *
 * A reel's strip is a Svelte `Tween`. Svelte's frame callback updates it, and in most games that
 * callback runs AFTER the Pixi tick has rendered, so each frame drew the previous frame's position:
 * one frame late, and late by a different amount every time the frame lengths change (a phone at
 * 120 Hz mixes 8.3 and 16.6 ms frames). And a reel's laps are chained segments: each lap stopped on
 * its end for a frame and the next one started late, a short step every lap.
 *
 * A {@link FrameTween} keeps that `Tween` for everything that is LOGIC: its `current`, its promise,
 * when a segment ends, what an interrupted one does, all exactly as before (the tween samples at
 * the frame's timestamp, `document.timeline.currentTime`, as it has since the first version of this
 * module). Beside it, a {@link FrameMotion} says where to DRAW: it is stepped by one
 * animation-frame callback, {@link frameClockPre}, that runs BEFORE the Pixi ticker's in the same
 * frame, at the frame's timestamp, and hands each new value to whoever draws it (the board writes
 * its cells' positions straight onto their containers). Between the two callbacks the browser runs
 * a microtask checkpoint, where Svelte flushes what a new position decides (which cells exist, which
 * are held), so Pixi draws this frame's motion. No `flushSync`.
 *
 * ORDER. `frameClockPre` is requested only from inside a Pixi tick ({@link frameClockTick}, bound
 * by `InitialiseApplication`) or by itself while it runs first. Pixi asks for its next frame at the
 * END of its tick, so the clock's request precedes it and the clock runs right before the Pixi tick
 * in the next frame, whatever order the page's other frame callbacks run in. The first frame of a
 * motion that starts from rest is the exception: nothing has asked for the clock yet, so that frame
 * draws the start value. With no Pixi ticker bound (a story, a tool without an app) the clock drives
 * itself.
 *
 * WHAT IS DRAWN differs from the tween's own value in two ways, neither of which moves an end:
 *  - a segment set with `runOn` (the next one continues the same way: a reel's laps, the long
 *    slide) is drawn past `to` on the frame it ends, where the next one will have it, instead of
 *    stopping there for that frame;
 *  - a segment set in the clock frame a `runOn` predecessor ended in (or one cut off mid-way)
 *    CARRIES on from where that one is drawn, so the strip does not stop for the moment the next
 *    `set()` came late; it still ends on the tween's frame, so it runs at most a frame's time
 *    slower over its length. After a segment that came to rest on its `to` (the last slide before
 *    a bounce) the next starts where the tween starts it.
 * Under `?ie_determinism` both clocks read one virtual clock, so away from those two the drawn
 * value IS the tween's, a frame earlier.
 *
 * No Pixi import: a plain `.ts` module, so a fixture and the Node gates load it without a canvas.
 */

import { untrack } from 'svelte';
import { linear } from 'svelte/easing';
import { Tween } from 'svelte/motion';

export type FrameEasing = (t: number) => number;

export type FrameSetOptions = {
	duration?: number;
	easing?: FrameEasing;
	/** The next segment continues this one the same way: draw past `to` on the frame it ends. */
	runOn?: boolean;
};

/** What a probe reads off a moving value at render time (`?perf=1`). */
export interface FrameMotionView {
	/** The value this frame draws. */
	readonly drawn: number;
	/** Every jump a duration-0 `set` made, summed: `drawn - shift` runs on through a relayout. */
	readonly shift: number;
	/** Units per ms the drawn value moves at when that motion is linear, else `undefined`. */
	readonly rate: number | undefined;
}

/** Called once per Pixi tick, before it renders, with the frame's timestamp and every moving value. */
export type FrameProbe = (time: number, moving: Iterable<FrameMotionView>) => void;

/** Told each new drawn value, as it is made. */
export type FrameDrawnListener = (drawn: number) => void;

/** How long ago a segment may have ended and still be the moment the next one starts from. */
const MAX_CARRY_MS = 250;
/** Two callbacks closer than this belong to one frame (frames are at least ~4 ms apart). */
const SAME_FRAME_MS = 0.5;
/** The step an eased segment's end speed is measured over, in progress. */
const END_SLOPE_STEP = 1e-4;

const active = new Set<FrameMotion>();
let time = -Infinity;
let frame = 0;
let prePending = false;
let boundTickers = 0;
let pixiTickAt = Number.NaN;
let probe: FrameProbe | undefined;
/** What this frame's clock callback stepped, kept only while a probe reads it. */
let stepped: FrameMotion[] | undefined;

/** The frame's own timestamp, fixed for the whole rendering step; `performance.now()` without one. */
function frameTime(): number {
	const now = typeof document === 'undefined' ? null : document.timeline?.currentTime;
	return typeof now === 'number' ? now : performance.now();
}

function requestPre(): void {
	if (prePending || typeof requestAnimationFrame !== 'function') return;
	prePending = true;
	requestAnimationFrame(frameClockPre);
}

/** The clock's animation-frame callback: runs before the Pixi tick of the same frame. */
export function frameClockPre(t: number): void {
	prePending = false;
	// Pixi ticked this frame already (the clock ran late): what it steps is drawn next frame, as
	// before the clock existed, and the next Pixi tick puts the clock back in front.
	const late = Math.abs(t - pixiTickAt) < SAME_FRAME_MS;
	// Anything moving at the start of the frame: a segment ending now is continued after this
	// frame's Pixi tick (in Svelte's callback), so the next frame needs the clock even if none of
	// them is still moving when the Pixi tick asks.
	const moving = active.size > 0;
	if (t > time) {
		time = t;
		frame++;
		stepped = probe ? [...active] : undefined;
		for (const motion of active) motion.step(t);
	}
	if (moving && (!late || boundTickers === 0)) requestPre();
}

/**
 * The Pixi ticker listener (`ticker.add(frameClockTick)` on each app). Inside a listener
 * `ticker.lastTime` is still the PREVIOUS frame's time — Pixi assigns it after its listeners —
 * so this frame's is `lastTime + elapsedMS`.
 */
export function frameClockTick(ticker: { lastTime: number; elapsedMS: number }): void {
	const at = ticker.lastTime + ticker.elapsedMS;
	// A segment that ended in this frame's callback has left `active`, but this frame draws it.
	probe?.(at, Math.abs(at - time) < SAME_FRAME_MS && stepped ? stepped : active);
	pixiTickAt = at;
	if (active.size) requestPre();
}

/** Count a Pixi ticker that calls {@link frameClockTick}; returns the release. */
export function bindFrameClock(): () => void {
	boundTickers++;
	let bound = true;
	return () => {
		if (!bound) return;
		bound = false;
		boundTickers--;
	};
}

/** Read every moving value once per Pixi tick (`?perf=1`); `undefined` removes it. */
export function setFrameProbe(next: FrameProbe | undefined): void {
	probe = next;
}

/** One segment, as `FrameMotion.set` returns it for `arrive`. */
export type FrameSegment = {
	readonly from: number;
	readonly to: number;
	/** `performance.now()` at `set()`, as the tween counts it: the segment ends after `duration`. */
	readonly start: number;
	readonly duration: number;
	/** When the drawn motion begins (`start`, or earlier for a carried segment) and how long. */
	readonly origin: number;
	readonly span: number;
	readonly easing: FrameEasing;
	/** Units per ms it ends at, when it runs on past its end; else `undefined`. */
	readonly runOnRate: number | undefined;
};

/** Units per ms a segment of `easing` ends at, over `span` ms. Exact for `linear`. */
function endRate(easing: FrameEasing, from: number, to: number, span: number): number {
	if (easing === linear) return (to - from) / span;
	const slope = (easing(1) - easing(1 - END_SLOPE_STEP)) / END_SLOPE_STEP;
	return (slope * (to - from)) / span;
}

/**
 * Where a tween's value is DRAWN. Mirrors each `set` of the tween it shadows: `set(from, to, …)`
 * with the tween's value at that moment as `from`; `duration: 0` places it at once; `arrive` when
 * the tween's promise resolves (it reads the time later in the frame, so it can see the end first).
 * Each new drawn value goes to every listener (`listen`).
 */
export class FrameMotion implements FrameMotionView {
	drawn: number;
	shift = 0;
	rate: number | undefined;
	private readonly listeners = new Set<FrameDrawnListener>();
	private segment: FrameSegment | undefined;
	/** The moment the drawn value stands for, and the clock frame it was made in. */
	private valueTime = -Infinity;
	private valueFrame = -1;
	/**
	 * The motion was still under way when it stopped: a `runOn` segment ended, or a segment was cut
	 * off mid-way. Only then does the next segment carry on from it; one that came to rest on its
	 * `to` (the last slide before a bounce) leaves the next to start where the tween starts it.
	 */
	private underWay = false;

	constructor(initial: number) {
		this.drawn = initial;
	}

	/** Tell `listener` every new drawn value from now on; returns the release. */
	listen(listener: FrameDrawnListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	set(from: number, to: number, options: FrameSetOptions = {}): FrameSegment | undefined {
		const duration = options.duration ?? 400;
		// Drawn in the latest clock frame: the strip is moving, and the drawn value (run on past an
		// end, or carried) may stand a little apart from the tween's.
		const live = this.valueFrame === frame;
		if (this.segment) this.underWay = true;
		this.segment = undefined;
		if (!(duration > 0)) {
			active.delete(this);
			this.shift += to - from;
			// A moving strip relaid by the reel (new cells above, moved by the same amount) keeps where
			// it is drawn; one at rest is placed exactly.
			this.write(live ? this.drawn + (to - from) : to);
			return undefined;
		}
		const start = performance.now();
		const carried = live && this.underWay && start - this.valueTime < MAX_CARRY_MS;
		this.underWay = false;
		const origin = carried ? Math.min(this.valueTime, start) : start;
		const easing = options.easing ?? linear;
		const segmentFrom = carried ? this.drawn : from;
		const span = origin === start ? duration : duration + (start - origin);
		const segment: FrameSegment = {
			from: segmentFrom,
			to,
			start,
			duration,
			origin,
			span,
			easing,
			runOnRate: options.runOn ? endRate(easing, segmentFrom, to, span) : undefined,
		};
		this.segment = segment;
		active.delete(this);
		active.add(this);
		if (boundTickers === 0) requestPre();
		return segment;
	}

	/** The tween reached the end of `segment`: so has the drawn value, if the clock had not yet. */
	arrive(segment: FrameSegment | undefined): void {
		if (segment && this.segment === segment) this.end(segment);
	}

	/** One frame of the running segment at the frame's timestamp `t`. */
	step(t: number): void {
		const s = this.segment;
		if (!s) {
			active.delete(this);
			return;
		}
		if (t - s.start > s.duration) {
			this.end(s, s.runOnRate === undefined ? undefined : t);
			return;
		}
		if (t < s.origin) return;
		const progress = s.origin === s.start ? (t - s.start) / s.duration : (t - s.origin) / s.span;
		this.valueTime = t;
		this.valueFrame = frame;
		this.rate = s.easing === linear ? (s.to - s.from) / s.span : undefined;
		this.write(s.from === s.to ? s.from : s.from + s.easing(progress) * (s.to - s.from));
	}

	/** The segment is over: drawn at `to`, or run on past it to the frame time `runOnTo`. */
	private end(s: FrameSegment, runOnTo?: number): void {
		const end = s.start + s.duration;
		this.segment = undefined;
		active.delete(this);
		this.valueTime = runOnTo ?? end;
		this.valueFrame = frame;
		this.underWay = s.runOnRate !== undefined;
		if (runOnTo === undefined) this.rate = undefined;
		this.write(runOnTo === undefined ? s.to : s.to + (s.runOnRate ?? 0) * (runOnTo - end));
	}

	private write(drawn: number): void {
		this.drawn = drawn;
		for (const listener of this.listeners) listener(drawn);
	}
}

/**
 * The reel's Svelte `Tween<number>`, sampled at each frame's timestamp, and its drawn twin. `current`,
 * `target` and the promise `set` returns are the tween's, so the motion logic and everything
 * awaiting it run exactly as before; `motion.drawn` is where to draw it. `FrameTween`
 * (`frameTween.svelte.ts`) adds a reactive `drawn`.
 */
export class FrameTweenCore {
	readonly tween: Tween<number>;
	readonly motion: FrameMotion;

	constructor(value: number) {
		this.tween = new Tween(value);
		this.motion = new FrameMotion(value);
	}

	set(value: number, options: FrameSetOptions = {}): Promise<void> {
		const duration = options.duration ?? 400;
		const easing = options.easing ?? linear;
		// Read as `Tween` reads its own start value: untracked, so a `set` inside an effect does not
		// make that effect depend on the motion.
		const from = untrack(() => this.tween.current);
		const done = this.setTween(value, duration, easing);
		const segment = this.motion.set(from, value, { duration, easing, runOn: options.runOn });
		if (segment) void done.then(() => this.motion.arrive(segment));
		return done;
	}

	private setTween(to: number, duration: number, easing: FrameEasing) {
		if (!(duration > 0)) return this.tween.set(to, { duration, easing });
		const start = performance.now();
		return this.tween.set(to, {
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
	}
}
