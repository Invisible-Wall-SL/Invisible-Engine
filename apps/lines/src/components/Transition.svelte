<script lang="ts" module>
	export type EmitterEventTransition = { type: 'transition' };
</script>

<script lang="ts">
	import { waitForResolve } from 'utils-shared/wait';

	import TransitionAnimation from './TransitionAnimation.svelte';
	import { getContext } from '../game/context';
	import { TRANSITION_INSTANCE } from '../game/editorFlags';

	const context = getContext();

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
	<!-- Under `TRANSITION_INSTANCE` this coded part is the bound child of the
		`transition` componentInstance: render at LOCAL origin (0,0) so the instance node's
		transform places the wipe. OFF: pass `undefined` so it self-centres on the canvas —
		byte-identical to before the migration. -->
	<TransitionAnimation
		x={TRANSITION_INSTANCE ? 0 : undefined}
		y={TRANSITION_INSTANCE ? 0 : undefined}
		oncomplete={() => {
			oncomplete();
			transitioning = false;
		}}
	/>
{/if}
