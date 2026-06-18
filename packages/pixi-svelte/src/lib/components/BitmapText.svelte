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
	import {
		ensureBitmapFontSpaceGlyph,
		resolveBitmapFont,
		sanitizeBitmapText,
	} from '../sanitizeBitmapText';

	const props: Props = $props();
	const parentContext = getContextParent();

	// Engine guard against a pixi black-screen: a BitmapText asked to render a glyph its
	// font lacks crashes the whole render loop. See ../sanitizeBitmapText.ts. Two layers,
	// applied to the resolved font synchronously here so the FIRST frame (drawn from the
	// constructor below) is already safe:
	//   1. ensureBitmapFontSpaceGlyph — guarantee a space glyph, which is also pixi's
	//      fallback for any missing glyph, so the layout pass can never dereference
	//      undefined (the crash). Idempotent.
	//   2. sanitizeBitmapText — drop any remaining unbaked glyph so it degrades to "not
	//      drawn" rather than a blank-space fallback.
	// No-op until the font resolves / for dynamic/system fonts ⇒ text passes through.
	const safeText = $derived.by(() => {
		const font = resolveBitmapFont(props.style?.fontFamily);
		ensureBitmapFontSpaceGlyph(font);
		return sanitizeBitmapText(props.text, font);
	});

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
