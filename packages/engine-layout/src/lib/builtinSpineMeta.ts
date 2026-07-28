import { BUILTIN_SPINE_META } from './builtinSpineMeta.generated';

/**
 * Animation / skin / slot / bone NAME lists for one CODED spine bundle — the
 * subset of the editor's `SpineMeta` the Properties-panel dropdowns need (no
 * texture-page / size info; those only matter for a live render).
 */
export interface SpineBundleMeta {
	animations: string[];
	skins: string[];
	slots: string[];
	bones: string[];
}

export { BUILTIN_SPINE_META };

/** The coded spine bundle NAMES the engine ships (what a `spine`-kind param may
 * default to, e.g. `fsIntroNumber` / `bigwin`). Feeds the Scene Editor's spine
 * picker so a coded default appears as a real option, not a free-text "(custom)". */
export const BUILTIN_SPINE_NAMES: string[] = Object.keys(BUILTIN_SPINE_META).sort();

/** Meta for a coded bundle by NAME, or `undefined` for an unknown / project spine. */
export function builtinSpineMeta(name: string | undefined): SpineBundleMeta | undefined {
	return name ? BUILTIN_SPINE_META[name] : undefined;
}
