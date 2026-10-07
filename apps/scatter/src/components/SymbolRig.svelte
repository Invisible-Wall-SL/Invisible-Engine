<script lang="ts">
	import { RigProvider, RigTrack, type RigTrackProps } from 'pixi-svelte';

	import { SYMBOL_SIZE } from '../game/constants';
	import { getSymbolBackgroundInfo, getSymbolInfo } from '../game/utils';
	import SymbolRigMain from './SymbolRigMain.svelte';
	import SymbolRigBackground from './SymbolRigBackground.svelte';

	type Props = {
		symbolInfo: ReturnType<typeof getSymbolInfo>;
		symbolBackgroundInfo: ReturnType<typeof getSymbolBackgroundInfo>;
		x?: number;
		y?: number;
		listener: RigTrackProps['listener'];
		showWinFrame: boolean;
		loop?: boolean;
	};

	const props: Props = $props();
</script>

<SymbolRigBackground
	x={props.x}
	y={props.y}
	symbolBackgroundInfo={props.symbolBackgroundInfo}
	loop={props.loop}
/>

<!-- main -->
<SymbolRigMain
	x={props.x}
	y={props.y}
	symbolInfo={props.symbolInfo}
	listener={props.listener}
	loop={props.loop}
/>

<!-- tumble frame -->
{#if props.showWinFrame}
	<RigProvider x={props.x} y={props.y} key="anticipation" width={SYMBOL_SIZE * 0.19}>
		<RigTrack trackIndex={0} animationName="payframe" loop />
	</RigProvider>
{/if}
