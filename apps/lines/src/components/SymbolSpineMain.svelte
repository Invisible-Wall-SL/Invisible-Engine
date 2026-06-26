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

	// CONTAIN sizing (the reel's "Symbol size (× cell)" global → `symbolFit === 'contain'`):
	// fit the spine INSIDE the SYMBOL_SIZE × ratio box preserving its aspect, exactly like the
	// sprite path (`SymbolSprite` `contain`). Without it a wide/tall rig (e.g. a character
	// spine) only had its HEIGHT pinned, so it overflowed the cell. The per-symbol 'stretch'
	// path is unchanged — height-only, byte-identical parity — so only a reel-control game
	// (or any future contain provenance) gets the new fit.
	const fitContain = $derived(props.symbolInfo.symbolFit === 'contain');
</script>

<SpineProvider
	x={props.x}
	y={props.y}
	key={props.symbolInfo.assetKey}
	width={fitContain ? SYMBOL_SIZE * props.symbolInfo.sizeRatios.width : undefined}
	height={SYMBOL_SIZE * props.symbolInfo.sizeRatios.height}
	fit={fitContain ? 'contain' : undefined}
>
	<SpineTrack
		loop={props.loop}
		trackIndex={0}
		animationName={props.symbolInfo.animationName}
		timeScale={stateBetDerived.timeScale()}
		listener={props.listener}
	/>
</SpineProvider>
