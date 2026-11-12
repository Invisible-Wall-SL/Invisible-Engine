import {
	BUILTIN_COMPONENTS,
	getBoundComponent,
	getComponentDefaults,
	resolveComponent,
} from 'engine-layout';

import { bootStockAssetData } from '../editor-scenes';
import { anticipationParam } from './anticipationParam';
import { fallbackEditorScenes } from './fallbackLayout';
import { getActiveGameConfig, getSymbolsInPlay } from './gameConfig';
import { analyseStockAssets, anticipationRigLeftOut, withoutStockAssets } from './stockAssets';
import { stockAssetsOnDevice } from './stateApp';
import { ANTICIPATION_SWITCHES } from './stockAssetRules';

/** A standalone build that may have left stock files out (`config-vite` `stockAssetPrune.js`). */
const stockFilesPruned = (): boolean =>
	typeof __IE_STOCK_PRUNED__ !== 'undefined' && __IE_STOCK_PRUNED__;

let refusedAnticipationParam = false;

/**
 * Whether the boot refused `?anticipation=`: a pruned build whose docs never arm the reel
 * anticipation may have left its overlay rig out, so `Game.svelte` does not arm the mode.
 */
export const anticipationParamRefused = (): boolean => refusedAnticipationParam;

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
		typeof location !== 'undefined' && anticipationParam(location.search) !== null;
	const analyse = (withUrl: boolean) =>
		analyseStockAssets({
			data: withUrl ? { ...data, other: [...(data.other ?? []), ANTICIPATION_SWITCHES] } : data,
			fallbackDoc: fallbackEditorScenes,
			resolveDef: (id, version) =>
				resolveComponent(id, version).def ?? BUILTIN_COMPONENTS.find((def) => def.id === id),
			componentDefaults: getComponentDefaults,
			isBoundPart: (name) => getBoundComponent(name) !== undefined,
			config: getActiveGameConfig(),
			symbolsInPlay: getSymbolsInPlay(),
		});
	let analysis = analyse(urlArmsAnticipation);
	if (urlArmsAnticipation && stockFilesPruned()) {
		// The build plan (`stockAssetBuild.ts`) has no URL, so it may have left out the rig the param
		// needs and its own docs do not.
		const own = analyse(false);
		if (anticipationRigLeftOut(data, own.needed)) {
			refusedAnticipationParam = true;
			analysis = own;
			console.info(
				'[stock-assets] ignored ?anticipation=: no flow arms the reel anticipation, so this ' +
					'build may have left its rig out',
			);
		}
	}
	const { needed, keptAllBecause, editorArtUnused } = analysis;
	// The table as this device registered it: on the compressed tier a twinned entry is not the
	// coded one, and `withoutStockAssets` skips only an entry that is still the stock one.
	const { assets, skipped } = withoutStockAssets(registered, stockAssetsOnDevice, needed);
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
