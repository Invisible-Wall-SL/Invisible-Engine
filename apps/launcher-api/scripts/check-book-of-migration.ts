/**
 * Contract check for the Book-of migration (`docs/design/book-feature.md` §6, Phase 6):
 *   pnpm --filter launcher-api check:book-of-migration
 *
 * Runs the REAL `bookOfMigration.ts`, the doc stores, the backups and the test-server manifest over
 * an in-memory R2; only R2, the project and game rows, the leases, the published pointer and the
 * publish itself are stubbed. The fixture is the live estate in miniature: the remake (authored,
 * published, with a stamped desktop build), an un-authored project, a pots project whose republish
 * a gate refuses, the partner game, the unstamped desktop build, a project someone is editing, and a
 * Lines control. What it pins:
 *  - the census and the dry run write nothing;
 *  - apply migrates config, layout and kind per project, each save under its ETag with a backup,
 *    republishes only test-server cards with a snapshot, reports a refusal instead of overriding it,
 *    never republishes the partner game, and leaves a blocked project byte-identical;
 *  - a save that loses its race is reported and finished by the next run;
 *  - a run after everything landed is a no-op;
 *  - the migrated configs ARE the game the lines mock deals as the book mock does: their contract is
 *    the Book of Thermopylae grid `check:expanding-symbol` plays against the book mock (Phase 3).
 */
import { readFileSync } from 'node:fs';
import { mock } from 'node:test';
import type { LiveLease } from '../src/lib/server/lease.ts';
import {
	addPotsOverlay,
	bookOfThermopylaePreset,
	normalizeGameConfigDoc,
	type GameConfigDoc,
} from 'game-config';

type Obj = { body: string; etag: string };
const R2 = new Map<string, Obj>();
let etagSeq = 0;
/** Keys a "concurrent author" saves between the migration's read and its write. */
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
		deleteObject: async (key: string) => R2.delete(key),
		deleteObjects: async (keys: string[]) => keys.forEach((k) => R2.delete(k)),
		listAllKeys: async (prefix: string) => sortedKeys(prefix),
		listAllObjects: async (prefix: string) =>
			sortedKeys(prefix).map((key) => ({ key, size: R2.get(key)!.body.length, lastModified: 1 })),
		listObjects: async () => ({ keys: [], prefixes: [] }),
	},
});

const CLIENT = 'invisible_wall';
const GAMES = 'https://games.invisiblewall.org';
/** The projects table: key → kind. */
const KINDS = new Map<string, string>([
	['bookofborutremake', 'bookOf'],
	['bookoffresh', 'bookOf'],
	['bookofpots', 'bookOf'],
	['bookofthermopylae', 'bookOf'],
	['bookofborut', 'bookOf'],
	['bookofleased', 'bookOf'],
	['hotfruits', 'lines'],
]);
const KIND_WRITES: string[] = [];
mock.module(src('lib/server/projects.ts'), {
	namedExports: {
		listProjects: async () =>
			[...KINDS].map(([key, gameType]) => ({ key, name: key, gameType, clientKey: CLIENT })),
		setProjectGameType: async (key: string, gameType: string) => {
			KIND_WRITES.push(`${key}=${gameType}`);
			KINDS.set(key, gameType);
		},
		projectGameType: async (key: string) => KINDS.get(key) ?? null,
		projectClientKey: async () => CLIENT,
	},
});

const testCard = (key: string) => ({
	key,
	projectKey: key,
	url: `${GAMES}/${key}/?runtime=1&sessionID=demo&rgs_url=games.invisiblewall.org/api/${key}&lang=en`,
});
/** The games table, by owning project. */
const CARDS: Record<string, { key: string; projectKey: string; url: string }[]> = {
	bookofborutremake: [
		testCard('bookofborutremake'),
		{ ...testCard('bookofborutremakebuild'), projectKey: 'bookofborutremake' },
	],
	bookofpots: [testCard('bookofpots')],
	bookofthermopylae: [
		{
			key: 'bookofthermopylae',
			projectKey: 'bookofthermopylae',
			url: `${GAMES}/bookofthermopylae/?runtime=1&rgs_profile=play4fun&lang=en`,
		},
	],
	bookofborut: [testCard('bookofborut')],
	hotfruits: [testCard('hotfruits')],
};
mock.module(src('lib/server/games.ts'), {
	namedExports: { listGamesOwnedByProject: async (key: string) => CARDS[key] ?? [] },
});

const LEASES: (LiveLease & { projectKey: string })[] = [
	{
		toolId: 'gameConfig',
		docKey: 'gameConfig',
		projectKey: 'bookofleased',
		holderSessionId: 'other',
		holderName: 'Ana',
	},
];
mock.module(src('lib/server/lease.ts'), {
	namedExports: {
		liveLeases: async (keys: { toolId: string; docKey: string; projectKey: string }[]) =>
			LEASES.filter((l) =>
				keys.some(
					(k) => k.toolId === l.toolId && k.docKey === l.docKey && k.projectKey === l.projectKey,
				),
			),
	},
});

/** Projects with a published runtime snapshot. */
const PUBLISHED = new Set(['bookofborutremake', 'bookofpots', 'bookofthermopylae', 'bookofborut']);
mock.module(src('lib/server/publishedRuntime.ts'), {
	namedExports: {
		currentPointer: async (_client: string, project: string) =>
			PUBLISHED.has(project) ? { version: 'v1' } : null,
		readSnapshotBundle: async () => null,
	},
});

class PublishBlockedError extends Error {
	constructor(
		message: string,
		readonly reason = 'own-bundle',
		readonly details: string[] = [],
	) {
		super(message);
	}
}
const PUBLISHES: string[] = [];
mock.module(src('lib/server/publishGame.ts'), {
	namedExports: {
		PublishBlockedError,
		publishGame: async (key: string, origin: string, opts: { by: string }) => {
			PUBLISHES.push(`${key} by ${opts.by} from ${origin}`);
			if (key === 'bookofpots') {
				throw new PublishBlockedError(
					'The pots overlay routes a pot to free spins the mock cannot deal.',
					'paytable-drift',
				);
			}
		},
	},
});
const INVALIDATED: string[] = [];
mock.module(src('lib/server/runtimeBundleCache.ts'), {
	namedExports: { invalidateRuntimeBundle: (project: string) => INVALIDATED.push(project) },
});

const { applyBookOfMigration, migrateBookOfConfig, planBookOfMigration } =
	await import('../src/lib/server/bookOfMigration.ts');
const { listBackups } = await import('../src/lib/server/docBackups.ts');
const { mockContractOfBundle } = await import('../src/lib/server/mockContract.ts');
const {
	editorDocBackupTarget,
	editorDocKey,
	editorTemplateKey,
	gameConfigDocBackupTarget,
	gameConfigDocKey,
} = await import('../src/lib/server/projectPaths.ts');
const { TEST_SERVER_MANIFEST_KEY } = await import('../src/lib/server/testServerManifest.ts');

let failures = 0;
async function check(name: string, fn: () => void | Promise<void>) {
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
const same = (a: unknown, b: unknown, msg: string) =>
	assert(
		JSON.stringify(a) === JSON.stringify(b),
		`${msg}\n  got  ${JSON.stringify(a)}\n  want ${JSON.stringify(b)}`,
	);
const normalized = (raw: unknown): GameConfigDoc => {
	const doc = normalizeGameConfigDoc(raw);
	assert(doc, 'config did not normalize');
	return doc;
};
const put = (key: string, value: unknown) =>
	R2.set(key, { body: JSON.stringify(value), etag: `"e${++etagSeq}"` });
const stored = <T>(key: string): T => JSON.parse(R2.get(key)!.body) as T;
const snapshot = () => JSON.stringify([...R2].sort(([a], [b]) => a.localeCompare(b)));
const configOf = (project: string) => stored<GameConfigDoc>(gameConfigDocKey(CLIENT, project));
const layoutOf = (project: string, gameType = 'bookOf') => ({
	version: 2,
	projectKey: project,
	gameType,
	mainSizesMap: {},
	scenes: [],
	updatedAt: '',
});
const linesTemplate = () =>
	normalized(
		JSON.parse(
			readFileSync(new URL('../src/lib/data/gameConfig/lines.json', import.meta.url), 'utf8'),
		),
	);
const PINNED_GRID: unknown = JSON.parse(
	readFileSync(
		new URL('../../../scripts/lib/book-of-thermopylae-lines-grid.json', import.meta.url),
		'utf8',
	),
);
const linesGrid = (config: GameConfigDoc, key: string) =>
	mockContractOfBundle('lines', { config, symbols: { map: {}, index: {} } }, key).grid;

// ─── the estate ───────────────────────────────────────────────────────────────────────────────

/** The remake as authored before Phase 5: the captured game without the mechanic's config. */
const remake = (): GameConfigDoc => {
	const doc = normalized(bookOfThermopylaePreset());
	doc.symbols.S = { special_properties: ['scatter'] };
	doc.paylines = linesTemplate().paylines;
	delete doc.freeSpins;
	doc.betModes.bonus = { ...doc.betModes.bonus, cost: 50 };
	doc.betModes.superBonus = { ...doc.betModes.bonus, cost: 300 };
	doc.betModePresentation = {
		bonus: { order: 1 },
		superBonus: { order: 2 },
	};
	return normalized(doc);
};
const pots = (): GameConfigDoc => {
	const doc = normalized(bookOfThermopylaePreset());
	doc.symbols.S = { special_properties: ['scatter'] };
	doc.betModes = { base: doc.betModes.base, freespins: { ...doc.betModes.bonus, cost: 80 } };
	const added = addPotsOverlay(doc, 'potsToFreeSpins');
	assert(added.ok, 'the pots overlay did not add');
	return added.doc;
};
const partner = (): GameConfigDoc => {
	const doc = normalized(bookOfThermopylaePreset());
	doc.symbols.S.special_properties = ['scatter'];
	return doc;
};

put(gameConfigDocKey(CLIENT, 'bookofborutremake'), remake());
put(editorDocKey(CLIENT, 'bookofborutremake'), layoutOf('bookofborutremake'));
put(gameConfigDocKey(CLIENT, 'bookofpots'), pots());
put(editorDocKey(CLIENT, 'bookofpots'), layoutOf('bookofpots'));
put(gameConfigDocKey(CLIENT, 'bookofthermopylae'), partner());
put(editorDocKey(CLIENT, 'bookofthermopylae'), layoutOf('bookofthermopylae'));
put(gameConfigDocKey(CLIENT, 'bookofborut'), remake());
put(editorDocKey(CLIENT, 'bookofborut'), layoutOf('bookofborut'));
put(gameConfigDocKey(CLIENT, 'bookofleased'), partner());
put(gameConfigDocKey(CLIENT, 'hotfruits'), linesTemplate());
put(editorDocKey(CLIENT, 'hotfruits'), layoutOf('hotfruits', 'lines'));
put(editorTemplateKey('bookOf'), { version: 2, scenes: [] });
const entry = (protocol: string, extra: Record<string, unknown>) => ({
	protocol,
	name: 'x',
	updatedAt: '2026-10-01T00:00:00.000Z',
	...extra,
});
put(TEST_SERVER_MANIFEST_KEY, {
	games: {
		bookofborutremake: entry('book', { runtime: 'lines', projectKey: 'bookofborutremake' }),
		bookofborutremakebuild: entry('book', { projectKey: 'bookofborutremake', tableCapable: true }),
		bookofpots: entry('book', { runtime: 'lines', projectKey: 'bookofpots' }),
		bookofborut: entry('book', {}),
		hotfruits: entry('lines', { runtime: 'lines', projectKey: 'hotfruits' }),
	},
});

const RUN = { gamesBaseUrl: GAMES, launcherOrigin: 'https://app.test', sessionId: 'me', by: 'owner@test' }; // prettier-ignore

// ─── the dry run ──────────────────────────────────────────────────────────────────────────────

console.info('the census and the dry run');

const before = snapshot();
const dry = await planBookOfMigration(GAMES);
const plan = (key: string) => {
	const found = dry.plans.find((p) => p.key === key);
	assert(found, `no plan for ${key}`);
	return found;
};

await check('the census and the dry run write nothing', () => {
	same(snapshot() === before, true, 'R2 unchanged');
	same([KIND_WRITES, PUBLISHES, INVALIDATED], [[], [], []], 'no kind, publish or cache write');
});

await check('the census: every bookOf row and nothing else, with its facts', () => {
	same(
		dry.census.projects.map((p) => [p.key, p.config, p.layoutGameType, p.published]),
		[
			['bookofborutremake', 'authored', 'bookOf', true],
			['bookoffresh', null, null, false],
			['bookofpots', 'authored', 'bookOf', true],
			['bookofthermopylae', 'authored', 'bookOf', true],
			['bookofborut', 'authored', 'bookOf', true],
			['bookofleased', 'authored', null, false],
		],
		'rows',
	);
	const facts = dry.census.projects.find((p) => p.key === 'bookofborutremake')!;
	same(facts.book, { symbol: 'S', specialProperties: ['scatter'] }, 'the book');
	same(facts.alreadyWild, false, 'not yet wild');
	same(facts.betModes.map((m) => [m.mode, m.kind, m.cost]), [['base', 'base', 1], ['bonus', 'buy', 50], ['superBonus', 'buy', 300]], 'bet modes'); // prettier-ignore
	same(facts.freeSpins, null, 'no freeSpins block');
	same(facts.manifest.map((m) => [m.key, m.runtime, m.tableCapable]), [['bookofborutremake', 'lines', false], ['bookofborutremakebuild', null, true]], 'manifest'); // prettier-ignore
	same(facts.cards.map((c) => [c.key, c.testServer]), [['bookofborutremake', true], ['bookofborutremakebuild', true]], 'cards'); // prettier-ignore
	same(dry.census.projects.find((p) => p.key === 'bookofpots')!.potsOverlay, true, 'pots');
	same(dry.census.projects.find((p) => p.key === 'bookofthermopylae')!.cards[0].testServer, false, 'the partner card'); // prettier-ignore
	same(dry.census.bookManifestEntries.map((m) => m.key), ['bookofborutremake', 'bookofborutremakebuild', 'bookofpots', 'bookofborut'], 'book entries'); // prettier-ignore
	same(dry.census.editorTemplate, true, 'the bookOf editor template');
});

await check('the plan: what each project would change, and what blocks it', () => {
	same(plan('bookofborutremake').blockers, [], 'remake not blocked');
	same(plan('bookofborutremake').config.changes.length, 6, 'remake: six config changes');
	same(plan('bookofborutremake').republish, { games: ['bookofborutremake'], skipped: [{ key: 'bookofborutremakebuild', why: 'a desktop build (its own bundle): rebuilt, not republished' }] }, 'remake republish'); // prettier-ignore
	same(plan('bookoffresh').config.changes, ['un-authored: the Book of Thermopylae preset is stored as its config'], 'fresh'); // prettier-ignore
	same(plan('bookofthermopylae').republish.games, [], 'the partner game is never republished');
	assert(plan('bookofthermopylae').republish.skipped[0].why.startsWith('not a test-server card'), 'partner why'); // prettier-ignore
	same(
		plan('bookofborut').blockers,
		['its desktop build "bookofborut" is not stamped table-capable — rebuild it from the desktop launcher first (☁ Publish)'],
		'the unstamped desktop build blocks',
	); // prettier-ignore
	for (const p of dry.plans) {
		console.log(`       ${p.key}: ${p.blockers.length ? `BLOCKED: ${p.blockers.join('; ')}` : [...p.config.changes, p.layout ?? 'layout: unchanged', p.kind, `republish [${p.republish.games.join(', ')}]`, ...p.republish.skipped.map((s) => `skip ${s.key}: ${s.why}`)].join(' | ')}`); // prettier-ignore
	}
});

// ─── apply ────────────────────────────────────────────────────────────────────────────────────

console.info('apply');

/** Every object of one project's two docs and their History. */
const blockedBefore = (key: string) =>
	JSON.stringify(
		[
			gameConfigDocKey(CLIENT, key),
			editorDocKey(CLIENT, key),
			...sortedKeys(gameConfigDocBackupTarget(CLIENT, key).prefix),
			...sortedKeys(editorDocBackupTarget(CLIENT, key).prefix),
		].map((k) => [k, R2.get(k)?.body ?? null]),
	);
const borutBefore = blockedBefore('bookofborut');
const leasedBefore = blockedBefore('bookofleased');
const remakeBeforeBody = R2.get(gameConfigDocKey(CLIENT, 'bookofborutremake'))!.body;
// A concurrent author creates the fresh project's config between the migration's read and write.
RACE.set(gameConfigDocKey(CLIENT, 'bookoffresh'), JSON.stringify(linesTemplate()));
const first = await applyBookOfMigration(RUN);
const result = (results: typeof first, key: string) => {
	const found = results.find((r) => r.key === key);
	assert(found, `no result for ${key}`);
	return found;
};

await check('per-project results', () => {
	same(
		first.map((r) => [r.key, r.status]),
		[
			['bookofborutremake', 'migrated'],
			['bookoffresh', 'error'],
			['bookofpots', 'migrated'],
			['bookofthermopylae', 'migrated'],
			['bookofborut', 'blocked'],
			['bookofleased', 'blocked'],
		],
		'statuses',
	);
	for (const r of first) {
		console.log(`       ${r.key} ${r.status}${r.error ? ` — ${r.error}` : ''}`);
		for (const step of r.steps) console.log(`         ${step}`);
	}
});

await check('the remake: config migrated to the captured game, the buy under its own name', () => {
	const doc = configOf('bookofborutremake');
	same(doc.symbols.S.special_properties, ['scatter', 'wild'], 'the book is wild');
	same(doc.symbols.S.paytable, [{ 3: 2 }, { 4: 20 }, { 5: 200 }], 'the scatter row, paid');
	same(Object.keys(doc.paylines).length, 10, 'ten paylines');
	same(doc.freeSpins?.retriggerAwards, [{ count: 3, spins: 10 }], 'retrigger +10');
	same(doc.freeSpins?.expandingSymbol, bookOfThermopylaePreset().freeSpins?.expandingSymbol, 'the expanding block'); // prettier-ignore
	same(Object.entries(doc.betModes).map(([m, b]) => [m, b.cost]), [['base', 1], ['bonus', 100]], 'base + the 100× buy'); // prettier-ignore
	same(
		Object.keys(doc.betModePresentation ?? {}),
		['bonus'],
		'presentation follows the kept modes',
	);
});

await check('every save carries a History backup of what it replaced', async () => {
	const configBackups = await listBackups(gameConfigDocBackupTarget(CLIENT, 'bookofborutremake'));
	assert(configBackups.length === 1, `config backups: ${configBackups.length}`);
	const layoutBackups = await listBackups(editorDocBackupTarget(CLIENT, 'bookofborutremake'));
	assert(layoutBackups.length === 1, `layout backups: ${layoutBackups.length}`);
	assert(
		[...R2.values()].some((o) => o.body === remakeBeforeBody),
		'the backup holds the pre-migration config',
	);
});

await check('layout and kind: bookOf → lines, after the docs', () => {
	for (const key of ['bookofborutremake', 'bookofpots', 'bookofthermopylae']) {
		same(
			stored<{ gameType: string }>(editorDocKey(CLIENT, key)).gameType,
			'lines',
			`${key} layout`,
		);
	}
	same(KIND_WRITES, ['bookofborutremake=lines', 'bookofpots=lines', 'bookofthermopylae=lines'], 'kinds'); // prettier-ignore
	same(INVALIDATED, ['bookofborutremake', 'bookofpots', 'bookofthermopylae'], 'bundle caches');
});

await check('republish: test-server cards only; a refusal reported, never overridden', () => {
	same(PUBLISHES, ['bookofborutremake by owner@test from https://app.test', 'bookofpots by owner@test from https://app.test'], 'publishes'); // prettier-ignore
	assert(
		result(first, 'bookofpots').steps.some((s) => s.startsWith('republish bookofpots: REFUSED (paytable-drift)')),
		'the pots refusal is reported',
	); // prettier-ignore
	assert(
		result(first, 'bookofthermopylae').steps.some((s) => s.startsWith('republish bookofthermopylae: skipped — not a test-server card')),
		'the partner game is skipped',
	); // prettier-ignore
});

await check('the pots project keeps its overlay and its buy name', () => {
	const doc = configOf('bookofpots');
	assert(doc.potsOverlay, 'overlay kept');
	same(Object.entries(doc.betModes).map(([m, b]) => [m, b.cost]), [['base', 1], ['freespins', 100]], 'bet modes'); // prettier-ignore
});

await check('a blocked project is left byte-identical, its kind unmoved', () => {
	same(blockedBefore('bookofborut') === borutBefore, true, 'the desktop build project');
	same(blockedBefore('bookofleased') === leasedBefore, true, 'the leased project');
	same([KINDS.get('bookofborut'), KINDS.get('bookofleased')], ['bookOf', 'bookOf'], 'kinds');
	assert(result(first, 'bookofleased').error?.startsWith('Ana is editing /config'), 'the lease is named'); // prettier-ignore
});

await check('a save that loses its race is reported; the project is not half-moved', () => {
	same(result(first, 'bookoffresh').error, 'a doc was saved by someone else meanwhile — run the migration again', 'error'); // prettier-ignore
	same(KINDS.get('bookoffresh'), 'bookOf', 'kind unmoved');
	same(configOf('bookoffresh'), linesTemplate(), 'the author’s save stands');
});

console.info('re-runs');

const second = await applyBookOfMigration(RUN);
await check('the next run finishes what lost its race, and only that', () => {
	same(second.map((r) => [r.key, r.status]), [['bookoffresh', 'migrated'], ['bookofborut', 'blocked'], ['bookofleased', 'blocked']], 'statuses'); // prettier-ignore
	same(KINDS.get('bookoffresh'), 'lines', 'kind');
	same(configOf('bookoffresh').symbols.S.special_properties, ['scatter', 'wild'], 'the raced config, migrated'); // prettier-ignore
});

await check('a run after everything landed is a no-op', async () => {
	const settled = snapshot();
	const writes = [KIND_WRITES.length, PUBLISHES.length, INVALIDATED.length];
	const third = await applyBookOfMigration(RUN);
	same(
		third.map((r) => r.status),
		['blocked', 'blocked'],
		'only the blocked projects remain',
	);
	same(snapshot() === settled, true, 'R2 unchanged');
	same([KIND_WRITES.length, PUBLISHES.length, INVALIDATED.length], writes, 'no kind, publish or cache write'); // prettier-ignore
	for (const key of ['bookofborutremake', 'bookofpots', 'bookofthermopylae']) {
		same(migrateBookOfConfig(configOf(key)).changes, [], `${key}: migrating again changes nothing`);
	}
});

// ─── equivalence ──────────────────────────────────────────────────────────────────────────────

console.info('the migrated game is the one the book mock deals (Phase 3 comparison)');

await check(
	'the remake, the un-authored preset and the partner deal the Book of Thermopylae grid',
	() => {
		same(linesGrid(configOf('bookofborutremake'), 'bookofborutremake'), PINNED_GRID, 'remake');
		same(linesGrid(migrateBookOfConfig(null).doc!, 'fresh'), PINNED_GRID, 'un-authored');
		same(linesGrid(configOf('bookofthermopylae'), 'bookofthermopylae'), PINNED_GRID, 'partner');
	},
);

await check('a board the book mock cannot deal is blocked, not reshaped', () => {
	const doc = remake();
	doc.numReels = 6;
	doc.numRows = [3, 3, 3, 3, 3, 3];
	const out = migrateBookOfConfig(doc);
	same([out.doc, out.blockers.length], [null, 1], 'blocked');
});

if (failures) {
	console.error(`\ncheck:book-of-migration — ${failures} failure(s)`);
	process.exit(1);
}
console.log('\ncheck:book-of-migration — all passed');
