/**
 * Shared client-side font loading for every launcher tool that previews real game
 * fonts (the Scene Editor's text overlay + the Font Maker's View/Import/Generate).
 * Extracted so the BMFont descriptor parse + the PIXI `BitmapFont` build + the page
 * loading + the web-`FontFace` registration live in ONE place — fix a font-loading
 * bug here and every tool gets it.
 *
 * Bitmap fonts are built from the raw descriptor text + EXPLICIT page URLs, NOT via
 * `Assets.load(descriptorUrl, { loadParser: 'loadBitmapFont' })`: PIXI resolves a
 * descriptor's `<page file>` refs RELATIVE to the descriptor's request URL, and our
 * gated stream URLs are query-string based (`/api/<tool>/asset?key=…`), so that
 * resolution mangles each page into a doubled `/api/…/api/…asset?…?key=…` path that
 * fails to load. Building from explicit URLs sidesteps the relative resolution.
 * Web fonts load through the browser `FontFace` API. Both are idempotent + cached
 * per id, defensive on failure (a bad font resolves to "not loaded").
 */
import { Application, BitmapFont, Cache, Container, Texture } from 'pixi.js';
import type { FontDescriptorFormat, FontKind } from 'engine-layout';

/**
 * Size a PIXI app's canvas to a display object's TRUE bounds + position the object
 * fully inside it (with `pad`). Bitmap/web text can render above the baseline or
 * taller than the nominal font size, so sizing from `obj.width/height` at a fixed
 * origin clips the overhang — `getLocalBounds()` captures the real extent (whose
 * origin may be negative), so the preview area grows to exactly fit the glyphs.
 */
export function fitCanvasToObject(app: Application, obj: Container, pad = 6): void {
	const b = obj.getLocalBounds();
	const w = Math.max(1, Math.ceil(b.width) + pad * 2);
	const h = Math.max(1, Math.ceil(b.height) + pad * 2);
	app.renderer.resize(w, h);
	obj.position.set(pad - b.x, pad - b.y);
}

/**
 * One resolved font as a tool's catalog endpoint (`/api/editor/fonts` or
 * `/api/fonts/catalog`) returns it — each file already a tool-gated stream URL.
 */
export interface CatalogFont {
	id: string;
	name: string;
	kind: FontKind;
	/** Bitmap: the BMFont descriptor's stream URL + its format. */
	descriptorUrl?: string;
	descriptorFormat?: FontDescriptorFormat;
	/** Bitmap: each page image's declared filename + its stream URL. */
	pages?: { file: string; url: string }[];
	/** Web: each font file's stream URL + `@font-face` format token. */
	files?: { url: string; format: string; weight?: string; style?: string }[];
	/** Bitmap only: the font has an authoring recipe, so the View tab can offer Edit. */
	editable?: boolean;
}

/** Result of parsing a BMFont descriptor client-side (mirrors the server parse). */
export interface ParsedDescriptor {
	face: string;
	pageFiles: string[];
	/** Glyph count, for an import summary (0 when not derivable). */
	glyphCount: number;
}

/** Parse a BMFont descriptor's text → face + page refs + glyph count. */
export function parseDescriptorClient(
	text: string,
	format: FontDescriptorFormat,
): ParsedDescriptor {
	if (format === 'json') return parseJsonDescriptor(text);
	return parseTextDescriptor(text, format);
}

function parseTextDescriptor(text: string, format: FontDescriptorFormat): ParsedDescriptor {
	let face = '';
	const pageFiles: string[] = [];
	let glyphCount = 0;

	if (format === 'xml') {
		// Prefer a real XML parse; fall back to regex if the DOM rejects it.
		try {
			const doc = new DOMParser().parseFromString(text, 'application/xml');
			if (!doc.querySelector('parsererror')) {
				face = doc.querySelector('info')?.getAttribute('face')?.trim() ?? '';
				for (const page of Array.from(doc.querySelectorAll('page'))) {
					const file = page.getAttribute('file')?.trim();
					if (file) pageFiles.push(file);
				}
				glyphCount = doc.querySelectorAll('char').length;
			}
		} catch {
			/* fall through to regex */
		}
	}

	if (!face) face = text.match(/face\s*=\s*"([^"]+)"/)?.[1]?.trim() ?? '';
	if (pageFiles.length === 0) {
		const re = /\bfile\s*=\s*"([^"]+)"/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(text)) !== null) {
			const f = m[1]?.trim();
			if (f) pageFiles.push(f);
		}
	}
	if (glyphCount === 0) glyphCount = (text.match(/<char\b/g) ?? []).length;

	return { face, pageFiles: dedupe(pageFiles), glyphCount };
}

function parseJsonDescriptor(text: string): ParsedDescriptor {
	const data = JSON.parse(text) as Record<string, unknown>;
	const inner = ((data.data ?? data) ?? {}) as Record<string, unknown>;
	const info = (inner.info ?? {}) as Record<string, unknown>;
	const face = typeof info.face === 'string' ? info.face.trim() : '';
	const rawPages = Array.isArray(inner.pages) ? (inner.pages as unknown[]) : [];
	const pageFiles = rawPages
		.filter((p): p is string => typeof p === 'string')
		.map((p) => p.trim());
	const chars = inner.chars;
	let glyphCount = 0;
	if (Array.isArray(chars)) glyphCount = chars.length;
	else if (chars && typeof chars === 'object') glyphCount = Object.keys(chars).length;
	return { face, pageFiles: dedupe(pageFiles), glyphCount };
}

function dedupe(values: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const v of values) {
		if (v && !seen.has(v)) {
			seen.add(v);
			out.push(v);
		}
	}
	return out;
}

/** One previewed bitmap font registered in PIXI's Cache; teardown removes it. */
export interface LocalBitmapFont {
	family: string;
	dispose(): void;
}

/**
 * Build an in-memory `BitmapFont` from a descriptor's text + EXPLICIT page image URLs
 * and register it in PIXI's `Cache` under `${family}-bitmap` — exactly the key
 * `BitmapText({ fontFamily })` resolves. Used by the import LIVE preview (object-URL
 * pages, before anything is saved) AND `loadCatalogBitmapFont` (gated stream-URL
 * pages). Avoids `Assets.load`-ing the descriptor (whose relative page resolution
 * mangles both `blob:` and query-string URLs).
 *
 * `dispose()` removes the cache entry + frees the font (and unloads the page URLs).
 * Throws on failure (e.g. a missing page) so the caller can fall back.
 */
export async function loadLocalBitmapFont(args: {
	family: string;
	descriptorText: string;
	descriptorFormat: FontDescriptorFormat;
	/** Declared page filename → URL of its image (object URL or gated stream URL). */
	pageUrls: Record<string, string>;
}): Promise<LocalBitmapFont> {
	const { family, descriptorText, descriptorFormat, pageUrls } = args;
	const data = buildBitmapFontData(descriptorText, descriptorFormat, family);

	// Load each page image by FETCHING its bytes + decoding to an `ImageBitmap`, then
	// build a `Texture` from it. We must NOT `Assets.load(url)` here: PIXI picks an
	// asset parser by the URL's file EXTENSION, but our gated page URLs are
	// query-string based with none (`/api/<tool>/asset?key=…webp`) — and the import
	// preview's `blob:` object URLs have none either — so detection fails ("we don't
	// know how to parse it") and the page texture comes back null. Decoding the bytes
	// ourselves works regardless of how the URL is shaped.
	const textures: Texture[] = [];
	for (const page of data.pages) {
		const url = pageUrls[page.file];
		if (!url) throw new Error(`Missing page image for "${page.file}".`);
		const res = await fetch(url);
		if (!res.ok) throw new Error(`page image "${page.file}" failed (${res.status}).`);
		const bitmap = await createImageBitmap(await res.blob());
		textures.push(Texture.from(bitmap));
	}

	const font = new BitmapFont({ data, textures });
	const cacheKey = `${family}-bitmap`;
	if (Cache.has(cacheKey)) Cache.remove(cacheKey);
	Cache.set(cacheKey, font);

	let disposed = false;
	return {
		family,
		dispose() {
			if (disposed) return;
			disposed = true;
			if (Cache.get(cacheKey) === font) Cache.remove(cacheKey);
			try {
				font.destroy();
			} catch {
				/* font already torn down */
			}
			// We built these textures ourselves (not via Assets), so free them directly.
			for (const t of textures) {
				try {
					t.destroy(true);
				} catch {
					/* already torn down */
				}
			}
		},
	};
}

const bitmapLoads = new Map<string, Promise<string | null>>();

/**
 * Ensure a CATALOG bitmap font is registered with PIXI under its catalog `name`, so a
 * `BitmapText({ style: { fontFamily: name } })` resolves it. Fetches the raw
 * descriptor text and maps each declared page to the catalog's gated page URL, then
 * builds the font via `loadLocalBitmapFont` (no descriptor-relative page resolution —
 * see the module header). Resolves to the family name on success, `null` on failure.
 * Idempotent per font id (shared across tools — a font loaded once stays in the global
 * PIXI cache).
 */
export function loadCatalogBitmapFont(font: CatalogFont): Promise<string | null> {
	const hit = bitmapLoads.get(font.id);
	if (hit) return hit;
	const p = (async (): Promise<string | null> => {
		if (!font.descriptorUrl) return null;
		try {
			const res = await fetch(font.descriptorUrl);
			if (!res.ok) throw new Error(`descriptor request failed (${res.status})`);
			const descriptorText = await res.text();
			const pageUrls: Record<string, string> = {};
			for (const page of font.pages ?? []) pageUrls[page.file] = page.url;
			await loadLocalBitmapFont({
				family: font.name,
				descriptorText,
				descriptorFormat: font.descriptorFormat ?? 'xml',
				pageUrls,
			});
			return font.name;
		} catch (e) {
			console.warn('[fonts] bitmap font load failed', font.name, e);
			return null;
		}
	})();
	bitmapLoads.set(font.id, p);
	return p;
}

const webLoads = new Map<string, Promise<string | null>>();

/**
 * Ensure a web font's faces are loaded + registered with `document.fonts`, so a PIXI
 * `Text` (or a 2D-canvas `fillText`) using `font.name` renders with the real face
 * instead of a system fallback. Resolves to the family name, `null` on failure.
 * Idempotent per font id.
 */
export function ensureWebFont(font: CatalogFont): Promise<string | null> {
	const hit = webLoads.get(font.id);
	if (hit) return hit;
	const p = (async (): Promise<string | null> => {
		const files = font.files ?? [];
		if (files.length === 0) return null;
		try {
			await Promise.all(
				files.map(async (wf) => {
					const face = new FontFace(font.name, `url(${wf.url})`, {
						weight: wf.weight ?? 'normal',
						style: wf.style ?? 'normal',
					});
					await face.load();
					document.fonts.add(face);
				}),
			);
			return font.name;
		} catch (e) {
			console.warn('[fonts] web font load failed', font.name, e);
			return null;
		}
	})();
	webLoads.set(font.id, p);
	return p;
}

/** Parse a BMFont descriptor into a pixi `BitmapFontData` (no `Texture`s yet). */
function buildBitmapFontData(
	text: string,
	format: FontDescriptorFormat,
	family: string,
): BitmapFontData {
	if (format === 'json') return buildFromJson(text, family);
	return buildFromXmlOrFnt(text, format, family);
}

interface BitmapFontData {
	baseLineOffset: number;
	chars: Record<string, RawCharData>;
	pages: { id: number; file: string }[];
	lineHeight: number;
	fontSize: number;
	fontFamily: string;
	distanceField?: { type: 'sdf' | 'msdf' | 'none'; range: number };
}
interface RawCharData {
	id: number;
	page: number;
	x: number;
	y: number;
	width: number;
	height: number;
	xOffset: number;
	yOffset: number;
	xAdvance: number;
	kerning: Record<string, number>;
	letter: string;
}

function num(v: string | null | undefined, fallback = 0): number {
	const n = Number(v);
	return Number.isFinite(n) ? n : fallback;
}

function buildFromXmlOrFnt(
	text: string,
	format: FontDescriptorFormat,
	family: string,
): BitmapFontData {
	// Both XML and the `.fnt` text grammar are `key="value"` (or `key=value`) pairs
	// on `info`/`common`/`page`/`char`/`kerning` lines; a tolerant attr scanner reads
	// either. (We could DOMParser the xml, but one scanner covers both dialects.)
	const attrs = (block: string): Record<string, string> => {
		const out: Record<string, string> = {};
		// Accept double-quoted, single-quoted (some exporters), and bare values.
		const re = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(-?[\w.]+))/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(block)) !== null) out[m[1]] = m[2] ?? m[3] ?? m[4] ?? '';
		return out;
	};
	// Anchor the tag to the START of a line (after optional `<` + whitespace) so e.g.
	// the `page="0"` attribute INSIDE a `<char …>` line never matches the `page` tag.
	// This also naturally skips the plural `<chars>` / `<pages>` wrapper lines (they
	// carry only `count`, which the per-block guards ignore).
	const blocks = (tag: string): Record<string, string>[] => {
		const out: Record<string, string>[] = [];
		const re = new RegExp(`^\\s*<?${tag}\\b([^>\\n]*)`, 'gm');
		let m: RegExpExecArray | null;
		while ((m = re.exec(text)) !== null) out.push(attrs(m[1]));
		return out;
	};

	const info = blocks('info')[0] ?? {};
	const common = blocks('common')[0] ?? {};
	const pages = blocks('page')
		.filter((p) => p.file)
		.map((p) => ({ id: num(p.id), file: p.file }));

	// Key chars by the LETTER — exactly like PIXI's `bitmapFontTextParser`. The
	// `BitmapFont` ctor derives `id = key.codePointAt(0)` from the key, and the layout
	// looks up `font.chars[char] || font.chars[' ']`, so a numeric key makes EVERY
	// lookup (incl. the space fallback) miss → `undefined.kerning`. Real BMFonts often
	// have no `letter` attr (just a numeric `id`), so derive it from the code (NaN-safe
	// `fromCharCode`, matching PIXI). Kerning lives on the SECOND char keyed by the
	// FIRST char's letter (layout reads `charData.kerning[previousChar]`).
	const chars: Record<string, RawCharData> = {};
	const idToLetter = new Map<number, string>();
	for (const c of blocks('char')) {
		if (c.id === undefined) continue;
		const id = parseInt(c.id, 10);
		let letter = c.letter ?? c.char ?? '';
		if (!letter) letter = String.fromCharCode(id);
		if (letter === 'space') letter = ' ';
		idToLetter.set(id, letter);
		chars[letter] = {
			id,
			page: num(c.page),
			x: num(c.x),
			y: num(c.y),
			width: num(c.width),
			height: num(c.height),
			xOffset: num(c.xoffset),
			yOffset: num(c.yoffset),
			xAdvance: num(c.xadvance),
			kerning: {},
			letter,
		};
	}
	for (const k of blocks('kerning')) {
		const second = idToLetter.get(parseInt(k.second, 10));
		const first = idToLetter.get(parseInt(k.first, 10));
		if (second !== undefined && first !== undefined && chars[second]) {
			chars[second].kerning[first] = num(k.amount);
		}
	}

	const fontSize = num(info.size, 16) || 16;
	const lineHeight = num(common.lineHeight, fontSize) || fontSize;
	ensureSpaceChar(chars, fontSize);
	return {
		fontFamily: info.face?.trim() || family,
		fontSize,
		lineHeight,
		// PIXI: `baseLineOffset = lineHeight - base` (NOT `base`).
		baseLineOffset: lineHeight - num(common.base),
		pages,
		chars,
	};
}

/**
 * PIXI's bitmap layout dereferences `font.chars[' ']` for every missing glyph AND for
 * its end-of-string sentinel (`getBitmapTextLayout`), so a font lacking a space char
 * crashes the renderer (`undefined.kerning`). Synthesize a zero-size space if absent.
 */
function ensureSpaceChar(chars: Record<string, RawCharData>, fontSize: number): void {
	if (chars[' ']) return;
	chars[' '] = {
		id: 32,
		page: 0,
		x: 0,
		y: 0,
		width: 0,
		height: 0,
		xOffset: 0,
		yOffset: 0,
		xAdvance: Math.round(fontSize / 4),
		kerning: {},
		letter: ' ',
	};
}

function buildFromJson(text: string, family: string): BitmapFontData {
	const data = JSON.parse(text) as Record<string, unknown>;
	const inner = ((data.data ?? data) ?? {}) as Record<string, unknown>;
	const info = (inner.info ?? {}) as Record<string, unknown>;
	const common = (inner.common ?? {}) as Record<string, unknown>;
	const pagesArr = Array.isArray(inner.pages) ? (inner.pages as unknown[]) : [];
	const pages = pagesArr
		.filter((p): p is string => typeof p === 'string')
		.map((file, id) => ({ id, file }));

	const chars: Record<string, RawCharData> = {};
	const rawChars = inner.chars;
	const charList: Record<string, unknown>[] = Array.isArray(rawChars)
		? (rawChars as Record<string, unknown>[])
		: rawChars && typeof rawChars === 'object'
			? Object.values(rawChars as Record<string, unknown>).filter(
					(c): c is Record<string, unknown> => !!c && typeof c === 'object',
				)
			: [];
	for (const c of charList) {
		const id = num(String(c.id ?? c.charCode));
		let letter = typeof c.char === 'string' && c.char.length ? c.char : String.fromCharCode(id);
		if (letter === 'space') letter = ' ';
		chars[letter] = {
			id,
			page: num(String(c.page ?? 0)),
			x: num(String(c.x)),
			y: num(String(c.y)),
			width: num(String(c.width)),
			height: num(String(c.height)),
			xOffset: num(String(c.xoffset ?? c.xOffset)),
			yOffset: num(String(c.yoffset ?? c.yOffset)),
			xAdvance: num(String(c.xadvance ?? c.xAdvance)),
			kerning: {},
			letter,
		};
	}

	const fontSize = num(String(info.size), 16) || 16;
	const lineHeight = num(String(common.lineHeight), fontSize) || fontSize;
	ensureSpaceChar(chars, fontSize);
	return {
		fontFamily: typeof info.face === 'string' ? info.face.trim() : family,
		fontSize,
		lineHeight,
		baseLineOffset: lineHeight - num(String(common.base)),
		pages,
		chars,
	};
}
