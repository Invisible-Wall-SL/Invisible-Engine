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
 *  1. NOTHING MOVES. 38 shapes deal byte-identically to `main` (`MAIN_DIGESTS`, measured on main
 *     7db698b through main's own `validGrid` + `makeMock`): every Hold and Win preset, test fixture
 *     and template; every kind's template; every overlay preset on a lines and a Book-of host;
 *     `borut-pots-sample`; the lines game whose overlay coin is also on a base strip (bonus-games
 *     Phase 2's flag); an imported bonus; the two-mode hosts; and the sweep of a respin block on a
 *     kind that is not Hold and Win with no route main ignored. Each one's contract, and a seeded
 *     deal through the REAL test-server factory (`services/test-server/makeMock.mjs`): the authoring
 *     twin's natural, forced and feature rounds, the players' mock, and bought rounds on every buy.
 *  2. ONLY a doc with something main never dealt differs, its new deal pinned (`BRANCH_DIGESTS`)
 *     and that thing shown to play: a Hold and Win kind whose overlay drops tokens (its pots), and a
 *     respin block on another kind with a buy, Lucky Spin or random-metre route (the route).
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
	isHoldAndWinSymbol,
	normalizeGameConfigDoc,
	potsOverlayOf,
	primaryHoldAndWin,
	symbolsWithRole,
	type GameConfigDoc,
	type RawGameConfig,
} from 'game-config';
import { makeMock, validGrid } from '../../../services/test-server/makeMock.mjs';
import { mockContractOfBundle, type MockContract } from '../src/lib/server/mockContract.ts';
import { protocolFor } from '../src/lib/server/mockProtocol.ts';
import { withoutMirror } from './lib/withoutMirror.ts';

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

/** `borut-pots-sample`: 3 Pots on a Book-of host, green re-routed to free spins — stored as the
 *  legacy `holdAndWin` / `potsOverlay` pair, as the sample was. */
const borut = (() => {
	const { coinOverlay, ...doc } = withOverlay(book, 'threePots');
	const pots = potsOverlayOf({ coinOverlay })!;
	const raw: RawGameConfig = {
		...doc,
		holdAndWin: primaryHoldAndWin({ coinOverlay, modes: doc.modes }),
		potsOverlay: {
			...pots,
			pots: pots.pots.map((pot) =>
				pot.id === 'green' ? { ...pot, bonus: { mode: 'freeSpins' } } : pot,
			),
		},
	};
	return normalize(raw);
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

/**
 * The Hold and Win template's respin rules on a kind that is NOT Hold and Win (the sweep of review
 * item 1): with or without its symbols on the base strips, with only the coin overlay routes named
 * (or no coin overlay at all), and with or without pots dropping (to free spins).
 */
const respinShape = (o: {
	base: boolean;
	routes: string[];
	coinOverlay?: boolean;
	drops?: boolean;
}): GameConfigDoc => {
	const raw = clone(o.drops ? withOverlay(classic, 'potsToFreeSpins') : classic);
	if (!o.base) {
		raw.paddingReels.basegame = raw.paddingReels.basegame.map((reel) =>
			reel.filter((cell) => !isHoldAndWinSymbol(raw.symbols[cell.name])),
		);
	}
	if (o.coinOverlay === false) delete raw.coinOverlay;
	else if (raw.coinOverlay) {
		const routes = Object.entries(raw.coinOverlay.trigger ?? {}).filter(([cause]) =>
			o.routes.includes(cause),
		);
		if (routes.length) raw.coinOverlay.trigger = Object.fromEntries(routes);
		else delete raw.coinOverlay.trigger;
	}
	return normalize(raw);
};

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
	// The sweep: a respin block on another kind, with no route main ignored.
	{
		name: 'lines kind, respin rules: no route, nothing drops, no base symbol',
		kind: 'lines',
		doc: respinShape({ base: false, routes: [] }),
	},
	{
		name: 'lines kind, respin rules: only a coin count, nothing drops, no base symbol',
		kind: 'lines',
		doc: respinShape({ base: false, routes: ['count'] }),
	},
	{
		name: 'lines kind, respin rules and base symbols, no coin overlay',
		kind: 'lines',
		doc: respinShape({ base: true, routes: [], coinOverlay: false }),
	},
	{
		name: 'Book-of kind, respin rules: only a buy, nothing drops, no base symbol',
		kind: 'bookOf',
		doc: respinShape({ base: false, routes: ['buy'] }),
	},
	{
		name: 'lines kind, pots to free spins, respin rules with only a count, no base symbol',
		kind: 'lines',
		doc: respinShape({ base: false, routes: ['count'], drops: true }),
	},
	{
		name: 'Book-of kind, pots to free spins, respin rules and base symbols',
		kind: 'bookOf',
		doc: respinShape({ base: true, routes: ['count', 'buy', 'randomMetre'], drops: true }),
	},
	{
		name: 'ways kind, respin rules: no route, nothing drops, no base symbol',
		kind: 'ways',
		doc: respinShape({ base: false, routes: [] }),
	},
];

/**
 * 3 Pots over Classic exactly as main's add-on built it. Since bonus-games Phase 8b the add-on also
 * brings the payer and collector its red and blue pots start (their rules, symbols and respin cells);
 * they are taken back out here and the overlay keeps Classic's style, so this shape keeps measuring
 * the doc main dealt: {@link MAIN_THREE_POTS_ON_CLASSIC} pins it byte for byte.
 */
function threePotsOnClassicAsMain(): GameConfigDoc {
	const doc = clone(withOverlay(classic, 'threePots'));
	const brought = ['payer', 'collector'] as const;
	const names = brought.flatMap((kind) =>
		Object.keys(doc.symbols).filter(
			(n) =>
				!classic.symbols[n] &&
				doc.symbols[n].special_properties?.includes(kind === 'payer' ? 'payer' : 'collector'),
		),
	);
	const rules = doc.modes!.find((m) => m.id === 'holdAndWin')!.holdAndWin!;
	for (const kind of brought) delete rules.specials[kind];
	rules.applyOrder = rules.applyOrder.filter(
		(kind) => !(brought as readonly string[]).includes(kind),
	);
	for (const name of names) delete doc.symbols[name];
	doc.paddingReels.respin = doc.paddingReels.respin.map((strip) =>
		strip.filter((cell) => !names.includes(cell.name)),
	);
	doc.coinOverlay!.style = classic.coinOverlay!.style;
	return normalize(doc);
}

/** The shapes whose deal moves, why, and how the bonus main never dealt now starts: `force` is a
 *  forced play, `buy` the bet mode a bought round sells, `cause` the `spinTrigger` cause it shows. */
type Changed = Shape & { why: string; force?: string; buy?: boolean; cause: string };
const CHANGED: Changed[] = [
	{
		name: 'a Hold and Win kind whose overlay drops tokens beside its base coins',
		kind: 'holdAndWin',
		doc: threePotsOnClassicAsMain(),
		why: 'main dealt it without its pots; now they are dealt and start its own respin mode',
		force: 'force:pot:red',
		cause: 'meter',
	},
	{
		name: 'lines kind, respin rules with buy / random-metre routes, nothing drops, no base symbol',
		kind: 'lines',
		doc: respinShape({ base: false, routes: ['count', 'buy', 'randomMetre'] }),
		why: 'routes main ignored (buy / random metre): the coin overlay now deals them',
		buy: true,
		cause: 'buy',
	},
	{
		name: 'lines kind, pots to free spins and a buy route to the respin mode, no base symbol',
		kind: 'lines',
		doc: respinShape({ base: false, routes: ['buy'], drops: true }),
		why: 'a route main ignored (buy): the coin overlay now deals it',
		buy: true,
		cause: 'buy',
	},
	{
		name: 'Book-of kind, respin rules with a random metre, nothing drops, no base symbol',
		kind: 'bookOf',
		doc: respinShape({ base: false, routes: ['randomMetre'] }),
		why: 'a route main ignored (random metre): the coin overlay now deals it',
		force: 'force:trigger:randomMetre',
		cause: 'randomMetre',
	},
	{
		name: 'ways kind, respin rules with a random metre, nothing drops, no base symbol',
		kind: 'ways',
		doc: respinShape({ base: false, routes: ['randomMetre'] }),
		why: 'a route main ignored (random metre): the coin overlay now deals it',
		force: 'force:trigger:randomMetre',
		cause: 'randomMetre',
	},
];

// ─── the deal ─────────────────────────────────────────────────────────────────────────────────

type Mock = { handle: (req: unknown, res: unknown, url: URL) => Promise<void> };
type BookEvent = { event: string; context?: unknown };
type Response = { events?: BookEvent[]; platform?: { gameRound?: { id?: string } } };
type Grid = NonNullable<MockContract['grid']> & {
	betModes?: { mode: string; kind: string }[];
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

/**
 * The mock the Invisible Test Server builds for a contract: its own `validGrid` and `makeMock`
 * (`services/test-server/makeMock.mjs`), as a runtime game's authoring twin (forcing on, its bet
 * table sold) or its players' mock (forcing off). Seeded through `SEED`, as the server's mocks read
 * it; `forceTrigger` through `FORCE_TRIGGER`.
 */
const mockFor = (contract: MockContract, { forceTrigger = false, players = false } = {}): Mock => {
	process.env.SEED = SEED;
	if (forceTrigger) process.env.FORCE_TRIGGER = '1';
	try {
		return makeMock(
			contract.protocol,
			SEED,
			validGrid(contract.grid),
			SEED,
			contract.cascade,
			true,
			!players,
			false,
		) as Mock;
	} finally {
		delete process.env.FORCE_TRIGGER;
	}
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
const play = async (mock: Mock, contexts: (string | null)[], option = 0): Promise<BookEvent[]> => {
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
		const bet = [config?.betOptions?.length ? option : lineCount, 1];
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
	const pots = overlay?.pots.map((pot) => `force:pot:${pot.id}`) ?? [];
	const players = await play(mockFor(contract, { players: true }), Array<null>(20).fill(null));
	// Three bought rounds on each option the game sells beyond its base.
	const buys = (grid?.betModes ?? []).flatMap((mode, option) =>
		mode.kind === 'buy' ? [option] : [],
	);
	for (const option of buys)
		players.push(...(await play(mockFor(contract), [null, null, null], option)));
	if (contract.protocol === 'lines' && grid?.holdAndWin) {
		return [
			...(await play(mockFor(contract), [...natural, ...Array(12).fill('force:trigger'), ...pots])),
			...players,
		];
	}
	const coins = overlay?.drops.table.some((entry) => entry.coin) ? ['force:overlay:coins:6'] : [];
	return [
		...(await play(mockFor(contract), [...natural, ...pots, ...coins])),
		...(await play(mockFor(contract, { forceTrigger: true }), Array(8).fill(null))),
		...players,
	];
};

const digest = (value: unknown) =>
	createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

/** `normalize(addPotsOverlay(classic, 'threePots'))` as main 4067dfb built it, by this `digest`
 *  without main's legacy mirror pair (re-measured so on main 65d47c1, bonus-games Phase 7b; main
 *  9018d9c, whose code is the same, reproduces it). */
const MAIN_THREE_POTS_ON_CLASSIC = 'ac4aaafa30d564c1';
check(
	'3 Pots over Classic, rebuilt as main built it, is byte-identical to main’s doc',
	digest(withoutMirror(threePotsOnClassicAsMain())),
	MAIN_THREE_POTS_ON_CLASSIC,
);

/** `[contract, deal]` digests per shape, measured on main 7db698b through its own `makeMock`. */
const MAIN_DIGESTS: Record<string, [string, string]> = {
	'Hold and Win preset pots': ['41178c048c1d8387', 'fdc45952df25abd5'],
	'Hold and Win preset classic': ['a03e41fe3786e6e0', '2bde8a2f8fbf4711'],
	'Hold and Win preset collector': ['b697bb43a34b1307', '4145bef3e7c14bf5'],
	'Hold and Win fixture pots-progressive': ['5847b8d597469671', 'eb4f17ddffa4f204'],
	'Hold and Win fixture pots-extra': ['6d9973a07847b611', 'e7a219e4e1a74b35'],
	'Hold and Win fixture pots-expansion-fullrow': ['e9a21a15c85fced8', 'a4446f509e580816'],
	'Hold and Win fixture pots-expansion-unlock': ['3c0f237e3c08c1ca', '7daf49485fc25333'],
	'Hold and Win fixture pots-expansion-count': ['cacb0e0178f372fa', '26fdc56c15affafc'],
	'template holdAndWin.classic': ['a03e41fe3786e6e0', '2bde8a2f8fbf4711'],
	'template holdAndWin.pots': ['41178c048c1d8387', 'fdc45952df25abd5'],
	'template holdAndWin.collector': ['b697bb43a34b1307', '4145bef3e7c14bf5'],
	'template lines': ['153887dad41c3a04', '2adb4f4b5a54cca4'],
	'template ways': ['b9c09f1cbb3e4a17', 'c135dd5160087790'],
	'template scatter': ['6a679c972e88f205', '356c5ce60ba7b1bb'],
	'lines template as cluster': ['bce869646936698c', '0fa074731b515b7d'],
	'Book of Thermopylae (lines kind)': ['8339eb59c2486df2', 'a9aa0acaf0399333'],
	'Book of Thermopylae (bookOf kind)': ['e886c9e924a51135', 'a47755bab636c9d1'],
	'threePots on lines': ['d5a169516733fb12', 'cc9e7a09424d4ed2'],
	'threePots on a Book-of host': ['20c60a22624c8f57', 'b91c64fb60252009'],
	'potsToFreeSpins on lines': ['93feccf3255eba22', '1802ae57c0b894f5'],
	'potsToFreeSpins on a Book-of host': ['7e46b09f2c3b0bef', '216bff3f25fd92e7'],
	'coinsOnly on lines': ['a3ba7058759d510a', 'ed258bbce7c4f2a2'],
	'coinsOnly on a Book-of host': ['57585ca44c2c1aad', 'a9c14568b53b24ca'],
	'borut-pots-sample': ['4735e08964e59488', 'c6b93677eb871428'],
	'lines + 3 Pots, its coin also on a base strip (Phase 2 flag)': [
		'7ba2390fbf9b3ddd',
		'4c5503f8599a831d',
	],
	'a Book-of host + 3 Pots with an imported bonus': ['0d55a14fad021e13', '802512184561452d'],
	'Hold and Win + a second respin mode': ['36a9bb50aae6177a', 'd022b614a4f75a7b'],
	'lines + 3 Pots + an added mode on green (Phase 6)': ['41f6525863d163ee', 'a72c6632677f0179'],
	'Book-of + 3 Pots + an added mode on green (Phase 6)': ['6641de64966f450c', '3a9c60b020663244'],
	'the Hold and Win template under the lines kind': ['f5f214f47e71833f', '7bcb482e8fdef714'],
	'a Hold and Win kind with no respin rules': ['2abc85ce8b18a1ba', 'ae4031e0e2cd140d'],
	'lines kind, respin rules: no route, nothing drops, no base symbol': [
		'f5f214f47e71833f',
		'7bcb482e8fdef714',
	],
	'lines kind, respin rules: only a coin count, nothing drops, no base symbol': [
		'f5f214f47e71833f',
		'7bcb482e8fdef714',
	],
	'lines kind, respin rules and base symbols, no coin overlay': [
		'f5f214f47e71833f',
		'7bcb482e8fdef714',
	],
	'Book-of kind, respin rules: only a buy, nothing drops, no base symbol': [
		'f454887ab73a8134',
		'c471f4ff54813653',
	],
	'lines kind, pots to free spins, respin rules with only a count, no base symbol': [
		'a3707be06d3fadce',
		'2bd5bc93d2347a91',
	],
	'Book-of kind, pots to free spins, respin rules and base symbols': [
		'61d0588065e109a4',
		'9302efa668d6d06e',
	],
	'ways kind, respin rules: no route, nothing drops, no base symbol': [
		'c9bc43692e9216c7',
		'a6638cc2a6631c17',
	],
	'a Hold and Win kind whose overlay drops tokens beside its base coins': [
		'a03e41fe3786e6e0',
		'2bde8a2f8fbf4711',
	],
	'lines kind, respin rules with buy / random-metre routes, nothing drops, no base symbol': [
		'f5f214f47e71833f',
		'7bcb482e8fdef714',
	],
	'lines kind, pots to free spins and a buy route to the respin mode, no base symbol': [
		'51b9947061227502',
		'2bd5bc93d2347a91',
	],
	'Book-of kind, respin rules with a random metre, nothing drops, no base symbol': [
		'f454887ab73a8134',
		'c471f4ff54813653',
	],
	'ways kind, respin rules with a random metre, nothing drops, no base symbol': [
		'c9bc43692e9216c7',
		'a6638cc2a6631c17',
	],
};

/** `[contract, deal]` digests of the shapes that change, as this branch deals them. */
const BRANCH_DIGESTS: Record<string, [string, string]> = {
	'a Hold and Win kind whose overlay drops tokens beside its base coins': [
		'541028a262beefcd',
		'48b141a87892bab3',
	],
	'lines kind, respin rules with buy / random-metre routes, nothing drops, no base symbol': [
		'57252839791dfba1',
		'64e9243f0838f339',
	],
	'lines kind, pots to free spins and a buy route to the respin mode, no base symbol': [
		'51b9947061227502',
		'5a482f67b1921b9e',
	],
	'Book-of kind, respin rules with a random metre, nothing drops, no base symbol': [
		'973cf00414131b77',
		'6485d3d759433429',
	],
	'ways kind, respin rules with a random metre, nothing drops, no base symbol': [
		'578a6640fd9663f0',
		'ee1d9bb582fce6dc',
	],
};

console.log('\n1. nothing moves: every current shape deals as on main');
const measured: Record<string, [string, string]> = {};
const dealt: Record<string, BookEvent[]> = {};
for (const shape of [...UNCHANGED, ...CHANGED]) {
	const contract = contractOf(shape);
	dealt[shape.name] = await deal(contract);
	measured[shape.name] = [digest(contract), digest(dealt[shape.name])];
}
for (const shape of UNCHANGED) {
	check(`${shape.name} (${shape.kind})`, measured[shape.name], MAIN_DIGESTS[shape.name]);
}

console.log('\n2. only a doc with something main never dealt differs, and that now plays');
for (const shape of CHANGED) {
	const main = MAIN_DIGESTS[shape.name];
	check(
		`${shape.name} (${shape.kind}) — ${shape.why}`,
		measured[shape.name][0] !== main?.[0] || measured[shape.name][1] !== main?.[1],
		true,
	);
	check(`${shape.name}: its new deal, pinned`, measured[shape.name], BRANCH_DIGESTS[shape.name]);
	const contract = contractOf(shape);
	const betModes = (contract.grid as { betModes?: { mode: string; kind: string }[] } | undefined)
		?.betModes;
	const option = shape.buy ? (betModes?.findIndex((m) => m.kind === 'buy') ?? -1) : 0;
	const started = await play(mockFor(contract), [shape.force ?? null], Math.max(0, option));
	check(
		`${shape.name}: its bonus starts (${shape.cause})`,
		[
			option >= 0,
			started.some(
				(e) =>
					e.event === 'spinTrigger' &&
					(e.context as { cause?: string; bonus?: string }).cause === shape.cause &&
					(e.context as { bonus?: string }).bonus !== 'feature',
			),
		],
		[true, true],
	);
	const grid = contractOf(shape).grid as Grid | undefined;
	check(
		`${shape.name}: the coin overlay rides last on its contract`,
		Object.keys(grid ?? {}).at(-1),
		'potsOverlay',
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
process.exit(0);
