import { normalizeHudScenes, type ComponentDef, type LayoutDoc } from 'engine-layout';

import type { StockAssetData } from './stockAssets';

/** Bundle sections the stock-asset walk reads in their own right (the doc, the defs through the
 *  component registry, the config through `getActiveGameConfig`, the symbols), or that only index
 *  the project's own files and text (art, fonts, sounds, localization). Every OTHER section is read
 *  for names, so one added later counts without anyone remembering this list. */
const STOCK_DATA_READ_ELSEWHERE = new Set([
	'doc',
	'componentDefs',
	'componentVersions',
	'componentDefaults',
	'config',
	'symbols',
	'effects',
	'rigFx',
	'shaderEffects',
	'editorArt',
	'fonts',
	'sounds',
	'localization',
	'assetBase',
	'name',
]);

/** The bundle sections {@link stockAssetDataOf} reads: a baked or runtime editor bundle. */
export type StockAssetSource = {
	doc?: LayoutDoc | null;
	symbols?: unknown;
	effects?: unknown;
	rigFx?: unknown;
	editorArt?: unknown;
	componentDefs?: Record<string, ComponentDef>;
	componentVersions?: ComponentDef[];
	componentDefaults?: unknown;
	shaderEffects?: unknown;
	config?: unknown;
};

/** Whether `source` carries a layout the game mounts (`editor-scenes.ts` `hasBakedDoc`). */
export const hasStockAssetDoc = (source: StockAssetSource | null | undefined): boolean =>
	!!(source?.doc && Array.isArray(source.doc.scenes) && source.doc.scenes.length > 0);

/**
 * What the stock-asset filter (`stockAssets.ts`) reads from a bundle: the layout this boot mounts —
 * as `loadEditorScenes` resolves it — and every authored doc it renders from. Shared by the boot
 * (`editor-scenes.ts` `bootStockAssetData`) and the build (`stockAssetBuild.ts`), so both judge the
 * same data.
 */
export function stockAssetDataOf(source: StockAssetSource): StockAssetData {
	return {
		doc: normalizeHudScenes(source.doc as LayoutDoc),
		symbols: source.symbols as StockAssetData['symbols'],
		effects: (source.effects ?? []) as StockAssetData['effects'],
		rigFx: (source.rigFx ?? {}) as StockAssetData['rigFx'],
		other: Object.entries(source as Record<string, unknown>)
			.filter(([section]) => !STOCK_DATA_READ_ELSEWHERE.has(section))
			.map(([, value]) => value),
		editorArt: source.editorArt as StockAssetData['editorArt'],
		componentDefs: [
			...Object.values(source.componentDefs ?? {}),
			...(source.componentVersions ?? []),
		],
		artReferences: [source.componentDefaults, source.shaderEffects],
	};
}
