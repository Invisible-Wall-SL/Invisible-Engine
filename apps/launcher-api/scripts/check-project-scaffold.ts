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
 *  - the scaffold never overwrites an authored config, and loses a concurrent first save quietly.
 */
import { mock } from 'node:test';
import { holdAndWinMockInputs, normalizeGameConfigDoc } from 'game-config';

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
	lines: 'lines',
	ways: 'ways',
	scatter: 'scatter',
	cluster: 'cluster',
	book: 'bookOf',
};
mock.module(src('lib/server/projects.ts'), {
	namedExports: {
		projectGameType: async (p: string) => GAME_TYPES[p] ?? 'lines',
	},
});

const { scaffoldProject } = await import('../src/lib/server/projectScaffold.ts');
const { gameConfigDocKey } = await import('../src/lib/server/projectPaths.ts');
const { gameConfigDefaultFor } = await import('../src/lib/server/gameConfigDefaults.ts');

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

await check('every other kind stays un-authored', async () => {
	for (const project of ['lines', 'ways', 'scatter', 'cluster', 'book']) {
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

if (failures) {
	console.error(`\ncheck:project-scaffold — ${failures} failure(s)`);
	process.exit(1);
}
console.log('\ncheck:project-scaffold — all passed');
