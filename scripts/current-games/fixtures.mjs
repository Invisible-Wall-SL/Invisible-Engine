// Local stand-in games for the current-games harness: one "published snapshot" per game type,
// built from the engine's reference layouts and the committed per-type Game Config defaults, so the
// harness runs with no R2 key and no launcher (development, the noise measurement, the 1 px proof).
// They are NOT the live games: CI renders the real published snapshots.
//
//   node --experimental-strip-types --import ./scripts/ts-loader.mjs \
//     scripts/current-games/fixtures.mjs [--out .cache/current-games/fixtures]
//
// Writes `<out>/games.json` in the `/api/pipeline/games` shape, each game carrying `local`: its
// snapshot folder, its test-server manifest entry (the mock contract) and `assetBase: 'runtime'`
// (the reference layouts' art ships inside the runtime build). Then:
//
//   node scripts/current-games/run.mjs --games-file .cache/current-games/fixtures/games.json …

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

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
	HOLD_AND_WIN_PRESETS,
	holdAndWinMockInputs,
	normalizeGameConfigDoc,
	potsOverlayMockInputs,
} from '../../packages/game-config/index.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const { values: opt } = parseArgs({
	options: { out: { type: 'string', default: join(ROOT, '.cache/current-games/fixtures') } },
});
const out = resolve(opt.out);

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
	writeFileSync(join(dir, 'runtime.json'), JSON.stringify({ doc, ...(config ? { config } : {}) }));
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
			assetBase: 'runtime',
			manifestEntry: { ...entry, name: `Fixture ${key.slice(3)}`, projectKey: key },
		},
	});
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'games.json'), JSON.stringify({ games }, null, '\t'));
console.log(`[current-games] ${games.length} fixture games → ${join(out, 'games.json')}`);
