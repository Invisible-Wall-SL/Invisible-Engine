<script lang="ts">
	import {
		backgroundCoverScale,
		backgroundCoverStretch,
		backgroundFit,
		boundComponentDefault,
		boundComponentRidesBone,
		computeOverlayPlacement,
		coverTransform,
		isHudScene,
		MAX_COMPONENT_DEPTH,
		parseScopedFrameRef,
		resolveAnchorPreviewArt,
		resolveBoundValue,
		resolveComponentParams,
		resolveTransform,
		STANDARD_MAIN_SIZES_MAP,
		type ComponentDef,
		type LayoutNode,
		type LayoutType,
		type OverlayPlacement,
		type PlacementGeometry,
		type ResolvedPreviewArt,
		type ResolvedTransform,
		type Scene,
	} from 'engine-layout';
	import { onMount } from 'svelte';
	import {
		childLocalTransform,
		nodeBox,
		nodeCornersWorld,
		topMidWorld,
		pointInQuad,
		resolveBoneRiderRigKey,
		type BoneRiderTransform,
		type Vec2,
		type NodeBox,
		type NaturalSize,
	} from './editorCanvas.helpers';
	import {
		clearRegionCache,
		fetchRegions,
		regionNaturalSize,
		type EditorRegion,
		type RegionDragPayload,
		type RegionSet,
	} from './editorRegions.client';
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
		// `effect` carries an authored FX id in `key` (the Library's Effects section).
		kind: 'atlas-page' | 'atlas-manifest' | 'sheet' | 'spine' | 'text' | 'rect' | 'effect';
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
		type: 'sprite' | 'spine';
		assetKey: string;
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
		/** Active authoring layoutType; non-`desktop` puts edits into override mode. */
		layoutType: LayoutType;
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
		/** Loaded component defs by id (§8.4) — lets the canvas resolve + draw a
		 * `componentInstance` node by expanding `def.root` under the instance transform.
		 * The editor canvas is its OWN renderer, so it reads this map (NOT the engine
		 * registry). Absent / unknown id → a labelled placeholder. */
		componentMap?: Map<string, ComponentDef>;
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
	}

	let {
		scene,
		scenes,
		mainSizesMap,
		frameWidth,
		frameHeight,
		layoutType,
		assets,
		symbolDefaults = null,
		symbolsDoc = null,
		componentMap = new Map(),
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
	}: Props = $props();

	/** Each symbol's STATIC binding for the reel preview: the coded default's `static`
	 * cell, with the override doc's `static` cell layered on top (sparse). Computed once
	 * (not per draw), and cycled across the grid cells so the board looks populated. A
	 * `spine` static can't be drawn on the 2D canvas — kept so those cells fall back to
	 * the amber marker. Empty when no symbol data is present (graceful). */
	const symbolStatics = $derived.by<
		{ type: 'sprite' | 'spine'; assetKey: string; sizeRatios?: { width: number; height: number } }[]
	>(() => {
		if (!symbolDefaults) return [];
		const out: {
			type: 'sprite' | 'spine';
			assetKey: string;
			sizeRatios?: { width: number; height: number };
		}[] = [];
		for (const name of Object.keys(symbolDefaults.symbols)) {
			const base = symbolDefaults.symbols[name]?.static;
			const override = symbolsDoc?.symbols?.[name]?.static;
			const cell = override ?? base;
			if (!cell?.assetKey) continue;
			out.push({ type: cell.type, assetKey: cell.assetKey, sizeRatios: cell.sizeRatios });
		}
		return out;
	});

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
		if (space === 'standard') {
			return standardToWorld(t, sceneCtx);
		}
		if (space === 'canvas') {
			// Canvas space = RAW window coords — the game renders these scenes with NO
			// `<MainContainer>` (see `LayoutScene`), so x/y are window pixels, never the
			// main→window mapping. A `screenAnchor` pins to a window edge; without one the
			// x/y are used verbatim — matching the game's `LayoutNodeView`
			// (`posX = screenAnchor ? screenAnchor·canvas + x : x`) and the spine render's
			// canvas branch. Previously a canvas node WITHOUT a screenAnchor fell through to
			// the game-space mapping below, so the editor placed it (and its selection box) at
			// a DIFFERENT spot + scale than the game ships — every component dropped into a
			// canvas-space scene mismatched. Returning here keeps editor == game.
			return t.screenAnchor
				? {
						...t,
						x: t.screenAnchor.x * frameWidth + t.x,
						y: t.screenAnchor.y * frameHeight + t.y,
					}
				: t;
		}
		if (
			space === 'background' &&
			(node.kind === 'sprite' || node.kind === 'spine' || node.kind === 'componentInstance')
		) {
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
		const std = STANDARD_MAIN_SIZES_MAP[layoutType];
		const s = Math.min(frameWidth / (std.width || 1), frameHeight / (std.height || 1));
		const drawW = std.width * s;
		const drawH = std.height * s;
		const offX = (frameWidth - drawW) / 2;
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
			const box = nodeBox(node, t, naturalSize, componentMap, layoutType);
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
		if (layoutType === 'desktop') {
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
		if (layoutType === 'desktop') {
			node.scale = { x: sx, y: sy };
		} else {
			const o = getOverride(node);
			o.scale = { x: sx, y: sy };
		}
	}
	function writeRotation(node: LayoutNode, r: number): void {
		if (layoutType === 'desktop') {
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
		return (
			scene.space === 'background' &&
			(node.kind === 'sprite' || node.kind === 'spine' || node.kind === 'componentInstance')
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
	/** Global play/pause for the live effect preview overlay (default playing). */
	let playingEffects = $state(true);
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

	/** Svelte action: register a per-scene 2D canvas + size/draw it once it mounts. */
	function registerSceneCanvasAction(el: HTMLCanvasElement, id: string) {
		registerSceneCanvas(id, el);
		resizeCanvas();
		schedule();
		return {
			destroy() {
				registerSceneCanvas(id, null);
				forgetScene(id);
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
	type HandleHit = { kind: 'corner'; idx: number } | { kind: 'rotate' } | { kind: 'body' };

	const HANDLE_PX = 7;
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
		img.src = `/api/editor/asset?key=${encodeURIComponent(key)}&v=${assetVersion}`;
		return null;
	}

	/** "Reload art": drop the per-session image + region caches and bump the
	 * cache-bust tokens so updated atlas/spine art is re-fetched from R2 — no full
	 * page reload needed. The 2D images + region pages re-load on the next draw();
	 * the spine layer re-loads via the forwarded `spineReload` token. */
	function refreshAssets(): void {
		images.clear();
		regionSets.clear();
		failedRegionKeys.clear();
		clearRegionCache(); // also drop the module-level fetchRegions cache (page key + rects)
		clearPageImages(); // drop the Library thumbnails' shared page decodes (+ bust their HTTP cache)
		clearFontCatalogCache(); // drop the module-level font catalog so it re-fetches
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

	/** Resolved stand-in art for a `bind` anchor (explicit override → catalog default
	 * against the project's assets). The 2D canvas + the spine overlay both resolve
	 * through this so they agree on ONE art per anchor. Triggers the lazy sprite-region
	 * scan when a node's catalog default is a sprite the index hasn't located yet. */
	function anchorArt(node: LayoutNode): ResolvedPreviewArt | undefined {
		const art = resolveAnchorPreviewArt(node, assets, spriteRegionIndex);
		if (art?.kind === 'sprite' && !art.assetKey) ensureRegionIndex();
		return art;
	}

	/** Natural draw size for a node — region size for region sprites, page/native otherwise. */
	function naturalSize(node: LayoutNode): NaturalSize | null {
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
		// A componentInstance's "natural size" is the union of its expanded content (the
		// same box `nodeBox` frames + `drawComponentInstance` draws), so a background-space
		// instance cover-fits against its real drawn extent via `backgroundTransform`.
		// `nodeBox` routes an instance through `componentInstanceContentBox`; a missing def
		// or empty content falls back to its generic 160×100, which we treat as "unknown"
		// (null) so the cover uses the frame size instead of a tiny box.
		if (node.kind === 'componentInstance') {
			const box = nodeBox(
				node,
				resolveTransform(node, layoutType),
				naturalSize,
				componentMap,
				layoutType,
			);
			if (box.w > 0 && box.h > 0 && !(box.w === 160 && box.h === 100))
				return { w: box.w, h: box.h };
			return null;
		}
		// A `preview.art` bind anchor borrows the art's natural size (so box/hit-test
		// math frames the rendered art, not an empty container).
		const art = artNaturalSize(node);
		if (art) return art;
		if (node.kind === 'sprite' && node.region) {
			const found = findRegion(node.assetKey, node.region);
			if (found) return regionNaturalSize(found.region);
			return null;
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
	function artNaturalSize(node: LayoutNode): { w: number; h: number } | null {
		const art = anchorArt(node);
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

	/** Does a scene carry a spine render target (a real spine node, or a `bind`
	 * anchor whose resolved preview art is a spine)? Only such scenes mount a
	 * (WebGL) spine sublayer in their group, so contexts stay bounded. */
	function sceneHasSpine(s: Scene): boolean {
		return nodesHaveSpine(s.nodes, 0, []);
	}
	function nodesHaveSpine(nodes: LayoutNode[], depth: number, stack: string[]): boolean {
		for (const n of nodes) {
			if (n.kind === 'spine') return true;
			const art = anchorArt(n);
			if (art?.kind === 'spine' && art.assetKey) return true;
			if (n.kind === 'container' && nodesHaveSpine(n.children, depth, stack)) return true;
			if (n.kind === 'componentInstance') {
				const def = componentMap.get(n.componentId);
				if (!def || depth >= MAX_COMPONENT_DEPTH || stack.includes(def.id)) continue;
				if (nodesHaveSpine(def.root.children, depth + 1, [...stack, def.id])) return true;
			}
		}
		return false;
	}

	/** Does a scene carry a bone-riding component (a `bind` whose coded component declares
	 * `ridesBone` — the free-spin symbol reveal) ANYWHERE in its tree? Gates the rider overlay's
	 * rAF so it only runs when a stand-in symbol could be published. */
	function sceneHasBoneRider(s: Scene): boolean {
		return nodesHaveBoneRider(s.nodes, 0, []);
	}
	function nodesHaveBoneRider(nodes: LayoutNode[], depth: number, stack: string[]): boolean {
		for (const n of nodes) {
			if (n.bind && boundComponentRidesBone(n.bind.component)) return true;
			if (n.kind === 'container' && nodesHaveBoneRider(n.children, depth, stack)) return true;
			if (n.kind === 'componentInstance') {
				const def = componentMap.get(n.componentId);
				if (!def || depth >= MAX_COMPONENT_DEPTH || stack.includes(def.id)) continue;
				if (nodesHaveBoneRider(def.root.children, depth + 1, [...stack, def.id])) return true;
			}
		}
		return false;
	}
	/** Any non-hidden game scene hosting a bone-riding component → run the rider rAF. */
	const hasBoneRiders = $derived(visibleGameScenes().some(sceneHasBoneRider));

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

	/** Per-scene 2D canvas registry — each game scene's node art draws onto its OWN
	 * canvas (registered here on mount) so it z-orders with the rest of its group. */
	const sceneCanvases = new Map<string, HTMLCanvasElement>();
	function registerSceneCanvas(id: string, el: HTMLCanvasElement | null): void {
		if (el) sceneCanvases.set(id, el);
		else sceneCanvases.delete(id);
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
			const c = sceneCanvases.get(s.id);
			if (!c) continue;
			const sctx = c.getContext('2d');
			if (!sctx) continue;
			sctx.setTransform(1, 0, 0, 1, 0, 0);
			sctx.clearRect(0, 0, c.width, c.height); // transparent — base shows through
			sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			sctx.translate(panX, panY);
			sctx.scale(zoom, zoom);
			for (const node of s.nodes) drawNode(sctx, node, s);
		}
	}

	/**
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
			const art = anchorArt(node);
			if (art?.kind === 'spine') {
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
				// The PIXI text overlay draws this HUD anchor with its real chosen font once
				// loaded (reported via readyTextIds); until then the chip stands in.
				// When this `bind` is a mount inside a componentInstance (instanceParams set),
				// the chip shows the instance's resolved `label` caption + `fill`/`fontSize`
				// styling — so a placed `HudReadout` reads "BALANCE" (its label param), not the
				// bare component name. Absent instanceParams ⇒ the prior bind.props path (parity).
				if (instanceParams) {
					drawHudChip(ctx, t, node.preview, chipCaption(node, instanceParams), undefined, {
						fill: typeof instanceParams.fill === 'number' ? instanceParams.fill : undefined,
						fontSize:
							typeof instanceParams.fontSize === 'number' ? instanceParams.fontSize : undefined,
						fontFamily:
							typeof instanceParams.fontFamily === 'string' ? instanceParams.fontFamily : undefined,
					});
				} else {
					drawHudChip(
						ctx,
						t,
						node.preview,
						chipCaption(node, componentParams),
						node.bind.props as Record<string, unknown> | undefined,
					);
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
				drawNode(ctx, child, sceneCtx, componentDepth, componentStack, instanceParams, true);
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
		}

		ctx.restore();
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
	 * `getSymbolX` / `getSymbolLead` exactly, so the preview matches the live board.
	 */
	function drawReelGrid(
		ctx: CanvasRenderingContext2D,
		node: Extract<LayoutNode, { kind: 'reelGrid' }>,
		t: ResolvedTransform,
	): void {
		const reels = Math.max(1, Math.round(node.reels));
		const rows = Math.max(1, Math.round(node.rows));
		const cellW = node.cellWidth && node.cellWidth > 0 ? node.cellWidth : node.cellSize;
		const cellH = node.cellHeight && node.cellHeight > 0 ? node.cellHeight : node.cellSize;
		const gapX = Number.isFinite(node.gapX) ? (node.gapX as number) : 0;
		const gapY = Number.isFinite(node.gapY) ? (node.gapY as number) : 0;
		const pitchX = cellW + gapX;
		const pitchY = cellH + gapY;
		const w = reels * cellW + (reels - 1) * gapX;
		const h = rows * cellH + (rows - 1) * gapY;
		// Board NUDGE — a fine px offset of the WHOLE board (cells + seats move
		// together), mirroring the game's `boardLayout` position offset. Default 0.
		const nudgeX = Number.isFinite(node.boardNudgeX) ? (node.boardNudgeX as number) : 0;
		const nudgeY = Number.isFinite(node.boardNudgeY) ? (node.boardNudgeY as number) : 0;
		const left = -w * (t.anchor?.x ?? 0.5) + nudgeX;
		const top = -h * (t.anchor?.y ?? 0.5) + nudgeY;

		ctx.fillStyle = 'rgba(93, 176, 255, 0.06)';
		ctx.fillRect(left, top, w, h);

		ctx.lineWidth = 1;
		ctx.strokeStyle = 'rgba(93, 176, 255, 0.45)';
		for (let i = 0; i < reels; i++) {
			for (let j = 0; j < rows; j++) {
				ctx.strokeRect(left + i * pitchX, top + j * pitchY, cellW, cellH);
			}
		}

		// Real symbol art per cell: the static binding (sprite frame) drawn CENTRED in each
		// cell, CLIPPED to it, and CONTAIN-fit to the cell by its own art (no size param —
		// matches the engine's `Sprite`/`Spine` `contain`). The static list is cycled across
		// cells so the board looks populated. A spine static (can't draw on a 2D canvas) or an
		// unresolved frame falls back to the amber marker square.
		// Seat offset from each cell's CENTRE — the same two independent contributions
		// the game applies (see `getSymbolX` / `getSymbolLead`): the reel/row LEAD
		// (`reelPadding`/`rowPadding`, in cell-SIZE units — seats the whole cluster) plus
		// the per-cell SEAT ALIGNMENT (`symbolAlignX/Y`, in cell-W/H units — art inside
		// its own cell). Both default 0.5 ⇒ 0 offset ⇒ centred (parity).
		const leadX = Number.isFinite(node.reelPadding) ? (node.reelPadding as number) : 0.5;
		const leadY = Number.isFinite(node.rowPadding) ? (node.rowPadding as number) : 0.5;
		const alignX = Number.isFinite(node.symbolAlignX) ? (node.symbolAlignX as number) : 0.5;
		const alignY = Number.isFinite(node.symbolAlignY) ? (node.symbolAlignY as number) : 0.5;
		const seatDX = node.cellSize * (leadX - 0.5) + cellW * (alignX - 0.5);
		const seatDY = node.cellSize * (leadY - 0.5) + cellH * (alignY - 0.5);
		const statics = symbolStatics;
		const drawMarker = (cx: number, cy: number, label?: string): void => {
			const sym = Math.min(cellW, cellH);
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
		for (let i = 0; i < reels; i++) {
			for (let j = 0; j < rows; j++) {
				const cellX = left + i * pitchX;
				const cellY = top + j * pitchY;
				const cx = cellX + cellW / 2 + seatDX;
				const cy = cellY + cellH / 2 + seatDY;
				const cell = statics.length ? statics[(j * reels + i) % statics.length] : undefined;
				if (!cell) {
					drawMarker(cx, cy);
					continue;
				}
				if (cell.type === 'spine') {
					drawMarker(cx, cy, 'spine');
					continue;
				}
				const found = findRegion(cell.assetKey, cell.assetKey);
				if (!found) {
					drawMarker(cx, cy);
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
				ctx.rect(left, top, w, h);
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
				drawArtRegionSprite(ctx, cell.assetKey, cell.assetKey, symTransform);
				ctx.restore();
			}
		}

		ctx.lineWidth = 2;
		ctx.strokeStyle = '#5db0ff';
		ctx.strokeRect(left, top, w, h);
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
		const params = resolveComponentParams(def, node.params, undefined);
		for (const child of def.root.children) {
			drawNode(ctx, child, sceneCtx, componentDepth + 1, stack, params, true);
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
		const nat = regionNaturalSize(region);
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
		const cx = -dw * ax + (region.offX ?? 0) * scaleX;
		const cy = -dh * ay + (region.offY ?? 0) * scaleY;
		// On-page packed rect: a `rotated` frame is stored (h × w) — swap.
		const pw = region.rotated ? region.h : region.w;
		const ph = region.rotated ? region.w : region.h;
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
			// `<Text anchor={{x:0.5,y:0}}>` in the resolved `fontFamily` (proxima-nova by
			// default) at the resolved `fontSize` (UiLabel base 45), normal weight — i.e.
			// horizontally centred, TOP-anchored at the node origin. The old hardcoded
			// `600 30px sans-serif`, vertically centred, was the editor↔game mismatch.
			ctx.textBaseline = 'top';
			const size = typeof style.fontSize === 'number' ? Math.max(8, style.fontSize) : 45;
			const family = style.fontFamily ?? 'proxima-nova';
			ctx.font = `${size}px ${family}, sans-serif`;
			ctx.fillStyle = fill ?? '#ffffff';
			ctx.fillText(label, 0, 0);
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

	/** rAF loop (run only while `hasBoneRiders`): read the spine layers' published rider
	 * transforms + draw each stand-in symbol on `riderCanvas`, in the SAME world→screen mapping
	 * as everything else (`setTransform(dpr) · pan · zoom`). Self-sizes the canvas so it overlays
	 * the base 1:1. Cheap when the map is empty (a clear + early out). */
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

	/** Clear the rider overlay (on stop / when no riders remain). */
	function clearRiderCanvas(): void {
		const c = riderCanvas;
		if (!c) return;
		const ctx = c.getContext('2d');
		if (!ctx) return;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, c.width, c.height);
	}

	/** Draw one stand-in symbol at its published world transform: the real preview atlas region
	 * when set + resolvable, else a labelled symbol-sized box. `base` is the symbol size in world
	 * px; the published `scaleX`/`scaleY` (symbolScale × the bone's world scale) size the box. */
	function drawRiderSymbol(ctx: CanvasRenderingContext2D, r: BoneRiderTransform, base: number): void {
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
	function drawRiderRegion(ctx: CanvasRenderingContext2D, ref: string, w: number, h: number): boolean {
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

	// Run the rider overlay's rAF only while a bone-riding component is present; stop + clear
	// otherwise so the overlay never spins idle or strands a stale symbol.
	$effect(() => {
		if (hasBoneRiders) {
			if (!riderRaf) riderRaf = requestAnimationFrame(drawRiders);
		} else if (riderRaf) {
			cancelAnimationFrame(riderRaf);
			riderRaf = 0;
			boneRiders.clear();
			clearRiderCanvas();
		}
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
		const box = nodeBox(node, t, naturalSize, componentMap, layoutType);
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
		ctx.lineWidth = 1.5;
		ctx.strokeStyle = accent;
		ctx.beginPath();
		ctx.moveTo(corners[0].x, corners[0].y);
		for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
		ctx.closePath();
		ctx.stroke();

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
		const box = nodeBox(node, t, naturalSize, componentMap, layoutType);
		const corners = nodeCornersWorld(t, box).map(worldToScreen);
		const top = worldToScreen(topMidWorld(t, box));
		const rot = t.rotation ?? 0;
		const stem = {
			x: top.x + Math.sin(rot) * ROTATE_OFFSET_PX,
			y: top.y - Math.cos(rot) * ROTATE_OFFSET_PX,
		};
		const rGrab = ROTATE_PX + 4;
		if (Math.hypot(screen.x - stem.x, screen.y - stem.y) <= rGrab) return { kind: 'rotate' };
		const grab = HANDLE_PX / 2 + 3;
		for (let i = 0; i < 4; i++) {
			const c = corners[i];
			if (Math.abs(screen.x - c.x) <= grab && Math.abs(screen.y - c.y) <= grab) {
				return { kind: 'corner', idx: i };
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
			const box = nodeBox(node, t, naturalSize, componentMap, layoutType);
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
	function startScale(node: LayoutNode, cornerIdx: number, world: Vec2): void {
		const t = nodeTransform(node);
		const box = nodeBox(node, t, naturalSize, componentMap, layoutType);
		dragMode = {
			kind: 'scale',
			nodeId: node.id,
			cornerIdx,
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
		// Default: uniform scale (use average of the two abs ratios, signed by the corner). Shift = non-uniform.
		if (!shift) {
			const avg = (Math.abs(sxRatio) + Math.abs(syRatio)) / 2;
			sxRatio = Math.sign(sxRatio || 1) * avg;
			syRatio = Math.sign(syRatio || 1) * avg;
		}
		const MIN = 0.05;
		let newSx = d.startScale.x * sxRatio;
		let newSy = d.startScale.y * syRatio;
		if (Math.abs(newSx) < MIN) newSx = Math.sign(newSx || 1) * MIN;
		if (Math.abs(newSy) < MIN) newSy = Math.sign(newSy || 1) * MIN;
		writeScale(node, newSx, newSy);
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
		const box = nodeBox(node, t, naturalSize, componentMap, layoutType);
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
			const ob = nodeBox(other, ot, naturalSize, componentMap, layoutType);
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
		// Forced repaint signal (undo/redo): a position-only restore reassigns `scenes`
		// but changes no node count, so without this the composite can stay stale.
		void redrawNonce;
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
		const box = nodeBox(node, t, naturalSize, componentMap, layoutType);
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
		if (layoutType === 'desktop') {
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
			const i = dragMode.cornerIdx;
			return i === 0 || i === 2 ? 'cursor-nwse' : 'cursor-nesw';
		}
		if (hoverHandle?.kind === 'rotate') return 'cursor-grab';
		if (hoverHandle?.kind === 'corner') {
			const i = hoverHandle.idx;
			return i === 0 || i === 2 ? 'cursor-nwse' : 'cursor-nesw';
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
	{#each visibleGameScenes() as s, i (s.id)}
		<div class="scene-group" style="z-index:{i + 1}">
			<canvas class="scene-2d" use:registerSceneCanvasAction={s.id}></canvas>
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
					{frameWidth}
					{frameHeight}
					reloadToken={fontReload}
					onLoadingChange={(c) => {
						mergeFontLoading(s.id, c);
					}}
					onReadyIdsChange={(ids) => {
						mergeTextReady(s.id, ids);
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
				worldTransformOf={nodeTransform}
				reloadToken={spineReload}
				{hiddenSceneIds}
				sceneFilter={hudSpineSceneFilter()}
				activeSceneId={null}
				playing={playingSpines}
				onReadyKeysChange={(keys) => {
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
				{frameWidth}
				{frameHeight}
				reloadToken={fontReload}
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
		<div class="load-overlay" role="status" aria-live="polite">
			<div class="load-card">
				<div class="spinner"></div>
				<div class="load-text">
					<span class="load-title">Loading assets…</span>
					<span class="load-count">{loadDone} / {batchTotal}</span>
				</div>
				<div class="load-bar"><div class="load-bar-fill" style="width:{loadPct}%"></div></div>
			</div>
		</div>
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
		/* One composite group per game scene; z-index (set inline by scene order) makes
		   a later scene's whole group — its 2D + spine + text — sit above an earlier
		   scene's group. Input passes through to the base canvas underneath. */
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
		color: #666;
		font-size: 11px;
		pointer-events: none;
		text-shadow: 0 1px 2px #000;
	}
	.canvas-actions {
		position: absolute;
		top: 10px;
		right: 10px;
		display: flex;
		gap: 6px;
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
	.load-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;
		background: rgba(11, 11, 16, 0.55);
		backdrop-filter: blur(1px);
	}
	.load-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding: 22px 28px;
		min-width: 220px;
		background: #14141c;
		border: 1px solid #2a2430;
		border-radius: 12px;
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
	}
	.spinner {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 3px solid #2a2a36;
		border-top-color: #7ee0c0;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.load-text {
		display: flex;
		align-items: baseline;
		gap: 10px;
	}
	.load-title {
		color: #e8e8ee;
		font-size: 13px;
		letter-spacing: 0.02em;
	}
	.load-count {
		color: #888;
		font-size: 12px;
		font-family: ui-monospace, monospace;
	}
	.load-bar {
		width: 100%;
		height: 4px;
		border-radius: 999px;
		background: #2a2a36;
		overflow: hidden;
	}
	.load-bar-fill {
		height: 100%;
		background: #7ee0c0;
		border-radius: 999px;
		transition: width 0.2s ease;
	}
</style>
