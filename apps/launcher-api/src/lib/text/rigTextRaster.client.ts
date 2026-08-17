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
import { Application, BitmapText, Text, type Container } from 'pixi.js';
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
}

/** Where a rasterised string landed on the packed page. */
export interface RigTextRect {
	elementId: string;
	locale: string;
	x: number;
	y: number;
	w: number;
	h: number;
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
 * tile the packer places. The object is positioned by its LOCAL BOUNDS, not by `width/height`
 * at a fixed origin: text routinely draws above the baseline or past the nominal size, and
 * sizing from `width/height` clips that overhang (the same trap `fitCanvasToObject` solves for
 * the Font Maker preview).
 */
export async function rasterizeString(req: RigTextRequest): Promise<HTMLCanvasElement | null> {
	if (!req.text) return null;
	const obj = await buildTextObject(req);
	if (!obj) return null;
	try {
		const app = await renderApp();
		const bounds = obj.getLocalBounds();
		if (!(bounds.width > 0) || !(bounds.height > 0)) return null;
		obj.position.set(-bounds.x, -bounds.y);
		const extracted = app.renderer.extract.canvas(obj) as HTMLCanvasElement;
		// `extract.canvas` may hand back an OffscreenCanvas; normalise to a plain canvas so the
		// page compositor (and the preview DOM) can treat every tile identically.
		if (typeof (extracted as unknown as HTMLCanvasElement).getContext !== 'function') return null;
		return extracted;
	} finally {
		obj.destroy();
	}
}

export interface RigTextBakeResult {
	page: RigTextPage | null;
	/** Requests that produced no pixels (missing font, empty string) — surfaced, never silent. */
	failed: { elementId: string; locale: string; reason: string }[];
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
	const tiles: { req: RigTextRequest; canvas: HTMLCanvasElement }[] = [];
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
		tiles.push({ req, canvas });
	}
	if (!tiles.length) return { page: null, failed };

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
		});
	});

	const blob = await canvasToPng(pageCanvas);
	const file = `rigtext-${await sha256Hex(blob, 16)}.png`;
	return {
		page: { blob, file, width: packed.width, height: packed.height, rects },
		failed,
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
