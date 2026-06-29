<script lang="ts">
	import { SpineProvider, SpineTrack, type SpineTrackProps } from 'pixi-svelte';
	import { stateBetDerived } from 'state-shared';

	import { getSymbolInfo } from '../game/utils';
	import { SYMBOL_SIZE, SYMBOL_CONTENT_FILL } from '../game/constants';

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
	Symbol size comes from the ART, not a size param: the spine CONTAIN-fits its bounds to
	`SYMBOL_SIZE × SYMBOL_CONTENT_FILL` — the SAME fraction the sprite path fits its content to,
	so a spine character and a sprite icon end up the same on-screen size. The rig's bounds (its
	visible content, authored tight in the Rigger) decide the fit; keep them tight (don't pad)
	so the spine's content matches the sprites' content. No `sizeRatios` multiplier.
-->
<SpineProvider
	x={props.x}
	y={props.y}
	key={props.symbolInfo.assetKey}
	width={SYMBOL_SIZE * SYMBOL_CONTENT_FILL}
	height={SYMBOL_SIZE * SYMBOL_CONTENT_FILL}
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
