import type { SymbolInfoMap } from './types';

/**
 * The two SOURCES a game's symbol art can come from. Phase A of
 * `docs/design/game-type-templates.md`.
 *
 * The MERGE and its two caches — coded ⊕ baked, the memo, and the generation counter the symbol
 * resolver keys off — are identical for every game type and live here. What differs per game is
 * only where the two sources come from, which is the entire seam.
 *
 * Note what this seam is NOT: an inversion of the app's whole `editor-scenes` module. Of its 52
 * exports the symbol layer reads exactly one, so one getter is the seam. Handing the factory the
 * module would have coupled the engine to a game's baked bundle for nothing.
 */
export interface SymbolMapDeps {
	/** This game's CODED symbol bindings (`SYMBOL_INFO_MAP` in the app's `constants.ts`). Game
	 *  CONTENT, which is why Phase A3.5 left it in the app. */
	codedMap: SymbolInfoMap;
	/** The project's BAKED overrides (`bakedSymbolMap()` off the app's editor bundle). A GETTER, not
	 *  a value: on the live runtime path the overrides arrive after this module has evaluated. */
	bakedMap: () => SymbolInfoMap | undefined;
}

/** Derived from the factory's return type rather than re-declared, so a consumer's view of the map
 *  API cannot drift from what the factory actually builds. */
export type SymbolMapApi = ReturnType<typeof createSymbolMap>;

export function createSymbolMap(deps: SymbolMapDeps) {
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
	function getActiveSymbolInfoMap(): SymbolInfoMap {
		if (!cached) cached = mergeSymbolMap(deps.codedMap, deps.bakedMap());
		return cached;
	}

	/**
	 * Drop the {@link getActiveSymbolInfoMap} memo so the next call recomputes the merge.
	 * Called once the live runtime bundle is fetched + applied (`Game.svelte`), to discard a
	 * map that was memoised at import time (before the async overrides arrived) — otherwise
	 * an online game renders the coded template symbols forever. A no-op for the baked path
	 * (the memo there was already correct), preserving dev parity.
	 */
	function resetSymbolMapCache(): void {
		cached = null;
		generation += 1;
	}

	/**
	 * Bumped by {@link resetSymbolMapCache}. Read by `getSymbolInfo`'s memo so the two caches can
	 * never disagree about which map is live: one counter, invalidated at one place, rather than a
	 * second clear call at every reset site that a future caller could forget.
	 */
	let generation = 0;
	function symbolMapGeneration(): number {
		return generation;
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
	function resolveSymbolSizeRatios(
		name: string,
		state: string,
	): { width: number; height: number; fit: 'contain' | 'stretch' } {
		const override = deps.bakedMap()?.[name]?.[state]?.sizeRatios;
		if (override) return { ...override, fit: 'stretch' };
		const coded = deps.codedMap[name]?.[state]?.sizeRatios ?? DEFAULT_SIZE_RATIOS;
		return { ...coded, fit: 'stretch' };
	}

	return {
		getActiveSymbolInfoMap,
		resetSymbolMapCache,
		symbolMapGeneration,
		resolveSymbolSizeRatios,
	};
}
