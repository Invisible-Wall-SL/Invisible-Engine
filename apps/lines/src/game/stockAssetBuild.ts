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
	const keepAll = (keptAllBecause: string): StockAssetBuildPlan => ({
		keptAllBecause,
		skipped: [],
		files,
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
		const { needed, keptAllBecause } = analyseStockAssets({
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
		return { skipped: STOCK_KEYS.filter((key) => !needed.has(key)), files };
	} catch (error) {
		return keepAll(`the build-time walk threw: ${error}`);
	} finally {
		clearComponents();
		clearComponentDefaults();
	}
}
