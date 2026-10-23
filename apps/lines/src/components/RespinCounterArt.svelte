<script lang="ts">
	import { Anchor, Container, Text } from 'pixi-svelte';
	import { SYMBOL_SIZE } from 'engine-game';
	import { RESPIN_COUNTER_ANCHOR } from 'engine-layout';

	import { respinCounterLine } from '../game/respinCounterLine';
	import { activeModifiersText } from '../game/stateHoldAndWin.svelte';

	type Props = { scale: number };

	const props: Props = $props();

	/**
	 * THE CODED COUNTER'S LOOK at its own origin: "RESPINS 3" (scaled by the pulse, under the
	 * `respinCounter` anchor its "+N" flies into) and, under it, the modifiers active in this feature.
	 * Drawn by the coded default (`RespinCounter`) and by an authored counter's part with nothing
	 * inside it (`RespinCounterPart`). Both lines are the `respinCounterText` and `activeModifiers`
	 * sources an authored counter binds instead.
	 */
	const modifiers = $derived(activeModifiersText());
</script>

<Container scale={props.scale}>
	<Anchor name={RESPIN_COUNTER_ANCHOR} />
	<Text
		anchor={0.5}
		text={respinCounterLine()}
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
		y={SYMBOL_SIZE * 0.22}
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
