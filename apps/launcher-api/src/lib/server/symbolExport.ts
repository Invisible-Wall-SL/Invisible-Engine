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
import { exportSpineBundle, loadSkeletonIndexWithShared } from './spine';
import { SYMBOL_SPINE_LOAD_SCALE } from '$lib/spineScale';
import { copyObject, deleteObjects, listAllKeys, putObjectText } from './r2';
import {
	canonicalizeSymbolsDocForExport,
	loadSymbolsDoc,
	type SymbolCell,
	type SymbolsDoc,
} from './symbolsStorage';
import { parseScopedFrameRef, scopedFrameRef } from 'engine-layout';

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
 *  bundle is exported alongside the per-symbol spines, keyed the same way).
 *
 *  `tintMode`/`tintColor` are the MULTIPLY tint the frame applies to the symbols it loops over
 *  (`'fixed'` → `tintColor`; `'winLine'` → the paying line's authored colour, resolved in-game).
 *  Both absent ⇒ no tint. */
export interface SymbolExportHighlight {
	assetKey: string;
	animationName?: string;
	tintMode?: 'fixed' | 'winLine';
	tintColor?: string;
}

/** One stacked symbol's baked config. `height` is how many CELLS tall the tall picture is (the crop
 *  denominator); `art` is the tall picture — its asset ships via the SAME `refs` as a per-cell binding
 *  (spine bundle → `index.spines` / sprite sheet → `index.sheets`), so `art.assetKey` resolves with no
 *  rewriting (exactly like the grid `map` + `highlight`). */
export interface SymbolExportStackedArt {
	type: 'sprite' | 'spine' | 'flipbook';
	assetKey: string;
	animationName?: string;
	clipId?: string;
}
export interface SymbolExportStacked {
	symbols: { name: string; height: number; art: SymbolExportStackedArt }[];
	/** When true, a tall picture shows ONLY at full stack height; shorter landed runs fall back to the
	 *  normal single icons. Absent ⇒ partial runs crop the picture (default). */
	fullHeightOnly?: boolean;
	/** When true, a partial stacked run pinned to the board's TOP or BOTTOM edge renders as a CUT-OFF
	 *  tall picture regardless of `fullHeightOnly` (top edge → bottom N/M, bottom edge → top N/M; any
	 *  run length, even 1). Absent ⇒ edge partials follow `fullHeightOnly`. Independent toggle. */
	edgeCutoffs?: boolean;
}

export interface SymbolExportResult {
	/** The doc's `symbols` map, passed through VERBATIM (assetKeys already match the
	 *  index keys, so the engine's `bakedSymbolMap()` needs zero rewriting). */
	map: SymbolsDoc['symbols'];
	index: SymbolExportIndex;
	/** The authored symbol DISPLAY NAMES (`H1` → "Banana"), passed through VERBATIM — pure text,
	 *  no asset. Invisible Win Text interpolates them as `{symbolName}`, so a rename in `/symbols`
	 *  rewrites every win sentence with no template edit. Absent/empty → every symbol speaks as
	 *  its own id. */
	names?: SymbolsDoc['names'];
	/** The authored global highlight override (absent → game uses built-in payframe). */
	highlight?: SymbolExportHighlight;
	/** The authored free-spin board glow (absent → game uses its coded `reelhouse` spine).
	 *  Passed through VERBATIM: its bundle rides `index.spines` under the same `assetKey`, so
	 *  the engine can load it with no rewriting — exactly like `highlight`. */
	boardGlow?: SymbolsDoc['boardGlow'];
	/** The global win-line config (on/off + line + text style), passed through VERBATIM
	 *  (no asset work — the chosen text font travels via the font pipeline). Absent → the
	 *  game keeps all its coded defaults. */
	winLine?: SymbolsDoc['winLine'];
	/** The resting-board win-SYMBOL replay config, passed through VERBATIM (no asset work).
	 *  Absent → the game keeps its coded defaults (replay on, 0.4s between passes). */
	winCycle?: SymbolsDoc['winCycle'];
	/** The Book-symbol VFX layers (background + foreground), passed through VERBATIM. Each layer's
	 *  asset rides the same channels as the per-cell bindings: a spine layer's bundle + a sprite
	 *  layer's sheet ship via `refs` into `index.spines`/`index.sheets` under the same key; a flipbook
	 *  layer's clip ships via the editor-art clip walk (no ref here); an fx layer references an effect
	 *  the effects export ships (kept reachable at bake). Absent → the game renders no book VFX. */
	bookVfx?: SymbolsDoc['bookVfx'];
	/** The reel-anticipation presentation FX (per-tier escalation + optional overlay spine key),
	 *  passed through VERBATIM. A swapped `spineKey` bundle rides `index.spines` under the same key
	 *  (like `boardGlow`); the per-tier FX are pure config (no asset). Absent → the game keeps its
	 *  coded `codedTierFx` ramp (byte-parity with Phase 4). */
	anticipation?: SymbolsDoc['anticipation'];
	/** The stacked-picture reel-mode config (the editable twin of the old coded `STACKED_PICTURE.heights`).
	 *  Each tall `art` asset already shipped via `refs` (spine bundle → `index.spines` / sprite sheet →
	 *  `index.sheets`), so this is a verbatim pass-through of `{ name, height, art }` — the engine resolves
	 *  `art.assetKey` with no rewriting, exactly like the grid `map`. Present ONLY when the master toggle is
	 *  ON and ≥1 symbol is authored, so a disabled/un-authored project bakes NO `stacked` field (byte-parity). */
	stacked?: SymbolExportStacked;
}

const EXPORT_SUBTREE = 'editor-symbols';

interface SymbolRefs {
	/** BARE sprite-cell frame names (e.g. `h1.webp`) → resolve to a containing sheet by name.
	 *  Ambiguous when a name is packed by several atlases (the collision this whole fix is about),
	 *  but kept for legacy/coded cells that carry no atlas. */
	frameNames: Set<string>;
	/** Manifest keys named by a SCOPED sprite ref (`<manifest>::<region>`). The atlas is pinned, so
	 *  ship exactly that sheet and register its frames scoped — two symbols reusing a region name on
	 *  DISTINCT atlases then resolve to distinct textures. */
	spriteManifests: Set<string>;
	/** Spine-cell `assetKey`s (full R2 bundle prefixes). */
	spineKeys: Set<string>;
}

/** Walk the (sparse) symbol map and split its cells into bare sprite frame names, scoped sprite
 *  atlases, and spine bundle keys. */
function collectSymbolRefs(doc: SymbolsDoc): SymbolRefs {
	const refs: SymbolRefs = {
		frameNames: new Set(),
		spriteManifests: new Set(),
		spineKeys: new Set(),
	};
	for (const states of Object.values(doc.symbols)) {
		for (const cell of Object.values(states)) {
			if (!cell?.assetKey) continue;
			// A FLIPBOOK cell owns no frame of its own: its art is the clip's, and every clip's
			// sheets already ship via `editorArtExport`'s clip walk. Its `assetKey` is the clip's
			// primary MANIFEST key, so filing it as a frame name would send the resolver hunting
			// for a region called `…/atlas_manifest_page0.json`, never find one, and report a
			// dangling symbol binding that is not actually broken.
			if (cell.type === 'flipbook') continue;
			if (cell.type === 'spine') {
				refs.spineKeys.add(cell.assetKey);
				continue;
			}
			// A SCOPED sprite ref (`<manifest>::<region>`) pins its atlas, so ship that exact sheet;
			// a bare name has no atlas and falls back to the by-name scan (legacy).
			const parsed = parseScopedFrameRef(cell.assetKey);
			if (parsed.assetKey) {
				refs.spriteManifests.add(parsed.assetKey);
			} else {
				// A `::`-bearing ref whose prefix ISN'T a recognized full manifest (a Sheet-Maker
				// output prefix, or a basename `canonicalizeSymbolsDocForExport` couldn't map) still
				// ships via the by-name scan on its REGION part rather than dangling on the whole
				// string. It resolves only bare in-game (so it can still collide, exactly as today),
				// but an atlas-manifest source — the common case — is fully disambiguated above.
				const sep = cell.assetKey.indexOf('::');
				refs.frameNames.add(sep > 0 ? cell.assetKey.slice(sep + 2) : cell.assetKey);
			}
		}
	}
	// The global highlight is a spine bundle too — export it like any per-symbol
	// spine cell so its `index.spines` entry (keyed by the same `assetKey`) ships.
	if (doc.highlight?.type === 'spine' && doc.highlight.assetKey) {
		refs.spineKeys.add(doc.highlight.assetKey);
	}
	// So is the free-spin board glow — same reason. Without this the picker would show the rig in
	// the tool while the game shipped nothing to load under that key (repo rule 8).
	if (doc.boardGlow?.type === 'spine' && doc.boardGlow.assetKey) {
		refs.spineKeys.add(doc.boardGlow.assetKey);
	}
	// A swapped reel-anticipation overlay spine (`anticipation.spineKey`, a full R2 bundle prefix) is
	// also a spine bundle — ship it like `highlight`/`boardGlow` so the game can load it (rule 8). The
	// coded default `anticipation` spine is a LOCAL game asset and carries no `/`, so it never lands
	// here (nothing to ship) — only an author-picked R2 bundle does.
	if (doc.anticipation?.spineKey && doc.anticipation.spineKey.includes('/')) {
		refs.spineKeys.add(doc.anticipation.spineKey);
	}
	// Book-symbol VFX layers carry the same asset kinds as a per-cell binding, so route each layer's
	// asset through the SAME refs — a spine layer's bundle + a sprite layer's sheet must ship or the
	// game loads nothing under the key (rule 8). A flipbook layer's clip ships via the editor-art clip
	// walk (like a flipbook cell, skipped here); an fx layer's effect ships via the effects export.
	addBookVfxLayerRefs(doc.bookVfx?.background, refs);
	addBookVfxLayerRefs(doc.bookVfx?.foreground, refs);
	// Stacked-picture tall art — each stacked symbol's `art` is a sprite/spine/flipbook binding exactly
	// like a grid cell, so route it through the SAME refs or the game would load nothing under the key
	// (rule 8). Gated the same as the emitted `stacked` field (master toggle on) so a disabled project
	// ships nothing. A flipbook art's clip rides the editor-art clip walk (skipped here, like a cell).
	if (doc.stackedPictures?.enabled === true) {
		for (const s of doc.stackedPictures.symbols ?? []) addCellRefs(s.art, refs);
	}
	return refs;
}

/** Route ONE sprite/spine/flipbook cell's asset into the shared `refs` — the exact split
 *  `collectSymbolRefs` applies to a per-cell binding, factored out so the stacked-picture tall art
 *  ships through the identical path. A flipbook art carries no frame of its own (its clip ships via
 *  `editorArtExport`'s clip walk), so it adds nothing here. */
function addCellRefs(cell: SymbolCell | undefined, refs: SymbolRefs): void {
	if (!cell?.assetKey || cell.type === 'flipbook') return;
	if (cell.type === 'spine') {
		refs.spineKeys.add(cell.assetKey);
		return;
	}
	const parsed = parseScopedFrameRef(cell.assetKey);
	if (parsed.assetKey) {
		refs.spriteManifests.add(parsed.assetKey);
	} else {
		const sep = cell.assetKey.indexOf('::');
		refs.frameNames.add(sep > 0 ? cell.assetKey.slice(sep + 2) : cell.assetKey);
	}
}

/** Route one Book-VFX layer's asset into the shared `refs` — spine bundle or sprite sheet frame, the
 *  same split `collectSymbolRefs` applies to a per-cell sprite/spine binding. Flipbook + fx layers
 *  ship no asset through this exporter (clip art via editor-art; effect via the effects export). */
function addBookVfxLayerRefs(
	layer: NonNullable<SymbolsDoc['bookVfx']>[keyof NonNullable<SymbolsDoc['bookVfx']>] | undefined,
	refs: SymbolRefs,
): void {
	if (!layer) return;
	if (layer.kind === 'spine') {
		if (layer.assetKey) refs.spineKeys.add(layer.assetKey);
		return;
	}
	if (layer.kind === 'sprite' && layer.assetKey) {
		const parsed = parseScopedFrameRef(layer.assetKey);
		if (parsed.assetKey) {
			refs.spriteManifests.add(parsed.assetKey);
		} else {
			const sep = layer.assetKey.indexOf('::');
			refs.frameNames.add(sep > 0 ? layer.assetKey.slice(sep + 2) : layer.assetKey);
		}
	}
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

/** Build the TexturePacker json-hash the engine's `sprites` loader parses. Each frame is keyed
 *  BOTH by its bare name (what a legacy/coded bare `assetKey` looks up) AND by the atlas-scoped
 *  key `<manifest>::<region>` (what a SCOPED sprite cell looks up). The scoped key carries the
 *  manifest, so two symbols reusing a name on distinct atlases resolve to distinct textures — the
 *  symbol-path analogue of `editorArtNamespace`'s dual registration, baked into the sheet the game
 *  loads with no namespace, so no game change is needed. */
function toTexturePackerJson(set: EditorRegionSet, pageFile: string): string {
	const frames: Record<string, TexturePackerFrame> = {};
	for (const r of set.regions) {
		const origW = r.origW ?? r.w;
		const origH = r.origH ?? r.h;
		const offX = r.offX ?? 0;
		const offY = r.offY ?? 0;
		const entry: TexturePackerFrame = {
			frame: { x: r.x, y: r.y, w: r.w, h: r.h },
			rotated: r.rotated === true,
			trimmed: offX !== 0 || offY !== 0 || origW !== r.w || origH !== r.h,
			spriteSourceSize: { x: offX, y: offY, w: r.w, h: r.h },
			sourceSize: { w: origW, h: origH },
		};
		frames[r.name] = entry;
		frames[scopedFrameRef(set.assetKey, r.name)] = entry;
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
	// Repair any sprite cell whose scoped atlas ref names its manifest by a bare basename (the same
	// naming problem the flipbook clips had), so a pinned atlas resolves to the full manifest key
	// the sheet ships under. A correctly-authored doc pays nothing.
	const doc = await canonicalizeSymbolsDocForExport(
		await loadSymbolsDoc(clientKey, projectKey),
		clientKey,
		projectKey,
	);
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

	// ── Scoped sprite cells: ship exactly the atlas each one pins ──
	// A scoped ref (`<manifest>::<region>`) names its sheet, so load + export it directly rather
	// than guess via the ambiguous by-name scan below. `toTexturePackerJson` emits the scoped key,
	// so the cell resolves uniquely in-game even when another atlas reuses the region name — this is
	// what stops the idle-board static sprites from collapsing to one shared texture.
	for (const manifestKey of refs.spriteManifests) {
		await exportSheet(await loadRegionSet(manifestKey, clientKey, projectKey));
	}

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
		refs.spineKeys.size > 0 ? await loadSkeletonIndexWithShared(clientKey, projectKey) : [];

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
			? {
					assetKey: doc.highlight.assetKey,
					animationName: doc.highlight.animationName,
					...(doc.highlight.tintMode ? { tintMode: doc.highlight.tintMode } : {}),
					...(doc.highlight.tintColor ? { tintColor: doc.highlight.tintColor } : {}),
				}
			: undefined;

	// The global win-line config — a pure pass-through (no asset). The doc is already
	// sparse (only authored fields), so forward it verbatim; absent means the game keeps
	// all its coded defaults.
	const winLine = doc.winLine;

	// Sibling pass-through of the win-SYMBOL replay (also assetless). Kept separate from
	// `winLine` on purpose: the replay never draws the line, so the two are independent switches.
	const winCycle = doc.winCycle;

	// The free-spin board glow. Like `highlight`, its bundle already shipped via `refs.spineKeys`
	// into `index.spines` under this same `assetKey`, so this is just the pointer + its sparse
	// animation/size overrides, forwarded verbatim.
	const boardGlow = doc.boardGlow;

	// The Book-symbol VFX layers. Each layer's asset already shipped via `refs` above (spine bundle →
	// `index.spines`, sprite sheet → `index.sheets`, both keyed by the layer's own `assetKey`) or via
	// a sibling export (flipbook clip / fx effect), so this is a verbatim pass-through of the sparse
	// authored config, exactly like `boardGlow`. Absent → the game renders no book VFX.
	const bookVfx = doc.bookVfx;

	// The reel-anticipation FX. Its optional `spineKey` bundle already shipped via `refs.spineKeys`
	// into `index.spines` under this same key (like `boardGlow`); the per-tier FX are pure config, so
	// this is a verbatim pass-through of the sparse authored doc (alias-keyed per-tier FX). Absent →
	// the coded `codedTierFx` ramp.
	const anticipation = doc.anticipation;

	// Display names — another assetless pass-through, omitted when nothing is named so an
	// un-authored project's bundle stays byte-identical.
	const names = doc.names && Object.keys(doc.names).length ? doc.names : undefined;

	// The stacked-picture config. Each tall `art` asset already shipped via `refs` above (spine bundle →
	// `index.spines`, sprite sheet → `index.sheets`, both keyed by the art's own `assetKey`), so this is a
	// verbatim pass-through of `{ name, height, art }` — reduced to the baked contract's art fields (no
	// `sizeRatios`; height is the crop denominator). Gated on the master toggle AND ≥1 symbol so a
	// disabled/un-authored project emits NO `stacked` field and bakes byte-identical.
	const stackedSyms = doc.stackedPictures?.symbols ?? [];
	const stacked: SymbolExportStacked | undefined =
		doc.stackedPictures?.enabled === true && stackedSyms.length
			? {
					symbols: stackedSyms.map((s) => {
						const art: SymbolExportStackedArt = { type: s.art.type, assetKey: s.art.assetKey };
						if (s.art.animationName) art.animationName = s.art.animationName;
						if (s.art.clipId) art.clipId = s.art.clipId;
						return { name: s.name, height: s.height, art };
					}),
					...(doc.stackedPictures.fullHeightOnly ? { fullHeightOnly: true } : {}),
					...(doc.stackedPictures.edgeCutoffs ? { edgeCutoffs: true } : {}),
				}
			: undefined;

	return {
		map: doc.symbols,
		index,
		...(names ? { names } : {}),
		...(highlight ? { highlight } : {}),
		...(boardGlow ? { boardGlow } : {}),
		...(winLine ? { winLine } : {}),
		...(winCycle ? { winCycle } : {}),
		...(bookVfx ? { bookVfx } : {}),
		...(anticipation ? { anticipation } : {}),
		...(stacked ? { stacked } : {}),
	};
}
