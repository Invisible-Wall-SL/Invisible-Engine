/**
 * Contract check for Game Maker's Duplicate (`projectDuplicate.ts`):
 *   pnpm --filter launcher-api check:project-duplicate
 *
 * Runs the REAL planner, copier and the published-pointer reader over an in-memory R2; only R2 is
 * stubbed. What it pins, each because getting it wrong is silent until someone plays the copy:
 *  - per scope, exactly which folders travel: `setup` takes the authored game and NO art, sounds or
 *    fonts; `full` takes the whole project, `deploy/` and `storybook/` included;
 *  - neither scope copies the source's published snapshots, its live pointer or its doc backups,
 *    so a `full` copy starts unpublished (the real `currentPointer` finds nothing);
 *  - the cap counts only what is copied, and a copy over it writes nothing;
 *  - every copied JSON body is re-based onto the copy, binaries are copied byte for byte, a
 *    neighbouring project whose key merely starts the same never travels, and the source is
 *    untouched;
 *  - why `deploy/` must travel: the real `loadRegionSet` takes the copy's atlas page from the
 *    Atlas Maker deploy in it, which neither Publish nor the live assemble rebuilds; without it the
 *    copy falls back to another page;
 *  - the copy re-stamps every object, and `deploy/` lands last, so a deployed page the source
 *    shows is still the one the copy shows.
 */
import { mock } from 'node:test';

/** `mtime` is a write counter: R2 stamps a copy with the time it was written, not the source's. */
type Obj = { body: string; etag: string; mtime: number };
const R2 = new Map<string, Obj>();
let etagSeq = 0;
let clock = 0;
const put = (key: string, body: string) =>
	R2.set(key, { body, etag: `"e${++etagSeq}"`, mtime: ++clock });

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
		getObjectText: async (key: string) => R2.get(key)?.body ?? null,
		objectExists: async (key: string) => R2.has(key),
		headObject: async (key: string) => {
			const o = R2.get(key);
			return o ? { etag: o.etag, lastModified: o.mtime, size: o.body.length } : null;
		},
		getObjectTextWithEtag: async (key: string) => {
			const o = R2.get(key);
			return o ? { text: o.body, etag: o.etag } : null;
		},
		putObjectText: async (key: string, text: string) => {
			put(key, text);
			return R2.get(key)!.etag;
		},
		copyObject: async (from: string, to: string) => {
			const o = R2.get(from);
			if (!o) return false;
			R2.set(to, { ...o, mtime: ++clock });
			return true;
		},
		deleteObjects: async (keys: string[]) => keys.forEach((k) => R2.delete(k)),
		listAllKeys: async (prefix: string) => sortedKeys(prefix),
		listAllObjects: async (prefix: string) =>
			sortedKeys(prefix).map((key) => {
				const o = R2.get(key)!;
				return { key, size: o.body.length, lastModified: o.mtime };
			}),
		listObjects: async () => ({ keys: [], prefixes: [] }),
	},
});

const { DuplicateTooLargeError, MAX_OBJECTS, duplicateProjectData, planDuplicate } =
	await import('../src/lib/server/projectDuplicate.ts');
const { currentPointer } = await import('../src/lib/server/publishedRuntime.ts');
const { loadRegionSet } = await import('../src/lib/server/editorRegions.ts');

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

// A hyphenated key on purpose: R2 prefixes use the underscore form (`r2Slug`).
const SOURCE = { clientKey: 'acme', projectKey: 'book-of-borut' };
const SRC_ROOT = 'acme/book_of_borut/';
const SRC_COMPONENTS = 'editor/book_of_borut/';
const SNAPSHOT = '20261001T120000000Z-abcd';

/** The source tree, relative to its project root, as a Book of Borut-shaped project holds it. */
const PROJECT_FILES: Record<string, string> = {
	'editor/scenes.json': JSON.stringify({
		projectKey: 'book-of-borut',
		scenes: [
			{ id: 'base', node: { assetKey: `${SRC_ROOT}manifests/atlas_manifest_reels.json::f` } },
		],
	}),
	'editor/flow-v2.json': '{"version":2}',
	'editor/art-bounds.json': '{}',
	'editor/backups/scenes-20261001T120000000Z-00000001.json': '{}',
	'editor/flow-v2-backups/flow-v2-20261001T120000000Z-00000001.json': '{}',
	'config/config.json': '{"version":1}',
	'config/backups/config-20261001T120000000Z-00000001.json': '{}',
	'symbols/symbols.json': JSON.stringify({ symbols: { H1: { static: { assetKey: 'h1.webp' } } } }),
	'symbols/defaults.json': '{}',
	'symbols/backups/symbols-20261001T120000000Z-00000001.json': '{}',
	'win-text/win-text.json': '{"version":1}',
	'localization/strings.json': '{"en":{}}',
	'atlas_config.json': '{"output_prefix":"book-of-borut"}',
	'sheet_config.json': '{}',
	'manifests/atlas_manifest_reels.json': JSON.stringify({
		atlas: { source_image_path: `${SRC_ROOT}atlas/reels_new.webp` },
	}),
	'atlas/reels_new.webp': 'PAGE-bytes',
	'input/refs/atlas/reels.png': 'REF-bytes',
	'sheets/S_Reels/page.png': 'SHEET-bytes',
	'spines/hero/hero.json': '{"skeleton":{}}',
	'spines/hero/hero.atlas': 'hero.png\nsize: 4,4',
	'spines/hero/hero.png': 'RIG-bytes',
	'fonts/fonts.json': '{"fonts":[]}',
	'fonts/goldFont/gold.fnt': 'FONT-bytes',
	'sounds/sounds.json': '{"sounds":[]}',
	'sounds/files/spin.mp3': 'SOUND-bytes',
	'clips/intro.clip.json': '{"id":"intro"}',
	'glow.fx.json': '{"id":"glow"}',
	'glow.fx.meta.json': '{}',
	'cinematics/intro.json': '{"id":"intro"}',
	'deploy/sprites/reels.webp': 'DEPLOYED-PAGE-bytes',
	'deploy/sprites/reels.json': '{"meta":{"image":"reels.webp"}}',
	'deploy/editor-art/index.json': '{"sheets":[]}',
	'storybook/index.html': '<html></html>',
	'published/pointer.json': JSON.stringify({
		version: 1,
		current: SNAPSHOT,
		snapshots: [{ id: SNAPSHOT }],
	}),
	[`published/${SNAPSHOT}/runtime.json`]: `{"doc":{"projectKey":"book-of-borut"}}`,
	[`published/${SNAPSHOT}/deploy/sprites/reels.webp`]: 'FROZEN-bytes',
};
/** The source's editor components, relative to `editor/<projectKey>/`. */
const COMPONENT_FILES: Record<string, string> = {
	'components/btn.json': `{"id":"btn","assetKey":"${SRC_ROOT}spines/hero/"}`,
	'components/btn.v2.json': '{"id":"btn"}',
	'component-defaults/btn.json': '{"params":{}}',
	'component-defaults-backups/btn/component-defaults-20261001T120000000Z-00000001.json': '{}',
};
/** Neighbours whose keys merely START like the source's; nothing of theirs may travel. */
const NEIGHBOURS = [
	'acme/book_of_borut_2/editor/scenes.json',
	'editor/book_of_borut_2/components/x.json',
];

for (const [rel, body] of Object.entries(PROJECT_FILES)) put(SRC_ROOT + rel, body);
for (const [rel, body] of Object.entries(COMPONENT_FILES)) put(SRC_COMPONENTS + rel, body);
for (const key of NEIGHBOURS) put(key, '{}');
const sourceBefore = new Map([...R2].filter(([k]) => !k.startsWith('other/')));

const isBackup = (rel: string) => /(^|\/)[a-z0-9-]*backups\//.test(rel);
/** Every source file of `files` a copy must write, given which top-level folders the scope takes. */
const expected = (files: Record<string, string>, takes: (rel: string) => boolean) =>
	Object.keys(files)
		.filter((rel) => takes(rel) && !isBackup(rel))
		.sort();

const SETUP_FOLDERS = ['editor/', 'config/', 'symbols/', 'win-text/', 'localization/'];
const SETUP_ROOT_FILES = ['atlas_config.json', 'sheet_config.json'];
const takesSetup = (rel: string) =>
	SETUP_FOLDERS.some((f) => rel.startsWith(f)) || SETUP_ROOT_FILES.includes(rel);
const takesFull = (rel: string) => !rel.startsWith('published/');

/** A copy's keys, split by root and made relative so they compare against the source tree. */
function copiedTree(root: string, components: string) {
	return {
		project: sortedKeys(root).map((k) => k.slice(root.length)),
		components: sortedKeys(components).map((k) => k.slice(components.length)),
	};
}
const topLevel = (rels: string[]) =>
	[...new Set(rels.map((r) => (r.includes('/') ? `${r.split('/')[0]}/` : r)))].sort();

console.log('\n1. what each scope copies');

const SETUP_TARGET = { clientKey: 'other', projectKey: 'borut-setup' };
const FULL_TARGET = { clientKey: 'other', projectKey: 'borut-pots-sample' };

await check('setup: the authored game and its components, no art, sounds or fonts', async () => {
	const result = await duplicateProjectData(SOURCE, SETUP_TARGET, 'setup');
	const tree = copiedTree('other/borut_setup/', 'editor/borut_setup/');
	same(tree.project, expected(PROJECT_FILES, takesSetup), 'project files');
	same(
		tree.components,
		expected(COMPONENT_FILES, () => true),
		'component files',
	);
	same(
		topLevel(tree.project),
		[
			'atlas_config.json',
			'config/',
			'editor/',
			'localization/',
			'sheet_config.json',
			'symbols/',
			'win-text/',
		],
		'what travels',
	);
	same(result.copied, tree.project.length + tree.components.length, 'copied count');
	same(result.skipped, 0, 'skipped');
});

await check('full: the whole project, deploy/ and storybook/ included', async () => {
	const result = await duplicateProjectData(SOURCE, FULL_TARGET, 'full');
	const tree = copiedTree('other/borut_pots_sample/', 'editor/borut_pots_sample/');
	same(tree.project, expected(PROJECT_FILES, takesFull), 'project files');
	same(
		tree.components,
		expected(COMPONENT_FILES, () => true),
		'component files',
	);
	same(
		topLevel(tree.project),
		[
			'atlas/',
			'atlas_config.json',
			'cinematics/',
			'clips/',
			'config/',
			'deploy/',
			'editor/',
			'fonts/',
			'glow.fx.json',
			'glow.fx.meta.json',
			'input/',
			'localization/',
			'manifests/',
			'sheet_config.json',
			'sheets/',
			'sounds/',
			'spines/',
			'storybook/',
			'symbols/',
			'win-text/',
		],
		'what travels',
	);
	same(result.copied, tree.project.length + tree.components.length, 'copied count');
});

await check('neither scope copies published/ or a backup', () => {
	for (const root of ['other/borut_setup/', 'other/borut_pots_sample/']) {
		same(sortedKeys(`${root}published/`), [], `${root} published/`);
	}
	const backups = [...R2.keys()].filter((k) => k.startsWith('other/') || /^editor\/borut_/.test(k));
	same(backups.filter(isBackup), [], 'backups in a copy');
});

await check('a full copy starts unpublished; the source still has its live version', async () => {
	same(await currentPointer(FULL_TARGET.clientKey, FULL_TARGET.projectKey), null, 'copy pointer');
	same(
		(await currentPointer(SOURCE.clientKey, SOURCE.projectKey))?.current,
		SNAPSHOT,
		'source pointer',
	);
});

console.log('\n2. what the copy reads');

await check('every copied JSON body points at the copy, never the source', () => {
	for (const key of [...sortedKeys('other/'), ...sortedKeys('editor/borut_')]) {
		if (!key.endsWith('.json')) continue;
		const body = R2.get(key)!.body;
		assert(!body.includes(SRC_ROOT), `${key} still names ${SRC_ROOT}`);
		assert(!body.includes(SRC_COMPONENTS), `${key} still names ${SRC_COMPONENTS}`);
	}
	const scenes = JSON.parse(R2.get('other/borut_pots_sample/editor/scenes.json')!.body);
	same(scenes.projectKey, 'borut-pots-sample', 'scenes projectKey');
	same(
		scenes.scenes[0].node.assetKey,
		'other/borut_pots_sample/manifests/atlas_manifest_reels.json::f',
		'a placed asset',
	);
	same(
		JSON.parse(R2.get('other/borut_pots_sample/atlas_config.json')!.body).output_prefix,
		'borut-pots-sample',
		'atlas output_prefix',
	);
});

await check('binaries are byte copies; neighbours and the source are untouched', () => {
	for (const rel of [
		'atlas/reels_new.webp',
		'deploy/sprites/reels.webp',
		'sounds/files/spin.mp3',
	]) {
		same(R2.get(`other/borut_pots_sample/${rel}`)?.body, PROJECT_FILES[rel], rel);
	}
	same(sortedKeys('other/book_of_borut_2'), [], 'a neighbour project');
	same(
		sortedKeys('editor/borut_pots_sample/').filter((k) => k.includes('/x.json')),
		[],
		'a neighbour component',
	);
	for (const [key, obj] of sourceBefore) same(R2.get(key)?.body, obj.body, key);
	same(
		[...R2.keys()].filter((k) => !k.startsWith('other/') && !/^editor\/borut_/.test(k)).length,
		sourceBefore.size,
		'source key count',
	);
});

console.log('\n3. the cap counts only what is copied');

const CAPPED = { clientKey: 'acme', projectKey: 'capped' };
for (let i = 0; i < MAX_OBJECTS; i++) put(`acme/capped/sheets/s${i}.png`, 'x');
for (let i = 0; i < 3000; i++) put(`acme/capped/published/${SNAPSHOT}/deploy/f${i}.png`, 'x');
for (let i = 0; i < 40; i++) {
	put(
		`acme/capped/editor/backups/scenes-20261001T120000000Z-${String(i).padStart(8, '0')}.json`,
		'{}',
	);
}

await check(`${MAX_OBJECTS} to copy beside 3040 that stay: copied, not refused`, async () => {
	const target = { clientKey: 'other', projectKey: 'capped-full' };
	same((await planDuplicate(CAPPED, target, 'full')).length, MAX_OBJECTS, 'planned');
	const result = await duplicateProjectData(CAPPED, target, 'full');
	same(result.copied, MAX_OBJECTS, 'copied');
	same(sortedKeys('other/capped_full/').length, MAX_OBJECTS, 'written');
});

await check('one more to copy: refused, and nothing written', async () => {
	put('acme/capped/sheets/one-more.png', 'x');
	const target = { clientKey: 'other', projectKey: 'capped-over' };
	try {
		await duplicateProjectData(CAPPED, target, 'full');
		throw new Error('not refused');
	} catch (e) {
		assert(e instanceof DuplicateTooLargeError, `wrong error: ${String(e)}`);
		same(e.objects, MAX_OBJECTS + 1, 'reported count');
	}
	same(sortedKeys('other/capped_over/'), [], 'written');
});

console.log('\n4. why deploy/ travels');

await check("the copy's atlas takes its page from the copied Atlas Maker deploy", async () => {
	const manifest = 'other/borut_pots_sample/manifests/atlas_manifest_reels.json';
	same(
		(await loadRegionSet(manifest)).pageKey,
		'other/borut_pots_sample/deploy/sprites/reels.webp',
		'with deploy/',
	);
	R2.delete('other/borut_pots_sample/deploy/sprites/reels.webp');
	same(
		(await loadRegionSet(manifest)).pageKey,
		'other/borut_pots_sample/atlas/reels_new.webp',
		'without deploy/ it reads another page',
	);
});

await check(
	'a manifest re-saved after its deploy keeps the deployed page in the copy',
	async () => {
		const project = { clientKey: 'acme', projectKey: 'squid' };
		put('acme/squid/sheets/S_Squid/page.png', 'FLIPBOOK-PAGE');
		put('acme/squid/deploy/sprites/page.webp', 'REPACKED-AND-DEPLOYED');
		put(
			'acme/squid/manifests/atlas_manifest_squid.json',
			JSON.stringify({ atlas: { source_image_path: 'acme/squid/sheets/S_Squid/page.png' } }),
		);
		const manifest = (root: string) => `${root}manifests/atlas_manifest_squid.json`;
		same(
			(await loadRegionSet(manifest('acme/squid/'))).pageKey,
			'acme/squid/deploy/sprites/page.webp',
			'the source',
		);
		await duplicateProjectData(project, { clientKey: 'other', projectKey: 'squid-copy' }, 'full');
		same(
			(await loadRegionSet(manifest('other/squid_copy/'))).pageKey,
			'other/squid_copy/deploy/sprites/page.webp',
			'the copy',
		);
	},
);

if (failures) {
	console.error(`\ncheck:project-duplicate — ${failures} failure(s)`);
	process.exit(1);
}
console.log('\ncheck:project-duplicate — all passed');
