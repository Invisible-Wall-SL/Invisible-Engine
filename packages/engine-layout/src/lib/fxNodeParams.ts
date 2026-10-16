import {
	FX_PARAM_CHANNEL_PREFIX,
	type CinematicFxParamChannel,
	type CinematicNodeSample,
} from 'engine-cinematic';
import {
	effectParamValue,
	isHexColor,
	type EffectParam,
	type EffectParamValue,
	type EffectParamValues,
} from 'engine-fx';

import { forwardedParams } from './componentParams';
import type { LayoutNode, ValueBinding } from './types';

/**
 * EXPOSED EFFECT PARAMETERS DRIVEN FROM THE NODE (Invisible FX Step 2, `docs/design/invisible-fx.md`
 * §"Direction (2026-10-15)") — the pure half. A placed `effect` node first sets the parameters
 * itself: its own `params` values, or the enclosing component's params its `params.<id>` bindings
 * name ({@link placedFxParamValues}). Its `fxParam` value bindings and the `fx:<id>` channels a
 * timeline keys on it then drive them through the node's ONE fold: its own bindings' outputs, then
 * the timeline's (`withNodeActorOutputs`), the last value winning, as it does for `fill` and
 * `frame`. This module turns those into the values `<EffectPlayer params>` reads. The runtime
 * (`<LayoutNodeView>`), the editor preview and the gate (`check:fx-node-params`) go through the
 * same functions.
 */

/** The parameter kinds a node drives: a binding or a channel produces a number. A colour parameter
 *  is neither bound nor keyed. */
export const FX_NODE_PARAM_KINDS = ['number', 'bool'] as const;

const DRIVABLE: ReadonlySet<string> = new Set(FX_NODE_PARAM_KINDS);

/** The timeline channel that keys parameter `id`. */
export const fxParamChannel = (id: string): CinematicFxParamChannel =>
	`${FX_PARAM_CHANNEL_PREFIX}${id}`;

/** The parameter id an `fx:<id>` channel keys, or `undefined` for any other channel name. */
export function fxParamOfChannel(channel: string): string | undefined {
	if (!channel.startsWith(FX_PARAM_CHANNEL_PREFIX)) return undefined;
	const id = channel.slice(FX_PARAM_CHANNEL_PREFIX.length);
	return id || undefined;
}

/** The parameters of an effect a node can drive, in the effect's order. */
export function drivableFxParams(params: readonly EffectParam[] | undefined): EffectParam[] {
	return (params ?? []).filter((param) => DRIVABLE.has(param.kind));
}

/** The drivable parameter `id`, or `undefined` when the effect declares no number or bool one. */
export function drivableFxParam(
	params: readonly EffectParam[] | undefined,
	id: string | undefined,
): EffectParam | undefined {
	if (!id) return undefined;
	return params?.find((param) => param.id === id && DRIVABLE.has(param.kind));
}

/** Does any of `bindings` target an effect parameter? */
export const bindsFxParam = (bindings: readonly ValueBinding[] | undefined): boolean =>
	!!bindings?.some((binding) => binding.target === 'fxParam');

/** Does `node` set a parameter of its effect itself: a value of its own, or one it takes from the
 *  enclosing component (`params.<id>`)? */
export function setsFxParams(node: LayoutNode): boolean {
	if (node.kind !== 'effect') return false;
	return (!!node.params && Object.keys(node.params).length > 0) || forwardedParams(node).length > 0;
}

/** `raw` as a value of `param`'s kind, or `undefined` when it is not one. A component's colour
 *  param holds `0xrrggbb`, which reads as `#rrggbb`. */
function asFxParamValue(param: EffectParam, raw: unknown): EffectParamValue | undefined {
	switch (param.kind) {
		case 'number':
			return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
		case 'bool':
			return typeof raw === 'boolean' ? raw : undefined;
		case 'color':
			if (typeof raw === 'number' && Number.isFinite(raw))
				return `#${(raw & 0xffffff).toString(16).padStart(6, '0')}`;
			return isHexColor(raw) ? raw : undefined;
	}
}

/**
 * The parameter values a node sets itself, before any binding or timeline: for each parameter the
 * effect declares, the param of the enclosing component a `params.<id>` binding names
 * (`componentParams`: the owning instance's resolved params) while it holds a value of the
 * parameter's kind, else the node's own `params` value — through `effectParamValue`, which clamps a
 * number to the range. An id the effect does not declare is skipped. `undefined` when the node sets
 * nothing: the effect then draws its defaults.
 */
export function placedFxParamValues(
	node: LayoutNode,
	componentParams: Readonly<Record<string, unknown>>,
	params: readonly EffectParam[] | undefined,
): EffectParamValues | undefined {
	if (node.kind !== 'effect' || !params?.length) return undefined;
	const forwards = new Map(forwardedParams(node));
	let values: Record<string, EffectParamValue> | undefined;
	for (const param of params) {
		const parentKey = forwards.get(param.id);
		const value =
			(parentKey === undefined ? undefined : asFxParamValue(param, componentParams[parentKey])) ??
			asFxParamValue(param, node.params?.[param.id]);
		if (value === undefined) continue;
		values ??= {};
		values[param.id] = effectParamValue(param, value);
	}
	return values;
}

/** What `<EffectPlayer params>` reads: the node's own values, with what its bindings and timeline
 *  drive ({@link boundFxParamValues}) on top. */
export function nodeFxParamValues(
	placed: EffectParamValues | undefined,
	bound: EffectParamValues | undefined,
): EffectParamValues | undefined {
	return placed && bound ? { ...placed, ...bound } : (bound ?? placed);
}

/**
 * The parameter values a node's fold produces: for each `fxParam` binding with an output, in
 * order, its parameter's value — so a later binding wins, and a timeline's (appended after the
 * node's own) wins over them. A number output is the parameter's value, a bool one is on from 0.5;
 * both go through `effectParamValue`, which clamps to the range. A binding naming a parameter the
 * effect does not declare (or a colour one) is skipped. `undefined` when nothing has a value: the
 * effect then draws its defaults.
 */
export function boundFxParamValues(
	bindings: readonly ValueBinding[] | undefined,
	outputs: readonly (number | undefined)[],
	params: readonly EffectParam[] | undefined,
): EffectParamValues | undefined {
	let values: Record<string, EffectParamValue> | undefined;
	bindings?.forEach((binding, i) => {
		const out = outputs[i];
		if (binding.target !== 'fxParam' || out === undefined || !Number.isFinite(out)) return;
		const param = drivableFxParam(params, binding.fxParam);
		if (!param) return;
		values ??= {};
		values[param.id] = effectParamValue(param, param.kind === 'bool' ? out >= 0.5 : out);
	});
	return values;
}

/**
 * Where a channel rests when a timeline does not key it: the node's own value for its parameter
 * (`own`, the node's `params`), else the parameter's default, as the number a channel holds (a bool
 * reads 1 or 0). What a state-machine blend mixes from or towards when only one side keys the
 * parameter. `undefined` for a channel that keys no drivable parameter.
 */
export function fxParamRest(
	params: readonly EffectParam[] | undefined,
	channel: string,
	own?: Readonly<Record<string, unknown>>,
): number | undefined {
	const param = drivableFxParam(params, fxParamOfChannel(channel));
	if (!param) return undefined;
	const value = effectParamValue(param, own?.[param.id]);
	return typeof value === 'boolean' ? +value : typeof value === 'number' ? value : undefined;
}

/** The `fx:` channels a node sample carries. */
export function sampledFxChannels(
	sample: CinematicNodeSample | undefined,
): CinematicFxParamChannel[] {
	const out: CinematicFxParamChannel[] = [];
	for (const key in sample ?? {}) {
		if (fxParamOfChannel(key) !== undefined) out.push(key as CinematicFxParamChannel);
	}
	return out;
}

export interface FxParamBindingIssue {
	code: 'fx-param-missing' | 'fx-param-unknown' | 'fx-param-colour';
	message: string;
}

/**
 * Why an `fxParam` binding does nothing, against the placed effect's parameters — or `undefined`
 * when it works, or when the effect is not known here (`params` absent: nothing to check against).
 * The runtime skips every one of these cases; this is where they show.
 */
export function fxParamBindingIssue(
	binding: ValueBinding,
	effect: { params?: readonly EffectParam[] } | undefined,
): FxParamBindingIssue | undefined {
	if (binding.target !== 'fxParam') return undefined;
	if (!binding.fxParam) {
		return { code: 'fx-param-missing', message: 'Pick the effect parameter it drives.' };
	}
	if (!effect) return undefined;
	const declared = effect.params?.find((param) => param.id === binding.fxParam);
	if (!declared) {
		return {
			code: 'fx-param-unknown',
			message: `The effect has no parameter "${binding.fxParam}" (renamed or removed in /fx?).`,
		};
	}
	if (!DRIVABLE.has(declared.kind)) {
		return {
			code: 'fx-param-colour',
			message: `"${binding.fxParam}" is a colour parameter; a binding drives a number or on/off one.`,
		};
	}
	return undefined;
}
