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
// A game with no rounds (free play: arcade, match-3, card) plays steps 1, 3, 4 and 7 only. An ONLINE
// arcade game with a room is played by `playArcadeLabSequence` at the end of this file instead
// (`salmons-lab.mjs`).
//
// Idle is read from the probe itself: `__IE_PERF__()` (no action) is the reading so far, whose
// phases count frames as the game is idle, spinning or presenting a round. Idle = two polls in a row
// where only idle frames grew. Each poll builds the whole report on the game's thread (~1 a second),
// a cost every run pays alike: it can lift JS ms a little, never the draw or GL-call counts.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// An arcade game's reading (`perf: 8`, `kind: 'arcade'`) has `menu` and `play` in place of the
// slot's phases; it plays no rounds, so its frames only need counting at boot.
const PHASES = `(() => {
	if (typeof window.__IE_PERF__ !== 'function') return null;
	const r = JSON.parse(window.__IE_PERF__());
	return {
		idle: r.idle?.frames ?? 0,
		spinning: r.spinning?.frames ?? 0,
		round: r.round?.frames ?? 0,
		free: (r.menu?.frames ?? 0) + (r.play?.frames ?? 0),
	};
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
		if (p && p.idle + p.spinning + p.round + p.free > 0) break;
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

// ---- The arcade lab (Salmons performance plan T2) ----------------------------------------------
//
// A free-play game with a room of its own never enters a round, so the slot sequence above only
// idles it at boot. This sequence plays the room: it waits for the room to run with the own player
// in it, lets the level mount, presses Reset, plays a scripted input loop on the real frame clock
// and takes the reading. The page needs `LAB_WS_HOOK` installed before it loads
// (`Page.addScriptToEvaluateOnNewDocument`, or Playwright's `addInitScript`) for the socket bytes.

/** Counts the page's WebSocket traffic by direction and Colyseus protocol code (the first byte of a
 *  binary frame: 8 state patch, 13 room data, 14 state, …); `window.__IE_LAB_WS__`. */
export const LAB_WS_HOOK = `(() => {
	const Native = window.WebSocket;
	let counts = { in: {}, out: {} };
	const add = (dir, data) => {
		const size = typeof data === 'string' ? data.length : (data.byteLength ?? data.size ?? 0);
		const code = data instanceof ArrayBuffer && size ? new Uint8Array(data)[0] : ArrayBuffer.isView(data) ? data[0] : -1;
		const c = (counts[dir][code] ??= { messages: 0, bytes: 0 });
		c.messages++;
		c.bytes += size;
	};
	window.WebSocket = class extends Native {
		constructor(...args) {
			super(...args);
			this.addEventListener('message', (e) => add('in', e.data));
		}
		send(data) {
			add('out', data);
			return super.send(data);
		}
	};
	window.__IE_LAB_WS__ = {
		reset: () => { counts = { in: {}, out: {} }; },
		take: () => JSON.parse(JSON.stringify(counts)),
	};
})();`;

/** The arcade lab's defaults (Salmons: `salmons-lab.mjs`). */
export const ARCADE_LAB_DEFAULTS = {
	/** Play (the room `running`, the own player in it) this long between Reset and the reading. */
	playSeconds: 60,
	/** The level mount is one frame creating this many objects; Reset waits for it to have passed. */
	mountCreated: 5000,
	/** Quiet polls after the mount frame before Reset. */
	mountQuiet: 2,
	/** A level that has not mounted after this long is played from anyway, and the run says so. */
	mountMs: 120_000,
	bootMs: 240_000,
	/** The room never ran after this long (a lobby that waits, a join that failed). */
	runningMs: 120_000,
	pollMs: 1000,
};

/**
 * The scripted input loop of an arcade lab: `[holdMs, keys]` steps played in order and repeated.
 * Keys are the screen's, held for the step then released: Salmons' river runs up the screen's
 * upper left, so up-river is Up + Left. `['Space']` alone is a tap, not a hold: a jump, a climb, a
 * swipe. The loop is a function of time alone, so two runs press the same keys at the same
 * moments; the room's bots and currents decide what they do to the player.
 */
export const SALMONS_INPUT_LOOP = Object.freeze([
	[1500, ['ArrowUp', 'ArrowLeft']],
	[300, ['Space']],
	[1500, ['ArrowUp', 'ArrowLeft']],
	[300, ['Space']],
	[1000, ['ArrowUp', 'ArrowRight']],
	[300, ['Space']],
	[1500, ['ArrowUp', 'ArrowLeft']],
	[1000, ['ArrowLeft']],
	[300, ['Space']],
	[1000, ['ArrowDown', 'ArrowLeft']],
]);

/** The probe's reading so far, boiled down to what the sequence waits on. */
const PROBE = `(() => {
	if (typeof window.__IE_PERF__ !== 'function') return null;
	const r = JSON.parse(window.__IE_PERF__());
	const work = Object.values(r.work ?? {});
	return {
		frames: work.reduce((n, w) => n + (w?.frames ?? 0), 0),
		createdSprites: Math.max(0, ...work.map((w) => w?.perFrame?.createdSprites?.max ?? 0)),
	};
})()`;

/** What the room says of itself: its phase and the own player's status (Flow variables). */
const ROOM = `(() => {
	const read = (id) => window.__IE_FLOW_V2__?.state?.read?.(id) ?? null;
	return { phase: read('phase'), status: read('status') };
})()`;

/**
 * Plays an ARCADE online lab on `page` (booting or booted with `?perf=1` and a room to join):
 *   1. boot: the probe reports frames; a runtime that fell back to stale data stops the run;
 *   2. wait for the room `running` with the own player in it;
 *   3. press Space (the start screen's tap) until the level mounts (a frame creating
 *      `mountCreated` objects) and `mountQuiet` quiet polls have passed; take the MOUNT reading
 *      (boot to the mount, no Reset before it), then Reset (probe and socket counts);
 *   4. play `input` for `playSeconds` on the real frame clock, sampling the room each second;
 *   5. take the PLAY reading and the socket counts.
 * Returns `{ mount, text, ws, run }`: both readings as JSON text, the socket counts of the play and
 * what the run saw (`run.mounted` false when the level never mounted before the play began).
 */
export async function playArcadeLabSequence(page, options = {}) {
	const o = { ...ARCADE_LAB_DEFAULTS, input: SALMONS_INPUT_LOOP, log: () => {}, ...options };
	const run = { phases: {}, statuses: {}, taps: 0, mounted: false };

	const booted = Date.now();
	for (;;) {
		const stale = await page.evaluate('window.__IE_RUNTIME_STALE__ ?? null').catch(() => null);
		if (stale) {
			throw new LabRunError(`the runtime fell back to stale data: ${JSON.stringify(stale)}`);
		}
		const p = await page.evaluate(PROBE).catch(() => null);
		if (p && p.frames > 0) break;
		if (Date.now() - booted > o.bootMs) throw new LabRunError('the probe never reported a frame');
		await sleep(o.pollMs);
	}
	o.log(`booted in ${Math.round((Date.now() - booted) / 1000)} s`);

	const waited = Date.now();
	for (;;) {
		const r = await page.evaluate(ROOM).catch(() => null);
		if (r?.phase === 'running' && r.status !== 'out') break;
		if (Date.now() - waited > o.runningMs)
			throw new LabRunError(`the room never ran (phase ${r?.phase}, status ${r?.status})`);
		await page.keyboard.press('Space');
		await sleep(o.pollMs);
	}
	o.log(`room running after ${Math.round((Date.now() - waited) / 1000)} s`);
	const mountStart = Date.now();
	let quiet = -1;
	while (Date.now() - mountStart < o.mountMs) {
		await sleep(o.pollMs);
		const p = await page.evaluate(PROBE).catch(() => null);
		if (p && p.createdSprites >= o.mountCreated && quiet < 0) quiet = 0;
		else if (quiet >= 0) quiet++;
		// The level draws once a tap has passed the start screen (the first tap), as for a player.
		else await page.keyboard.press('Space');
		if (quiet >= o.mountQuiet) {
			run.mounted = true;
			break;
		}
	}
	o.log(
		run.mounted
			? `level mounted ${Math.round((Date.now() - mountStart) / 1000)} s after`
			: 'the level never showed a mount frame: playing from anyway',
	);

	const mount = await page.evaluate("window.__IE_PERF__('take')");
	await page.evaluate("window.__IE_PERF__('reset')");
	await page.evaluate('window.__IE_LAB_WS__?.reset()');

	const held = new Set();
	const hold = async (keys) => {
		for (const key of [...held])
			if (!keys.includes(key)) {
				await page.keyboard.up(key);
				held.delete(key);
			}
		for (const key of keys)
			if (!held.has(key)) {
				await page.keyboard.down(key);
				held.add(key);
			}
	};
	const started = Date.now();
	const end = started + o.playSeconds * 1000;
	let playing = true;
	const sampler = (async () => {
		while (playing) {
			const r = await page.evaluate(ROOM).catch(() => null);
			if (r) {
				run.phases[r.phase] = (run.phases[r.phase] ?? 0) + 1;
				run.statuses[r.status] = (run.statuses[r.status] ?? 0) + 1;
			}
			await sleep(1000);
		}
	})();
	try {
		for (let i = 0; Date.now() < end; i++) {
			const [holdMs, keys] = o.input[i % o.input.length];
			if (keys.length === 1 && keys[0] === 'Space') {
				await hold([]);
				await page.keyboard.down('Space');
				await sleep(60);
				await page.keyboard.up('Space');
				run.taps++;
				await sleep(Math.max(0, holdMs - 60));
			} else {
				await hold(keys);
				await sleep(Math.max(0, Math.min(holdMs, end - Date.now())));
			}
		}
	} finally {
		playing = false;
		await hold([]);
		await sampler;
	}
	o.log(`played ${Math.round((Date.now() - started) / 1000)} s`);
	const text = await page.evaluate("window.__IE_PERF__('take')");
	const ws = await page.evaluate('window.__IE_LAB_WS__?.take() ?? null');
	return { mount, text, ws, run };
}
