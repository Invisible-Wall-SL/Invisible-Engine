/**
 * Offline fixture for how the loader's GPU warm-up spreads over frames (`warmupSchedule.ts`, run by
 * `gpuWarmup.ts`) — run with:
 *   node --experimental-strip-types packages/pixi-svelte/fixtures/warmupSchedule.fixture.ts
 *
 * Pins: every step runs once, in order; a frame takes steps until 8 ms of main-thread time, 8 MB of
 * texture data or one program compile, whichever comes first; a step over a budget on its own still
 * runs, alone, as its frame's first; an upload may share a frame with one compile; a step that
 * throws is skipped and the rest still run; the progress rises with every step, by bytes and
 * programs, and ends at exactly 1; a compressed page counts its levels' bytes, any other source
 * four bytes a pixel. The frame wait gives up after 50 ms only while no frame comes (a hidden tab,
 * an offscreen iframe); a frame that comes, even after its wait gave up (a slow phone's first
 * upload frame), makes the next waits hold up to 1 s for the frame instead of packing it, and a wait
 * that gives up makes the next one short again. A lifted budget (the harness's determinism mode)
 * runs every step in one frame.
 */

import {
	FRAMELESS_WAIT_MS,
	FRAME_WAIT_MS,
	WARMUP_FRAME_BUDGET,
	createFrameWait,
	runWarmup,
	setWarmupFrameBudget,
	sourceBytes,
	stepWeight,
	type WarmupStep,
} from '../src/lib/warmupSchedule.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	if (ok) console.log(`  ok  ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
	}
};

const MB = 1024 * 1024;

/** Runs `plan` on a fake clock; each step advances it by its `ms`. Returns the steps per frame. */
async function frames(
	plan: { ms?: number; bytes?: number; compiles?: boolean; throws?: boolean }[],
	progress?: number[],
): Promise<{ frames: number[][]; ran: number[] }> {
	let now = 0;
	let frame = 0;
	const out: number[][] = [[]];
	const ran: number[] = [];
	const steps: WarmupStep[] = plan.map((p, i) => ({
		bytes: p.bytes,
		compiles: p.compiles,
		run: () => {
			now += p.ms ?? 0;
			ran.push(i);
			out[frame].push(i);
			if (p.throws) throw new Error(`step ${i}`);
		},
	}));
	await runWarmup(
		steps,
		{
			now: () => now,
			nextFrame: async () => {
				frame += 1;
				out[frame] = [];
				now += 16;
			},
		},
		{ onProgress: (done) => progress?.push(done) },
	);
	return { frames: out, ran };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function main(): Promise<void> {
	console.log('budget');
	check(
		'8 ms, 8 MB and one program a frame',
		WARMUP_FRAME_BUDGET.ms === 8 &&
			WARMUP_FRAME_BUDGET.bytes === 8 * MB &&
			WARMUP_FRAME_BUDGET.compiles === 1,
	);

	console.log('time');
	{
		const { frames: f } = await frames([{ ms: 3 }, { ms: 3 }, { ms: 3 }, { ms: 3 }, { ms: 3 }]);
		check(
			'3 ms steps: three a frame (9 ms reaches the budget)',
			same(f, [
				[0, 1, 2],
				[3, 4],
			]),
			JSON.stringify(f),
		);
	}
	{
		const { frames: f } = await frames([{ ms: 30 }, { ms: 1 }, { ms: 1 }]);
		check('a 30 ms step runs alone in its frame', same(f, [[0], [1, 2]]), JSON.stringify(f));
	}

	console.log('bytes');
	{
		const { frames: f } = await frames([
			{ bytes: 3 * MB },
			{ bytes: 3 * MB },
			{ bytes: 3 * MB },
			{ bytes: 2 * MB },
		]);
		check(
			'3 MB pages: two a frame (9 MB would pass 8)',
			same(f, [
				[0, 1],
				[2, 3],
			]),
			JSON.stringify(f),
		);
	}
	{
		const { frames: f } = await frames([{ bytes: 1 * MB }, { bytes: 16 * MB }, { bytes: 1 * MB }]);
		check('a 16 MB page waits for a frame of its own', same(f, [[0], [1], [2]]), JSON.stringify(f));
	}
	{
		const { frames: f } = await frames([{ bytes: 4 * MB }, { bytes: 4 * MB }, { bytes: 1 }]);
		check('exactly 8 MB fits, one byte more does not', same(f, [[0, 1], [2]]), JSON.stringify(f));
	}

	console.log('compiles');
	{
		const { frames: f } = await frames([
			{ compiles: true },
			{ compiles: true },
			{ compiles: true },
		]);
		check('one program a frame', same(f, [[0], [1], [2]]), JSON.stringify(f));
	}
	{
		const { frames: f } = await frames([{ bytes: 1 * MB }, { compiles: true }, { compiles: true }]);
		check('an upload and one program share a frame', same(f, [[0, 1], [2]]), JSON.stringify(f));
	}

	console.log('failures');
	{
		const warn = console.warn;
		const warned: unknown[] = [];
		console.warn = (...args: unknown[]) => warned.push(args);
		const { ran } = await frames([{}, { throws: true }, {}]);
		console.warn = warn;
		check('a throwing step is skipped and the rest run', same(ran, [0, 1, 2]), JSON.stringify(ran));
		check('the failure is reported', warned.length === 1);
	}

	console.log('order');
	{
		const plan = [
			{ bytes: 16 * MB },
			{ ms: 9 },
			{ bytes: 2 * MB },
			{ compiles: true },
			{ compiles: true, ms: 2 },
			{},
		];
		const { frames: f, ran } = await frames(plan);
		check('every step runs once, in order', same(ran, [0, 1, 2, 3, 4, 5]), JSON.stringify(ran));
		check(
			'frames follow the first budget each step meets',
			same(f, [[0], [1], [2, 3], [4, 5]]),
			JSON.stringify(f),
		);
	}
	{
		const { frames: f } = await frames([]);
		check('no steps: no frame waited for', same(f, [[]]), JSON.stringify(f));
	}

	console.log('progress');
	{
		const progress: number[] = [];
		await frames([{ bytes: 8 * MB }, { compiles: true }, {}, { bytes: 1 * MB }], progress);
		check('one report a step', progress.length === 4, JSON.stringify(progress));
		check(
			'rises with every step',
			progress.every((p, i) => i === 0 || p > progress[i - 1]),
			JSON.stringify(progress),
		);
		check('ends at exactly 1', progress.at(-1) === 1, JSON.stringify(progress));
		check(
			'an 8 MB page weighs more than a program, a program more than a bare step',
			stepWeight({ run: () => {}, bytes: 8 * MB }) >
				stepWeight({ run: () => {}, compiles: true }) &&
				stepWeight({ run: () => {}, compiles: true }) > stepWeight({ run: () => {} }),
		);
	}

	console.log('source bytes');
	check(
		'an uncompressed 2048² page is 16 MB',
		sourceBytes({ resource: {}, pixelWidth: 2048, pixelHeight: 2048 }) === 16 * MB,
	);
	check(
		'a compressed page counts its levels',
		sourceBytes({
			resource: [new Uint8Array(1000), new Uint8Array(250), new Uint8Array(63)],
			pixelWidth: 2048,
			pixelHeight: 2048,
		}) === 1313,
	);

	console.log('frame wait');
	{
		let clock = 0;
		const timers = new Map<number, { at: number; run: () => void }>();
		let frames: (() => void)[] = [];
		let ids = 0;
		const waits: number[] = [];
		const wait = createFrameWait({
			requestFrame: (run) => void frames.push(run),
			setTimer: (run, ms) => {
				waits.push(ms);
				timers.set(++ids, { at: clock + ms, run });
				return ids;
			},
			clearTimer: (id) => void timers.delete(id),
		});
		/** Advance the clock to `ms`, running due timers; `frameAt` delivers the pending frames then. */
		const advance = async (ms: number, frameAt?: number) => {
			for (; clock < ms; clock++) {
				if (frameAt === clock) {
					const due = frames;
					frames = [];
					for (const run of due) run();
				}
				for (const [id, t] of [...timers]) if (t.at <= clock && timers.delete(id)) t.run();
				await Promise.resolve();
			}
		};
		let done = false;
		const start = () => wait().then(() => (done = true));
		let pending = start();
		await advance(49);
		check('no frame yet: still waiting at 49 ms', !done);
		await advance(51);
		await pending;
		check('no frame: gives up at 50 ms', done && waits[0] === FRAMELESS_WAIT_MS);
		done = false;
		pending = start();
		await advance(80, 66);
		await pending;
		check('a frame that comes ends the wait', done && waits[1] === FRAMELESS_WAIT_MS);
		done = false;
		pending = start();
		await advance(330);
		check('once frames come, a 250 ms frame is waited for', !done && waits[2] === FRAME_WAIT_MS);
		await advance(340, 330);
		await pending;
		check('…and ends when it comes', done);
		done = false;
		pending = start();
		await advance(1400);
		await pending;
		check('frames that stop: gives up after 1 s', done && waits[3] === FRAME_WAIT_MS);
		done = false;
		pending = start();
		await advance(1460);
		check('…then back to 50 ms', done && waits[4] === FRAMELESS_WAIT_MS);
		await advance(2500);
		await pending;
		done = false;
		pending = start();
		await advance(2560);
		await pending;
		check('a slow first frame: the wait gives up at 50 ms', done && waits[5] === FRAMELESS_WAIT_MS);
		await advance(2580, 2566);
		done = false;
		pending = start();
		await advance(2700);
		check(
			'…but the frame that comes late makes the next wait the long one',
			!done && waits[6] === FRAME_WAIT_MS,
		);
		await advance(2720, 2700);
		await pending;
	}

	console.log('lifted budget');
	{
		setWarmupFrameBudget({ ms: Infinity, bytes: Infinity, compiles: Infinity });
		const { frames: f } = await frames([
			{ bytes: 16 * MB, ms: 40 },
			{ compiles: true },
			{ compiles: true },
		]);
		check('every step in one frame', same(f, [[0, 1, 2]]), JSON.stringify(f));
		setWarmupFrameBudget(WARMUP_FRAME_BUDGET);
		const { frames: g } = await frames([{ compiles: true }, { compiles: true }]);
		check('the default budget back: one program a frame', same(g, [[0], [1]]), JSON.stringify(g));
	}

	if (failures) throw new Error(`warmupSchedule fixture: ${failures} check(s) FAILED`);
	console.log('\nwarmupSchedule fixture: ok');
}

/** A wait that never settles must fail the fixture, not end it quietly. */
const watchdog = setTimeout(() => {
	throw new Error('warmupSchedule fixture: a wait never settled');
}, 10_000);
void main().then(() => clearTimeout(watchdog));
