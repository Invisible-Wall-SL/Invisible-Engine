/**
 * Offline fixture for the FRAME CLOCK (`src/lib/frameClock.ts`) — run with:
 *   node --experimental-strip-types packages/pixi-svelte/frameClock.fixture.ts
 *
 * Each frame has a timestamp (`document.timeline.currentTime`, fixed for the frame) and runs Svelte's
 * own frame callback, which reads `performance.now()` `lag` ms after that timestamp.
 * Pins, against Svelte's `Tween` stepped on the same frames:
 *  - with no lag (`?ie_determinism`: one virtual clock), `FrameTween` IS `Tween`: the same value on
 *    every frame to the bit, through a reel's chained laps and relayouts, and every slide settles
 *    on the same frame;
 *  - with a lag that changes every frame (a phone's render time), `Tween`'s steps wander while
 *    `FrameTween`'s are each frame's interval times the speed;
 *  - with no document timeline (Node) the sample is `performance.now()`, as `Tween`'s is;
 *  - `duration: 0` places at once and its jump is counted in `shift`; the probe sees a reel only
 *    while it moves.
 */

import { linear, backIn } from 'svelte/easing';
import { Tween } from 'svelte/motion';

import { FrameTween, frameClockTick, setFrameProbe } from './src/lib/frameClock.ts';

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
let svelteFrame: ((t: number) => void) | undefined;
const timeline = { currentTime: 0 };
const page = globalThis as { document?: unknown };

const drain = async () => {
	for (let i = 0; i < 20; i++) await Promise.resolve();
};
const FRAME = 1000 / 60;

/** One frame at timestamp `t`, its Pixi tick, then Svelte's callback `lag` ms later. */
const frame = async (t: number, { lag = 0 } = {}) => {
	timeline.currentTime = t;
	frameClockTick({ lastTime: t - FRAME, elapsedMS: FRAME });
	now = t + lag;
	const run = svelteFrame;
	svelteFrame = undefined;
	run?.(now);
	await drain();
};

type Like = {
	readonly current: number;
	set: (v: number, o?: { duration?: number; easing?: (t: number) => number }) => Promise<void>;
};

const main = async () => {
	// Svelte's frame loop, stepped by hand on the same clock (the module `Tween` itself uses).
	const internal: string = 'svelte/internal/client';
	const { raf } = (await import(internal)) as {
		raf: { tick: (fn: (t: number) => void) => void; now: () => number };
	};
	raf.tick = (fn) => (svelteFrame = fn);
	raf.now = () => now;

	// 1. One clock: the same value as Tween on every frame, through a reel's laps and relayouts.
	{
		const speed = 3;
		const pitch = 120;
		const lap = 5 * pitch;
		const home = -pitch;
		const run = async (it: Like, ends: number[], frameOf: () => number) => {
			await it.set(home, { duration: 300, easing: backIn });
			ends.push(frameOf());
			for (let k = 0; k < 3; k++) {
				await it.set(home - lap, { duration: 0 });
				await it.set(home, { duration: Math.abs(home - it.current) / speed, easing: linear });
				ends.push(frameOf());
			}
		};
		page.document = { timeline };
		const t0 = 5000;
		let index = 0;
		const old = new Tween(home - lap);
		const reel = new FrameTween(home - lap);
		const endsOld: number[] = [];
		const endsNew: number[] = [];
		now = t0 + 3.25;
		void run(old, endsOld, () => index);
		void run(reel, endsNew, () => index);
		let same = true;
		for (index = 1; index <= 70; index++) {
			await frame(t0 + index * FRAME);
			same &&= Object.is(reel.current, old.current);
		}
		check('one clock: the same value as Tween on every frame, to the bit', same);
		check(
			'…and every slide settles on the frame Tween’s does',
			JSON.stringify(endsOld) === JSON.stringify(endsNew) && endsNew.length === 4,
			`tween ${endsOld} frame clock ${endsNew}`,
		);
	}

	// 2. Svelte's callback late by a different amount each frame, as behind a phone's render.
	{
		const speed = 3;
		const t0 = 20000;
		const lags = [1, 7, 3, 9, 2, 6];
		const old = new Tween(0);
		const reel = new FrameTween(0);
		now = t0 + 1;
		void old.set(2000, { duration: 2000 / speed, easing: linear });
		void reel.set(2000, { duration: 2000 / speed, easing: linear });
		const tween: number[] = [];
		const clock: number[] = [];
		for (let f = 1; f <= 24; f++) {
			await frame(t0 + f * FRAME, { lag: lags[f % lags.length] });
			tween.push(old.current);
			clock.push(reel.current);
		}
		const ideal = speed * FRAME;
		const worst = (values: number[]) =>
			Math.max(...values.slice(2).map((v, i) => Math.abs(v - values[i + 1] - ideal)));
		check(
			`a lagging callback: Tween’s steps wander (worst ${worst(tween).toFixed(1)} px of ${ideal.toFixed(1)})`,
			worst(tween) > 10,
		);
		check(
			`…the frame clock’s are interval × speed (worst ${worst(clock).toFixed(6)} px)`,
			worst(clock) < 1e-9,
		);
	}

	// 3. No document timeline (Node): the sample is performance.now(), as Tween's is.
	{
		page.document = undefined;
		const t0 = 40000;
		const old = new Tween(0);
		const reel = new FrameTween(0);
		now = t0 + 1;
		void old.set(1000, { duration: 1000 });
		void reel.set(1000, { duration: 1000 });
		let same = true;
		for (let f = 1; f < 70; f++) {
			await frame(t0 + f * FRAME, { lag: f % 5 });
			same &&= Object.is(reel.current, old.current);
		}
		check('no document timeline: the same value as Tween on every frame', same);
		page.document = { timeline };
	}

	// 4. duration 0, and the probe.
	{
		const t0 = 60000;
		const seen: number[] = [];
		const reel = new FrameTween(0);
		setFrameProbe((_, moving) => seen.push([...moving].length));
		let placed = false;
		void reel.set(-50, { duration: 0 }).then(() => (placed = true));
		await drain();
		check('a duration-0 set places the value at once', reel.current === -50 && placed);
		check('…and its jump is counted in shift', reel.shift === -50);
		now = t0 + 1;
		void reel.set(100, { duration: 100 });
		for (let f = 1; f <= 12; f++) await frame(t0 + f * FRAME);
		setFrameProbe(undefined);
		check(
			'the probe sees a reel while it moves, and not after',
			seen[0] === 1 && seen.at(-1) === 0,
		);
	}
};

void main().then(() => {
	if (failures) throw new Error(`frameClock.fixture: ${failures} FAILED`);
	console.log('\nframeClock.fixture: all ok');
});
