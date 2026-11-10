/**
 * Offline fixture for the render-quality controller (`renderQuality.ts`) — run with:
 *   node --experimental-strip-types packages/pixi-svelte/fixtures/renderQuality.fixture.ts
 *
 * Pins, on simulated frame feeds: the ladder each pixel ratio gets (never below 1, duplicates
 * dropped, the MSAA step only where it can switch); steady 60 Hz and 120 Hz mixed 8.3/16.7 ms
 * frames stay at the top; idle, hidden and settling frames never count, nor intervals over 250 ms;
 * the 21 ms and 10% boundaries; two slow windows step down, only after 20 quiet frames in a row
 * (which may be measured frames too: autoplay's stopped reels); a trial that helps (half the slow
 * share, or a mean frame interval 20% shorter) keeps its level, one that does not (dipping under
 * 10% is not enough) reverts and stops stepping down, each verdict kept for the readout; a
 * browser's 30 fps rhythm never adapts (Low Power Mode caps idle frames too) while rounds at 30 on
 * a device that idles at 60, a device slower than 30 (an iPhone 13 Pro at 14 fps) or a jittery
 * 25–45 ms one do; the floor holds; a step up after 30 good windows is a trial that backs off and
 * is never retried; at most 6 switches, the sixth only a revert.
 */

import {
	QUALITY_RULES as RULES,
	createRenderQualityController,
	qualityLadder,
	type QualityFrame,
	type QualityLevel,
} from '../src/lib/renderQuality.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	if (ok) console.log(`  ok  ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
	}
};

const PLAYING: QualityFrame = { measuring: true, quiet: false, visible: true };
const IDLE: QualityFrame = { measuring: false, quiet: true, visible: true };
const LOADING: QualityFrame = { measuring: false, quiet: false, visible: true };
const HIDDEN: QualityFrame = { measuring: true, quiet: false, visible: false };
const FRAME_60 = 16.7;
const SLOW_MS = 33.3;
const SPIN_FRAMES = 150;
const BETWEEN_SPINS = 40;

const show = (ladder: readonly QualityLevel[]) =>
	ladder.map((l) => `${l.resolution}${l.msaa ? 'm' : ''}`).join(' ');
const PHONE = qualityLadder(3, { msaa: true, msaaSwitchable: true });

/**
 * A device under the controller. `slowAt(level)` is how many of every 120 measured frames run late
 * at that level, spread evenly, so any 120 frames in a row hold exactly that many.
 */
function device(ladder: readonly QualityLevel[] = PHONE) {
	const controller = createRenderQualityController(ladder);
	let measured = 0;
	const sim = {
		controller,
		frames: 0,
		switchedAt: [] as number[],
		level: () => controller.snapshot().level.index,
		history: () => controller.snapshot().history,
		feed(intervalMs: number, state: QualityFrame) {
			sim.frames++;
			const next = controller.frame(intervalMs, state);
			if (next) {
				sim.switchedAt.push(sim.frames);
				if (next !== ladder[sim.level()]) throw new Error('returned level is not the current one');
			}
		},
		play(frames: number, slowAt: (level: number) => number, slowMs = SLOW_MS) {
			for (let i = 0; i < frames; i++) {
				const n = slowAt(sim.level());
				const late =
					Math.floor(((measured + 1) * n) / RULES.windowFrames) >
					Math.floor((measured * n) / RULES.windowFrames);
				measured++;
				sim.feed(late ? slowMs : FRAME_60, PLAYING);
			}
		},
		/** `frames` measured frames whose intervals `intervalAt(level, k)` gives. */
		run(frames: number, intervalAt: (level: number, k: number) => number) {
			for (let i = 0; i < frames; i++) sim.feed(intervalAt(sim.level(), measured++), PLAYING);
		},
		idle(frames: number, intervalMs = FRAME_60) {
			for (let i = 0; i < frames; i++) sim.feed(intervalMs, IDLE);
		},
		spins(
			count: number,
			intervalAt: (level: number, k: number) => number,
			idleMs: number = FRAME_60,
		) {
			for (let i = 0; i < count; i++) {
				sim.run(SPIN_FRAMES, intervalAt);
				sim.idle(BETWEEN_SPINS, idleMs);
			}
		},
		rounds(count: number, slowAt: (level: number) => number, slowMs = SLOW_MS) {
			for (let i = 0; i < count; i++) {
				sim.play(SPIN_FRAMES, slowAt, slowMs);
				sim.idle(BETWEEN_SPINS);
			}
		},
	};
	return sim;
}

const at =
	(...perLevel: number[]) =>
	(level: number) =>
		perLevel[Math.min(level, perLevel.length - 1)];
const trail = (sim: ReturnType<typeof device>) =>
	sim
		.history()
		.map((s) => `${s.from}->${s.to} ${s.reason} ${s.slowShare}`)
		.join(', ');

console.log('ladder');
check('DPR 3: 2, 1.75, 1.5, 1.5 without MSAA', show(PHONE) === '2m 1.75m 1.5m 1.5', show(PHONE));
const ladderOf = (dpr: number, msaa = true, msaaSwitchable = true) =>
	show(qualityLadder(dpr, { msaa, msaaSwitchable }));
check('DPR 2: the same four', ladderOf(2) === '2m 1.75m 1.5m 1.5');
check('DPR 1.75: three', ladderOf(1.75) === '1.75m 1.5m 1.5', ladderOf(1.75));
check('DPR 1.5: the top and the MSAA step only', ladderOf(1.5) === '1.5m 1.5', ladderOf(1.5));
check('DPR 1: MSAA is the only step', ladderOf(1) === '1m 1', ladderOf(1));
check('DPR 0.75 never goes below 1', ladderOf(0.75) === '1m 1', ladderOf(0.75));
check('an unreadable DPR counts as 1', ladderOf(Number.NaN) === '1m 1', ladderOf(Number.NaN));
check(
	'no back-buffer MSAA switch: resolution steps only',
	ladderOf(3, true, false) === '2m 1.75m 1.5m',
	ladderOf(3, true, false),
);
check('MSAA off from the start (?aa=0)', ladderOf(3, false) === '2 1.75 1.5', ladderOf(3, false));
check('DPR 1 with nothing to switch: one level', ladderOf(1, true, false) === '1m');
check(
	'no level below resolution 1, ever',
	[0.5, 1, 1.25, 1.5, 2, 2.625, 3, 4].every((dpr) =>
		qualityLadder(dpr, { msaa: true, msaaSwitchable: true }).every((l) => l.resolution >= 1),
	),
);

console.log('\nkeeping up');
{
	const sim = device();
	for (let i = 0; i < 60; i++) {
		for (let f = 0; f < SPIN_FRAMES; f++) sim.feed(f % 2 ? 16.2 : 17.2, PLAYING);
		sim.idle(BETWEEN_SPINS);
	}
	check('steady 60 Hz stays at the top', sim.history().length === 0, trail(sim));
}
{
	const sim = device();
	const pattern = [8.3, 16.7, 8.3, 8.3, 16.7, 16.7, 8.4];
	for (let i = 0; i < 60; i++) {
		for (let f = 0; f < SPIN_FRAMES; f++) sim.feed(pattern[f % pattern.length], PLAYING);
		sim.idle(BETWEEN_SPINS);
	}
	check('120 Hz mixed 8.3/16.7 ms stays at the top', sim.history().length === 0, trail(sim));
}
{
	const sim = device();
	sim.rounds(60, at(12));
	check('12 late frames in 120 (10%) is not slow', sim.history().length === 0, trail(sim));
	const over = device();
	over.rounds(2, at(13));
	check('13 in 120 is slow', over.history()[0]?.reason === 'slow', trail(over));
}
{
	const sim = device();
	for (let i = 0; i < 60; i++) {
		for (let f = 0; f < SPIN_FRAMES; f++) sim.feed(21, PLAYING);
		sim.idle(BETWEEN_SPINS);
	}
	check('a 21 ms frame is not slow', sim.history().length === 0, trail(sim));
	const over = device();
	for (let i = 0; i < 2; i++) {
		for (let f = 0; f < SPIN_FRAMES; f++) over.feed(21.5, PLAYING);
		over.idle(BETWEEN_SPINS);
	}
	check('a 21.5 ms frame is', over.history()[0]?.reason === 'slow', trail(over));
}

console.log('\nwhat never counts');
{
	const sim = device();
	sim.idle(5000, 40);
	for (let i = 0; i < 2000; i++) sim.feed(40, LOADING);
	sim.rounds(10, at(0));
	sim.idle(200);
	check('slow idle and loading frames never count', sim.history().length === 0, trail(sim));
}
{
	const sim = device();
	for (let i = 0; i < 2000; i++) sim.feed(40, HIDDEN);
	sim.idle(200);
	check('a hidden page never counts', sim.history().length === 0, trail(sim));
}
{
	const sim = device();
	for (let i = 0; i < 60; i++) {
		for (let f = 0; f < SPIN_FRAMES; f++) sim.feed(f % 4 === 0 ? 400 : FRAME_60, PLAYING);
		sim.idle(BETWEEN_SPINS);
	}
	check('intervals over 250 ms are not frames', sim.history().length === 0, trail(sim));
}

console.log('\n30 fps cap or a slow device');
const cycle = (values: number[]) => (_level: number, k: number) => values[k % values.length];
/** An iPhone 13 Pro spinning at 14 fps (2026-11-09): ~71 ms frames with jitter. */
const IPHONE_14FPS = [60, 85, 66, 75, 71, 92, 58, 64];
{
	const sim = device();
	// Low Power Mode caps every frame, idle ones too.
	sim.idle(BETWEEN_SPINS, 33.3);
	sim.spins(80, cycle([33.3, 33.4, 33.2, 33.3, 33.3, 33.4, 33.3, 33.2, 33.3, 66.7]), 33.3);
	check(
		'a steady 33.3 ms Low Power Mode rhythm is ignored',
		sim.history().length === 0,
		trail(sim),
	);
}
{
	const sim = device();
	sim.idle(BETWEEN_SPINS);
	sim.spins(2, cycle([33.3, 33.4, 33.2, 33.3, 33.3, 33.4, 33.3, 33.2, 33.3, 66.7]));
	check(
		'rounds at a steady 30 fps on a device that idles at 60 are judged and step down',
		sim.history()[0]?.reason === 'slow' && sim.level() === 1,
		trail(sim),
	);
}
{
	const sim = device();
	sim.idle(BETWEEN_SPINS);
	sim.idle(Math.ceil(RULES.uncappedMemoryMs / 33.3) + 1, 33.3);
	sim.spins(4, cycle([33.3, 33.4, 33.2, 33.3, 33.3, 33.4, 33.3, 33.2, 33.3, 66.7]), 33.3);
	check(
		'a cap that starts mid-session is ignored once no fast frame came for 30 s',
		sim.history().length === 0,
		trail(sim),
	);
}
{
	const sim = device();
	sim.spins(2, cycle(IPHONE_14FPS));
	check(
		'14 fps with jitter (no frame under 28 ms) is judged and steps down',
		sim.history()[0]?.reason === 'slow' && sim.level() === 1,
		trail(sim),
	);
}
{
	const sim = device();
	sim.spins(2, cycle([25, 30, 35, 40, 45, 27, 33, 38, 43, 29]));
	check(
		'a jittery 25–45 ms window is judged and steps down',
		sim.history()[0]?.reason === 'slow',
		trail(sim),
	);
}
{
	const sim = device();
	sim.controller.visibilityChanged();
	sim.play(2 * RULES.windowFrames + RULES.settleFrames - 1, at(36));
	sim.idle(BETWEEN_SPINS);
	const before = sim.history().length;
	sim.play(1, at(36));
	sim.idle(BETWEEN_SPINS);
	check(
		'the 30 frames after the page is shown are not counted',
		before === 0 && sim.history().length === 1,
		`${before} then ${sim.history().length}`,
	);
}

console.log('\nstepping down');
{
	const sim = device();
	sim.play(2 * RULES.windowFrames, at(36));
	sim.play(600, at(36));
	const mid = sim.history().length;
	for (let i = 0; i < 300; i++) sim.feed(FRAME_60, LOADING);
	sim.idle(19);
	sim.feed(FRAME_60, LOADING);
	const interrupted = sim.history().length;
	const before = sim.frames;
	sim.idle(30);
	check('two slow windows decide, but nothing switches mid-round', mid === 0);
	check('nor in a quiet run cut short', interrupted === 0);
	check(
		'the switch lands on the 20th quiet frame in a row',
		sim.switchedAt[0] === before + RULES.quietFrames,
		`at ${sim.switchedAt[0] - before}`,
	);
	const first = sim.history()[0];
	check(
		'one level down, for being slow, on the windows it saw',
		sim.level() === 1 && first?.reason === 'slow' && first.slowShare === 0.3,
		trail(sim),
	);
}
{
	const sim = device();
	sim.play(2 * RULES.windowFrames - 1, at(36));
	sim.idle(200);
	check('one window short of two decides nothing', sim.history().length === 0);
}
{
	const sim = device();
	sim.rounds(40, at(36, 6));
	const trials = sim.controller.snapshot().trials;
	check(
		'a trial that helps keeps its level',
		sim.level() === 1 && sim.history().length === 1,
		trail(sim),
	);
	check(
		'and its verdict is in the readout as kept',
		trials.length === 1 && trials[0].kept && trials[0].after.slowShare === 0.05,
		JSON.stringify(trials),
	);
}
{
	const sim = device();
	// The Nothing Phone (1), 2026-11-10: 13% slow at 17.8 ms; at 1.75 a trial can dip under 10%
	// by chance while the frames are no shorter.
	sim.rounds(40, at(18, 11));
	const trials = sim.controller.snapshot().trials;
	check(
		'a trial that only dips under 10% (15% → 9%, frames 5% shorter) reverts',
		sim.level() === 0 && sim.history()[1]?.reason === 'no gain',
		trail(sim),
	);
	check(
		'and its verdict is in the readout with both measures',
		trials.length === 1 &&
			!trials[0].kept &&
			!trials[0].up &&
			trials[0].level === 1 &&
			trials[0].before.slowShare === 0.15 &&
			trials[0].after.slowShare === 0.09,
		JSON.stringify(trials),
	);
}
{
	const sim = device();
	sim.rounds(80, at(36));
	const steps = sim.history();
	check(
		'a trial that does not help reverts',
		steps.length === 2 && steps[1].reason === 'no gain' && steps[1].to === 0 && sim.level() === 0,
		trail(sim),
	);
	check(
		'and stepping down stops for the session',
		sim.controller.snapshot().downStopped && sim.history().length === 2,
	);
}
{
	const sim = device();
	// Late frames of 45 ms: 90% of them at 33.3 ms would be a 30 fps rhythm, read as a cap.
	sim.rounds(120, at(108, 54, 27, 13), 45);
	check(
		'a kept level that is still slow steps down again, to the floor and no further',
		sim.level() === PHONE.length - 1 && sim.history().length === PHONE.length - 1,
		trail(sim),
	);
	const flat = device(qualityLadder(1, { msaa: true, msaaSwitchable: true }));
	flat.rounds(80, at(60, 24));
	check(
		'a DPR-1 desktop only drops MSAA, at resolution 1',
		flat.level() === 1 && flat.controller.snapshot().level.resolution === 1,
		trail(flat),
	);
	const single = device(qualityLadder(1, { msaa: true, msaaSwitchable: false }));
	single.rounds(80, at(60));
	check('a one-level ladder never switches', single.history().length === 0);
}

{
	const sim = device();
	sim.spins(40, (level, k) => (level === 0 ? IPHONE_14FPS[k % 8] : k % 2 ? 25 : 41.7));
	check(
		'14 → 30 fps keeps the step though every frame is still slow',
		trail(sim) === '0->1 slow 1, 1->2 slow 1, 2->1 no gain 1' && sim.level() === 1,
		trail(sim),
	);
	const flat = device();
	flat.spins(40, (level, k) => (level === 0 ? IPHONE_14FPS[k % 8] : [60, 70, 66, 72, 65][k % 5]));
	check(
		'14 → 15 fps reverts',
		trail(flat) === '0->1 slow 1, 1->0 no gain 1' && flat.level() === 0,
		trail(flat),
	);
}
{
	const sim = device();
	let switchedQuiet: boolean | undefined;
	for (let f = 0; f < 3000 && switchedQuiet === undefined; f++) {
		const stopped = f % SPIN_FRAMES >= 100;
		const next = sim.controller.frame(f % 3 ? FRAME_60 : SLOW_MS, {
			measuring: true,
			quiet: stopped,
			visible: true,
		});
		if (next) switchedQuiet = stopped;
	}
	check(
		'frames both measured and quiet (autoplay with the reels stopped) switch there',
		switchedQuiet === true,
		String(switchedQuiet),
	);
}

console.log('\nstepping up');
{
	// Idle stretches longer than the settle, so every played frame counts and windows line up.
	const hot = at(36, 0);
	const pause = RULES.quietFrames + RULES.settleFrames;
	const sim = device();
	sim.play(2 * RULES.windowFrames, hot);
	sim.idle(pause);
	sim.play(RULES.trialWindows * RULES.windowFrames, hot);
	sim.idle(pause);
	sim.play((RULES.goodWindows - 1) * RULES.windowFrames, hot);
	sim.idle(pause);
	const before = sim.history().length;
	sim.play(RULES.windowFrames, hot);
	sim.idle(pause);
	const steps = sim.history();
	check('29 good windows after a kept step down are not enough', before === 1, trail(sim));
	check(
		'the 30th tries one level up',
		steps[1]?.reason === 'headroom' && steps[1].from === 1 && steps[1].to === 0,
		trail(sim),
	);
	sim.play(RULES.windowFrames, hot);
	sim.idle(pause);
	const back = sim.history()[2];
	check(
		'which, slow in its first window, backs off',
		back?.reason === 'slow again' && back.to === 1 && sim.level() === 1,
		trail(sim),
	);
	sim.rounds(100, hot);
	check('and is never tried again', sim.history().length === 3, trail(sim));
}
{
	const sim = device();
	sim.rounds(6, at(36, 0));
	sim.rounds(40, at(0));
	const steps = sim.history();
	check(
		'a step up that stays good is kept',
		steps.length === 2 && steps[1].reason === 'headroom' && sim.level() === 0,
		trail(sim),
	);
}
{
	const sim = device();
	sim.rounds(6, at(36, 2));
	sim.rounds(60, at(36, 2));
	check(
		'2 late frames in 120 is not a good window: no step up',
		sim.history().length === 1 && sim.level() === 1,
		trail(sim),
	);
	const one = device();
	one.rounds(6, at(36, 1));
	one.rounds(40, at(0, 1));
	check('1 in 120 is', one.history().length === 2 && one.level() === 0, trail(one));
}

console.log('\nswitch cap');
{
	// A device that heats up (slow at the top, fine one level down) and cools off, by turns.
	const hot = at(36, 0);
	const cool = at(0);
	const sim = device();
	for (const [phase, rounds] of [hot, cool, hot, cool, hot, cool, hot, cool].map(
		(phase, i) => [phase, i % 2 ? 40 : 6] as const,
	))
		sim.rounds(rounds, phase);
	check(
		'a trial is only started while its revert still fits under 6',
		sim.history().length === 5 &&
			sim.history().every((s, i) => s.reason === (i % 2 ? 'headroom' : 'slow')),
		trail(sim),
	);
	const worse = device();
	for (const [phase, rounds] of [
		[hot, 6],
		[cool, 40],
		[hot, 6],
		[cool, 40],
		[at(36, 36), 12],
		[cool, 40],
		[hot, 6],
	] as const)
		worse.rounds(rounds, phase);
	const steps = worse.history();
	check(
		'never more than 6 switches, and the sixth is a revert',
		steps.length === RULES.maxSwitches && steps[5].reason === 'no gain',
		trail(worse),
	);
}

console.log('\nreadout');
{
	const sim = device();
	sim.rounds(6, at(36, 0));
	const snap = sim.controller.snapshot();
	const step = snap.history[0];
	check(
		'the snapshot names the mode, the level and each switch',
		snap.mode === 'adaptive' &&
			snap.levels === 4 &&
			snap.level.index === 1 &&
			snap.level.resolution === 1.75 &&
			snap.level.msaa &&
			step.at > 0 &&
			step.from === 0 &&
			step.to === 1 &&
			step.frameMs > FRAME_60,
		JSON.stringify(snap),
	);
	snap.history.length = 0;
	check('a snapshot is a copy', sim.controller.snapshot().history.length === 1);
}

if (failures) throw new Error(`renderQuality fixture: ${failures} check(s) FAILED`);
console.log('\nrenderQuality fixture: ok');
