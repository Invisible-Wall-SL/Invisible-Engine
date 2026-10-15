<script lang="ts">
	/**
	 * A BONE-HOSTED effect whose parameters something drives (Invisible FX Step 2). An effect node
	 * with a `hostSpineId` rides its rig and has no `<LayoutNodeView>` of its own, so the fold that
	 * view runs for a placed effect runs here instead: the node's own value bindings, then the
	 * channels a timeline keys on it, into `<EffectPlayer params>`. Mounted only for a driven effect;
	 * every other bone-hosted effect mounts a bare `<EffectPlayer>` as before.
	 */
	import { EffectPlayer } from 'pixi-svelte';

	import { createBoundValues } from './boundValues.svelte';
	import type { CinematicNodeDrive } from './cinematicNodeContext';
	import { nodeActorBindings, withNodeActorOutputs } from './cinematicNodes';
	import { getComponentParams } from './componentParamsContext';
	import { createFxParamValues, fxParamsDriven } from './fxParamValues.svelte';
	import type { EffectDoc } from './registerEffects';
	import type { EffectNode } from './types';

	type Props = {
		node: EffectNode;
		doc: EffectDoc;
		/** The timeline driving this node, when one does. */
		drive?: CinematicNodeDrive;
		scope?: string;
	};

	const { node, doc, drive, scope }: Props = $props();

	const bindingParams = getComponentParams();
	// svelte-ignore state_referenced_locally
	const bindings = node.valueBindings;
	// svelte-ignore state_referenced_locally
	const timelineBindings = drive ? nodeActorBindings(drive.channels) : [];
	// svelte-ignore state_referenced_locally
	const fxParams = fxParamsDriven(node, bindings, timelineBindings);
	const bound = createBoundValues(
		bindings,
		() => bindingParams,
		() => undefined,
		fxParams,
	);
	const allBindings = timelineBindings.length
		? [...(bindings ?? []), ...timelineBindings]
		: bindings;
	const allOutputs = $derived(
		timelineBindings.length
			? withNodeActorOutputs(bindings, bound.outputs, timelineBindings, drive?.sample())
			: bound.outputs,
	);
	const params = fxParams
		? createFxParamValues(allBindings, () => allOutputs, fxParams)
		: undefined;
</script>

<EffectPlayer {doc} {scope} {params} />
