<script lang="ts" module>
	import type { TextProps } from 'pixi-svelte';

	/**
	 * A catalog-aware drop-in for pixi-svelte's `<Text>`. pixi-svelte's `<Text>` and
	 * `<BitmapText>` share the SAME prop surface (`OverwriteCursor<PIXI.TextOptions>`
	 * + `onresize`), so this component accepts it verbatim and forwards it to whichever
	 * it renders — a caller swaps `<Text>` → `<CatalogText>` with no other change.
	 */
	export type Props = TextProps;
</script>

<script lang="ts">
	import { BitmapText, Text } from 'pixi-svelte';

	import { findFont, fontFamilyForRef } from './fontCatalog';
	import { getFontCatalog } from './registerFontCatalog';

	/**
	 * §9.4 bitmap-vs-system-font decision, extracted from `LayoutNodeView` so EVERY coded
	 * text part shares it — not just layout text nodes. The HUD readout caption/value,
	 * the button label, and the numeric readout are "separate coded parts" (§14.3/§16.2)
	 * that rendered a plain `<Text>` regardless of the chosen font, so an editor-authored
	 * Font Maker BITMAP family was handed to pixi's canvas `<Text>` — which cannot resolve
	 * it as a system font and falls back to the default face. Routing them through here
	 * makes them render `<BitmapText>` (pixi's `BitmapFont` blitter) for a bitmap family,
	 * exactly like a layout text node, so an authored bitmap font reaches the HUD too.
	 *
	 * No registered catalog, or a family the catalog does not list as a bitmap font, ⇒
	 * `<Text>` exactly as before (parity — the common `proxima-nova`/web-font case is
	 * untouched). `fontFamily` may be a fallback list; the first family decides, matching
	 * pixi's own resolution.
	 */
	const props: Props = $props();

	// The doc stores a font REFERENCE (a Font Maker `id`, a built-in family, or a
	// system face). `fontFamily` may be a fallback list; the first entry decides,
	// matching pixi's own resolution.
	const ref = $derived.by(() => {
		const f = props.style?.fontFamily;
		return Array.isArray(f) ? f[0] : f;
	});
	const entry = $derived(findFont(getFontCatalog(), typeof ref === 'string' ? ref : undefined));
	const isBitmap = $derived(entry?.kind === 'bitmap');
	// Rewrite the reference to the actual registered family before handing it to pixi:
	// a bitmap font resolves to its unique `id` (the `${id}-bitmap` cache key), a web
	// font to its CSS `name`, and an unlisted family passes through unchanged. Without
	// this a same-face bitmap VARIANT would resolve to whichever variant loaded last.
	const resolvedStyle = $derived.by(() => {
		if (!entry || !props.style) return props.style;
		const family = fontFamilyForRef(getFontCatalog(), typeof ref === 'string' ? ref : undefined);
		return family === undefined ? props.style : { ...props.style, fontFamily: family };
	});
</script>

{#if isBitmap}
	<BitmapText {...props} style={resolvedStyle} />
{:else}
	<Text {...props} style={resolvedStyle} />
{/if}
