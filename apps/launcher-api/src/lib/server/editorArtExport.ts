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
	FEATURE_CARD_DEF,
	isBuiltinRegion,
	parseScopedFrameRef,
} from 'engine-layout';
import { EDITOR_SPINE_LOAD_SCALE } from '$lib/spineScale';
import { betModeCardIds, betModeCardParamRefs } from 'game-config';
import { sheetVersion } from './assetVersion';
import { repairComponentDefsAtlasRefs } from './atlasRefRepair';
import { loadComponent } from './componentStorage';
import { loadDoc } from './editorStorage';
import { loadGameConfigDoc } from './gameConfigStorage';
import { applyClipBounds, clipFrameRefs, clipSheetKeys } from 'engine-flipbook';
import { artBoundsRef, loadArtBoundsDoc, type ArtBounds } from './artBoundsStorage';
import { collectPlayedClipIds } from './clipReachability';
import { loadFlipbookDoc } from './flipbookStorage';
import { listEffects, loadEffect } from './fxStorage';
import { loadRegionSet, type EditorRegionSet } from './editorRegions';
import { listProjectAssets } from './projectAssets';
import { SUB } from './projectPaths';
import {
	bundleFromAssetKey,
	exportSpineBundle,
	loadSkeletonIndexWithShared,
	parseSpineBundleKey,
	type ExportedSpineEntry,
} from './spine';
import { deleteObjects, listAllKeys, putObjectText } from './r2';
import { PageStore, PAGE_REF_PREFIX } from './pageStore';

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
	/** Spine `assetKey`s the doc PLACES that name an R2 bundle prefix which resolved to
	 *  nothing — a reference into another project, or a bundle since deleted/renamed. The
	 *  spine half of the dangling-binding guard: the doc keeps the prefix as its runtime
	 *  lookup key, so the game throws `Spine: key "…" is not found in loadedAssets` and the
	 *  art is simply absent. Bare/coded keys (`bigwin`) are excluded — the game registers
	 *  those itself, so reporting them would be the false alarm `isBuiltinRegion` prevents
	 *  for regions. */
	spinesMissing: string[];
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
			// A sprite `region` can itself be a SCOPED ref (`<assetKey>::<frame>` — what an
			// image-kind param binding stores), which is how `LayoutNodeView` reads it. Adding the
			// raw value would put a string no sheet can carry into `usedRegions`, and the dangling
			// guard below would then report a perfectly good frame as "in NO shipped atlas".
			const scoped = parseScopedFrameRef(node.region);
			refs.usedRegions.add(scoped.region);
			if (scoped.assetKey) refs.manifestKeys.add(scoped.assetKey);
		}
		if (node.kind === 'sprite' && isManifestAssetKey(node.assetKey)) {
			refs.manifestKeys.add(node.assetKey);
		} else if (node.kind === 'sprite' && !node.region && isImageAssetKey(node.assetKey)) {
			refs.imageKeys.add(node.assetKey);
		} else if (node.kind === 'spine' && typeof node.assetKey === 'string' && node.assetKey) {
			refs.spineKeys.add(node.assetKey);
		}
		// A `reelGrid` node's GROUND TILE art (docs/design/perspective-board-mode.md §"The tiles").
		// This `visit` is a per-node-kind WHITELIST, so a kind it has never heard of contributes
		// nothing — and because the editor reads R2 directly, a tile authored without this branch
		// would look perfect while it was being placed and ship as a missing frame.
		//
		// `addImageRef`, not a copy of the sprite branch above, because the tile key stores exactly
		// the shape an image-kind param binding stores: a scoped ref pins its atlas (the manifest is
		// exported and the BARE region is marked used — never the raw `<assetKey>::<frame>` string,
		// which no sheet can carry and which the dangling guard below would then report as "in NO
		// shipped atlas"), while a legacy bare name joins the name-guess pool resolved against the
		// project's atlases.
		if (node.kind === 'reelGrid' && typeof node.tileRegion === 'string' && node.tileRegion) {
			addImageRef(refs, node.tileRegion);
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
 * `/api/editor/doc?components=1` bake — built-in → shared → project).
 *
 * `extraSeedIds` are the config-assigned buy-feature card ids (`betModeCardIds`) — components a bet
 * mode names at RUNTIME, invisible to the static scene walk. Seeding them here means each card's OWN
 * sprite/spine art is discovered and exported to `deploy/editor-art/`, so the shipped card is not a
 * blank frame. A seed with no def resolves to null and is skipped (the mode falls back to the default
 * `featureCard`, whose art the scene walk already covers). */
async function resolveReferencedDefs(
	doc: LayoutDoc,
	projectKey: string,
	extraSeedIds: string[] = [],
): Promise<Record<string, ComponentDef>> {
	const defs: Record<string, ComponentDef> = {};
	const seen = new Set<string>();
	const queue = [
		...collectComponentIds(doc.scenes.flatMap((scene) => scene.nodes)),
		...extraSeedIds,
	];
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

/**
 * Build the TexturePacker json-hash the engine's `sprites` loader parses, with frames keyed
 * EXACTLY by the editor region names (`SpriteNode.region` values). `sx`/`sy` scale EVERY pixel
 * coordinate — used for the KTX2 variant when its page was downscaled, so the frame rects match
 * the smaller page (identical UVs ⇒ sprites render at the same size, just lower-res). Default 1
 * ⇒ full-res, byte-identical to before.
 *
 * `box` supplies a region's AUTHORED bounds — the sprite twin of a rig's size frame. This is the
 * whole ship path for that feature and the reason it needs no runtime code: a declared box IS a
 * `sourceSize`, and where the art sits inside it IS a `spriteSourceSize`, which is exactly the pair
 * PIXI builds a texture's `orig`/`trim` from. So a boxed region arrives in the game already sized,
 * anchored and cover-fitted by its box, through the loader that was already there. A region with no
 * authored box writes its own packed geometry, byte-identical to before (parity).
 */
function toTexturePackerJson(
	set: EditorRegionSet,
	pageFile: string,
	sx = 1,
	sy = 1,
	box?: (regionName: string) => ArtBounds | undefined,
): string {
	const frames: Record<string, TexturePackerFrame> = {};
	const rx = (n: number) => Math.round(n * sx);
	const ry = (n: number) => Math.round(n * sy);
	for (const r of set.regions) {
		const declared = box?.(r.name);
		// The box REPLACES the region's declared canvas, and the art keeps its size at its position
		// inside it. Computed by `applyClipBounds` rather than inline: a clip's box, a region's box
		// and this export are the same operation in the same space, and a fourth hand-written copy of
		// it is how the editor and the game start disagreeing about where a boxed frame lands.
		// A box SMALLER than the art yields a negative offset and an art rect that exceeds the box:
		// deliberate, and drawn correctly (`updateQuadBounds` positions the quad from `trim` and takes
		// only the anchor from `orig`).
		const geo = declared
			? applyClipBounds(
					{
						origW: r.origW ?? r.w,
						origH: r.origH ?? r.h,
						offX: r.offX ?? 0,
						offY: r.offY ?? 0,
						artW: r.w,
						artH: r.h,
					},
					declared,
				)
			: null;
		const origW = geo ? geo.origW : (r.origW ?? r.w);
		const origH = geo ? geo.origH : (r.origH ?? r.h);
		const offX = geo ? geo.offX : (r.offX ?? 0);
		const offY = geo ? geo.offY : (r.offY ?? 0);
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
 * Export every atlas the project's layout doc (and its component defs) reference
 * into `deploy/editor-art/`, prune leftovers from a previous export, and write
 * the `index.json` the game build registers. Idempotent — re-running converges.
 */
export async function exportEditorArt(
	clientKey: string,
	projectKey: string,
	/**
	 * Extra spine BUNDLE NAMES to ship even though the static scene/def walk never sees them.
	 * Today: the rigs a project's CINEMATICS cast. A cinematic references rigs that may appear in
	 * no scene at all, so without this seed the doc ships while its rigs do not — the exact
	 * "renders in the tool, blank in the game" trap rule 8 exists to prevent. Same shape as the
	 * `cardComponentIds` / FX-atlas seeds below: runtime-chosen refs the walk is blind to.
	 */
	opts?: {
		extraSpineNames?: Iterable<string>;
		/**
		 * Optional per-PHASE timings, folded into the caller's record and surfaced on
		 * `/api/editor/runtime`'s `Server-Timing` header.
		 *
		 * `art` is ~34s of a ~37s assemble (measured 2026-08-20), and the top-level number cannot say
		 * WHY. The page store already skips re-encoding, so the cost is not compute — the suspicion is
		 * that the three export loops below run one item at a time, each making several sequential R2
		 * round-trips. These sub-timings are what turns that into a measurement before anyone
		 * parallelises a loop that writes shipped game art.
		 */
		timings?: Record<string, number>;
	},
): Promise<EditorArtIndex> {
	/** Record a phase's elapsed ms under `art:<name>`, or run it untimed when no record was passed. */
	const phase = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
		if (!opts?.timings) return run();
		const startedAt = Date.now();
		try {
			return await run();
		} finally {
			opts.timings[`art:${name}`] = Date.now() - startedAt;
		}
	};
	const doc = (await loadDoc(clientKey, projectKey)) as LayoutDoc;
	// Seed the def walk with the config's per-mode buy-feature card ids so each card's OWN art rides
	// this export — those ids are chosen at runtime, so `collectComponentIds` (the static scene walk)
	// never sees them. `loadGameConfigDoc` is null for a never-authored project ⇒ no seeds ⇒ parity.
	const gameConfig = await loadGameConfigDoc(clientKey, projectKey);
	const cardComponentIds = gameConfig ? betModeCardIds(gameConfig) : [];
	// Per-mode `cardParams` overrides can name art/spine keys on the card component (a different
	// panel/icon/spine per card), chosen at runtime — so their DEFS must be resolvable to classify each
	// override key by param KIND. Seed the default `featureCard` too when any mode overrides params
	// WITHOUT a custom card (its explicit card is already in `cardComponentIds`). Empty ⇒ no extra seed.
	const cardParamRefs = gameConfig ? betModeCardParamRefs(gameConfig) : [];
	const cardParamSeedIds = cardParamRefs.some((ref) => !ref.card)
		? [...cardComponentIds, FEATURE_CARD_DEF.id]
		: cardComponentIds;
	const defs = await resolveReferencedDefs(doc, projectKey, cardParamSeedIds);
	// `loadDoc` repaired the doc's own atlas refs; do the same for the defs BEFORE collecting, so a
	// def whose art was authored against a sheet output prefix queues that sheet's real MANIFEST
	// key — the key the runtime, reading the same repaired defs, will look the frame up under.
	await repairComponentDefsAtlasRefs(Object.values(defs), clientKey, projectKey);
	const refs = collectArtRefs(doc, defs);

	// Collect art/spine keys referenced through the config's per-mode `cardParams` overrides — the
	// static scene/def walk in `collectArtRefs` never sees them (the keys are chosen at RUNTIME in the
	// config). Mirror its component-instance param branch: classify each override key by the resolved
	// card def's param KIND (image → atlas manifest/region, spine → bundle name). A missing card def or
	// an unknown/non-string value is skipped safely, so a mode falling back to the default `featureCard`
	// (or overriding only a color/text param) ships exactly as before.
	for (const ref of cardParamRefs) {
		const cardDef = defs[ref.card] || defs[FEATURE_CARD_DEF.id];
		if (!cardDef) continue;
		for (const p of cardDef.params ?? []) {
			const value = ref.cardParams[p.key];
			if (typeof value !== 'string' || !value) continue;
			if (p.kind === 'image') addImageRef(refs, value);
			else if (p.kind === 'spine') refs.spineNames.add(value);
		}
	}
	// Rigs a cinematic casts (see `opts.extraSpineNames`) — bundle NAMES, the same currency the
	// `spine`-kind component-param branch above adds.
	for (const name of opts?.extraSpineNames ?? []) {
		if (typeof name === 'string' && name) refs.spineNames.add(name);
	}

	// Reconcile bare region names picked up above into the used-region set (mirrors `collectArtRefs`).
	for (const n of refs.regionNames) refs.usedRegions.add(n);

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
		// A clip is shipped only when something PLAYS it. The registry used to be its own
		// reason to exist: every clip in the doc queued its sheets, so an ORPHANED clip — one no
		// scene, component, symbol, effect or flow node names — dragged its whole atlas into the
		// build. Measured on a real project: one unused 160-frame clip shipped an 8192×8192 page
		// as an 80 MB PNG plus a 6.8 MB KTX2 — and because 67 Mpix is ~6× the encoder's 11 Mpix
		// cap, that page was downscaled to 40%, so the dead art also set the resolution ceiling
		// for the shared page store it was deduplicated into.
		//
		// `null` means reachability could NOT be determined (a doc failed to load), and then
		// every clip ships — the old behaviour. Shipping an unused clip costs bytes; dropping a
		// used one costs an animation that renders nothing, so the uncertain case must not prune.
		const played = await collectPlayedClipIds(clientKey, projectKey, { doc, defs });
		const skipped: string[] = [];
		for (const clip of (await loadFlipbookDoc(clientKey, projectKey)).clips) {
			if (played && !played.has(clip.id)) {
				skipped.push(clip.id);
				continue;
			}
			for (const key of clipSheetKeys(clip)) {
				if (isManifestAssetKey(key)) refs.manifestKeys.add(key);
			}
			const frameRefs = clipFrameRefs(clip).filter((r) => !!r.region);
			for (const r of frameRefs) refs.usedRegions.add(r.region);
			clipRefs.push({ clipId: clip.id, refs: frameRefs });
		}
		// Say what was dropped. A silently smaller export is indistinguishable from a broken one,
		// and this is the line that explains a clip's art going missing after an edit.
		if (skipped.length) {
			console.log(
				`[editor-art] skipped ${skipped.length} unplayed flipbook clip(s): ${skipped.join(', ')}` +
					' — nothing references them, so their sheets are not exported.',
			);
		}
	} catch {
		// Clips are additive art — never let them break the sprite/spine export.
	}

	/**
	 * The project's AUTHORED region boxes (`<assetKey>::<region>` → box), read once and folded into
	 * every sheet JSON written below. Empty for a project that has declared none, in which case
	 * every frame ships its own packed geometry exactly as before.
	 *
	 * Read here rather than shipped as its own file: the box's whole job is to be a region's
	 * declared size, and the shipped TexturePacker JSON already carries that field. Nothing new
	 * reaches R2 — there is no asset class to strand (rule 8) and no runtime registration.
	 */
	const artBounds = (await loadArtBoundsDoc(clientKey, projectKey)).bounds;
	const hasArtBounds = Object.keys(artBounds).length > 0;
	/** A per-sheet box lookup, scoped so a region name that exists on two sheets can be boxed
	 * differently on each — the same `<assetKey>::<region>` scoping every other art surface uses. */
	const artBoundsLookup = (
		manifestKey: string,
	): ((r: string) => ArtBounds | undefined) | undefined =>
		hasArtBounds ? (region: string) => artBounds[artBoundsRef(manifestKey, region)] : undefined;

	const deployPrefix = `${SUB.deploy(clientKey, projectKey)}/`;
	const artPrefix = `${deployPrefix}editor-art/`;

	const sheets: EditorArtSheet[] = [];
	const written = new Set<string>();
	// Content-addressed page store: a page shared by several sheets/rigs is copied + KTX2-encoded
	// ONCE (under `_pages/`) and loads as ONE GPU texture — fixes the rig page-duplication VRAM
	// leak. Its writes are pruned separately (they live outside `editor-art/`). Shared with the
	// spine export so rig atlases dedup against the sheets too.
	const pageStore = new PageStore(deployPrefix);
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
		const jsonRel = `editor-art/${stem}/${stem}.${version}.json`;

		// Dedup the packed page into the shared content-addressed `_pages/` store (+ its KTX2 twin
		// when enabled): a page used by this sheet AND by rigs / other sheets is copied + encoded
		// ONCE and loads as ONE GPU texture — the fix for the rig page-duplication VRAM leak. The
		// spritesheet JSON references it by the base-independent relative path (`../../_pages/…`);
		// frame rects are unchanged (the WebP page keeps full resolution). Missing source ⇒ skip.
		const shared = await pageStore.ensure(set.pageKey, pageExt);
		if (!shared) return;
		usedStems.add(stem);
		const boxFor = artBoundsLookup(manifestKey);
		await putObjectText(
			`${deployPrefix}${jsonRel}`,
			toTexturePackerJson(set, `${PAGE_REF_PREFIX}${shared.file}`, 1, 1, boxFor),
			'application/json',
		);
		written.add(`${deployPrefix}${jsonRel}`);
		// GPU-compressed KTX2 twin: a SECOND spritesheet JSON pointing `meta.image` at the shared
		// `.ktx2` page, with frame rects rescaled to its (possibly auto-downscaled) dimensions so
		// UVs stay identical. The game registers it on the compressed tier for 4–8× less VRAM.
		// Absent ⇒ `ktx2Json` unset ⇒ the game ships the WebP/PNG unchanged (parity).
		let ktx2Json: string | undefined;
		if (shared.ktx2File) {
			ktx2Json = `editor-art/${stem}/${stem}.${version}.ktx2.json`;
			const sx = set.pageWidth ? shared.ktx2Width / set.pageWidth : 1;
			const sy = set.pageHeight ? shared.ktx2Height / set.pageHeight : 1;
			await putObjectText(
				`${deployPrefix}${ktx2Json}`,
				toTexturePackerJson(set, `${PAGE_REF_PREFIX}${shared.ktx2File}`, sx, sy, boxFor),
				'application/json',
			);
			written.add(`${deployPrefix}${ktx2Json}`);
		}
		sheets.push({ key: manifestKey, json: jsonRel, frames: set.regions.length, ktx2Json });
		sheetRegionNames.push({ stem, names: set.regions.map((r) => r.name) });
		for (const r of set.regions) coveredRegions.add(r.name);
		coveredBySheet.set(manifestKey, new Set(set.regions.map((r) => r.name)));
	};

	await phase('manifests', async () => {
		for (const manifestKey of refs.manifestKeys) {
			await exportManifest(manifestKey);
		}
	});

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

	// Standalone images (dropped atlas PAGES): dedup into the shared `_pages/` store, so an image
	// used as both a rig page AND a dropped page (or by several nodes) loads as ONE texture. The
	// game registers a single-texture asset under the node's full `assetKey`, its `file`/`ktx2`
	// pointing at the shared page (relative to the asset base, so `_pages/…`). A whole-texture
	// sprite has no atlas coords, so a downscaled KTX2 twin just lowers its resolution.
	const images: EditorArtImage[] = [];
	await phase('images', async () => {
		for (const imageKey of refs.imageKeys) {
			const ext = /\.(png|webp|jpe?g)$/i.exec(imageKey)?.[1].toLowerCase() ?? 'png';
			const shared = await pageStore.ensure(imageKey, ext);
			if (!shared) continue;
			images.push({
				key: imageKey,
				file: `_pages/${shared.file}`,
				ktx2: shared.ktx2File ? `_pages/${shared.ktx2File}` : undefined,
			});
		}
	});

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
	//
	// `fromNode` separates the two so the stranded-spine guard below can only fire on a key
	// an author actually WROTE. A reconstructed NAME is project-rooted by construction, so a
	// coded/game-bundled one (`bigwin`) would otherwise report as stranded on every project —
	// the same false-alarm class `isBuiltinRegion` exists to prevent for regions.
	const spines: EditorArtSpine[] = [];
	const spinesMissing: string[] = [];
	const spineAssetKeys = [
		...[...refs.spineKeys].map((assetKey) => ({ assetKey, fromNode: true })),
		...[...refs.spineNames].map((name) => ({
			assetKey: `${SUB.spines(clientKey, projectKey)}/${name}/`,
			fromNode: false,
		})),
	];
	if (spineAssetKeys.length > 0) {
		await phase('spines', async () => {
			const skeletonIndex = await loadSkeletonIndexWithShared(clientKey, projectKey);
			const exportedSpines = new Set<string>();
			const spineStem = (assetKey: string): string => {
				const base = assetKey.replace(/\/$/, '');
				const tail = base.slice(base.lastIndexOf('/') + 1).replace(/[^a-zA-Z0-9_-]/g, '_');
				return tail || 'spine';
			};
			for (const { assetKey, fromNode } of spineAssetKeys) {
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
					// Share the page store so a rig atlas page that matches a sheet page (or another
					// rig's) dedups to ONE shared `_pages/` texture instead of a private copy per rig.
					pageStore,
				});
				if (!result) {
					// STRANDED: the node names an R2 bundle PREFIX that resolved to nothing — a
					// reference into another project (`bundleFromAssetKey` only answers for this
					// project + `_shared/`), or a bundle since deleted/renamed. Either way the
					// export ships nothing while the doc keeps the prefix as its lookup key, so
					// the game throws `Spine: key "…" is not found in loadedAssets` and the art is
					// simply absent. This used to `continue` in silence — the one asset class with
					// no dangling guard (rule 8) — so it reached production unannounced.
					if (fromNode && parseSpineBundleKey(assetKey)) spinesMissing.push(assetKey);
					continue;
				}
				// Register under the plain bundle NAME — not the full prefix — or the runtime
				// lookup misses and the spine never loads in the built game.
				if (gameKey) result.entry.key = gameKey;
				for (const k of result.written) written.add(k);
				spines.push(result.entry);
			}
		});
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
		spinesMissing: spinesMissing.sort(),
		collisions,
		missing: danglingRegions,
		clipMissing,
	};
	const indexKey = `${artPrefix}index.json`;
	await putObjectText(indexKey, JSON.stringify(index, null, '\t'), 'application/json');
	written.add(indexKey);

	// Prune leftovers from a previous export so deploy/editor-art/ mirrors the doc. The shared
	// page store lives in a SIBLING `_pages/` prefix (outside `editor-art/`), so prune it too —
	// against `pageStore.written`, which includes every page REUSED from a previous run (the
	// content-cache adds reused keys to `written`), so an unchanged page is never wrongly deleted.
	const [existing, stalePages] = await phase('prune:list', () =>
		Promise.all([listAllKeys(artPrefix), listAllKeys(`${deployPrefix}_pages/`)]),
	);
	const stale = [
		...existing.filter((k) => !written.has(k)),
		...stalePages.filter((k) => !pageStore.written.has(k)),
	];
	await deleteObjects(stale);

	return index;
}
