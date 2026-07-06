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
 *                  atlas + skeleton + page files (preserving names so the atlas's
 *                  page refs resolve once mirrored), and add
 *                  `index.spines += { key: <assetKey>, atlas, skeleton, scale: 2 }`.
 *                  A Rigger `.irig` skeleton is shipped under a `.json` name — the
 *                  game's `PIXI.Assets.load` resolves the spine parser by extension
 *                  and `.irig` is unknown to it (bytes are valid Spine JSON).
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
import { sheetVersion } from './assetVersion';
import { loadRegionSet, type EditorRegionSet } from './editorRegions';
import { listProjectAssets } from './projectAssets';
import { SUB } from './projectPaths';
import { exportSpineBundle, loadSkeletonIndex } from './spine';
import { SYMBOL_SPINE_LOAD_SCALE } from '$lib/spineScale';
import { copyObject, deleteObjects, listAllKeys, putObjectText } from './r2';
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
	/** Sprite-cell frame names a binding references that NO project atlas/sheet
	 *  packs — so they never reach the game's `loadedAssets` and the symbol renders
	 *  blank ("… is not found in the loadedAssets"). Surfaced as a build/boot warning
	 *  (the dangling-binding guard) so a re-authored atlas that dropped/renamed a
	 *  bound frame is caught at publish instead of silently in-game. */
	missing: string[];
}

/** The global win-frame highlight, passed through to the bundle so the game can
 *  render the authored win frame instead of its built-in `payframe`. Only present
 *  when the author overrode it; `assetKey` is the FULL R2 spine bundle prefix (its
 *  bundle is exported alongside the per-symbol spines, keyed the same way). */
export interface SymbolExportHighlight {
	assetKey: string;
	animationName?: string;
}

export interface SymbolExportResult {
	/** The doc's `symbols` map, passed through VERBATIM (assetKeys already match the
	 *  index keys, so the engine's `bakedSymbolMap()` needs zero rewriting). */
	map: SymbolsDoc['symbols'];
	index: SymbolExportIndex;
	/** The authored global highlight override (absent → game uses built-in payframe). */
	highlight?: SymbolExportHighlight;
	/** The global win-line config (on/off + line + text style), passed through VERBATIM
	 *  (no asset work — the chosen text font travels via the font pipeline). Absent → the
	 *  game keeps all its coded defaults. */
	winLine?: SymbolsDoc['winLine'];
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
	// The global highlight is a spine bundle too — export it like any per-symbol
	// spine cell so its `index.spines` entry (keyed by the same `assetKey`) ships.
	if (doc.highlight?.type === 'spine' && doc.highlight.assetKey) {
		refs.spineKeys.add(doc.highlight.assetKey);
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

		// Stamp a content hash into the filenames so a re-authored atlas ships at a NEW
		// URL the cache can't serve stale (see assetVersion.ts). Null = source page gone.
		const version = await sheetVersion(set);
		if (!version) return;

		const stem = claimStem(set.assetKey);
		const pageExt = set.pageKey.toLowerCase().endsWith('.webp') ? 'webp' : 'png';
		const pageFile = `${stem}.${version}.${pageExt}`;
		const jsonRel = `${EXPORT_SUBTREE}/${stem}/${stem}.${version}.json`;
		const pageRel = `${EXPORT_SUBTREE}/${stem}/${pageFile}`;

		// Server-side copy the packed page verbatim (no bytes through this process —
		// keeps peak memory flat); skip if the source page is missing.
		if (!(await copyObject(set.pageKey, `${deployPrefix}${pageRel}`))) return;
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
			// Stop once every BOUND frame is covered — not when the running region
			// COUNT reaches the bound count. `coveredFrames` holds all of an exported
			// sheet's regions (icons AND their `_glow`/`_shine` siblings), so a size
			// compare can trip early: a sheet with N unrelated extra regions makes the
			// count reach the target while the actual bound frames are still missing
			// (e.g. a 6-region icons+glows sheet "covers" 6 bindings but not the 3 in a
			// later atlas). Check membership of the bound names themselves.
			if ([...refs.frameNames].every((f) => coveredFrames.has(f))) break;
			const set = await loadRegionSet(candidate, clientKey, projectKey);
			if (exportedManifests.has(set.assetKey)) continue;
			if (set.regions.some((r) => refs.frameNames.has(r.name))) {
				await exportSheet(set);
			} else {
				exportedManifests.add(set.assetKey);
			}
		}
	}

	// ── Spine cells: copy each referenced bundle into deploy/ via the shared helper ──
	// `assetKey` is the full R2 bundle prefix; `exportSpineBundle` copies the bundle's
	// own atlas + skeleton + pages (renaming a Rigger `.irig` skeleton to `.json` so
	// `PIXI.Assets.load` can parse it), preserving page names so the atlas refs resolve
	// once mirrored. Dedup by assetKey (W.win + W.land share one bundle → copy once).
	const spines: SymbolSpine[] = [];
	const exportedSpines = new Set<string>();
	const skeletonIndex =
		refs.spineKeys.size > 0 ? await loadSkeletonIndex(clientKey, projectKey) : [];

	for (const assetKey of refs.spineKeys) {
		if (exportedSpines.has(assetKey)) continue;
		exportedSpines.add(assetKey);

		const result = await exportSpineBundle({
			clientKey,
			projectKey,
			assetKey,
			deployPrefix,
			subtree: EXPORT_SUBTREE,
			stem: claimStem(assetKey.replace(/\/$/, '')),
			skeletonIndex,
			scale: SYMBOL_SPINE_LOAD_SCALE,
		});
		if (!result) continue;
		for (const k of result.written) written.add(k);
		spines.push(result.entry);
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

	// Dangling-binding guard: a bound sprite frame no project atlas packs never
	// reaches `loadedAssets` → the symbol renders blank in-game. Report it so a
	// re-authored atlas that dropped/renamed the frame is caught (bake warns; the
	// engine warns at boot) instead of surfacing only as a runtime lookup miss.
	const missing = [...refs.frameNames].filter((f) => !coveredFrames.has(f)).sort();

	const index: SymbolExportIndex = { sheets, images: [], spines, collisions, missing };
	const indexKey = `${symbolsPrefix}index.json`;
	await putObjectText(indexKey, JSON.stringify(index, null, '\t'), 'application/json');
	written.add(indexKey);

	// Prune leftovers from a previous export so deploy/editor-symbols/ mirrors the doc.
	const existing = await listAllKeys(symbolsPrefix);
	await deleteObjects(existing.filter((k) => !written.has(k)));

	// The global highlight override (if any). Its spine bundle was exported in the
	// loop above (added to `refs.spineKeys`), so it's already in `index.spines` under
	// this same `assetKey`; we only surface the pointer for the bundle's top level.
	const highlight: SymbolExportHighlight | undefined =
		doc.highlight?.type === 'spine' && doc.highlight.assetKey
			? { assetKey: doc.highlight.assetKey, animationName: doc.highlight.animationName }
			: undefined;

	// The global win-line config — a pure pass-through (no asset). The doc is already
	// sparse (only authored fields), so forward it verbatim; absent means the game keeps
	// all its coded defaults.
	const winLine = doc.winLine;

	return {
		map: doc.symbols,
		index,
		...(highlight ? { highlight } : {}),
		...(winLine ? { winLine } : {}),
	};
}
