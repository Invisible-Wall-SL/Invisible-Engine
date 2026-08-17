/**
 * Browser-side BMFont baker for the Font Maker's Generate tab. Uses `opentype.js`
 * for metrics + glyph geometry and Canvas 2D for rasterisation + effects, then a
 * multi-page shelf packer lays the non-empty glyph tiles across one or more pages.
 * The output is a BMFont XML string + one page PNG `Blob` per page, byte-compatible
 * with the shipped fonts (`apps/lines/static/assets/fonts/goldFont/mm_gold.xml`):
 * `<info face>` is the family the user chose (== the catalog `name`), unicode
 * `char id`s, and a `<kernings>` block derived from opentype's kerning pairs (unless
 * the Kerning toggle is off).
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
import { parse, type Font, type Glyph } from 'opentype.js';
import { shelfPack } from '$lib/shelfPack';

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
	/**
	 * The base page filename (the folder/id). One page → `${pageBase}.png` (the shipped
	 * single-page convention); multiple pages → `${pageBase}_0.png`, `${pageBase}_1.png`, …
	 */
	pageBase: string;
	/** Characters to bake (already the final, de-duped set). */
	chars: string[];
	/** Glyph pixel size. */
	fontSize: number;
	/** Max page width before the packer wraps to a new shelf. */
	pageMaxWidth: number;
	/** Max page height before the packer starts a new page. */
	pageMaxHeight: number;
	/** Emit a `<kernings>` block from the font's kerning pairs. */
	kerning: boolean;
	effects: BakeEffects;
}

/** One baked atlas page: its PNG blob + the canvas (for the preview thumbnail). */
export interface BakePage {
	/** Page filename + descriptor `<page file>` ref. */
	file: string;
	blob: Blob;
	canvas: HTMLCanvasElement;
}

export interface BakeResult {
	xml: string;
	/** One entry per atlas page (≥ 1). */
	pages: BakePage[];
	/** Shared page canvas dimensions (== `<common scaleW/scaleH>`). */
	scaleW: number;
	scaleH: number;
	/** Code points the font lacked (mapped to .notdef) — reported in the UI. */
	skipped: string[];
	glyphCount: number;
	/** Kerning pairs emitted (0 when the toggle is off or none were non-zero). */
	kerningCount: number;
}

/** Default, sane-looking effects: fill on, outline + shadow off. */
export function defaultEffects(): BakeEffects {
	return {
		fill: { enabled: true, gradient: false, color: '#ffffff', color2: '#9aa0ff' },
		outline: { enabled: false, width: 3, color: '#000000' },
		shadow: { enabled: false, offsetX: 0, offsetY: 2, blur: 4, color: '#000000cc' },
	};
}

/** One placed glyph: its tile bitmap + BMFont char record (page/x/y filled by the packer). */
interface GlyphTile {
	id: number;
	width: number;
	height: number;
	xoffset: number;
	yoffset: number;
	xadvance: number;
	/** Rendered tile (effects baked in); null for empty-ink glyphs (e.g. space). */
	canvas: HTMLCanvasElement | null;
	/** Atlas page index this tile lives on (always 0 for empty-ink glyphs). */
	page: number;
	x: number;
	y: number;
}

const PAGE_GAP = 1;
/** Absolute ceiling on pages so a runaway charset/size errors instead of minting 100. */
const MAX_PAGES = 8;
/** Upper bound on the O(n²) kerning-pair scan; larger custom charsets skip kerning. */
const MAX_KERNING_CHARS = 256;

/** Parse an uploaded TTF/OTF ArrayBuffer into an opentype `Font`. */
export function parseFont(buffer: ArrayBuffer): Font {
	return parse(buffer);
}

/** Bake a charset into a BMFont XML descriptor + one PNG per atlas page. */
export async function bakeBitmapFont(opts: BakeOptions): Promise<BakeResult> {
	const { font, face, pageBase, chars, fontSize, pageMaxWidth, pageMaxHeight, kerning, effects } =
		opts;

	const scale = fontSize / font.unitsPerEm;
	const ascent = font.ascender * scale;
	const descent = -font.descender * scale;
	const base = Math.round(ascent);
	const lineHeight = Math.round(ascent + descent);

	// Effect bleed padding so outlines / blur / shadow offsets never clip the tile.
	const pad = effectPad(effects);

	const tiles: GlyphTile[] = [];
	const skipped: string[] = [];
	// Code point → opentype glyph, for the post-pass kerning scan (cached, no re-lookup).
	const bakedGlyphs: { code: number; glyph: Glyph }[] = [];

	for (const ch of dedupeChars(chars)) {
		const code = ch.codePointAt(0);
		if (code === undefined) continue;
		const glyph = font.charToGlyph(ch);
		// A glyph index of 0 (.notdef) for a non-space char means the font lacks it.
		if (glyph.index === 0 && code !== 0x20) {
			skipped.push(ch);
			continue;
		}
		bakedGlyphs.push({ code, glyph });

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
				page: 0,
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
			page: 0,
			x: 0,
			y: 0,
		});
	}

	if (tiles.length === 0) {
		throw new Error('No renderable glyphs — the font lacks every requested character.');
	}

	const { scaleW, scaleH, pageCount } = packTiles(tiles, pageMaxWidth, pageMaxHeight);

	// All pages share one canvas size so the descriptor's scaleW/scaleH is uniform
	// (what pixi's BitmapText loader expects); one file per page index.
	const pageFiles = pageFileNames(pageBase, pageCount);
	const pages: BakePage[] = [];
	for (let i = 0; i < pageCount; i++) {
		const pageCanvas = document.createElement('canvas');
		pageCanvas.width = scaleW;
		pageCanvas.height = scaleH;
		const pageCtx = pageCanvas.getContext('2d');
		if (!pageCtx) throw new Error('Could not acquire a 2D page context.');
		for (const t of tiles) {
			if (t.canvas && t.page === i) pageCtx.drawImage(t.canvas, t.x, t.y);
		}
		pages.push({ file: pageFiles[i], blob: await canvasToPng(pageCanvas), canvas: pageCanvas });
	}

	const kernings = kerning
		? collectKernings(font, bakedGlyphs, scale)
		: { pairs: [] as KerningPair[] };

	const xml = emitBmfontXml({
		face,
		fontSize,
		base,
		lineHeight,
		scaleW,
		scaleH,
		pageFiles,
		tiles,
		kernings: kernings.pairs,
	});

	return {
		xml,
		pages,
		scaleW,
		scaleH,
		skipped,
		glyphCount: tiles.length,
		kerningCount: kernings.pairs.length,
	};
}

/** Page filenames: `${base}.png` for a single page, else `${base}_${i}.png`. */
function pageFileNames(base: string, count: number): string[] {
	if (count === 1) return [`${base}.png`];
	return Array.from({ length: count }, (_, i) => `${base}_${i}.png`);
}

interface KerningPair {
	first: number;
	second: number;
	amount: number;
}

/**
 * Scan every ordered pair of baked code points and read opentype's kerning value
 * (scaled to px, rounded). Skips zero-amount pairs. The charset is normally ≤ ~95
 * chars so the O(n²) scan is trivial; a pathological custom charset is capped at
 * `MAX_KERNING_CHARS` (kerning is then omitted rather than scanning n²).
 */
function collectKernings(
	font: Font,
	baked: { code: number; glyph: Glyph }[],
	scale: number,
): { pairs: KerningPair[] } {
	if (baked.length > MAX_KERNING_CHARS) return { pairs: [] };
	const pairs: KerningPair[] = [];
	for (const left of baked) {
		for (const right of baked) {
			const amount = Math.round(font.getKerningValue(left.glyph, right.glyph) * scale);
			if (amount === 0) continue;
			pairs.push({ first: left.code, second: right.code, amount });
		}
	}
	return { pairs };
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

/**
 * Place every glyph tile with the SHARED shelf packer (`$lib/shelfPack.ts`), then copy the
 * placements back onto the tiles (the BMFont emitter reads them off each `<char>`). The
 * packing itself is shared with the Rigger's rig-text page so there is exactly one shelf
 * packer in the launcher; a tile with no canvas is zero-area and lands at page 0, (0,0) —
 * the space-glyph case the packer preserves.
 */
function packTiles(
	tiles: GlyphTile[],
	maxWidth: number,
	maxHeight: number,
): { scaleW: number; scaleH: number; pageCount: number } {
	const packed = shelfPack(
		tiles.map((t) => (t.canvas ? { width: t.width, height: t.height } : { width: 0, height: 0 })),
		{
			maxWidth,
			maxHeight,
			gap: PAGE_GAP,
			maxPages: MAX_PAGES,
			tooTallMessage:
				'A glyph is taller than the max page height — increase the max page height or ' +
				'reduce the glyph size.',
			tooManyPagesMessage: (max) =>
				`Glyph atlas needs more than ${max} pages — try a smaller size, a smaller ` +
				'charset, or a larger page.',
		},
	);
	tiles.forEach((t, i) => {
		const p = packed.placements[i];
		t.page = p.page;
		t.x = p.x;
		t.y = p.y;
	});
	return { scaleW: packed.width, scaleH: packed.height, pageCount: packed.pageCount };
}

/** Emit a BMFont XML descriptor string (one `<page>` per atlas page + `<kernings>`). */
function emitBmfontXml(args: {
	face: string;
	fontSize: number;
	base: number;
	lineHeight: number;
	scaleW: number;
	scaleH: number;
	pageFiles: string[];
	tiles: GlyphTile[];
	kernings: KerningPair[];
}): string {
	const { face, fontSize, base, lineHeight, scaleW, scaleH, pageFiles, tiles, kernings } = args;
	const lines: string[] = [];
	lines.push('<?xml version="1.0"?>');
	lines.push('<font>');
	lines.push(
		`  <info face="${xmlAttr(face)}" size="${fontSize}" bold="0" italic="0" charset="" ` +
			`unicode="1" stretchH="100" smooth="1" aa="1" padding="0,0,0,0" spacing="1,1" outline="0"/>`,
	);
	lines.push(
		`  <common lineHeight="${lineHeight}" base="${base}" scaleW="${scaleW}" scaleH="${scaleH}" ` +
			`pages="${pageFiles.length}" packed="0" alphaChnl="1" redChnl="0" greenChnl="0" blueChnl="0"/>`,
	);
	lines.push('  <pages>');
	pageFiles.forEach((file, id) => {
		lines.push(`    <page id="${id}" file="${xmlAttr(file)}"/>`);
	});
	lines.push('  </pages>');
	lines.push(`  <chars count="${tiles.length}">`);
	for (const t of tiles) {
		lines.push(
			`    <char id="${t.id}" x="${t.x}" y="${t.y}" width="${t.width}" height="${t.height}" ` +
				`xoffset="${t.xoffset}" yoffset="${t.yoffset}" xadvance="${t.xadvance}" ` +
				`page="${t.page}" chnl="15"/>`,
		);
	}
	lines.push('  </chars>');
	if (kernings.length) {
		lines.push(`  <kernings count="${kernings.length}">`);
		for (const k of kernings) {
			lines.push(`    <kerning first="${k.first}" second="${k.second}" amount="${k.amount}"/>`);
		}
		lines.push('  </kernings>');
	}
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
