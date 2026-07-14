/**
 * Client-side region types + fetch/cache for the editor. Mirrors the
 * `/api/editor/regions` response shape (kept in sync with the server's
 * `EditorRegionSet`). These are EDITOR-SIDE preview data only — they are never
 * baked into the saved doc. A node stores just `assetKey` + `region`; the
 * canvas resolves the page image + rect through this cache.
 */

export interface EditorRegion {
	name: string;
	x: number;
	y: number;
	w: number;
	h: number;
	rotated?: boolean;
	offX?: number;
	offY?: number;
	origW?: number;
	origH?: number;
}

export interface RegionSet {
	/** Resolved manifest key — the value a node stores as `assetKey`. */
	assetKey: string;
	pageKey: string;
	/** Content-version token for the page — stamp into the asset URL to bust caches
	 * when the atlas is re-authored (see `regionAssetUrl`). Empty when there's no page. */
	pageVersion: string;
	pageWidth: number;
	pageHeight: number;
	regions: EditorRegion[];
}

/** The drag payload for a single region (`application/x-iw-asset`). */
export interface RegionDragPayload {
	kind: 'region';
	/** The sheet/atlas identifier the node will keep as `assetKey`. */
	key: string;
	name: string;
	region: string;
	pageKey: string;
	rect: { x: number; y: number; w: number; h: number };
	rotated?: boolean;
	offX?: number;
	offY?: number;
	origW?: number;
	origH?: number;
}

const cache = new Map<string, Promise<RegionSet>>();

/** Drop the per-session region cache so the next fetch re-resolves from R2 —
 * used by the editor's "Reload art" after the underlying atlas changed (e.g. a
 * new deploy), so the page key + rects refresh without a full page reload. */
export function clearRegionCache(): void {
	cache.clear();
}

/** Fetch (and cache per identifier) the region set for a sheet/atlas key. */
export function fetchRegions(sheetKey: string): Promise<RegionSet> {
	const hit = cache.get(sheetKey);
	if (hit) return hit;
	const p = (async (): Promise<RegionSet> => {
		const res = await fetch(`/api/editor/regions?sheet=${encodeURIComponent(sheetKey)}`);
		if (!res.ok) {
			return {
				assetKey: sheetKey,
				pageKey: '',
				pageVersion: '',
				pageWidth: 0,
				pageHeight: 0,
				regions: [],
			};
		}
		return (await res.json()) as RegionSet;
	})();
	cache.set(sheetKey, p);
	return p;
}

/**
 * Build the gated page-image URL for a region set's page. Pass the set's
 * `pageVersion` to stamp a content-version `&v=` so a re-authored atlas busts every
 * URL-keyed cache (browser/CDN/PIXI) automatically — no manual "Reload art".
 */
export function regionAssetUrl(pageKey: string, version?: string): string {
	const base = `/api/editor/asset?key=${encodeURIComponent(pageKey)}`;
	return version ? `${base}&v=${encodeURIComponent(version)}` : base;
}

/** Native (untrimmed) size to spawn a region at — prefers the original art size. */
export function regionNaturalSize(r: EditorRegion): { w: number; h: number } {
	return { w: r.origW ?? r.w, h: r.origH ?? r.h };
}
