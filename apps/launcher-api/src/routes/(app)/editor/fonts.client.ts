/**
 * Editor-side font glue: the tool-specific `/api/editor/fonts` catalog fetch (with a
 * by-name index + a clearable cache for "Reload art"). The actual font LOADING
 * (descriptor parse, `BitmapFont` build, page + web-`FontFace` loading) lives in the
 * shared `$lib/fontLoad.client` so the Scene Editor and the Font Maker share ONE
 * implementation — re-exported here so the editor's components keep importing from
 * `./fonts.client`.
 */
import type { CatalogFont } from '$lib/fontLoad.client';
import { loadCatalogBitmapFont } from '$lib/fontLoad.client';

/** One resolved font from `/api/editor/fonts` — editor-gated stream URLs. */
export type EditorFont = CatalogFont;

export { ensureWebFont } from '$lib/fontLoad.client';
/** A catalog bitmap font, registered with PIXI under its `name`. See the shared module. */
export const ensureBitmapFont = loadCatalogBitmapFont;

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
