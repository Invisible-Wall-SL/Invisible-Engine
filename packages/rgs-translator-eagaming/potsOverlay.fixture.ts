/**
 * The pots-overlay translation (design `docs/design/pots-overlay.md` §3.2–3.3), driven through the
 * REAL facade against a scripted server that answers with HAND-BUILT wire — the "Pots overlay"
 * section of `docs/reference/hold-and-win-wire.md`, in the array order Phase 2's mock deals it
 * (`overlayDrop` right after `spinStart`, `meterLevels` last). Every book is folded through the engine's own readers (`modeOpOf`, the mode
 * stack, `applyHoldAndWinEvent`), so the facade and the engine contract cannot drift apart.
 *
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs packages/rgs-translator-eagaming/potsOverlay.fixture.ts
 *
 * Claims:
 *  1. BOOT: the pots' levels are published for the game to seed from, for any kind — after a Hold and
 *     Win game's own meters — and a game without the block publishes exactly what it did.
 *  2. A BOOK HOST + A POT → ITS FREE SPINS: the drop appears with its reveal (before the wins), the
 *     pot's meter events translate with no Hold and Win block, and the free spins enter with
 *     `cause: 'meter'` and the pots, which the mode layer keeps.
 *  3. A BOOK HOST + A POT → HOLD AND WIN: the bonus key routes the round to the respin board, value
 *     coins dropped on the base board are held, and the book's own symbols still map.
 *     A pot routed to a mode the client does not play yet passes through as its `modeEnter` /
 *     `modeExit` stub, with no Hold and Win block captured.
 *  4. BOTH BONUSES IN ONE ROUND, in either order: each ends when the next is triggered (there is no
 *     `gameEnd` between them), the win meter never steps back, and the mode stack ends at base.
 *  5. RESUME: a round left open mid-respins resumes after the respins already played; one left open
 *     in a pot's free spins replays whole, as every free-spin round does.
 *  6. PARITY: without the block, a Hold and Win block still takes every bonus and a book round
 *     translates with no overlay field anywhere.
 */

import { createServer, type Server } from 'node:http';

import {
	applyHoldAndWinEvent,
	emptyHoldAndWinState,
	type HoldAndWinEvent,
} from '../engine-game/src/game/holdAndWin.ts';
import { modeEntryMeters, modeOpOf } from '../engine-game/src/game/modeEvents.ts';
import {
	activeModeId,
	emptyModeStack,
	enterMode,
	exitMode,
	type ModeStackState,
} from '../engine-game/src/game/modeStack.ts';

type Facade = typeof import('./src/engineFacade.ts');
type BookEvent = { type: string; index: number; [key: string]: unknown };
type Answer = {
	balance?: { amount: number };
	round?: { state?: BookEvent[]; active?: boolean; event?: string };
};
type Wire = { event: string; context?: unknown };

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
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

const quiet = { log: console.log, warn: console.warn, error: console.error };
const hush = async <T>(fn: () => Promise<T>): Promise<T> => {
	console.log = console.warn = console.error = () => {};
	try {
		return await fn();
	} finally {
		Object.assign(console, quiet);
	}
};

let tabs = 0;
const openTab = (): Promise<Facade> => import(`./src/engineFacade.ts?tab=${++tabs}`);

// ---------- the wire, by hand ----------

const ROUND = 'R-pots';
const PAYLINES = [
	[1, 1, 1, 1, 1],
	[0, 0, 0, 0, 0],
	[2, 2, 2, 2, 2],
	[0, 1, 2, 1, 0],
	[2, 1, 0, 1, 2],
	[1, 0, 0, 0, 1],
	[1, 2, 2, 2, 1],
	[0, 0, 1, 2, 2],
	[2, 2, 1, 0, 0],
	[1, 2, 1, 0, 1],
];
/** 10 lines × 10 cents: the base stake is 100 credits, so a book unit is 1/100 of a pay. */
const BET_PER_LINE = 10;

const BOOK_SYMBOLS = [
	'PIC1',
	'PIC2',
	'PIC3',
	'PIC4',
	'ACE',
	'KING',
	'QUEEN',
	'JACK',
	'TEN',
	'SCAT',
];
const OVERLAY_SYMBOLS = ['RED', 'GREEN', 'BLUE', 'COIN', 'BONUS', 'BLANK'];

const bookConfig = (extra: Record<string, unknown> = {}) => ({
	symbols: [...BOOK_SYMBOLS, ...OVERLAY_SYMBOLS],
	window: { reels: 5, rows: 3 },
	availablePayLines: PAYLINES,
	wildSymbols: ['SCAT'],
	...extra,
});

const holdAndWinBlock = (extra: Record<string, unknown> = {}) => ({
	wire: 1,
	bonus: 'respin',
	roles: { BONUS: ['coin'], BLANK: ['blank'], RED: ['meterSpecial'], GREEN: ['meterSpecial'] },
	blank: 'BLANK',
	jackpots: [{ name: 'MINI', multiplier: 15 }],
	respins: 3,
	stickiness: 'allCoins',
	boardEnd: { type: 'none' },
	...extra,
});

const overlayBlock = (pots: { id: string; level: number; bonus: string }[]) => ({
	wire: 1,
	pots: pots.map((p) => ({
		id: p.id,
		token: p.id.toUpperCase(),
		level: p.level,
		max: 5,
		sizeStages: [2, 4],
		bonus: p.bonus,
	})),
	bonuses: { respin: 'holdAndWin', feature: 'freeSpins' },
});

const BOARD = [
	['ACE', 'PIC1', 'TEN'],
	['KING', 'PIC1', 'QUEEN'],
	['JACK', 'PIC1', 'TEN'],
	['ACE', 'PIC3', 'KING'],
	['TEN', 'QUEEN', 'JACK'],
];
const SCATTER_BOARD = [
	['SCAT', 'PIC1', 'TEN'],
	['KING', 'SCAT', 'QUEEN'],
	['JACK', 'PIC1', 'SCAT'],
	['ACE', 'PIC3', 'KING'],
	['TEN', 'QUEEN', 'JACK'],
];

const opening = (): Wire[] => [
	{ event: 'bet', context: { total: 100, betPerLine: BET_PER_LINE, paylines: PAYLINES } },
	{ event: 'gameStart', context: { totalBet: 100, betPerLine: BET_PER_LINE } },
	{ event: 'spinStart', context: {} },
];
const lineWin = (pay: number): Wire => ({
	event: 'spinWin',
	context: { what: 'PIC1', occurs: 3, mode: 'line', pay, context: { payline: [1, 1, 1, 1, 1] } },
});
const scatterWin = (pay: number): Wire => ({
	event: 'spinWin',
	context: {
		what: 'SCAT',
		occurs: 3,
		mode: 'scatter',
		pay,
		context: [
			{ reel: 0, row: 0 },
			{ reel: 1, row: 1 },
			{ reel: 2, row: 2 },
		],
	},
});
const drop = (cells: Record<string, unknown>[]): Wire => ({
	event: 'overlayDrop',
	context: { cells },
});
const meterUpdate = (
	meter: string,
	level: number,
	from: { reel: number; row: number }[],
): Wire => ({
	event: 'meterUpdate',
	context: {
		meter,
		level,
		max: 5,
		full: level >= 5,
		from: from.map((c) => ({ ...c, symbol: meter.toUpperCase() })),
	},
});
const meterLevels = (levels: Record<string, number>): Wire => ({
	event: 'meterLevels',
	context: { meters: Object.entries(levels).map(([id, level]) => ({ id, level, max: 5 })) },
});
const featureTrigger = (spins: number, cause?: { cause: string; meters: string[] }): Wire => ({
	event: 'spinTrigger',
	context: {
		spins: [{ prob: 1, spins }],
		occurs: cause ? 0 : 3,
		bonus: 'feature',
		trigger: { occurs: [3, 4, 5], of: 'SCAT', mode: 'scatter', from: '' },
		...cause,
	},
});
const bookSnapshot = (played: number, left: number) => ({
	played,
	left,
	bonusTriggers: { feature: 1 },
	playing: 'feature',
	state: 'PIC2',
});
const enterFreeSpins = (spins: number): Wire[] => [
	{ event: 'enterBonus', context: bookSnapshot(0, spins) },
	{ event: 'pickRandomly', context: { item: { state: 'PIC2' } } },
];
const freeSpin = (played: number, left: number, last: { win: number } | null): Wire[] => [
	{ event: 'spinStart', context: {} },
	{ event: 'playedSpin', context: BOARD },
	{ event: 'playedBonusSpin', context: bookSnapshot(played, left) },
	...(last
		? [
				{ event: 'playedBonusSpins', context: bookSnapshot(played, left) },
				{ event: 'gameEnd', context: { win: last.win } },
			]
		: []),
];
/** The pot's Hold and Win entry — the respin bonus, from a full red pot, holding the dropped coin. */
const respinEntry = (): Wire[] => [
	{
		event: 'spinTrigger',
		context: {
			spins: [{ prob: 1, spins: 3 }],
			occurs: 1,
			bonus: 'respin',
			trigger: { occurs: [6], of: 'BONUS', mode: 'holdAndWin', from: '' },
			cause: 'meter',
			meters: ['red'],
		},
	},
	{
		event: 'holdAndWinTrigger',
		context: {
			cause: 'meter',
			meters: ['red'],
			cells: [{ reel: 2, row: 2, symbol: 'BONUS', value: 2 }],
			respins: 3,
			stickiness: 'allCoins',
			activeModifiers: ['payer'],
		},
	},
	{
		event: 'enterBonus',
		context: {
			holdAndWin: {
				cells: [{ reel: 2, row: 2, symbol: 'BONUS', value: 2 }],
				start: 3,
				left: 3,
				played: 0,
				banked: 0,
				activeModifiers: ['payer'],
			},
		},
	},
];
const respinBoard = (cells: { reel: number; row: number; text: string }[]) =>
	Array.from({ length: 5 }, (_, reel) =>
		Array.from(
			{ length: 3 },
			(_, row) => cells.find((c) => c.reel === reel && c.row === row)?.text ?? 'BLANK',
		),
	);
const HELD = { reel: 2, row: 2, text: 'BONUS:2' };
const LANDED = { reel: 0, row: 0, text: 'BONUS:1' };
const heldSnapshot = (left: number, played: number) => ({
	holdAndWin: {
		cells: [
			{ reel: 0, row: 0, symbol: 'BONUS', value: 1 },
			{ reel: 2, row: 2, symbol: 'BONUS', value: 2 },
		],
		start: 3,
		left,
		played,
		banked: 0,
		activeModifiers: ['payer'],
	},
});
/** Respin 1 lands a coin (the counter resets); respin 2 lands nothing and, at 0 left… */
const respinOne = (): Wire[] => [
	{ event: 'playedSpin', context: respinBoard([HELD, LANDED]) },
	{ event: 'coinsLand', context: { cells: [{ reel: 0, row: 0, symbol: 'BONUS', value: 1 }] } },
	{ event: 'respinUpdate', context: { left: 3, played: 1, start: 3, reset: true } },
	{ event: 'playedBonusSpin', context: heldSnapshot(3, 1) },
];
/** …ends the feature: 3 × stake held, so the round pays its line win plus 300 credits. */
const respinLast = (lineWinCredits: number): Wire[] => [
	{ event: 'playedSpin', context: respinBoard([HELD, LANDED]) },
	{ event: 'respinUpdate', context: { left: 0, played: 2, start: 3, reset: false } },
	{ event: 'playedBonusSpin', context: heldSnapshot(0, 2) },
	{
		event: 'holdAndWinEnd',
		context: {
			cells: [
				{ reel: 0, row: 0, symbol: 'BONUS', value: 1, amount: 100 },
				{ reel: 2, row: 2, symbol: 'BONUS', value: 2, amount: 200 },
			],
			banked: 0,
			total: 300,
		},
	},
	{ event: 'playedBonusSpins', context: {} },
	{ event: 'gameEnd', context: { win: lineWinCredits + 300 } },
];

// ---------- a scripted server ----------

type Script = {
	config: Record<string, unknown>;
	/** Answers to the stored-action requests, in the order the facade posts them. */
	answers: Wire[][];
	/** A round the session left open: the boot names it with its stored actions. */
	open?: { actions: { action: string; context?: unknown }[] };
};

const serve = async (script: Script) => {
	const answers = [...script.answers];
	let open = Boolean(script.open);
	const posted: unknown[][] = [];
	const server: Server = createServer((req, res) => {
		let raw = '';
		req.on('data', (chunk) => (raw += chunk));
		req.on('end', () => {
			const body = (raw ? JSON.parse(raw) : []) as { action: string }[];
			const answer = (events: Wire[], closed = false) => {
				res.setHeader('content-type', 'application/json');
				res.end(
					JSON.stringify({
						events,
						platform: {
							balance: 100_000,
							...(open || !closed ? { gameRound: { id: ROUND, updating: !closed } } : {}),
						},
					}),
				);
			};
			if (body.length === 0 || body[0].action === 'config') {
				const config: Record<string, unknown> = { event: 'config', context: script.config };
				if (script.open) Object.assign(config, { resume: true, actions: script.open.actions });
				return answer([config as Wire], !open);
			}
			posted.push(body.map((a) => a.action));
			if (body[0].action === 'collect') {
				open = false;
				return answer([{ event: 'gameRoundOver', context: { win: 0 } }], true);
			}
			answer(answers.shift() ?? []);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const address = server.address();
	const rgsUrl = `localhost:${typeof address === 'object' && address ? address.port : 0}`;
	return { server, rgsUrl, posted, close: () => new Promise((r) => server.close(r)) };
};

type MetersGlobal = { __IE_HOLD_AND_WIN_METERS__?: { id: string; level: number; max: number }[] };
const bootMeters = () => (globalThis as MetersGlobal).__IE_HOLD_AND_WIN_METERS__;

/** Boot a fresh tab against the script, play one bet, return the engine's book. */
const play = async (sid: string, script: Script) => {
	const s = await serve(script);
	const facade = await openTab();
	delete (globalThis as MetersGlobal).__IE_HOLD_AND_WIN_METERS__;
	const out = await hush(async () => {
		const boot = (await facade.requestAuthenticate({
			sessionID: sid,
			rgsUrl: s.rgsUrl,
			language: 'en',
		})) as Answer;
		if (script.open) return { boot, book: boot.round?.state ?? [], meters: bootMeters() };
		const meters = bootMeters();
		const bet = (await facade.requestBet({
			sessionID: sid,
			currency: 'USD',
			amount: 1,
			mode: 'BASE',
			rgsUrl: s.rgsUrl,
		})) as Answer;
		return { boot, book: bet.round?.state ?? [], meters };
	});
	await s.close();
	return { ...out, posted: s.posted };
};

const types = (book: BookEvent[]) => book.map((e) => e.type);
const only = (book: BookEvent[], type: string) => book.filter((e) => e.type === type);
const first = (book: BookEvent[], type: string) => book.find((e) => e.type === type);

/** Every invariant any translated book keeps. */
const wellFormed = (label: string, book: BookEvent[]) => {
	check(
		`${label}: every event keeps its ordinal index`,
		book.every((e, i) => e.index === i),
		true,
	);
	check(
		`${label}: no wire event leaks through untranslated`,
		types(book).filter((t) => t.startsWith('_')),
		[],
	);
};

/** The mode stack the book drives, as the play seam moves it — and every transition, in order. */
const modesOf = (book: BookEvent[]) => {
	let state: ModeStackState = emptyModeStack();
	const moves: string[] = [];
	for (const event of book) {
		const op = modeOpOf(event);
		if (!op) continue;
		const step =
			op.op === 'enter'
				? enterMode(state, op.id, { policy: op.policy, cause: op.cause, payload: op.payload })
				: exitMode(state, op.id, { total: op.total });
		state = step.state;
		for (const t of step.transitions)
			moves.push(t.kind === 'allFinished' ? t.kind : `${t.kind}:${t.mode.id}`);
	}
	return { state, moves };
};

/** Fold the Hold and Win events through the engine's reducer. */
const holdAndWinPicture = (book: BookEvent[]) => {
	const HW = new Set([
		'meterUpdate',
		'meterLevels',
		'holdAndWinTrigger',
		'coinsLand',
		'respinUpdate',
		'holdAndWinState',
		'holdAndWinEnd',
	]);
	let state = emptyHoldAndWinState();
	const seen: { type: string; held: number; left: number; active: boolean }[] = [];
	for (const event of book) {
		if (!HW.has(event.type)) continue;
		state = applyHoldAndWinEvent(state, event as unknown as HoldAndWinEvent);
		seen.push({
			type: event.type,
			held: state.cells.length,
			left: state.left,
			active: state.active,
		});
	}
	return { state, seen };
};

// ---------- 1. boot ----------

console.log('\n1. boot: the pots seed for any kind');
{
	const pots = overlayBlock([
		{ id: 'red', level: 2, bonus: 'holdAndWin' },
		{ id: 'green', level: 4, bonus: 'freeSpins' },
	]);
	const book = await play('S-boot-book', {
		config: bookConfig({ potsOverlay: pots }),
		answers: [],
	});
	check('a book host publishes its pots at their boot levels', book.meters, [
		{ id: 'red', level: 2, max: 5 },
		{ id: 'green', level: 4, max: 5 },
	]);
	const hwGame = await play('S-boot-hw', {
		config: bookConfig({
			holdAndWin: holdAndWinBlock({
				meters: [{ id: 'gold', symbol: 'BONUS', level: 1, max: 9, sizeStages: [] }],
			}),
			potsOverlay: pots,
		}),
		answers: [],
	});
	check(
		'a Hold and Win game that adds an overlay publishes its own meters first, then the pots',
		hwGame.meters?.map((m) => m.id),
		['gold', 'red', 'green'],
	);
	const plainBook = await play('S-boot-plain', { config: bookConfig(), answers: [] });
	check('a book game without the block publishes nothing', plainBook.meters, undefined);
	const plainHw = await play('S-boot-plain-hw', {
		config: bookConfig({
			holdAndWin: holdAndWinBlock({
				meters: [{ id: 'gold', symbol: 'BONUS', level: 1, max: 9, sizeStages: [] }],
			}),
		}),
		answers: [],
	});
	check('a Hold and Win game without the block publishes exactly its meters', plainHw.meters, [
		{ id: 'gold', level: 1, max: 9 },
	]);
	const futureWire = await play('S-boot-wire2', {
		config: bookConfig({ potsOverlay: { ...pots, wire: 2 } }),
		answers: [],
	});
	check('a wire this client was not written for seeds no pot', futureWire.meters, undefined);
}

// ---------- 2. book host + pot → free spins ----------

console.log('\n2. a book host: a full pot starts its own free spins');
const potFreeSpinsBase = (): Wire[] => [
	...opening(),
	drop([{ reel: 1, row: 0, symbol: 'GREEN', pot: 'green' }]),
	lineWin(20),
	{ event: 'playedSpin', context: BOARD },
	meterUpdate('green', 5, [{ reel: 1, row: 0 }]),
	featureTrigger(2, { cause: 'meter', meters: ['green'] }),
	...enterFreeSpins(2),
	meterLevels({ green: 0 }),
];
const freeSpinsScript = (): Script => ({
	config: bookConfig({
		potsOverlay: overlayBlock([{ id: 'green', level: 4, bonus: 'freeSpins' }]),
	}),
	answers: [
		potFreeSpinsBase(),
		freeSpin(1, 1, null),
		[...freeSpin(2, 0, { win: 20 }), meterLevels({ green: 0 })],
	],
});
{
	const { book, posted } = await play('S-pot-fs', freeSpinsScript());
	wellFormed('pot → free spins', book);
	check('the facade plays both free spins and collects', posted, [
		['bet', 'play'],
		['play'],
		['play'],
		['collect'],
	]);
	check('the book, in order', types(book), [
		'reveal',
		'overlayDrop',
		'winInfo',
		'meterUpdate',
		'setTotalWin',
		'freeSpinTrigger',
		'setExpandingSymbol',
		'meterLevels',
		'updateFreeSpin',
		'reveal',
		'setTotalWin',
		'updateFreeSpin',
		'reveal',
		'setTotalWin',
		'freeSpinEnd',
		'setTotalWin',
		'meterLevels',
		'finalWin',
	]);
	check('the drop: visible position, the token, its pot', first(book, 'overlayDrop')?.cells, [
		{ reel: 1, row: 0, token: 'GREEN', pot: 'green' },
	]);
	const reveal = first(book, 'reveal') as { board: { name: string }[][] } | undefined;
	check(
		'the host board still maps through the book vocabulary (ACE → L1, PIC1 → H1)',
		[reveal?.board[0][1].name, reveal?.board[1][2].name],
		['L1', 'H1'],
	);
	check('the pot fills with no Hold and Win block captured', first(book, 'meterUpdate'), {
		index: 3,
		type: 'meterUpdate',
		meter: 'green',
		level: 5,
		max: 5,
		full: true,
		from: [{ reel: 1, row: 0, symbol: { name: 'GREEN' } }],
	});
	check(
		'the base win is banked before the intro (the pot triggered after the reveal)',
		(first(book, 'setTotalWin') as { amount?: number } | undefined)?.amount,
		(first(book, 'winInfo') as { totalWin?: number } | undefined)?.totalWin,
	);
	const trigger = first(book, 'freeSpinTrigger');
	check('the free spins name the pot that started them', trigger && { ...trigger, index: 0 }, {
		index: 0,
		type: 'freeSpinTrigger',
		totalFs: 2,
		positions: [],
		cause: 'meter',
		meters: ['green'],
	});
	const op = trigger ? modeOpOf(trigger) : undefined;
	check(
		'…which the mode layer keeps: the cause on the entry, the pots in its payload',
		op?.op === 'enter' ? [op.id, op.cause, modeEntryMeters(op)] : null,
		['freeSpins', 'meter', ['green']],
	);
	check(
		'one counter tick per free spin',
		only(book, 'updateFreeSpin').map((e) => [e.amount, e.total]),
		[
			[0, 2],
			[1, 2],
		],
	);
	check('the mode stack enters and leaves free spins', modesOf(book).moves, [
		'enter:freeSpins',
		'exit:freeSpins',
		'allFinished',
	]);
}

console.log('\n2b. a pot routed to a mode the client does not play yet');
{
	const { book } = await play('S-pot-mode', {
		config: bookConfig({
			potsOverlay: overlayBlock([{ id: 'blue', level: 4, bonus: 'wheel' }]),
		}),
		answers: [
			[
				...opening(),
				drop([{ reel: 2, row: 1, symbol: 'BLUE', pot: 'blue' }]),
				{ event: 'playedSpin', context: BOARD },
				meterUpdate('blue', 5, [{ reel: 2, row: 1 }]),
				{ event: 'modeEnter', context: { mode: 'wheel', cause: 'meter', meters: ['blue'] } },
				{ event: 'modeExit', context: { mode: 'wheel', total: 0 } },
				{ event: 'gameEnd', context: { win: 0 } },
				{ event: 'gameRoundOver', context: { win: 0 } },
				meterLevels({ blue: 0 }),
			],
		],
	});
	wellFormed('pot → another mode', book);
	check('the stub mode passes through, with no Hold and Win block captured', types(book), [
		'reveal',
		'overlayDrop',
		'meterUpdate',
		'modeEnter',
		'modeExit',
		'setTotalWin',
		'finalWin',
		'meterLevels',
	]);
	const op = modeOpOf(first(book, 'modeEnter') ?? { type: '' });
	check(
		'…naming the pot that started it',
		op?.op === 'enter' ? [op.id, op.cause, modeEntryMeters(op)] : null,
		['wheel', 'meter', ['blue']],
	);
	check('the mode stack enters and leaves it', modesOf(book).moves, [
		'enter:wheel',
		'exit:wheel',
		'allFinished',
	]);
}

// ---------- 3. book host + pot → Hold and Win ----------

console.log('\n3. a book host: a full pot starts Hold and Win, holding the dropped coins');
const potRespinBase = (): Wire[] => [
	...opening(),
	drop([
		{ reel: 0, row: 1, symbol: 'RED', pot: 'red' },
		{ reel: 2, row: 2, symbol: 'COIN', value: 2 },
		{ reel: 4, row: 0, symbol: 'COIN', jackpot: 'MINI' },
	]),
	lineWin(20),
	{ event: 'playedSpin', context: BOARD },
	meterUpdate('red', 5, [{ reel: 0, row: 1 }]),
	...respinEntry(),
	meterLevels({ red: 0 }),
];
const respinScript = (): Script => ({
	config: bookConfig({
		holdAndWin: holdAndWinBlock(),
		potsOverlay: overlayBlock([
			{ id: 'red', level: 4, bonus: 'holdAndWin' },
			{ id: 'green', level: 0, bonus: 'freeSpins' },
		]),
	}),
	answers: [potRespinBase(), respinOne(), [...respinLast(20), meterLevels({ red: 0 })]],
});
{
	const { book, posted } = await play('S-pot-hw', respinScript());
	wellFormed('pot → Hold and Win', book);
	check('the facade plays both respins and collects', posted, [
		['bet', 'play'],
		['play'],
		['play'],
		['collect'],
	]);
	check('the book, in order', types(book), [
		'reveal',
		'overlayDrop',
		'winInfo',
		'meterUpdate',
		'holdAndWinTrigger',
		'holdAndWinState',
		'meterLevels',
		'respinReveal',
		'coinsLand',
		'respinUpdate',
		'holdAndWinState',
		'respinReveal',
		'respinUpdate',
		'holdAndWinState',
		'holdAndWinEnd',
		'setTotalWin',
		'meterLevels',
		'finalWin',
	]);
	check(
		'the drop carries a value coin’s value and a jackpot coin’s label',
		first(book, 'overlayDrop')?.cells,
		[
			{ reel: 0, row: 1, token: 'RED', pot: 'red' },
			{ reel: 2, row: 2, token: 'COIN', value: 2 },
			{ reel: 4, row: 0, token: 'COIN', jackpot: 'MINI' },
		],
	);
	const reveal = first(book, 'reveal') as { board: { name: string }[][] } | undefined;
	check(
		'the book board still maps (a Hold and Win block no longer forces identity names)',
		reveal?.board[0][1].name,
		'L1',
	);
	const trigger = first(book, 'holdAndWinTrigger') as
		{ cause: string; payload: { meters?: string[]; cells: unknown[] } } | undefined;
	check(
		'the respins start from the pot, holding the dropped value coin',
		[trigger?.cause, trigger?.payload.meters, trigger?.payload.cells],
		['meter', ['red'], [{ reel: 2, row: 2, symbol: { name: 'BONUS', value: 2 } }]],
	);
	check(
		'no free-spin event appears',
		types(book).filter((t) => /FreeSpin|freeSpin/.test(t)),
		[],
	);
	const picture = holdAndWinPicture(book);
	check(
		'the engine’s picture: the pot empties at entry, two coins held, then closed',
		[
			picture.seen.find((s) => s.type === 'holdAndWinTrigger')?.held,
			picture.seen.filter((s) => s.type === 'holdAndWinState').map((s) => s.held),
			picture.state.active,
			picture.state.meters,
		],
		[1, [1, 2, 2], false, [{ id: 'red', level: 0, max: 5 }]],
	);
	const end = first(book, 'holdAndWinEnd') as { total: number } | undefined;
	check(
		'the round closes on the line win plus the feature total, in book units',
		(only(book, 'setTotalWin').at(-1) as { amount?: number } | undefined)?.amount,
		(end?.total ?? 0) + (first(book, 'winInfo') as { totalWin: number } | undefined)!.totalWin,
	);
	check('the mode stack enters and leaves Hold and Win', modesOf(book).moves, [
		'enter:holdAndWin',
		'exit:holdAndWin',
		'allFinished',
	]);
}

// ---------- 4. both bonuses in one round ----------

console.log('\n4. both: the host’s free spins, then the pot’s Hold and Win, in one round');
{
	const base: Wire[] = [
		...opening(),
		drop([
			{ reel: 3, row: 0, symbol: 'RED', pot: 'red' },
			{ reel: 4, row: 2, symbol: 'COIN', value: 2 },
		]),
		lineWin(20),
		scatterWin(40),
		featureTrigger(2),
		{ event: 'playedSpin', context: SCATTER_BOARD },
		meterUpdate('red', 5, [{ reel: 3, row: 0 }]),
		...enterFreeSpins(2),
		meterLevels({ red: 5, green: 0 }),
	];
	const lastFreeSpin: Wire[] = [
		{ event: 'spinStart', context: {} },
		{ event: 'playedSpin', context: BOARD },
		{ event: 'playedBonusSpin', context: bookSnapshot(2, 0) },
		{ event: 'playedBonusSpins', context: bookSnapshot(2, 0) },
		// No `gameEnd`: the pot's bonus follows in the same round.
		...respinEntry(),
		meterLevels({ red: 0, green: 0 }),
	];
	const { book, posted } = await play('S-both', {
		config: respinScript().config,
		answers: [
			base,
			freeSpin(1, 1, null),
			lastFreeSpin,
			respinOne(),
			[...respinLast(60), meterLevels({ red: 0, green: 0 })],
		],
	});
	wellFormed('both bonuses', book);
	check('the facade plays the free spins, then the respins, then collects', posted, [
		['bet', 'play'],
		['play'],
		['play'],
		['play'],
		['play'],
		['collect'],
	]);
	check('the book, in order', types(book), [
		'reveal',
		'overlayDrop',
		'winInfo',
		'winInfo',
		'setTotalWin',
		'meterUpdate',
		'freeSpinTrigger',
		'setExpandingSymbol',
		'meterLevels',
		'updateFreeSpin',
		'reveal',
		'setTotalWin',
		'updateFreeSpin',
		'reveal',
		'setTotalWin',
		'freeSpinEnd',
		'holdAndWinTrigger',
		'holdAndWinState',
		'meterLevels',
		'respinReveal',
		'coinsLand',
		'respinUpdate',
		'holdAndWinState',
		'respinReveal',
		'respinUpdate',
		'holdAndWinState',
		'holdAndWinEnd',
		'setTotalWin',
		'meterLevels',
		'finalWin',
	]);
	const fs = first(book, 'freeSpinTrigger');
	check(
		'the host’s free spins keep their scatter cause (no pot fields)',
		[fs?.positions, 'cause' in (fs ?? {}), 'meters' in (fs ?? {})],
		[
			[
				{ reel: 0, row: 1 },
				{ reel: 1, row: 2 },
				{ reel: 2, row: 3 },
			],
			false,
			false,
		],
	);
	check(
		'the free spins end on the round’s win so far, before the pot’s bonus starts',
		(first(book, 'freeSpinEnd') as { amount?: number } | undefined)?.amount,
		(only(book, 'winInfo').at(-1) as { totalWin?: number } | undefined)?.totalWin,
	);
	check(
		'the respin counters never tick the free-spin counter',
		only(book, 'updateFreeSpin').length,
		2,
	);
	check('one free-spin end only', only(book, 'freeSpinEnd').length, 1);
	const modes = modesOf(book);
	check('the mode stack plays one bonus after the other, back to base', modes.moves, [
		'enter:freeSpins',
		'exit:freeSpins',
		'allFinished',
		'enter:holdAndWin',
		'exit:holdAndWin',
		'allFinished',
	]);
	check('…and ends at base', activeModeId(modes.state), 'basegame');
}

console.log('\n4b. both pots full: Hold and Win, then the other pot’s free spins');
{
	const lastRespin = respinLast(0).slice(0, -1); // its `gameEnd` gives way to the next bonus
	const { book } = await play('S-hw-then-fs', {
		config: respinScript().config,
		answers: [
			[
				...opening(),
				drop([
					{ reel: 0, row: 1, symbol: 'RED', pot: 'red' },
					{ reel: 1, row: 0, symbol: 'GREEN', pot: 'green' },
				]),
				lineWin(20),
				{ event: 'playedSpin', context: BOARD },
				meterUpdate('red', 5, [{ reel: 0, row: 1 }]),
				meterUpdate('green', 5, [{ reel: 1, row: 0 }]),
				...respinEntry(),
				meterLevels({ red: 0, green: 0 }),
			],
			respinOne(),
			[
				...lastRespin,
				featureTrigger(2, { cause: 'meter', meters: ['green'] }),
				...enterFreeSpins(2),
				meterLevels({ red: 0, green: 0 }),
			],
			freeSpin(1, 1, null),
			[...freeSpin(2, 0, { win: 340 }), meterLevels({ red: 0, green: 0 })],
		],
	});
	wellFormed('Hold and Win then free spins', book);
	const after = types(book).slice(types(book).indexOf('freeSpinTrigger'));
	check(
		'the free spins play on the reels, not the respin board',
		[
			after.filter((t) => t === 'respinReveal').length,
			only(book, 'reveal').filter((e) => e.gameType === 'freegame').length,
			only(book, 'updateFreeSpin').length,
		],
		[0, 2, 2],
	);
	const meter = only(book, 'setTotalWin').map((e) => e.amount as number);
	check(
		'the win meter never steps back: the feature’s total is in it before the free spins',
		meter.every((amount, i) => i === 0 || amount >= meter[i - 1]),
		true,
	);
	const end = first(book, 'holdAndWinEnd') as { total: number } | undefined;
	check(
		'…from the first bank, at the free spins’ entry',
		meter[0] >= (end?.total ?? Infinity),
		true,
	);
	check('the mode stack plays Hold and Win, then the free spins', modesOf(book).moves, [
		'enter:holdAndWin',
		'exit:holdAndWin',
		'allFinished',
		'enter:freeSpins',
		'exit:freeSpins',
		'allFinished',
	]);
}

// ---------- 5. resume ----------

console.log('\n5. resume mid-bonus');
{
	const script = respinScript();
	const { boot, book, posted } = await play('S-resume-hw', {
		...script,
		open: { actions: [{ action: 'bet' }, { action: 'play' }, { action: 'play' }] },
		answers: script.answers,
	});
	wellFormed('resume mid-respins', book);
	check('the boot replays the stored actions, plays the rest and collects', posted, [
		['bet', 'play'],
		['play'],
		['play'],
		['collect'],
	]);
	const at = Number(boot.round?.event);
	check(
		'it resumes after the respin already played — at the next respin’s board',
		[at > 0, book[at]?.type],
		[true, 'respinReveal'],
	);
	check(
		'…with the pot’s entry and the last snapshot behind it, for the resume snapshot',
		types(book.slice(0, at)).filter((t) => ['holdAndWinTrigger', 'holdAndWinState'].includes(t)),
		['holdAndWinTrigger', 'holdAndWinState', 'holdAndWinState'],
	);

	const fsScript = freeSpinsScript();
	const fsResume = await play('S-resume-fs', {
		...fsScript,
		config: bookConfig({
			holdAndWin: holdAndWinBlock(),
			potsOverlay: overlayBlock([{ id: 'green', level: 4, bonus: 'freeSpins' }]),
		}),
		open: { actions: [{ action: 'bet' }, { action: 'play' }, { action: 'play' }] },
	});
	check(
		'a pot’s free spins replay whole, as every free-spin round does — even on a Hold and Win host',
		fsResume.boot.round?.event,
		'0',
	);
	check(
		'…and present as free spins, not respins',
		[only(fsResume.book, 'freeSpinTrigger').length, only(fsResume.book, 'holdAndWinState').length],
		[1, 0],
	);
}

// ---------- 6. parity ----------

console.log('\n6. parity: no block, no change');
{
	// The old rule: a captured Hold and Win block takes EVERY bonus, whatever its key.
	const { book } = await play('S-parity-hw', {
		config: bookConfig({ holdAndWin: holdAndWinBlock() }),
		answers: [
			[
				...opening(),
				{ event: 'playedSpin', context: respinBoard([HELD]) },
				{
					...respinEntry()[0],
					context: { ...(respinEntry()[0].context as object), bonus: 'feature' },
				},
				...respinEntry().slice(1),
			],
			respinOne(),
			respinLast(0),
		],
	});
	wellFormed('parity Hold and Win', book);
	check(
		'a Hold and Win game without the block still enters respins on any bonus key',
		[only(book, 'holdAndWinState').length, only(book, 'freeSpinTrigger').length],
		[3, 0],
	);
	const reveal = first(book, 'reveal') as { board: { name: string }[][] } | undefined;
	check('…and maps by identity', reveal?.board[2][3].name, 'BONUS');

	const plain = await play('S-parity-book', {
		config: bookConfig(),
		answers: [
			[
				...opening(),
				scatterWin(40),
				featureTrigger(2),
				{ event: 'playedSpin', context: SCATTER_BOARD },
				...enterFreeSpins(2),
			],
			freeSpin(1, 1, null),
			freeSpin(2, 0, { win: 40 }),
		],
	});
	wellFormed('parity book', plain.book);
	check('a book round without the block', types(plain.book), [
		'reveal',
		'winInfo',
		'setTotalWin',
		'freeSpinTrigger',
		'setExpandingSymbol',
		'updateFreeSpin',
		'reveal',
		'setTotalWin',
		'updateFreeSpin',
		'reveal',
		'setTotalWin',
		'freeSpinEnd',
		'setTotalWin',
		'finalWin',
	]);
	check(
		'…whose free spins carry no pot field',
		Object.keys(first(plain.book, 'freeSpinTrigger') ?? {}),
		['index', 'type', 'totalFs', 'positions'],
	);
	check(
		'an overlay event without the block stays untranslated (no host is told about pots)',
		types(
			(
				await play('S-parity-drop', {
					config: bookConfig(),
					answers: [
						[
							...opening(),
							{ event: 'playedSpin', context: BOARD },
							drop([{ reel: 0, row: 0, symbol: 'RED', pot: 'red' }]),
							{ event: 'gameEnd', context: { win: 0 } },
							{ event: 'gameRoundOver', context: { win: 0 } },
						],
					],
				})
			).book,
		),
		['reveal', '_overlayDrop', 'setTotalWin', 'finalWin'],
	);
}

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
