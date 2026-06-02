/**
 * Locate + parse a sheet/atlas manifest into a flat list of draggable regions
 * for the Invisible Editor. Mirrors the style of `projectAssets.ts`: read-only,
 * defensive, never throws on a missing/garbage manifest (returns empty regions).
 *
 * A sheet/atlas is a CONTAINER of frames, not a single texture. The editor lists
 * each frame as its own draggable thumbnail (cropped out of the packed page),
 * and a dropped region becomes a `SpriteNode { assetKey, region }`.
 *
 * `assetKey` is the stable identifier the node keeps AND the value the
 * `/api/editor/regions` endpoint accepts again later (so a reopened doc can
 * re-resolve its preview data). For both kinds we use the manifest's R2 key as
 * `assetKey` — for a `sheet` we resolve the manifest key under its output prefix
 * here, then hand the resolved manifest key back to the client as `assetKey`.
 */
import { SUB } from './projectPaths';
import { getObjectText, listObjects, objectExists } from './r2';

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

export interface EditorRegionSet {
	/** Resolved manifest R2 key — the value the node stores as `assetKey`. */
	assetKey: string;
	/** R2 key of the packed page image, streamable via `/api/editor/asset`. */
	pageKey: string;
	pageWidth: number;
	pageHeight: number;
	regions: EditorRegion[];
}

interface RawRegion {
	name?: unknown;
	x?: unknown;
	y?: unknown;
	w?: unknown;
	h?: unknown;
	rotated?: unknown;
	offX?: unknown;
	offY?: unknown;
	origW?: unknown;
	origH?: unknown;
}

interface RawManifest {
	atlas?: {
		source_image?: unknown;
		source_image_path?: unknown;
		atlas_file?: unknown;
		width?: unknown;
		height?: unknown;
	};
	width?: unknown;
	height?: unknown;
	export_prefix?: unknown;
	regions?: unknown;
}

function num(v: unknown): number | undefined {
	return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
	return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function basename(key: string): string {
	const i = key.lastIndexOf('/');
	return i === -1 ? key : key.slice(i + 1);
}

function isManifestKey(key: string): boolean {
	return key.endsWith('.json');
}

/**
 * Resolve a sheet/atlas identifier to its manifest R2 key.
 *
 * - An `atlas-manifest` library item already IS the manifest key (`*.json`).
 * - A `sheet` library item is the output prefix `…/output/<sheet>/`; the
 *   manifest there is `atlas_manifest_<basename>.json` (Sheet Maker naming).
 */
async function resolveManifestKey(sheet: string): Promise<string | null> {
	if (isManifestKey(sheet)) return sheet;
	const prefix = sheet.endsWith('/') ? sheet : `${sheet}/`;
	const listed = await listObjects(prefix, 500);
	const jsons = listed.keys.filter((k) => k.endsWith('.json'));
	// Prefer the Sheet Maker AI manifest; fall back to any JSON in the prefix.
	const am = jsons.find((k) => basename(k).startsWith('atlas_manifest_'));
	return am ?? jsons[0] ?? null;
}

/**
 * Resolve the packed page image to a real R2 key inside the project. The
 * manifest's `source_image_path` is an R2 key when authored by the cloud Sheet
 * Maker (B14); legacy manifests carry a local Windows path in `source_image`.
 * In the latter case we resolve by basename against the manifest's own folder
 * and the project's atlas output prefix, tolerating a `.png`/`.webp` mismatch.
 */
async function resolvePageKey(
	man: RawManifest,
	manifestKey: string,
	client: string,
	project: string,
): Promise<string | null> {
	const direct = str(man.atlas?.source_image_path);
	if (direct && (await objectExists(direct))) return direct;

	const rawName = str(man.atlas?.source_image) ?? direct;
	if (!rawName) return null;
	// Strip any local/Windows directory components → bare filename.
	const base = rawName.replace(/\\/g, '/').split('/').pop() ?? rawName;
	const stem = base.replace(/\.[^.]+$/, '');

	const manifestDir = manifestKey.slice(0, manifestKey.lastIndexOf('/') + 1);
	const atlasOut = `${SUB.atlas(client, project)}/`;
	const sheetExport = str(man.export_prefix);
	const candidateDirs = [manifestDir, sheetExport ? `${sheetExport}/` : '', atlasOut].filter(
		(d) => d.length > 0,
	);

	const exts = ['png', 'webp'];
	for (const dir of candidateDirs) {
		for (const ext of exts) {
			const candidate = `${dir}${stem}.${ext}`;
			if (await objectExists(candidate)) return candidate;
		}
		// Also try the exact basename as-given (already has an extension).
		const exact = `${dir}${base}`;
		if (await objectExists(exact)) return exact;
	}
	return null;
}

function parseRegions(raw: unknown): EditorRegion[] {
	if (!Array.isArray(raw)) return [];
	const out: EditorRegion[] = [];
	for (const r of raw as RawRegion[]) {
		const name = str(r.name);
		const x = num(r.x);
		const y = num(r.y);
		const w = num(r.w);
		const h = num(r.h);
		if (!name || x === undefined || y === undefined || w === undefined || h === undefined) {
			continue;
		}
		const region: EditorRegion = { name, x, y, w, h };
		if (r.rotated === true) region.rotated = true;
		const offX = num(r.offX);
		const offY = num(r.offY);
		const origW = num(r.origW);
		const origH = num(r.origH);
		if (offX !== undefined) region.offX = offX;
		if (offY !== undefined) region.offY = offY;
		if (origW !== undefined) region.origW = origW;
		if (origH !== undefined) region.origH = origH;
		out.push(region);
	}
	return out;
}

/**
 * Locate, parse and resolve a sheet/atlas into its region set. Returns an empty
 * set (never null/throws) when nothing usable is found, so the endpoint can
 * always answer `{ regions: [] }` with a clear shape instead of 500-ing.
 */
export async function loadRegionSet(
	sheet: string,
	client: string,
	project: string,
): Promise<EditorRegionSet> {
	const empty: EditorRegionSet = {
		assetKey: sheet,
		pageKey: '',
		pageWidth: 0,
		pageHeight: 0,
		regions: [],
	};

	const manifestKey = await resolveManifestKey(sheet);
	if (!manifestKey) return empty;

	const text = await getObjectText(manifestKey);
	if (!text) return { ...empty, assetKey: manifestKey };

	let man: RawManifest;
	try {
		man = JSON.parse(text) as RawManifest;
	} catch {
		return { ...empty, assetKey: manifestKey };
	}

	const regions = parseRegions(man.regions);
	const pageKey = await resolvePageKey(man, manifestKey, client, project);
	const pageWidth = num(man.atlas?.width) ?? num(man.width) ?? 0;
	const pageHeight = num(man.atlas?.height) ?? num(man.height) ?? 0;

	return {
		assetKey: manifestKey,
		pageKey: pageKey ?? '',
		pageWidth,
		pageHeight,
		regions,
	};
}
