/**
 * Offline fixture for THE ONE INVARIANT A CASCADE HAS: after every tumble step, the board the
 * CLIENT is showing must be the board the SERVER scored the next step's wins on.
 *
 * When the two drift, nothing errors. The round plays, the meter climbs, and the win frames simply
 * land on the wrong cells — symbols that never paid get framed, symbols that did are left dark, and
 * a stale row from before the tumble sits in the grid looking like the previous spin. That is how
 * the refill-stacking bug survived: every piece of the chain was individually right, and no test
 * ever put them end to end. `cascadeCollect.fixture.ts` drives the same mock and the same facade,
 * but it stops at the wire — it never asks what the board LOOKS like afterwards.
 *
 * So this drives all three of the real things: the real mock deals and scores, the real facade
 * translates (`padReel` + the +1 row shift), and the real `combineTumbleReel` stacks each step's
 * refills onto the survivors. The only part restated here is the removal of the exploded cells —
 * one `filter` that lives inside a Svelte component and cannot be imported by Node.
 *
 * Run it (extensionless internal imports need tsx):
 *   pnpm --filter launcher-api exec tsx ../../packages/rgs-translator-eagaming/cascadeBoard.fixture.ts
 */

import { createServer, type Server } from 'node:http';

import { createMockRgs } from '../../scripts/mock-rgs-server.mjs';
import { PAD_ROWS_ABOVE, combineTumbleReel } from '../../apps/lines/src/game/tumbleBoardLayout.ts';
import { requestAuthenticate, requestBet } from './src/engineFacade.ts';

const report: string[] = [];
let failures = 0;
let passes = 0;

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

const PORT = 7898;
const ROUNDS = 60;

type Cell = { name: string; multiplier?: number };
type BookEvent = { type: string; [key: string]: unknown };

const startMock = async (opts: Record<string, unknown>): Promise<Server> => {
	const mock = createMockRgs({ label: 'fixture', ...opts });
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
		return mock.handle(req, res, url);
	});
	await new Promise<void>((resolve) => server.listen(PORT, resolve));
	return server;
};

const playRound = async (sessionID: string): Promise<BookEvent[]> => {
	const rgsUrl = `localhost:${PORT}`;
	await requestAuthenticate({ sessionID, rgsUrl, language: 'en' });
	const bet = await requestBet({ sessionID, currency: 'EUR', amount: 1, mode: 'BASE', rgsUrl });
	return ((bet as { round?: { state?: BookEvent[] } })?.round?.state ?? []) as BookEvent[];
};

/**
 * WAYS, cascading, on a wide short grid — the shape the bug was reported on. A ways win covers every
 * matching cell on its contributing reels, so a single win explodes several cells per reel and the
 * refill counts differ column to column, which is exactly the case a per-column stacking error
 * scrambles.
 */
const server = await hush(() =>
	startMock({
		winModel: 'ways',
		cascade: true,
		reels: 7,
		rows: 4,
		paylines: [],
		seed: 'cascade-board',
	}),
);

console.log(`\ndriving the REAL mock + facade + board rule over ${ROUNDS} ways rounds`);

let steps = 0;
let chains = 0;

for (let round = 0; round < ROUNDS; round++) {
	const events = await hush(() => playRound(`fixture-${round}`));

	const reveal = events.find((e) => e.type === 'reveal');
	if (!reveal) continue;
	const tumbles = events.filter((e) => e.type === 'tumbleBoard');
	if (!tumbles.length) continue;
	if (tumbles.length > 1) chains += 1;

	const shape = (reveal.board as Cell[][]).map((reel) => reel.length);
	/** The client's board, as the reels hold it: padded, one cell per row, top to bottom. */
	let board = (reveal.board as Cell[][]).map((reel) => reel.map((cell) => ({ ...cell })));
	let tumbled = false;

	// IN BOOK ORDER, because that is the only order in which the question means anything: a win is
	// narrated on the board that was on screen WHEN IT FIRED, and a cascade replaces that board
	// between one win and the next. Checking against the settled board instead would ask every step's
	// win about the last step's board — which is the very confusion this fixture exists to catch.
	for (const event of events) {
		if (event.type === 'tumbleBoard') {
			steps += 1;
			tumbled = true;
			const exploding = event.explodingSymbols as { reel: number; row: number }[];
			const adding = event.newSymbols as Cell[][];

			// The one restated line: `tumbleBoardRemoveExploded` filters the cells that just popped out
			// of the survivor layer. Everything either side of it is the shipped code.
			const gone = new Set(exploding.map((p) => `${p.reel}:${p.row}`));
			const survivors = board.map((reel, reelIndex) =>
				reel.filter((_, row) => !gone.has(`${reelIndex}:${row}`)),
			);
			board = survivors.map((reel, reelIndex) => combineTumbleReel(reel, adding[reelIndex] ?? []));

			// A step never changes the board's SHAPE: one refill for every cell it blew away, so a
			// column that grew or shrank means the two layers were stacked into the wrong lattice.
			check(
				`round ${round}: the board keeps its shape across a tumble`,
				board.map((reel) => reel.length),
				shape,
			);
			continue;
		}
		// THE INVARIANT. A win narrated after a tumble names cells on the board the server just
		// scored, in padded client coordinates — so the client must be showing that symbol there.
		// A wild counts as itself; nothing else does.
		if (event.type !== 'winInfo' || !tumbled) continue;
		const wins = event.wins as { symbol: string; positions: { reel: number; row: number }[] }[];
		for (const win of wins) {
			for (const { reel, row } of win.positions) {
				const shown = board[reel]?.[row]?.name;
				check(
					`round ${round}: reel ${reel} row ${row} shows the ${win.symbol} that paid there`,
					shown === win.symbol || shown === 'W',
					true,
				);
			}
			// A paying cell can never be a padding row — those are off-screen buffer the server does
			// not index, so a win that lands on one is an unshifted position.
			check(
				`round ${round}: no win pays on the top padding row`,
				win.positions.every((position) => position.row >= PAD_ROWS_ABOVE),
				true,
			);
		}
	}
}

check('the cascade ran at all', steps > 0, true);
check('a CHAIN of more than one tumble ran', chains > 0, true);

server.close();

for (const line of report.slice(0, 20)) console.log(line);
if (report.length > 20) console.log(`… and ${report.length - 20} more`);
console.log(
	failures === 0
		? `\nAll ${passes} board-parity assertions passed across ${steps} tumble steps.\n`
		: `\n${failures} FAILED (${passes} passed) across ${steps} tumble steps\n`,
);
process.exit(failures === 0 ? 0 : 1);
