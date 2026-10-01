<script lang="ts">
	import { Tween } from 'svelte/motion';
	import { backOut } from 'svelte/easing';
	import { Container, Text } from 'pixi-svelte';
	import { SYMBOL_SIZE } from 'engine-game';

	import { boardDimensions } from '../game/gameConfig';
	import { cellWindow, getSymbolX } from '../game/stateGame.svelte';
	import { stateHoldAndWin } from '../game/stateHoldAndWin.svelte';
	import { stateRespinBoard } from '../game/stateRespinBoard.svelte';

	/**
	 * THE CODED RESPIN COUNTER — "RESPINS 3" centred above the respin board, pulsing on every reset,
	 * and under it the modifiers active in this feature ("PAYER · MULTIPLIER", from the entry and any
	 * mystery unlock since). The default for a project that authored none: Phase 6 gives it a Scene
	 * Editor component, fed the same state through the `respinsLeft` / `activeModifiers` sources.
	 */
	const PULSE_SCALE = 1.35;
	const pulse = new Tween(1);

	let seenResets = stateRespinBoard.counter.resets;
	$effect(() => {
		const resets = stateRespinBoard.counter.resets;
		if (resets === seenResets) return;
		seenResets = resets;
		pulse
			.set(PULSE_SCALE, { duration: 0 })
			.then(() => pulse.set(1, { duration: 450, easing: backOut }));
	});

	const x = $derived((getSymbolX(0) + getSymbolX(boardDimensions().x - 1)) / 2);
	const y = $derived(cellWindow(0, 0).top - SYMBOL_SIZE * 0.3);
	const modifiers = $derived(
		stateHoldAndWin.activeModifiers.map((kind) => kind.toUpperCase()).join(' · '),
	);
</script>

{#if stateRespinBoard.counter.show}
	<Container {x} {y} scale={pulse.current}>
		<Text
			anchor={0.5}
			text={`RESPINS ${stateRespinBoard.counter.left}`}
			style={{
				fontFamily: 'Arial',
				fontWeight: 'bold',
				fontSize: SYMBOL_SIZE * 0.3,
				fill: 0xffffff,
				stroke: { color: 0x000000, width: 6 },
			}}
		/>
	</Container>
	{#if modifiers}
		<Text
			{x}
			y={y + SYMBOL_SIZE * 0.22}
			anchor={0.5}
			text={modifiers}
			style={{
				fontFamily: 'Arial',
				fontWeight: 'bold',
				fontSize: SYMBOL_SIZE * 0.1,
				fill: 0xffe08a,
				stroke: { color: 0x000000, width: 4 },
			}}
		/>
	{/if}
{/if}
