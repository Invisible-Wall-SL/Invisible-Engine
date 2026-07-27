<script lang="ts">
	import { onMount } from 'svelte';

	import { Text } from 'pixi-svelte';

	import { gameActor } from '../game/actor';
	import { clearWinPresentation } from '../game/winSymbolCycle';
	import { getContext } from '../game/context';

	type Props = {
		debug?: boolean;
	};

	const props: Props = $props();
	const context = getContext();

	onMount(() => {
		const { unsubscribe } = gameActor.subscribe((snapshot) => {
			context.stateXstate.value = snapshot.value;
			// const childActor = snapshot.children[snapshot.value];
		});

		gameActor.start();
		gameActor.send({ type: 'RENDERED' });

		return () => {
			// Equivalent to onDestroy(); Leave this comment for searching.
			unsubscribe();
			gameActor.stop();
		};
	});

	context.eventEmitter.subscribeOnMount({
		// Connect every actor with app.eventEmitter to avoid call actor directly
		bet: () => gameActor.send({ type: 'BET' }),
		autoBet: () => gameActor.send({ type: 'AUTO_BET' }),
		resumeBet: () => gameActor.send({ type: 'RESUME_BET' }),
		// A SLAM press (`stopButtonClick`, fired while a round is rolling/presenting) wipes the
		// previous win's line + stamped amount + info-bar message NOW, so any spin press clears the
		// board — not just a new bet at rest (which clears via `onNewGameStart`). The win LINE is
		// already slam-gated (`winLineEnabledForWin`) so no later payline redraws behind this; here we
		// clear the currently-drawn one instantly instead of one-win-later. A no-op when there is
		// nothing on screen (a slam during the reel roll, before any win).
		stopButtonClick: () => clearWinPresentation(),
	});
</script>

{#if props.debug}
	<Text
		x={context.stateLayoutDerived.canvasSizes().width}
		anchor={{ x: 1, y: 0 }}
		style={{ fill: 0xffffff }}
		text={JSON.stringify(context.stateXstate.value, undefined, 2)}
	/>
{/if}
