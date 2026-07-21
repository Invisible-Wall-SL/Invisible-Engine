/**
 * Client-side region types + fetch/cache for the editor. Mirrors the
 * `/api/editor/regions` response shape (kept in sync with the server's
 * `EditorRegionSet`). These are EDITOR-SIDE preview data only — they are never
 * baked into the saved doc. A node stores just `assetKey` + `region`; the
 * canvas resolves the page image + rect through this cache.
 */
import { builtinSheetFromKey, type BuiltinSheet } from 'engine-layout';

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
	/** True for a verbatim cocos2d `.plist` import — its rotated frames use the TexturePacker
	 * (PIXI-native) pack direction, so `RegionThumb` un-rotates them the opposite way from a
	 * Sheet-Maker-packed sheet, keeping the preview in step with the runtime. */
	tpRotated?: boolean;
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

/** Where the launcher vendors the engine's built-in sheets (see `builtinRegions.ts`). */
const BUILTIN_SHEET_DIR = '/builtin/sheets';

/** A TexturePacker json-hash frame, as the vendored built-in manifests store it. */
interface TexturePackerFrame {
	frame: { x: number; y: number; w: number; h: number };
	rotated?: boolean;
	spriteSourceSize?: { x: number; y: number; w: number; h: number };
	sourceSize?: { w: number; h: number };
}

const EMPTY_SET = (assetKey: string): RegionSet => ({
	assetKey,
	pageKey: '',
	pageVersion: '',
	pageWidth: 0,
	pageHeight: 0,
	regions: [],
});

/**
 * Build the `RegionSet` for one of the engine's BUILT-IN sheets from the copy vendored
 * under `static/builtin/sheets/`. These ship as LOCAL game assets (every game app's
 * `static/assets/sprites/<id>/`, registered in its `game/assets.ts`), so they are not in
 * R2 and `/api/editor/regions` cannot resolve them — without this the coded-default art
 * (`progressBar*.png`, `Frame_FSCounter.png`) drew an editor placeholder even though the
 * shipped game renders it fine. Mirrors `editorSpine.client.ts`'s `builtinDescriptor`.
 *
 * The vendored manifest is authoritative for the rects; `pageKey` is a static path (it
 * starts with `/`), which the page-URL builders pass through verbatim instead of routing
 * it to the R2-gated `/api/editor/asset`.
 */
async function fetchBuiltinRegions(sheet: BuiltinSheet, key: string): Promise<RegionSet> {
	const res = await fetch(`${BUILTIN_SHEET_DIR}/${sheet.id}/${sheet.json}`);
	if (!res.ok) return EMPTY_SET(key);
	const body = (await res.json()) as {
		frames?: Record<string, TexturePackerFrame>;
		meta?: { size?: { w: number; h: number } };
	};
	const regions: EditorRegion[] = Object.entries(body.frames ?? {}).map(([name, f]) => ({
		name,
		x: f.frame.x,
		y: f.frame.y,
		w: f.frame.w,
		h: f.frame.h,
		rotated: f.rotated === true,
		offX: f.spriteSourceSize?.x,
		offY: f.spriteSourceSize?.y,
		origW: f.sourceSize?.w,
		origH: f.sourceSize?.h,
	}));
	return {
		assetKey: key,
		pageKey: `${BUILTIN_SHEET_DIR}/${sheet.id}/${sheet.page}`,
		// Vendored art only changes with an engine release, which changes the deployed
		// file anyway — no per-fetch version token needed.
		pageVersion: '',
		pageWidth: body.meta?.size?.w ?? 0,
		pageHeight: body.meta?.size?.h ?? 0,
		regions,
	};
}

/** Drop the per-session region cache so the next fetch re-resolves from R2 —
 * used by the editor's "Reload art" after the underlying atlas changed (e.g. a
 * new deploy), so the page key + rects refresh without a full page reload. */
export function clearRegionCache(): void {
	cache.clear();
}

/** Fetch (and cache per identifier) the region set for a sheet/atlas key. A `builtin:<id>`
 *  key resolves from the vendored engine sheets instead of R2. */
export function fetchRegions(sheetKey: string): Promise<RegionSet> {
	const hit = cache.get(sheetKey);
	if (hit) return hit;
	const builtin = builtinSheetFromKey(sheetKey);
	const p = builtin
		? fetchBuiltinRegions(builtin, sheetKey)
		: (async (): Promise<RegionSet> => {
				const res = await fetch(`/api/editor/regions?sheet=${encodeURIComponent(sheetKey)}`);
				if (!res.ok) return EMPTY_SET(sheetKey);
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
	// A vendored built-in sheet's page is a static launcher path, not an R2 key — serve it
	// directly rather than through the R2-gated asset proxy (which would 404 on it).
	if (isStaticPageKey(pageKey)) return pageKey;
	const base = `/api/editor/asset?key=${encodeURIComponent(pageKey)}`;
	return version ? `${base}&v=${encodeURIComponent(version)}` : base;
}

/** Whether a region set's `pageKey` is a launcher-static path (a vendored built-in sheet's
 *  page) rather than an R2 object key. R2 keys never start with `/`. */
export function isStaticPageKey(pageKey: string): boolean {
	return pageKey.startsWith('/');
}

/** Native (untrimmed) size to spawn a region at — prefers the original art size. */
export function regionNaturalSize(r: EditorRegion): { w: number; h: number } {
	return { w: r.origW ?? r.w, h: r.origH ?? r.h };
}

/**
 * Extension-stripped, lowercased frame STEM — the case/extension-insensitive key that
 * lets a coded-default cell (`w.png`, `explodedW.png`, `H1`) resolve against a synced
 * atlas region carrying a different extension or casing (`w.webp`, `h1.png`, `W`).
 * Mirrors the server-side stem in `server/editorRegions.ts`'s `backfillMissingGeometry`.
 */
export function frameStem(name: string): string {
	return name.replace(/\.[^.]+$/, '').toLowerCase();
}
