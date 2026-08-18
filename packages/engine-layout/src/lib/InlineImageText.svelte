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
		/** Box-LESS: only the centred case ({0.5,0.5}, the info-bar toast) is honoured, the row is
		 *  laid out centred on (x, y). BOXED (`boxWidth`): the anchor places the BOX, exactly as
		 *  `<TextBox>` does, and the row aligns inside it. */
		anchor: { x: number; y: number } | undefined;
		scale: { x: number; y: number } | undefined;
		rotation: number | undefined;
		alpha: number | undefined;
		zIndex: number | undefined;
		/** Text-BOX layout (the §text-box model), all optional — omitted ⇒ the box-less centred row
		 *  (byte-identical parity with the original renderer). Present ⇒ the row aligns inside the
		 *  box by `style.align`/`verticalAlign` and `autoFit` shrinks it (font AND symbol) to fit,
		 *  the same knobs `<TextBox>` honours for plain text. */
		boxWidth?: number | undefined;
		boxHeight?: number | undefined;
		padding?: number | undefined;
		autoFit?: boolean | undefined;
	}
</script>

<script lang="ts">
	import { Container, type Sizes } from 'pixi-svelte';

	import CatalogText from './CatalogText.svelte';
	import { parseInlineImageSegments } from './inlineImage';
	import { resolveInlineImage, INLINE_IMAGE_BOUND_COMPONENT } from './registerInlineImage';
	import { getBoundComponent } from './registerBoundComponents';
	import { textBoxContentHeight, textBoxContentWidth, textBoxPlacement } from './textBoxLayout';

	/**
	 * The message renderer for a string that carries an inline symbol image (`hasInlineImage`).
	 * Splits the string into text runs + image slots and lays them out on ONE horizontal line:
	 * centred on (x, y) with no box, or aligned inside the box when one is given. Each text run is
	 * a `<CatalogText>` (so the bitmap-vs-system-font decision is identical to the plain path),
	 * each image the game's registered symbol renderer (`INLINE_IMAGE_BOUND_COMPONENT`) at text
	 * height, so the symbol "fits with the rest of the text at the correct size".
	 *
	 * The image is drawn by a GAME component, not a `<Sprite>` here, because the high-paying symbols
	 * are SPINE animations — a `<Sprite key>` can only draw a flat texture, so it rendered the name
	 * instead. Delegating to the game's `<Symbol>` path (registered under `messageSymbol`) handles
	 * sprite, spine AND flipbook symbols. A token the resolver doesn't know — or when no game
	 * component is registered — renders its sentinel `fallback` (the symbol name) as a text run, so
	 * the message always reads sensibly.
	 *
	 * **The BOX case is not optional polish.** The Info Bar's message is engine-fed and LOCALIZED, so
	 * its instance routinely carries a box width + auto-fit to keep a longer translation inside the
	 * plaque art (`INFO_BAR_DEF`). Before this renderer honoured a box, `<LayoutNodeView>` had to send
	 * a boxed node down the `<TextBox>` path, which `stripInlineImage`s — so ticking "show symbol as
	 * image" did nothing on precisely the bars that needed the box, with no error to explain it. The
	 * box math is `textBoxLayout.ts`, shared verbatim with `<TextBox>`, so a boxed message with an
	 * image and one without sit in the same place.
	 *
	 * The row is ALWAYS one line: a mixed text+sprite run can't be word-wrapped by pixi (it measures
	 * per `<Text>`, and an image is not a glyph), so a boxed row that is too wide SHRINKS via
	 * `autoFit` rather than wrapping — and the run style forces `wordWrap: false` so an authored wrap
	 * can't make each run wrap at pixi's 100px default.
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

	const baseFontSize = $derived(props.style?.fontSize ?? 24);
	const hasBox = $derived(typeof props.boxWidth === 'number' && props.boxWidth > 0);
	// The room the row has INSIDE the box once padding is off both edges — the auto-fit target and
	// what alignment measures against. Shared helpers, so this agrees with `<TextBox>` exactly.
	const contentWidth = $derived(
		hasBox ? textBoxContentWidth(props.boxWidth as number, props.padding) : undefined,
	);
	const contentHeight = $derived(
		hasBox && props.boxHeight !== undefined
			? textBoxContentHeight(props.boxHeight, props.padding)
			: undefined,
	);

	const MIN_FONT = 6;
	// The size the row actually renders at. Auto-fit shrinks it from `baseFontSize` through the
	// measure feedback below; it is NEVER grown past the base, and without a box it never moves
	// (so the box-less path renders exactly as it always did).
	let fitFontSize = $state(baseFontSize);
	// Reset the fit search on any fit-affecting input. Reads ONLY the inputs (never `fitFontSize`),
	// so it can't fight the shrink loop.
	$effect(() => {
		void props.text;
		void props.boxWidth;
		void props.boxHeight;
		void props.padding;
		void props.autoFit;
		void baseFontSize;
		void props.style?.fontFamily;
		void props.style?.letterSpacing;
		fitFontSize = baseFontSize;
	});
	const fontSize = $derived(hasBox ? fitFontSize : baseFontSize);

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

	// Measured size of each text run, TAGGED with the font size it was measured at: a shrink makes
	// every stored width stale, and acting on stale (larger) widths would over-shrink the row.
	type Measured = { font: number; width: number; height: number };
	let textSizes = $state<Record<number, Measured>>({});
	// Reset whenever the text changes so a new message re-measures instead of inheriting stale sizes.
	$effect(() => {
		void props.text;
		textSizes = {};
	});

	// A rough pre-measurement width so the first frame is close before `onresize` lands.
	const estimateTextWidth = (value: string): number => value.length * fontSize * 0.5;
	// A run measured at another font size scales linearly as an interim estimate — one frame's
	// approximation while the real measurement at the new size arrives.
	const runWidth = (index: number, value: string): number => {
		const m = textSizes[index];
		if (!m) return estimateTextWidth(value);
		return m.font === fontSize ? m.width : m.width * (m.font > 0 ? fontSize / m.font : 1);
	};
	const runHeight = (index: number): number => {
		const m = textSizes[index];
		if (!m) return fontSize;
		return m.font === fontSize ? m.height : m.height * (m.font > 0 ? fontSize / m.font : 1);
	};

	// The row's height: the tallest TEXT run at the current font (before any run has reported, the
	// font size stands in). The symbol is drawn AT this height, so it never adds to it — which is
	// why this, and not a max over the images too, is the row height.
	const textHeight = $derived(
		segments.reduce((tallest, seg, i) => {
			if (seg.kind !== 'text') return tallest;
			const h = runHeight(i);
			return h > tallest ? h : tallest;
		}, 0) || fontSize,
	);

	// The inline symbol's height — the line of text's OWN measured height, so the picture stands
	// exactly as tall as the words beside it. Measured rather than a multiple of `fontSize`: a
	// bitmap font's line box is routinely well under 1em, so an em-sized symbol towered over the
	// letters it was supposed to sit among.
	//
	// Because it FOLLOWS the text it must never feed back into the fit (see `fitRow`). While it
	// did, a boxed message shrank its own font until the symbol fitted the plaque — so the same
	// sentence rendered visibly smaller with a symbol than without one, with nothing in the layout
	// to explain it. The box still bounds the picture, so it can't spill out of the frame.
	const imageHeight = $derived(Math.min(textHeight, contentHeight ?? Infinity));
	// Side breathing room around a symbol. The template's space around the token is trimmed off the
	// adjacent text runs' measured width (pixi drops boundary whitespace), so without this the symbol
	// butts straight against the neighbouring word ("2🐄"). ~a space's width on each side.
	const imageMargin = $derived(fontSize * 0.22);
	const imageSlot = $derived(imageHeight + imageMargin * 2);

	const widths = $derived(
		segments.map((seg, i) => (seg.kind === 'image' ? imageSlot : runWidth(i, seg.value))),
	);
	const totalWidth = $derived(widths.reduce((sum, w) => sum + w, 0));
	// True once every text run has reported a size AT the current font — the only point at which
	// `totalWidth` is real enough to shrink from.
	const allRunsMeasured = $derived(
		segments.every((seg, i) => seg.kind !== 'text' || textSizes[i]?.font === fontSize),
	);

	function setRunSize(index: number, size: Sizes, font: number): void {
		const prev = textSizes[index];
		if (prev && prev.font === font && prev.width === size.width && prev.height === size.height)
			return;
		textSizes = { ...textSizes, [index]: { font, width: size.width, height: size.height } };
	}

	/**
	 * Shrink the row toward the box, one measured step at a time (the `<TextBox>` convergence loop,
	 * over the whole row instead of one text object). Runs only once every text run has reported at
	 * the CURRENT font, so a half-measured row can't drive the size down. Each shrink invalidates
	 * those measurements ⇒ the next call waits for the re-measure ⇒ it always terminates.
	 */
	function fitRow(): void {
		if (!hasBox || !props.autoFit) return;
		if (!allRunsMeasured || fitFontSize <= MIN_FONT) return;
		const fitWidth = contentWidth ?? Infinity;
		const fitHeight = contentHeight ?? Infinity;
		if (totalWidth <= fitWidth + 0.5 && textHeight <= fitHeight + 0.5) return;
		const wRatio = totalWidth > 0 ? fitWidth / totalWidth : 1;
		const hRatio = textHeight > 0 ? fitHeight / textHeight : 1;
		const ratio = Math.min(1, wRatio, hRatio);
		const next = Math.max(MIN_FONT, Math.floor(fitFontSize * (ratio >= 0.999 ? 0.9 : ratio)));
		if (next < fitFontSize) fitFontSize = next; // re-renders → onresize fires again → converges
	}

	// Where the row starts. BOXED: `textBoxPlacement` (shared with `<TextBox>`) puts an anchor-{0,0}
	// block at its aligned spot inside the box — the runs are anchored mid-line, so the row's centre
	// line sits half a text-height below that. BOX-LESS: centred on (x, y), unchanged.
	const placement = $derived(
		hasBox
			? textBoxPlacement({
					boxWidth: props.boxWidth as number,
					boxHeight: props.boxHeight,
					padding: props.padding,
					anchorX: props.anchor?.x ?? 0,
					anchorY: props.anchor?.y ?? 0,
					align: props.style?.align,
					verticalAlign: props.style?.verticalAlign,
					measuredWidth: totalWidth,
					measuredHeight: textHeight,
				})
			: undefined,
	);
	const originX = $derived(placement ? placement.offsetX : -totalWidth / 2);
	const originY = $derived(placement ? placement.offsetY + textHeight / 2 : 0);

	// Left edge (x) of each segment along the row.
	const lefts = $derived.by(() => {
		const out: number[] = [];
		let x = originX;
		for (const w of widths) {
			out.push(x);
			x += w;
		}
		return out;
	});

	// The style each text run renders at: the author's, at the fitted size. Untouched when nothing
	// fitted and there is no box (parity — an unset `fontSize` stays unset). Inside a box `wordWrap`
	// is forced OFF: the row is one line by construction, and an authored wrap would otherwise make
	// every run wrap at pixi's 100px default.
	const runStyle = $derived(
		!hasBox && fontSize === baseFontSize
			? props.style
			: { ...(props.style ?? {}), fontSize, ...(hasBox ? { wordWrap: false } : {}) },
	);
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
				<MessageSymbol
					symbol={seg.id}
					size={imageHeight}
					x={lefts[i] + widths[i] / 2}
					y={originY}
				/>
			{/if}
		{:else}
			{@const measuredAt = fontSize}
			<CatalogText
				text={seg.value}
				x={lefts[i]}
				y={originY}
				anchor={{ x: 0, y: 0.5 }}
				style={runStyle}
				onresize={(size: Sizes) => {
					setRunSize(i, size, measuredAt);
					fitRow();
				}}
			/>
		{/if}
	{/each}
</Container>
