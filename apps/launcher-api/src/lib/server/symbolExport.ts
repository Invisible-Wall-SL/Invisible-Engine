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
import { PAGE_REF_PREFIX, type PageStore } from './pageStore';
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
import { mapWithConcurrency } from './concurrency';

/**
 * How many spine bundles this export copies at once — the symbols twin of
 * `ART_EXPORT_CONCURRENCY`, and sized the same way: the work is R2 latency per bundle, while the
 * launcher is memory-tight enough to OOM during bake. Kept equal to art's width so the two
 * exporters, which run CONCURRENTLY inside one assemble, cannot together fan out further than
 * either was tuned for.
 */
const SYMBOL_EXPORT_CONCURRENCY = 6;

/** A sprite sheet a symbol binding references. `key` is the source manifest (kept
 *  for the exporter's dedup); the sheet's frames register under their OWN names, so
 *  a sprite cell's plain frame `assetKey` (e.g. `h1.webp`) resolves directly. */
export interface SymbolSheet {
	key: string;
	/** Spritesheet JSON path relative to `deploy/` (= relative to `static/assets/`). */
	json: string;
	frames: number;
	/** The KTX2 twin's spritesheet JSON — identical frames, `meta.image` pointing at the shared
	 *  `.ktx2` page and rects rescaled to its (possibly auto-downscaled) dimensions. Absent when
	 *  no twin was encoded (`KTX2_ENCODE` off, page under/over the encoder's size band, no page
	 *  store), in which case the game ships the WebP/PNG unchanged. */
	ktx2Json?: string;
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
	/** The KTX2 twin `.atlas` (`exportSpineBundle` output) whose page-name lines point at the
	 *  `.ktx2` pages. Written since the page store was wired in, but DECLARED only now — the game
	 *  could not select what the type did not admit existed, so every symbol rig shipped its page
	 *  uncompressed while the twin sat unused in the bundle. Absent ⇒ the original `.atlas`. */
	ktx2Atlas?: string;
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
	 *  but the field is present so the shape matches S1's `bakedSymbolAssets()` — `ktx2` included,
	 *  so a v2 that does emit them inherits the compressed tier rather than re-opening this hole. */
	images: { key: string; file: string; ktx2?: string }[];
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
	symbols: {
		name: string;
		height: number;
		art: SymbolExportStackedArt;
		/** The RESTING picture's winning variant — drawn while the stack is part of a paying line.
		 *  Absent ⇒ the stack keeps showing `art` through the win (how this behaved before the slot
		 *  existed). Its asset ships via the same `refs` as `art`. */
		winArt?: SymbolExportStackedArt;
	}[];
	/** When true, a tall picture shows ONLY at full stack height; shorter landed runs fall back to the
	 *  normal single icons. Absent ⇒ partial runs crop the picture (default). */
	fullHeightOnly?: boolean;
	/** When true, a partial stacked run pinned to the board's TOP or BOTTOM edge renders as a CUT-OFF
	 *  tall picture regardless of `fullHeightOnly` (top edge → bottom N/M, bottom edge → top N/M; any
	 *  run length, even 1). Absent ⇒ edge partials follow `fullHeightOnly`. Independent toggle. */
	edgeCutoffs?: boolean;
	/** How long (ms) a stacked cell holds its win beat — the knob that matches that beat to an authored
	 *  `winArt` animation. Absent ⇒ the game's coded `STACKED_WIN_HOLD_MS`. */
	winHoldMs?: number;
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
	/** PER-SYMBOL sound overrides (symbol → state → audiosprite key), passed through VERBATIM — pure
	 *  text, no asset (the cue is a region of the game's own audiosprite, which ships with the game).
	 *  Absent → every symbol falls through to the config's game-wide sound slots. */
	symbolSounds?: SymbolsDoc['symbolSounds'];
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
	/** "A winning symbol POPS at the end of its win" — assetless config, so a verbatim pass-through
	 *  like `winCycle`. `normalizeSymbolsDoc` drops it entirely when OFF, which is what keeps an
	 *  untouched project's bundle byte-identical. */
	winExplode?: SymbolsDoc['winExplode'];
	/** The authored CEILING (ms) on one win/explosion beat — assetless config, another verbatim
	 *  pass-through. Absent → each beat still runs as long as its art does, bounded only by the
	 *  engine's runaway guard, so an un-authored project's bundle stays byte-identical. */
	winBeat?: SymbolsDoc['winBeat'];
	/** "The round is released when the symbols arrive, not when their intros finish" — assetless
	 *  config, a third verbatim pass-through. Absent → the emerge arrival is awaited exactly as it
	 *  always was, so an un-switched project's bundle stays byte-identical. */
	arrivalRelease?: SymbolsDoc['arrivalRelease'];
	/** The Book-symbol VFX layers (background + foreground), passed through VERBATIM. Each layer's
	 *  asset rides the same channels as the per-cell bindings: a spine layer's bundle + a sprite
	 *  layer's sheet ship via `refs` into `index.spines`/`index.sheets` under the same key; a flipbook
	 *  layer's clip ships via the editor-art clip walk (no ref here); an fx layer references an effect
	 *  the effects export ships (kept reachable at bake). Absent → the game renders no book VFX. */
	bookVfx?: SymbolsDoc['bookVfx'];
	/** The explosion → intro transition (one project-global layer + `delayMs`), passed through
	 *  VERBATIM. Its asset rides the SAME channels as a book-VFX layer: a spine's bundle ships via
	 *  `refs` into `index.spines` under its own key, a flipbook's clip via the editor-art clip walk, an
	 *  fx's effect via the effects export (kept reachable at bake). Absent → the intro cuts in the
	 *  moment the explosion ends, exactly as before the field existed. */
	transition?: SymbolsDoc['transition'];
	/** The cascade EXPLOSION PATTERN — the order the winning seats pop in and the gap between two
	 *  waves of them. Pure config, no asset of any kind, so it is a verbatim pass-through like
	 *  `winCycle`. Absent → the whole board explodes in one frame, exactly as before the field
	 *  existed. */
	tumblePattern?: SymbolsDoc['tumblePattern'];
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
 *  atlases, and spine bundle keys. Exported for `scripts/check-symbol-transition.ts`, which proves a
 *  spine bound ONLY as the explosion transition still reaches `index.spines` — the shipping half of
 *  rule 8, asserted offline rather than assumed. */
export function collectSymbolRefs(doc: SymbolsDoc): SymbolRefs {
	const refs: SymbolRefs = {
		frameNames: new Set(),
		spriteManifests: new Set(),
		spineKeys: new Set(),
	};
	for (const states of Object.values(doc.symbols)) {
		for (const cell of Object.values(states)) {
			// A cell's own LAYERS first, and BEFORE the `continue`s below: a flipbook cell bails out
			// two lines down, so a layer authored on one would never have its spine bundle / sprite
			// sheet shipped — the art would show in the tool and be missing in the game (rule 8).
			// They are the same kind-tagged object the book VFX and the transition carry, so they
			// route through the same `addLayerRefs`.
			for (const layer of cell?.layers ?? []) addLayerRefs(layer, refs);
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
	// Book-symbol VFX layers and the explosion transition carry the same asset kinds as a per-cell
	// binding, so route each one's asset through the SAME refs — a spine's bundle + a sprite's sheet
	// must ship or the game loads nothing under the key (rule 8). A flipbook's clip ships via the
	// editor-art clip walk (like a flipbook cell, skipped here); an fx's effect ships via the effects
	// export. A spine bound ONLY as the transition reaches `index.spines` through the third line and
	// no other — `check-symbol-transition.ts` asserts it.
	addLayerRefs(doc.bookVfx?.background, refs);
	addLayerRefs(doc.bookVfx?.foreground, refs);
	addLayerRefs(doc.transition, refs);
	// Stacked-picture tall art — each stacked symbol's `art` is a sprite/spine/flipbook binding exactly
	// like a grid cell, so route it through the SAME refs or the game would load nothing under the key
	// (rule 8). Gated the same as the emitted `stacked` field (master toggle on) so a disabled project
	// ships nothing. A flipbook art's clip rides the editor-art clip walk (skipped here, like a cell).
	if (doc.stackedPictures?.enabled === true) {
		for (const s of doc.stackedPictures.symbols ?? []) {
			addCellRefs(s.art, refs);
			addCellRefs(s.winArt, refs);
		}
	}
	return refs;
}

/** Reduce ONE authored stacked picture to the baked contract's art fields — the kind, its asset, and
 *  whichever of `animationName`/`clipId` that kind uses. Never a `sizeRatios`: stacked art is sized by
 *  the symbol's `height` in cells, not a ratio. Shared by both picture slots so the resting and the
 *  winning picture can never bake through different rules. */
function stackedArt(cell: SymbolCell): SymbolExportStackedArt {
	const art: SymbolExportStackedArt = { type: cell.type, assetKey: cell.assetKey };
	if (cell.animationName) art.animationName = cell.animationName;
	if (cell.clipId) art.clipId = cell.clipId;
	return art;
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

/** Route one kind-tagged LAYER's asset (a Book-VFX layer, the explosion transition, a symbol cell's
 *  own extra layer) into the shared
 *  `refs` — spine bundle or sprite sheet frame, the same split `collectSymbolRefs` applies to a
 *  per-cell sprite/spine binding. Flipbook + fx layers ship no asset through this exporter (clip art
 *  via editor-art; effect via the effects export). */
function addLayerRefs(
	layer: { kind: 'sprite' | 'spine' | 'flipbook' | 'fx'; assetKey?: string } | undefined,
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
function toTexturePackerJson(set: EditorRegionSet, pageFile: string, sx = 1, sy = 1): string {
	const frames: Record<string, TexturePackerFrame> = {};
	// `sx`/`sy` rescale every coordinate onto a page the KTX2 encoder auto-downscaled (see
	// `ktx2Encode`'s `DEFAULT_MAX_DIMENSION`). The ratios are uniform, so UVs are unchanged and the
	// art draws at the same size, just from a smaller page — the rule `editorArtExport` already
	// follows. Both default to 1, so the WebP page's JSON is byte-identical to before.
	const rx = (n: number) => Math.round(n * sx);
	const ry = (n: number) => Math.round(n * sy);
	for (const r of set.regions) {
		const origW = r.origW ?? r.w;
		const origH = r.origH ?? r.h;
		const offX = r.offX ?? 0;
		const offY = r.offY ?? 0;
		const entry: TexturePackerFrame = {
			frame: { x: rx(r.x), y: ry(r.y), w: rx(r.w), h: ry(r.h) },
			rotated: r.rotated === true,
			trimmed: offX !== 0 || offY !== 0 || origW !== r.w || origH !== r.h,
			spriteSourceSize: { x: rx(offX), y: ry(offY), w: rx(r.w), h: ry(r.h) },
			sourceSize: { w: rx(origW), h: ry(origH) },
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
				size: { w: rx(set.pageWidth), h: ry(set.pageHeight) },
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
	opts?: {
		/**
		 * The shared content-addressed page store, owned by the caller.
		 *
		 * Without it every symbol rig shipped a PRIVATE copy of its atlas page. Eight symbols
		 * sharing `S_Game_Reel` shipped that page eight times — 12.3 MB of one delivery, and eight
		 * separate GPU textures for identical bytes, which is precisely the VRAM duplication
		 * `pageStore` was built to end (see its header: the iOS OOM came from a page appearing
		 * under multiple rig folders). Symbols were simply never wired to it.
		 *
		 * The store must be the SAME instance the art export uses: the two run in one
		 * `Promise.all`, and a page deduped by one has to be visible to the other or it is written
		 * twice under different subtrees.
		 */
		pageStore?: PageStore;
		/**
		 * Per-phase collector, surfaced as `symbols:<name>` in `/api/editor/runtime`'s
		 * `Server-Timing` header — the same treatment `exportEditorArt` already has.
		 *
		 * WHY. With `art` parallelised (#756), `symbols` is THE ceiling of the runtime assemble:
		 * 29.1s of what is now a ~32s total, with nothing else above ~17s. The top-level number
		 * cannot say which of this function's three sequential loops owns it, and the answer
		 * decides the fix rather than just sizing it — two of the loops are map-shaped and safe to
		 * overlap, but the by-name candidate scan is a SEARCH WITH AN EARLY BREAK, so fanning that
		 * one out would load every candidate instead of stopping at the first covering set and
		 * could do strictly more R2 work. Measure before touching it.
		 */
		timings?: Record<string, number>;
	},
): Promise<SymbolExportResult> {
	/** Record a phase's elapsed ms under `symbols:<name>`, or run it untimed when no record
	 *  was passed (Publish and the desktop bake call this without one). */
	const phase = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
		if (!opts?.timings) return run();
		const startedAt = Date.now();
		try {
			return await run();
		} finally {
			opts.timings[`symbols:${name}`] = Date.now() - startedAt;
		}
	};
	// Repair any sprite cell whose scoped atlas ref names its manifest by a bare basename (the same
	// naming problem the flipbook clips had), so a pinned atlas resolves to the full manifest key
	// the sheet ships under. A correctly-authored doc pays nothing.
	const doc = await phase('doc', async () =>
		canonicalizeSymbolsDocForExport(
			await loadSymbolsDoc(clientKey, projectKey),
			clientKey,
			projectKey,
		),
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
		// Carry the page's REAL extension, as `editorArtExport` and `spine.ts` do. Defaulting
		// anything non-`.webp` to `png` was survivable while the copy stayed inside
		// `editor-symbols/` — one mislabelled private file. It is not survivable in the SHARED
		// store: the filename is `<hash>.<ext>`, the content key is ETag+size only, so a `.jpg`
		// page named `.png` here and `.jpg` by the art export becomes two objects for identical
		// bytes that then delete and re-encode each other on every assemble.
		const pageExt = /\.(png|webp|jpe?g)$/i.exec(set.pageKey)?.[1].toLowerCase() ?? 'png';
		const pageFile = `${stem}.${version}.${pageExt}`;
		const jsonRel = `${EXPORT_SUBTREE}/${stem}/${stem}.${version}.json`;
		const pageRel = `${EXPORT_SUBTREE}/${stem}/${pageFile}`;

		// Route the packed page through the shared store when the caller supplied one — the same
		// treatment the symbol RIGS got when they were wired to it, and the half that was left
		// behind. Two wins, both of them VRAM: the page is deduped against every rig and art sheet
		// that uses it (one GPU texture, not N), and it gets a KTX2 twin, without which a symbol
		// sheet is a raw 32 MB upload on exactly the devices the compressed tier exists to protect.
		// No store ⇒ the old verbatim per-bundle copy, unchanged (parity).
		let ktx2Json: string | undefined;
		if (opts?.pageStore) {
			const shared = await opts.pageStore.ensure(set.pageKey, pageExt);
			if (!shared) return;
			await putObjectText(
				`${deployPrefix}${jsonRel}`,
				toTexturePackerJson(set, `${PAGE_REF_PREFIX}${shared.file}`),
				'application/json',
			);
			written.add(`${deployPrefix}${jsonRel}`);
			// The twin is a SECOND spritesheet JSON over the same regions, pointing at the `.ktx2`
			// page with rects rescaled to its dimensions (equal to the source unless the encoder
			// downscaled it). The game registers it on the compressed tier; absent ⇒ WebP/PNG.
			if (shared.ktx2File) {
				ktx2Json = `${EXPORT_SUBTREE}/${stem}/${stem}.${version}.ktx2.json`;
				const sx = set.pageWidth ? shared.ktx2Width / set.pageWidth : 1;
				const sy = set.pageHeight ? shared.ktx2Height / set.pageHeight : 1;
				await putObjectText(
					`${deployPrefix}${ktx2Json}`,
					toTexturePackerJson(set, `${PAGE_REF_PREFIX}${shared.ktx2File}`, sx, sy),
					'application/json',
				);
				written.add(`${deployPrefix}${ktx2Json}`);
			}
		} else {
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
		}
		sheets.push({ key: set.assetKey, json: jsonRel, frames: set.regions.length, ktx2Json });
		sheetFrameNames.push({ stem, names: set.regions.map((r) => r.name) });
		for (const r of set.regions) coveredFrames.add(r.name);
	};

	// ── Scoped sprite cells: ship exactly the atlas each one pins ──
	// A scoped ref (`<manifest>::<region>`) names its sheet, so load + export it directly rather
	// than guess via the ambiguous by-name scan below. `toTexturePackerJson` emits the scoped key,
	// so the cell resolves uniquely in-game even when another atlas reuses the region name — this is
	// what stops the idle-board static sprites from collapsing to one shared texture.
	await phase('sheets:pinned', async () => {
		for (const manifestKey of refs.spriteManifests) {
			await exportSheet(await loadRegionSet(manifestKey, clientKey, projectKey));
		}
	});

	await phase('sheets:scan', async () => {
		if (refs.frameNames.size === 0) return;
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
	});

	// ── Spine cells: copy each referenced bundle into deploy/ via the shared helper ──
	// `assetKey` is the full R2 bundle prefix; `exportSpineBundle` copies the bundle's
	// own atlas + skeleton + pages (renaming a Rigger `.irig` skeleton to `.json` so
	// `PIXI.Assets.load` can parse it), preserving page names so the atlas refs resolve
	// once mirrored. Dedup by assetKey (W.win + W.land share one bundle → copy once).
	const spines: SymbolSpine[] = [];
	const exportedSpines = new Set<string>();
	const skeletonIndex = await phase('spines:index', async () =>
		refs.spineKeys.size > 0 ? loadSkeletonIndexWithShared(clientKey, projectKey) : [],
	);

	// THE symbols exporter's whole cost. Profiled 2026-09-21 on `test6`: this loop was 27.9s of a
	// 28.4s `symbols`, with every other phase under 100ms — it is R2 latency per bundle, exported
	// one at a time, exactly as `art`'s loops were before #756.
	//
	// PLAN synchronously, in `refs.spineKeys` order, then EXECUTE concurrently. The plan pass is not
	// ceremony: `claimStem` is a check-then-act on `usedStems`, and although it never awaits (so it
	// cannot produce a DUPLICATE stem), calling it from concurrent tasks would hand the `_2` suffix
	// to whichever bundle's R2 read landed first — so two assembles of an unchanged project would
	// ship the same rig under different filenames. Deciding it up front keeps the name a pure
	// function of the doc. `exportedSpines` dedup moves up with it for the same reason.
	//
	// `opts.pageStore` is shared across tasks and safe: `PageStore.ensure` single-flights per source
	// key (#756), so two rigs on one page copy + KTX2-encode it once between them.
	await phase('spines:bundles', async () => {
		const plan: { assetKey: string; stem: string }[] = [];
		for (const assetKey of refs.spineKeys) {
			if (exportedSpines.has(assetKey)) continue;
			exportedSpines.add(assetKey);
			plan.push({ assetKey, stem: claimStem(assetKey.replace(/\/$/, '')) });
		}
		await mapWithConcurrency(plan, SYMBOL_EXPORT_CONCURRENCY, async ({ assetKey, stem }) => {
			const result = await exportSpineBundle({
				clientKey,
				projectKey,
				assetKey,
				deployPrefix,
				subtree: EXPORT_SUBTREE,
				stem,
				skeletonIndex,
				scale: SYMBOL_SPINE_LOAD_SCALE,
				// Dedup this rig's atlas page into the shared `_pages/` store instead of copying it
				// under `editor-symbols/<rig>/`. Undefined ⇒ the old per-bundle copy (parity).
				pageStore: opts?.pageStore,
			});
			if (!result) return;
			for (const k of result.written) written.add(k);
			spines.push(result.entry);
		});
	});

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

	// CANONICAL ORDER — `spines` is filled by side-effecting `push`es from concurrent tasks, so its
	// array order is whichever bundle finished first. Nothing downstream reads that order (the game
	// registers each entry by `key`), but a payload that is never byte-equal to itself defeats the
	// content fingerprint the runtime cache needs, and makes diffing two bundles noise. `sheets` is
	// still exported sequentially and sorted here anyway, so the whole index is order-stable by
	// construction rather than by which loops happen to be concurrent today. Learned the hard way
	// on the art index, which shipped unsorted for one release (#757).
	const index: SymbolExportIndex = {
		sheets: [...sheets].sort((a, b) => a.key.localeCompare(b.key)),
		images: [],
		spines: [...spines].sort((a, b) => a.key.localeCompare(b.key)),
		collisions,
		missing,
	};
	const indexKey = `${symbolsPrefix}index.json`;
	await putObjectText(indexKey, JSON.stringify(index, null, '\t'), 'application/json');
	written.add(indexKey);

	// Prune leftovers from a previous export so deploy/editor-symbols/ mirrors the doc.
	await phase('prune', async () => {
		const existing = await listAllKeys(symbolsPrefix);
		await deleteObjects(existing.filter((k) => !written.has(k)));
	});

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

	// The win-explosion pop. Assetless (a single switch — the art it plays is the symbol's existing
	// Explosion cell, which already ships through the map), so a verbatim pass-through of the
	// already-pruned field: absent for every project that left the switch off.
	const winExplode = doc.winExplode;

	// The win-beat ceiling. Assetless too (one number in milliseconds — it cuts an animation the map
	// already ships short), so another verbatim pass-through of the already-pruned field: absent for
	// every project that never authored one, which is what keeps that project's pacing untouched.
	const winBeat = doc.winBeat;

	// The arrival release. Assetless as well (one switch over an animation the map already ships —
	// it does not shorten that animation, it stops the round waiting on it), so the same verbatim
	// pass-through of the already-pruned field: absent for every project that left it off.
	const arrivalRelease = doc.arrivalRelease;

	// The free-spin board glow. Like `highlight`, its bundle already shipped via `refs.spineKeys`
	// into `index.spines` under this same `assetKey`, so this is just the pointer + its sparse
	// animation/size overrides, forwarded verbatim.
	const boardGlow = doc.boardGlow;

	// The Book-symbol VFX layers. Each layer's asset already shipped via `refs` above (spine bundle →
	// `index.spines`, sprite sheet → `index.sheets`, both keyed by the layer's own `assetKey`) or via
	// a sibling export (flipbook clip / fx effect), so this is a verbatim pass-through of the sparse
	// authored config, exactly like `boardGlow`. Absent → the game renders no book VFX.
	const bookVfx = doc.bookVfx;

	// The explosion → intro transition. Its asset already shipped via `refs` above (or a sibling
	// export), so this is a verbatim pass-through of the sparse authored binding + delay, exactly like
	// `bookVfx`. Absent → the seam stays a hard cut.
	const transition = doc.transition;

	// The cascade explosion pattern. Assetless (a pattern name + a millisecond gap), so a verbatim
	// pass-through of the already-pruned doc field — `normalizeSymbolsDoc` has dropped it entirely
	// for a project left on "all at once", which is what keeps that project's bundle byte-identical.
	const tumblePattern = doc.tumblePattern;

	// The reel-anticipation FX. Its optional `spineKey` bundle already shipped via `refs.spineKeys`
	// into `index.spines` under this same key (like `boardGlow`); the per-tier FX are pure config, so
	// this is a verbatim pass-through of the sparse authored doc (alias-keyed per-tier FX). Absent →
	// the coded `codedTierFx` ramp.
	const anticipation = doc.anticipation;

	// Display names — another assetless pass-through, omitted when nothing is named so an
	// un-authored project's bundle stays byte-identical.
	const names = doc.names && Object.keys(doc.names).length ? doc.names : undefined;

	// Per-symbol sound overrides — assetless too (an audiosprite key names a region of the game's own
	// sound file, which ships with the game and needs no ref), and omitted when nothing is bound so an
	// un-authored project bakes no `symbolSounds` field at all.
	const symbolSounds =
		doc.symbolSounds && Object.keys(doc.symbolSounds).length ? doc.symbolSounds : undefined;

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
						const art = stackedArt(s.art);
						// The win picture is optional — a symbol without one keeps showing `art` while it pays.
						const winArt = s.winArt?.assetKey ? stackedArt(s.winArt) : undefined;
						return { name: s.name, height: s.height, art, ...(winArt ? { winArt } : {}) };
					}),
					...(doc.stackedPictures.fullHeightOnly ? { fullHeightOnly: true } : {}),
					...(doc.stackedPictures.edgeCutoffs ? { edgeCutoffs: true } : {}),
					...(doc.stackedPictures.winHoldMs !== undefined
						? { winHoldMs: doc.stackedPictures.winHoldMs }
						: {}),
				}
			: undefined;

	return {
		map: doc.symbols,
		index,
		...(names ? { names } : {}),
		...(symbolSounds ? { symbolSounds } : {}),
		...(highlight ? { highlight } : {}),
		...(boardGlow ? { boardGlow } : {}),
		...(winLine ? { winLine } : {}),
		...(winCycle ? { winCycle } : {}),
		...(winExplode ? { winExplode } : {}),
		...(winBeat ? { winBeat } : {}),
		...(arrivalRelease ? { arrivalRelease } : {}),
		...(bookVfx ? { bookVfx } : {}),
		...(transition ? { transition } : {}),
		...(tumblePattern ? { tumblePattern } : {}),
		...(anticipation ? { anticipation } : {}),
		...(stacked ? { stacked } : {}),
	};
}
