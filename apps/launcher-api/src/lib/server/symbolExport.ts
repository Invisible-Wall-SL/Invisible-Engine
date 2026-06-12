/**
 * Export the assets a project's Invisible Symbols State Machine doc
 * (`symbols/symbols.json`) binds into the game-loadable `deploy/editor-symbols/`
 * subtree — the symbol analogue of `editorArtExport.ts` (sprite sheets) +
 * `fontExport.ts` (verbatim multi-file bundles). Closes the "rebound a symbol in
 * the tool, it shows in the preview, but the shipped game has the old asset" gap
 * (docs/design/live-assets.md, CLAUDE.md §8).
 *
 * The tool authors a sparse `symbols` map (`name → state → { type, assetKey, … }`)
 * that is merged OVER the coded `SYMBOL_INFO_MAP`. The map ships VERBATIM — this
 * exporter never rewrites it. It only resolves the assets the cells reference,
 * copies them under `deploy/editor-symbols/<stem>/`, and emits an `index` whose
 * keys MATCH the cells' `assetKey`s, so the engine's `bakedSymbolMap()` +
 * `bakedSymbolAssets()` (apps/lines/src/editor-scenes.ts) line up with zero
 * rewriting:
 *
 *   sprite cell  → `assetKey` is a FRAME NAME (e.g. `h1.webp`). Find the project
 *                  atlas/sheet that contains the frame (scan like editorArtExport),
 *                  export that sheet as TexturePacker JSON + page, and add
 *                  `index.sheets += { key: <manifestKey>, json }`. The engine
 *                  registers each sheet's frames by their OWN names (NO namespace),
 *                  so the cell's plain frame key resolves directly. Frame names MUST
 *                  be unique across exported sheets (no namespace to disambiguate) —
 *                  cross-sheet collisions are surfaced as a build warning.
 *   spine cell   → `assetKey` is the FULL R2 BUNDLE PREFIX. Copy that bundle's own
 *                  atlas + skeleton + page files VERBATIM (preserving names so the
 *                  atlas's page refs resolve once mirrored), and add
 *                  `index.spines += { key: <assetKey>, atlas, skeleton, scale: 2 }`.
 *
 *   <client>/<project>/deploy/editor-symbols/<stem>/<files…>
 *   <client>/<project>/deploy/editor-symbols/index.json   ← the index the game registers
 *
 * The existing transport carries it: `bake-editor-doc.mjs` triggers this and embeds
 * `{ map, index }` as `bundle.symbols`; `pull-project-assets.mjs` mirrors `deploy/`
 * → `static/assets/`; `bakedSymbolAssets()` registers the sheets/images/spines and
 * `bakedSymbolMap()` merges the map. Stale objects from a previous export are
 * pruned. Idempotent — re-running converges.
 */
import { loadRegionSet, type EditorRegionSet } from './editorRegions';
import { listProjectAssets } from './projectAssets';
import { SUB } from './projectPaths';
import {
	atlasPageNames,
	bundleFromAssetKey,
	loadSkeletonIndex,
	resolveBundlePrefix,
} from './spine';
import {
	deleteObjects,
	getObjectBytes,
	getObjectText,
	listAllKeys,
	putObjectBytes,
	putObjectText,
} from './r2';
import { loadSymbolsDoc, type SymbolsDoc } from './symbolsStorage';

/** A sprite sheet a symbol binding references. `key` is the source manifest (kept
 *  for the exporter's dedup); the sheet's frames register under their OWN names, so
 *  a sprite cell's plain frame `assetKey` (e.g. `h1.webp`) resolves directly. */
export interface SymbolSheet {
	key: string;
	/** Spritesheet JSON path relative to `deploy/` (= relative to `static/assets/`). */
	json: string;
	frames: number;
}

/** A spine bundle a symbol binding references. `key` is the binding's full R2
 *  BUNDLE-PREFIX `assetKey` (the engine's lookup key). */
export interface SymbolSpine {
	key: string;
	/** Atlas path relative to `deploy/` (= relative to `static/assets/`). */
	atlas: string;
	/** Skeleton path relative to `deploy/` (= relative to `static/assets/`). */
	skeleton: string;
	/** Spine scale; defaults to 2 (the symbols convention) — emitted explicitly. */
	scale: number;
}

/** A frame name bound by a sprite cell that appears in MORE THAN ONE exported
 *  sheet. Because symbol sheet frames register with NO namespace, a colliding
 *  frame name is ambiguous (last-loaded wins) — surfaced as a build warning so the
 *  author can retire the stale sheet or rename the frame. */
export interface SymbolFrameCollision {
	frame: string;
	/** Stems (folder names under `editor-symbols/`) of the sheets sharing this name. */
	sheets: string[];
}

export interface SymbolExportIndex {
	sheets: SymbolSheet[];
	/** Standalone images are not produced by v1 (sprite cells bind sheet frames),
	 *  but the field is present so the shape matches S1's `bakedSymbolAssets()`. */
	images: { key: string; file: string }[];
	spines: SymbolSpine[];
	collisions: SymbolFrameCollision[];
}

export interface SymbolExportResult {
	/** The doc's `symbols` map, passed through VERBATIM (assetKeys already match the
	 *  index keys, so the engine's `bakedSymbolMap()` needs zero rewriting). */
	map: SymbolsDoc['symbols'];
	index: SymbolExportIndex;
}

const EXPORT_SUBTREE = 'editor-symbols';

interface SymbolRefs {
	/** Sprite-cell frame names (e.g. `h1.webp`) → resolve to a containing sheet. */
	frameNames: Set<string>;
	/** Spine-cell `assetKey`s (full R2 bundle prefixes). */
	spineKeys: Set<string>;
}

/** Walk the (sparse) symbol map and split its cells into sprite frame names vs
 *  spine bundle keys. */
function collectSymbolRefs(doc: SymbolsDoc): SymbolRefs {
	const refs: SymbolRefs = { frameNames: new Set(), spineKeys: new Set() };
	for (const states of Object.values(doc.symbols)) {
		for (const cell of Object.values(states)) {
			if (!cell?.assetKey) continue;
			if (cell.type === 'spine') refs.spineKeys.add(cell.assetKey);
			else refs.frameNames.add(cell.assetKey);
		}
	}
	return refs;
}

/** `atlas_manifest_symbols.json` → `symbols`; `…/spines/W/` → `W` (a safe stem). */
function stemFromManifestKey(manifestKey: string): string {
	const base = manifestKey.replace(/\/$/, '');
	const tail = base.slice(base.lastIndexOf('/') + 1).replace(/\.json$/i, '');
	const stripped = tail.replace(/^atlas_manifest_/i, '');
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

/** Build the TexturePacker json-hash the engine's `sprites` loader parses, keyed
 *  by the sheet's own frame names — the exact keys a sprite cell's `assetKey`
 *  references (mirrors `editorArtExport.toTexturePackerJson`). */
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
				app: 'invisible-editor-symbols-export',
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
 * Export the assets a project's symbols doc binds into `deploy/editor-symbols/`,
 * prune leftovers from a previous export, and return the verbatim `map` + an
 * `index` whose keys match the cells' `assetKey`s. Idempotent — re-running
 * converges.
 */
export async function exportEditorSymbols(
	clientKey: string,
	projectKey: string,
): Promise<SymbolExportResult> {
	const doc = await loadSymbolsDoc(clientKey, projectKey);
	const refs = collectSymbolRefs(doc);

	const deployPrefix = `${SUB.deploy(clientKey, projectKey)}/`;
	const symbolsPrefix = `${deployPrefix}${EXPORT_SUBTREE}/`;

	const written = new Set<string>();
	const usedStems = new Set<string>();

	const claimStem = (manifestKey: string): string => {
		let stem = stemFromManifestKey(manifestKey);
		for (let i = 2; usedStems.has(stem); i++) stem = `${stemFromManifestKey(manifestKey)}_${i}`;
		usedStems.add(stem);
		return stem;
	};

	// ── Sprite cells: resolve each frame name to its containing project sheet ──
	// A sprite cell's `assetKey` is a frame name (e.g. `h1.webp`), not a manifest —
	// so scan the project's atlases + sheets (like editorArtExport's by-name path)
	// and export the FIRST sheet that contains each missing frame. One sheet covers
	// many frames, so this dedups naturally.
	const sheets: SymbolSheet[] = [];
	const coveredFrames = new Set<string>();
	const exportedManifests = new Set<string>();
	/** Frame names per exported sheet (by stem) — used to detect cross-sheet name
	 *  collisions (fatal-ish: no namespace disambiguates symbol sheet frames). */
	const sheetFrameNames: { stem: string; names: string[] }[] = [];

	const exportSheet = async (set: EditorRegionSet): Promise<void> => {
		if (exportedManifests.has(set.assetKey)) return;
		exportedManifests.add(set.assetKey);
		if (set.regions.length === 0 || !set.pageKey) return;
		const page = await getObjectBytes(set.pageKey);
		if (!page) return;

		const stem = claimStem(set.assetKey);
		const pageExt = set.pageKey.toLowerCase().endsWith('.webp') ? 'webp' : 'png';
		const pageFile = `${stem}.${pageExt}`;
		const jsonRel = `${EXPORT_SUBTREE}/${stem}/${stem}.json`;
		const pageRel = `${EXPORT_SUBTREE}/${stem}/${pageFile}`;

		await putObjectBytes(`${deployPrefix}${pageRel}`, page.body, page.contentType);
		await putObjectText(
			`${deployPrefix}${jsonRel}`,
			toTexturePackerJson(set, pageFile),
			'application/json',
		);
		written.add(`${deployPrefix}${jsonRel}`);
		written.add(`${deployPrefix}${pageRel}`);
		sheets.push({ key: set.assetKey, json: jsonRel, frames: set.regions.length });
		sheetFrameNames.push({ stem, names: set.regions.map((r) => r.name) });
		for (const r of set.regions) coveredFrames.add(r.name);
	};

	if (refs.frameNames.size > 0) {
		const { atlases, sheets: sheetItems } = await listProjectAssets(clientKey, projectKey);
		// `atlas-manifest` keys are manifests; `sheet` keys are output prefixes —
		// `loadRegionSet` resolves both to a region set with the resolved manifest key.
		const candidates = [
			...atlases.filter((a) => a.kind === 'atlas-manifest').map((a) => a.key),
			...sheetItems.map((s) => s.key),
		];
		for (const candidate of candidates) {
			if (coveredFrames.size >= refs.frameNames.size) break;
			const set = await loadRegionSet(candidate, clientKey, projectKey);
			if (exportedManifests.has(set.assetKey)) continue;
			if (set.regions.some((r) => refs.frameNames.has(r.name))) {
				await exportSheet(set);
			} else {
				exportedManifests.add(set.assetKey);
			}
		}
	}

	// ── Spine cells: copy each referenced bundle's own files VERBATIM ──
	// `assetKey` is the full R2 bundle prefix. Resolve its `skeletons.json` entry
	// (folder → atlas_file, skeleton_file), read the page names from the atlas text,
	// and copy atlas + skeleton + pages preserving names so the atlas's relative
	// page refs resolve once mirrored. Dedup by assetKey (W.win + W.land share one
	// bundle → copy once). We deliberately copy the bundle's OWN files (not
	// `resolveEditorSpine`'s deploy-page-preferring path, which can swap a page name
	// the .atlas does not reference).
	const spines: SymbolSpine[] = [];
	const exportedSpines = new Set<string>();
	const skeletonIndex =
		refs.spineKeys.size > 0 ? await loadSkeletonIndex(clientKey, projectKey) : [];

	for (const assetKey of refs.spineKeys) {
		if (exportedSpines.has(assetKey)) continue;
		exportedSpines.add(assetKey);

		const folder = bundleFromAssetKey(clientKey, projectKey, assetKey);
		if (folder === null) continue;
		const entry = skeletonIndex.find((e) => e.folder === folder);
		if (!entry) continue;

		const prefix = await resolveBundlePrefix(clientKey, projectKey, folder, entry.atlas_file);
		if (!prefix) continue;

		const atlasText = await getObjectText(`${prefix}/${entry.atlas_file}`);
		if (atlasText === null) continue;

		const stem = claimStem(assetKey.replace(/\/$/, ''));
		const dir = `${EXPORT_SUBTREE}/${stem}`;

		// Atlas — copied verbatim (its page refs are names relative to the bundle dir).
		await putObjectText(
			`${deployPrefix}${dir}/${entry.atlas_file}`,
			atlasText,
			'text/plain; charset=utf-8',
		);
		written.add(`${deployPrefix}${dir}/${entry.atlas_file}`);

		// Skeleton (.json or .skel) — copied verbatim.
		const skel = await getObjectBytes(`${prefix}/${entry.skeleton_file}`);
		if (!skel) continue;
		await putObjectBytes(
			`${deployPrefix}${dir}/${entry.skeleton_file}`,
			skel.body,
			skel.contentType,
		);
		written.add(`${deployPrefix}${dir}/${entry.skeleton_file}`);

		// Page images the atlas references — copied verbatim under their own names.
		for (const pageName of atlasPageNames(atlasText)) {
			const obj = await getObjectBytes(`${prefix}/${pageName}`);
			if (!obj) continue;
			await putObjectBytes(`${deployPrefix}${dir}/${pageName}`, obj.body, obj.contentType);
			written.add(`${deployPrefix}${dir}/${pageName}`);
		}

		spines.push({
			key: assetKey,
			atlas: `${dir}/${entry.atlas_file}`,
			skeleton: `${dir}/${entry.skeleton_file}`,
			scale: 2,
		});
	}

	// Cross-sheet frame-name collisions. Symbol sheet frames register with NO
	// namespace (a cell's `assetKey` is the plain frame key), so a name in two
	// sheets is ambiguous — warn so the author can retire the stale sheet.
	const frameToStems = new Map<string, Set<string>>();
	for (const { stem, names } of sheetFrameNames) {
		for (const name of names) {
			let stems = frameToStems.get(name);
			if (!stems) frameToStems.set(name, (stems = new Set()));
			stems.add(stem);
		}
	}
	const collisions: SymbolFrameCollision[] = [];
	for (const [frame, stems] of frameToStems) {
		// Only flag frames a binding actually references — a shared sheet packs many
		// names the symbols never bind, and those overlaps are noise.
		if (stems.size >= 2 && refs.frameNames.has(frame)) {
			collisions.push({ frame, sheets: [...stems].sort() });
		}
	}
	collisions.sort((a, b) => a.frame.localeCompare(b.frame));

	const index: SymbolExportIndex = { sheets, images: [], spines, collisions };
	const indexKey = `${symbolsPrefix}index.json`;
	await putObjectText(indexKey, JSON.stringify(index, null, '\t'), 'application/json');
	written.add(indexKey);

	// Prune leftovers from a previous export so deploy/editor-symbols/ mirrors the doc.
	const existing = await listAllKeys(symbolsPrefix);
	await deleteObjects(existing.filter((k) => !written.has(k)));

	return { map: doc.symbols, index };
}
