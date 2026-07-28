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

/** The font catalog as the overlay consumes it: a list + by-id / by-name indexes.
 *  A stored `style.fontFamily` resolves by `id` first (so same-face variants stay
 *  distinct), then by `name` (legacy docs + built-ins). */
export interface FontCatalogResult {
	fonts: EditorFont[];
	byId: Map<string, EditorFont>;
	byName: Map<string, EditorFont>;
}

/** Resolve a stored font reference (`style.fontFamily`) to its catalog entry —
 *  `id` first, then `name`. Mirrors engine-layout's `findFont`. */
export function resolveFontRef(
	cat: FontCatalogResult,
	ref: string | null | undefined,
): EditorFont | undefined {
	if (!ref) return undefined;
	return cat.byId.get(ref) ?? cat.byName.get(ref);
}

let catalogPromise: Promise<FontCatalogResult> | null = null;

/** Fetch (once per session) the active project's font catalog. Empty on failure. */
export function fetchFontCatalog(): Promise<FontCatalogResult> {
	if (catalogPromise) return catalogPromise;
	catalogPromise = (async (): Promise<FontCatalogResult> => {
		try {
			const res = await fetch('/api/editor/fonts');
			if (!res.ok) return { fonts: [], byId: new Map(), byName: new Map() };
			const body = (await res.json()) as { fonts?: EditorFont[] };
			const fonts = body.fonts ?? [];
			const byId = new Map<string, EditorFont>();
			const byName = new Map<string, EditorFont>();
			for (const f of fonts) {
				byId.set(f.id, f);
				byName.set(f.name, f);
			}
			return { fonts, byId, byName };
		} catch {
			return { fonts: [], byId: new Map(), byName: new Map() };
		}
	})();
	return catalogPromise;
}

/** Drop the cached catalog so "Reload art" re-fetches it after a font sync. */
export function clearFontCatalogCache(): void {
	catalogPromise = null;
}
