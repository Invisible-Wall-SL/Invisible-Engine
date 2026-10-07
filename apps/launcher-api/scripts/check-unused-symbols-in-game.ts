/**
 * A symbol Invisible Game Config marks UNUSED never reaches the game — pinned for the mock RGS that
 * deals every game we host, kind by kind, from the contract the test server is handed.
 *
 * For each kind's mock — the lines mock (lines, ways, cluster, scatter), the book mock (bookOf) and
 * the Hold and Win mock — a project whose `/config` takes a symbol off every strip gets a contract
 * (`mockContractOfBundle`, the derivation a publish freezes and the test server reads) whose mock
 * never deals that symbol, never picks it as the Book's expanding special, and never declares it in
 * its boot `config` (the client builds its spinning reels from the declared symbols). Base spins,
 * forced features, forced wins, the forced big win and, with stacked pictures on, the stacked test
 * deal are all played. Every case is shown non-vacuous: with the symbol left in play, the same deal
 * shows it.
 *
 * The client's own surfaces: the spinning reels, the paytable and the info page read the in-play gate
 * (`getSymbolsInPlay` / `paddingReels`), the initial board's fallback is pinned by
 * `engine-game`'s `paddingReels.fixture.ts`, and the Book-of shuffle and the Symbol Debug grid are
 * pinned at the end of this file.
 *
 * Run:  pnpm --filter launcher-api check:unused-symbols-in-game
 */

import { createServer, request } from 'node:http';
import { fileURLToPath } from 'node:url';
import {
	HOLD_AND_WIN_PRESETS,
	normalizeGameConfigDoc,
	symbolUses,
	type GameConfigDoc,
} from 'game-config';
import { createMockRgs as createBookMock } from '../../../scripts/mock-rgs-server-book.mjs';
import { createMockRgs as createHoldAndWinMock } from '../../../scripts/mock-rgs-server-holdandwin.mjs';
import { createMockRgs as createLinesMock } from '../../../scripts/mock-rgs-server.mjs';
import { readLF } from '../../../scripts/lib/read-lf.mjs';
import { gameConfigDefaultFor } from '../src/lib/server/gameConfigDefaults.ts';
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

const boot = async (mock: Mock) => {
	const server = createServer((req, res) =>
		mock.handle(req, res, new URL(req.url ?? '/', 'http://127.0.0.1')),
	);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	const port = typeof address === 'object' && address ? address.port : 0;
	const post = (path: string, body: unknown): Promise<Response> =>
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

/** What a run saw: the names the mock DECLARED (its `config` and `spinStart` events — the client
 *  builds its spinning reels from them), the ones it DEALT or picked (every other event), and how
 *  many rounds reached their end. */
type Seen = { declared: Set<string>; dealt: Set<string>; rounds: number };

const DECLARING = new Set(['config', 'spinStart']);

const record = (resp: Response, seen: Seen): void => {
	for (const e of resp.events ?? []) {
		namesIn(e.context, DECLARING.has(e.event) ? seen.declared : seen.dealt);
	}
	if (has(resp, 'gameEnd')) seen.rounds += 1;
};

/**
 * Play `rounds` rounds of a mock the way the client does — `config` once, then bet + play, `play`
 * while a feature runs, `collect` when the round is left open. The stake is the client's: an option
 * index on a game that declares a bet table, else its line count. `play(i)` is round i's `play`
 * context: a force spec on the mocks that take one.
 */
const playRounds = async (
	mock: Mock,
	rounds: number,
	seen: Seen,
	play: (i: number) => string | null = () => null,
): Promise<void> => {
	const { post, close } = await boot(mock);
	try {
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
	} finally {
		await close();
	}
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

const templateOf = (kind: string): GameConfigDoc => {
	const template = gameConfigDefaultFor(kind);
	if (!template) throw new Error(`no template for ${kind}`);
	return saved(template);
};

type Case = {
	label: string;
	protocol: MockProtocol;
	/** The config with the symbol in play, and the symbol `/config` is about to mark unused. */
	config: GameConfigDoc;
	unused: string;
	/** Its name on the wire. */
	wire: string;
	stacked?: boolean;
	/** What each case's mock plays beyond plain base spins. */
	drive: (make: (extra: Record<string, unknown>) => Mock, seen: Seen) => Promise<void>;
};

const contractOf = (c: Case, config: GameConfigDoc) =>
	mockContractOfBundle(
		c.protocol,
		{ config, symbols: { stacked: Boolean(c.stacked), map: {} } } as unknown as Pick<
			RuntimeBundle,
			'config' | 'symbols'
		>,
		'unused-in-game',
	);

/** The mock the test server builds for a contract (`makeMock` in services/test-server/server.mjs). */
const mockFor = (c: Case, config: GameConfigDoc) => {
	const { grid } = contractOf(c, config);
	return (extra: Record<string, unknown>): Mock => {
		const common = { label: 'unused-in-game', seed: 'unused-in-game', quiet: true, ...extra };
		if (c.protocol === 'book') {
			return createBookMock({
				...common,
				autoCollect: true,
				symbolPaytable: grid?.symbolPaytable,
				symbols: grid?.symbols,
			});
		}
		if (c.protocol === 'holdAndWin') return createHoldAndWinMock({ ...common, ...grid });
		return createLinesMock({
			...common,
			winModel: c.protocol === 'lines' ? 'lines' : c.protocol,
			cascade: false,
			...grid,
		});
	};
};

const linesDrive = async (make: (extra: Record<string, unknown>) => Mock, seen: Seen) => {
	await playRounds(make({}), 150, seen);
	await playRounds(make({ forceTrigger: true }), 20, seen);
	await playRounds(make({ winX: [5, 20, 60] }), 6, seen);
};

const bookDrive = async (make: (extra: Record<string, unknown>) => Mock, seen: Seen) => {
	await playRounds(make({}), 150, seen);
	await playRounds(make({ forceTrigger: true }), 25, seen);
	await playRounds(make({ bigWin: true }), 2, seen);
	await playRounds(make({ winX: [5, 20, 60] }), 6, seen);
};

/** Natural rounds with a forced feature every third; then `force` — a spec the unused twin refuses,
 *  having no such special, so only its natural deal is played. */
const holdAndWinDrive =
	(force: string) => async (make: (extra: Record<string, unknown>) => Mock, seen: Seen) => {
		await playRounds(make({}), 60, seen, (i) => (i % 3 === 0 ? 'force:trigger' : null));
		await playRounds(make({}), 6, seen, () => force);
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
		label: 'holdAndWin · MULTI (a special)',
		protocol: 'holdAndWin',
		config: pots,
		unused: 'MULTI',
		wire: 'MULTI',
		drive: holdAndWinDrive('force:special:multiplier'),
	},
	{
		label: 'holdAndWin · L1 (a line symbol)',
		protocol: 'holdAndWin',
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
	const seen: Seen = { declared: new Set(), dealt: new Set(), rounds: 0 };
	await quiet(() => c.drive(mockFor(c, config), seen));
	return seen;
};

for (const c of CASES) {
	const unusedConfig = takeOffReels(c.config, c.unused);
	check(
		`${c.label} · /config badges ${c.unused} in play, then unused once it is off the strips`,
		symbolUses(c.config)[c.unused] === 'inPlay' && symbolUses(unusedConfig)[c.unused] === 'unused',
	);
	const inPlay = await run(c, c.config);
	check(`${c.label} · in play, rounds are played`, inPlay.rounds > 20, `${inPlay.rounds} rounds`);
	check(
		`${c.label} · in play, the deal shows ${c.wire} (the case is not vacuous)`,
		inPlay.dealt.has(c.wire),
	);
	const unused = await run(c, unusedConfig);
	check(`${c.label} · unused, rounds are played`, unused.rounds > 20, `${unused.rounds} rounds`);
	check(`${c.label} · unused, ${c.wire} is never dealt or picked`, !unused.dealt.has(c.wire));
	check(`${c.label} · unused, ${c.wire} is never declared`, !unused.declared.has(c.wire));
}

// The game's own surfaces that list symbols rather than read a dealt board.
const here = fileURLToPath(new URL('.', import.meta.url));
const appSource = (rel: string) => readLF(`${here}../../lines/src/${rel}`);
check(
	'the Book-of shuffle cycles only the symbols in play',
	/const inPlay = new Set\(getSymbolsInPlay\(\)\);[\s\S]{0,200}\.filter\(\(name\) =>\s*inPlay\.has\(name\)/.test(
		appSource('components/SpecialBook.svelte'),
	),
);
check(
	'the Symbol Debug grid lists what Invisible Symbols lists',
	/const symbols = symbolsUsed\(getActiveGameConfig\(\)\);/.test(
		appSource('components/debug/SymbolDebugTool.svelte'),
	),
);

console.log(
	failures === 0
		? `\nunused symbols in game: OK (${checks} checks, ${CASES.length} kinds × cases)`
		: `\nunused symbols in game: ${failures} of ${checks} FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
