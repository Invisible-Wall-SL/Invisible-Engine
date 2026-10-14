/**
 * The coin board through the facade (`docs/design/hold-and-win-coin-board.md` Phase 13c): the REAL
 * facade against the REAL Hold and Win mock dealing a coin board. The boot block reaches the game,
 * the bet buys the line count the board plays (and the stake follows it), the base reveal names the
 * lines the server played, and the end tally carries each pay rule's fields.
 *
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs packages/rgs-translator-eagaming/coinBoard.fixture.ts
 */

import { createServer, type Server } from 'node:http';

import {
	activePaylineIds,
	HOLD_AND_WIN_COIN_BOARD_TEMPLATE,
	holdAndWinMockInputs,
	normalizeGameConfigDoc,
	payingCells,
	type CoinBoard,
} from '../game-config/index.ts';
import { createMockRgs } from '../../scripts/mock-rgs-server-holdandwin.mjs';
import { BOOK_AMOUNT_MULTIPLIER } from '../constants-shared/bet.ts';

type Facade = typeof import('./src/engineFacade.ts');
type BookEvent = { type: string; [key: string]: unknown };
type Answer = { balance?: { amount: number }; round?: { state?: BookEvent[] } };
type Globals = { __IE_COIN_BOARD__?: unknown; __IE_COIN_BOARD_LINE_COUNT__?: unknown };

let failures = 0;
let passes = 0;
const report: string[] = [];
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

let tabs = 0;
const openTab = (): Promise<Facade> => import(`./src/engineFacade.ts?tab=${++tabs}`);

const ALL = ['1', '2', '3', '4', '5'];
const BOARDS: Record<string, CoinBoard> = {
	all: HOLD_AND_WIN_COIN_BOARD_TEMPLATE.coinBoard as CoinBoard,
	middle: {
		lines: { selection: 'fixed', active: ['1'] },
		payRule: 'coinsOnLines',
		triggerMin: { 1: 5 },
	},
	player: {
		lines: {
			selection: 'player',
			choices: [1, 3, 5],
			default: 5,
			order: ['1', '4', '5', '2', '3'],
		},
		payRule: 'coinsOnLines',
		triggerMin: { 1: 5, 3: 6, 5: 6 },
	},
	lineFill: {
		lines: { selection: 'fixed', active: ALL },
		payRule: 'lineFill',
		lineFill: { min: 3 },
		triggerMin: { 5: 6 },
		inactiveOverlay: { color: '#102030', alpha: 0.4 },
	},
	perLine: { lines: { selection: 'fixed', active: ALL }, payRule: 'perLine', triggerMin: { 5: 6 } },
};

const startMock = async (id: string, force: string) => {
	const doc = normalizeGameConfigDoc({
		...structuredClone(HOLD_AND_WIN_COIN_BOARD_TEMPLATE),
		coinBoard: BOARDS[id],
	});
	const mock = createMockRgs({
		label: `fixture-coin-${id}`,
		quiet: true,
		seed: `fixture-coin-${id}-${force}`,
		reels: doc.numReels,
		rows: Math.max(...doc.numRows),
		paylines: Object.values(doc.paylines),
		holdAndWin: holdAndWinMockInputs(doc),
		...(force ? { force } : {}),
	});
	const server: Server = createServer((req, res) =>
		mock.handle(req, res, new URL(req.url ?? '/', `http://${req.headers.host}`)),
	);
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const address = server.address();
	const port = typeof address === 'object' && address ? address.port : 0;
	return { doc, server, rgsUrl: `localhost:${port}` };
};

/** One round on a fresh session: the book, and what the balance fell by before the win. */
const playRound = async (id: string, force: string, lineCount?: number) => {
	const { doc, server, rgsUrl } = await hush(() => startMock(id, force));
	const facade = await openTab();
	const sid = `fx-coin-${id}-${force}-${lineCount ?? 'default'}`;
	const globals = globalThis as Globals;
	delete globals.__IE_COIN_BOARD__;
	if (lineCount === undefined) delete globals.__IE_COIN_BOARD_LINE_COUNT__;
	else globals.__IE_COIN_BOARD_LINE_COUNT__ = lineCount;
	const result = await hush(async () => {
		const auth = (await facade.requestAuthenticate({
			sessionID: sid,
			rgsUrl,
			language: 'en',
		})) as Answer;
		const published = globals.__IE_COIN_BOARD__;
		const bet = (await facade.requestBet({
			sessionID: sid,
			currency: 'EUR',
			amount: 1,
			mode: 'BASE',
			rgsUrl,
		})) as Answer;
		return { auth, published, bet };
	});
	delete globals.__IE_COIN_BOARD_LINE_COUNT__;
	await new Promise<void>((resolve) => server.close(() => resolve()));
	const events = result.bet.round?.state ?? [];
	const win = (events.filter((e) => e.type === 'finalWin').pop()?.amount as number) ?? 0;
	const spent =
		(result.auth.balance?.amount ?? 0) -
		(result.bet.balance?.amount ?? 0) +
		(win / BOOK_AMOUNT_MULTIPLIER) * 1_000_000;
	return { doc, events, published: result.published, spent };
};

const reveal = (events: BookEvent[]) =>
	events.find((e) => e.type === 'reveal') as
		{ board: { name: string; value?: number }[][]; paylineIds?: string[] } | undefined;

// BOOT + BET + REVEAL, per selection: the board the game reads, the lines a bet plays, its stake.
const SELECTIONS: [id: string, lineCount: number | undefined, plays: number][] = [
	['all', undefined, 5],
	['middle', undefined, 1],
	['middle', 3, 1],
	['player', undefined, 5],
	['player', 3, 3],
	['player', 1, 1],
	['player', 2, 5],
];
for (const [id, lineCount, plays] of SELECTIONS) {
	const label = `${id} (asked ${lineCount ?? 'nothing'})`;
	const { doc, events, published, spent } = await playRound(id, '', lineCount);
	const board = BOARDS[id];
	check(`${label}: the boot coin board is published`, published, {
		lines: board.lines,
		payRule: board.payRule,
		triggerMin: Object.fromEntries(Object.entries(board.triggerMin).map(([k, v]) => [k, v])),
		...(board.lineFill ? { lineFill: board.lineFill } : {}),
		inactiveOverlay: board.inactiveOverlay ?? { color: '#000000', alpha: 0.6 },
	});
	const ids = activePaylineIds(board, doc.paylines, plays);
	const shown = reveal(events);
	check(`${label}: the reveal names the lines the server played`, shown?.paylineIds, ids);
	// The stake is the lines it plays × the bet per line (whole cents): 100 cents over the count.
	check(
		`${label}: the stake is the lines played × the bet per line`,
		Math.round(spent),
		plays * Math.round(100 / plays) * 10_000,
	);
	const paying = payingCells(doc.paylines, ids, doc);
	const offLines = (shown?.board ?? []).flatMap((reel, r) =>
		reel.slice(1, -1).filter((cell, row) => !paying[r][row] && cell.name !== 'BLANK'),
	);
	check(`${label}: a non-paying cell is always the blank`, offLines, []);
	check(
		`${label}: a coin board base spin pays no line`,
		events.filter((e) => e.type === 'winInfo').length,
		0,
	);
}

// THE END TALLY, per rule: the rule, each cell's `lines` and the `lineFill` runs come through.
for (const id of ['all', 'lineFill', 'perLine', 'middle'] as const) {
	const force = id === 'lineFill' ? 'fullBoard' : 'trigger';
	const { events } = await playRound(id, force);
	const end = events.find((e) => e.type === 'holdAndWinEnd') as
		| {
				total: number;
				payload: {
					cells: { amount: number; lines?: number }[];
					banked: number;
					payRule?: string;
					runs?: { id: string; cells: unknown[]; total: number }[];
				};
		  }
		| undefined;
	const rule = BOARDS[id].payRule;
	check(`${id} ${force}: the feature ends`, Boolean(end), true);
	if (!end) continue;
	check(`${id} ${force}: the end names its pay rule`, end.payload.payRule, rule);
	check(
		`${id} ${force}: a cell says how often it paid exactly when the rule counts`,
		end.payload.cells.every((cell) => (rule === 'coinsOnLines') === (cell.lines === undefined)),
		true,
	);
	check(
		`${id} ${force}: runs travel under lineFill only`,
		Boolean(end.payload.runs),
		rule === 'lineFill',
	);
	const sum = end.payload.cells.reduce((s, c) => s + c.amount, 0) + end.payload.banked;
	check(
		`${id} ${force}: the total is its cells plus what was banked (±rounding)`,
		Math.abs(sum - end.total) <= end.payload.cells.length,
		true,
	);
	if (rule === 'lineFill') {
		const runs = end.payload.runs ?? [];
		check(
			`${id} ${force}: a full board fills every line`,
			runs.map((run) => run.id),
			ALL,
		);
		check(
			`${id} ${force}: every run is at least the line-fill minimum, its total in book units`,
			runs.every((run) => run.cells.length >= 3 && run.total > 0),
			true,
		);
	}
	if (rule === 'perLine') {
		check(
			`${id} ${force}: every held cell pays on at least one line`,
			end.payload.cells.every((cell) => (cell.lines ?? 0) >= 1),
			true,
		);
	}
}

// A classic board is untouched: no coin board published, no `paylineIds` on its reveal.
{
	const { HOLD_AND_WIN_PRESETS } = await import('../game-config/index.ts');
	const doc = normalizeGameConfigDoc(HOLD_AND_WIN_PRESETS.pots);
	const mock = createMockRgs({
		label: 'fixture-classic',
		quiet: true,
		seed: 'fixture-classic',
		reels: doc.numReels,
		rows: Math.max(...doc.numRows),
		paylines: Object.values(doc.paylines),
		holdAndWin: holdAndWinMockInputs(doc),
	});
	const server: Server = createServer((req, res) =>
		mock.handle(req, res, new URL(req.url ?? '/', `http://${req.headers.host}`)),
	);
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const address = server.address();
	const rgsUrl = `localhost:${typeof address === 'object' && address ? address.port : 0}`;
	const facade = await openTab();
	delete (globalThis as Globals).__IE_COIN_BOARD__;
	const bet = (await hush(async () => {
		await facade.requestAuthenticate({ sessionID: 'fx-classic', rgsUrl, language: 'en' });
		return facade.requestBet({
			sessionID: 'fx-classic',
			currency: 'EUR',
			amount: 1,
			mode: 'BASE',
			rgsUrl,
		});
	})) as Answer;
	check(
		'classic: no coin board is published',
		(globalThis as Globals).__IE_COIN_BOARD__,
		undefined,
	);
	check(
		'classic: its reveal carries no lines',
		reveal(bet.round?.state ?? [])?.paylineIds,
		undefined,
	);
	await new Promise<void>((resolve) => server.close(() => resolve()));
}

realLog(`\n${passes} coin board facade checks passed, ${failures} failed.`);
if (failures) {
	realLog(report.join('\n'));
	process.exit(1);
}
