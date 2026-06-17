<script lang="ts" module>
	import * as PIXI from 'pixi.js';

	import type { Sizes, OverwriteCursor } from '../types';

	export type Props = OverwriteCursor<PIXI.TextOptions> & {
		onresize?: (arg0: Sizes) => void;
	};
</script>

<script lang="ts">
	import { onMount } from 'svelte';

	import { propsSyncEffect } from '../utils.svelte';
	import { getContextParent } from '../context.svelte';
	import { resolveBitmapFont, sanitizeBitmapText } from '../sanitizeBitmapText';

	const props: Props = $props();
	const parentContext = getContextParent();

	// Engine guard: drop any glyph the resolved bitmap font lacks BEFORE it reaches pixi,
	// so a missing glyph degrades to "not drawn" instead of crashing the render loop
	// (black screen). See ../sanitizeBitmapText.ts. No-op when the font isn't resolved yet
	// or it's a dynamic/system font ⇒ text passes through unchanged.
	const safeText = $derived(
		sanitizeBitmapText(props.text, resolveBitmapFont(props.style?.fontFamily)),
	);

	const bitmapText = new PIXI.BitmapText({ text: safeText, style: props.style });

	// `text` is driven from `safeText` here; everything else syncs verbatim.
	propsSyncEffect({ props, target: bitmapText, ignore: ['onresize', 'text'] });

	$effect(() => {
		if (safeText !== undefined) bitmapText.text = safeText;
	});

	$effect(() => {
		props?.text;
		props?.style;
		props.onresize?.({ width: bitmapText.width, height: bitmapText.height });
	});

	onMount(() => {
		props.onresize?.({ width: bitmapText.width, height: bitmapText.height });
	});

	parentContext.addToParent(bitmapText);
</script>
