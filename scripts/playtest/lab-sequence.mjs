// The Invisible Profiler lab sequence (P6, docs/design/invisible-profiler.md §6): what a lab run
// plays on a game opened with `?perf=1`, ending in the probe's reading. Written against a SUBSET of
// Playwright's `Page` — `evaluate(expression: string)` and `keyboard.press(key)` — so the same
// sequence runs on the local headless shell (`lab-run.mjs`'s CDP adapter) and, in P7, on a remote
// browser (BrowserStack Automate's real phones) by handing it a real Playwright page.
//
// The sequence, on the real frame clock (never `?ie_determinism`: its clock is virtual, so JS ms
// would read 0):
//   1. boot: wait for the probe (`__IE_PERF__`); a runtime that fell back to stale data stops here;
//   2. warm-up: press Space until a round starts (the first press passes a tap-to-start screen),
//      then wait for idle — the first round's shader compiles and uploads stay out of the reading;
//   3. Reset (`__IE_PERF__('reset')`, which sends nothing);
//   4. idle `idleSeconds`;
//   5. `spins` rounds: press Space, wait for idle, pressing Space again when a round has shown no
//      idle frame for `holdMs` (a big win waiting for Spin, a feature intro waiting for a tap);
//   6. a forced feature, when the caller's `force()` says the mock took the beat;
//   7. `__IE_PERF__('take')`: the reading (the probe's Copy JSON).
// A game with no rounds (free play: arcade, match-3, card) plays steps 1, 3, 4 and 7 only.
//
// Idle is read from the probe itself: `__IE_PERF__()` (no action) is the reading so far, whose
// phases count frames as the game is idle, spinning or presenting a round. Idle = two polls in a row
// where only idle frames grew. Each poll builds the whole report on the game's thread (~1 a second),
// a cost every run pays alike: it can lift JS ms a little, never the draw or GL-call counts.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PHASES = `(() => {
	if (typeof window.__IE_PERF__ !== 'function') return null;
	const r = JSON.parse(window.__IE_PERF__());
	return { idle: r.idle?.frames ?? 0, spinning: r.spinning?.frames ?? 0, round: r.round?.frames ?? 0 };
})()`;

export const LAB_DEFAULTS = {
	idleSeconds: 20,
	spins: 10,
	bootMs: 240_000,
	/** A round (or the warm-up) that is not idle again after this long fails the run. */
	roundMs: 240_000,
	/** Press Space again after this long without idle: a hold waiting for Spin. */
	holdMs: 25_000,
	pollMs: 1000,
};

export class LabRunError extends Error {}

/**
 * Plays the lab sequence on `page` (booting or booted with `?perf=1`) and returns the reading.
 * `rounds: false` for a game with no rounds; `force()` resolves true when a feature was forced for
 * the next round; `log(line)` is told each step.
 */
export async function playLabSequence(page, options = {}) {
	const o = { ...LAB_DEFAULTS, rounds: true, log: () => {}, ...options };
	const phases = () => page.evaluate(PHASES);
	const press = () => page.keyboard.press('Space');
	const run = { holds: 0, spins: 0, feature: 'not tried', presses: 0 };

	const booted = Date.now();
	for (;;) {
		const stale = await page.evaluate('window.__IE_RUNTIME_STALE__ ?? null').catch(() => null);
		if (stale) {
			throw new LabRunError(`the runtime fell back to stale data: ${JSON.stringify(stale)}`);
		}
		const p = await phases().catch(() => null);
		if (p && p.idle + p.spinning + p.round > 0) break;
		if (Date.now() - booted > o.bootMs) throw new LabRunError('the probe never reported a frame');
		await sleep(o.pollMs);
	}
	o.log(`booted in ${Math.round((Date.now() - booted) / 1000)} s`);

	/** Space until a round starts (spinning or round frames grow); false after `tries` presses. */
	const startRound = async (tries) => {
		for (let i = 0; i < tries; i++) {
			const before = await phases();
			await press();
			run.presses++;
			const until = Date.now() + 8000;
			while (Date.now() < until) {
				await sleep(o.pollMs / 2);
				const now = await phases();
				if (now.spinning > before.spinning || now.round > before.round) return true;
			}
		}
		return false;
	};
	/** Until only idle frames grow, twice in a row; Space past a hold every `holdMs`. */
	const waitIdle = async () => {
		const started = Date.now();
		let pressed = Date.now();
		let quiet = 0;
		let last = await phases();
		while (quiet < 2) {
			await sleep(o.pollMs);
			const now = await phases();
			const busy = now.spinning > last.spinning || now.round > last.round;
			// A hold: the round goes on with no idle frame at all (a round just ending shows both).
			const held = now.round > last.round && now.idle === last.idle;
			quiet = !busy && now.idle > last.idle ? quiet + 1 : 0;
			last = now;
			if (Date.now() - started > o.roundMs) throw new LabRunError('a round never ended');
			if (held && Date.now() - pressed > o.holdMs) {
				await press();
				run.holds++;
				pressed = Date.now();
			}
		}
	};

	if (o.rounds) {
		if (!(await startRound(6))) throw new LabRunError('Space never started a round');
		await waitIdle();
		o.log('warm-up round done');
	} else {
		await press();
		await sleep(5000);
	}

	await page.evaluate("window.__IE_PERF__('reset')");
	await sleep(o.idleSeconds * 1000);
	o.log(`idle ${o.idleSeconds} s`);

	if (o.rounds) {
		for (let i = 0; i < o.spins; i++) {
			if (!(await startRound(3))) throw new LabRunError(`spin ${i + 1} never started`);
			await waitIdle();
			run.spins++;
		}
		o.log(`${run.spins} spins (${run.holds} hold presses)`);
		if (o.force) {
			const forced = await o.force();
			run.feature = forced === true ? 'forced' : forced || 'not supported';
			if (forced === true) {
				if (!(await startRound(3))) throw new LabRunError('the forced round never started');
				await waitIdle();
				o.log('forced feature round done');
			}
		}
	}

	const text = await page.evaluate("window.__IE_PERF__('take')");
	return { text, run };
}
