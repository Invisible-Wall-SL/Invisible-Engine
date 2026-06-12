/**
 * Font Maker client-side font catalog + PIXI/CSS font loading for the View preview.
 * Mirrors `editor/fonts.client.ts`, but reads from the Font Maker's self-contained
 * `/api/fonts/catalog` (so the tool does NOT depend on the editor grant). The
 * catalog already routes every file through `/api/fonts/asset`; bitmap descriptors
 * load through PIXI's `Assets.load` (page refs rewritten to absolute gated URLs by
 * `/api/fonts/asset?…&font=1`), web fonts through the browser `FontFace` API. Both
 * are idempotent + cached per id, defensive on failure.
 */
import { Assets, BitmapFont, Cache, Texture } from 'pixi.js';
import type { FontDescriptorFormat, FontKind } from 'engine-layout';

/** One resolved font from `/api/fonts/catalog` — font-maker-gated stream URLs. */
export interface CatalogFont {
	id: string;
	name: string;
	kind: FontKind;
	descriptorUrl?: string;
	descriptorFormat?: FontDescriptorFormat;
	pages?: { file: string; url: string }[];
	files?: { url: string; format: string; weight?: string; style?: string }[];
}

/** Fetch the active project's font catalog. Empty list on any failure. */
export async function fetchFontCatalog(): Promise<CatalogFont[]> {
	try {
		const res = await fetch('/api/fonts/catalog');
		if (!res.ok) return [];
		const body = (await res.json()) as { fonts?: CatalogFont[] };
		return body.fonts ?? [];
	} catch {
		return [];
	}
}

/** One file to upload as part of a bitmap-font save (descriptor or page image). */
export interface SaveFile {
	/** Filename — must match a `<page file>` ref for pages, or the descriptor name. */
	name: string;
	blob: Blob;
	contentType: string;
}

/**
 * Run the Phase-2 save sequence shared by Import + Generate: mint presigned PUT URLs
 * (`POST /api/fonts/upload-urls`), PUT each file straight to R2 with its content-type,
 * then `POST /api/fonts/save` (AUTHORITATIVE — re-reads the descriptor + upserts the
 * catalog). The descriptor MUST be one of `files`; `descriptorFile` names it. Throws
 * on any failure; resolves to the committed entry's `{ id, name }`.
 */
export async function saveBitmapFont(args: {
	folder: string;
	descriptorFile: string;
	descriptorFormat: FontDescriptorFormat;
	files: SaveFile[];
}): Promise<{ id: string; name: string }> {
	const { folder, descriptorFile, descriptorFormat, files } = args;
	const byName = new Map(files.map((f) => [f.name, f]));

	const urlsRes = await fetch('/api/fonts/upload-urls', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			folder,
			files: files.map((f) => ({ name: f.name, contentType: f.contentType })),
		}),
	});
	if (!urlsRes.ok) throw new Error(await errText(urlsRes, 'Failed to mint upload URLs.'));
	const { uploads } = (await urlsRes.json()) as {
		uploads: { name: string; url: string; contentType: string }[];
	};

	for (const up of uploads) {
		const file = byName.get(up.name);
		if (!file) throw new Error(`Internal: no local file for "${up.name}".`);
		const put = await fetch(up.url, {
			method: 'PUT',
			headers: { 'content-type': up.contentType },
			body: file.blob,
		});
		if (!put.ok) throw new Error(`Upload of "${up.name}" failed (${put.status}).`);
	}

	const saveRes = await fetch('/api/fonts/save', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ folder, descriptorFile, descriptorFormat }),
	});
	if (!saveRes.ok) throw new Error(await errText(saveRes, 'Save failed.'));
	const { font } = (await saveRes.json()) as { font: { name: string; id: string } };
	return { id: font.id, name: font.name };
}

/** Read a JSON error `message` off a failed response, falling back to a default. */
async function errText(res: Response, fallback: string): Promise<string> {
	try {
		const body = (await res.json()) as { message?: string };
		return body.message ?? fallback;
	} catch {
		return `${fallback} (${res.status})`;
	}
}

/** Result of parsing a BMFont descriptor client-side (mirrors the server parse). */
export interface ParsedDescriptor {
	face: string;
	pageFiles: string[];
	/** Glyph count, for the import summary (0 when not derivable). */
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

/** One previewed local bitmap font registered in PIXI's Cache; teardown removes it. */
export interface LocalBitmapFont {
	family: string;
	dispose(): void;
}

/**
 * Build an in-memory `BitmapFont` from a descriptor's text + the user-supplied page
 * IMAGES (as object URLs) and register it in PIXI's `Cache` under `${family}-bitmap`
 * — exactly the key `BitmapText({ fontFamily })` resolves. This drives the import
 * LIVE preview BEFORE anything is saved, WITHOUT routing through the server
 * `?font=1` path or `Assets.load`-ing a blob descriptor (PIXI's `loadBitmapFont`
 * resolves page refs against the descriptor's dirname, which a `blob:` src mangles).
 *
 * We parse the descriptor to a pixi `BitmapFontData`, load each declared page image
 * straight from its object URL into a `Texture`, then construct the public
 * `BitmapFont`. `dispose()` removes the cache entry + frees the font. Throws on
 * failure (e.g. a missing page) so the caller can fall back to thumbnails.
 */
export async function loadLocalBitmapFont(args: {
	family: string;
	descriptorText: string;
	descriptorFormat: FontDescriptorFormat;
	/** Declared page filename → object URL of the user-supplied image. */
	pageUrls: Record<string, string>;
}): Promise<LocalBitmapFont> {
	const { family, descriptorText, descriptorFormat, pageUrls } = args;
	const data = buildBitmapFontData(descriptorText, descriptorFormat, family);

	const textures: Texture[] = [];
	for (const page of data.pages) {
		const url = pageUrls[page.file];
		if (!url) throw new Error(`Missing page image for "${page.file}".`);
		const texture = (await Assets.load(url)) as Texture;
		textures.push(texture);
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
			for (const url of Object.values(pageUrls)) {
				try {
					void Assets.unload(url);
				} catch {
					/* not tracked */
				}
			}
		},
	};
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

	const chars: Record<string, RawCharData> = {};
	for (const c of blocks('char')) {
		if (c.id === undefined) continue;
		const id = num(c.id);
		chars[id] = {
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
			letter: c.letter ?? String.fromCodePoint(id),
		};
	}
	for (const k of blocks('kerning')) {
		const first = chars[num(k.first)];
		if (first) first.kerning[String(num(k.second))] = num(k.amount);
	}

	const fontSize = num(info.size, 16) || 16;
	return {
		fontFamily: info.face?.trim() || family,
		fontSize,
		lineHeight: num(common.lineHeight, fontSize) || fontSize,
		baseLineOffset: num(common.base),
		pages,
		chars,
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
		chars[id] = {
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
			letter: typeof c.char === 'string' ? c.char : String.fromCodePoint(id || 32),
		};
	}

	const fontSize = num(String(info.size), 16) || 16;
	return {
		fontFamily: typeof info.face === 'string' ? info.face.trim() : family,
		fontSize,
		lineHeight: num(String(common.lineHeight), fontSize) || fontSize,
		baseLineOffset: num(String(common.base)),
		pages,
		chars,
	};
}

/** Append `font=1` so the asset endpoint rewrites the descriptor's page refs to
 * absolute gated URLs (PIXI otherwise resolves them against the descriptor request
 * URL and 404s). Robust to an existing query string. */
function descriptorLoadUrl(url: string): string {
	return url.includes('?') ? `${url}&font=1` : `${url}?font=1`;
}

const bitmapLoads = new Map<string, Promise<string | null>>();

/**
 * Ensure a bitmap font is registered with PIXI under its catalog `name`, so a
 * `BitmapText({ style: { fontFamily: name } })` resolves it. Resolves to the family
 * name on success, `null` on failure. Idempotent per font id.
 */
export function ensureBitmapFont(font: CatalogFont): Promise<string | null> {
	const hit = bitmapLoads.get(font.id);
	if (hit) return hit;
	const p = (async (): Promise<string | null> => {
		if (!font.descriptorUrl) return null;
		try {
			await Assets.load({
				src: descriptorLoadUrl(font.descriptorUrl),
				alias: font.name,
				loadParser: 'loadBitmapFont',
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
 * Ensure a web font's faces are loaded + registered with `document.fonts`, so a
 * PIXI `Text` using `font.name` renders with the real face instead of a system
 * fallback. Resolves to the family name, `null` on failure. Idempotent per font id.
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
