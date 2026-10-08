/**
 * Several respin modes through the facade (design `bonus-games.md` §2.2, Phase 3): a boot `config`
 * that declares respin modes in `bonusModes`, and rounds that play in them. Every respin round is
 * dealt by the REAL Hold and Win mock; a proxy in front of it rewrites only what the per-mode wire
 * adds (`docs/reference/hold-and-win-wire.md` "Several respin modes"): the boot's `bonusModes`, primary
 * first, the mode's strip key as its bonus key, and `mode` on the six contexts that name it.
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

/** The six wire contexts that name their respin mode. */
const NAMING = [
	'spinTrigger',
	'holdAndWinTrigger',
	'enterBonus',
	'playedBonusSpin',
	'playedBonusSpins',
	'holdAndWinEnd',
];

/**
 * The per-mode wire over the mock's single-mode answer: the boot declares `modes` (`[mode, block]`,
 * primary first, the legacy `holdAndWin` staying the primary's), and the round plays in `mode` under
 * the strip key `key` — its bonus key — with every naming context tagged.
 */
const perModeWire =
	(
		modes: (own: Record<string, unknown>) => [string, string, Record<string, unknown>][],
		mode: string,
		key: string,
	) =>
	(answer: WireAnswer): void => {
		for (const e of answer.events ?? []) {
			const ctx = e.context;
			if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) continue;
			if (e.event === 'config') {
				const declared = modes(ctx.holdAndWin as Record<string, unknown>);
				ctx.bonusModes = declared.map(([id, gameType, block]) => ({
					mode: id,
					gameType,
					...block,
					bonus: gameType,
				}));
				ctx.holdAndWin = { ...declared[0][2], bonus: declared[0][1] };
				continue;
			}
			if (e.event === 'spinTrigger') {
				ctx.bonus = key;
				(ctx.trigger as Record<string, unknown>).mode = mode;
			}
			if (NAMING.includes(e.event)) ctx.mode = mode;
		}
	};

/** Primary A, then B — the mock's own rules under the strip key `respin_2`. */
const twoModes = (own: Record<string, unknown>): [string, string, Record<string, unknown>][] => [
	['holdAndWin', 'respin', PRIMARY],
	[MODE_B, KEY_B, { ...own, blank: 'BLANK_2' }],
];

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
 *  names the mode, the mode stack enters and leaves it, and the
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
		`${label}: every respinReveal / holdAndWinState names the mode`,
		boardLevel.map((e) => e.mode),
		boardLevel.map(() => mode),
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
		'reader: bonusModes wins over the legacy block; its first entry is the primary',
		two && [[...two.modes.keys()], two.primary],
		[[MODE_B, 'holdAndWin'], MODE_B],
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
		'reader: another wire, no id and a repeat are dropped; the first kept is the primary',
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
	const label = `mode B ${force}`;
	const mock = await hush(() => startMock('pots-expansion-fullrow', force));
	const proxy = await startProxy(mock.rgsUrl, perModeWire(twoModes, MODE_B, KEY_B));
	const events = await playRound(proxy.rgsUrl, `modes-${force}`);
	books.set(label, events);
	verifyModeRound(label, events, MODE_B, 'allCoins');
	await close(proxy.server);
	await close(mock.server);
}
{
	const grown = books.get('mode B expandFull') ?? [];
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
	const mini = books.get('mode B mystery:jackpot:MINI') ?? [];
	check(
		"mode B: a MINI jackpot coin is held, so the snapshot totals above were priced on B's table",
		mini.some(
			(e) =>
				e.type === 'holdAndWinState' &&
				(e.snapshot as HoldAndWinState).cells.some((c) => c.symbol.jackpot === 'MINI'),
		),
		true,
	);
}

// ---------- the same two-mode boot, a round in the primary (its contexts tagged too) ----------

{
	const mock = await hush(() => startMock('collector', 'trigger'));
	const proxy = await startProxy(
		mock.rgsUrl,
		perModeWire(
			(own) => [
				['holdAndWin', 'respin', own],
				[MODE_B, KEY_B, { ...own, stickiness: 'allCoins' }],
			],
			'holdAndWin',
			'respin',
		),
	);
	const events = await playRound(proxy.rgsUrl, 'modes-primary');
	verifyModeRound('primary', events, 'holdAndWin', 'collectorsOnly');
	await close(proxy.server);
	await close(mock.server);
}

// ---------- a lone non-default mode ----------

{
	const mock = await hush(() => startMock('pots-expansion-fullrow', 'expandFull'));
	const proxy = await startProxy(
		mock.rgsUrl,
		perModeWire((own) => [[MODE_B, KEY_B, own]], MODE_B, KEY_B),
	);
	const events = await playRound(proxy.rgsUrl, 'modes-lone');
	verifyModeRound(`lone ${MODE_B}`, events, MODE_B, 'allCoins');
	check(
		`lone ${MODE_B}: translated as a two-mode boot translates the same round in it`,
		events,
		books.get('mode B expandFull'),
	);
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
