// import { STANDARD_MAIN_SIZES_MAP } from 'constants-shared/layout';

/**
 * Fixed per-layoutType design box the HUD authors into (`<MainContainer standard>`
 * → `mainLayoutStandard`). Distinct from a game's own `mainSizesMap` (which the
 * gameplay scenes use). Lives here — the lowest shared package — so both
 * `utils-layout` (runtime) and `engine-layout` (the editor contract) read ONE
 * source of truth without a dependency cycle. The editor sizes its frame from
 * this for `space: 'standard' | 'canvas'` scenes.
 */
export const STANDARD_MAIN_SIZES_MAP = {
	desktop: { width: 1920, height: 1080 },
	tablet: { width: 1920, height: 1920 },
	landscape: { width: 1920, height: 1080 },
	portrait: { width: 1080, height: 1920 },
};
