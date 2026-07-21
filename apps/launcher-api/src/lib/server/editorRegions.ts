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
import { pickDeployedPage } from './deployedPage';
import { SUB } from './projectPaths';
import {
	getObjectText,
	headObject,
	listAllObjects,
	listObjects,
	objectExists,
	type ListedObject,
} from './r2';

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
	/** True for a verbatim cocos2d `.plist` import. Its rotated frames use the TexturePacker
	 * pack direction (which PIXI un-rotates natively) — the OPPOSITE of the Sheet Maker's own
	 * packer. `RegionThumb` reads this to un-rotate the matching way, so the preview agrees with
	 * the runtime. Absent/false ⇒ the Sheet-Maker convention (today's behaviour). */
	tpRotated?: boolean;
}

/**
 * A manifest region as written by either producer.
 *
 * **Deliberately camelCase-only.** The Atlas Maker also writes trim in snake_case
 * (`off_x`/`orig_w` — `batch_atlas.py` `merge_atlas_regions`, `ui_server.py`
 * `_tp_frame_to_region`), and reading it here looks like an obvious bug fix. It is
 * not — it was tried (660c424) and reverted (see below). Do NOT "fix" it without
 * doing the two things that fix actually needs:
 *
 * 1. **Convert `off_y`.** `_tp_frame_to_region` copies TexturePacker's
 *    `spriteSourceSize.y` raw, which is Y-DOWN from the frame's top. Spine's
 *    `offsets` offY is Y-UP from the bottom — `spine-webgl-4.2.js` does
 *    `v -= (originalHeight - offsetY - height) / textureHeight`. The correct value is
 *    `orig_h - h - sss.y`. Reading the raw field applies a wrong vertical offset.
 * 2. **Migrate existing rigs.** Emitting `offsets:` (see `regionsToSpineAtlas`)
 *    re-bases the atlas coordinate space. Every `.irig` bakes geometry in the space
 *    it was authored in — a region attachment's `width`/`height` (`view.html`
 *    `attachRegion`) and a mesh's `uvs` are both relative to `originalWidth`. Turning
 *    trim on under frozen geometry shrinks the art by `w/orig_w` and anchors it to a
 *    corner. `⟳ Re-sync atlas` rewrites the `.atlas` but deliberately never touches
 *    the `.irig`, so it is the trigger, not the cure.
 *
 * Dropping the trim is wrong-but-consistent, and every existing rig is authored
 * against it. Fixing it is a versioned migration, not a parser tweak.
 */
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
		/** R2 key of the sheet's TexturePacker JSON — the authoritative packing. */
		texturepacker_json?: unknown;
		width?: unknown;
		height?: unknown;
	};
	width?: unknown;
	height?: unknown;
	export_prefix?: unknown;
	/** Atlas-tool deploy hints — used to locate the DEPLOYED page (preferred). */
	deploy_basename?: unknown;
	deploy_path?: unknown;
	regions?: unknown;
	/** Set by a verbatim `.plist` import (`{kind:'plist'}`) — the only manifests whose frames may
	 * be TRIMMED, so the only ones that need trim pulled from the TexturePacker JSON. */
	import?: { kind?: unknown };
}

function num(v: unknown): number | undefined {
	return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
	return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
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
/**
 * Prefer the DEPLOYED page so the editor shows the latest Atlas Maker deploy —
 * i.e. exactly what the game loads (deploy/ is the live-asset source of truth).
 * Matches a page under `deploy/` by the sheet's basename stem (the manifest's
 * `deploy_basename`, its source-page name, or its own stem) via the shared
 * `pickDeployedPage` ranking. Returns null when nothing is deployed for this
 * sheet → the caller falls back to the source page.
 *
 * Note: this swaps only the PAGE, keeping the manifest's region rects — correct
 * ONLY when the deployed page shares the manifest's current packing. The region
 * rects come from the LIVE manifest (Atlas Maker rewrites it the instant you add
 * or re-pack a region), while `deploy/` only updates on an explicit deploy — so a
 * re-pack without a re-deploy leaves the deployed page a packing behind. Pairing
 * fresh rects with that stale page crops empty/wrong pixels (the "new region shows
 * up but the image is blank" bug). Guard against it: if the manifest was written
 * AFTER the newest matching deployed page, treat the deploy as stale and return
 * null so the caller falls back to the manifest's own source page (which IS in the
 * manifest's current coordinate space). `manifestModified` is the manifest object's
 * mtime (epoch ms; 0 = unknown → no guard, legacy behaviour).
 */
async function findDeployedPage(
	man: RawManifest,
	manifestKey: string,
	client: string,
	project: string,
	manifestModified: number,
): Promise<string | null> {
	const stems = new Set<string>();
	const addStem = (s: string | undefined): void => {
		if (!s) return;
		const b = basename(s.replace(/\\/g, '/'));
		const stem = b.replace(/\.[^.]+$/, '').toLowerCase();
		if (stem) stems.add(stem);
	};
	addStem(str(man.deploy_basename));
	addStem(str(man.atlas?.source_image_path));
	addStem(str(man.atlas?.source_image));
	addStem(manifestKey);
	if (stems.size === 0) return null;

	const deployPrefix = `${SUB.deploy(client, project)}/`;
	let objs: ListedObject[];
	try {
		objs = await listAllObjects(deployPrefix);
	} catch {
		return null;
	}
	const picked = pickDeployedPage(objs, stems, deployPrefix);
	if (!picked) return null;

	// Stale-deploy guard: if the manifest (source of the region rects) is newer than
	// the deployed page, the page predates the current packing — fall back to the
	// source page so rects + pixels stay in the same coordinate space.
	if (manifestModified > 0) {
		const pickedObj = objs.find((o) => o.key === picked);
		if (pickedObj && pickedObj.lastModified > 0 && pickedObj.lastModified < manifestModified) {
			return null;
		}
	}
	return picked;
}

async function resolvePageKey(
	man: RawManifest,
	manifestKey: string,
	client: string,
	project: string,
	manifestModified: number,
): Promise<string | null> {
	// Prefer the deployed page so the editor reflects the latest deploy — unless the
	// deploy is older than the manifest (a re-pack that hasn't shipped yet), in which
	// case `findDeployedPage` returns null and we fall through to the source page.
	const deployed = await findDeployedPage(man, manifestKey, client, project, manifestModified);
	if (deployed) return deployed;

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
 * Detect + normalize a **TexturePacker** (json-hash or json-array) manifest into
 * the Invisible shape this module already parses, so a game's own atlas (e.g.
 * Book of Borut's `reels_frame.json`) renders in the editor with NO conversion
 * step — drop the `.json` + page image in R2 and the editor reads it directly.
 *
 * TexturePacker per-frame: `{ frame:{x,y,w,h}, rotated, spriteSourceSize:{x,y,w,h},
 * sourceSize:{w,h} }`. Maps to the Invisible region: `frame` → on-page rect; the
 * unrotated `w/h` (the editor swaps to `(h×w)` on-page for rotated frames);
 * `spriteSourceSize.x/y` → trim `offX/offY`; `sourceSize` → `origW/origH`. Page +
 * size come from `meta.image` / `meta.size`. Returns `null` if not TexturePacker.
 */
function texturePackerToInvisible(raw: unknown): RawManifest | null {
	if (!isRecord(raw)) return null;
	const frames = raw.frames;
	const meta = isRecord(raw.meta) ? raw.meta : null;
	if (!meta || (!isRecord(frames) && !Array.isArray(frames))) return null;

	const entries: [string, unknown][] = Array.isArray(frames)
		? frames.map((f) => [isRecord(f) ? (str(f.filename) ?? '') : '', f])
		: Object.entries(frames as Record<string, unknown>);

	const regions: RawRegion[] = [];
	for (const [name, f] of entries) {
		if (!name || !isRecord(f)) continue;
		const fr = isRecord(f.frame) ? f.frame : {};
		const sss = isRecord(f.spriteSourceSize) ? f.spriteSourceSize : {};
		const src = isRecord(f.sourceSize) ? f.sourceSize : {};
		regions.push({
			name,
			x: num(fr.x) ?? 0,
			y: num(fr.y) ?? 0,
			w: num(fr.w) ?? 0,
			h: num(fr.h) ?? 0,
			rotated: f.rotated === true,
			offX: num(sss.x) ?? 0,
			offY: num(sss.y) ?? 0,
			origW: num(src.w) ?? num(fr.w) ?? 0,
			origH: num(src.h) ?? num(fr.h) ?? 0,
		});
	}

	const size = isRecord(meta.size) ? meta.size : {};
	const w = num(size.w) ?? 0;
	const h = num(size.h) ?? 0;
	return {
		atlas: { source_image: str(meta.image), width: w, height: h },
		width: w,
		height: h,
		regions,
	};
}

/**
 * Backfill from the sheet's TexturePacker JSON two things the Invisible manifest can lack:
 *
 *  1. GEOMETRY for a region listed but WITHOUT `x/y/w/h` — a sprite added to the sheet before
 *     the atlas was re-composed, so the entry exists yet never got coordinates.
 *  2. TRIM (`offX/offY/origW/origH`) for a region that HAS geometry but no trim — the case
 *     that matters for a plist import. `build_manifest` writes only `x/y/w/h`, so a trimmed
 *     frame arrives with its tight packed size and no idea it sits inside a larger canvas, and
 *     every renderer contain-fits the tight rect independently → the art pulses in size. The
 *     trim DOES exist, in the `atlas.texturepacker_json` the manifest already references (its
 *     `spriteSourceSize`/`sourceSize`), so pull it in by name.
 *
 * Mutates `regions` in place. One extra R2 read, and only when some region is missing geometry
 * OR missing trim (a fully self-describing manifest fetches nothing).
 */
async function backfillMissingGeometry(man: RawManifest, regions: EditorRegion[]): Promise<void> {
	const tpKey = str(man.atlas?.texturepacker_json);
	if (!tpKey) return;
	const stem = (n: string): string => n.replace(/\.[^.]+$/, '').toLowerCase();
	const have = new Set(regions.map((r) => stem(r.name)));
	const listed = Array.isArray(man.regions) ? (man.regions as RawRegion[]) : [];
	const missing = listed
		.map((r) => str(r.name))
		.filter((n): n is string => !!n && !have.has(stem(n)));
	// Trim backfill applies ONLY to a verbatim plist import — the sole path that trims a frame.
	// Every normal Sheet Maker sheet centres art in its cell (untrimmed), so gating here spares
	// them the extra TP-JSON read on every load. A region with geometry but no `origW` never
	// learned its untrimmed size.
	const isPlistImport = isRecord(man.import) && man.import.kind === 'plist';
	const needTrim = isPlistImport ? regions.filter((r) => r.origW === undefined) : [];
	if (!missing.length && !needTrim.length) return;

	const text = await getObjectText(tpKey);
	if (!text) return;
	let tp: unknown;
	try {
		tp = JSON.parse(text);
	} catch {
		return;
	}
	const conv = texturePackerToInvisible(tp);
	if (!conv) return;
	const tpByStem = new Map(parseRegions(conv.regions).map((r) => [stem(r.name), r]));
	// Copy trim onto the regions that have geometry but lack it. The TP JSON shares the
	// manifest's coordinate space, so its `offX/offY/origW/origH` apply as-is.
	for (const r of needTrim) {
		const tpR = tpByStem.get(stem(r.name));
		if (!tpR || tpR.origW === undefined) continue;
		r.offX = tpR.offX;
		r.offY = tpR.offY;
		r.origW = tpR.origW;
		r.origH = tpR.origH;
	}
	for (const name of missing) {
		const found = tpByStem.get(stem(name));
		if (found) regions.push({ ...found, name }); // keep the manifest's (extensionless) name
	}
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

	// Fetch the manifest bytes + its mtime together: the mtime lets `resolvePageKey`
	// reject a deployed page that predates this (re-packed) manifest.
	const [text, head] = await Promise.all([getObjectText(manifestKey), headObject(manifestKey)]);
	if (!text) return { ...empty, assetKey: manifestKey };
	const manifestModified = head?.lastModified ?? 0;

	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { ...empty, assetKey: manifestKey };
	}
	// A game's own TexturePacker atlas (json-hash/array) is read directly — no
	// conversion step. Falls through to the Invisible manifest shape otherwise.
	const man: RawManifest = texturePackerToInvisible(parsed) ?? (parsed as RawManifest);

	const regions = parseRegions(man.regions);
	await backfillMissingGeometry(man, regions);
	const pageKey = await resolvePageKey(man, manifestKey, client, project, manifestModified);
	const pageWidth = num(man.atlas?.width) ?? num(man.width) ?? 0;
	const pageHeight = num(man.atlas?.height) ?? num(man.height) ?? 0;

	// A verbatim plist import packs rotated frames the TexturePacker way (PIXI-native); flag it so
	// the preview un-rotates to match the runtime rather than the Sheet Maker's own packer.
	const tpRotated = isRecord(man.import) && man.import.kind === 'plist';

	return {
		assetKey: manifestKey,
		pageKey: pageKey ?? '',
		pageWidth,
		pageHeight,
		regions,
		...(tpRotated ? { tpRotated: true } : {}),
	};
}
