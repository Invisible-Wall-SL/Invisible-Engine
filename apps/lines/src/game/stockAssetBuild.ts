import {
	BUILTIN_COMPONENTS,
	clearComponentDefaults,
	clearComponents,
	getComponentDefaults,
	registerComponentDefaults,
	registerComponents,
	resolveComponent,
	type ComponentDef,
} from 'engine-layout';
import { createGameConfig } from 'engine-game/src/game/gameConfig';
import type { GameConfigDoc } from 'game-config';

import stockTable, { gameAssetsBase } from './assets';
import { GAME_BUILTIN_DEFS } from './builtinDefs';
import compiledConfig from './config';
import { SYMBOL_INFO_MAP } from './constants';
import { fallbackEditorScenes } from './fallbackLayout';
import { analyseStockAssets } from './stockAssets';
import { hasStockAssetDoc, stockAssetDataOf, type StockAssetSource } from './stockAssetData';
import { PART_NEEDS, STOCK_KEYS } from './stockAssetRules';

/**
 * THE STOCK ASSETS A STANDALONE BUILD LEAVES OUT.
 *
 * A game repo ships the upstream sample game's files (`static/assets/{spines,sprites,…}`, seeded
 * from `apps/lines/static`) whatever the project draws, and the boot already skips the keys it can
 * never draw (`stockAssetBoot.ts`). A standalone build bakes the data that decision reads
 * (`baked-editor-bundle.json`), so it is taken here at build time, and `config-vite`
 * (`stockAssetPrune.js`) leaves those keys' files out of the build.
 *
 * The build must keep at least what any boot of it keeps, so it runs the SAME walk
 * (`analyseStockAssets`) on the same data, with each input the boot takes from live state given
 * the value that keeps the most:
 * - the component registry is seeded as `Game.svelte` seeds it (`GAME_BUILTIN_DEFS`, then the
 *   bundle's pinned versions, defs and defaults, as `registerBakedComponents` does);
 * - every part with a stock rule counts as registered (the boot registers a subset of them);
 * - the config resolves through the engine's own resolver, baked over compiled;
 * - the symbols in play are the config's AND every symbol the coded or authored map draws: a
 *   Play4Fun RGS declares the symbol set at boot, so any symbol either map draws may be dealt.
 *
 * The same walk names the project's exported art that only a component default every placement
 * overrides names (`editorArtUnused`): the boot takes it off the asset table too, so the build
 * leaves its files out as well. With the walk's inputs at their widest here, what the build leaves
 * out is a subset of what any boot of it leaves out.
 *
 * Every doubt keeps everything, as at boot: no doc, an unreadable bundle, or any throw.
 */

export type StockAssetBuildPlan = {
	/** Set when nothing is left out, and why. */
	keptAllBecause?: string;
	/** The stock keys this build leaves out. */
	skipped: string[];
	/** Every stock key's own files, relative to the deploy's `assets/` root: a rig's atlas and
	 *  skeleton, a sheet's or font's descriptor. What those files name in turn (pages, the audio
	 *  sprite) is read off the files themselves. */
	files: Record<string, string[]>;
	/** The folders of those files, the audio sprite's aside: everything in one is the upstream
	 *  sample's, loaded only through the stock table, so a file no kept key loads there is dead
	 *  weight (the sample's `index.ts` manifests, a font's unused `.json` twin). */
	folders: string[];
	/** The project's exported art (the bundle's `editorArt` index), by its asset-table key: the keys
	 *  the build leaves out, and every key's own files (a sheet's descriptors, an image, a rig's
	 *  skeleton and atlases, on every tier), relative to the `assets/` root. */
	art: { skipped: string[]; files: Record<string, string[]> };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** Each stock key's own files, relative to the `assets/` root. */
export function stockAssetFiles(): Record<string, string[]> {
	const base = gameAssetsBase();
	const rel = (href: string): string => {
		if (!href.startsWith(base)) throw new Error(`stock asset ${href} is outside ${base}`);
		return decodeURIComponent(href.slice(base.length));
	};
	return Object.fromEntries(
		Object.entries(stockTable).map(([key, entry]) => {
			const src: unknown = entry.src;
			const hrefs =
				typeof src === 'string' ? [src] : isRecord(src) ? [src.atlas, src.skeleton] : [];
			return [key, hrefs.map((href) => rel(String(href)))];
		}),
	);
}

/** The fields of an `editorArt` index entry (and of each of its resolution tiers) that name a file. */
const ART_FILE_FIELDS = ['json', 'ktx2Json', 'file', 'ktx2', 'skeleton', 'atlas', 'ktx2Atlas'];

const artFilesOf = (entry: Record<string, unknown>): string[] => {
	const tiers = isRecord(entry.tiers) ? Object.values(entry.tiers).filter(isRecord) : [];
	return [entry, ...tiers].flatMap((at) =>
		ART_FILE_FIELDS.map((field) => at[field]).filter(
			(file): file is string => typeof file === 'string' && file.length > 0,
		),
	);
};

/** Each exported-art entry's own files, by the key `editor-scenes.ts` `bakedEditorArtAssets`
 *  registers it under (`editorArt/<json>` for a sheet, its `key` for an image or a rig). */
export function editorArtFiles(source: StockAssetSource): Record<string, string[]> {
	const art = isRecord(source.editorArt) ? source.editorArt : {};
	const list = (name: string): Record<string, unknown>[] =>
		Array.isArray(art[name]) ? (art[name] as unknown[]).filter(isRecord) : [];
	const out: Record<string, string[]> = {};
	const add = (key: unknown, entry: Record<string, unknown>) => {
		if (typeof key === 'string' && key) out[key] = [...(out[key] ?? []), ...artFilesOf(entry)];
	};
	for (const sheet of list('sheets')) add(`editorArt/${String(sheet.json)}`, sheet);
	for (const image of list('images')) add(image.key, image);
	for (const rig of list('spines')) add(rig.key, rig);
	return out;
}

/** The folders of the stock table's own files, the audio sprite's aside (its `src` list names its
 *  media, which the prune does not read, and its split is the sound pipeline's). */
export function stockAssetFolders(files = stockAssetFiles()): string[] {
	const audio = new Set(
		Object.entries(stockTable)
			.filter(([, entry]) => entry.type === 'audio')
			.map(([key]) => key),
	);
	const folders = Object.entries(files)
		.filter(([key]) => !audio.has(key))
		.flatMap(([, own]) => own.map((rel) => rel.slice(0, rel.lastIndexOf('/'))))
		.filter((folder) => folder.length > 0);
	return [...new Set(folders)].sort();
}

/** Seed the component registry the way a boot has it when the stock-asset filter runs. */
function registerBundleComponents(source: StockAssetSource): void {
	clearComponents();
	clearComponentDefaults();
	registerComponents(GAME_BUILTIN_DEFS, { builtin: true });
	for (const def of source.componentVersions ?? []) registerComponents({ [def.id]: def });
	if (source.componentDefs) registerComponents(source.componentDefs);
	if (isRecord(source.componentDefaults)) {
		registerComponentDefaults(source.componentDefaults as Record<string, Record<string, unknown>>);
	}
}

export function stockAssetBuildPlan(bundle: unknown): StockAssetBuildPlan {
	const files = stockAssetFiles();
	const folders = stockAssetFolders(files);
	const artFiles = isRecord(bundle) ? editorArtFiles(bundle as StockAssetSource) : {};
	const keepAll = (keptAllBecause: string): StockAssetBuildPlan => ({
		keptAllBecause,
		skipped: [],
		files,
		folders,
		art: { skipped: [], files: artFiles },
	});
	if (!isRecord(bundle)) return keepAll('no readable editor bundle');
	const source = bundle as StockAssetSource;
	if (!hasStockAssetDoc(source)) return keepAll('no baked layout doc');
	try {
		registerBundleComponents(source);
		const gameConfig = createGameConfig({
			bakedConfig: () => source.config as GameConfigDoc | undefined,
			compiledConfig,
		});
		const authoredMap = isRecord(source.symbols) ? source.symbols.map : undefined;
		const symbolsInPlay = [
			...new Set([
				...gameConfig.getSymbolsInPlay(),
				...Object.keys(SYMBOL_INFO_MAP),
				...(isRecord(authoredMap) ? Object.keys(authoredMap) : []),
			]),
		].sort();
		const { needed, keptAllBecause, editorArtUnused } = analyseStockAssets({
			data: stockAssetDataOf(source),
			fallbackDoc: fallbackEditorScenes,
			resolveDef: (id, version): ComponentDef | undefined =>
				resolveComponent(id, version).def ?? BUILTIN_COMPONENTS.find((def) => def.id === id),
			componentDefaults: getComponentDefaults,
			isBoundPart: (name) => name in PART_NEEDS,
			config: gameConfig.getActiveGameConfig(),
			symbolsInPlay,
		});
		if (keptAllBecause) return keepAll(keptAllBecause);
		return {
			skipped: STOCK_KEYS.filter((key) => !needed.has(key)),
			files,
			folders,
			art: { skipped: editorArtUnused.filter((key) => key in artFiles), files: artFiles },
		};
	} catch (error) {
		return keepAll(`the build-time walk threw: ${error}`);
	} finally {
		clearComponents();
		clearComponentDefaults();
	}
}
