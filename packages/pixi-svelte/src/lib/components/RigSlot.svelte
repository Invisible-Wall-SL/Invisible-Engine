<script lang="ts" module>
	import * as PIXI from 'pixi.js';

	export type Props = { slotName: string; children: Snippet };
</script>

<script lang="ts">
	import { onMount, type Snippet } from 'svelte';

	import { getContextRig, createContextParent, getContextRigEventEmitter } from '../context.svelte';

	const props: Props = $props();
	const rig = getContextRig();
	const slotContainer = new PIXI.Container();
	const rigEventEmitter = getContextRigEventEmitter();

	let show = $state(!rigEventEmitter);

	onMount(() => {
		// The rig runtime's `addSlotObject` THROWS when the skeleton has no slot with
		// this name (`getSlotFromRef`), which would crash the whole mount. A bundle chosen
		// for `slotName` that lacks it (mismatched rig ⇄ slot param) must degrade, not
		// take the game down — skip attaching and warn once instead.
		if (!rig.skeleton.findSlot(props.slotName)) {
			// Name the slots the skeleton DOES expose. Without them the warning is a dead end: the
			// author cannot see which name to put in the `spineSlot` param, and the count/number simply
			// never appears. Truncated so a large rig cannot flood the console.
			const available = rig.skeleton.slots.map((slot) => slot.data.name);
			const shown = available.slice(0, 20).join(', ');
			console.warn(
				`[RigSlot] no slot "${props.slotName}" on this rig skeleton — slot content will not render. ` +
					(available.length
						? `Available slots: ${shown}${available.length > 20 ? `, …(+${available.length - 20})` : ''}`
						: 'This skeleton has no slots at all.'),
			);
			return;
		}

		if (rigEventEmitter) {
			rigEventEmitter.on('beforeUpdateWorldTransforms', () => {
				const slot = rig.skeleton.findSlot(props.slotName);

				if (slot) {
					show = Boolean(slot?.attachment);
				}
			});
		}

		rig.addSlotObject(props.slotName, slotContainer);
	});

	createContextParent(slotContainer);
</script>

{#if show}
	{@render props.children()}
{/if}
