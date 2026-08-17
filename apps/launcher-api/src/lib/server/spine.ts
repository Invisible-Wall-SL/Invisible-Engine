import { error } from '@sveltejs/kit';
import sharp from 'sharp';
import { roleHasTool } from '$lib/roles';
import { EDITOR_SPINE_LOAD_SCALE } from '$lib/spineScale';
import { SUB, sharedSpinesPrefix, spineBundlePath, spineBundleSharedPath } from './projectPaths';
import { pickDeployedPage } from './deployedPage';
import {
	copyObject,
	getObjectBytes,
	getObjectText,
	headObject,
	listAllObjects,
	objectExists,
	putObjectBytes,
	putObjectText,
	type ListedObject,
} from './r2';
import { ENV } from './env';
import { encodePageToKtx2 } from './ktx2Encode';
import { PageStore, PAGE_REF_PREFIX } from './pageStore';
import { getRoleOverrides } from './roleToolAccess';
import { ensureBundleAtlasFresh, firstAtlasPageName } from './spineBundleSync';
import { getToolOverrides } from './userToolAccess';

export async function requireSpineAccess(locals: App.Locals): Promise<void> {
	if (!locals.user) throw error(401, 'Not authenticated');
	const roleOverrides = await getRoleOverrides(locals.user.role);
	const overrides = await getToolOverrides(locals.user.id);
	// The Spine Viewer, the Rigger AND Invisible FX all read project skeletons through this
	// gate (same R2 spines + skeletons.json). The Viewer/Rigger author or inspect rigs;
	// Invisible FX loads a playing skeleton purely as the Tier-B authoring BACKDROP to pin
	// emitters onto bones (a READ of the same skeletons + bundle files), so its grant
	// satisfies the gate too. This never widens the R2 prefix — only the entitlement check
	// (the same shared-read seam the editor's region/asset endpoints use for `fx`).
	const hasViewer = roleHasTool(locals.user.role, 'spineViewer', roleOverrides, overrides);
	const hasRigger = roleHasTool(locals.user.role, 'rigger', roleOverrides, overrides);
	const hasFx = roleHasTool(locals.user.role, 'fx', roleOverrides, overrides);
	if (!hasViewer && !hasRigger && !hasFx) {
		throw error(403, 'Your role does not have access to the Spine Viewer, Rigger or FX.');
	}
}

/** Per-project skeletons.json key with a `_shared/` fallback root. */
export async function resolveSkeletonsRoot(
	clientKey: string,
	projectKey: string,
): Promise<{ root: string; key: string } | null> {
	const projectRoot = SUB.spines(clientKey, projectKey);
	if (await objectExists(`${projectRoot}/skeletons.json`)) {
		return { root: projectRoot, key: `${projectRoot}/skeletons.json` };
	}
	const sharedRoot = '_shared/spines';
	if (await objectExists(`${sharedRoot}/skeletons.json`)) {
		return { root: sharedRoot, key: `${sharedRoot}/skeletons.json` };
	}
	return null;
}

/** Pick the first existing bundle prefix: per-project, then shared `_shared/`. */
export async function resolveBundlePrefix(
	clientKey: string,
	projectKey: string,
	bundle: string,
	name: string,
): Promise<string | null> {
	const project = spineBundlePath(clientKey, projectKey, bundle);
	if (await objectExists(`${project}/${name}`)) return project;
	const shared = spineBundleSharedPath(bundle);
	if (await objectExists(`${shared}/${name}`)) return shared;
	return null;
}

const PAGE_LINE = /^(.+)\.(webp|jpg|jpeg)\s*$/i;

/** Rewrite atlas page refs (`foo.webp`) to a `.png` sibling when it exists in R2
 * (avoids lossy-WebP alpha — mirrors the local tool's _atlas_prefer_png). */
async function atlasPreferPng(text: string, bundlePrefix: string): Promise<string> {
	const out: string[] = [];
	for (const line of text.split(/\r?\n/)) {
		const m = line.match(PAGE_LINE);
		if (m && (await objectExists(`${bundlePrefix}/${m[1]}.png`))) {
			out.push(`${m[1]}.png`);
		} else {
			out.push(line);
		}
	}
	return out.join('\n');
}

export interface SpineFile {
	body: Uint8Array | string;
	contentType: string;
}

/**
 * Fetch a single file inside a spine bundle, resolving the per-project location
 * first and falling back to the shared `_shared/<bundle>/` set. `.atlas` files
 * get the WebP→PNG sibling rewrite when `preferPng` is true.
 */
export async function fetchSpineBundleFile(
	clientKey: string,
	projectKey: string,
	bundle: string,
	name: string,
	preferPng: boolean,
): Promise<SpineFile | null> {
	const prefix = await resolveBundlePrefix(clientKey, projectKey, bundle, name);
	if (!prefix) return null;
	const key = `${prefix}/${name}`;

	if (name.toLowerCase().endsWith('.atlas')) {
		let text = await getObjectText(key);
		if (text === null) return null;

		// SELF-HEAL A MISSING PAGE IMAGE. The bundle's `.atlas` names its page on the first line; if
		// that file is not actually in the bundle, every consumer fails with the runtime's opaque
		// "Couldn't load texture … page image", and `/rigger` — the tool that AUTHORS rigs — was the
		// one read path with no heal wired (the Symbols/Editor read, the bake, save and the ⟳ button
		// all have one). A plain `ensureBundleAtlasFresh` is not enough here: it compares a geometry
		// revision and bails when it matches, and a page can be missing while the geometry is
		// unchanged — so a missing page forces the re-derive. One HEAD on the happy path; the force
		// only ever runs when the bundle is already broken.
		const pageName = firstAtlasPageName(text);
		if (pageName && !(await objectExists(`${prefix}/${pageName}`))) {
			const healed = await ensureBundleAtlasFresh(clientKey, projectKey, prefix, name, {
				force: true,
			}).catch(() => null);
			if (healed?.changed) text = (await getObjectText(key)) ?? text;
		}

		if (preferPng) text = await atlasPreferPng(text, prefix);
		return { body: text, contentType: 'text/plain; charset=utf-8' };
	}

	const obj = await getObjectBytes(key);
	if (!obj) return null;
	return { body: obj.body, contentType: obj.contentType };
}

/** Region geometry for synthesising a `.atlas` (matches `EditorRegion` from
 * `editorRegions.ts` — on-page rect + optional trim/orig). */
export interface SynthRegion {
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

/**
 * Synthesise a modern Spine 4.x `.atlas` from a manifest's regions, byte-compatible
 * with what the Atlas Maker itself emits (`atlas_format.py` `write_atlas`): page
 * line, `size:`/`filter:`, then per region `<name>` + `bounds:x,y,w,h`, optional
 * `offsets:ox,oy,ow,oh` (only when trimmed), `rotate:90` when rotated. Lets the
 * Rigger turn any composed atlas (manifest) into a loadable spine bundle.
 */
export function regionsToSpineAtlas(
	pageImage: string,
	pageWidth: number,
	pageHeight: number,
	regions: SynthRegion[],
): string {
	const out: string[] = [
		pageImage,
		`size:${Math.round(pageWidth)},${Math.round(pageHeight)}`,
		'filter:Linear,Linear',
	];
	for (const r of regions) {
		const w = Math.round(r.w);
		const h = Math.round(r.h);
		out.push(r.name);
		out.push(`bounds:${Math.round(r.x)},${Math.round(r.y)},${w},${h}`);
		const ow = Math.round(r.origW ?? r.w);
		const oh = Math.round(r.origH ?? r.h);
		const ox = Math.round(r.offX ?? 0);
		const oy = Math.round(r.offY ?? 0);
		if (ox !== 0 || oy !== 0 || ow !== w || oh !== h) out.push(`offsets:${ox},${oy},${ow},${oh}`);
		if (r.rotated) out.push('rotate:90');
	}
	return out.join('\n') + '\n';
}

/**
 * Re-orient a composed page's `rotated` regions for Spine consumption.
 *
 * The Atlas/Sheet packers store a rotated region's pixels rotated 90° CLOCKWISE
 * (`PIL rotate(-90)` in `packer.compose` / `batch_atlas.fit_to_region`) — the PixiJS
 * Spritesheet convention, which the editor canvas, symbols and region thumbnails all
 * un-rotate correctly. The Spine atlas parser uses the OPPOSITE convention: a
 * `rotate:90` region must be packed COUNTER-clockwise to render upright (verified from
 * the `degrees == 90` UV math in the vendored `spine-webgl-4.2.js`). So a CW-packed
 * region renders 180° off — upside down — in the Rigger, and spine-webgl only honours
 * `degrees` 0/90 (270 falls through to the unrotated branch), so it can't be expressed
 * in the `.atlas`.
 *
 * The fix is purely in the pixels: a rotated region's on-page footprint is `(h×w)`, and
 * rotating that block 180° converts our CW packing into the CCW orientation Spine
 * expects. 180° preserves the bounding box, so it's an in-place pixel reversal that
 * never disturbs neighbouring regions or any geometry — the `.atlas` (bounds/offsets/
 * `rotate:90`) is unchanged.
 *
 * Atlas Maker pages are WebP, Sheet Maker pages are PNG, so we decode via `sharp`
 * (multi-format), flip on the raw RGBA buffer, and re-encode LOSSLESSLY to the SAME
 * format (the existing pixels pass through byte-faithfully; only rotated regions move).
 * Returns the input untouched when nothing is rotated, the format is one we don't
 * re-encode, or anything throws — a re-sync must never fail over this.
 */
export async function reorientRotatedRegionsForSpine(
	pageBytes: Uint8Array,
	regions: SynthRegion[],
): Promise<Uint8Array> {
	const rotated = regions.filter((r) => r.rotated);
	if (!rotated.length) return pageBytes;

	try {
		const input = Buffer.from(pageBytes);
		const meta = await sharp(input).metadata();
		const pw = meta.width ?? 0;
		const ph = meta.height ?? 0;
		// Only PNG/WebP round-trip cleanly to the same format with alpha; anything else
		// (e.g. JPEG, which can't hold the sprite transparency) is left untouched.
		if (!pw || !ph || (meta.format !== 'png' && meta.format !== 'webp')) return pageBytes;

		// Decode to raw RGBA (always 4 channels) so the in-place 180° flips are trivial.
		const data = await sharp(input).ensureAlpha().raw().toBuffer();

		for (const r of rotated) {
			const x = Math.round(r.x);
			const y = Math.round(r.y);
			// On-page footprint of a rotated region is (h × w): width = unrotated height,
			// height = unrotated width (matches the packer footprint + the `.atlas` bounds).
			const rw = Math.round(r.h);
			const rh = Math.round(r.w);
			// Skip a malformed/out-of-bounds rect so it can never read or write past the page.
			if (rw <= 0 || rh <= 0 || x < 0 || y < 0 || x + rw > pw || y + rh > ph) continue;
			rotate180InPlace(data, pw, x, y, rw, rh);
		}

		const raw = sharp(data, { raw: { width: pw, height: ph, channels: 4 } });
		const out = meta.format === 'webp' ? raw.webp({ lossless: true }) : raw.png();
		return new Uint8Array(await out.toBuffer());
	} catch {
		return pageBytes;
	}
}

/**
 * Rotate a rectangular block of RGBA pixels 180° in place. Pixel p (row-major within the
 * rect) swaps with its 180° partner `total-1-p`; iterating the first half pairs each once
 * (an odd centre pixel is its own partner and is left alone).
 */
function rotate180InPlace(
	data: Buffer,
	pageW: number,
	x0: number,
	y0: number,
	w: number,
	h: number,
): void {
	const half = (w * h) >> 1;
	for (let p = 0; p < half; p++) {
		const i = p % w;
		const j = (p / w) | 0;
		const ai = ((y0 + j) * pageW + (x0 + i)) * 4;
		const bi = ((y0 + (h - 1 - j)) * pageW + (x0 + (w - 1 - i))) * 4;
		for (let c = 0; c < 4; c++) {
			const t = data[ai + c];
			data[ai + c] = data[bi + c];
			data[bi + c] = t;
		}
	}
}

/** One skeleton's index entry, as written into `skeletons.json` by the sync. */
export interface SkeletonIndexEntry {
	name: string;
	folder: string;
	skeleton_file: string;
	atlas_file: string;
	format: 'skel' | 'json';
	version?: string;
	runtime: string;
	pma?: boolean;
	dir_b64: string;
}

/** Bundle name (`folder` in the index) implied by a spine node's `assetKey`. The
 * `assetKey` is the R2 prefix the asset list hands out — either per-project
 * `<client>/<project>/spines/<bundle>/` or the shared `_shared/spines/<bundle>/`. */
export function bundleFromAssetKey(
	clientKey: string,
	projectKey: string,
	assetKey: string,
): string | null {
	const trimmed = assetKey.endsWith('/') ? assetKey.slice(0, -1) : assetKey;
	const projectRoot = SUB.spines(clientKey, projectKey);
	const sharedRoot = sharedSpinesPrefix('').replace(/\/$/, '');
	for (const root of [projectRoot, sharedRoot]) {
		if (trimmed === root) return '';
		if (trimmed.startsWith(`${root}/`)) return trimmed.slice(root.length + 1);
	}
	return null;
}

/**
 * Read a project's `skeletons.json` entries (per-project, then `_shared/`). Returns
 * `[]` when the index is missing or unparseable. The shared read primitive for any
 * caller that needs to resolve a folder → `{ atlas_file, skeleton_file, … }`.
 */
export async function loadSkeletonIndex(
	clientKey: string,
	projectKey: string,
): Promise<SkeletonIndexEntry[]> {
	const root = await resolveSkeletonsRoot(clientKey, projectKey);
	if (!root) return [];
	const indexText = await getObjectText(root.key);
	if (!indexText) return [];
	try {
		return (JSON.parse(indexText).skeletons ?? []) as SkeletonIndexEntry[];
	} catch {
		return [];
	}
}

/** Page-image filenames declared by an atlas. A page block starts at file start /
 * after a blank line: the FIRST non-property line there is the page image; every
 * other non-indented, no-`:` line is a region name. Region names CAN carry an image
 * extension (e.g. `heart_shadow.png`), so pages MUST be identified structurally by
 * position, never by extension — otherwise such a region is mis-loaded as a texture
 * page (a 404 that leaves the spine with a blank placeholder). Inverse of
 * `atlasRegionNames`; the two share one structural model. */
export function atlasPageNames(atlasText: string): string[] {
	const out: string[] = [];
	let expectPage = true; // first non-empty line is a page image; also after a blank line
	for (const line of atlasText.split(/\r?\n/)) {
		if (line.trim() === '') {
			expectPage = true;
			continue;
		}
		if (/^\s/.test(line) || line.includes(':')) {
			expectPage = false;
			continue;
		} // property line
		if (expectPage) {
			expectPage = false;
			out.push(line.trim()); // page image filename
			continue;
		}
		// region name — not a page
	}
	return out;
}

/** A page's KTX2 twin: the new filename + the dimensions it was encoded at (≤ source when it
 * was downscaled). */
interface Ktx2Page {
	name: string;
	width: number;
	height: number;
}

/** Atlas region-coordinate lines whose numbers are page pixels and so must be rescaled when a
 * page is downscaled. Alternating axes: 1st,3rd number = x-axis (sx), 2nd,4th = y-axis (sy) —
 * which is correct for `bounds`/`offsets` (x,y,w,h) AND `xy`/`offset` (x,y) AND `size`/`orig`
 * (w,h). Non-coord lines (`rotate`/`index`/`filter`/…) are left untouched. */
const ATLAS_COORD_LINE = /^(\s*)(bounds|offsets|xy|orig|offset|size)(\s*:\s*)(.+?)\s*$/i;
function scaleAtlasCoordLine(line: string, sx: number, sy: number): string {
	const m = line.match(ATLAS_COORD_LINE);
	if (!m) return line;
	const [, indent, key, sep, body] = m;
	const scaled = body.split(',').map((p, i) => {
		const v = parseFloat(p);
		return Number.isNaN(v) ? p.trim() : String(Math.round(v * (i % 2 === 0 ? sx : sy)));
	});
	return `${indent}${key}${sep}${scaled.join(',')}`;
}

/**
 * Rewrite an atlas for the KTX2 variant: swap each page-name line to its `.ktx2` twin, and — for
 * a page that was DOWNSCALED — rewrite its `size:` line and rescale every following region
 * coordinate by the same factor, so the UVs (rect ÷ page-size) are unchanged and regions render
 * identically at lower resolution. Pages that weren't encoded keep their original name + coords.
 * Mirrors {@link atlasPageNames}' page/property/region line classification.
 */
function rewriteAtlasForKtx2(atlasText: string, ktx2ByPage: Map<string, Ktx2Page>): string {
	const out: string[] = [];
	let expectPage = true;
	let sx = 1;
	let sy = 1;
	let pending: Ktx2Page | null = null; // ktx2 page whose `size:` line is still to come
	for (const line of atlasText.split(/\r?\n/)) {
		if (line.trim() === '') {
			expectPage = true;
			sx = sy = 1;
			pending = null;
			out.push(line);
			continue;
		}
		const isProperty = /^\s/.test(line) || line.includes(':');
		if (isProperty) {
			const sizeM = line.match(/^(\s*)size\s*:\s*(\d+)\s*,\s*(\d+)\s*$/i);
			if (sizeM && pending) {
				sx = +sizeM[2] ? pending.width / +sizeM[2] : 1;
				sy = +sizeM[3] ? pending.height / +sizeM[3] : 1;
				out.push(`${sizeM[1]}size:${pending.width},${pending.height}`);
				pending = null;
				continue;
			}
			out.push(sx !== 1 || sy !== 1 ? scaleAtlasCoordLine(line, sx, sy) : line);
			continue;
		}
		// A non-indented, colon-free line: a page name (when a page is expected) or a region name.
		if (expectPage) {
			expectPage = false;
			const twin = ktx2ByPage.get(line.trim());
			sx = sy = 1;
			pending = twin ?? null;
			out.push(twin ? twin.name : line);
			continue;
		}
		out.push(line); // region name — unchanged
	}
	return out.join('\n');
}

/** Whether an atlas declares ANY rotated region (a `rotate:90` / `rotate: true` line).
 * The Atlas/Sheet packers store a rotated region's pixels 90° CLOCKWISE (the PixiJS
 * spritesheet convention); Spine's atlas parser expects the OPPOSITE (CCW), so a
 * rotated region only renders upright once its page pixels are reoriented 180°
 * (`reorientRotatedRegionsForSpine`). This flag lets the editor pick the reoriented
 * BUNDLE page over the raw (CW) deployed sheet page for such an atlas — see
 * {@link resolveSpinePageKeys} / {@link resolveEditorSpine}. Matches only a standalone
 * `rotate` property line so a region NAMED e.g. `rotate_icon` can't false-positive. */
export function atlasHasRotatedRegion(atlasText: string): boolean {
	return /^[ \t]*rotate[ \t]*:[ \t]*(?:true|90)[ \t]*$/im.test(atlasText);
}

/** Region names declared by an atlas (the Rigger lists these so a new rig can attach
 * packed images). A page block starts at file start / after a blank line with the
 * image filename, then page properties (`size:`…); every other non-indented, no-`:`
 * line is a region name. NOTE region names CAN have image extensions (e.g.
 * `heart_shadow.png`), so pages are identified structurally, not by extension. */
export function atlasRegionNames(atlasText: string): string[] {
	const out: string[] = [];
	let expectPage = true; // first non-empty line is a page image; also after a blank line
	for (const line of atlasText.split(/\r?\n/)) {
		if (line.trim() === '') {
			expectPage = true;
			continue;
		}
		if (/^\s/.test(line) || line.includes(':')) {
			expectPage = false;
			continue;
		} // property line
		if (expectPage) {
			expectPage = false;
			continue;
		} // page image filename
		out.push(line.trim()); // region name
	}
	return out;
}

/** The editor needs the skeleton stream URL, the (PNG-preferred) atlas text, and
 * each page image URL — all routed through the editor-gated `/api/editor/asset`
 * streamer so no extra tool grant is required. */
export interface EditorSpineDescriptor {
	folder: string;
	format: 'skel' | 'json';
	runtime: string;
	pma: boolean;
	atlasText: string;
	skeletonKey: string;
	pageKeys: string[];
	pageNames: string[];
}

/**
 * Map each spine page name to the R2 key the editor should stream. Prefers a
 * DEPLOYED page (`deploy/…`) whose basename matches the spine's page name —
 * via the shared `pickDeployedPage` ranking (editor-art excluded, newest deploy
 * batch, `.webp` then largest within it) — so a spine reflects the latest
 * deploy (same as region sprites). Falls back to the spine bundle's own page when
 * nothing is deployed for it. Safe only because the atlas geometry is unchanged
 * (the page is regenerated with the same layout); a re-pack that changed layout
 * would need a matching `.atlas`.
 */
async function resolveSpinePageKeys(
	pageNames: string[],
	client: string,
	project: string,
	bundlePrefix: string,
): Promise<string[]> {
	const deployPrefix = `${SUB.deploy(client, project)}/`;
	let deployObjs: ListedObject[] = [];
	try {
		deployObjs = await listAllObjects(deployPrefix);
	} catch {
		deployObjs = [];
	}
	return pageNames.map((n) => {
		const base = n.split('/').pop() ?? n;
		const dot = base.lastIndexOf('.');
		const stem = (dot === -1 ? base : base.slice(0, dot)).toLowerCase();
		const deployed = pickDeployedPage(deployObjs, new Set([stem]), deployPrefix);
		return deployed ?? `${bundlePrefix}/${n}`;
	});
}

/**
 * Resolve a spine node's `assetKey` to everything the editor canvas needs to build
 * the skeleton: the index entry (from the per-project or `_shared` `skeletons.json`),
 * the PNG-preferred atlas text, and the R2 keys for the skeleton + page images.
 * Returns `null` when the project has no skeleton index or no matching bundle.
 */
export async function resolveEditorSpine(
	clientKey: string,
	projectKey: string,
	assetKey: string,
	preferPng: boolean,
): Promise<EditorSpineDescriptor | null> {
	const entries = await loadSkeletonIndex(clientKey, projectKey);
	// Resolve the skeleton, most-specific first:
	//  1. a full R2 bundle PREFIX → the FIRST skeleton in that folder (the editor's
	//     by-folder model — one skeleton per placed spine node);
	//  2. a `<folder>/<stem>` key (the Symbols tool's published `previewKey`, e.g.
	//     `symbols/h1`) → the exact `skeletons.json` entry by `name`;
	//  3. a bare engine key (e.g. `H1`, `explosion` — a coded symbol whose defaults
	//     were published WITHOUT previewKeys) → the entry whose SKELETON FILE stem
	//     matches case-insensitively (`H1` → `h1.json`). This makes a shared-atlas
	//     symbol spine previewable straight from its coded assetKey.
	const stemOf = (file: string): string => file.replace(/\.[^.]+$/, '').toLowerCase();
	const bundle = bundleFromAssetKey(clientKey, projectKey, assetKey);
	const entry =
		bundle !== null
			? entries.find((e) => e.folder === bundle)
			: (entries.find((e) => e.name === assetKey) ??
				entries.find((e) => stemOf(e.skeleton_file) === assetKey.toLowerCase()));
	if (!entry) return null;

	const prefix = await resolveBundlePrefix(clientKey, projectKey, entry.folder, entry.atlas_file);
	if (!prefix) return null;

	// Self-heal the frozen bundle geometry: if the source sheet was re-packed since this rig
	// was last synced, re-derive the bundle `.atlas` + page from the live manifest BEFORE we
	// read it, so the preview always reflects the current sheet (no manual `⟳ Re-sync`). A
	// no-op when the geometry is unchanged; leaves the bundle untouched when it has no source.
	await ensureBundleAtlasFresh(clientKey, projectKey, prefix, entry.atlas_file).catch(() => null);

	const atlas = await fetchSpineBundleFile(
		clientKey,
		projectKey,
		entry.folder,
		entry.atlas_file,
		preferPng,
	);
	if (!atlas || typeof atlas.body !== 'string') return null;

	const pageNames = atlasPageNames(atlas.body);
	// A ROTATED-region atlas must serve the bundle's OWN page, which `ensureBundleAtlasFresh`
	// (called above) reorients 180° from the CW-packed source into Spine's CCW `rotate:90`
	// convention. The DEPLOYED sheet page (deploy/sprites/…) is still CW-packed — serving it
	// would render every rotated region upside-down in the editor's spine-webgl runtime, unlike
	// in-game (which loads the reoriented deploy/editor-art bundle copy). Non-rotated atlases
	// keep preferring the latest deploy page (reorientation is a no-op there, so it's byte-safe).
	const pageKeys = atlasHasRotatedRegion(atlas.body)
		? pageNames.map((n) => `${prefix}/${n}`)
		: await resolveSpinePageKeys(pageNames, clientKey, projectKey, prefix);
	return {
		folder: entry.folder,
		format: entry.format,
		runtime: entry.runtime,
		pma: Boolean(entry.pma),
		atlasText: atlas.body,
		skeletonKey: `${prefix}/${entry.skeleton_file}`,
		pageKeys,
		pageNames,
	};
}

/** Animation / skin / slot / bone NAME lists the editor's spine panels turn into dropdowns.
 * The SAME shape the canvas publishes per loaded bundle (`SpineMeta`) — but sourced
 * from the skeleton manifest, not a live render. */
export interface EditorSpineMeta {
	animations: string[];
	skins: string[];
	slots: string[];
	bones: string[];
}

/**
 * Resolve a spine node's `assetKey` to its animation / skin / slot NAME lists by
 * reading the skeleton straight from R2 — the author-facing dropdown source that does
 * NOT depend on a live WebGL render. The canvas only publishes `SpineMeta` once a
 * bundle renders "ready"; a GL hiccup or a marker-only preview never gets there, which
 * left the Properties panel falling back to free-text inputs even though the data
 * exists. JSON / `.irig` skeletons parse directly; a binary `.skel` returns empty
 * lists (only the live render can read those). Returns `null` when the bundle can't be
 * resolved (unknown `assetKey`, no `skeletons.json` entry).
 */
export async function resolveEditorSpineMeta(
	clientKey: string,
	projectKey: string,
	assetKey: string,
): Promise<EditorSpineMeta | null> {
	const descriptor = await resolveEditorSpine(clientKey, projectKey, assetKey, true);
	if (!descriptor) return null;
	const empty: EditorSpineMeta = { animations: [], skins: [], slots: [], bones: [] };
	if (descriptor.format !== 'json') return empty;
	const text = await getObjectText(descriptor.skeletonKey);
	if (!text) return empty;
	try {
		const data = JSON.parse(text) as {
			animations?: Record<string, unknown>;
			skins?: Array<{ name?: unknown }> | Record<string, unknown>;
			slots?: Array<{ name?: unknown }>;
			bones?: Array<{ name?: unknown }>;
		};
		// Spine 4.x writes `skins` as an array of `{ name }` (older exports as an object
		// keyed by skin name); `slots` / `bones` are always arrays of `{ name }`.
		const named = (
			v: Array<{ name?: unknown }> | Record<string, unknown> | undefined,
		): string[] =>
			Array.isArray(v)
				? v.map((e) => e?.name).filter((n): n is string => typeof n === 'string')
				: Object.keys(v ?? {});
		const namedArray = (v: Array<{ name?: unknown }> | undefined): string[] =>
			Array.isArray(v)
				? v.map((e) => e?.name).filter((n): n is string => typeof n === 'string')
				: [];
		return {
			animations: Object.keys(data.animations ?? {}),
			skins: named(data.skins),
			slots: namedArray(data.slots),
			bones: namedArray(data.bones),
		};
	} catch {
		return empty;
	}
}

/** A spine bundle copied into a game-loadable `deploy/` subtree. `key` is the
 * binding/node `assetKey` (the engine's lookup key); `atlas`/`skeleton` are paths
 * relative to `deploy/` (= relative to `static/assets/`). */
export interface ExportedSpineEntry {
	key: string;
	atlas: string;
	skeleton: string;
	scale: number;
	/** GPU-compressed variant: a second `.atlas` whose page refs point at KTX2 (Basis)
	 * twins of the pages, emitted beside the originals when `ENV.KTX2_ENCODE` is on and a
	 * page was large enough to encode. The game swaps `atlas`→`ktx2Atlas` on the low-memory
	 * tier so rig/spine textures load compressed (4× less VRAM). Absent ⇒ the original atlas
	 * loads unchanged (parity). Rig atlas pages are the dominant VRAM cost, so this is where
	 * the big saving lands. */
	ktx2Atlas?: string;
}

export interface ExportedSpineBundle {
	entry: ExportedSpineEntry;
	/** Full R2 keys written under `deployPrefix` — fold into the caller's prune set. */
	written: string[];
}

/**
 * Copy ONE spine bundle (named by a full R2 bundle-prefix `assetKey`) into
 * `<deployPrefix><subtree>/<stem>/…`: the bundle's own atlas + skeleton + page
 * files, names preserved so the atlas's relative page refs resolve once mirrored.
 *
 * The ONE rewrite: a Rigger `.irig` skeleton is shipped under a `.json` name. The
 * game loads spines via `PIXI.Assets.load`, which resolves the skeleton parser by
 * FILE EXTENSION — `.irig` is unknown to it, so a shipped `.irig` loads as `null`
 * and crashes `readSkeletonData`. The bytes are valid Spine JSON, and the `.atlas`
 * never references the skeleton, so renaming is safe.
 *
 * Returns the index entry + the keys written, or `null` when the bundle can't be
 * resolved (unknown `assetKey`, no `skeletons.json` entry, or missing files — e.g.
 * a coded spine key that isn't an R2 bundle). Shared by `symbolExport` +
 * `editorArtExport` so both ship spines identically.
 */
export async function exportSpineBundle(opts: {
	clientKey: string;
	projectKey: string;
	/** Full R2 bundle prefix, e.g. `<client>/<project>/spines/<bundle>/`. */
	assetKey: string;
	/** Deploy root, ending in `/` (e.g. `<client>/<project>/deploy/`). */
	deployPrefix: string;
	/** Subtree under `deploy/` (e.g. `editor-symbols` | `editor-art`). */
	subtree: string;
	/** Caller-claimed, collision-free folder stem for this bundle. */
	stem: string;
	skeletonIndex: SkeletonIndexEntry[];
	/** Spine scale; defaults to {@link EDITOR_SPINE_LOAD_SCALE} (the symbols/editor
	 * convention). The editor preview applies the SAME constant so previews are WYSIWYG. */
	scale?: number;
	/** When supplied, dedup this bundle's atlas PAGES into the shared content-addressed `_pages/`
	 * store (instead of a private copy per bundle), and rewrite the atlas page refs to it — so a
	 * page shared by several rigs / the editor-art sheets loads as ONE GPU texture (fixes the rig
	 * page-duplication VRAM leak). Omitted (e.g. `symbolExport`) ⇒ the per-bundle copy, unchanged. */
	pageStore?: PageStore;
}): Promise<ExportedSpineBundle | null> {
	const { clientKey, projectKey, assetKey, deployPrefix, subtree, stem, skeletonIndex, pageStore } =
		opts;
	const scale = opts.scale ?? EDITOR_SPINE_LOAD_SCALE;
	const written: string[] = [];

	const folder = bundleFromAssetKey(clientKey, projectKey, assetKey);
	if (folder === null) return null;
	const entry = skeletonIndex.find((e) => e.folder === folder);
	if (!entry) return null;

	const prefix = await resolveBundlePrefix(clientKey, projectKey, folder, entry.atlas_file);
	if (!prefix) return null;

	// Ship the CURRENT sheet geometry, not the rig's creation-time snapshot: self-heal the
	// bundle `.atlas` + page from the live manifest before copying it into `deploy/`. Without
	// this a re-packed sheet would ship stale rects to the game even though Symbols/Editor
	// (which self-heal on read) show it correctly — the "shows in editor ≠ ships" trap.
	await ensureBundleAtlasFresh(clientKey, projectKey, prefix, entry.atlas_file).catch(() => null);

	const atlasText = await getObjectText(`${prefix}/${entry.atlas_file}`);
	if (atlasText === null) return null;

	// Confirm the skeleton exists before writing anything (no orphaned atlas on a
	// half-resolved bundle); the bytes themselves never load into this process —
	// they're server-side copied below, keeping peak memory flat.
	const skelSrc = `${prefix}/${entry.skeleton_file}`;
	if (!(await objectExists(skelSrc))) return null;

	const dir = `${subtree}/${stem}`;

	// Skeleton — server-side copy verbatim, but a Rigger `.irig` ships under a `.json`
	// name (PIXI.Assets resolves the parser by extension; `.irig` is unknown), so
	// override the Content-Type for that rename; otherwise the source's is preserved.
	const isIrig = entry.skeleton_file.toLowerCase().endsWith('.irig');
	const skeletonOut = isIrig
		? entry.skeleton_file.replace(/\.irig$/i, '.json')
		: entry.skeleton_file;
	await copyObject(
		skelSrc,
		`${deployPrefix}${dir}/${skeletonOut}`,
		isIrig ? 'application/json' : undefined,
	);
	written.push(`${deployPrefix}${dir}/${skeletonOut}`);

	// Page images the atlas references. With a `pageStore` (editor-art rigs) DEDUP each page into
	// the shared `_pages/` store — a page shared by several rigs / the sheets is copied + encoded
	// ONCE and loads as ONE GPU texture (the rig page-duplication VRAM fix) — and record the
	// shared refs to rewrite the atlas page-name lines below. Without a store (symbolExport) copy
	// the page per-bundle under its own name (the heaviest objects; R2-side copy keeps memory flat)
	// and, when KTX2 is on, encode a compressed twin per page (sequential — the launcher OOM guard).
	const ktx2ByPage = new Map<string, Ktx2Page>(); // pageName -> ktx2 ref + dims (for the .ktx2 atlas)
	const webpByPage = new Map<string, string>(); // pageName -> shared webp ref (deduped only)
	for (const pageName of atlasPageNames(atlasText)) {
		if (pageStore) {
			const ext = /\.(png|webp|jpe?g)$/i.exec(pageName)?.[1].toLowerCase() ?? 'png';
			const shared = await pageStore.ensure(`${prefix}/${pageName}`, ext);
			if (!shared) continue;
			webpByPage.set(pageName, `${PAGE_REF_PREFIX}${shared.file}`);
			if (shared.ktx2File) {
				ktx2ByPage.set(pageName, {
					name: `${PAGE_REF_PREFIX}${shared.ktx2File}`,
					width: shared.ktx2Width,
					height: shared.ktx2Height,
				});
			}
			continue;
		}
		if (!(await copyObject(`${prefix}/${pageName}`, `${deployPrefix}${dir}/${pageName}`))) continue;
		written.push(`${deployPrefix}${dir}/${pageName}`);
		if (!ENV.KTX2_ENCODE) continue;
		const ktx2Name = pageName.replace(/\.(png|webp|jpe?g)$/i, '.ktx2');
		const ktx2Key = `${deployPrefix}${dir}/${ktx2Name}`;
		// Content-cache the compressed twin. `encodePageToKtx2` is a ~9s SYNCHRONOUS wasm call that
		// blocks the event loop, and this export re-runs on EVERY live `/api/editor/runtime`
		// assemble (i.e. every game boot) — re-encoding each page every time pushed the endpoint
		// past its 30s cap and silently dropped games onto stale baked data. A sidecar records the
		// source page's ETag + the encoded dims beside the twin (the page name here is NOT
		// content-hashed, so existence alone is not a sound key), so an unchanged page reuses the
		// existing twin (one HEAD + one small GET, no page bytes, no encode). A changed page (new
		// ETag) re-encodes. The reused keys MUST go into `written` or the caller's prune deletes them.
		const metaKey = `${ktx2Key}.meta.json`;
		const head = await headObject(`${prefix}/${pageName}`);
		const srcEtag = head ? (head.etag ?? `${head.size}:${head.lastModified}`) : null;
		if (srcEtag) {
			const cached = await getObjectText(metaKey);
			if (cached) {
				try {
					const m = JSON.parse(cached) as { etag: string; width: number; height: number };
					if (m.etag === srcEtag && (await objectExists(ktx2Key))) {
						written.push(ktx2Key, metaKey);
						ktx2ByPage.set(pageName, { name: ktx2Name, width: m.width, height: m.height });
						continue;
					}
				} catch {
					// Unparseable sidecar — fall through to a fresh encode.
				}
			}
		}
		const src = await getObjectBytes(`${prefix}/${pageName}`);
		const ktx2 = src ? await encodePageToKtx2(src.body) : null;
		if (!ktx2) continue; // too small or failed => this page stays webp in the ktx2 atlas
		await putObjectBytes(ktx2Key, ktx2.bytes, 'image/ktx2');
		written.push(ktx2Key);
		if (srcEtag) {
			await putObjectText(
				metaKey,
				JSON.stringify({ etag: srcEtag, width: ktx2.width, height: ktx2.height }),
				'application/json',
			);
			written.push(metaKey);
		}
		ktx2ByPage.set(pageName, { name: ktx2Name, width: ktx2.width, height: ktx2.height });
	}

	// WEBP atlas: when pages were deduped, rewrite each page-name line to its shared `_pages/` ref
	// (region coords unchanged — the WebP page keeps full resolution); otherwise copy verbatim.
	// A region name never carries a page extension, so the trimmed-line swap can't hit one.
	const webpAtlas =
		webpByPage.size > 0
			? atlasText
					.split(/\r?\n/)
					.map((line) => webpByPage.get(line.trim()) ?? line)
					.join('\n')
			: atlasText;
	await putObjectText(
		`${deployPrefix}${dir}/${entry.atlas_file}`,
		webpAtlas,
		'text/plain; charset=utf-8',
	);
	written.push(`${deployPrefix}${dir}/${entry.atlas_file}`);

	// Emit a second `.atlas` pointing at the KTX2 twins (falling back to the original page for
	// any that weren't encoded). A downscaled page also has its region coords rescaled so UVs
	// stay identical (see `rewriteAtlasForKtx2`). The game loads it on the low-memory tier.
	let ktx2Atlas: string | undefined;
	if (ktx2ByPage.size > 0) {
		const rewritten = rewriteAtlasForKtx2(atlasText, ktx2ByPage);
		const ktx2AtlasFile = entry.atlas_file.replace(/\.atlas$/i, '.ktx2.atlas');
		await putObjectText(
			`${deployPrefix}${dir}/${ktx2AtlasFile}`,
			rewritten,
			'text/plain; charset=utf-8',
		);
		written.push(`${deployPrefix}${dir}/${ktx2AtlasFile}`);
		ktx2Atlas = `${dir}/${ktx2AtlasFile}`;
	}

	return {
		entry: {
			key: assetKey,
			atlas: `${dir}/${entry.atlas_file}`,
			skeleton: `${dir}/${skeletonOut}`,
			scale,
			ktx2Atlas,
		},
		written,
	};
}
