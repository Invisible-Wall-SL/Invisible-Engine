<script lang="ts">
	import { Sprite, type SpriteProps } from 'pixi-svelte';

	import { getSymbolInfo } from '../game/utils';
	import { SYMBOL_SIZE, SYMBOL_CONTENT_FILL } from '../game/constants';
	import { onMount } from 'svelte';

	type Props = {
		x?: number;
		y?: number;
		symbolInfo: ReturnType<typeof getSymbolInfo>;
		oncomplete?: () => void;
	};

	const props: Props = $props();

	onMount(() => {
		props.oncomplete?.();
	});

	$effect(() => {
		props.symbolInfo;
		props.oncomplete?.();
	});
</script>

<!--
	Symbol size comes from the ART, not a size param: the sprite fits its VISIBLE CONTENT
	(opaque pixels, ignoring transparent margin) to `SYMBOL_SIZE × SYMBOL_CONTENT_FILL` and
	centres on the content. So a padded icon and a tight one render at the same on-screen size
	as every spine symbol — uniform, no `sizeRatios`. `containContent` degrades to plain
	contain if the art can't be measured.
-->
<Sprite
	x={props.x}
	y={props.y}
	anchor={0.5}
	key={props.symbolInfo.assetKey}
	width={SYMBOL_SIZE * SYMBOL_CONTENT_FILL}
	height={SYMBOL_SIZE * SYMBOL_CONTENT_FILL}
	containContent
/>
