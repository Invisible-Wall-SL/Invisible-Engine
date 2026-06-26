<script lang="ts">
	import { SpineProvider, SpineTrack, type SpineTrackProps } from 'pixi-svelte';
	import { stateBetDerived } from 'state-shared';

	import { getSymbolInfo } from '../game/utils';
	import { SYMBOL_SIZE } from '../game/constants';

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
	Symbol size comes from the ART, not a size param: the spine CONTAIN-fits the cell
	(`SYMBOL_SIZE` box, native aspect preserved), exactly like `SymbolSprite`. No `sizeRatios`
	multiplier — authored per-symbol/global sizes were removed from the result (owner
	direction). The rig's NATURAL size (its `skeleton` bounds, authored in the Rigger) decides
	how the art sits inside the cell, so you size a spine by its bounds, not a number.
-->
<SpineProvider
	x={props.x}
	y={props.y}
	key={props.symbolInfo.assetKey}
	width={SYMBOL_SIZE}
	height={SYMBOL_SIZE}
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
