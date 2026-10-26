/**
 * Offline fixture for the `.atlas` loader's unload (`assets.ts`): a page the loader fetched goes back
 * through the loader, so Pixi's cache never holds a destroyed texture ("A TextureSource managed by
 * Assets was destroyed instead of unloaded" — the boot splash tripped it releasing its rig); a page
 * handed in through `images` is disposed, as before.
 *
 *   pnpm check:all --only engine-rig
 */
import { TextureSource, type Loader, type ResolvedAsset } from 'pixi.js';
import type { TextureAtlas } from '../atlas';
import { rigAtlasAsset } from './assets';

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

type AtlasParser = {
	parse: (asset: string, resolved: ResolvedAsset, loader: Loader) => Promise<TextureAtlas>;
	unload: (atlas: TextureAtlas, resolved: ResolvedAsset, loader: Loader) => Promise<void>;
};
const parser = (rigAtlasAsset as unknown as { loader: AtlasParser }).loader;

const ATLAS = 'page.png\nsize: 64,64\nfilter: Linear,Linear\nregion\nbounds: 0,0,8,8\n';
const resolved: ResolvedAsset = { src: 'https://example.test/rigs/hero.atlas' };

/** Stands in for Pixi's loader: what it fetched, what it was asked to unload, and whether a page
 *  was already destroyed when it was. */
const fetched = new Map<string, TextureSource>();
const unloaded: { url: string; alreadyDestroyed: boolean }[] = [];
const loader = {
	load: async ({ src }: { src: string }) => {
		const source = new TextureSource({ width: 64, height: 64 });
		fetched.set(src, source);
		return { source };
	},
	unload: async (url: string) => {
		const source = fetched.get(url);
		unloaded.push({ url, alreadyDestroyed: !!source?.destroyed });
		source?.destroy();
	},
} as unknown as Loader;

async function run(): Promise<void> {
	console.log('\n1. a page the loader fetched');
	const atlas = await parser.parse(ATLAS, resolved, loader);
	const [pageUrl] = [...fetched.keys()];
	await parser.unload(atlas, resolved, loader);
	check('is unloaded through the loader, by the url it was fetched at, still alive', unloaded, [
		{ url: pageUrl, alreadyDestroyed: false },
	]);
	check('and is gone afterwards', fetched.get(pageUrl)?.destroyed, true);

	console.log('\n2. a page handed in through `images`');
	const provided = new TextureSource({ width: 64, height: 64 });
	const own = await parser.parse(ATLAS, { ...resolved, data: { images: provided } }, loader);
	unloaded.length = 0;
	await parser.unload(own, resolved, loader);
	check('is disposed', provided.destroyed, true);
	check('and the loader is not asked about it', unloaded, []);
}

void run().then(() => {
	if (failures) throw new Error(`${failures} rig atlas unload assertion(s) FAILED`);
	console.log('\nAll rig atlas unload assertions passed.');
});
