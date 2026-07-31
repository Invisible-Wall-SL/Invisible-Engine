<script lang="ts" module>
	import type { Sizes } from 'pixi-svelte';

	import type { TextStyle } from './types';

	export interface Props {
		text: string;
		/** Fully-resolved style (font/fill/align/verticalAlign…) — LayoutNodeView already
		 * merged param bindings + node style before handing it here. */
		style: Partial<TextStyle> | undefined;
		/** Box dims (local, pre-scale). `boxWidth` is required (the caller only mounts this
		 * when a box exists); `boxHeight` is optional (drives vertical align + auto-fit). */
		boxWidth: number;
		boxHeight: number | undefined;
		autoFit: boolean;
		x: number;
		y: number;
		anchor: { x: number; y: number } | undefined;
		scale: { x: number; y: number } | undefined;
		rotation: number | undefined;
		alpha: number | undefined;
		zIndex: number | undefined;
	}
</script>

<script lang="ts">
	import { Container } from 'pixi-svelte';

	import CatalogText from './CatalogText.svelte';
	import { textBoxPlacement, textBoxStyleOverrides } from './textBoxLayout';

	const {
		text,
		style,
		boxWidth,
		boxHeight,
		autoFit,
		x,
		y,
		anchor,
		scale,
		rotation,
		alpha,
		zIndex,
	}: Props = $props();

	const baseFontSize = $derived(style?.fontSize ?? 24);

	// The font size we actually render at. Auto-fit shrinks it from `baseFontSize` via the
	// measure feedback below (`onresize`); it is NEVER grown past the base. Reset to the base
	// whenever an input that changes the fit does — so a shorter string / larger box / bigger
	// base font can grow back instead of staying stuck at a previously-shrunk size.
	let fitFontSize = $state(baseFontSize);
	// Rendered block height (local px) of the wrapped text at `fitFontSize`, reported by the
	// pixi object via `onresize`. Seeds the vertical-alignment padding. Defaults to the base
	// font so the first frame (before a measurement lands) is already close.
	let measuredHeight = $state(baseFontSize);
	// Rendered block WIDTH — drives the horizontal-alignment offset (right/centre reach the box
	// edges). Defaults to the box width so the first frame is close before a measurement lands.
	let measuredWidth = $state(boxWidth);

	// Reset the auto-fit search on any fit-affecting input change. Reads ONLY the inputs (not
	// `fitFontSize`), so it never fights the shrink loop below.
	$effect(() => {
		void text;
		void boxWidth;
		void boxHeight;
		void autoFit;
		void baseFontSize;
		void style?.fontFamily;
		void style?.letterSpacing;
		void style?.lineHeight;
		fitFontSize = baseFontSize;
	});

	const MIN_FONT = 6;
	function onresize(size: Sizes): void {
		measuredHeight = size.height;
		measuredWidth = size.width;
		if (!autoFit || boxHeight === undefined) return;
		const overflow = size.height > boxHeight + 0.5 || size.width > boxWidth + 0.5;
		if (!overflow || fitFontSize <= MIN_FONT) return;
		const wRatio = size.width > 0 ? boxWidth / size.width : 1;
		const hRatio = size.height > 0 ? boxHeight / size.height : 1;
		const ratio = Math.min(1, wRatio, hRatio);
		const next = Math.max(MIN_FONT, Math.floor(fitFontSize * (ratio >= 0.999 ? 0.9 : ratio)));
		if (next < fitFontSize) fitFontSize = next; // re-renders → onresize fires again → converges
	}

	// Wrap the lines to the box width + align them within it, at the fitted font size. Merged
	// OVER the resolved style so the author's font/fill/stroke/verticalAlign pass through.
	const boxStyle = $derived({
		...(style ?? {}),
		...textBoxStyleOverrides(boxWidth),
		fontSize: fitFontSize,
	});
	const placement = $derived(
		textBoxPlacement({
			boxWidth,
			boxHeight,
			anchorX: anchor?.x ?? 0,
			anchorY: anchor?.y ?? 0,
			align: style?.align,
			verticalAlign: style?.verticalAlign,
			measuredWidth,
			measuredHeight,
		}),
	);
</script>

<Container x={x} y={y} {scale} {rotation} {alpha} {zIndex}>
	<CatalogText
		{text}
		x={placement.offsetX}
		y={placement.offsetY}
		anchor={{ x: 0, y: 0 }}
		style={boxStyle}
		{onresize}
	/>
</Container>
