import { BUILTIN_COMPONENTS } from './builtinComponents';
import { BUILTIN_TIMELINES } from './builtinTimelines';
import { PROP_COMPONENTS, PROP_TIMELINES } from './propComponents';
import type { CinematicDoc, ComponentDef } from './types';

/** Two lists as one. Each export is one `@__PURE__` call of it, so a bundle that reaches this
 *  module through the package's index and reads neither (every runtime) keeps none of it, nor the
 *  prop defs: an array spread at the top level would be kept. */
const joined = <T>(a: readonly T[], b: readonly T[]): T[] => [...a, ...b];

/**
 * THE LAUNCHER'S BUILT-IN LIBRARY: every built-in def and timeline the editor offers and a project
 * copies from, the prop built-ins (`propComponents.ts`) included. Nothing a runtime imports reaches
 * this module, so the prop defs stay out of every runtime's main bundle: a runtime gets them from the
 * arcade art that draws them (`engine-layout/salmons-art`), behind its dynamic import.
 */
export const BUILTIN_LIBRARY_COMPONENTS: readonly ComponentDef[] = /* @__PURE__ */ joined(
	BUILTIN_COMPONENTS,
	PROP_COMPONENTS,
);

/** Every built-in timeline the editor lists, the prop built-ins' included. */
export const BUILTIN_LIBRARY_TIMELINES: readonly CinematicDoc[] = /* @__PURE__ */ joined(
	BUILTIN_TIMELINES,
	PROP_TIMELINES,
);
