import { ELEMENT_FX_KINDS, type ElementFxKind } from 'constants-shared/elementFx';
import { BREAK_TWINS } from './twins/breaks';
import { DISTORT_TWINS } from './twins/distort';
import { MATERIAL_TWINS } from './twins/material';
import { PASS_TWINS } from './twins/passes';
import type { ShaderGraphDoc } from './types';

/**
 * The graph twins of the built-in Element FX (`docs/design/invisible-shader-graph.md` §7.3, step
 * 6): each rebuilds one built-in kind from nodes, with the kind's own params (same ids, kinds,
 * defaults and ranges), phase, length and padding, so an entry's params mean the same on either.
 * What a kind moves by the seconds played, a param, looping or the element's shape, and the room it
 * grows, is the twin's motion graph (step 8a). A break's twin is the element as it is and a Break
 * Output (step 8b). `pnpm --filter fx-spike shader-twins` renders each beside its built-in and holds
 * it to the parity tolerance, its motion and room included (a break's pieces, in flight), in every
 * case. `/shaders` offers them as "Start from a built-in".
 */
export interface BuiltinTwin {
	/** The built-in it rebuilds. */
	kind: ElementFxKind;
	/** The graph, its id the kind's. */
	doc: ShaderGraphDoc;
}

export const BUILTIN_TWINS: readonly BuiltinTwin[] = [
	...PASS_TWINS,
	...DISTORT_TWINS,
	...MATERIAL_TWINS,
	...BREAK_TWINS,
].sort((a, b) => ELEMENT_FX_KINDS.indexOf(a.kind) - ELEMENT_FX_KINDS.indexOf(b.kind));

export { isBreakTwin } from './twins/breaks';

/** The twin of built-in `kind`, if it has one. */
export const builtinTwin = (kind: string): BuiltinTwin | undefined =>
	BUILTIN_TWINS.find((t) => t.kind === kind);
