<script lang="ts">
	import { SpineProvider, SpineTrack, type SpineTrackProps } from 'pixi-svelte';
	import { stateBetDerived } from 'state-shared';

	import { getSymbolInfo } from '../game/utils';
	import { SYMBOL_SIZE, SYMBOL_SPINE_FILL } from '../game/constants';

	type Props = {
		symbolInfo: ReturnType<typeof getSymbolInfo>;
		x?: number;
		y?: number;
		listener: SpineTrackProps['listener'];
		loop?: boolean;
	};

	const props: Props = $props();
</script>

<!--
	Spine symbols read visually bigger than sprite icons (a character + badge fills its bounds),
	so we contain-fit the rig's bounds to `SYMBOL_SIZE × SYMBOL_SPINE_FILL` (< 1) to bring them
	down to match the sprites. Spine-only knob — sprites are full contain. Tune SYMBOL_SPINE_FILL.
-->
<SpineProvider
	x={props.x}
	y={props.y}
	key={props.symbolInfo.assetKey}
	width={SYMBOL_SIZE * SYMBOL_SPINE_FILL}
	height={SYMBOL_SIZE * SYMBOL_SPINE_FILL}
	fit="contain"
>
	<SpineTrack
		loop={props.loop}
		trackIndex={0}
		animationName={props.symbolInfo.animationName}
		timeScale={stateBetDerived.timeScale()}
		listener={props.listener}
	/>
</SpineProvider>
