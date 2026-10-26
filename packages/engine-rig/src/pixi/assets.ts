import {
	DOMAdapter,
	ExtensionType,
	LoaderParserPriority,
	TextureSource,
	checkExtension,
	copySearchParams,
	extensions,
	path,
	type AssetExtension,
	type Loader,
	type ResolvedAsset,
	type Texture,
} from 'pixi.js';
import { TextureAtlas, type TextureAtlasPage } from '../atlas';
import { RigPageTexture } from './pageTexture';

/** Optional `data` for an `.atlas` asset: page images to use instead of the files the atlas names
 * (one source for a single page, or a map by page name), and extra options for loading them. */
export interface RigAtlasMetadata {
	images?: TextureSource | string | Record<string, TextureSource | string>;
	imageMetadata?: Record<string, unknown>;
}

/** The image url of each page the loader fetched — the loader's to release on unload. */
const fetchedPageUrls = new WeakMap<TextureAtlasPage, string>();

/** `.atlas` → `TextureAtlas`, each page's image loaded beside it (premultiplied once: a `pma` page
 * arrives premultiplied, any other is premultiplied on upload). */
export const rigAtlasAsset: AssetExtension<TextureAtlas, RigAtlasMetadata> = {
	extension: ExtensionType.Asset,
	loader: {
		extension: {
			type: ExtensionType.LoadParser,
			priority: LoaderParserPriority.Normal,
			name: 'invisibleRigAtlas',
		},
		name: 'invisibleRigAtlas',
		id: 'invisibleRigAtlas',
		test: (url: string) => checkExtension(url, '.atlas'),
		async load(url: string): Promise<string> {
			const response = await DOMAdapter.get().fetch(url);
			return response.text();
		},
		testParse: async (asset: unknown, resolved?: ResolvedAsset) =>
			typeof asset === 'string' && !!resolved?.src && checkExtension(resolved.src, '.atlas'),
		async parse(
			asset: string,
			resolved?: ResolvedAsset<RigAtlasMetadata>,
			loader?: Loader,
		): Promise<TextureAtlas> {
			const atlas = new TextureAtlas(asset);
			const src = resolved?.src ?? '';
			const base = path.dirname(src);
			const meta = resolved?.data ?? {};
			let images = meta.images;
			if (images instanceof TextureSource || typeof images === 'string')
				images = { [atlas.pages[0]?.name ?? '']: images };
			await Promise.all(
				atlas.pages.map(async (page) => {
					const provided = images?.[page.name];
					let source: TextureSource;
					if (provided instanceof TextureSource) source = provided;
					else {
						if (!loader) throw new Error(`No loader to fetch atlas page ${page.name}`);
						const url = copySearchParams(path.join(base, provided ?? page.name), src);
						const texture = await loader.load<Texture>({
							src: url,
							data: {
								...meta.imageMetadata,
								alphaMode: page.pma ? 'premultiplied-alpha' : 'premultiply-alpha-on-upload',
							},
						});
						source = texture.source;
						fetchedPageUrls.set(page, url);
					}
					page.setTexture(RigPageTexture.from(source));
				}),
			);
			return atlas;
		},
		// A fetched page is unloaded through the loader, as Pixi's spritesheet does its image:
		// destroying its source left the loader's cache holding a dead texture (Pixi warns "destroyed
		// instead of unloaded"). A page handed in through `images` is disposed as before.
		async unload(atlas: TextureAtlas, _resolved?: ResolvedAsset, loader?: Loader): Promise<void> {
			await Promise.all(
				atlas.pages.map(async (page) => {
					const texture = page.texture as RigPageTexture | null;
					const url = fetchedPageUrls.get(page);
					if (!url || !loader) {
						texture?.dispose();
						return;
					}
					texture?.texture.destroy();
					await loader.unload(url);
				}),
			);
		},
	},
} as unknown as AssetExtension<TextureAtlas, RigAtlasMetadata>;

const isSkeletonJson = (value: unknown): boolean =>
	!!value && typeof value === 'object' && 'skeleton' in value && 'bones' in value;

/** `.skel` → `Uint8Array`; `.irig` → its parsed skeleton JSON (a skeleton `.json` already
 * arrives parsed through Pixi's JSON loader, which is all the readers need). */
export const rigSkeletonAsset: AssetExtension<Uint8Array | object> = {
	extension: ExtensionType.Asset,
	loader: {
		extension: {
			type: ExtensionType.LoadParser,
			priority: LoaderParserPriority.Normal,
			name: 'invisibleRigSkeleton',
		},
		name: 'invisibleRigSkeleton',
		id: 'invisibleRigSkeleton',
		test: (url: string) => checkExtension(url, '.skel') || checkExtension(url, '.irig'),
		async load(url: string): Promise<Uint8Array | object> {
			const response = await DOMAdapter.get().fetch(url);
			if (checkExtension(url, '.irig')) {
				const json = await response.json();
				if (!isSkeletonJson(json)) throw new Error(`${url} is not a skeleton`);
				return json;
			}
			return new Uint8Array(await response.arrayBuffer());
		},
	},
} as unknown as AssetExtension<Uint8Array | object>;

let registered = false;

/** Registers the atlas and skeleton asset parsers with Pixi's `Assets` (once). */
export function registerRigAssets(): void {
	if (registered) return;
	registered = true;
	extensions.add(rigAtlasAsset, rigSkeletonAsset);
}
