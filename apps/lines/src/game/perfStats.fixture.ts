/**
 * Offline fixture for the `?perf=1` readout's numbers (`perfStats.ts`) — run with:
 *   node --experimental-strip-types apps/lines/src/game/perfStats.fixture.ts
 *
 * Pins: the display refresh read off the fastest frames (120 / 60 Hz, through dropped frames);
 * the 30 fps cap flag (iOS Low Power Mode) and only it; idle vs spinning buckets and their hitch
 * counts; the reel step error is 0 for a value drawn at interval × speed (through a relayout jump)
 * and shows a value drawn a frame late; a hidden page's gap is not a frame; Reset clears.
 */

import { createPerfStats, estimateRefreshHz } from './perfStats.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	if (ok) console.log(`  ok  ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
	}
};

const frames = (ms: number, count: number, jitter = 0) =>
	Array.from({ length: count }, (_, i) => ms + (i % 2 ? jitter : -jitter));

check('120 Hz is read as 120', estimateRefreshHz(frames(8.33, 200, 0.2)) === 120);
check('60 Hz is read as 60', estimateRefreshHz(frames(16.67, 200, 0.3)) === 60);
check(
	'120 Hz with every third frame dropped is still 120',
	estimateRefreshHz(Array.from({ length: 300 }, (_, i) => (i % 3 === 2 ? 16.67 : 8.33))) === 120,
);
check('too few frames give no estimate', estimateRefreshHz(frames(8.33, 10)) === undefined);

type View = { drawn: number; shift: number; rate: number | undefined };
const drive = (
	intervals: number[],
	spinningAt: (i: number) => boolean,
	motion?: (t: number, i: number) => View,
) => {
	let now = 0;
	const stats = createPerfStats(() => now);
	let t = 1000;
	stats.frame(t, false, []);
	intervals.forEach((ms, i) => {
		t += ms;
		now = t;
		stats.frame(t, spinningAt(i), motion ? [motion(t, i)] : []);
	});
	return stats;
};

{
	const s = drive(frames(33.3, 120, 0.4), () => false).snapshot();
	check(
		'30 fps steady is flagged as a 30 fps cap',
		s.capped30 && s.refreshHz === 30,
		JSON.stringify(s),
	);
	const t = drive(frames(16.67, 120, 0.3), () => false).snapshot();
	check('60 fps is not', !t.capped30);
}

{
	const intervals = [...frames(8.33, 100), 40, 60, 120, ...frames(8.33, 50)];
	const s = drive(intervals, (i) => i >= 100).snapshot();
	check(
		'idle and spinning frames go to their own bucket',
		s.idle.frames === 100 && s.spinning.frames === 53,
	);
	check(
		'hitches count over 33 / 50 / 100 ms',
		s.spinning.hitches[33] === 3 && s.spinning.hitches[50] === 2 && s.spinning.hitches[100] === 1,
		JSON.stringify(s.spinning.hitches),
	);
	check('idle shows no hitches', s.idle.hitches[33] === 0);
	check('max is the worst frame', s.spinning.max === 120);
}

{
	// A reel drawn at each frame's timestamp, 3 px/ms, with a relayout jump of -600 every 200 ms.
	const rate = 3;
	const object = { drawn: 0, shift: 0, rate };
	const jittered = Array.from({ length: 120 }, (_, i) => 8.33 + (i % 5) * 0.7);
	const exact = drive(
		jittered,
		() => true,
		(t) => {
			const jumps = Math.floor((t - 1000) / 200);
			object.shift = -600 * jumps;
			object.drawn = rate * (t - 1000) + object.shift;
			return object;
		},
	).snapshot();
	check(
		'a reel drawn at the frame timestamp has no step error, through relayouts',
		exact.reel.steps > 100 && exact.reel.max < 1e-6,
		JSON.stringify(exact.reel),
	);
	// The same reel drawn one frame late (the value sampled for the previous frame).
	let previous = 0;
	const lateObject = { drawn: 0, shift: 0, rate };
	const late = drive(
		jittered,
		() => true,
		(t) => {
			lateObject.drawn = previous;
			previous = rate * (t - 1000);
			return lateObject;
		},
	).snapshot();
	check(
		'…and one drawn a frame late shows the uneven frames',
		late.reel.max > 3,
		JSON.stringify(late.reel),
	);
}

{
	let now = 0;
	const stats = createPerfStats(() => now);
	stats.frame(1000, false, []);
	stats.frame(1008, false, []);
	stats.pause();
	stats.frame(9000, false, []);
	stats.frame(9008, false, []);
	const s = stats.snapshot();
	check('a hidden page’s gap is not counted as a frame', s.idle.frames === 2 && s.idle.max === 8);
	stats.reset();
	check('Reset clears every count', stats.snapshot().idle.frames === 0);
}

if (failures) throw new Error(`perfStats.fixture: ${failures} FAILED`);
console.log('\nperfStats.fixture: all ok');
