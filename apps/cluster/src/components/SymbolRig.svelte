<script lang="ts">
	import { type RigTrackProps } from 'pixi-svelte';

	import { getSymbolInfo } from '../game/utils';
	import SymbolRigMain from './SymbolRigMain.svelte';

	type Props = {
		symbolInfo: ReturnType<typeof getSymbolInfo>;
		x?: number;
		y?: number;
		listener: RigTrackProps['listener'];
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
