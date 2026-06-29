import { bakedSymbolMap } from '../editor-scenes';
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
 *
 * The memo holds for the BAKED path (the overrides are a static `import`, present at
 * module-init). It does NOT hold for the live RUNTIME path (Invisible Game Maker): there
 * the overrides arrive via an async fetch in `+layout.ts`'s `load()`, which resolves
 * AFTER module evaluation — and `infoManifest.ts` calls `getSymbolInfo` at import time,
 * so the first call here memoises the coded map BEFORE the overrides land, freezing every
 * symbol to the template default. {@link resetSymbolMapCache} clears the memo once the
 * runtime bundle is applied (see `Game.svelte`), so the next render recomputes WITH the
 * overrides.
 */
export function getActiveSymbolInfoMap(): SymbolInfoMap {
	if (!cached) cached = mergeSymbolMap(SYMBOL_INFO_MAP, bakedSymbolMap());
	return cached;
}

/**
 * Drop the {@link getActiveSymbolInfoMap} memo so the next call recomputes the merge.
 * Called once the live runtime bundle is fetched + applied (`Game.svelte`), to discard a
 * map that was memoised at import time (before the async overrides arrived) — otherwise
 * an online game renders the coded template symbols forever. A no-op for the baked path
 * (the memo there was already correct), preserving dev parity.
 */
export function resetSymbolMapCache(): void {
	cached = null;
}

const DEFAULT_SIZE_RATIOS = { width: 1, height: 1 } as const;

/**
 * VESTIGIAL — symbol size no longer comes from a `sizeRatios` param (the render now
 * contain-fits each symbol to the cell by its own art; see `SymbolSprite`/`SymbolSpineMain`).
 * Kept only so `getSymbolInfo`'s shape is unchanged for any caller that still reads it; the
 * returned ratio does NOT affect the rendered size. The reel "Symbol size (× cell)" control
 * and `reelGrid.symbolSizeRatios` were removed (owner direction — see
 * `feedback_symbols_size_from_art_no_param`). Returns the baked/coded per-cell ratio if one
 * exists, else `{1,1}`.
 */
export function resolveSymbolSizeRatios(
	name: string,
	state: string,
): { width: number; height: number; fit: 'contain' | 'stretch' } {
	const override = bakedSymbolMap()?.[name]?.[state]?.sizeRatios;
	if (override) return { ...override, fit: 'stretch' };
	const coded =
		(SYMBOL_INFO_MAP as SymbolInfoMap)[name]?.[state]?.sizeRatios ?? DEFAULT_SIZE_RATIOS;
	return { ...coded, fit: 'stretch' };
}
