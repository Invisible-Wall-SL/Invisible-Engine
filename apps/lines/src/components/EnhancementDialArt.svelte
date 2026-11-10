<script lang="ts">
	import { Anchor, Container, Rectangle, Text } from 'pixi-svelte';
	import { SYMBOL_SIZE } from 'engine-game';
	import { enhancementDialAnchor } from 'engine-layout';

	import {
		enhancementName,
		stateEnhancements,
		type EnhancementDial,
		type EnhancementDialState,
	} from '../game/holdAndWinEnhancements.svelte';

	type Props = { kind: EnhancementDial; scale?: number };

	const props: Props = $props();

	/**
	 * THE CODED ENHANCEMENT DIAL at its own origin (Phase 14b): a round plate with the enhancement's
	 * name, dim while it is `off`, lit gold `on`, flashing with what it adds while `hit` ("+$5.00",
	 * "×3"), and crossed out with a red X on a `miss`. It registers the dial's anchor, so a hit's beam
	 * leaves from it. Drawn by the coded dials row (`EnhancementDials`) and by an authored dial's part
	 * with nothing inside (`EnhancementDialPart`).
	 */
	const SIZE = SYMBOL_SIZE * 0.62;
	const LOOK: Record<
		EnhancementDialState,
		{ fill: number; fillAlpha: number; border: number; text: number; alpha: number }
	> = {
		off: { fill: 0x1c1c1c, fillAlpha: 0.6, border: 0x555555, text: 0x8a8a8a, alpha: 0.55 },
		on: { fill: 0x6b3a00, fillAlpha: 0.9, border: 0xffd24a, text: 0xffe08a, alpha: 1 },
		hit: { fill: 0xffe08a, fillAlpha: 1, border: 0xffffff, text: 0x3a1f00, alpha: 1 },
		miss: { fill: 0x2a0b0b, fillAlpha: 0.9, border: 0xd23b3b, text: 0x9a6a6a, alpha: 1 },
	};
	const state = $derived(stateEnhancements.dials[props.kind]);
	const look = $derived(LOOK[state]);
	const caption = $derived(stateEnhancements.captions[props.kind]);
	const name = $derived(enhancementName(props.kind));
</script>

<Container scale={props.scale ?? 1} alpha={look.alpha}>
	<Anchor name={enhancementDialAnchor(props.kind)} />
	<Rectangle
		anchor={0.5}
		width={SIZE}
		height={SIZE}
		borderRadius={SIZE / 2}
		backgroundColor={look.fill}
		backgroundAlpha={look.fillAlpha}
		borderColor={look.border}
		borderWidth={state === 'off' ? 2 : 4}
	/>
	<Text
		anchor={0.5}
		text={state === 'hit' && caption ? caption : name}
		style={{
			fontFamily: 'Arial',
			fontWeight: 'bold',
			fontSize: SYMBOL_SIZE * (state === 'hit' && caption ? 0.15 : 0.1),
			fill: look.text,
			stroke: { color: 0x000000, width: state === 'hit' ? 0 : 3 },
		}}
	/>
	{#if state === 'miss'}
		<Text
			anchor={0.5}
			text="✕"
			style={{
				fontFamily: 'Arial',
				fontWeight: 'bold',
				fontSize: SIZE * 0.85,
				fill: 0xff4a4a,
				stroke: { color: 0x000000, width: 5 },
			}}
		/>
	{/if}
</Container>
