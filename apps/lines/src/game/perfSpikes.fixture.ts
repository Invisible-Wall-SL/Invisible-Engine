/**
 * Offline fixture for the `?perf=1` spike records (`perfSpikes.ts`, fed through `perfStats.ts`) —
 * run with:
 *   pnpm check:all --only perfSpikes
 *
 * Pins: the spike threshold is max(33 ms, 2.5 display frames) at 60 and 120 Hz, at the 30 fps cap,
 * and on a device too slow to show its display's rate; each cause comes out of its own frame (first
 * use from either side, particles, rigs, page JS, game code, GC, outside the game, mixed), main-
 * thread time outside JS (a commit waiting on the GPU) is not taken for page JS, and a part that is
 * not the largest, or under 40% of the JS, is not named; the cause is read off
 * the PREVIOUS frame's work, and the frame's own work arrives a frame later; only the latest 30
 * records are kept while the summary counts every spike, idle and spinning apart; Reset clears
 * them; records drop zero fields and round to 0.1 ms; long tasks and the heap show where given.
 */

import type { FrameWork } from 'pixi-svelte';

import {
	SPIKE_RULES,
	classifySpike,
	compactFrame,
	createSpikeRecorder,
	displayPeriodMs,
	spikeThresholdMs,
	stateLabel,
	topCause,
} from './perfSpikes';
import { createPerfStats } from './perfStats';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	if (ok) console.log(`  ok  ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
	}
};

const work = (over: Partial<FrameWork> = {}): FrameWork => ({
	calls: 200,
	draws: 40,
	vertices: 4000,
	passes: 1,
	targetSwitches: 1,
	resolves: 1,
	invalidations: 1,
	clears: 1,
	copies: 1,
	programs: 3,
	filterGroups: 0,
	filterPasses: 0,
	textureUploads: 0,
	uploadBytes: 0,
	compiles: 0,
	bufferUploads: 2,
	bufferBytes: 20000,
	roundTrips: 0,
	renderMs: 2,
	tickMs: 4,
	lateMs: 0.5,
	afterMs: 1,
	jsMs: 5,
	particleMs: 0,
	particles: 0,
	emitters: 0,
	emitterStarts: 0,
	baked: 0,
	rigMs: 0,
	rigs: 0,
	rigSyncMs: 0,
	...over,
});
const light = work();

console.log('threshold');
{
	const at = (hz: number | undefined, capped = false) =>
		Math.round(spikeThresholdMs(displayPeriodMs(hz, capped)) * 10) / 10;
	check('60 Hz: 2.5 frames, 41.7 ms', at(60) === 41.7, String(at(60)));
	check('120 Hz: the 33 ms floor', at(120) === 33, String(at(120)));
	check('no estimate yet reads as 60 Hz', at(undefined) === 41.7);
	check('30 fps cap (Low Power Mode): 83.3 ms', at(30, true) === 83.3, String(at(30, true)));
	check('a slow device reading 30 without the cap stays at 60 Hz', at(30) === 41.7);
}

/** perfStats driven at `ms` per frame (with work each frame), then `tail` intervals. */
const drive = (ms: number, count: number, tail: number[], spinning = false) => {
	const stats = createPerfStats(() => 0);
	let t = 1000;
	stats.frame(t, spinning, []);
	for (const interval of [...Array.from({ length: count }, () => ms), ...tail]) {
		stats.work(light);
		t += interval;
		stats.frame(t, spinning, [], 'idle');
	}
	stats.work(light);
	return stats.snapshot().spikes;
};
{
	const at60 = drive(16.67, 120, [40, 45]);
	check(
		'60 Hz: a 40 ms frame is no spike, a 45 ms one is',
		at60.overMs === 41.7 && at60.records.length === 1 && at60.records[0].ms === 45,
		JSON.stringify(at60),
	);
	const at120 = drive(8.33, 120, [32, 34]);
	check(
		'120 Hz: a 32 ms frame is no spike, a 34 ms one is',
		at120.overMs === 33 && at120.records.length === 1 && at120.records[0].ms === 34,
		JSON.stringify(at120),
	);
	check('the state is kept', at120.records[0].state === 'idle');
}

console.log('causes');
const cause = (intervalMs: number, prev: FrameWork, cur?: FrameWork, heapDropMb?: number) =>
	classifySpike({ intervalMs, prev, cur, heapDropMb });
{
	const c = cause(80, work({ compiles: 3 }));
	check('a compile in the frame before is a first use', c.cause === 'first use', c.why);
	const u = cause(80, light, work({ uploadBytes: 2e6 }));
	check('2 MB uploaded by the frame itself is a first use', u.cause === 'first use', u.why);
	const small = cause(80, work({ uploadBytes: 0.5e6, tickMs: 4 }), work({ uploadBytes: 0.5e6 }));
	check('half a MB a frame is not', small.cause !== 'first use', small.cause);
}
{
	// 80 ms; JS 64 (80%): particles 45, render 10, tick code 5, page 4.
	const p = cause(
		80,
		work({ lateMs: 1, tickMs: 60, renderMs: 10, afterMs: 3, jsMs: 64, particleMs: 45 }),
	);
	check('particles: the largest part, 70% of the JS', p.cause === 'particles', p.why);
	// JS 55: rigs 40 + 2 sync, page 5, render 4, tick code 4.
	const r = cause(
		80,
		work({ lateMs: 1, tickMs: 10, renderMs: 6, afterMs: 50, jsMs: 55, rigMs: 40, rigSyncMs: 2 }),
	);
	check('rigs: updates and mesh rebuilds, the largest part', r.cause === 'rigs', r.why);
	const page = cause(80, work({ lateMs: 1, tickMs: 10, renderMs: 5, afterMs: 50, jsMs: 55 }));
	check('page JS: most of the JS ran outside the Pixi tick', page.cause === 'page JS', page.why);
	// Headless Chrome drawing on the CPU: ~140 ms after each tick, the commit waiting on the GPU.
	const gpu = cause(150, work({ lateMs: 1, tickMs: 5, renderMs: 4, afterMs: 140, jsMs: 6 }));
	check(
		'busy after the tick but not in JS is outside the game, not page JS',
		gpu.cause === 'outside the game' && gpu.why.includes('busy 140 ms outside JS'),
		gpu.why,
	);
	const code = cause(80, work({ tickMs: 60, renderMs: 20, particleMs: 5, afterMs: 2, jsMs: 62 }));
	check(
		'game code: the tick, with its other ms given',
		code.cause === 'game code' && code.why.includes('tick code 35 ms'),
		code.why,
	);
	const notLargest = cause(80, work({ tickMs: 70, renderMs: 5, particleMs: 30, jsMs: 71 }));
	check(
		'particles behind the tick code are not named',
		notLargest.cause === 'game code',
		notLargest.why,
	);
	// JS 70: particles 20 (29%), render 18, tick code 17, page 15.
	const thin = cause(
		80,
		work({ lateMs: 5, tickMs: 55, renderMs: 18, afterMs: 10, jsMs: 70, particleMs: 20 }),
	);
	check('particles largest but under 40% of the JS are not named', thin.cause === 'game code');
	const gc = cause(100, work({ tickMs: 15, afterMs: 5, jsMs: 16 }), light, 8);
	check('GC: the heap fell 8 MB while little JS ran', gc.cause === 'GC (likely)', gc.why);
	const gcSmall = cause(100, work({ tickMs: 15, afterMs: 5, jsMs: 16 }), light, 3);
	check('…not for 3 MB', gcSmall.cause === 'outside the game');
	const out = cause(100, work({ tickMs: 8, afterMs: 2, jsMs: 10 }));
	check('outside the game: JS under 40% of the interval', out.cause === 'outside the game');
	check('…and says how much', out.why === 'JS 10% of it', out.why);
	const mixed = cause(100, work({ tickMs: 40, renderMs: 10, afterMs: 9, jsMs: 50 }));
	check('mixed: JS for half of it', mixed.cause === 'mixed', mixed.why);
}

console.log('records');
{
	const rec = createSpikeRecorder();
	const heavy = work({ tickMs: 60, renderMs: 8, particleMs: 50, particles: 3200, emitters: 4 });
	rec.work(heavy);
	rec.frame(2000, 70, 41.7, true, 'bet', 1.5);
	let s = rec.snapshot(41.7);
	check(
		'a spike reads its cause off the frame before it, before its own work is in',
		s.records.length === 1 && s.records[0].cause === 'particles' && !s.records[0].cur,
		JSON.stringify(s.records),
	);
	check('…and counts in the summary already', s.causes.spinning.particles === 1);
	rec.work(work({ particleMs: 0.3 }));
	s = rec.snapshot(41.7);
	check(
		'its own work joins it a frame later',
		s.records[0].cur?.particleMs === 0.3 && s.records[0].prev.particles === 3200,
		JSON.stringify(s.records[0]),
	);
	check('a spinning spike counts under spinning', s.causes.spinning.particles === 1);

	const quiet = createSpikeRecorder();
	quiet.work(light);
	quiet.frame(2000, 70, 41.7, false, undefined, 1);
	quiet.work(heavy);
	const q = quiet.snapshot(41.7).records[0];
	check(
		"the frame's own heavy work does not explain its interval",
		q.cause === 'outside the game' && q.cur?.particleMs === 50,
		JSON.stringify(q),
	);

	const none = createSpikeRecorder();
	none.frame(2000, 70, 41.7, false, undefined, 1);
	check('no spike is recorded before any work has come in', !none.snapshot(41.7).records.length);
}
{
	const rec = createSpikeRecorder();
	let t = 1000;
	for (let i = 0; i < 40; i++) {
		rec.work(light);
		t += 50;
		rec.frame(t, 50, 41.7, i % 4 === 0, undefined, i);
	}
	rec.work(light);
	const s = rec.snapshot(41.7);
	const total = Object.values(s.causes.idle).reduce((a, b) => a + (b ?? 0), 0);
	const spun = Object.values(s.causes.spinning).reduce((a, b) => a + (b ?? 0), 0);
	check(
		`only the latest ${SPIKE_RULES.keep} records are kept`,
		s.records.length === 30 && s.records[0].at === 10,
		String(s.records.length),
	);
	check('the summary counts all 40, idle and spinning apart', total === 30 && spun === 10);
	check('the most common cause is named', topCause(s.causes)?.[0] === 'outside the game');
	rec.reset();
	const r = rec.snapshot(41.7);
	check('Reset clears records and counts', !r.records.length && !topCause(r.causes));
	rec.frame(t + 50, 50, 41.7, false, undefined, 0);
	check(
		'…and keeps the last frame, so the next spike still has its previous one',
		rec.snapshot(41.7).records.length === 1,
	);
}
{
	const rec = createSpikeRecorder();
	rec.work(work({ heapMb: 120 }));
	rec.work(work({ heapMb: 121, tickMs: 10 }));
	rec.frame(5000, 100, 41.7, false, undefined, 3);
	rec.longTask(4980, 60);
	rec.work(work({ heapMb: 110 }));
	const s = rec.snapshot(41.7).records[0];
	check(
		'the heap drop across the interval is read from the frame before it to the frame itself',
		s.heapDropMb === 10 && s.cause === 'GC (likely)',
		JSON.stringify(s),
	);
	check(
		'a long task overlapping the interval is given in ms',
		s.longtask === 20,
		String(s.longtask),
	);
}
{
	const c = compactFrame(work({ tickMs: 12.345, uploadBytes: 1_234_567, gpuWaitMs: 0 }));
	check(
		'a record rounds to 0.1 ms, gives uploads in KB and drops zero fields',
		c.tick === 12.3 && c.uploadKb === 1235 && !('gpuWait' in c) && !('rigMs' in c),
		JSON.stringify(c),
	);
	check('the state machine reads as one line', stateLabel({ bet: 'spin' }) === 'bet.spin');
}

if (failures) throw new Error(`perfSpikes.fixture: ${failures} FAILED`);
console.log('\nperfSpikes.fixture: all ok');
