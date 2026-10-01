<script lang="ts">
	import { untrack } from 'svelte';
	import { Tween } from 'svelte/motion';
	import { cubicIn, cubicOut } from 'svelte/easing';
	import { Container } from 'pixi-svelte';
	import { ResponsiveBitmapText } from 'components-pixi';
	import { SYMBOL_SIZE } from 'engine-game';
	import type { CoinLabelLook } from 'engine-layout';

	import type { CoinLabelPopCue } from '../game/coinLabel';

	type Props = {
		x?: number;
		y?: number;
		text: string;
		/** `coinLabelLookFor` — the coded look when nothing is authored. */
		look: CoinLabelLook;
		/** A pop to play; a cue with a new `id` plays it again. */
		pop?: CoinLabelPopCue;
	};

	const props: Props = $props();

	/**
	 * A Hold and Win coin's value, jackpot tier or factor (`Symbol.svelte`), drawn as the Symbols tool
	 * authored it (`doc.coinLabel`): font, size, tint, offset from the cell centre, scale, the width it
	 * shrinks to fit, and the pop it plays as its coin sticks or its count lands. With nothing authored
	 * the look is the coded one — `gold`, 0.3 × the symbol, centred, 0.9 wide — and nothing pops.
	 */
	const pop = new Tween(1);
	// The cue present at mount is already spent: a label that remounts (a mystery revealing) must not
	// replay the pop its previous instance played.
	let seen = untrack(() => props.pop?.id ?? 0);
	$effect(() => {
		const cue = props.pop;
		if (!cue || cue.id === seen) return;
		seen = cue.id;
		const half = cue.ms / 2;
		pop
			.set(cue.scale, { duration: half, easing: cubicOut })
			.then(() => pop.set(1, { duration: half, easing: cubicIn }));
	});
</script>

<Container
	x={(props.x ?? 0) + props.look.x * SYMBOL_SIZE}
	y={(props.y ?? 0) + props.look.y * SYMBOL_SIZE}
	scale={props.look.scale * pop.current}
>
	<ResponsiveBitmapText
		anchor={0.5}
		maxWidth={SYMBOL_SIZE * props.look.maxWidth}
		text={props.text}
		tint={props.look.tint}
		style={{
			fontFamily: props.look.font,
			fontSize: SYMBOL_SIZE * props.look.size,
			// pixi's BitmapText makes the fill white only in its constructor; a style re-assigned
			// without one (every re-render here) draws the glyphs black.
			fill: 0xffffff,
		}}
	/>
</Container>
