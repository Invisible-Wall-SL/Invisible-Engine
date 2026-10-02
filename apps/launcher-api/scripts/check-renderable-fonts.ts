/**
 * The fonts a project RENDERS are its own catalog PLUS the `_shared/fonts/` library
 * (`loadRenderableFonts` in `$lib/server/fonts.ts`) — in the Scene Editor and in the export that
 * ships them (`exportEditorFonts`). A shared component def names a library font by family
 * (`featureCard` → `Tungsten-Bold`); with the library read only as a fallback for a project with NO
 * catalog, every project with fonts of its own drew and shipped that text in the default font.
 *
 *   1. editor list: own fonts, then library fonts the project does not override (id or folder),
 *      each streamed from where it lives;
 *   2. the Font Maker keeps ITS catalog (project, else library) — where its writes and deletes land;
 *   3. the export copies a library font from `_shared/fonts/` and lists it in the shipped index;
 *   4. no catalog anywhere ⇒ nothing, and the export prunes its subtree.
 *
 * Runs the real modules over an in-memory R2.
 *   pnpm --filter launcher-api check:renderable-fonts
 */
import { mock } from 'node:test';

const bucket = new Map<string, string>();
const copies: string[] = [];
const r2Url = new URL('../src/lib/server/r2.ts', import.meta.url).href;
mock.module(r2Url, {
	namedExports: {
		...(await import(r2Url)),
		getObjectText: async (key: string) => bucket.get(key) ?? null,
		objectExists: async (key: string) => bucket.has(key),
		listAllKeys: async (prefix: string) => [...bucket.keys()].filter((k) => k.startsWith(prefix)),
		deleteObjects: async (keys: string[]) => keys.forEach((k) => bucket.delete(k)),
		putObjectText: async (key: string, text: string) => {
			bucket.set(key, text);
			return '"etag"';
		},
		copyObject: async (from: string, to: string) => {
			const body = bucket.get(from);
			if (body === undefined) return false;
			bucket.set(to, body);
			copies.push(`${from} -> ${to}`);
			return true;
		},
	},
});

const { resolveEditorFonts } = await import('../src/lib/server/fonts.ts');
const { exportEditorFonts } = await import('../src/lib/server/fontExport.ts');

let failures = 0;
const check = (label: string, ok: boolean) => {
	console.log(`${ok ? '  ok ' : 'FAIL '} ${label}`);
	if (!ok) failures += 1;
};

const bitmap = (id: string, folder = id) => ({
	id,
	name: id,
	kind: 'bitmap',
	folder,
	descriptorFile: `${id}.xml`,
	descriptorFormat: 'xml',
	pageFiles: [`${id}.png`],
	recipe: { file: 'recipe.json', sourceFile: '_src.otf' },
});
const catalog = (prefix: string, fonts: unknown[]) => JSON.stringify({ prefix, fonts });
const putFont = (root: string, id: string, folder = id) => {
	bucket.set(`${root}/${folder}/${id}.xml`, 'xml');
	bucket.set(`${root}/${folder}/${id}.png`, 'png');
};

const OWN = 'invisible_wall/test6/fonts';
const LIB = '_shared/fonts';
bucket.set(
	`${OWN}/fonts.json`,
	catalog(OWN, [bitmap('Rye-Regular'), bitmap('Shadowed'), bitmap('Mine', 'Clash')]),
);
putFont(OWN, 'Rye-Regular');
putFont(OWN, 'Shadowed');
putFont(OWN, 'Mine', 'Clash');
bucket.set(
	`${LIB}/fonts.json`,
	catalog(LIB, [bitmap('Tungsten-Bold'), bitmap('Shadowed'), bitmap('Theirs', 'Clash')]),
);
putFont(LIB, 'Tungsten-Bold');
putFont(LIB, 'Shadowed');
putFont(LIB, 'Theirs', 'Clash');

console.log('1. the editor draws the project’s fonts and the library’s');
const fonts = (await resolveEditorFonts('Invisible_Wall', 'test6')) ?? [];
const byId = new Map(fonts.map((f) => [f.id, f]));
check('own fonts listed', byId.has('Rye-Regular') && byId.has('Mine'));
check(
	'a library font a project has none of is listed, streamed from the library',
	byId.get('Tungsten-Bold')?.descriptorUrl ===
		`/api/editor/asset?key=${encodeURIComponent(`${LIB}/Tungsten-Bold/Tungsten-Bold.xml`)}`,
);
check(
	'a project font overrides the library font of the same id',
	fonts.filter((f) => f.id === 'Shadowed').length === 1 &&
		byId.get('Shadowed')?.descriptorUrl?.includes(encodeURIComponent(`${OWN}/`)) === true,
);
check('a library font in a folder the project uses is left out', !byId.has('Theirs'));

console.log('2. the Font Maker keeps the catalog it writes to');
const maker = (await resolveEditorFonts('Invisible_Wall', 'test6', (k) => k, 'fontMaker')) ?? [];
check('only the project’s catalog', maker.map((f) => f.id).join() === 'Rye-Regular,Shadowed,Mine');

console.log('3. the export ships the library font');
const index = await exportEditorFonts('Invisible_Wall', 'test6');
const shipped = index.catalog.fonts.map((f) => f.id);
check('listed in the shipped catalog', shipped.includes('Tungsten-Bold'));
check(
	'copied from the library',
	copies.includes(
		`${LIB}/Tungsten-Bold/Tungsten-Bold.xml -> invisible_wall/test6/deploy/editor-fonts/Tungsten-Bold/Tungsten-Bold.xml`,
	),
);
check(
	'the project’s own copy wins over the library’s',
	copies.includes(
		`${OWN}/Shadowed/Shadowed.xml -> invisible_wall/test6/deploy/editor-fonts/Shadowed/Shadowed.xml`,
	) && !copies.some((c) => c.startsWith(`${LIB}/Shadowed/`)),
);
check(
	'no authoring recipe ships',
	index.catalog.fonts.every((f) => !('recipe' in f)),
);

console.log('4. a project with no catalog of its own');
const libOnly = (await resolveEditorFonts('Invisible_Wall', 'fresh')) ?? [];
check(
	'draws the library',
	libOnly
		.map((f) => f.id)
		.sort()
		.join() === 'Shadowed,Theirs,Tungsten-Bold',
);
bucket.delete(`${LIB}/fonts.json`);
check('no catalog anywhere ⇒ none', (await resolveEditorFonts('Invisible_Wall', 'fresh')) === null);
bucket.set('invisible_wall/fresh/deploy/editor-fonts/Old/Old.xml', 'stale');
const none = await exportEditorFonts('Invisible_Wall', 'fresh');
check(
	'… and the export ships nothing and prunes its subtree',
	none.catalog.fonts.length === 0 &&
		!bucket.has('invisible_wall/fresh/deploy/editor-fonts/Old/Old.xml'),
);

console.log(failures === 0 ? '\nrenderable fonts: OK' : `\nrenderable fonts: ${failures} FAILED`);
if (failures > 0) process.exit(1);
