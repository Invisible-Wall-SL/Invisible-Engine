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
	import { Container, type Sizes } from 'pixi-svelte';

	import CatalogText from './CatalogText.svelte';
	import { parseInlineImageSegments } from './inlineImage';
	import { resolveInlineImage, INLINE_IMAGE_BOUND_COMPONENT } from './registerInlineImage';
	import { getBoundComponent } from './registerBoundComponents';

	/**
	 * The message renderer for a string that carries an inline symbol image (`hasInlineImage`).
	 * Splits the string into text runs + image slots and lays them out on ONE horizontal line,
	 * centred on (x, y): each text run is a `<CatalogText>` (so the bitmap-vs-system-font decision
	 * is identical to the plain path), each image the game's registered symbol renderer
	 * (`INLINE_IMAGE_BOUND_COMPONENT`) at text height, so the symbol "fits with the rest of the text
	 * at the correct size".
	 *
	 * The image is drawn by a GAME component, not a `<Sprite>` here, because the high-paying symbols
	 * are SPINE animations — a `<Sprite key>` can only draw a flat texture, so it rendered the name
	 * instead. Delegating to the game's `<Symbol>` path (registered under `messageSymbol`) handles
	 * sprite, spine AND flipbook symbols. A token the resolver doesn't know — or when no game
	 * component is registered — renders its sentinel `fallback` (the symbol name) as a text run, so
	 * the message always reads sensibly.
	 *
	 * Widths: a text run's is learned from its `onresize` (the SAME measure-feedback pattern
	 * `<TextBox>` uses) and converges within a frame or two; an image occupies a fixed square slot
	 * (text height) plus a little side margin, since the boundary space around a token is trimmed by
	 * the text runs on either side and would otherwise butt the symbol against the words.
	 */
	const props: Props = $props();

	// The game's inline symbol renderer (sprite/spine/flipbook). Registered at boot; absent ⇒ every
	// image token falls back to its name text below (so a game that didn't wire it still reads).
	const MessageSymbol = getBoundComponent(INLINE_IMAGE_BOUND_COMPONENT);

	const fontSize = $derived(props.style?.fontSize ?? 24);
	// The inline symbol's height — matched to the font size so it sits at text height.
	const imageHeight = $derived(fontSize * 1.1);
	// Side breathing room around a symbol. The template's space around the token is trimmed off the
	// adjacent text runs' measured width (pixi drops boundary whitespace), so without this the symbol
	// butts straight against the neighbouring word ("2🐄"). ~a space's width on each side.
	const imageMargin = $derived(fontSize * 0.22);
	const imageSlot = $derived(imageHeight + imageMargin * 2);

	type Resolved = { kind: 'text'; value: string } | { kind: 'image'; id: string };

	// Resolve each image token to a render id up front. A token the resolver rejects (or any token
	// when no game renderer is registered) becomes a TEXT segment (its fallback name), so the layout
	// below has one uniform "render as text" path.
	const segments = $derived.by<Resolved[]>(() =>
		parseInlineImageSegments(props.text).map((seg) => {
			if (seg.kind === 'text') return seg;
			const id = MessageSymbol ? resolveInlineImage(seg.token) : undefined;
			return id ? { kind: 'image', id } : { kind: 'text', value: seg.fallback };
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

	// A rough pre-measurement width so the first frame is close before `onresize` lands.
	const estimateTextWidth = (value: string): number => value.length * fontSize * 0.5;

	const widths = $derived(
		segments.map((seg, i) =>
			seg.kind === 'image' ? imageSlot : (textWidths[i] ?? estimateTextWidth(seg.value)),
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
			{#if MessageSymbol}
				<MessageSymbol symbol={seg.id} size={imageHeight} x={lefts[i] + widths[i] / 2} y={0} />
			{/if}
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
