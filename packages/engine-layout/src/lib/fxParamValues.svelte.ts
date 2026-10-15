import type { EffectParam, EffectParamValues } from 'engine-fx';

import { boundFxParamValues, bindsFxParam, drivableFxParams } from './fxNodeParams';
import { resolveEffect } from './registerEffects';
import type { LayoutNode, ValueBinding } from './types';

/**
 * The placed effect's parameters, when `node` is an effect that one of its own bindings or a
 * timeline channel (`timeline`, the node actor's bindings) drives and that declares a parameter a
 * node can drive; `undefined` otherwise, and then nothing extra runs for the node (parity).
 */
export function fxParamsDriven(
	node: LayoutNode,
	own: readonly ValueBinding[] | undefined,
	timeline: readonly ValueBinding[],
): readonly EffectParam[] | undefined {
	if (node.kind !== 'effect' || (!bindsFxParam(own) && !bindsFxParam(timeline))) return undefined;
	const params = resolveEffect(node.effectId)?.params;
	return drivableFxParams(params).length ? params : undefined;
}

/**
 * The getter `<EffectPlayer params>` reads on the ticker: the parameter values of the node's fold
 * (`boundFxParamValues`), derived once per change of its outputs — not once per layer per frame.
 * Call during component init.
 */
export function createFxParamValues(
	bindings: readonly ValueBinding[] | undefined,
	outputs: () => readonly (number | undefined)[],
	params: readonly EffectParam[],
): () => EffectParamValues | undefined {
	const values = $derived(boundFxParamValues(bindings, outputs(), params));
	return () => values;
}
