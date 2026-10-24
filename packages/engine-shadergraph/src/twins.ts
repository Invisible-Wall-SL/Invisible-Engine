import { ELEMENT_FX_KINDS, type ElementFxKind } from 'constants-shared/elementFx';
import { DISTORT_TWINS } from './twins/distort';
import { MATERIAL_TWINS } from './twins/material';
import { PASS_TWINS } from './twins/passes';
import type { ShaderGraphDoc } from './types';

/**
 * The graph twins of the built-in Element FX (`docs/design/invisible-shader-graph.md` §7.3, step
 * 6): each rebuilds one built-in kind from nodes, with the kind's own params (same ids, kinds,
 * defaults and ranges), phase, length and padding, so an entry's params mean the same on either.
 * `pnpm --filter fx-spike shader-twins` renders each beside its built-in and holds it to the
 * parity tolerance. `/shaders` offers them as "Start from a built-in".
 */
export interface BuiltinTwin {
	/** The built-in it rebuilds. */
	kind: ElementFxKind;
	/** The graph, its id the kind's. */
	doc: ShaderGraphDoc;
	/**
	 * Why the twin's motion only approximates the built-in's, when it does: what the built-in moves
	 * by that a curve over the play cannot follow (the seconds played, a param, looping, the
	 * element's shape). The gate holds every other twin's motion, and every twin's pixels, to parity;
	 * and this one's too at the defaults, unless {@link motionGapAtDefaults}.
	 */
	motionGap?: string;
	/** The motion gap shows at the kind's defaults too, on the gate's card. */
	motionGapAtDefaults?: true;
	/**
	 * Why the twin's room around the element (its doc's fixed padding) is short of the built-in's
	 * in some plays, when it is: the built-in's grows with its params, strength or progress. The gate
	 * then compares the two within the twin's room and reports what the built-in draws past it.
	 */
	paddingGap?: string;
}

export const BUILTIN_TWINS: readonly BuiltinTwin[] = [
	...PASS_TWINS,
	...DISTORT_TWINS,
	...MATERIAL_TWINS,
].sort((a, b) => ELEMENT_FX_KINDS.indexOf(a.kind) - ELEMENT_FX_KINDS.indexOf(b.kind));

/** The twin of built-in `kind`, if it has one. */
export const builtinTwin = (kind: string): BuiltinTwin | undefined =>
	BUILTIN_TWINS.find((t) => t.kind === kind);
