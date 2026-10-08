/**
 * Contract check for the Game Maker scaffold's Game Config seed:
 *   pnpm --filter launcher-api check:project-scaffold
 *
 * A freshly scaffolded `holdAndWin` project used to have NO authored config, so the test server
 * dealt it plain lines (the compiled lines config has no `holdAndWin` block) until someone saved
 * `/config` once. Runs the REAL `projectScaffold.ts` + `gameConfigStorage.ts` over an in-memory R2;
 * only R2 and the project lookups are stubbed. What it pins:
 *  - a `holdAndWin` project is seeded with the kind's default preset (Pots), whose mock inputs exist;
 *  - every other kind stays UN-authored, so what it plays is byte-identical to before;
 *  - the scaffold never overwrites an authored config, and loses a concurrent first save quietly;
 *  - a `holdAndWin` project's symbols doc binds every Hold and Win symbol of its preset (the game
 *    draws only what that doc binds), from the STORED config, so /admin Re-scaffold backfills an
 *    older project; no other kind gets one, and an existing symbols doc is never overwritten;
 *  - a `lines` project created with the Book of Thermopylae preset (book-feature Phase 5c) is seeded
 *    with the preset and the Book-of reference scenes, as a LINES layout; another kind ignores it.
 */
import { mock } from 'node:test';
import {
	HOLD_AND_WIN_PRESETS,
	HOLD_AND_WIN_SYMBOL_ROLES,
	holdAndWinMockInputs,
	normalizeGameConfigDoc,
	type GameConfigDoc,
} from 'game-config';

type Obj = { body: string; etag: string };
const R2 = new Map<string, Obj>();
let etagSeq = 0;
/** Keys a "concurrent author" creates between the scaffold's HEAD and its PUT. */
const RACE = new Map<string, string>();

class ConflictError extends Error {
	constructor(readonly key: string) {
		super(`conflict ${key}`);
	}
}
const sortedKeys = (prefix: string) => [...R2.keys()].filter((k) => k.startsWith(prefix)).sort();

const src = (rel: string) => new URL(`../src/${rel}`, import.meta.url).href;
mock.module(src('lib/server/r2.ts'), {
	namedExports: {
		ConflictError,
		precondition: (base: string | null | undefined) =>
			base === undefined ? undefined : base === null ? { ifNoneMatch: '*' } : { ifMatch: base },
		objectExists: async (key: string) => R2.has(key),
		headObject: async (key: string) => (R2.has(key) ? { etag: R2.get(key)!.etag } : null),
		getObjectText: async (key: string) => R2.get(key)?.body ?? null,
		getObjectTextWithEtag: async (key: string) => {
			const o = R2.get(key);
			return o ? { text: o.body, etag: o.etag } : null;
		},
		putObjectText: async (
			key: string,
			text: string,
			_type: string,
			cond?: { ifMatch?: string; ifNoneMatch?: string },
		) => {
			const raced = RACE.get(key);
			if (raced !== undefined) {
				RACE.delete(key);
				R2.set(key, { body: raced, etag: `"e${++etagSeq}"` });
			}
			const cur = R2.get(key);
			if (cond?.ifNoneMatch && cur) throw new ConflictError(key);
			if (cond?.ifMatch && cur?.etag !== cond.ifMatch) throw new ConflictError(key);
			R2.set(key, { body: text, etag: `"e${++etagSeq}"` });
			return R2.get(key)!.etag;
		},
		copyObject: async (from: string, to: string) => {
			const o = R2.get(from);
			if (!o) return false;
			R2.set(to, { ...o });
			return true;
		},
		deleteObjects: async (keys: string[]) => keys.forEach((k) => R2.delete(k)),
		listAllKeys: async (prefix: string) => sortedKeys(prefix),
		listAllObjects: async (prefix: string) =>
			sortedKeys(prefix).map((key) => ({ key, size: R2.get(key)!.body.length, lastModified: 1 })),
		listObjects: async () => ({ keys: [], prefixes: [] }),
	},
});

const GAME_TYPES: Record<string, string> = {
	hw: 'holdAndWin',
	hwAuthored: 'holdAndWin',
	hwRace: 'holdAndWin',
	hwClassic: 'holdAndWin',
	hwCollector: 'holdAndWin',
	hwBackfill: 'holdAndWin',
	hwSymbolsAuthored: 'holdAndWin',
	hwSymbolsRace: 'holdAndWin',
	linesPreset: 'lines',
	linesBook: 'lines',
	waysBook: 'ways',
	linesWithCoins: 'lines',
	lines: 'lines',
	ways: 'ways',
	scatter: 'scatter',
	cluster: 'cluster',
};
mock.module(src('lib/server/projects.ts'), {
	namedExports: {
		projectGameType: async (p: string) => GAME_TYPES[p] ?? 'lines',
	},
});

const { scaffoldProject } = await import('../src/lib/server/projectScaffold.ts');
const { gameConfigDocKey, symbolsDocKey } = await import('../src/lib/server/projectPaths.ts');
const { symbolDefaultsFor } = await import('../src/lib/server/symbolDefaults.ts');
const { gameConfigDefaultFor, gameConfigSeedFor } =
	await import('../src/lib/server/gameConfigDefaults.ts');
const { editorDocKey } = await import('../src/lib/server/projectPaths.ts');
const {
	BOOK_OF_REFERENCE_SET,
	engineOwnedOnly,
	getFullSceneSet,
	listFullSceneSets,
	listImportableKinds,
	referenceLoadsAs,
} = await import('engine-layout');

const CLIENT = 'invisible_wall';
let failures = 0;
async function check(name: string, fn: () => Promise<void>) {
	try {
		await fn();
		console.log(`  ok  ${name}`);
	} catch (e) {
		failures++;
		console.error(`  FAIL ${name}\n       ${e instanceof Error ? e.message : String(e)}`);
	}
}
function assert(cond: unknown, msg: string): asserts cond {
	if (!cond) throw new Error(msg);
}
const storedConfig = (project: string) => {
	const o = R2.get(gameConfigDocKey(CLIENT, project));
	return o ? normalizeGameConfigDoc(JSON.parse(o.body)) : null;
};

await check('a holdAndWin project is seeded with the Pots preset', async () => {
	await scaffoldProject(CLIENT, 'hw');
	const doc = storedConfig('hw');
	assert(doc, 'no Game Config stored');
	const pots = gameConfigDefaultFor('holdAndWin');
	assert(pots?.holdAndWin, 'the holdAndWin default has no holdAndWin block');
	assert(
		JSON.stringify(doc.holdAndWin) === JSON.stringify(pots.holdAndWin),
		'the seeded block is not the default preset',
	);
	assert(holdAndWinMockInputs(doc), 'the seeded config yields no mock inputs (plain lines)');
});

await check('the preset picked at Create is the one seeded', async () => {
	await scaffoldProject(CLIENT, 'hwClassic', { holdAndWinPreset: 'classic' });
	const doc = storedConfig('hwClassic');
	const classic = normalizeGameConfigDoc(HOLD_AND_WIN_PRESETS.classic);
	assert(doc?.holdAndWin && classic?.holdAndWin, 'no holdAndWin block');
	assert(
		JSON.stringify(doc.holdAndWin) === JSON.stringify(classic.holdAndWin),
		'the seeded block is not the Classic preset',
	);
	await scaffoldProject(CLIENT, 'linesPreset', { holdAndWinPreset: 'classic' });
	assert(!R2.has(gameConfigDocKey(CLIENT, 'linesPreset')), 'a preset seeded a non-preset kind');
});

await check('every other kind stays un-authored', async () => {
	for (const project of ['lines', 'ways', 'scatter', 'cluster']) {
		await scaffoldProject(CLIENT, project);
		assert(!R2.has(gameConfigDocKey(CLIENT, project)), `${project} was seeded a config`);
	}
});

await check('an authored config is never overwritten', async () => {
	const key = gameConfigDocKey(CLIENT, 'hwAuthored');
	const authored = JSON.stringify({ authored: true });
	R2.set(key, { body: authored, etag: '"mine"' });
	await scaffoldProject(CLIENT, 'hwAuthored');
	assert(R2.get(key)?.body === authored, 'the authored config was replaced');
});

await check('a concurrent first save wins, quietly', async () => {
	const key = gameConfigDocKey(CLIENT, 'hwRace');
	const theirs = JSON.stringify({ theirs: true });
	RACE.set(key, theirs);
	await scaffoldProject(CLIENT, 'hwRace');
	assert(R2.get(key)?.body === theirs, 'the scaffold clobbered a concurrent save');
});

const HW_ROLES = new Set<string>(HOLD_AND_WIN_SYMBOL_ROLES.filter((r) => r !== 'blank'));
/** Every Hold and Win symbol of `config` must be bound, cell for cell, to its tool default. */
function assertBindsPreset(project: string, config: GameConfigDoc) {
	const o = R2.get(symbolsDocKey(CLIENT, project));
	assert(o, `${project}: no symbols doc stored`);
	const stored = JSON.parse(o.body) as { symbols: Record<string, Record<string, object>> };
	const defaults = symbolDefaultsFor('holdAndWin').symbols;
	const expected = Object.entries(config.symbols)
		.filter(([, s]) => s.special_properties?.some((r) => HW_ROLES.has(r)))
		.map(([name]) => name);
	assert(expected.length > 0, `${project}: the preset has no Hold and Win symbols`);
	for (const name of expected) {
		const cells = stored.symbols[name];
		assert(cells, `${project}: ${name} is not bound`);
		for (const [state, cell] of Object.entries(defaults[name])) {
			const want = { type: cell.type, assetKey: cell.assetKey, animationName: cell.animationName };
			assert(
				JSON.stringify(cells[state]) === JSON.stringify(want),
				`${project}: ${name}.${state} = ${JSON.stringify(cells[state])}, want ${JSON.stringify(want)}`,
			);
		}
	}
	const extra = Object.keys(stored.symbols).filter((n) => !expected.includes(n));
	assert(
		!extra.length,
		`${project}: seeded symbols outside the preset's roles: ${extra.join(', ')}`,
	);
}

await check('a holdAndWin symbols doc binds every symbol of its preset', async () => {
	await scaffoldProject(CLIENT, 'hwCollector', { holdAndWinPreset: 'collector' });
	for (const [project, preset] of [
		['hw', 'pots'],
		['hwClassic', 'classic'],
		['hwCollector', 'collector'],
	] as const) {
		const config = normalizeGameConfigDoc(HOLD_AND_WIN_PRESETS[preset]);
		assert(config, `${preset} preset does not normalize`);
		assertBindsPreset(project, config);
	}
});

await check('every other kind gets no symbols doc', async () => {
	// Even one whose authored config carries Hold and Win roles (copied from a preset).
	const pots = JSON.stringify(normalizeGameConfigDoc(HOLD_AND_WIN_PRESETS.pots));
	R2.set(gameConfigDocKey(CLIENT, 'linesWithCoins'), { body: pots, etag: '"copied"' });
	await scaffoldProject(CLIENT, 'linesWithCoins');
	for (const project of ['linesWithCoins', 'lines', 'linesPreset', 'ways', 'scatter', 'cluster']) {
		assert(!R2.has(symbolsDocKey(CLIENT, project)), `${project} was seeded a symbols doc`);
	}
});

await check('Re-scaffold backfills an older project from its stored config', async () => {
	const classic = normalizeGameConfigDoc(HOLD_AND_WIN_PRESETS.classic);
	assert(classic, 'classic preset does not normalize');
	R2.set(gameConfigDocKey(CLIENT, 'hwBackfill'), { body: JSON.stringify(classic), etag: '"old"' });
	await scaffoldProject(CLIENT, 'hwBackfill');
	assertBindsPreset('hwBackfill', classic);
});

await check('an existing symbols doc is never overwritten', async () => {
	const key = symbolsDocKey(CLIENT, 'hwSymbolsAuthored');
	const authored = JSON.stringify({ version: 1, symbols: {}, coinLabel: {} });
	R2.set(key, { body: authored, etag: '"mine"' });
	await scaffoldProject(CLIENT, 'hwSymbolsAuthored');
	assert(R2.get(key)?.body === authored, 'the authored symbols doc was replaced');
	const raceKey = symbolsDocKey(CLIENT, 'hwSymbolsRace');
	const theirs = JSON.stringify({ theirs: true });
	RACE.set(raceKey, theirs);
	await scaffoldProject(CLIENT, 'hwSymbolsRace');
	assert(R2.get(raceKey)?.body === theirs, 'the scaffold clobbered a concurrent symbols save');
});

await check(
	'Book of Thermopylae: a lines project seeded with the preset and the Book-of scenes',
	async () => {
		await scaffoldProject(CLIENT, 'linesBook', { linesPreset: 'bookOfThermopylae' });
		const { updatedAt: _stamp, ...doc } = storedConfig('linesBook') ?? {};
		const { updatedAt: _none, ...preset } = gameConfigSeedFor('lines', 'bookOfThermopylae') ?? {};
		assert(JSON.stringify(doc) === JSON.stringify(preset), 'the seeded config is not the preset');
		const layout = JSON.parse(R2.get(editorDocKey(CLIENT, 'linesBook'))?.body ?? '{}');
		const book = engineOwnedOnly(getFullSceneSet(BOOK_OF_REFERENCE_SET)!);
		assert(layout.gameType === 'lines', `the layout is a ${layout.gameType} layout`);
		assert(
			JSON.stringify(layout.scenes) === JSON.stringify(book.scenes),
			'the scenes are not the Book-of reference set',
		);
		await scaffoldProject(CLIENT, 'waysBook', { linesPreset: 'bookOfThermopylae' });
		assert(!R2.has(gameConfigDocKey(CLIENT, 'waysBook')), 'a lines preset seeded a ways project');
		const ways = JSON.parse(R2.get(editorDocKey(CLIENT, 'waysBook'))?.body ?? '{}');
		assert(
			JSON.stringify(ways.scenes) ===
				JSON.stringify(engineOwnedOnly(getFullSceneSet('ways')!).scenes),
			'a ways project lost its own scenes',
		);
	},
);

await check('the editor loads the Book-of reference into a lines project as lines', async () => {
	assert(referenceLoadsAs(BOOK_OF_REFERENCE_SET) === 'lines', 'the Book-of set loads as lines');
	assert(referenceLoadsAs('lines') === 'lines', 'a kind loads as itself');
	assert(referenceLoadsAs('ways') === 'ways', 'so the Book-of set into ways is cross-type');
	assert(
		!listFullSceneSets().some((s) => s.gameType === BOOK_OF_REFERENCE_SET),
		'the Book-of set is not offered as a kind',
	);
	assert(
		listImportableKinds().some((s) => s.id === BOOK_OF_REFERENCE_SET),
		'the Book-of set is offered for import',
	);
});

if (failures) {
	console.error(`\ncheck:project-scaffold — ${failures} failure(s)`);
	process.exit(1);
}
console.log('\ncheck:project-scaffold — all passed');
