/**
 * Contract check for the Book-of census (`docs/design/book-feature.md` §7, Phase 7):
 *   pnpm --filter launcher-api check:book-of-census
 *
 * Runs the REAL `bookOfCensus.ts` and test-server manifest reader over an in-memory R2; only R2 and
 * the project rows are stubbed. Phase 7 merges only while the census is clear, so it pins that each
 * of the four leftovers — a `bookOf` row, a `book` manifest entry, the `bookOf` editor template, a
 * pending migration republish — is reported and keeps it from being clear, and that the census
 * writes nothing.
 */
import { mock } from 'node:test';

const R2 = new Map<string, string>();
const sortedKeys = (prefix: string) => [...R2.keys()].filter((k) => k.startsWith(prefix)).sort();
const src = (rel: string) => new URL(`../src/${rel}`, import.meta.url).href;
class ConflictError extends Error {}
mock.module(src('lib/server/r2.ts'), {
	namedExports: {
		ConflictError,
		precondition: () => undefined,
		objectExists: async (key: string) => R2.has(key),
		headObject: async () => null,
		getObjectText: async (key: string) => R2.get(key) ?? null,
		getObjectTextWithEtag: async (key: string) =>
			R2.has(key) ? { text: R2.get(key)!, etag: '"e"' } : null,
		putObjectText: async () => {
			throw new Error('the census wrote to R2');
		},
		listAllKeys: async (prefix: string) => sortedKeys(prefix),
	},
});
const ROWS: { key: string; name: string; gameType: string }[] = [];
mock.module(src('lib/server/projects.ts'), {
	namedExports: { listProjects: async () => ROWS },
});

const { bookOfCensus } = await import('../src/lib/server/bookOfCensus.ts');
const { editorTemplateKey } = await import('../src/lib/server/projectPaths.ts');
const { TEST_SERVER_MANIFEST_KEY } = await import('../src/lib/server/testServerManifest.ts');

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
const same = (a: unknown, b: unknown, msg: string) => {
	if (JSON.stringify(a) !== JSON.stringify(b)) {
		throw new Error(`${msg}\n  got  ${JSON.stringify(a)}\n  want ${JSON.stringify(b)}`);
	}
};
const manifest = (games: Record<string, Record<string, unknown>>) =>
	R2.set(TEST_SERVER_MANIFEST_KEY, JSON.stringify({ games }));

// The estate after the migration: every Book-of game a lines game.
ROWS.push(
	{ key: 'bookofborutremake', name: 'Remake', gameType: 'lines' },
	{ key: 'hotfruits', name: 'Hot Fruits', gameType: 'lines' },
);
manifest({
	bookofborutremake: { protocol: 'lines', name: 'Remake', runtime: 'lines' },
	bookofborut: { protocol: 'lines', name: 'Borut', tableCapable: true },
});

await check('a migrated estate is clear', async () => {
	const census = await bookOfCensus();
	same(census, { projects: [], bookManifestEntries: [], editorTemplate: false, pendingRepublish: [], clear: true }, 'census'); // prettier-ignore
});

await check('each leftover is named, and keeps the census from clear', async () => {
	ROWS.push({ key: 'stray', name: 'Stray', gameType: 'bookOf' });
	manifest({
		bookofborutremake: { protocol: 'lines', name: 'Remake', runtime: 'lines' },
		bookofborut: { protocol: 'book', name: 'Borut', projectKey: 'bookofborut' },
	});
	R2.set(editorTemplateKey('bookOf'), '{}');
	R2.set('_shared/migrations/book-of/bookofflaky.json', JSON.stringify({ games: ['bookofflaky'] }));
	R2.set('_shared/migrations/book-of/garbled.json', 'not json');
	const census = await bookOfCensus();
	same(census.projects, [{ key: 'stray', name: 'Stray' }], 'bookOf rows');
	same(census.bookManifestEntries, [{ key: 'bookofborut', projectKey: 'bookofborut', runtime: null }], 'book entries'); // prettier-ignore
	same(census.editorTemplate, true, 'editor template');
	same(census.pendingRepublish, [{ project: 'bookofflaky', games: ['bookofflaky'] }, { project: 'garbled', games: [] }], 'pending'); // prettier-ignore
	same(census.clear, false, 'not clear');
});

if (failures) {
	console.error(`\ncheck:book-of-census — ${failures} failure(s)`);
	process.exit(1);
}
console.log('\ncheck:book-of-census — all passed');
