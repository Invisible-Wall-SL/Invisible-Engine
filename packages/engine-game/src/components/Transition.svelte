<script lang="ts" module>
	export type EmitterEventTransition = { type: 'transition' };
</script>

<script lang="ts">
	import { waitForResolve } from 'utils-shared/wait';

	import TransitionAnimation from './TransitionAnimation.svelte';
	import { getGameContext } from '../game/context';

	// `boundToInstance` = mounted as the bound child of the `transition` componentInstance
	// (§17): render the wipe at LOCAL origin so the instance node's transform places it.
	// Absent (a direct `bind:Transition` scene anchor) ⇒ self-centre on the canvas,
	// byte-identical to before the migration. Encoded on the def, so no per-game flag.
	const { boundToInstance = false }: { boundToInstance?: boolean } = $props();

	const context = getGameContext();

	let transitioning = $state(false);
	let oncomplete = $state(() => {});

	context.eventEmitter.subscribeOnMount({
		transition: async () => {
			transitioning = true;
			await waitForResolve((resolve) => (oncomplete = resolve));
		},
	});
</script>

{#if transitioning}
	<TransitionAnimation
		x={boundToInstance ? 0 : undefined}
		y={boundToInstance ? 0 : undefined}
		oncomplete={() => {
			oncomplete();
			transitioning = false;
		}}
	/>
{/if}
