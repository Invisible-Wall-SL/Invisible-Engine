/**
 * Offline fixture for the render-quality controller (`renderQuality.ts`) — run with:
 *   node --experimental-strip-types packages/pixi-svelte/fixtures/renderQuality.fixture.ts
 *
 * Pins, on simulated frame feeds: the ladder each pixel ratio gets (never below 1, duplicates
 * dropped, the MSAA step only where it can switch, the effects step last and only there); steady
 * 60 Hz and 120 Hz mixed 8.3/16.7 ms frames stay at the top; idle, hidden and settling frames never
 * count, nor intervals over 250 ms; the 21 ms and 10% boundaries; two slow windows step down, only
 * after 20 quiet frames in a row (which may be measured frames too: autoplay's stopped reels); a
 * trial that helps (half the slow share, or a mean frame interval 20% shorter) keeps its level, one
 * that does not (dipping under 10% is not enough) reverts, each verdict kept for the readout; the
 * second chance after it (four slow windows, then a walk from past the level that did not help,
 * one level at a time, kept at the first level that helps, back to its start and stopped when none
 * does, each stepped-on level so marked): a device just over the line keeps its effects, one slow
 * at every resolution reaches the effects level even after earlier spells spent the switches (two
 * are held for it), and 15 windows under 1% slow give a waiting second chance back; a browser's
 * 30 fps rhythm never adapts (Low Power Mode caps idle frames too) while rounds at 30 on a device
 * that idles at 60, a device slower than 30 (an iPhone 13 Pro at 14 fps) or a jittery 25–45 ms one
 * do; the floor holds; a step up after 30 good windows is a trial that backs off and is never
 * retried; at most 12 switches, the last only a revert. And the effects wiring of
 * `installRenderQuality` on a stand-in app: the effects are lowered and given back only on a
 * change (down to the last level, up from it, down again), and its teardown gives them back.
 */

import {
	LOW_EFFECTS_PARTICLES,
	QUALITY_RULES as RULES,
	configureRenderQuality,
	createRenderQualityController,
	installRenderQuality,
	qualityLadder,
	renderQualitySnapshot,
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
	ladder.map((l) => `${l.resolution}${l.msaa ? 'm' : ''}${l.postFx ? '' : '-fx'}`).join(' ');
const PHONE = qualityLadder(3, { msaa: true, msaaSwitchable: true });

/**
 * A device under the controller. `slowAt(level)` is how many of every 120 measured frames run late
 * at that level, spread evenly, so any 120 frames in a row hold exactly that many.
 */
function device(ladder: readonly QualityLevel[] = PHONE, secondChance = true) {
	const controller = createRenderQualityController(ladder, { secondChance });
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
check(
	'DPR 3: 2, 1.75, 1.5, 1.5 without MSAA, 1.25, 1, 1 with the effects lowered',
	show(PHONE) === '2m 1.75m 1.5m 1.5 1.25 1 1-fx',
	show(PHONE),
);
const ladderOf = (dpr: number, msaa = true, msaaSwitchable = true) =>
	show(qualityLadder(dpr, { msaa, msaaSwitchable }));
check('DPR 2: the same seven', ladderOf(2) === '2m 1.75m 1.5m 1.5 1.25 1 1-fx', ladderOf(2));
check('DPR 1.75: six', ladderOf(1.75) === '1.75m 1.5m 1.5 1.25 1 1-fx', ladderOf(1.75));
check('DPR 1.5: five', ladderOf(1.5) === '1.5m 1.5 1.25 1 1-fx', ladderOf(1.5));
check('DPR 1.25: four', ladderOf(1.25) === '1.25m 1.25 1 1-fx', ladderOf(1.25));
check('DPR 1: MSAA, then the effects', ladderOf(1) === '1m 1 1-fx', ladderOf(1));
check('DPR 0.75 never goes below 1', ladderOf(0.75) === '1m 1 1-fx', ladderOf(0.75));
check('an unreadable DPR counts as 1', ladderOf(Number.NaN) === '1m 1 1-fx', ladderOf(Number.NaN));
check(
	'no back-buffer MSAA switch: resolution and effects steps only',
	ladderOf(3, true, false) === '2m 1.75m 1.5m 1.25m 1m 1m-fx',
	ladderOf(3, true, false),
);
check(
	'MSAA off from the start (?aa=0)',
	ladderOf(3, false) === '2 1.75 1.5 1.25 1 1-fx',
	ladderOf(3, false),
);
check(
	'DPR 1 with nothing to switch: the effects step only',
	ladderOf(1, true, false) === '1m 1m-fx',
	ladderOf(1, true, false),
);
check(
	'only the last level lowers the effects, to a particle cap of 0.5',
	[0.75, 1, 1.5, 2, 3].every((dpr) =>
		[true, false].every((msaaSwitchable) => {
			const ladder = qualityLadder(dpr, { msaa: true, msaaSwitchable });
			return ladder.every((l, i) =>
				i === ladder.length - 1
					? !l.postFx && l.particleCap === LOW_EFFECTS_PARTICLES && l.resolution === 1
					: l.postFx && l.particleCap === 1,
			);
		}),
	),
);
check('the effects level caps particles at 0.5', LOW_EFFECTS_PARTICLES === 0.5);
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
		// The first step's trial, then one per level of the walk: L2 to L6, the last one reverted.
		trials.length === 6 &&
			trials.slice(1, -1).every((t) => !t.kept && t.steppedOn) &&
			!trials[5].steppedOn &&
			!trials[0].steppedOn &&
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
		steps[1]?.reason === 'no gain' && steps[1].to === 0,
		trail(sim),
	);
	check(
		'then the second chance walks down the ladder, and when no level helps, back to the top, ' +
			'and stepping down stops for the session',
		trail(sim) ===
			'0->1 slow 0.3, 1->0 no gain 0.3, 0->2 second chance 0.3, 2->3 second chance 0.3, ' +
				'3->4 second chance 0.3, 4->5 second chance 0.3, 5->6 second chance 0.3, ' +
				'6->0 no gain 0.3' &&
			sim.level() === 0 &&
			sim.controller.snapshot().downStopped &&
			sim.controller.snapshot().secondChance === 'taken',
		trail(sim),
	);
}

console.log('\nthe second chance');
{
	// `engine-3d` walks its own ladder with this controller, without the second chance.
	const sim = device(PHONE, false);
	sim.rounds(80, at(36));
	check(
		'without the option a step down that does not help stops, as before',
		trail(sim) === '0->1 slow 0.3, 1->0 no gain 0.3' &&
			sim.controller.snapshot().downStopped &&
			sim.controller.snapshot().secondChance === undefined,
		trail(sim),
	);
	const hot = at(36, 0);
	const capped = device(PHONE, false);
	for (let i = 0; i < 2 * RULES.maxSwitches; i++)
		capped.rounds(i % 2 ? 40 : 6, i % 2 ? at(0) : hot);
	check(
		`and switches at most ${RULES.maxSwitchesSingleTry} times`,
		capped.history().length === RULES.maxSwitchesSingleTry - 1,
		trail(capped),
	);
}
{
	// Idle stretches longer than the settle, so every played frame counts and windows line up.
	const hot = at(36);
	const pause = RULES.quietFrames + RULES.settleFrames;
	const sim = device();
	sim.play(RULES.slowWindows * RULES.windowFrames, hot);
	sim.idle(pause);
	sim.play(RULES.trialWindows * RULES.windowFrames, hot);
	sim.idle(pause);
	const reverted = trail(sim);
	const waiting = sim.controller.snapshot();
	sim.play((RULES.retrySlowWindows - 1) * RULES.windowFrames, hot);
	sim.idle(pause);
	const short = sim.history().length;
	sim.play(RULES.windowFrames, hot);
	sim.idle(pause);
	check(
		'a step down that did not help leaves the second chance waiting, not a stop',
		reverted === '0->1 slow 0.3, 1->0 no gain 0.3' &&
			waiting.secondChance === 'waiting' &&
			!waiting.downStopped,
		`${reverted} ${waiting.secondChance}`,
	);
	check(
		'three slow windows after the revert are not enough (twice what a first step needs)',
		short === 2,
		trail(sim),
	);
	check(
		'the fourth steps past the level that did not help, keeping the effects (2 is not 1)',
		sim.history()[2]?.reason === 'second chance' &&
			sim.history()[2].from === 0 &&
			sim.history()[2].to === 2 &&
			sim.controller.snapshot().level.postFx === true,
		trail(sim),
	);
}
{
	// The Nothing Phone (1) as BUG-20's review read it: 13% slow at the top, the first step no
	// help, each lower resolution a little lighter and the effects level lightest of all.
	const sim = device();
	sim.rounds(80, at(16, 15, 14, 9, 6, 3, 0));
	const snap = sim.controller.snapshot();
	check(
		'a device just over the line stops at the first level that helps and keeps its effects',
		trail(sim) ===
			'0->1 slow 0.13, 1->0 no gain 0.13, 0->2 second chance 0.13, 2->3 second chance 0.12, ' +
				'3->4 second chance 0.08' &&
			sim.level() === 4 &&
			snap.level.resolution === 1.25 &&
			snap.level.postFx === true &&
			snap.level.particleCap === 1 &&
			snap.trials.at(-1)?.kept === true,
		trail(sim),
	);
}
{
	// Pixels are not what costs (every resolution as slow as the top); the effects are (BUG-20's
	// Mali-G57 phone).
	const sim = device();
	sim.rounds(60, at(36, 36, 36, 36, 36, 36, 0));
	const trials = sim.controller.snapshot().trials;
	check(
		'a device slow at every resolution walks to the effects level and keeps it',
		trail(sim).startsWith(
			'0->1 slow 0.3, 1->0 no gain 0.3, 0->2 second chance 0.3, 2->3 second chance 0.3, ' +
				'3->4 second chance 0.3, 4->5 second chance 0.3, 5->6 second chance 0.3',
		) &&
			trials[5]?.kept === true &&
			trials[5].level === 6 &&
			trials[5].before.slowShare === 0.3 &&
			sim.controller.snapshot().level.postFx === false,
		trail(sim),
	);
	sim.rounds(100, at(36, 36, 36, 36, 36, 36, 0));
	check(
		'from there a step up that goes slow backs off, and is tried again only after twice the wait',
		trail(sim).endsWith(
			'5->6 second chance 0.3, 6->5 headroom 0, 5->6 slow again 0.3, 6->5 headroom 0, ' +
				'5->6 slow again 0.3',
		) &&
			sim.history().length === 11 &&
			sim.level() === 6,
		trail(sim),
	);
}
{
	// The review's fuzz: a warm spell's climb from the effects level fails, then the device cools
	// off for good. The failed level is tried again, so the session ends with its effects back.
	const sim = device();
	sim.rounds(60, at(36, 36, 36, 36, 36, 36, 0));
	const warm = trail(sim);
	const waiting = sim.controller.snapshot().stepUp;
	sim.rounds(300, at(0));
	const snap = sim.controller.snapshot();
	check(
		'a failed climb from the effects level is tried again once the device cools off',
		warm.endsWith('6->5 headroom 0, 5->6 slow again 0.3') &&
			waiting?.level === 5 &&
			waiting.failures === 1 &&
			waiting.goodWindows === 2 * RULES.goodWindows &&
			snap.level.index < PHONE.length - 1 &&
			snap.level.postFx === true &&
			snap.level.particleCap === 1 &&
			sim.history().length <= RULES.maxSwitches,
		`${trail(sim)} ${JSON.stringify(waiting)}`,
	);
}
{
	// Always too slow one level up, fine at the effects level ('1m 1m-fx': one switch down, so
	// only the cap and the backoff bound the tries): each wait twice the last, within the cap.
	const sim = device(qualityLadder(1, { msaa: true, msaaSwitchable: false }));
	sim.rounds(1000, at(36, 0));
	const steps = sim.history();
	const tries = steps.filter((s) => s.reason === 'headroom').map((s) => s.at);
	const gaps = tries.slice(1).map((t, i) => t - tries[i]);
	check(
		'a device always too slow one level up retries it at most once per doubling, within the cap',
		steps.length <= RULES.maxSwitches &&
			tries.length === 4 &&
			gaps.every((gap, i) => i === 0 || gap >= 1.8 * gaps[i - 1]) &&
			steps.every((s) => ['slow', 'headroom', 'slow again'].includes(s.reason)) &&
			sim.level() === 1,
		`${trail(sim)} gaps ${gaps.map((g) => g.toFixed(0)).join(', ')} s`,
	);
}
{
	// A DPR-1 screen: a step to 1 without MSAA that did not help leaves only the effects to try.
	const sim = device(qualityLadder(1, { msaa: true, msaaSwitchable: true }));
	sim.rounds(40, at(36, 36, 0));
	check(
		'from resolution 1 the second chance steps straight to the effects level',
		trail(sim).startsWith('0->1 slow 0.3, 1->0 no gain 0.3, 0->2 second chance 0.3') &&
			sim.level() === 2,
		trail(sim),
	);
}
{
	// A device that recovers after the revert (the particle budget caught up) never gets there.
	const pause = RULES.quietFrames + RULES.settleFrames;
	const hot = at(36);
	const sim = device();
	sim.play(RULES.slowWindows * RULES.windowFrames, hot);
	sim.idle(pause);
	sim.play(RULES.trialWindows * RULES.windowFrames, hot);
	sim.idle(pause);
	const waiting = sim.controller.snapshot().secondChance;
	sim.play((RULES.retryGoodWindows - 1) * RULES.windowFrames, at(0));
	sim.idle(pause);
	const short = sim.controller.snapshot().secondChance;
	sim.play(RULES.windowFrames, at(0));
	sim.idle(pause);
	const back = sim.controller.snapshot().secondChance;
	check(
		'a device that recovers after a revert takes no second chance',
		waiting === 'waiting' && short === 'waiting' && back === 'unused' && sim.level() === 0,
		`${waiting} ${short} ${back} ${trail(sim)}`,
	);
	// A heavy bonus long after: a first step, as on a device that never needed the second chance.
	sim.rounds(6, at(36, 0));
	check(
		'15 windows under 1% slow give it back unused: a later slow spell starts from a first step',
		trail(sim) === '0->1 slow 0.3, 1->0 no gain 0.3, 0->1 slow 0.3' && sim.level() === 1,
		trail(sim),
	);
}
{
	// One second chance a session: once it is taken, a step down that does not help stops.
	const sim = device();
	sim.rounds(20, at(36, 36, 0));
	const kept = sim.level();
	// The device cools off and climbs back to the top, one kept step up at a time.
	sim.rounds(100, at(0));
	const climbed = sim.level();
	sim.rounds(80, at(36));
	check(
		'one second chance a session: a later step down that does not help stops',
		kept === 2 &&
			climbed === 0 &&
			trail(sim) ===
				'0->1 slow 0.3, 1->0 no gain 0.3, 0->2 second chance 0.3, 2->1 headroom 0, ' +
					'1->0 headroom 0, 0->1 slow 0.3, 1->0 no gain 0.3' &&
			sim.level() === 0 &&
			sim.controller.snapshot().downStopped &&
			sim.controller.snapshot().secondChance === 'taken' &&
			sim.history().length <= RULES.maxSwitches,
		trail(sim),
	);
}
{
	const sim = device();
	// Late frames of 45 ms: 90% of them at 33.3 ms would be a 30 fps rhythm, read as a cap. The
	// share halves down to 1.5 without MSAA, then 1.25 and 1 do not help and the walk goes on.
	sim.rounds(160, at(108, 54, 27, 13, 13, 13, 0), 45);
	check(
		'a 90%-late 45 ms device is judged at every level on its way to the floor',
		trail(sim).startsWith(
			'0->1 slow 0.9, 1->2 slow 0.45, 2->3 slow 0.23, 3->4 slow 0.11, 4->3 no gain 0.11, ' +
				'3->5 second chance 0.11, 5->6 second chance 0.11',
		) && sim.level() === PHONE.length - 1,
		trail(sim),
	);
}
{
	const sim = device();
	// Every frame slow at every level, each level's frames 22% shorter than the one above.
	sim.spins(120, (level) => 100 * 0.78 ** level);
	check(
		'a kept level that is still slow steps down again, to the floor and no further',
		sim.level() === PHONE.length - 1 &&
			sim.history().length === PHONE.length - 1 &&
			sim.history().every((s) => s.reason === 'slow'),
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
	check(
		'the effects step alone, when it does not help, reverts with no second chance',
		trail(single) === '0->1 slow 0.5, 1->0 no gain 0.5' && single.controller.snapshot().downStopped,
		trail(single),
	);
}

{
	const sim = device();
	sim.spins(40, (level, k) => (level === 0 ? IPHONE_14FPS[k % 8] : k % 2 ? 25 : 41.7));
	check(
		'14 → 30 fps keeps the step though every frame is still slow',
		trail(sim) ===
			'0->1 slow 1, 1->2 slow 1, 2->1 no gain 1, 1->3 second chance 1, 3->4 second chance 1, ' +
				'4->5 second chance 1, 5->6 second chance 1, 6->1 no gain 1' && sim.level() === 1,
		trail(sim),
	);
	const flat = device();
	flat.spins(40, (level, k) => (level === 0 ? IPHONE_14FPS[k % 8] : [60, 70, 66, 72, 65][k % 5]));
	check(
		'14 → 15 fps reverts',
		trail(flat) ===
			'0->1 slow 1, 1->0 no gain 1, 0->2 second chance 1, 2->3 second chance 1, ' +
				'3->4 second chance 1, 4->5 second chance 1, 5->6 second chance 1, 6->0 no gain 1' &&
			flat.level() === 0,
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
	sim.play((2 * RULES.goodWindows - 1) * RULES.windowFrames, hot);
	sim.idle(pause);
	const waited = sim.history().length;
	sim.play(RULES.windowFrames, hot);
	sim.idle(pause);
	check(
		'and is tried again after twice the good windows, not one sooner',
		waited === 3 && sim.history()[3]?.reason === 'headroom' && sim.history()[3].to === 0,
		trail(sim),
	);
	const single = device(PHONE, false);
	single.rounds(400, hot);
	check(
		'without the second chance (engine-3d) a level that went slow is never tried again',
		trail(single) === '0->1 slow 0.3, 1->0 headroom 0, 0->1 slow again 0.3' &&
			single.level() === 1 &&
			single.controller.snapshot().stepUp?.goodWindows === Infinity,
		trail(single),
	);
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
	for (const [phase, rounds] of Array.from({ length: 2 * RULES.maxSwitches }, (_, i) =>
		i % 2 ? ([cool, 40] as const) : ([hot, 6] as const),
	))
		sim.rounds(rounds, phase);
	check(
		`a trial is only started while its revert still fits under ${RULES.maxSwitches}, less the ` +
			"second chance's two",
		sim.history().length === RULES.maxSwitches - 3 &&
			sim.history().every((s, i) => s.reason === (i % 2 ? 'headroom' : 'slow')),
		trail(sim),
	);
	const worse = device();
	// Heat and cool by turns until only the second chance's two switches are left, then slow at
	// every level: the second chance takes them, to the effects level, and its revert is the last.
	const cycles = (RULES.maxSwitches - 2) / 2;
	for (let i = 0; i < cycles; i++) {
		worse.rounds(6, hot);
		worse.rounds(40, cool);
	}
	worse.rounds(80, at(36, 36));
	const steps = worse.history();
	check(
		`never more than ${RULES.maxSwitches} switches, and the last is a revert`,
		steps.length === RULES.maxSwitches &&
			steps.at(-1)?.reason === 'no gain' &&
			steps.at(-2)?.to === PHONE.length - 1,
		trail(worse),
	);
}
for (const cycles of [3, 5]) {
	// Slow spells that one step down did not help, each followed by a recovery that gives the
	// second chance back: they spend the switches, then BUG-20's phone (slow at every resolution).
	const sim = device();
	for (let i = 0; i < cycles; i++) {
		sim.rounds(6, at(36));
		sim.rounds(20, at(0));
	}
	const spent = sim.history().length;
	sim.rounds(100, at(36, 36, 36, 36, 36, 36, 0));
	check(
		`after ${cycles} spells that spent ${spent} switches, a device slow at every resolution ` +
			'still reaches the effects level',
		sim.level() === PHONE.length - 1 &&
			sim.controller.snapshot().level.postFx === false &&
			!sim.controller.snapshot().downStopped &&
			sim.history().length <= RULES.maxSwitches,
		trail(sim),
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
			snap.levels === 7 &&
			snap.level.postFx === true &&
			snap.level.particleCap === 1 &&
			snap.secondChance === 'unused' &&
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
{
	// A fixed level (a deterministic render, a `?render=` pin) has no controller: its readout
	// carries no second chance, as before the ladder had one.
	const undo = configureRenderQuality({
		adaptive: false,
		measuring: () => false,
		quiet: () => true,
	});
	const app = { renderer: { resolution: 2 } } as unknown as Parameters<
		typeof installRenderQuality
	>[0];
	const release = installRenderQuality(app, { tier: 'full', msaa: true });
	const snap = renderQualitySnapshot();
	check(
		'a fixed level reads one level and no second chance',
		snap !== undefined &&
			snap.mode === 'full' &&
			snap.levels === 1 &&
			!snap.downStopped &&
			!('secondChance' in snap),
		JSON.stringify(snap),
	);
	release();
	undo();
}

console.log('\nthe effects wiring');
{
	// A stand-in app (no back buffer, so no MSAA switch) and page; the effects are spies.
	type Tick = (ticker: { elapsedMS: number }) => void;
	const ticks = new Set<Tick>();
	const listeners = new Set<unknown>();
	Object.defineProperty(globalThis, 'document', {
		value: {
			visibilityState: 'visible',
			addEventListener: (_: string, fn: unknown) => listeners.add(fn),
			removeEventListener: (_: string, fn: unknown) => listeners.delete(fn),
		},
		configurable: true,
	});
	const app = {
		renderer: { resolution: 2 },
		ticker: { add: (fn: Tick) => ticks.add(fn), remove: (fn: Tick) => ticks.delete(fn) },
	};
	const calls: string[] = [];
	const effects = {
		suppressPostFx: (suppressed: boolean) => calls.push(`postFx ${suppressed ? 'off' : 'on'}`),
		capParticles: (cap: number) => calls.push(`particles ${cap}`),
	};
	let playing = false;
	const undo = configureRenderQuality({
		adaptive: true,
		measuring: () => playing,
		quiet: () => !playing,
	});
	const install = () =>
		installRenderQuality(app as unknown as Parameters<typeof installRenderQuality>[0], {
			tier: 'full',
			msaa: true,
			effects,
		});
	const release = install();
	const level = () => renderQualitySnapshot()?.level.index ?? -1;
	const levels = renderQualitySnapshot()?.levels ?? 0;
	/** Rounds slow at every level but the last (BUG-20's phone), noting the calls at each switch. */
	const atSwitch: string[] = [];
	let frame = 0;
	for (let round = 0; round < 80 && level() < levels - 1; round++) {
		for (let f = 0; f < SPIN_FRAMES + BETWEEN_SPINS; f++) {
			playing = f < SPIN_FRAMES;
			const slow = playing && level() < levels - 1 && frame++ % 10 < 3;
			const before = level();
			for (const tick of ticks) tick({ elapsedMS: slow ? SLOW_MS : FRAME_60 });
			if (level() !== before) atSwitch.push(`L${level()}: ${calls.splice(0).join(', ')}`);
		}
	}
	const last = `L${levels - 1}: postFx off, particles ${LOW_EFFECTS_PARTICLES}`;
	check(
		'the effects are lowered once, at the switch to the last level, and at no other',
		atSwitch.at(-1) === last &&
			atSwitch.slice(0, -1).every((s) => s.endsWith(': ')) &&
			atSwitch.length > 2 &&
			app.renderer.resolution === 1,
		atSwitch.join(' | '),
	);
	/** Up to `rounds` rounds, `slowOf()` saying if each played frame is late, until `done()`. */
	const drive = (rounds: number, slowOf: () => boolean, done: () => boolean) => {
		for (let round = 0; round < rounds && !done(); round++) {
			for (let f = 0; f < SPIN_FRAMES + BETWEEN_SPINS && !done(); f++) {
				playing = f < SPIN_FRAMES;
				const before = level();
				for (const tick of ticks) tick({ elapsedMS: playing && slowOf() ? SLOW_MS : FRAME_60 });
				if (level() !== before) atSwitch.push(`L${level()}: ${calls.splice(0).join(', ')}`);
			}
		}
	};
	atSwitch.length = 0;
	drive(
		200,
		() => false,
		() => level() < levels - 1,
	);
	check(
		'a step up from the last level gives them back once',
		atSwitch.join(' | ') === `L${levels - 2}: postFx on, particles 1`,
		atSwitch.join(' | '),
	);
	atSwitch.length = 0;
	drive(
		20,
		() => frame++ % 10 < 3,
		() => level() === levels - 1,
	);
	check(
		'and the step back down lowers them once again',
		atSwitch.join(' | ') === last,
		atSwitch.join(' | '),
	);
	release();
	check(
		'teardown gives the post FX back and lifts the particle cap, and unhooks the ticker',
		calls.join(', ') === 'postFx on, particles 1' && ticks.size === 0 && listeners.size === 0,
		calls.join(', '),
	);
	calls.length = 0;
	const untouched = install();
	untouched();
	check('teardown at full effects calls neither', calls.length === 0, calls.join(', '));
	undo();
	Reflect.deleteProperty(globalThis, 'document');
}

if (failures) throw new Error(`renderQuality fixture: ${failures} check(s) FAILED`);
console.log('\nrenderQuality fixture: ok');
