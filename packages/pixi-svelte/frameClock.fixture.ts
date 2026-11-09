/**
 * Offline fixture for the FRAME CLOCK (`src/lib/frameClock.ts`) — run with:
 *   node --experimental-strip-types packages/pixi-svelte/frameClock.fixture.ts
 *
 * Each frame has a timestamp (`document.timeline.currentTime`) and runs, in this order, the clock's
 * callback, the Pixi tick (which draws), then Svelte's own frame callback — the order in which the
 * board drew the previous frame's position — which may read `performance.now()` late. Pins, against
 * Svelte's `Tween` stepped on the same frames:
 *  - LOGIC IS THE TWEEN'S: `current` is the frame-timestamp sample the reel has always used, to the
 *    bit (one clock: `Tween`'s own value), every promise settles on the same frame, after the Pixi
 *    tick, and a lagging Svelte callback does not move it;
 *  - SAME-FRAME DRAWING: what the Pixi tick draws is the motion sampled at THAT frame's timestamp
 *    (`Tween`'s sample of the same frame, which used to be drawn a frame later), so with frame
 *    lengths that alternate (a 120 Hz phone) each drawn step is that frame's interval × the speed;
 *  - LAP-END CARRY-OVER: through a chain of laps (`await set`, a `duration: 0` relayout, the next
 *    `set`) and from an eased ramp into the roll, every drawn step stays interval × speed, within
 *    the bound a carried lap allows, while `current` still stops on each lap's end for a frame;
 *  - `duration: 0` places at once, abandons the running segment and counts its jump in `shift`; a
 *    handover with the tween read late in the frame draws no jump;
 *  - listeners hear every drawn value as it is made, before the Pixi tick of its frame;
 *  - ordering: the Pixi tick asks for the clock's callback while anything moves, the callback keeps
 *    itself ahead of Pixi, and one that ran after Pixi's tick hands the request back to Pixi.
 */

import { linear, backIn, sineIn, sineOut } from 'svelte/easing';
import { Tween } from 'svelte/motion';

import {
	FrameMotion,
	FrameTweenCore,
	bindFrameClock,
	frameClockTick,
	setFrameProbe,
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
const timeline = { currentTime: 0 };
const page = globalThis as { document?: unknown };
page.document = { timeline };
const rafQueue: FrameRequestCallback[] = [];
globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => rafQueue.push(cb);

let svelteFrame: ((t: number) => void) | undefined;

const drain = async () => {
	for (let i = 0; i < 20; i++) await Promise.resolve();
};
const FRAME = 1000 / 60;
let pixiTicked = false;
let lastPixi = 0;

/**
 * One frame at timestamp `t`: the clock's callback, the Pixi tick (`onDraw` reads what it draws),
 * then Svelte's callback, which reads the clock `svelteLag` ms late. `late` runs the Pixi tick first.
 */
const frame = async (t: number, { late = false, onDraw = () => {}, svelteLag = 0 } = {}) => {
	timeline.currentTime = t;
	now = t;
	pixiTicked = false;
	const callbacks = rafQueue.splice(0);
	const pixi = () => {
		frameClockTick({ lastTime: lastPixi, elapsedMS: t - lastPixi });
		lastPixi = t;
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
	run?.(now);
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

/** Start a motion's frames at `t0`, the way the game does: from inside a Pixi tick. */
const kick = (t0: number) => {
	lastPixi = t0;
	frameClockTick({ lastTime: t0 - FRAME, elapsedMS: FRAME });
};

const main = async () => {
	// Svelte's frame loop, stepped by hand on the same clock (the module `Tween` itself uses).
	const internal: string = 'svelte/internal/client';
	const { raf } = (await import(internal)) as {
		raf: { tick: (fn: (t: number) => void) => void; now: () => number };
	};
	raf.tick = (fn) => (svelteFrame = fn);
	raf.now = () => now;
	const release = bindFrameClock();

	const speed = 3;
	const pitch = 120;
	const lap = 5 * pitch;
	const home = -pitch;

	// 1. One clock (`?ie_determinism`): logic is Tween's, to the bit; each frame DRAWS, before the
	//    Pixi tick, what Tween samples after it.
	{
		const t0 = 5000;
		const old = new Tween(home - lap);
		const core = new FrameTweenCore(home - lap);
		const ends: Record<'old' | 'new', number[]> = { old: [], new: [] };
		let index = 0;
		let resolvedAfterPixi = true;
		const run = async (it: Like, out: number[], probe = false) => {
			await it.set(home, { duration: 300, easing: backIn });
			out.push(index);
			for (let k = 0; k < 3; k++) {
				await it.set(home - lap, { duration: 0 });
				await it.set(home, { duration: Math.abs(home - it.current) / speed, easing: linear });
				out.push(index);
				if (probe) resolvedAfterPixi &&= pixiTicked;
			}
		};
		now = t0 + 3.25;
		void run(old, ends.old);
		void run(like(core), ends.new, true);
		kick(t0);
		const drawn: number[] = [];
		const sampled: number[] = [];
		let sameCurrent = true;
		for (index = 1; index <= 24; index++) {
			await frame(t0 + index * FRAME, { onDraw: () => drawn.push(core.motion.drawn) });
			sampled.push(old.current);
			sameCurrent &&= Object.is(core.tween.current, old.current);
		}
		for (; index <= 90; index++) {
			await frame(t0 + index * FRAME);
			sameCurrent &&= Object.is(core.tween.current, old.current);
		}
		check('`current` is Tween’s own value on every frame, to the bit', sameCurrent);
		check(
			'every slide settles on the frame Tween’s does, after the Pixi tick',
			JSON.stringify(ends.old) === JSON.stringify(ends.new) &&
				ends.new.length === 4 &&
				resolvedAfterPixi,
			`tween ${ends.old} clock ${ends.new}`,
		);
		// Through the first slide, up to the frame it ends on (whose Svelte callback relays the strip
		// before `sampled` reads it); the laps after it are carried (case 3).
		const first = ends.new[0] - 1;
		check(
			'each frame draws, before the Pixi tick, exactly what Tween samples after it',
			first > 10 && drawn.slice(0, first).every((v, i) => Object.is(v, sampled[i])),
			`tween ${sampled.slice(0, first)} drawn ${drawn.slice(0, first)}`,
		);
	}

	// 2. Frame lengths that alternate, as a 120 Hz adaptive display mixes them, and Svelte's callback
	//    reading the clock a different amount late each frame. `current` (what the board used to draw,
	//    a frame late) steps by the PREVIOUS frame's interval; the drawn value by this frame's.
	{
		const t0 = 20000;
		const intervals = [1000 / 120, 1000 / 60];
		const lags = [1, 5, 3, 7];
		const core = new FrameTweenCore(0);
		now = t0 + 0.5;
		void core.set(4000, { duration: 4000 / speed, easing: linear });
		kick(t0);
		const drawn: number[] = [];
		const current: number[] = [];
		const times: number[] = [];
		let t = t0;
		for (let f = 1; f <= 40; f++) {
			t += intervals[f % 2];
			await frame(t, {
				svelteLag: lags[f % lags.length],
				onDraw: () => {
					drawn.push(core.motion.drawn);
					current.push(core.tween.current);
					times.push(t);
				},
			});
		}
		const worst = (values: number[]) =>
			Math.max(
				...values
					.slice(3)
					.map((v, i) => Math.abs(v - values[i + 2] - speed * (times[i + 3] - times[i + 2]))),
			);
		check(
			`alternating 8.3 / 16.7 ms frames: drawing \`current\` a frame late misses by ${worst(current).toFixed(1)} px a step`,
			worst(current) > 20,
		);
		check(
			`…drawing the frame’s own sample, every step is that frame’s interval × speed (worst ${worst(drawn).toExponential(1)} px)`,
			worst(drawn) < 1e-9,
		);
	}

	// 3. A reel's laps: carried over, so the drawn strip keeps its speed through every handover.
	{
		const t0 = 40000;
		const old = new Tween(home - lap);
		const core = new FrameTweenCore(home - lap);
		const motion = core.motion;
		const ends: Record<'old' | 'new', number[]> = { old: [], new: [] };
		let index = 0;
		const runLaps = async (it: Like, out: number[]) => {
			for (let k = 0; k < 4; k++) {
				await it.set(home, {
					duration: Math.abs(home - it.current) / speed,
					easing: linear,
					runOn: true,
				});
				out.push(index);
				await it.set(home - lap, { duration: 0 });
			}
		};
		now = t0 + 1;
		void runLaps(old, ends.old);
		void runLaps(like(core), ends.new);
		kick(t0);
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
			JSON.stringify(ends.old) === JSON.stringify(ends.new) && ends.new.length === 4,
			`tween ${ends.old} clock ${ends.new}`,
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
	}

	// 3b. A landing: the last slide comes to rest on the seat (no `runOn`) and the bounce follows.
	//     Nothing is carried, so every frame draws exactly what Tween samples for it: the bounce is
	//     the tween's own, a frame earlier.
	{
		const t0 = 50000;
		const old = new Tween(home - lap);
		const core = new FrameTweenCore(home - lap);
		const land = async (it: Like) => {
			await it.set(home, { duration: Math.abs(home - it.current) / 0.7, easing: linear });
			await it.set(home, { duration: 0 });
			await it.set(home + 30, { duration: 65, easing: sineOut });
			await it.set(home, { duration: 65, easing: sineIn });
		};
		now = t0 + 3.7;
		void land(old);
		void land(like(core));
		kick(t0);
		const drawn: number[] = [];
		const sampled: number[] = [];
		for (let f = 1; f <= 64; f++) {
			await frame(t0 + f * FRAME, { onDraw: () => drawn.push(core.motion.drawn) });
			sampled.push(old.current);
		}
		check(
			'a slide that comes to rest hands over as the tween does: every frame, the bounce included, draws Tween’s own sample',
			drawn.every((v, i) => Object.is(v, sampled[i])) && sampled.at(-1) === home,
			`tween ${sampled.slice(-12).map((v) => v.toFixed(2))} drawn ${drawn.slice(-12).map((v) => v.toFixed(2))}`,
		);
	}

	// 4. An eased ramp into the roll (the house reel feel's spin-up): run on at the speed it ends at.
	{
		const t0 = 60000;
		const ramp = 60;
		const core = new FrameTweenCore(home - lap);
		const motion = core.motion;
		const rampIn = (duration: number, distance: number) => (t: number) => {
			const ms = t * duration;
			const covered = ms < ramp ? (speed * ms * ms) / (2 * ramp) : speed * (ms - ramp / 2);
			return Math.min(covered / distance, 1);
		};
		const roll = async () => {
			const duration = lap / speed + ramp / 2;
			await core.set(home, { duration, easing: rampIn(duration, lap), runOn: true });
			for (let k = 0; k < 2; k++) {
				await core.set(home - lap, { duration: 0 });
				await core.set(home, { duration: lap / speed, easing: linear, runOn: true });
			}
		};
		now = t0 + 2;
		void roll();
		kick(t0);
		const visual: number[] = [];
		for (let f = 1; f <= 45; f++)
			await frame(t0 + f * FRAME, { onDraw: () => visual.push(motion.drawn - motion.shift) });
		const ideal = FRAME * speed;
		// Past the ramp (from frame 6), through the ramp's end and the next lap's.
		const steps = visual.slice(6, 40).map((v, i) => v - visual[i + 5]);
		const worst = Math.max(...steps.map((s) => Math.abs(s - ideal)));
		const bound = (2 * ideal * FRAME) / (lap / speed + FRAME) + 0.01;
		check(
			`a ramp runs on into the roll at the speed it ends at (worst ${worst.toFixed(2)} of ${ideal.toFixed(1)} px, bound ${bound.toFixed(2)})`,
			worst <= bound,
			`steps ${steps.map((s) => s.toFixed(1)).join(' ')}`,
		);
	}

	// 5. duration 0: placed at once, the running segment is abandoned, the jump is counted.
	{
		const core = new FrameTweenCore(0);
		let settled = false;
		now = 80000;
		void core.set(100, { duration: 200 }).then(() => (settled = true));
		kick(now);
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
	}

	// 6. A handover between frames, as a phone runs them: Svelte's callback reads the clock a few ms
	//    after the frame's timestamp. The spin relays the strip from the tween's value and slides on;
	//    the drawn strip must not jump.
	{
		const slow = 1.5;
		const t0 = 90000;
		const core = new FrameTweenCore(-720);
		now = t0 + 1;
		void core.set(-120, { duration: 600 / slow, easing: linear });
		kick(t0);
		const visual: number[] = [];
		const onDraw = () => visual.push(core.motion.drawn - core.motion.shift);
		let t = t0;
		for (let f = 1; f <= 8; f++) await frame((t += FRAME), { onDraw, svelteLag: 4 });
		now = t + 6;
		const at = core.tween.current;
		void core.set(at - 600, { duration: 0 });
		void core.set(-120, { duration: Math.abs(-120 - (at - 600)) / slow, easing: linear });
		for (let f = 1; f <= 8; f++) await frame((t += FRAME), { onDraw, svelteLag: 4 });
		const steps = visual.slice(2).map((v, i) => v - visual[i + 1]);
		const worst = Math.max(...steps.map((step) => Math.abs(step - slow * FRAME)));
		check(
			`a handover between frames draws no jump (worst ${worst.toFixed(2)} px of ${(slow * FRAME).toFixed(1)})`,
			worst < 0.5,
			`steps ${steps.map((step) => step.toFixed(2)).join(' ')}`,
		);
		for (let f = 0; f < 60 && rafQueue.length; f++) await frame((t += FRAME));
	}

	// 7. Listeners and the probe.
	{
		const t0 = 100000;
		const core = new FrameTweenCore(0);
		const heard: number[] = [];
		const beforePixi: boolean[] = [];
		const stop = core.motion.listen((drawn) => {
			heard.push(drawn);
			beforePixi.push(!pixiTicked);
		});
		const seen: number[] = [];
		setFrameProbe((_, moving) => seen.push([...moving].length));
		now = t0 + 1;
		void core.set(100, { duration: 100 });
		kick(t0);
		const drawnAtPixi: number[] = [];
		for (let f = 1; f <= 9; f++)
			await frame(t0 + f * FRAME, { onDraw: () => drawnAtPixi.push(core.motion.drawn) });
		check(
			'a listener hears each drawn value before the Pixi tick draws it',
			heard.length >= 6 &&
				beforePixi.slice(0, 6).every(Boolean) &&
				heard.slice(0, 6).every((v, i) => v === drawnAtPixi[i]),
			`heard ${heard.slice(0, 6)} drawn ${drawnAtPixi.slice(0, 6)}`,
		);
		check('…and the last value it hears is where the motion ends', heard.at(-1) === 100);
		stop();
		void core.set(5, { duration: 0 });
		check('a released listener hears nothing more', heard.at(-1) === 100);
		setFrameProbe(undefined);
		check(
			'the probe sees a value while it moves, and not after',
			seen[0] === 1 && seen.at(-1) === 0,
		);
	}

	// 8. No document timeline (Node): the tween samples performance.now(), as Tween does.
	{
		page.document = undefined;
		const t0 = 120000;
		const old = new Tween(0);
		const core = new FrameTweenCore(0);
		now = t0 + 1;
		void old.set(1000, { duration: 1000 });
		void core.set(1000, { duration: 1000 });
		kick(t0);
		let same = true;
		for (let f = 1; f < 70; f++) {
			await frame(t0 + f * FRAME, { svelteLag: f % 5 });
			same &&= Object.is(core.tween.current, old.current);
		}
		check('no document timeline: `current` is Tween’s value on every frame', same);
		page.document = { timeline };
	}
	release();

	// 9. Ordering: Pixi asks for the clock while something moves; the clock keeps itself ahead.
	{
		for (let f = 0; f < 60 && rafQueue.length; f++) await frame(now + FRAME);
		rafQueue.length = 0;
		const bound = bindFrameClock();
		const motion = new FrameMotion(0);
		now = 140000;
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
		bound();
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
