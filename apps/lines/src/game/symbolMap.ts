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
 * The size a symbol×state cell renders at. Order: per-cell baked override (legacy — a baked
 * symbols doc that still carries a cell `sizeRatios`) > the reel's `symbolSizeRatios` (authored
 * on the reelGrid node in the Scene Editor) > coded `SYMBOL_INFO_MAP` size > {1,1}. Read from
 * the ORIGINAL layers (not the merged map, which replaces whole cells). Consumed via
 * `getSymbolInfo`, so render components read a fully-resolved `sizeRatios`.
 */
export function resolveSymbolSizeRatios(
	name: string,
	state: string,
): { width: number; height: number } {
	const override = bakedSymbolMap()?.[name]?.[state]?.sizeRatios;
	if (override) return override;
	const reel = boardSymbolSizeRatios();
	if (reel) return reel;
	return (SYMBOL_INFO_MAP as SymbolInfoMap)[name]?.[state]?.sizeRatios ?? DEFAULT_SIZE_RATIOS;
}
