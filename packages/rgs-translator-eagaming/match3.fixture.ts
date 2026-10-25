/**
 * Offline fixture for the match-3 wire (`docs/reference/match3-wire.md`) through the REAL facade.
 * Run it with node:
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs packages/rgs-translator-eagaming/match3.fixture.ts
 *
 * The server is a FAKE, in-process and scripted in the wire doc's shape — the facade's half of the
 * contract is held here on its own, whatever the mock deals. It stores every action at its `seq`
 * and answers an occupied position with what it stored there (a replay), as the partner's does.
 *
 *  1. THE BET OPENS THE ROUND and binds its `gid`; `seq` moves on by two; the round stays OPEN
 *     (`active`), and its book is the first board (`boardInit`) — nothing driven, nothing collected.
 *  2. EACH MOVE posts at the next `seq` (+1) under `&gid=`, and its book is the contract's table:
 *     `swap`, per step `tumbleBoard` (padded rows, identity symbols) + `updateTumbleWin` (book
 *     units), `movesLeft`; the move that ends the round adds `match3RoundEnd` and the `gameEnd` translation.
 *  3. A LOST ANSWER TO A MOVE is resent at the SAME `seq` and `gid`, and replayed — dealt once.
 *  4. MID-ROUND the balance heartbeat stands down, and `requestEndRound` posts ONE `collect` and
 *     answers the post-collect balance — a zero win included.
 *  5. A MOVE WITH NO ROUND OPEN is refused with nothing sent.
 *  6. RESUME condenses a replayed round to ONE `boardInit` (the last board, its moves left) and the
 *     running win; an ended round adds its end; the round goes on at the next `seq`.
 *  7. THE STOCK TRANSPORT (`rgs-requests`) answers `requestMove` with ERR_UNSUPPORTED and no request.
 */

import { requestMove as stockRequestMove } from '../rgs-requests/src/rgs-requests.ts';

type Facade = typeof import('./src/engineFacade.ts');
type Event = { index: number; type: string; [key: string]: unknown };
type Answer = {
	status?: { statusCode: string };
	balance?: { amount: number };
	round?: { roundID?: string; active?: boolean; event?: string; amount?: number; state?: Event[] };
	error?: unknown;
};
type WireEvent = { event: string; context?: unknown };
type WireAnswer = {
	events: WireEvent[];
	platform: { balance: number; gameRound?: { id: string; updating: boolean } };
};

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

// ---------- the scripted round ----------

const START = 100_000; // cents
const STAKE = 100; // cents — a $1 bet on a game with no paylines: bet [1, 100]
const ENGINE_PER_CENT = 10_000;

const BOARD0 = [
	['H1', 'H2', 'L1', 'L2'],
	['H2', 'H1', 'L2', 'L1'],
	['L1', 'L2', 'H1', 'H2'],
	['L2', 'L1', 'H2', 'H1'],
];
const BOARD1 = [
	['L1', 'L2', 'H2', 'L2'],
	['H2', 'H1', 'L2', 'L1'],
	['L1', 'L2', 'H1', 'H2'],
	['L2', 'L1', 'H2', 'H1'],
];
const BOARD2 = [
	['L1', 'L2', 'H2', 'L2'],
	['H1', 'L1', 'H2', 'L1'],
	['L1', 'L2', 'H1', 'H2'],
	['L2', 'L1', 'H2', 'H1'],
];

/** An accepted move: one step paying 50 (running 50). */
const MOVE_WIN = {
	from: { reel: 0, row: 1 },
	to: { reel: 1, row: 1 },
	accepted: true,
	steps: [
		{
			exploding: [
				{ reel: 0, row: 0 },
				{ reel: 0, row: 1 },
				{ reel: 0, row: 2 },
			],
			newSymbols: [['L1', 'L2', 'H2'], [], [], []],
			win: 50,
			roundWin: 50,
		},
	],
	movesLeft: 1,
	roundWin: 50,
	board: BOARD1,
};
/** A refused move: no steps, moves and board unchanged. */
const MOVE_REFUSED = {
	from: { reel: 3, row: 3 },
	to: { reel: 3, row: 2 },
	accepted: false,
	steps: [],
	movesLeft: 1,
	roundWin: 50,
	board: BOARD1,
};
/** The last move: one step (running 120), then the round ends, settling to 1500. */
const MOVE_LAST = {
	from: { reel: 1, row: 0 },
	to: { reel: 1, row: 1 },
	accepted: true,
	steps: [
		{
			exploding: [
				{ reel: 1, row: 1 },
				{ reel: 1, row: 2 },
				{ reel: 1, row: 3 },
			],
			newSymbols: [[], ['L1', 'H2', 'L1'], [], []],
			win: 70,
			roundWin: 120,
		},
	],
	movesLeft: 0,
	roundWin: 120,
	board: BOARD2,
};
const END = { totalWin: 1500, reason: 'movesUsed', settle: 1380 };

/** What the server answers each `move` with, in order, per session. */
type Script = WireEvent[][];
const winningScript = (): Script => [
	[{ event: 'match3Move', context: MOVE_WIN }],
	[{ event: 'match3Move', context: MOVE_REFUSED }],
	[
		{ event: 'match3Move', context: MOVE_LAST },
		{ event: 'match3End', context: END },
		{ event: 'gameEnd', context: { win: END.totalWin } },
	],
];

const CONFIG = {
	symbols: ['H1', 'H2', 'L1', 'L2'],
	window: { reels: 4, rows: 4 },
	availablePayLines: [],
	paylines: [],
	wildSymbols: [],
	paytable: {},
	match3: { wire: 1, minRun: 3, moves: 2 },
};

// ---------- the fake server ----------

interface Held {
	balance: number;
	script: Script;
	round: {
		id: string;
		stored: WireEvent[][];
		answers: Map<number, WireAnswer>;
		win: number;
	} | null;
}

const held = new Map<string, Held>();
let rounds = 0;
let fault: 'drop-after' | null = null;
const sent: string[] = [];
let lastBody: unknown = null;

const serve = (url: URL, body: { action: string; context?: unknown }[]): WireAnswer | object => {
	const sid = url.searchParams.get('sid') ?? '';
	const seq = Number(url.searchParams.get('seq'));
	const gid = url.searchParams.get('gid');
	const s = held.get(sid);
	if (!s) return { result: 0, error: 'no session', errorCode: 100, platform: {} };
	const platform = () => ({
		balance: s.balance,
		...(s.round ? { gameRound: { id: s.round.id, updating: true } } : {}),
	});
	const refuse = (error: string, errorCode: number) => ({
		result: 0,
		error,
		errorCode,
		platform: {},
	});
	if (body.length === 0) return { events: [], platform: platform() };
	if (body[0].action === 'config') {
		const open = s.round;
		return {
			events: [
				{
					event: 'config',
					context: CONFIG,
					...(open ? { resume: true, actions: open.stored.flat() } : {}),
				},
			],
			platform: platform(),
		};
	}
	const round = s.round;
	// An occupied position replays what was dealt there.
	if (round && gid === round.id && round.answers.has(seq)) return round.answers.get(seq)!;
	const action = body[body.length - 1].action;
	const store = (answer: WireAnswer) => {
		round!.answers.set(seq, answer);
		round!.stored.push(body as unknown as WireEvent[]);
		return answer;
	};
	if (body[0].action === 'bet') {
		if (round) return refuse('a round is open', 102);
		const stake = (body[0].context as number[])[0] * (body[0].context as number[])[1];
		s.balance -= stake;
		s.round = { id: `G${++rounds}`, stored: [], answers: new Map(), win: 0 };
		s.round.answers.set(seq, {
			events: [
				{ event: 'bet', context: { total: stake, betPerLine: stake, paylines: [], maxWinCap: 0 } },
				{ event: 'gameStart', context: { totalBet: stake, betPerLine: stake } },
				{ event: 'match3Board', context: { board: BOARD0, movesLeft: CONFIG.match3.moves } },
			],
			platform: platform(),
		});
		s.round.stored.push(body as unknown as WireEvent[]);
		return s.round.answers.get(seq)!;
	}
	if (!round || gid !== round.id) return refuse('no open round', 102);
	if (action === 'move') {
		const events = s.script.shift();
		if (!events) return refuse('the round is over', 102);
		const end = events.find((e) => e.event === 'match3End');
		if (end) round.win = (end.context as { totalWin: number }).totalWin;
		return store({ events, platform: platform() });
	}
	if (action === 'collect') {
		s.balance += round.win;
		const win = round.win;
		s.round = null;
		return { events: [{ event: 'gameRoundOver', context: { win } }], platform: platform() };
	}
	return refuse(`unexpected action: ${action}`, 102);
};

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = new URL(String(input));
	const body = JSON.parse(String(init?.body ?? '[]')) as { action: string }[];
	const answer = serve(url, body);
	lastBody = body;
	const dropped = fault === 'drop-after';
	fault = null;
	sent.push(
		`${url.searchParams.get('seq')}${url.searchParams.get('gid') ? 'g' : ''}:${body.map((a) => a.action).join('+') || '[]'}${dropped ? '(dropped)' : ''}`,
	);
	if (dropped) throw new TypeError('fetch failed');
	return new Response(JSON.stringify(answer), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
}) as typeof fetch;

// ---------- driving the facade ----------

let tabs = 0;
/** A new tab: a facade with none of the previous one's session state. */
const openTab = async (): Promise<Facade> => {
	const facade = (await import(`./src/engineFacade.ts?tab=${++tabs}`)) as Facade;
	facade.setResendPolicy({ attemptTimeoutMs: 1_000, resendDelayMs: 5, giveUpAfterMs: 5_000 });
	return facade;
};
const rgsUrl = 'localhost:1';
const open = (sid: string, script: Script = winningScript()) =>
	held.set(sid, { balance: START, script, round: null });
const boot = async (facade: Facade, sid: string) =>
	(await facade.requestAuthenticate({ sessionID: sid, rgsUrl, language: 'en' })) as Answer;
const bet = async (facade: Facade, sid: string) =>
	(await facade.requestBet({
		sessionID: sid,
		rgsUrl,
		currency: 'USD',
		amount: 1,
		mode: 'BASE',
	})) as Answer;
const move = async (
	facade: Facade,
	sid: string,
	from: { reel: number; row: number },
	to: { reel: number; row: number },
) => (await facade.requestMove({ sessionID: sid, rgsUrl, from, to })) as Answer;
const since = (mark: number) => sent.slice(mark);
const raw = (board: string[][]) => board.map((reel) => reel.map((name) => ({ name })));
const stripIndex = (events: Event[] | undefined) =>
	(events ?? []).map(({ index: _index, ...rest }) => rest);
const indices = (events: Event[] | undefined) => (events ?? []).map((e) => e.index);

/** The table's translation of `MOVE_WIN`. */
const MOVE_WIN_BOOK = [
	{ type: 'swap', from: { reel: 0, row: 1 }, to: { reel: 1, row: 1 }, accepted: true },
	{
		type: 'tumbleBoard',
		explodingSymbols: [
			{ reel: 0, row: 1 },
			{ reel: 0, row: 2 },
			{ reel: 0, row: 3 },
		],
		newSymbols: [[{ name: 'L1' }, { name: 'L2' }, { name: 'H2' }], [], [], []],
	},
	{ type: 'updateTumbleWin', amount: 50 },
	{ type: 'movesLeft', count: 1, board: raw(BOARD1) },
];
const MOVE_LAST_BOOK = [
	{ type: 'swap', from: { reel: 1, row: 0 }, to: { reel: 1, row: 1 }, accepted: true },
	{
		type: 'tumbleBoard',
		explodingSymbols: [
			{ reel: 1, row: 2 },
			{ reel: 1, row: 3 },
			{ reel: 1, row: 4 },
		],
		newSymbols: [[], [{ name: 'L1' }, { name: 'H2' }, { name: 'L1' }], [], []],
	},
	{ type: 'updateTumbleWin', amount: 120 },
	{ type: 'movesLeft', count: 0, board: raw(BOARD2) },
	{ type: 'match3RoundEnd', totalWin: 1500, reason: 'movesUsed' },
	// 15× the stake is a big win on the coded ladder (level 6), so `gameEnd` adds `setWin`.
	{ type: 'setWin', amount: 1500, winLevel: 6 },
	{ type: 'setTotalWin', amount: 1500 },
];

const realWarn = console.warn.bind(console);
console.warn = () => {};

console.log('\n1. the bet opens the round, and it stays open');
const tab = await openTab();
{
	const sid = 'S-play';
	open(sid);
	await boot(tab, sid);
	const mark = sent.length;
	const answer = await bet(tab, sid);
	check('bet+play is posted at seq 0 with no gid', since(mark), ['0:bet+play']);
	check('the gid is bound', tab.getSessionState(sid)?.gid, 'G1');
	check('seq moves on by two', tab.getSessionState(sid)?.seq, 2);
	check('the round is ACTIVE', answer.round?.active, true);
	check('…and its book is the first board', stripIndex(answer.round?.state), [
		{ type: 'boardInit', board: raw(BOARD0), movesLeft: 2, minRun: 3 },
	]);
	check('…indexed', indices(answer.round?.state), [0]);
	check(
		'the balance is the stake-debited one',
		answer.balance?.amount,
		(START - STAKE) * ENGINE_PER_CENT,
	);
	check('nothing was collected', held.get(sid)?.round?.id, 'G1');

	console.log('\n2. each move posts at the next seq under the gid, and translates per the table');
	let at = sent.length;
	const first = await move(tab, sid, MOVE_WIN.from, MOVE_WIN.to);
	check('move posted at seq 2 with &gid=', since(at), ['2g:move']);
	check('…its body names the two cells as [reel, row]', lastBody, [
		{ action: 'move', context: { from: [0, 1], to: [1, 1] } },
	]);
	check('…and seq moves on by one', tab.getSessionState(sid)?.seq, 3);
	check(
		'the book is swap, tumbleBoard, updateTumbleWin, movesLeft',
		stripIndex(first.round?.state),
		MOVE_WIN_BOOK,
	);
	check('…indexed from 0', indices(first.round?.state), [0, 1, 2, 3]);
	check('…in an ACTIVE round', first.round?.active, true);
	check('…named', first.round?.roundID, 'G1');

	at = sent.length;
	const refused = await move(tab, sid, MOVE_REFUSED.from, MOVE_REFUSED.to);
	check('a refused move is stored too: seq 3', since(at), ['3g:move']);
	check('…its book is a refused swap and the unchanged moves', stripIndex(refused.round?.state), [
		{ type: 'swap', from: { reel: 3, row: 3 }, to: { reel: 3, row: 2 }, accepted: false },
		{ type: 'movesLeft', count: 1, board: raw(BOARD1) },
	]);

	console.log('\n3. a lost answer to a move is resent at the same seq and gid — and replayed');
	const left = held.get(sid)!.script.length;
	fault = 'drop-after';
	at = sent.length;
	const last = await move(tab, sid, MOVE_LAST.from, MOVE_LAST.to);
	check('posted at seq 4, lost, resent at seq 4 under the gid', since(at), [
		'4g:move(dropped)',
		'4g:move',
	]);
	check('the server dealt the move ONCE', held.get(sid)!.script.length, left - 1);
	check('seq moved on once', tab.getSessionState(sid)?.seq, 5);
	check(
		'the ending move adds match3RoundEnd and the gameEnd translation',
		stripIndex(last.round?.state),
		MOVE_LAST_BOOK,
	);
	check('…and the round is still ACTIVE (not collected)', last.round?.active, true);
	check('…on the server too', held.get(sid)?.round?.id, 'G1');

	console.log('\n4. mid-round the heartbeat stands down; endRound collects once');
	at = sent.length;
	const poll = await tab.requestBalance({ sessionID: sid, rgsUrl });
	check('the balance poll is SKIPPED', poll.status.statusCode, 'SKIPPED');
	check('…with nothing sent', since(at), []);
	at = sent.length;
	const end = (await tab.requestEndRound({ sessionID: sid, rgsUrl })) as Answer;
	check('ONE collect, at seq 5 under the gid', since(at), ['5g:collect']);
	check('the round is closed on the server', held.get(sid)?.round, null);
	check('…and in the session', tab.getSessionState(sid)?.gid, null);
	check(
		'the balance answered is the post-collect one',
		end.balance?.amount,
		(START - STAKE + END.totalWin) * ENGINE_PER_CENT,
	);
	at = sent.length;
	await tab.requestEndRound({ sessionID: sid, rgsUrl });
	check(
		'a second endRound collects nothing',
		since(at).filter((r) => r.endsWith('collect')),
		[],
	);

	console.log('\n5. a move with no round open is refused with nothing sent');
	at = sent.length;
	const stray = await move(tab, sid, { reel: 0, row: 0 }, { reel: 0, row: 1 });
	check('refused', stray.status?.statusCode, 'ERR_NO_ROUND');
	check('…with an error the engine shows', typeof stray.error, 'string');
	check('…and no request', since(at), []);
}
{
	const sid = 'S-zero';
	open(sid, [[{ event: 'match3Move', context: { ...MOVE_REFUSED, roundWin: 0, movesLeft: 2 } }]]);
	await boot(tab, sid);
	await bet(tab, sid);
	await move(tab, sid, MOVE_REFUSED.from, MOVE_REFUSED.to);
	const at = sent.length;
	const end = (await tab.requestEndRound({ sessionID: sid, rgsUrl })) as Answer;
	check('a zero-win round is collected too — once, at seq 3', since(at), ['3g:collect']);
	check('…closing it', held.get(sid)?.round, null);
	check('…on the stake-debited balance', end.balance?.amount, (START - STAKE) * ENGINE_PER_CENT);
}

console.log('\n6. resume condenses the replayed round to one board');
{
	const sid = 'S-resume';
	open(sid);
	const tabA = await openTab();
	await boot(tabA, sid);
	await bet(tabA, sid);
	await move(tabA, sid, MOVE_WIN.from, MOVE_WIN.to);
	await move(tabA, sid, MOVE_REFUSED.from, MOVE_REFUSED.to);

	const tabB = await openTab();
	let at = sent.length;
	const answer = await boot(tabB, sid);
	check(
		'the stored requests are re-posted where they were stored, under the gid',
		since(at).filter((r) => !r.endsWith(':[]') && !r.endsWith('config')),
		['0g:bet+play', '2g:move', '3g:move'],
	);
	check(
		'the round reaches the engine ACTIVE, from event 0',
		[answer.round?.active, answer.round?.event],
		[true, '0'],
	);
	check('…as ONE board (the last) and the running win', stripIndex(answer.round?.state), [
		{ type: 'boardInit', board: raw(BOARD1), movesLeft: 1, minRun: 3 },
		{ type: 'updateTumbleWin', amount: 50 },
	]);
	check('…indexed', indices(answer.round?.state), [0, 1]);
	check('…at the stake it was played at', answer.round?.amount, STAKE * ENGINE_PER_CENT);
	check('…on the unpaid balance', answer.balance?.amount, (START - STAKE) * ENGINE_PER_CENT);
	check('nothing was collected', held.get(sid)?.round?.id !== undefined, true);

	at = sent.length;
	const next = await move(tabB, sid, MOVE_LAST.from, MOVE_LAST.to);
	check('the round goes on at the next seq', since(at), ['4g:move']);
	check(
		'…its amounts read against the resumed stake',
		stripIndex(next.round?.state),
		MOVE_LAST_BOOK,
	);
	at = sent.length;
	await tabB.requestEndRound({ sessionID: sid, rgsUrl });
	check('…and endRound collects it once', since(at), ['5g:collect']);
}
{
	const sid = 'S-resume-ended';
	open(sid);
	const tabA = await openTab();
	await boot(tabA, sid);
	await bet(tabA, sid);
	await move(tabA, sid, MOVE_WIN.from, MOVE_WIN.to);
	await move(tabA, sid, MOVE_REFUSED.from, MOVE_REFUSED.to);
	await move(tabA, sid, MOVE_LAST.from, MOVE_LAST.to);

	const tabB = await openTab();
	const answer = await boot(tabB, sid);
	check(
		'an ended round resumes on its last board, its win and its end',
		stripIndex(answer.round?.state),
		[
			{ type: 'boardInit', board: raw(BOARD2), movesLeft: 0, minRun: 3 },
			{ type: 'updateTumbleWin', amount: 120 },
			{ type: 'match3RoundEnd', totalWin: 1500, reason: 'movesUsed' },
			{ type: 'setWin', amount: 1500, winLevel: 6 },
			{ type: 'setTotalWin', amount: 1500 },
		],
	);
	check('…still ACTIVE: the engine collects it', answer.round?.active, true);
	check('the resume collected nothing', held.get(sid)?.round?.id !== undefined, true);
	const at = sent.length;
	const end = (await tabB.requestEndRound({ sessionID: sid, rgsUrl })) as Answer;
	check('endRound collects it once', since(at), ['5g:collect']);
	check('…paying the round', end.balance?.amount, (START - STAKE + END.totalWin) * ENGINE_PER_CENT);
}

console.log('\n7. the stock transport has no move');
{
	const at = sent.length;
	const answer = await stockRequestMove({
		sessionID: 'S-stock',
		rgsUrl,
		from: { reel: 0, row: 0 },
		to: { reel: 0, row: 1 },
	});
	check('ERR_UNSUPPORTED', answer.status.statusCode, 'ERR_UNSUPPORTED');
	check('…with an error the engine shows', typeof answer.error, 'string');
	check('…and no request', since(at), []);
}

console.warn = realWarn;
if (failures) {
	console.log(`\n${failures} check(s) FAILED`);
	process.exit(1);
}
console.log('\nmatch3 fixture: all checks passed');
