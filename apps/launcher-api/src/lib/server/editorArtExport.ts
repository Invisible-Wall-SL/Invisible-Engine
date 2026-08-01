/**
 * Export the art a project's editor LayoutDoc references into the game-loadable
 * `deploy/editor-art/` subtree, closing the "placed it in the editor but the
 * shipped game shows nothing" gap (docs/design/live-assets.md).
 *
 * The editor renders sprites straight from R2 atlas MANIFESTS (`SpriteNode.assetKey`
 * is a manifest key), but a game resolves textures only from spritesheets it
 * loaded. This walks the doc + its referenced ComponentDefs, and for every
 * referenced manifest writes a TexturePacker json-hash spritesheet (frames keyed
 * by the editor's region names — the exact keys `LayoutNodeView` looks up) plus a
 * copy of the packed page, under:
 *
 *   <client>/<project>/deploy/editor-art/<stem>/<stem>.{json,png|webp}
 *   <client>/<project>/deploy/editor-art/index.json   ← list the game registers
 *
 * The existing transport then carries it: `bake-editor-doc.mjs` triggers this and
 * embeds the index in the baked bundle; `pull-project-assets.mjs` mirrors
 * `deploy/` → `static/assets/`; the game's `bakedEditorArtAssets()` registers
 * each sheet. Stale `editor-art/` objects from a previous export are pruned.
 *
 * Editor-placed SPINE nodes ride the same chain: each referenced bundle is copied
 * (via the shared `exportSpineBundle`, which also renames a Rigger `.irig` skeleton
 * to `.json`) and listed in `index.spines`, which the game registers as a spine
 * asset under the node's `assetKey` — the same value `LayoutNodeView` looks up.
 *
 * Spine bundles a componentInstance references through a `spine`-KIND PARAM (the Win
 * Overlay's `winSpine`, the free-spin visuals' `introSpine`/`outroSpine`, …) ride the
 * SAME chain — discovered generically off `ComponentParam.kind === 'spine'` (def
 * defaults + instance overrides). A spine param stores the bundle NAME (not a full
 * assetKey), so its name is reconstructed into a project-rooted assetKey for the shared
 * export path and registered back under the NAME — the exact value `<SpineProvider
 * key={…}>` looks up. A coded/game-bundled default (`bigwin`, `fsIntroNumber`) has no
 * R2 bundle, so it resolves to nothing and is skipped (the game registers it itself).
 */
import type { ComponentDef, LayoutDoc, LayoutNode } from 'engine-layout';
import {
	collectComponentIds,
	collectComponentPins,
	isBuiltinRegion,
	parseScopedFrameRef,
} from 'engine-layout';
import { EDITOR_SPINE_LOAD_SCALE } from '$lib/spineScale';
import { sheetVersion } from './assetVersion';
import { loadComponent } from './componentStorage';
import { loadDoc } from './editorStorage';
import { clipFrameRefs, clipSheetKeys } from 'engine-flipbook';
import { loadFlipbookDoc } from './flipbookStorage';
import { listEffects, loadEffect } from './fxStorage';
import { loadRegionSet, type EditorRegionSet } from './editorRegions';
import { listProjectAssets } from './projectAssets';
import { SUB } from './projectPaths';
import {
	bundleFromAssetKey,
	exportSpineBundle,
	loadSkeletonIndex,
	type ExportedSpineEntry,
} from './spine';
import {
	copyObject,
	deleteObjects,
	getObjectBytes,
	listAllKeys,
	putObjectBytes,
	putObjectText,
} from './r2';
import { ENV } from './env';
import { encodePageToKtx2 } from './ktx2Encode';

export interface EditorArtSheet {
	/** The manifest R2 key the doc references (`SpriteNode.assetKey`). */
	key: string;
	/** Spritesheet JSON path relative to `deploy/` (= relative to `static/assets/`). */
	json: string;
	frames: number;
	/** GPU-compressed variant: a second spritesheet JSON whose `meta.image` points at the
	 * KTX2 (Basis Universal) page emitted beside the WebP/PNG. Present only when the page
	 * was large enough to encode; the game prefers it (4–8× less VRAM) unless `?quality=high`.
	 * Absent ⇒ the game loads `json` exactly as before (parity). */
	ktx2Json?: string;
}

export interface EditorArtImage {
	/** The image R2 key the doc references (`SpriteNode.assetKey`, no region) —
	 * also the game's lookup key, so the asset entry is registered under it. */
	key: string;
	/** Image path relative to `deploy/` (= relative to `static/assets/`). */
	file: string;
	/** GPU-compressed KTX2 (Basis Universal) variant of the page, emitted beside `file`
	 * when the image was large enough to encode. The game prefers it unless `?quality=high`;
	 * absent ⇒ `file` loads as before (parity). */
	ktx2?: string;
}

/** A region name that appears in MORE THAN ONE exported sheet. Harmless now that
 * each sheet is registered scoped by its manifest, but surfaced as a build warning
 * because it usually means a superseded sheet (e.g. the 2D original behind a 3D
 * remake) is still referenced and could be retired. */
export interface EditorArtCollision {
	region: string;
	/** Stems (folder names under `editor-art/`) of the sheets sharing this name. */
	sheets: string[];
	/** Whether the colliding name is actually placed by the doc (vs only packed). */
	used: boolean;
}

/** A spine bundle an editor-doc `spine` node references. `key` is the node's full
 * R2 bundle-prefix `assetKey` (the engine's lookup key, as `LayoutNodeView` passes
 * it to `<SpineProvider>`). */
export type EditorArtSpine = ExportedSpineEntry;

export interface EditorArtIndex {
	sheets: EditorArtSheet[];
	images: EditorArtImage[];
	spines: EditorArtSpine[];
	collisions: EditorArtCollision[];
	/** Region names the doc PLACES that no exported sheet packs — so they never
	 *  reach the game's `loadedAssets` and the sprite renders blank ("… is not found
	 *  in the loadedAssets"). Surfaced as a build/boot warning (the dangling-binding
	 *  guard) so a re-authored atlas that dropped/renamed a placed region is caught at
	 *  publish instead of silently in-game. */
	missing: string[];
	/** Per Invisible Flipbook clip, the frames no shipped sheet packs. A subset of `missing`,
	 *  attributed to its clip — the bake BAILS on this instead of warning (design doc
	 *  §"What this design does about it" #2): a dangling sprite region renders an invisible
	 *  node, but a dangling clip frame silently SHORTENS an animation that still plays and
	 *  still looks plausible, so it must not be shippable. Empty when nothing dangles. */
	clipMissing: { clipId: string; frames: string[] }[];
}

/** A doc `assetKey` that names an R2 atlas/sheet manifest (vs a game-bundled
 * key like `symbolsStatic`, which the game already loads itself). */
function isManifestAssetKey(assetKey: unknown): assetKey is string {
	return typeof assetKey === 'string' && assetKey.includes('/') && assetKey.endsWith('.json');
}

/** A doc `assetKey` that is a standalone R2 image (a dropped atlas PAGE — a
 * sprite node with no `region`). The game looks these up by the full key. */
function isImageAssetKey(assetKey: unknown): assetKey is string {
	return (
		typeof assetKey === 'string' && assetKey.includes('/') && /\.(png|webp|jpe?g)$/i.test(assetKey)
	);
}

interface ArtRefs {
	manifestKeys: Set<string>;
	imageKeys: Set<string>;
	/** `spine`-node `assetKey`s (full R2 bundle prefixes). A coded spine key (no R2
	 * bundle) resolves to nothing in `exportSpineBundle` and is skipped there. */
	spineKeys: Set<string>;
	/** Bundle NAMES referenced by `spine`-kind component params (def defaults + instance
	 * overrides). A param stores the bare bundle name (`EditorProperties` `<option
	 * value={s.name}>`), not an assetKey, so each is reconstructed into a project-rooted
	 * assetKey below and registered back under the NAME. A game-bundled name (`bigwin`,
	 * `fsIntroNumber`) has no R2 bundle and is skipped in `exportSpineBundle`. */
	spineNames: Set<string>;
	/** Region names referenced ONLY by name (image-kind component params) — their
	 * containing manifest must be found among the project's atlases. */
	regionNames: Set<string>;
	/** Every region a sprite node actually places (for the collision report's
	 * `used` flag) — a superset of `regionNames`. */
	usedRegions: Set<string>;
}

function walkNodes(nodes: LayoutNode[], visit: (node: LayoutNode) => void): void {
	for (const node of nodes) {
		visit(node);
		if (node.kind === 'container') walkNodes(node.children, visit);
	}
}

/** Record an image-kind param value. A SCOPED ref (`<assetKey>::<region>`, from the
 * region picker) pins the source atlas — export that exact manifest. A legacy BARE
 * name carries no atlas, so it joins the name-guess pool resolved against the project's
 * atlases below. Either way the region counts as "used" for the collision report. */
function addImageRef(refs: ArtRefs, value: string): void {
	const { assetKey, region } = parseScopedFrameRef(value);
	if (assetKey) {
		refs.manifestKeys.add(assetKey);
		refs.usedRegions.add(region);
	} else {
		refs.regionNames.add(value);
	}
}

/** Collect every art reference in the doc + the defs' roots: sprite-node manifest
 * keys, and frames set through image-kind params (instance overrides and def
 * defaults) — scoped refs pin their atlas, bare names are resolved by name below. */
function collectArtRefs(doc: LayoutDoc, defs: Record<string, ComponentDef>): ArtRefs {
	const refs: ArtRefs = {
		manifestKeys: new Set(),
		imageKeys: new Set(),
		spineKeys: new Set(),
		spineNames: new Set(),
		regionNames: new Set(),
		usedRegions: new Set(),
	};
	const imageParamKeys = new Map<string, Set<string>>();
	const spineParamKeys = new Map<string, Set<string>>();
	for (const [id, def] of Object.entries(defs)) {
		const imgKeys = new Set<string>();
		const spineKeys = new Set<string>();
		for (const p of def.params ?? []) {
			if (p.kind === 'image') {
				imgKeys.add(p.key);
				if (typeof p.default === 'string' && p.default) addImageRef(refs, p.default);
			} else if (p.kind === 'spine') {
				spineKeys.add(p.key);
				if (typeof p.default === 'string' && p.default) refs.spineNames.add(p.default);
			}
		}
		imageParamKeys.set(id, imgKeys);
		spineParamKeys.set(id, spineKeys);
	}

	const visit = (node: LayoutNode): void => {
		if (node.kind === 'sprite' && typeof node.region === 'string' && node.region) {
			refs.usedRegions.add(node.region);
		}
		if (node.kind === 'sprite' && isManifestAssetKey(node.assetKey)) {
			refs.manifestKeys.add(node.assetKey);
		} else if (node.kind === 'sprite' && !node.region && isImageAssetKey(node.assetKey)) {
			refs.imageKeys.add(node.assetKey);
		} else if (node.kind === 'spine' && typeof node.assetKey === 'string' && node.assetKey) {
			refs.spineKeys.add(node.assetKey);
		}
		if (node.kind === 'componentInstance' && node.params) {
			const imgKeys = imageParamKeys.get(node.componentId);
			const spineKeys = spineParamKeys.get(node.componentId);
			for (const [k, v] of Object.entries(node.params)) {
				if (typeof v !== 'string' || !v) continue;
				if (imgKeys?.has(k)) addImageRef(refs, v);
				else if (spineKeys?.has(k)) refs.spineNames.add(v);
			}
		}
	};

	for (const scene of doc.scenes) walkNodes(scene.nodes, visit);
	for (const def of Object.values(defs)) walkNodes([def.root], visit);
	// Regions referenced by name through image params are "used" too.
	for (const n of refs.regionNames) refs.usedRegions.add(n);
	return refs;
}

/** Resolve the doc's referenced ComponentDefs (same precedence walk as the
 * `/api/editor/doc?components=1` bake — built-in → shared → project). */
async function resolveReferencedDefs(
	doc: LayoutDoc,
	projectKey: string,
): Promise<Record<string, ComponentDef>> {
	const defs: Record<string, ComponentDef> = {};
	const seen = new Set<string>();
	const queue = collectComponentIds(doc.scenes.flatMap((scene) => scene.nodes));
	while (queue.length) {
		const id = queue.shift()!;
		if (seen.has(id)) continue;
		seen.add(id);
		const def = await loadComponent(id, projectKey);
		if (!def) continue;
		defs[id] = def;
		for (const nested of collectComponentIds([def.root])) {
			if (!seen.has(nested)) queue.push(nested);
		}
	}
	// Also walk PINNED component versions the game actually renders — mirror the doc bake
	// (`/api/editor/doc?components=1`, which ships `componentVersions` via `collectComponentPins`).
	// An instance pinned to a non-latest version renders THAT version's nodes, so its atlas art
	// must be exported from that version, not just latest. Without this the exporter and the doc
	// bake drift: the game asks for the pinned version's sheet, only latest's was written to
	// `deploy/editor-art/`, and the pinned sprites render black. Keyed by `id@version` so a pinned
	// def is walked in addition to (not replacing) latest. Nested pins inside a pinned version are
	// resolved against latest, matching the doc bake's scope.
	for (const pin of collectComponentPins(doc.scenes.flatMap((scene) => scene.nodes))) {
		if (defs[pin.id]?.version === pin.version) continue;
		const pinned = await loadComponent(pin.id, projectKey, pin.version);
		if (pinned) defs[`${pin.id}@${pin.version}`] = pinned;
	}
	return defs;
}

/** `atlas_manifest_S_StaticElements.json` → `S_StaticElements` (a safe folder/file stem). */
function stemFromManifestKey(manifestKey: string): string {
	const base = manifestKey.slice(manifestKey.lastIndexOf('/') + 1).replace(/\.json$/i, '');
	const stripped = base.replace(/^atlas_manifest_/i, '');
	const safe = stripped.replace(/[^a-zA-Z0-9_-]/g, '_');
	return safe || 'sheet';
}

interface TexturePackerFrame {
	frame: { x: number; y: number; w: number; h: number };
	rotated: boolean;
	trimmed: boolean;
	spriteSourceSize: { x: number; y: number; w: number; h: number };
	sourceSize: { w: number; h: number };
}

/** Build the TexturePacker json-hash the engine's `sprites` loader parses, with frames keyed
 * EXACTLY by the editor region names (`SpriteNode.region` values). `sx`/`sy` scale EVERY pixel
 * coordinate — used for the KTX2 variant when its page was downscaled, so the frame rects match
 * the smaller page (identical UVs ⇒ sprites render at the same size, just lower-res). Default 1
 * ⇒ full-res, byte-identical to before. */
function toTexturePackerJson(set: EditorRegionSet, pageFile: string, sx = 1, sy = 1): string {
	const frames: Record<string, TexturePackerFrame> = {};
	const rx = (n: number) => Math.round(n * sx);
	const ry = (n: number) => Math.round(n * sy);
	for (const r of set.regions) {
		const origW = r.origW ?? r.w;
		const origH = r.origH ?? r.h;
		const offX = r.offX ?? 0;
		const offY = r.offY ?? 0;
		frames[r.name] = {
			frame: { x: rx(r.x), y: ry(r.y), w: rx(r.w), h: ry(r.h) },
			rotated: r.rotated === true,
			trimmed: offX !== 0 || offY !== 0 || origW !== r.w || origH !== r.h,
			spriteSourceSize: { x: rx(offX), y: ry(offY), w: rx(r.w), h: ry(r.h) },
			sourceSize: { w: rx(origW), h: ry(origH) },
		};
	}
	return JSON.stringify(
		{
			frames,
			meta: {
				app: 'invisible-editor-art-export',
				format: 'RGBA8888',
				image: pageFile,
				scale: '1',
				size: { w: rx(set.pageWidth), h: ry(set.pageHeight) },
			},
		},
		null,
		'\t',
	);
}

/**
 * Encode the packed page to a KTX2 twin (opt-in via `ENV.KTX2_ENCODE`) and write it +
 * a second spritesheet JSON that points `meta.image` at it, both under `deploy/editor-art/`.
 * Returns the two `deploy/`-relative paths (page + json) so the caller records them in the
 * art index (`sheet.ktx2Json`) and the write-set (so pruning keeps them). Returns null when
 * encoding is off or the page is skipped/failed ⇒ the game loads the WebP/PNG (parity).
 *
 * The `.ktx2` page may be DOWNSCALED (an over-large page), so the spritesheet JSON frame rects
 * are rescaled by the same factor — identical UVs, so sprites render at the same size (lower-res).
 */
async function encodeSheetKtx2(
	pageKey: string,
	deployPrefix: string,
	stem: string,
	version: string,
	set: EditorRegionSet,
): Promise<{ pageRel: string; jsonRel: string } | null> {
	if (!ENV.KTX2_ENCODE) return null;
	const page = await getObjectBytes(pageKey);
	if (!page) return null;
	const ktx2 = await encodePageToKtx2(page.body);
	if (!ktx2) return null;
	// Scale the frame rects to the (possibly downscaled) ktx2 page so UVs stay identical.
	const sx = set.pageWidth ? ktx2.width / set.pageWidth : 1;
	const sy = set.pageHeight ? ktx2.height / set.pageHeight : 1;
	const ktx2File = `${stem}.${version}.ktx2`;
	const pageRel = `editor-art/${stem}/${ktx2File}`;
	const jsonRel = `editor-art/${stem}/${stem}.${version}.ktx2.json`;
	await putObjectBytes(`${deployPrefix}${pageRel}`, ktx2.bytes, 'image/ktx2');
	await putObjectText(
		`${deployPrefix}${jsonRel}`,
		toTexturePackerJson(set, ktx2File, sx, sy),
		'application/json',
	);
	return { pageRel, jsonRel };
}

/**
 * Export every atlas the project's layout doc (and its component defs) reference
 * into `deploy/editor-art/`, prune leftovers from a previous export, and write
 * the `index.json` the game build registers. Idempotent — re-running converges.
 */
export async function exportEditorArt(
	clientKey: string,
	projectKey: string,
): Promise<EditorArtIndex> {
	const doc = (await loadDoc(clientKey, projectKey)) as LayoutDoc;
	const defs = await resolveReferencedDefs(doc, projectKey);
	const refs = collectArtRefs(doc, defs);

	// Also ship the atlases the project's Invisible FX EFFECTS reference. An EffectDoc's particle
	// art is an atlas the game must load, but effects ship independently of the layout (every effect
	// ships; a placed `effect` node AND `Effects.svelte` both play them), so those atlases would
	// otherwise NOT be in `refs.manifestKeys` unless the layout ALSO placed them as a sprite — the
	// old "place the effect AND its atlas" trap. Add each effect layer's manifest `art.assetKey` so a
	// placed/mounted effect's particles have textures in-game with no extra step. Best-effort: a
	// listing/parse failure must never break the editor-art export.
	try {
		for (const row of await listEffects(clientKey, projectKey)) {
			const { doc: effectDoc } = await loadEffect(clientKey, projectKey, row.id);
			for (const layer of effectDoc.layers) {
				const assetKey = layer.art?.assetKey;
				if (!assetKey || !isManifestAssetKey(assetKey)) continue;
				refs.manifestKeys.add(assetKey);
				// Count this layer's FRAME names as used regions too, so a frame that no atlas packs
				// any more shows up in `index.missing` like a dangling sprite region. Without this the
				// dangling guard below is structurally blind to FX art: a renamed/deleted frame is
				// reported NOWHERE (not export, bake, or boot) and degrades silently at runtime —
				// `EffectLayer` drops missing frames from the array, and if ALL are gone
				// `ParticleEmitter` falls back to binding the WHOLE sheet, spraying wrong textures.
				// Guarded on a MANIFEST assetKey: that's what queues the sheet for export above, so a
				// non-manifest layer's frames would otherwise report dangling spuriously.
				for (const frame of layer.art?.frames ?? []) {
					if (frame) refs.usedRegions.add(frame);
				}
			}
		}
	} catch {
		// Effects are additive art — never let them break the sprite/spine export.
	}

	// Same idea for Invisible Flipbook CLIPS: an ordered run of frames, each either a bare region
	// name (resolved against the clip's primary `assetKey`) or an atlas-scoped `<assetKey>::<region>`
	// ref — because a real multipacked export interleaves an animation across several pages. Ship
	// EVERY sheet a clip touches (`clipSheetKeys`), not just its primary, or a four-page clip would
	// ship one page and silently lose three quarters of its frames.
	//
	// Note `usedRegions` takes the PARSED region, never the raw entry: a scoped entry contains
	// `::` and would never match a covered region name, so every scoped frame would report as
	// dangling. Validation itself is per-sheet (see `clipRefs` below), which the flat
	// `coveredRegions` can't express.
	//
	// A clip's degradation is nastier than a sprite's: a missing sprite region draws nothing
	// (obvious), but a missing clip frame silently SHORTENS an animation that still plays and
	// still looks plausible — which is why the bake treats `clipMissing` as FATAL. Best-effort:
	// a listing/parse failure must never break the editor-art export.
	const clipRefs: {
		clipId: string;
		refs: { assetKey: string; region: string; entry: string }[];
	}[] = [];
	try {
		for (const clip of (await loadFlipbookDoc(clientKey, projectKey)).clips) {
			for (const key of clipSheetKeys(clip)) {
				if (isManifestAssetKey(key)) refs.manifestKeys.add(key);
			}
			const frameRefs = clipFrameRefs(clip).filter((r) => !!r.region);
			for (const r of frameRefs) refs.usedRegions.add(r.region);
			clipRefs.push({ clipId: clip.id, refs: frameRefs });
		}
	} catch {
		// Clips are additive art — never let them break the sprite/spine export.
	}

	const deployPrefix = `${SUB.deploy(clientKey, projectKey)}/`;
	const artPrefix = `${deployPrefix}editor-art/`;

	const sheets: EditorArtSheet[] = [];
	const written = new Set<string>();
	const usedStems = new Set<string>();
	const coveredRegions = new Set<string>();
	const exported = new Set<string>();
	/** Region names per exported sheet (by stem) — used to detect cross-sheet name
	 * collisions for the build warning. */
	const sheetRegionNames: { stem: string; names: string[] }[] = [];
	/** Covered regions keyed by MANIFEST, so a clip frame can be validated against the sheet it
	 * actually names. The flat `coveredRegions` above is sheet-blind: a clip scoped to page 1
	 * would be satisfied by a same-named region on page 0 and the dangling frame would slip
	 * through — precisely the cross-sheet mix-up scoped refs exist to prevent. */
	const coveredBySheet = new Map<string, Set<string>>();

	const exportManifest = async (
		manifestKey: string,
		preloaded?: EditorRegionSet,
	): Promise<void> => {
		if (exported.has(manifestKey)) return;
		exported.add(manifestKey);
		const set = preloaded ?? (await loadRegionSet(manifestKey, clientKey, projectKey));
		if (set.regions.length === 0 || !set.pageKey) return;

		let stem = stemFromManifestKey(manifestKey);
		for (let i = 2; usedStems.has(stem); i++) stem = `${stemFromManifestKey(manifestKey)}_${i}`;

		// Stamp a content hash into the filenames so a re-authored atlas ships at a NEW
		// URL the cache can't serve stale (see assetVersion.ts). Null = source page gone.
		const version = await sheetVersion(set);
		if (!version) return;

		// Carry the page's REAL extension. The page is copied byte-for-byte below, so defaulting
		// anything non-`.webp` to `png` shipped a mislabelled file whenever the source wasn't a
		// PNG — and `isImageAssetKey` above accepts `.jpg`/`.jpeg`, so the two halves disagreed.
		// PIXI picks its loader by extension, so the lie only surfaces in the game.
		const pageExt = /\.(png|webp|jpe?g)$/i.exec(set.pageKey)?.[1].toLowerCase() ?? 'png';
		const pageFile = `${stem}.${version}.${pageExt}`;
		const jsonRel = `editor-art/${stem}/${stem}.${version}.json`;
		const pageRel = `editor-art/${stem}/${pageFile}`;

		// Server-side copy the packed page verbatim (no bytes through this process —
		// keeps peak memory flat); a missing source is skipped (the manifest is dropped).
		if (!(await copyObject(set.pageKey, `${deployPrefix}${pageRel}`))) return;
		usedStems.add(stem);
		await putObjectText(
			`${deployPrefix}${jsonRel}`,
			toTexturePackerJson(set, pageFile),
			'application/json',
		);
		written.add(`${deployPrefix}${jsonRel}`);
		written.add(`${deployPrefix}${pageRel}`);
		// GPU-compressed KTX2 twin (opt-in via ENV.KTX2_ENCODE). Encode the page to a `.ktx2`
		// beside the WebP/PNG and write a SECOND spritesheet JSON whose `meta.image` points at
		// it (identical frame rects — same page dimensions), so the game can register the
		// compressed variant through the same `sprites` loader for 4–8× less VRAM. A skipped
		// page (encoder off, too big/small, or any failure) leaves `ktx2Json` unset ⇒ the game
		// ships the WebP/PNG unchanged (parity). Reads page bytes through this process only when
		// enabled, so a normal export stays memory-flat.
		const ktx2 = await encodeSheetKtx2(set.pageKey, deployPrefix, stem, version, set);
		if (ktx2) {
			written.add(`${deployPrefix}${ktx2.pageRel}`);
			written.add(`${deployPrefix}${ktx2.jsonRel}`);
		}
		sheets.push({
			key: manifestKey,
			json: jsonRel,
			frames: set.regions.length,
			ktx2Json: ktx2?.jsonRel,
		});
		sheetRegionNames.push({ stem, names: set.regions.map((r) => r.name) });
		for (const r of set.regions) coveredRegions.add(r.name);
		coveredBySheet.set(manifestKey, new Set(set.regions.map((r) => r.name)));
	};

	for (const manifestKey of refs.manifestKeys) {
		await exportManifest(manifestKey);
	}

	// Image-kind params reference regions by NAME only — locate each missing one
	// among the project's atlases and export its containing sheet too.
	const missing = new Set([...refs.regionNames].filter((n) => !coveredRegions.has(n)));
	if (missing.size > 0) {
		const { atlases } = await listProjectAssets(clientKey, projectKey);
		for (const atlas of atlases) {
			if (missing.size === 0) break;
			if (atlas.kind !== 'atlas-manifest' || exported.has(atlas.key)) continue;
			const set = await loadRegionSet(atlas.key, clientKey, projectKey);
			if (set.regions.some((r) => missing.has(r.name))) {
				await exportManifest(set.assetKey, set);
				for (const n of [...missing]) if (coveredRegions.has(n)) missing.delete(n);
			} else {
				exported.add(atlas.key);
			}
		}
	}

	// Standalone images (dropped atlas PAGES): copy verbatim; the game registers a
	// single-texture asset under the node's full assetKey so the lookup matches.
	const images: EditorArtImage[] = [];
	for (const imageKey of refs.imageKeys) {
		const base = imageKey.slice(imageKey.lastIndexOf('/') + 1).replace(/[^a-zA-Z0-9._-]/g, '_');
		let file = `editor-art/img/${base}`;
		for (let i = 2; written.has(`${deployPrefix}${file}`); i++) {
			file = `editor-art/img/${i}_${base}`;
		}
		// Server-side copy the page image verbatim (memory-flat); skip a missing source.
		if (!(await copyObject(imageKey, `${deployPrefix}${file}`))) continue;
		written.add(`${deployPrefix}${file}`);
		// GPU-compressed KTX2 twin (opt-in). A standalone image is a single texture, so it
		// needs no spritesheet JSON — the game registers the `.ktx2` directly and `loadKTX2`
		// handles it by extension. Skipped/failed ⇒ `ktx2` unset ⇒ the WebP/PNG ships (parity).
		let ktx2File: string | undefined;
		if (ENV.KTX2_ENCODE) {
			const src = await getObjectBytes(imageKey);
			const ktx2 = src ? await encodePageToKtx2(src.body) : null;
			if (ktx2) {
				// A standalone image is a whole-texture sprite (no atlas coords), so a downscale
				// just lowers its resolution — the node transform still sizes it in-game.
				ktx2File = file.replace(/\.(png|webp|jpe?g)$/i, '.ktx2');
				await putObjectBytes(`${deployPrefix}${ktx2File}`, ktx2.bytes, 'image/ktx2');
				written.add(`${deployPrefix}${ktx2File}`);
			}
		}
		images.push({ key: imageKey, file, ktx2: ktx2File });
	}

	// Spine bundles: copy each referenced bundle into deploy/editor-art/ via the shared
	// helper (atlas + skeleton + pages; a Rigger `.irig` skeleton is shipped as `.json`
	// so PIXI's loader can parse it). Two reference kinds feed one export path:
	//   - NODES store the full R2 bundle-prefix `assetKey`;
	//   - `spine`-kind component PARAMS store the bare bundle NAME (`refs.spineNames`),
	//     reconstructed here into a project-rooted assetKey so `bundleFromAssetKey` →
	//     `resolveBundlePrefix` (inside `exportSpineBundle`) finds the files, whether the
	//     bundle lives in the project or the shared `_shared/spines/` root.
	// Either way the entry registers under the plain bundle NAME: for a node that is its
	// `assetKey` rewritten by `resolveSpineKeysForGame` (`runtimeBundle.ts` +
	// `api/editor/doc`) and handed to `<SpineProvider>` by `LayoutNodeView`; for a param it
	// is the value stored, the exact key `<SpineProvider key={…}>` looks up (e.g. the win
	// overlay's `winSpine`). A coded/game-bundled key (no R2 bundle — `bigwin`,
	// `fsIntroNumber`) resolves to nothing and is skipped (the game registers it itself).
	// Stems share the `usedStems` pool with the sheets so a spine/sheet name clash can't
	// collide.
	const spines: EditorArtSpine[] = [];
	const spineAssetKeys = [
		...refs.spineKeys,
		...[...refs.spineNames].map((name) => `${SUB.spines(clientKey, projectKey)}/${name}/`),
	];
	if (spineAssetKeys.length > 0) {
		const skeletonIndex = await loadSkeletonIndex(clientKey, projectKey);
		const exportedSpines = new Set<string>();
		const spineStem = (assetKey: string): string => {
			const base = assetKey.replace(/\/$/, '');
			const tail = base.slice(base.lastIndexOf('/') + 1).replace(/[^a-zA-Z0-9_-]/g, '_');
			return tail || 'spine';
		};
		for (const assetKey of spineAssetKeys) {
			// Dedup by the REGISTRATION key (the bundle NAME) so a bundle referenced by BOTH a
			// node (full assetKey) and a param (name → synthetic assetKey) exports once; a coded
			// key with no R2 bundle falls back to its assetKey.
			const gameKey = bundleFromAssetKey(clientKey, projectKey, assetKey);
			const dedupKey = gameKey ?? assetKey;
			if (exportedSpines.has(dedupKey)) continue;
			exportedSpines.add(dedupKey);
			let stem = spineStem(assetKey);
			for (let i = 2; usedStems.has(stem); i++) stem = `${spineStem(assetKey)}_${i}`;
			usedStems.add(stem);
			const result = await exportSpineBundle({
				clientKey,
				projectKey,
				assetKey,
				deployPrefix,
				subtree: 'editor-art',
				stem,
				skeletonIndex,
				scale: EDITOR_SPINE_LOAD_SCALE,
			});
			if (!result) continue;
			// Register under the plain bundle NAME — not the full prefix — or the runtime
			// lookup misses and the spine never loads in the built game.
			if (gameKey) result.entry.key = gameKey;
			for (const k of result.written) written.add(k);
			spines.push(result.entry);
		}
	}

	// Cross-sheet region-name collisions. Each sheet is registered scoped by its
	// manifest so a collision no longer mis-renders, but it usually flags a stale
	// sheet (e.g. a 2D original still referenced behind a 3D remake) worth retiring.
	const regionToStems = new Map<string, Set<string>>();
	for (const { stem, names } of sheetRegionNames) {
		for (const name of names) {
			let stems = regionToStems.get(name);
			if (!stems) regionToStems.set(name, (stems = new Set()));
			stems.add(stem);
		}
	}
	const collisions: EditorArtCollision[] = [];
	for (const [region, stems] of regionToStems) {
		if (stems.size >= 2) {
			collisions.push({
				region,
				sheets: [...stems].sort(),
				used: refs.usedRegions.has(region),
			});
		}
	}
	collisions.sort((a, b) => a.region.localeCompare(b.region));

	// Dangling-binding guard: a region the doc places that no exported sheet packs
	// never reaches `loadedAssets` → the sprite renders blank in-game. Report it so a
	// re-authored atlas that dropped/renamed a placed region is caught (bake warns; the
	// engine warns at boot) instead of surfacing only as a runtime lookup miss. Image
	// keys (standalone dropped pages) resolve by full assetKey, not a region name, so
	// they're excluded — only frame/region references can dangle this way.
	//
	// The engine's BUILT-IN regions are excluded too (`isBuiltinRegion`). They are the
	// coded-default art of the built-in components — `Frame_FSCounter.png` on the
	// free-spin counter, the `progressBar*.png` trio on the loading bar — and every game
	// app bundles + registers their sheets (`static/assets/sprites/{reelsFrame,progressBar}`
	// in `game/assets.ts`), so they ARE in `loadedAssets` at runtime and render correctly.
	// This guard only knows about R2 atlases, so it used to report all four as "in NO
	// shipped atlas and will render blank" on every project — a false alarm that pointed
	// authors at re-packing an atlas for art that was never missing.
	const danglingRegions = [...refs.usedRegions]
		.filter((r) => !coveredRegions.has(r) && !isBuiltinRegion(r))
		.sort();

	// The same guard, attributed PER CLIP — because the bake BAILS on this rather than warning.
	// A flat name list can't tell an author which animation broke, and unlike a blank sprite a
	// short clip still plays and still looks plausible, so the report has to name the clip.
	//
	// Validated PER SHEET, not against the flat `coveredRegions`: a frame scoped to page 1 must
	// not be satisfied by a same-named region on page 0. A sheet that never exported (missing
	// page, unreadable manifest) has no entry, so every frame naming it correctly reports as
	// missing rather than silently passing. Reported as AUTHORED (`entry`) so the message names
	// the sheet the author actually referenced.
	const clipMissing = clipRefs
		.map(({ clipId, refs: frameRefs }) => ({
			clipId,
			frames: [
				...new Set(
					frameRefs
						.filter((r) => !(coveredBySheet.get(r.assetKey)?.has(r.region) ?? false))
						.map((r) => r.entry),
				),
			].sort(),
		}))
		.filter((c) => c.frames.length > 0)
		.sort((a, b) => a.clipId.localeCompare(b.clipId));

	const index: EditorArtIndex = {
		sheets,
		images,
		spines,
		collisions,
		missing: danglingRegions,
		clipMissing,
	};
	const indexKey = `${artPrefix}index.json`;
	await putObjectText(indexKey, JSON.stringify(index, null, '\t'), 'application/json');
	written.add(indexKey);

	// Prune leftovers from a previous export so deploy/editor-art/ mirrors the doc.
	const existing = await listAllKeys(artPrefix);
	const stale = existing.filter((k) => !written.has(k));
	await deleteObjects(stale);

	return index;
}
