/**
 * THE RUNTIME PLAYS THE ACTIVE RESPIN MODE (`docs/design/bonus-games.md` §2.3, bonus-games Phase 4).
 *
 *   pnpm check:respin-modes
 *
 * Real rounds, dealt by Phase 2's REAL two-mode mock and translated by the REAL facade, are walked
 * through the mode stack exactly as the play seam moves it (`modeOpOf`: an entry before its event, an
 * exit after it), and at every board event the runtime's own decisions (`respinModes.ts`) are asked
 * which mode plays, on what board, with which jackpots and which screens:
 *
 *  1. THE HOST. The 3 Pots overlay over a lines host, its own Hold and Win (`holdAndWin`, `respin`)
 *     plus the Collector preset imported as `holdAndWin_2` (symbols `_2`, strip `respin_2`, blank
 *     `BLANK_2`); the red pot starts the first, the green pot the second. `respinModeRules` gives each
 *     its own rules, strip and blank, the primary first.
 *  2. RED POT → mode 1, GREEN POT → mode 2: every board event resolves to the mode it names, on that
 *     mode's strip, blank, rows, stickiness, jackpot table, counter start and screens, and the board
 *     is built for it.
 *  3. BOTH POTS in one round: the two features play in turn, each in its own mode, and the board is
 *     rebuilt exactly once per feature.
 *  4. RESUME mid mode 2: the stack the snapshot rebuilds puts mode 2 on top, so the replayed
 *     `holdAndWinState` redraws mode 2's board, with no intro.
 *  4b. AUTOMATIC vs MANUAL on both modes (`play`, read back through the config): Manual parks on SPIN
 *     before every respin of that mode (the first after the intro and after a resume too) and
 *     nowhere else; never under autoplay or space-hold; the intro and outro never park. Auto and
 *     absent never park.
 *  6. THE REAL PLAY SEAM: the engine's own `createPlayBook` and `createModeController` (compiled by
 *     Svelte's `compileModule`), with the game's own `holdBeforeRespin`, `ensureBoard` and
 *     `respinStrip` sliced from their sources. On the coded AND the flow branch a Manual respin is
 *     presented only after its park; the board is built once per mode, on that mode's strip; Automatic
 *     never parks, nor does Manual on the last autoplay round or under hold-to-spin; a resume
 *     (`convertTorResumableBet`) rebuilds mode 2 with no intro and parks its next respin. `utils.ts`
 *     hands the seam the hold.
 *  7. PHASE 7a, A LINES HOST DEALS EVERY ROUTE (the coin overlay over the lines mock): a lines game with a
 *     coin overlay, two respin modes and its free spins — the red pot plays mode 1 (Automatic), a
 *     buy tier and Lucky Spin play mode 2 (Manual, parked before each respin), the scatters play the
 *     free spins and no respin mode; each feature speaks its own Win Text; a tier name progressive in
 *     both modes keeps a pool per mode (the boot levels tagged, the runtime showing the active
 *     mode's, a tagged level moving one mode's alone); the dropped value coins carry the authored
 *     base-game values (`coinOverlay.coins`).
 *  8. PHASE 7a, A HOLD AND WIN BASE WITH A COIN OVERLAY: the overlay composes over the Hold and Win
 *     engine (Classic, plus the Collector as a second mode). Its reels still start its own feature;
 *     the red pot starts it too, the green pot the second mode, the blue pot this game's approximate
 *     free spins; reels and a pot in one round play the base feature first, then the pot's. And the
 *     PLAIN Hold and Win game — no jackpots, no board end, no overlay — plays coins → respins → pay.
 *     The route dispatch: a spins mode a buy names starts through `startFreeSpins` with its `game`
 *     untouched; a mode the host registers through its own hook.
 *  5. PARITY: for every game with one respin mode (the three presets, the test fixtures, a 3 Pots
 *     host) the runtime reads exactly what it read from the primary's block: the same block,
 *     the same blank, strip, rows, jackpots, meters and screens.
 */

import {
	HOLD_AND_WIN_PRESETS,
	HOLD_AND_WIN_TEST_FIXTURES,
	addPotsOverlay,
	holdAndWinMockInputs,
	holdAndWinBlankSymbol,
	holdAndWinBonus,
	holdAndWinModeDecl,
	normalizeGameConfigDoc,
	potsOverlayMockInputs,
	potsOverlayOf,
	potsOverlayPreset,
	primaryHoldAndWin,
	resolveMeters,
	respinBoardMaxRows,
	respinModeRules,
	symbolHoldAndWinRoles,
	type GameConfigDoc,
	type RespinModeRules,
} from '../packages/game-config/index.ts';
import type { Scene } from 'engine-layout';
import {
	MODE_EVENT_TYPES,
	modeOpOf,
	type ModeOp,
} from '../packages/engine-game/src/game/modeEvents.ts';
import {
	emptyModeStack,
	enterMode,
	exitMode,
	restoreModes,
	type ModeStackState,
} from '../packages/engine-game/src/game/modeStack.ts';
import { createPotsOverlay, withPotsOverlay } from './mock-pots-overlay.mjs';
import { createMockRgs as createLinesMock } from './mock-rgs-server.mjs';
import { createMockRgs as createHoldAndWinMock } from './mock-rgs-server-holdandwin.mjs';
import {
	resolveWinTextForMode,
	type WinTextDoc,
} from '../packages/engine-layout/src/lib/winText.ts';
import {
	applyPools,
	readBootJackpotLevels,
	readHoldAndWinModes,
} from '../packages/rgs-translator-eagaming/src/holdAndWin.ts';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

import { compileSlice, stripSliceTypes } from './lib/compile-slice.mjs';

import {
	jackpotTier,
	jackpotTierMode,
	modeSceneBaseId,
	modeScreenFor,
	parksBeforeRespin,
	poolLevel,
	respinBoardShape,
	respinModeOnStack,
	sameRespinBoard,
	type RespinBoardShape,
} from '../apps/lines/src/game/respinModes.ts';

type BookEvent = { type: string; mode?: string; [key: string]: unknown };
type Facade = typeof import('../packages/rgs-translator-eagaming/src/engineFacade.ts');

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

const realLog = console.log.bind(console);
const realWarn = console.warn.bind(console);
const realError = console.error.bind(console);
const hush = async <T,>(fn: () => T | Promise<T>): Promise<T> => {
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

// ---------- 1. the host ----------

const MODE_A = 'holdAndWin';
const MODE_B = 'holdAndWin_2';
const KEY_B = 'respin_2';
const GRID_ROWS = 3;

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

const normalized = (raw: unknown): GameConfigDoc => {
	const doc = normalizeGameConfigDoc(raw as Record<string, unknown>);
	if (!doc) throw new Error('config did not normalize');
	return doc;
};

const collector = normalized(structuredClone(HOLD_AND_WIN_PRESETS.collector));
const collectorRules = collector.modes?.find((m) => m.id === MODE_A)?.holdAndWin;
if (!collectorRules) throw new Error('the Collector preset has no holdAndWin mode');
const isRole = (name: string) => symbolHoldAndWinRoles(collector.symbols[name]).length > 0;
const as2 = (name: string) => (isRole(name) ? `${name}_2` : name);

const threePotsHost = (): GameConfigDoc => {
	const preset = potsOverlayPreset('threePots');
	const bonus = holdAndWinBonus(preset.holdAndWin, LINES_HOST);
	return normalized({
		...structuredClone(LINES_HOST),
		symbols: { ...LINES_HOST.symbols, ...bonus.symbols, ...preset.tokens },
		paddingReels: { ...LINES_HOST.paddingReels, ...bonus.paddingReels },
		holdAndWin: bonus.holdAndWin,
		potsOverlay: preset.potsOverlay,
	});
};

const twoModeHost = (): GameConfigDoc => {
	const raw = structuredClone(threePotsHost());
	for (const [name, symbol] of Object.entries(collector.symbols))
		if (isRole(name)) raw.symbols[as2(name)] = structuredClone(symbol);
	const strips = collector.paddingReels.respin;
	raw.paddingReels[KEY_B] = Array.from({ length: raw.numReels }, (_u, reel) =>
		strips[reel % strips.length].map((cell) => ({ ...cell, name: as2(cell.name) })),
	);
	raw.modes = [
		...(raw.modes ?? []),
		{
			...holdAndWinModeDecl(),
			id: MODE_B,
			gameType: KEY_B,
			label: 'Collector',
			holdAndWin: { ...structuredClone(collectorRules), blank: 'BLANK_2' },
		},
	];
	const overlay = (raw as { coinOverlay: { pots: { id: string; bonus?: { mode: string } }[] } })
		.coinOverlay;
	overlay.pots = overlay.pots.map((p) =>
		p.id === 'green' ? { ...p, bonus: { mode: MODE_B } } : p,
	);
	return normalized(raw);
};

const HOST = twoModeHost();
const MODES = respinModeRules(HOST);
const [A, B] = MODES;

check(
	'host: two respin modes, the primary first, each on its own strip and blank',
	MODES.map((m) => [m.mode, m.gameType, m.blank, m.play]),
	[
		[MODE_A, 'respin', A?.blank, 'auto'],
		[MODE_B, KEY_B, 'BLANK_2', 'auto'],
	],
);
check(
	'host: the two play by different rules (stickiness, jackpot table)',
	[
		A.block.stickiness !== B.block.stickiness,
		JSON.stringify(A.block.jackpots) !== JSON.stringify(B.block.jackpots),
		B.block.stickiness,
	],
	[true, true, 'collectorsOnly'],
);
check(
	"host: the primary's rules ARE the legacy block view, mode 2's are its own; no mirror keys",
	[
		JSON.stringify(A.block) === JSON.stringify(primaryHoldAndWin(HOST)),
		B.block.stickiness === collectorRules.stickiness,
		'holdAndWin' in HOST || 'potsOverlay' in HOST,
	],
	[true, true, false],
);

// Mode screens as Phase 5b seeds them: the reference respin screens for `holdAndWin`
// (`referenceLayouts/holdAndWin.ts`), and a copy for mode 2 with every id suffixed `-holdAndWin_2`.
const REFERENCE_MODE_SCENES: Scene[] = [
	'respinBoard',
	'wheel',
	'featureIntro',
	'jackpotWin',
	'featureOutro',
].map((id) => ({ id, name: id, nodes: [], role: 'mode', modeId: MODE_A }) as Scene);
const SCENES: Scene[] = [
	...REFERENCE_MODE_SCENES,
	...REFERENCE_MODE_SCENES.map((scene) => ({
		...scene,
		id: `${scene.id}-${MODE_B}`,
		modeId: MODE_B,
	})),
];
const BEAT_SCREENS = ['featureIntro', 'featureOutro', 'jackpotWin', 'wheel'];

// ---------- playing rounds ----------

const listen = async (server: Server): Promise<string> => {
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const address = server.address();
	return `localhost:${typeof address === 'object' && address ? address.port : 0}`;
};
const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));
const bodyOf = (req: IncomingMessage): Promise<string> =>
	new Promise((resolve) => {
		let text = '';
		req.on('data', (chunk) => (text += chunk));
		req.on('end', () => resolve(text));
	});

/** The real two-mode mock behind a proxy that puts `force` on the first `play` of a session (none
 *  when null). `doc` is the host; `opts` what the test server adds from its contract (bet modes). */
const startHost = async (
	force: string | null,
	seed: string,
	doc: GameConfigDoc = HOST,
	opts: Record<string, unknown> = {},
) => {
	const make = (host: Record<string, unknown> = {}) =>
		(opts.holdAndWin ? createHoldAndWinMock : createLinesMock)({ quiet: true, ...opts, ...host });
	const inputs = potsOverlayMockInputs(doc);
	const mockOpts = { label: 'runtime-modes', seed, allowForce: true };
	// No overlay (a plain Hold and Win game): the base mock alone, as the test server deals it.
	const mock = inputs ? withPotsOverlay(make, inputs)(mockOpts) : make(mockOpts);
	const upstream = createServer((req, res) =>
		mock.handle(req, res, new URL(req.url ?? '/', `http://${req.headers.host}`)),
	);
	const upstreamUrl = await listen(upstream);
	let armed = force !== null;
	const proxy = createServer(async (req, res) => {
		const actions = JSON.parse((await bodyOf(req)) || '[]') as {
			action: string;
			context?: unknown;
		}[];
		for (const a of actions)
			if (armed && a.action === 'play' && !a.context) {
				a.context = force;
				armed = false;
			}
		const answer = await fetch(`http://${upstreamUrl}${req.url}`, {
			method: req.method,
			...(req.method === 'POST' ? { body: JSON.stringify(actions) } : {}),
		});
		res.writeHead(answer.status, { 'content-type': 'application/json' });
		res.end(await answer.text());
	});
	const rgsUrl = await listen(proxy);
	return {
		rgsUrl,
		stop: async () => {
			await close(proxy);
			await close(upstream);
		},
	};
};

let tabs = 0;
const openTab = (): Promise<Facade> =>
	import(`../packages/rgs-translator-eagaming/src/engineFacade.ts?tab=${++tabs}`);

const playRound = async (
	force: string | null,
	doc: GameConfigDoc = HOST,
	opts: Record<string, unknown> = {},
	betMode = 'BASE',
): Promise<BookEvent[]> => {
	const host = await startHost(force, `runtime-modes-${force}`, doc, opts);
	const sid = `runtime-${force}-${betMode}`;
	const events = await hush(async () => {
		const facade = await openTab();
		await facade.requestAuthenticate({ sessionID: sid, rgsUrl: host.rgsUrl, language: 'en' });
		const bet = (await facade.requestBet({
			sessionID: sid,
			currency: 'EUR',
			amount: 1,
			mode: betMode,
			rgsUrl: host.rgsUrl,
		})) as { round?: { state?: BookEvent[] } };
		return bet.round?.state ?? [];
	});
	await host.stop();
	return events;
};

// ---------- the runtime, walked ----------

const BOARD_EVENTS = new Set([
	'holdAndWinTrigger',
	'respinReveal',
	'holdAndWinState',
	'holdAndWinEnd',
]);
/** The beats that put the board up (`showRespinBoard` → `ensureBoard`). */
const SHOWS_BOARD = new Set(['holdAndWinTrigger', 'holdAndWinState']);

type Step = {
	event: BookEvent;
	active: RespinModeRules | undefined;
	board: RespinBoardShape;
	rebuilt: boolean;
	/** The respin mode the play seam's hold reads — it runs before the event moves the stack. */
	before: RespinModeRules | undefined;
};

/**
 * Walk a book as the play seam does: an entering event moves the stack before it is presented, an
 * exiting one after. At each event, what the runtime would read — and whether the board it would put
 * up had to be rebuilt.
 */
const walk = (
	events: readonly BookEvent[],
	from: ModeStackState = emptyModeStack(),
	modes: readonly RespinModeRules[] = MODES,
): Step[] => {
	let state = from;
	let built: (Pick<RespinBoardShape, 'mode' | 'rows'> & { reels: number }) | undefined;
	const steps: Step[] = [];
	const apply = (op: ModeOp) => {
		state =
			op.op === 'enter'
				? enterMode(state, op.id, op).state
				: exitMode(state, op.id, { total: op.total }).state;
	};
	const onStack = () =>
		respinModeOnStack(
			modes,
			state.stack.map((entry) => entry.id),
		);
	for (const event of events) {
		const before = onStack();
		const op = modeOpOf(event);
		if (op?.op === 'enter') apply(op);
		const active = onStack();
		const board = respinBoardShape(active, GRID_ROWS);
		let rebuilt = false;
		if (SHOWS_BOARD.has(event.type)) {
			const wanted = { mode: board.mode, rows: board.rows, reels: HOST.numReels };
			rebuilt = !built || !sameRespinBoard(built, wanted);
			built = wanted;
		}
		steps.push({ event, active, board, rebuilt, before });
		if (op?.op === 'exit') apply(op);
	}
	return steps;
};

/** Every board event of a feature in `mode` plays on `rules`' board, screens and jackpots. */
const verifyFeature = (
	label: string,
	steps: Step[],
	mode: RespinModeRules,
	modes: readonly RespinModeRules[] = MODES,
) => {
	const board = steps.filter((s) => BOARD_EVENTS.has(s.event.type));
	check(`${label}: the feature has board events`, board.length > 2, true);
	check(
		`${label}: every board event names the mode and the runtime plays that mode`,
		[...new Set(board.map((s) => `${s.event.mode}→${s.active?.mode}`))],
		[`${mode.mode}→${mode.mode}`],
	);
	check(
		`${label}: …on its own strip, blank and rows`,
		[...new Set(board.map((s) => JSON.stringify([s.board, s.active?.blank])))],
		[JSON.stringify([respinBoardShape(mode, GRID_ROWS), mode.blank])],
	);
	const states = steps.filter((s) => s.event.type === 'holdAndWinState');
	check(
		`${label}: …by its own stickiness`,
		[
			...new Set(
				states.map((s) => (s.event.snapshot as { stickiness?: string } | undefined)?.stickiness),
			),
		],
		[mode.block.stickiness],
	);
	const trigger = steps.find((s) => s.event.type === 'holdAndWinTrigger');
	// A resume has no trigger: the feature's first board event stands in for it.
	const entry = trigger ?? board[0];
	if (trigger)
		check(
			`${label}: …its counter starts at its own respins`,
			(trigger.event.payload as { respins?: number } | undefined)?.respins,
			mode.block.respins.start,
		);
	const wins = steps.filter((s) => s.event.type === 'jackpotWin');
	check(
		`${label}: …every jackpot it wins is one of its own tiers, at its own worth`,
		wins.every((s) => {
			const tier = jackpotTier(modes, s.active, String(s.event.tier));
			return tier !== undefined && mode.block.jackpots.includes(tier);
		}),
		true,
	);
	check(
		`${label}: …each of its tiers reads its own table while it plays`,
		mode.block.jackpots.map((j) => jackpotTier(modes, entry?.active, j.name) === j),
		mode.block.jackpots.map(() => true),
	);
	check(
		`${label}: …its beats are drawn by its own screens`,
		BEAT_SCREENS.map((screen) => modeScreenFor(SCENES, entry?.active?.mode, screen)),
		BEAT_SCREENS.map((screen) => (mode.mode === MODE_A ? screen : `${screen}-${mode.mode}`)),
	);
};

// ---------- 2. red pot → mode 1, green pot → mode 2 ----------

const red = walk(await playRound('force:pot:red'));
verifyFeature('red pot', red, A);
check(
	'red pot: the board is built once, for mode 1',
	red.filter((s) => s.rebuilt).map((s) => s.board.mode),
	[MODE_A],
);

const green = walk(await playRound('force:pot:green'));
verifyFeature('green pot', green, B);
check(
	'green pot: the board is built once, for mode 2',
	green.filter((s) => s.rebuilt).map((s) => s.board.mode),
	[MODE_B],
);
check(
	'green pot: back in the base game the reads are the primary again',
	green.at(-1)?.active?.mode,
	MODE_A,
);

// ---------- 3. both pots in one round ----------

const both = walk(await playRound('force:pot:red,pot:green'));
const runs: string[] = [];
for (const s of both)
	if (BOARD_EVENTS.has(s.event.type) && runs.at(-1) !== s.active?.mode)
		runs.push(String(s.active?.mode));
check('both pots: the two features play in turn, mode 1 then mode 2', runs, [MODE_A, MODE_B]);
const split = both.findIndex((s) => s.event.type === 'holdAndWinEnd') + 1;
verifyFeature('both pots, first feature', both.slice(0, split), A);
verifyFeature('both pots, second feature', both.slice(split), B);
check(
	'both pots: the board is rebuilt exactly once per feature',
	both.filter((s) => s.rebuilt).map((s) => s.board.mode),
	[MODE_A, MODE_B],
);

// ---------- 4. resume mid mode 2 ----------

/** What a resume mid mode 2 replays, and the stack it restores — 4b plays it Manual. */
let resumed2: { events: BookEvent[]; restored: ModeStackState } | undefined;
/** The resumed round as the facade answered it, for the real seam (§6). */
let resumedBet: { state: BookEvent[]; event: string } | undefined;
{
	const host = await startHost('force:pot:green', 'runtime-modes-resume');
	const sid = 'runtime-resume';
	const post = async (seq: number, gid: string | null, body: unknown) => {
		const query = `sid=${sid}&seq=${seq}${gid ? `&gid=${gid}` : ''}`;
		const res = await fetch(`http://${host.rgsUrl}/rgs/engine?${query}`, {
			method: 'POST',
			body: JSON.stringify(body),
		});
		return (await res.json()) as {
			platform: { gameRound?: { id?: string } };
			events: { event: string; context?: Record<string, unknown> }[];
		};
	};
	await post(0, null, [{ action: 'config' }]);
	const opened = await post(0, null, [
		{ action: 'bet', context: [1, 0] },
		{ action: 'play', context: null },
	]);
	const gid = opened.platform.gameRound?.id ?? null;
	await post(2, gid, [{ action: 'play' }]);
	const resumed = await hush(async () => {
		const facade = await openTab();
		return (await facade.requestAuthenticate({
			sessionID: sid,
			rgsUrl: host.rgsUrl,
			language: 'en',
		})) as { round?: { state?: BookEvent[]; event?: string } };
	});
	await host.stop();
	const book = resumed.round?.state ?? [];
	const at = Number(resumed.round?.event);
	check(
		'resume: the round reopens mid mode 2',
		[gid !== null, at > 0, book[at]?.mode],
		[true, true, MODE_B],
	);
	// The snapshot keeps the stack-moving events before the break (`playBook.ts`), and the stack is
	// rebuilt from them silently (`restoreModes`) before the last `holdAndWinState` is replayed.
	const kept = book
		.slice(0, at)
		.filter((e) => (MODE_EVENT_TYPES as readonly string[]).includes(e.type));
	const ops = kept.map(modeOpOf).filter((op): op is ModeOp => op !== undefined);
	const restored = restoreModes(ops);
	const replay = book
		.slice(0, at)
		.filter((e) => e.type === 'holdAndWinState')
		.pop();
	const replayed = replay ? [replay, ...book.slice(at)] : book.slice(at);
	resumed2 = { events: replayed, restored };
	resumedBet = { state: structuredClone(book), event: String(at) };
	const steps = walk(replayed, restored);
	check(
		'resume: the restored stack puts mode 2 on top, and its replayed snapshot is mode 2’s',
		[restored.stack.map((e) => e.id), replay?.mode, steps[0]?.active?.mode],
		[[MODE_B], MODE_B, MODE_B],
	);
	check(
		'resume: the board is rebuilt for mode 2 from the snapshot, with no intro',
		[
			steps[0]?.event.type,
			steps[0]?.rebuilt,
			steps[0]?.board.gameType,
			steps.some((s) => s.event.type === 'holdAndWinTrigger'),
		],
		['holdAndWinState', true, KEY_B, false],
	);
	verifyFeature('resume, the rest of mode 2', [...steps], B);
}

// ---------- 4b. Automatic vs Manual, on both modes ----------

/** The host with each respin mode's `play` set, read back through the config. */
const hostPlaying = (playA?: 'auto' | 'manual', playB?: 'auto' | 'manual') => {
	const raw = structuredClone(HOST);
	raw.modes = raw.modes?.map((m) => {
		const play = m.id === MODE_A ? playA : m.id === MODE_B ? playB : undefined;
		if (!m.holdAndWin) return m;
		const { play: _was, ...rules } = m.holdAndWin;
		return { ...m, holdAndWin: play ? { ...rules, play } : rules };
	});
	return respinModeRules(normalized(raw));
};

/** Where the book parks on SPIN: the index of every event it waits before. */
const parks = (steps: Step[], handsOff: boolean) =>
	steps.flatMap((s, i) => (parksBeforeRespin(s.event.type, s.before?.play, handsOff) ? [i] : []));
const respinsOf = (steps: Step[], mode: string) =>
	steps.flatMap((s, i) => (s.event.type === 'respinReveal' && s.event.mode === mode ? [i] : []));

{
	const bothBook = both.map((s) => s.event);
	const settings = [
		['auto', 'auto'],
		['manual', 'auto'],
		['auto', 'manual'],
		['manual', 'manual'],
		[undefined, undefined],
	] as const;
	for (const [playA, playB] of settings) {
		const modes = hostPlaying(playA, playB);
		const steps = walk(bothBook, emptyModeStack(), modes);
		const label = `play ${playA ?? 'absent'} / ${playB ?? 'absent'}`;
		check(
			`${label}: the config gives each mode its own setting`,
			modes.map((m) => m.play),
			[playA ?? 'auto', playB ?? 'auto'],
		);
		const want = [
			...(playA === 'manual' ? respinsOf(steps, MODE_A) : []),
			...(playB === 'manual' ? respinsOf(steps, MODE_B) : []),
		];
		check(
			`${label}: it parks before every respin of a Manual mode and nowhere else`,
			parks(steps, false),
			want,
		);
		check(`${label}: …never under autoplay or space-hold`, parks(steps, true), []);
		check(
			`${label}: the intro and the outro never park (they stay timed)`,
			parks(steps, false).every((i) => steps[i].event.type === 'respinReveal'),
			true,
		);
	}
	if (resumed2) {
		const steps = walk(resumed2.events, resumed2.restored, hostPlaying(undefined, 'manual'));
		check(
			'Manual mode 2, resumed: the snapshot redraws without a park, the next respin parks',
			[steps[0]?.event.type, parks(steps, false)[0], steps[parks(steps, false)[0]]?.event.type],
			['holdAndWinState', 1, 'respinReveal'],
		);
	}
	const manualB = walk(
		green.map((s) => s.event),
		emptyModeStack(),
		hostPlaying(undefined, 'manual'),
	);
	check(
		'Manual mode 2 alone: the first respin after the intro parks too',
		parks(manualB, false)[0],
		manualB.findIndex((s) => s.event.type === 'respinReveal'),
	);
}

// ---------- 5. parity: one respin mode reads what it always read ----------

const singleModeDocs: [string, GameConfigDoc][] = [
	...Object.entries(HOLD_AND_WIN_PRESETS).map(([id, raw]): [string, GameConfigDoc] => [
		`preset ${id}`,
		normalized(structuredClone(raw)),
	]),
	...Object.entries(HOLD_AND_WIN_TEST_FIXTURES).map(([id, raw]): [string, GameConfigDoc] => [
		`fixture ${id}`,
		normalized(structuredClone(raw)),
	]),
	['3 Pots host', threePotsHost()],
];

/** What the runtime read before Phase 4 — the primary's block and the game-wide blank. */
const before = (doc: GameConfigDoc) => {
	const block = primaryHoldAndWin(doc)!;
	return {
		block,
		blank: holdAndWinBlankSymbol(doc),
		strip: 'respin',
		rows: block.expansion ? Math.max(GRID_ROWS, respinBoardMaxRows(doc)) : GRID_ROWS,
		jackpots: block.jackpots.map((j) => [j.name, j.multiplier, j.fixed]),
		meters: [
			...(block.meters ?? []).map((m) => [m.id, m.symbol, MODE_A]),
			...(potsOverlayOf(doc)?.pots ?? []).map((p) => [p.id, p.token, p.bonus.mode]),
		],
	};
};

for (const [label, doc] of singleModeDocs) {
	const modes = respinModeRules(doc);
	const was = before(doc);
	const active = respinModeOnStack(modes, []);
	const inFeature = respinModeOnStack(modes, [MODE_A]);
	const board = respinBoardShape(active, GRID_ROWS);
	check(
		`parity ${label}: one respin mode, the default, in base and in its feature`,
		[modes.length, active?.mode, inFeature === active],
		[1, MODE_A, true],
	);
	check(
		`parity ${label}: the rules read are the block it read, and no mirror keys`,
		[active?.block, 'holdAndWin' in doc || 'potsOverlay' in doc],
		[was.block, false],
	);
	check(
		`parity ${label}: the same blank, strip and rows, auto play`,
		[active?.blank, board.gameType, board.rows, active?.play],
		[was.blank, was.strip, was.rows, 'auto'],
	);
	check(
		`parity ${label}: the same jackpot tiers`,
		was.block.jackpots.map((j) => {
			const tier = jackpotTier(modes, active, j.name.toLowerCase());
			return [tier?.name, tier?.multiplier, tier?.fixed];
		}),
		was.jackpots,
	);
	check(
		`parity ${label}: the same meters`,
		resolveMeters(doc).map((m) => [m.id, m.symbol, m.bonus.mode]),
		was.meters,
	);
	check(
		`parity ${label}: the same screens, none of them reserved anew`,
		[
			BEAT_SCREENS.map((screen) => modeScreenFor(REFERENCE_MODE_SCENES, active?.mode, screen)),
			REFERENCE_MODE_SCENES.map((scene) => modeSceneBaseId(scene) === scene.id),
		],
		[BEAT_SCREENS, REFERENCE_MODE_SCENES.map(() => true)],
	);
}

check(
	"two modes: mode 2's screen copies reduce to the reference ids (so they are reserved by them)",
	SCENES.filter((scene) => scene.modeId === MODE_B).map(modeSceneBaseId),
	REFERENCE_MODE_SCENES.map((scene) => scene.id),
);
check(
	"two modes: mode 2's meters start mode 2, the primary's the primary",
	[...new Set(resolveMeters(HOST).map((m) => m.bonus.mode))].sort(),
	[MODE_A, MODE_B].sort(),
);

// ---------- 6. the REAL play seam ----------

// The engine's own `createPlayBook` and `createModeController` (its `.svelte.ts` compiled by Svelte's
// `compileModule`, server output — the hook `newGameGate.fixture.mjs` uses), with the game's own
// `holdBeforeRespin`, `ensureBoard` and `respinStrip` sliced from their sources and run against
// stubs. A respin must park BEFORE it is presented, on the coded and the flow branch alike; the board
// must be built per mode, on that mode's strip; a resume must restore the mode and park.

const stub = (source: string) => 'data:text/javascript,' + encodeURIComponent(source);
const SEAM_STUBS = {
	'$app/state': stub('export const page = { url: new URL("https://game.test/") };'),
	'$env/static/public': stub(
		'export const PUBLIC_SITE_MODE = ""; export const PUBLIC_SENTRY_DSN = ""; export const PUBLIC_SENTRY_SAMPLE_RATE = ""; export const PUBLIC_CHROMATIC = "";',
	),
	'rgs-requests': stub('export const requestEndEvent = async () => ({});'),
	'error-tracking': stub('export const captureRgsFailure = () => {};'),
	// No `main`, so node would look for `index.js`; the bundler reads `index.ts`.
	...Object.fromEntries(
		['state-shared', 'utils-book', 'utils-shared', 'envs', 'utils-event-emitter'].map((name) => [
			name,
			new URL(`../packages/${name}/index.ts`, import.meta.url).href,
		]),
	),
};
register(
	'data:text/javascript,' +
		encodeURIComponent(`
			import { readFile } from 'node:fs/promises';
			import { createRequire, stripTypeScriptTypes } from 'node:module';
			import { fileURLToPath } from 'node:url';
			const STUBS = ${JSON.stringify(SEAM_STUBS)};
			export async function resolve(specifier, context, next) {
				if (STUBS[specifier]) return { url: STUBS[specifier], shortCircuit: true };
				try {
					return await next(specifier, context);
				} catch (err) {
					if (!specifier.startsWith('.') && !/^[\\w-]+\\/[\\w/-]+$/.test(specifier)) throw err;
					for (const ext of ['.ts', '/index.ts']) {
						try {
							return await next(specifier + ext, context);
						} catch {}
					}
					throw err;
				}
			}
			export async function load(url, context, next) {
				// Vite's \`import.meta.env\` is absent under node: the play seam reads only \`DEV\`.
				if (url.endsWith('/engine-game/src/game/playBook.ts')) {
					const text = await readFile(fileURLToPath(url), 'utf8');
					const js = stripTypeScriptTypes(text.replaceAll('import.meta.env.DEV', 'false'));
					return { format: 'module', source: js, shortCircuit: true };
				}
				if (!url.endsWith('.svelte.ts')) return next(url, context);
				const path = fileURLToPath(url);
				const { compileModule } = createRequire(path)('svelte/compiler');
				const js = stripTypeScriptTypes(await readFile(path, 'utf8'));
				const { js: out } = compileModule(js, { filename: path, generate: 'server' });
				return { format: 'module', source: out.code, shortCircuit: true };
			}
		`),
	pathToFileURL('./'),
);

const { createPlayBook } = await import('../packages/engine-game/src/game/playBook.ts');
const { createModeController } =
	await import('../packages/engine-game/src/game/modeController.svelte.ts');
const { stateBet } = await import('../packages/state-shared/index.ts');

const source = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const sliceBetween = (text: string, what: string, from: string, to: string) => {
	const start = text.indexOf(from);
	if (start < 0) throw new Error(`${what}: could not find "${from}"`);
	const end = text.indexOf(to, start + from.length);
	if (end < 0) throw new Error(`${what}: could not find "${to}" after it`);
	return text.slice(start, end + to.length);
};
const LINES = 'apps/lines/src/game';
const holdSource = source(`${LINES}/respinHold.svelte.ts`);
const boardSource = source(`${LINES}/stateRespinBoard.svelte.ts`);
const utilsSource = source(`${LINES}/utils.ts`);

check(
	'the game hands its play seam the Manual respin hold',
	utilsSource.includes('holdBeforeEvent: holdBeforeRespin,'),
	true,
);

type Seam = {
	log: string[];
	builds: { mode?: string; strip: unknown }[];
	controller: ReturnType<typeof createModeController>;
	playBet: (bet: { state: BookEvent[] }) => Promise<void>;
	convertTorResumableBet: (bet: { state: BookEvent[]; event: string }) => {
		state: BookEvent[];
	};
};

/** One game wired to the real seam: `modes` are the respin modes it declares, `flow` whether a v2
 *  flow owns every event. */
const buildSeam = (doc: GameConfigDoc, flow: boolean): Seam => {
	const modes = respinModeRules(doc);
	const log: string[] = [];
	const builds: Seam['builds'] = [];
	const controller = createModeController({
		gameTypeOf: (id: string) => modes.find((m) => m.mode === id)?.gameType ?? 'basegame',
		setGameType: () => {},
		present: async () => {},
	});
	const activeRespinMode = () =>
		respinModeOnStack(
			modes,
			controller.state.stack.map((entry: { id: string }) => entry.id),
		);
	const hold = compileSlice({
		what: 'respinHold.svelte.ts#holdBeforeRespin',
		names: ['parksBeforeRespin', 'activeRespinMode', 'stateBet', 'armSpinHold', 'stateRespinPark'],
		body: `${stripSliceTypes(
			'respinHold',
			sliceBetween(holdSource, 'handsOff', 'const handsOff = ', ';\n') +
				'\n' +
				sliceBetween(holdSource, 'holdBeforeRespin', 'export const holdBeforeRespin = (', '\n};\n'),
		).replace('export const', 'const')}\nreturn holdBeforeRespin;`,
	})(
		parksBeforeRespin,
		activeRespinMode,
		stateBet,
		(release: () => void) => {
			log.push('park');
			setImmediate(release);
		},
		{ parked: false },
	);
	const board = compileSlice({
		what: 'stateRespinBoard.svelte.ts#ensureBoard',
		names: [
			'getActiveGameConfig',
			'getPaddingReels',
			'activeRespinMode',
			'boardDimensions',
			'respinBoardShape',
			'sameRespinBoard',
			'createRespinBoard',
			'stateGameDerived',
			'cellSymbolLead',
			'respinSeedBoard',
			'respinBlank',
			'onCellStopping',
		],
		body: `let board = null;\nlet boardMode;\n${stripSliceTypes(
			'stateRespinBoard',
			sliceBetween(boardSource, 'respinStrip', 'const respinStrip = (', '\n};\n') +
				'\n' +
				sliceBetween(boardSource, 'ensureBoard', 'const ensureBoard = (', '\n};\n'),
		)}\nreturn { ensureBoard, respinStrip };`,
	})(
		() => doc,
		() => doc.paddingReels.basegame,
		activeRespinMode,
		() => ({ x: doc.numReels, y: GRID_ROWS }),
		respinBoardShape,
		sameRespinBoard,
		(options: { reels: number; rows: number }) => ({ reels: options.reels, rows: options.rows }),
		{ boardGeometry: () => ({ rowPitchLocal: 1 }), reelSpinProfile: () => undefined },
		() => 0,
		() => [],
		() => 'BLANK',
		() => {},
	);
	const showBoard = (type: string) => {
		const built = board.ensureBoard();
		if (builds.at(-1)?.board !== built)
			builds.push({
				board: built,
				mode: activeRespinMode()?.mode,
				strip: board.respinStrip(0)[0]?.name,
			} as never);
		log.push(`board:${type}`);
	};
	const present = async (bookEvent: BookEvent) => {
		if (bookEvent.type === 'holdAndWinTrigger' || bookEvent.type === 'holdAndWinState')
			showBoard(bookEvent.type);
		log.push(`present:${bookEvent.type}`);
	};
	let playBookEvent: (event: BookEvent, context: { bookEvents: BookEvent[] }) => Promise<void>;
	const handlers = new Proxy(
		{
			createBonusSnapshot: async (event: { bookEvents: BookEvent[] }) => {
				const last = [...event.bookEvents].reverse().find((e) => e.type === 'holdAndWinState');
				if (last) await playBookEvent(last, { bookEvents: event.bookEvents });
			},
		} as Record<string, (event: never) => Promise<void>>,
		{ get: (target, type: string) => target[type] ?? present },
	);
	const noop = () => {};
	const book = createPlayBook({
		bookEventHandlerMap: handlers,
		getFlowInterpreter: () => undefined,
		getFlowV2: () =>
			flow
				? {
						ownsEvent: (type: string) => type !== 'createBonusSnapshot',
						dispatch: async (_type: string, event: BookEvent) => {
							log.push('flow');
							await present(event);
						},
						chainCallsAction: () => false,
					}
				: undefined,
		eventEmitter: { broadcast: noop, broadcastAsync: async () => {} },
		runBookEventPresentation: (_type: string, run: () => Promise<void>) => run(),
		startsCelebration: () => false,
		recordWinCycleWins: noop,
		forgetWinCycleWins: noop,
		stopWinCycle: noop,
		startWinCycle: async () => {},
		explodeSpinWinners: async () => {},
		explodeWinnersBeforeBoardChange: async () => {},
		bakedWinLineConfig: () => ({ line: { allAtOnce: false } }),
		winsOnThisBoard: () => [],
		showAllWinLines: async () => {},
		activeWinLevelData: () => undefined,
		cueBigWinCountUp: async () => {},
		setPendingScatterAwardFs: noop,
		holdAfterBigWin: async () => {},
		clearSpinHold: noop,
		holdBeforeEvent: hold,
		trackCascadeStep: noop,
		modes: controller,
	} as never);
	playBookEvent = book.playBookEvent;
	return {
		log,
		builds,
		controller,
		playBet: book.playBet,
		convertTorResumableBet: book.convertTorResumableBet,
	};
};

/** The host with both respin modes Manual (or as given), as the config reads back. */
const hostDoc = (playA?: 'auto' | 'manual', playB?: 'auto' | 'manual'): GameConfigDoc => {
	const raw = structuredClone(HOST);
	raw.modes = raw.modes?.map((m) => {
		const play = m.id === MODE_A ? playA : m.id === MODE_B ? playB : undefined;
		return m.holdAndWin && play ? { ...m, holdAndWin: { ...m.holdAndWin, play } } : m;
	});
	return normalized(raw);
};

/** Every respin: is the event presented right after its park, with nothing in between? */
const parkedRight = (log: string[]) => {
	const presented = log.flatMap((entry, i) => (entry === 'present:respinReveal' ? [i] : []));
	const before = (i: number) => (log[i - 1] === 'flow' ? log[i - 2] : log[i - 1]);
	return {
		respins: presented.length,
		parks: log.filter((e) => e === 'park').length,
		everyParkRightBefore: presented.every((i) => before(i) === 'park'),
	};
};

const bothBook = both.map((s) => structuredClone(s.event));
for (const flow of [false, true]) {
	const branch = flow ? 'flow' : 'coded';
	stateBet.autoSpinsCounter = 0;
	stateBet.isSpaceHold = false;
	const manual = buildSeam(hostDoc('manual', 'manual'), flow);
	await hush(() => manual.playBet({ state: structuredClone(bothBook) }));
	const seen = parkedRight(manual.log);
	check(
		`seam (${branch}): Manual parks before every respin, and the respin is presented only after it`,
		[seen.respins > 4, seen.parks === seen.respins, seen.everyParkRightBefore],
		[true, true, true],
	);
	check(
		`seam (${branch}): the board is built once per mode, on that mode's own strip`,
		manual.builds.map((b) => [b.mode, b.strip]),
		[
			[MODE_A, HOST.paddingReels.respin[0][0].name],
			[MODE_B, HOST.paddingReels[KEY_B][0][0].name],
		],
	);
	const auto = buildSeam(hostDoc(), flow);
	await hush(() => auto.playBet({ state: structuredClone(bothBook) }));
	check(`seam (${branch}): Automatic (absent) never parks`, parkedRight(auto.log).parks, 0);
	for (const [label, set] of [
		['the LAST autoplay round (counter 1)', () => (stateBet.autoSpinsCounter = 1)],
		['hold-to-spin', () => (stateBet.isSpaceHold = true)],
	] as const) {
		set();
		const handsOff = buildSeam(hostDoc('manual', 'manual'), flow);
		await hush(() => handsOff.playBet({ state: structuredClone(bothBook) }));
		check(
			`seam (${branch}): Manual never parks under ${label}`,
			parkedRight(handsOff.log).parks,
			0,
		);
		stateBet.autoSpinsCounter = 0;
		stateBet.isSpaceHold = false;
	}
}

if (resumedBet) {
	for (const flow of [false, true]) {
		const branch = flow ? 'flow' : 'coded';
		const seam = buildSeam(hostDoc(undefined, 'manual'), flow);
		const bet = seam.convertTorResumableBet(structuredClone(resumedBet));
		await hush(() => seam.playBet(bet));
		const firstRespin = seam.log.indexOf('present:respinReveal');
		check(
			`seam resume (${branch}): the snapshot rebuilds mode 2's board with no intro, then the next respin parks`,
			[
				seam.builds[0]?.mode,
				seam.builds[0]?.strip,
				seam.log.includes('present:holdAndWinTrigger'),
				seam.log.slice(0, firstRespin).includes('park'),
				parkedRight(seam.log).everyParkRightBefore,
			],
			[MODE_B, HOST.paddingReels[KEY_B][0][0].name, false, true, true],
		);
	}
}

// ---------- 7. Phase 7a: a LINES host deals every route ----------

/**
 * Bonus-games Phase 7a: the deal is decided by the doc, so a LINES game whose coin overlay routes to
 * two respin modes plays each by its route — the red pot starts mode 1 (Automatic), a buy tier and
 * Lucky Spin start mode 2 (Manual), the scatters start the game's own free spins. Each mode plays by
 * its own rules, strip, screens and Win Text; a tier name progressive in both keeps a pool per mode;
 * the base game's coin values (`coinOverlay.coins`) are what drops.
 */
const POOL = 'POOL';
const BUY_MODES = [
	{ mode: 'base', cost: 1, kind: 'base' },
	{ mode: 'bonus', cost: 100, kind: 'buy' },
];
const routedHost = (): GameConfigDoc => {
	const raw = structuredClone(HOST);
	raw.betModes = {
		...raw.betModes,
		bonus: { cost: 100, feature: false, buyBonus: true, rtp: 0.96, max_win: 5000 },
	};
	const overlay = raw.coinOverlay!;
	overlay.pots = overlay.pots!.map((p) =>
		p.id === 'green' ? { ...p, bonus: { mode: MODE_A } } : p,
	);
	overlay.trigger = {
		...overlay.trigger,
		buy: [{ betMode: 'bonus', mode: MODE_B, guaranteed: [], boostedSpecials: false }],
		luckySpin: { mode: MODE_B },
	};
	overlay.coins = [{ kind: 'cash', value: 7, weight: 1 }];
	raw.modes = raw.modes?.map((m) => {
		if (!m.holdAndWin) return m;
		const seed = m.id === MODE_A ? 500 : 900;
		const pool = {
			name: POOL,
			multiplier: seed,
			fixed: false,
			progressive: { seed, contribution: 0 },
		};
		return {
			...m,
			holdAndWin: {
				...m.holdAndWin,
				jackpots: [...m.holdAndWin.jackpots, pool],
				...(m.id === MODE_B ? { play: 'manual' as const } : {}),
			},
		};
	});
	return normalized(raw);
};
const ROUTED = routedHost();
const ROUTED_MODES = respinModeRules(ROUTED);
const [RA, RB] = ROUTED_MODES;
const routedOpts = { betModes: BUY_MODES };

check(
	'7a host: a lines game, two respin modes (Automatic, Manual), its free spins on',
	[ROUTED_MODES.map((m) => [m.mode, m.play]), Boolean(ROUTED.freeSpins?.enabled !== false)],
	[
		[
			[MODE_A, 'auto'],
			[MODE_B, 'manual'],
		],
		true,
	],
);

const routedWalk = (events: BookEvent[]) => walk(events, emptyModeStack(), ROUTED_MODES);
const respinRuns = (steps: Step[]) => [
	...new Set(steps.filter((s) => BOARD_EVENTS.has(s.event.type)).map((s) => s.active?.mode)),
];

const potA = routedWalk(await playRound('force:pot:red', ROUTED, routedOpts));
verifyFeature('7a red pot', potA, RA, ROUTED_MODES);
check(
	'7a red pot: mode 1 alone plays, and never parks (Automatic)',
	[respinRuns(potA), parks(potA, false)],
	[[MODE_A], []],
);

const bought = routedWalk(await playRound(null, ROUTED, routedOpts, 'BONUS'));
verifyFeature('7a buy', bought, RB, ROUTED_MODES);
check(
	'7a buy: the bought round plays mode 2 alone, and no free spins',
	[
		respinRuns(bought),
		bought.some((s) => modeOpOf(s.event)?.id === 'freeSpins'),
		bought.find((s) => s.event.type === 'holdAndWinTrigger')?.event.cause,
	],
	[[MODE_B], false, 'buy'],
);
check(
	'7a buy: Manual parks before every respin of mode 2, never under autoplay',
	[parks(bought, false), parks(bought, true)],
	[respinsOf(bought, MODE_B), []],
);

const lucky = routedWalk(await playRound('force:trigger:luckySpin', ROUTED, routedOpts));
verifyFeature('7a Lucky Spin', lucky, RB, ROUTED_MODES);
check(
	'7a Lucky Spin: announced, then mode 2 plays',
	[lucky.some((s) => s.event.type === 'luckySpin'), respinRuns(lucky)],
	[true, [MODE_B]],
);

const scatters = routedWalk(await playRound('force:feature', ROUTED, routedOpts));
check(
	'7a scatters: the free spins play, and no respin mode',
	[scatters.some((s) => modeOpOf(s.event)?.id === 'freeSpins'), respinRuns(scatters)],
	[true, []],
);

// Win Text: the active mode's lines (`bakedWinTextFor`: the primary speaks the top level).
{
	const winText: WinTextDoc = {
		version: 1,
		feature: { intro: 'mode 1 intro' },
		modes: { [MODE_B]: { feature: { intro: 'mode 2 intro' } } },
	};
	const introOf = (steps: Step[]) => {
		const active = steps.find((s) => s.event.type === 'holdAndWinTrigger')?.active;
		return resolveWinTextForMode(winText, active === RA ? undefined : active?.mode).feature.intro;
	};
	check(
		'7a Win Text: each feature speaks its own mode’s lines',
		[introOf(potA), introOf(bought)],
		['mode 1 intro', 'mode 2 intro'],
	);
}

// Pools and base-game coins, straight off the mock.
{
	const host = await startHost(null, 'runtime-modes-7a-pools', ROUTED, routedOpts);
	const post = async (seq: number, body: unknown, gid?: string) =>
		(await (
			await fetch(
				`http://${host.rgsUrl}/rgs/engine?sid=pools&seq=${seq}${gid ? `&gid=${gid}` : ''}`,
				{
					method: 'POST',
					body: JSON.stringify(body),
				},
			)
		).json()) as { events: { event: string; context?: Record<string, unknown> }[] };
	const boot = (await post(0, [{ action: 'config' }])).events.find(
		(e) => e.event === 'config',
	)?.context;
	const levels = readBootJackpotLevels(boot);
	const pools = levels.filter((l) => l.name === POOL);
	check(
		'7a pools: a tier name progressive in both modes keeps a pool per mode, each tagged',
		pools.map((l) => [l.mode, l.value]),
		[
			[MODE_A, 500],
			[MODE_B, 900],
		],
	);
	check(
		'7a pools: the runtime shows the active mode’s pool',
		[RA, RB].map(
			(m) => poolLevel(levels, POOL, jackpotTierMode(ROUTED_MODES, m, POOL)?.mode)?.value,
		),
		[500, 900],
	);
	const respin = readHoldAndWinModes(boot);
	if (respin) applyPools(respin, [{ name: POOL, value: 950, mode: MODE_B }]);
	check(
		'7a pools: a level tagged with mode 2 moves mode 2’s pool alone',
		[MODE_A, MODE_B].map(
			(id) => respin?.modes.get(id)?.jackpots.find((j) => j.name === POOL)?.value,
		),
		[500, 950],
	);
	const dropped = (
		await post(0, [
			{ action: 'bet', context: [0, 1] },
			{ action: 'play', context: 'force:overlay:coins:6' },
		])
	).events.find((e) => e.event === 'overlayDrop')?.context?.cells as { value?: number }[];
	check(
		'7a base-game coins: every dropped value coin is worth the authored base-game value',
		[dropped?.length, [...new Set(dropped?.map((c) => c.value))]],
		[6, [7]],
	);
	await host.stop();
}

// The route dispatch (`startBonus`): a bonus mode that is no respin mode — a reels or spins mode
// (bonus-games Phase 8) — is started by any route through the host's `startFreeSpins`, its `game`
// passed through untouched; a mode the host registers (`bonusModes`) is started by its own hook.
{
	let started: Record<string, unknown> | undefined;
	const game = { winModel: 'ways', reels: 6, rows: [4], paylines: [], spins: 8 };
	const fakeHost = {
		label: 'dispatch',
		seed: 'dispatch',
		reels: 5,
		rows: 3,
		bonuses: {},
		freeSpinsMode: 'freeSpins',
		freeSpinsOn: true,
		startFreeSpins: (_events: unknown[], _round: unknown, opts: Record<string, unknown>) => {
			started = opts;
		},
	};
	const reelsOverlay = createPotsOverlay(fakeHost, {
		pots: [],
		drops: { table: [] },
		modes: {
			spinsMode: {
				gameType: 'spinsMode',
				strips: [['PIC1']],
				paytable: {},
				trigger: { buy: [{ mode: 'bonus', guaranteed: [], boostedSpecials: false }] },
				game,
			},
		},
	});
	const round: Record<string, unknown> = { isBuy: true, betMode: 'bonus' };
	const session = {};
	reelsOverlay.beginPlay(session, round, null, { mode: 'basegame', sid: 'dispatch' });
	const owns = reelsOverlay.takeOver([], session, round);
	check(
		'dispatch: a buy routed to a spins mode starts it through startFreeSpins, game untouched',
		[
			reelsOverlay.sellsBuy('bonus'),
			round.isBuy,
			owns,
			started?.bonus,
			started?.spins,
			started?.game === game,
			(started?.extra as { cause?: string } | undefined)?.cause,
		],
		[true, false, true, 'spinsMode', 8, true, 'buy'],
	);
	let hooked: unknown;
	const hookedOverlay = createPotsOverlay(
		{
			...fakeHost,
			bonusModes: {
				picker: { start: (_e: unknown, _r: unknown, info: unknown) => (hooked = info) },
			},
		},
		{
			pots: [{ id: 'red', token: 'TOKEN', maxLevel: 1, bonus: { mode: 'picker' } }],
			drops: { table: [] },
		},
	);
	const hookedRound: Record<string, unknown> = {};
	const hookedSession = {};
	hookedOverlay.beginPlay(hookedSession, hookedRound, 'force:pot:red', {
		mode: 'basegame',
		sid: 'hooked',
	});
	check(
		'dispatch: a pot to a mode the host registers starts it through its own hook',
		[hookedOverlay.takeOver([], hookedSession, hookedRound), hooked],
		[true, { cause: 'meter', meters: ['red'] }],
	);
}

// ---------- 8. Phase 7a: a Hold and Win BASE with a coin overlay ----------

/**
 * The overlay composes over the Hold and Win engine too: a Hold and Win game (Classic) with a pots
 * overlay and a second respin mode (the Collector). Its reels still start its own feature; the red
 * pot starts it too, the green pot the second mode, the blue pot this game's free spins
 * (approximate). Each feature plays its own mode, and the round ends after the last.
 */
const hwBase = (): GameConfigDoc => {
	const classicDoc = normalized(structuredClone(HOLD_AND_WIN_PRESETS.classic));
	const added = addPotsOverlay(classicDoc, 'potsToFreeSpins');
	if (!added.ok) throw new Error(added.reason);
	const raw = structuredClone(normalized(added.doc));
	for (const [name, symbol] of Object.entries(collector.symbols))
		if (isRole(name)) raw.symbols[as2(name)] = structuredClone(symbol);
	const strips = collector.paddingReels.respin;
	raw.paddingReels[KEY_B] = Array.from({ length: raw.numReels }, (_u, reel) =>
		strips[reel % strips.length].map((cell) => ({ ...cell, name: as2(cell.name) })),
	);
	raw.modes = [
		...(raw.modes ?? []),
		{
			...holdAndWinModeDecl(),
			id: MODE_B,
			gameType: KEY_B,
			label: 'Collector',
			holdAndWin: { ...structuredClone(collectorRules), blank: 'BLANK_2' },
		},
	];
	// The preset's one gold pot, as three: each starts a different bonus.
	const [gold] = raw.coinOverlay!.pots!;
	raw.coinOverlay!.pots = [
		{ ...gold, id: 'red', bonus: { mode: MODE_A } },
		{ ...gold, id: 'green', bonus: { mode: MODE_B } },
		{ ...gold, id: 'blue', bonus: { mode: 'freeSpins', spins: 5 } },
	];
	raw.coinOverlay!.drops = {
		...raw.coinOverlay!.drops!,
		table: ['red', 'green', 'blue'].map((pot) => ({ pot, weight: 1 })),
	};
	return normalized(raw);
};
const HW_BASE = hwBase();
const HW_MODES = respinModeRules(HW_BASE);
const [HA, HB] = HW_MODES;
/** What the launcher's contract hands the test server for a `holdAndWin`-kind project. */
const hwOpts = {
	reels: HW_BASE.numReels,
	rows: Math.max(...HW_BASE.numRows),
	paylines: Object.values(HW_BASE.paylines),
	holdAndWin: holdAndWinMockInputs(HW_BASE),
};
check(
	'8 host: a Hold and Win base, its pots routed to itself, a second mode and free spins',
	[
		HW_MODES.map((m) => m.mode),
		HW_BASE.coinOverlay?.pots?.map((p) => [p.id, p.bonus.mode]),
		Boolean(potsOverlayMockInputs(HW_BASE)),
	],
	[
		[MODE_A, MODE_B],
		[
			['red', MODE_A],
			['green', MODE_B],
			['blue', 'freeSpins'],
		],
		true,
	],
);
const hwWalk = (events: BookEvent[]) => walk(events, emptyModeStack(), HW_MODES);

const ownReels = hwWalk(await playRound('force:trigger', HW_BASE, hwOpts));
verifyFeature('8 its reels', ownReels, HA, HW_MODES);
check('8 its reels: its own feature alone, as without the overlay', respinRuns(ownReels), [MODE_A]);

const hwRed = hwWalk(await playRound('force:pot:red', HW_BASE, hwOpts));
verifyFeature('8 red pot', hwRed, HA, HW_MODES);

const hwGreen = hwWalk(await playRound('force:pot:green', HW_BASE, hwOpts));
verifyFeature('8 green pot', hwGreen, HB, HW_MODES);
check('8 green pot: the second mode alone plays', respinRuns(hwGreen), [MODE_B]);

const hwBoth = hwWalk(await playRound('force:trigger,pot:green', HW_BASE, hwOpts));
check(
	'8 reels and green pot in one round: the base feature first, then the second mode',
	respinRuns(hwBoth),
	[MODE_A, MODE_B],
);

const hwBlue = hwWalk(await playRound('force:pot:blue', HW_BASE, hwOpts));
check(
	'8 blue pot: the Hold and Win base plays free spins, and no respin mode',
	[hwBlue.some((s) => modeOpOf(s.event)?.id === 'freeSpins'), respinRuns(hwBlue)],
	[true, []],
);

// A resume mid the overlay's feature that follows the base's own: the round reopens on a fresh
// `config` (`resume: true`), play continues at the same `seq` and `gid`, and the round ends once.
{
	const host = await startHost(null, 'runtime-modes-8-resume', HW_BASE, hwOpts);
	type Raw = {
		events: {
			event: string;
			context?: Record<string, unknown>;
			resume?: boolean;
			actions?: unknown;
		}[];
		platform: { balance: number; gameRound?: { id?: string } };
	};
	const post = async (seq: number, gid: string | null, body: unknown) =>
		(await (
			await fetch(
				`http://${host.rgsUrl}/rgs/engine?sid=resume8&seq=${seq}${gid ? `&gid=${gid}` : ''}`,
				{ method: 'POST', body: JSON.stringify(body) },
			)
		).json()) as Raw;
	const start = (await post(0, null, [{ action: 'config' }])).platform.balance;
	const lines = Object.keys(HW_BASE.paylines).length;
	const opened = await post(0, null, [
		{ action: 'bet', context: [lines, 1] },
		{ action: 'play', context: 'force:trigger,pot:green' },
	]);
	const gid = opened.platform.gameRound?.id ?? null;
	let seq = 2;
	let last = opened;
	const startsB = (r: Raw) =>
		r.events.some((e) => e.event === 'spinTrigger' && e.context?.bonus === KEY_B);
	for (let guard = 0; !startsB(last) && guard < 200; guard++) {
		last = await post(seq, gid, [{ action: 'play' }]);
		seq += 1;
	}
	const reopened = await post(seq, gid, [{ action: 'config' }]);
	const config = reopened.events.find((e) => e.event === 'config');
	let ended = false;
	let ends = 0;
	for (let guard = 0; !ended && guard < 200; guard++) {
		last = await post(seq, gid, [{ action: 'play' }]);
		seq += 1;
		ends += last.events.filter((e) => e.event === 'gameEnd').length;
		ended = last.events.some((e) => e.event === 'gameEnd');
	}
	const collected = await post(seq, gid, [{ action: 'collect' }]);
	const win = Number(collected.events.find((e) => e.event === 'gameRoundOver')?.context?.win);
	await host.stop();
	check(
		'8 resume: the base feature, then the pot’s mode 2 opens; a fresh config reopens the round there',
		[gid !== null, startsB(last) || ended, config?.resume, Array.isArray(config?.actions)],
		[true, true, true, true],
	);
	check(
		'8 resume: play goes on at the same seq and gid to one gameEnd, then the collect pays it once',
		[ends, Number.isFinite(win), collected.platform.balance, collected.platform.gameRound],
		[1, true, start - lines + win, undefined],
	);
}

// A round abandoned mid the overlay's feature (a fresh `bet` with no `gid`) is settled the way the
// server settles one nobody finishes: played out, its whole win credited — what playing it pays.
{
	const lines = Object.keys(HW_BASE.paylines).length;
	const run = async (abandon: boolean) => {
		const host = await startHost(null, 'runtime-modes-8-abandon', HW_BASE, hwOpts);
		const post = async (seq: number, gid: string | null, body: unknown) =>
			(await (
				await fetch(
					`http://${host.rgsUrl}/rgs/engine?sid=abandon8&seq=${seq}${gid ? `&gid=${gid}` : ''}`,
					{ method: 'POST', body: JSON.stringify(body) },
				)
			).json()) as {
				events: { event: string; context?: Record<string, unknown> }[];
				platform: { balance: number; gameRound?: { id?: string } };
			};
		const start = (await post(0, null, [{ action: 'config' }])).platform.balance;
		const opened = await post(0, null, [
			{ action: 'bet', context: [lines, 1] },
			{ action: 'play', context: 'force:pot:red' },
		]);
		const gid = opened.platform.gameRound?.id ?? null;
		let seq = 2;
		let last = opened;
		const inB = (r: typeof opened) =>
			r.events.some((e) => e.event === 'spinTrigger' && Array.isArray(e.context?.meters));
		for (let guard = 0; !inB(last) && guard < 200; guard++) {
			last = await post(seq, gid, [{ action: 'play' }]);
			seq += 1;
		}
		let win = 0;
		if (abandon) {
			const next = await post(0, null, [{ action: 'bet', context: [lines, 1] }]);
			win = next.platform.balance - (start - 2 * lines);
		} else {
			for (let guard = 0; !last.events.some((e) => e.event === 'gameEnd') && guard < 200; guard++) {
				last = await post(seq, gid, [{ action: 'play' }]);
				seq += 1;
			}
			const collected = await post(seq, gid, [{ action: 'collect' }]);
			win = collected.platform.balance - (start - lines);
		}
		await host.stop();
		return win;
	};
	const played = await run(false);
	const abandoned = await run(true);
	check(
		'8 abandoned mid a pot’s feature: settled with the whole win playing it out pays',
		[played > 0, abandoned],
		[true, played],
	);
}

// The PLAIN Hold and Win game (the owner's base game): coins on the reels start respins that pay,
// with no jackpot, no board end and no overlay.
{
	const raw = structuredClone(normalized(structuredClone(HOLD_AND_WIN_PRESETS.classic)));
	raw.modes = raw.modes?.map((m) =>
		m.holdAndWin
			? {
					...m,
					holdAndWin: {
						...m.holdAndWin,
						jackpots: [],
						boardEnd: { type: 'none' },
						coins: m.holdAndWin.coins.filter((c) => c.kind === 'cash'),
					},
				}
			: m,
	);
	const plain = normalized(raw);
	const plainModes = respinModeRules(plain);
	const plainOpts = {
		reels: plain.numReels,
		rows: Math.max(...plain.numRows),
		paylines: Object.values(plain.paylines),
		holdAndWin: holdAndWinMockInputs(plain),
	};
	check(
		'8 plain: a Hold and Win base with no jackpots, no board end and no overlay',
		[plainModes[0]?.block.jackpots, plainModes[0]?.block.boardEnd, potsOverlayMockInputs(plain)],
		[[], { type: 'none' }, undefined],
	);
	const book = await playRound('force:trigger', plain, plainOpts);
	const steps = walk(book, emptyModeStack(), plainModes);
	verifyFeature('8 plain', steps, plainModes[0], plainModes);
	const end = book.find((e) => e.type === 'holdAndWinEnd');
	check(
		'8 plain: coins → respins → a paying end, and no jackpot anywhere',
		[
			Boolean(book.find((e) => e.type === 'holdAndWinTrigger')),
			book.filter((e) => e.type === 'respinReveal').length > 0,
			Boolean(end),
			book.some((e) => e.type === 'jackpotWin' || e.type === 'jackpotLevels'),
		],
		[true, true, true, false],
	);
}

realLog(`\n${passes} runtime respin-mode checks passed, ${failures} failed.`);
if (failures) process.exit(1);
