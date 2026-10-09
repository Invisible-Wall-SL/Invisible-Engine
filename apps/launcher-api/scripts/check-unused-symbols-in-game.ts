/**
 * A symbol Invisible Game Config marks UNUSED never reaches the game — pinned for the mock RGS that
 * deals every game we host, kind by kind, from the contract the test server is handed.
 *
 * For each kind's mock — the lines mock (lines, ways, cluster, scatter), the book mock (bookOf) and
 * the Hold and Win mock — a project whose `/config` takes a symbol off every strip gets a contract
 * (`mockContractOfBundle`, the derivation a publish freezes and the test server reads) whose mock
 * never deals that symbol, never picks it as the Book's expanding special, never lands it through a
 * forced meter, and never declares it in its boot `config` (the client builds its spinning reels from
 * the declared symbols). Base spins, forced features, forced wins, the forced big win and, with
 * stacked pictures on, the stacked test deal are all played. Every case is shown non-vacuous: with
 * the symbol left in play, the same deal LANDS it on a board (a pick list naming the pool is not
 * enough). The client reads every declared symbol as one `/config` puts in play — through the
 * mapping it detects from that declaration, so a Book-of pool without `ACE`, `KING` and `QUEEN` is
 * still read as a book (a pots overlay host's too), and draws the respin board's empty cell with the
 * blank the server declares. Each case's unused config is one `/config` saves; a Hold and Win coin
 * symbol taken off the reels is refused there, and a config saved before that rule still deals its
 * coins rather than losing them.
 *
 * The real Invisible Test Server (`services/test-server/server.mjs`, local mode) then deals every
 * case from the same contracts through its own `validGrid` and `makeMock`, so the wiring the in-process
 * mocks stand in for is proven too: it declares what they declare and never shows the unused symbol.
 *
 * The client's own surfaces: the spinning reels, the paytable and the info page read the in-play gate
 * (`getSymbolsInPlay` / `paddingReels`), the initial board's fallback is pinned by `engine-game`'s
 * `paddingReels.fixture.ts`, and the Book-of shuffle and the Symbol Debug grid are pinned at the end
 * of this file.
 *
 * Run:  pnpm --filter launcher-api check:unused-symbols-in-game
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	HOLD_AND_WIN_PRESETS,
	addPotsOverlay,
	gameConfigErrors,
	holdAndWinBlankSymbol,
	normalizeGameConfigDoc,
	symbolUses,
	type GameConfigDoc,
} from 'game-config';
import {
	linesMapping,
	mapSymbol,
	pickMappingForConfig,
} from 'rgs-translator-eagaming/game-mappings';
import { startTestServer } from '../../../scripts/current-games/lib/serve.mjs';
import { withPotsOverlay } from '../../../scripts/mock-pots-overlay.mjs';
import { createMockRgs as createBookMock } from '../../../scripts/mock-rgs-server-book.mjs';
import { createMockRgs as createHoldAndWinMock } from '../../../scripts/mock-rgs-server-holdandwin.mjs';
import { createMockRgs as createLinesMock } from '../../../scripts/mock-rgs-server.mjs';
import { readLF } from '../../../scripts/lib/read-lf.mjs';
import { gameConfigDefaultFor, templateIsBuiltIn } from '../src/lib/server/gameConfigDefaults.ts';
import { mockContractOfBundle } from '../src/lib/server/mockContract.ts';
import type { RuntimeBundle } from '../src/lib/server/runtimeBundle.ts';
import type { MockProtocol } from '../src/lib/server/testServerManifest.ts';

let failures = 0;
let checks = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	checks += 1;
	if (ok) return;
	failures += 1;
	console.log(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};

type Mock = { handle: (req: unknown, res: unknown, url: URL) => Promise<void> };
type Response = { events?: Array<{ event: string; context?: unknown }>; platform?: unknown };
type Post = (path: string, body: unknown) => Promise<Response>;

const boot = async (mock: Mock) => {
	const server = createServer((req, res) =>
		mock.handle(req, res, new URL(req.url ?? '/', 'http://127.0.0.1')),
	);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	const port = typeof address === 'object' && address ? address.port : 0;
	const post: Post = (path, body) =>
		new Promise((resolve, reject) => {
			const payload = JSON.stringify(body);
			const req = request(
				{
					host: '127.0.0.1',
					port,
					path,
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						'content-length': Buffer.byteLength(payload),
						connection: 'close',
					},
				},
				(res) => {
					let text = '';
					res.setEncoding('utf8');
					res.on('data', (chunk) => (text += chunk));
					res.on('end', () => resolve(JSON.parse(text) as Response));
				},
			);
			req.on('error', reject);
			req.end(payload);
		});
	return { post, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
};

const has = (resp: Response, name: string) => (resp.events ?? []).some((e) => e.event === name);

/**
 * Every symbol name a response carries: each string, and each string's part before a `:` (a coin's
 * `BONUS:5`, a jackpot's `JACKPOT:grand`, a multiplier's `MULT:3`). A Hold and Win meter's `symbol`
 * is skipped: it names what fills the meter — a reference that never lands while the symbol is
 * unused, not a symbol on screen.
 */
const namesIn = (value: unknown, out: Set<string>, key = ''): Set<string> => {
	if (typeof value === 'string') {
		out.add(value);
		out.add(value.split(':')[0]);
	} else if (Array.isArray(value)) for (const v of value) namesIn(v, out, key);
	else if (value && typeof value === 'object') {
		for (const [k, v] of Object.entries(value)) {
			if (!(key === 'meters' && k === 'symbol')) namesIn(v, out, k);
		}
	}
	return out;
};

type BootConfig = { symbols?: string[]; holdAndWin?: { blank?: string }; potsOverlay?: unknown };

/** What a run saw: the names the mock DECLARED (its `config` and `spinStart` events — the client
 *  builds its spinning reels from them), the ones it DEALT or picked (every other event), the ones
 *  that LANDED on a board, its boot `config`, and how many rounds reached their end. */
type Seen = {
	declared: Set<string>;
	dealt: Set<string>;
	landed: Set<string>;
	boot?: BootConfig;
	rounds: number;
};

const seenNothing = (): Seen => ({
	declared: new Set(),
	dealt: new Set(),
	landed: new Set(),
	rounds: 0,
});

const DECLARING = new Set(['config', 'spinStart']);
/** The events that carry a board: a base or bonus spin, a tumble, the coins a respin lands. */
const LANDING = new Set(['playedSpin', 'playedBonusSpin', 'tumbleStep', 'coinsLand']);

const record = (resp: Response, seen: Seen): void => {
	for (const e of resp.events ?? []) {
		namesIn(e.context, DECLARING.has(e.event) ? seen.declared : seen.dealt);
		if (LANDING.has(e.event)) namesIn(e.context, seen.landed);
		if (e.event === 'config') seen.boot ??= e.context as BootConfig;
	}
	if (has(resp, 'gameEnd')) seen.rounds += 1;
};

/**
 * Play `rounds` rounds against a mock the way the client does — `config` once, then bet + play,
 * `play` while a feature runs, `collect` when the round is left open. The stake is the client's: an
 * option index on a game that declares a bet table, else its line count. `play(i)` is round i's
 * `play` context: a force spec on the mocks that take one.
 */
const playRounds = async (
	post: Post,
	rounds: number,
	seen: Seen,
	play: (i: number) => string | null = () => null,
): Promise<void> => {
	const sid = 'unused-in-game';
	const booted = await post(`/rgs/engine?sid=${sid}&seq=0`, [{ action: 'config' }]);
	record(booted, seen);
	const config = booted.events?.find((e) => e.event === 'config')?.context as
		{ betOptions?: unknown[]; paylines?: unknown[]; availablePayLines?: unknown[] } | undefined;
	const lines = (config?.paylines ?? config?.availablePayLines ?? []).length;
	const bet = [config?.betOptions?.length ? 0 : lines, 1];
	for (let i = 0; i < rounds; i++) {
		// `seq` is a position in the ROUND's stored actions, so every round starts at 0.
		let seq = 0;
		let resp = await post(`/rgs/engine?sid=${sid}&seq=${seq}`, [
			{ action: 'bet', context: bet },
			{ action: 'play', context: play(i) },
		]);
		seq += 2;
		record(resp, seen);
		const round = resp.platform as { gameRound?: { id?: string } } | undefined;
		const gid = round?.gameRound?.id;
		for (let guard = 0; gid && !has(resp, 'gameEnd') && guard < 300; guard++) {
			resp = await post(`/rgs/engine?sid=${sid}&seq=${seq}&gid=${gid}`, [{ action: 'play' }]);
			seq += 1;
			record(resp, seen);
		}
		if (gid && !has(resp, 'gameRoundOver')) {
			resp = await post(`/rgs/engine?sid=${sid}&seq=${seq}&gid=${gid}`, [{ action: 'collect' }]);
			seq += 1;
			record(resp, seen);
		}
	}
};

/** Boot an in-process mock, play it, close it. */
const playMock = async (
	mock: Mock,
	rounds: number,
	seen: Seen,
	play?: (i: number) => string | null,
): Promise<void> => {
	const { post, close } = await boot(mock);
	try {
		await playRounds(post, rounds, seen, play);
	} finally {
		await close();
	}
};

/**
 * The names the client draws for a boot `config`'s declared symbols: mapped through the mapping the
 * facade detects from that declaration, else the shared runtime's own (`lines` — it is built without
 * `PUBLIC_RGS_GAME`).
 */
const drawnAs = (boot: BootConfig | undefined): string[] => {
	const mapping = (boot && pickMappingForConfig(boot)) ?? linesMapping;
	return (boot?.symbols ?? []).map((name) => mapSymbol(mapping, name));
};

/** What a save then a load does to a config: the stored doc is always the normalized one. */
const saved = (raw: unknown): GameConfigDoc => {
	const out = normalizeGameConfigDoc(structuredClone(raw));
	if (!out) throw new Error('a case config did not normalize');
	return out;
};

/** `/config`'s badge click on an in-play symbol: every cell of it off every strip, never emptying a
 *  reel. */
const takeOffReels = (doc: GameConfigDoc, name: string): GameConfigDoc => {
	const next = structuredClone(doc);
	for (const type of Object.keys(next.paddingReels)) {
		next.paddingReels[type] = next.paddingReels[type].map((reel) => {
			const kept = reel.filter((cell) => cell.name !== name);
			return kept.length ? kept : reel;
		});
	}
	return saved(next);
};

/** A symbol renamed in the dictionary and on every strip. */
const renameSymbol = (doc: GameConfigDoc, from: string, to: string): GameConfigDoc => {
	const next = structuredClone(doc);
	next.symbols = Object.fromEntries(
		Object.entries(next.symbols).map(([name, symbol]) => [name === from ? to : name, symbol]),
	);
	for (const type of Object.keys(next.paddingReels)) {
		next.paddingReels[type] = next.paddingReels[type].map((reel) =>
			reel.map((cell) => (cell.name === from ? { ...cell, name: to } : cell)),
		);
	}
	return saved(next);
};

const templateOf = (kind: string): GameConfigDoc => {
	const template = gameConfigDefaultFor(kind);
	if (!template) throw new Error(`no template for ${kind}`);
	return saved(template);
};

type Drive = (make: (extra: Record<string, unknown>) => Mock, seen: Seen) => Promise<void>;

type Case = {
	label: string;
	protocol: MockProtocol;
	/** The project's stored kind, when it decides the deal (a `holdAndWin` kind's lines contract). */
	gameType?: string;
	/** The config with the symbol in play, and the symbol `/config` is about to mark unused. */
	config: GameConfigDoc;
	unused: string;
	/** Its name on the wire. */
	wire: string;
	stacked?: boolean;
	/** What each case's mock plays beyond plain base spins. */
	drive: Drive;
};

const contractOf = (c: Case, config: GameConfigDoc) =>
	mockContractOfBundle(
		c.protocol,
		{ config, symbols: { stacked: Boolean(c.stacked), map: {} } } as unknown as Pick<
			RuntimeBundle,
			'config' | 'symbols'
		>,
		'unused-in-game',
		c.gameType,
	);

/** The mock the test server builds for a contract (`makeMock` in services/test-server/server.mjs),
 *  with the forcing options it reads from its environment passed in. */
const mockFor = (c: Case, config: GameConfigDoc) => {
	const { grid } = contractOf(c, config);
	return (extra: Record<string, unknown>): Mock => {
		const common = { label: 'unused-in-game', seed: 'unused-in-game', quiet: true, ...extra };
		if (c.protocol === 'book') {
			const opts = {
				...common,
				autoCollect: true,
				symbolPaytable: grid?.symbolPaytable,
				symbols: grid?.symbols,
			};
			// A pots overlay rides the book host, as `makeBookMock` composes it.
			return grid?.potsOverlay
				? withPotsOverlay(createBookMock, grid.potsOverlay)({ ...opts, allowForce: true })
				: createBookMock(opts);
		}
		// A lines contract carrying the Hold and Win inputs runs on the Hold and Win engine.
		if (c.protocol === 'lines' && grid?.holdAndWin)
			return createHoldAndWinMock({ ...common, ...grid });
		const opts = {
			...common,
			winModel: c.protocol === 'lines' ? 'lines' : c.protocol,
			cascade: false,
			...grid,
		};
		// …and the lines host, since book-feature Phase 4.
		return grid?.potsOverlay
			? withPotsOverlay(createLinesMock, grid.potsOverlay)({ ...opts, allowForce: true })
			: createLinesMock(opts);
	};
};

const linesDrive: Drive = async (make, seen) => {
	await playMock(make({}), 150, seen);
	await playMock(make({ forceTrigger: true }), 20, seen);
	await playMock(make({ winX: [5, 20, 60] }), 6, seen);
};

const bookDrive: Drive = async (make, seen) => {
	await playMock(make({}), 150, seen);
	await playMock(make({ forceTrigger: true }), 25, seen);
	await playMock(make({ bigWin: true }), 2, seen);
	await playMock(make({ winX: [5, 20, 60] }), 6, seen);
};

/** Natural rounds with a forced feature every third; then each of `forces` — specs the unused twin
 *  refuses, having no such special or meter symbol, so only its natural deal is played. */
const holdAndWinDrive =
	(...forces: string[]): Drive =>
	async (make, seen) => {
		await playMock(make({}), 60, seen, (i) => (i % 3 === 0 ? 'force:trigger' : null));
		for (const force of forces) await playMock(make({}), 6, seen, () => force);
	};

const lines = templateOf('lines');
const linesWithWild = (() => {
	const doc = structuredClone(lines);
	doc.symbols.W = { ...doc.symbols.W, paytable: [{ '3': 5 }, { '4': 10 }, { '5': 20 }] };
	for (const strips of Object.values(doc.paddingReels))
		for (const reel of strips) reel.push({ name: 'W' });
	return saved(doc);
})();
const pots = saved(HOLD_AND_WIN_PRESETS.pots);
/** The pots preset's meter that MULTI fills. */
const multiMeter = primaryHoldAndWin(pots)?.meters?.find((meter) => meter.symbol === 'MULTI')?.id;
if (!multiMeter) throw new Error('the pots preset has no meter MULTI fills');
/** A Book-of game with the 3 Pots overlay, its blank renamed so the respin board's empty cell is a
 *  name of the project's own, and L1–L4 off its strips: only TEN is left of the royals. */
const bookWithPots = (() => {
	const added = addPotsOverlay(lines, 'threePots');
	if (!added.ok) throw new Error(`the threePots overlay: ${added.reason}`);
	let doc = renameSymbol(added.doc, 'BLANK', 'EMPTY');
	for (const name of ['L1', 'L2', 'L3', 'L4']) doc = takeOffReels(doc, name);
	return doc;
})();

const CASES: Case[] = [
	{
		label: 'lines · L1',
		protocol: 'lines',
		config: lines,
		unused: 'L1',
		wire: 'PIC5',
		drive: linesDrive,
	},
	{
		label: 'ways · L1',
		protocol: 'ways',
		config: templateOf('ways'),
		unused: 'L1',
		wire: 'PIC5',
		drive: linesDrive,
	},
	{
		label: 'cluster · L1',
		protocol: 'cluster',
		config: templateOf('cluster'),
		unused: 'L1',
		wire: 'PIC5',
		drive: linesDrive,
	},
	{
		label: 'scatter · L1',
		protocol: 'scatter',
		config: templateOf('scatter'),
		unused: 'L1',
		wire: 'PIC5',
		drive: linesDrive,
	},
	{
		label: 'lines · W with stacked pictures on',
		protocol: 'lines',
		config: linesWithWild,
		unused: 'W',
		wire: 'WILD',
		stacked: true,
		drive: linesDrive,
	},
	{
		label: 'bookOf · L5 (TEN)',
		protocol: 'book',
		config: lines,
		unused: 'L5',
		wire: 'TEN',
		drive: bookDrive,
	},
	{
		label: 'bookOf · H1 (PIC1)',
		protocol: 'book',
		config: lines,
		unused: 'H1',
		wire: 'PIC1',
		drive: bookDrive,
	},
	{
		// Unused, the pool keeps no ACE, KING or QUEEN: the client must still read it as a book.
		label: 'bookOf · L3 (QUEEN), with L1 and L2 already off',
		protocol: 'book',
		config: takeOffReels(takeOffReels(lines, 'L1'), 'L2'),
		unused: 'L3',
		wire: 'QUEEN',
		drive: bookDrive,
	},
	{
		// Unused, no royal is left at all, on a host whose boot also carries a Hold and Win bonus.
		label: 'bookOf with the 3 Pots overlay · L5 (TEN), with L1–L4 already off',
		protocol: 'book',
		config: bookWithPots,
		unused: 'L5',
		wire: 'TEN',
		drive: bookDrive,
	},
	{
		// The same game dealt by the lines mock, the overlay over it.
		label: 'lines with the 3 Pots overlay · L5 (PIC7), with L1–L4 already off',
		protocol: 'lines',
		config: bookWithPots,
		unused: 'L5',
		wire: 'PIC7',
		drive: linesDrive,
	},
	{
		label: 'holdAndWin · MULTI (a special and a meter symbol)',
		protocol: 'lines',
		gameType: 'holdAndWin',
		config: pots,
		unused: 'MULTI',
		wire: 'MULTI',
		drive: holdAndWinDrive(
			'force:special:multiplier',
			`force:meter:${multiMeter}`,
			`force:trigger:meter:${multiMeter}`,
		),
	},
	{
		label: 'holdAndWin · L1 (a line symbol)',
		protocol: 'lines',
		gameType: 'holdAndWin',
		config: pots,
		unused: 'L1',
		wire: 'L1',
		drive: holdAndWinDrive('force:trigger'),
	},
];

const quiet = async <T>(run: () => Promise<T>): Promise<T> => {
	const { log, warn, info } = console;
	console.log = console.warn = console.info = () => {};
	try {
		return await run();
	} finally {
		Object.assign(console, { log, warn, info });
	}
};

const run = async (c: Case, config: GameConfigDoc): Promise<Seen> => {
	const seen = seenNothing();
	await quiet(() => c.drive(mockFor(c, config), seen));
	return seen;
};

/** The client draws every declared symbol as one `/config` puts in play, and a respin board's empty
 *  cell with the blank the server declares (`respinBlank` is `holdAndWinBlankSymbol` for a lone
 *  default respin mode, `respinModeRules`). */
const checkDrawn = (label: string, seen: Seen, config: GameConfigDoc): void => {
	const uses = symbolUses(config);
	const strays = drawnAs(seen.boot).filter((name) => uses[name] !== 'inPlay');
	check(
		`${label} · the client reads every declared symbol as one /config puts in play`,
		Boolean(seen.boot?.symbols?.length) && !strays.length,
		`declared ${JSON.stringify(seen.boot?.symbols)}, drawn as ${JSON.stringify(drawnAs(seen.boot))}`,
	);
	if (primaryHoldAndWin(config)) {
		check(
			`${label} · the client's respin blank is the one the server declares`,
			seen.boot?.holdAndWin?.blank === holdAndWinBlankSymbol(config),
			`declared ${seen.boot?.holdAndWin?.blank}, the client's ${holdAndWinBlankSymbol(config)}`,
		);
	}
};

/** Each case's two contracts, as the real test server is about to deal them. */
const served: Array<{ key: string; c: Case; config: GameConfigDoc; local: Seen; unused: boolean }> =
	[];

for (const [index, c] of CASES.entries()) {
	const unusedConfig = takeOffReels(c.config, c.unused);
	check(
		`${c.label} · /config badges ${c.unused} in play, then unused once it is off the strips`,
		symbolUses(c.config)[c.unused] === 'inPlay' && symbolUses(unusedConfig)[c.unused] === 'unused',
	);
	check(
		`${c.label} · /config saves the config with ${c.unused} unused`,
		!gameConfigErrors(unusedConfig).length,
		JSON.stringify(gameConfigErrors(unusedConfig)),
	);
	const inPlay = await run(c, c.config);
	check(`${c.label} · in play, rounds are played`, inPlay.rounds > 20, `${inPlay.rounds} rounds`);
	check(
		`${c.label} · in play, a board lands ${c.wire} (the case is not vacuous)`,
		inPlay.landed.has(c.wire),
	);
	checkDrawn(`${c.label} · in play`, inPlay, c.config);
	const unused = await run(c, unusedConfig);
	check(`${c.label} · unused, rounds are played`, unused.rounds > 20, `${unused.rounds} rounds`);
	check(`${c.label} · unused, ${c.wire} is never dealt or picked`, !unused.dealt.has(c.wire));
	check(`${c.label} · unused, ${c.wire} is never declared`, !unused.declared.has(c.wire));
	checkDrawn(`${c.label} · unused`, unused, unusedConfig);
	served.push({ key: `case${index}-in`, c, config: c.config, local: inPlay, unused: false });
	served.push({ key: `case${index}-out`, c, config: unusedConfig, local: unused, unused: true });
}

// A Hold and Win coin symbol off the reels leaves its cash coins nothing to land as but the jackpot
// symbol, which the game values at nothing — so `/config` refuses to save it, and no mock is handed it.
const coinSymbol = Object.keys(pots.symbols).find((name) =>
	pots.symbols[name].special_properties?.includes('coin'),
);
check(
	'holdAndWin · /config refuses to save the coin symbol unused',
	Boolean(coinSymbol) &&
		gameConfigErrors(takeOffReels(pots, coinSymbol ?? '')).some(
			(issue) => issue.path === 'holdAndWin.coins',
		),
);
// …but a config saved before that rule still deals its coins, rather than losing its feature.
if (coinSymbol) {
	const legacy: Case = {
		label: 'holdAndWin · a coin symbol saved off the strips before the rule',
		protocol: 'lines',
		gameType: 'holdAndWin',
		config: pots,
		unused: coinSymbol,
		wire: coinSymbol,
		drive: holdAndWinDrive(),
	};
	const seen = await run(legacy, takeOffReels(pots, coinSymbol));
	check(
		`${legacy.label} · still lands its coins`,
		seen.rounds > 20 && seen.landed.has(coinSymbol),
		`${seen.rounds} rounds`,
	);
}

// A blank `/config` marks unused: the server's respin board falls back to `BLANK`, and so does
// the client's.
{
	const blankOff = takeOffReels(bookWithPots, 'EMPTY');
	const blankCase: Case = {
		label: 'bookOf with the 3 Pots overlay · its blank EMPTY off the strips',
		protocol: 'book',
		config: bookWithPots,
		unused: 'EMPTY',
		wire: 'EMPTY',
		drive: async (make, seen) => playMock(make({}), 25, seen),
	};
	check(
		`${blankCase.label} · /config badges EMPTY unused and saves it`,
		symbolUses(blankOff).EMPTY === 'unused' && !gameConfigErrors(blankOff).length,
		JSON.stringify(gameConfigErrors(blankOff)),
	);
	checkDrawn(blankCase.label, await run(blankCase, blankOff), blankOff);
}

// The real test server, dealing every case from the same contracts.
const tree = mkdtempSync(join(tmpdir(), 'unused-in-game-'));
try {
	const games = Object.fromEntries(
		served.map(({ key, c, config }) => [
			key,
			{ name: key, protocol: c.protocol, cascade: false, grid: contractOf(c, config).grid },
		]),
	);
	writeFileSync(join(tree, 'games.json'), JSON.stringify({ games }));
	const server = await startTestServer(tree, { SEED: 'unused-in-game' });
	try {
		for (const { key, c, config, local, unused } of served) {
			const seen = seenNothing();
			const post: Post = (path, body) =>
				fetch(`${server.origin}/api/${key}${path}`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body),
					// A hung request fails this gate here, and `finally` stops the server.
					signal: AbortSignal.timeout(15_000),
				}).then((res) => res.json() as Promise<Response>);
			await playRounds(post, 40, seen, (i) =>
				c.protocol === 'holdAndWin' && i % 3 === 0 ? 'force:trigger' : null,
			);
			const label = `${c.label} · ${unused ? 'unused' : 'in play'} · the test server`;
			check(`${label} · rounds are played`, seen.rounds > 20, `${seen.rounds} rounds`);
			check(
				`${label} · declares what the contract's mock declares`,
				JSON.stringify(seen.boot?.symbols) === JSON.stringify(local.boot?.symbols),
				`${JSON.stringify(seen.boot?.symbols)} vs ${JSON.stringify(local.boot?.symbols)}`,
			);
			checkDrawn(label, seen, config);
			if (unused) {
				check(
					`${label} · never deals or declares ${c.wire}`,
					!seen.dealt.has(c.wire) && !seen.declared.has(c.wire),
				);
			}
		}
	} finally {
		server.stop();
	}
} finally {
	rmSync(tree, { recursive: true, force: true });
}

// The game's own surfaces that list symbols rather than read a dealt board, and the never-saved
// banner's claim — pinned over whitespace-free source, so a re-wrap never breaks them.
const here = fileURLToPath(new URL('.', import.meta.url));
const source = (rel: string) => readLF(`${here}../${rel}`);
const holds = (text: string, code: string): boolean =>
	text.replace(/\s+/g, '').includes(code.replace(/\s+/g, ''));
const specialBook = source('../lines/src/components/SpecialBook.svelte');
check(
	'the Book-of shuffle cycles only the symbols in play',
	holds(specialBook, 'const inPlay = new Set(getSymbolsInPlay());') &&
		holds(specialBook, '.filter((name) => inPlay.has(name)') &&
		holds(specialBook, '= symbolNames();'),
);
check(
	'the Symbol Debug grid lists what Invisible Symbols lists',
	holds(
		source('../lines/src/components/debug/SymbolDebugTool.svelte'),
		'const symbols = symbolsUsed(getActiveGameConfig());',
	) &&
		holds(
			source('../lines/src/components/debug/SymbolDebugTool.svelte'),
			'<SymbolDebugOverlay {symbols}',
		),
);
check(
	"the respin board's empty cell is the active respin mode's, the server's pick (holdAndWinBlankSymbol for the lone default)",
	holds(
		source('../lines/src/game/stateRespinBoard.svelte.ts'),
		'activeRespinMode()?.blank ?? holdAndWinBlankSymbol(getActiveGameConfig());',
	) &&
		holds(
			source('../../packages/game-config/src/bonusGames.ts'),
			'blank: loneDefault ? holdAndWinBlankSymbol(doc) : respinModeBlank(doc, entry.decl),',
		),
);
// A never-saved project plays the compiled lines config: the banner says whether that is the
// template `/config` shows.
check(
	'the kinds whose template is the built-in lines config',
	JSON.stringify(
		['lines', 'cluster', 'bookOf', 'myCustomKind', 'ways', 'scatter', 'holdAndWin'].map((kind) =>
			templateIsBuiltIn(kind),
		),
	) === JSON.stringify([true, true, true, true, false, false, false]),
);
check(
	'the never-saved banner reads templateIsBuiltIn',
	holds(
		source('src/routes/(app)/config/+page.server.ts'),
		'templateIsBuiltIn: templateIsBuiltIn(gameType),',
	) &&
		holds(
			source('src/routes/(app)/config/+page.svelte'),
			"{data.templateIsBuiltIn ? 'which is this template' : 'not what this page shows'}",
		),
);

console.log(
	failures === 0
		? `\nunused symbols in game: OK (${checks} checks, ${CASES.length} cases)`
		: `\nunused symbols in game: ${failures} of ${checks} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
