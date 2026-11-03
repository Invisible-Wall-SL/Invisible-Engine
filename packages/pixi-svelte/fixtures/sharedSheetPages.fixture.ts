/**
 * Offline fixture for `shareSheetPages` (`src/lib/sharedSheetPages.ts`): a page in the shared
 * `_pages/` store that two sheets (the editor-art and symbol exports' copies of one sheet) and a rig
 * name is fetched under ONE url, so it is one texture; a sheet handed a `texture` fetches nothing.
 *
 *   pnpm check:all --only sharedSheetPages
 */
import { Spritesheet, Texture, TextureSource, spritesheetAsset, type Loader } from 'pixi.js';
import { rigAtlasAsset } from 'engine-rig/pixi';
import { shareSheetPages } from '../src/lib/sharedSheetPages';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

const BASE = 'https://games.example.test/game/assets';
const PAGE = '../../_pages/0ef425de.webp';

/** Stands in for Pixi's loader, caching by url as it does. */
const fetched: string[] = [];
const cache = new Map<string, Promise<Texture>>();
const loader = {
	load: async (asset: string | { src: string } | { src: string }[]) => {
		const list = Array.isArray(asset) ? asset : [asset];
		const out: Record<string, unknown> = {};
		for (const one of list) {
			const src = typeof one === 'string' ? one : one.src;
			if (!cache.has(src)) {
				fetched.push(src);
				const source = new TextureSource({ width: 64, height: 64 });
				cache.set(src, Promise.resolve(new Texture({ source })));
			}
			out[src] = await cache.get(src);
		}
		return Array.isArray(asset) ? out : out[typeof asset === 'string' ? asset : asset.src];
	},
} as unknown as Loader;

type Parse = (asset: unknown, options: unknown, loader: Loader) => Promise<unknown>;
const sheetParser = spritesheetAsset.loader as unknown as { parse: Parse };
const rigParser = (rigAtlasAsset as unknown as { loader: { parse: Parse } }).loader;

const sheet = {
	frames: { H1_static: { frame: { x: 0, y: 0, w: 8, h: 8 }, sourceSize: { w: 8, h: 8 } } },
	meta: { image: PAGE, size: { w: 64, h: 64 }, scale: 1 },
};
const parseSheet = (src: string, data?: object) =>
	sheetParser.parse(sheet, { src: `${BASE}/${src}`, data }, loader) as Promise<Spritesheet>;
const ART = 'editor-art/S_StaticElements/S_StaticElements.json';
const SYMBOLS = 'editor-symbols/S_StaticElements/S_StaticElements.json';
const ATLAS = `${PAGE}\nsize: 64,64\nfilter: Linear,Linear\nregion\nbounds: 0,0,8,8\n`;

async function main(): Promise<void> {
	console.log('\n1. without the patch, Pixi spells the page per sheet folder (the bug)');
	await parseSheet(ART);
	await parseSheet(SYMBOLS);
	check('two fetches of one page', fetched.length, 2);

	fetched.length = 0;
	cache.clear();
	shareSheetPages();

	console.log('\n2. with it, two sheet folders and a rig share one fetch');
	const art = await parseSheet(ART);
	const symbols = await parseSheet(SYMBOLS);
	await rigParser.parse(ATLAS, { src: `${BASE}/editor-art/R_Static/R_Static.atlas` }, loader);
	check('one fetch, the normalized url', fetched, [`${BASE}/_pages/0ef425de.webp`]);
	check('both sheets draw from the same source', art.textureSource === symbols.textureSource, true);
	check('frames still parse', Object.keys(art.textures), ['H1_static']);

	console.log('\n2b. a premultiplied (`pma`) rig page keeps a texture of its own');
	fetched.length = 0;
	const PMA = ATLAS.replace('filter: Linear,Linear', 'filter: Linear,Linear\npma: true');
	await rigParser.parse(PMA, { src: `${BASE}/editor-art/R_Imported/R_Imported.atlas` }, loader);
	await rigParser.parse(PMA, { src: `${BASE}/editor-art/R_Other/R_Other.atlas` }, loader);
	check('one more fetch, keyed apart, shared by pma rigs', fetched, [
		`${BASE}/_pages/0ef425de.webp#pma`,
	]);

	console.log('\n3. the url keeps the sheet’s query');
	fetched.length = 0;
	await parseSheet('editor-art/S_UI/S_UI.json?v=3');
	check('query copied onto the page', fetched, [`${BASE}/_pages/0ef425de.webp?v=3`]);

	console.log('\n4. a sheet handed a texture fetches nothing');
	fetched.length = 0;
	const given = new TextureSource({ width: 64, height: 64 });
	const handed = await parseSheet('editor-art/S_UI/S_UI.json', {
		texture: new Texture({ source: given }),
	});
	check('no fetch', fetched, []);
	check('the given source is used', handed.textureSource === given, true);

	if (failures) throw new Error(`${failures} sharedSheetPages assertion(s) FAILED`);
	console.log('\nAll sharedSheetPages assertions passed.');
}

void main();
