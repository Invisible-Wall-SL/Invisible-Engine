/**
 * Editor-side font catalog resolution + PIXI/CSS font loading for the text overlay.
 * Mirrors the `/api/editor/fonts` response shape (kept in sync with the server's
 * `EditorFont` in `$lib/server/fonts`). Bitmap fonts load through PIXI's
 * `Assets.load` (the descriptor's relative page references are rewritten to
 * absolute editor-gated URLs by `/api/editor/asset?font=1`); web fonts load through
 * the browser `FontFace` API. Both are idempotent + cached per id, defensive on
 * failure (a bad font resolves to "not loaded" so the overlay just skips it).
 */
import { Assets } from 'pixi.js';
import type { FontDescriptorFormat, FontKind } from 'engine-layout';

/** One resolved font from `/api/editor/fonts` — editor-gated stream URLs. */
export interface EditorFont {
	id: string;
	name: string;
	kind: FontKind;
	descriptorUrl?: string;
	descriptorFormat?: FontDescriptorFormat;
	pages?: { file: string; url: string }[];
	files?: { url: string; format: string; weight?: string; style?: string }[];
}

/** The font catalog as the overlay consumes it: a list + a by-name index. */
export interface FontCatalogResult {
	fonts: EditorFont[];
	byName: Map<string, EditorFont>;
}

let catalogPromise: Promise<FontCatalogResult> | null = null;

/** Fetch (once per session) the active project's font catalog. Empty on failure. */
export function fetchFontCatalog(): Promise<FontCatalogResult> {
	if (catalogPromise) return catalogPromise;
	catalogPromise = (async (): Promise<FontCatalogResult> => {
		try {
			const res = await fetch('/api/editor/fonts');
			if (!res.ok) return { fonts: [], byName: new Map() };
			const body = (await res.json()) as { fonts?: EditorFont[] };
			const fonts = body.fonts ?? [];
			const byName = new Map<string, EditorFont>();
			for (const f of fonts) byName.set(f.name, f);
			return { fonts, byName };
		} catch {
			return { fonts: [], byName: new Map() };
		}
	})();
	return catalogPromise;
}

/** Drop the cached catalog so "Reload art" re-fetches it after a font sync. */
export function clearFontCatalogCache(): void {
	catalogPromise = null;
}

/** Append the `font=1` flag so the asset endpoint rewrites the descriptor's page
 * references to absolute editor-gated URLs (PIXI otherwise resolves them relative
 * to the descriptor request URL and 404s). Robust to an existing query string. */
function descriptorLoadUrl(url: string): string {
	return url.includes('?') ? `${url}&font=1` : `${url}?font=1`;
}

const bitmapLoads = new Map<string, Promise<string | null>>();

/**
 * Ensure a bitmap font is registered with PIXI under its catalog `name`, so a
 * `BitmapText({ style: { fontFamily: name } })` resolves it. Loads the rewritten
 * BMFont descriptor (PIXI pulls in the page images via the absolute URLs). Resolves
 * to the family name on success, `null` on failure. Idempotent per font id.
 */
export function ensureBitmapFont(font: EditorFont): Promise<string | null> {
	const hit = bitmapLoads.get(font.id);
	if (hit) return hit;
	const p = (async (): Promise<string | null> => {
		if (!font.descriptorUrl) return null;
		try {
			// PIXI registers the BitmapFont under its BMFont `<info face>` — which the
			// catalog mirrors as `font.name`. Alias the load so a re-load resolves it.
			await Assets.load({
				src: descriptorLoadUrl(font.descriptorUrl),
				alias: font.name,
				loadParser: 'loadBitmapFont',
			});
			return font.name;
		} catch (e) {
			console.warn('[editor] bitmap font load failed', font.name, e);
			return null;
		}
	})();
	bitmapLoads.set(font.id, p);
	return p;
}

const webLoads = new Map<string, Promise<string | null>>();

/**
 * Ensure a web font's faces are loaded + registered with `document.fonts`, so a
 * PIXI `Text` (or a 2D-canvas `fillText`) using `font.name` renders with the real
 * face instead of a system fallback. Resolves to the family name, `null` on
 * failure. Idempotent per font id.
 */
export function ensureWebFont(font: EditorFont): Promise<string | null> {
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
			console.warn('[editor] web font load failed', font.name, e);
			return null;
		}
	})();
	webLoads.set(font.id, p);
	return p;
}
