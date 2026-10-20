<script lang="ts">
	/**
	 * A BONE-HOSTED effect whose parameters the node sets or something drives (Invisible FX Step 2).
	 * An effect node with a `hostSpineId` rides its rig and has no `<LayoutNodeView>` of its own, so
	 * the fold that view runs for a placed effect (`createNodeFold`) runs here instead: the node's
	 * own values, its value bindings, then the channels a timeline keys on it, into `<EffectPlayer
	 * params>`. Mounted only for such an effect; every other bone-hosted effect mounts a bare
	 * `<EffectPlayer>` as before.
	 */
	import { EffectPlayer } from 'pixi-svelte';

	import type { CinematicNodeDrive } from './cinematicNodeContext';
	import { getComponentParams } from './componentParamsContext';
	import { createNodeFold } from './nodeFold.svelte';
	import type { EffectDoc } from './registerEffects';
	import type { EffectNode } from './types';

	type Props = {
		node: EffectNode;
		doc: EffectDoc;
		/** The timeline driving this node, asked once by the host rig's view. */
		drive?: CinematicNodeDrive;
		scope?: string;
	};

	const { node, doc, drive, scope }: Props = $props();

	const bindingParams = getComponentParams();
	// svelte-ignore state_referenced_locally
	const fold = createNodeFold(
		node,
		() => bindingParams,
		() => undefined,
		drive,
	);
</script>

<EffectPlayer {doc} {scope} params={fold.fxParamValues} />
