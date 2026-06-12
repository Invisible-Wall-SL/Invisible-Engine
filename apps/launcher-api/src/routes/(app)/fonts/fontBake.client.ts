/**
 * Browser-side BMFont baker for the Font Maker's Generate tab. Uses `opentype.js`
 * for metrics + glyph geometry and Canvas 2D for rasterisation + effects, then a
 * shelf packer lays the non-empty glyph tiles onto a single page. The output is a
 * BMFont XML string + a page PNG `Blob`, byte-compatible with the shipped fonts
 * (`apps/lines/static/assets/fonts/goldFont/mm_gold.xml`): `<info face>` is the
 * family the user chose (== the catalog `name`), unicode `char id`s, no `<kernings>`
 * (kerning is Phase 4).
 *
 * Metrics mapping (all integers):
 *   scale      = fontSize / unitsPerEm
 *   ascent     = font.ascender  * scale
 *   descent    = -font.descender * scale   (descender is negative in font units)
 *   base       = round(ascent)
 *   lineHeight = round(ascent + descent)
 * Per glyph the outline is placed at baseline `ascent` in a local tile, so its ink
 * box (from `Path.getBoundingBox()`, canvas y-down) is already measured from the
 * line top. The tile is the ink box expanded by `pad` (effect bleed) on every side:
 *   width/height = tile size
 *   xoffset      = floor(bb.x1) - pad
 *   yoffset      = floor(bb.y1) - pad
 *   xadvance     = round(glyph.advanceWidth * scale)
 */
import { parse, type Font } from 'opentype.js';

export interface FillEffect {
	enabled: boolean;
	/** When false, a solid `color`; when true, a vertical gradient `color`→`color2`. */
	gradient: boolean;
	color: string;
	color2: string;
}
export interface OutlineEffect {
	enabled: boolean;
	width: number;
	color: string;
}
export interface ShadowEffect {
	enabled: boolean;
	offsetX: number;
	offsetY: number;
	blur: number;
	color: string;
}

export interface BakeEffects {
	fill: FillEffect;
	outline: OutlineEffect;
	shadow: ShadowEffect;
}

export interface BakeOptions {
	/** Parsed TTF/OTF. */
	font: Font;
	/** The BMFont `<info face>` + catalog name. */
	face: string;
	/** The page PNG filename + descriptor `<page file>` ref, e.g. `myfont.png`. */
	pageFile: string;
	/** Characters to bake (already the final, de-duped set). */
	chars: string[];
	/** Glyph pixel size. */
	fontSize: number;
	/** Max page width before the packer wraps to a new shelf. */
	pageMaxWidth: number;
	effects: BakeEffects;
}

export interface BakeResult {
	xml: string;
	pageBlob: Blob;
	/** For the preview atlas thumbnail. */
	pageCanvas: HTMLCanvasElement;
	scaleW: number;
	scaleH: number;
	/** Code points the font lacked (mapped to .notdef) — reported in the UI. */
	skipped: string[];
	glyphCount: number;
}

/** Default, sane-looking effects: fill on, outline + shadow off. */
export function defaultEffects(): BakeEffects {
	return {
		fill: { enabled: true, gradient: false, color: '#ffffff', color2: '#9aa0ff' },
		outline: { enabled: false, width: 3, color: '#000000' },
		shadow: { enabled: false, offsetX: 0, offsetY: 2, blur: 4, color: '#000000cc' },
	};
}

/** One placed glyph: its tile bitmap + BMFont char record (page x,y filled by the packer). */
interface GlyphTile {
	id: number;
	width: number;
	height: number;
	xoffset: number;
	yoffset: number;
	xadvance: number;
	/** Rendered tile (effects baked in); null for empty-ink glyphs (e.g. space). */
	canvas: HTMLCanvasElement | null;
	x: number;
	y: number;
}

const PAGE_GAP = 1;
/** Hard ceiling so a runaway charset/size surfaces an error instead of a huge canvas. */
const MAX_PAGE_HEIGHT = 4096;

/** Parse an uploaded TTF/OTF ArrayBuffer into an opentype `Font`. */
export function parseFont(buffer: ArrayBuffer): Font {
	return parse(buffer);
}

/** Bake a charset into a BMFont XML descriptor + a single page PNG. */
export async function bakeBitmapFont(opts: BakeOptions): Promise<BakeResult> {
	const { font, face, pageFile, chars, fontSize, pageMaxWidth, effects } = opts;

	const scale = fontSize / font.unitsPerEm;
	const ascent = font.ascender * scale;
	const descent = -font.descender * scale;
	const base = Math.round(ascent);
	const lineHeight = Math.round(ascent + descent);

	// Effect bleed padding so outlines / blur / shadow offsets never clip the tile.
	const pad = effectPad(effects);

	const tiles: GlyphTile[] = [];
	const skipped: string[] = [];

	for (const ch of dedupeChars(chars)) {
		const code = ch.codePointAt(0);
		if (code === undefined) continue;
		const glyph = font.charToGlyph(ch);
		// A glyph index of 0 (.notdef) for a non-space char means the font lacks it.
		if (glyph.index === 0 && code !== 0x20) {
			skipped.push(ch);
			continue;
		}

		const xadvance = Math.round((glyph.advanceWidth ?? 0) * scale);
		const path = glyph.getPath(0, ascent, fontSize);
		const bb = path.getBoundingBox();
		const inkW = bb.x2 - bb.x1;
		const inkH = bb.y2 - bb.y1;

		// Empty-ink glyph (space): a `<char>` with xadvance, no tile / quad.
		if (!Number.isFinite(inkW) || !Number.isFinite(inkH) || inkW <= 0 || inkH <= 0) {
			tiles.push({
				id: code,
				width: 0,
				height: 0,
				xoffset: 0,
				yoffset: 0,
				xadvance,
				canvas: null,
				x: 0,
				y: 0,
			});
			continue;
		}

		const inkLeft = Math.floor(bb.x1);
		const inkTop = Math.floor(bb.y1);
		const inkRight = Math.ceil(bb.x2);
		const inkBottom = Math.ceil(bb.y2);
		const tileW = inkRight - inkLeft + pad * 2;
		const tileH = inkBottom - inkTop + pad * 2;

		const canvas = document.createElement('canvas');
		canvas.width = tileW;
		canvas.height = tileH;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Could not acquire a 2D canvas context.');

		// Shift the path so its ink box + pad sits at tile (0,0).
		ctx.save();
		ctx.translate(pad - inkLeft, pad - inkTop);
		const p2d = new Path2D(path.toPathData(3));

		// (1) drop-shadow: applied to the fill pass below via ctx.shadow*.
		if (effects.shadow.enabled) {
			ctx.shadowColor = effects.shadow.color;
			ctx.shadowBlur = effects.shadow.blur;
			ctx.shadowOffsetX = effects.shadow.offsetX;
			ctx.shadowOffsetY = effects.shadow.offsetY;
		}

		// (2) outline UNDER the fill so it reads as a surround. Stroke carries the
		// shadow (it's the bottom-most ink); fill is drawn on top shadow-less.
		if (effects.outline.enabled && effects.outline.width > 0) {
			ctx.lineJoin = 'round';
			ctx.lineWidth = effects.outline.width;
			ctx.strokeStyle = effects.outline.color;
			ctx.stroke(p2d);
			ctx.shadowColor = 'transparent';
			ctx.shadowBlur = 0;
			ctx.shadowOffsetX = 0;
			ctx.shadowOffsetY = 0;
		}

		// (3) fill: solid OR a vertical gradient across the ink box (top→bottom).
		if (effects.fill.enabled) {
			if (effects.fill.gradient) {
				const grad = ctx.createLinearGradient(0, bb.y1, 0, bb.y2);
				grad.addColorStop(0, effects.fill.color);
				grad.addColorStop(1, effects.fill.color2);
				ctx.fillStyle = grad;
			} else {
				ctx.fillStyle = effects.fill.color;
			}
			ctx.fill(p2d);
		}
		ctx.restore();

		tiles.push({
			id: code,
			width: tileW,
			height: tileH,
			xoffset: inkLeft - pad,
			yoffset: inkTop - pad,
			xadvance,
			canvas,
			x: 0,
			y: 0,
		});
	}

	if (tiles.length === 0) {
		throw new Error('No renderable glyphs — the font lacks every requested character.');
	}

	const { scaleW, scaleH } = packTiles(tiles, pageMaxWidth);

	const pageCanvas = document.createElement('canvas');
	pageCanvas.width = scaleW;
	pageCanvas.height = scaleH;
	const pageCtx = pageCanvas.getContext('2d');
	if (!pageCtx) throw new Error('Could not acquire a 2D page context.');
	for (const t of tiles) {
		if (t.canvas) pageCtx.drawImage(t.canvas, t.x, t.y);
	}

	const xml = emitBmfontXml({ face, fontSize, base, lineHeight, scaleW, scaleH, pageFile, tiles });
	const pageBlob = await canvasToPng(pageCanvas);

	return {
		xml,
		pageBlob,
		pageCanvas,
		scaleW,
		scaleH,
		skipped,
		glyphCount: tiles.length,
	};
}

/** Effect bleed in px: `ceil(outline + blur + max(|dx|,|dy|)) + 2`. */
function effectPad(effects: BakeEffects): number {
	const outline = effects.outline.enabled ? effects.outline.width : 0;
	const blur = effects.shadow.enabled ? effects.shadow.blur : 0;
	const off = effects.shadow.enabled
		? Math.max(Math.abs(effects.shadow.offsetX), Math.abs(effects.shadow.offsetY))
		: 0;
	return Math.ceil(outline + blur + off) + 2;
}

/** Simple left→right shelf packer; wraps at `maxWidth`, grows height to fit. */
function packTiles(tiles: GlyphTile[], maxWidth: number): { scaleW: number; scaleH: number } {
	let penX = PAGE_GAP;
	let penY = PAGE_GAP;
	let shelfH = 0;
	let usedW = 0;

	for (const t of tiles) {
		if (!t.canvas || t.width === 0 || t.height === 0) {
			t.x = 0;
			t.y = 0;
			continue;
		}
		if (penX + t.width + PAGE_GAP > maxWidth && penX > PAGE_GAP) {
			// Wrap to a new shelf.
			penX = PAGE_GAP;
			penY += shelfH + PAGE_GAP;
			shelfH = 0;
		}
		t.x = penX;
		t.y = penY;
		penX += t.width + PAGE_GAP;
		shelfH = Math.max(shelfH, t.height);
		usedW = Math.max(usedW, t.x + t.width);
		if (penY + t.height + PAGE_GAP > MAX_PAGE_HEIGHT) {
			throw new Error(
				'Glyph atlas overflows the max page height — try a smaller size, a smaller ' +
					'charset, or a wider page.',
			);
		}
	}

	const scaleW = Math.max(1, usedW + PAGE_GAP);
	const scaleH = Math.max(1, penY + shelfH + PAGE_GAP);
	return { scaleW, scaleH };
}

/** Emit a BMFont XML descriptor string (no `<kernings>` — Phase 4). */
function emitBmfontXml(args: {
	face: string;
	fontSize: number;
	base: number;
	lineHeight: number;
	scaleW: number;
	scaleH: number;
	pageFile: string;
	tiles: GlyphTile[];
}): string {
	const { face, fontSize, base, lineHeight, scaleW, scaleH, pageFile, tiles } = args;
	const lines: string[] = [];
	lines.push('<?xml version="1.0"?>');
	lines.push('<font>');
	lines.push(
		`  <info face="${xmlAttr(face)}" size="${fontSize}" bold="0" italic="0" charset="" ` +
			`unicode="1" stretchH="100" smooth="1" aa="1" padding="0,0,0,0" spacing="1,1" outline="0"/>`,
	);
	lines.push(
		`  <common lineHeight="${lineHeight}" base="${base}" scaleW="${scaleW}" scaleH="${scaleH}" ` +
			`pages="1" packed="0" alphaChnl="1" redChnl="0" greenChnl="0" blueChnl="0"/>`,
	);
	lines.push('  <pages>');
	lines.push(`    <page id="0" file="${xmlAttr(pageFile)}"/>`);
	lines.push('  </pages>');
	lines.push(`  <chars count="${tiles.length}">`);
	for (const t of tiles) {
		lines.push(
			`    <char id="${t.id}" x="${t.x}" y="${t.y}" width="${t.width}" height="${t.height}" ` +
				`xoffset="${t.xoffset}" yoffset="${t.yoffset}" xadvance="${t.xadvance}" ` +
				`page="0" chnl="15"/>`,
		);
	}
	lines.push('  </chars>');
	lines.push('</font>');
	return lines.join('\n');
}

function xmlAttr(v: string): string {
	return v
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function dedupeChars(chars: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const ch of chars) {
		if (ch && !seen.has(ch)) {
			seen.add(ch);
			out.push(ch);
		}
	}
	return out;
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) resolve(blob);
			else reject(new Error('Failed to encode the page PNG.'));
		}, 'image/png');
	});
}
