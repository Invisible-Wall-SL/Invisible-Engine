import {
	BUILTIN_COMPONENTS,
	getBoundComponent,
	getComponentDefaults,
	resolveComponent,
} from 'engine-layout';

import { bootStockAssetData } from '../editor-scenes';
import stockAssets from './assets';
import { fallbackEditorScenes } from './fallbackLayout';
import { getActiveGameConfig, getSymbolsInPlay } from './gameConfig';
import { analyseStockAssets, withoutStockAssets } from './stockAssets';
import { ANTICIPATION_SWITCHES } from './stockAssetRules';

/**
 * The asset table without the stock assets this project can never draw (`stockAssets.ts`). Called
 * once from `Game.svelte`, after the project's defs and bound parts are registered and before
 * `<App>` mounts the loader, which reads the table when it mounts. A boot with no doc yet (dev,
 * live-doc) gets the table back untouched.
 *
 * A def the registry does not hold yet falls back to the built-in of that id: the buy screens'
 * defs (`registerBuyFeature`, `registerHudMenus`) are registered after this runs.
 */
export function skipUnusedStockAssets<T extends Record<string, unknown>>(registered: T): T {
	const data = bootStockAssetData();
	if (!data) return registered;
	// `?anticipation=` arms the reel anticipation at boot (`Game.svelte`), as the flow action does.
	const urlArmsAnticipation =
		typeof location !== 'undefined' &&
		new URLSearchParams(location.search).get('anticipation') !== null;
	const { needed, keptAllBecause, editorArtUnused } = analyseStockAssets({
		data: urlArmsAnticipation
			? { ...data, other: [...(data.other ?? []), ANTICIPATION_SWITCHES] }
			: data,
		fallbackDoc: fallbackEditorScenes,
		resolveDef: (id, version) =>
			resolveComponent(id, version).def ?? BUILTIN_COMPONENTS.find((def) => def.id === id),
		componentDefaults: getComponentDefaults,
		isBoundPart: (name) => getBoundComponent(name) !== undefined,
		config: getActiveGameConfig(),
		symbolsInPlay: getSymbolsInPlay(),
	});
	const { assets, skipped } = withoutStockAssets(registered, stockAssets, needed);
	const art = editorArtUnused.filter((key) => key in assets);
	const kept: T = art.length ? { ...assets } : assets;
	for (const key of art) delete kept[key];
	console.info(
		keptAllBecause
			? `[stock-assets] kept every stock asset: ${keptAllBecause}`
			: `[stock-assets] skipped ${skipped.length} stock asset(s) this project never draws: ${skipped.join(', ') || 'none'}`,
	);
	if (art.length) {
		console.info(
			`[stock-assets] skipped ${art.length} exported art asset(s) only a component default every placement overrides names: ${art.join(', ')}`,
		);
	}
	return kept;
}
