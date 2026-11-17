import { Assets, Spritesheet, type SpritesheetData, type Texture } from 'pixi.js';

import { SALMONS_SHEETS } from './sheets/frames';
import { builtinSheetsNeeded, pickSalmonsRegions, type SalmonsSheet } from './regions';

/**
 * Salmons' art, loaded: each region the drawing code names and the waterfall's face tile, from the
 * project's own published sheets where they ship it (`ProjectSheet`s, found by the online runtime
 * among the project's editor art), else from the built-in copy. A built-in page is its
 * own hashed file of the build (`new URL(…, import.meta.url)`; `config-vite` never inlines them),
 * fetched only when a region still needs it, and this module is reached only through the lazy
 * `engine-layout/salmons-art` import of a room whose generator draws Salmons.
 */
export type SalmonsTextures = {
	region: (name: string) => Texture;
	face: Texture;
};

/** A project sheet as the runtime ships it: its spritesheet JSON, and the one to try if it fails. */
export type ProjectSheet = { src: string; fallback?: string };

type ProjectTextures = Readonly<Record<string, Texture>>;

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
const loading = new Map<SalmonsSheet | 'face', Promise<Record<string, Texture>>>();

/** Load one built-in page once a page; a failed load is retried by the next call. */
function builtin(page: SalmonsSheet | 'face'): Promise<Record<string, Texture>> {
	let pending = loading.get(page);
	if (!pending) {
		pending = loadPage(page).catch((error: unknown) => {
			loading.delete(page);
			throw error;
		});
		loading.set(page, pending);
	}
	return pending;
}

async function loadPage(page: SalmonsSheet | 'face'): Promise<Record<string, Texture>> {
	if (page === 'face') return { waterfall_face: await Assets.load<Texture>(FACE_URL) };
	const texture = await Assets.load<Texture>(PAGES[page].url);
	const parsed = new Spritesheet(texture, PAGES[page].data);
	await parsed.parse();
	return parsed.textures;
}

/** One project sheet's frames by region name; none if it loads neither way (the built-in covers it). */
async function projectFrames(sheet: ProjectSheet): Promise<Record<string, Texture>> {
	for (const src of sheet.fallback ? [sheet.src, sheet.fallback] : [sheet.src]) {
		try {
			return (await Assets.load<Spritesheet>(src)).textures;
		} catch (error) {
			console.warn(`[salmons-art] the project sheet ${src} did not load`, error);
		}
	}
	return {};
}

export async function loadSalmonsTextures(
	sheets: readonly ProjectSheet[] = [],
): Promise<SalmonsTextures> {
	const project: ProjectTextures = Object.assign(
		{},
		...(await Promise.all(sheets.map(projectFrames))),
	);
	const pages: (SalmonsSheet | 'face')[] = builtinSheetsNeeded(project);
	if (!project.waterfall_face) pages.push('face');
	const builtins: Record<string, Texture> = Object.assign(
		{},
		...(await Promise.all(pages.map(builtin))),
	);
	const all = pickSalmonsRegions(project, builtins);
	return { region: (name) => all[name], face: all.waterfall_face };
}
