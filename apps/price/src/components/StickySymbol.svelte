<script lang="ts">
	import { RigProvider, RigTrack } from 'pixi-svelte';
	import { stateBetDerived } from 'state-shared';

	import SymbolPrize from './SymbolPrize.svelte';
	import { SYMBOL_SIZE } from '../game/constants';
	import type { StickySymbol } from '../game/stateGame.svelte';

	const STICKY_SYMBOL_ANIMATION_MAP = {
		hit: 'scatter_hit',
		open: 'scatter_open',
		idle: 'scatter_loop',
		win: 'scatter_trigger',
	} as const;

	type Props = {
		x?: number;
		y?: number;
		stickySymbol: StickySymbol;
	};

	const props: Props = $props();
</script>

<RigProvider x={props.x} y={props.y} key="symbols" height={SYMBOL_SIZE}>
	<RigTrack
		trackIndex={0}
		animationName={STICKY_SYMBOL_ANIMATION_MAP[props.stickySymbol.state]}
		timeScale={stateBetDerived.timeScale()}
		loop={props.stickySymbol.state === 'idle'}
		listener={{
			complete: () => {
				props.stickySymbol.oncomplete();
			},
		}}
	/>
</RigProvider>

{#if props.stickySymbol.isOpen}
	<SymbolPrize x={props.x} y={props.y} prize={props.stickySymbol.prize.prize} />
{/if}
