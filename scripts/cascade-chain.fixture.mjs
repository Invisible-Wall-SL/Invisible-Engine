/**
 * Offline fixture for the CASCADE CHAIN — run with node:
 *   node scripts/cascade-chain.fixture.mjs
 *
 * The chain is the one part of the cascade that no other gate can see. The vocabulary harness
 * checks that the palette DECLARES the tumble surfaces; the facade fixture checks the translation;
 * neither can tell whether the mock stops cascading a board that still pays. That was a real
 * defect for a day (the one-shot outlived the reason for it), and it was found by a player
 * counting symbols off a screenshot rather than by anything here.
 *
 * So this asserts the properties a chain has to have: it TERMINATES, and it terminates because the
 * last board paid nothing; the running total accumulates; a step only exists because its
 * predecessor paid; each reel refills exactly what it lost; and the round pays the whole chain.
 * Run against three configurations, because the interesting behaviour differs per game type.
 */
import { createServer } from 'node:http';

import { createMockRgs } from './mock-rgs-server.mjs';

const report = [];
let failures = 0;
let passes = 0;
const check = (label, actual, expected) => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		passes += 1;
		return;
	}
	failures += 1;
	report.push(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

const realLog = console.log.bind(console);
const realWarn = console.warn.bind(console);
const hush = async (fn) => {
	console.log = () => {};
	console.warn = () => {};
	try {
		return await fn();
	} finally {
		console.log = realLog;
		console.warn = realWarn;
	}
};

const startMock = async (port, opts) => {
	const mock = createMockRgs({ label: 'chain', ...opts });
	const server = createServer((req, res) => {
		const url = new URL(req.url, `http://${req.headers.host}`);
		return mock.handle(req, res, url);
	});
	await new Promise((r) => server.listen(port, r));
	return server;
};

const spin = async (port, sid, seq) => {
	const r = await fetch(`http://localhost:${port}/rgs/engine?sid=${sid}&seq=${seq}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify([
			{ action: 'bet', context: [20, 1] },
			{ action: 'play', context: '' },
		]),
	});
	return r.json();
};

const survey = async (port, label, rounds) => {
	const stats = { rounds: 0, chained: 0, maxSteps: 0, deadSpinsWithSteps: 0, totalSteps: 0 };
	for (let i = 0; i < rounds; i++) {
		const d = await hush(() => spin(port, `${label}${i}`, i));
		const ev = d.events ?? [];
		stats.rounds += 1;

		const steps = ev.filter((e) => e.event === 'tumbleStep').map((e) => e.context);
		const spinWins = ev.filter((e) => e.event === 'spinWin').map((e) => e.context);
		const dealtWin = spinWins.reduce((s, w) => s + w.pay, 0);
		const gameEnd = ev.find((e) => e.event === 'gameEnd');
		const collect = ev.find((e) => e.event === 'multiplierCollect');

		stats.totalSteps += steps.length;
		stats.maxSteps = Math.max(stats.maxSteps, steps.length);
		if (steps.length > 1) stats.chained += 1;
		if (dealtWin === 0 && steps.length > 0) stats.deadSpinsWithSteps += 1;

		// A DEMO tumble explodes symbols nothing paid on, so the chain invariants below do not
		// apply to it — it is decoration for a game whose cascade was forced on. Assert what IS
		// true of it instead: it adds no win, and the round still pays only the dealt board.
		if (steps.length && steps.every((s) => s.demo)) {
			check(
				`${label} ${i}: a demo tumble adds nothing to the round`,
				gameEnd?.context.win,
				dealtWin,
			);
			for (const step of steps) {
				check(
					`${label} ${i}: a demo step carries the round total, not 0`,
					step.runningWin,
					dealtWin,
				);
			}
			continue;
		}

		if (!steps.length) {
			check(
				`${label} ${i}: no steps ⇒ the round pays the dealt board`,
				gameEnd?.context.win,
				dealtWin,
			);
			continue;
		}

		// TERMINATION: the chain stops because the last board paid nothing, so the last step must
		// carry no wins. A chain that ended any other way is either capped or a bug.
		const last = steps[steps.length - 1];
		check(`${label} ${i}: the chain ends on a board that pays nothing`, last.wins.length, 0);

		// ACCUMULATION: runningWin on each step is the dealt win plus every step's win so far.
		let expected = dealtWin;
		for (let k = 0; k < steps.length; k++) {
			expected += steps[k].wins.reduce((s, w) => s + w.pay, 0);
			check(`${label} ${i}: step ${k} runningWin accumulates`, steps[k].runningWin, expected);
		}

		// EACH STEP EXPLODES WHAT THE PREVIOUS BOARD PAID — so a step whose predecessor paid nothing
		// should not exist at all.
		for (let k = 1; k < steps.length; k++) {
			check(
				`${label} ${i}: step ${k} only exists because step ${k - 1} paid`,
				steps[k - 1].wins.length > 0,
				true,
			);
		}

		// THE ROUND PAYS THE CHAIN (times the collect, when there is one).
		const chainTotal = expected;
		if (collect) {
			check(
				`${label} ${i}: the collect multiplies the WHOLE chain`,
				collect.context.tumbleWin,
				chainTotal,
			);
			check(
				`${label} ${i}: gameEnd pays the multiplied chain`,
				gameEnd?.context.win,
				collect.context.totalWin,
			);
		} else {
			check(`${label} ${i}: gameEnd pays the chain total`, gameEnd?.context.win, chainTotal);
		}

		// REFILL SHAPE: each reel refills exactly as many cells as it lost.
		for (let k = 0; k < steps.length; k++) {
			const perReel = new Map();
			for (const p of steps[k].exploding) perReel.set(p.reel, (perReel.get(p.reel) ?? 0) + 1);
			steps[k].newSymbols.forEach((reel, r) => {
				check(
					`${label} ${i}: step ${k} reel ${r} refills what it lost`,
					reel.length,
					perReel.get(r) ?? 0,
				);
			});
		}
	}
	return stats;
};

// --- a scatter game: the cascade is its MECHANIC ---------------------------------
const scatterServer = await startMock(7801, {
	winModel: 'scatter',
	cascade: true,
	multiplier: true,
	reels: 6,
	rows: 5,
	paylines: [],
	minCount: 8,
});
console.log("\n--- scatter 6x5, minCount 8 (the owner's board shape) ---");
const sc = await survey(7801, 'sc', 60);
console.log(sc);
check('scatter: chains of more than one step happen', sc.chained > 0, true);
check('scatter: a dead spin never tumbles', sc.deadSpinsWithSteps, 0);
check('scatter: the chain stays under the cap', sc.maxSteps <= 12, true);
scatterServer.close();

// --- a lines game with the cascade FORCED on (the demo path) ---------------------
const linesServer = await startMock(7802, { winModel: 'lines', cascade: true });
console.log('\n--- lines, cascade forced on (CASCADE_GAMES demo path) ---');
const ln = await survey(7802, 'ln', 30);
console.log(ln);
check(
	'lines demo: a dead spin still tumbles, so the overlay stays visible',
	ln.deadSpinsWithSteps > 0,
	true,
);
linesServer.close();

// --- a scatter game with NO cascade ----------------------------------------------
const flatServer = await startMock(7803, {
	winModel: 'scatter',
	cascade: false,
	reels: 6,
	rows: 5,
	paylines: [],
	minCount: 8,
});
console.log('\n--- scatter, cascade off ---');
const flat = await survey(7803, 'fl', 20);
console.log(flat);
check('cascade off: no steps at all', flat.totalSteps, 0);
flatServer.close();

for (const line of report) console.log(line);
console.log(
	failures === 0
		? `\nAll ${passes} chain assertions passed.\n`
		: `\n${failures} FAILED (${passes} passed)\n`,
);
process.exit(failures === 0 ? 0 : 1);
