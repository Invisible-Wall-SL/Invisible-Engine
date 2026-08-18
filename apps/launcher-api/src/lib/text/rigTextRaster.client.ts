/**
 * Rasterise localization strings into rig ART — the "text → region" step the Rigger's
 * localized-text elements need (design `docs/design/invisible-cinematic.md` §12.4a).
 *
 * Nothing here lays out text. The strings are drawn by **PIXI's own text renderers** —
 * `BitmapText` for the project's bitmap fonts, `Text` for its web fonts — loaded through the
 * SHARED `$lib/fontLoad.client.ts` that the Scene Editor and the Font Maker already use. So
 * what gets baked into the rig page is what the same font would have drawn in the game, and a
 * fix to font loading lands here for free. Packing is the SHARED `$lib/shelfPack.ts` (the Font
 * Maker's glyph packer). This module is only the glue: render → extract pixels → pack → PNG.
 *
 * Runs in the browser (`document`, `canvas`, WebGL). It is bundled as the vendored IIFE
 * `static/rigger/vendor/rigger-text.js` because `/rigger` is a raw-WebGL static page with no
 * module system — the same shape as the FX overlay's `rigger-fx.js`.
 */
import { Application, BitmapText, Rectangle, Text, type Container } from 'pixi.js';
import { loadCatalogBitmapFont, ensureWebFont, type CatalogFont } from '$lib/fontLoad.client';
import { shelfPack } from '$lib/shelfPack';

/** How a text element is drawn — shared by every locale variant of that element. */
export interface RigTextStyle {
	/** Catalog font id (`/api/fonts/catalog`). */
	fontId: string;
	/** Render size in px. */
	fontSize: number;
	/** Fill colour. A bitmap font is TINTED by it (its baked pixels keep their gradient). */
	color: string;
	/** Outline, web/system fonts only — a bitmap font's outline is baked into its glyphs. */
	strokeColor?: string;
	strokeWidth?: number;
	letterSpacing?: number;
}

/** One string to rasterise: which element + locale it belongs to, and what it says. */
export interface RigTextRequest {
	elementId: string;
	locale: string;
	text: string;
	style: RigTextStyle;
	/**
	 * True for the element's SOURCE locale. It is the one the author sized against the art, so
	 * its rasterised width becomes the budget every other locale of that element is fitted to
	 * (see {@link fitTilesToSource}).
	 */
	isSource?: boolean;
}

/** Where a rasterised string landed on the packed page. */
export interface RigTextRect {
	elementId: string;
	locale: string;
	x: number;
	y: number;
	w: number;
	h: number;
	/**
	 * The size this tile was ACTUALLY rasterised at — the element's size, or a smaller one when
	 * the fit pass had to shrink this locale. Persisted so the drift check can tell "never been
	 * fitted" from "fitted as far as it goes": without that distinction, a translation too long
	 * to ever fit would re-bake on every single rig open, forever.
	 */
	fontSize: number;
}

export interface RigTextPage {
	blob: Blob;
	/** Content-addressed filename (`rigtext-<sha256 prefix>.png`) — see the endpoint's guard. */
	file: string;
	width: number;
	height: number;
	rects: RigTextRect[];
}

/** Gap + border on the packed page, in px. Matches the Font Maker's glyph page. */
const PAGE_GAP = 2;
const PAGE_MAX = 2048;

/**
 * How far outside a string's REPORTED bounds we rasterise before measuring the ink, and the
 * ceiling that search stops at. A font whose glyph art overhangs its metrics needs room to draw
 * into or the extract clips it; the tile is cut back afterwards, so the padding costs nothing on
 * the packed page.
 */
const OVERHANG_PAD_MIN = 8;
const OVERHANG_PAD_MAX = 512;

let appPromise: Promise<Application> | null = null;

/**
 * The one offscreen PIXI renderer this module rasterises through. WebGL by preference, never
 * WebGPU: the launcher only needs `extract`, and WebGPU has already produced a context that
 * initialises but paints nothing on some devices ([[gotcha_webgpu_blank_canvas_ios_pixel]]).
 * Kept alive for the page's lifetime — a rig is baked repeatedly while authoring, and each
 * `Application.init` is a fresh GL context (browsers cap those at ~16).
 */
function renderApp(): Promise<Application> {
	if (appPromise) return appPromise;
	appPromise = (async () => {
		const app = new Application();
		await app.init({
			width: 16,
			height: 16,
			backgroundAlpha: 0,
			antialias: true,
			preference: 'webgl',
			autoStart: false,
		});
		return app;
	})();
	return appPromise;
}

const fontCache = new Map<string, CatalogFont>();

/** Register the catalog so a request can name a font by id alone. */
export function setFontCatalog(fonts: CatalogFont[]): void {
	fontCache.clear();
	for (const f of fonts) fontCache.set(f.id, f);
}

export function catalogFont(fontId: string): CatalogFont | null {
	return fontCache.get(fontId) ?? null;
}

/**
 * Build the PIXI display object for one string. Bitmap fonts resolve by their CATALOG ID (not
 * the BMFont face) — `loadCatalogBitmapFont` registers them that way precisely so two catalog
 * entries sharing a face still resolve to the right one.
 *
 * Returns `null` when the font could not be loaded, so the caller reports "this font failed"
 * rather than silently baking a system fallback into permanent art.
 */
async function buildTextObject(req: RigTextRequest): Promise<Container | null> {
	const font = fontCache.get(req.style.fontId);
	if (!font) return null;
	const { fontSize, color, strokeColor, strokeWidth, letterSpacing } = req.style;

	if (font.kind === 'bitmap') {
		const family = await loadCatalogBitmapFont(font);
		if (!family) return null;
		const obj = new BitmapText({
			text: req.text,
			style: { fontFamily: family, fontSize, letterSpacing: letterSpacing ?? 0 },
		});
		// A bitmap font's glyphs are already coloured art; `tint` MULTIPLIES, so white leaves
		// them exactly as baked (the identity) and any other colour recolours them.
		obj.tint = color || '#ffffff';
		return obj;
	}

	const family = await ensureWebFont(font);
	if (!family) return null;
	return new Text({
		text: req.text,
		style: {
			fontFamily: family,
			fontSize,
			fill: color || '#ffffff',
			letterSpacing: letterSpacing ?? 0,
			...(strokeColor && (strokeWidth ?? 0) > 0
				? { stroke: { color: strokeColor, width: strokeWidth as number, join: 'round' as const } }
				: {}),
		},
	});
}

/**
 * Rasterise ONE string to its own canvas — used for the live preview and as the per-variant
 * tile the packer places.
 *
 * PIXI's reported bounds are METRICS, not ink: `BitmapText` measures a line as the sum of the
 * glyphs' `xAdvance` by the font's `lineHeight`, so any glyph whose baked art overhangs its
 * advance or its line box — a descender in a font with a lying descriptor, a swash, a baked
 * shadow or outline — is drawn OUTSIDE the box `extract` frames and comes back cut. That cut is
 * permanent, because rig text is baked ART.
 *
 * So the string is rasterised into a PADDED frame, the ink that actually landed is measured, and
 * the pad grows until no ink touches an edge. The tile is then cut back to the metric box GROWN
 * SYMMETRICALLY by the largest overhang. Symmetry is the point: a region attachment is placed by
 * its CENTRE, so an even margin keeps every variant's centre exactly where the metric box put it
 * — a locale whose string overhangs and one whose string does not still line up. A font that
 * never overhangs yields the metric box unchanged.
 */
export async function rasterizeString(req: RigTextRequest): Promise<HTMLCanvasElement | null> {
	if (!req.text) return null;
	const obj = await buildTextObject(req);
	if (!obj) return null;
	try {
		const app = await renderApp();
		const bounds = obj.getLocalBounds();
		if (!(bounds.width > 0) || !(bounds.height > 0)) return null;
		// Snapshotted: `Bounds` is a live object PIXI reuses, and the loop below re-renders.
		const boxX = bounds.x;
		const boxY = bounds.y;
		const boxW = Math.ceil(bounds.width);
		const boxH = Math.ceil(bounds.height);
		let pad = Math.max(
			OVERHANG_PAD_MIN,
			Math.ceil(req.style.fontSize / 2) + 2 * Math.ceil(req.style.strokeWidth ?? 0),
		);
		for (;;) {
			// The frame is what `extract` renders; without it the frame IS the metric box, which is
			// exactly the box the overhang falls outside of.
			const frame = new Rectangle(boxX - pad, boxY - pad, boxW + pad * 2, boxH + pad * 2);
			const extracted = app.renderer.extract.canvas({ target: obj, frame }) as HTMLCanvasElement;
			// `extract.canvas` may hand back an OffscreenCanvas; normalise to a plain canvas so the
			// page compositor (and the preview DOM) can treat every tile identically.
			if (typeof extracted.getContext !== 'function') return null;
			const ink = inkBounds(extracted);
			if (!ink) return null; // the string drew nothing at all
			const grow = Math.max(
				0,
				pad - ink.minX,
				ink.maxX + 1 - (pad + boxW),
				pad - ink.minY,
				ink.maxY + 1 - (pad + boxH),
			);
			// Ink reaching the frame's own edge means the pad clipped something — widen and re-render.
			if (grow >= pad && pad < OVERHANG_PAD_MAX) {
				pad = Math.min(OVERHANG_PAD_MAX, pad * 2);
				continue;
			}
			return cropCanvas(extracted, pad - grow, pad - grow, boxW + grow * 2, boxH + grow * 2);
		}
	} finally {
		obj.destroy();
	}
}

/** The bounding box of every non-transparent pixel, or null when nothing was drawn. */
function inkBounds(
	canvas: HTMLCanvasElement,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) return null;
	const { width, height } = canvas;
	const { data } = ctx.getImageData(0, 0, width, height);
	let minX = width;
	let minY = height;
	let maxX = -1;
	let maxY = -1;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			// Any alpha at all counts — an antialiased edge is part of the glyph, not slack.
			if (data[(y * width + x) * 4 + 3] === 0) continue;
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
		}
	}
	return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

function cropCanvas(
	src: HTMLCanvasElement,
	x: number,
	y: number,
	w: number,
	h: number,
): HTMLCanvasElement | null {
	if (x === 0 && y === 0 && w === src.width && h === src.height) return src;
	const out = document.createElement('canvas');
	out.width = Math.max(1, w);
	out.height = Math.max(1, h);
	const ctx = out.getContext('2d');
	if (!ctx) return null;
	ctx.drawImage(src, x, y, w, h, 0, 0, w, h);
	return out;
}

export interface RigTextBakeResult {
	page: RigTextPage | null;
	/** Requests that produced no pixels (missing font, empty string) — surfaced, never silent. */
	failed: { elementId: string; locale: string; reason: string }[];
	/**
	 * Locales that DID bake but could not be brought inside the source locale's width even at
	 * the minimum size. Kept apart from `failed`, which means "no pixels": these ship, they just
	 * ship too wide, and telling the author that is the difference between a fit rule and a
	 * silent cap.
	 */
	warnings: { elementId: string; locale: string; reason: string }[];
}

/** Never shrink a translation below this — past it the text is unreadable and silently hiding
 *  the real problem, which is that the art is too small for the language. */
const MIN_FIT_FONT_SIZE = 8;
/** Refinement passes. Bitmap glyph advances scale near-linearly with size but not exactly, and
 *  a web font's hinting makes it less so, so one ratio is a good guess and not a guarantee. */
const FIT_PASSES = 3;

/**
 * Shrink every non-source locale of an element until it is no WIDER than that element's source
 * locale, by re-rasterising it at a smaller font size.
 *
 * Why it has to happen here, at bake time, rather than as a scale on the attachment: §12.4a's
 * promise is that all locales share ONE placement — the source locale carries the authored
 * x/y/scale and every other locale inherits it, which is what makes swapping language never
 * move the text, and what lets a mesh authored once drive them all as linked meshes. Per-locale
 * attachment scaling would break that symmetry, and would be silently discarded the moment the
 * author converted the element to a mesh.
 *
 * The source locale is the budget because it is the one the author sized against the art: they
 * made "Buy Feature" fit the button, so "Acheter fonctionnalité" — 1.7× wider at the same size
 * — must come back to that width rather than run off the end of it.
 *
 * Shrinking is UNIFORM (font size, not an x-scale): squeezing the x-axis to fit distorts
 * letterforms, and a distorted translation looks like a bug where a smaller one looks intended.
 * Height therefore comes down with width, which is correct — the budget is the art, and the art
 * is not taller for a longer string.
 */
async function fitTilesToSource(
	tiles: { req: RigTextRequest; canvas: HTMLCanvasElement; fontSize: number }[],
): Promise<RigTextBakeResult['warnings']> {
	const warnings: RigTextBakeResult['warnings'] = [];
	const budgets = new Map<string, number>();
	for (const t of tiles) if (t.req.isSource) budgets.set(t.req.elementId, t.canvas.width);

	for (const t of tiles) {
		const budget = budgets.get(t.req.elementId);
		// No source tile (it failed to rasterise) means no budget to fit to — leaving the locale
		// at full size is the honest outcome; inventing a budget would silently resize it against
		// nothing.
		if (t.req.isSource || budget === undefined || t.canvas.width <= budget) continue;

		let size = t.req.style.fontSize;
		for (let pass = 0; pass < FIT_PASSES && t.canvas.width > budget; pass++) {
			const next = Math.max(MIN_FIT_FONT_SIZE, Math.floor(size * (budget / t.canvas.width)));
			if (next >= size) break; // already at the floor, or the ratio rounded to a no-op
			size = next;
			let refit: HTMLCanvasElement | null = null;
			try {
				refit = await rasterizeString({ ...t.req, style: { ...t.req.style, fontSize: size } });
			} catch {
				refit = null;
			}
			// A re-raster that fails leaves the previous, too-wide tile in place rather than
			// dropping the locale: overflowing art beats no art, and the locale still ships.
			if (!refit) break;
			t.canvas = refit;
			t.fontSize = size;
		}
		if (t.canvas.width > budget) {
			warnings.push({
				elementId: t.req.elementId,
				locale: t.req.locale,
				reason:
					`still ${t.canvas.width}px wide against the source locale's ${budget}px, even at ` +
					`${size}px — shorten the translation or give the element more room`,
			});
		}
	}
	return warnings;
}

/**
 * Rasterise every request and pack them onto ONE page. A rig's text is a handful of short
 * strings, so a single 2048² page is generous; the shared packer errors clearly if it isn't.
 *
 * The page filename is CONTENT-ADDRESSED (sha-256 of the PNG bytes). That is what makes the
 * save safe under a lost conditional write: a losing author's pixels sit under a name no
 * surviving document references, and the endpoint's sweep removes them.
 */
export async function bakeRigTextPage(requests: RigTextRequest[]): Promise<RigTextBakeResult> {
	const failed: RigTextBakeResult['failed'] = [];
	const tiles: { req: RigTextRequest; canvas: HTMLCanvasElement; fontSize: number }[] = [];
	for (const req of requests) {
		let canvas: HTMLCanvasElement | null = null;
		try {
			canvas = await rasterizeString(req);
		} catch (e) {
			failed.push({
				elementId: req.elementId,
				locale: req.locale,
				reason: e instanceof Error ? e.message : String(e),
			});
			continue;
		}
		if (!canvas) {
			failed.push({
				elementId: req.elementId,
				locale: req.locale,
				reason: req.text ? 'the font could not be loaded' : 'the string is empty',
			});
			continue;
		}
		tiles.push({ req, canvas, fontSize: req.style.fontSize });
	}
	if (!tiles.length) return { page: null, failed, warnings: [] };

	const warnings = await fitTilesToSource(tiles);

	const packed = shelfPack(
		tiles.map((t) => ({ width: t.canvas.width, height: t.canvas.height })),
		{
			maxWidth: PAGE_MAX,
			maxHeight: PAGE_MAX,
			gap: PAGE_GAP,
			maxPages: 1,
			tooTallMessage: `A rasterised string is taller than ${PAGE_MAX}px — reduce the text size.`,
			tooManyPagesMessage: () =>
				`This rig’s text does not fit on one ${PAGE_MAX}×${PAGE_MAX} page — reduce the text ` +
				'size, or split it across two rigs.',
		},
	);

	const pageCanvas = document.createElement('canvas');
	pageCanvas.width = packed.width;
	pageCanvas.height = packed.height;
	const ctx = pageCanvas.getContext('2d');
	if (!ctx) throw new Error('Could not acquire a 2D page context.');

	const rects: RigTextRect[] = [];
	tiles.forEach((t, i) => {
		const p = packed.placements[i];
		ctx.drawImage(t.canvas, p.x, p.y);
		rects.push({
			elementId: t.req.elementId,
			locale: t.req.locale,
			x: p.x,
			y: p.y,
			w: t.canvas.width,
			h: t.canvas.height,
			fontSize: t.fontSize,
		});
	});

	const blob = await canvasToPng(pageCanvas);
	const file = `rigtext-${await sha256Hex(blob, 16)}.png`;
	return {
		page: { blob, file, width: packed.width, height: packed.height, rects },
		failed,
		warnings,
	};
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) resolve(blob);
			else reject(new Error('Failed to encode the text page PNG.'));
		}, 'image/png');
	});
}

async function sha256Hex(blob: Blob, chars: number): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')
		.slice(0, chars);
}
