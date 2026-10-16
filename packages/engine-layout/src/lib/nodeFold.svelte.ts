import { untrack } from 'svelte';
import type { CinematicNodeSample } from 'engine-cinematic';
import type { EffectParam, EffectParamValues } from 'engine-fx';

import { createBoundValues, type BoundValues } from './boundValues.svelte';
import type { CinematicNodeDrive, CinematicNodeDriver } from './cinematicNodeContext';
import { nodeActorBindings, withNodeActorOutputs } from './cinematicNodes';
import {
	boundFxParamValues,
	bindsFxParam,
	drivableFxParams,
	nodeFxParamValues,
	placedFxParamValues,
	setsFxParams,
} from './fxNodeParams';
import { resolveEffect } from './registerEffects';
import type { EffectNode, LayoutNode, ValueBinding } from './types';

/**
 * ONE NODE'S FOLD — the numbers that drive a layout node: its own value bindings (Phase 12b), then
 * the channels a timeline keys on it (Rive plan §3.1), one output per binding. `<LayoutNodeView>`
 * runs it for every node and `<DrivenEffectPlayer>` for a bone-hosted effect, so a placed effect's
 * exposed parameters (Invisible FX Step 2) come out of the same fold either way. Call during
 * component init; everything it reads off the node and the drive is read once.
 */
export interface NodeFold {
	/** The node's own bindings' live outputs. */
	readonly bound: BoundValues;
	/** The bindings the timeline's keyed channels stand for; empty when no timeline drives it. */
	readonly timelineBindings: readonly ValueBinding[];
	/** The node's own bindings, then the timeline's: what every fold of the node reads. */
	readonly allBindings: readonly ValueBinding[] | undefined;
	/** One output per `allBindings` entry. Reactive. */
	readonly allOutputs: readonly (number | undefined)[];
	/** The timeline's channels at its current time, when one drives the node. Reactive. */
	readonly timelineSample: CinematicNodeSample | undefined;
	/**
	 * What `<EffectPlayer params>` reads on the ticker: the effect's parameter values — the node's
	 * own, then this fold's — derived once per change. Only for an effect something sets or drives
	 * (parity).
	 */
	readonly fxParamValues: (() => EffectParamValues | undefined) | undefined;
}

/**
 * The placed effect's parameters, when `node` is an effect that sets one itself (`setsFxParams`)
 * and declares parameters, or that one of its own bindings or a timeline channel (`timeline`, the
 * node actor's bindings) drives and that declares a parameter a node can drive; `undefined`
 * otherwise, and then nothing extra runs for the node (parity).
 */
export function fxParamsDriven(
	node: LayoutNode,
	own: readonly ValueBinding[] | undefined,
	timeline: readonly ValueBinding[],
): readonly EffectParam[] | undefined {
	if (node.kind !== 'effect') return undefined;
	const placed = setsFxParams(node);
	if (!placed && !bindsFxParam(own) && !bindsFxParam(timeline)) return undefined;
	const params = resolveEffect(node.effectId)?.params;
	if (!params?.length) return undefined;
	return placed || drivableFxParams(params).length ? params : undefined;
}

function createFxParamValues(
	node: LayoutNode,
	componentParams: () => Record<string, unknown>,
	bindings: readonly ValueBinding[] | undefined,
	outputs: () => readonly (number | undefined)[],
	params: readonly EffectParam[],
): () => EffectParamValues | undefined {
	const values = $derived(
		nodeFxParamValues(
			placedFxParamValues(node, componentParams(), params),
			boundFxParamValues(bindings, outputs(), params),
		),
	);
	return () => values;
}

/**
 * `node`'s fold. `params` are the owning instance's params (`{key}` placeholders and `param`
 * inputs), `frameCount` a flipbook's frame count (a `frame` binding's default top), and `drive` the
 * timeline driving the node, asked once by the caller (`cinematicNodeContext`). An effect's
 * `fxParam` bindings map onto its declared parameters (their range, a bool one switching at its
 * threshold), over the values the node sets itself — the parameters `fxParamsDriven` reads.
 */
export function createNodeFold(
	node: LayoutNode,
	params: () => Record<string, unknown>,
	frameCount: () => number | undefined,
	drive: CinematicNodeDrive | undefined,
): NodeFold {
	const bindings = node.valueBindings;
	const timelineBindings = drive ? nodeActorBindings(drive.channels) : [];
	const fxParams = fxParamsDriven(node, bindings, timelineBindings);
	const bound = createBoundValues(bindings, params, frameCount, fxParams);
	const timelineSample = $derived(drive?.sample());
	const allBindings = timelineBindings.length
		? [...(bindings ?? []), ...timelineBindings]
		: bindings;
	const allOutputs = $derived(
		timelineBindings.length
			? withNodeActorOutputs(bindings, bound.outputs, timelineBindings, timelineSample)
			: bound.outputs,
	);
	return {
		bound,
		timelineBindings,
		allBindings,
		get allOutputs() {
			return allOutputs;
		},
		get timelineSample() {
			return timelineSample;
		},
		fxParamValues: fxParams
			? createFxParamValues(node, params, allBindings, () => allOutputs, fxParams)
			: undefined,
	};
}

/** A bone-hosted effect something sets or drives, with the timeline driving it (if one does);
 *  `null` when nothing sets its parameters. */
export type AttachedEffectDrive = { drive: CinematicNodeDrive | undefined } | null;

/**
 * For a rig's bone-hosted effects (`attachedEffects`, which have no view of their own): whether
 * something drives each one's parameters, and the timeline drive it then folds — asked ONCE per
 * effect, untracked, as every node's timeline drive is, so a re-render never swaps the effect's
 * player (which would reset its particles). `driver` is the host view's node driver.
 */
export function attachedEffectDrives(
	driver: CinematicNodeDriver | undefined,
): (fx: EffectNode) => AttachedEffectDrive {
	let asked: Map<string, AttachedEffectDrive> | undefined;
	return (fx) => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		asked ??= new Map();
		let entry = asked.get(fx.id);
		if (entry === undefined) {
			entry = untrack((): AttachedEffectDrive => {
				const drive = driver?.(fx.id);
				const timeline = drive ? nodeActorBindings(drive.channels) : [];
				return fxParamsDriven(fx, fx.valueBindings, timeline) ? { drive } : null;
			});
			asked.set(fx.id, entry);
		}
		return entry;
	};
}
