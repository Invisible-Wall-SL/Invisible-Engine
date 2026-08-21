/**
 * Offline fixture for the cascade + multiplier-collect translation — the facade path that nothing
 * had ever EXECUTED.
 *
 * `apps/lines` does not import this package (the runtime is built with the ordinary RGS transport),
 * so no build compiles these cases and no test drove them: `tumbleStep` shipped in #385 verified
 * only at the mock end, with the translation "prettier- and eslint-clean but never run". This
 * closes that by standing the REAL mock up on a port and driving the REAL public facade API against
 * it — no hand-written event stream, so the two ends cannot agree in a fixture and disagree in
 * production.
 *
 * This package's internal imports are extensionless (bundler resolution), which bare `node` cannot
 * resolve, so run it through tsx:
 *   pnpm --filter launcher-api exec tsx ../../packages/rgs-translator-eagaming/cascadeCollect.fixture.ts
 */

import { createServer, type Server } from 'node:http';

import { createMockRgs } from '../../scripts/mock-rgs-server.mjs';
import { requestAuthenticate, requestBet } from './src/stakeFacade.ts';

const report: string[] = [];
let failures = 0;
let passes = 0;

/** Quiet on success — 40 rounds x per-cell assertions would bury the failures that matter. */
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		passes += 1;
		return;
	}
	failures += 1;
	report.push(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

/** The mock logs every request, and the facade logs its config cross-check. Hush both. */
const realLog = console.log.bind(console);
const realWarn = console.warn.bind(console);
const hush = async <T>(fn: () => T | Promise<T>): Promise<T> => {
	console.log = () => {};
	console.warn = () => {};
	try {
		return await fn();
	} finally {
		console.log = realLog;
		console.warn = realWarn;
	}
};

const PORT = 7897;
const ROUNDS = 40;

/** Stand up the real mock, configured the way the test server configures a scatter project. */
const startMock = async (opts: Record<string, unknown>): Promise<Server> => {
	const mock = createMockRgs({ label: 'fixture', ...opts });
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
		return mock.handle(req, res, url);
	});
	await new Promise<void>((resolve) => server.listen(PORT, resolve));
	return server;
};

type BookEvent = { type: string; [key: string]: unknown };

const playRound = async (sessionID: string): Promise<BookEvent[]> => {
	const rgsUrl = `localhost:${PORT}`;
	await requestAuthenticate({ sessionID, rgsUrl, language: 'en' });
	const bet = await requestBet({ sessionID, currency: 'EUR', amount: 1, mode: 'BASE', rgsUrl });
	return ((bet as { round?: { state?: BookEvent[] } })?.round?.state ?? []) as BookEvent[];
};

const server = await hush(() =>
	startMock({
		winModel: 'scatter',
		cascade: true,
		multiplier: true,
		reels: 5,
		rows: 3,
		paylines: [],
		// Below the sample's 8 so a 15-cell board pays often enough to exercise the beat in 40 spins.
		minCount: 4,
	}),
);

console.log(`\ndriving the REAL facade against the REAL mock over ${ROUNDS} rounds`);

let sawTumble = false;
let sawCollect = false;
let sawMultiplierOnBoard = false;
let sawChain = false;

for (let i = 0; i < ROUNDS; i++) {
	const events = await hush(() => playRound(`fixture-${i}`));
	const types = events.map((e) => e.type);

	const tumbles = events.filter((e) => e.type === 'tumbleBoard');
	if (tumbles.length) sawTumble = true;
	if (tumbles.length > 1) sawChain = true;

	// THE CHAIN'S NARRATION. A cascading board pays again, and each step's win has to be narrated on
	// the board that step revealed — so a `winInfo` may follow a `tumbleBoard`, and the LAST tumble
	// must have none after it (the chain ends precisely because that board paid nothing).
	if (tumbles.length) {
		const lastTumble = types.lastIndexOf('tumbleBoard');
		const winInfoAfterLastTumble = types.findIndex((t, at) => t === 'winInfo' && at > lastTumble);
		check(
			`round ${i}: nothing pays after the final tumble — that is why the chain stopped`,
			winInfoAfterLastTumble,
			-1,
		);

		// The meter only ever climbs across a chain. A step that reset it to its own figure would
		// show the player the round going backwards mid-cascade.
		let previous = -1;
		for (const e of events.filter((ev) => ev.type === 'winInfo')) {
			const total = e.totalWin as number;
			check(`round ${i}: the win meter never steps back mid-chain`, total >= previous, true);
			previous = total;
		}
	}

	for (const tumble of tumbles) {
		const newSymbols = tumble.newSymbols as { name: string; multiplier?: number }[][];
		for (const cell of newSymbols.flat()) {
			// The wire's `MULT:5` must arrive as a MAPPED name plus a value — never as a symbol
			// literally called "MULT:5", which is what an unparsed cell would look like and which the
			// client would render as a missing symbol rather than fail on.
			check(
				`round ${i}: a refilled cell never carries a raw wire name`,
				cell.name.includes(':'),
				false,
			);
			if (cell.multiplier === undefined) continue;
			sawMultiplierOnBoard = true;
			check(`round ${i}: a multiplier cell maps to the game's own symbol`, cell.name, 'M');
			check(`round ${i}: its value survives as a positive number`, cell.multiplier > 0, true);
		}
	}

	const collect = events.find((e) => e.type === 'boardMultiplierInfo');
	if (!collect) continue;
	sawCollect = true;

	const multInfo = collect.multInfo as {
		positions: { reel: number; row: number; multiplier: number }[];
	};
	const winInfo = collect.winInfo as { tumbleWin: number; boardMult: number; totalWin: number };

	check(`round ${i}: the collect names at least one position`, multInfo.positions.length > 0, true);
	check(
		`round ${i}: boardMult is the sum of what it collected`,
		winInfo.boardMult,
		multInfo.positions.reduce((sum, p) => sum + p.multiplier, 0),
	);
	// The engine's amounts are fixed-point bet-multipliers, not cents. A skipped conversion would
	// still be self-consistent, so assert the RATIO — the part a missed conversion breaks.
	check(
		`round ${i}: totalWin is tumbleWin scaled by boardMult, in engine units`,
		Math.round(winInfo.totalWin),
		Math.round(winInfo.tumbleWin * winInfo.boardMult),
	);
	// Rows must be shifted into the engine's PADDED board space — row 0 of the visible grid is row 1
	// there, so an unshifted position lights the padding row instead of the cell that collected.
	check(
		`round ${i}: positions are shifted into padded board space`,
		multInfo.positions.every((p) => p.row >= 1),
		true,
	);

	// Ordering IS the correctness of this beat: the client re-reads the SETTLED board to find the
	// multipliers, so a collect emitted before the last tumble would read a board about to be gone.
	check(
		`round ${i}: the collect follows the last tumble`,
		types.indexOf('boardMultiplierInfo') > types.lastIndexOf('tumbleBoard'),
		true,
	);
	check(
		`round ${i}: ...and precedes the round total`,
		types.indexOf('boardMultiplierInfo') < types.indexOf('setTotalWin'),
		true,
	);

	// The meter must not step BACK after the collect announced the multiplied figure.
	const setTotal = events.filter((e) => e.type === 'setTotalWin').pop();
	if (setTotal) {
		check(
			`round ${i}: the round total is at least what the collect announced`,
			(setTotal.amount as number) >= winInfo.totalWin,
			true,
		);
	}
}

check('the cascade translated at all', sawTumble, true);
check('a CHAIN of more than one tumble translated', sawChain, true);
check('a refilled multiplier reached the board', sawMultiplierOnBoard, true);
check('the collect beat translated at all', sawCollect, true);

server.close();

for (const line of report) console.log(line);
console.log(
	failures === 0
		? `\nAll ${passes} cascade/collect assertions passed.\n`
		: `\n${failures} FAILED (${passes} passed)\n`,
);
process.exit(failures === 0 ? 0 : 1);
