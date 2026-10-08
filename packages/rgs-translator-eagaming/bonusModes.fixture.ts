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
	holdAndWinBonus,
	holdAndWinMockInputs,
	holdAndWinModeDecl,
	normalizeGameConfigDoc,
	potsOverlayMockInputs,
	potsOverlayPreset,
	symbolHoldAndWinRoles,
} from '../game-config/index.ts';
import {
	applyHoldAndWinEvent,
	emptyHoldAndWinState,
	type HoldAndWinEvent,
	type HoldAndWinState,
} from '../engine-game/src/game/holdAndWin.ts';
import { modeOpOf } from '../engine-game/src/game/modeEvents.ts';
import { createMockRgs } from '../../scripts/mock-rgs-server-holdandwin.mjs';
import { withPotsOverlay } from '../../scripts/mock-pots-overlay.mjs';
import { createMockRgs as createLinesMock } from '../../scripts/mock-rgs-server.mjs';
import { applyPools, readHoldAndWinModes, respinModesOf } from './src/holdAndWin.ts';
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
const startProxy = async (
	rgsUrl: string,
	rewrite: (answer: WireAnswer) => void,
	request: (body: string) => string = (body) => body,
) => {
	const server = createServer(async (req, res) => {
		const body = request(await bodyOf(req));
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
 * The per-mode wire over the mock's single-mode answer: the boot declares `modes` (`[mode, gameType,
 * block]`, primary first, the legacy `holdAndWin` staying the primary's), and the round's Hold and
 * Win feature plays in `mode` under the strip key `key` — its bonus key. `tags`: `all` names the
 * mode as the agreed wire does (`spinTrigger.trigger.mode`, and `mode` on `holdAndWinTrigger`,
 * `enterBonus`, `playedBonusSpin(s)` and `holdAndWinEnd`); `spinTrigger` names it on the trigger
 * alone; `none` names it nowhere, leaving the route to the bonus key. `boot` edits the rest of the boot (an overlay's).
 */
const perModeWire =
	(
		modes: (own: Record<string, unknown>) => [string, string, Record<string, unknown>][],
		mode: string,
		key: string,
		{
			tags = 'all',
			boot,
		}: {
			tags?: 'all' | 'spinTrigger' | 'none';
			boot?: (ctx: Record<string, unknown>) => void;
		} = {},
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
				boot?.(ctx);
				continue;
			}
			// Only the Hold and Win feature's contexts: an overlay host's own free spins stay as dealt.
			const respinFeature =
				(e.event === 'spinTrigger' && ctx.bonus === 'respin') ||
				e.event === 'holdAndWinTrigger' ||
				e.event === 'holdAndWinEnd' ||
				(['enterBonus', 'playedBonusSpin', 'playedBonusSpins'].includes(e.event) &&
					typeof ctx.holdAndWin === 'object');
			if (!respinFeature) continue;
			if (e.event === 'spinTrigger') {
				ctx.bonus = key;
				const trigger = ctx.trigger as Record<string, unknown>;
				if (tags === 'none') delete trigger.mode;
				else trigger.mode = mode;
			} else if (tags === 'all') ctx.mode = mode;
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

// ---------- the routing rules, event by event ----------

{
	const modes = readHoldAndWinModes({
		bonusModes: [
			{ mode: 'holdAndWin', gameType: 'respin', ...PRIMARY, bonus: 'respin' },
			{ mode: MODE_B, gameType: KEY_B, ...PRIMARY, bonus: KEY_B },
		],
	});
	if (!modes) throw new Error('the two-mode boot did not read');
	const at = (
		events: { event: string; context?: unknown }[],
		overlay: PotsOverlayWireConfig | null = null,
	) => respinModesOf(modes, overlay, events);
	const feature = (tag: Record<string, unknown>) => [
		{ event: 'spinTrigger', context: { bonus: KEY_B, trigger: { mode: MODE_B } } },
		{ event: 'holdAndWinTrigger', context: tag },
		{ event: 'enterBonus', context: { ...tag, holdAndWin: {} } },
		{ event: 'coinsLand', context: {} },
		{ event: 'holdAndWinEnd', context: tag },
		{ event: 'playedBonusSpins', context: tag },
		{ event: 'jackpotLevels', context: {} },
		{ event: 'gameEnd', context: {} },
	];
	check(
		"routing: spinTrigger.trigger.mode names the feature's mode for its untagged events",
		at(feature({})).slice(0, 5),
		[MODE_B, MODE_B, MODE_B, MODE_B, MODE_B],
	);
	check(
		'routing: the mode ends at holdAndWinEnd; the closing summary does not reopen it; the rest of the round is the primary’s',
		at(feature({ mode: MODE_B })).slice(4),
		[MODE_B, MODE_B, 'holdAndWin', 'holdAndWin'],
	);
	const overlay: PotsOverlayWireConfig = {
		wire: 1,
		pots: [],
		bonuses: { respin: 'holdAndWin', [KEY_B]: MODE_B },
		modes: {},
	};
	check(
		"routing: on an overlay host the rest of the round is nobody's",
		at(feature({}), overlay).slice(4),
		[MODE_B, undefined, undefined, undefined],
	);
	check(
		'routing: a free spins’ trigger.mode (scatter) names nothing',
		at([{ event: 'spinTrigger', context: { bonus: 'feature', trigger: { mode: 'scatter' } } }]),
		['holdAndWin'],
	);
	check(
		'routing: a named mode without rules is reported as uncaptured, until the next spinTrigger',
		at([
			{ event: 'holdAndWinTrigger', context: { mode: 'holdAndWin_9' } },
			{ event: 'coinsLand', context: {} },
			{ event: 'spinTrigger', context: { bonus: 'respin' } },
		]),
		[{ uncaptured: 'holdAndWin_9' }, { uncaptured: 'holdAndWin_9' }, 'holdAndWin'],
	);

	const progressive = (seed: number) => ({
		...PRIMARY,
		jackpots: [
			{ name: 'MINI', multiplier: 15 },
			{ name: 'MAJOR', multiplier: 100, progressive: true, value: seed },
		],
	});
	const pooled = readHoldAndWinModes({
		bonusModes: [
			{ mode: 'holdAndWin', gameType: 'respin', ...progressive(100), bonus: 'respin' },
			{ mode: MODE_B, gameType: KEY_B, ...progressive(100), bonus: KEY_B },
		],
	});
	if (!pooled) throw new Error('the pooled boot did not read');
	applyPools(pooled, [
		{ name: 'MAJOR', value: 123.4 },
		{ name: 'MINI', value: 99 },
	]);
	check(
		'pools: a jackpotLevels pool moves the tier of that name in EVERY mode; a fixed tier never moves',
		[...pooled.modes.values()].map((hw) => hw.jackpots.map((j) => j.value ?? j.multiplier)),
		[
			[15, 123.4],
			[15, 123.4],
		],
	);
	check(
		'reader: bonusModes whose every entry is refused fall back to the legacy holdAndWin',
		await hush(() => {
			const read = readHoldAndWinModes({
				holdAndWin: PRIMARY,
				bonusModes: [{ mode: MODE_B, ...PRIMARY, wire: 99 }],
			});
			return read && [[...read.modes.keys()], read.primary];
		}),
		[['holdAndWin'], 'holdAndWin'],
	);
}

// ---------- only spinTrigger.trigger.mode names B ----------

{
	const mock = await hush(() => startMock('pots-expansion-fullrow', 'expandFull'));
	const proxy = await startProxy(
		mock.rgsUrl,
		perModeWire(twoModes, MODE_B, KEY_B, { tags: 'spinTrigger' }),
	);
	const events = await playRound(proxy.rgsUrl, 'modes-trigger-only');
	verifyModeRound('B named on spinTrigger.trigger only', events, MODE_B, 'allCoins');
	check(
		'B named on spinTrigger.trigger only: translated as the fully tagged round',
		events,
		books.get('mode B expandFull'),
	);
	await close(proxy.server);
	await close(mock.server);
}

// ---------- fail closed: a respin feature of a mode the boot declares no rules for ----------

const playWarned = async (rgsUrl: string, sid: string) => {
	const warnings: string[] = [];
	const events = await hush(async () => {
		console.warn = (...args: unknown[]) => warnings.push(String(args[0]));
		const facade = await openTab();
		await facade.requestAuthenticate({ sessionID: sid, rgsUrl, language: 'en' });
		const out: BookEvent[][] = [];
		for (let r = 0; r < 2; r++) {
			const bet = (await facade.requestBet({
				sessionID: sid,
				currency: 'EUR',
				amount: 1,
				mode: 'BASE',
				rgsUrl,
			})) as { round?: { state?: BookEvent[] } };
			out.push(bet.round?.state ?? []);
			await facade.requestEndRound({ sessionID: sid, rgsUrl });
		}
		return out;
	});
	return { events, warnings: warnings.filter((w) => w.includes('declares no rules')) };
};
const HW_OR_FREE = (e: BookEvent) => HW_TYPES.has(e.type) || e.type.startsWith('freeSpin');
{
	const mock = await hush(() => startMock('pots-expansion-fullrow', 'trigger'));
	const proxy = await startProxy(mock.rgsUrl, perModeWire(twoModes, 'holdAndWin_9', 'respin_9'));
	const { events, warnings } = await playWarned(proxy.rgsUrl, 'modes-uncaptured');
	check(
		'fail closed: a named mode without rules shows none of its feature, neither as respins nor as free spins',
		events.map((book) => book.filter(HW_OR_FREE).map((e) => e.type)),
		[[], []],
	);
	check(
		'fail closed: …the round still shows its board and closes',
		events.map((book) => [
			book.some((e) => e.type === 'reveal'),
			book.some((e) => e.type === 'finalWin' || e.type === 'setTotalWin'),
			book.filter((e) => e.type.startsWith('_')).length,
		]),
		[
			[true, true, 0],
			[true, true, 0],
		],
	);
	check('fail closed: …and says so once per session and mode', warnings.length, 1);
	await close(proxy.server);
	await close(mock.server);
}

// ---------- a coin overlay over a lines host: a pot routed to B ----------

const pays = (three: number, four: number, five: number) => ({
	paytable: [{ 3: three }, { 4: four }, { 5: five }],
});
const LINES_HOST = {
	providerName: 'invisible_wall',
	gameName: 'lines_host',
	gameID: 'lines_host',
	rtp: 0.96,
	numReels: 5,
	numRows: [3, 3, 3, 3, 3],
	betModes: { base: { cost: 1, feature: true, buyBonus: false, rtp: 0.96, max_win: 5000 } },
	paylines: { 1: [1, 1, 1, 1, 1], 2: [0, 0, 0, 0, 0], 3: [2, 2, 2, 2, 2] },
	symbols: {
		PIC1: pays(100, 1000, 5000),
		PIC2: pays(30, 400, 2000),
		PIC5: pays(5, 50, 150),
		PIC6: pays(5, 50, 150),
		PIC7: pays(5, 20, 100),
		SCAT: { special_properties: ['scatter'] },
	},
	paddingReels: {
		basegame: Array.from({ length: 5 }, () =>
			['PIC1', 'PIC5', 'SCAT', 'PIC6', 'PIC2', 'PIC7'].map((name) => ({ name })),
		),
		freegame: Array.from({ length: 5 }, () =>
			['PIC1', 'PIC5', 'SCAT', 'PIC6', 'PIC2', 'PIC7'].map((name) => ({ name })),
		),
	},
};
const overlayHost = async (force: string) => {
	const preset = potsOverlayPreset('threePots');
	const bonus = holdAndWinBonus(preset.holdAndWin, LINES_HOST);
	const doc = normalizeGameConfigDoc({
		...structuredClone(LINES_HOST),
		symbols: { ...LINES_HOST.symbols, ...bonus.symbols, ...preset.tokens },
		paddingReels: { ...LINES_HOST.paddingReels, ...bonus.paddingReels },
		holdAndWin: bonus.holdAndWin,
		potsOverlay: preset.potsOverlay,
	});
	const mock = withPotsOverlay(
		(opts: Record<string, unknown> = {}) => createLinesMock({ quiet: true, ...opts }),
		potsOverlayMockInputs(doc),
	)({ label: 'modes-overlay', seed: `modes-overlay-${force}`, allowForce: true });
	const server = createServer((req, res) =>
		mock.handle(req, res, new URL(req.url ?? '/', `http://${req.headers.host}`)),
	);
	return { server, rgsUrl: await listen(server) };
};
/** The first `play` of a session carries the force, as the authoring mock takes it. */
const forcing = (force: string) => {
	let armed = true;
	return (body: string) => {
		const actions = JSON.parse(body || '[]') as { action: string; context?: unknown }[];
		for (const a of actions)
			if (armed && a.action === 'play' && !a.context) {
				a.context = force;
				armed = false;
			}
		return JSON.stringify(actions);
	};
};
/** The overlay's routes gain B's strip key, and the pot that starts Hold and Win starts `mode`. */
const routedTo = (mode: string, key: string) => (ctx: Record<string, unknown>) => {
	const overlay = ctx.potsOverlay as {
		bonuses: Record<string, string>;
		pots: { bonus?: string }[];
	};
	overlay.bonuses[key] = mode;
	for (const pot of overlay.pots) if (pot.bonus === 'holdAndWin') pot.bonus = mode;
};
for (const tags of ['all', 'none'] as const) {
	const label = `overlay pot → B (${tags === 'all' ? 'contexts name B' : 'by the overlay route'})`;
	const host = await hush(() => overlayHost('force:pot:green'));
	const proxy = await startProxy(
		host.rgsUrl,
		perModeWire(
			(own) => [
				['holdAndWin', 'respin', PRIMARY],
				[MODE_B, KEY_B, { ...own, stickiness: 'allCoins' }],
			],
			MODE_B,
			KEY_B,
			{ tags, boot: routedTo(MODE_B, KEY_B) },
		),
		forcing('force:pot:green'),
	);
	const events = await playRound(proxy.rgsUrl, `modes-overlay-${tags}`);
	verifyModeRound(label, events, MODE_B, 'allCoins');
	const entry = events.find((e) => e.type === 'holdAndWinTrigger');
	check(`${label}: the pot is the cause`, entry?.cause, 'meter');
	await close(proxy.server);
	await close(host.server);
}
{
	const host = await hush(() => overlayHost('force:pot:green'));
	const proxy = await startProxy(
		host.rgsUrl,
		perModeWire(twoModes, 'holdAndWin_9', 'respin_9', {
			tags: 'none',
			boot: routedTo('holdAndWin_9', 'respin_9'),
		}),
		forcing('force:pot:green'),
	);
	const { events, warnings } = await playWarned(proxy.rgsUrl, 'modes-overlay-uncaptured');
	check(
		'fail closed: an overlay route to a mode without rules shows none of the feature (not as free spins either)',
		events[0].filter(HW_OR_FREE).map((e) => e.type),
		[],
	);
	check(
		'fail closed: …the pot that started it still empties, and it is said once',
		[events[0].some((e) => e.type === 'meterUpdate'), warnings.length],
		[true, 1],
	);
	await close(proxy.server);
	await close(host.server);
}

// ---------- the REAL two-mode mock (Phase 2): no proxy ----------

// The 3 Pots overlay over the lines host, plus the Collector preset imported as `holdAndWin_2` (its
// symbols renamed `_2`, on its own `respin_2` strip) and the green pot routed to it — the host
// `check:bonus-modes` pins on the mock side.
{
	const collector = normalizeGameConfigDoc(structuredClone(HOLD_AND_WIN_PRESETS.collector));
	const rules = collector?.modes?.find((m) => m.id === 'holdAndWin')?.holdAndWin;
	if (!collector || !rules) throw new Error('the Collector preset has no holdAndWin mode');
	const isRole = (name: string) => symbolHoldAndWinRoles(collector.symbols[name]).length > 0;
	const as2 = (name: string) => (isRole(name) ? `${name}_2` : name);
	const preset = potsOverlayPreset('threePots');
	const bonus = holdAndWinBonus(preset.holdAndWin, LINES_HOST);
	const three = normalizeGameConfigDoc({
		...structuredClone(LINES_HOST),
		symbols: { ...LINES_HOST.symbols, ...bonus.symbols, ...preset.tokens },
		paddingReels: { ...LINES_HOST.paddingReels, ...bonus.paddingReels },
		holdAndWin: bonus.holdAndWin,
		potsOverlay: preset.potsOverlay,
	});
	if (!three) throw new Error('the 3 Pots host did not normalize');
	const raw = structuredClone(three) as Record<string, unknown> & typeof three;
	delete raw.holdAndWin;
	delete raw.potsOverlay;
	for (const [name, symbol] of Object.entries(collector.symbols))
		if (isRole(name)) raw.symbols[as2(name)] = structuredClone(symbol);
	const strips = collector.paddingReels.respin;
	raw.paddingReels.respin_2 = Array.from({ length: raw.numReels }, (_u, reel) =>
		strips[reel % strips.length].map((cell) => ({ ...cell, name: as2(cell.name) })),
	);
	raw.modes = [
		...(raw.modes ?? []),
		{
			...holdAndWinModeDecl(),
			id: MODE_B,
			gameType: KEY_B,
			label: 'Collector',
			holdAndWin: { ...structuredClone(rules), blank: 'BLANK_2' },
		},
	];
	const overlay = (raw as { coinOverlay: { pots: { id: string; bonus?: { mode: string } }[] } })
		.coinOverlay;
	overlay.pots = overlay.pots.map((p) =>
		p.id === 'green' ? { ...p, bonus: { mode: MODE_B } } : p,
	);
	const two = normalizeGameConfigDoc(raw);
	if (!two) throw new Error('the two-mode host did not normalize');
	const inputs = potsOverlayMockInputs(two);
	const primaryStickiness = (inputs.holdAndWin as { modes?: { block: { stickiness: string } }[] })
		?.modes?.[0]?.block.stickiness;

	const roundOn = async (force: string) => {
		const mock = withPotsOverlay(
			(opts: Record<string, unknown> = {}) => createLinesMock({ quiet: true, ...opts }),
			inputs,
		)({ label: 'modes-real', seed: `modes-real-${force}`, allowForce: true });
		const server = createServer((req, res) =>
			mock.handle(req, res, new URL(req.url ?? '/', `http://${req.headers.host}`)),
		);
		const rgsUrl = await listen(server);
		const proxy = await startProxy(rgsUrl, () => {}, forcing(force));
		const events = await playRound(proxy.rgsUrl, `modes-real-${force}`);
		await close(proxy.server);
		await close(server);
		return events;
	};
	check(
		'real mock: the primary and B play by different stickiness',
		[primaryStickiness !== rules.stickiness, rules.stickiness],
		[true, 'collectorsOnly'],
	);
	verifyModeRound(
		'real mock red pot',
		await roundOn('force:pot:red'),
		'holdAndWin',
		primaryStickiness,
	);
	verifyModeRound(
		'real mock green pot',
		await roundOn('force:pot:green'),
		MODE_B,
		'collectorsOnly',
	);
	const both = await roundOn('force:pot:red,pot:green');
	const boardLevel = new Set([
		'holdAndWinTrigger',
		'respinReveal',
		'holdAndWinState',
		'holdAndWinEnd',
	]);
	const runs: string[] = [];
	for (const e of both)
		if (boardLevel.has(e.type) && runs.at(-1) !== e.mode) runs.push(String(e.mode));
	check(
		'real mock both pots: the two features play in turn, every board event in its own mode',
		runs,
		['holdAndWin', MODE_B],
	);
	check(
		'real mock both pots: …each by its own stickiness, nothing left untranslated, nothing as free spins',
		[
			[
				...new Set(
					both
						.filter((e) => e.type === 'holdAndWinState')
						.map((e) => `${e.mode}:${(e.snapshot as HoldAndWinState).stickiness}`),
				),
			],
			both.filter((e) => e.type.startsWith('_') || e.type.startsWith('freeSpin')).length,
		],
		[[`holdAndWin:${primaryStickiness}`, `${MODE_B}:collectorsOnly`], 0],
	);
}

// ---------- RESUME in mode B ----------

{
	const mock = await hush(() => startMock('pots-expansion-fullrow', 'trigger'));
	const proxy = await startProxy(mock.rgsUrl, perModeWire(twoModes, MODE_B, KEY_B));
	const sid = 'modes-resume';
	const post = async (seq: number, gid: string | null, body: unknown) => {
		const query = `sid=${sid}&seq=${seq}${gid ? `&gid=${gid}` : ''}`;
		const res = await fetch(`http://${proxy.rgsUrl}/rgs/engine?${query}`, {
			method: 'POST',
			body: JSON.stringify(body),
		});
		return (await res.json()) as {
			platform: { gameRound?: { id?: string } };
			events: WireEvent[];
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
	const held = (
		last.events.find((e) => e.event === 'playedBonusSpin')?.context?.holdAndWin as
			{ cells?: unknown[] } | undefined
	)?.cells;
	check('resume B: the feature is open after two respins', Boolean(gid && held), true);

	const resumed = await hush(async () => {
		const facade = await openTab();
		return (await facade.requestAuthenticate({
			sessionID: sid,
			rgsUrl: proxy.rgsUrl,
			language: 'en',
		})) as {
			round?: { state?: BookEvent[]; event?: string };
		};
	});
	const book = resumed.round?.state ?? [];
	const at = Number(resumed.round?.event);
	verifyModeRound('resume B', book, MODE_B, 'allCoins');
	const lastState = book
		.slice(0, at)
		.filter((e) => e.type === 'holdAndWinState')
		.pop() as { mode?: string; snapshot: { cells: unknown[] } } | undefined;
	check(
		'resume B: it picks up at the next respin, in B',
		[at > 0, book[at]?.type, book[at]?.mode],
		[true, 'respinReveal', MODE_B],
	);
	check(
		'resume B: the snapshot before it is the board held at the break, in B',
		[lastState?.mode, lastState?.snapshot.cells.length],
		[MODE_B, held?.length],
	);
	await close(proxy.server);
	await close(mock.server);
}

realLog(`\n${passes} bonus-mode facade checks passed, ${failures} failed.`);
if (failures) {
	realLog(report.join('\n'));
	process.exit(1);
}
