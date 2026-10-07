<script lang="ts">
	import { RigProvider, RigTrack, type RigTrackProps } from 'pixi-svelte';

	import { SYMBOL_SIZE } from '../game/constants';
	import { getSymbolInfo } from '../game/utils';
	import SymbolRigMain from './SymbolRigMain.svelte';

	type Props = {
		symbolInfo: ReturnType<typeof getSymbolInfo>;
		x?: number;
		y?: number;
		listener: RigTrackProps['listener'];
		showWinFrame: boolean;
		loop?: boolean;
	};

	const props: Props = $props();
</script>

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
