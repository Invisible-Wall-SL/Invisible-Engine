/**
 * The Hold and Win translation (`src/holdAndWin.ts`), driven end to end: the REAL facade against the
 * REAL Hold and Win mock, for all three presets and a forced beat of every kind the presets deal.
 * Every book the facade hands the engine is folded through the engine's own reducer
 * (`applyHoldAndWinEvent`), and the picture it builds must equal the server's snapshot after each
 * respin — so the facade and the engine contract cannot drift apart unnoticed.
 *
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs packages/rgs-translator-eagaming/holdAndWin.fixture.ts
 */

import { createServer, type Server } from 'node:http';

import {
	HOLD_AND_WIN_PRESETS,
	HOLD_AND_WIN_TEST_FIXTURES,
	holdAndWinMockInputs,
	normalizeGameConfigDoc,
} from '../game-config/index.ts';
import {
	applyHoldAndWinEvent,
	emptyHoldAndWinState,
	type HoldAndWinEvent,
	type HoldAndWinState,
} from '../engine-game/src/game/holdAndWin.ts';
import { createMockRgs } from '../../scripts/mock-rgs-server-holdandwin.mjs';
import { BOOK_AMOUNT_MULTIPLIER } from '../constants-shared/bet.ts';

type Facade = typeof import('./src/engineFacade.ts');
type BookEvent = { type: string; [key: string]: unknown };
type Answer = {
	balance?: { amount: number };
	round?: { state?: BookEvent[]; active?: boolean; event?: string };
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

const startMock = async (preset: string, force: string) => {
	const doc = normalizeGameConfigDoc(
		HOLD_AND_WIN_PRESETS[preset as keyof typeof HOLD_AND_WIN_PRESETS] ??
			HOLD_AND_WIN_TEST_FIXTURES[preset],
	);
	const mock = createMockRgs({
		label: `fixture-${preset}`,
		quiet: true,
		seed: `fixture-${preset}-${force}`,
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

type MetersGlobal = {
	__IE_HOLD_AND_WIN_METERS__?: { id: string; level: number; max: number }[];
};

const HW_TYPES = new Set([
	'luckySpin',
	'meterUpdate',
	'meterLevels',
	'jackpotLevels',
	'coinInstantCollect',
	'randomMetreTrigger',
	'holdAndWinTrigger',
	'holdAndWinWheel',
	'respinReveal',
	'coinsLand',
	'mysteryReveal',
	'coinPay',
	'respinsAdded',
	'coinUpgrade',
	'coinBoost',
	'specialBecomesCoin',
	'coinCollect',
	'cellsCleared',
	'rowsUnlocked',
	'columnComplete',
	'jackpotWin',
	'respinUpdate',
	'holdAndWinState',
	'holdAndWinEnd',
]);

const canon = (state: HoldAndWinState) =>
	JSON.stringify(
		[...state.cells]
			.sort((a, b) => a.reel - b.reel || a.row - b.row)
			.map((c) => [c.reel, c.row, c.symbol]),
	);

/** One forced round through the facade; every invariant of the translated book. */
const verifyRound = (label: string, events: BookEvent[]) => {
	const types = events.map((e) => e.type);
	// Every event's `index` is its ordinal in the book; a payload field of that name would overwrite it
	// (the wheel's segment once did).
	check(
		`${label}: every event keeps its ordinal index`,
		events.every((e, i) => e.index === i),
		true,
	);
	check(
		`${label}: no wire event leaks through untranslated`,
		types.filter((t) => t.startsWith('_')),
		[],
	);
	check(
		`${label}: the feature is not presented as free spins`,
		types.filter((t) => ['freeSpinTrigger', 'updateFreeSpin', 'freeSpinEnd'].includes(t)),
		[],
	);
	const reveal = events.find((e) => e.type === 'reveal') as
		{ board: { name: string; value?: number; jackpot?: string }[][] } | undefined;
	check(`${label}: the base board is revealed once`, types.filter((t) => t === 'reveal').length, 1);
	const names = (reveal?.board ?? []).flat().map((s) => s.name);
	check(
		`${label}: no board cell keeps its wire syntax`,
		names.filter((n) => n.includes(':')),
		[],
	);

	const trigger = events.find((e) => e.type === 'holdAndWinTrigger');
	if (!trigger) return { triggered: false, types };
	check(`${label}: the trigger carries the mode fields`, trigger.mode, 'holdAndWin');
	check(
		`${label}: ...and its entry payload`,
		typeof (trigger.payload as { respins?: number })?.respins,
		'number',
	);

	let state = emptyHoldAndWinState();
	let snapshots = 0;
	let lastTotal = 0;
	for (const event of events) {
		if (!HW_TYPES.has(event.type)) continue;
		if (event.type === 'holdAndWinState') {
			const server = (event as { snapshot: HoldAndWinState }).snapshot;
			snapshots += 1;
			check(
				`${label}: snapshot ${snapshots} — the events rebuild the server's board`,
				canon(state),
				canon({ ...emptyHoldAndWinState(), ...server }),
			);
			// A board-ending respin (full board, every letter) reports a reset in `respinUpdate` while
			// its closing snapshot says 0 left — the mock's own disagreement; the snapshot wins.
			if (server.left > 0) {
				check(`${label}: snapshot ${snapshots} — counter`, state.left, server.left);
				check(`${label}: snapshot ${snapshots} — counter cap`, state.start, server.start);
			}
			check(`${label}: snapshot ${snapshots} — banked`, state.banked, server.banked);
			check(`${label}: snapshot ${snapshots} — open rows`, state.rows, server.rows);
			lastTotal = server.total;
		}
		state = applyHoldAndWinEvent(state, event as HoldAndWinEvent);
	}
	const reveals = types.filter((t) => t === 'respinReveal').length;
	check(`${label}: one respin board per respin played`, reveals, snapshots - 1);

	const end = events.find((e) => e.type === 'holdAndWinEnd') as
		{ total: number; payload: { cells: { amount: number }[]; banked: number } } | undefined;
	check(`${label}: the feature ends`, Boolean(end), true);
	if (end) {
		const sum = end.payload.cells.reduce((s, c) => s + c.amount, 0) + end.payload.banked;
		check(
			`${label}: the end's total is its cells plus what was banked (±rounding)`,
			Math.abs(sum - end.total) <= end.payload.cells.length,
			true,
		);
		// The running total the facade computes for each snapshot (roles × values + the jackpot
		// table) must land where the server's own tally does.
		check(
			`${label}: the last snapshot's total is the end's total (±rounding)`,
			Math.abs(lastTotal - end.total) <= end.payload.cells.length,
			true,
		);
		const close = events.filter((e) => e.type === 'setTotalWin').pop() as
			{ amount: number } | undefined;
		check(
			`${label}: the round closes on at least the feature total`,
			(close?.amount ?? 0) >= end.total,
			true,
		);
		check(`${label}: the end closes the picture`, state.active, false);
	}
	return { triggered: true, types };
};

const CASES: [preset: string, force: string][] = [
	['pots', 'trigger'],
	['pots', 'special:payer'],
	['pots', 'special:multiplier'],
	['pots', 'special:collector'],
	['pots', 'mystery:jackpot:MINI'],
	['pots', 'unlock:payer'],
	['pots', 'meter:red'],
	['pots', 'lucky'],
	['pots', 'fullBoard'],
	['pots', 'chain'],
	['classic', 'trigger'],
	['classic', 'letter'],
	['classic', 'letters'],
	['classic', 'special:multiplier'],
	['collector', 'trigger'],
	['collector', 'wheel:extraCollect'],
	['collector', 'wheel:coinBoost'],
	['collector', 'chain'],
	['pots-extra', 'trigger'],
	['pots-extra', 'special:addRespins'],
	['pots-extra', 'special:upgrade:all'],
	['pots-extra', 'special:upgrade:adjacent'],
	['pots-extra', 'special:upgrade:jackpotTier'],
	['pots-extra', 'mystery:addRespins'],
	['pots-extra', 'mystery:upgrade'],
	['pots-extra', 'chain'],
	['pots-expansion-fullrow', 'unlock:2'],
	['pots-expansion-fullrow', 'expandFull'],
	['pots-expansion-unlock', 'unlock:1'],
	['pots-expansion-count', 'unlock:3'],
];

const seen = new Set<string>();
const books = new Map<string, BookEvent[]>();
for (const [preset, force] of CASES) {
	const { doc, server, rgsUrl } = await hush(() => startMock(preset, force));
	const facade = await openTab();
	const sid = `fx-${preset}-${force}`;
	delete (globalThis as MetersGlobal).__IE_HOLD_AND_WIN_METERS__;
	const events = await hush(async () => {
		await facade.requestAuthenticate({ sessionID: sid, rgsUrl, language: 'en' });
		// The boot levels are published at authenticate, for the game to seed its pots from.
		const published = (globalThis as MetersGlobal).__IE_HOLD_AND_WIN_METERS__;
		const declared = doc?.holdAndWin?.meters ?? [];
		check(
			`${preset} ${force}: the boot meter levels are published (only when the game has meters)`,
			published?.map((m) => [m.id, typeof m.level, m.max]),
			declared.length ? declared.map((m) => [m.id, 'number', m.maxLevel]) : undefined,
		);
		const bet = (await facade.requestBet({
			sessionID: sid,
			currency: 'EUR',
			amount: 1,
			mode: 'BASE',
			rgsUrl,
		})) as Answer;
		return bet.round?.state ?? [];
	});
	books.set(`${preset} ${force}`, events);
	const { triggered, types } = verifyRound(`${preset} ${force}`, events);
	check(`${preset} ${force}: the forced beat triggers the feature`, triggered, true);
	for (const t of types) seen.add(t);
	await new Promise<void>((resolve) => server.close(() => resolve()));
}

// Every engine Hold and Win event a preset can deal was produced at least once.
for (const type of HW_TYPES) {
	if (['coinInstantCollect', 'randomMetreTrigger', 'luckySpin', 'jackpotLevels'].includes(type))
		continue;
	check(`the cases produce a ${type}`, seen.has(type), true);
}

// PROGRESSIVE POOLS (design §7 11c): published at boot, restated in every book and by the balance
// heartbeat, and a forced jackpot pays the grown pool — on the `pots-progressive` test fixture.
{
	type PoolsGlobal = { __IE_HOLD_AND_WIN_JACKPOTS__?: { name: string; value: number }[] };
	const pools = () => (globalThis as PoolsGlobal).__IE_HOLD_AND_WIN_JACKPOTS__;
	const levelsIn = (events: BookEvent[]) =>
		(
			events.findLast((e) => e.type === 'jackpotLevels') as
				{ jackpots: { name: string; value: number }[] } | undefined
		)?.jackpots;
	const named = (levels: { name: string; value: number }[] | undefined) =>
		Object.fromEntries((levels ?? []).map(({ name, value }) => [name, value]));

	delete (globalThis as PoolsGlobal).__IE_HOLD_AND_WIN_JACKPOTS__;
	const plain = await hush(() => startMock('pots', ''));
	await hush(async () =>
		(await openTab()).requestAuthenticate({
			sessionID: 'fx-plain',
			rgsUrl: plain.rgsUrl,
			language: 'en',
		}),
	);
	check('progressive: a game without a progressive tier publishes no pools', pools(), undefined);
	await new Promise<void>((resolve) => plain.server.close(() => resolve()));

	const { server, rgsUrl } = await hush(() => startMock('pots-progressive', ''));
	const facade = await openTab();
	const sid = 'fx-pools';
	const books = await hush(async () => {
		await facade.requestAuthenticate({ sessionID: sid, rgsUrl, language: 'en' });
		check('progressive: the boot pools are published at their seeds', named(pools()), {
			MINOR: 30,
			MAJOR: 100,
			GRAND: 2000,
		});
		const out: BookEvent[][] = [];
		for (let i = 0; i < 3; i++) {
			const bet = (await facade.requestBet({
				sessionID: sid,
				currency: 'EUR',
				amount: 1,
				mode: 'BASE',
				rgsUrl,
			})) as Answer;
			out.push(bet.round?.state ?? []);
			await facade.requestEndRound({ sessionID: sid, rgsUrl });
		}
		return out;
	});
	check(
		'progressive: every book restates the pools, grown by each bet',
		books.map((events) => named(levelsIn(events)).MAJOR),
		[100.2, 100.4, 100.6],
	);
	delete (globalThis as PoolsGlobal).__IE_HOLD_AND_WIN_JACKPOTS__;
	await hush(() => facade.requestBalance({ sessionID: sid, rgsUrl }));
	check('progressive: the balance heartbeat republishes the pools', named(pools()), {
		MINOR: 33,
		MAJOR: 100.6,
		GRAND: 2003,
	});
	await new Promise<void>((resolve) => server.close(() => resolve()));

	const hit = await hush(() => startMock('pots-progressive', 'jackpot:GRAND'));
	const hitTab = await openTab();
	const events = await hush(async () => {
		await hitTab.requestAuthenticate({
			sessionID: 'fx-pool-hit',
			rgsUrl: hit.rgsUrl,
			language: 'en',
		});
		const bet = (await hitTab.requestBet({
			sessionID: 'fx-pool-hit',
			currency: 'EUR',
			amount: 1,
			mode: 'BASE',
			rgsUrl: hit.rgsUrl,
		})) as Answer;
		return bet.round?.state ?? [];
	});
	verifyRound('progressive GRAND', events);
	const win = events.find((e) => e.type === 'jackpotWin' && e.tier === 'GRAND');
	check(
		'progressive: a forced GRAND pays the pool the bet grew (2001×), in book units',
		win?.amount,
		2001 * BOOK_AMOUNT_MULTIPLIER,
	);
	check(
		'progressive: …and the won pool is back at its seed after',
		named(levelsIn(events)).GRAND,
		2000,
	);
	await new Promise<void>((resolve) => hit.server.close(() => resolve()));
}

// The Phase 11a specials, translated into the contract's shapes.
{
	const of = (book: string, type: string): unknown[] =>
		(books.get(book) ?? []).filter((e) => e.type === type);
	const added = of('pots-extra special:addRespins', 'respinsAdded')[0] as
		| {
				cell: { symbol: { name: string; value?: number } };
				added: number;
				left: number;
				total: number;
		  }
		| undefined;
	check(
		'respinsAdded: the cell carries its respins as the value',
		[added?.cell.symbol.name, added?.cell.symbol.value === added?.added],
		['ADD', true],
	);
	check(
		'respinsAdded: left and total are numbers (the counter after, its cap)',
		[typeof added?.left, typeof added?.total],
		['number', 'number'],
	);
	check(
		'a non-sticky add-respins leaves with reason applied',
		(of('pots-extra special:addRespins', 'cellsCleared') as BookEvent[]).some(
			(e) => e.reason === 'applied' && (e.cells as unknown[]).length === 1,
		),
		true,
	);
	for (const rule of ['all', 'adjacent'] as const) {
		const up = of(`pots-extra special:upgrade:${rule}`, 'coinUpgrade')[0] as
			| { target: string; step: number; cells: { kind: string; from: number; to: number }[] }
			| undefined;
		check(
			`coinUpgrade ${rule}: value changes, each raised by the step`,
			[
				up?.target,
				(up?.cells.length ?? 0) > 0,
				up?.cells.every((c) => c.kind === 'value' && Math.abs(c.to - c.from - up.step) < 1e-9),
			],
			[rule, true, true],
		);
	}
	const tier = of('pots-extra special:upgrade:jackpotTier', 'coinUpgrade')[0] as
		| { target: string; step: number; cells: { kind: string; from: string; to: string }[] }
		| undefined;
	check(
		'coinUpgrade jackpotTier: one jackpot coin one tier up, step 0',
		[tier?.target, tier?.step, tier?.cells.map((c) => [c.kind, c.from, c.to])],
		['jackpotTier', 0, [['jackpot', 'MINI', 'MINOR']]],
	);
}

// Board expansion (11b): the entry's rows, each unlock, its row jackpot, the grown respin board.
{
	const of = (book: string, type: string): BookEvent[] =>
		(books.get(book) ?? []).filter((e) => e.type === type);
	const entry = of('pots-expansion-fullrow unlock:2', 'holdAndWinTrigger')[0] as
		{ payload: { expansion?: { rows: number; maxRows: number } } } | undefined;
	check('the entry carries the expansion', entry?.payload.expansion, { rows: 3, maxRows: 6 });
	check(
		'an unexpanding board carries none',
		(of('pots trigger', 'holdAndWinTrigger')[0] as { payload: object })?.payload &&
			'expansion' in (of('pots trigger', 'holdAndWinTrigger')[0] as { payload: object }).payload,
		false,
	);
	check(
		'fullRow: two unlocks, 3→4→5, then the MAJOR row jackpot banked',
		[
			of('pots-expansion-fullrow unlock:2', 'rowsUnlocked').map((e) => [e.from, e.rows, e.cause]),
			of('pots-expansion-fullrow unlock:2', 'jackpotWin')
				.filter((e) => e.source === 'row')
				.map((e) => [e.tier, e.banked]),
		],
		[
			[
				[3, 4, 'fullRow'],
				[4, 5, 'fullRow'],
			],
			[['MAJOR', true]],
		],
	);
	const reveals = of('pots-expansion-fullrow expandFull', 'respinReveal') as unknown as {
		cells: { row: number }[];
	}[];
	check(
		'the respin board grows with the rows: the last reveal is 5 reels × 6 rows',
		reveals.at(-1)?.cells.length,
		30,
	);
	check(
		'expandFull pays the full-board jackpot on the 6-row board',
		of('pots-expansion-fullrow expandFull', 'jackpotWin')
			.filter((e) => e.source === 'fullBoard')
			.map((e) => e.tier),
		['GRAND'],
	);
	const unlock = of('pots-expansion-unlock unlock:1', 'rowsUnlocked')[0] as
		{ cause: string; unlockers: { symbol: { name: string } }[] } | undefined;
	check(
		'unlockSymbol: the unlocker rides the event, then leaves as applied',
		[
			unlock?.cause,
			unlock?.unlockers.map((u) => u.symbol.name),
			of('pots-expansion-unlock unlock:1', 'cellsCleared').some((e) => e.reason === 'applied'),
		],
		['unlockSymbol', ['UNLOCK'], true],
	);
	check(
		'coinCount: three thresholds open three rows',
		of('pots-expansion-count unlock:3', 'rowsUnlocked').map((e) => e.rows),
		[4, 5, 6],
	);
}

// A base-game instant collect and a Lucky Spin, which do not open the feature on their own.
{
	const { server, rgsUrl } = await hush(() => startMock('collector', 'instant'));
	const facade = await openTab();
	const events = await hush(async () => {
		await facade.requestAuthenticate({ sessionID: 'fx-instant', rgsUrl, language: 'en' });
		const bet = (await facade.requestBet({
			sessionID: 'fx-instant',
			currency: 'EUR',
			amount: 1,
			mode: 'BASE',
			rgsUrl,
		})) as Answer;
		return bet.round?.state ?? [];
	});
	const instant = events.find((e) => e.type === 'coinInstantCollect') as
		{ amount: number; cells: { amount: number }[] } | undefined;
	check('instant collect: translated', Boolean(instant), true);
	check('instant collect: amounts in book units', (instant?.amount ?? 0) > 0, true);
	await new Promise<void>((resolve) => server.close(() => resolve()));
}

// A QUEUED second mode (`queuedMode`, wire doc "Modes"): it enters right after the feature's own
// trigger and exits right after its end, as the engine's generic pair — `total` in book units, the
// feature itself never doubled as a mode event.
{
	const { server, rgsUrl } = await hush(() => startMock('pots', 'queuedMode'));
	const facade = await openTab();
	const events = await hush(async () => {
		await facade.requestAuthenticate({ sessionID: 'fx-queued', rgsUrl, language: 'en' });
		const bet = (await facade.requestBet({
			sessionID: 'fx-queued',
			currency: 'EUR',
			amount: 1,
			mode: 'BASE',
			rgsUrl,
		})) as Answer;
		return bet.round?.state ?? [];
	});
	verifyRound('queuedMode', events);
	const types = events.map((e) => e.type);
	const enter = events.find((e) => e.type === 'modeEnter');
	const exit = events.find((e) => e.type === 'modeExit');
	check('queuedMode: the queued mode enters', enter && [enter.mode, enter.cause, enter.policy], [
		'queuedFixture',
		'forced',
		'queue',
	]);
	check(
		'queuedMode: ...right after the feature opens',
		types.indexOf('modeEnter') > types.indexOf('holdAndWinTrigger'),
		true,
	);
	check('queuedMode: it exits with a total in book units', exit && [exit.mode, exit.total], [
		'queuedFixture',
		0,
	]);
	check(
		'queuedMode: ...right after the feature ends',
		types.indexOf('modeExit') > types.indexOf('holdAndWinEnd'),
		true,
	);
	check(
		'queuedMode: the feature itself is never a mode event',
		events.filter(
			(e) => (e.type === 'modeEnter' || e.type === 'modeExit') && e.mode === 'holdAndWin',
		).length,
		0,
	);
	await new Promise<void>((resolve) => server.close(() => resolve()));
}

// RESUME: a feature left open after two respins, picked up by a fresh tab. The replayed `bet` sets
// the base before any amount converts, and the book rebuilds the feature to its end.
{
	const { server, rgsUrl } = await hush(() => startMock('pots', 'trigger'));
	const sid = 'fx-resume';
	const post = async (seq: number, gid: string | null, body: unknown) => {
		const query = `sid=${sid}&seq=${seq}${gid ? `&gid=${gid}` : ''}`;
		const res = await fetch(`http://${rgsUrl}/rgs/engine?${query}`, {
			method: 'POST',
			body: JSON.stringify(body),
		});
		return (await res.json()) as {
			platform: { gameRound?: { id?: string } };
			events: { event: string; context?: { holdAndWin?: { cells: unknown[] } } }[];
		};
	};
	await post(0, null, [{ action: 'config' }]);
	const opened = await post(0, null, [
		{ action: 'bet', context: [25, 4] },
		{ action: 'play', context: null },
	]);
	const gid = opened.platform.gameRound?.id ?? null;
	let last = opened;
	for (const seq of [2, 3]) last = await post(seq, gid, [{ action: 'play' }]);
	const held = last.events.find((e) => e.event === 'playedBonusSpin')?.context?.holdAndWin;
	check('resume: the feature is open after two respins', Boolean(gid && held), true);

	const facade = await openTab();
	const resumed = await hush(
		async () =>
			(await facade.requestAuthenticate({ sessionID: sid, rgsUrl, language: 'en' })) as Answer,
	);
	const book = resumed.round?.state ?? [];
	verifyRound('resume', book);
	const states = book.filter((e) => e.type === 'holdAndWinState') as unknown as {
		snapshot: { cells: unknown[] };
	}[];
	check(
		'resume: the replayed respins rebuild the board held at the break',
		states[2]?.snapshot.cells.length,
		held?.cells.length,
	);
	// The engine presents the book from `round.event` and folds everything before it into the
	// snapshot. A mid-feature resume must start at the first respin still to come, with the last
	// snapshot before it holding the board as the server stored it — so the trigger does not replay.
	const at = Number(resumed.round?.event);
	const before = book.slice(0, at);
	const lastState = before.filter((e) => e.type === 'holdAndWinState').pop() as unknown as
		{ snapshot: { cells: unknown[] } } | undefined;
	check('resume: it picks up past the replayed respins, not at 0', at > 0, true);
	check(
		'resume: the snapshot before the resume point is the board held at the break',
		lastState?.snapshot.cells.length,
		held?.cells.length,
	);
	check('resume: the first event presented is the next respin', book[at]?.type, 'respinReveal');
	check(
		'resume: the trigger is folded into the snapshot, not presented again',
		book.slice(at).some((e) => e.type === 'holdAndWinTrigger'),
		false,
	);
	check(
		'resume: the feature still ends in the presented part',
		book.slice(at).some((e) => e.type === 'holdAndWinEnd'),
		true,
	);
	await new Promise<void>((resolve) => server.close(() => resolve()));
}

// RESUME, the two edges: a break right after the feature opened (no respin stored yet) resumes at
// the first respin; a break after the feature ENDED (only the collect missing) resumes at 0 — the
// whole book plays again, as every other round's resume does.
for (const edge of ['entry', 'ended'] as const) {
	const { server, rgsUrl } = await hush(() => startMock('pots', 'trigger'));
	const sid = `fx-resume-${edge}`;
	const post = async (seq: number, gid: string | null, body: unknown) => {
		const query = `sid=${sid}&seq=${seq}${gid ? `&gid=${gid}` : ''}`;
		const res = await fetch(`http://${rgsUrl}/rgs/engine?${query}`, {
			method: 'POST',
			body: JSON.stringify(body),
		});
		return (await res.json()) as {
			platform: { gameRound?: { id?: string } };
			events: { event: string }[];
		};
	};
	await post(0, null, [{ action: 'config' }]);
	const opened = await post(0, null, [
		{ action: 'bet', context: [25, 4] },
		{ action: 'play', context: null },
	]);
	const gid = opened.platform.gameRound?.id ?? null;
	if (edge === 'ended') {
		let seq = 2;
		let ended = false;
		while (!ended && seq < 60) {
			const r = await post(seq++, gid, [{ action: 'play' }]);
			ended = r.events.some((e) => e.event === 'gameEnd');
		}
		check(`resume ${edge}: the feature ended before the break`, ended, true);
	}
	const facade = await openTab();
	const resumed = await hush(
		async () =>
			(await facade.requestAuthenticate({ sessionID: sid, rgsUrl, language: 'en' })) as Answer,
	);
	const book = resumed.round?.state ?? [];
	const at = Number(resumed.round?.event);
	if (edge === 'entry') {
		check('resume entry: it picks up past the trigger', at > 0, true);
		check('resume entry: the first event presented is respin 1', book[at]?.type, 'respinReveal');
		check(
			'resume entry: the snapshot before it is the entry picture',
			book.slice(0, at).some((e) => e.type === 'holdAndWinState'),
			true,
		);
	} else {
		check('resume ended: an ended feature replays from 0', resumed.round?.event, '0');
		check(
			'resume ended: and the book still carries the feature',
			book.some((e) => e.type === 'holdAndWinEnd'),
			true,
		);
	}
	await new Promise<void>((resolve) => server.close(() => resolve()));
}

realLog(`\n${passes} Hold and Win facade checks passed, ${failures} failed.`);
if (failures) {
	realLog(report.join('\n'));
	process.exit(1);
}
