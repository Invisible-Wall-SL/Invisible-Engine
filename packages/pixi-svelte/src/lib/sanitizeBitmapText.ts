import * as PIXI from 'pixi.js';

/**
 * Engine guard for a known PixiJS-8 black-screen: a `BitmapText` rendering a character
 * the resolved `BitmapFont` was not baked with crashes the whole render loop instead of
 * skipping the glyph.
 *
 * Root cause (verified against pixi.js 8.8.1): the bitmap layout/GPU path looks up
 * `font.chars[char] || font.chars[' ']` and then dereferences `charData.kerning`. For a
 * STATIC/installed font (e.g. a Font Maker digits/currency-only descriptor) that lacks
 * both the glyph AND the space glyph, `charData` is `undefined` → `Cannot read properties
 * of undefined (reading 'kerning')` → the `requestAnimationFrame` loop dies → black screen.
 * (Dynamically-generated fonts never hit this; they mint glyphs on demand.)
 *
 * The fix sanitises `text` BEFORE it reaches the PIXI object: any character the resolved
 * font does not contain is DROPPED, so a missing glyph degrades to "that char isn't drawn"
 * rather than crashing. Whitespace is always kept.
 */

/**
 * Resolve the installed `BitmapFont` for a `<Text>`-style `fontFamily`.
 *
 * pixi caches a loaded/installed bitmap font under `\`${fontFamily}-bitmap\``
 * (see pixi.js 8.8.1 `loadBitmapFont` cache parser + `BitmapFontManager.getFont`).
 * `fontFamily` may be a single name or a fallback list (`string | string[]`); we resolve
 * the first family that is present as a static bitmap font.
 *
 * Returns `undefined` when nothing is registered yet (font still loading, or this is a
 * dynamic/system font) — callers must treat that as "leave the text unchanged".
 */
export function resolveBitmapFont(
	fontFamily: string | string[] | undefined,
): PIXI.BitmapFont | undefined {
	if (fontFamily === undefined) return undefined;
	const families = Array.isArray(fontFamily) ? fontFamily : [fontFamily];
	for (const family of families) {
		if (typeof family !== 'string' || family.length === 0) continue;
		const key = `${family}-bitmap`;
		try {
			if (PIXI.Cache.has(key)) {
				const font = PIXI.Cache.get<PIXI.BitmapFont>(key);
				if (font && typeof font === 'object' && font.chars) return font;
			}
		} catch {
			// Cache lookup should never throw, but never let the guard itself crash.
		}
	}
	return undefined;
}

/**
 * Guarantee the resolved bitmap `font` has a space glyph, synthesising a textureless one
 * when it is missing. This is the CRASH-PROOFING half of the guard (sanitisation alone is
 * not enough — see below).
 *
 * pixi's `getBitmapTextLayout` (verified against 8.8.1) resolves every character to
 * `font.chars[char] || font.chars[' ']` and dereferences `.xAdvance` / `.kerning` on the
 * result; its trim-end pass additionally reads `font.chars[' '].xAdvance` DIRECTLY (no
 * fallback). A font baked WITHOUT a space glyph — e.g. a Font Maker charset that omits the
 * space — therefore crashes the whole render loop the instant any text contains a space
 * (and the layout's missing-glyph fallback is itself the missing space) → black screen.
 * `sanitizeBitmapText` cannot cover this: it intentionally KEEPS whitespace (a space is
 * meaningful layout), so a space always reaches a space-less font.
 *
 * With a space glyph guaranteed present, a space renders as blank width and any other
 * missing glyph degrades to the space fallback in layout, then is skipped by the GPU pipe
 * (`charData?.texture`) — i.e. "not drawn" instead of a dead render loop. Any STATIC font
 * pixi can crash on is cached under `${fontFamily}-bitmap`, the exact key
 * {@link resolveBitmapFont} resolves, so this guard always reaches the offending font.
 *
 * Idempotent + defensive: no-op when the font is unresolved, already has a space, or
 * exposes an unexpected `chars` shape. The synthetic glyph carries a quarter-em advance
 * (from `baseMeasurementFontSize`) and NO texture, so it occupies sensible width yet draws
 * nothing.
 */
export function ensureBitmapFontSpaceGlyph(font: PIXI.BitmapFont | undefined): void {
	const chars = font?.chars;
	if (!chars || typeof chars !== 'object' || ' ' in chars) return;
	try {
		const base =
			typeof font?.baseMeasurementFontSize === 'number' && font.baseMeasurementFontSize > 0
				? font.baseMeasurementFontSize
				: 100;
		chars[' '] = {
			id: 32,
			xOffset: 0,
			yOffset: 0,
			xAdvance: Math.max(1, Math.round(base * 0.25)),
			kerning: {},
		};
	} catch {
		// Never let the guard itself crash the render loop.
	}
}

/** The metric fields pixi declares `readonly` on `AbstractBitmapFont` but writes as plain
 *  instance properties in the `BitmapFont` constructor — i.e. readonly to TS only. */
type MutableFontMetrics = {
	lineHeight: number;
	baseLineOffset: number;
	baseMeasurementFontSize: number;
};

/** Fonts whose metrics have been inspected — the correction must run exactly once per font. */
const measuredFonts = new WeakSet<PIXI.BitmapFont>();

/** How far the glyphs may overflow the declared line box before the descriptor is treated as
 *  WRONG rather than as ordinary overshoot (a real font's descenders stay inside it). */
const GLYPH_OVERFLOW_TOLERANCE = 1.1;

/**
 * Correct a static bitmap font whose descriptor UNDER-REPORTS its own glyph box, so
 * `fontSize` means the same thing for every font.
 *
 * pixi 8 derives everything about a bitmap font from two descriptor numbers (verified against
 * 8.8.1): `getBitmapTextLayout` draws at `scale = style.fontSize / font.baseMeasurementFontSize`
 * (`<info size>`) and advances each new line by `font.lineHeight` (`<common lineHeight>`).
 * `style.lineHeight` is never consulted. A descriptor whose glyphs are actually TALLER than
 * those numbers therefore breaks twice over, and neither is fixable from the call site:
 *   - every glyph renders `glyphBox / size` times bigger than the requested `fontSize`, so an
 *     authored size control appears not to work (the engine's bundled `silver` font declares
 *     `size=97` for ~168px glyphs → ~1.7× too big);
 *   - multi-line text advances by less than a glyph is tall → the lines OVERLAP.
 *
 * The fix rescales both numbers by the font's measured glyph box, which restores the invariant
 * every correct descriptor already satisfies (`lineHeight ≈ tallest glyph`): text draws at the
 * requested `fontSize` and one line clears the next. `baseLineOffset` rides the same factor as
 * it is expressed in the same units.
 *
 * Idempotent + defensive: no-op for an unresolved font, a DYNAMIC font (its glyphs are minted
 * from a real font file, so its metrics are correct by construction and its char set keeps
 * growing), a descriptor that already fits its glyphs, or any unexpected error.
 */
export function normalizeBitmapFontMetrics(font: PIXI.BitmapFont | undefined): void {
	if (!font || measuredFonts.has(font)) return;
	if (typeof (font as { ensureCharacters?: unknown }).ensureCharacters === 'function') return;
	try {
		const metrics = font as unknown as MutableFontMetrics;
		const { lineHeight, baseMeasurementFontSize } = metrics;
		if (!(lineHeight > 0) || !(baseMeasurementFontSize > 0)) return;

		// The box the glyphs actually occupy below the line's top edge. Textureless glyphs (a
		// synthesised space) carry no box and are skipped.
		let glyphBox = 0;
		for (const key in font.chars) {
			const char = font.chars[key];
			const height = char?.texture?.frame?.height ?? 0;
			if (height > 0) glyphBox = Math.max(glyphBox, (char.yOffset || 0) + height);
		}

		measuredFonts.add(font);
		if (!(glyphBox > lineHeight * GLYPH_OVERFLOW_TOLERANCE)) return;

		const correction = glyphBox / lineHeight;
		metrics.lineHeight = glyphBox;
		metrics.baseMeasurementFontSize = baseMeasurementFontSize * correction;
		metrics.baseLineOffset *= correction;
	} catch {
		// Never let the guard itself crash the render loop.
	}
}

/** True for characters that must always survive sanitisation (space, tab, CR, LF, …). */
const isWhitespace = (char: string): boolean => /\s/.test(char);

/**
 * Drop every character the resolved bitmap `font` does not contain.
 *
 * - Whitespace is ALWAYS kept (the bitmap layout handles spaces/newlines itself, and a
 *   font may legitimately omit a space glyph).
 * - A character present in `font.chars` is kept; one that is absent is dropped.
 * - Defensive bail-outs return the input UNCHANGED (never blank the game): no font, a font
 *   with no/empty/oddly-shaped `chars` map, or any unexpected error. The font may resolve
 *   on a later frame; this guard only ever REMOVES known-missing glyphs.
 *
 * `font.chars` is `Record<string, CharData>` keyed by the single-character STRING in
 * pixi.js 8.8.1 (verified: `AbstractBitmapFont.chars` + `getBitmapTextLayout` indexes it
 * with `chars[i]`, a code-point string). We iterate by code point (spread) so astral
 * characters are tested as whole units.
 */
export function sanitizeBitmapText(
	text: string | undefined,
	font: PIXI.BitmapFont | undefined,
): string | undefined {
	if (text === undefined || text === '') return text;
	const chars = font?.chars;
	if (!chars || typeof chars !== 'object') return text;

	let hasKey = false;
	for (const _ in chars) {
		hasKey = true;
		break;
	}
	if (!hasKey) return text;

	try {
		let out = '';
		for (const char of text) {
			if (isWhitespace(char) || char in chars) out += char;
		}
		return out;
	} catch {
		return text;
	}
}
