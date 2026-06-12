/**
 * Font Maker client-side font catalog + PIXI/CSS font loading for the View preview.
 * Mirrors `editor/fonts.client.ts`, but reads from the Font Maker's self-contained
 * `/api/fonts/catalog` (so the tool does NOT depend on the editor grant). The
 * catalog already routes every file through `/api/fonts/asset`; bitmap descriptors
 * load through PIXI's `Assets.load` (page refs rewritten to absolute gated URLs by
 * `/api/fonts/asset?…&font=1`), web fonts through the browser `FontFace` API. Both
 * are idempotent + cached per id, defensive on failure.
 */
import { Assets } from 'pixi.js';
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
