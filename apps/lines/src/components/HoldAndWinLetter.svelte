<script lang="ts">
	import { Tween } from 'svelte/motion';
	import { backOut } from 'svelte/easing';
	import { Container, Text } from 'pixi-svelte';
	import { SYMBOL_SIZE } from 'engine-game';

	import { stateLetters } from '../game/holdAndWinLetters.svelte';

	type Props = { reel: number; letter: string; x: number; y: number };

	const props: Props = $props();

	/**
	 * ONE CODED COLUMN LETTER over its reel: dim until its column completes, then lit gold, with a
	 * pulse each time it lights.
	 */
	const PULSE_SCALE = 1.6;
	const lit = $derived(stateLetters.lit.includes(props.reel));

	const pulse = new Tween(1);
	let seenPulses = stateLetters.pulses[props.reel] ?? 0;
	$effect(() => {
		const pulses = stateLetters.pulses[props.reel] ?? 0;
		if (pulses === seenPulses) return;
		seenPulses = pulses;
		pulse
			.set(PULSE_SCALE, { duration: 0 })
			.then(() => pulse.set(1, { duration: 600, easing: backOut }));
	});
</script>

<Container x={props.x} y={props.y} scale={pulse.current}>
	<Text
		anchor={0.5}
		text={props.letter}
		alpha={lit ? 1 : 0.45}
		style={{
			fontFamily: 'Arial',
			fontWeight: 'bold',
			fontSize: SYMBOL_SIZE * 0.36,
			fill: lit ? 0xffd24a : 0x6b6b6b,
			stroke: { color: lit ? 0x7a3d00 : 0x000000, width: 6 },
		}}
	/>
</Container>
