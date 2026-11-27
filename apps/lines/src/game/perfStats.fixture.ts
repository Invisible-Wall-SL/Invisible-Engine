/**
 * Offline fixture for the `?perf=1` readout's numbers (`perfStats.ts`) — run with:
 *   pnpm check:all --only perfStats
 *
 * Pins: the display refresh read off the fastest frames (120 / 60 Hz, through dropped frames);
 * the 30 fps cap flag (iOS Low Power Mode) and only it; idle vs spinning buckets and their hitch
 * counts; a round's frames with the reels at rest in a bucket of their own (boot and idle are not
 * a round, a moving reel in a round is spinning); churn counted per frame like the rest; the reel
 * step error is 0 for a value drawn at interval × speed (through a relayout jump)
 * and shows a value drawn a frame late; a hidden page's gap is not a frame; Reset clears.
 * Arcade phases: a slot feed's snapshot, less what `perf: 10` added (busy time, hidden time, a
 * p95 beside each mean), is byte-for-byte the one recorded before they existed (a hash) and holds
 * nothing arcade; an arcade feed splits into loading, lobby, play and spectate only, its sim,
 * bodies and room counts land in play, the room states' lateness is kept per phase. The cap: a
 * steady 30 fps of light frames is one, a steady 30 fps of frames busier than a 60 Hz frame is not.
 * `perf: 10`: busy time as p50 / p95 per phase against the display's frame period; hidden frames
 * and a throttled page's 1000 ms frames; a p95 beside every work counter's mean; the display's
 * rate from a side loop; GPU time and scene samples summarised.
 */

import { ARCADE_WORK_KEYS } from './arcadePerf.ts';
import { WORK_KEYS, createPerfStats, estimateRefreshHz, framePhase } from './perfStats.ts';
import type { PerfFrameWork } from './perfSpikes.ts';

/** A 53-bit string hash (cyrb53): enough to tell one recorded snapshot from any other. */
const hash53 = (text: string): number => {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < text.length; i++) {
		const ch = text.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
	h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
	h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};

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
		s.capped30 && s.achievedHz === 30,
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
	now = 1000;
	stats.frame(1000, false, []);
	stats.frame(1008, false, []);
	stats.pause();
	// Frames a hidden page still gets (a throttled background tab) are not frames.
	now = 1008;
	stats.frame(2008, false, []);
	stats.frame(3008, false, []);
	now = 9000;
	stats.resume();
	stats.frame(9000, false, []);
	stats.frame(9008, false, []);
	const s = stats.snapshot();
	check(
		'a hidden page’s gap and its throttled frames are not counted as frames',
		s.idle.frames === 2 && s.idle.max === 8 && s.hiddenFrames === 2 && s.hiddenMs === 8000,
		JSON.stringify([s.idle, s.hiddenFrames, s.hiddenMs]),
	);
	check('…and no visible frame was throttled', s.throttledFrames === 0);
	stats.reset();
	check('Reset clears every count', stats.snapshot().idle.frames === 0);
}

{
	const work = (draws: number, passes: number, extra: Record<string, number> = {}) => ({
		calls: draws * 5,
		draws,
		vertices: draws * 6,
		passes,
		targetSwitches: passes,
		resolves: 1,
		invalidations: 0,
		clears: 1,
		copies: 0,
		programs: 1,
		filterGroups: 0,
		filterPasses: 0,
		textureUploads: 0,
		uploadBytes: 0,
		compiles: 0,
		bufferUploads: 0,
		bufferBytes: 0,
		roundTrips: 0,
		renderMs: 1,
		tickMs: 2,
		lateMs: 0,
		afterMs: 1,
		jsMs: 2,
		particleMs: 0,
		particles: 0,
		emitters: 0,
		emitterStarts: 0,
		baked: 0,
		rigMs: 0,
		rigs: 0,
		rigSyncMs: 0,
		created: 0,
		createdContainers: 0,
		createdSprites: 0,
		createdParticles: 0,
		createdTexts: 0,
		createdGraphics: 0,
		createdMeshes: 0,
		createdOther: 0,
		destroyed: 0,
		destroyedContainers: 0,
		destroyedSprites: 0,
		destroyedParticles: 0,
		destroyedTexts: 0,
		destroyedGraphics: 0,
		destroyedMeshes: 0,
		destroyedOther: 0,
		rigsBuilt: 0,
		rigsDestroyed: 0,
		textRenders: 0,
		textMs: 0,
		domAdded: 0,
		domRemoved: 0,
		...extra,
	});
	const stats = createPerfStats(() => 0);
	stats.frame(1000, false, []);
	stats.work(work(1, 3));
	stats.frame(1016, false, []);
	stats.work(work(3, 3));
	stats.frame(1032, true, []);
	stats.work(work(30, 9, { filterPasses: 4, gpuWaitMs: 12 }));
	const s = stats.snapshot();
	const idle = s.work.idle.perFrame;
	const spin = s.work.spinning.perFrame;
	check(
		'work lands in the bucket of the frame that drew it, as a mean and a max',
		s.work.idle.frames === 2 &&
			idle.draws?.mean === 2 &&
			idle.draws?.max === 3 &&
			s.work.spinning.frames === 1 &&
			spin.draws?.mean === 30 &&
			spin.filterPasses?.max === 4,
		JSON.stringify(s.work),
	);
	check(
		'the GPU wait shows only where it was measured',
		idle.gpuWaitMs === undefined && spin.gpuWaitMs?.mean === 12,
		JSON.stringify(s.work),
	);
	stats.reset();
	check('Reset clears the work too', stats.snapshot().work.idle.frames === 0);

	stats.frame(2000, false, [], 'idle');
	stats.work(work(1, 1));
	stats.frame(2016, true, [], 'bet');
	stats.work(work(1, 1, { created: 4, createdSprites: 4 }));
	stats.frame(2032, false, [], 'bet');
	stats.work(work(1, 1, { created: 120, createdContainers: 80, domAdded: 900 }));
	stats.frame(2048, false, [], 'bet');
	stats.work(work(1, 1, { destroyed: 60, textRenders: 2 }));
	stats.frame(2064, false, [], 'idle');
	const r = stats.snapshot();
	check(
		"a round's frames at rest go to the round bucket, its spinning ones to spinning",
		r.idle.frames === 1 && r.spinning.frames === 1 && r.round.frames === 2,
		JSON.stringify([r.idle.frames, r.spinning.frames, r.round.frames]),
	);
	const round = r.work.round.perFrame;
	check(
		'churn is a mean and a max per frame, in the phase of the frame that did it',
		r.work.round.frames === 2 &&
			round.created?.mean === 60 &&
			round.created.max === 120 &&
			round.domAdded?.max === 900 &&
			round.destroyed?.mean === 30 &&
			round.textRenders?.max === 2 &&
			r.work.spinning.perFrame.createdSprites?.mean === 4,
		JSON.stringify(r.work.round.perFrame.created),
	);
}

check('boot is not a round', framePhase(false, 'rendering') === 'idle');
check('autoplay is a round', framePhase(false, 'autoBet') === 'round');
check('no state is idle', framePhase(false, undefined) === 'idle');
check('a moving reel is spinning in any state', framePhase(true, 'idle') === 'spinning');

/** Every key the renderer's probe reports, at a light frame's values. */
const fullWork = (over: Partial<PerfFrameWork> = {}): PerfFrameWork => ({
	...(Object.fromEntries(
		[...WORK_KEYS, 'clears', 'bufferUploads', 'emitterStarts'].map((key) => [key, 0]),
	) as unknown as PerfFrameWork),
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
	bufferUploads: 2,
	bufferBytes: 20000,
	renderMs: 2,
	tickMs: 4,
	lateMs: 0.5,
	afterMs: 1,
	jsMs: 5,
	...over,
});

console.log('a slot reading is what it was before arcade phases');
{
	// The feed `perfStats.ts` was recorded on before the arcade phases (2026-11-26): idle, a spin with
	// a moving reel, a round at rest, spikes of four causes in three phases, a long task, a heap drop.
	// Its snapshot (less the new `set`) must hash to the recording.
	let now = 0;
	const stats = createPerfStats(() => now);
	let t = 1000;
	const reel = { drawn: 0, shift: 0, rate: 2 };
	const spikeAt = [100, 200, 290, 350];
	for (let i = 0; i < 400; i++) {
		const spinning = i >= 150 && i < 260;
		const state = i < 150 ? 'idle' : i < 320 ? 'bet.spinning' : 'idle';
		const k = spikeAt.indexOf(i);
		const ms = k >= 0 ? [120, 120, 90, 70][k] : 16.67 + (i % 3) * 0.2;
		t += ms;
		now = t;
		if (spinning) reel.drawn += reel.rate * ms;
		stats.frame(t, spinning, spinning ? [reel] : [], state);
		const w = fullWork({ draws: 40 + (i % 7), jsMs: 5 + (i % 4), tickMs: 4 + (i % 3) });
		if (i === 99) Object.assign(w, { compiles: 2, uploadBytes: 3e6 });
		if (i === 199)
			Object.assign(w, { jsMs: 100, tickMs: 90, particleMs: 70, particles: 400, emitters: 3 });
		if (i === 289)
			Object.assign(w, {
				jsMs: 60,
				tickMs: 50,
				created: 80,
				createdSprites: 70,
				destroyed: 20,
				destroyedSprites: 20,
			});
		if (i === 349) Object.assign(w, { jsMs: 3, tickMs: 2, lateMs: 30, afterMs: 30, heapMb: 40 });
		if (i === 350) Object.assign(w, { heapMb: 30 });
		if (i === 348) Object.assign(w, { heapMb: 48 });
		stats.work(w);
		if (i === 120) stats.longTask(t - 60, 80);
	}
	const { set, ...full } = stats.snapshot();
	// What `perf: 10` added is stripped, and the achieved rate is `refreshHz` again: the rest must be
	// what was recorded.
	const NEW_KEYS = ['displayHz', 'budgetMs', 'hiddenMs', 'hiddenFrames', 'throttledFrames', 'busy'];
	const rest = Object.fromEntries(
		Object.entries(full)
			.filter(([key]) => !NEW_KEYS.includes(key))
			.map(([key, value]) => [key === 'achievedHz' ? 'refreshHz' : key, value]),
	) as unknown as Omit<typeof full, 'achievedHz'> & { work: Record<string, { perFrame: object }> };
	for (const phase of Object.values(rest.work))
		for (const entry of Object.values(phase.perFrame) as { p95?: number }[]) delete entry.p95;
	const json = JSON.stringify(rest);
	const hash = hash53(json);
	check(
		'the slot snapshot is byte-for-byte the recorded one',
		set === 'slot' && hash === 6309061860972396,
		`${hash}\n       ${json}`,
	);
	check(
		'a slot reading has no arcade phase, count or timing',
		!('menu' in rest) &&
			!('play' in rest) &&
			!('lateMs' in rest) &&
			!ARCADE_WORK_KEYS.some((key) => key in rest.work.idle.perFrame),
	);
}

console.log('arcade phases');
{
	let now = 0;
	const stats = createPerfStats(() => now, 'arcade');
	let t = 1000;
	stats.arcadeFrame(t, 'lobby');
	// 100 lobby frames at 60 Hz, then 200 in play: two bodies spawned, a step a frame, a frame of
	// three steps after a long one, the room's states 0–20 ms late.
	for (let i = 0; i < 300; i++) {
		const play = i >= 100;
		const long = i === 200;
		t += long ? 50 : 16.67;
		now = t;
		stats.arcadeFrame(t, play ? 'play' : 'lobby');
		const steps = !play ? 0 : i === 201 ? 3 : 1;
		stats.work(
			fullWork(
				play
					? {
							simSteps: steps,
							simCatchUp: steps > 1 ? 1 : 0,
							simMs: steps * 0.5,
							bodies: 2,
							spawns: i === 100 ? 2 : 0,
							patches: i % 3 === 0 ? 1 : 0,
							patchBytes: i % 3 === 0 ? 120 : 0,
							netMs: i % 3 === 0 ? 0.3 : 0,
						}
					: { simSteps: 0, bodies: 0 },
			),
		);
		if (play && i % 3 === 0) stats.lates([(i % 21) - 1]);
	}
	const s = stats.snapshot();
	check(
		'an arcade reading is split into loading, lobby, play and spectate, no slot phase',
		s.set === 'arcade' &&
			s.lobby.frames === 100 &&
			s.play.frames === 200 &&
			s.loading.frames === 0 &&
			s.spectate.frames === 0 &&
			!('menu' in s) &&
			!('idle' in s) &&
			!('spinning' in s) &&
			!('reel' in s),
		JSON.stringify({ lobby: s.lobby, play: s.play }),
	);
	const play = s.work.play.perFrame;
	check(
		'its sim, bodies and room counts land in play as a mean and a max',
		play.simSteps?.max === 3 &&
			play.simCatchUp?.mean === 0 &&
			play.bodies?.mean === 2 &&
			play.spawns?.max === 2 &&
			play.patchBytes?.max === 120 &&
			s.work.lobby.perFrame.bodies?.max === 0,
		JSON.stringify(play),
	);
	check(
		'how late the room states came is kept per phase',
		s.lateMs.play.count === 66 && s.lateMs.play.max === 17 && s.lateMs.lobby.count === 0,
		JSON.stringify(s.lateMs),
	);
	check('the 50 ms frame counts in play', s.play.max === 50 && s.play.hitches[33] === 1);
	check('no scene or GPU time was given, none is reported', !('scene' in s) && !('gpuMs' in s));

	let n = 0;
	const phasesSeen = createPerfStats(() => n, 'arcade');
	let u = 0;
	for (const phase of ['loading', 'lobby', 'play', 'spectate'] as const) {
		for (let i = 0; i < 3; i++) {
			u += 16.67;
			n = u;
			phasesSeen.arcadeFrame(u, phase, phase === 'spectate' ? 'running' : undefined);
			phasesSeen.work(fullWork());
		}
	}
	const seen = phasesSeen.snapshot();
	check(
		'a frame counts in the phase it was given, loading and spectate included',
		seen.loading.frames === 2 &&
			seen.lobby.frames === 3 &&
			seen.play.frames === 3 &&
			seen.spectate.frames === 3,
		JSON.stringify([
			seen.loading.frames,
			seen.lobby.frames,
			seen.play.frames,
			seen.spectate.frames,
		]),
	);
}

console.log('busy time, not fps');
{
	// 600 frames: busy 8 ms for most, 15 for one in five, 40 for one in a hundred, at 60 Hz.
	let now = 0;
	const stats = createPerfStats(() => now, 'arcade');
	let t = 1000;
	stats.arcadeFrame(t, 'play');
	for (let i = 0; i < 600; i++) {
		t += 16.67;
		now = t;
		stats.arcadeFrame(t, 'play');
		const busyMs = i % 100 === 0 ? 40 : i % 5 === 0 ? 15 : 8;
		stats.work(fullWork({ lateMs: 0, tickMs: busyMs - 1, afterMs: 1 }));
	}
	const s = stats.snapshot();
	const near = (a: number, b: number) => Math.abs(a - b) <= 0.03 * b + 0.05;
	check(
		'busy is p50 / p95 / max per phase over late + tick + after',
		s.busy.play.frames === 600 &&
			near(s.busy.play.p50, 8) &&
			near(s.busy.play.p95, 15) &&
			s.busy.play.max === 40 &&
			s.busy.lobby.frames === 0,
		JSON.stringify(s.busy),
	);
	check('the budget is the 60 Hz frame', s.budgetMs === 16.7, String(s.budgetMs));
	const tick = s.work.play.perFrame.tickMs;
	check(
		'every work counter has a p95 over the whole reading beside its mean and max',
		!!tick && near(tick.p95, 14) && tick.max === 39 && tick.mean > 6 && tick.mean < 9,
		JSON.stringify(tick),
	);
}
{
	// The reading's p95 is over every frame, not the last window's.
	let now = 0;
	const stats = createPerfStats(() => now, 'arcade');
	let t = 1000;
	stats.arcadeFrame(t, 'play');
	for (let i = 0; i < 3000; i++) {
		t += 16.67;
		now = t;
		stats.arcadeFrame(t, 'play');
		stats.work(fullWork({ lateMs: 0, tickMs: i < 1000 ? 30 : 5, afterMs: 0 }));
	}
	const busy = stats.snapshot().busy.play;
	check(
		'busy p95 covers the whole reading, past the percentile window',
		busy.frames === 3000 && busy.p95 > 25,
		JSON.stringify(busy),
	);
}

{
	// A counter that never moves reads the same p95 as its mean: a bucket's middle never shows.
	let now = 0;
	const stats = createPerfStats(() => now, 'arcade');
	let t = 1000;
	stats.arcadeFrame(t, 'play');
	for (let i = 0; i < 200; i++) {
		t += 16.67;
		now = t;
		stats.arcadeFrame(t, 'play');
		stats.work(fullWork({ draws: 100, lateMs: 0, tickMs: 7, afterMs: 0 }));
	}
	const s = stats.snapshot();
	const draws = s.work.play.perFrame.draws;
	check(
		'a constant counter and a constant busy time have p95 = mean = max',
		draws?.mean === 100 && draws.p95 === 100 && draws.max === 100 && s.busy.play.p95 === 7,
		JSON.stringify([draws, s.busy.play]),
	);
}

console.log('display rate, hidden and throttled frames');
{
	// A game that runs at 30 on a 60 Hz display: the achieved rate is 30, the side loop reads 60.
	let now = 0;
	const stats = createPerfStats(() => now, 'arcade');
	let t = 1000;
	stats.arcadeFrame(t, 'play');
	for (let i = 0; i < 200; i++) {
		t += 33.33;
		now = t;
		stats.arcadeFrame(t, 'play');
		stats.work(fullWork({ tickMs: 20, lateMs: 0, afterMs: 2 }));
	}
	let d = 0;
	for (let i = 0; i < 120; i++) {
		d += i % 10 === 0 ? 33.3 : 16.67;
		stats.displayFrame(d);
	}
	const s = stats.snapshot();
	check(
		'the achieved rate and the display rate are told apart',
		s.achievedHz === 30 && s.displayHz === 60 && s.budgetMs === 16.7,
		JSON.stringify([s.achievedHz, s.displayHz, s.budgetMs]),
	);
	stats.reset();
	check(
		'Reset keeps the display rate',
		stats.snapshot().displayHz === 60 && stats.snapshot().play.frames === 0,
	);
}
{
	// A throttled background tab: 1000 ms frames. They are bucketed (the page was visible) and counted.
	let now = 0;
	const stats = createPerfStats(() => now, 'arcade');
	let t = 1000;
	stats.arcadeFrame(t, 'play');
	for (let i = 0; i < 40; i++) {
		t += 1004;
		now = t;
		stats.arcadeFrame(t, 'play');
		stats.work(fullWork({ tickMs: 1, lateMs: 0, afterMs: 0 }));
	}
	const s = stats.snapshot();
	check(
		'a page throttled to 1 s frames reads p50 ~1000 ms and counts them',
		s.play.p50 > 900 && s.throttledFrames === 40 && s.hiddenMs === 0,
		JSON.stringify([s.play.p50, s.throttledFrames, s.hiddenMs]),
	);
}
{
	// Hidden for 10 s with frames still ticking: not in any bucket or work.
	let now = 0;
	const stats = createPerfStats(() => now, 'arcade');
	let t = 1000;
	stats.arcadeFrame(t, 'play');
	for (let i = 0; i < 10; i++) {
		t += 16.67;
		now = t;
		stats.arcadeFrame(t, 'play');
		stats.work(fullWork());
	}
	stats.pause();
	for (let i = 0; i < 10; i++) {
		t += 1000;
		now = t;
		stats.arcadeFrame(t, 'play');
		stats.work(fullWork({ tickMs: 500 }));
	}
	stats.resume();
	for (let i = 0; i < 10; i++) {
		t += 16.67;
		now = t;
		stats.arcadeFrame(t, 'play');
		stats.work(fullWork());
	}
	const s = stats.snapshot();
	check(
		'frames while hidden are in no bucket, no work and no busy time',
		s.play.frames === 19 &&
			s.work.play.frames === 20 &&
			s.busy.play.max < 20 &&
			s.hiddenFrames === 10 &&
			s.hiddenMs > 9900 &&
			s.throttledFrames === 0,
		JSON.stringify([
			s.play.frames,
			s.work.play.frames,
			s.busy.play.max,
			s.hiddenFrames,
			s.hiddenMs,
		]),
	);
}

console.log('GPU time and scene samples');
{
	let now = 0;
	const stats = createPerfStats(() => now, 'arcade');
	let t = 1000;
	stats.arcadeFrame(t, 'play');
	for (let i = 0; i < 70; i++) {
		t += 16.67;
		now = t;
		stats.arcadeFrame(t, 'play');
		stats.work(fullWork());
		if (i > 3) stats.gpuTime(10 + (i % 5));
		if (i % 30 === 0)
			stats.scene({
				nodes: 1000 + i,
				renderables: 900,
				visible: 100,
				culled: 800,
				renderGroups: 2,
				walkMs: 0.5,
				layers: [
					{
						label: 'river',
						nodes: 900,
						renderables: 800,
						visible: 40,
						culled: 760,
						filters: 0,
						renderGroup: true,
						cost: { draws: 6, passes: 1, filterPasses: 0, targetSwitches: 1 },
					},
					{
						label: 'bodies',
						nodes: 100,
						renderables: 100,
						visible: 60,
						culled: 40,
						filters: 5,
						renderGroup: false,
					},
				],
				rest: { draws: 4, passes: 2, filterPasses: 8, targetSwitches: 3 },
			});
	}
	const s = stats.snapshot();
	check(
		'GPU time is a spread per phase where a timer query gave it',
		s.gpuMs?.play.count === 66 && s.gpuMs.play.max === 14 && s.gpuMs.lobby.count === 0,
		JSON.stringify(s.gpuMs),
	);
	const river = s.scene?.layers.find((l) => l.label === 'river');
	check(
		'scene samples are kept as means by layer, with the render-group layers’ own cost',
		s.scene?.samples === 3 &&
			s.scene.latest.nodes === 1060 &&
			river?.draws === 6 &&
			river.renderGroup &&
			s.scene.layers.find((l) => l.label === 'bodies')?.draws === undefined &&
			s.scene.rest.filterPasses === 8,
		JSON.stringify(s.scene),
	);
	stats.reset();
	check(
		'Reset clears the scene samples and GPU time',
		!stats.snapshot().scene && !stats.snapshot().gpuMs,
	);
}

console.log('a 30 fps cap is the browser only when the frames could have run faster');
{
	const capped = (busyMs: number) => {
		let now = 0;
		const stats = createPerfStats(() => now);
		let t = 1000;
		stats.frame(t, false, []);
		for (let i = 0; i < 120; i++) {
			t += 33.3 + (i % 2 ? 0.2 : -0.2);
			now = t;
			stats.frame(t, false, []);
			stats.work(fullWork({ lateMs: 1, tickMs: busyMs - 2, afterMs: 1 }));
		}
		return stats.snapshot().capped30;
	};
	check('light frames (5 ms) held at 30 fps: a cap (Low Power Mode)', capped(5));
	check(
		'frames of 25 ms held at 30 fps on a 60 Hz display: no cap, the game missed 60',
		!capped(25),
	);
}

if (failures) throw new Error(`perfStats.fixture: ${failures} FAILED`);
console.log('\nperfStats.fixture: all ok');
