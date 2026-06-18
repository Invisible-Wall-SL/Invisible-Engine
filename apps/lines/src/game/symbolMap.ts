import { bakedSymbolMap } from '../editor-scenes';
import { boardSymbolSizeRatios } from './stateGame.svelte';
import { SYMBOL_INFO_MAP } from './constants';
import type { SymbolInfoMap } from './types';

/**
 * Cell-level merge of the coded default map with a baked overrides map (Invisible
 * Symbols State Machine output). An override replaces a WHOLE binding; an unset
 * symbol/state falls through to the base — sparse, like `componentDefaults`. The base
 * is the `as const` `SYMBOL_INFO_MAP`, structurally a `SymbolInfoMap`.
 */
function mergeSymbolMap(base: SymbolInfoMap, overrides?: SymbolInfoMap): SymbolInfoMap {
	if (!overrides) return base;
	const out: SymbolInfoMap = {};
	for (const name of new Set([...Object.keys(base), ...Object.keys(overrides)])) {
		out[name] = { ...(base[name] ?? {}), ...(overrides[name] ?? {}) };
	}
	return out;
}

let cached: SymbolInfoMap | null = null;

/**
 * The map the game actually renders from: coded defaults ⊕ baked overrides. Computed
 * lazily on first symbol render (memoised) so module-init order never races the
 * baked-bundle import. Un-baked repos (`bakedSymbolMap()` → undefined) get the coded
 * map byte-for-byte — dev parity.
 */
export function getActiveSymbolInfoMap(): SymbolInfoMap {
	if (!cached) cached = mergeSymbolMap(SYMBOL_INFO_MAP, bakedSymbolMap());
	return cached;
}

const DEFAULT_SIZE_RATIOS = { width: 1, height: 1 } as const;

/**
 * The size a symbol×state cell renders at. Order: the reel's `symbolSizeRatios` (Scene Editor
 * "Symbol size (× cell)") > per-cell baked `sizeRatios` (Symbols State Machine) > coded
 * `SYMBOL_INFO_MAP` size > {1,1}. The reel control wins FIRST because it is the explicit
 * "applied to EVERY symbol" global the author set in the editor — and once a symbols doc is
 * baked EVERY cell carries a (default `{1,1}`) `sizeRatios`, so checking the baked map first
 * silently shadowed the reel control for every published game. This matches the editor
 * preview's `node.symbolSizeRatios ?? cell.sizeRatios` precedence; clear the reel control to
 * fall back to the per-symbol sizes. Read from the ORIGINAL layers (not the merged map, which
 * replaces whole cells). Consumed via `getSymbolInfo`, so render components read a resolved size.
 *
 * `fit` signals provenance so the renderer knows how to apply the ratio: the reel-override
 * path is `'contain'` (the ratio is a bounding box; the symbol fits inside preserving its
 * native aspect), every other path is `'stretch'` (today's behavior — width/height applied
 * directly to `SYMBOL_SIZE × ratio`). Parity for the stretch paths is non-negotiable.
 */
export function resolveSymbolSizeRatios(
	name: string,
	state: string,
): { width: number; height: number; fit: 'contain' | 'stretch' } {
	const reel = boardSymbolSizeRatios();
	if (reel) return { ...reel, fit: 'contain' };
	const override = bakedSymbolMap()?.[name]?.[state]?.sizeRatios;
	if (override) return { ...override, fit: 'stretch' };
	const coded =
		(SYMBOL_INFO_MAP as SymbolInfoMap)[name]?.[state]?.sizeRatios ?? DEFAULT_SIZE_RATIOS;
	return { ...coded, fit: 'stretch' };
}
