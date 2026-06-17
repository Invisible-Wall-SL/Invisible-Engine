<script lang="ts">
	import { SpineProvider, SpineTrack, type SpineTrackProps } from 'pixi-svelte';

	import { SYMBOL_SIZE } from '../game/constants';
	import { bakedHighlight } from '../editor-scenes';
	import { getSymbolInfo } from '../game/utils';
	import SymbolSpineMain from './SymbolSpineMain.svelte';

	type Props = {
		symbolInfo: ReturnType<typeof getSymbolInfo>;
		x?: number;
		y?: number;
		listener: SpineTrackProps['listener'];
		showWinFrame: boolean;
		loop?: boolean;
	};

	const props: Props = $props();

	// GLOBAL win-highlight frame from the baked Symbol-State-Machine doc; falls back to the
	// coded `anticipation`/`payframe` when no highlight is authored (un-baked = identical).
	const highlight = bakedHighlight();
	const frameKey = highlight?.assetKey ?? 'anticipation';
	const frameAnimation = highlight?.animationName ?? 'payframe';
</script>

<!-- main -->
<SymbolSpineMain
	x={props.x}
	y={props.y}
	symbolInfo={props.symbolInfo}
	listener={props.listener}
	loop={props.loop}
/>

<!-- tumble frame -->
{#if props.showWinFrame}
	<SpineProvider x={props.x} y={props.y} key={frameKey} width={SYMBOL_SIZE * 0.19}>
		<SpineTrack trackIndex={0} animationName={frameAnimation} loop />
	</SpineProvider>
{/if}
