// Local stand-in games for the current-games harness: one "published snapshot" per game type,
// built from the engine's reference layouts and the committed per-type Game Config defaults, so the
// harness runs with no R2 key and no launcher (development, the noise measurement, the 1 px proof).
// They are NOT the live games: CI renders the real published snapshots.
//
//   node --experimental-strip-types --import ./scripts/ts-loader.mjs \
//     scripts/current-games/fixtures.mjs [--out .cache/current-games/fixtures] [--builtins <json>]
//
// Writes `<out>/games.json` in the `/api/pipeline/games` shape, each game carrying `local`: its
// snapshot folder, its test-server manifest entry (the mock contract) and `assetBase: 'runtime'`
// (the reference layouts' art ships inside the runtime build). Then:
//
//   node scripts/current-games/run.mjs --games-file .cache/current-games/fixtures/games.json …
//
// Like a publish (`runtimeBundle.ts`), each snapshot BAKES the component defs its doc references —
// the closure of its placed instances, resolved from the built-ins — so a built-in change reaches
// a fixture the way it reaches a live game: not until it is "republished", which the harness renders
// as a row of its own (`lib/builtins.mjs`). `--builtins` bakes from another build's `builtins.json`
// (main's, for the 1 px proof: the snapshots must predate the change); without it the working
// tree's built-ins are baked.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { BUILTIN_COMPONENTS } from '../../packages/engine-layout/src/lib/builtinComponents.ts';
import { resolveComponentClosure } from '../../packages/engine-layout/src/lib/collectComponentIds.ts';
import {
	bookofReferenceLayout,
	clusterReferenceLayout,
	defaultLayout,
	holdAndWinReferenceLayout,
	scatterReferenceLayout,
	waysReferenceLayout,
} from '../../packages/engine-layout/src/lib/referenceLayouts/index.ts';
import {
	addPotsOverlay,
	betModeCardIds,
	HOLD_AND_WIN_PRESETS,
	holdAndWinMockInputs,
	normalizeGameConfigDoc,
	potsOverlayMockInputs,
} from '../../packages/game-config/index.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const { values: opt } = parseArgs({
	options: {
		out: { type: 'string', default: join(ROOT, '.cache/current-games/fixtures') },
		builtins: { type: 'string' },
	},
});
const out = resolve(opt.out);

/** The built-in defs a "publish" of these fixtures resolves from, keyed by id. */
const builtins = opt.builtins
	? JSON.parse(readFileSync(resolve(opt.builtins), 'utf8')).defs
	: Object.fromEntries(BUILTIN_COMPONENTS.map((def) => [def.id, def]));

/** The defs a publish bakes for `doc`: the placed instances' closure plus the config's card ids. */
const bakeComponentDefs = (doc, config) =>
	resolveComponentClosure(
		doc.scenes.flatMap((scene) => scene.nodes),
		(id) => builtins[id],
		{ extraSeedIds: config ? betModeCardIds(config) : [] },
	);

const committedDefault = (name) =>
	normalizeGameConfigDoc(
		JSON.parse(
			readFileSync(join(ROOT, 'apps/launcher-api/src/lib/data/gameConfig', `${name}.json`), 'utf8'),
		),
	);

/** The lines-family manifest grid, as `mockContract.ts` derives it from a config. */
const linesGrid = (doc) => {
	const paylines = Object.values(doc.paylines ?? {});
	return {
		reels: doc.numReels,
		rows: Math.max(...doc.numRows),
		...(new Set(doc.numRows).size > 1 ? { rowsPerReel: doc.numRows } : {}),
		...(paylines.length ? { paylines } : {}),
	};
};

const pays = (three, four, five) => ({ paytable: [{ 3: three }, { 4: four }, { 5: five }] });
const BOOK_STRIP = ['PIC1', 'ACE', 'SCAT', 'KING', 'PIC2', 'TEN'].map((name) => ({ name }));
/** A Book-of host for the pots overlay, the shape `check-pots-overlay-protocol.mjs` uses. */
const BOOK_HOST = normalizeGameConfigDoc({
	providerName: 'invisible_wall',
	gameName: 'cg_book_pots',
	gameID: 'cg_book_pots',
	rtp: 0.96,
	numReels: 5,
	numRows: [3, 3, 3, 3, 3],
	betModes: { base: { cost: 1, feature: true, buyBonus: false, rtp: 0.96, max_win: 5000 } },
	paylines: { 1: [1, 1, 1, 1, 1], 2: [0, 0, 0, 0, 0], 3: [2, 2, 2, 2, 2] },
	symbols: {
		PIC1: pays(100, 1000, 5000),
		PIC2: pays(30, 400, 2000),
		ACE: pays(5, 50, 150),
		KING: pays(5, 50, 150),
		TEN: pays(5, 20, 100),
		SCAT: { special_properties: ['scatter'] },
	},
	paddingReels: {
		basegame: Array.from({ length: 5 }, () => BOOK_STRIP),
		freegame: Array.from({ length: 5 }, () => BOOK_STRIP),
	},
});

const holdAndWinGame = (preset) => {
	const config = normalizeGameConfigDoc(HOLD_AND_WIN_PRESETS[preset]);
	return {
		gameType: 'holdAndWin',
		doc: holdAndWinReferenceLayout(),
		config,
		entry: {
			protocol: 'holdAndWin',
			grid: { ...linesGrid(config), holdAndWin: holdAndWinMockInputs(config) },
		},
	};
};

const booksPots = () => {
	const added = addPotsOverlay(BOOK_HOST, 'threePots');
	if (!added.ok) throw new Error(`pots overlay: ${added.reason}`);
	const config = normalizeGameConfigDoc(added.doc);
	return {
		gameType: 'bookOf',
		doc: bookofReferenceLayout(),
		config,
		entry: {
			protocol: 'book',
			grid: { ...linesGrid(config), potsOverlay: potsOverlayMockInputs(config) },
		},
	};
};

const FIXTURES = {
	'cg-lines': () => {
		const config = committedDefault('lines');
		return {
			gameType: 'lines',
			doc: defaultLayout('lines'),
			config,
			entry: { protocol: 'lines', grid: linesGrid(config) },
		};
	},
	'cg-ways': () => {
		const config = committedDefault('ways');
		return {
			gameType: 'ways',
			doc: waysReferenceLayout(),
			config,
			entry: { protocol: 'ways', grid: linesGrid(config) },
		};
	},
	'cg-scatter': () => {
		const config = committedDefault('scatter');
		return {
			gameType: 'scatter',
			doc: scatterReferenceLayout(),
			config,
			entry: { protocol: 'scatter', grid: linesGrid(config) },
		};
	},
	'cg-cluster': () => ({
		gameType: 'cluster',
		doc: clusterReferenceLayout(),
		entry: { protocol: 'cluster' },
	}),
	'cg-bookof': () => ({
		gameType: 'bookOf',
		doc: bookofReferenceLayout(),
		entry: { protocol: 'book' },
	}),
	'cg-bookof-pots': booksPots,
	'cg-hw-pots': () => holdAndWinGame('pots'),
	'cg-hw-classic': () => holdAndWinGame('classic'),
};

const games = [];
for (const [key, make] of Object.entries(FIXTURES)) {
	const { gameType, doc, config, entry } = make();
	const dir = join(out, 'snapshots', key);
	mkdirSync(join(dir, 'deploy'), { recursive: true });
	const componentDefs = await bakeComponentDefs(doc, config);
	writeFileSync(
		join(dir, 'runtime.json'),
		JSON.stringify({ doc, componentDefs, componentDefaults: {}, ...(config ? { config } : {}) }),
	);
	// What a live pointer records as the engine the game was published with, as data: the built-ins
	// this snapshot was baked from, which the harness tells the baked copies by.
	writeFileSync(
		join(dir, 'published-builtins.json'),
		JSON.stringify({ version: 1, defs: builtins }),
	);
	games.push({
		key,
		name: `Fixture ${key.slice(3)}`,
		projectKey: key,
		clientKey: 'fixtures',
		gameType,
		version: '0',
		builtAt: null,
		publishedPointerKey: `fixtures/${key}/published/pointer.json`,
		hasOwnBuiltBundle: false,
		local: {
			snapshot: dir,
			publishedBuiltins: join(dir, 'published-builtins.json'),
			assetBase: 'runtime',
			manifestEntry: { ...entry, name: `Fixture ${key.slice(3)}`, projectKey: key },
		},
	});
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'games.json'), JSON.stringify({ games }, null, '\t'));
console.log(`[current-games] ${games.length} fixture games → ${join(out, 'games.json')}`);
