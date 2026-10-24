/**
 * The twins of the built-in kinds a custom effect can draw as a pass (`ELEMENT_FX_PASS_KINDS`) and
 * that have no node twin: the Output alone, then that kind's own pass with each of its params tied
 * to the effect's param of the same id. Exact by construction. Shine and flash have node twins
 * (`material.ts`), which win.
 */

import {
	ELEMENT_FX_PASS_KINDS,
	elementFxSpec,
	type CustomElementFxPassValue,
	type ElementFxPassKind,
} from 'constants-shared/elementFx';
import type { BuiltinTwin } from '../twins';
import { twinGraph } from './graph';

const NODE_TWINNED: readonly ElementFxPassKind[] = ['shine', 'flash'];

const passTwin = (kind: ElementFxPassKind): BuiltinTwin => {
	const params: Record<string, CustomElementFxPassValue> = Object.fromEntries(
		elementFxSpec(kind).params.map((p) => [p.id, { param: p.id }]),
	);
	const g = twinGraph(kind, { passes: [{ kind, params }] });
	g.output();
	return { kind, doc: g.doc() };
};

export const PASS_TWINS: readonly BuiltinTwin[] = ELEMENT_FX_PASS_KINDS.filter(
	(kind) => !NODE_TWINNED.includes(kind),
).map(passTwin);
