import { Assets, Spritesheet, type SpritesheetData, type Texture } from 'pixi.js';

import { SALMONS_SHEETS } from './sheets/frames';
import { SALMONS_REGIONS, type SalmonsSheet } from './regions';

/**
 * Salmons' built-in art, loaded: each region of the three sheets and the waterfall's face tile.
 * Each page is its own hashed file of the build (`new URL(…, import.meta.url)`; `config-vite`
 * never inlines them), fetched only here, and this module is reached only through the lazy
 * `engine-layout/salmons-art` import of a room whose generator is `salmonsRiver`.
 */
export type SalmonsTextures = {
	region: (name: string) => Texture;
	face: Texture;
};

const PAGES: Record<SalmonsSheet, { url: string; data: SpritesheetData }> = {
	terrain: {
		url: new URL('./sheets/terrain.webp', import.meta.url).href,
		data: SALMONS_SHEETS.terrain,
	},
	props: {
		url: new URL('./sheets/props.webp', import.meta.url).href,
		data: SALMONS_SHEETS.props,
	},
	characters: {
		url: new URL('./sheets/characters.webp', import.meta.url).href,
		data: SALMONS_SHEETS.characters,
	},
};
const FACE_URL = new URL('./sheets/waterfall_face.webp', import.meta.url).href;

/** Kept for the page: a rejoin (or the next room) draws from the same textures. */
let loading: Promise<SalmonsTextures> | undefined;

/** Load the art once a page; a failed load is retried by the next call. */
export function loadSalmonsTextures(): Promise<SalmonsTextures> {
	loading ??= load().catch((error: unknown) => {
		loading = undefined;
		throw error;
	});
	return loading;
}

async function load(): Promise<SalmonsTextures> {
	const sheets = await Promise.all(
		(Object.keys(PAGES) as SalmonsSheet[]).map(async (sheet) => {
			const page = PAGES[sheet];
			const texture = await Assets.load<Texture>(page.url);
			const parsed = new Spritesheet(texture, page.data);
			await parsed.parse();
			return parsed.textures;
		}),
	);
	const face = await Assets.load<Texture>(FACE_URL);
	const all: Record<string, Texture> = Object.assign({}, ...sheets);
	for (const names of Object.values(SALMONS_REGIONS))
		for (const name of names)
			if (!all[name]) throw new Error(`[salmons-art] the sheets have no region "${name}"`);
	return { region: (name) => all[name], face };
}
