/**
 * The FRAME CLOCK: a moving value DRAWN at the frame's own timestamp, in that same frame.
 *
 * Svelte's `Tween` runs on Svelte's own animation-frame callback and samples `performance.now()`
 * when that callback runs, not the frame's timestamp. In the game that callback runs AFTER the
 * Pixi ticker has rendered, so for a reel moving at 3–5 px/ms a frame draws the position sampled
 * during the previous frame, late by however long the previous render took, which changes every
 * frame: steps that should all be `interval × speed` vary by tens of pixels, judder at full frame
 * rate. And a reel's laps are chained segments: each lap stopped on its end for a frame and the
 * next one started late, a short step every lap.
 *
 * A {@link FrameMotion} is the drawn twin of such a tween (`FrameTween` pairs them). The tween keeps
 * everything it did — its `current`, its promise, when a segment ends, what an interrupted one
 * does — exactly as before, so all the logic that reads it and everything a landing starts runs
 * on the frame and at the point in the frame it always did. The motion only says where to DRAW:
 * it is advanced by one animation-frame callback, {@link frameClockPre}, that runs BEFORE the Pixi
 * ticker's in the same frame, at the frame's timestamp. Between the two callbacks the browser runs
 * a microtask checkpoint, where Svelte flushes the effects that move each symbol's container, so
 * Pixi draws this frame's sample. No `flushSync`.
 *
 * ORDER. `frameClockPre` is requested only from inside a Pixi tick ({@link frameClockTick}, bound
 * by `InitialiseApplication`) or by itself while it runs first. Pixi asks for its next frame at the
 * END of its tick, so the clock's request precedes it and the clock runs first in the next frame.
 * The first frame of a motion that starts from rest is the exception: nothing has asked for the
 * clock yet, so that frame draws the start value. With no Pixi ticker bound (a story, a tool
 * without an app) the clock drives itself.
 *
 * WHAT IS DRAWN differs from the tween's own value in three ways, none of which moves an end:
 *  - it is sampled at the frame's timestamp (the tween samples at `performance.now()`; under
 *    `?ie_determinism`, one virtual clock, the two are the same number);
 *  - a segment set in the clock frame its predecessor ended in CARRIES the time since that exact
 *    end, so the strip does not stop for the moment the next `set()` came late; it still ends on
 *    its old frame, at most one frame's time slower over its length;
 *  - a segment set with `runOn` (the next one continues the same way: a reel's laps, the long
 *    slide) is drawn past `to` on the frame it ends, where the next one will have it, instead of
 *    stopping there for that frame.
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

/** How long ago a segment may have ended and still be the moment the next one starts from. */
const MAX_CARRY_MS = 250;
/** Two callbacks closer than this belong to one frame (frames are at least ~4 ms apart). */
const SAME_FRAME_MS = 0.5;

const active = new Set<FrameMotion>();
let time = -Infinity;
let frame = 0;
let prePending = false;
let boundTickers = 0;
let pixiTickAt = Number.NaN;
let probe: FrameProbe | undefined;
/** What this frame's clock callback stepped, kept only while a probe reads it. */
let stepped: FrameMotion[] | undefined;

function requestPre(): void {
	if (prePending || typeof requestAnimationFrame !== 'function') return;
	prePending = true;
	requestAnimationFrame(frameClockPre);
}

/** The clock's animation-frame callback: runs before the Pixi tick of the same frame. */
export function frameClockPre(t: number): void {
	prePending = false;
	// Pixi ticked this frame already (the clock ran late): what it samples is drawn next frame, as
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
	readonly runOn: boolean;
};

/**
 * Where a tween's value is DRAWN. Mirrors each `set` of the tween it shadows: `set(from, to, …)`
 * with the tween's value at that moment as `from`; `duration: 0` places it at once; `arrive` when
 * the tween's promise resolves (it reads the time later in the frame, so it can see the end first).
 * `onDrawn` reports each new drawn value (the `$state` behind `FrameTween.drawn`).
 */
export class FrameMotion implements FrameMotionView {
	drawn: number;
	shift = 0;
	rate: number | undefined;
	private readonly onDrawn: (drawn: number) => void;
	private segment: FrameSegment | undefined;
	/** The moment the drawn value stands for, and the clock frame it was made in. */
	private valueTime = -Infinity;
	private valueFrame = -1;

	constructor(initial: number, onDrawn: (drawn: number) => void = () => {}) {
		this.drawn = initial;
		this.onDrawn = onDrawn;
	}

	set(from: number, to: number, options: FrameSetOptions = {}): FrameSegment | undefined {
		const duration = options.duration ?? 400;
		// Drawn in the latest clock frame: the strip is moving, and the drawn value (sampled at the
		// frame's timestamp, or run on past an end) may stand a little apart from the tween's.
		const live = this.valueFrame === frame;
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
		const carried = live && start - this.valueTime < MAX_CARRY_MS;
		const origin = carried ? Math.min(this.valueTime, start) : start;
		const easing = options.easing ?? linear;
		const segment: FrameSegment = {
			from: carried ? this.drawn : from,
			to,
			start,
			duration,
			origin,
			span: origin === start ? duration : duration + (start - origin),
			easing,
			runOn: options.runOn === true && easing === linear,
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
			this.end(s, s.runOn ? t : undefined);
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
		if (runOnTo === undefined) this.rate = undefined;
		this.write(runOnTo === undefined ? s.to : s.to + ((s.to - s.from) / s.span) * (runOnTo - end));
	}

	private write(drawn: number): void {
		this.drawn = drawn;
		this.onDrawn(drawn);
	}
}

/**
 * A Svelte `Tween<number>` and its drawn twin: `tween` is the value the motion logic works from and
 * the promise it awaits, unchanged; `motion.drawn` is where to draw it. `FrameTween` wraps this
 * with `$state` for `drawn`.
 */
export class FrameTweenCore {
	readonly tween: Tween<number>;
	readonly motion: FrameMotion;

	constructor(value: number, onDrawn?: (drawn: number) => void) {
		this.tween = new Tween(value);
		this.motion = new FrameMotion(value, onDrawn);
	}

	set(value: number, options: FrameSetOptions = {}): Promise<void> {
		// Read as `Tween` reads its own start value: untracked, so a `set` inside an effect does not
		// make that effect depend on the motion.
		const from = untrack(() => this.tween.current);
		const done = this.tween.set(value, { duration: options.duration, easing: options.easing });
		const segment = this.motion.set(from, value, options);
		if (segment) void done.then(() => this.motion.arrive(segment));
		return done;
	}
}
