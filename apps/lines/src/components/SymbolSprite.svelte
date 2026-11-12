<script lang="ts">
	import { Sprite, type SpriteProps } from 'pixi-svelte';

	import { getContext } from '../game/context';
	import { getSymbolInfo } from '../game/utils';
	import { onMount } from 'svelte';

	type Props = {
		x?: number;
		y?: number;
		symbolInfo: ReturnType<typeof getSymbolInfo>;
		oncomplete?: () => void;
		/** A kept sprite handed its next entry by a view (`Symbol`'s `instanceKey`): it reports as a
		 *  new sprite would on mount. */
		restart?: number;
		/** A view's kept sprite is hidden while the view draws other art or nothing (`artDraw`). */
		visible?: boolean;
	};

	const props: Props = $props();
	const context = getContext();

	// Contain-fit box = the reel's LIVE cell (the mask window's per-cell size in
	// board-local space), the SAME source of truth the reel mask uses — so art can
	// never overflow the mask when a non-square / small cell is authored. No override
	// (and a uniform-scaled board) collapses to SYMBOL_SIZE × SYMBOL_SIZE ⇒ byte-parity.
	const geometry = $derived(context.stateGameDerived.boardGeometry());

	onMount(() => {
		props.oncomplete?.();
	});

	$effect(() => {
		props.symbolInfo;
		void props.restart;
		props.oncomplete?.();
	});
</script>

<!--
	Sprite symbols contain-fit the cell by their art (native aspect preserved). No size param.
	(rig symbols are shrunk separately via SYMBOL_RIG_FILL — they read visually bigger.)
-->
<Sprite
	x={props.x}
	y={props.y}
	anchor={0.5}
	key={props.symbolInfo.assetKey}
	width={geometry.cellWidthLocal}
	height={geometry.cellHeightLocal}
	visible={props.visible}
	contain
/>
