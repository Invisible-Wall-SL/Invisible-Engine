import { BUILTIN_RIG_META } from './builtinRigMeta.generated';

/**
 * Animation / skin / slot / bone NAME lists for one CODED rig bundle — the
 * subset of the editor's `RigMeta` the Properties-panel dropdowns need (no
 * texture-page / size info; those only matter for a live render).
 */
export interface RigBundleMeta {
	animations: string[];
	skins: string[];
	slots: string[];
	bones: string[];
}

export { BUILTIN_RIG_META };

/** The coded rig bundle NAMES the engine ships (what a `spine`-kind param may
 * default to, e.g. `fsIntroNumber` / `bigwin`). Feeds the Scene Editor's rig
 * picker so a coded default appears as a real option, not a free-text "(custom)". */
export const BUILTIN_RIG_NAMES: string[] = Object.keys(BUILTIN_RIG_META).sort();

/** Meta for a coded bundle by NAME, or `undefined` for an unknown / project rig. */
export function builtinRigMeta(name: string | undefined): RigBundleMeta | undefined {
	return name ? BUILTIN_RIG_META[name] : undefined;
}
