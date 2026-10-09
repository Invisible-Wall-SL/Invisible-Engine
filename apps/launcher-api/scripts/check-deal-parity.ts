/**
 * BONUS GAMES Phase 7a — every current game deals as it did, and the coin overlay now composes over a
 * Hold and Win base too (`docs/design/bonus-games.md`, `docs/status/bonus-games.md` Phase 7a).
 *
 * The base engine still comes from the stored kind (the Hold and Win engine for `holdAndWin`, the
 * lines-family mock or the book mock otherwise). What 7a changes is what composes over it: the
 * overlay deals a buy, a Lucky Spin, a random metre and a pattern of dropped coins over a lines or
 * book base, and composes over the Hold and Win engine, starting that engine's own respin modes and
 * an approximate free spins from its pots.
 *
 * Pins:
 *  1. NOTHING MOVES. For every Hold and Win preset and test fixture, every kind's template, every
 *     overlay preset on a lines and a Book-of host, `borut-pots-sample`, the lines game whose overlay
 *     coin is also on a base strip (bonus-games Phase 2's flag), an imported free spins, an imported
 *     bonus, the two-mode hosts, the Hold and Win template saved under the lines kind and a Hold and
 *     Win kind with no rules: the contract the test server is handed (the mock inputs) and a seeded
 *     deal through the mock it builds (`makeMock`) are byte-identical to `main`'s (`MAIN_DIGESTS`,
 *     measured on main 7db698b).
 *  2. ONLY the Hold and Win kind whose overlay drops tokens differs: main dealt it without its pots;
 *     its contract now carries the overlay, last, and its pots are dealt.
 *
 * Re-measure after an intended change: `npx tsx --tsconfig tsconfig.scripts.json
 * scripts/check-deal-parity.ts --print` (from apps/launcher-api).
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import {
	HOLD_AND_WIN_PRESETS,
	HOLD_AND_WIN_TEST_FIXTURES,
	addPotsOverlay,
	importBonus,
	importRespinMode,
	normalizeGameConfigDoc,
	symbolsWithRole,
	type GameConfigDoc,
} from 'game-config';
import { withPotsOverlay } from '../../../scripts/mock-pots-overlay.mjs';
import { createMockRgs as createBookMock } from '../../../scripts/mock-rgs-server-book.mjs';
import { createMockRgs as createHoldAndWinMock } from '../../../scripts/mock-rgs-server-holdandwin.mjs';
import { createMockRgs as createLinesMock } from '../../../scripts/mock-rgs-server.mjs';
import { mockContractOfBundle, type MockContract } from '../src/lib/server/mockContract.ts';
import { protocolFor } from '../src/lib/server/mockProtocol.ts';

const PRINT = process.argv.includes('--print');
/** The label, seed and session the main digests were measured with. */
const SEED = 'deal-by-doc';
let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (!ok) failures += 1;
	console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}`);
	if (!ok) {
		console.log(`        expected ${JSON.stringify(expected)}`);
		console.log(`        actual   ${JSON.stringify(actual)}`);
	}
};

// ─── the doc shapes ───────────────────────────────────────────────────────────────────────────

const clone = <T>(value: T): T => structuredClone(value);
const normalize = (raw: unknown): GameConfigDoc => {
	const doc = normalizeGameConfigDoc(clone(raw));
	if (!doc) throw new Error('a shape did not normalize');
	return doc;
};
const template = (name: string): GameConfigDoc =>
	normalize(
		JSON.parse(
			readFileSync(new URL(`../src/lib/data/gameConfig/${name}.json`, import.meta.url), 'utf8'),
		),
	);
const added = (result: { ok: true; doc: GameConfigDoc } | { ok: false; reason: string }) => {
	if (!result.ok) throw new Error(result.reason);
	return normalize(result.doc);
};
const withOverlay = (doc: GameConfigDoc, preset: 'threePots' | 'potsToFreeSpins' | 'coinsOnly') =>
	added(addPotsOverlay(doc, preset));

const lines = template('lines');
const book = template('lines.bookOfThermopylae');
const classic = template('holdAndWin.classic');

/** `borut-pots-sample`: 3 Pots on a Book-of host, green re-routed to free spins. */
const borut = (() => {
	const doc = clone(withOverlay(book, 'threePots'));
	doc.potsOverlay!.pots = doc.potsOverlay!.pots.map((pot) =>
		pot.id === 'green' ? { ...pot, bonus: { mode: 'freeSpins' } } : pot,
	);
	delete doc.coinOverlay;
	return normalize(doc);
})();

/** The overlay's coin also on a base strip — bonus-games Phase 2's flagged lines game. */
const withBaseCoin = (doc: GameConfigDoc): GameConfigDoc => {
	const out = clone(doc);
	out.paddingReels.basegame[0] = [
		...out.paddingReels.basegame[0],
		{ name: symbolsWithRole(out, 'coin')[0] },
	];
	return normalize(out);
};

/** A Hold and Win game with a second respin mode on its own strip, in the split form. */
const withSecondMode = (doc: GameConfigDoc): GameConfigDoc => {
	const out = clone(doc);
	delete out.holdAndWin;
	delete out.potsOverlay;
	const primary = out.modes!.find((m) => m.id === 'holdAndWin')!;
	out.modes!.push({ ...primary, id: 'holdAndWin_2', gameType: 'respin_2', label: 'Gold' });
	out.paddingReels.respin_2 = clone(out.paddingReels.respin);
	return normalize(out);
};

/** Phase 6's "Add a bonus mode…": the Classic mode added to a 3 Pots host on its green pot. */
const withAddedMode = (host: GameConfigDoc): GameConfigDoc =>
	added(
		importRespinMode(host, classic, {
			hostKind: 'lines',
			project: 'hw-classic-sample',
			mode: 'holdAndWin',
			at: '2026-10-09T00:00:00.000Z',
			routes: [{ kind: 'pot', pot: 'green' }],
		}),
	);

/** The old "Import a bonus…": a Hold and Win project's bonus onto a pots host's pot. */
const withImportedBonus = (host: GameConfigDoc): GameConfigDoc =>
	added(
		importBonus(host, template('holdAndWin.pots'), {
			project: 'hw-3pots-sample',
			mode: 'holdAndWin',
			at: '2026-10-09T00:00:00.000Z',
			pots: ['gold'],
		}),
	);

type Shape = { name: string; kind: string; doc: GameConfigDoc };

/** Every shape a current game has, under the kind it is stored with. */
const UNCHANGED: Shape[] = [
	...Object.entries(HOLD_AND_WIN_PRESETS).map(([id, raw]) => ({
		name: `Hold and Win preset ${id}`,
		kind: 'holdAndWin',
		doc: normalize(raw),
	})),
	...Object.entries(HOLD_AND_WIN_TEST_FIXTURES).map(([id, raw]) => ({
		name: `Hold and Win fixture ${id}`,
		kind: 'holdAndWin',
		doc: normalize(raw),
	})),
	...['holdAndWin.classic', 'holdAndWin.pots', 'holdAndWin.collector'].map((name) => ({
		name: `template ${name}`,
		kind: 'holdAndWin',
		doc: template(name),
	})),
	{ name: 'template lines', kind: 'lines', doc: lines },
	{ name: 'template ways', kind: 'ways', doc: template('ways') },
	{ name: 'template scatter', kind: 'scatter', doc: template('scatter') },
	{ name: 'lines template as cluster', kind: 'cluster', doc: lines },
	{ name: 'Book of Thermopylae (lines kind)', kind: 'lines', doc: book },
	{ name: 'Book of Thermopylae (bookOf kind)', kind: 'bookOf', doc: book },
	...(['threePots', 'potsToFreeSpins', 'coinsOnly'] as const).flatMap((preset) => [
		{ name: `${preset} on lines`, kind: 'lines', doc: withOverlay(lines, preset) },
		{ name: `${preset} on a Book-of host`, kind: 'bookOf', doc: withOverlay(book, preset) },
	]),
	{ name: 'borut-pots-sample', kind: 'bookOf', doc: borut },
	{
		name: 'lines + 3 Pots, its coin also on a base strip (Phase 2 flag)',
		kind: 'lines',
		doc: withBaseCoin(withOverlay(lines, 'threePots')),
	},
	{
		name: 'a Book-of host + 3 Pots with an imported bonus',
		kind: 'bookOf',
		doc: withImportedBonus(withOverlay(book, 'potsToFreeSpins')),
	},
	{ name: 'Hold and Win + a second respin mode', kind: 'holdAndWin', doc: withSecondMode(classic) },
	{
		name: 'lines + 3 Pots + an added mode on green (Phase 6)',
		kind: 'lines',
		doc: withAddedMode(withOverlay(lines, 'threePots')),
	},
	{
		name: 'Book-of + 3 Pots + an added mode on green (Phase 6)',
		kind: 'bookOf',
		doc: withAddedMode(withOverlay(book, 'threePots')),
	},
	{ name: 'the Hold and Win template under the lines kind', kind: 'lines', doc: classic },
	{ name: 'a Hold and Win kind with no respin rules', kind: 'holdAndWin', doc: lines },
];

/** The one shape whose deal moves, and why. */
const CHANGED: (Shape & { why: string })[] = [
	{
		name: 'a Hold and Win kind whose overlay drops tokens beside its base coins',
		kind: 'holdAndWin',
		doc: withOverlay(classic, 'threePots'),
		why: 'main dealt it without its pots; now they are dealt and start its own respin mode',
	},
];

// ─── the deal ─────────────────────────────────────────────────────────────────────────────────

type Mock = { handle: (req: unknown, res: unknown, url: URL) => Promise<void> };
type BookEvent = { event: string; context?: unknown };
type Response = { events?: BookEvent[]; platform?: { gameRound?: { id?: string } } };
type Grid = NonNullable<MockContract['grid']> & {
	holdAndWin?: unknown;
	potsOverlay?: { pots: { id: string }[]; drops: { table: { coin?: boolean }[] } };
};

const contractOf = (shape: Shape): MockContract =>
	mockContractOfBundle(
		protocolFor(shape.kind),
		{ config: shape.doc, symbols: { map: {}, index: {} } } as Parameters<
			typeof mockContractOfBundle
		>[1],
		SEED,
		shape.kind,
	);

/** The host with its overlay, or — as the test server does when the overlay cannot stand up — the
 *  plain host. */
const overlaid = (
	createHost: (opts: Record<string, unknown>) => unknown,
	grid: Grid | undefined,
	opts: Record<string, unknown>,
): Mock => {
	if (!grid?.potsOverlay) return createHost(opts) as Mock;
	try {
		return withPotsOverlay(createHost, grid.potsOverlay)({ ...opts, allowForce: true }) as Mock;
	} catch {
		return createHost(opts) as Mock;
	}
};

/** The mock the test server builds for a contract (`makeMock` in services/test-server/server.mjs). */
const mockFor = (contract: MockContract, extra: Record<string, unknown> = {}): Mock => {
	const grid = contract.grid as Grid | undefined;
	const common = { label: SEED, seed: SEED, quiet: true, ...extra };
	if (contract.protocol === 'lines' && grid?.holdAndWin)
		return overlaid(createHoldAndWinMock, grid, { ...common, ...grid });
	if (contract.protocol === 'book') {
		const opts = { ...common, symbolPaytable: grid?.symbolPaytable, symbols: grid?.symbols };
		return overlaid(createBookMock, grid, opts);
	}
	const opts = {
		...common,
		winModel: contract.protocol === 'lines' ? 'lines' : contract.protocol,
		cascade: false,
		...grid,
	};
	return overlaid(createLinesMock, grid, opts);
};

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
 * Play `contexts.length` rounds the way the client does (`config`, then bet + play, `play` while a
 * feature runs, `collect` when the round is left open) and return every event dealt, round ids out.
 */
const play = async (mock: Mock, contexts: (string | null)[]): Promise<BookEvent[]> => {
	const { post, close } = await boot(mock);
	// The book mock logs every request; this gate reads only what it deals.
	const log = console.log;
	console.log = (...args: unknown[]) => {
		if (!String(args[0]).startsWith('[deal-by-doc]')) log(...args);
	};
	const dealt: BookEvent[] = [];
	const keep = (resp: Response) => dealt.push(...(resp.events ?? []));
	try {
		const sid = SEED;
		const first = await post(`/rgs/engine?sid=${sid}&seq=0`, [{ action: 'config' }]);
		keep(first);
		const config = first.events?.find((e) => e.event === 'config')?.context as
			{ betOptions?: unknown[]; paylines?: unknown[]; availablePayLines?: unknown[] } | undefined;
		const lineCount = (config?.paylines ?? config?.availablePayLines ?? []).length;
		const bet = [config?.betOptions?.length ? 0 : lineCount, 1];
		for (const context of contexts) {
			let seq = 0;
			let resp = await post(`/rgs/engine?sid=${sid}&seq=${seq}`, [
				{ action: 'bet', context: bet },
				{ action: 'play', context },
			]);
			seq += 2;
			keep(resp);
			const gid = resp.platform?.gameRound?.id;
			for (let guard = 0; gid && !has(resp, 'gameEnd') && guard < 300; guard++) {
				resp = await post(`/rgs/engine?sid=${sid}&seq=${seq}&gid=${gid}`, [{ action: 'play' }]);
				seq += 1;
				keep(resp);
			}
			if (gid && !has(resp, 'gameRoundOver')) {
				resp = await post(`/rgs/engine?sid=${sid}&seq=${seq}&gid=${gid}`, [{ action: 'collect' }]);
				seq += 1;
				keep(resp);
			}
		}
	} finally {
		console.log = log;
		await close();
	}
	return dealt;
};

/** Natural rounds, then each feature a contract can force: the Hold and Win trigger, each pot,
 *  the dropped coins and the host's own free spins. */
const deal = async (contract: MockContract): Promise<BookEvent[]> => {
	const grid = contract.grid as Grid | undefined;
	const natural = Array<null>(60).fill(null);
	const overlay = grid?.potsOverlay;
	if (contract.protocol === 'lines' && grid?.holdAndWin) {
		const pots = overlay?.pots.map((pot) => `force:pot:${pot.id}`) ?? [];
		return play(mockFor(contract), [...natural, ...Array(12).fill('force:trigger'), ...pots]);
	}
	const forces = overlay
		? [
				...overlay.pots.map((pot) => `force:pot:${pot.id}`),
				...(overlay.drops.table.some((entry) => entry.coin) ? ['force:overlay:coins:6'] : []),
			]
		: [];
	return [
		...(await play(mockFor(contract), [...natural, ...forces])),
		...(await play(mockFor(contract, { forceTrigger: true }), Array(8).fill(null))),
	];
};

const digest = (value: unknown) =>
	createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

/** `[contract, deal]` digests per shape, measured on main 7db698b with the kind passed. */
const MAIN_DIGESTS: Record<string, [string, string]> = {
	'Hold and Win preset pots': ['41178c048c1d8387', '8cfcf32ecd326dc2'],
	'Hold and Win preset classic': ['a03e41fe3786e6e0', '3e4b3e9beb4e61ee'],
	'Hold and Win preset collector': ['b697bb43a34b1307', 'b6a14cb95ab9b836'],
	'Hold and Win fixture pots-progressive': ['5847b8d597469671', '4f443d4fe8774dcc'],
	'Hold and Win fixture pots-extra': ['6d9973a07847b611', 'ae5b621cec3cebcb'],
	'Hold and Win fixture pots-expansion-fullrow': ['e9a21a15c85fced8', '54e3052d8463951e'],
	'Hold and Win fixture pots-expansion-unlock': ['3c0f237e3c08c1ca', 'b7d43445700b8fca'],
	'Hold and Win fixture pots-expansion-count': ['cacb0e0178f372fa', 'b45fe50de77767fa'],
	'template holdAndWin.classic': ['a03e41fe3786e6e0', '3e4b3e9beb4e61ee'],
	'template holdAndWin.pots': ['41178c048c1d8387', '8cfcf32ecd326dc2'],
	'template holdAndWin.collector': ['b697bb43a34b1307', 'b6a14cb95ab9b836'],
	'template lines': ['153887dad41c3a04', '4aa65853be9a1129'],
	'template ways': ['b9c09f1cbb3e4a17', '6575b6ce46e61b2b'],
	'template scatter': ['6a679c972e88f205', '887a00c6b877b80c'],
	'lines template as cluster': ['bce869646936698c', '87ad1ff102d6ff07'],
	'Book of Thermopylae (lines kind)': ['8339eb59c2486df2', '4ef2e3d57eea7709'],
	'Book of Thermopylae (bookOf kind)': ['e886c9e924a51135', '46a12527c602c538'],
	'threePots on lines': ['d5a169516733fb12', '57d375c10a224dbb'],
	'threePots on a Book-of host': ['20c60a22624c8f57', 'e187bb6cf99eb3ce'],
	'potsToFreeSpins on lines': ['93feccf3255eba22', '92a81bd63a3afee9'],
	'potsToFreeSpins on a Book-of host': ['7e46b09f2c3b0bef', 'e4f7df214085b8e7'],
	'coinsOnly on lines': ['a3ba7058759d510a', '44a5e16f70157d84'],
	'coinsOnly on a Book-of host': ['57585ca44c2c1aad', 'bb3d9ce400ef087a'],
	'borut-pots-sample': ['4735e08964e59488', '447d4e769be59ff1'],
	'lines + 3 Pots, its coin also on a base strip (Phase 2 flag)': [
		'7ba2390fbf9b3ddd',
		'efc3612bb99d7179',
	],
	'a Book-of host + 3 Pots with an imported bonus': ['0d55a14fad021e13', 'f220368672a57c52'],
	'Hold and Win + a second respin mode': ['36a9bb50aae6177a', '512e432ffe8aa973'],
	'lines + 3 Pots + an added mode on green (Phase 6)': ['41f6525863d163ee', 'ff3c8f0b51592273'],
	'Book-of + 3 Pots + an added mode on green (Phase 6)': ['6641de64966f450c', '8e6b8e1b9a97f3d7'],
	'the Hold and Win template under the lines kind': ['f5f214f47e71833f', '03abb1f903deed50'],
	'a Hold and Win kind whose overlay drops tokens beside its base coins': [
		'a03e41fe3786e6e0',
		'3e4b3e9beb4e61ee',
	],
	'a Hold and Win kind with no respin rules': ['2abc85ce8b18a1ba', '68d5fc616621bf8a'],
};

console.log('\n1. nothing moves: every current shape deals as on main');
const measured: Record<string, [string, string]> = {};
for (const shape of [...UNCHANGED, ...CHANGED]) {
	const contract = contractOf(shape);
	measured[shape.name] = [digest(contract), digest(await deal(contract))];
}
for (const shape of UNCHANGED) {
	check(`${shape.name} (${shape.kind})`, measured[shape.name], MAIN_DIGESTS[shape.name]);
}

console.log('\n2. only the Hold and Win kind whose overlay drops tokens differs');
for (const shape of CHANGED) {
	const main = MAIN_DIGESTS[shape.name];
	check(
		`${shape.name} (${shape.kind}) — ${shape.why}`,
		[measured[shape.name][0] !== main?.[0], measured[shape.name][1] !== main?.[1]],
		[true, true],
	);
	const grid = contractOf(shape).grid as Grid | undefined;
	check(
		`${shape.name}: the overlay rides last on its Hold and Win contract`,
		[Boolean(grid?.holdAndWin), Object.keys(grid ?? {}).at(-1), grid?.potsOverlay?.pots.length],
		[true, 'potsOverlay', 3],
	);
}

if (PRINT) {
	console.log('\nconst MAIN_DIGESTS: Record<string, [string, string]> = {');
	for (const [name, pair] of Object.entries(measured))
		console.log(`\t${JSON.stringify(name)}: ${JSON.stringify(pair)},`);
	console.log('};');
}

if (failures) {
	console.log(`\n${failures} check(s) FAILED.`);
	process.exit(1);
}
console.log('\nAll deal-parity checks passed.');
