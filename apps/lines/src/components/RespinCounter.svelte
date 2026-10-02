<script lang="ts">
	import { onMount } from 'svelte';
	import { Tween } from 'svelte/motion';
	import { backOut } from 'svelte/easing';
	import { Container, getContextParent, Text } from 'pixi-svelte';
	import { SYMBOL_SIZE } from 'engine-game';
	import { isComponentMounted } from 'engine-layout/svelte';

	import { boardDimensions } from '../game/gameConfig';
	import { getContext } from '../game/context';
	import { cellWindow, getSymbolX, stateGameDerived } from '../game/stateGame.svelte';
	import { respinCounterText } from '../game/holdAndWinText';
	import { activeModifiersText } from '../game/stateHoldAndWin.svelte';
	import { stateRespinBoard } from '../game/stateRespinBoard.svelte';

	/**
	 * THE CODED RESPIN COUNTER — "RESPINS 3" centred above the respin board, pulsing on every reset,
	 * and under it the modifiers active in this feature ("PAYER · MULTIPLIER", from the entry and any
	 * mystery unlock since; a collector the wheel raised reads "DOUBLE COLLECTOR"). The default for a
	 * project that authored none: it steps aside while an authored `respinCounter` component (fed the
	 * same state through `respinsLeft`) is mounted.
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
	const aboveBoard = $derived(cellWindow(0, 0).top - SYMBOL_SIZE * 0.3);

	/**
	 * Above the board — unless the layout puts the board's top at the canvas edge (a portrait layout,
	 * `hw-3pots-sample`), where that is off screen: then the counter is pulled down until its line is
	 * on screen, over the top row. Measured through the board's own transform, once it is attached
	 * (pixi-svelte adds a parent after its children mount) and again on every resize.
	 */
	const MARGIN_PX = 6;
	const board = getContextParent().parent;
	const context = getContext();
	let attached = $state(false);
	onMount(() => {
		const timer = setTimeout(() => (attached = true));
		return () => clearTimeout(timer);
	});
	const y = $derived.by(() => {
		context.stateLayoutDerived.canvasSizes();
		stateGameDerived.boardLayout();
		if (!attached || !board.parent) return aboveBoard;
		const at = board.toGlobal({ x, y: aboveBoard });
		const pxPerUnit = (board.toGlobal({ x, y: aboveBoard + 100 }).y - at.y) / 100;
		if (pxPerUnit <= 0) return aboveBoard;
		const lowest = MARGIN_PX + SYMBOL_SIZE * 0.15 * pxPerUnit;
		return at.y >= lowest ? aboveBoard : aboveBoard + (lowest - at.y) / pxPerUnit;
	});
	const modifiers = $derived(activeModifiersText());
</script>

{#if stateRespinBoard.counter.show && !isComponentMounted('respinCounter')}
	<Container {x} {y} scale={pulse.current}>
		<Text
			anchor={0.5}
			text={respinCounterText(stateRespinBoard.counter.left, stateRespinBoard.counter.note)}
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
