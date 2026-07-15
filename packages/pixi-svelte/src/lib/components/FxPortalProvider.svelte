<script lang="ts" module>
	import type { Snippet } from 'svelte';

	export type Props = {
		children: Snippet;
	};
</script>

<script lang="ts">
	/**
	 * Provide an UNMASKED render target for rig-timeline FX (`<RiggedEffect>`).
	 *
	 * Mounts one container as a sibling in the CURRENT parent (so it escapes any mask an inner
	 * subtree sets on its own container) and hands it to descendants via the FX-portal context
	 * (`setContextFxPortal`). A `<RiggedEffect>` under this provider renders its effect subtree into
	 * that container — world-transform mirrored to the host spine, so it is transform-identical to
	 * the default (spine-parented) mount but no longer clipped.
	 *
	 * Use case: a board draws its symbols on a MASKED layer (clipped to the reel window); an effect
	 * bound to a symbol's always-on idle animation, authored larger than the symbol, would be
	 * clipped. Wrap the masked layer in this provider so the effect shows its full frame while the
	 * symbol art stays masked. Scope it around the masked layer ONLY — an already-unmasked layer
	 * needs no portal, and leaving the context unset there keeps that path unchanged.
	 *
	 * Children with no `<RiggedEffect>` are unaffected: the only cost is one empty container.
	 */
	import * as PIXI from 'pixi.js';
	import { getContextParent, setContextFxPortal } from '../context.svelte';

	const props: Props = $props();

	const portal = new PIXI.Container();
	getContextParent().addToParent(portal);
	setContextFxPortal(portal);
</script>

{@render props.children()}
