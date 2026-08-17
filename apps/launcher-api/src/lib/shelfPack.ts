/**
 * The launcher's ONE bitmap shelf packer.
 *
 * Extracted verbatim (semantics-for-semantics) from the Font Maker's glyph packer so a second
 * consumer — the Rigger's rig-text page, which packs rasterised STRINGS instead of glyphs — does
 * not grow a parallel one. Two packers producing subtly different pages is exactly the kind of
 * duplication that ends with a page whose `size:` disagrees with its rects.
 *
 * Left→right shelves, wrapping at `maxWidth` and starting a NEW page when the next shelf would
 * exceed `maxHeight`. Every page shares ONE canvas size (`width`/`height`) because a BMFont
 * descriptor declares a single `scaleW`/`scaleH` for all pages — and because a uniform page is
 * simpler for every consumer.
 *
 * Zero-area items are legal and are reported at page 0, (0,0): a BMFont space glyph has an
 * advance but no quad, and dropping it from the result would break index correspondence.
 */

export interface ShelfItem {
	width: number;
	height: number;
}

export interface ShelfPlacement {
	page: number;
	x: number;
	y: number;
}

export interface ShelfPackResult {
	/** One placement per input item, in input order. */
	placements: ShelfPlacement[];
	/** Shared page width (widest used column across pages, + one gap). */
	width: number;
	/** Shared page height (tallest used page, + one gap). */
	height: number;
	pageCount: number;
}

export interface ShelfPackOptions {
	maxWidth: number;
	maxHeight: number;
	/** Gap between items AND the border inset. Default 1 (the Font Maker's `PAGE_GAP`). */
	gap?: number;
	/** Ceiling so a runaway input errors instead of minting a hundred pages. Default 8. */
	maxPages?: number;
	/** Message for an item taller than any page can hold. */
	tooTallMessage?: string;
	/** Message for exceeding `maxPages`. */
	tooManyPagesMessage?: (maxPages: number) => string;
}

export function shelfPack(items: ShelfItem[], opts: ShelfPackOptions): ShelfPackResult {
	const gap = opts.gap ?? 1;
	const maxPages = opts.maxPages ?? 8;
	const { maxWidth, maxHeight } = opts;

	const placements: ShelfPlacement[] = [];
	let page = 0;
	let penX = gap;
	let penY = gap;
	let shelfH = 0;
	let usedW = 0;
	// Bottom (penY + shelfH) of each page, to size the shared canvas height.
	const pageBottoms: number[] = [];

	const startNewPage = (): void => {
		pageBottoms[page] = penY + shelfH;
		page += 1;
		if (page >= maxPages) {
			throw new Error(
				opts.tooManyPagesMessage?.(maxPages) ??
					`The packed atlas needs more than ${maxPages} pages — reduce the size or the count.`,
			);
		}
		penX = gap;
		penY = gap;
		shelfH = 0;
	};

	for (const item of items) {
		if (item.width <= 0 || item.height <= 0) {
			placements.push({ page: 0, x: 0, y: 0 });
			continue;
		}
		// A single item too tall for any page can never fit — fail clearly.
		if (item.height + gap * 2 > maxHeight) {
			throw new Error(
				opts.tooTallMessage ??
					'An item is taller than the max page height — increase it or reduce the item size.',
			);
		}
		if (penX + item.width + gap > maxWidth && penX > gap) {
			// Wrap to a new shelf.
			penX = gap;
			penY += shelfH + gap;
			shelfH = 0;
		}
		if (penY + item.height + gap > maxHeight && penY > gap) {
			// This shelf overflows the page → start a fresh page.
			startNewPage();
		}
		placements.push({ page, x: penX, y: penY });
		penX += item.width + gap;
		shelfH = Math.max(shelfH, item.height);
		usedW = Math.max(usedW, penX - gap);
	}
	pageBottoms[page] = penY + shelfH;

	return {
		placements,
		width: Math.max(1, usedW + gap),
		height: Math.max(1, Math.max(...pageBottoms) + gap),
		pageCount: page + 1,
	};
}
