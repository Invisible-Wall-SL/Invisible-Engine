import type { ResolvedTransform, TextStyle } from './types';

/**
 * Text-box layout — the ONE implementation of "how a {@link TextNode} with an explicit
 * `width`/`height` lays its glyphs out inside that box", shared by the runtime
 * (`<TextBox>` mounted by `<LayoutNodeView>`) and the editor overlay (`EditorTextLayer`)
 * so the two surfaces cannot disagree. All helpers are pure; each surface supplies its
 * own pixi `measure` callback (canvas `<Text>` vs `<BitmapText>` measure differently).
 *
 * The model (see `TextNode.width`):
 * - A box makes the pixi text object exactly `width` wide (via `wordWrap` + `wordWrapWidth`),
 *   so `style.align` (left/center/right) positions each line WITHIN the box — a single-line
 *   right-align finally has an edge to align to. Without a box, PIXI aligns lines only
 *   relative to the widest line, so alignment is invisible for one line (the old bug).
 * - The object is placed anchor-{0,0} at the box top-left; `style.verticalAlign` then
 *   offsets the whole block inside `height` (top/middle/bottom).
 * - Resizing the box changes `width`/`height` — never `scale` — so glyphs never stretch.
 *   `autoFit` shrinks the font until the wrapped block fits `height`.
 */

/** A text node has an explicit box once `width` is a positive number. `height` is optional
 * (vertical alignment + auto-fit need it, horizontal alignment does not). */
export function hasTextBox(t: Pick<ResolvedTransform, 'width'>): boolean {
	return typeof t.width === 'number' && t.width > 0;
}

/** The horizontal room text has INSIDE the box after `padding` is removed from both edges —
 * the wrap width the caller feeds pixi's `wordWrapWidth`, and the width alignment measures
 * against. Never below 1 (a padding larger than the box would otherwise wrap to nothing). */
export function textBoxContentWidth(boxWidth: number, padding: number | undefined): number {
	return Math.max(1, boxWidth - Math.max(0, padding ?? 0) * 2);
}

/** The vertical room text has INSIDE the box after `padding` is removed from both edges —
 * the height auto-fit + vertical alignment measure against. Never below 1. */
export function textBoxContentHeight(boxHeight: number, padding: number | undefined): number {
	return Math.max(1, boxHeight - Math.max(0, padding ?? 0) * 2);
}

/**
 * Horizontal alignment expressed as a text ANCHOR x — so `align` works with NO box (the text
 * pivots around its position: left ⇒ left edge at x, right ⇒ right edge at x), the SAME thing
 * the canvas anchor grid does. `justify`/unset ⇒ undefined (keep the node's own anchor).
 * Inside a box the box is placed by this anchor AND the lines align within it, so the two agree.
 */
export function alignToAnchorX(align: TextStyle['align']): number | undefined {
	switch (align) {
		case 'left':
			return 0;
		case 'center':
			return 0.5;
		case 'right':
			return 1;
		default:
			return undefined;
	}
}

/** Vertical alignment expressed as a text ANCHOR y (top ⇒ 0, middle ⇒ 0.5, bottom ⇒ 1). Unset
 * ⇒ undefined (keep the node's own anchor). The vertical sibling of {@link alignToAnchorX}. */
export function verticalAlignToAnchorY(verticalAlign: TextStyle['verticalAlign']): number | undefined {
	switch (verticalAlign) {
		case 'top':
			return 0;
		case 'middle':
			return 0.5;
		case 'bottom':
			return 1;
		default:
			return undefined;
	}
}

export interface TextBoxPlacement {
	/** Local offset (added to the node's resolved x/y, pre-scale) at which to place an
	 * anchor-{0,0} text object so the box honours the transform anchor and the block sits at
	 * its horizontal + vertical alignment inside the box. */
	offsetX: number;
	offsetY: number;
}

/**
 * Where to place an anchor-{0,0} text object for a box. The box is positioned by the node
 * `anchor`; the block is then aligned WITHIN it by offsetting the MEASURED block by `align`
 * (horizontal) + `verticalAlign` (vertical) — so right/centre truly reach the box edges, even
 * for a single line (PIXI's own `align` only shifts lines vs the widest line, doing nothing for
 * one line — the manual offset is the fix). The text is NOT auto-wrapped to the box; the box is
 * a positioning + auto-fit frame, so the measured width is the real content width.
 */
export function textBoxPlacement(params: {
	boxWidth: number;
	boxHeight: number | undefined;
	/** Inset from every box edge; the block aligns inside `box - 2·padding`. Absent ⇒ 0. */
	padding?: number;
	anchorX: number;
	anchorY: number;
	align: TextStyle['align'];
	verticalAlign: TextStyle['verticalAlign'];
	/** Rendered block width (local px) of the text at its final font size. */
	measuredWidth: number;
	/** Rendered block height (local px) of the text at its final font size. */
	measuredHeight: number;
}): TextBoxPlacement {
	const { boxWidth, boxHeight, anchorX, anchorY, align, verticalAlign } = params;
	const { measuredWidth, measuredHeight } = params;
	const pad = Math.max(0, params.padding ?? 0);
	const contentWidth = textBoxContentWidth(boxWidth, pad);
	const frameHeight = boxHeight ?? measuredHeight;
	// The block aligns inside the padded content area; `pad` shifts the whole thing off the edge.
	let hpad = pad;
	if (align === 'center') hpad = pad + (contentWidth - measuredWidth) / 2;
	else if (align === 'right') hpad = pad + (contentWidth - measuredWidth);
	// No box height ⇒ nothing to align in vertically (padding is a box-only inset), keep parity.
	let vpad = 0;
	if (boxHeight !== undefined) {
		const contentHeight = textBoxContentHeight(boxHeight, pad);
		vpad = pad;
		if (verticalAlign === 'middle') vpad = pad + (contentHeight - measuredHeight) / 2;
		else if (verticalAlign === 'bottom') vpad = pad + (contentHeight - measuredHeight);
	}
	return {
		offsetX: -boxWidth * anchorX + hpad,
		offsetY: -frameHeight * anchorY + vpad,
	};
}

/**
 * The largest font size ≤ `baseFontSize` at which the wrapped text fits the box. `measure`
 * returns the rendered `{ width, height }` at a given font size WITH the box's wrap width
 * applied (so height reflects the real number of wrapped lines). Width is wrap-bounded, so
 * fitting is driven by `boxHeight`; with no `boxHeight` this returns `baseFontSize` (nothing
 * to shrink against). Iterative (font metrics aren't linear once wrapping changes line count),
 * capped so it always terminates.
 */
export function autoFitFontSize(params: {
	measure: (fontSize: number) => { width: number; height: number };
	baseFontSize: number;
	boxWidth: number;
	boxHeight: number | undefined;
	/** Inset from every box edge; the text fits `box - 2·padding`. Absent ⇒ 0. */
	padding?: number;
	minFontSize?: number;
}): number {
	const { measure, baseFontSize, boxWidth, boxHeight, minFontSize = 6 } = params;
	if (boxHeight === undefined) return baseFontSize;
	const contentWidth = textBoxContentWidth(boxWidth, params.padding);
	const contentHeight = textBoxContentHeight(boxHeight, params.padding);
	const EPS = 0.5;
	const fits = (m: { width: number; height: number }) =>
		m.width <= contentWidth + EPS && m.height <= contentHeight + EPS;
	let fs = Math.max(minFontSize, baseFontSize);
	let m = measure(fs);
	if (fits(m)) return fs;
	for (let i = 0; i < 40 && fs > minFontSize; i++) {
		const wRatio = m.width > 0 ? contentWidth / m.width : 1;
		const hRatio = m.height > 0 ? contentHeight / m.height : 1;
		const ratio = Math.min(1, wRatio, hRatio);
		const next = Math.max(minFontSize, Math.floor(fs * (ratio >= 0.999 ? 0.9 : ratio)));
		if (next === fs) break;
		fs = next;
		m = measure(fs);
		if (fits(m)) break;
	}
	return fs;
}
