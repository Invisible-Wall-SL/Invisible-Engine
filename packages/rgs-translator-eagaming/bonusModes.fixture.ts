/**
 * Several respin modes through the facade (design `bonus-games.md` §2.2, Phase 3): a boot `config`
 * that declares two respin modes in `bonusModes`, and rounds that play in each. Every respin round is
 * dealt by the REAL Hold and Win mock; a proxy in front of it rewrites only what the shared wire
 * contract adds — the boot's `bonusModes` (the mock's own rules as mode B, another preset's as the
 * primary A) and, for a round in B, its bonus key and the `mode` its contexts name.
 *
 * Mode B is `pots-expansion-fullrow` (all coins sticky, MINI 15×, a board growing to 6 rows); the
 * primary A is `collector` (collectors only, MINI 25×, no expansion). A round translated under the
 * wrong mode's rules shows it: a wrong stickiness, a wrong jackpot worth, a board clamped to 3 rows.
 *
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs packages/rgs-translator-eagaming/bonusModes.fixture.ts
 */

import { createServer, type IncomingMessage, type Server } from 'node:http';

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
import { modeOpOf } from '../engine-game/src/game/modeEvents.ts';
import { createMockRgs } from '../../scripts/mock-rgs-server-holdandwin.mjs';
import { readHoldAndWinModes } from './src/holdAndWin.ts';
import { bonusRoutes, type PotsOverlayWireConfig } from './src/potsOverlay.ts';

type Facade = typeof import('./src/engineFacade.ts');
type BookEvent = { type: string; [key: string]: unknown };
type WireEvent = { event: string; context?: Record<string, unknown> };
type WireAnswer = { events?: WireEvent[] };

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

let tabs = 0;
const openTab = (): Promise<Facade> => import(`./src/engineFacade.ts?tab=${++tabs}`);

const listen = async (server: Server): Promise<string> => {
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const address = server.address();
	return `localhost:${typeof address === 'object' && address ? address.port : 0}`;
};
const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

const startMock = async (preset: string, force: string) => {
	const doc = normalizeGameConfigDoc(
		HOLD_AND_WIN_PRESETS[preset as keyof typeof HOLD_AND_WIN_PRESETS] ??
			HOLD_AND_WIN_TEST_FIXTURES[preset],
	);
	const mock = createMockRgs({
		label: `modes-${preset}`,
		quiet: true,
		seed: `modes-${preset}-${force}`,
		reels: doc.numReels,
		rows: Math.max(...doc.numRows),
		paylines: Object.values(doc.paylines),
		holdAndWin: holdAndWinMockInputs(doc),
		...(force ? { force } : {}),
	});
	const server = createServer((req, res) =>
		mock.handle(req, res, new URL(req.url ?? '/', `http://${req.headers.host}`)),
	);
	return { server, rgsUrl: await listen(server) };
};

const bodyOf = (req: IncomingMessage): Promise<string> =>
	new Promise((resolve) => {
		let text = '';
		req.on('data', (chunk) => (text += chunk));
		req.on('end', () => resolve(text));
	});

/** A proxy in front of `rgsUrl` that hands every JSON answer through `rewrite`. */
const startProxy = async (rgsUrl: string, rewrite: (answer: WireAnswer) => void) => {
	const server = createServer(async (req, res) => {
		const body = await bodyOf(req);
		const upstream = await fetch(`http://${rgsUrl}${req.url}`, {
			method: req.method,
			...(req.method === 'POST' ? { body } : {}),
		});
		const answer = (await upstream.json()) as WireAnswer;
		rewrite(answer);
		res.writeHead(upstream.status, { 'content-type': 'application/json' });
		res.end(JSON.stringify(answer));
	});
	return { server, rgsUrl: await listen(server) };
};

/** A preset's boot `holdAndWin` block, as its mock declares it. */
const bootBlockOf = async (preset: string): Promise<Record<string, unknown>> => {
	const { server, rgsUrl } = await hush(() => startMock(preset, ''));
	const res = await fetch(`http://${rgsUrl}/rgs/engine?sid=boot-${preset}&seq=0`, {
		method: 'POST',
		body: JSON.stringify([{ action: 'config' }]),
	});
	const answer = (await res.json()) as WireAnswer;
	await close(server);
	const block = answer.events?.find((e) => e.event === 'config')?.context?.holdAndWin;
	if (!block) throw new Error(`${preset}: its mock declares no holdAndWin block`);
	return block as Record<string, unknown>;
};

const MODE_B = 'holdAndWin_2';
const KEY_B = 'respin_2';
const PRIMARY = await bootBlockOf('collector');

/**
 * Mode B's rewrite: the boot declares the primary A and the mock's own rules as B (the legacy
 * `holdAndWin` stays the primary's, as the contract keeps it); the round's bonus arrives under B's
 * key, and — with `named` — every context the contract lists names B.
 */
const asModeB =
	(named: boolean) =>
	(answer: WireAnswer): void => {
		for (const e of answer.events ?? []) {
			const ctx = e.context;
			if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) continue;
			if (e.event === 'config') {
				const own = ctx.holdAndWin as Record<string, unknown>;
				ctx.bonusModes = [
					{ mode: 'holdAndWin', gameType: 'respin', ...PRIMARY },
					{ mode: MODE_B, gameType: KEY_B, ...own, bonus: KEY_B, blank: 'BLANK_2' },
				];
				ctx.holdAndWin = PRIMARY;
				continue;
			}
			if (e.event === 'spinTrigger' && ctx.bonus === 'respin') ctx.bonus = KEY_B;
			if (
				named &&
				['enterBonus', 'playedBonusSpin', 'holdAndWinTrigger', 'holdAndWinEnd'].includes(e.event)
			)
				ctx.mode = MODE_B;
		}
	};

const playRound = async (rgsUrl: string, sid: string): Promise<BookEvent[]> =>
	hush(async () => {
		const facade = await openTab();
		await facade.requestAuthenticate({ sessionID: sid, rgsUrl, language: 'en' });
		const bet = (await facade.requestBet({
			sessionID: sid,
			currency: 'EUR',
			amount: 1,
			mode: 'BASE',
			rgsUrl,
		})) as { round?: { state?: BookEvent[] } };
		return bet.round?.state ?? [];
	});

const HW_TYPES = new Set([
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

/** A round played in `mode` under rules whose stickiness is `stickiness`: every board-level event
 *  names the mode (or, for `holdAndWin`, names none), the mode stack enters and leaves it, and the
 *  events rebuild every server snapshot with totals under its own jackpot table. */
const verifyModeRound = (label: string, events: BookEvent[], mode: string, stickiness: string) => {
	const types = events.map((e) => e.type);
	check(
		`${label}: nothing leaks untranslated`,
		types.filter((t) => t.startsWith('_')),
		[],
	);
	check(
		`${label}: not presented as free spins`,
		types.filter((t) => t.startsWith('freeSpin')),
		[],
	);
	const trigger = events.find((e) => e.type === 'holdAndWinTrigger');
	const end = events.find((e) => e.type === 'holdAndWinEnd') as
		{ mode?: string; total: number; payload: { cells: unknown[] } } | undefined;
	check(`${label}: the trigger names the mode`, trigger?.mode, mode);
	check(`${label}: the end names the mode`, end?.mode, mode);
	check(
		`${label}: the mode stack enters and leaves that mode`,
		[trigger && modeOpOf(trigger), end && modeOpOf(end)].map((op) => op && [op.op, op.id]),
		[
			['enter', mode],
			['exit', mode],
		],
	);
	const boardLevel = events.filter(
		(e) => e.type === 'respinReveal' || e.type === 'holdAndWinState',
	);
	check(
		`${label}: every respinReveal / holdAndWinState names ${mode === 'holdAndWin' ? 'no mode' : 'the mode'}`,
		boardLevel.map((e) => e.mode),
		boardLevel.map(() => (mode === 'holdAndWin' ? undefined : mode)),
	);

	let state = emptyHoldAndWinState();
	let lastTotal = 0;
	let snapshots = 0;
	for (const event of events) {
		if (!HW_TYPES.has(event.type)) continue;
		if (event.type === 'holdAndWinState') {
			const server = (event as { snapshot: HoldAndWinState }).snapshot;
			snapshots += 1;
			check(
				`${label}: snapshot ${snapshots} rebuilds the server's board`,
				canon(state),
				canon({ ...emptyHoldAndWinState(), ...server }),
			);
			check(
				`${label}: snapshot ${snapshots} carries the mode's stickiness`,
				server.stickiness,
				stickiness,
			);
			lastTotal = server.total;
		}
		state = applyHoldAndWinEvent(state, event as HoldAndWinEvent);
	}
	check(`${label}: the respins were snapshotted`, snapshots > 1, true);
	check(
		`${label}: the last snapshot's total (the mode's own jackpot table) is the end's total`,
		end ? Math.abs(lastTotal - end.total) <= end.payload.cells.length : false,
		true,
	);
	check(`${label}: the end closes the picture`, state.active, false);
	return boardLevel;
};

// ---------- the reader ----------

{
	const legacy = readHoldAndWinModes({ holdAndWin: PRIMARY });
	check(
		'reader: a legacy boot is one mode, holdAndWin, the primary',
		legacy && [[...legacy.modes.keys()], legacy.primary],
		[['holdAndWin'], 'holdAndWin'],
	);

	const own = { ...PRIMARY, stickiness: 'allCoins', expansion: { startRows: 3, maxRows: 6 } };
	const two = readHoldAndWinModes({
		holdAndWin: PRIMARY,
		bonusModes: [
			{ mode: MODE_B, gameType: KEY_B, ...own, bonus: KEY_B, blank: 'BLANK_2' },
			{ mode: 'holdAndWin', gameType: 'respin', ...PRIMARY },
		],
	});
	check(
		'reader: bonusModes wins over the legacy block; holdAndWin stays the primary wherever it is listed',
		two && [[...two.modes.keys()], two.primary],
		[[MODE_B, 'holdAndWin'], 'holdAndWin'],
	);
	const b = two?.modes.get(MODE_B);
	check(
		'reader: each mode keeps its own key, blank, stickiness and expansion',
		[
			b?.bonus,
			b?.blank,
			b?.stickiness,
			b?.expansion?.maxRows,
			two?.modes.get('holdAndWin')?.stickiness,
		],
		[KEY_B, 'BLANK_2', 'allCoins', 6, 'collectorsOnly'],
	);
	const without = await hush(() =>
		readHoldAndWinModes({
			bonusModes: [
				{ mode: 'pick', ...PRIMARY, wire: 99 },
				{ ...PRIMARY },
				{ mode: MODE_B, ...own },
				{ mode: MODE_B, ...PRIMARY },
				{ mode: 'holdAndWin_3', ...PRIMARY },
			],
		}),
	);
	check(
		'reader: without holdAndWin the first mode is the primary; another wire, no id and a repeat are dropped',
		without && [[...without.modes.keys()], without.primary, without.modes.get(MODE_B)?.stickiness],
		[[MODE_B, 'holdAndWin_3'], MODE_B, 'allCoins'],
	);
	check(
		'reader: no block at all is no Hold and Win',
		readHoldAndWinModes({ bonusModes: [] }),
		null,
	);
}

// ---------- the overlay's routes ----------

{
	const overlay: PotsOverlayWireConfig = {
		wire: 1,
		pots: [],
		bonuses: { red: 'holdAndWin', gold: MODE_B, green: 'freeSpins' },
		modes: {},
	};
	const respin = new Set(['holdAndWin', MODE_B]);
	const keys: Record<string, string> = { respin: 'holdAndWin', [KEY_B]: MODE_B };
	const routes = bonusRoutes(
		overlay,
		(mode) => respin.has(mode),
		(key) => keys[key],
		['red', 'gold', 'green', KEY_B, 'unknown'].map((bonus) => ({
			event: 'spinTrigger',
			context: { bonus },
		})),
	);
	check(
		'routes: each pot plays its own respin mode; free spins and an unknown key play on the reels',
		routes,
		[{ respins: 'holdAndWin' }, { respins: MODE_B }, 'reels', { respins: MODE_B }, 'reels'],
	);
	check(
		'routes: a pot naming a mode the boot declared no rules for plays on the reels',
		bonusRoutes(
			overlay,
			() => false,
			() => undefined,
			[{ event: 'spinTrigger', context: { bonus: 'red' } }],
		),
		['reels'],
	);
}

// ---------- a two-mode boot, a round in mode B ----------

const books = new Map<string, BookEvent[]>();
for (const force of ['expandFull', 'mystery:jackpot:MINI'] as const) {
	for (const named of [true, false]) {
		const label = `mode B ${force} (${named ? 'contexts name the mode' : 'by its bonus key'})`;
		const mock = await hush(() => startMock('pots-expansion-fullrow', force));
		const proxy = await startProxy(mock.rgsUrl, asModeB(named));
		const events = await playRound(proxy.rgsUrl, `modes-${force}-${named}`);
		books.set(label, events);
		verifyModeRound(label, events, MODE_B, 'allCoins');
		await close(proxy.server);
		await close(mock.server);
	}
}
{
	const grown = books.get('mode B expandFull (contexts name the mode)') ?? [];
	const reveals = grown.filter((e) => e.type === 'respinReveal') as unknown as {
		cells: unknown[];
	}[];
	check(
		"mode B: the board grows to B's 6 rows (5 × 6 cells), not the primary's 3",
		reveals.at(-1)?.cells.length,
		30,
	);
	const entry = grown.find((e) => e.type === 'holdAndWinTrigger') as
		{ payload: { expansion?: { maxRows: number } } } | undefined;
	check("mode B: the entry carries B's expansion", entry?.payload.expansion?.maxRows, 6);
	const mini = books.get('mode B mystery:jackpot:MINI (contexts name the mode)') ?? [];
	check(
		"mode B: a MINI jackpot coin is held, so the snapshot totals above were priced on B's table",
		mini.some(
			(e) =>
				e.type === 'holdAndWinState' &&
				(e.snapshot as HoldAndWinState).cells.some((c) => c.symbol.jackpot === 'MINI'),
		),
		true,
	);
	check(
		'mode B: naming the mode and routing by its key translate the same round alike',
		books.get('mode B expandFull (by its bonus key)'),
		grown,
	);
}

// ---------- the same two-mode boot, a round in the primary ----------

{
	const mock = await hush(() => startMock('collector', 'trigger'));
	const proxy = await startProxy(mock.rgsUrl, (answer) => {
		const cfg = answer.events?.find((e) => e.event === 'config')?.context;
		if (cfg) {
			const own = cfg.holdAndWin as Record<string, unknown>;
			cfg.bonusModes = [
				{ mode: MODE_B, gameType: KEY_B, ...own, bonus: KEY_B, stickiness: 'allCoins' },
				{ mode: 'holdAndWin', gameType: 'respin', ...own },
			];
		}
	});
	const events = await playRound(proxy.rgsUrl, 'modes-primary');
	verifyModeRound('primary (no mode named, its own key)', events, 'holdAndWin', 'collectorsOnly');
	await close(proxy.server);
	await close(mock.server);
}

// ---------- a legacy-only boot reads exactly as before ----------

for (const [preset, force] of [
	['pots', 'trigger'],
	['pots-expansion-fullrow', 'unlock:2'],
	['collector', 'chain'],
] as const) {
	const legacyMock = await hush(() => startMock(preset, force));
	const legacy = await playRound(legacyMock.rgsUrl, `legacy-${preset}`);
	await close(legacyMock.server);
	verifyModeRound(
		`legacy ${preset} ${force}`,
		legacy,
		'holdAndWin',
		preset === 'collector' ? 'collectorsOnly' : 'allCoins',
	);
	const declaredMock = await hush(() => startMock(preset, force));
	const proxy = await startProxy(declaredMock.rgsUrl, (answer) => {
		const cfg = answer.events?.find((e) => e.event === 'config')?.context;
		if (cfg)
			cfg.bonusModes = [{ mode: 'holdAndWin', gameType: 'respin', ...(cfg.holdAndWin as object) }];
	});
	const declared = await playRound(proxy.rgsUrl, `legacy-${preset}`);
	check(
		`legacy ${preset} ${force}: the same rules declared in bonusModes translate byte for byte alike`,
		declared,
		legacy,
	);
	await close(proxy.server);
	await close(declaredMock.server);
}

realLog(`\n${passes} bonus-mode facade checks passed, ${failures} failed.`);
if (failures) {
	realLog(report.join('\n'));
	process.exit(1);
}
