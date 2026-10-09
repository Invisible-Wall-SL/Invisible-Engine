/**
 * A SPINS BONUS MODE OF ANY GAME TYPE (`docs/design/bonus-games.md` §0 layer 3, bonus-games Phase 8a).
 *
 *   pnpm check:spins-modes
 *
 * Real rounds dealt by the REAL lines mock under the coin overlay, translated by the REAL facade:
 *
 *  1. THE HOST. A lines base game (5×3, paylines) with the 3 Pots overlay, its own Hold and Win and
 *     its own free spins, plus two spins modes (`game-config` `spinsGame.sample.ts`): a WAYS game
 *     (6×4, 5 spins) and a CLUSTER game (7×7, 4 spins, its own pay for one symbol). The blue pot
 *     starts the ways game, a buy tier the cluster game. It validates clean.
 *  2. BLUE POT → WAYS: exactly 5 spins, each dealt 6×4 from its own strips and paid by WAYS only,
 *     revealed on its own game type and 6×4 window; the round ends back in the base game.
 *  3. BUY → CLUSTER: a bought round plays exactly 4 spins, 7×7, paid by CLUSTERS only, at its own price.
 *  4. ITS OWN FREE SPINS (a forced feature) still play on the 5×3 base grid, paid by lines, as
 *     `freegame`.
 *  5. THE RUNTIME. The engine's own `createModeController` (compiled by Svelte) and `createGameConfig`,
 *     with the game's own `syncSpinsBoard` sliced from `stateModes.svelte.ts`: at every reveal the board
 *     is the mode's grid, model and paylines; it is rebuilt exactly on entering and on leaving the
 *     spins mode; a resume mid-mode rebuilds it once for the mode, with no intro.
 *  6. PARITY. For every committed default the grid / board / win-model / payline / divisor accessors
 *     answer the same with the mode stack bound and on every built-in mode as unbound, and the board
 *     is never rebuilt.
 */

import {
	normalizeGameConfigDoc,
	potsOverlayMockInputs,
	potsOverlayPreset,
	holdAndWinBonus,
	gameConfigErrors,
	type GameConfigDoc,
} from '../packages/game-config/index.ts';
import {
	CLUSTER_BONUS,
	WAYS_BONUS,
	withSpinsModes,
} from '../packages/game-config/spinsGame.sample.ts';
import { modeOpOf } from '../packages/engine-game/src/game/modeEvents.ts';
import { createGameConfig } from '../packages/engine-game/src/game/gameConfig.ts';
import { withPotsOverlay } from './mock-pots-overlay.mjs';
import { createMockRgs as createLinesMock } from './mock-rgs-server.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

import { compileSlice, stripSliceTypes } from './lib/compile-slice.mjs';

type BookEvent = { type: string; mode?: string; [key: string]: unknown };
type Facade = typeof import('../packages/rgs-translator-eagaming/src/engineFacade.ts');
type Wire = { events?: { event: string; context?: unknown }[] };

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

const pays = (three: number, four: number, five: number) => ({
	paytable: [{ 3: three }, { 4: four }, { 5: five }],
});
const LINE_STRIP = ['PIC1', 'PIC5', 'SCAT', 'PIC6', 'PIC2', 'PIC7'].map((name) => ({ name }));
const LINES_HOST = {
	providerName: 'invisible_wall',
	gameName: 'spins_host',
	gameID: 'spins_host',
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
		basegame: Array.from({ length: 5 }, () => LINE_STRIP),
		freegame: Array.from({ length: 5 }, () => LINE_STRIP),
	},
};

const normalized = (raw: unknown): GameConfigDoc => {
	const doc = normalizeGameConfigDoc(raw as Record<string, unknown>);
	if (!doc) throw new Error('config did not normalize');
	return doc;
};

const spinsHost = (): GameConfigDoc => {
	const preset = potsOverlayPreset('threePots');
	const bonus = holdAndWinBonus(preset.holdAndWin, LINES_HOST);
	const threePots = normalized({
		...structuredClone(LINES_HOST),
		symbols: { ...LINES_HOST.symbols, ...bonus.symbols, ...preset.tokens },
		paddingReels: { ...LINES_HOST.paddingReels, ...bonus.paddingReels },
		holdAndWin: bonus.holdAndWin,
		potsOverlay: preset.potsOverlay,
	});
	// A split-form writer: the legacy pair goes before the edit (design §2.1).
	const raw = structuredClone(threePots) as GameConfigDoc & Record<string, unknown>;
	delete raw.holdAndWin;
	delete raw.potsOverlay;
	const spins = withSpinsModes(raw);
	spins.betModes = {
		...spins.betModes,
		bonus: { cost: 100, feature: false, buyBonus: true, rtp: 0.96, max_win: 5000 },
	};
	const overlay = spins.coinOverlay!;
	overlay.pots = overlay.pots!.map((p) =>
		p.id === 'blue' ? { ...p, bonus: { mode: WAYS_BONUS } } : p,
	);
	overlay.trigger = {
		...overlay.trigger,
		buy: [{ betMode: 'bonus', mode: CLUSTER_BONUS, guaranteed: [], boostedSpecials: false }],
	};
	return normalized(spins);
};

const HOST = spinsHost();
check(
	'host: the pots start Hold and Win and the ways game, the buy the cluster game',
	[
		HOST.coinOverlay?.pots?.map((p) => [p.id, p.bonus.mode]),
		HOST.coinOverlay?.trigger?.buy?.map((t) => [t.betMode, t.mode]),
	],
	[
		[
			['red', 'holdAndWin'],
			['blue', WAYS_BONUS],
			['green', 'holdAndWin'],
		],
		[['bonus', CLUSTER_BONUS]],
	],
);
check(
	'host: validates clean',
	gameConfigErrors(HOST).map((i) => `${i.path}: ${i.message}`),
	[],
);
const INPUTS = potsOverlayMockInputs(HOST);
check(
	'host: the mock is told each spins game',
	Object.entries(INPUTS?.modes ?? {})
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([id, m]) => [id, m.game?.winModel.type, m.game?.reels, m.game?.rows, m.game?.spins]),
	[
		[CLUSTER_BONUS, 'cluster', 7, [7, 7, 7, 7, 7, 7, 7], 4],
		[WAYS_BONUS, 'ways', 6, [4, 4, 4, 4, 4, 4], 5],
	].sort(),
);

check(
	'host: the cluster game is dealt at its own price for PIC1',
	INPUTS?.modes?.[CLUSTER_BONUS]?.paytable.PIC1,
	{ 5: 2, 8: 10, 12: 50 },
);

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

/** The real mock behind a proxy that forces the first `play` and keeps every wire answer. */
const BET_MODES = [
	{ mode: 'base', cost: 1, kind: 'base' },
	{ mode: 'bonus', cost: 100, kind: 'buy' },
];
const startHost = async (force: string | null, seed: string) => {
	const mock = withPotsOverlay(
		(opts: Record<string, unknown> = {}) => createLinesMock({ quiet: true, ...opts }),
		INPUTS,
	)({
		label: 'spins-modes',
		seed,
		allowForce: true,
		paylines: Object.values(HOST.paylines),
		betModes: BET_MODES,
	});
	const upstream = createServer((req, res) =>
		mock.handle(req, res, new URL(req.url ?? '/', `http://${req.headers.host}`)),
	);
	const upstreamUrl = await listen(upstream);
	let armed = force !== null;
	const wire: Wire[] = [];
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
		const text = await answer.text();
		wire.push(JSON.parse(text) as Wire);
		res.writeHead(answer.status, { 'content-type': 'application/json' });
		res.end(text);
	});
	const rgsUrl = await listen(proxy);
	return {
		rgsUrl,
		wire,
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
	betMode = 'BASE',
): Promise<{ book: BookEvent[]; wire: Wire[] }> => {
	const host = await startHost(force, `spins-modes-${force}-${betMode}`);
	const sid = `spins-${force}-${betMode}`;
	const book = await hush(async () => {
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
	return { book, wire: host.wire };
};

/** The raw wins the mock paid while the bonus played, by evaluator (`line`, `ways`, `cluster`, …). */
const bonusWinModes = (wire: Wire[]): string[] => {
	const modes = new Set<string>();
	let inBonus = false;
	for (const answer of wire)
		for (const e of answer.events ?? []) {
			const ctx = (e.context ?? {}) as { bonus?: string; mode?: string; what?: string };
			if (e.event === 'enterBonus') inBonus = true;
			if (inBonus && e.event === 'spinWin' && ctx.what !== 'SCAT' && ctx.mode) modes.add(ctx.mode);
			if (e.event === 'gameEnd') inBonus = false;
		}
	return [...modes].sort();
};

const reveals = (book: BookEvent[]) =>
	book.filter((e) => e.type === 'reveal') as (BookEvent & {
		board: unknown[][];
		gameType: string;
	})[];
/** A reveal board's visible shape: reels × rows, the facade's one-row padding top and bottom off. */
const shapeOf = (board: unknown[][]) =>
	`${board.length}×${[...new Set(board.map((r) => r.length - 2))].join('/')}`;

const verifySpins = async (
	label: string,
	[force, betMode]: [string | null, string],
	mode: string,
	spins: number,
	shape: string,
	paidBy: string,
) => {
	const { book, wire } = await playRound(force, betMode);
	const trigger = book.find((e) => e.type === 'freeSpinTrigger');
	check(
		`${label}: enters ${mode} for ${spins} spins`,
		[trigger?.mode, trigger?.totalFs],
		[mode, spins],
	);
	const bonus = reveals(book).filter((r) => r.gameType === mode);
	check(`${label}: exactly ${spins} reveals on its own game type`, bonus.length, spins);
	check(
		`${label}: each on its own ${shape} grid`,
		[...new Set(bonus.map((r) => shapeOf(r.board)))],
		[shape],
	);
	check(`${label}: the base spin stays 5×3`, shapeOf(reveals(book)[0].board), '5×3');
	check(`${label}: paid by ${paidBy} only`, bonusWinModes(wire), [paidBy]);
	check(`${label}: no retrigger`, book.filter((e) => e.type === 'freeSpinRetrigger').length, 0);
	const end = book.find((e) => e.type === 'freeSpinEnd');
	check(`${label}: ends the mode`, end?.mode, mode);
	return book;
};

// ---------- 2–4. the rounds ----------

const waysBook = await verifySpins(
	'blue pot → ways',
	['force:pot:blue', 'BASE'],
	WAYS_BONUS,
	5,
	'6×4',
	'ways',
);
const clusterBook = await verifySpins(
	'buy → cluster',
	[null, 'BONUS'],
	CLUSTER_BONUS,
	4,
	'7×7',
	'cluster',
);

{
	const { book, wire } = await playRound('force:feature');
	const trigger = book.find((e) => e.type === 'freeSpinTrigger');
	check('own free spins: no mode of their own', trigger?.mode, undefined);
	const free = reveals(book).filter((r) => r.gameType === 'freegame');
	check('own free spins: they play', free.length > 0, true);
	check(
		'own free spins: on the 5×3 base grid',
		[...new Set(free.map((r) => shapeOf(r.board)))],
		['5×3'],
	);
	const lineOnly = bonusWinModes(wire).every((m) => m === 'line');
	check('own free spins: paid by lines', lineOnly, true);
}

// ---------- 5. the runtime ----------

register(
	'data:text/javascript,' +
		encodeURIComponent(`
			import { readFile } from 'node:fs/promises';
			import { createRequire, stripTypeScriptTypes } from 'node:module';
			import { fileURLToPath } from 'node:url';
			export async function load(url, context, next) {
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
const { createModeController } =
	await import('../packages/engine-game/src/game/modeController.svelte.ts');

const source = readFileSync(
	new URL('../apps/lines/src/game/stateModes.svelte.ts', import.meta.url),
	'utf8',
);
const slice = (from: string, to: string) => {
	const start = source.indexOf(from);
	const end = source.indexOf(to, start + from.length);
	if (start < 0 || end < 0) throw new Error(`stateModes.svelte.ts: could not slice "${from}"`);
	return source.slice(start, end + to.length);
};

/** One game's runtime: its config, the real mode controller, the shipped board sync. */
const runtimeFor = (doc: GameConfigDoc) => {
	const config = createGameConfig<string>({ bakedConfig: () => doc, compiledConfig: doc });
	const rebuilds: string[] = [];
	const syncSpinsBoard = compileSlice({
		what: 'stateModes.svelte.ts#syncSpinsBoard',
		names: ['activeSpinsGame', 'rebuildBoard'],
		body: `${stripSliceTypes(
			'stateModes',
			slice('let boardBuiltFor', ';\n') + '\n' + slice('const syncSpinsBoard = (', '\n};\n'),
		)}\nreturn syncSpinsBoard;`,
	})(config.activeSpinsGame, () => {
		const { x, y } = config.boardDimensions();
		rebuilds.push(`${x}×${y}`);
	}) as () => void;
	const controller = createModeController({
		gameTypeOf: (id: string) => id,
		setGameType: () => {},
		onStack: syncSpinsBoard,
	});
	config.bindActiveMode(() => controller.active());
	return { config, controller, rebuilds };
};

/** Walk a book through the play seam's mode moves; at each reveal, what the board reads. */
const walk = async (book: BookEvent[], runtime: ReturnType<typeof runtimeFor>) => {
	const seen: string[] = [];
	for (const event of book) {
		await runtime.controller.before(event);
		if (event.type === 'reveal') {
			const { x, y } = runtime.config.boardDimensions();
			const model = runtime.config.activeWinModel().type;
			seen.push(`${x}×${y} ${model} ${runtime.config.getPaylines().length}`);
		}
		await runtime.controller.after(event);
	}
	return seen;
};

{
	const runtime = runtimeFor(HOST);
	runtime.controller.reset();
	const seen = await walk(waysBook, runtime);
	check('runtime ways: the base spin on the base board', seen[0], '5×3 lines 3');
	check(
		'runtime ways: every bonus reveal on the mode’s board',
		[...new Set(seen.slice(1))],
		['6×4 ways 0'],
	);
	check('runtime ways: rebuilt on entry and on exit only', runtime.rebuilds, ['6×4', '5×3']);
	check('runtime ways: back on the base board', runtime.config.boardDimensions(), { x: 5, y: 3 });
	check(
		'runtime ways: the initial board fills the mode grid',
		runtime.config.initialBoard().length,
		5,
	);
}
{
	const runtime = runtimeFor(HOST);
	runtime.controller.reset();
	const seen = await walk(clusterBook, runtime);
	check(
		'runtime cluster: every bonus reveal on the mode’s board',
		[...new Set(seen.slice(1))],
		['7×7 cluster 0'],
	);
	check('runtime cluster: rebuilt on entry and on exit only', runtime.rebuilds, ['7×7', '5×3']);
}
{
	// A resume mid-mode: the snapshot's mode events rebuild the stack with no transition.
	const runtime = runtimeFor(HOST);
	const upTo = waysBook.findIndex((e) => e.type === 'reveal' && e.gameType === WAYS_BONUS);
	runtime.controller.restore(waysBook.slice(0, upTo + 1).filter((e) => modeOpOf(e)));
	check('resume: the mode is on top', runtime.controller.active(), WAYS_BONUS);
	check('resume: the board is rebuilt once, for the mode', runtime.rebuilds, ['6×4']);
	check('resume: the board reads the mode’s grid', runtime.config.boardDimensions(), {
		x: 6,
		y: 4,
	});
	check(
		'resume: the initial board is dealt from the mode’s strips',
		runtime.config.initialBoard().map((reel) => reel.length),
		[6, 6, 6, 6, 6, 6],
	);
}

// ---------- 6. parity ----------

const DEFAULTS = new URL('../apps/launcher-api/src/lib/data/gameConfig/', import.meta.url);
const accessors = (config: ReturnType<typeof createGameConfig<string>>) =>
	JSON.stringify({
		grid: config.activeGrid(),
		board: config.boardDimensions(),
		model: config.activeWinModel(),
		paylines: config.getPaylines(),
		lines: config.getNumLines(),
		divisor: config.payoutDivisor(),
		colour: config.paylineColor(0),
		initial: config.initialBoard(),
	});
for (const name of readdirSync(DEFAULTS).filter((n) => n.endsWith('.json'))) {
	const doc = normalized(JSON.parse(readFileSync(new URL(name, DEFAULTS), 'utf8')));
	const unbound = accessors(
		createGameConfig<string>({ bakedConfig: () => doc, compiledConfig: doc }),
	);
	const runtime = runtimeFor(doc);
	const answers = ['basegame', 'freeSpins', 'holdAndWin'].map((mode) => {
		runtime.controller.restore(mode === 'basegame' ? [] : [{ type: 'modeEnter', mode }]);
		return accessors(runtime.config) === unbound;
	});
	check(`parity ${name}: every built-in mode reads the doc's own board`, answers, [
		true,
		true,
		true,
	]);
	check(`parity ${name}: the board is never rebuilt`, runtime.rebuilds, []);
}

console.log(
	failures
		? `\ncheck:spins-modes — ${failures} FAILED, ${passes} passed`
		: `\ncheck:spins-modes — all ${passes} passed`,
);
process.exit(failures ? 1 : 0);
