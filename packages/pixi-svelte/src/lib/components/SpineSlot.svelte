<script lang="ts" module>
	import * as PIXI from 'pixi.js';

	export type Props = { slotName: string; children: Snippet };
</script>

<script lang="ts">
	import { onMount, type Snippet } from 'svelte';

	import {
		getContextSpine,
		createContextParent,
		getContextSpineEventEmitter,
	} from '../context.svelte';

	const props: Props = $props();
	const spine = getContextSpine();
	const slotContainer = new PIXI.Container();
	const spineEventEmitter = getContextSpineEventEmitter();

	let show = $state(!spineEventEmitter);

	onMount(() => {
		// The Spine runtime's `addSlotObject` THROWS when the skeleton has no slot with
		// this name (`getSlotFromRef`), which would crash the whole mount. A bundle chosen
		// for `slotName` that lacks it (mismatched spine ⇄ slot param) must degrade, not
		// take the game down — skip attaching and warn once instead.
		if (!spine.skeleton.findSlot(props.slotName)) {
			console.warn(
				`[SpineSlot] no slot "${props.slotName}" on this spine skeleton — slot content will not render`,
			);
			return;
		}

		if (spineEventEmitter) {
			spineEventEmitter.on('beforeUpdateWorldTransforms', () => {
				const slot = spine.skeleton.findSlot(props.slotName);

				if (slot) {
					show = Boolean(slot?.attachment);
				}
			});
		}

		spine.addSlotObject(props.slotName, slotContainer);
	});

	createContextParent(slotContainer);
</script>

{#if show}
	{@render props.children()}
{/if}
