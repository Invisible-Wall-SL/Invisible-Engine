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
 */
import type { ComponentDef, LayoutDoc, LayoutNode } from 'engine-layout';
import { collectComponentIds, parseScopedFrameRef } from 'engine-layout';
import { SPINE_LOAD_SCALE } from '$lib/spineScale';
import { loadComponent } from './componentStorage';
import { loadDoc } from './editorStorage';
import { loadRegionSet, type EditorRegionSet } from './editorRegions';
import { listProjectAssets } from './projectAssets';
import { SUB } from './projectPaths';
import {
	bundleFromAssetKey,
	exportSpineBundle,
	loadSkeletonIndex,
	type ExportedSpineEntry,
} from './spine';
import { copyObject, deleteObjects, listAllKeys, putObjectText } from './r2';

export interface EditorArtSheet {
	/** The manifest R2 key the doc references (`SpriteNode.assetKey`). */
	key: string;
	/** Spritesheet JSON path relative to `deploy/` (= relative to `static/assets/`). */
	json: string;
	frames: number;
}

export interface EditorArtImage {
	/** The image R2 key the doc references (`SpriteNode.assetKey`, no region) —
	 * also the game's lookup key, so the asset entry is registered under it. */
	key: string;
	/** Image path relative to `deploy/` (= relative to `static/assets/`). */
	file: string;
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
		regionNames: new Set(),
		usedRegions: new Set(),
	};
	const imageParamKeys = new Map<string, Set<string>>();
	for (const [id, def] of Object.entries(defs)) {
		const keys = new Set<string>();
		for (const p of def.params ?? []) {
			if (p.kind === 'image') {
				keys.add(p.key);
				if (typeof p.default === 'string' && p.default) addImageRef(refs, p.default);
			}
		}
		imageParamKeys.set(id, keys);
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
			const keys = imageParamKeys.get(node.componentId);
			if (keys) {
				for (const [k, v] of Object.entries(node.params)) {
					if (keys.has(k) && typeof v === 'string' && v) addImageRef(refs, v);
				}
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

/** Build the TexturePacker json-hash the engine's `sprites` loader parses, with
 * frames keyed EXACTLY by the editor region names (`SpriteNode.region` values). */
function toTexturePackerJson(set: EditorRegionSet, pageFile: string): string {
	const frames: Record<string, TexturePackerFrame> = {};
	for (const r of set.regions) {
		const origW = r.origW ?? r.w;
		const origH = r.origH ?? r.h;
		const offX = r.offX ?? 0;
		const offY = r.offY ?? 0;
		frames[r.name] = {
			frame: { x: r.x, y: r.y, w: r.w, h: r.h },
			rotated: r.rotated === true,
			trimmed: offX !== 0 || offY !== 0 || origW !== r.w || origH !== r.h,
			spriteSourceSize: { x: offX, y: offY, w: r.w, h: r.h },
			sourceSize: { w: origW, h: origH },
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
				size: { w: set.pageWidth, h: set.pageHeight },
			},
		},
		null,
		'\t',
	);
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

		const pageExt = set.pageKey.toLowerCase().endsWith('.webp') ? 'webp' : 'png';
		const pageFile = `${stem}.${pageExt}`;
		const jsonRel = `editor-art/${stem}/${stem}.json`;
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
		sheets.push({ key: manifestKey, json: jsonRel, frames: set.regions.length });
		sheetRegionNames.push({ stem, names: set.regions.map((r) => r.name) });
		for (const r of set.regions) coveredRegions.add(r.name);
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
		images.push({ key: imageKey, file });
	}

	// Spine nodes: copy each referenced bundle into deploy/editor-art/ via the shared
	// helper (atlas + skeleton + pages; a Rigger `.irig` skeleton is shipped as `.json`
	// so PIXI's loader can parse it). `key` is the node's full R2 bundle-prefix
	// `assetKey` — the same value `LayoutNodeView` hands `<SpineProvider>`. A coded
	// spine key (no R2 bundle) resolves to nothing and is skipped. Stems share the
	// `usedStems` pool with the sheets so a spine/sheet name clash can't collide.
	const spines: EditorArtSpine[] = [];
	if (refs.spineKeys.size > 0) {
		const skeletonIndex = await loadSkeletonIndex(clientKey, projectKey);
		const exportedSpines = new Set<string>();
		const spineStem = (assetKey: string): string => {
			const base = assetKey.replace(/\/$/, '');
			const tail = base.slice(base.lastIndexOf('/') + 1).replace(/[^a-zA-Z0-9_-]/g, '_');
			return tail || 'spine';
		};
		for (const assetKey of refs.spineKeys) {
			if (exportedSpines.has(assetKey)) continue;
			exportedSpines.add(assetKey);
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
				scale: SPINE_LOAD_SCALE,
			});
			if (!result) continue;
			// The game's doc has this spine node's `assetKey` rewritten from the full R2
			// bundle prefix down to the plain bundle NAME (`resolveSpineKeysForGame` in
			// `runtimeBundle.ts` + `api/editor/doc`), and `LayoutNodeView` looks the asset
			// up by that name. Register under the SAME key — not the full prefix — or the
			// lookup misses and the spine never loads in the built game.
			const gameKey = bundleFromAssetKey(clientKey, projectKey, assetKey);
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

	const index: EditorArtIndex = { sheets, images, spines, collisions };
	const indexKey = `${artPrefix}index.json`;
	await putObjectText(indexKey, JSON.stringify(index, null, '\t'), 'application/json');
	written.add(indexKey);

	// Prune leftovers from a previous export so deploy/editor-art/ mirrors the doc.
	const existing = await listAllKeys(artPrefix);
	const stale = existing.filter((k) => !written.has(k));
	await deleteObjects(stale);

	return index;
}
