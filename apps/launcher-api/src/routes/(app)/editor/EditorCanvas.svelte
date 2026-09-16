<script lang="ts">
	import {
		backgroundCoverScale,
		backgroundCoverStretch,
		backgroundFit,
		boundComponentDefault,
		boundComponentRidesBone,
		boundComponentTileImage,
		builtinSheetIdForRegion,
		builtinSheetKey,
		computeOverlayPlacement,
		canvasCompositeOp,
		cssBlendMode,
		coverTransform,
		hostedComponentSpace,
		instancePreviewSpineBundle,
		isCoverFitKind,
		isHudScene,
		MAX_COMPONENT_DEPTH,
		parseScopedFrameRef,
		resolveAnchorPreviewArt,
		resolveBoundValue,
		resolveComponentParams,
		resolveLayoutInstanceParams,
		anchoredPosition,
		resolveTransform,
		STANDARD_MAIN_SIZES_MAP,
		type ComponentDef,
		type BlendMode,
		type LayoutNode,
		type LayoutType,
		type OverlayPlacement,
		type PlacementGeometry,
		type ResolvedPreviewArt,
		type ResolvedTransform,
		type Scene,
	} from 'engine-layout';
	import { onMount, type Snippet } from 'svelte';
	import {
		childLocalTransform,
		nodeBox,
		nodeCornersWorld,
		repeaterPlaceholderGrid,
		repeaterBoxes,
		topMidWorld,
		pointInQuad,
		reelGridGeometry,
		resolveBoneRiderRigKey,
		type BoneRiderTransform,
		type Vec2,
		type NodeBox,
		type NaturalSize,
		type RepeaterSourceMap,
	} from './editorCanvas.helpers';
	import {
		clearRegionCache,
		fetchRegions,
		isStaticPageKey,
		regionNaturalSize,
		type EditorRegion,
		type RegionDragPayload,
		type RegionSet,
	} from './editorRegions.client';
	import {
		clearClipCache,
		clipFrameAt,
		clipFrameBox,
		clipFrameIndexAt,
		fetchClips,
		type EditorClip,
	} from './editorFlipbooks.client';
	import {
		artBoundsVersion,
		artBoxGeometry,
		clearArtBoundsCache,
		loadArtBounds,
	} from './editorArtBounds.client.svelte';
	import BusyOverlay from '$lib/BusyOverlay.svelte';
	import EditorItemOverlay from './EditorItemOverlay.svelte';
	import EditorEffectLayer from './EditorEffectLayer.svelte';
	import EditorSpineLayer from './EditorSpineLayer.svelte';
	import type { SpineMeta } from './spineRuntime.client';
	import EditorTextLayer from './EditorTextLayer.svelte';
	import { clearFontCatalogCache } from './fonts.client';
	import { clearPageImages } from './RegionThumb.svelte';

	interface AssetDragPayload {
		// `text` / `rect` are not assets — they're blank ELEMENTS the
		// Library's "Elements" palette drags in (key is unused for those).
		// `effect` carries an authored FX id in `key` (the Library's Effects section);
		// `flipbook` an authored clip id (the Library's Flipbooks section).
		kind:
			| 'atlas-page'
			| 'atlas-manifest'
			| 'sheet'
			| 'spine'
			| 'text'
			| 'rect'
			| 'effect'
			| 'flipbook';
		key: string;
		name: string;
	}
	type DragPayload = AssetDragPayload | RegionDragPayload;

	/** Structural view of the project's asset listing (mirrors `ProjectAssets` in
	 * `$lib/server/projectAssets`, but defined here so this client component never
	 * imports a server module). Drives catalog-default preview resolution. */
	interface ProjectAssets {
		atlases: { name: string; key: string; kind: 'atlas-manifest' | 'atlas-page' }[];
		spines: { name: string; key: string }[];
		sheets: { name: string; key: string }[];
	}

	/** Structural twin of a symbol×state binding (mirrors `SymbolCell` in
	 * `$lib/server/symbolsStorage`) — declared here so this client component never
	 * imports a server module. Only the fields the canvas reads. */
	interface SymbolStaticCell {
		type: 'sprite' | 'spine' | 'flipbook';
		assetKey: string;
		/** The animation the STATIC state plays in-game (`SymbolSpineMain`'s `animationName`) —
		 * the spine layer auto-loops it so the board preview shows the same pose the game does. */
		animationName?: string;
		/** Tool-only spine resolver hint on a CODED default cell (`<folder>/<stem>`) — the
		 * specific skeleton inside a shared-atlas symbol bundle. Preferred over `assetKey`
		 * when loading the rig, exactly as the Symbols grid does. */
		previewKey?: string;
		/** The authored Invisible Flipbook clip a `flipbook` cell plays. The clip owns the ordered
		 * frames (and may span sheets), so such a cell's `assetKey` holds its PRIMARY SHEET — a
		 * manifest key, never a region name — and only `clipId` can resolve the frame to draw. */
		clipId?: string;
		/** `flipbook` cells only — the binding's PER-STATE playback overrides of the clip's own
		 * values. The canvas reads them so the board preview animates the way the game will: a
		 * state authored to run in reverse that previewed forwards here would be a
		 * what-you-author-is-not-what-you-see gap, which is the whole reason the clip plays on
		 * this canvas at all. */
		fps?: number;
		direction?: 'forward' | 'reverse' | 'pingpong';
		flipX?: boolean;
		flipY?: boolean;
		sizeRatios?: { width: number; height: number };
	}
	type SymbolStateMap = Partial<Record<string, SymbolStaticCell>>;
	/** The project's coded symbol defaults (dense: every symbol's `static` cell). */
	interface SymbolDefaultsView {
		symbols: Record<string, SymbolStateMap>;
	}
	/** The Symbols State Machine override doc (sparse per-symbol/state overrides). */
	interface SymbolsDocView {
		symbols: Record<string, SymbolStateMap>;
	}

	interface Props {
		scene: Scene;
		/** All doc scenes — used to locate the `boardFrame` node (which lives in the
		 * basegame scene, NOT the active overlay scene) so board-relative previews
		 * land on their real in-game spot. */
		scenes: Scene[];
		/** The game's main-layout sizes per layoutType — the coordinate space a
		 * `positioned` overlay preview is mapped from (board centre / left-of-board). */
		mainSizesMap: Record<LayoutType, { width: number; height: number }>;
		frameWidth: number;
		frameHeight: number;
		/** Active authoring layoutType; a non-base bucket puts edits into override mode. */
		layoutType: LayoutType;
		/** The BASE bucket id (the profile's fallback). Edits in this bucket write the base
		 * transform; any other bucket writes a sparse `overrides[layoutType]`. Defaults to the
		 * legacy `'desktop'` so any caller that hasn't threaded it stays byte-identical. */
		baseLayoutType?: LayoutType;
		/** The STANDARD (HUD/frame) design box for the current bucket — the active profile's
		 * bucket box (== `frameSize` on the page). `standard`-space nodes fit against it, the
		 * editor twin of the runtime's `mainLayoutStandard`. Falls back to the legacy fixed map
		 * when a caller doesn't pass it (back-compat). */
		standardBox?: { width: number; height: number };
		/** The project's asset listing — used to resolve catalog-default preview art
		 * for `bind` anchors (spine bundle by name, sprite region by manifest scan). */
		assets: ProjectAssets;
		/** The project's coded symbol defaults — the dense source of truth for each
		 * symbol's STATIC binding (sprite frame / spine bundle). Lets the canvas draw the
		 * real symbol art in each reel cell so the author sizes symbols in context. */
		symbolDefaults?: SymbolDefaultsView | null;
		/** The Symbols State Machine override doc — sparse per-symbol/state overrides
		 * layered OVER `symbolDefaults` (parity with the tool's effective binding). */
		symbolsDoc?: SymbolsDocView | null;
		/** The board grid COUNT from the project's Game Config (numReels/max(numRows)). The reelGrid
		 * preview draws THIS many cells — the config is the single source of truth for the grid, the
		 * same one the game sizes off. `null` ⇒ fall back to the reelGrid node's own reels/rows. */
		gridDimensions?: { reels: number; rows: number } | null;
		/** Per-source SAMPLE data for `repeater` placeholders, resolved from the project's game config
		 * (currently `featureCards` → one card per non-default bet mode, with each card's per-item
		 * values). Drives BOTH the placeholder count and the per-box component preview. `null` / an
		 * absent source ⇒ the fixed fallback sample + def-default params (parity). */
		repeaterSources?: RepeaterSourceMap | null;
		/** Loaded component defs by id (§8.4) — lets the canvas resolve + draw a
		 * `componentInstance` node by expanding `def.root` under the instance transform.
		 * The editor canvas is its OWN renderer, so it reads this map (NOT the engine
		 * registry). Absent / unknown id → a labelled placeholder. */
		componentMap?: Map<string, ComponentDef>;
		/** EDITOR-PREVIEW ONLY: forwarded to `EditorSpineLayer` — while the author focuses a spine
		 * param in the Properties panel, override the selected instance's bind spine to this bundle +
		 * animation (WYSIWYG). Applies only to {@link spinePreviewNodeId}. Never written to the doc. */
		spinePreview?: { bundle?: string; animation?: string } | null;
		spinePreviewNodeId?: string;
		onSpawn: (node: LayoutNode, pos: { x: number; y: number }) => void;
		/** Hoisted selection — bound from the page. The LAST id is the "primary"
		 * (drives the properties panel + transform handles); shift-click adds/removes. */
		selectedIds?: string[];
		/** Called once after any doc-mutating gesture (drag-spawn, translate/scale/rotate end). */
		onDirty?: () => void;
		/** Remove the node with this id from the active scene + clear selection. */
		onDelete?: (id: string) => void;
		/** Remove several nodes in one transaction (Delete with a multi-selection) — a
		 * single undo step. Falls back to per-id `onDelete` when not provided. */
		onDeleteMany?: (ids: string[]) => void;
		/** Bump to force a full repaint. The page increments this on undo/redo, which
		 * reassigns `scenes` to a clone but can leave node POSITIONS changed with no
		 * other tracked dependency (the count is unchanged) — so this guarantees the
		 * per-scene composites repaint to the restored state. */
		redrawNonce?: number;
		/**
		 * Drag-onto-a-slot request from the page: spawn `payload` at frame centre,
		 * tagged with `slotId`. `seq` dedupes (bump it to fire a new fill); a null
		 * request is a no-op. Routed through a prop rather than a method call so the
		 * page never needs the canvas's internal payload type.
		 */
		fillRequest?: { payload: unknown; slotId: string; seq: number } | null;
		/** Editor-only: scene ids hidden from the composite. The ACTIVE scene always
		 * draws (you're editing it); other non-hidden scenes draw as a dimmed,
		 * non-interactive backdrop so you can see all screens at once. */
		hiddenSceneIds?: Set<string>;
		/** The project's display name — the default HUD game-name shown on the canvas
		 * when the author hasn't typed an override (not written to the doc). */
		projectGameName?: string | null;
		/**
		 * Resolved component params for a non-empty preview (§13.4, B3). When the
		 * Component Editor opens a `ComponentDef` it passes the params resolved by
		 * `resolveComponentParams(def, undefined, projectDefaults)`; a text node with
		 * `paramBindings` then reads its content/style from these values (via the pure
		 * `resolveBoundValue` helper) instead of its own static value. Empty (the
		 * default, and every scene-editor caller) ⇒ identical to today's draw — parity.
		 */
		componentParams?: Record<string, unknown>;
		/** Bubbles the merged `assetKey → {animations,skins}` map for every ready spine
		 * bundle (union across the per-scene sublayers) up to the page, so the Properties
		 * panel can offer animation/skin dropdowns instead of free-text. */
		onSpineMeta?: (meta: Map<string, SpineMeta>) => void;
		/** Undo/redo wiring — when provided, the canvas-actions toolbar shows undo/redo
		 * buttons next to "Reload art" (the history itself lives on the page). Omitted
		 * by callers without a history stack (e.g. the Component Editor). */
		canUndo?: boolean;
		canRedo?: boolean;
		onUndo?: () => void;
		onRedo?: () => void;
		/** Optional device/mode bar rendered at the LEFT of the canvas's top overlay row,
		 * sharing that flex row with the action buttons so the two can never overlap (they
		 * wrap instead) and both sit above the canvas art. The Scene Editor passes its
		 * `<CanvasModeBar inline>`; omit for a bare canvas. */
		modeBar?: Snippet;
	}

	let {
		scene,
		scenes,
		mainSizesMap,
		frameWidth,
		frameHeight,
		layoutType,
		baseLayoutType = 'desktop',
		standardBox,
		assets,
		symbolDefaults = null,
		symbolsDoc = null,
		gridDimensions = null,
		repeaterSources = null,
		componentMap = new Map(),
		spinePreview = null,
		spinePreviewNodeId,
		onSpawn,
		selectedIds = $bindable([]),
		onDirty,
		onDelete,
		onDeleteMany,
		redrawNonce = 0,
		fillRequest = null,
		hiddenSceneIds = new Set<string>(),
		projectGameName = null,
		componentParams = {},
		onSpineMeta,
		canUndo = false,
		canRedo = false,
		onUndo,
		onRedo,
		modeBar,
	}: Props = $props();

	/** Each symbol's STATIC binding for the reel preview: the coded default's `static`
	 * cell, with the override doc's `static` cell layered on top (sparse). Computed once
	 * (not per draw), and cycled across the grid cells so the board looks populated. A
	 * `spine` static is drawn by `EditorSpineLayer` (WebGL) — this list is the SAME one it
	 * receives, so both surfaces cycle the identical symbol into each cell. A `flipbook` static
	 * stays on the 2D canvas: its frames are ordinary atlas regions, so `drawReelGrid` plays it
	 * off the clip doc the same way a placed `flipbook` node does. Empty when no symbol data is
	 * present (graceful). */
	const symbolStatics = $derived.by<SymbolStaticCell[]>(() => {
		if (!symbolDefaults) return [];
		const out: SymbolStaticCell[] = [];
		for (const name of Object.keys(symbolDefaults.symbols)) {
			const base = symbolDefaults.symbols[name]?.static;
			const override = symbolsDoc?.symbols?.[name]?.static;
			const cell = override ?? base;
			if (!cell?.assetKey) continue;
			out.push({
				type: cell.type,
				// A coded default spine cell resolves through its `previewKey` (the specific
				// skeleton in a shared-atlas bundle) — the same key the Symbols grid loads. An
				// authored override never carries one, and a sprite cell never needs one.
				assetKey: (cell.type === 'spine' ? cell.previewKey : undefined) ?? cell.assetKey,
				animationName: cell.animationName,
				clipId: cell.clipId,
				sizeRatios: cell.sizeRatios,
			});
		}
		return out;
	});

	/** Any symbol whose STATIC binding is an Invisible Flipbook clip — a reel board then needs the
	 * clip playback clock running, exactly as a placed `flipbook` node does. Declared beside
	 * `symbolStatics` (not beside `hasSpineSymbol`) because `nodesHaveFlipbook` reads it. */
	const hasFlipbookSymbol = $derived(symbolStatics.some((c) => c.type === 'flipbook'));

	/** The "primary" selected id — the last one picked. Drives the properties panel,
	 * the transform handles, and single-node hit-tests. Most internal code reads this;
	 * the full set (`selectedIds`) only matters for the multi-outline + group drag. */
	const selectedId = $derived(selectedIds.at(-1) ?? null);
	/** Replace the selection with a single node (the common click path). */
	function selectOnly(id: string | null): void {
		selectedIds = id ? [id] : [];
	}
	/** Shift-click: add the node to the selection, or remove it if already in. */
	function toggleSelected(id: string): void {
		selectedIds = selectedIds.includes(id)
			? selectedIds.filter((x) => x !== id)
			: [...selectedIds, id];
	}

	/** B3 numeric readout format: thousands-grouped integer — matches B2's
	 * `ParamReadoutText`/`LayoutNodeView` (`maximumFractionDigits: 0`) so the editor
	 * preview reads like the engine. Cached formatter instance. */
	const paramNumberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

	function getOverride(node: LayoutNode) {
		if (!node.overrides) node.overrides = {};
		let o = node.overrides[layoutType];
		if (!o) {
			o = {};
			node.overrides[layoutType] = o;
		}
		return o;
	}
	/**
	 * Resolve a node's transform with space-specific framing baked into the result,
	 * so every geometry/draw/hit-test path can treat x/y (+ width/height) as plain
	 * WINDOW-world coords. Every scene is composited against ONE fixed window per
	 * `layoutType` (§10.2), so switching the active screen never rescales anything:
	 * - `game` (default): main-box coords mapped into the window EXACTLY like
	 *   `<MainContainer>` — origin via `mainToWorld`, scale multiplied by `mainScale`
	 *   (`s`) so a centred main box is scaled into the window.
	 * - `canvas`: `screenAnchor` is folded into x/y against the window edges.
	 * - `background`: full-bleed cover of the WINDOW via the shared `coverTransform`
	 *   (default `coverScale = 1` = exact cover), centred — matching the game's
	 *   `normalBackgroundLayout({ scale: 1 })`.
	 * - `standard`: fit the STANDARD box into the window (identity now the window IS
	 *   the standard box; still honours bottom-align).
	 */
	function nodeTransform(node: LayoutNode, sceneCtx: Scene = scene): ResolvedTransform {
		const space = sceneCtx.space;
		const t = resolveTransform(node, layoutType);
		// A preview-art bind anchor (e.g. the animated Background, the Win animation, or
		// the free-spin counter) is placed by its catalog `placement`, resolved against
		// the game's geometry: cover/contain size to the frame; board-relative ones land
		// at a MAIN-coord spot mapped to the canvas like `<MainContainer>` does.
		const art = anchorArt(node);
		if (art) {
			return placedArtTransform(node, t, art.placement);
		}
		// No resolvable preview art (e.g. the component's spine isn't in THIS project),
		// but a known overlay still has a catalog PLACEMENT — position its placeholder
		// where the component actually plays (centred / board-relative) instead of
		// stranding it at the anchor's raw origin (top-left). Universal across game
		// types; HUD binds have no catalog placement so they keep the screenAnchor path.
		if (node.bind) {
			const placement = boundComponentDefault(node.bind.component)?.placement;
			if (placement) {
				return placedArtTransform(node, t, placement);
			}
		}
		// A componentInstance hosting a board-relative overlay (catalog `space:'game'` — the win /
		// free-spin VISUALS) is framed against the MAIN box regardless of the host screen's space,
		// mirroring the runtime `LayoutNodeView` game-frame override, so the preview matches the
		// game in ANY screen space. A `game` scene already maps it below (identical result); a
		// `background` scene cover-fits — leave those two alone (parity).
		if (
			node.kind === 'componentInstance' &&
			space !== 'game' &&
			space !== 'background' &&
			hostedComponentSpace(componentMap.get(node.componentId)) === 'game'
		) {
			const s = mainScale();
			const world = mainToWorld({ x: t.x, y: t.y });
			return {
				...t,
				x: world.x,
				y: world.y,
				scale: { x: (t.scale?.x ?? 1) * s, y: (t.scale?.y ?? 1) * s },
			};
		}
		if (space === 'standard') {
			return standardToWorld(t, sceneCtx);
		}
		// A `coverFit` sprite/spine/flipbook in a `canvas`-space (flow-gated) scene cover-fits the
		// window with the SAME true-cover helper the `background` path uses — mirroring the
		// runtime `LayoutNodeView` (`isCanvasCoverFit`), so the preview is WYSIWYG. Scoped to
		// sprite/spine/flipbook (a componentInstance cover stays background-only). Checked BEFORE
		// the plain canvas mapping below, which would otherwise place it at its raw transform.
		if (space === 'canvas' && node.coverFit && isCoverFitKind(node)) {
			return backgroundTransform(node, t);
		}
		if (space === 'canvas') {
			// Canvas space = RAW window coords — the game renders these scenes with NO
			// `<MainContainer>` (see `LayoutScene`), so x/y are window pixels, never the
			// main→window mapping. A `screenAnchor` pins to a window edge; without one the
			// x/y are used verbatim — via the SAME shared `anchoredPosition` the game's
			// `LayoutNodeView` uses, so the two cannot drift. Previously a canvas node WITHOUT
			// a screenAnchor fell through to the game-space mapping below, so the editor placed
			// it (and its selection box) at a DIFFERENT spot + scale than the game ships —
			// every component dropped into a canvas-space scene mismatched. Returning here
			// keeps editor == game.
			return { ...t, ...anchoredPosition(t, space, frameWidth, frameHeight) };
		}
		if (space === 'background' && (isCoverFitKind(node) || node.kind === 'componentInstance')) {
			return backgroundTransform(node, t);
		}
		// game space: map the node's main-box coords into the fixed window the way
		// `<MainContainer>` does — centre the main box + scale it by `mainScale`.
		const s = mainScale();
		const world = mainToWorld({ x: t.x, y: t.y });
		return {
			...t,
			x: world.x,
			y: world.y,
			scale: { x: (t.scale?.x ?? 1) * s, y: (t.scale?.y ?? 1) * s },
		};
	}

	/**
	 * Map a `standard`-space node (HUD bar) into the current frame: fit the STANDARD
	 * reference box into the frame (centred; bottom-aligned when the scene asks),
	 * scaling position + size by the same factor — mirrors `<MainContainer standard>`.
	 * When this scene IS the active one its frame == the standard box, so the fit is
	 * identity (unchanged); as a composited backdrop over a game-space frame it scales
	 * the HUD into view instead of stranding it at raw standard coords.
	 */
	function standardToWorld(t: ResolvedTransform, sceneCtx: Scene): ResolvedTransform {
		const std = standardBox ?? STANDARD_MAIN_SIZES_MAP[layoutType];
		const s = Math.min(frameWidth / (std.width || 1), frameHeight / (std.height || 1));
		const drawW = std.width * s;
		const drawH = std.height * s;
		// Mirror `<MainContainer standard>`'s alignment: centred by default, hug an edge
		// when the scene asks. `left`/`right` only visibly deviate when the standard box
		// fits NARROWER than the frame (letterboxed sides), exactly as the runtime's
		// `getX` shifts the HUD to the window edge.
		const offX =
			sceneCtx.align?.horizontal === 'left'
				? 0
				: sceneCtx.align?.horizontal === 'right'
					? frameWidth - drawW
					: (frameWidth - drawW) / 2;
		const offY =
			sceneCtx.align?.vertical === 'bottom' ? frameHeight - drawH : (frameHeight - drawH) / 2;
		return {
			...t,
			x: offX + t.x * s,
			y: offY + t.y * s,
			scale: { x: (t.scale?.x ?? 1) * s, y: (t.scale?.y ?? 1) * s },
		};
	}

	/**
	 * Full-bleed cover of the fixed WINDOW (§10.4), via the shared `coverTransform` —
	 * the SAME true-cover helper the game runtime uses. `coverScale` defaults to 1
	 * (exact edge-to-edge cover); the node's `coverScale` is the uniform zoom and
	 * `node.scale` the free per-axis stretch on top, both honoured so the author can
	 * over/under-cover and stretch. Width/height are the art's natural size and the
	 * cover lives in the per-axis `scaleX`/`scaleY`, so the 2D draw (`width × scale`) +
	 * box/hit-test math (`natural × scale`) reproduce the cover identically. Falls back
	 * to the window size when the art dims aren't loaded so it never collapses to a
	 * tiny offset sprite.
	 */
	function backgroundTransform(node: LayoutNode, t: ResolvedTransform): ResolvedTransform {
		const stretch = backgroundCoverStretch(node);
		const coverScale = backgroundCoverScale(node);
		const fit = backgroundFit(node);
		// A background componentInstance covers as ONE composed unit, matching the runtime
		// (`LayoutNodeView` `bgComponent`). Unlike a sprite (drawn anchored 0.5 at the frame
		// centre), `drawComponentInstance` expands the def's children from the transform
		// ORIGIN and does NOT apply the transform anchor — so we must place the origin
		// EXPLICITLY so the content's union CENTRE lands on the frame centre. `nodeBox`
		// returns the union box `{w,h,ax,ay}` (ax=-minX/w), from which the local union
		// top-left is `minX = -ax*w`, `minY = -ay*h`. The cover then lives in per-axis
		// scale (anchor {0,0}), and the offset `cover.x - (minX + w/2)*scaleX` centres it —
		// so the 2D draw AND the selection box (`nodeCornersWorld`, which uses the SAME
		// box ax/ay as the origin-in-box) frame the identical centred cover extent.
		if (node.kind === 'componentInstance') {
			const box = boxOf(node, t);
			const minX = -box.ax * box.w;
			const minY = -box.ay * box.h;
			const cover = coverTransform({
				artWidth: box.w,
				artHeight: box.h,
				targetWidth: frameWidth,
				targetHeight: frameHeight,
				coverScale,
				stretchX: stretch.x,
				stretchY: stretch.y,
				fit,
			});
			return {
				...t,
				x: cover.x - (minX + box.w / 2) * cover.scaleX,
				y: cover.y - (minY + box.h / 2) * cover.scaleY,
				anchor: { x: 0, y: 0 },
				scale: { x: cover.scaleX, y: cover.scaleY },
				rotation: 0,
				width: box.w,
				height: box.h,
			};
		}
		const nat = naturalSize(node);
		const cover = coverTransform({
			artWidth: nat?.w ?? frameWidth,
			artHeight: nat?.h ?? frameHeight,
			targetWidth: frameWidth,
			targetHeight: frameHeight,
			coverScale,
			stretchX: stretch.x,
			stretchY: stretch.y,
			fit,
		});
		return {
			...t,
			x: cover.x,
			y: cover.y,
			anchor: { x: 0.5, y: 0.5 },
			scale: { x: cover.scaleX, y: cover.scaleY },
			rotation: 0,
			width: nat?.w ?? frameWidth,
			height: nat?.h ?? frameHeight,
		};
	}

	/**
	 * Map a point in the GAME's MAIN-layout coords to the canvas's world coords the
	 * SAME way `<MainContainer>` maps the doc's `mainSizesMap`: uniform scale that
	 * fits the main box into the frame, centred. So a board-relative preview lands
	 * where the coded component renders in-game. (Pan/zoom turns world → screen.)
	 */
	function mainScale(): number {
		const main = mainSizesMap[layoutType];
		return Math.min(frameWidth / (main.width || 1), frameHeight / (main.height || 1));
	}
	function mainToWorld(p: Vec2): Vec2 {
		const main = mainSizesMap[layoutType];
		const s = mainScale();
		return {
			x: frameWidth / 2 + s * (p.x - main.width / 2),
			y: frameHeight / 2 + s * (p.y - main.height / 2),
		};
	}

	/**
	 * The board rect (centre + size) in the game's MAIN coords, read from the doc's
	 * `boardFrame` node — every game's basegame carries one, so this is game-agnostic.
	 * The node lives in a DIFFERENT scene than the overlay being drawn, so scan all
	 * scenes. `undefined` when not found → board-relative placements fall back to
	 * `contain` (centred), which is safe.
	 */
	function boardRect(): PlacementGeometry['board'] {
		for (const s of scenes) {
			for (const n of s.nodes) {
				if (n.slotId !== 'boardFrame') continue;
				const bt = resolveTransform(n, layoutType);
				if (bt.width === undefined || bt.height === undefined) continue;
				// boardFrame is anchored centre, so x/y is the board centre.
				return { x: bt.x, y: bt.y, width: bt.width, height: bt.height };
			}
		}
		return undefined;
	}

	/** Geometry inputs for {@link computeOverlayPlacement} for this node's art. */
	function placementGeometry(node: LayoutNode): PlacementGeometry {
		const main = mainSizesMap[layoutType];
		const nat = artNaturalSize(node);
		return {
			main: { width: main.width, height: main.height },
			board: boardRect(),
			art: nat ? { width: nat.w, height: nat.h } : undefined,
		};
	}

	/**
	 * Resolve a preview-art bind anchor's transform from its catalog `placement` — the
	 * editor stand-in for a coded component the editor can't run.
	 * - `cover` (full-bleed Background): scale so BOTH frame dims are covered (may crop).
	 * - `contain` (centred overlays — FS intro/outro, Transition): fit INSIDE the frame.
	 * - `positioned` (board-relative — Win = board centre, FS counter = left of board):
	 *   draw at the art's NATURAL size, placed at the MAIN-coord spot mapped to the
	 *   canvas via `mainToWorld` (so it matches the coded in-game position). `boardLeft`
	 *   panels are sized to ≈ board.width*0.4 so they read like the real counter panel.
	 * Falls back to a plain frame-sized box until the art's natural size is known.
	 */
	function placedArtTransform(
		node: LayoutNode,
		t: ResolvedTransform,
		placement: OverlayPlacement,
	): ResolvedTransform {
		// The node's stored x/y is a POSITIONAL OFFSET (raw scene-canvas px at the
		// editor reference frame) applied ON TOP of the placement — the game honours
		// the same x/y verbatim for these canvas anchors (no screenAnchor). The frame
		// IS world space 1:1, so the offset adds directly in world coords. With the
		// default offset 0 the preview is identical to the Level-1 placement-only spot.
		const offX = t.x;
		const offY = t.y;
		const result = computeOverlayPlacement(placement, placementGeometry(node));
		if (result.mode === 'positioned') {
			const nat = artNaturalSize(node);
			const s = mainScale();
			const board = boardRect();
			let drawW = (nat?.w ?? 160) * s;
			let drawH = (nat?.h ?? 100) * s;
			// Optional sizing: scale a left-of-board panel to ≈40% of the board width
			// (keeping aspect) so the FS counter reads like the real panel, not its raw
			// natural size. Only when we know both the art aspect and the board.
			if (placement === 'boardLeft' && nat && nat.w > 0 && board) {
				const targetW = board.width * 0.4 * s;
				const ratio = nat.h / nat.w;
				drawW = targetW;
				drawH = targetW * ratio;
			}
			const world = mainToWorld({ x: result.x, y: result.y });
			return {
				...t,
				x: world.x + offX,
				y: world.y + offY,
				anchor: result.anchor,
				scale: { x: 1, y: 1 },
				rotation: 0,
				width: drawW,
				height: drawH,
			};
		}
		// cover / contain: centred, sized to the WINDOW via the shared `coverTransform`
		// — the SAME true-cover helper the game runtime + the spine overlay use. The
		// cover placement reads the node's DOC-DRIVEN fit + cover scale (§10.3 step 4)
		// so this 2D path stays unified with `backgroundTransform` + the spine layer;
		// the contain placement (centred overlays) is always contain at scale 1.
		const isCover = result.mode === 'cover';
		const fit = isCover ? backgroundFit(node) : 'contain';
		const coverScale = isCover ? backgroundCoverScale(node) : 1;
		const stretch = isCover ? backgroundCoverStretch(node) : { x: 1, y: 1 };
		const nat = artNaturalSize(node);
		// `coverTransform` returns per-axis scales for art of natural size; this 2D
		// path draws via explicit width/height, so multiply the natural dims by them.
		const artW = nat?.w ?? frameWidth;
		const artH = nat?.h ?? frameHeight;
		const cover = coverTransform({
			artWidth: artW,
			artHeight: artH,
			targetWidth: frameWidth,
			targetHeight: frameHeight,
			coverScale,
			stretchX: stretch.x,
			stretchY: stretch.y,
			fit,
		});
		const width = artW * cover.scaleX;
		const height = artH * cover.scaleY;
		// cover (full-bleed Background) ignores the offset — it stays non-draggable and
		// pinned to the frame. contain (centred overlays) honours the draggable offset.
		const applyOffset = fit === 'contain';
		return {
			...t,
			x: frameWidth / 2 + (applyOffset ? offX : 0),
			y: frameHeight / 2 + (applyOffset ? offY : 0),
			anchor: { x: 0.5, y: 0.5 },
			scale: { x: 1, y: 1 },
			rotation: 0,
			width,
			height,
		};
	}

	/**
	 * The placement world base for a preview-art anchor — the on-screen position the
	 * placement produces with a ZERO offset (cover/contain → frame centre; positioned
	 * → the mapped MAIN-coord spot). Drag works in world coords, so subtracting this
	 * base from a dropped world position yields the raw offset to store in x/y (which
	 * the game then applies verbatim on top of the component's own placement).
	 */
	function placementWorldBase(node: LayoutNode, placement: OverlayPlacement): Vec2 {
		const result = computeOverlayPlacement(placement, placementGeometry(node));
		if (result.mode === 'positioned') {
			return mainToWorld({ x: result.x, y: result.y });
		}
		return { x: frameWidth / 2, y: frameHeight / 2 };
	}

	/** Write `x`/`y` for the active layoutType (base when desktop, sparse override otherwise). */
	function writeXY(node: LayoutNode, x: number, y: number): void {
		// Canvas-space (HUD corners): x/y arrive as effective world coords; store the
		// offset from the screen-anchored edge so the node stays edge-pinned at runtime.
		const sa = resolveTransform(node, layoutType).screenAnchor;
		const art = anchorArt(node);
		if (scene.space === 'canvas' && sa) {
			x -= sa.x * frameWidth;
			y -= sa.y * frameHeight;
		} else if (art && art.placement !== 'cover') {
			// Preview-art anchor (positioned/centred): x/y arrive as effective world coords
			// (placement base + offset). Store the OFFSET from the placement base so the game
			// applies the same raw x/y on top of the coded component's own placement. Raw
			// scene-canvas px == world px (the frame is world 1:1), so no extra scaling.
			const base = placementWorldBase(node, art.placement);
			x -= base.x;
			y -= base.y;
		} else if (isGameSpaceNode(node)) {
			// Game-space: x/y arrive as WINDOW-world coords (the `mainToWorld` mapping in
			// nodeTransform). Invert that mapping back to main-box coords before storing,
			// so the value round-trips and the game (which reads raw main coords inside
			// <MainContainer>) reproduces the same window position. Inverse of:
			//   world = frameW/2 + s * (main - mainW/2)   →   main = (world - frameW/2)/s + mainW/2
			const main = mainSizesMap[layoutType];
			const s = mainScale();
			x = (x - frameWidth / 2) / s + main.width / 2;
			y = (y - frameHeight / 2) / s + main.height / 2;
		}
		if (layoutType === baseLayoutType) {
			node.x = x;
			node.y = y;
		} else {
			const o = getOverride(node);
			o.x = x;
			o.y = y;
		}
	}
	/** Does this node go through the game-space main→window mapping (scale ×`mainScale`)
	 * in {@link nodeTransform}? Mirrors that branch's guards exactly so the scale/translate
	 * inverses below match it. Canvas/standard/background spaces + preview-art anchors take
	 * other paths and are NOT main-scaled. */
	function isGameSpaceNode(node: LayoutNode): boolean {
		// A componentInstance hosting a board-relative overlay (catalog `space:'game'`) is ALWAYS
		// game-framed by `nodeTransform` (main→window mapping) regardless of the host scene's space,
		// so its drag/scale writeback must invert that mapping too — mirror the override there.
		if (
			node.kind === 'componentInstance' &&
			scene.space !== 'background' &&
			hostedComponentSpace(componentMap.get(node.componentId)) === 'game'
		) {
			return true;
		}
		if (scene.space === 'standard' || scene.space === 'background' || scene.space === 'canvas') {
			return false;
		}
		const art = anchorArt(node);
		if (art) return false;
		if (node.bind && boundComponentDefault(node.bind.component)?.placement) return false;
		return true;
	}
	function writeScale(node: LayoutNode, sx: number, sy: number): void {
		// Game-space nodes are presented scaled by `mainScale` (nodeTransform maps the
		// main box into the window). The handle drag works in that presented frame, so
		// divide it back out before storing — keeps the stored scale in raw main space.
		if (isGameSpaceNode(node)) {
			const s = mainScale() || 1;
			sx /= s;
			sy /= s;
		}
		if (layoutType === baseLayoutType) {
			node.scale = { x: sx, y: sy };
		} else {
			const o = getOverride(node);
			o.scale = { x: sx, y: sy };
		}
	}
	function writeRotation(node: LayoutNode, r: number): void {
		if (layoutType === baseLayoutType) {
			node.rotation = r;
		} else {
			const o = getOverride(node);
			o.rotation = r;
		}
	}
	/** Resolved (base + override) start translate value used when initiating a drag. */
	function effectiveXY(node: LayoutNode): Vec2 {
		const t = nodeTransform(node);
		return { x: t.x, y: t.y };
	}

	/** Full-bleed cover nodes are auto-cover-fit (their transform is synthesised, not
	 * authored), so the canvas must not drag/scale/rotate them — a write would store
	 * the synthetic centre/size and break the cover. The cover scale is still editable
	 * via the Properties `scale.x` control. This covers BOTH `background`-space sprite/
	 * spine nodes AND a `cover`-placement preview anchor (the full-bleed Background).
	 *
	 * Positioned/centred preview anchors (Win, Transition, FreeSpinIntro/Outro,
	 * FreeSpinCounter) are NOT cover: their preview = placement + the node's stored x/y
	 * offset, so dragging them writes a meaningful offset (Level 2). They stay draggable.
	 */
	function isBackgroundCover(node: LayoutNode): boolean {
		const art = anchorArt(node);
		// A cover-placement anchor (the full-bleed Background) stays non-draggable;
		// every other preview-art anchor is offset-draggable.
		if (art && art.placement === 'cover') return true;
		// A `canvas`-space `coverFit` node is auto-cover-fit too (its transform is
		// synthesised by `backgroundTransform`), so it must not drag/scale/rotate either —
		// the cover is edited via the Properties cover scale + fit + Transform stretch.
		if (scene.space === 'canvas' && node.coverFit && isCoverFitKind(node)) {
			return true;
		}
		return (
			scene.space === 'background' && (isCoverFitKind(node) || node.kind === 'componentInstance')
		);
	}

	let canvas: HTMLCanvasElement | null = $state(null);
	// Top-most 2D layer for the HUD: it sits ABOVE the spine/FX overlay so the HUD
	// draws on top (matching the game, where the HUD is the top UI layer). The base
	// `canvas` draws the game scenes + frame BELOW the spine layer.
	let hudCanvas: HTMLCanvasElement | null = $state(null);
	let wrap: HTMLDivElement | null = $state(null);

	// ---------- bone-ridden stand-in symbol overlay (Scene Editor preview) ----------
	// SHARED, non-reactive sink the per-scene spine layers write each frame (they OWN the
	// skeleton↔screen mapping, so they resolve each reveal's followed bone and hand us a plain
	// WORLD transform, keyed by host component-instance node id). This canvas's OWN rAF
	// (`drawRiders`) reads it + draws the stand-in symbols on `riderCanvas`, sitting just above
	// the scene groups so a symbol rides ON TOP of its rig. Using a plain Map + a dedicated rAF
	// keeps the per-frame follow off Svelte's reactive graph (no $state churn).
	const boneRiders = new Map<string, BoneRiderTransform>();
	let riderCanvas: HTMLCanvasElement | null = $state(null);
	let riderRaf = 0;
	/** Nominal symbol size in MAIN px — the stand-in box base, mapped to world via `mainScale`
	 * (a book symbol is ~one board cell; 150 reads right for the common 5×3 board). */
	const SYMBOL_PREVIEW_MAIN = 150;

	let panX = $state(0);
	let panY = $state(0);
	let zoom = $state(0.5);
	let panning = $state(false);
	let lastXY: [number, number] | null = null;
	let dragOver = $state(false);

	type DragMode =
		| {
				kind: 'translate';
				nodeId: string;
				startWorld: Vec2;
				startNode: Vec2;
				/** Start positions of every node moved by this drag (the multi-selection,
				 * minus locked/background-cover nodes), so the group translates as one. */
				group: { id: string; sx: number; sy: number }[];
		  }
		| {
				kind: 'scale';
				nodeId: string;
				cornerIdx: number;
				/** Restrict the resize to ONE axis (an edge handle) — `'x'` keeps height, `'y'`
				 * keeps width. Undefined ⇒ a corner handle resizes both. */
				resizeAxis?: 'x' | 'y';
				startWorld: Vec2;
				startScale: Vec2;
				startBox: NodeBox;
				startTx: number;
				startTy: number;
				startRot: number;
		  }
		| {
				kind: 'rotate';
				nodeId: string;
				startAngle: number;
				startRot: number;
				center: Vec2;
		  };
	let dragMode: DragMode | null = null;
	let hoverNodeId = $state<string | null>(null);
	let hoverHandle = $state<HandleHit | null>(null);
	let snapLines = $state<SnapLine[]>([]);
	/** Spine node ids whose preview animation is playing (static otherwise). */
	let playingSpines = $state<Set<string>>(new Set());
	/** `assetKey`s the spine overlay renders as real skeletons — the 2D canvas
	 * skips their placeholder box so only the live preview shows. UNION across the
	 * per-scene spine sublayers (each reports only its own scene's keys). */
	let readySpineKeys = $state<Set<string>>(new Set());
	/** Setup-pose natural size per spine `assetKey`, reported by the WebGL overlay —
	 * lets the 2D canvas cover-fit `preview.art` spine anchors by the art's aspect.
	 * MERGED across the per-scene spine sublayers. */
	let spineNaturalSizes = $state<Map<string, { w: number; h: number }>>(new Map());
	/** Node ids the PIXI text overlay (`EditorTextLayer`) now renders as real text — the
	 * 2D canvas steps its HUD-text CHIP aside for these (the overlay owns the text). Text
	 * NODES are overlay-only now (no 2D `fillText`), so this only gates HUD bind-anchor
	 * chips. UNION across the per-scene text sublayers. */
	let readyTextIds = $state<Set<string>>(new Set());
	/** Measured RENDERED size per text NODE id (local / pre-scale px), reported by the PIXI
	 * text overlay so an auto-size text node's selection box + hit-test hug the real glyphs
	 * (a boxed text uses its explicit width/height instead). MERGED across the per-scene text
	 * sublayers. */
	let textMeasured = $state<Map<string, { w: number; h: number }>>(new Map());
	/** Global play/pause for the live effect preview overlay (default playing). */
	let playingEffects = $state(true);
	/** When on, redraw the window + play-area (main box) outlines on the top-most HUD canvas,
	 * ABOVE every art/spine/FX layer — so the screen bounds stay visible once stacked art buries
	 * the base-canvas guides (which sit at the bottom of the z-stack). Off by default. */
	let showScreenBorder = $state(false);
	/** Effect NODE ids the live particle overlay (`EditorEffectLayer`) now renders — the 2D canvas
	 * skips their placeholder chip so only the live emitters show. UNION across the per-scene effect
	 * sublayers (each reports only its own scene's node ids). */
	let liveEffectIds = $state<Set<string>>(new Set());
	/** Measured particle SPREAD per effect NODE id (running-MAX rect in node-local / scene-world
	 * units — `x`/`y` are the top-left offset from the node origin), reported by the live overlay so
	 * the selection box + hit-test fit the real particles instead of the fixed placeholder. MERGED
	 * across the per-scene effect sublayers. */
	let effectBounds = $state<Map<string, { x: number; y: number; w: number; h: number }>>(new Map());

	// Per-scene report buffers: each sublayer is filtered to one scene, so the 2D
	// canvas folds their reports together (union of ready keys/ids + merged natural
	// sizes; summed load tallies) to keep its placeholder/progress logic unchanged.
	const spineReadyByScene = new Map<string, Set<string>>();
	const spineNaturalByScene = new Map<string, Map<string, { w: number; h: number }>>();
	const spineMetaByScene = new Map<string, Map<string, SpineMeta>>();
	const textReadyByScene = new Map<string, Set<string>>();
	const textMeasuredByScene = new Map<string, Map<string, { w: number; h: number }>>();
	const effectReadyByScene = new Map<string, Set<string>>();
	const effectBoundsByScene = new Map<
		string,
		Map<string, { x: number; y: number; w: number; h: number }>
	>();
	const spineLoadByScene = new Map<string, { started: number; settled: number }>();
	const fontLoadByScene = new Map<string, { started: number; settled: number }>();

	function mergeSpineReady(sceneId: string, keys: Set<string>): void {
		spineReadyByScene.set(sceneId, keys);
		const union = new Set<string>();
		for (const set of spineReadyByScene.values()) for (const k of set) union.add(k);
		readySpineKeys = union;
	}
	function mergeSpineNatural(sceneId: string, sizes: Map<string, { w: number; h: number }>): void {
		spineNaturalByScene.set(sceneId, sizes);
		const merged = new Map<string, { w: number; h: number }>();
		for (const m of spineNaturalByScene.values()) for (const [k, v] of m) merged.set(k, v);
		spineNaturalSizes = merged;
	}
	function mergeSpineMeta(sceneId: string, meta: Map<string, SpineMeta>): void {
		spineMetaByScene.set(sceneId, meta);
		const merged = new Map<string, SpineMeta>();
		for (const m of spineMetaByScene.values()) for (const [k, v] of m) merged.set(k, v);
		onSpineMeta?.(merged);
	}
	function mergeTextReady(sceneId: string, ids: Set<string>): void {
		textReadyByScene.set(sceneId, ids);
		const union = new Set<string>();
		for (const set of textReadyByScene.values()) for (const id of set) union.add(id);
		readyTextIds = union;
	}
	function mergeTextMeasured(sceneId: string, sizes: Map<string, { w: number; h: number }>): void {
		textMeasuredByScene.set(sceneId, sizes);
		const merged = new Map<string, { w: number; h: number }>();
		for (const m of textMeasuredByScene.values()) for (const [k, v] of m) merged.set(k, v);
		textMeasured = merged;
	}
	function mergeEffectReady(sceneId: string, ids: Set<string>): void {
		effectReadyByScene.set(sceneId, ids);
		const union = new Set<string>();
		for (const set of effectReadyByScene.values()) for (const id of set) union.add(id);
		liveEffectIds = union;
	}
	function mergeEffectBounds(
		sceneId: string,
		bounds: Map<string, { x: number; y: number; w: number; h: number }>,
	): void {
		effectBoundsByScene.set(sceneId, bounds);
		const merged = new Map<string, { x: number; y: number; w: number; h: number }>();
		for (const m of effectBoundsByScene.values()) for (const [k, v] of m) merged.set(k, v);
		effectBounds = merged;
	}
	function mergeSpineLoading(sceneId: string, c: { started: number; settled: number }): void {
		spineLoadByScene.set(sceneId, c);
		let started = 0;
		let settled = 0;
		for (const v of spineLoadByScene.values()) {
			started += v.started;
			settled += v.settled;
		}
		spineStarted = started;
		spineSettled = settled;
	}
	function mergeFontLoading(sceneId: string, c: { started: number; settled: number }): void {
		fontLoadByScene.set(sceneId, c);
		let started = 0;
		let settled = 0;
		for (const v of fontLoadByScene.values()) {
			started += v.started;
			settled += v.settled;
		}
		fontStarted = started;
		fontSettled = settled;
	}

	/** Drop a scene's report buffers (when its group unmounts — hidden/removed) and
	 * recompute the merged unions/sums so stale ready keys + load tallies don't linger. */
	function forgetScene(id: string): void {
		spineReadyByScene.delete(id);
		spineNaturalByScene.delete(id);
		spineMetaByScene.delete(id);
		textReadyByScene.delete(id);
		textMeasuredByScene.delete(id);
		effectReadyByScene.delete(id);
		effectBoundsByScene.delete(id);
		spineLoadByScene.delete(id);
		fontLoadByScene.delete(id);
		sceneFilters.delete(id);
		const meta = new Map<string, SpineMeta>();
		for (const m of spineMetaByScene.values()) for (const [k, v] of m) meta.set(k, v);
		onSpineMeta?.(meta);
		const keys = new Set<string>();
		for (const set of spineReadyByScene.values()) for (const k of set) keys.add(k);
		readySpineKeys = keys;
		const nat = new Map<string, { w: number; h: number }>();
		for (const m of spineNaturalByScene.values()) for (const [k, v] of m) nat.set(k, v);
		spineNaturalSizes = nat;
		const ids = new Set<string>();
		for (const set of textReadyByScene.values()) for (const tid of set) ids.add(tid);
		readyTextIds = ids;
		const tMeasured = new Map<string, { w: number; h: number }>();
		for (const m of textMeasuredByScene.values()) for (const [k, v] of m) tMeasured.set(k, v);
		textMeasured = tMeasured;
		blendRunCache.delete(id);
		blendOverlayCache.delete(id);
		normalOverlayCache.delete(id);
		// The scene's blend overlays report under synthetic `<sceneId>#blend:<mode>` keys — purge
		// them too, else a removed scene's rigs stay "ready" forever and keep their placeholders off.
		const blendPrefix = `${id}#blend:`;
		for (const map of [
			spineReadyByScene,
			spineNaturalByScene,
			spineMetaByScene,
			effectReadyByScene,
			effectBoundsByScene,
			spineLoadByScene,
		] as Map<string, unknown>[]) {
			for (const key of [...map.keys()]) if (key.startsWith(blendPrefix)) map.delete(key);
		}
		const effIds = new Set<string>();
		for (const set of effectReadyByScene.values()) for (const eid of set) effIds.add(eid);
		liveEffectIds = effIds;
		const effBounds = new Map<string, { x: number; y: number; w: number; h: number }>();
		for (const m of effectBoundsByScene.values()) for (const [k, v] of m) effBounds.set(k, v);
		effectBounds = effBounds;
		let ss = 0;
		let sd = 0;
		for (const v of spineLoadByScene.values()) {
			ss += v.started;
			sd += v.settled;
		}
		spineStarted = ss;
		spineSettled = sd;
		let fs = 0;
		let fd = 0;
		for (const v of fontLoadByScene.values()) {
			fs += v.started;
			fd += v.settled;
		}
		fontStarted = fs;
		fontSettled = fd;
	}

	/** Svelte action: register one {@link BlendRun}'s 2D canvas + size/draw it once it mounts.
	 * The scene's per-scene buffers are only forgotten when its LAST run canvas goes — a scene
	 * that merely re-splits its runs (an author flips one node to `add`) must keep them. */
	function registerSceneCanvasAction(el: HTMLCanvasElement, run: BlendRun) {
		registerSceneCanvas(run.key, el);
		resizeCanvas();
		schedule();
		return {
			destroy() {
				registerSceneCanvas(run.key, null);
				const prefix = `${run.sceneId}#`;
				for (const key of sceneCanvases.keys()) if (key.startsWith(prefix)) return;
				forgetScene(run.sceneId);
			},
		};
	}
	function toggleSpinePlay(node: LayoutNode): void {
		const next = new Set(playingSpines);
		if (next.has(node.id)) next.delete(node.id);
		else next.add(node.id);
		playingSpines = next;
	}

	// ---------- asset-load progress (drives the loading overlay) ----------
	// Monotonic counters across the three asset sources: images + atlas/sheet
	// regions (this canvas) and spine bundles (the overlay child, via callback).
	// `started`/`settled` only grow; `pending` is the live in-flight count.
	let imgStarted = $state(0);
	let imgSettled = $state(0);
	let regStarted = $state(0);
	let regSettled = $state(0);
	let spineStarted = $state(0);
	let spineSettled = $state(0);
	let fontStarted = $state(0);
	let fontSettled = $state(0);
	const loadPending = $derived(
		imgStarted -
			imgSettled +
			(regStarted - regSettled) +
			(spineStarted - spineSettled) +
			(fontStarted - fontSettled),
	);
	// High-water mark for the current load burst: grows as new refs are
	// discovered, resets to 0 once everything settles. Gives a real progress
	// fraction per burst without the totals drifting up across many doc opens.
	let batchTotal = $state(0);
	let showOverlay = $state(false);
	let overlayTimer = 0;
	$effect(() => {
		const pending = loadPending;
		if (pending === 0) batchTotal = 0;
		else if (pending > batchTotal) batchTotal = pending;

		if (pending > 0) {
			// Defer the overlay so quick single loads (e.g. one drag-dropped
			// sprite) don't flash it — only sustained bursts show feedback.
			if (!showOverlay && !overlayTimer) {
				overlayTimer = window.setTimeout(() => {
					overlayTimer = 0;
					showOverlay = true;
				}, 250);
			}
		} else {
			if (overlayTimer) {
				clearTimeout(overlayTimer);
				overlayTimer = 0;
			}
			showOverlay = false;
		}
	});
	const loadDone = $derived(Math.max(0, batchTotal - loadPending));
	const loadPct = $derived(batchTotal > 0 ? Math.round((loadDone / batchTotal) * 100) : 0);

	interface SnapLine {
		axis: 'x' | 'y';
		/** World-space coordinate (x for vertical, y for horizontal). */
		v: number;
	}
	type HandleHit =
		| { kind: 'corner'; idx: number }
		| { kind: 'edge'; idx: number }
		| { kind: 'rotate' }
		| { kind: 'body' };

	const HANDLE_PX = 8;
	/** Edge-midpoint resize handles (top / right / bottom / left). Drawn a touch smaller than
	 * the corners so the two read as distinct. */
	const EDGE_HANDLE_PX = 7;
	const ROTATE_PX = 6;
	const ROTATE_OFFSET_PX = 22;
	const SNAP_PX = 6;

	// Bumped by "Reload art" to bust the per-session asset caches. The asset
	// endpoint is now ETag-cacheable, so a stable `?v=` is the CONTENT-version
	// token: it stays constant across renders (the browser revalidates cheaply
	// via If-None-Match) and changes ONLY on "Reload art" — forcing a fresh
	// fetch after the underlying R2 art actually changed, without a page reload.
	// `spineReload` is forwarded to the spine layer to drop its bundle cache.
	let assetVersion = $state(0);
	let spineReload = $state(0);
	let fontReload = $state(0);

	// Content-version per resolved page key (filled as region sets resolve). Lets a page
	// image bust its cache the instant the atlas changes — the manual `assetVersion`
	// counter is only the fallback for keys with no known content version (e.g. a raw
	// full-image node, not an atlas page).
	const pageVersionByKey = new Map<string, string>();
	const images = new Map<string, HTMLImageElement | null>();
	function ensureImage(key: string): HTMLImageElement | null {
		if (images.has(key)) return images.get(key) ?? null;
		images.set(key, null);
		imgStarted++;
		const img = new Image();
		img.onload = () => {
			images.set(key, img);
			imgSettled++;
			draw(); // force a redraw (schedule() can be swallowed mid-load on doc open)
		};
		img.onerror = () => {
			images.set(key, null);
			imgSettled++;
			console.warn('[editor] image load failed', key);
		};
		const v = pageVersionByKey.get(key) ?? String(assetVersion);
		// A vendored built-in sheet's page is a launcher-static path, not an R2 key — the
		// R2-gated proxy would 404 on it, so serve it directly.
		img.src = isStaticPageKey(key)
			? key
			: `/api/editor/asset?key=${encodeURIComponent(key)}&v=${encodeURIComponent(v)}`;
		return null;
	}

	/** "Reload art": drop the per-session image + region caches and bump the
	 * cache-bust tokens so updated atlas/spine art is re-fetched from R2 — no full
	 * page reload needed. The 2D images + region pages re-load on the next draw();
	 * the spine layer re-loads via the forwarded `spineReload` token. */
	function refreshAssets(): void {
		images.clear();
		pageVersionByKey.clear();
		regionSets.clear();
		failedRegionKeys.clear();
		clearRegionCache(); // also drop the module-level fetchRegions cache (page key + rects)
		clearPageImages(); // drop the Library thumbnails' shared page decodes (+ bust their HTTP cache)
		clearFontCatalogCache(); // drop the module-level font catalog so it re-fetches
		// A clip re-authored in /flipbook (frames reordered, fps changed) is exactly as stale as a
		// re-packed atlas, so "Reload art" must re-read it too — otherwise a placed node keeps
		// playing the old frame list until a full page reload.
		clearClipCache();
		loadClips();
		// A box authored in another tab is exactly as stale as a re-packed atlas.
		clearArtBoundsCache();
		void loadArtBounds();
		// Drop the cross-atlas name→manifest map too, else a name-resolved sprite keeps
		// pointing at the manifest the previous scan locked onto — Reload art would do
		// nothing for it. Cleared + flagged for rebuild on the next draw().
		spriteRegionIndex = new Map();
		regionScanStarted = false;
		assetVersion++;
		spineReload++;
		fontReload++;
		draw();
	}

	// ---------- region (atlas/sheet frame) resolution ----------
	// A region sprite stores `{ assetKey, region }`. Preview data (the packed page
	// key + per-frame rects) is editor-side only — resolved here, never saved.
	// Keyed by `assetKey` so a reopened doc re-fetches automatically.
	const regionSets = new Map<string, RegionSet | null>();
	// Keys whose region fetch FAILED (403/404/…) — lets findRegion tell "still
	// loading" apart from "never going to load" and fall back to the name index.
	const failedRegionKeys = new Set<string>();
	function ensureRegionSet(assetKey: string): RegionSet | null {
		if (regionSets.has(assetKey)) return regionSets.get(assetKey) ?? null;
		regionSets.set(assetKey, null);
		regStarted++;
		void fetchRegions(assetKey)
			.then((set) => {
				regionSets.set(assetKey, set);
				regSettled++;
				if (set.pageKey && set.pageVersion) pageVersionByKey.set(set.pageKey, set.pageVersion);
				if (set.pageKey) ensureImage(set.pageKey);
				draw(); // force a redraw once regions resolve (don't rely on raf dedup)
			})
			.catch((err) => {
				failedRegionKeys.add(assetKey);
				regSettled++;
				console.warn('[editor] region load failed', assetKey, err);
				draw(); // let findRegion's name-index fallback take over
			});
		return null;
	}
	/** Seed the cache from a drag payload so the dropped sprite renders instantly. */
	function seedRegionSet(p: RegionDragPayload): void {
		const existing = regionSets.get(p.key);
		const region: EditorRegion = {
			name: p.region,
			x: p.rect.x,
			y: p.rect.y,
			w: p.rect.w,
			h: p.rect.h,
			rotated: p.rotated,
			offX: p.offX,
			offY: p.offY,
			origW: p.origW,
			origH: p.origH,
		};
		if (existing) {
			if (!existing.regions.some((r) => r.name === region.name)) existing.regions.push(region);
		} else {
			regionSets.set(p.key, {
				assetKey: p.key,
				pageKey: p.pageKey,
				pageVersion: '', // synthetic set from a drag payload; the real fetch fills the version
				pageWidth: 0,
				pageHeight: 0,
				regions: [region],
			});
		}
		if (p.pageKey) ensureImage(p.pageKey);
	}
	function findRegion(
		assetKey: string,
		regionName: string,
	): { set: RegionSet; region: EditorRegion } | null {
		// An assetKey with no `/` can't be an R2 key — a broken def likely shoved a
		// region NAME into it (e.g. a param bound to both image fields). Fetching it
		// is a guaranteed 403, so skip the fetch and resolve purely by name below.
		const looksLikeKey = assetKey.includes('/');
		const set = looksLikeKey ? ensureRegionSet(assetKey) : null;
		if (set) {
			const region = set.regions.find((r) => r.name === regionName);
			if (region) return { set, region };
		} else if (looksLikeKey && !failedRegionKeys.has(assetKey)) {
			// Fetch still in flight — let it settle first, so the normal same-atlas
			// path never kicks off the full cross-atlas manifest scan.
			return null;
		}
		// MISS in the named atlas (or the set failed to load / the key wasn't a key).
		// A frame may live in ANOTHER atlas — a per-instance `image`-param swap, or a
		// sprite whose static `assetKey` no longer packs it. Resolve it by NAME through
		// the one-time cross-atlas index, matching the game (which resolves frames
		// across all loaded atlases). Only runs on a miss, so a normal same-atlas
		// sprite pays nothing. When `regionName` is empty, try `assetKey` itself as
		// the name (a def that put a region name in assetKey).
		const lookupName = regionName || (!looksLikeKey ? assetKey : '');
		if (!lookupName) return null;
		const indexed = spriteRegionIndex.get(lookupName);
		if (indexed && indexed !== assetKey) {
			const altSet = ensureRegionSet(indexed);
			const altRegion = altSet?.regions.find((r) => r.name === lookupName);
			if (altRegion) return { set: altSet, region: altRegion };
		} else if (!indexed) {
			ensureRegionIndex(); // build the index, then a later redraw resolves
		}
		// Last resort: the engine's BUILT-IN sheets. A coded-default region
		// (`Frame_FSCounter.png`, the `progressBar*.png` trio) is engine art every game app
		// bundles + registers, so it renders fine in the shipped game — but it lives in no
		// project atlas, so the scan above can never find it and the canvas drew a
		// placeholder. Resolved from the launcher's vendored copy (the built-in SPINE
		// precedent). Deliberately AFTER the project index, so a project atlas that packs the
		// same name still wins and an author's own art keeps overriding the engine default.
		const builtinId = builtinSheetIdForRegion(lookupName);
		if (builtinId) {
			const bSet = ensureRegionSet(builtinSheetKey(builtinId));
			const bRegion = bSet?.regions.find((r) => r.name === lookupName);
			if (bRegion) return { set: bSet, region: bRegion };
		}
		return null;
	}

	// ---------- catalog sprite-region index ----------
	// A bind anchor whose catalog default is a SPRITE knows only the region NAME, not
	// which project manifest packs it. We scan the project's atlas manifests + sheets
	// (each via the same `/api/editor/regions` fetch the Library uses) ONCE, building
	// `region name → manifest assetKey`. The resolver reads this map so the canvas can
	// draw the region; until the scan settles the anchor falls back to a placeholder.
	let spriteRegionIndex = $state<Map<string, string>>(new Map());
	let regionScanStarted = false;
	/** Manifest/sheet identifiers to scan for catalog sprite regions. */
	function regionContainerKeys(): string[] {
		const keys: string[] = [];
		for (const a of assets.atlases) if (a.kind === 'atlas-manifest') keys.push(a.key);
		for (const sh of assets.sheets) keys.push(sh.key);
		return keys;
	}
	/** Kick off the one-time manifest scan that fills `spriteRegionIndex`. Triggered
	 * lazily the first time a scene actually needs a catalog sprite region. */
	function ensureRegionIndex(): void {
		if (regionScanStarted) return;
		regionScanStarted = true;
		const keys = regionContainerKeys();
		// Fetch every manifest in parallel but FOLD them in listing order, so the
		// winner for a region name packed by more than one atlas is deterministic
		// (first container in `regionContainerKeys()` wins) — not whichever fetch
		// happens to resolve first, which silently flip-flopped which art a sprite drew.
		void Promise.all(
			keys.map((key) => fetchRegions(key).catch(() => null)), // a bad manifest contributes nothing
		).then((sets) => {
			const next = new Map<string, string>();
			const warned = new Set<string>();
			for (const set of sets) {
				if (!set?.regions.length) continue;
				for (const r of set.regions) {
					const owner = next.get(r.name);
					if (owner === undefined) {
						next.set(r.name, set.assetKey);
					} else if (owner !== set.assetKey && !warned.has(r.name)) {
						// Two atlases pack the same region name → the sprite can only draw one.
						// Surface it instead of silently shadowing the loser (the bug that made
						// edits to one atlas look ignored). Rename/remove the dup to disambiguate.
						warned.add(r.name);
						console.warn(
							`[editor] region "${r.name}" is packed by multiple atlases — using "${owner}", ` +
								`shadowing "${set.assetKey}". Rename or remove the duplicate to control ` +
								`which atlas a name-resolved sprite draws from.`,
						);
					}
				}
			}
			spriteRegionIndex = next;
			draw();
		});
	}

	// ---------- flipbook clips (placed `flipbook` nodes) ----------
	// A `flipbook` node stores only a `clipId`; the ordered frame list lives in the clip doc, so
	// the canvas resolves it here — the exact mirror of how the game resolves it through
	// `registerFlipbooks`. Frames are ordinary atlas regions, so each one draws through the SAME
	// `drawArtRegionSprite` a region sprite uses (no second cropping routine, and a lazily-loaded
	// sheet self-heals through `findRegion`'s fetch-then-redraw).
	// A plain Map, NOT a SvelteMap, on purpose — see the `clipClockMs` note below. `draw()` reads
	// this, and several redraw `$effect`s call `draw()` synchronously, so a reactive map would be
	// tracked by all of them and re-run the whole set on every clip fetch. The repaint is driven
	// explicitly instead (`loadClips` calls `draw()`), which is the same contract `regionSets` above
	// already has.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const clipsById = new Map<string, EditorClip>();
	function loadClips(): void {
		void fetchClips().then((list) => {
			clipsById.clear();
			for (const clip of list) clipsById.set(clip.id, clip);
			draw(); // force the repaint directly — the map is deliberately non-reactive (see below)
		});
	}
	loadClips();
	// The project's authored region boxes, fetched once per page load. Absent/forbidden ⇒ an empty
	// map ⇒ every region draws on its own packed rect, exactly as before (parity).
	void loadArtBounds();

	/**
	 * Wall-clock ms driving in-place clip PLAYBACK. Unlike an effect (a WebGL emitter the 2D canvas
	 * genuinely cannot run, hence its placeholder chip), a flipbook is just atlas frames in order —
	 * so the editor can show the real animation where it will play, which is the only way to judge
	 * a clip's placement and timing against the rest of the screen.
	 *
	 * Deliberately NOT `$state`, and neither is `clipsById`: `draw()` reads both, and several
	 * redraw `$effect`s call `draw()` synchronously — so a reactive clock would be TRACKED by every
	 * one of them and re-run the whole set 60 times a second. The ticker owns the repaint instead
	 * (calling `draw()` itself, the same way `ensureRegionSet` does when regions resolve).
	 *
	 * The loop is gated on a VISIBLE scene actually carrying a flipbook node, so a project without
	 * one pays nothing and the canvas keeps repainting purely on demand as it does today.
	 */
	let clipClockMs = 0;
	$effect(() => {
		void scenes;
		void scene;
		void hiddenSceneIds;
		const playing = scenes.some((s) => !hiddenSceneIds.has(s.id) && sceneHasFlipbook(s));
		if (!playing) return;
		let raf = 0;
		const tick = (now: number): void => {
			// The PAGE clock, not an elapsed-since-mount one: this effect re-runs on any scene/visibility
			// change, and an offset clock would restart every placed clip from frame 0 each time.
			clipClockMs = now;
			draw();
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});

	/** Does a scene carry a placed `kind:'flipbook'` node — or a reel board whose symbols bind a
	 * clip — ANYWHERE in its tree (incl. nested in a container / component instance)? Gates the
	 * playback clock above — mirroring `sceneHasEffect` / `sceneHasSpine`. */
	function sceneHasFlipbook(s: Scene): boolean {
		return nodesHaveFlipbook(s.nodes, 0, []);
	}
	function nodesHaveFlipbook(nodes: LayoutNode[], depth: number, stack: string[]): boolean {
		for (const n of nodes) {
			if (n.kind === 'flipbook') return true;
			// A reel BOARD whose symbols bind a clip animates its cells too. Without this the clock
			// never starts for a board-only project and every cell would sit frozen on frame 0.
			if (n.kind === 'reelGrid' && hasFlipbookSymbol) return true;
			if (n.kind === 'container' && nodesHaveFlipbook(n.children, depth, stack)) return true;
			if (n.kind === 'componentInstance') {
				const def = componentMap.get(n.componentId);
				if (!def || depth >= MAX_COMPONENT_DEPTH || stack.includes(def.id)) continue;
				if (nodesHaveFlipbook(def.root.children, depth + 1, [...stack, def.id])) return true;
			}
		}
		return false;
	}

	/** The frame a placed clip shows RIGHT NOW — `(assetKey, region)` ready for the region draw.
	 * `null` for an unregistered / empty clip, which then draws its dangling placeholder.
	 *
	 * `override` carries a BINDING's own `fps` / `direction` — a placed `flipbook` node's, or a
	 * symbol cell's — so the preview shows what THAT binding does. The point of playing a clip in
	 * place is to judge it, and a binding that reverses or halves the authored clip would
	 * otherwise animate here as if it hadn't. */
	function flipbookFrame(
		clipId: string,
		override?: { fps?: number; direction?: 'forward' | 'reverse' | 'pingpong' },
	): { assetKey: string; region: string } | null {
		const clip = clipsById.get(clipId);
		if (!clip || clip.frames.length === 0) return null;
		return clipFrameAt(clip, clipFrameIndexAt(clip, clipClockMs, override));
	}

	/** A bound clip's mirroring — the BINDING's override, else the clip's own. Returned as a
	 * pair so the draw applies both axes in one `ctx.scale`.
	 *
	 * Takes the three fields rather than a node, because a symbol CELL now carries the same
	 * override block a placed node does and the precedence must not be written twice. */
	function flipbookMirror(binding: { clipId?: string; flipX?: boolean; flipY?: boolean }): {
		x: boolean;
		y: boolean;
	} {
		const clip = binding.clipId ? clipsById.get(binding.clipId) : undefined;
		return {
			x: binding.flipX ?? clip?.flipX ?? false,
			y: binding.flipY ?? clip?.flipY ?? false,
		};
	}

	/** The clip BOX to draw a frame against — `null` when the clip declares none, in which case the
	 * frame draws on its own packed rect exactly as it always has. */
	function flipbookBox(
		clipId: string,
		frame: { assetKey: string; region: string },
	): { origW: number; origH: number; offX: number; offY: number } | null {
		const clip = clipsById.get(clipId);
		if (!clip?.bounds) return null;
		const found = findRegion(frame.assetKey, frame.region);
		return found ? clipFrameBox(clip, found.region) : null;
	}

	/** Resolved stand-in art for a `bind` anchor (explicit override → catalog default
	 * against the project's assets). The 2D canvas + the spine overlay both resolve
	 * through this so they agree on ONE art per anchor. Triggers the lazy sprite-region
	 * scan when a node's catalog default is a sprite the index hasn't located yet. */
	function anchorArt(
		node: LayoutNode,
		previewSpineBundle?: string,
	): ResolvedPreviewArt | undefined {
		const art = resolveAnchorPreviewArt(node, assets, spriteRegionIndex, previewSpineBundle);
		if (art?.kind === 'sprite' && !art.assetKey) ensureRegionIndex();
		return art;
	}

	/** Natural draw size for a node — region size for region sprites, page/native otherwise.
	 * `instanceSpineBundle` (threaded by `nodeBox`/`componentInstanceContentBox`) resolves a
	 * nested spine bind's stand-in to the ENCLOSING instance's AUTHORED rig, so its box tracks
	 * that rig's natural bounds instead of the fixed catalog bundle. */
	function naturalSize(node: LayoutNode, instanceSpineBundle?: string): NaturalSize | null {
		// A placed effect's "natural size" is its live particle SPREAD, reported by the overlay
		// (`EditorEffectLayer` → `effectBounds`) in node-local / scene-world units. The spread is
		// OFFSET from the node origin (a burst fanning upward has particles above/left of it), so we
		// map the rect's top-left offset `x`/`y` into the box anchor: `nodeBox`/`nodeCornersWorld`
		// span the box local `-w*ax .. w*(1-ax)`, so a spread at local `x..x+w` needs `ax = -x/w`
		// (the same `-minX/w` convention `componentInstanceContentBox` uses). Null until particles
		// emit, so an idle effect keeps its fixed placeholder box.
		if (node.kind === 'effect') {
			const b = effectBounds.get(node.id);
			if (b && b.w > 0 && b.h > 0) {
				return { w: b.w, h: b.h, ax: -b.x / b.w, ay: -b.y / b.h };
			}
			return null;
		}
		// A text node's "natural size" is the RENDERED glyph box measured by the PIXI overlay
		// (`EditorTextLayer` → `textMeasured`), so an auto-size text node's selection frame hugs
		// the real text. Null until the first measurement lands (keeps the fallback box).
		if (node.kind === 'text') {
			const m = textMeasured.get(node.id);
			if (m && m.w > 0 && m.h > 0) return { w: m.w, h: m.h };
			return null;
		}
		// A componentInstance's "natural size" is the union of its expanded content (the
		// same box `nodeBox` frames + `drawComponentInstance` draws), so a background-space
		// instance cover-fits against its real drawn extent via `backgroundTransform`.
		// `nodeBox` routes an instance through `componentInstanceContentBox`; a missing def
		// or empty content falls back to its generic 160×100, which we treat as "unknown"
		// (null) so the cover uses the frame size instead of a tiny box.
		if (node.kind === 'componentInstance') {
			const box = boxOf(node, resolveTransform(node, layoutType));
			if (box.w > 0 && box.h > 0 && !(box.w === 160 && box.h === 100))
				return { w: box.w, h: box.h };
			return null;
		}
		// A `preview.art` bind anchor borrows the art's natural size (so box/hit-test
		// math frames the rendered art, not an empty container).
		const art = artNaturalSize(node, instanceSpineBundle);
		if (art) return art;
		if (node.kind === 'sprite' && node.region) {
			const found = findRegion(node.assetKey, node.region);
			if (!found) return null;
			// A boxed region sizes by its BOX — which is the point of declaring one: the selection
			// frame, the resize handles and a cover-fit all stop tracking the packer's rect.
			const boxed = artBoxGeometry(found.set.assetKey, found.region.name, found.region);
			return boxed ? { w: boxed.origW, h: boxed.origH } : regionNaturalSize(found.region);
		}
		// A placed clip sizes off its FIRST frame, not the frame currently playing: frames of one
		// animation are rarely identical rects, and a natural size that changed 24 times a second
		// would jitter the selection box, the resize handles and the hit-test under the cursor.
		if (node.kind === 'flipbook') {
			const clip = clipsById.get(node.clipId);
			if (!clip || clip.frames.length === 0) return null;
			// A clip with a declared BOX sizes off the box, not off a frame — which is the point of
			// declaring one: the selection box, the resize handles and a cover-fit all stop tracking
			// whatever rect the packer happened to give frame 0.
			if (clip.bounds && clip.bounds.w > 0 && clip.bounds.h > 0) {
				return { w: clip.bounds.w, h: clip.bounds.h };
			}
			const first = clipFrameAt(clip, 0);
			const found = findRegion(first.assetKey, first.region);
			return found ? regionNaturalSize(found.region) : null;
		}
		// A directly-placed spine node's natural size comes from the WebGL overlay's
		// setup-pose bounds (the 2D canvas can't measure a skeleton), keyed by the bundle
		// `assetKey` — the same map a `preview.art` spine anchor reads via `artNaturalSize`.
		// Without this the box/hit-test falls back to a tiny default (the assetKey is a
		// bundle prefix, never an image key, so the `images` lookup below always misses).
		if (node.kind === 'spine') {
			const sz = spineNaturalSizes.get(node.assetKey);
			if (sz) return sz;
		}
		if (node.kind === 'sprite' || node.kind === 'spine') {
			const img = images.get(node.assetKey);
			if (img && img.naturalWidth > 0) return { w: img.naturalWidth, h: img.naturalHeight };
		}
		return null;
	}

	/** Natural size of a `preview.art` payload, when the art is loaded:
	 * - sprite art: the atlas region's native size (resolved like a region sprite);
	 * - spine art: the skeleton's setup-pose bounds, reported by the WebGL overlay
	 *   (the 2D canvas can't measure a skeleton). `null` until it resolves. */
	function artNaturalSize(
		node: LayoutNode,
		instanceSpineBundle?: string,
	): { w: number; h: number } | null {
		const art = anchorArt(node, instanceSpineBundle);
		if (!art) return null;
		if (art.kind === 'sprite' && art.region && art.assetKey) {
			const found = findRegion(art.assetKey, art.region);
			return found ? regionNaturalSize(found.region) : null;
		}
		if (art.kind === 'spine') {
			return spineNaturalSizes.get(art.assetKey) ?? null;
		}
		return null;
	}

	let rafId = 0;
	function schedule(): void {
		if (rafId) return;
		rafId = requestAnimationFrame(() => {
			rafId = 0;
			draw();
		});
	}

	function resizeCanvas(): void {
		if (!wrap) return;
		const dpr = window.devicePixelRatio || 1;
		const w = Math.floor(wrap.clientWidth * dpr);
		const h = Math.floor(wrap.clientHeight * dpr);
		// Keep every 2D surface the same backing size so they overlay the base 1:1:
		// the base canvas (frame + interaction), each per-scene canvas, and the HUD.
		const all = [canvas, hudCanvas, ...sceneCanvases.values()];
		for (const c of all) {
			if (c && (c.width !== w || c.height !== h)) {
				c.width = w;
				c.height = h;
			}
		}
	}

	function clientToWorld(clientX: number, clientY: number): Vec2 {
		if (!canvas) return { x: 0, y: 0 };
		const rect = canvas.getBoundingClientRect();
		const cx = clientX - rect.left;
		const cy = clientY - rect.top;
		return { x: (cx - panX) / zoom, y: (cy - panY) / zoom };
	}
	function worldToScreen(p: Vec2): Vec2 {
		return { x: p.x * zoom + panX, y: p.y * zoom + panY };
	}

	function visibleSceneNodes(): LayoutNode[] {
		return scene.nodes.filter((n) => resolveTransform(n, layoutType).visible);
	}

	/**
	 * Non-hidden GAME scenes in DOC ORDER — the per-scene composite groups (markup
	 * below) are emitted one per entry, z-ordered by this index so ANY scene's
	 * content (its 2D canvas + spine + text) sits above/below ANOTHER scene's
	 * content strictly by screen order. (HUD scenes are drawn separately on the
	 * top-most `hudCanvas`.) This is what makes a full-bleed Background SPINE render
	 * BELOW the base-game 2D reels, instead of the spine layer always sitting on top.
	 */
	function visibleGameScenes(): Scene[] {
		return scenes.filter((s) => !hiddenSceneIds.has(s.id) && !isHudScene(s));
	}

	/** Does a scene carry a spine render target (a real spine node, a `bind` anchor whose
	 * resolved preview art is a spine, or a reel BOARD whose symbols bind spine art)? Only
	 * such scenes mount a (WebGL) spine sublayer in their group, so contexts stay bounded. */
	function sceneHasSpine(s: Scene): boolean {
		return nodesHaveSpine(s.nodes, 0, [], undefined);
	}
	/** Any symbol whose STATIC binding is a spine — the reel board then needs the WebGL
	 * layer to draw its cells (the 2D canvas can only marker them). */
	const hasSpineSymbol = $derived(symbolStatics.some((c) => c.type === 'spine'));
	function nodesHaveSpine(
		nodes: LayoutNode[],
		depth: number,
		stack: string[],
		/** The enclosing componentInstance's AUTHORED preview spine bundle (its first `spine`-kind
		 * param value), threaded EXACTLY like `collectNestedSpines` in `EditorSpineLayer`. Without it
		 * this check resolved only the FIXED catalog bundle (the win overlay's `bigwin`); a project
		 * whose authored rig differs (Borut's `R_WinScreen`) and that has no `bigwin` spine looked
		 * "spine-less", so the WebGL spine layer never mounted and the authored rig showed only its 2D
		 * placeholder — even though the renderer WOULD have drawn it. Mirrors the renderer so the
		 * layer mounts exactly when there is real spine work. */
		instanceSpineBundle: string | undefined,
	): boolean {
		for (const n of nodes) {
			if (n.kind === 'spine') return true;
			// A reel board with spine-bound symbols: its cells are drawn by the spine layer.
			if (n.kind === 'reelGrid' && hasSpineSymbol) return true;
			const art = anchorArt(n, instanceSpineBundle);
			if (art?.kind === 'spine' && art.assetKey) return true;
			if (n.kind === 'container' && nodesHaveSpine(n.children, depth, stack, instanceSpineBundle))
				return true;
			if (n.kind === 'componentInstance') {
				const def = componentMap.get(n.componentId);
				if (!def || depth >= MAX_COMPONENT_DEPTH || stack.includes(def.id)) continue;
				const params = resolveComponentParams(
					def,
					resolveLayoutInstanceParams(n, layoutType),
					undefined,
				);
				const spineBundle = instancePreviewSpineBundle(def, params);
				if (nodesHaveSpine(def.root.children, depth + 1, [...stack, def.id], spineBundle))
					return true;
			}
		}
		return false;
	}

	/** Does a scene carry a text render target (a `kind:'text'` node, or a coded HUD
	 * text bind anchor) ANYWHERE in its tree — including nested in containers / component
	 * instances, which the overlay now also owns? Only such scenes mount the pixi text
	 * sublayer. Walks the same tree (+ `componentInstance` expansion) as the overlay's
	 * `collectTextTargets`, so the layer mounts exactly when the overlay has work. */
	function sceneHasText(s: Scene): boolean {
		return nodesHaveText(s.nodes, 0, []);
	}
	function nodesHaveText(nodes: LayoutNode[], depth: number, stack: string[]): boolean {
		for (const n of nodes) {
			if (n.kind === 'text') return true;
			if (n.kind === 'container' && n.bind && n.preview?.style === 'text') return true;
			if (n.kind === 'container' && nodesHaveText(n.children, depth, stack)) return true;
			if (n.kind === 'componentInstance') {
				const def = componentMap.get(n.componentId);
				if (!def || depth >= MAX_COMPONENT_DEPTH || stack.includes(def.id)) continue;
				if (nodesHaveText(def.root.children, depth + 1, [...stack, def.id])) return true;
			}
			// A repeater expands its component per box in the overlay too (the cards' title/price/…
			// text), so the layer must mount when the repeated def carries any text.
			if (n.kind === 'repeater') {
				const def = componentMap.get(n.componentId);
				if (!def || depth >= MAX_COMPONENT_DEPTH || stack.includes(def.id)) continue;
				if (nodesHaveText(def.root.children, depth + 1, [...stack, def.id])) return true;
			}
		}
		return false;
	}

	/** Does a scene carry a placed `kind:'effect'` node ANYWHERE in its tree (incl. nested in a
	 * container / component instance)? Only such scenes mount the (WebGL) effect sublayer, so Pixi
	 * contexts stay bounded — mirroring `sceneHasSpine`. */
	function sceneHasEffect(s: Scene): boolean {
		return nodesHaveEffect(s.nodes, 0, []);
	}
	function nodesHaveEffect(nodes: LayoutNode[], depth: number, stack: string[]): boolean {
		for (const n of nodes) {
			if (n.kind === 'effect') return true;
			if (n.kind === 'container' && nodesHaveEffect(n.children, depth, stack)) return true;
			if (n.kind === 'componentInstance') {
				const def = componentMap.get(n.componentId);
				if (!def || depth >= MAX_COMPONENT_DEPTH || stack.includes(def.id)) continue;
				if (nodesHaveEffect(def.root.children, depth + 1, [...stack, def.id])) return true;
			}
		}
		return false;
	}

	/** Stable single-id `sceneFilter` per scene — memoized so the spine/text sublayers
	 * don't see a fresh Set reference (and rebuild) on every parent re-render. */
	const sceneFilters = new Map<string, Set<string>>();
	function sceneFilterFor(id: string): Set<string> {
		let f = sceneFilters.get(id);
		if (!f) {
			f = new Set([id]);
			sceneFilters.set(id, f);
		}
		return f;
	}

	/** Synthetic scene key for the HUD text overlay's report buffers (it covers ALL HUD
	 * scenes, which the game draws on one top layer — not one buffer per game scene). */
	const HUD_TEXT_KEY = '__hud-text__';

	/** Non-hidden HUD scenes that carry text the overlay must own. The HUD draws on its
	 * OWN top-most layer (`hudCanvas`), so its text lives on ONE overlay above that — the
	 * per-game-scene `{#each}` deliberately excludes HUD scenes. */
	function hudTextScenes(): Scene[] {
		return scenes.filter((s) => isHudScene(s) && !hiddenSceneIds.has(s.id) && sceneHasText(s));
	}

	/** Memoized multi-id `sceneFilter` for the HUD text overlay — a stable Set reference
	 * (rebuilt only when the membership changes) so the overlay doesn't churn each render. */
	let hudTextFilter = new Set<string>();
	function hudTextSceneFilter(): Set<string> {
		const ids = hudTextScenes().map((s) => s.id);
		if (ids.length !== hudTextFilter.size || ids.some((id) => !hudTextFilter.has(id))) {
			hudTextFilter = new Set(ids);
		}
		return hudTextFilter;
	}

	/** Synthetic scene key for the HUD spine overlay's report buffers — it covers ALL HUD
	 * scenes on one overlay (the HUD draws on its own top layer), mirroring `HUD_TEXT_KEY`. */
	const HUD_SPINE_KEY = '__hud-spine__';

	/** Non-hidden HUD scenes carrying a spine ANYWHERE in their tree (incl. nested in a
	 * placed component — a spin button's `R_SpinButton`). The per-game-scene `{#each}`
	 * excludes HUD scenes (they draw on `hudCanvas`), so without this the HUD's spines only
	 * ever show their 2D placeholder box and never the live skeleton. */
	function hudSpineScenes(): Scene[] {
		return scenes.filter((s) => isHudScene(s) && !hiddenSceneIds.has(s.id) && sceneHasSpine(s));
	}

	/** Memoized multi-id `sceneFilter` for the HUD spine overlay — a stable Set reference
	 * (rebuilt only when membership changes) so the overlay doesn't churn each render. */
	let hudSpineFilter = new Set<string>();
	function hudSpineSceneFilter(): Set<string> {
		const ids = hudSpineScenes().map((s) => s.id);
		if (ids.length !== hudSpineFilter.size || ids.some((id) => !hudSpineFilter.has(id))) {
			hudSpineFilter = new Set(ids);
		}
		return hudSpineFilter;
	}

	/** Synthetic scene key for the HUD effect overlay's report buffers — it covers ALL HUD scenes on
	 * one overlay (the HUD draws on its own top layer), mirroring `HUD_SPINE_KEY`. */
	const HUD_EFFECT_KEY = '__hud-effect__';

	/** Non-hidden HUD scenes carrying a placed effect ANYWHERE in their tree (incl. nested in a placed
	 * HUD component). The per-game-scene `{#each}` excludes HUD scenes (they draw on `hudCanvas`), so
	 * without this a HUD effect only ever shows its 2D chip and never the live emitters. */
	function hudEffectScenes(): Scene[] {
		return scenes.filter((s) => isHudScene(s) && !hiddenSceneIds.has(s.id) && sceneHasEffect(s));
	}

	/** Memoized multi-id `sceneFilter` for the HUD effect overlay — a stable Set reference (rebuilt
	 * only when membership changes) so the overlay doesn't churn each render. */
	let hudEffectFilter = new Set<string>();
	function hudEffectSceneFilter(): Set<string> {
		const ids = hudEffectScenes().map((s) => s.id);
		if (ids.length !== hudEffectFilter.size || ids.some((id) => !hudEffectFilter.has(id))) {
			hudEffectFilter = new Set(ids);
		}
		return hudEffectFilter;
	}

	/** Per-RUN 2D canvas registry — each game scene's node art draws onto its own canvas
	 * (registered here on mount) so it z-orders with the rest of its group. Keyed by
	 * {@link BlendRun.key}, not by scene id: a scene whose nodes use more than one blend mode
	 * draws across several stacked canvases (see {@link blendRuns}). */
	const sceneCanvases = new Map<string, HTMLCanvasElement>();
	function registerSceneCanvas(key: string, el: HTMLCanvasElement | null): void {
		if (el) sceneCanvases.set(key, el);
		else sceneCanvases.delete(key);
	}

	// ---------- blend modes (§ Photoshop-style node blending) ----------

	/**
	 * One stretch of consecutive top-level nodes that share a blend mode, drawn on its OWN
	 * `<canvas>` element carrying that mode as CSS `mix-blend-mode`.
	 *
	 * Why elements and not `ctx.globalCompositeOperation` on the one scene canvas: a scene canvas
	 * is TRANSPARENT and holds only its own scene. Blending inside it composites against that
	 * scene's art alone, so the canonical case — an additive glow in the base-game screen lifting
	 * the BACKGROUND screen's art, which lives in a different scene group — would show nothing in
	 * the editor while the game showed the glow. Stacked elements let the browser composite each
	 * run against everything already painted beneath it, which is exactly what PixiJS does with
	 * one scene graph.
	 *
	 * RUNS, not one layer per mode, so draw order is untouched: a blended node still paints
	 * between the same two siblings it does today. A scene with no blending yields exactly ONE run
	 * — the single canvas the editor has always had (parity, no extra surfaces).
	 */
	interface BlendRun {
		/** `<sceneId>#<runIndex>` — the canvas-registry key and the `{#each}` key. */
		key: string;
		sceneId: string;
		mode: BlendMode;
		/** CSS `mix-blend-mode` for the run's canvas element. */
		css: string;
		/** Top-level node ids in this run (draw order comes from the scene, not this set). */
		ids: Set<string>;
	}

	/** Effective blend mode of a top-level node for the ACTIVE layoutType (per-ratio overrides
	 * included) — `'normal'` when unset, which is every node that predates this feature. */
	function nodeBlendMode(n: LayoutNode): BlendMode {
		return resolveTransform(n, layoutType).blendMode ?? 'normal';
	}

	/** Memoized runs per scene — the Sets are handed to the WebGL overlays as props, so a fresh
	 * reference on every re-render would rebuild their skeletons/emitters each frame. Recomputed
	 * only when the scene's id→mode sequence (or the layoutType) actually changes. */
	const blendRunCache = new Map<string, { sig: string; runs: BlendRun[] }>();
	function blendRuns(s: Scene): BlendRun[] {
		const modes = s.nodes.map((n) => `${n.id}:${nodeBlendMode(n)}`);
		const sig = `${layoutType}|${modes.join(',')}`;
		const hit = blendRunCache.get(s.id);
		if (hit && hit.sig === sig) return hit.runs;
		const runs: BlendRun[] = [];
		for (const n of s.nodes) {
			const mode = nodeBlendMode(n);
			const last = runs[runs.length - 1];
			if (last && last.mode === mode) last.ids.add(n.id);
			else
				runs.push({
					key: `${s.id}#${runs.length}`,
					sceneId: s.id,
					mode,
					css: cssBlendMode(mode),
					ids: new Set([n.id]),
				});
		}
		// An empty scene still needs its canvas — the group's other sublayers stack on it.
		if (runs.length === 0) {
			runs.push({ key: `${s.id}#0`, sceneId: s.id, mode: 'normal', css: 'normal', ids: new Set() });
		}
		blendRunCache.set(s.id, { sig, runs });
		return runs;
	}

	/**
	 * The blend GROUPS a scene's WebGL overlay (spine / FX) splits into: the un-blended nodes stay
	 * on the layer the editor already mounted (`nodeFilter: null` — byte-identical parity), and
	 * each non-normal mode gets ONE extra layer. Unlike the 2D runs this collapses to one layer per
	 * MODE rather than per run, because the overlays already sit in a fixed stack above the 2D art
	 * (2D → spine → text → FX) and so make no intra-scene z-order promise to keep. That also keeps
	 * the WebGL context count bounded: a scene adds a context per distinct blend mode it uses, and
	 * blending is opt-in, so the common scene adds none.
	 */
	interface BlendOverlayGroup {
		/** Synthetic merge/report key — `forgetScene` purges these alongside the scene. */
		key: string;
		mode: BlendMode;
		css: string;
		ids: Set<string>;
	}
	const blendOverlayCache = new Map<string, { sig: string; groups: BlendOverlayGroup[] }>();
	function blendOverlayGroups(s: Scene): BlendOverlayGroup[] {
		const sig = `${layoutType}|${s.nodes.map((n) => `${n.id}:${nodeBlendMode(n)}`).join(',')}`;
		const hit = blendOverlayCache.get(s.id);
		if (hit && hit.sig === sig) return hit.groups;
		const byMode = new Map<BlendMode, Set<string>>();
		for (const n of s.nodes) {
			const mode = nodeBlendMode(n);
			if (mode === 'normal') continue;
			const set = byMode.get(mode) ?? new Set<string>();
			set.add(n.id);
			byMode.set(mode, set);
		}
		const groups: BlendOverlayGroup[] = [...byMode].map(([mode, ids]) => ({
			key: `${s.id}#blend:${mode}`,
			mode,
			css: cssBlendMode(mode),
			ids,
		}));
		blendOverlayCache.set(s.id, { sig, groups });
		return groups;
	}

	/** The un-blended top-level node ids of a scene — the `nodeFilter` for its BASE overlay layer,
	 * so a blended rig renders on its own blended layer instead of twice. `null` when the scene
	 * blends nothing, which is the untouched path the overlays take today. */
	const normalOverlayCache = new Map<string, { sig: string; ids: Set<string> | null }>();
	function normalOverlayFilter(s: Scene): Set<string> | null {
		const sig = `${layoutType}|${s.nodes.map((n) => `${n.id}:${nodeBlendMode(n)}`).join(',')}`;
		const hit = normalOverlayCache.get(s.id);
		if (hit && hit.sig === sig) return hit.ids;
		const blended = s.nodes.some((n) => nodeBlendMode(n) !== 'normal');
		const ids = blended
			? new Set(s.nodes.filter((n) => nodeBlendMode(n) === 'normal').map((n) => n.id))
			: null;
		normalOverlayCache.set(s.id, { sig, ids });
		return ids;
	}

	function findNodeById(id: string): LayoutNode | null {
		for (const n of scene.nodes) if (n.id === id) return n;
		return null;
	}

	// ---------- draw ----------

	function draw(): void {
		if (!canvas) return;
		// Size-sync every 2D surface first, so a per-scene canvas that mounted this same
		// frame (or a DPR change) never paints one frame at a stale backing size.
		resizeCanvas();
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		const dpr = window.devicePixelRatio || 1;
	/**
	 * True while the 2D surface being drawn carries its nodes' blend on the ELEMENT (a
	 * {@link BlendRun} canvas), so `drawNode` must not apply it a second time via
	 * `globalCompositeOperation`. False for the HUD canvas, which is one shared surface and
	 * therefore blends inline. NESTED nodes always blend inline — they cannot have an element of
	 * their own — so this only ever suppresses the top-level application.
	 */
	let elementCarriesBlend = false;


		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.fillStyle = '#0b0b10';
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.translate(panX, panY);
		ctx.scale(zoom, zoom);

		// `standard` + bottom-align: show the window extent ABOVE the standard box so
		// the author sees the box is pinned to the bottom of the screen (matching
		// `<MainContainer standard alignVertical="bottom">`). The box itself frames at
		// 0..frameHeight; the dimmed region above is a context cue only (the live
		// window height varies — this uses a representative 16:9 window).
		if (scene.space === 'standard' && scene.align?.vertical === 'bottom') {
			const windowH = Math.max(frameWidth * (9 / 16), frameHeight);
			const top = frameHeight - windowH;
			ctx.fillStyle = 'rgba(20,20,28,0.35)';
			ctx.fillRect(0, top, frameWidth, windowH - frameHeight);
			ctx.lineWidth = 1.5 / zoom;
			ctx.strokeStyle = '#2a2a36';
			ctx.setLineDash([10 / zoom, 8 / zoom]);
			ctx.strokeRect(0, top, frameWidth, windowH);
			ctx.setLineDash([]);
		}

		// The frame backdrop now represents the fixed WINDOW (§10.2) — one viewport per
		// layoutType that every scene composites against.
		ctx.fillStyle = '#14141c';
		ctx.fillRect(0, 0, frameWidth, frameHeight);
		ctx.lineWidth = 2 / zoom;
		ctx.strokeStyle = '#3a3a4a';
		ctx.setLineDash([12 / zoom, 8 / zoom]);
		ctx.strokeRect(0, 0, frameWidth, frameHeight);
		ctx.setLineDash([]);

		// The play area (main box) drawn as a centred inner dashed guide, sized + placed
		// EXACTLY like the game's <MainContainer> inside this window (centre + `mainScale`).
		// Lets the author see where gameplay sits within the full window.
		{
			const main = mainSizesMap[layoutType];
			const s = mainScale();
			const mw = main.width * s;
			const mh = main.height * s;
			const mx = frameWidth / 2 - mw / 2;
			const my = frameHeight / 2 - mh / 2;
			ctx.lineWidth = 1.5 / zoom;
			ctx.strokeStyle = '#2f5d57';
			ctx.setLineDash([8 / zoom, 6 / zoom]);
			ctx.strokeRect(mx, my, mw, mh);
			ctx.setLineDash([]);
		}

		// GAME scenes are NOT drawn on this base canvas anymore: each is composited onto
		// its OWN per-scene canvas (see `drawSceneCanvases`), z-ordered with that scene's
		// spine + text sublayers by screen order — so e.g. a full-bleed Background spine
		// renders BELOW the base-game 2D, instead of the spine layer always being on top.
		// This base canvas keeps only the frame backdrop + the interaction surface (input
		// passes through the per-scene groups, which are `pointer-events:none`).
		drawSceneCanvases();
		drawHud();
	}

	/**
	 * Draw each non-hidden GAME scene's 2D node art onto its OWN registered canvas, in
	 * the SAME world→screen mapping as everything else (`setTransform(dpr) · pan · zoom`).
	 * Each per-scene canvas sits in a z-ordered group (markup below) between this base
	 * canvas and the HUD, so intra-stack order follows screen order across the 2D/spine/
	 * text surfaces. The eye toggle is authoritative — a hidden scene never draws.
	 */
	function drawSceneCanvases(): void {
		const dpr = window.devicePixelRatio || 1;
		for (const s of visibleGameScenes()) {
			for (const run of blendRuns(s)) {
				const c = sceneCanvases.get(run.key);
				if (!c) continue;
				const sctx = c.getContext('2d');
				if (!sctx) continue;
				sctx.setTransform(1, 0, 0, 1, 0, 0);
				sctx.clearRect(0, 0, c.width, c.height); // transparent — base shows through
				sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
				sctx.translate(panX, panY);
				sctx.scale(zoom, zoom);
				// Iterate the SCENE, not the run's set, so draw order stays doc order.
				for (const node of s.nodes) if (run.ids.has(node.id)) drawNode(sctx, node, s);
			}
		}
	}

	/**
		// Each run canvas carries its own blend on the element, so the node draws must NOT also
		// apply it (see `elementCarriesBlend`). Restored before returning so the HUD pass — one
		// shared surface, which has to blend inline — is unaffected.
		elementCarriesBlend = true;
	 * Draw the HUD screens on the top-most `hudCanvas` — ABOVE the spine/FX overlay,
	 * so the HUD renders on top like the real game (the base canvas, which holds the
	 * game scenes, sits below the spine layer). Also draws the selection overlay here
	 * (top-most) so a selected node's handles are never hidden behind the FX.
	 */
	function drawHud(): void {
		if (!hudCanvas) return;
		const ctx = hudCanvas.getContext('2d');
		if (!ctx) return;
		const dpr = window.devicePixelRatio || 1;

		ctx.setTransform(1, 0, 0, 1, 0, 0);
		elementCarriesBlend = false;
		ctx.clearRect(0, 0, hudCanvas.width, hudCanvas.height); // transparent overlay
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.translate(panX, panY);
		ctx.scale(zoom, zoom);

		// Snap guide lines (world-space). Drawn on the top-most HUD canvas so the pink
		// placement guides stay visible over the per-scene composite groups beneath it.
		if (snapLines.length > 0) {
			ctx.save();
			ctx.lineWidth = 1 / zoom;
			ctx.strokeStyle = '#ff5db0';
			ctx.setLineDash([6 / zoom, 4 / zoom]);
			const ext = 4000 / zoom;
			for (const s of snapLines) {
				ctx.beginPath();
				if (s.axis === 'x') {
					ctx.moveTo(s.v, -ext);
					ctx.lineTo(s.v, frameHeight + ext);
				} else {
					ctx.moveTo(-ext, s.v);
					ctx.lineTo(frameWidth + ext, s.v);
				}
				ctx.stroke();
			}
			ctx.restore();
		}

		for (const s of scenes) {
			if (hiddenSceneIds.has(s.id) || !isHudScene(s)) continue;
			for (const node of s.nodes) drawNode(ctx, node, s);
		}

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		drawSelectionOverlay(ctx);

		// Always-on-top screen-border overlay. The window frame + play-area (main box) are
		// normally drawn on the BASE canvas (bottom of the z-stack), so stacked art buries
		// them. When toggled on, re-draw them here on the top-most HUD canvas — above every
		// art/spine/FX layer — as a brighter guide so the author can always see the bounds.
		if (showScreenBorder) {
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.translate(panX, panY);
			ctx.scale(zoom, zoom);
			// Window frame — the full viewport every scene composites against.
			ctx.lineWidth = 2 / zoom;
			ctx.strokeStyle = '#7ee0c0';
			ctx.setLineDash([12 / zoom, 8 / zoom]);
			ctx.strokeRect(0, 0, frameWidth, frameHeight);
			// Play area (main box) — where <MainContainer> gameplay sits inside the window.
			const main = mainSizesMap[layoutType];
			const s = mainScale();
			const mw = main.width * s;
			const mh = main.height * s;
			ctx.lineWidth = 1.5 / zoom;
			ctx.strokeStyle = '#4fd6c0';
			ctx.setLineDash([8 / zoom, 6 / zoom]);
			ctx.strokeRect(frameWidth / 2 - mw / 2, frameHeight / 2 - mh / 2, mw, mh);
			ctx.setLineDash([]);
		}
	}

	/** The numeric value bound to `fieldPath`, or `undefined` (so the caller keeps its own). */
	function boundNumber(
		bound: Record<string, string> | undefined,
		fieldPath: string,
		params: Record<string, unknown>,
	) {
		const value = resolveBoundValue(bound, fieldPath, params);
		return typeof value === 'number' ? value : undefined;
	}

	/** The string value bound to `fieldPath`, or `undefined` (so the caller keeps its own). */
	function boundString(
		bound: Record<string, string> | undefined,
		fieldPath: string,
		params: Record<string, unknown>,
	) {
		const value = resolveBoundValue(bound, fieldPath, params);
		return typeof value === 'string' ? value : undefined;
	}

	/** Caption a `bind` text-chip shows. A `preview.textParam` reads the resolved
	 * param from `params` (number → formatted, string → as-is, engine-fed/unset
	 * number → "0") so a decomposed readout's Caption reads "BALANCE" and its Value
	 * a number — not the part name. No `textParam` ⇒ the instance's `label` param (a
	 * placed readout's caption) then the node label — parity with the prior path. */
	function chipCaption(node: LayoutNode, params: Record<string, unknown> | undefined): string {
		const key = node.preview?.textParam;
		if (key) {
			const v = params?.[key];
			if (typeof v === 'number') return paramNumberFormat.format(v);
			if (typeof v === 'string' && v !== '') return v;
			return '0';
		}
		const bindName = node.bind?.component ?? '';
		const label = params?.label;
		return String((typeof label === 'string' && label) || node.label || bindName);
	}

	/** Preview mirror of the coded readout ALIGN (HudReadout v3): the Caption
	 * (`textParam:'label'`) reads `captionAlign`, the Value (`textParam:'value'`) reads
	 * `valueAlign`; `left`/`right` drive the text anchor AND an x-offset of ±`alignWidth/2`
	 * (the background box), matching `HudCaption`/`HudValue`. Unset ⇒ no override (the node's
	 * own transform anchor stands). `anchorX` undefined = "don't touch the anchor". */
	function readoutAlign(
		node: LayoutNode,
		params: Record<string, unknown> | undefined,
	): { anchorX?: number; offsetX: number } {
		const prefix =
			node.preview?.textParam === 'label'
				? 'caption'
				: node.preview?.textParam === 'value'
					? 'value'
					: '';
		if (!prefix) return { offsetX: 0 };
		const align = params?.[prefix + 'Align'];
		const halfW = (typeof params?.alignWidth === 'number' ? params.alignWidth : 0) / 2;
		if (align === 'left') return { anchorX: 0, offsetX: -halfW };
		if (align === 'right') return { anchorX: 1, offsetX: halfW };
		if (align === 'center') return { anchorX: 0.5, offsetX: 0 };
		return { offsetX: 0 };
	}

	function drawNode(
		ctx: CanvasRenderingContext2D,
		node: LayoutNode,
		sceneCtx: Scene = scene,
		componentDepth = 0,
		componentStack: string[] = [],
		/**
		 * Resolved params of the ENCLOSING `componentInstance` (when this node is being
		 * drawn as expanded def content) — threaded so a mounted `bind` chip can show the
		 * instance's `label`/`fill`/`fontSize` params instead of the def's bare component
		 * name. Absent for every top-level scene draw (and every non-instance subtree) ⇒
		 * the chip/text paths fall back to their prior inputs — parity. A nested
		 * componentInstance recomputes its OWN params (it does not inherit this).
		 */
		instanceParams?: Record<string, unknown>,
		/**
		 * NESTED nodes (a container/component-instance child) compose in their parent's
		 * LOCAL space — no scene-space framing (`mainToWorld`/`mainScale`, background cover,
		 * standard fit), because the parent chain (via the `ctx` matrix stack) already
		 * carries that framing ONCE, exactly like the runtime's single root `<MainContainer>`.
		 * Top-level scene nodes (`false`) keep the framed `nodeTransform`. This is THE shared
		 * composition rule the PIXI text overlay obeys too (`childLocalTransform`), so the 2D
		 * canvas + overlay + game runtime land every nested node identically.
		 */
		nested = false,
		/**
		 * The ENCLOSING componentInstance's AUTHORED preview spine bundle (its first `spine`-kind
		 * param value; see `instancePreviewSpineBundle`) — so a nested bound-component that previews a
		 * SPINE (the win / free-spin VISUAL) stands in the authored rig, and its readiness check keys
		 * the SAME bundle the WebGL layer renders. Undefined for a top-level node or an instance
		 * whose def declares no spine param ⇒ the catalog default (parity).
		 */
		instanceSpineBundle?: string,
	): void {
		const t = nested
			? childLocalTransform(node, layoutType, sceneCtx.space, frameWidth, frameHeight)
			: nodeTransform(node, sceneCtx);
		if (!t.visible) return;

		ctx.save();
		ctx.translate(t.x, t.y);
		if (t.rotation) ctx.rotate(t.rotation);
		const sx = t.scale?.x ?? 1;
		const sy = t.scale?.y ?? 1;
		if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
		if (t.alpha !== undefined) ctx.globalAlpha = t.alpha;

		if (node.bind) {
			// Bound nodes (HUD elements, Win/Transition anchors, mount slots) have no
			// editor-renderable art — the game mounts the real component at runtime.
			// A `preview.art` anchor (e.g. the animated Background) gets a real spine/
			// sprite stand-in: spine art is drawn by the WebGL overlay (placeholder
			// until ready, like a spine node); sprite art is drawn here on the 2D canvas.
			// HUD elements carry `preview.style` so we draw a faithful chip; others get
			// a plain placeholder.
			const art = anchorArt(node, instanceSpineBundle);
			// A coded TILE part the catalog says an instance can SKIN (the readout's Background —
			// see `TileImageBinding`): the picked frame REPLACES the stand-in chip, drawn at the
			// tile's coded box or the instance's size overrides, so a per-instance background
			// previews here exactly as the game draws it. Read off `bind.component`, never a
			// hardcoded component id; no declaration ⇒ every branch below is unchanged (parity).
		// Photoshop-style blend. A TOP-LEVEL node on a scene run canvas already has its mode on the
		// element, so applying it here too would blend twice; every other case (a nested child, the
		// shared HUD canvas) blends inline against whatever this surface has already drawn.
		if (nested || !elementCarriesBlend) {
			const op = canvasCompositeOp(t.blendMode);
			if (op !== 'source-over') ctx.globalCompositeOperation = op;
		}
			const tile = boundComponentTileImage(node.bind.component);
			const tileParams = instanceParams ?? componentParams;
			const tileNum = (key?: string): number | undefined =>
				key && typeof tileParams[key] === 'number' ? (tileParams[key] as number) : undefined;
			const tileStr = (key?: string): string | undefined =>
				key && typeof tileParams[key] === 'string' && tileParams[key]
					? (tileParams[key] as string)
					: undefined;
			const tileT = tile
				? {
						...t,
						width: tileNum(tile.widthParam) ?? tile.width,
						height: tileNum(tile.heightParam) ?? tile.height,
					}
				: t;
			const tileTint = tile ? tileNum(tile.tintParam) : undefined;
			const tileImage = tile ? tileStr(tile.imageParam) : undefined;
			if (tileImage) {
				const scoped = parseScopedFrameRef(tileImage);
				drawArtRegionSprite(
					ctx,
					scoped.assetKey ?? '',
					scoped.region,
					tileT,
					node.label,
					tileTint !== undefined && tileTint !== 0xffffff ? tileTint : undefined,
				);
			} else if (art?.kind === 'spine') {
				// A bone-riding bind (the Scene Editor reveal preview) renders its rig from the
				// ENCLOSING instance's spine param, not the catalog default — so check THAT key
				// for readiness, else the placeholder would linger over the real rig (or double it
				// when the author picks a non-default bundle). Non-riding binds are unchanged.
				let rigKey = art.assetKey;
				const rides = node.bind ? boundComponentRidesBone(node.bind.component) : undefined;
				if (rides && instanceParams) {
					rigKey = resolveBoneRiderRigKey(rides, instanceParams, assets.spines) || art.assetKey;
				}
				if (!readySpineKeys.has(rigKey)) {
					drawPlaceholder(
						ctx,
						t.anchor?.x ?? 0.5,
						t.anchor?.y ?? 0.5,
						'#4a3a5a',
						`spine: ${node.label ?? art.assetKey}`,
					);
				}
			} else if (art?.kind === 'sprite' && art.region && art.assetKey) {
				drawArtRegionSprite(ctx, art.assetKey, art.region, t, node.label);
			} else if (node.preview?.style && !readyTextIds.has(node.id)) {
				// A skinnable tile with no image picked still draws its chip at the RESOLVED box
				// (coded size, or the instance's overrides) — so widening the background moves the
				// preview too, and the chip finally stands in at the size the game paints.
				const chipPreview = tile
					? { ...node.preview, w: tileT.width, h: tileT.height }
					: node.preview;
				// The tile's recolour: the instance's `backgroundTint` over the def's `bind.props`.
				const chipProps =
					tileTint !== undefined
						? { ...((node.bind.props ?? {}) as Record<string, unknown>), tint: tileTint }
						: (node.bind.props as Record<string, unknown> | undefined);
				// The PIXI text overlay draws this HUD anchor with its real chosen font once
				// loaded (reported via readyTextIds); until then the chip stands in.
				// When this `bind` is a mount inside a componentInstance (instanceParams set),
				// the chip shows the instance's resolved `label` caption + `fill`/`fontSize`
				// styling — so a placed `HudReadout` reads "BALANCE" (its label param), not the
				// bare component name. Absent instanceParams ⇒ the prior bind.props path (parity).
				if (instanceParams) {
					// Per-text style preview (HudReadout v2): the Caption node (`textParam:'label'`)
					// reads `caption*`, the Value node (`textParam:'value'`) reads `value*`; both
					// fall back to the SHARED key so older instances preview identically.
					const textPrefix =
						node.preview?.textParam === 'label'
							? 'caption'
							: node.preview?.textParam === 'value'
								? 'value'
								: '';
					const styleParam = (base: 'fill' | 'fontSize' | 'fontFamily'): unknown => {
						const scoped = textPrefix
							? instanceParams[textPrefix + base[0].toUpperCase() + base.slice(1)]
							: undefined;
						return scoped !== undefined ? scoped : instanceParams[base];
					};
					const fillV = styleParam('fill');
					const fontSizeV = styleParam('fontSize');
					const fontFamilyV = styleParam('fontFamily');
					const a = readoutAlign(node, instanceParams);
					const ta =
						a.anchorX !== undefined ? { ...t, anchor: { x: a.anchorX, y: t.anchor?.y ?? 0 } } : t;
					ctx.save();
					ctx.translate(a.offsetX, 0);
					drawHudChip(ctx, ta, chipPreview, chipCaption(node, instanceParams), chipProps, {
						fill: typeof fillV === 'number' ? fillV : undefined,
						fontSize: typeof fontSizeV === 'number' ? fontSizeV : undefined,
						fontFamily: typeof fontFamilyV === 'string' ? fontFamilyV : undefined,
					});
					ctx.restore();
				} else {
					const a = readoutAlign(node, componentParams);
					const ta =
						a.anchorX !== undefined ? { ...t, anchor: { x: a.anchorX, y: t.anchor?.y ?? 0 } } : t;
					ctx.save();
					ctx.translate(a.offsetX, 0);
					drawHudChip(ctx, ta, chipPreview, chipCaption(node, componentParams), chipProps);
					ctx.restore();
				}
			} else if (!node.preview?.style) {
				drawPlaceholder(
					ctx,
					t.anchor?.x ?? 0.5,
					t.anchor?.y ?? 0.5,
					'#2f5d57',
					node.label ?? node.bind.component,
				);
			}
		} else if (node.kind === 'sprite') {
			// B3 (§13.4): when the open component provides resolved params AND this sprite
			// declares `paramBindings`, the bound `region`/`assetKey`/`tint` fields read
			// from the params (same paths + precedence as `LayoutNodeView`) so the canvas
			// previews the BOUND icon/texture + colour, not the static placeholder. With no
			// params / no bindings every value falls back to the node's own — parity.
			const bound = node.paramBindings;
			// Prefer the ENCLOSING instance's resolved params (scene editor: a placed
			// instance's per-instance overrides) over the open-component params (component
			// editor: the def's own defaults). Both empty ⇒ static fallback (parity).
			const effParams = instanceParams ?? componentParams;
			const hasParams = Object.keys(effParams).length > 0;
			const boundRegion = hasParams ? boundString(bound, 'region', effParams) : undefined;
			const boundAssetKey = hasParams ? boundString(bound, 'assetKey', effParams) : undefined;
			const boundTint = hasParams ? boundNumber(bound, 'tint', effParams) : undefined;
			// An atlas-scoped image-param value (`<assetKey>::<region>`, from the picker)
			// pins the atlas; a legacy bare name leaves `assetKey` from the node.
			const scopedFrame = parseScopedFrameRef(boundRegion ?? node.region);
			const region = scopedFrame.region;
			// Cross-atlas resolution lives in `findRegion` now (a frame missing from this
			// `assetKey` is looked up by name across atlases) — so a bound `image`-param swap
			// OR a static region whose atlas no longer packs it both render.
			const assetKey = scopedFrame.assetKey ?? boundAssetKey ?? node.assetKey;
			const tint = boundTint !== undefined && boundTint !== 0xffffff ? boundTint : undefined;
			if (region) {
				drawRegionSprite(ctx, node, t, region, assetKey, tint);
			} else {
				const img = ensureImage(assetKey);
				if (img && img.complete && img.naturalWidth > 0) {
					const w = t.width ?? img.naturalWidth;
					const h = t.height ?? img.naturalHeight;
					const ax = t.anchor?.x ?? 0;
					const ay = t.anchor?.y ?? 0;
					drawTintedImage(
						ctx,
						img,
						0,
						0,
						img.naturalWidth,
						img.naturalHeight,
						-w * ax,
						-h * ay,
						w,
						h,
						tint,
					);
				} else {
					drawPlaceholder(
						ctx,
						t.anchor?.x ?? 0.5,
						t.anchor?.y ?? 0.5,
						'#3a4a5a',
						node.label ?? '…',
					);
				}
			}
		} else if (node.kind === 'spine') {
			// The WebGL overlay draws the real skeleton once loaded; until then (or on
			// load error) the placeholder box stands in.
			if (!readySpineKeys.has(node.assetKey)) {
				drawPlaceholder(
					ctx,
					t.anchor?.x ?? 0.5,
					t.anchor?.y ?? 0.5,
					'#4a3a5a',
					`spine: ${node.label ?? node.assetKey}`,
				);
			}
		} else if (node.kind === 'text') {
			// Text is rendered EXCLUSIVELY by the PIXI overlay (`EditorTextLayer`) now — it
			// owns every `kind:'text'` node (top-level, nested, or inside a component
			// instance) with the same anchor/align/baseline + world position as the game
			// runtime. The old 2D `fillText` fallback (which dropped anchor/align) is gone.
		} else if (node.kind === 'rect') {
			// Flat colour fill — lossless at any size (no art). The transform (translate/
			// scale/rotate/alpha) is already applied above, so draw the box in local space
			// honouring the anchor. `color` defaults to white; opacity is the transform alpha.
			const w = t.width ?? node.width;
			const h = t.height ?? node.height;
			const ax = t.anchor?.x ?? 0.5;
			const ay = t.anchor?.y ?? 0.5;
			ctx.fillStyle = '#' + ((node.color ?? 0xffffff) & 0xffffff).toString(16).padStart(6, '0');
			ctx.fillRect(-w * ax, -h * ay, w, h);
		} else if (node.kind === 'container') {
			for (const child of node.children)
				drawNode(
					ctx,
					child,
					sceneCtx,
					componentDepth,
					componentStack,
					instanceParams,
					true,
					instanceSpineBundle,
				);
		} else if (node.kind === 'componentInstance') {
			drawComponentInstance(ctx, node, sceneCtx, componentDepth, componentStack);
		} else if (node.kind === 'reelGrid') {
			drawReelGrid(ctx, node, t);
		} else if (node.kind === 'effect') {
			// A placed Invisible FX effect. The live `EditorEffectLayer` overlay plays the real
			// emitters on a Pixi canvas above this one, positioned at the SAME transform — so once it
			// reports the node ready (`liveEffectIds`), skip the 2D chip and let the particles show.
			// A node still loading its doc (or a bone-only effect the overlay skips) keeps the chip;
			// the selection box + hit-test stay regardless (still selectable / movable).
			if (!liveEffectIds.has(node.id)) {
				drawPlaceholder(
					ctx,
					t.anchor?.x ?? 0.5,
					t.anchor?.y ?? 0.5,
					'#3a5a4a',
					`✨ ${node.label ?? node.effectId}`,
				);
			}
		} else if (node.kind === 'flipbook') {
			// A placed Invisible Flipbook clip PLAYS here — unlike an effect (a WebGL emitter this 2D
			// canvas genuinely can't run) a clip is just atlas frames in order, so the author sees the
			// real animation at its real placement. The current frame draws through the SAME region
			// path a sprite uses, so trim, rotation and cross-atlas resolution all behave identically.
			// A dangling / un-baked clipId has no frames to draw: the labelled chip says so, and the
			// node stays selectable and movable so the reference can be re-pointed in Properties.
			const frame = flipbookFrame(node.clipId, { fps: node.fps, direction: node.direction });
			if (frame) {
				drawArtRegionSprite(
					ctx,
					frame.assetKey,
					frame.region,
					t,
					node.label,
					t.tint,
					flipbookMirror(node),
					flipbookBox(node.clipId, frame),
				);
			} else {
				drawPlaceholder(
					ctx,
					t.anchor?.x ?? 0.5,
					t.anchor?.y ?? 0.5,
					'#3a4a5a',
					`🎞 ${node.label ?? node.clipId}`,
				);
			}
		} else if (node.kind === 'repeater') {
			drawRepeater(ctx, node, t, sceneCtx, componentDepth, componentStack);
		}

		ctx.restore();
	}

	/** The config-resolved SAMPLE item count for a `repeater` (its `source`'s live length —
	 * `featureCards` → the non-default bet modes). Undefined for an unknown/unconfigured source ⇒
	 * `repeaterPlaceholderGrid` keeps its fixed fallback count. */
	function repeaterItemCount(node: Extract<LayoutNode, { kind: 'repeater' }>): number | undefined {
		return repeaterSources?.[node.source]?.count;
	}

	/** The per-item `engineProvided` values for a `repeater`'s cards (title/price/… per bet mode).
	 * Empty for an unknown/unconfigured source ⇒ each box previews the def's default copy. */
	function repeaterItemValues(
		node: Extract<LayoutNode, { kind: 'repeater' }>,
	): Array<Record<string, unknown>> {
		return repeaterSources?.[node.source]?.items ?? [];
	}

	/** `nodeBox` with the `repeater` SAMPLE count threaded in from config, so a repeater's selection /
	 * hit rect frames the SAME grid `drawRepeater` draws. Every canvas `nodeBox` call routes through
	 * here, so the count is resolved in ONE place (non-repeater nodes are unaffected). */
	function boxOf(node: LayoutNode, t: ResolvedTransform, spineBundle?: string): NodeBox {
		return nodeBox(
			node,
			t,
			naturalSize,
			componentMap,
			layoutType,
			spineBundle,
			node.kind === 'repeater' ? repeaterItemCount(node) : undefined,
		);
	}

	/**
	 * Draw a `repeater` node's editor preview: the config-resolved SAMPLE of item boxes laid out by
	 * the node's `layout` rule (row advances +x; grid wraps at `columns`), each EXPANDING the real
	 * repeated component (its `def.root.children` fed the item's per-card values) so the author sees
	 * actual cards, not empty rects. Reuses `drawNode`'s component-expansion path via a synthetic
	 * per-box container (`repeaterBoxes`) — sprites/rects draw here on the 2D canvas, text draws on
	 * the PIXI overlay (which expands the SAME boxes). A missing/unknown def falls back to the labelled
	 * empty-box placeholder. Drawn in the node's already-scaled local space (drawNode applied the
	 * transform), anchored like the reel grid.
	 */
	function drawRepeater(
		ctx: CanvasRenderingContext2D,
		node: Extract<LayoutNode, { kind: 'repeater' }>,
		t: ResolvedTransform,
		sceneCtx: Scene,
		componentDepth: number,
		componentStack: string[],
	): void {
		const def = componentMap.get(node.componentId);
		const g = repeaterPlaceholderGrid(node, { count: repeaterItemCount(node), def });
		// Unset repeater anchor = extend-right (0), matching the runtime <Repeater> (parity); the
		// seeded buy-feature scene carries an explicit {0.5,0.5} to centre.
		const anchorX = t.anchor?.x ?? 0;
		const anchorY = t.anchor?.y ?? 0;
		const left = -g.w * anchorX;
		const top = -g.h * anchorY;

		// Group backdrop so the repeated set still reads as one node.
		ctx.fillStyle = 'rgba(200, 163, 255, 0.06)';
		ctx.fillRect(left, top, g.w, g.h);

		if (def && !(componentDepth >= MAX_COMPONENT_DEPTH || componentStack.includes(def.id))) {
			// Expand the REAL component per box. The bind-spine preview bundle is resolved from the
			// def's own params (the per-item values feed no spine param), like `drawComponentInstance`.
			const spineBundle = instancePreviewSpineBundle(
				def,
				resolveComponentParams(def, undefined, undefined),
			);
			const stack = [...componentStack, def.id];
			for (const box of repeaterBoxes(node, def, g, repeaterItemValues(node), anchorX, anchorY)) {
				drawNode(
					ctx,
					box.container,
					sceneCtx,
					componentDepth + 1,
					stack,
					box.params,
					true,
					spineBundle,
				);
			}
		} else {
			// No def loaded (unknown componentId) or a depth/cycle guard: keep the empty-box placeholder.
			ctx.lineWidth = 1;
			ctx.strokeStyle = 'rgba(200, 163, 255, 0.5)';
			ctx.fillStyle = 'rgba(200, 163, 255, 0.09)';
			for (let i = 0; i < g.count; i++) {
				const col = i % g.cols;
				const rowIdx = Math.floor(i / g.cols);
				const x = left + col * (g.itemW + g.gap);
				const y = top + rowIdx * (g.itemH + g.gap);
				ctx.fillRect(x, y, g.itemW, g.itemH);
				ctx.strokeRect(x, y, g.itemW, g.itemH);
			}
		}

		ctx.fillStyle = '#e8e8ee';
		ctx.font = '14px sans-serif';
		ctx.fillText(
			`⧉ ${node.label ?? 'Repeater'} · ${node.componentId} ×${g.count}`,
			left + 8,
			top + 20,
		);
	}

	/**
	 * Draw the static placeholder for a `reelGrid` node: a `reels × rows` grid of
	 * cells (`cellWidth × cellHeight`, defaulting to the square `cellSize`) at the
	 * `gapX/gapY` pitch, centred per the node's anchor (drawn in the node's already-
	 * scaled local space — drawNode applied the transform). This stands in for the
	 * coded dynamic symbols so the author can position/shape the board. The cell
	 * boxes are the reel WINDOW (they move only with the board `boardNudge`); the warm
	 * inner SYMBOL marker per cell is the symbol seat, which the reel/row LEAD
	 * (`reelPadding`/`rowPadding`, seats the whole cluster) and the per-cell SEAT
	 * ALIGNMENT (`symbolAlignX/Y`, art within its own cell) move — mirroring the game's
	 * `getSymbolX` / `getSymbolLead` exactly, so the preview matches the live board. The
	 * geometry itself comes from the shared {@link reelGridGeometry} so the WebGL spine
	 * layer (which draws the SPINE symbols) seats them identically.
	 */
	function drawReelGrid(
		ctx: CanvasRenderingContext2D,
		node: Extract<LayoutNode, { kind: 'reelGrid' }>,
		t: ResolvedTransform,
	): void {
		// Board geometry (cell boxes + symbol seats) comes from the SHARED `reelGridGeometry`,
		// the same resolver `EditorSpineLayer` reads — so a sprite symbol drawn here and a spine
		// symbol drawn by the WebGL layer land on the SAME seat.
		const geo = reelGridGeometry(node, t.anchor, gridDimensions);
		const { left, top } = geo;
		const w = geo.width;
		const h = geo.height;
		// Board OUTLINE: a rect while the board is flat (the literal call, unchanged), a TRAPEZOID
		// once a perspective is authored — the geometry hands back the 4 corners so no vanishing-point
		// math lives in this drawing code. Each CELL stays an axis-aligned rectangle either way: every
		// cell in a row shares that row's scale, so a row contracts uniformly and only the BOARD
		// converges. `clip` is the outline's axis-aligned bound, matching the game's rectangular
		// `BoardMask` (which deliberately over-extends so the widest row is never clipped).
		const outlinePath = (): void => {
			ctx.beginPath();
			if (!geo.outline) {
				ctx.rect(left, top, w, h);
				return;
			}
			ctx.moveTo(geo.outline[0].x, geo.outline[0].y);
			for (let k = 1; k < geo.outline.length; k += 1)
				ctx.lineTo(geo.outline[k].x, geo.outline[k].y);
			ctx.closePath();
		};

		ctx.fillStyle = 'rgba(93, 176, 255, 0.06)';
		if (geo.outline) {
			outlinePath();
			ctx.fill();
		} else {
			ctx.fillRect(left, top, w, h);
		}

		ctx.lineWidth = 1;
		ctx.strokeStyle = 'rgba(93, 176, 255, 0.45)';
		// The cell box comes off the SEAT (`w`/`h`), never off `geo.cellW`/`cellH` — under perspective
		// a back-row cell is smaller than a front-row one, and the seat is where that lives.
		for (const seat of geo.seats) ctx.strokeRect(seat.x, seat.y, seat.w, seat.h);

		// Real symbol art per cell: the static binding drawn CENTRED on the seat, CLIPPED to the
		// board window, and CONTAIN-fit to the cell by its own art (no size param — matches the
		// engine's `Sprite`/`Spine` `contain`). The static list is cycled across cells so the
		// board looks populated. A SPINE static is drawn by the WebGL spine layer (which reads the
		// same geometry), so this path only marks the ones it can't render yet; a FLIPBOOK static
		// plays here off its clip doc; an unresolved frame falls back to the amber marker square.
		const statics = symbolStatics;
		const drawMarker = (cx: number, cy: number, cw: number, ch: number, label?: string): void => {
			const sym = Math.min(cw, ch);
			ctx.fillStyle = 'rgba(255, 196, 93, 0.10)';
			ctx.strokeStyle = 'rgba(255, 196, 93, 0.7)';
			ctx.fillRect(cx - sym / 2, cy - sym / 2, sym, sym);
			ctx.strokeRect(cx - sym / 2, cy - sym / 2, sym, sym);
			if (label) {
				ctx.fillStyle = 'rgba(255, 196, 93, 0.85)';
				ctx.font = '10px sans-serif';
				ctx.fillText(label, cx - sym / 2 + 4, cy - sym / 2 + 12);
			}
		};
		for (const seat of geo.seats) {
			const { cx, cy } = seat;
			// This CELL's box — its own size under perspective, `cellW`/`cellH` while flat.
			const cellW = seat.w;
			const cellH = seat.h;
			const cell = statics.length
				? statics[(seat.j * geo.reels + seat.i) % statics.length]
				: undefined;
			if (!cell) {
				drawMarker(cx, cy, cellW, cellH);
				continue;
			}
			if (cell.type === 'spine') {
				// The spine overlay renders this cell's real skeleton once the bundle is ready
				// (it reports the key via `readySpineKeys`) — until then the amber marker stands in,
				// exactly like a spine NODE's placeholder.
				if (!readySpineKeys.has(cell.assetKey)) drawMarker(cx, cy, cellW, cellH, 'spine');
				continue;
			}
			// A FLIPBOOK cell resolves through the clip doc, never through its own `assetKey` (which
			// holds the clip's primary SHEET, not a frame). Same `clipFrameIndexAt(clipClockMs)` a
			// placed `flipbook` node uses, so a symbol animates on the board preview in step with
			// every other clip on screen. A dangling / still-loading clip keeps the marker and
			// self-heals on the repaint `loadClips` forces.
			const clipFrame =
				cell.type === 'flipbook'
					? flipbookFrame(cell.clipId ?? '', { fps: cell.fps, direction: cell.direction })
					: null;
			if (cell.type === 'flipbook' && !clipFrame) {
				drawMarker(cx, cy, cellW, cellH, 'clip');
				continue;
			}
			// A SPRITE cell's `assetKey` is the frame NAME (the symbols doc binds regions by name),
			// which is why both arguments are the same key on that path.
			const artKey = clipFrame?.assetKey ?? cell.assetKey;
			const artRegion = clipFrame?.region ?? cell.assetKey;
			const found = findRegion(artKey, artRegion);
			if (!found) {
				drawMarker(cx, cy, cellW, cellH);
				continue;
			}
			// Symbol size comes from the ART, not a size param: CONTAIN-fit the region into
			// the cell (single uniform scale, native aspect preserved), matching the game's
			// `Sprite`/`Spine` `contain`. `sizeRatios` (per-cell or the reel global) was removed
			// from the result (owner direction), so it no longer affects the size here.
			let drawW = cellW;
			let drawH = cellH;
			const nat = regionNaturalSize(found.region);
			if (nat.w > 0 && nat.h > 0) {
				const s = Math.min(cellW / nat.w, cellH / nat.h);
				drawW = nat.w * s;
				drawH = nat.h * s;
			}
			// `drawArtRegionSprite` places the frame with its top-left at the origin offset by
			// `-dw * anchor` — anchor {0.5,0.5} centres it on the origin, so translate to the
			// symbol seat (cx, cy). Clip to the whole reel WINDOW (not the single cell) — the
			// game masks the board window, not each cell, so a lead/align-offset symbol crops
			// at the window edge here exactly as it does live.
			ctx.save();
			ctx.beginPath();
			const clip = geo.clip;
			if (clip) ctx.rect(clip.x, clip.y, clip.w, clip.h);
			else ctx.rect(left, top, w, h);
			ctx.clip();
			ctx.translate(cx, cy);
			const symTransform: import('engine-layout').ResolvedTransform = {
				x: 0,
				y: 0,
				anchor: { x: 0.5, y: 0.5 },
				width: drawW,
				height: drawH,
				visible: true,
			};
			// Mirroring is the cell's override else the clip's own — a sprite cell has neither, so
			// `flipbookMirror` returns the identity pair and that path draws exactly as before.
			// Mirroring through the SAME precedence a placed node uses (binding's override, else
			// the clip's own). A sprite cell has neither a clip nor a flag, so it resolves to the
			// identity pair and that path draws exactly as before.
			drawArtRegionSprite(
				ctx,
				artKey,
				artRegion,
				symTransform,
				undefined,
				undefined,
				flipbookMirror(cell),
			);
			ctx.restore();
		}

		ctx.lineWidth = 2;
		ctx.strokeStyle = '#5db0ff';
		if (geo.outline) {
			outlinePath();
			ctx.stroke();
		} else {
			ctx.strokeRect(left, top, w, h);
		}
	}

	/**
	 * Draw a `componentInstance` by EXPANDING its `ComponentDef.root` children under
	 * the (already-applied) instance transform — the editor's own static render of the
	 * prefab, mirroring how `<LayoutScene>` expands it in-engine. The editor canvas
	 * resolves the def from the loaded `componentMap` (NOT the engine registry). Guards:
	 * a missing def or a depth/cycle breach draws a labelled placeholder instead.
	 */
	function drawComponentInstance(
		ctx: CanvasRenderingContext2D,
		node: Extract<LayoutNode, { kind: 'componentInstance' }>,
		sceneCtx: Scene,
		componentDepth: number,
		componentStack: string[],
	): void {
		const def = componentMap.get(node.componentId);
		if (!def) {
			drawPlaceholder(ctx, 0.5, 0.5, '#4a3a5a', `◇ ${node.label ?? node.componentId}`);
			return;
		}
		if (componentDepth >= MAX_COMPONENT_DEPTH || componentStack.includes(def.id)) {
			drawPlaceholder(ctx, 0.5, 0.5, '#3a3a46', `◇ ${def.name}`);
			return;
		}
		const stack = [...componentStack, def.id];
		// Resolve THIS instance's effective params (def defaults ◁ instance overrides) and
		// thread them into the expanded children so a mounted `bind` chip shows the
		// instance's `label`/`fill`/`fontSize` (e.g. "BALANCE"), not the def's component
		// name. No per-project defaults here: the SCENE editor resolves each instance from
		// def defaults + node.params (the `componentParams` prop is the Component Editor's
		// open-component preview, a different concern), so pass `undefined`.
		// Per-ratio param overrides (`node.overrides[layoutType].params`) merged onto the base
		// instance params for the active device layout, so the canvas previews e.g. a smaller
		// portrait font exactly as the game will resolve it. No override ⇒ `node.params` verbatim.
		const params = resolveComponentParams(
			def,
			resolveLayoutInstanceParams(node, layoutType),
			undefined,
		);
		// A nested bound-component that previews a SPINE (the win / free-spin VISUAL) renders the
		// instance's AUTHORED rig (its first `spine`-kind param value, else the catalog bundle), so
		// the real art shows here + its readiness key matches the rig the WebGL layer draws.
		const spineBundle = instancePreviewSpineBundle(def, params);
		for (const child of def.root.children) {
			drawNode(ctx, child, sceneCtx, componentDepth + 1, stack, params, true, spineBundle);
		}
	}

	function drawRegionSprite(
		ctx: CanvasRenderingContext2D,
		node: Extract<LayoutNode, { kind: 'sprite' }>,
		t: import('engine-layout').ResolvedTransform,
		/** Effective region/assetKey from param-bindings (§13.4) — fall back to the
		 * node's own when a field isn't bound, so an unbound sprite renders identically
		 * (parity). `tint` multiplies the drawn frame (absent / 0xffffff = no-op). */
		regionOverride?: string,
		assetKeyOverride?: string,
		tint?: number,
	): void {
		drawArtRegionSprite(
			ctx,
			assetKeyOverride ?? node.assetKey,
			regionOverride ?? node.region ?? '',
			t,
			node.label,
			tint,
		);
	}

	/** Core atlas-region draw, shared by region sprite NODES and `preview.art` sprite
	 * anchors. `assetKey` = manifest/atlas key, `region` = packed frame; honours the
	 * resolved transform's anchor + explicit width/height (else the region's native
	 * size). Falls back to a placeholder until the page image + rect resolve. `tint`
	 * multiplies the drawn frame (absent / 0xffffff = untinted — parity). */
	function drawArtRegionSprite(
		ctx: CanvasRenderingContext2D,
		assetKey: string,
		regionName: string,
		t: import('engine-layout').ResolvedTransform,
		label?: string,
		tint?: number,
		mirror?: { x: boolean; y: boolean },
		box?: { origW: number; origH: number; offX: number; offY: number } | null,
	): void {
		const found = regionName ? findRegion(assetKey, regionName) : null;
		const ax = t.anchor?.x ?? 0;
		const ay = t.anchor?.y ?? 0;
		if (!found || !found.set.pageKey) {
			drawPlaceholder(ctx, ax || 0.5, ay || 0.5, '#3a4a5a', label ?? (regionName || '…'));
			return;
		}
		const img = ensureImage(found.set.pageKey);
		const { region } = found;
		// A region's OWN authored box applies to every draw of it, unless the caller passed one (a
		// clip's box, which is about that clip rather than about the art). Looked up against the
		// RESOLVED sheet (`found.set.assetKey`), never the requested key: `findRegion` falls back to
		// a cross-atlas search by name, and a box scoped to the sheet the frame actually came from is
		// the only one that can be right.
		box = box ?? artBoxGeometry(found.set.assetKey, region.name, region);
		// A `box` REPLACES the region's own declared size + trim offset (an Invisible Flipbook clip's
		// bounds, already re-based onto the frame by `clipFrameBox`; or the region's own). Everything
		// below is unchanged: a box IS a declared size and a trim offset, which is exactly what the
		// region path already speaks — the same reason the runtime applies a box by re-stating
		// `orig`/`trim`.
		const nat = box ? { w: box.origW, h: box.origH } : regionNaturalSize(region);
		// Destination box: respect explicit width/height, else the region's native size.
		const dw = t.width ?? nat.w;
		const dh = t.height ?? nat.h;
		if (!img || !img.complete || img.naturalWidth === 0) {
			drawPlaceholder(ctx, ax || 0.5, ay || 0.5, '#3a4a5a', label ?? region.name);
			return;
		}
		// All destination geometry is in UPRIGHT space: `w/h` are the unrotated
		// trimmed size, `offX/offY` the trim offset inside the original
		// `origW/origH`. The trimmed content occupies (cw × ch) at (cx, cy).
		const scaleX = dw / nat.w;
		const scaleY = dh / nat.h;
		const cw = region.w * scaleX;
		const ch = region.h * scaleY;
		const cx = -dw * ax + (box ? box.offX : (region.offX ?? 0)) * scaleX;
		const cy = -dh * ay + (box ? box.offY : (region.offY ?? 0)) * scaleY;
		// On-page packed rect: a `rotated` frame is stored (h × w) — swap.
		const pw = region.rotated ? region.h : region.w;
		const ph = region.rotated ? region.w : region.h;
		// Mirroring wraps the DRAW only, never the placeholders above: a flipped label is unreadable,
		// and a still-loading page is not the moment to show one. The origin here IS the anchor
		// point (`cx` is already `-dw * ax`), so scaling by −1 mirrors about the same point PIXI's
		// negative `scale` does — which is what makes the canvas and the game agree. Applied
		// BEFORE the rotated branch's own transform on purpose: mirroring the composed result is
		// the mirror of the drawn frame, whichever way it was packed.
		const mirrored = mirror ? mirror.x || mirror.y : false;
		if (mirrored) {
			ctx.save();
			ctx.scale(mirror?.x ? -1 : 1, mirror?.y ? -1 : 1);
		}
		if (region.rotated) {
			// Page pixels are packed rotated; restore upright to MATCH THE GAME.
			// The page is packed with PIL rotate(-90) (atlas-tool fit_to_region), so the
			// un-rotation is +90 = counter-clockwise (verified empirically: cropping the
			// real page rect and applying PIL rotate(+90) renders upright). Canvas is
			// y-down, so CCW = rotate(-π/2) with translate(cx, cy + ch): under -π/2 the
			// local (ch × cw) dest box lands upright at screen (cx, cy) size (cw × ch),
			// no mirror (rotation det = +1).
			ctx.save();
			ctx.translate(cx, cy + ch);
			ctx.rotate(-Math.PI / 2);
			drawTintedImage(ctx, img, region.x, region.y, pw, ph, 0, 0, ch, cw, tint);
			ctx.restore();
		} else {
			drawTintedImage(ctx, img, region.x, region.y, pw, ph, cx, cy, cw, ch, tint);
		}
		if (mirrored) ctx.restore();
	}

	/** Scratch canvas reused for tinted sprite draws (avoids per-frame allocation). */
	let tintScratch: HTMLCanvasElement | null = null;

	/**
	 * Draw a sprite (or atlas frame, via the source rect) with an optional `tint`
	 * multiply that respects the sprite's own alpha — the 2D-canvas equivalent of
	 * PixiJS's `Sprite.tint`. Untinted (absent / 0xffffff) ⇒ a plain `ctx.drawImage`,
	 * byte-identical to the prior draw (parity).
	 *
	 * Tint path: composite on an offscreen canvas sized to the DEST box so the main
	 * canvas (and any active rotation/transform) is never polluted — draw the image,
	 * `multiply` a solid tint over it, then `destination-in` the image again as the
	 * alpha mask (so transparent pixels stay transparent), and blit the result back.
	 */
	function drawTintedImage(
		ctx: CanvasRenderingContext2D,
		img: CanvasImageSource,
		sx: number,
		sy: number,
		sw: number,
		sh: number,
		dx: number,
		dy: number,
		dw: number,
		dh: number,
		tint?: number,
	): void {
		if (tint === undefined || tint === 0xffffff) {
			ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
			return;
		}
		const iw = Math.max(1, Math.round(dw));
		const ih = Math.max(1, Math.round(dh));
		if (!tintScratch) tintScratch = document.createElement('canvas');
		const off = tintScratch;
		off.width = iw;
		off.height = ih;
		const octx = off.getContext('2d');
		if (!octx) {
			ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
			return;
		}
		octx.clearRect(0, 0, iw, ih);
		octx.drawImage(img, sx, sy, sw, sh, 0, 0, iw, ih);
		octx.globalCompositeOperation = 'multiply';
		octx.fillStyle = cssColor(tint);
		octx.fillRect(0, 0, iw, ih);
		octx.globalCompositeOperation = 'destination-in';
		octx.drawImage(img, sx, sy, sw, sh, 0, 0, iw, ih);
		ctx.drawImage(off, dx, dy, dw, dh);
	}

	/** Faithful 2D preview of a HUD `bind` element (the real component is a shape +
	 * text, so this is close to what the game renders): buttons = dark rounded
	 * square + centered icon label; labels = ticker + label + value; logo/name =
	 * text. Drawn in the node's already-scaled space (drawNode applied scale).
	 *
	 * Reflects the editor-authored `bind.props` params so an edit shows here without
	 * a republish: a button's `tint` colours the chip; a label's `style.fill`
	 * colours its caption + value. `style.fontSize` scales the chip text. Absent =
	 * the neutral defaults. */
	function drawHudChip(
		ctx: CanvasRenderingContext2D,
		t: ResolvedTransform,
		preview: NonNullable<LayoutNode['preview']>,
		label: string,
		props?: Record<string, unknown>,
		/** Resolved-param styling for a componentInstance mount (§14.3): the instance's
		 * `fill`/`fontSize`/`fontFamily` params, used INSTEAD of `props.style` so the chip
		 * colours/sizes/font match the placed readout. Absent ⇒ the `props.style` path (parity). */
		paramStyle?: { fill?: number; fontSize?: number; fontFamily?: string },
	): void {
		const ax = t.anchor?.x ?? 0.5;
		const ay = t.anchor?.y ?? 0.5;
		const w = preview.w ?? 160;
		const h = preview.h ?? 100;
		const x = -w * ax;
		const y = -h * ay;
		const style =
			paramStyle ??
			((props?.style ?? {}) as { fill?: number; fontSize?: number; fontFamily?: string });
		const tint = typeof props?.tint === 'number' ? props.tint : undefined;
		const fill = typeof style.fill === 'number' ? cssColor(style.fill) : undefined;
		// `tile`: just the ticker background — a DECOMPOSED readout's caption + value
		// are sibling `text` parts, so this draws no text (avoids the legacy all-in-one
		// chip's caption + hardcoded `0.00` colliding with the real parts).
		if (preview.style === 'tile') {
			// Honour the editor-set `borderRadius` / `tint` (the `HudTicker` params) so an
			// edit shows live; fall back to a neutral rounded tile when unset.
			const radius =
				typeof props?.borderRadius === 'number' ? props.borderRadius : Math.min(26, h / 2);
			const r = Math.max(0, Math.min(radius, w / 2, h / 2));
			ctx.beginPath();
			ctx.roundRect(x, y, w, h, r);
			ctx.fillStyle = tint !== undefined ? cssColor(tint) : 'rgba(8,8,10,0.92)';
			ctx.fill();
			// Authored outline (borderWidth/borderColor); when none is set, draw a faint
			// 1px placeholder edge so the tile reads on the dark canvas (not a real border).
			const bw = typeof props?.borderWidth === 'number' ? props.borderWidth : 0;
			if (bw > 0) {
				ctx.lineWidth = bw;
				ctx.strokeStyle =
					typeof props?.borderColor === 'number' ? cssColor(props.borderColor) : '#ffffff';
			} else {
				ctx.lineWidth = 1;
				ctx.strokeStyle = '#3a3a46';
			}
			ctx.stroke();
			return;
		}
		const isText = preview.style === 'text';
		if (!isText) {
			// Honour the editor-set `borderRadius` / `borderColor` / `borderWidth` (the
			// shared tile params, e.g. on the button Frame) so an edit shows live; fall
			// back to the chip default radius + faint edge when unset.
			const defaultR = preview.style === 'button' ? 36 : 26;
			const radius = typeof props?.borderRadius === 'number' ? props.borderRadius : defaultR;
			const r = Math.max(0, Math.min(radius, w / 2, h / 2));
			ctx.beginPath();
			ctx.roundRect(x, y, w, h, r);
			// A button tint multiplies the themed art in-game; here it colours the chip.
			ctx.fillStyle = tint !== undefined ? cssColor(tint) : 'rgba(8,8,10,0.92)';
			ctx.fill();
			const bw = typeof props?.borderWidth === 'number' ? props.borderWidth : 0;
			if (bw > 0) {
				ctx.lineWidth = bw;
				ctx.strokeStyle =
					typeof props?.borderColor === 'number' ? cssColor(props.borderColor) : '#ffffff';
			} else {
				ctx.lineWidth = 2;
				ctx.strokeStyle = '#3a3a46';
			}
			ctx.stroke();
		}
		ctx.save();
		ctx.textAlign = 'center';
		if (preview.style === 'label') {
			ctx.textBaseline = 'top';
			const size = typeof style.fontSize === 'number' ? Math.max(8, style.fontSize) : 30;
			ctx.font = `600 ${size}px sans-serif`;
			ctx.fillStyle = fill ?? '#e8e8ee';
			ctx.fillText(label, x + w / 2, y + 14);
			ctx.fillStyle = fill ?? '#7ee0c0';
			ctx.fillText('0.00', x + w / 2, y + 14 + size + 8);
		} else if (preview.style === 'button') {
			ctx.textBaseline = 'middle';
			ctx.font = '600 28px sans-serif';
			ctx.fillStyle = '#e8e8ee';
			ctx.fillText(label, x + w / 2, y + h / 2);
		} else {
			// Decomposed readout caption/value (the coded HudCaption/HudValue parts).
			// Match the GAME render so the editor preview is WYSIWYG: the coded parts are
			// `<CatalogText anchor={transform.anchor}>` in the resolved `fontFamily`
			// (proxima-nova by default) at the resolved `fontSize` (UiLabel base 45), normal
			// weight. HONOUR THE NODE ANCHOR: pixi's Text anchor.x 0=left / 0.5=centre / 1=right
			// (anchor.y offsets the baseline the same way) — so re-anchoring the Caption/Value
			// node to left-align its text previews EXACTLY as it renders in-game. We draw
			// left-aligned + shift by the measured size × anchor, which is correct for any
			// fractional anchor (not just 0/0.5/1). The old hardcoded `textAlign:'center'` at
			// the origin ignored the anchor entirely — the editor↔game mismatch.
			const size = typeof style.fontSize === 'number' ? Math.max(8, style.fontSize) : 45;
			const family = style.fontFamily ?? 'proxima-nova';
			ctx.font = `${size}px ${family}, sans-serif`;
			ctx.fillStyle = fill ?? '#ffffff';
			ctx.textAlign = 'left';
			ctx.textBaseline = 'top';
			const textWidth = ctx.measureText(label).width;
			ctx.fillText(label, -textWidth * ax, -size * ay);
		}
		ctx.restore();
	}

	/** A doc colour number (e.g. `0xff0000`) → a CSS hex string for the 2D canvas. */
	function cssColor(n: number): string {
		return `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;
	}

	function drawPlaceholder(
		ctx: CanvasRenderingContext2D,
		ax: number,
		ay: number,
		fill: string,
		label: string,
	): void {
		const w = 160;
		const h = 100;
		ctx.fillStyle = fill;
		ctx.fillRect(-w * ax, -h * ay, w, h);
		ctx.fillStyle = '#e8e8ee';
		ctx.font = '14px sans-serif';
		ctx.fillText(label, -w * ax + 8, -h * ay + 20);
	}

	// ---------- bone-ridden stand-in symbol overlay draw ----------

	/** rAF loop (runs continuously — cheap when idle): read the spine layers' published rider
	 * transforms + draw each stand-in symbol on `riderCanvas`, in the SAME world→screen mapping
	 * as everything else (`setTransform(dpr) · pan · zoom`). Self-sizes the canvas so it overlays
	 * the base 1:1. When the map is empty it clears + early-outs, so it must NOT be gated on a
	 * scene scan (a stale `$derived` gate once left the whole overlay dormant). */
	function drawRiders(): void {
		riderRaf = requestAnimationFrame(drawRiders);
		const c = riderCanvas;
		if (!c) return;
		const ctx = c.getContext('2d');
		if (!ctx) return;
		const dpr = window.devicePixelRatio || 1;
		const w = Math.floor((wrap?.clientWidth ?? 0) * dpr);
		const h = Math.floor((wrap?.clientHeight ?? 0) * dpr);
		if (c.width !== w || c.height !== h) {
			c.width = w;
			c.height = h;
		}
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, c.width, c.height);
		if (boneRiders.size === 0) return;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.translate(panX, panY);
		ctx.scale(zoom, zoom);
		const base = SYMBOL_PREVIEW_MAIN * mainScale();
		for (const [, r] of boneRiders) drawRiderSymbol(ctx, r, base);
	}

	/** Draw one stand-in symbol at its published world transform: the real preview atlas region
	 * when set + resolvable, else a labelled symbol-sized box. `base` is the symbol size in world
	 * px; the published `scaleX`/`scaleY` (symbolScale × the bone's world scale) size the box. */
	function drawRiderSymbol(
		ctx: CanvasRenderingContext2D,
		r: BoneRiderTransform,
		base: number,
	): void {
		ctx.save();
		ctx.translate(r.x, r.y);
		if (r.rotation) ctx.rotate(r.rotation);
		const w = Math.max(4, base * Math.abs(r.scaleX));
		const h = Math.max(4, base * Math.abs(r.scaleY));
		let drew = false;
		if (r.region) drew = drawRiderRegion(ctx, r.region, w, h);
		if (!drew) {
			ctx.fillStyle = 'rgba(90,74,58,0.82)';
			ctx.fillRect(-w / 2, -h / 2, w, h);
			ctx.lineWidth = 2 / zoom;
			ctx.strokeStyle = '#e0b070';
			ctx.strokeRect(-w / 2, -h / 2, w, h);
			ctx.fillStyle = '#f4e6cf';
			ctx.font = '13px sans-serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText('symbol', 0, 0);
			ctx.textAlign = 'left';
			ctx.textBaseline = 'alphabetic';
		}
		ctx.restore();
	}

	/** Draw the `previewImage` atlas region centred in a `w×h` box (already translated/rotated by
	 * the caller). Returns false (→ labelled box) when the ref is unset or not yet resolvable. */
	function drawRiderRegion(
		ctx: CanvasRenderingContext2D,
		ref: string,
		w: number,
		h: number,
	): boolean {
		const scoped = parseScopedFrameRef(ref);
		const region = scoped.region;
		if (!region) return false;
		const assetKey = scoped.assetKey ?? '';
		const found = findRegion(assetKey, region);
		if (!found || !found.set.pageKey) return false;
		const t: ResolvedTransform = {
			x: 0,
			y: 0,
			anchor: { x: 0.5, y: 0.5 },
			width: w,
			height: h,
			visible: true,
		};
		drawArtRegionSprite(ctx, assetKey, region, t, 'symbol');
		return true;
	}

	// Start the rider overlay's rAF once, unconditionally. It's cheap when no rider is published
	// (clear + early-out), and gating it on a scene scan proved fragile — a stale `$derived`
	// left the loop un-started so the stand-in never drew even though the spine layers were
	// publishing bone transforms. The loop is torn down with the rest on unmount (onMount return).
	$effect(() => {
		if (!riderRaf) riderRaf = requestAnimationFrame(drawRiders);
	});

	function drawSelectionOverlay(ctx: CanvasRenderingContext2D): void {
		if (selectedIds.length === 0) return;
		// Handles (scale/rotate) only make sense for a single node; a multi-selection
		// gets outline-only on every member (it can still be group-translated).
		const single = selectedIds.length === 1;
		for (const id of selectedIds) {
			const node = findNodeById(id);
			if (node) drawNodeSelection(ctx, node, single);
		}
	}

	function drawNodeSelection(
		ctx: CanvasRenderingContext2D,
		node: LayoutNode,
		withHandles: boolean,
	): void {
		const t = nodeTransform(node);
		if (!t.visible) return;
		const box = boxOf(node, t);
		const corners = nodeCornersWorld(t, box).map(worldToScreen);
		const top = worldToScreen(topMidWorld(t, box));

		// Locked: outline only (amber), no transform handles.
		if (node.locked) {
			ctx.lineWidth = 1.5;
			ctx.strokeStyle = '#f0c878';
			ctx.setLineDash([5, 4]);
			ctx.beginPath();
			ctx.moveTo(corners[0].x, corners[0].y);
			for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
			ctx.closePath();
			ctx.stroke();
			ctx.setLineDash([]);
			return;
		}

		const accent = '#5db0ff';
		// A text node with an explicit BOX (`width`): tint its area so the author sees the box they
		// resize (the glyphs may not fill it), and dashes distinguish "layout box" from a solid node.
		const isTextBox = node.kind === 'text' && (t.width ?? node.width ?? 0) > 0;
		if (isTextBox) {
			ctx.fillStyle = 'rgba(93, 176, 255, 0.10)';
			ctx.beginPath();
			ctx.moveTo(corners[0].x, corners[0].y);
			for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
			ctx.closePath();
			ctx.fill();
		}
		ctx.lineWidth = 1.5;
		ctx.strokeStyle = accent;
		if (isTextBox) ctx.setLineDash([6, 3]);
		ctx.beginPath();
		ctx.moveTo(corners[0].x, corners[0].y);
		for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
		ctx.closePath();
		ctx.stroke();
		ctx.setLineDash([]);

		// Outline-only for a multi-selection — no transform handles.
		if (!withHandles) return;

		// Rotation handle stem.
		const rot = t.rotation ?? 0;
		const stem = {
			x: top.x + Math.sin(rot) * ROTATE_OFFSET_PX,
			y: top.y - Math.cos(rot) * ROTATE_OFFSET_PX,
		};
		ctx.beginPath();
		ctx.moveTo(top.x, top.y);
		ctx.lineTo(stem.x, stem.y);
		ctx.stroke();

		// Edge-midpoint squares FIRST (drawn under the corners so a corner always wins the overlap).
		// They resize ONE axis, which is what a text box usually needs (its width) and makes the box
		// grabbable without hunting the small corners. `mid` averages the two adjacent screen corners
		// so it follows rotation for free.
		const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
		const edges = [
			mid(corners[0], corners[1]),
			mid(corners[1], corners[2]),
			mid(corners[2], corners[3]),
			mid(corners[3], corners[0]),
		];
		ctx.fillStyle = '#0b0b10';
		ctx.strokeStyle = accent;
		ctx.lineWidth = 1.5;
		for (const e of edges) {
			ctx.fillRect(
				e.x - EDGE_HANDLE_PX / 2,
				e.y - EDGE_HANDLE_PX / 2,
				EDGE_HANDLE_PX,
				EDGE_HANDLE_PX,
			);
			ctx.strokeRect(
				e.x - EDGE_HANDLE_PX / 2,
				e.y - EDGE_HANDLE_PX / 2,
				EDGE_HANDLE_PX,
				EDGE_HANDLE_PX,
			);
		}
		// Corner squares.
		ctx.fillStyle = accent;
		ctx.strokeStyle = '#0b0b10';
		ctx.lineWidth = 1;
		for (const c of corners) {
			ctx.fillRect(c.x - HANDLE_PX / 2, c.y - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX);
			ctx.strokeRect(c.x - HANDLE_PX / 2, c.y - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX);
		}
		// Rotation circle.
		ctx.beginPath();
		ctx.arc(stem.x, stem.y, ROTATE_PX, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
	}

	// ---------- hit-test ----------

	function hitTestHandle(screen: Vec2): HandleHit | null {
		if (selectedIds.length !== 1 || !selectedId) return null;
		const node = findNodeById(selectedId);
		if (!node || node.locked || isBackgroundCover(node)) return null;
		const t = nodeTransform(node);
		if (!t.visible) return null;
		const box = boxOf(node, t);
		const corners = nodeCornersWorld(t, box).map(worldToScreen);
		const top = worldToScreen(topMidWorld(t, box));
		const rot = t.rotation ?? 0;
		const stem = {
			x: top.x + Math.sin(rot) * ROTATE_OFFSET_PX,
			y: top.y - Math.cos(rot) * ROTATE_OFFSET_PX,
		};
		const rGrab = ROTATE_PX + 4;
		if (Math.hypot(screen.x - stem.x, screen.y - stem.y) <= rGrab) return { kind: 'rotate' };
		const grab = HANDLE_PX / 2 + 4;
		for (let i = 0; i < 4; i++) {
			const c = corners[i];
			if (Math.abs(screen.x - c.x) <= grab && Math.abs(screen.y - c.y) <= grab) {
				return { kind: 'corner', idx: i };
			}
		}
		// Edge-midpoint handles (single-axis resize). Checked AFTER corners so a corner still wins the
		// overlap, and BEFORE the body so grabbing an edge resizes instead of moving the node.
		const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
		const edges = [
			mid(corners[0], corners[1]),
			mid(corners[1], corners[2]),
			mid(corners[2], corners[3]),
			mid(corners[3], corners[0]),
		];
		const eGrab = EDGE_HANDLE_PX / 2 + 4;
		for (let i = 0; i < 4; i++) {
			const e = edges[i];
			if (Math.abs(screen.x - e.x) <= eGrab && Math.abs(screen.y - e.y) <= eGrab) {
				return { kind: 'edge', idx: i };
			}
		}
		// Body hit on selected node (in world space).
		const world = clientFromScreen(screen);
		if (pointInQuad(world, nodeCornersWorld(t, box))) return { kind: 'body' };
		return null;
	}

	function clientFromScreen(p: Vec2): Vec2 {
		return { x: (p.x - panX) / zoom, y: (p.y - panY) / zoom };
	}

	function hitTestNode(world: Vec2): LayoutNode | null {
		const list = visibleSceneNodes();
		for (let i = list.length - 1; i >= 0; i--) {
			const node = list[i];
			const t = nodeTransform(node);
			const box = boxOf(node, t);
			const corners = nodeCornersWorld(t, box);
			if (pointInQuad(world, corners)) return node;
		}
		return null;
	}

	// ---------- drag handlers ----------

	function startTranslate(node: LayoutNode, world: Vec2): void {
		const start = effectiveXY(node);
		// The group is every selected node that can actually move (locked + background-
		// cover nodes stay put). `node` (the grabbed one) is always included.
		const movableIds = selectedIds.includes(node.id) ? selectedIds : [node.id];
		const group: { id: string; sx: number; sy: number }[] = [];
		for (const id of movableIds) {
			const n = findNodeById(id);
			if (!n || n.locked || isBackgroundCover(n)) continue;
			const xy = effectiveXY(n);
			group.push({ id, sx: xy.x, sy: xy.y });
		}
		dragMode = {
			kind: 'translate',
			nodeId: node.id,
			startWorld: world,
			startNode: start,
			group,
		};
	}
	/** Edge idx (top/right/bottom/left) → the reference CORNER its resize pivots from, and which
	 * single axis it changes. Reuses the corner-scale math with the other axis locked. */
	const EDGE_TO_CORNER = [0, 1, 2, 3] as const;
	const EDGE_TO_AXIS = ['y', 'x', 'y', 'x'] as const;

	function startScale(
		node: LayoutNode,
		cornerIdx: number,
		world: Vec2,
		resizeAxis?: 'x' | 'y',
	): void {
		const t = nodeTransform(node);
		const box = boxOf(node, t);
		dragMode = {
			kind: 'scale',
			nodeId: node.id,
			cornerIdx,
			resizeAxis,
			startWorld: world,
			startScale: { x: t.scale?.x ?? 1, y: t.scale?.y ?? 1 },
			startBox: box,
			startTx: t.x,
			startTy: t.y,
			startRot: t.rotation ?? 0,
		};
	}
	function startRotate(node: LayoutNode, world: Vec2): void {
		const t = nodeTransform(node);
		const center = { x: t.x, y: t.y };
		const startAngle = Math.atan2(world.y - center.y, world.x - center.x);
		dragMode = {
			kind: 'rotate',
			nodeId: node.id,
			startAngle,
			startRot: t.rotation ?? 0,
			center,
		};
	}

	function applyTranslate(node: LayoutNode, world: Vec2, shift: boolean): void {
		if (!dragMode || dragMode.kind !== 'translate') return;
		let dx = world.x - dragMode.startWorld.x;
		let dy = world.y - dragMode.startWorld.y;
		if (shift) {
			if (Math.abs(dx) > Math.abs(dy)) dy = 0;
			else dx = 0;
		}
		// Snap the grabbed (primary) node, then move the whole group by the SAME snapped
		// delta so their relative layout is preserved.
		const snapped = snapTranslate(node, dragMode.startNode.x + dx, dragMode.startNode.y + dy);
		const ddx = snapped.x - dragMode.startNode.x;
		const ddy = snapped.y - dragMode.startNode.y;
		for (const g of dragMode.group) {
			const n = findNodeById(g.id);
			if (n) writeXY(n, g.sx + ddx, g.sy + ddy);
		}
	}

	function applyScale(node: LayoutNode, world: Vec2, shift: boolean): void {
		if (!dragMode || dragMode.kind !== 'scale') return;
		const d = dragMode;
		const cos = Math.cos(d.startRot);
		const sin = Math.sin(d.startRot);
		// Convert pointer delta (world) into the node's local pre-scale frame.
		const dxw = world.x - d.startWorld.x;
		const dyw = world.y - d.startWorld.y;
		const dxl = dxw * cos + dyw * sin;
		const dyl = -dxw * sin + dyw * cos;
		// Initial local corner offsets (signed) used to scale proportionally.
		const left = -d.startBox.w * d.startBox.ax;
		const top = -d.startBox.h * d.startBox.ay;
		const right = left + d.startBox.w;
		const bottom = top + d.startBox.h;
		const cornerLocal: [Vec2, Vec2, Vec2, Vec2] = [
			{ x: left, y: top },
			{ x: right, y: top },
			{ x: right, y: bottom },
			{ x: left, y: bottom },
		];
		const ref = cornerLocal[d.cornerIdx];
		// Base (start) signed magnitudes; avoid div-by-zero.
		const baseX = ref.x * d.startScale.x;
		const baseY = ref.y * d.startScale.y;
		const newRefX = baseX + dxl;
		const newRefY = baseY + dyl;
		let sxRatio = baseX === 0 ? 1 : newRefX / baseX;
		let syRatio = baseY === 0 ? 1 : newRefY / baseY;
		// An EDGE handle resizes ONE axis — lock the other to its start size (ratio 1). A CORNER
		// handle defaults to uniform scale (average of the two abs ratios, signed); Shift makes it
		// non-uniform (free per-axis).
		if (d.resizeAxis === 'x') {
			syRatio = 1;
		} else if (d.resizeAxis === 'y') {
			sxRatio = 1;
		} else if (!shift) {
			const avg = (Math.abs(sxRatio) + Math.abs(syRatio)) / 2;
			sxRatio = Math.sign(sxRatio || 1) * avg;
			syRatio = Math.sign(syRatio || 1) * avg;
		}
		// A TEXT node resizes its BOX (`width`/`height`), never `scale` — so the glyphs
		// re-align/re-wrap inside instead of stretching (a bitmap font would pixelate). The
		// drag ratios scale the START box (its explicit dims, or the measured glyph extent on
		// the first drag) into a concrete box the node then owns. Font size is unchanged;
		// `autoFit` shrinks it to the new box at render time.
		if (node.kind === 'text') {
			const MIN_PX = 8;
			const newW = Math.max(MIN_PX, d.startBox.w * Math.abs(sxRatio));
			const newH = Math.max(MIN_PX, d.startBox.h * Math.abs(syRatio));
			writeSize(node, newW, newH);
			return;
		}
		// A Text Box COMPONENT INSTANCE resizes its BOX (the `boxWidth`/`boxHeight` params on
		// the inner text node), never `scale` — dragging defines the text AREA instead of
		// stretching the glyphs (which pixelates a bitmap font). The current displayed scale is
		// FOLDED into the box and the instance scale reset to 1, so the box is the single size
		// authority and the font renders crisp at its `fontSize` (edit it / auto-fit to fill).
		if (isTextBoxInstance(node)) {
			const MIN_PX = 8;
			const newW = Math.max(MIN_PX, d.startBox.w * Math.abs(d.startScale.x) * Math.abs(sxRatio));
			const newH = Math.max(MIN_PX, d.startBox.h * Math.abs(d.startScale.y) * Math.abs(syRatio));
			setInstanceBox(node, newW, newH);
			writeScale(node, 1, 1);
			return;
		}
		const MIN = 0.05;
		let newSx = d.startScale.x * sxRatio;
		let newSy = d.startScale.y * syRatio;
		if (Math.abs(newSx) < MIN) newSx = Math.sign(newSx || 1) * MIN;
		if (Math.abs(newSy) < MIN) newSy = Math.sign(newSy || 1) * MIN;
		writeScale(node, newSx, newSy);
	}

	/** Write a text node's BOX size (`width`/`height`) — base value when desktop, sparse
	 * per-layoutType override otherwise (mirrors {@link writeScale}). Text boxes live in raw
	 * local px (no `mainScale` division: the box is measured in the node's own local space,
	 * same as a rect's width/height). */
	function writeSize(node: LayoutNode, w: number, h: number): void {
		if (layoutType === baseLayoutType) {
			if (node.kind === 'text' || node.kind === 'rect') {
				node.width = w;
				node.height = h;
			}
		} else {
			const o = getOverride(node);
			o.width = w;
			o.height = h;
		}
	}

	/** A Text Box component instance — its def exposes `boxWidth`/`boxHeight` params bound to an
	 * inner text node's box AND is nothing BUT text. Its resize handles drive those params (see
	 * {@link applyScale}).
	 *
	 * The pure-text test matters because the box params are shared (`TEXT_BOX_LAYOUT_PARAMS`) with
	 * text-bearing components that also draw ART — the Info Bar's plaque sprite, say. Sizing those
	 * by the box would resize the text and SNAP the artwork back to scale 1, so they keep the
	 * normal scale handles and set their box from the properties panel instead. */
	function isTextBoxInstance(node: LayoutNode): boolean {
		if (node.kind !== 'componentInstance') return false;
		const def = componentMap.get(node.componentId);
		if (!def?.params?.some((p) => p.key === 'boxWidth')) return false;
		return isTextOnlyNode(def.root);
	}
	/** True when a component tree draws text and nothing else (containers are pure grouping). */
	function isTextOnlyNode(node: LayoutNode): boolean {
		if (node.kind === 'text') return true;
		if (node.kind === 'container') return node.children.every(isTextOnlyNode);
		return false;
	}
	/** Write a Text Box instance's box dims as per-instance params (round for a clean doc). Params
	 * are not per-layoutType, so this is shared across device layouts (acceptable for a box). */
	function setInstanceBox(node: LayoutNode, w: number, h: number): void {
		if (node.kind !== 'componentInstance') return;
		node.params = { ...(node.params ?? {}), boxWidth: Math.round(w), boxHeight: Math.round(h) };
	}

	function applyRotate(node: LayoutNode, world: Vec2, shift: boolean): void {
		if (!dragMode || dragMode.kind !== 'rotate') return;
		const d = dragMode;
		const ang = Math.atan2(world.y - d.center.y, world.x - d.center.x);
		let rot = d.startRot + (ang - d.startAngle);
		if (shift) {
			const step = (15 * Math.PI) / 180;
			rot = Math.round(rot / step) * step;
		}
		writeRotation(node, rot);
	}

	function snapTranslate(node: LayoutNode, nx: number, ny: number): Vec2 {
		const tol = SNAP_PX / zoom;
		const t = nodeTransform(node);
		const box = boxOf(node, t);
		// Compute candidate moving-node points using nx, ny.
		const moved: typeof t = { ...t, x: nx, y: ny };
		const corners = nodeCornersWorld(moved, box);
		const movingXs = [corners[0].x, corners[1].x, corners[2].x, corners[3].x, nx];
		const movingYs = [corners[0].y, corners[1].y, corners[2].y, corners[3].y, ny];

		const xCandidates: number[] = [0, frameWidth / 2, frameWidth];
		const yCandidates: number[] = [0, frameHeight / 2, frameHeight];
		for (const other of visibleSceneNodes()) {
			if (other.id === node.id) continue;
			const ot = nodeTransform(other);
			const ob = boxOf(other, ot);
			const oc = nodeCornersWorld(ot, ob);
			let minX = Infinity,
				maxX = -Infinity,
				minY = Infinity,
				maxY = -Infinity;
			for (const p of oc) {
				if (p.x < minX) minX = p.x;
				if (p.x > maxX) maxX = p.x;
				if (p.y < minY) minY = p.y;
				if (p.y > maxY) maxY = p.y;
			}
			xCandidates.push(minX, (minX + maxX) / 2, maxX);
			yCandidates.push(minY, (minY + maxY) / 2, maxY);
		}

		let dx = 0;
		let dy = 0;
		let bestX = tol;
		let bestY = tol;
		const lines: SnapLine[] = [];
		for (const cx of xCandidates) {
			for (const mx of movingXs) {
				const diff = cx - mx;
				if (Math.abs(diff) < bestX) {
					bestX = Math.abs(diff);
					dx = diff;
				}
			}
		}
		for (const cy of yCandidates) {
			for (const my of movingYs) {
				const diff = cy - my;
				if (Math.abs(diff) < bestY) {
					bestY = Math.abs(diff);
					dy = diff;
				}
			}
		}
		const out = { x: nx + dx, y: ny + dy };
		if (dx !== 0) {
			// Find which candidate is now matched (within 0.001) on the snapped X.
			const movedX: typeof t = { ...t, x: out.x, y: out.y };
			const mc = nodeCornersWorld(movedX, box);
			const mxs = [mc[0].x, mc[1].x, mc[2].x, mc[3].x, out.x];
			for (const cx of xCandidates) {
				if (mxs.some((m) => Math.abs(m - cx) < 0.5)) {
					lines.push({ axis: 'x', v: cx });
					break;
				}
			}
		}
		if (dy !== 0) {
			const movedY: typeof t = { ...t, x: out.x, y: out.y };
			const mc = nodeCornersWorld(movedY, box);
			const mys = [mc[0].y, mc[1].y, mc[2].y, mc[3].y, out.y];
			for (const cy of yCandidates) {
				if (mys.some((m) => Math.abs(m - cy) < 0.5)) {
					lines.push({ axis: 'y', v: cy });
					break;
				}
			}
		}
		snapLines = lines;
		return out;
	}

	// ---------- input ----------

	function onWheel(e: WheelEvent): void {
		e.preventDefault();
		const factor = e.deltaY > 0 ? 0.9 : 1.1;
		const newZoom = Math.max(0.05, Math.min(8, zoom * factor));
		const rect = canvas?.getBoundingClientRect();
		if (rect) {
			const cx = e.clientX - rect.left;
			const cy = e.clientY - rect.top;
			panX = cx - ((cx - panX) * newZoom) / zoom;
			panY = cy - ((cy - panY) * newZoom) / zoom;
		}
		zoom = newZoom;
		schedule();
	}

	function onMouseDown(e: MouseEvent): void {
		// Middle / right always pan.
		if (e.button === 1 || e.button === 2) {
			panning = true;
			lastXY = [e.clientX, e.clientY];
			e.preventDefault();
			return;
		}
		if (e.button !== 0) return;

		const rect = canvas!.getBoundingClientRect();
		const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
		const world = clientToWorld(e.clientX, e.clientY);

		// 1) handle hit (transform the lone selected node). Skipped while Shift is held —
		// Shift+click is reserved for multi-select / pan, not scale/rotate.
		if (!e.shiftKey) {
			const hh = hitTestHandle(screen);
			if (hh && selectedId) {
				const node = findNodeById(selectedId);
				if (node) {
					if (hh.kind === 'corner') startScale(node, hh.idx, world);
					else if (hh.kind === 'edge')
						startScale(node, EDGE_TO_CORNER[hh.idx], world, EDGE_TO_AXIS[hh.idx]);
					else if (hh.kind === 'rotate') startRotate(node, world);
					else startTranslate(node, world);
					e.preventDefault();
					return;
				}
			}
		}
		// 2) body hit on any node
		const node = hitTestNode(world);
		if (node) {
			if (e.shiftKey) {
				// Shift+click toggles this node in/out of the selection (no drag).
				toggleSelected(node.id);
				schedule();
				e.preventDefault();
				return;
			}
			// Plain click: keep an existing multi-selection if you grabbed a member
			// (so you can group-drag it); otherwise select just this node.
			if (!selectedIds.includes(node.id)) selectOnly(node.id);
			// Locked nodes select but never move; background-cover nodes select but
			// never drag (transform is synthesised). Only movement is locked, not selection.
			if (!node.locked && !isBackgroundCover(node)) startTranslate(node, world);
			schedule();
			e.preventDefault();
			return;
		}
		// 3) empty space — Shift+drag still pans the canvas (unchanged gesture).
		if (e.shiftKey) {
			panning = true;
			lastXY = [e.clientX, e.clientY];
			e.preventDefault();
			return;
		}
		if (selectedIds.length > 0) {
			selectedIds = [];
			schedule();
		}
	}

	function onWindowMouseMove(e: MouseEvent): void {
		if (panning && lastXY) {
			const dx = e.clientX - lastXY[0];
			const dy = e.clientY - lastXY[1];
			panX += dx;
			panY += dy;
			lastXY = [e.clientX, e.clientY];
			schedule();
			return;
		}
		if (dragMode) {
			const node = findNodeById(dragMode.nodeId);
			if (!node) return;
			const world = clientToWorld(e.clientX, e.clientY);
			if (dragMode.kind === 'translate') applyTranslate(node, world, e.shiftKey);
			else if (dragMode.kind === 'scale') applyScale(node, world, e.shiftKey);
			else if (dragMode.kind === 'rotate') applyRotate(node, world, e.shiftKey);
			bumpFrame();
			schedule();
			return;
		}
		// Hover updates for cursor feedback.
		if (!canvas) return;
		const rect = canvas.getBoundingClientRect();
		const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
		if (screen.x < 0 || screen.y < 0 || screen.x > rect.width || screen.y > rect.height) {
			hoverHandle = null;
			hoverNodeId = null;
			return;
		}
		hoverHandle = hitTestHandle(screen);
		if (!hoverHandle) {
			const w = clientToWorld(e.clientX, e.clientY);
			const n = hitTestNode(w);
			hoverNodeId = n?.id ?? null;
		} else {
			hoverNodeId = null;
		}
	}

	function onWindowMouseUp(): void {
		panning = false;
		lastXY = null;
		if (dragMode) {
			dragMode = null;
			snapLines = [];
			schedule();
			onDirty?.();
		}
	}

	function onKeyDown(e: KeyboardEvent): void {
		// Don't hijack typing in form fields (properties panel inputs etc.).
		const tgt = e.target as HTMLElement | null;
		const typing =
			tgt &&
			(tgt.tagName === 'INPUT' ||
				tgt.tagName === 'TEXTAREA' ||
				tgt.tagName === 'SELECT' ||
				tgt.isContentEditable);
		if (typing) return;

		if (e.key === 'Escape' && selectedIds.length > 0) {
			selectedIds = [];
			schedule();
			return;
		}
		if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length > 0) {
			// Delete every selected node that isn't locked, in one transaction.
			const ids = selectedIds.filter((id) => {
				const n = findNodeById(id);
				return n && !n.locked;
			});
			if (ids.length === 0) return;
			e.preventDefault();
			if (ids.length === 1 || !onDeleteMany) ids.forEach((id) => onDelete?.(id));
			else onDeleteMany(ids);
		}
	}

	function onDragOver(e: DragEvent): void {
		if (!e.dataTransfer) return;
		if (!Array.from(e.dataTransfer.types).includes('application/x-iw-asset')) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = 'copy';
		dragOver = true;
	}
	function onDragLeave(): void {
		dragOver = false;
	}
	function onDrop(e: DragEvent): void {
		dragOver = false;
		if (!e.dataTransfer) return;
		const raw = e.dataTransfer.getData('application/x-iw-asset');
		if (!raw) return;
		e.preventDefault();
		let payload: DragPayload | null = null;
		try {
			payload = JSON.parse(raw) as DragPayload;
		} catch {
			return;
		}
		// Blank elements (the Library's "Elements" palette — `text`/`rect`)
		// carry an empty `key` by design; only ASSET kinds (region/atlas-page/spine)
		// reference a key. Requiring a key here silently rejected the keyless drops.
		if (!payload || !payload.kind) return;
		const keyless = payload.kind === 'text' || payload.kind === 'rect';
		if (!keyless && !payload.key) return;
		const pos = clientToWorld(e.clientX, e.clientY);
		const node = spawnNode(payload, pos);
		if (node) {
			onSpawn(node, pos);
			onDirty?.();
		}
	}

	function genId(): string {
		return 'n_' + Math.random().toString(36).slice(2, 10);
	}
	function spawnNode(p: DragPayload, pos: Vec2): LayoutNode | null {
		const id = genId();
		const base = {
			id,
			label: p.name,
			x: Math.round(pos.x),
			y: Math.round(pos.y),
			anchor: { x: 0.5, y: 0.5 },
			scale: { x: 1, y: 1 },
		};
		if (p.kind === 'region') {
			// Seed preview data so the dropped sprite renders immediately, then
			// spawn sized to the region's native art size.
			seedRegionSet(p);
			const nat = { w: p.origW ?? p.rect.w, h: p.origH ?? p.rect.h };
			return {
				...base,
				kind: 'sprite',
				assetKey: p.key,
				region: p.region,
				width: nat.w,
				height: nat.h,
			};
		}
		switch (p.kind) {
			case 'atlas-page':
				return { ...base, kind: 'sprite', assetKey: p.key };
			case 'spine':
				return {
					...base,
					kind: 'spine',
					assetKey: p.key,
					defaultAnimation: '',
					loop: false,
				};
			// An authored Invisible FX effect (id in `key`). The editor can't run a WebGL
			// emitter in its 2D canvas, so it draws a placeholder chip; the game mounts the
			// real `<EffectPlayer>`.
			case 'effect':
				return { ...base, kind: 'effect', effectId: p.key };
			// An authored Invisible Flipbook clip (id in `key`). Spawned UNSIZED, like a spine and
			// unlike a region sprite: the frames are atlas art, so the node draws at the frames'
			// native size until the author resizes it — and the sheet behind them may still be
			// loading at drop time, so there is no native size to bake in yet.
			case 'flipbook':
				return { ...base, kind: 'flipbook', clipId: p.key };
			// Blank elements (the Library's "Elements" palette) — a default text node
			// (edited via Properties → Text).
			case 'text':
				return {
					...base,
					kind: 'text',
					text: 'Text',
					style: { fontFamily: 'proxima-nova', fontSize: 45, fill: 0xffffff },
				};
			// A solid fill block (full-screen dims, panels, colour blocks) — sized
			// 400×400 white by default, recoloured + resized via Properties/handles.
			case 'rect':
				return { ...base, kind: 'rect', width: 400, height: 400, color: 0xffffff };
			// `atlas-manifest` / `sheet` are CONTAINERS — they are never dropped
			// whole (the Library expands them into draggable regions instead).
			default:
				return null;
		}
	}

	/**
	 * Programmatic fill (drag-onto-a-slot): spawn a node from a Library drag
	 * payload at the frame centre and tag it with `slotId`. Reuses the same
	 * `spawnNode` (region-preview seeding included) + `onSpawn` callback as a
	 * canvas drop, so panel/outline slot drops and canvas drops share one spawn
	 * code path.
	 */
	function fillSlotFromPayload(p: DragPayload, slotId: string): void {
		const pos: Vec2 = { x: frameWidth / 2, y: frameHeight / 2 };
		const node = spawnNode(p, pos);
		if (!node) return;
		node.slotId = slotId;
		onSpawn(node, pos);
		onDirty?.();
	}

	// Drag-onto-a-slot arrives as a `fillRequest` prop bumped by the page; the
	// `seq` dedupes so the same request fires the spawn exactly once.
	let handledFillSeq = -1;
	$effect(() => {
		const req = fillRequest;
		if (!req || req.seq === handledFillSeq) return;
		handledFillSeq = req.seq;
		fillSlotFromPayload(req.payload as DragPayload, req.slotId);
	});

	// Redraw the composite when the visible-screen set changes (eye toggles) or the
	// scene set/active scene swaps. schedule() dedupes, so this is cheap.
	// Invariant: each per-scene canvas action also calls schedule() on mount, so a
	// new scene self-heals on the next frame even if this effect's RAF wins first.
	$effect(() => {
		void hiddenSceneIds;
		void scenes;
		void scene;
		void layoutType;
		// Toggling the always-on-top screen-border overlay repaints the HUD canvas.
		void showScreenBorder;
		// Forced repaint signal (undo/redo): a position-only restore reassigns `scenes`
		// but changes no node count, so without this the composite can stay stale.
		void redrawNonce;
		// A region's declared BOX lives outside the layout doc (it describes the ART, not a
		// placement), so no doc field changes when one is dragged — this counter is the signal.
		// ONE cheap dependency that changes only when a box does; the boxes themselves stay in a
		// non-reactive map for the same reason `clipsById` does (`draw()` reads it, and several
		// effects call `draw()` synchronously).
		void artBoundsVersion();
		schedule();
	});

	function fitView(): void {
		if (!wrap) return;
		const w = wrap.clientWidth;
		const h = wrap.clientHeight;
		const zx = (w * 0.9) / frameWidth;
		const zy = (h * 0.9) / frameHeight;
		zoom = Math.max(0.05, Math.min(zx, zy, 1));
		panX = (w - frameWidth * zoom) / 2;
		panY = (h - frameHeight * zoom) / 2;
		schedule();
	}

	// ---------- attached item overlay ----------
	// Screen-space bounding box of the selected node, tracking pan/zoom so the
	// HTML overlay stays glued to the node. Recomputed whenever the node's
	// transform or the viewport changes (the `frameTick` bump forces it after a
	// drag mutates the node in place).
	let frameTick = $state(0);
	const overlayInfo = $derived.by(() => {
		void frameTick;
		void panX;
		void panY;
		void zoom;
		void layoutType;
		if (!selectedId) return null;
		const node = findNodeById(selectedId);
		if (!node) return null;
		const t = nodeTransform(node);
		if (!t.visible) return null;
		const box = boxOf(node, t);
		const corners = nodeCornersWorld(t, box).map(worldToScreen);
		let minX = Infinity,
			minY = Infinity,
			maxX = -Infinity,
			maxY = -Infinity;
		for (const c of corners) {
			if (c.x < minX) minX = c.x;
			if (c.y < minY) minY = c.y;
			if (c.x > maxX) maxX = c.x;
			if (c.y > maxY) maxY = c.y;
		}
		// Live post-scale size in px (region/native box × scale).
		const w = Math.round(box.w * (t.scale?.x ?? 1));
		const h = Math.round(box.h * (t.scale?.y ?? 1));
		// Resolved stand-in art (explicit override OR catalog default) — lets the
		// overlay show the spine play toggle + a real subtitle for catalog anchors
		// that carry no baked `preview.art`.
		const resolvedArt = anchorArt(node) ?? null;
		return {
			node,
			resolvedArt,
			left: minX,
			top: minY,
			right: maxX,
			bottom: maxY,
			width: w,
			height: h,
		};
	});

	function bumpFrame(): void {
		frameTick = frameTick + 1;
	}

	function setAnchorPreset(node: LayoutNode, ax: number, ay: number): void {
		if (layoutType === baseLayoutType) {
			node.anchor = { x: ax, y: ay };
		} else {
			getOverride(node).anchor = { x: ax, y: ay };
		}
		bumpFrame();
		schedule();
		onDirty?.();
	}
	function nudgeScale(node: LayoutNode, factor: number): void {
		const t = nodeTransform(node);
		const sx = (t.scale?.x ?? 1) * factor;
		const sy = (t.scale?.y ?? 1) * factor;
		writeScale(node, sx, sy);
		bumpFrame();
		schedule();
		onDirty?.();
	}
	function bringForward(node: LayoutNode): void {
		const i = scene.nodes.findIndex((n) => n.id === node.id);
		if (i === -1 || i === scene.nodes.length - 1) return;
		const arr = scene.nodes;
		[arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
		bumpFrame();
		schedule();
		onDirty?.();
	}
	function sendBack(node: LayoutNode): void {
		const i = scene.nodes.findIndex((n) => n.id === node.id);
		if (i <= 0) return;
		const arr = scene.nodes;
		[arr[i], arr[i - 1]] = [arr[i - 1], arr[i]];
		bumpFrame();
		schedule();
		onDirty?.();
	}
	function toggleLock(node: LayoutNode): void {
		node.locked = !node.locked;
		bumpFrame();
		schedule();
		onDirty?.();
	}

	const cursorClass = $derived.by(() => {
		if (panning) return 'cursor-grabbing';
		if (dragMode?.kind === 'rotate') return 'cursor-grabbing';
		if (dragMode?.kind === 'translate') return 'cursor-grabbing';
		if (dragMode?.kind === 'scale') {
			if (dragMode.resizeAxis === 'y') return 'cursor-ns';
			if (dragMode.resizeAxis === 'x') return 'cursor-ew';
			const i = dragMode.cornerIdx;
			return i === 0 || i === 2 ? 'cursor-nwse' : 'cursor-nesw';
		}
		if (hoverHandle?.kind === 'rotate') return 'cursor-grab';
		if (hoverHandle?.kind === 'corner') {
			const i = hoverHandle.idx;
			return i === 0 || i === 2 ? 'cursor-nwse' : 'cursor-nesw';
		}
		if (hoverHandle?.kind === 'edge') {
			// top/bottom → vertical resize, right/left → horizontal.
			return hoverHandle.idx === 0 || hoverHandle.idx === 2 ? 'cursor-ns' : 'cursor-ew';
		}
		if (hoverHandle?.kind === 'body' || hoverNodeId) return 'cursor-move';
		return 'cursor-cross';
	});

	onMount(() => {
		resizeCanvas();
		fitView();
		// The 2D HUD-chip text uses the webfont (proxima-nova, via the Typekit kit in
		// app.html). It loads async — redraw once it's ready so the first paint shows
		// the real game font instead of the sans-serif fallback.
		if (typeof document !== 'undefined' && document.fonts) {
			void document.fonts.ready.then(() => schedule());
		}
		const ro = new ResizeObserver(() => {
			resizeCanvas();
			schedule();
		});
		if (wrap) ro.observe(wrap);

		window.addEventListener('mousemove', onWindowMouseMove);
		window.addEventListener('mouseup', onWindowMouseUp);
		window.addEventListener('keydown', onKeyDown);

		return () => {
			ro.disconnect();
			if (riderRaf) cancelAnimationFrame(riderRaf);
			riderRaf = 0;
			window.removeEventListener('mousemove', onWindowMouseMove);
			window.removeEventListener('mouseup', onWindowMouseUp);
			window.removeEventListener('keydown', onKeyDown);
		};
	});

	$effect(() => {
		void scene.nodes.length;
		void scene.space;
		void scene.align?.vertical;
		void scene.align?.horizontal;
		void frameWidth;
		void frameHeight;
		void selectedIds.length;
		void selectedIds;
		void snapLines.length;
		void layoutType;
		// Re-draw the param-aware text preview when a default changes (§13.4, B3).
		void componentParams;
		schedule();
	});
</script>

<div
	bind:this={wrap}
	class="wrap {cursorClass}"
	class:dragover={dragOver}
	ondragover={onDragOver}
	ondragleave={onDragLeave}
	ondrop={onDrop}
	oncontextmenu={(e) => e.preventDefault()}
	role="region"
	aria-label="Editor canvas"
>
	<!-- Base canvas: frame backdrop + the interaction surface. The per-scene composite
	     groups above are `pointer-events:none`, so input (select/drag/zoom/pan) always
	     reaches here; hit-testing is world-space math, independent of what's drawn. -->
	<canvas bind:this={canvas} onwheel={onWheel} onmousedown={onMouseDown}></canvas>

	<!-- One z-ordered group per non-hidden GAME scene, in doc order. Each group stacks
	     (bottom→top) its own 2D canvas, then its spine sublayer, then its text sublayer.
	     `z-index = scene index` makes a LATER scene's whole group sit above an EARLIER
	     scene's whole group — so a Background spine renders below the base-game 2D. The
	     spine/text sublayers are filtered to the one scene + mounted only when present
	     (keeps WebGL/pixi contexts bounded). -->
	{#each visibleGameScenes() as s (s.id)}
		<div class="scene-group">
			<!-- One canvas per BLEND RUN (usually exactly one): consecutive top-level nodes that
			     share a blend mode, with the mode on the element so the browser composites the run
			     against everything painted beneath it — earlier scene groups included. See
			     `blendRuns`. -->
			{#each blendRuns(s) as run (run.key)}
				<canvas class="scene-2d" style:mix-blend-mode={run.css} use:registerSceneCanvasAction={run}
				></canvas>
			{/each}
			{#if sceneHasSpine(s)}
				<EditorSpineLayer
					{scenes}
					{mainSizesMap}
					{layoutType}
					{frameWidth}
					{frameHeight}
					{panX}
					{panY}
					{zoom}
					{assets}
					{componentMap}
					{spinePreview}
					{spinePreviewNodeId}
					{symbolStatics}
					{gridDimensions}
					worldTransformOf={nodeTransform}
					reloadToken={spineReload}
					{hiddenSceneIds}
					sceneFilter={sceneFilterFor(s.id)}
					activeSceneId={scene.id}
					playing={playingSpines}
					{boneRiders}
					onReadyKeysChange={(keys) => {
						mergeSpineReady(s.id, keys);
						schedule();
					}}
					onNaturalSizesChange={(sizes) => {
						mergeSpineNatural(s.id, sizes);
						schedule();
					}}
					onSpineMetaChange={(meta) => {
						mergeSpineMeta(s.id, meta);
						schedule();
					}}
					onLoadingChange={(c) => {
						mergeSpineLoading(s.id, c);
					}}
				/>
			{/if}
			{#if sceneHasText(s)}
				<EditorTextLayer
					{scenes}
					{layoutType}
					{panX}
					{panY}
					{zoom}
					worldTransformOf={nodeTransform}
					{hiddenSceneIds}
					sceneFilter={sceneFilterFor(s.id)}
					{projectGameName}
					{componentParams}
					{componentMap}
					{repeaterSources}
					{frameWidth}
					{frameHeight}
					reloadToken={fontReload}
					{redrawNonce}
					onLoadingChange={(c) => {
						mergeFontLoading(s.id, c);
					}}
					onReadyIdsChange={(ids) => {
						mergeTextReady(s.id, ids);
						schedule();
					}}
					onMeasuredChange={(sizes) => {
						mergeTextMeasured(s.id, sizes);
					nodeFilter={normalOverlayFilter(s)}
						schedule();
					}}
				/>
			{/if}
			{#if sceneHasEffect(s)}
				<EditorEffectLayer
					{scenes}
					{layoutType}
					{frameWidth}
					{frameHeight}
					{panX}
					{panY}
					{zoom}
					{componentMap}
					worldTransformOf={nodeTransform}
					{hiddenSceneIds}
					sceneFilter={sceneFilterFor(s.id)}
					playing={playingEffects}
					onReadyKeysChange={(ids) => {
						mergeEffectReady(s.id, ids);
						schedule();
					}}
					onBoundsChange={(bounds) => {
						mergeEffectBounds(s.id, bounds);
						schedule();
					}}
				/>
			{/if}
		</div>
	{/each}

	<!-- Bone-ridden stand-in symbol overlay (Scene Editor preview): sits ABOVE the scene groups
	     (their spine layers included) so a reveal's symbol rides ON TOP of its rig, and BELOW the
	     HUD layers. Driven by `drawRiders`' own rAF reading the shared `boneRiders` map. -->
	<canvas bind:this={riderCanvas} class="rider-layer"></canvas>

	<canvas bind:this={hudCanvas} class="hud-layer"></canvas>
	<!-- HUD spine overlay: like the HUD text overlay below, the HUD scenes draw on the
	     top-most `hudCanvas` and are excluded from the per-game-scene `{#each}` above — so a
	     spine nested in a placed HUD component (a spin button's `R_SpinButton`) would only
	     ever show its 2D placeholder. This live spine layer (filtered to the HUD scenes) sits
	     just above the HUD's 2D canvas, so the editor reflects the in-game button. -->
	{#if hudSpineScenes().length > 0}
		<div class="hud-spine-layer">
			<EditorSpineLayer
				{scenes}
				{mainSizesMap}
				{layoutType}
				{frameWidth}
				{frameHeight}
				{panX}
				{panY}
				{zoom}
				{assets}
				{componentMap}
				{spinePreview}
				{spinePreviewNodeId}
				worldTransformOf={nodeTransform}
				reloadToken={spineReload}
				{hiddenSceneIds}
				sceneFilter={hudSpineSceneFilter()}
				activeSceneId={null}
				playing={playingSpines}
				onReadyKeysChange={(keys) => {
					nodeFilter={normalOverlayFilter(s)}
					mergeSpineReady(HUD_SPINE_KEY, keys);
					schedule();
				}}
				onNaturalSizesChange={(sizes) => {
					mergeSpineNatural(HUD_SPINE_KEY, sizes);
					schedule();
				}}
				onSpineMetaChange={(meta) => {
					mergeSpineMeta(HUD_SPINE_KEY, meta);
					schedule();
				}}
			<!-- BLENDED rigs / effects: one extra overlay per blend mode the scene uses, each
			     carrying the mode as CSS `mix-blend-mode` on its own element. They render nothing
			     when the scene blends nothing (`blendOverlayGroups` is empty), so the common scene
			     mounts exactly the surfaces it always has. Reports go under the group's synthetic
			     key, which `forgetScene` purges with the scene. -->
			{#each blendOverlayGroups(s) as g (g.key)}
				{#if sceneHasSpine(s)}
					<EditorSpineLayer
						{scenes}
						{mainSizesMap}
						{layoutType}
						{frameWidth}
						{frameHeight}
						{panX}
						{panY}
						{zoom}
						{assets}
						{componentMap}
						{spinePreview}
						{spinePreviewNodeId}
						{symbolStatics}
						{gridDimensions}
						worldTransformOf={nodeTransform}
						reloadToken={spineReload}
						{hiddenSceneIds}
						sceneFilter={sceneFilterFor(s.id)}
						nodeFilter={g.ids}
						blend={g.css}
						activeSceneId={scene.id}
						playing={playingSpines}
						{boneRiders}
						onReadyKeysChange={(keys) => {
							mergeSpineReady(g.key, keys);
							schedule();
						}}
						onNaturalSizesChange={(sizes) => {
							mergeSpineNatural(g.key, sizes);
							schedule();
						}}
						onSpineMetaChange={(meta) => {
							mergeSpineMeta(g.key, meta);
							schedule();
						}}
						onLoadingChange={(c) => {
							mergeSpineLoading(g.key, c);
						}}
					/>
				{/if}
				{#if sceneHasEffect(s)}
					<EditorEffectLayer
						{scenes}
						{layoutType}
						{frameWidth}
						{frameHeight}
						{panX}
						{panY}
						{zoom}
						{componentMap}
						worldTransformOf={nodeTransform}
						{hiddenSceneIds}
						sceneFilter={sceneFilterFor(s.id)}
						nodeFilter={g.ids}
						blend={g.css}
						playing={playingEffects}
						onReadyKeysChange={(ids) => {
							mergeEffectReady(g.key, ids);
							schedule();
						}}
						onBoundsChange={(bounds) => {
							mergeEffectBounds(g.key, bounds);
							schedule();
						}}
					/>
				{/if}
			{/each}
				onLoadingChange={(c) => {
					mergeSpineLoading(HUD_SPINE_KEY, c);
				}}
			/>
		</div>
	{/if}
	<!-- HUD text overlay: the HUD scenes (hudBar/hudCorners) draw on the top-most
	     `hudCanvas`, NOT in the per-game-scene `{#each}` above — so their text (which the
	     2D canvas no longer fills) needs its OWN pixi overlay, layered just over the HUD
	     canvas. Covers every HUD scene at once (one filter Set). -->
	{#if hudTextScenes().length > 0}
		<div class="hud-text-layer">
			<EditorTextLayer
				{scenes}
				{layoutType}
				{panX}
				{panY}
				{zoom}
				worldTransformOf={nodeTransform}
				{hiddenSceneIds}
				sceneFilter={hudTextSceneFilter()}
				{projectGameName}
				{componentParams}
				{componentMap}
				{repeaterSources}
				{frameWidth}
				{frameHeight}
				reloadToken={fontReload}
				{redrawNonce}
				onLoadingChange={(c) => {
					mergeFontLoading(HUD_TEXT_KEY, c);
				}}
				onReadyIdsChange={(ids) => {
					mergeTextReady(HUD_TEXT_KEY, ids);
					schedule();
				}}
			/>
		</div>
	{/if}
	<!-- HUD effect overlay: HUD scenes draw on the top-most `hudCanvas` (excluded from the per-game-
	     scene `{#each}`), so a placed HUD effect needs its OWN live particle overlay layered just over
	     the HUD canvas. Covers every HUD scene at once (one filter Set). -->
	{#if hudEffectScenes().length > 0}
		<div class="hud-effect-layer">
			<EditorEffectLayer
				{scenes}
				{layoutType}
				{frameWidth}
				{frameHeight}
				{panX}
				{panY}
				{zoom}
				{componentMap}
				worldTransformOf={nodeTransform}
				{hiddenSceneIds}
				sceneFilter={hudEffectSceneFilter()}
				playing={playingEffects}
				onReadyKeysChange={(ids) => {
					mergeEffectReady(HUD_EFFECT_KEY, ids);
					schedule();
				}}
				onBoundsChange={(bounds) => {
					mergeEffectBounds(HUD_EFFECT_KEY, bounds);
					schedule();
				}}
			/>
		</div>
	{/if}
	{#if showOverlay}
		<BusyOverlay label="Loading assets…" detail="{loadDone} / {batchTotal}" progress={loadPct} />
	{/if}
	{#if overlayInfo}
		<EditorItemOverlay
			info={overlayInfo}
			onDelete={(n) => onDelete?.(n.id)}
			onToggleLock={toggleLock}
			onAnchor={setAnchorPreset}
			onScale={nudgeScale}
			onForward={bringForward}
			onBack={sendBack}
			spinePlaying={playingSpines.has(overlayInfo.node.id)}
			onToggleSpinePlay={toggleSpinePlay}
		/>
	{/if}
	<div class="hint">
		click = select · drag = move · corners = scale (Shift = non-uniform) · top circle = rotate
		(Shift = 15°) · scroll = zoom · shift/middle/right-drag = pan · Esc = deselect
	</div>
	<div class="canvas-top">
		{@render modeBar?.()}
		<div class="canvas-actions">
			{#if onUndo || onRedo}
				<div class="hist-grp" role="group" aria-label="Undo / redo">
					<button
						class="fit hist"
						type="button"
						disabled={!canUndo}
						title="Undo (Ctrl/⌘+Z)"
						aria-label="Undo"
						onclick={() => onUndo?.()}
					>
						↶
					</button>
					<button
						class="fit hist"
						type="button"
						disabled={!canRedo}
						title="Redo (Ctrl/⌘+Shift+Z)"
						aria-label="Redo"
						onclick={() => onRedo?.()}
					>
						↷
					</button>
				</div>
			{/if}
			<button
				class="fit"
				onclick={refreshAssets}
				type="button"
				title="Reload atlas + spine art from R2 (after you update a PNG) — no full page reload needed"
			>
				↻ Reload art
			</button>
			<button
				class="fit"
				class:on={playingEffects}
				onclick={() => (playingEffects = !playingEffects)}
				type="button"
				aria-pressed={playingEffects}
				title={playingEffects ? 'Pause effect preview' : 'Play effect preview'}
			>
				{playingEffects ? '❚❚' : '▶'} FX
			</button>
			<button
				class="fit"
				class:on={showScreenBorder}
				onclick={() => (showScreenBorder = !showScreenBorder)}
				type="button"
				aria-pressed={showScreenBorder}
				title={showScreenBorder
					? 'Hide the screen bounds overlay'
					: 'Show the screen + play-area bounds on top of all art'}
			>
				⛶ Bounds
			</button>
		</div>
	</div>
</div>

<style>
	.wrap {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		background: #0b0b10;
	}
	.wrap.dragover {
		outline: 2px dashed #7ee0c0;
		outline-offset: -8px;
	}
	.cursor-cross {
		cursor: crosshair;
	}
	.cursor-move {
		cursor: move;
	}
	.cursor-grab {
		cursor: grab;
	}
	.cursor-grabbing {
		cursor: grabbing;
	}
	.cursor-nwse {
		cursor: nwse-resize;
	}
	.cursor-nesw {
		cursor: nesw-resize;
	}
	.cursor-ns {
		cursor: ns-resize;
	}
	.cursor-ew {
		cursor: ew-resize;
	}
	canvas {
		display: block;
		width: 100%;
		height: 100%;
	}
	.rider-layer {
		/* Bone-ridden stand-in symbol overlay — above the scene groups (z-index 1..N) so a
		   reveal's symbol draws over its rig, below the HUD (z-index 1000). Input passes through. */
		position: absolute;
		inset: 0;
		z-index: 999;
		pointer-events: none;
	}
	.hud-layer {
		/* Top-most 2D layer: overlays the base canvas + the per-scene groups so the HUD
		   draws on top. Sits above every scene group (which use z-index 1..N); the HUD
		   needs a higher stacking context. Input passes through to the base canvas. */
		position: absolute;
		/* THE blending boundary. A node's `mix-blend-mode` composites against every layer beneath
		   it inside this box — the base frame canvas and earlier scene groups included, which is
		   what makes an additive glow in one screen lift the BACKGROUND screen's art the way the
		   game does. `isolate` stops it reaching the launcher chrome outside; `overflow:hidden`
		   already clipped everything here, so nothing that used to escape this box now can't. */
		isolation: isolate;
		inset: 0;
		z-index: 1000;
		pointer-events: none;
	}
	.hud-spine-layer {
		/* The HUD's spine overlay — sits just ABOVE the HUD's 2D canvas (z-index 1000) so a
		   placed HUD component's live spine (a spin button) draws over its 2D base sprite,
		   mirroring the in-game button. Below the HUD text overlay (same z-index, earlier in
		   the DOM) so readout text stays on top. Input passes through to the base canvas. */
		position: absolute;
		inset: 0;
		z-index: 1001;
		pointer-events: none;
	}
	.hud-text-layer {
		/* The HUD's text overlay — sits just ABOVE the HUD's 2D canvas (z-index 1000) so
		   HUD readout/caption text draws over the plaque chips, mirroring how the game
		   layers HUD text on its top UI layer. Input passes through to the base canvas. */
		position: absolute;
		inset: 0;
		z-index: 1001;
		pointer-events: none;
	}
	.hud-effect-layer {
		/* The HUD's live particle overlay — sits just ABOVE the HUD's 2D canvas (z-index 1000) so a
		   placed HUD effect's particles draw over the HUD chips. Input passes through to the base
		   canvas. */
		position: absolute;
		inset: 0;
		z-index: 1001;
		pointer-events: none;
	}
	.scene-group {
		/* One composite group per game scene. Ordering is DOM order (the groups are emitted in
		   scene order), NOT z-index: a positioned element with a z-index forms a stacking context,
		   which would isolate its blended canvases to the group and leave a blend unable to see the
		   scene beneath it. `z-index:auto` positioned elements still paint above the non-positioned
		   base canvas and below the rider/HUD layers (z-index 999+), so the stack is unchanged.
		   Input passes through to the base canvas underneath. */
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
	.scene-2d {
		/* Bottom of each group: this scene's 2D node art. The group's spine + text
		   sublayers stack above it (later in the group's DOM order). */
		position: absolute;
		inset: 0;
		display: block;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}
	.hint {
		position: absolute;
		left: 12px;
		bottom: 10px;
		/* Above the canvas art layers (scene groups + HUD reach z-index 1001 in this same
		   stacking context) so the hint text is never buried. */
		z-index: 2000;
		color: #666;
		font-size: 11px;
		pointer-events: none;
		text-shadow: 0 1px 2px #000;
	}
	/* Unified top overlay: the device/mode bar (left) and the action buttons (right) share
	   ONE flex row so they can never overlap — when the canvas is narrow or the text is
	   large the actions wrap to a second line instead of colliding with the device tabs.
	   z-index sits above every canvas art layer (scene groups + HUD, up to z-index 1001 in
	   this stacking context) so the controls are never buried by canvas content. */
	.canvas-top {
		position: absolute;
		top: 8px;
		left: 8px;
		right: 8px;
		z-index: 2000;
		display: flex;
		align-items: flex-start;
		flex-wrap: wrap;
		gap: 8px;
		/* The row itself is click-through; each control re-enables pointer events. */
		pointer-events: none;
	}
	.canvas-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 6px;
		/* Push to the right edge of the row; when it wraps it stays right-aligned on its
		   own line, never overlapping the device bar. */
		margin-left: auto;
	}
	.canvas-actions button {
		pointer-events: auto;
	}
	.fit {
		background: #16161c;
		color: #c8a3ff;
		border: 1px solid #2a2430;
		border-radius: 6px;
		padding: 4px 10px;
		font-size: 11px;
		cursor: pointer;
	}
	.fit:hover {
		border-color: #7ee0c0;
	}
	.fit.on {
		color: #7ee0c0;
		border-color: #3a5a4a;
	}
	.hist-grp {
		display: inline-flex;
		gap: 4px;
	}
	.fit.hist {
		width: 28px;
		padding: 4px 0;
		text-align: center;
		font-size: 14px;
		line-height: 1;
	}
	.fit:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.fit:disabled:hover {
		border-color: #2a2430;
	}
</style>
