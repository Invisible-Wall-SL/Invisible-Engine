/**
 * Contract check for the Book-of migration (`docs/design/book-feature.md` §6, Phase 6):
 *   pnpm --filter launcher-api check:book-of-migration
 *
 * Runs the REAL `bookOfMigration.ts`, the REAL `publishGame.ts` (its gates, the mock contract it
 * derives and the test-server manifest it writes), the doc stores and the backups over an in-memory
 * R2. Stubbed: R2, the project and game rows, the leases, the snapshot store, the bundle assemble,
 * the sound and flow checks, and the test server's refresh. The estate is the live one in
 * miniature plus the edge cases. What it pins:
 *  - the census and the dry run write nothing;
 *  - a refusing publish gate, a held lease, an unstamped desktop build, free spins switched off and
 *    no scatter each BLOCK a project before anything of it is written;
 *  - apply migrates config, layout and kind, each save under its ETag with a backup, republishes
 *    only the project's own test-server card (never a desktop build, never the partner game), and
 *    the republished manifest entry deals the Book of Thermopylae grid on the lines mock;
 *  - an author's own expanding block and retrigger table are kept;
 *  - a save that loses its race, and a kind changed meanwhile, are reported and never overwritten;
 *  - a republish that fails after the kind moved is remembered and retried by the next run;
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
		deleteObject: async (key: string) => void R2.delete(key),
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
	['bookoffreeoff', 'bookOf'],
	['bookofkept', 'bookOf'],
	['bookofflaky', 'bookOf'],
	['bookofkindrace', 'bookOf'],
	['hotfruits', 'lines'],
]);
const KIND_WRITES: string[] = [];
/** A kind someone else sets between the migration's read and its switch. */
const KIND_RACE = new Map<string, string>();
mock.module(src('lib/server/projects.ts'), {
	namedExports: {
		listProjects: async () =>
			[...KINDS].map(([key, gameType]) => ({ key, name: key, gameType, clientKey: CLIENT })),
		switchProjectGameType: async (key: string, from: string, to: string) => {
			const raced = KIND_RACE.get(key);
			if (raced !== undefined) {
				KIND_RACE.delete(key);
				KINDS.set(key, raced);
			}
			if (KINDS.get(key) !== from) return false;
			KIND_WRITES.push(`${key}=${to}`);
			KINDS.set(key, to);
			return true;
		},
		projectGameType: async (key: string) => KINDS.get(key) ?? null,
		projectClientKey: async () => CLIENT,
		projectName: async (key: string) => key,
		getOrMintReadToken: async (key: string) => `tok-${key}`,
	},
});

const testUrl = (key: string) =>
	`${GAMES}/${key}/?runtime=1&sessionID=demo&rgs_url=games.invisiblewall.org/api/${key}&lang=en`;
/** The games table, by owning project. */
const CARDS: Record<string, { key: string; url: string }[]> = {
	bookofborutremake: [
		{ key: 'bookofborutremake', url: testUrl('bookofborutremake') },
		{ key: 'bookofborutremakebuild', url: testUrl('bookofborutremakebuild') },
	],
	bookofpots: [{ key: 'bookofpots', url: testUrl('bookofpots') }],
	bookofthermopylae: [
		{
			key: 'bookofthermopylae',
			url: `${GAMES}/bookofthermopylae/?runtime=1&rgs_profile=play4fun&lang=en`,
		},
	],
	bookofborut: [{ key: 'bookofborut', url: testUrl('bookofborut') }],
	bookofflaky: [{ key: 'bookofflaky', url: testUrl('bookofflaky') }],
	hotfruits: [{ key: 'hotfruits', url: testUrl('hotfruits') }],
};
mock.module(src('lib/server/games.ts'), {
	namedExports: {
		listGamesOwnedByProject: async (key: string) => CARDS[key] ?? [],
		gameExists: async () => true,
		createGame: async () => undefined,
		renameGame: async () => undefined,
		setGameProject: async () => undefined,
		setGameUrl: async () => undefined,
	},
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

/** The snapshot players boot, per project: the config it froze. */
const SNAPSHOTS = new Map<string, GameConfigDoc | null>();
let snapshotSeq = 0;
mock.module(src('lib/server/publishedRuntime.ts'), {
	namedExports: {
		currentPointer: async (_client: string, project: string) =>
			SNAPSHOTS.has(project) ? { version: 1, current: 'live', snapshots: [] } : null,
		readSnapshotBundle: async () => null,
		stageSnapshot: async () => ({
			id: `s${++snapshotSeq}`,
			createdAt: '2026-10-08T00:00:00.000Z',
			by: null,
			flow: 'absent',
			files: 0,
			bytes: 0,
		}),
		commitSnapshot: async () => undefined,
		discardSnapshot: async () => undefined,
	},
});

/** Projects whose next assemble fails with a non-gate error (R2 down, a timeout). */
const ASSEMBLE_FAILS = new Set<string>();
const PUBLISHES: string[] = [];
mock.module(src('lib/server/runtimeBundle.ts'), {
	namedExports: {
		buildRuntimeBundle: async (project: string) => {
			if (ASSEMBLE_FAILS.delete(project)) throw new Error('R2 timed out while assembling');
			const config = normalizeGameConfigDoc(
				JSON.parse(R2.get(gameConfigDocKey(CLIENT, project))?.body ?? 'null'),
			);
			PUBLISHES.push(project);
			SNAPSHOTS.set(project, config ?? null);
			return {
				config,
				symbols: { map: {}, index: {} },
				doc: { scenes: [] },
				componentDefs: {},
				editorArt: { spinesMissing: [] },
			};
		},
	},
});
/** Projects with a sound still marked draft — the publish's sound gate refuses them. */
const DRAFT_SOUNDS: Record<string, string[]> = { bookofpots: ['pot_win'] };
mock.module(src('lib/server/soundPublishCheck.ts'), {
	namedExports: {
		checkSoundsForPublish: async (_client: string, project: string) => ({
			unapproved: DRAFT_SOUNDS[project] ?? [],
			licences: { total: 0, approved: 0, byLicence: {} },
		}),
	},
});
mock.module(src('lib/server/flowV2Validation.ts'), {
	namedExports: {
		checkFlowV2ForPublish: async () => ({ status: 'absent' }),
		checkShippedFlowV2: async () => ({ status: 'absent' }),
		describeFlowErrors: () => [],
		flowScreensMissing: () => [],
		invalidFlowMessage: () => '',
	},
});
const INVALIDATED: string[] = [];
mock.module(src('lib/server/runtimeBundleCache.ts'), {
	namedExports: {
		invalidateRuntimeBundle: (project: string) => INVALIDATED.push(project),
		withDeployWrite: async <T>(_project: string, run: () => Promise<T>) => run(),
	},
});
mock.module(src('lib/server/testServerRefresh.ts'), {
	namedExports: { postTestServerRefresh: async () => new Response(null, { status: 202 }) },
});

const { applyBookOfMigrationTo, migrateBookOfConfig, planBookOfMigration } =
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
const manifestEntry = (game: string) =>
	stored<{ games: Record<string, { protocol: string; grid?: unknown }> }>(TEST_SERVER_MANIFEST_KEY)
		.games[game];
/** Every object of one project's two docs and their History. */
const projectObjects = (key: string) =>
	JSON.stringify(
		[
			gameConfigDocKey(CLIENT, key),
			editorDocKey(CLIENT, key),
			...sortedKeys(gameConfigDocBackupTarget(CLIENT, key).prefix),
			...sortedKeys(editorDocBackupTarget(CLIENT, key).prefix),
		].map((k) => [k, R2.get(k)?.body ?? null]),
	);
const PENDING = (key: string) => `_shared/migrations/book-of/${key}.json`;
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

/** The captured game without the book's wild — what the partner and most copies store. */
const unwild = (): GameConfigDoc => {
	const doc = normalized(bookOfThermopylaePreset());
	doc.symbols.S.special_properties = ['scatter'];
	return doc;
};
/** The remake as authored before Phase 5: the captured game without the mechanic's config. */
const remake = (): GameConfigDoc => {
	const doc = normalized(bookOfThermopylaePreset());
	doc.symbols.S = { special_properties: ['scatter'] };
	doc.paylines = linesTemplate().paylines;
	delete doc.freeSpins;
	doc.betModes.bonus = { ...doc.betModes.bonus, cost: 50 };
	doc.betModes.superBonus = { ...doc.betModes.bonus, cost: 300 };
	doc.betModePresentation = { bonus: { order: 1 }, superBonus: { order: 2 } };
	return normalized(doc);
};
const pots = (): GameConfigDoc => {
	const doc = unwild();
	doc.betModes = { base: doc.betModes.base, freespins: { ...doc.betModes.bonus, cost: 80 } };
	const added = addPotsOverlay(doc, 'potsToFreeSpins');
	assert(added.ok, 'the pots overlay did not add');
	return added.doc;
};
const freeOff = (): GameConfigDoc => {
	const doc = unwild();
	doc.freeSpins = { ...doc.freeSpins, enabled: false };
	return normalized(doc);
};
const KEPT_FREE_SPINS = {
	enabled: true,
	retriggerAwards: [{ count: 3, spins: 5 }],
	expandingSymbol: { weights: { H1: 1, L5: 3 } },
};
const kept = (): GameConfigDoc => normalized({ ...unwild(), freeSpins: KEPT_FREE_SPINS });

put(gameConfigDocKey(CLIENT, 'bookofborutremake'), remake());
put(editorDocKey(CLIENT, 'bookofborutremake'), layoutOf('bookofborutremake'));
put(gameConfigDocKey(CLIENT, 'bookofpots'), pots());
put(editorDocKey(CLIENT, 'bookofpots'), layoutOf('bookofpots'));
put(gameConfigDocKey(CLIENT, 'bookofthermopylae'), unwild());
put(editorDocKey(CLIENT, 'bookofthermopylae'), layoutOf('bookofthermopylae'));
put(gameConfigDocKey(CLIENT, 'bookofborut'), remake());
put(editorDocKey(CLIENT, 'bookofborut'), layoutOf('bookofborut'));
put(gameConfigDocKey(CLIENT, 'bookofleased'), unwild());
put(gameConfigDocKey(CLIENT, 'bookoffreeoff'), freeOff());
put(gameConfigDocKey(CLIENT, 'bookofkept'), kept());
put(gameConfigDocKey(CLIENT, 'bookofflaky'), unwild());
put(editorDocKey(CLIENT, 'bookofflaky'), layoutOf('bookofflaky'));
put(gameConfigDocKey(CLIENT, 'hotfruits'), linesTemplate());
put(editorDocKey(CLIENT, 'hotfruits'), layoutOf('hotfruits', 'lines'));
put(editorTemplateKey('bookOf'), { version: 2, scenes: [] });
// The desktop builds' own bundles.
put('test_server/bookofborut/index.html', '<html>');
put('test_server/bookofborutremakebuild/index.html', '<html>');
for (const key of ['bookofborutremake', 'bookofpots', 'bookofthermopylae', 'bookofborut', 'bookofflaky']) {
	SNAPSHOTS.set(key, null);
} // prettier-ignore
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
		bookofborut: entry('book', { projectKey: 'bookofborut' }),
		bookofflaky: entry('book', { runtime: 'lines', projectKey: 'bookofflaky' }),
		hotfruits: entry('lines', { runtime: 'lines', projectKey: 'hotfruits' }),
	},
});

const RUN = { gamesBaseUrl: GAMES, launcherOrigin: 'https://app.test', sessionId: 'me', by: 'owner@test' }; // prettier-ignore
/** What the page does: the dry run, then one request per planned project. */
const applyAll = async () => {
	const { plans } = await planBookOfMigration(GAMES);
	const out = [];
	for (const plan of plans) out.push(await applyBookOfMigrationTo(plan.key, RUN));
	return out;
};
type Results = Awaited<ReturnType<typeof applyAll>>;
const result = (results: Results, key: string) => {
	const found = results.find((r) => r.key === key);
	assert(found, `no result for ${key}`);
	return found;
};
const print = (results: Results) => {
	for (const r of results) {
		console.log(`       ${r.key} ${r.status}${r.error ? ` — ${r.error}` : ''}`);
		for (const step of r.steps) console.log(`         ${step}`);
	}
};

// ─── the pure config step ─────────────────────────────────────────────────────────────────────

console.info('the config step');

await check('what it cannot migrate without guessing blocks, and writes nothing', () => {
	const wide = remake();
	wide.numReels = 6;
	wide.numRows = [3, 3, 3, 3, 3, 3];
	const bookless = unwild();
	delete bookless.symbols.S;
	bookless.paddingReels = Object.fromEntries(
		Object.entries(bookless.paddingReels).map(([mode, reels]) => [
			mode,
			reels.map((reel) => reel.filter((cell) => cell.name !== 'S')),
		]),
	);
	for (const [label, doc, want] of [
		['a 6-reel board', wide, "not the book mock's 5×3"],
		['no scatter', normalized(bookless), 'no scatter on the strips'],
		['free spins off', freeOff(), 'free spins are off'],
	] as const) {
		const out = migrateBookOfConfig(doc);
		assert(out.doc === null, `${label}: no doc`);
		assert(out.blockers.length === 1 && out.blockers[0].includes(want), `${label}: ${out.blockers.join('; ')}`); // prettier-ignore
	}
});

await check('an author’s expanding block, retrigger table and switch are kept', () => {
	const out = migrateBookOfConfig(kept());
	assert(out.doc, out.blockers.join('; '));
	same(out.doc.freeSpins, kept().freeSpins, 'free spins as authored');
	same(out.doc.symbols.S.special_properties, ['scatter', 'wild'], 'the book is still made wild');
});

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
		dry.census.projects.map((p) => p.key),
		[...KINDS].filter(([, kind]) => kind === 'bookOf').map(([key]) => key),
		'rows',
	);
	const facts = dry.census.projects.find((p) => p.key === 'bookofborutremake')!;
	same([facts.config, facts.layoutGameType, facts.published], ['authored', 'bookOf', true], 'state'); // prettier-ignore
	same(facts.book, { symbol: 'S', specialProperties: ['scatter'] }, 'the book');
	same(facts.alreadyWild, false, 'not yet wild');
	same(facts.betModes.map((m) => [m.mode, m.kind, m.cost]), [['base', 'base', 1], ['bonus', 'buy', 50], ['superBonus', 'buy', 300]], 'bet modes'); // prettier-ignore
	same(facts.manifest.map((m) => [m.key, m.runtime, m.tableCapable]), [['bookofborutremake', 'lines', false], ['bookofborutremakebuild', null, true]], 'manifest'); // prettier-ignore
	same(facts.cards.map((c) => [c.key, c.testServer, c.desktop]), [['bookofborutremake', true, false], ['bookofborutremakebuild', true, true]], 'cards'); // prettier-ignore
	same(dry.census.projects.find((p) => p.key === 'bookoffresh')!.config, null, 'un-authored');
	same(dry.census.projects.find((p) => p.key === 'bookofpots')!.potsOverlay, true, 'pots');
	same(dry.census.projects.find((p) => p.key === 'bookofthermopylae')!.cards[0].testServer, false, 'the partner card'); // prettier-ignore
	same(dry.census.bookManifestEntries.map((m) => m.key), ['bookofborutremake', 'bookofborutremakebuild', 'bookofpots', 'bookofborut', 'bookofflaky'], 'book entries'); // prettier-ignore
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
	same(plan('bookofborut').republish.games, [], 'a desktop card under the project key is not a republish target'); // prettier-ignore
	assert(
		plan('bookofpots').blockers.some((b) => b.startsWith('its republish of "bookofpots" would be refused — unapproved-sounds: 1 sound the game plays is still marked draft: pot_win.')),
		`the pots gate blocks before anything is written: ${plan('bookofpots').blockers.join('; ')}`,
	); // prettier-ignore
	assert(plan('bookoffreeoff').blockers[0]?.startsWith('free spins are off'), 'free spins off blocks'); // prettier-ignore
	for (const p of dry.plans) {
		console.log(`       ${p.key}: ${p.blockers.length ? `BLOCKED: ${p.blockers.join('; ')}` : [...p.config.changes, p.layout ?? 'layout: unchanged', p.kind, `republish [${p.republish.games.join(', ')}]`, ...p.republish.skipped.map((s) => `skip ${s.key}: ${s.why}`)].join(' | ')}`); // prettier-ignore
	}
});

// ─── apply ────────────────────────────────────────────────────────────────────────────────────

console.info('apply');

const untouched = ['bookofborut', 'bookofpots', 'bookofleased', 'bookoffreeoff'];
const untouchedBefore = untouched.map(projectObjects);
const remakeBeforeBody = R2.get(gameConfigDocKey(CLIENT, 'bookofborutremake'))!.body;
// A concurrent author creates the fresh project's config between the migration's read and write;
// someone moves another project to Ways meanwhile; the flaky project's republish fails once.
RACE.set(gameConfigDocKey(CLIENT, 'bookoffresh'), JSON.stringify(linesTemplate()));
KIND_RACE.set('bookofkindrace', 'ways');
ASSEMBLE_FAILS.add('bookofflaky');
const first = await applyAll();

await check('per-project results: one failure never stops the others', () => {
	same(
		first.map((r) => [r.key, r.status]),
		[
			['bookofborutremake', 'migrated'],
			['bookoffresh', 'error'],
			['bookofpots', 'blocked'],
			['bookofthermopylae', 'migrated'],
			['bookofborut', 'blocked'],
			['bookofleased', 'blocked'],
			['bookoffreeoff', 'blocked'],
			['bookofkept', 'migrated'],
			['bookofflaky', 'republish-pending'],
			['bookofkindrace', 'error'],
		],
		'statuses',
	);
	print(first);
});

await check('the remake: config migrated to the captured game, the buy under its own name', () => {
	const doc = configOf('bookofborutremake');
	same(doc.symbols.S.special_properties, ['scatter', 'wild'], 'the book is wild');
	same(doc.symbols.S.paytable, [{ 3: 2 }, { 4: 20 }, { 5: 200 }], 'the scatter row, paid');
	same(Object.keys(doc.paylines).length, 10, 'ten paylines');
	same(doc.freeSpins?.retriggerAwards, [{ count: 3, spins: 10 }], 'retrigger +10');
	same(doc.freeSpins?.expandingSymbol, bookOfThermopylaePreset().freeSpins?.expandingSymbol, 'the expanding block'); // prettier-ignore
	same(Object.entries(doc.betModes).map(([m, b]) => [m, b.cost]), [['base', 1], ['bonus', 100]], 'base + the 100× buy'); // prettier-ignore
	same(Object.keys(doc.betModePresentation ?? {}), ['bonus'], 'presentation follows the modes');
});

await check(
	'the remake republished: its snapshot carries the block, its manifest deals the grid',
	() => {
		assert(
			SNAPSHOTS.get('bookofborutremake')?.freeSpins?.expandingSymbol,
			'snapshot has the block',
		);
		const live = manifestEntry('bookofborutremake');
		same(live.protocol, 'lines', 'the lines mock deals it');
		same(live.grid, PINNED_GRID, 'the Book of Thermopylae grid');
		same(
			manifestEntry('bookofborutremakebuild').protocol,
			'book',
			'the desktop build is not touched',
		);
	},
);

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

await check('layout and kind move after the docs; publishes only test-server cards', () => {
	for (const key of ['bookofborutremake', 'bookofthermopylae', 'bookofflaky']) {
		same(stored<{ gameType: string }>(editorDocKey(CLIENT, key)).gameType, 'lines', `${key} layout`); // prettier-ignore
	}
	same(KIND_WRITES, ['bookofborutremake=lines', 'bookofthermopylae=lines', 'bookofkept=lines', 'bookofflaky=lines'], 'kinds'); // prettier-ignore
	same(PUBLISHES, ['bookofborutremake'], 'only the remake republished (flaky failed)');
	assert(
		result(first, 'bookofthermopylae').steps.some((s) => s.startsWith('republish bookofthermopylae: skipped — not a test-server card')),
		'the partner game is skipped',
	); // prettier-ignore
});

await check('a project an author configured keeps its expanding block and retrigger', () => {
	same(configOf('bookofkept').freeSpins, kept().freeSpins, 'free spins as authored');
});

await check('a blocked project is left byte-identical, its kind unmoved', () => {
	same(untouched.map(projectObjects), untouchedBefore, 'docs and History');
	same(
		untouched.map((k) => KINDS.get(k)),
		untouched.map(() => 'bookOf'),
		'kinds',
	);
	assert(result(first, 'bookofleased').error?.startsWith('Ana is editing /config'), 'the lease is named'); // prettier-ignore
	same(Object.keys(configOf('bookoffreeoff').betModes), ['base', 'bonus'], 'free spins off: the buy is kept'); // prettier-ignore
});

await check('a save that loses its race is reported; the project is not half-moved', () => {
	same(result(first, 'bookoffresh').error, 'a doc was saved by someone else meanwhile. It is still listed: run the migration again.', 'error'); // prettier-ignore
	same(KINDS.get('bookoffresh'), 'bookOf', 'kind unmoved');
	same(configOf('bookoffresh'), linesTemplate(), 'the author’s save stands');
});

await check('a kind changed meanwhile is never overwritten', () => {
	same(KINDS.get('bookofkindrace'), 'ways', 'kind left as set');
	same(
		result(first, 'bookofkindrace').error,
		"its kind is now 'ways' — changed meanwhile, left alone. It is no longer listed, so a re-run will not pick it up: check it by hand (the steps above were written).",
		'reported, without promising a re-run',
	);
});

await check('a republish that fails after the kind moved is remembered', async () => {
	same(KINDS.get('bookofflaky'), 'lines', 'kind moved');
	assert(R2.has(PENDING('bookofflaky')), 'pending marker');
	assert(result(first, 'bookofflaky').steps.some((s) => s.startsWith('republish bookofflaky: FAILED — R2 timed out')), 'reported'); // prettier-ignore
	const again = await planBookOfMigration(GAMES);
	const facts = again.census.projects.find((p) => p.key === 'bookofflaky');
	same(facts?.pendingRepublish, ['bookofflaky'], 'the census lists it although it is Lines now');
	same(again.plans.find((p) => p.key === 'bookofflaky')?.republish.games, ['bookofflaky'], 'planned again'); // prettier-ignore
});

console.info('re-runs');

// The owner rebuilds bookofborut from the desktop launcher, which stamps it.
const manifest = stored<{ games: Record<string, Record<string, unknown>> }>(
	TEST_SERVER_MANIFEST_KEY,
);
manifest.games.bookofborut.tableCapable = true;
put(TEST_SERVER_MANIFEST_KEY, manifest);
const second = await applyAll();

await check('the next run finishes what lost its race or failed, and the rebuilt build', () => {
	print(second);
	same(
		second.map((r) => [r.key, r.status]),
		[
			['bookoffresh', 'migrated'],
			['bookofpots', 'blocked'],
			['bookofborut', 'migrated'],
			['bookofleased', 'blocked'],
			['bookoffreeoff', 'blocked'],
			['bookofflaky', 'migrated'],
		],
		'statuses',
	);
	same(configOf('bookoffresh').symbols.S.special_properties, ['scatter', 'wild'], 'the raced config, migrated'); // prettier-ignore
	same(
		PUBLISHES,
		['bookofborutremake', 'bookofflaky'],
		'flaky republished; the desktop build never',
	);
	same(manifestEntry('bookofflaky').protocol, 'lines', 'flaky on the lines mock');
	same(R2.has(PENDING('bookofflaky')), false, 'its pending marker is gone');
	assert(result(second, 'bookofborut').steps.includes('republish bookofborut: skipped — a desktop build (its own bundle): rebuilt, not republished'), 'the desktop card is skipped'); // prettier-ignore
	same(manifestEntry('bookofborut').protocol, 'book', 'the desktop entry is left for its rebuild');
});

await check('a run after everything landed is a no-op', async () => {
	const settled = snapshot();
	const writes = [KIND_WRITES.length, PUBLISHES.length, INVALIDATED.length];
	const third = await applyAll();
	same(third.map((r) => [r.key, r.status]), [['bookofpots', 'blocked'], ['bookofleased', 'blocked'], ['bookoffreeoff', 'blocked']], 'only the blocked projects remain'); // prettier-ignore
	same(snapshot() === settled, true, 'R2 unchanged');
	same([KIND_WRITES.length, PUBLISHES.length, INVALIDATED.length], writes, 'no kind, publish or cache write'); // prettier-ignore
	for (const key of ['bookofborutremake', 'bookofthermopylae', 'bookofkept', 'bookofflaky']) {
		same(migrateBookOfConfig(configOf(key)).changes, [], `${key}: migrating again changes nothing`);
	}
	same(
		(await applyBookOfMigrationTo('bookofborutremake', RUN)).status,
		'nothing-to-do',
		'a migrated key',
	);
});

// ─── equivalence ──────────────────────────────────────────────────────────────────────────────

console.info('the migrated game is the one the book mock deals (Phase 3 comparison)');

await check('the remake, the un-authored preset and the partner deal the Thermopylae grid', () => {
	same(linesGrid(configOf('bookofborutremake'), 'bookofborutremake'), PINNED_GRID, 'remake');
	same(linesGrid(migrateBookOfConfig(null).doc!, 'fresh'), PINNED_GRID, 'un-authored');
	same(linesGrid(configOf('bookofthermopylae'), 'bookofthermopylae'), PINNED_GRID, 'partner');
});

if (failures) {
	console.error(`\ncheck:book-of-migration — ${failures} failure(s)`);
	process.exit(1);
}
console.log('\ncheck:book-of-migration — all passed');
