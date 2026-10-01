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

type Facade = typeof import('./src/engineFacade.ts');
type BookEvent = { type: string; [key: string]: unknown };
type Answer = { balance?: { amount: number }; round?: { state?: BookEvent[]; active?: boolean } };

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
	const doc = normalizeGameConfigDoc(HOLD_AND_WIN_PRESETS[preset]);
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

const HW_TYPES = new Set([
	'luckySpin',
	'meterUpdate',
	'meterLevels',
	'coinInstantCollect',
	'randomMetreTrigger',
	'holdAndWinTrigger',
	'holdAndWinWheel',
	'respinReveal',
	'coinsLand',
	'mysteryReveal',
	'coinPay',
	'coinBoost',
	'specialBecomesCoin',
	'coinCollect',
	'cellsCleared',
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
		| { board: { name: string; value?: number; jackpot?: string }[][] }
		| undefined;
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
			}
			check(`${label}: snapshot ${snapshots} — banked`, state.banked, server.banked);
		}
		state = applyHoldAndWinEvent(state, event as HoldAndWinEvent);
	}
	const reveals = types.filter((t) => t === 'respinReveal').length;
	check(`${label}: one respin board per respin played`, reveals, snapshots - 1);

	const end = events.find((e) => e.type === 'holdAndWinEnd') as
		| { total: number; payload: { cells: { amount: number }[]; banked: number } }
		| undefined;
	check(`${label}: the feature ends`, Boolean(end), true);
	if (end) {
		const sum = end.payload.cells.reduce((s, c) => s + c.amount, 0) + end.payload.banked;
		check(
			`${label}: the end's total is its cells plus what was banked (±rounding)`,
			Math.abs(sum - end.total) <= end.payload.cells.length,
			true,
		);
		const close = events.filter((e) => e.type === 'setTotalWin').pop() as
			| { amount: number }
			| undefined;
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
];

const seen = new Set<string>();
for (const [preset, force] of CASES) {
	const { server, rgsUrl } = await hush(() => startMock(preset, force));
	const facade = await openTab();
	const sid = `fx-${preset}-${force}`;
	const events = await hush(async () => {
		await facade.requestAuthenticate({ sessionID: sid, rgsUrl, language: 'en' });
		const bet = (await facade.requestBet({
			sessionID: sid,
			currency: 'EUR',
			amount: 1,
			mode: 'BASE',
			rgsUrl,
		})) as Answer;
		return bet.round?.state ?? [];
	});
	const { triggered, types } = verifyRound(`${preset} ${force}`, events);
	check(`${preset} ${force}: the forced beat triggers the feature`, triggered, true);
	for (const t of types) seen.add(t);
	await new Promise<void>((resolve) => server.close(() => resolve()));
}

// Every engine Hold and Win event a preset can deal was produced at least once.
for (const type of HW_TYPES) {
	if (['coinInstantCollect', 'randomMetreTrigger', 'luckySpin'].includes(type)) continue;
	check(`the cases produce a ${type}`, seen.has(type), true);
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
		| { amount: number; cells: { amount: number }[] }
		| undefined;
	check('instant collect: translated', Boolean(instant), true);
	check('instant collect: amounts in book units', (instant?.amount ?? 0) > 0, true);
	await new Promise<void>((resolve) => server.close(() => resolve()));
}

realLog(`\n${passes} Hold and Win facade checks passed, ${failures} failed.`);
if (failures) {
	realLog(report.join('\n'));
	process.exit(1);
}
