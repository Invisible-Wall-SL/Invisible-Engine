/**
 * The partner's collector respin wire (`src/collectorRespin.ts`), driven end to end: the REAL facade
 * against a scripted partner server that answers in the shapes captured from their Fortune Vault
 * Force 5 (`docs/reference/play4fun-collector-respin-capture.md`) — our Getting Hot, game 8. No
 * session id, round id or token of theirs is used; every board and amount here is made up in their
 * shapes.
 *
 * Proves: the bet-option table (`betOptionNames`) and its `[optionIndex, betPerLine]` context, a
 * base spin, a base-game collect (with a jackpot coin) closed by `collect` at the next position, a
 * bought bonus with Expand + Boost + Multiply + Respin — a 4-row board, two collectors each taking a
 * coin's full value, boost and multiply hits and X misses, a MAJOR coin, retriggers — every respin
 * at its own position and the closing `collect`; and a refused bet (errorCode 110) answered as a
 * clean refusal. Every Hold and Win book event is folded through the engine's reducer, whose picture
 * must equal the facade's snapshot after each respin.
 *
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs packages/rgs-translator-eagaming/collectorRespin.fixture.ts
 */

import { createServer, type IncomingMessage } from 'node:http';

import {
	applyHoldAndWinEvent,
	emptyHoldAndWinState,
	isHoldAndWinEvent,
	type HoldAndWinEvent,
	type HoldAndWinState,
} from '../engine-game/src/game/holdAndWin.ts';

type Facade = typeof import('./src/engineFacade.ts');
type BookEvent = { type: string; index?: number; [key: string]: unknown };
type WireEvent = { event: string; context?: unknown };
type Answer = {
	status?: { statusCode?: string };
	error?: unknown;
	balance?: { amount: number };
	round?: { state?: BookEvent[]; active?: boolean };
};

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
const realError = console.error.bind(console);
const hush = async <T>(fn: () => T | Promise<T>): Promise<T> => {
	console.log = () => {};
	console.warn = () => {};
	console.error = () => {};
	try {
		return await fn();
	} finally {
		console.log = realLog;
		console.warn = realWarn;
		console.error = realError;
	}
};

// ---------- the partner, scripted ----------

const BASE = 40; // cents: option 0 (`gameCost` 10) × betPerLine 4
const OPTIONS = [10, 50, 500, 1000];
const NAMES = ['Base', 'Powerup', 'BuyCenterCoin', 'goldStrike'];
const PAYLINES = [
	[1, 1, 1, 1, 1],
	[0, 0, 0, 0, 0],
	[2, 2, 2, 2, 2],
	[0, 1, 2, 1, 0],
	[2, 1, 0, 1, 2],
];
const JACKPOTS = { event: 'jackpots', context: { MINI: 25, MINOR: 50, MAJOR: 150, GRAND: 1000 } };
const CONFIG = {
	event: 'config',
	context: {
		symbols: [
			'PIC1',
			'PIC2',
			'PIC3',
			'PIC4',
			'PIC5',
			'PIC6',
			'PIC7',
			'PIC8',
			'PIC9',
			'COIN',
			'COLLECT',
			'BLANK',
		],
		symbolsPay: { line: ['PIC1', 'PIC2', 'PIC3', 'PIC4', 'PIC5', 'PIC6', 'PIC7', 'PIC8', 'PIC9'] },
		wildSymbols: [],
		gameCost: 10,
		betOptions: OPTIONS,
		betOptionNames: NAMES,
		maxWinMp: [5000, 5000],
		window: { reels: 5, rows: 3 },
		availablePayLines: PAYLINES,
	},
};

const B = 'BLANK';
const ev = (event: string, context?: unknown): WireEvent =>
	context === undefined ? { event } : { event, context };
const spinHead = (option: number) => [
	ev('bet', { total: OPTIONS[option] * 4, betPerLine: 4, paylines: PAYLINES }),
	ev('gameStart', { totalBet: OPTIONS[option] * 4, betPerLine: 4 }),
	JACKPOTS,
	ev('spinStart', { symbols: CONFIG.context.symbols, betOptions: OPTIONS }),
];
const cellPay = (reel: number, row: number, original: number | string, pay: number) =>
	ev('cellPayAmount', {
		reel,
		row,
		original,
		value: typeof original === 'number' ? pay / BASE : original,
		pay,
	});

/** A round as the partner answers it: the bet's answer, then one per respin. */
type ScriptedRound = { option: number; answers: WireEvent[][]; win: number };

const BASE_BOARD = [
	['PIC1', 'PIC5', 'PIC9'],
	['PIC2', 'PIC6', 'PIC8'],
	['PIC3', 'PIC7', 'PIC9'],
	['PIC4', 'PIC8', 'PIC1'],
	['PIC5', 'PIC9', 'PIC2'],
];
const LOSING: ScriptedRound = {
	option: 0,
	win: 0,
	answers: [
		[
			...spinHead(0),
			ev('playWindow', BASE_BOARD),
			ev('playedSpin', BASE_BOARD),
			ev('gameEnd', { win: 0 }),
			ev('gameRoundOver', { win: 0 }),
		],
	],
};

// A line win: three PIC6 on the middle line. The partner sends `spinWin` after the board it pays.
const LINE_BOARD = [
	['PIC1', 'PIC6', 'PIC9'],
	['PIC2', 'PIC6', 'PIC8'],
	['PIC3', 'PIC6', 'PIC9'],
	['PIC4', 'PIC8', 'PIC1'],
	['PIC5', 'PIC9', 'PIC2'],
];
const LINE_WIN: ScriptedRound = {
	option: 0,
	win: 120,
	answers: [
		[
			...spinHead(0),
			ev('playWindow', LINE_BOARD),
			ev('spinWin', {
				what: 'PIC6',
				occurs: 3,
				mode: 'line',
				pay: 120,
				context: { paylineId: 0, payline: PAYLINES[0], direction: 'left' },
			}),
			ev('playedSpin', LINE_BOARD),
			ev('gameEnd', { win: 120 }),
			ev('gameRoundOver', { win: 120 }),
		],
	],
};

// Center Coin: a collector on reel 3 gathers a 2× coin and a MINI coin; no trigger (reel 2 is
// blank). It ends with `gameEnd` but no `gameRoundOver`: the client's `collect` closes it.
const CENTER_DEALT = [
	['COIN_2', B, B],
	[B, B, B],
	['COLLECT', B, B],
	[B, B, B],
	[B, B, 'COIN_MINI'],
];
const CENTER_AFTER = [
	[B, B, B],
	[B, B, B],
	['COLLECT_1080', B, B],
	[B, B, B],
	[B, B, B],
];
const CENTER: ScriptedRound = {
	option: 2,
	win: 1080,
	answers: [
		[
			...spinHead(2),
			ev('bonusSymbol', { reel: 0, row: 0, symbol: 'COIN_2', win: 2 }),
			ev('bonusSymbol', { reel: 4, row: 2, symbol: 'COIN_MINI', win: 'MINI' }),
			ev('playWindow', CENTER_DEALT),
			cellPay(0, 0, 2, 80),
			cellPay(4, 2, 'MINI', 1000),
			ev('collect', { reel: 2, row: 0, pay: 1080 }),
			ev('bonusWin', { bonus: 'initialspin', pay: 1080, isSpinWin: false }),
			ev('collectWindow', CENTER_AFTER),
			ev('playedSpin', CENTER_DEALT),
			ev('gameEnd', { win: 1080 }),
		],
	],
};

// The bonus buy: Expand + Boost + Multiply + Respin (`11011`). The trigger spin's collector gathers
// 240, the board opens with 4 rows and 4 respins, a second collector lands, boost and multiply each
// hit once and miss otherwise, a MAJOR coin lands, and the bonus pays both collectors' totals.
const blank4 = () => Array.from({ length: 5 }, () => [B, B, B, B]);
const board4 = (cells: [number, number, string][]) => {
	const board = blank4();
	for (const [reel, row, text] of cells) board[reel][row] = text;
	return board;
};
const respin = (
	dealt: string[][],
	after: string[][],
	inner: WireEvent[],
	counter: { played: number; left: number; retrigger: boolean },
	last = false,
): WireEvent[] => [
	JACKPOTS,
	ev('spinStart', { symbols: CONFIG.context.symbols }),
	ev('boostsEnabled', { expand: 1, boost: 1, powerFive: 0, multiply: 1, respin: 1 }),
	ev('playWindow', dealt),
	...inner,
	ev('collectWindow', after),
	...(counter.retrigger ? [ev('retrigger', { games: 1 })] : []),
	ev('playedSpin', dealt),
	ev('playedBonusSpin', { played: counter.played, left: counter.left, bonus: '11011' }),
	...(last
		? [
				ev('playedBonusSpins', { played: counter.played, left: 0, bonus: '11011' }),
				ev('gameEnd', { win: 13280 }),
			]
		: []),
];
const TRIGGER_DEALT = [
	['COIN_5', B, B],
	['COIN_1', B, B],
	[B, 'COLLECT', B],
	[B, B, B],
	[B, B, B],
];
const TRIGGER_AFTER = [
	[B, B, B],
	[B, B, B],
	[B, 'COLLECT_240', B],
	[B, B, B],
	[B, B, B],
];
const quiet = (a: number, b: number) =>
	board4([
		[2, 1, `COLLECT_${a}`],
		[2, 3, `COLLECT_${b}`],
	]);
const BUY: ScriptedRound = {
	option: 3,
	win: 13280,
	answers: [
		[
			...spinHead(3),
			ev('bonusSymbol', { reel: 0, row: 0, symbol: 'COIN_5', win: 5 }),
			ev('bonusSymbol', { reel: 1, row: 0, symbol: 'COIN_1', win: 1 }),
			ev('playWindow', TRIGGER_DEALT),
			cellPay(0, 0, 5, 200),
			cellPay(1, 0, 1, 40),
			ev('collect', { reel: 2, row: 1, pay: 240 }),
			ev('bonusWin', { bonus: 'initialspin', pay: 240, isSpinWin: false }),
			ev('collectWindow', TRIGGER_AFTER),
			ev('boostsAwarded', { expand: 1, boost: 1, powerFive: 0, multiply: 1, respin: 1 }),
			ev('spinTrigger', {
				spins: [{ prob: 1, spins: 4 }],
				occurs: 3,
				bonus: '11011',
				trigger: { occurs: [1, 2, 3], from: 'run' },
			}),
			ev('playedSpin', TRIGGER_DEALT),
			ev('enterBonus', {
				left: 4,
				triggers: 1,
				bonusTriggers: '11011',
				spins: 4,
				played: 0,
				triggering: [
					{ reel: 0, row: 0 },
					{ reel: 1, row: 0 },
					{ reel: 2, row: 1 },
				],
				playing: '11011',
				window: { reels: 5, rows: 4 },
			}),
		],
		// 1: a second collector lands with a 5× coin; boost hits it (+2×), multiply misses.
		respin(
			board4([
				[2, 1, 'COLLECT_240'],
				[2, 3, 'COLLECT'],
				[0, 2, 'COIN_5'],
			]),
			quiet(520, 280),
			[
				cellPay(0, 2, 5, 280),
				ev('boost', [{ reel: 0, row: 2, startingPay: 200, boost: 80 }]),
				ev('multiplier', { multiplier: 'X' }),
				ev('collect', { reel: 2, row: 1, pay: 280 }),
				ev('collect', { reel: 2, row: 3, pay: 280 }),
				ev('bonusWin', { bonus: '11011', pay: 560, isSpinWin: false }),
			],
			{ played: 1, left: 4, retrigger: true },
		),
		// 2: a 2× coin; boost misses, multiply hits it ×3.
		respin(
			board4([
				[2, 1, 'COLLECT_520'],
				[2, 3, 'COLLECT_280'],
				[4, 0, 'COIN_2'],
			]),
			quiet(760, 520),
			[
				cellPay(4, 0, 2, 240),
				ev('boost', { boost: 'X' }),
				ev('multiplier', [{ reel: 4, row: 0, startingPay: 80, multiplier: 3 }]),
				ev('collect', { reel: 2, row: 1, pay: 240 }),
				ev('collect', { reel: 2, row: 3, pay: 240 }),
				ev('bonusWin', { bonus: '11011', pay: 480, isSpinWin: false }),
			],
			{ played: 2, left: 4, retrigger: true },
		),
		// 3: a MAJOR coin on the expanded row; neither enhancement touches a jackpot coin.
		respin(
			board4([
				[2, 1, 'COLLECT_760'],
				[2, 3, 'COLLECT_520'],
				[1, 3, 'COIN_MAJOR'],
			]),
			quiet(6760, 6520),
			[
				cellPay(1, 3, 'MAJOR', 6000),
				ev('boost', { boost: 'X' }),
				ev('multiplier', { multiplier: 'X' }),
				ev('collect', { reel: 2, row: 1, pay: 6000 }),
				ev('collect', { reel: 2, row: 3, pay: 6000 }),
				ev('bonusWin', { bonus: '11011', pay: 12000, isSpinWin: false }),
			],
			{ played: 3, left: 4, retrigger: true },
		),
		...[3, 2, 1, 0].map((left, i) =>
			respin(
				quiet(6760, 6520),
				quiet(6760, 6520),
				[ev('boost', { boost: 'X' }), ev('multiplier', { multiplier: 'X' })],
				{ played: 4 + i, left, retrigger: false },
				left === 0,
			),
		),
	],
};

type Logged = { seq: number; gid: string | null; actions: string[]; context?: unknown };

const startPartner = async () => {
	let balance = 100_000;
	let configured = false;
	let refuse: number[] = [];
	let queue: ScriptedRound[] = [];
	let open: { round: ScriptedRound; id: string; answered: number; ended: boolean } | null = null;
	let rounds = 0;
	const log: Logged[] = [];

	const platform = (closed: boolean) => ({
		balance,
		...(open ? { gameRound: { id: open.id, updating: !closed } } : {}),
	});
	const refusal = (code: number, error: string) => ({
		errorCode: code,
		error,
		platform: { balance },
	});
	const read = (req: IncomingMessage) =>
		new Promise<string>((resolve) => {
			let body = '';
			req.on('data', (chunk) => (body += chunk));
			req.on('end', () => resolve(body));
		});

	const answer = (url: URL, body: { action: string; context?: unknown }[]) => {
		const seq = Number(url.searchParams.get('seq'));
		const gid = url.searchParams.get('gid');
		const actions = body.map((a) => a.action);
		if (actions.length === 0) return { events: [], platform: platform(false) };
		if (actions.join() === 'config') {
			configured = true;
			return { events: [JACKPOTS, CONFIG], platform: platform(false) };
		}
		log.push({ seq, gid, actions, context: body.find((a) => a.action === 'bet')?.context });
		if (actions[0] === 'bet') {
			const option = (body[0].context as number[])[0];
			if (!configured) return refusal(110, 'unexpected args for action bet');
			if (open) return refusal(110, 'round is open');
			if (refuse.includes(option)) return refusal(110, 'unexpected args for action bet');
			const round = queue.shift();
			if (!round || round.option !== option || seq !== 0) return refusal(101, 'unscripted bet');
			rounds += 1;
			open = { round, id: `R${rounds}`, answered: 1, ended: false };
			balance -= OPTIONS[option] * 4;
			const events = round.answers[0];
			const closed = events.some((e) => e.event === 'gameRoundOver');
			const out = { events, platform: platform(closed) };
			if (closed) {
				balance += round.win;
				out.platform.balance = balance;
				open = null;
			}
			return out;
		}
		if (!open || gid !== open.id) return refusal(118, 'not authorized');
		if (actions.join() === 'play') {
			const events = open.round.answers[open.answered];
			if (!events || seq !== open.answered + 1) return refusal(101, 'unscripted play');
			open.answered += 1;
			return { events, platform: platform(false) };
		}
		if (actions.join() === 'collect') {
			if (seq !== open.answered + 1) return refusal(101, 'collect at the wrong position');
			balance += open.round.win;
			const out = {
				events: [ev('gameRoundOver', { win: open.round.win })],
				platform: { balance, gameRound: { id: open.id, updating: false } },
			};
			open = null;
			return out;
		}
		return refusal(101, `unscripted ${actions.join()}`);
	};

	const server = createServer(async (req, res) => {
		const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
		const raw = await read(req);
		const reply = answer(url, raw ? JSON.parse(raw) : []);
		res.writeHead(200, { 'content-type': 'application/json' });
		res.end(JSON.stringify(reply));
	});
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const address = server.address();
	const port = typeof address === 'object' && address ? address.port : 0;
	return {
		rgsUrl: `localhost:${port}`,
		log,
		balance: () => balance,
		script: (rounds: ScriptedRound[]) => (queue = [...rounds]),
		refuseOptions: (options: number[]) => (refuse = options),
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
};

// ---------- the facade against it ----------

const partner = await startPartner();
const facade: Facade = await import('./src/engineFacade.ts');
const { rgsUrl } = partner;
const sid = 'fx-collector-respin';

// A bet before the session sent `config` is a clean refusal with no round. The facade refuses it
// itself now, before anything is sent: with no boot config it cannot price the bet
// (`refuseUnpricedBet`, ERR_GE, #1562). The server's own 110 for it is
// `check-holdandwin-partner-wire.mjs`'s.
const sentBeforeEarly = partner.log.length;
const early = (await hush(() =>
	facade.requestBet({
		sessionID: 'fx-unconfigured',
		currency: 'EUR',
		amount: 0.4,
		mode: 'BASE',
		rgsUrl,
	}),
)) as Answer;
check('a bet before config: refused as unpriced (ERR_GE)', early.status?.statusCode, 'ERR_GE');
check('...and never sent to the partner', partner.log.length, sentBeforeEarly);
check('...with no round handed to the engine', early.round, undefined);

await hush(() => facade.requestAuthenticate({ sessionID: sid, rgsUrl, language: 'en' }));
type OptionsGlobal = {
	__IE_SERVER_BET_OPTIONS__?: { key: string; index: number; costMultiplier: number }[];
};
check(
	'boot: the four bet options are read from `betOptionNames`',
	(globalThis as OptionsGlobal).__IE_SERVER_BET_OPTIONS__?.map((o) => [o.key, o.costMultiplier]),
	[
		['BASE', 1],
		['POWERUP', 5],
		['BUYCENTERCOIN', 50],
		['GOLDSTRIKE', 100],
	],
);

const bet = async (mode: string) =>
	(await hush(() =>
		facade.requestBet({ sessionID: sid, currency: 'EUR', amount: 0.4, mode, rgsUrl }),
	)) as Answer;
const endRound = () => hush(() => facade.requestEndRound({ sessionID: sid, rgsUrl }));

const commonChecks = (label: string, book: BookEvent[]) => {
	const types = book.map((e) => e.type);
	check(
		`${label}: every event keeps its ordinal index`,
		book.every((e, i) => e.index === i),
		true,
	);
	check(
		`${label}: no wire event leaks through untranslated`,
		types.filter((t) => t.startsWith('_')),
		[],
	);
	check(`${label}: the base board is revealed once`, types.filter((t) => t === 'reveal').length, 1);
	return types;
};

// 1. A base spin with nothing on it.
partner.script([LOSING, LINE_WIN, CENTER, BUY]);
{
	const answer = await bet('BASE');
	const book = answer.round?.state ?? [];
	const types = commonChecks('base spin', book);
	check('base spin: bet context [optionIndex, betPerLine]', partner.log.at(-1)?.context, [0, 4]);
	check(
		'base spin: no Hold and Win event',
		types.filter((t) => isHoldAndWinEvent({ type: t })),
		[],
	);
	const reveal = book.find((e) => e.type === 'reveal') as { board: { name: string }[][] };
	check(
		'base spin: line symbols are mapped, padded one row each side',
		reveal.board[0].map((s) => s.name),
		['H1', 'H1', 'L1', 'L3', 'L3'],
	);
	check('base spin: closed in its own batch', answer.round?.active, false);
	await endRound();
}

// 1b. A line win: its `winInfo` follows the reveal, so the winning symbols play their win animation.
{
	const answer = await bet('BASE');
	const book = answer.round?.state ?? [];
	const types = commonChecks('line win', book);
	check(
		'line win: one winInfo, right after the reveal',
		types.filter((t) => t === 'winInfo').length === 1 &&
			types.indexOf('winInfo') === types.indexOf('reveal') + 1,
		true,
	);
	const info = book.find((e) => e.type === 'winInfo') as
		{ wins: { kind: number; positions: { reel: number; row: number }[] }[] } | undefined;
	check(
		'line win: its line in the padded board, three of a kind',
		[info?.wins[0].positions, info?.wins[0].kind],
		[[0, 1, 2, 3, 4].map((reel) => ({ reel, row: 2 })), 3],
	);
	await endRound();
}

// 2. Center Coin: a base-game collect of a cash coin and a MINI coin, closed by our `collect`.
{
	const before = partner.log.length;
	const answer = await bet('BUYCENTERCOIN');
	const book = answer.round?.state ?? [];
	const types = commonChecks('center coin', book);
	check('center coin: bet context', partner.log.at(-1)?.context, [2, 4]);
	const reveal = book.find((e) => e.type === 'reveal') as {
		board: { name: string; value?: number; jackpot?: string }[][];
	};
	check('center coin: a cash coin carries n × base', reveal.board[0][1], {
		name: 'COIN',
		value: 2,
	});
	check('center coin: a jackpot coin carries its tier', reveal.board[4][3], {
		name: 'COIN',
		jackpot: 'MINI',
	});
	const collect = book.find((e) => e.type === 'coinInstantCollect') as Record<string, unknown>;
	check('center coin: the collect is an instant collect', Boolean(collect), true);
	check(
		'center coin: one collector, taking each coin once',
		[collect?.times, (collect?.specials as unknown[])?.length],
		[1, 1],
	);
	check(
		'center coin: the coins it took, in book units',
		(collect?.cells as { symbol: { value?: number; jackpot?: string }; amount: number }[]).map(
			(c) => [c.symbol.value ?? c.symbol.jackpot, c.amount],
		),
		[
			[2, 200],
			['MINI', 2500],
		],
	);
	check('center coin: its amount is the bonusWin pay', collect?.amount, 2700);
	check(
		'center coin: the collector, its total off collectWindow and what it gathered',
		collect?.collectors,
		[{ reel: 2, row: 0, symbol: { name: 'COLLECT', value: 27 }, amount: 2700 }],
	);
	check(
		'center coin: the MINI is presented, not paid again',
		book.filter((e) => e.type === 'jackpotWin').map((e) => [e.tier, e.amount, e.source, e.banked]),
		[['MINI', 2500, 'instantCollect', false]],
	);
	check('center coin: no feature', types.includes('holdAndWinTrigger'), false);
	check('center coin: the round stays open (no gameRoundOver)', answer.round?.active, true);
	const balanceBefore = partner.balance();
	await endRound();
	const closing = partner.log.slice(before).at(-1);
	check(
		'center coin: closed by `collect` at the next position, under the gid',
		[closing?.actions, closing?.seq, Boolean(closing?.gid)],
		[['collect'], 2, true],
	);
	check('center coin: the collect credited the win', partner.balance() - balanceBefore, 1080);
}

// 3. The bonus buy.
{
	const before = partner.log.length;
	const answer = await bet('GOLDSTRIKE');
	const book = answer.round?.state ?? [];
	const types = commonChecks('bonus', book);
	const walk = partner.log.slice(before);
	check('bonus: bet context', walk[0]?.context, [3, 4]);
	check(
		'bonus: bet+play at 0, each respin at the next position, then collect',
		walk.map((l) => `${l.actions.join('+')}@${l.seq}`),
		['bet+play@0', ...[2, 3, 4, 5, 6, 7, 8].map((s) => `play@${s}`), 'collect@9'],
	);
	check(
		'bonus: every request after the bet carries the gid',
		walk.slice(1).every((l) => l.gid),
		true,
	);
	check(
		'bonus: the feature is not presented as free spins',
		types.filter((t) => ['freeSpinTrigger', 'updateFreeSpin', 'freeSpinEnd'].includes(t)),
		[],
	);

	const trigger = book.find((e) => e.type === 'holdAndWinTrigger') as {
		mode: string;
		cause: string;
		payload: Record<string, unknown>;
	};
	check('bonus: the trigger is a run', [trigger?.mode, trigger?.cause], ['holdAndWin', 'run']);
	check('bonus: the enhancements drawn', trigger?.payload.enhancements, [
		'extraRow',
		'boost',
		'multiply',
		'extraRespins',
	]);
	check('bonus: Expand opens a 4-row board at entry', trigger?.payload.expansion, {
		rows: 4,
		maxRows: 4,
	});
	check('bonus: only the collector is held at entry', trigger?.payload.cells, [
		{ reel: 2, row: 1, symbol: { name: 'COLLECT' } },
	]);
	check(
		'bonus: collectors only, 4 respins',
		[trigger?.payload.stickiness, trigger?.payload.respins],
		['collectorsOnly', 4],
	);
	const entryCollect = book.find((e) => e.type === 'coinCollect') as Record<string, unknown>;
	check('bonus: the trigger spin collect is carried into the collector', entryCollect?.value, 6);

	check(
		'bonus: boost and multiply, hit and miss, in wire order',
		book
			.filter((e) => e.type === 'enhancementHit' || e.type === 'enhancementMiss')
			.slice(0, 4)
			.map((e) => (e.type === 'enhancementHit' ? [e.kind, e.by, e.cells] : [e.kind, 'X'])),
		[
			['boost', 2, [{ reel: 0, row: 2, from: 5, to: 7 }]],
			['multiply', 'X'],
			['boost', 'X'],
			['multiply', 3, [{ reel: 4, row: 0, from: 2, to: 6 }]],
		],
	);
	const firstRespinCollects = book.filter((e) => e.type === 'coinCollect').slice(1, 3);
	check(
		'bonus: two collectors each take the coin’s full value',
		firstRespinCollects.map((e) => [
			(e.collector as { row: number }).row,
			e.value,
			(e.cells as { amount: number }[]).map((c) => c.amount),
		]),
		[
			[1, 13, [700]],
			[3, 7, [700]],
		],
	);
	check(
		'bonus: the MAJOR coin is presented once as collected, not banked',
		book.filter((e) => e.type === 'jackpotWin').map((e) => [e.tier, e.amount, e.source, e.banked]),
		[['MAJOR', 15000, 'collect', false]],
	);
	check(
		'bonus: respin boards are 4 rows',
		book
			.filter((e) => e.type === 'respinReveal')
			.every((e) => Math.max(...(e.cells as { row: number }[]).map((c) => c.row)) === 3),
		true,
	);
	check(
		'bonus: the counter resets on a retrigger and counts down after',
		book.filter((e) => e.type === 'respinUpdate').map((e) => [e.left, e.reset]),
		[
			[4, true],
			[4, true],
			[4, true],
			[3, false],
			[2, false],
			[1, false],
			[0, false],
		],
	);

	// The engine's own reducer rebuilds the facade's snapshot after every respin.
	const canon = (state: HoldAndWinState) =>
		JSON.stringify(
			[...state.cells]
				.sort((a, b) => a.reel - b.reel || a.row - b.row)
				.map((c) => [c.reel, c.row, c.symbol]),
		);
	let state = emptyHoldAndWinState();
	let snapshots = 0;
	for (const event of book) {
		if (!isHoldAndWinEvent(event)) continue;
		if (event.type === 'holdAndWinState') {
			snapshots += 1;
			const server = event.snapshot;
			check(
				`bonus: snapshot ${snapshots} — the events rebuild the board`,
				canon(state),
				canon({ ...emptyHoldAndWinState(), ...server }),
			);
			check(
				`bonus: snapshot ${snapshots} — counter`,
				[state.left, state.start],
				[server.left, server.start],
			);
			check(`bonus: snapshot ${snapshots} — open rows`, state.rows, server.rows);
			check(`bonus: snapshot ${snapshots} — enhancements`, state.enhancements, server.enhancements);
		}
		state = applyHoldAndWinEvent(state, event as HoldAndWinEvent);
	}
	check('bonus: one snapshot at entry and one per respin', snapshots, 8);
	check('bonus: one respin board per respin', types.filter((t) => t === 'respinReveal').length, 7);
	const end = book.find((e) => e.type === 'holdAndWinEnd') as {
		total: number;
		payload: { cells: { amount: number }[] };
	};
	check(
		'bonus: the feature pays the sum of the collectors',
		[end?.total, end?.payload.cells.map((c) => c.amount)],
		[33200, [16900, 16300]],
	);
	check('bonus: the end closes the picture', state.active, false);
	check(
		'bonus: the round closes on the feature total',
		[
			book.filter((e) => e.type === 'setTotalWin').pop()?.amount,
			book.find((e) => e.type === 'finalWin')?.amount,
		],
		[33200, 33200],
	);
	check(
		'bonus: the feature ends after its last respin, before the round closes',
		types.indexOf('holdAndWinEnd') < types.lastIndexOf('setTotalWin'),
		true,
	);
	await endRound();
}

// 4. An option the server refuses (operator dependent): a clean refusal, nothing stored.
{
	partner.refuseOptions([1]);
	partner.script([LOSING]);
	const refused = await bet('POWERUP');
	check('refused option: ERR_110', refused.status?.statusCode, 'ERR_110');
	check('refused option: no round', refused.round, undefined);
	check('refused option: it was sent as option 1', partner.log.at(-1)?.context, [1, 4]);
	const next = await bet('BASE');
	check('after a refusal: the next bet still goes at 0', partner.log.at(-1)?.seq, 0);
	check('after a refusal: and plays', next.round?.active, false);
}

await partner.close();

if (failures) {
	console.log(report.join('\n'));
	console.log(`\ncollector respin: ${failures} FAILED, ${passes} passed`);
	process.exit(1);
}
console.log(`collector respin: all ${passes} checks pass`);
