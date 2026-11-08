/**
 * Offline fixture for the FRAME CLOCK (`src/lib/frameClock.ts`) — run with:
 *   node --experimental-strip-types packages/pixi-svelte/frameClock.fixture.ts
 *
 * One virtual clock, as under `?ie_determinism`: `performance.now()` and every frame's timestamp
 * read the same number, and each frame runs the clock's callback, then the Pixi tick, then Svelte's
 * own frame callback (the order the game's frames run in). Pins, against Svelte's `Tween` on the
 * same frames:
 *  - a segment samples to the bit what `Tween` samples, but in the clock's callback, before the
 *    Pixi tick draws, and resolves on the same frame, in Svelte's callback, after the Pixi tick;
 *  - a chain of reel laps (`await set`, a `duration: 0` relayout, the next `set`) ends every lap on
 *    the frame `Tween` ended it, while every DRAWN step is the frame's interval times the speed,
 *    within the bound the carried time allows (`Tween` stopped on each lap's end for a frame);
 *  - `current` and the promise are `Tween`'s own; `runOn` draws past `to` on a lap's last frame
 *    while `current` stops on it;
 *  - `duration: 0` places at once, abandons the running segment (its promise never settles) and
 *    counts the jump in `shift`; a handover between frames, with the tween's value read later in
 *    the frame than the drawn one (as on a phone), draws no jump;
 *  - ordering: the Pixi tick asks for the clock's callback while anything moves, the callback keeps
 *    itself ahead of Pixi, and one that ran after Pixi's tick hands the request back to Pixi.
 */

import { linear, backIn } from 'svelte/easing';
import { Tween } from 'svelte/motion';

import {
	FrameMotion,
	FrameTweenCore,
	bindFrameClock,
	frameClockTick,
} from './src/lib/frameClock.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	if (ok) console.log(`  ok  ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
	}
};

let now = 1000;
performance.now = () => now;
const rafQueue: FrameRequestCallback[] = [];
globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => rafQueue.push(cb);

let svelteFrame: ((t: number) => void) | undefined;

const drain = async () => {
	for (let i = 0; i < 20; i++) await Promise.resolve();
};
const FRAME = 1000 / 60;
let pixiTicked = false;

/**
 * One frame: the clock's callback, the Pixi tick (`onDraw` reads what it draws), Svelte's callback.
 * `late` runs the Pixi tick before the clock's callback.
 */
const frame = async (t: number, { late = false, onDraw = () => {}, svelteLag = 0 } = {}) => {
	now = t;
	pixiTicked = false;
	const callbacks = rafQueue.splice(0);
	const pixi = () => {
		frameClockTick({ lastTime: t - FRAME, elapsedMS: FRAME });
		pixiTicked = true;
		onDraw();
	};
	if (late) pixi();
	for (const cb of callbacks) {
		cb(t);
		await drain();
	}
	if (!late) pixi();
	now = t + svelteLag;
	const run = svelteFrame;
	svelteFrame = undefined;
	run?.(t);
	await drain();
};

type SetOptions = { duration?: number; easing?: (t: number) => number; runOn?: boolean };
type Like = { readonly current: number; set: (v: number, o?: SetOptions) => Promise<void> };
const like = (core: FrameTweenCore): Like => ({
	get current() {
		return core.tween.current;
	},
	set: (v, o) => core.set(v, o),
});

const main = async () => {
	// Svelte's frame loop, stepped by hand on the same clock (the module `Tween` itself uses).
	const internal: string = 'svelte/internal/client';
	const { raf } = (await import(internal)) as {
		raf: { tick: (fn: (t: number) => void) => void; now: () => number };
	};
	raf.tick = (fn) => (svelteFrame = fn);
	raf.now = () => now;

	// 1. One segment: Tween's samples, drawn before the Pixi tick; resolved after it, the same frame.
	{
		const t0 = 5000;
		now = t0 + 3.25;
		const release = bindFrameClock();
		const old = new Tween(-120);
		const core = new FrameTweenCore(-120);
		const ended: Record<string, number> = {};
		let resolvedAfterPixi = false;
		void old.set(-720, { duration: 333.3, easing: backIn }).then(() => (ended.old = now));
		void core.set(-720, { duration: 333.3, easing: backIn }).then(() => {
			ended.new = now;
			resolvedAfterPixi = pixiTicked;
		});
		frameClockTick({ lastTime: t0, elapsedMS: FRAME });
		const drawn: number[] = [];
		const sampled: number[] = [];
		let sameCurrent = true;
		for (let f = 1; f <= 24; f++) {
			await frame(t0 + f * FRAME, { onDraw: () => drawn.push(core.motion.drawn) });
			sampled.push(old.current);
			sameCurrent &&= Object.is(core.tween.current, old.current);
		}
		check(
			'each frame draws, before the Pixi tick, exactly what Tween samples after it',
			drawn.every((v, i) => Object.is(v, sampled[i])),
			`tween ${sampled.slice(0, 5)} drawn ${drawn.slice(0, 5)}`,
		);
		check('`current` is Tween’s own value, frame by frame', sameCurrent);
		check('…and resolves on the same frame', ended.old === ended.new && ended.old !== undefined);
		check('…in Svelte’s callback, after the Pixi tick', resolvedAfterPixi);
		release();
	}

	// 2. A reel's laps.
	{
		const speed = 3;
		const pitch = 120;
		const lap = 5 * pitch;
		const home = -pitch;
		const runLaps = async (it: Like, laps: number, ends: number[], frameOf: () => number) => {
			for (let k = 0; k < laps; k++) {
				await it.set(home, {
					duration: Math.abs(home - it.current) / speed,
					easing: linear,
					runOn: true,
				});
				ends.push(frameOf());
				await it.set(home - lap, { duration: 0 });
			}
		};
		const t0 = 20000;
		let index = 0;
		const release = bindFrameClock();
		const old = new Tween(home - lap);
		const core = new FrameTweenCore(home - lap);
		const motion = core.motion;
		const endsOld: number[] = [];
		const endsNew: number[] = [];
		now = t0 + 1;
		void runLaps(old, 4, endsOld, () => index);
		void runLaps(like(core), 4, endsNew, () => index);
		frameClockTick({ lastTime: t0, elapsedMS: FRAME });
		const visual: number[] = [];
		let runOnSeen = false;
		for (index = 1; index <= 60; index++)
			await frame(t0 + index * FRAME, {
				onDraw: () => {
					visual.push(motion.drawn - motion.shift);
					if (motion.drawn !== core.tween.current && core.tween.current === home) runOnSeen = true;
				},
			});
		check(
			'every lap ends on the frame Tween ended it',
			JSON.stringify(endsOld) === JSON.stringify(endsNew) && endsNew.length === 4,
			`tween ${endsOld} clock ${endsNew}`,
		);
		check('a lap’s last frame draws past `to` while `current` stops on it', runOnSeen);
		const steps = visual.slice(2, 48).map((v, i) => v - visual[i + 1]);
		const ideal = FRAME * speed;
		// A carried lap ends on the old frame, so it runs at most one frame's time slower; the frame
		// after a handover also differs by the run-on frame having been drawn at the ending lap's speed.
		const bound = (2 * ideal * FRAME) / (lap / speed + FRAME) + 1e-9;
		const worst = Math.max(...steps.map((s) => Math.abs(s - ideal)));
		check(
			`every drawn step is interval × speed through the handovers (worst ${worst.toFixed(2)} of ${ideal.toFixed(1)} px, bound ${bound.toFixed(2)})`,
			worst <= bound,
			`steps ${steps.map((s) => s.toFixed(1)).join(' ')}`,
		);
		release();
	}

	// 3. duration 0: placed at once, the running segment is abandoned, the jump is counted.
	{
		const release = bindFrameClock();
		const core = new FrameTweenCore(0);
		let settled = false;
		now = 40000;
		void core.set(100, { duration: 200 }).then(() => (settled = true));
		frameClockTick({ lastTime: now - FRAME, elapsedMS: FRAME });
		await frame(now + FRAME);
		await frame(now + FRAME);
		let placedSettled = false;
		void core.set(-50, { duration: 0 }).then(() => (placedSettled = true));
		for (let f = 0; f < 30; f++) await frame(now + FRAME);
		check(
			'a duration-0 set places the value at once',
			core.tween.current === -50 && core.motion.drawn === -50,
		);
		check('…resolves at once', placedSettled);
		check('…and the segment it cut off never settles', !settled);
		check('…and its jump is counted in shift', core.motion.shift !== 0);
		release();
	}

	// 5. A handover between frames, as a phone runs them: Svelte's callback reads the clock a few ms
	//    after the frame's timestamp, so the tween's value is ahead of the drawn one. The spin
	//    relays the strip from the tween's value and slides on; the drawn strip must not jump.
	{
		const speed = 1.5;
		const t0 = 50000;
		const release = bindFrameClock();
		const core = new FrameTweenCore(-720);
		now = t0 + 1;
		void core.set(-120, { duration: 600 / speed, easing: linear });
		frameClockTick({ lastTime: t0, elapsedMS: FRAME });
		const visual: number[] = [];
		const onDraw = () => visual.push(core.motion.drawn - core.motion.shift);
		let t = t0;
		for (let f = 1; f <= 8; f++) await frame((t += FRAME), { onDraw, svelteLag: 4 });
		now = t + 6;
		const at = core.tween.current;
		void core.set(at - 600, { duration: 0 });
		void core.set(-120, { duration: Math.abs(-120 - (at - 600)) / speed, easing: linear });
		for (let f = 1; f <= 8; f++) await frame((t += FRAME), { onDraw, svelteLag: 4 });
		const steps = visual.slice(2).map((v, i) => v - visual[i + 1]);
		const worst = Math.max(...steps.map((step) => Math.abs(step - speed * FRAME)));
		check(
			`a handover between frames draws no jump (worst ${worst.toFixed(2)} px of ${(speed * FRAME).toFixed(1)})`,
			worst < 0.5,
			`steps ${steps.map((step) => step.toFixed(2)).join(' ')}`,
		);
		for (let f = 0; f < 60 && rafQueue.length; f++) await frame((t += FRAME));
		release();
	}

	// 4. Ordering: Pixi asks for the clock while something moves; the clock keeps itself ahead.
	{
		rafQueue.length = 0;
		const release = bindFrameClock();
		const motion = new FrameMotion(0);
		now = 60000;
		motion.set(0, 1000, { duration: 1000 });
		check('a set from rest with a ticker bound waits for the Pixi tick', rafQueue.length === 0);
		frameClockTick({ lastTime: now - FRAME, elapsedMS: FRAME });
		check('the Pixi tick asks for the clock callback while a value moves', rafQueue.length === 1);
		await frame(now + FRAME);
		check('the clock callback asks for the next frame itself', rafQueue.length === 1);
		await frame(now + FRAME, { late: true });
		check(
			'a clock callback that ran after the Pixi tick leaves the next request to Pixi',
			rafQueue.length === 0,
		);
		frameClockTick({ lastTime: now, elapsedMS: FRAME });
		check('…which asks again from inside its tick, ahead of its own', rafQueue.length === 1);
		release();
		// Unbound: the clock drives itself while a value moves, and stops when nothing does.
		for (let f = 0; f < 80 && rafQueue.length; f++) {
			now += FRAME;
			for (const cb of rafQueue.splice(0)) cb(now);
			await drain();
		}
		check('unbound, the clock stops asking for frames once nothing moves', rafQueue.length === 0);
		new FrameMotion(0).set(0, 10, { duration: 100 });
		check('…and a set with no Pixi ticker bound starts it again', rafQueue.length === 1);
	}
};

void main().then(() => {
	if (failures) throw new Error(`frameClock.fixture: ${failures} FAILED`);
	console.log('\nframeClock.fixture: all ok');
});
