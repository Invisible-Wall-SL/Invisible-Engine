<script lang="ts" module>
	import type { TextStyle } from './types';

	export interface Props {
		/** The message string, possibly carrying inline-image sentinels (see `inlineImage.ts`). */
		text: string;
		/** Fully-resolved text style (font/size/fill/stroke…) — the SAME style the plain path would
		 *  use, applied verbatim to each text run so image + text share one look. */
		style: Partial<TextStyle> | undefined;
		x: number;
		y: number;
		/** Only the centred case ({0.5,0.5}, the info-bar toast) is honoured today; the row is laid
		 *  out centred on (x, y) regardless, matching that one consumer. */
		anchor: { x: number; y: number } | undefined;
		scale: { x: number; y: number } | undefined;
		rotation: number | undefined;
		alpha: number | undefined;
		zIndex: number | undefined;
	}
</script>

<script lang="ts">
	import { Container, Sprite, getContextApp, type Sizes } from 'pixi-svelte';

	import CatalogText from './CatalogText.svelte';
	import { parseInlineImageSegments } from './inlineImage';
	import { resolveInlineImage } from './registerInlineImage';

	/**
	 * The message renderer for a string that carries an inline symbol image (`hasInlineImage`).
	 * Splits the string into text runs + image slots and lays them out on ONE horizontal line,
	 * centred on (x, y): each text run is a `<CatalogText>` (so the bitmap-vs-system-font decision
	 * is identical to the plain path), each image an aspect-preserving `<Sprite>` sized to the text
	 * height, so the symbol "fits with the rest of the text at the correct size".
	 *
	 * Widths: a text run's width is learned from its `onresize` (the SAME measure-feedback pattern
	 * `<TextBox>` uses for auto-fit) and converges within a frame or two; an image's width is the
	 * font-height × the loaded texture's aspect, read synchronously. An image whose token can't
	 * resolve (no resolver / non-sprite symbol / missing art) renders its `fallback` as a text run,
	 * so the message always reads sensibly.
	 */
	const props: Props = $props();
	const appContext = getContextApp();

	const fontSize = $derived(props.style?.fontSize ?? 24);
	// The inline sprite's height. Matched to the font size so it sits at text height; art usually
	// carries transparent padding, so a hair over 1× reads as "same size as the letters".
	const imageHeight = $derived(fontSize * 1.1);

	type Resolved =
		| { kind: 'text'; value: string }
		| { kind: 'image'; key: string; fallback: string };

	// Resolve each image token to a texture key up front. A token with no key becomes a TEXT
	// segment (its fallback) so the layout below has one uniform "render as text" path.
	const segments = $derived.by<Resolved[]>(() =>
		parseInlineImageSegments(props.text).map((seg) => {
			if (seg.kind === 'text') return seg;
			const key = resolveInlineImage(seg.token);
			return key
				? { kind: 'image', key, fallback: seg.fallback }
				: { kind: 'text', value: seg.fallback };
		}),
	);

	// Measured widths of the text runs, keyed by segment index. Reset whenever the text changes so a
	// new message re-measures instead of inheriting stale widths.
	let textWidths = $state<Record<number, number>>({});
	$effect(() => {
		void props.text;
		textWidths = {};
	});
	const setTextWidth = (index: number, width: number): void => {
		if (textWidths[index] !== width) textWidths = { ...textWidths, [index]: width };
	};

	// An image's on-screen width = target height × the texture's natural aspect. Until the texture
	// resolves (symbol art is preloaded, so this is only the very first frames) fall back to square.
	const imageWidthOf = (key: string): number => {
		const tex = appContext.stateApp.loadedAssets?.[key] as
			| { width?: number; height?: number }
			| undefined;
		const w = tex?.width ?? 0;
		const h = tex?.height ?? 0;
		return w > 0 && h > 0 ? imageHeight * (w / h) : imageHeight;
	};

	// A rough pre-measurement width so the first frame is close before `onresize` lands.
	const estimateTextWidth = (value: string): number => value.length * fontSize * 0.5;

	const widths = $derived(
		segments.map((seg, i) =>
			seg.kind === 'image'
				? imageWidthOf(seg.key)
				: (textWidths[i] ?? estimateTextWidth(seg.value)),
		),
	);
	const totalWidth = $derived(widths.reduce((sum, w) => sum + w, 0));
	// Left edge (x) of each segment, relative to the centred row.
	const lefts = $derived.by(() => {
		const out: number[] = [];
		let x = -totalWidth / 2;
		for (const w of widths) {
			out.push(x);
			x += w;
		}
		return out;
	});
</script>

<Container
	x={props.x}
	y={props.y}
	scale={props.scale}
	rotation={props.rotation}
	alpha={props.alpha}
	zIndex={props.zIndex}
>
	{#each segments as seg, i (i)}
		{#if seg.kind === 'image'}
			<Sprite
				key={seg.key}
				x={lefts[i] + widths[i] / 2}
				y={0}
				anchor={{ x: 0.5, y: 0.5 }}
				width={widths[i]}
				height={imageHeight}
			/>
		{:else}
			<CatalogText
				text={seg.value}
				x={lefts[i]}
				y={0}
				anchor={{ x: 0, y: 0.5 }}
				style={props.style}
				onresize={(size: Sizes) => setTextWidth(i, size.width)}
			/>
		{/if}
	{/each}
</Container>
