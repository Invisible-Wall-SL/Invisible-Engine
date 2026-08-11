// import { STANDARD_MAIN_SIZES_MAP } from 'constants-shared/layout';
import { DEFAULT_LAYOUT_PROFILE, bucketBoxMap } from './layoutProfile';

/**
 * Fixed per-layoutType design box the HUD authors into (`<MainContainer standard>`
 * → `mainLayoutStandard`). Distinct from a game's own `mainSizesMap` (which the
 * gameplay scenes use). Lives here — the lowest shared package — so both
 * `utils-layout` (runtime) and `engine-layout` (the editor contract) read ONE
 * source of truth without a dependency cycle. The editor sizes its frame from
 * this for `space: 'standard' | 'canvas'` scenes.
 *
 * LEGACY VIEW: this is now the DEFAULT profile's bucket boxes (`layoutProfile.ts`).
 * It remains exported for the many call sites that index it by the four legacy
 * bucket ids; authorable per-bucket boxes flow through `LayoutProfile` instead.
 */
export const STANDARD_MAIN_SIZES_MAP = bucketBoxMap(DEFAULT_LAYOUT_PROFILE) as {
	desktop: { width: number; height: number };
	tablet: { width: number; height: number };
	landscape: { width: number; height: number };
	portrait: { width: number; height: number };
};
