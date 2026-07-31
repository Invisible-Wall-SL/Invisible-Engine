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

/**
 * Style additions that turn a plain text style into a box-constrained one: wrap the lines
 * to the box width and align them within it. Merged OVER the node's own style, so an
 * author's `align` is respected and everything else (font, fill, stroke…) passes through.
 * Kept minimal so a box-less text node (which never calls this) is byte-identical to before.
 */
export function textBoxStyleOverrides(
	boxWidth: number,
	align: TextStyle['align'],
): Pick<TextStyle, 'wordWrap' | 'wordWrapWidth' | 'align'> {
	return {
		wordWrap: true,
		wordWrapWidth: boxWidth,
		align: align ?? 'left',
	};
}

export interface TextBoxPlacement {
	/** Local offset (added to the node's resolved x/y, pre-scale) at which to place an
	 * anchor-{0,0} text object so the box's top-left honours the transform anchor and the
	 * block sits at its vertical alignment inside the box. */
	offsetX: number;
	offsetY: number;
}

/**
 * Where to place an anchor-{0,0} text object for a box. Horizontal alignment lives in the
 * style (`wordWrapWidth` + `align`), so `offsetX` only positions the box itself against the
 * transform anchor. `offsetY` positions the box AND applies the vertical alignment padding
 * (needs the measured block height; only meaningful when the box has a `height`).
 */
export function textBoxPlacement(params: {
	boxWidth: number;
	boxHeight: number | undefined;
	anchorX: number;
	anchorY: number;
	verticalAlign: TextStyle['verticalAlign'];
	/** Rendered block height (local px) of the wrapped text at its final font size. */
	measuredHeight: number;
}): TextBoxPlacement {
	const { boxWidth, boxHeight, anchorX, anchorY, verticalAlign, measuredHeight } = params;
	const frameHeight = boxHeight ?? measuredHeight;
	let vpad = 0;
	if (boxHeight !== undefined) {
		if (verticalAlign === 'middle') vpad = (boxHeight - measuredHeight) / 2;
		else if (verticalAlign === 'bottom') vpad = boxHeight - measuredHeight;
	}
	return {
		offsetX: -boxWidth * anchorX,
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
	minFontSize?: number;
}): number {
	const { measure, baseFontSize, boxWidth, boxHeight, minFontSize = 6 } = params;
	if (boxHeight === undefined) return baseFontSize;
	const EPS = 0.5;
	const fits = (m: { width: number; height: number }) =>
		m.width <= boxWidth + EPS && m.height <= boxHeight + EPS;
	let fs = Math.max(minFontSize, baseFontSize);
	let m = measure(fs);
	if (fits(m)) return fs;
	for (let i = 0; i < 40 && fs > minFontSize; i++) {
		const wRatio = m.width > 0 ? boxWidth / m.width : 1;
		const hRatio = m.height > 0 ? boxHeight / m.height : 1;
		const ratio = Math.min(1, wRatio, hRatio);
		const next = Math.max(minFontSize, Math.floor(fs * (ratio >= 0.999 ? 0.9 : ratio)));
		if (next === fs) break;
		fs = next;
		m = measure(fs);
		if (fits(m)) break;
	}
	return fs;
}
