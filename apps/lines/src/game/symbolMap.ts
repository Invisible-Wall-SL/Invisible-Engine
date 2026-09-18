import { createSymbolMap } from 'engine-game';

import { bakedSymbolMap } from '../editor-scenes';
import { SYMBOL_INFO_MAP } from './constants';
import type { SymbolInfoMap } from './types';

/**
 * This game's symbol map: the engine's coded ⊕ baked merge from `engine-game`, pointed at THIS
 * game's two sources. Phase A of `docs/design/game-type-templates.md`.
 *
 * Constructed once at module scope, so the two caches inside behave exactly as they did when they
 * were module-level `let`s — including the requirement that `Game.svelte` calls
 * `resetSymbolMapCache()` once the live runtime bundle is applied. Miss that and an online game
 * renders the coded template symbols forever.
 *
 * The instance is exported as well as its members because `utils.ts` builds the symbol RESOLVER on
 * it (`createSymbolInfo`), and the resolver's memo is keyed by this map's generation counter — one
 * instance, one generation, no way to wire them apart.
 *
 * The cast is the one the old `resolveSymbolSizeRatios` already carried: `constants.ts` builds a
 * few shared cells (`explosion`, the `*Static` sprites) without `as const`, so their `type` widens
 * to `string` and the `as const` map is only STRUCTURALLY a `SymbolInfoMap`. Asserted once here, at
 * the seam, rather than at each read.
 */
export const symbolMap = createSymbolMap({
	codedMap: SYMBOL_INFO_MAP as SymbolInfoMap,
	bakedMap: bakedSymbolMap,
});

export const { getActiveSymbolInfoMap, resetSymbolMapCache } = symbolMap;
