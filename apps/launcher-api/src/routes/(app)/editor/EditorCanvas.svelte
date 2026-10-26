<script lang="ts">
	import {
		backgroundCoverAnchor,
		backgroundCoverScale,
		backgroundCoverStretch,
		backgroundFit,
		bindingFrameIndex,
		boundComponentDefault,
		boundComponentRidesBone,
		boundComponentSkin,
		boundComponentTileImage,
		boundFillShare,
		boundFrameOutput,
		builtinSheetIdForRegion,
		builtinSheetKey,
		canBlendKind,
		canvasCompositeOp,
		cssBlendMode,
		computeOverlayPlacement,
		coverTransform,
		fillMaskRect,
		hostedComponentSpace,
		instancePreviewRigBundle,
		coversBackgroundWindow,
		isBackgroundCoverKind,
		isCoverFitKind,
		isHudScene,
		keyableElementFxEntries,
		tapOverlayDim,
		MAX_COMPONENT_DEPTH,
		parseScopedFrameRef,
		aspectBox,
		POT_FILL_DIRECTIONS,
		POT_PREVIEW_FILL_SHARE,
		resolveAnchorPreviewArt,
		resolveBoundValue,
		forwardInstanceParams,
		resolveComponentParams,
		resolveLayoutInstanceParams,
		anchoredPosition,
		isCountRepeater,
		repeaterComponentIds,
		resolveTransform,
		STANDARD_MAIN_SIZES_MAP,
		type BlendMode,
		type ComponentDef,
		type ComponentInstanceNode,
		type CountRepeaterNode,
		type EffectDoc,
		type EffectNode,
		type LayoutNode,
		type LayoutType,
		type OverlayPlacement,
		type PartSkinBinding,
		type PlacementGeometry,
		type ResolvedPreviewArt,
		type ResolvedTransform,
		type EditorGuides,
		type SliceMode,
		type Scene,
	} from 'engine-layout';
	import type { EffectParamValues } from 'engine-fx';
	import { onDestroy, onMount, untrack, type Snippet } from 'svelte';
	import {
		childLocalTransform,
		composeWorldMatrix,
		IDENTITY_AFFINE,
		invertAffine,
		matMul,
		type Affine,
		depthSegments,
		inDepthSlice,
		instanceDef,
		mergeSpreadBoxes,
		type DepthSegment,
		type DepthSlice,
		type SpreadBox,
		isPartSkinned,
		nodeBox,
		nodeCornersWorld,
		partSkinArtSize,
		partSkinImage,
		partSkinSize,
		repeaterPlaceholderGrid,
		repeaterBoxes,
		newCountRepeater,
		repeaterCountBoxes,
		REPEATER_SEGMENT_PLACEHOLDER,
		spawnLayerPlaceholder,
		resizeOriginShift,
		resizePivot,
		topMidWorld,
		pointInQuad,
		reelGridGeometry,
		type ReelGridSeat,
		resolveBoneRiderRigKey,
		standardToWorld,
		SCREEN_NEST,
		type BoneRiderTransform,
		type ComponentNest,
		type Vec2,
		type NodeBox,
		type NaturalSize,
		type RepeaterSourceMap,
	} from './editorCanvas.helpers';
	import {
		clearRegionCache,
		canvasImageUrl,
		fetchRegions,
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
	import {
		artSliceOf,
		artSlicesVersion,
		clearArtSlicesCache,
		loadArtSlices,
	} from './editorArtSlices.client.svelte';
	import { drawNineSlice } from './nineSliceDraw';
	import {
		onionPreview,
		onionResolveTransform,
		previewBindings,
		previewEffectParamValues,
		previewOutputs,
		previewDrawnTransform,
		previewElementFxNodeIds,
		previewElementFxPose,
		previewPoseTransform,
		previewResolveTransform,
		previewTimelineActive,
		previewTint,
		previewVersion,
		isViewHidden,
		setFxPreviewHidden,
	} from './valuePreview.client.svelte';
	import type { StageTransformDelta } from '$lib/timeline/screenTimeline';
	import { segmentPoseNodes } from '$lib/timeline/segmentPreview';
	import { segmentTimelines, segmentTimelinesVersion } from './segmentTimelines.client.svelte';
	import { setAnimateDragging } from './animateKeying.client.svelte';
	import { dialogQueue } from '$lib/dialogs.svelte';
	import {
		ancestorIds,
		effectiveHiddenIds,
		firstChildIdOf,
		lockedInTree,
		parentIdOf,
	} from '$lib/editor/hierarchy';
	import type { ElementFxEntry } from 'constants-shared/elementFx';
	import {
		addElementFxPreviewHandler,
		afterFrames,
		captureStill,
		coverStage,
		drawStill,
		intersectRect,
		isFxOverlayCanvas,
		playOnStill,
		posedPastRest,
		poseOnStill,
		stageSource,
		type ElementFxPreviewTarget,
		type PosedOverlay,
		type StageRect,
		type StillSource,
	} from './elementFxPreview.client.svelte';
	import { findById, flattenSceneIds } from './layoutTree.client';
	import {
		isTypingTarget,
		ownsFocusKeys,
		SHORTCUT_SHEET,
		stageShortcut,
		ZOOM_STEP,
		type StageAction,
	} from '$lib/editor/stageShortcuts';
	import { worldCameraFrames } from '$lib/editor/worldCameraEdit';
	import BusyOverlay from '$lib/BusyOverlay.svelte';
	import { deepHit } from '$lib/timeline/listenerPreview';
	import EditorItemOverlay from './EditorItemOverlay.svelte';
	import EditorEffectLayer from './EditorEffectLayer.svelte';
	import EditorRigLayer from './EditorRigLayer.svelte';
	import {
		applyGuideDrag,
		hitGuide,
		RULER_PX,
		rulerStep,
		rulerTicks,
		type GuideAxis,
	} from './editorRulers';
	import type { RigMeta } from './rigRuntime.client';
	import EditorTextLayer from './EditorTextLayer.svelte';
	import { clearFontCatalogCache } from './fonts.client';
	import { clearPageImages } from './RegionThumb.svelte';

	interface AssetDragPayload {
		// `text` / `rect` are not assets — they're blank ELEMENTS the
		// Library's "Elements" palette drags in (key is unused for those).
		// `effect` carries an authored FX id in `key` (the Library's Effects section);
		// `flipbook` an authored clip id (the Library's Flipbooks section); `component` a component
		// id (the Component Editor's Components section), placed as an instance pinned to `version`.
		kind:
			| 'atlas-page'
			| 'atlas-manifest'
			| 'sheet'
			| 'spine'
			| 'text'
			| 'rect'
			| 'effect'
			| 'flipbook'
			| 'component'
			| 'segments';
		key: string;
		name: string;
		version?: number;
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
		/** The animation the STATIC state plays in-game (`SymbolRigMain`'s `animationName`) —
		 * the rig layer auto-loops it so the board preview shows the same pose the game does. */
		animationName?: string;
		/** Tool-only rig resolver hint on a CODED default cell (`<folder>/<stem>`) — the
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
		 * for `bind` anchors (rig bundle by name, sprite region by manifest scan). */
		assets: ProjectAssets;
		/** The project's coded symbol defaults — the dense source of truth for each
		 * symbol's STATIC binding (sprite frame / rig bundle). Lets the canvas draw the
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
		/** EDITOR-PREVIEW ONLY: forwarded to `EditorRigLayer` — while the author focuses a rig
		 * param in the Properties panel, override the selected instance's bind rig to this bundle +
		 * animation (WYSIWYG). Applies only to {@link rigPreviewNodeId}. Never written to the doc. */
		rigPreview?: { bundle?: string; animation?: string } | null;
		rigPreviewNodeId?: string;
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
		/** The Scene Editor's "In-game view" (bindable; the page picks the screens). While on, a
		 * component part with no art bound draws nothing, as in the game, instead of its labelled
		 * placeholder. Absent (the Component Editor) ⇒ no toggle and placeholders always draw. */
		gameView?: boolean;
		/** The game modes In-game view can show besides the base game. Empty ⇒ no mode menu. */
		viewModes?: { id: string; label: string }[];
		/** The mode In-game view shows (bindable; `undefined` = the base game). */
		viewMode?: string;
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
		/** Where the top-level nodes sit in the game's component nesting (`ComponentNest`): a
		 *  screen's at level 0 (the default), the Component Editor's open def one level down. */
		componentNest?: ComponentNest;
		/**
		 * Per-project component DEFAULTS by component id (§13.3) — the `projectDefaults`
		 * layer `resolveComponentParams` applies UNDER each placed instance's own params, so
		 * a shared def carrying this project's appearance previews as the game renders it.
		 * Distinct from `componentParams` above (that is the Component Editor's already-resolved
		 * params for its ONE open def). Empty (the default) ⇒ every resolve passes `undefined`
		 * exactly as before — parity.
		 */
		componentDefaults?: Record<string, Record<string, unknown>>;
		/** Bubbles the merged `assetKey → {animations,skins}` map for every ready rig
		 * bundle (union across the per-scene sublayers) up to the page, so the Properties
		 * panel can offer animation/skin dropdowns instead of free-text. */
		onRigMeta?: (meta: Map<string, RigMeta>) => void;
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
		/** Animate mode (Rive plan Phase 3): the canvas never edits the authored pose — no drop,
		 * delete or item toolbar, and a drag only keys (`onAnimateTransform`). Absent ⇒ Design. */
		animate?: boolean;
		/** Animate (Rive plan Phase 9b): a drag, scale or rotate on the stage keys the timeline. The
		 *  gesture runs on the Design pose as in Design, then the pose is put back and what changed is
		 *  handed here (per node: design px moved, the scale ratio, degrees turned). Absent ⇒ the
		 *  Animate stage is select-only. */
		onAnimateTransform?: (deltas: StageTransformDelta[]) => void;
		/** Double-click on a placed component instance: edit its def in place (Rive plan Phase 4).
		 * Absent ⇒ a double-click does nothing beyond the two clicks. */
		onEditInstance?: (node: ComponentInstanceNode) => void;
		/** The State Machine preview's pointer (Rive plan Phase 6b): in Animate, every move, press
		 *  and release over the stage, with the DEEPEST node under it (into containers), so the
		 *  preview can drive the component's listeners. Absent ⇒ the stage only selects. */
		onStagePointer?: (kind: 'move' | 'down' | 'up' | 'leave', nodeId: string | null) => void;
		/** Right-click on a placed component instance: *Show in Flow* (Rive plan §6.2 step 4).
		 * Absent ⇒ no context menu (a right-drag still pans). */
		onShowInFlow?: (node: ComponentInstanceNode) => void;
		/** "Any screen" picking (bindable; the Scene Editor persists it). While on, a plain click
		 *  takes the topmost node drawn under the pointer on any screen the canvas shows, stacked as
		 *  drawn: HUD screens over game screens, a later screen over an earlier one. Shift-click
		 *  stays on the edited screen. */
		pickAnyScreen?: boolean;
		/** Edit screen `sceneId` with `nodeId` selected: the page makes it the edited screen. Absent
		 *  (the Components side, Animate) ⇒ no "Any screen" toggle; clicks stay on the edited screen. */
		onPickInScene?: (sceneId: string, nodeId: string) => void;
		/** `Tab` (Rive plan Phase 9a): flip Design / Animate. Absent ⇒ `Tab` keeps its native focus move. */
		onToggleMode?: () => void;
		/** `X`: scroll the Outline to the selected node, expanding its containers. */
		onRevealSelection?: (id: string) => void;
		/** The edited screen's / component's ruler guides for this device layout (editor-only). */
		guides?: EditorGuides;
		/** A guide was added, moved or removed. Absent ⇒ the rulers show, guides can't be edited. */
		onGuidesChange?: (next: EditorGuides) => void;
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
		rigPreview = null,
		rigPreviewNodeId,
		onSpawn,
		selectedIds = $bindable([]),
		onDirty,
		onDelete,
		onDeleteMany,
		redrawNonce = 0,
		fillRequest = null,
		hiddenSceneIds = new Set<string>(),
		gameView = $bindable(),
		viewModes = [],
		viewMode = $bindable(),
		projectGameName = null,
		componentParams = {},
		componentNest = SCREEN_NEST,
		componentDefaults = {},
		onRigMeta,
		canUndo = false,
		canRedo = false,
		onUndo,
		onRedo,
		modeBar,
		animate = false,
		onAnimateTransform,
		onEditInstance,
		onStagePointer,
		onShowInFlow,
		pickAnyScreen = $bindable(false),
		onPickInScene,
		onToggleMode,
		onRevealSelection,
		guides,
		onGuidesChange,
	}: Props = $props();

	/** The box a `standard`-space node fits against (`standardToWorld`), shared with the rig layer. */
	const standardFrameBox = $derived(standardBox ?? STANDARD_MAIN_SIZES_MAP[layoutType]);

	/** Clicks reach every drawn screen (see {@link pickAnyScreen}). */
	const pickAcross = $derived(pickAnyScreen && onPickInScene !== undefined);
	/** The node a plain click would pick on ANOTHER screen, outlined while hovered. */
	let hoverPick = $state<{ sceneId: string; nodeId: string } | null>(null);

	// The instance context menu (Rive plan §6.2 step 4): a right-CLICK (not a right-drag, which pans)
	// on a placed instance offers *Show in Flow* and *Edit component in place*. Decided on the
	// right button's mouse-UP — `contextmenu` fires on mouse-down on macOS and Linux, before any
	// drag could be told from a click — so the native menu is only ever suppressed there. Rendered
	// only while open, so a closed menu captures no pointer or keyboard input; a mousedown outside
	// it or Escape closes it.
	let instanceMenu = $state<{ x: number; y: number; node: ComponentInstanceNode } | null>(null);
	let instanceMenuEl: HTMLDivElement | undefined = $state();
	let rightDownXY: [number, number] | null = null;
	function openInstanceMenuAt(e: MouseEvent): void {
		const down = rightDownXY;
		rightDownXY = null;
		if (!down || (!onShowInFlow && !onEditInstance)) return;
		if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
		const node = hitTestNode(clientToWorld(e.clientX, e.clientY));
		if (node?.kind !== 'componentInstance') return;
		instanceMenu = { x: e.clientX, y: e.clientY, node };
	}
	function closeInstanceMenu(e?: Event): void {
		if (e && instanceMenuEl && e.target instanceof Node && instanceMenuEl.contains(e.target))
			return;
		instanceMenu = null;
	}
	$effect(() => {
		if (!instanceMenu) return;
		// Any key closes it: a Delete meant for the selection must not land under an open menu.
		const onKey = (): void => closeInstanceMenu();
		window.addEventListener('mousedown', closeInstanceMenu);
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('mousedown', closeInstanceMenu);
			window.removeEventListener('keydown', onKey);
		};
	});

	/** Each symbol's STATIC binding for the reel preview: the coded default's `static`
	 * cell, with the override doc's `static` cell layered on top (sparse). Computed once
	 * (not per draw), and cycled across the grid cells so the board looks populated. A
	 * `spine` static is drawn by `EditorRigLayer` (WebGL) — this list is the SAME one it
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
				// A coded default rig cell resolves through its `previewKey` (the specific
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
	 * `symbolStatics` (not beside `hasRigSymbol`) because `nodesHaveFlipbook` reads it. */
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
	 *   the standard box; still honours the scene's `align`), via the shared `standardToWorld`.
	 */
	function nodeTransform(
		node: LayoutNode,
		sceneCtx: Scene = scene,
		resolve: typeof resolveTransform = resolveTransform,
	): ResolvedTransform {
		const space = sceneCtx.space;
		const t = resolve(node, layoutType);
		// A preview-art bind anchor (e.g. the animated Background, the Win animation, or
		// the free-spin counter) is placed by its catalog `placement`, resolved against
		// the game's geometry: cover/contain size to the frame; board-relative ones land
		// at a MAIN-coord spot mapped to the canvas like `<MainContainer>` does.
		const art = anchorArt(node);
		if (art) {
			return placedArtTransform(node, t, art.placement);
		}
		// No resolvable preview art (e.g. the component's rig isn't in THIS project),
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
			hostedComponentSpace(instanceDef(componentMap, node)) === 'game'
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
			return standardToWorld(t, standardFrameBox, sceneCtx.align, frameWidth, frameHeight);
		}
		// A `coverFit` sprite/rig/flipbook in a `canvas`-space (flow-gated) scene cover-fits the
		// window with the SAME true-cover helper the `background` path uses — mirroring the
		// runtime `LayoutNodeView` (`isCanvasCoverFit`), so the preview is WYSIWYG. Scoped to
		// sprite/rig/flipbook (a componentInstance cover stays background-only). Checked BEFORE
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
		if (space === 'background') {
			if (isBackgroundCoverKind(node)) {
				return backgroundTransform(node, t);
			}
			// Everything ELSE on a background screen (a text label, a bare container) does
			// NOT cover — and the game draws it at RAW WINDOW pixels: `LayoutScene` wraps only
			// `game`/`standard` in a `<MainContainer>`, and `anchoredPosition` returns x/y verbatim
			// for this space. Without this branch such a node fell through to the game-space
			// mapping below, so the editor drew it main-box-mapped (a different spot AND a
			// different scale) while the game shipped it at its raw coords — the same drift that
			// was already fixed for `canvas` space, in the same function, for the same reason.
			return { ...t, ...anchoredPosition(t, space, frameWidth, frameHeight) };
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

	/** {@link nodeTransform} with the value-binding preview folded on — what the draw-only overlays
	 *  (rig, text, effects) place a top-level node by. Never used for a geometry edit. */
	function drawTransform(node: LayoutNode, sceneCtx: Scene = scene): ResolvedTransform {
		return nodeTransform(node, sceneCtx, previewResolveTransform);
	}

	/** {@link drawTransform} for the hit tests and the selection: a node an Element FX still stands
	 *  in for is hit and framed where it draws, though the layers skip it. */
	function poseTransform(node: LayoutNode, sceneCtx: Scene = scene): ResolvedTransform {
		return nodeTransform(node, sceneCtx, previewPoseTransform);
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
		// Every cover input is read for the ACTIVE layoutType (this bucket's override first, then
		// the base) through the shared readers, so the ratio tabs preview the per-layout fit / zoom
		// / stretch / alignment the game will run. The node's ANCHOR is the alignment of the fitted
		// art in the window; the drawn pivot below stays fixed (0.5 for art, 0 for a composed
		// instance) and the alignment rides in `cover.x`/`cover.y`.
		const stretch = backgroundCoverStretch(node, layoutType);
		const coverScale = backgroundCoverScale(node, layoutType);
		const fit = backgroundFit(node, layoutType);
		const anchor = backgroundCoverAnchor(node, layoutType);
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
				anchorX: anchor.x,
				anchorY: anchor.y,
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
		// A flat `rect` has no art to measure: it covers by its own width × height, as the runtime's
		// `rectCover` does, so a `contain` fit or a cover zoom letterboxes it the same in both.
		const nat =
			node.kind === 'rect'
				? { w: t.width ?? node.width, h: t.height ?? node.height }
				: naturalSize(node);
		const cover = coverTransform({
			artWidth: nat?.w ?? frameWidth,
			artHeight: nat?.h ?? frameHeight,
			targetWidth: frameWidth,
			targetHeight: frameHeight,
			coverScale,
			stretchX: stretch.x,
			stretchY: stretch.y,
			fit,
			anchorX: anchor.x,
			anchorY: anchor.y,
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
		// — the SAME true-cover helper the game runtime + the rig overlay use. The
		// cover placement reads the node's DOC-DRIVEN fit + cover scale (§10.3 step 4)
		// so this 2D path stays unified with `backgroundTransform` + the rig layer;
		// the contain placement (centred overlays) is always contain at scale 1.
		const isCover = result.mode === 'cover';
		const fit = isCover ? backgroundFit(node, layoutType) : 'contain';
		const coverScale = isCover ? backgroundCoverScale(node, layoutType) : 1;
		const stretch = isCover ? backgroundCoverStretch(node, layoutType) : { x: 1, y: 1 };
		const anchor = isCover ? backgroundCoverAnchor(node, layoutType) : { x: 0.5, y: 0.5 };
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
			anchorX: anchor.x,
			anchorY: anchor.y,
		});
		const width = artW * cover.scaleX;
		const height = artH * cover.scaleY;
		// cover (full-bleed Background) ignores the offset — it stays non-draggable and
		// pinned to the frame, positioned by the cover's own anchor alignment. contain
		// (centred overlays) stays frame-centred and honours the draggable offset.
		const applyOffset = fit === 'contain';
		return {
			...t,
			x: cover.x + (applyOffset ? offX : 0),
			y: cover.y + (applyOffset ? offY : 0),
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
			hostedComponentSpace(instanceDef(componentMap, node)) === 'game'
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
	 * via the Properties `scale.x` control. This covers BOTH a node that covers a
	 * `background` screen (`coversBackgroundWindow`) AND a `cover`-placement preview anchor
	 * (the full-bleed Background).
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
			scene.space === 'background' &&
			coversBackgroundWindow(
				node,
				scene.nodes.some((n) => n.id === node.id),
			)
		);
	}

	let canvas: HTMLCanvasElement | null = $state(null);
	// Top-most 2D layer for the HUD: it sits ABOVE the rig/FX overlay so the HUD
	// draws on top (matching the game, where the HUD is the top UI layer). The base
	// `canvas` draws the game scenes + frame BELOW the rig layer.
	let hudCanvas: HTMLCanvasElement | null = $state(null);
	let wrap: HTMLDivElement | null = $state(null);

	// ---------- bone-ridden stand-in symbol overlay (Scene Editor preview) ----------
	// SHARED, non-reactive sink the per-scene rig layers write each frame (they OWN the
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
				/** The scale the node DRAWS at — {@link startScale} in Design, the animated scale in an
				 *  Animate drag, so the handle tracks the art the author grabbed. */
				startDrawScale: Vec2;
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
	/** The axis of the ruler guide under the pointer, for its resize cursor. */
	let hoverGuideAxis = $state<GuideAxis | null>(null);
	let hoverHandle = $state<HandleHit | null>(null);
	let snapLines = $state<SnapLine[]>([]);
	/** Rig node ids whose preview animation is playing (static otherwise). */
	let playingRigs = $state<Set<string>>(new Set());
	/** `assetKey`s the rig overlay renders as real skeletons — the 2D canvas
	 * skips their placeholder box so only the live preview shows. UNION across the
	 * per-scene rig sublayers (each reports only its own scene's keys). */
	let readyRigKeys = $state<Set<string>>(new Set());
	/** Setup-pose natural size per rig `assetKey`, reported by the WebGL overlay —
	 * lets the 2D canvas cover-fit `preview.art` rig anchors by the art's aspect — with
	 * where the skeleton origin sits in that box (`ax`/`ay`).
	 * MERGED across the per-scene rig sublayers. */
	let rigNaturalSizes = $state<Map<string, NaturalSize>>(new Map());
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
	 * ABOVE every art/rig/FX layer — so the screen bounds stay visible once stacked art buries
	 * the base-canvas guides (which sit at the bottom of the z-stack). Off by default. */
	let showScreenBorder = $state(false);

	// ---------- rulers + guides (P10.9) ----------
	// Editor view state, kept per browser; the guides themselves are the screen's / component's.
	const RULERS_KEY = 'ie.editor.rulers';
	const SNAP_GUIDES_KEY = 'ie.editor.snapGuides';
	function readFlag(key: string, fallback: boolean): boolean {
		try {
			const stored = localStorage.getItem(key);
			return stored === null ? fallback : stored === '1';
		} catch {
			return fallback;
		}
	}
	function writeFlag(key: string, on: boolean): void {
		try {
			localStorage.setItem(key, on ? '1' : '0');
		} catch {
			/* private window / blocked storage: the toggle still works for this page */
		}
	}
	// Off until asked for, so the canvas edges stay as they were for everyone else.
	let showRulers = $state(readFlag(RULERS_KEY, false));
	let snapToGuides = $state(readFlag(SNAP_GUIDES_KEY, true));
	let rulerTop: HTMLCanvasElement | null = $state(null);
	let rulerLeft: HTMLCanvasElement | null = $state(null);
	/** A guide being dragged: a new one off a ruler (`index` null) or an existing one. */
	let guideDrag = $state<{
		axis: GuideAxis;
		index: number | null;
		value: number;
		remove: boolean;
		/** The guide's value when grabbed: an undo or a layout switch mid-drag leaves it alone. */
		from?: number;
	} | null>(null);
	/** The guides as drawn: the stored ones with an in-flight drag applied. */
	function drawnGuides(): EditorGuides | undefined {
		return guideDrag ? applyGuideDrag(guides, guideDrag) : guides;
	}
	/** What the live particle overlay applies to a placed effect's exposed parameters: the binding
	 * test values and the previewed timeline, through the game's fold (Invisible FX Step 2). */
	const effectPreviewValues = (
		node: EffectNode,
		doc: EffectDoc,
		params: Readonly<Record<string, unknown>>,
	): EffectParamValues | undefined => previewEffectParamValues(node, doc.params, params);
	/** Effect NODE ids the live particle overlay (`EditorEffectLayer`) now renders — the 2D canvas
	 * skips their placeholder chip so only the live emitters show. UNION across the per-scene effect
	 * sublayers (each reports only its own scene's node ids). */
	let liveEffectIds = $state<Set<string>>(new Set());
	/** Measured particle SPREAD per effect NODE id (running-MAX rect in node-local / scene-world
	 * units — `x`/`y` are the top-left offset from the node origin), reported by the live overlay so
	 * the selection box + hit-test fit the real particles instead of the fixed placeholder. UNION
	 * across the per-scene effect sublayers (`mergeSpreadBoxes`), so a part placed in several gets
	 * one box enclosing every placement. */
	let effectBounds = $state<Map<string, SpreadBox>>(new Map());

	// Per-scene report buffers: each sublayer is filtered to one scene, so the 2D
	// canvas folds their reports together (union of ready keys/ids + merged natural
	// sizes; summed load tallies) to keep its placeholder/progress logic unchanged.
	const rigReadyByScene = new Map<string, Set<string>>();
	const rigNaturalByScene = new Map<string, Map<string, NaturalSize>>();
	const rigMetaByScene = new Map<string, Map<string, RigMeta>>();
	const textReadyByScene = new Map<string, Set<string>>();
	const textMeasuredByScene = new Map<string, Map<string, { w: number; h: number }>>();
	const effectReadyByScene = new Map<string, Set<string>>();
	const effectBoundsByScene = new Map<string, Map<string, SpreadBox>>();
	const rigLoadByScene = new Map<string, { started: number; settled: number }>();
	const fontLoadByScene = new Map<string, { started: number; settled: number }>();

	function mergeRigReady(sceneId: string, keys: Set<string>): void {
		rigReadyByScene.set(sceneId, keys);
		const union = new Set<string>();
		for (const set of rigReadyByScene.values()) for (const k of set) union.add(k);
		readyRigKeys = union;
	}
	function mergeRigNatural(sceneId: string, sizes: Map<string, NaturalSize>): void {
		rigNaturalByScene.set(sceneId, sizes);
		const merged = new Map<string, NaturalSize>();
		for (const m of rigNaturalByScene.values()) for (const [k, v] of m) merged.set(k, v);
		rigNaturalSizes = merged;
	}
	function mergeRigMeta(sceneId: string, meta: Map<string, RigMeta>): void {
		rigMetaByScene.set(sceneId, meta);
		const merged = new Map<string, RigMeta>();
		for (const m of rigMetaByScene.values()) for (const [k, v] of m) merged.set(k, v);
		onRigMeta?.(merged);
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
	function mergeEffectBounds(sceneId: string, bounds: Map<string, SpreadBox>): void {
		effectBoundsByScene.set(sceneId, bounds);
		effectBounds = mergeSpreadBoxes(effectBoundsByScene.values());
	}
	function mergeRigLoading(sceneId: string, c: { started: number; settled: number }): void {
		rigLoadByScene.set(sceneId, c);
		let started = 0;
		let settled = 0;
		for (const v of rigLoadByScene.values()) {
			started += v.started;
			settled += v.settled;
		}
		rigStarted = started;
		rigSettled = settled;
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
		sceneFilters.delete(id);
		forgetReportKey(id);
	}

	/**
	 * Drop every report buffer and run cache filed under `key` or a key built on it, then recompute
	 * the merged unions/sums. A scene's surfaces report under its id, its later depth segments under
	 * `<sceneId>#seg<i>` and its blended overlays under `<key>#blend:<mode>`, so the `#` prefix
	 * reaches all of them. A leftover buffer would keep a removed rig "ready" and its placeholder off.
	 */
	function forgetReportKey(key: string): void {
		const prefix = `${key}#`;
		const owned = (k: string): boolean => k === key || k.startsWith(prefix);
		for (const map of [
			rigReadyByScene,
			rigNaturalByScene,
			rigMetaByScene,
			textReadyByScene,
			textMeasuredByScene,
			effectReadyByScene,
			effectBoundsByScene,
			rigLoadByScene,
			fontLoadByScene,
		] as Map<string, unknown>[]) {
			for (const k of [...map.keys()]) if (owned(k)) map.delete(k);
		}
		for (const cache of [
			blendRunCache,
			blendOverlayCache,
			normalOverlayCache,
			textOverlayCache,
			depthSliceCache,
		] as Record<string, unknown>[]) {
			for (const k of Object.keys(cache)) if (owned(k)) delete cache[k];
		}
		const meta = new Map<string, RigMeta>();
		for (const m of rigMetaByScene.values()) for (const [k, v] of m) meta.set(k, v);
		onRigMeta?.(meta);
		const keys = new Set<string>();
		for (const set of rigReadyByScene.values()) for (const k of set) keys.add(k);
		readyRigKeys = keys;
		const nat = new Map<string, NaturalSize>();
		for (const m of rigNaturalByScene.values()) for (const [k, v] of m) nat.set(k, v);
		rigNaturalSizes = nat;
		const ids = new Set<string>();
		for (const set of textReadyByScene.values()) for (const tid of set) ids.add(tid);
		readyTextIds = ids;
		const tMeasured = new Map<string, { w: number; h: number }>();
		for (const m of textMeasuredByScene.values()) for (const [k, v] of m) tMeasured.set(k, v);
		textMeasured = tMeasured;
		const effIds = new Set<string>();
		for (const set of effectReadyByScene.values()) for (const eid of set) effIds.add(eid);
		liveEffectIds = effIds;
		effectBounds = mergeSpreadBoxes(effectBoundsByScene.values());
		let ss = 0;
		let sd = 0;
		for (const v of rigLoadByScene.values()) {
			ss += v.started;
			sd += v.settled;
		}
		rigStarted = ss;
		rigSettled = sd;
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
	 * that merely re-splits its runs (an author flips one node to `add`) must keep them. A later
	 * depth segment's buffers go with its own last canvas, when a reorder merges it away. */
	function registerSceneCanvasAction(el: HTMLCanvasElement, run: BlendRun) {
		registerSceneCanvas(run.key, el);
		resizeCanvas();
		schedule();
		return {
			destroy() {
				registerSceneCanvas(run.key, null);
				const mounted = (prefix: string): boolean =>
					[...sceneCanvases.keys()].some((key) => key.startsWith(prefix));
				if (!mounted(`${run.sceneId}#`)) forgetScene(run.sceneId);
				else if (run.segKey !== run.sceneId && !mounted(`${run.segKey}#`))
					forgetReportKey(run.segKey);
			},
		};
	}
	function toggleRigPlay(node: LayoutNode): void {
		const next = new Set(playingRigs);
		if (next.has(node.id)) next.delete(node.id);
		else next.add(node.id);
		playingRigs = next;
	}

	// ---------- asset-load progress (drives the loading overlay) ----------
	// Monotonic counters across the three asset sources: images + atlas/sheet
	// regions (this canvas) and rig bundles (the overlay child, via callback).
	// `started`/`settled` only grow; `pending` is the live in-flight count.
	let imgStarted = $state(0);
	let imgSettled = $state(0);
	let regStarted = $state(0);
	let regSettled = $state(0);
	let rigStarted = $state(0);
	let rigSettled = $state(0);
	let fontStarted = $state(0);
	let fontSettled = $state(0);
	const loadPending = $derived(
		imgStarted -
			imgSettled +
			(regStarted - regSettled) +
			(rigStarted - rigSettled) +
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
	// `rigReload` is forwarded to the rig layer to drop its bundle cache.
	let assetVersion = $state(0);
	let rigReload = $state(0);
	let fontReload = $state(0);

	// Content-version per resolved page key (filled as region sets resolve). Lets a page
	// image bust its cache the instant the atlas changes — the manual `assetVersion`
	// counter is only the fallback for keys with no known content version (e.g. a raw
	// full-image node, not an atlas page).
	const pageVersionByKey = new Map<string, string>();
	const images = new Map<string, HTMLImageElement | null>();
	function ensureImage(key: string): HTMLImageElement | null {
		if (images.has(key)) return images.get(key) ?? null;
		const src = canvasImageUrl(key, pageVersionByKey.get(key) ?? String(assetVersion));
		if (!src) return null;
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
		img.src = src;
		return null;
	}

	/** "Reload art": drop the per-session image + region caches and bump the
	 * cache-bust tokens so updated atlas/rig art is re-fetched from R2 — no full
	 * page reload needed. The 2D images + region pages re-load on the next draw();
	 * the rig layer re-loads via the forwarded `rigReload` token. */
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
		clearArtSlicesCache();
		void loadArtSlices();
		// Drop the cross-atlas name→manifest map too, else a name-resolved sprite keeps
		// pointing at the manifest the previous scan locked onto — Reload art would do
		// nothing for it. Cleared + flagged for rebuild on the next draw().
		spriteRegionIndex = new Map();
		regionScanStarted = false;
		assetVersion++;
		rigReload++;
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
		// placeholder. Resolved from the launcher's vendored copy (the built-in RIG
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
	// The project's 9-slice insets — the same per-region art data, the same degradation.
	void loadArtSlices();

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
	 * playback clock above — mirroring `sceneHasEffect` / `sceneHasRig`. */
	function sceneHasFlipbook(s: Scene): boolean {
		return nodesHaveFlipbook(s.nodes, componentNest.depth, componentNest.stack);
	}
	function nodesHaveFlipbook(nodes: LayoutNode[], depth: number, stack: string[]): boolean {
		for (const n of nodes) {
			if (n.kind === 'flipbook') return true;
			// A reel BOARD whose symbols bind a clip animates its cells too. Without this the clock
			// never starts for a board-only project and every cell would sit frozen on frame 0.
			if (n.kind === 'reelGrid' && hasFlipbookSymbol) return true;
			if (n.kind === 'container' && nodesHaveFlipbook(n.children, depth, stack)) return true;
			if (n.kind === 'componentInstance') {
				const def = instanceDef(componentMap, n);
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
	 * against the project's assets). The 2D canvas + the rig overlay both resolve
	 * through this so they agree on ONE art per anchor. Triggers the lazy sprite-region
	 * scan when a node's catalog default is a sprite the index hasn't located yet. */
	function anchorArt(node: LayoutNode, previewRigBundle?: string): ResolvedPreviewArt | undefined {
		const art = resolveAnchorPreviewArt(
			node,
			assets,
			spriteRegionIndex,
			previewRigBundle,
			layoutType,
		);
		if (art?.kind === 'sprite' && !art.assetKey) ensureRegionIndex();
		return art;
	}

	/** Natural draw size for a node — region size for region sprites, page/native otherwise.
	 * `instanceRigBundle` (threaded by `nodeBox`/`componentInstanceContentBox`) resolves a
	 * nested rig bind's stand-in to the ENCLOSING instance's AUTHORED rig, so its box tracks
	 * that rig's natural bounds instead of the fixed catalog bundle. `instanceParams` (the
	 * enclosing instance's resolved params) resolves a skinned tile part to its picked frame. */
	function naturalSize(
		node: LayoutNode,
		instanceRigBundle?: string,
		instanceParams?: Record<string, unknown>,
	): NaturalSize | null {
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
		// A skinned coded part's own art is its picked layers (`drawPartSkin`); `nodeBox` frames the
		// part's nodes around it.
		const skin = node.bind ? boundComponentSkin(node.bind.component) : undefined;
		const skinArt =
			skin && instanceParams ? partSkinArtSize(skin, instanceParams, tileImageNaturalSize) : null;
		if (skinArt) return skinArt;
		// A coded tile part skinned with a picked frame sizes off that frame (`nodeBox` applies the
		// instance's overrides with `aspectBox`, as the draw does).
		const tile = node.bind ? boundComponentTileImage(node.bind.component) : undefined;
		const tileImage = tile ? instanceParams?.[tile.imageParam] : undefined;
		if (typeof tileImage === 'string' && tileImage) return tileImageNaturalSize(tileImage);
		// A `preview.art` bind anchor borrows the art's natural size (so box/hit-test
		// math frames the rendered art, not an empty container).
		const art = artNaturalSize(node, instanceRigBundle);
		if (art) return art;
		if (node.kind === 'sprite' && node.region) {
			const found = findRegion(node.assetKey, node.region);
			if (!found) return null;
			// A sliced sprite draws its packed art (`drawSlicedRegion`), so it frames that.
			if (node.slice && !isBackgroundCover(node)) return { w: found.region.w, h: found.region.h };
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
		// A directly-placed rig node's natural size comes from the WebGL overlay's
		// setup-pose bounds (the 2D canvas can't measure a skeleton), keyed by the bundle
		// `assetKey` — the same map a `preview.art` rig anchor reads via `artNaturalSize`.
		// It carries where the skeleton origin sits in that box, which `nodeBox` frames by.
		// Without this the box/hit-test falls back to a tiny default (the assetKey is a
		// bundle prefix, never an image key, so the `images` lookup below always misses).
		if (node.kind === 'spine') {
			const sz = rigNaturalSizes.get(node.assetKey);
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
	 * - rig art: the skeleton's setup-pose bounds, reported by the WebGL overlay
	 *   (the 2D canvas can't measure a skeleton). `null` until it resolves. */
	function artNaturalSize(
		node: LayoutNode,
		instanceRigBundle?: string,
	): { w: number; h: number } | null {
		const art = anchorArt(node, instanceRigBundle);
		if (!art) return null;
		if (art.kind === 'sprite' && art.region && art.assetKey) {
			const found = findRegion(art.assetKey, art.region);
			return found ? regionNaturalSize(found.region) : null;
		}
		if (art.kind === 'spine') {
			return rigNaturalSizes.get(art.assetKey) ?? null;
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
		const band = Math.floor(RULER_PX * dpr);
		if (rulerTop && (rulerTop.width !== w || rulerTop.height !== band)) {
			rulerTop.width = w;
			rulerTop.height = band;
		}
		if (rulerLeft && (rulerLeft.width !== band || rulerLeft.height !== h)) {
			rulerLeft.width = band;
			rulerLeft.height = h;
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

	function visibleSceneNodes(sceneCtx: Scene = scene): LayoutNode[] {
		return sceneCtx.nodes.filter(
			(n) => !isViewHidden(n.id) && resolveTransform(n, layoutType).visible,
		);
	}

	/** Every screen the canvas draws, TOP first: the HUD screens (on the top-most `hudCanvas`) over
	 *  the game screens, a later screen over an earlier one within each. The edited screen is always
	 *  in, as its nodes stay clickable while its eye is off. */
	function screensTopDown(): Scene[] {
		const drawn = scenes.filter((s) => s.id === scene.id || !hiddenSceneIds.has(s.id));
		return [
			...drawn.filter((s) => !isHudScene(s)),
			...drawn.filter((s) => isHudScene(s)),
		].reverse();
	}

	/**
	 * Non-hidden GAME scenes in DOC ORDER — the per-scene composite groups (markup
	 * below) are emitted one per entry, z-ordered by this index so ANY scene's
	 * content (its 2D canvas + rig + text) sits above/below ANOTHER scene's
	 * content strictly by screen order. (HUD scenes are drawn separately on the
	 * top-most `hudCanvas`.) This is what makes a full-bleed Background RIG render
	 * BELOW the base-game 2D reels, instead of the rig layer always sitting on top.
	 */
	function visibleGameScenes(): Scene[] {
		return scenes.filter((s) => !hiddenSceneIds.has(s.id) && !isHudScene(s));
	}

	/** Does a scene carry a rig render target (a real rig node, a `bind` anchor whose
	 * resolved preview art is a rig, or a reel BOARD whose symbols bind rig art)? Only
	 * such scenes mount a rig sublayer in their group, so no group draws an empty one. */
	function sceneHasRig(s: { nodes: LayoutNode[] }): boolean {
		return nodesHaveRig(
			s.nodes,
			componentNest.depth,
			componentNest.stack,
			undefined,
			componentParams,
		);
	}
	/** Any symbol whose STATIC binding is a rig — the reel board then needs the WebGL
	 * layer to draw its cells (the 2D canvas can only marker them). */
	const hasRigSymbol = $derived(symbolStatics.some((c) => c.type === 'spine'));
	function nodesHaveRig(
		nodes: LayoutNode[],
		depth: number,
		stack: string[],
		/** The enclosing componentInstance's AUTHORED preview rig bundle (its first `spine`-kind
		 * param value), threaded EXACTLY like `collectNestedRigs` in `EditorRigLayer`. Without it
		 * this check resolved only the FIXED catalog bundle (the win overlay's `bigwin`); a project
		 * whose authored rig differs (Borut's `R_WinScreen`) and that has no `bigwin` rig looked
		 * "rig-less", so the WebGL rig layer never mounted and the authored rig showed only its 2D
		 * placeholder — even though the renderer WOULD have drawn it. Mirrors the renderer so the
		 * layer mounts exactly when there is real rig work. */
		instanceRigBundle: string | undefined,
		/** The enclosing instance's resolved params (the open component's for a top-level node), the
		 * ones a nested instance's forwarded params read — as `drawComponentInstance` resolves them. */
		outerParams: Record<string, unknown>,
	): boolean {
		for (const n of nodes) {
			if (n.kind === 'spine') return true;
			// A reel board with rig-bound symbols: its cells are drawn by the rig layer.
			if (n.kind === 'reelGrid' && hasRigSymbol) return true;
			const art = anchorArt(n, instanceRigBundle);
			if (art?.kind === 'spine' && art.assetKey) return true;
			if (
				n.kind === 'container' &&
				nodesHaveRig(n.children, depth, stack, instanceRigBundle, outerParams)
			)
				return true;
			if (n.kind === 'componentInstance') {
				const def = instanceDef(componentMap, n);
				if (!def || depth >= MAX_COMPONENT_DEPTH || stack.includes(def.id)) continue;
				const params = resolveComponentParams(
					def,
					forwardInstanceParams(n, resolveLayoutInstanceParams(n, layoutType), outerParams),
					componentDefaults[def.id],
				);
				const rigBundle = instancePreviewRigBundle(def, params);
				if (nodesHaveRig(def.root.children, depth + 1, [...stack, def.id], rigBundle, params))
					return true;
			}
			// A segmented counter's segments: the rig layer draws their rigs (`collectSegmentRigs`).
			if (isCountRepeater(n)) {
				for (const id of repeaterComponentIds(n)) {
					const def = componentMap.get(id);
					if (!def || depth >= MAX_COMPONENT_DEPTH || stack.includes(def.id)) continue;
					const params = resolveComponentParams(def, undefined, componentDefaults[def.id]);
					const rigBundle = instancePreviewRigBundle(def, params);
					if (nodesHaveRig(def.root.children, depth + 1, [...stack, def.id], rigBundle, params))
						return true;
				}
			}
		}
		return false;
	}

	/** Does a scene carry a text render target (a `kind:'text'` node, or a coded HUD
	 * text bind anchor) ANYWHERE in its tree — including nested in containers / component
	 * instances, which the overlay now also owns? Only such scenes mount the pixi text
	 * sublayer. Walks the same tree (+ `componentInstance` expansion) as the overlay's
	 * `collectTextTargets`, so the layer mounts exactly when the overlay has work. */
	function sceneHasText(s: { nodes: LayoutNode[] }): boolean {
		return nodesHaveText(s.nodes, componentNest.depth, componentNest.stack);
	}
	function nodesHaveText(nodes: LayoutNode[], depth: number, stack: string[]): boolean {
		for (const n of nodes) {
			if (n.kind === 'text') return true;
			if (n.kind === 'container' && n.bind && n.preview?.style === 'text') return true;
			if (n.kind === 'container' && nodesHaveText(n.children, depth, stack)) return true;
			if (n.kind === 'componentInstance') {
				const def = instanceDef(componentMap, n);
				if (!def || depth >= MAX_COMPONENT_DEPTH || stack.includes(def.id)) continue;
				if (nodesHaveText(def.root.children, depth + 1, [...stack, def.id])) return true;
			}
			// A repeater expands its component per box in the overlay too (the cards' title/price/…
			// text), so the layer must mount when the repeated def carries any text.
			if (n.kind === 'repeater') {
				for (const id of repeaterComponentIds(n)) {
					const def = componentMap.get(id);
					if (!def || depth >= MAX_COMPONENT_DEPTH || stack.includes(def.id)) continue;
					if (nodesHaveText(def.root.children, depth + 1, [...stack, def.id])) return true;
				}
			}
		}
		return false;
	}

	/** Does a scene carry a placed `kind:'effect'` node ANYWHERE in its tree (incl. nested in a
	 * container / component instance)? Only such scenes mount the effect sublayer — mirroring
	 * `sceneHasRig`. */
	function sceneHasEffect(s: { nodes: LayoutNode[] }): boolean {
		return nodesHaveEffect(s.nodes, componentNest.depth, componentNest.stack);
	}
	function nodesHaveEffect(nodes: LayoutNode[], depth: number, stack: string[]): boolean {
		for (const n of nodes) {
			if (n.kind === 'effect') return true;
			if (n.kind === 'container' && nodesHaveEffect(n.children, depth, stack)) return true;
			if (n.kind === 'componentInstance') {
				const def = instanceDef(componentMap, n);
				if (!def || depth >= MAX_COMPONENT_DEPTH || stack.includes(def.id)) continue;
				if (nodesHaveEffect(def.root.children, depth + 1, [...stack, def.id])) return true;
			}
		}
		return false;
	}

	/** Stable single-id `sceneFilter` per scene — memoized so the rig/text sublayers
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

	/** Synthetic scene key for the HUD rig overlay's report buffers — it covers ALL HUD
	 * scenes on one overlay (the HUD draws on its own top layer), mirroring `HUD_TEXT_KEY`. */
	const HUD_RIG_KEY = '__hud-rig__';

	/** Non-hidden HUD scenes carrying a rig ANYWHERE in their tree (incl. nested in a
	 * placed component — a spin button's `R_SpinButton`). The per-game-scene `{#each}`
	 * excludes HUD scenes (they draw on `hudCanvas`), so without this the HUD's rigs only
	 * ever show their 2D placeholder box and never the live skeleton. */
	function hudRigScenes(): Scene[] {
		return scenes.filter((s) => isHudScene(s) && !hiddenSceneIds.has(s.id) && sceneHasRig(s));
	}

	/** Memoized multi-id `sceneFilter` for the HUD rig overlay — a stable Set reference
	 * (rebuilt only when membership changes) so the overlay doesn't churn each render. */
	let hudRigFilter = new Set<string>();
	function hudRigSceneFilter(): Set<string> {
		const ids = hudRigScenes().map((s) => s.id);
		if (ids.length !== hudRigFilter.size || ids.some((id) => !hudRigFilter.has(id))) {
			hudRigFilter = new Set(ids);
		}
		return hudRigFilter;
	}

	/** Synthetic scene key for the HUD effect overlay's report buffers — it covers ALL HUD scenes on
	 * one overlay (the HUD draws on its own top layer), mirroring `HUD_RIG_KEY`. */
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
		/** `<segmentKey>#<runIndex>` — the canvas-registry key and the `{#each}` key. */
		key: string;
		sceneId: string;
		/** The {@link DepthSegment} the run belongs to (the scene id for the first one). */
		segKey: string;
		mode: BlendMode;
		/** CSS `mix-blend-mode` for the run's canvas element. */
		css: string;
		/** Top-level node ids in this run (draw order comes from the scene, not this set). */
		ids: Set<string>;
	}

	/** Effective blend mode of a top-level node for the ACTIVE layoutType (per-ratio overrides
	 * included) — `'normal'` when unset, which is every node that predates this feature. */
	function nodeBlendMode(n: LayoutNode): BlendMode {
		// A kind that cannot blend in the GAME resolves to `normal` here, so an older doc that
		// stored a mode on one (a rig, while the control was briefly offered there) previews
		// exactly as the game draws it — and, just as importantly, is NOT filtered off the base
		// overlay into a blended layer that would never be mounted for it.
		if (!canBlendKind(n.kind)) return 'normal';
		return resolveTransform(n, layoutType).blendMode ?? 'normal';
	}

	/** Memoized runs per depth segment — the Sets are handed to the WebGL overlays as props, so a
	 * fresh reference on every re-render would rebuild their skeletons/emitters each frame.
	 * Recomputed only when the segment's id→mode sequence (or the layoutType) actually changes. */
	const blendRunCache: Record<string, { sig: string; runs: BlendRun[] } | undefined> = {};
	function blendRuns(seg: DepthSegment): BlendRun[] {
		const modes = seg.nodes.map((n) => `${n.id}:${nodeBlendMode(n)}`);
		const sig = `${layoutType}|${modes.join(',')}`;
		const hit = blendRunCache[seg.key];
		if (hit && hit.sig === sig) return hit.runs;
		const runs: BlendRun[] = [];
		const run = (mode: BlendMode, ids: Set<string>): BlendRun => ({
			key: `${seg.key}#${runs.length}`,
			sceneId: seg.sceneId,
			segKey: seg.key,
			mode,
			css: cssBlendMode(mode),
			ids,
		});
		for (const n of seg.nodes) {
			const mode = nodeBlendMode(n);
			const last = runs[runs.length - 1];
			if (last && last.mode === mode) last.ids.add(n.id);
			else runs.push(run(mode, new Set([n.id])));
		}
		// An empty scene still needs its canvas — the group's other sublayers stack on it.
		if (runs.length === 0) runs.push(run('normal', new Set()));
		blendRunCache[seg.key] = { sig, runs };
		return runs;
	}

	/**
	 * The blend GROUPS a scene's WebGL overlay (rig / FX) splits into: the un-blended nodes stay
	 * on the layer the editor already mounted (`nodeFilter: null` — byte-identical parity), and
	 * each non-normal mode gets ONE extra layer. Unlike the 2D runs this collapses to one layer per
	 * MODE rather than per run, because inside one depth segment the overlays sit in a fixed stack
	 * above the 2D art (2D → rig → text → FX); the order BETWEEN segments is what keeps an FX under
	 * later art (see {@link depthSegments}). A segment adds a layer per distinct blend mode it uses,
	 * and blending is opt-in, so the common scene adds none. (Every overlay draws through the
	 * editor's shared contexts — `sharedGl.client.ts` — so layers cost canvases, not contexts.)
	 */
	interface BlendOverlayGroup {
		/** Synthetic merge/report key — `forgetScene` purges these alongside the scene. */
		key: string;
		mode: BlendMode;
		css: string;
		ids: Set<string>;
	}
	const blendOverlayCache: Record<
		string,
		{ sig: string; groups: BlendOverlayGroup[] } | undefined
	> = {};
	function blendOverlayGroups(seg: DepthSegment): BlendOverlayGroup[] {
		const sig = `${layoutType}|${seg.nodes.map((n) => `${n.id}:${nodeBlendMode(n)}`).join(',')}`;
		const hit = blendOverlayCache[seg.key];
		if (hit && hit.sig === sig) return hit.groups;
		const byMode: Partial<Record<BlendMode, string[]>> = {};
		for (const n of seg.nodes) {
			const mode = nodeBlendMode(n);
			if (mode === 'normal') continue;
			(byMode[mode] ??= []).push(n.id);
		}
		const groups: BlendOverlayGroup[] = Object.entries(byMode).map(([mode, ids]) => ({
			key: `${seg.key}#blend:${mode}`,
			mode: mode as BlendMode,
			css: cssBlendMode(mode as BlendMode),
			ids: new Set(ids),
		}));
		blendOverlayCache[seg.key] = { sig, groups };
		return groups;
	}

	/** The un-blended top-level node ids of a depth segment — the `nodeFilter` for its BASE overlay
	 * layer, so a blended rig renders on its own blended layer instead of twice and a node in another
	 * segment is not drawn again here. `null` (every node) only when the segment is the whole scene
	 * and blends nothing, which is the untouched path the overlays take today. */
	const normalOverlayCache: Record<string, { sig: string; ids: Set<string> | null } | undefined> =
		{};
	function normalOverlayFilter(seg: DepthSegment): Set<string> | null {
		const modes = seg.nodes.map((n) => `${n.id}:${nodeBlendMode(n)}`).join(',');
		const sig = `${layoutType}|${seg.whole}|${modes}`;
		const hit = normalOverlayCache[seg.key];
		if (hit && hit.sig === sig) return hit.ids;
		const blended = seg.nodes.some((n) => nodeBlendMode(n) !== 'normal');
		const ids =
			blended || !seg.whole
				? new Set(seg.nodes.filter((n) => nodeBlendMode(n) === 'normal').map((n) => n.id))
				: null;
		normalOverlayCache[seg.key] = { sig, ids };
		return ids;
	}

	/** What a surface needs to draw one depth segment, `null` for a whole (unsplit) scene. Memoized
	 * on the split, so the WebGL overlays see the same object until the split itself changes. */
	const depthSliceCache: Record<string, { sig: string; slice: DepthSlice | null } | undefined> = {};
	function depthSliceFor(seg: DepthSegment): DepthSlice | null {
		const hit = depthSliceCache[seg.key];
		if (hit && hit.sig === seg.sig) return hit.slice;
		const slice = seg.whole ? null : { segmentOf: seg.segmentOf, index: seg.index };
		depthSliceCache[seg.key] = { sig: seg.sig, slice };
		return slice;
	}

	/** The text overlay's `nodeFilter` for a depth segment: every node in it (text has no blended
	 * layer), or `null` when the segment is the whole scene — the path the text layer always took. */
	const textOverlayCache: Record<string, { sig: string; ids: Set<string> | null } | undefined> = {};
	function textOverlayFilter(seg: DepthSegment): Set<string> | null {
		const sig = `${seg.whole}|${seg.nodes.map((n) => n.id).join(',')}`;
		const hit = textOverlayCache[seg.key];
		if (hit && hit.sig === sig) return hit.ids;
		const ids = seg.whole ? null : new Set(seg.nodes.map((n) => n.id));
		textOverlayCache[seg.key] = { sig, ids };
		return ids;
	}

	/** Which depth segment's rig layer draws the full-screen dim (`activeSceneId`). Each rig layer
	 * paints the scrim into its own canvas, so handing it to every segment would stack the dim. The
	 * segment holding the dim anchor gets it, so the anchor's frame rig draws bright over it; failing
	 * that (no rig there), the first segment with a rig. */
	function scrimSegmentKey(segs: DepthSegment[]): string | undefined {
		if (segs.length === 1) return segs[0].key;
		const withRig = segs.filter((seg) => sceneHasRig(seg));
		const anchor = withRig.find((seg) => seg.nodes.some((n) => (tapOverlayDim(n) ?? 0) > 0));
		return (anchor ?? withRig[0])?.key;
	}

	/**
	 * True while the 2D surface being drawn carries its nodes' blend on the ELEMENT (a
	 * {@link BlendRun} canvas), so `drawNode` must not apply it a second time via
	 * `globalCompositeOperation`. False for the HUD canvas, which is one shared surface and
	 * therefore blends inline. NESTED nodes always blend inline — they cannot have an element of
	 * their own — so this only ever suppresses the top-level application.
	 */
	let elementCarriesBlend = false;

	function findNodeById(id: string): LayoutNode | null {
		for (const n of scene.nodes) if (n.id === id) return n;
		return null;
	}

	// ---------- draw ----------

	/** Each mode's stage colour, so Animate never reads as Design (Rive plan Phase 9a). */
	const STAGE_TINT = { design: '#0b0b10', animate: '#0a1424' } as const;

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
		ctx.fillStyle = animate ? STAGE_TINT.animate : STAGE_TINT.design;
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.translate(panX, panY);
		ctx.scale(zoom, zoom);

		// `standard` + edge-align: show the window extent on the side the box is NOT
		// pinned to, so the author sees where the rest of the screen sits (matching
		// `<MainContainer standard alignVertical="bottom">` / `"top"`). The box itself
		// frames at 0..frameHeight; the dimmed region is a context cue only (the live
		// window height varies — this uses a representative 16:9 window).
		const edgeAlign = scene.space === 'standard' ? scene.align?.vertical : undefined;
		if (edgeAlign === 'top' || edgeAlign === 'bottom') {
			const windowH = Math.max(frameWidth * (9 / 16), frameHeight);
			// bottom-pinned ⇒ the window runs UP from the box; top-pinned ⇒ DOWN from it.
			const windowTop = edgeAlign === 'bottom' ? frameHeight - windowH : 0;
			const dimTop = edgeAlign === 'bottom' ? windowTop : frameHeight;
			ctx.fillStyle = 'rgba(20,20,28,0.35)';
			ctx.fillRect(0, dimTop, frameWidth, windowH - frameHeight);
			ctx.lineWidth = 1.5 / zoom;
			ctx.strokeStyle = '#2a2a36';
			ctx.setLineDash([10 / zoom, 8 / zoom]);
			ctx.strokeRect(0, windowTop, frameWidth, windowH);
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
		// rig + text sublayers by screen order — so e.g. a full-bleed Background rig
		// renders BELOW the base-game 2D, instead of the rig layer always being on top.
		// This base canvas keeps only the frame backdrop + the interaction surface (input
		// passes through the per-scene groups, which are `pointer-events:none`).
		drawSceneCanvases();
		drawHud();
		drawRulers();
	}

	/**
	 * The two rulers: world (window-frame) pixels along the top and left edges at the current
	 * zoom and pan, with a marker for every guide. Drawn only while the rulers are on.
	 */
	function drawRulers(): void {
		if (!showRulers) return;
		const dpr = window.devicePixelRatio || 1;
		const step = rulerStep(zoom);
		const shown = drawnGuides();
		for (const axis of ['x', 'y'] as const) {
			const c = axis === 'x' ? rulerTop : rulerLeft;
			const ctx = c?.getContext('2d');
			if (!c || !ctx) continue;
			const length = (axis === 'x' ? c.width : c.height) / dpr;
			const pan = axis === 'x' ? panX : panY;
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.fillStyle = '#15151c';
			ctx.fillRect(0, 0, c.width / dpr, c.height / dpr);
			ctx.strokeStyle = '#3a3a48';
			ctx.fillStyle = '#8a8a99';
			ctx.font = '9px system-ui, sans-serif';
			ctx.lineWidth = 1;
			const from = (0 - pan) / zoom;
			const to = (length - pan) / zoom;
			const minor = step / 5;
			for (const v of rulerTicks(from - step, to, minor)) {
				const at = Math.round(v * zoom + pan) + 0.5;
				const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
				const tick = major ? RULER_PX : RULER_PX * 0.3;
				ctx.beginPath();
				if (axis === 'x') {
					ctx.moveTo(at, RULER_PX);
					ctx.lineTo(at, RULER_PX - tick);
				} else {
					ctx.moveTo(RULER_PX, at);
					ctx.lineTo(RULER_PX - tick, at);
				}
				ctx.stroke();
				if (!major) continue;
				const label = String(Math.round(v));
				if (axis === 'x') ctx.fillText(label, at + 3, 9);
				else {
					ctx.save();
					ctx.translate(9, at - 3);
					ctx.rotate(-Math.PI / 2);
					ctx.fillText(label, 0, 0);
					ctx.restore();
				}
			}
			// A guide's marker: on the top ruler for a vertical guide (x), on the left for a horizontal.
			ctx.fillStyle = '#22d3ee';
			for (const g of shown?.[axis] ?? []) {
				const at = g * zoom + pan;
				ctx.beginPath();
				if (axis === 'x') {
					ctx.moveTo(at - 4, 0);
					ctx.lineTo(at + 4, 0);
					ctx.lineTo(at, 6);
				} else {
					ctx.moveTo(0, at - 4);
					ctx.lineTo(0, at + 4);
					ctx.lineTo(6, at);
				}
				ctx.fill();
			}
		}
	}

	/** Start dragging a NEW guide off a ruler: the top ruler gives a horizontal one (y), the left
	 * a vertical one (x). */
	function startRulerGuide(axis: GuideAxis, e: MouseEvent): void {
		// Any other button pans, as it does on the canvas.
		if (e.button !== 0) {
			onMouseDown(e);
			return;
		}
		if (!onGuidesChange || animate) return;
		const world = clientToWorld(e.clientX, e.clientY);
		guideDrag = { axis, index: null, value: Math.round(world[axis]), remove: true };
		e.preventDefault();
		schedule();
	}

	/** Move the dragged guide; released over the rulers (or off the canvas), it is removed. */
	function moveGuideDrag(e: MouseEvent): void {
		if (!guideDrag || !canvas) return;
		const rect = canvas.getBoundingClientRect();
		const sx = e.clientX - rect.left;
		const sy = e.clientY - rect.top;
		const off = sx < RULER_PX || sy < RULER_PX || sx > rect.width || sy > rect.height;
		const world = clientToWorld(e.clientX, e.clientY);
		guideDrag = { ...guideDrag, value: Math.round(world[guideDrag.axis]), remove: off };
		schedule();
	}

	function endGuideDrag(): void {
		const drag = guideDrag;
		guideDrag = null;
		hoverGuideAxis = null;
		schedule();
		if (!drag) return;
		// The guide moved under the drag (an undo, another layout): leave the guides as they are.
		if (drag.index !== null && guides?.[drag.axis]?.[drag.index] !== drag.from) return;
		// A click that moved nothing is no edit (no undo step, no autosave).
		const next = applyGuideDrag(guides, drag);
		const unchanged = applyGuideDrag(guides, { ...drag, index: null, remove: true });
		if (JSON.stringify(next) !== JSON.stringify(unchanged)) onGuidesChange?.(next);
	}

	/**
	 * Draw each non-hidden GAME scene's 2D node art onto its OWN registered canvas, in
	 * the SAME world→screen mapping as everything else (`setTransform(dpr) · pan · zoom`).
	 * Each per-scene canvas sits in a z-ordered group (markup below) between this base
	 * canvas and the HUD, so intra-stack order follows screen order across the 2D/rig/
	 * text surfaces. The eye toggle is authoritative — a hidden scene never draws.
	 */
	function drawSceneCanvases(): void {
		const dpr = window.devicePixelRatio || 1;
		// Each run canvas carries its own blend on the element, so the node draws must NOT also
		// apply it (see `elementCarriesBlend`). Restored before returning so the HUD pass — one
		// shared surface, which has to blend inline — is unaffected.
		elementCarriesBlend = true;
		for (const s of visibleGameScenes()) {
			for (const seg of depthSegments(s, componentMap, componentNest)) {
				drawDepth = depthSliceFor(seg);
				for (const run of blendRuns(seg)) {
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
		drawDepth = null;
		elementCarriesBlend = false;
	}

	/**
	 * Draw the HUD screens on the top-most `hudCanvas` — ABOVE the rig/FX overlay,
	 * so the HUD renders on top like the real game (the base canvas, which holds the
	 * game scenes, sits below the rig layer). Also draws the selection overlay here
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

		// Ruler guides, over the art (world space, across the whole visible stage). The one being
		// dragged draws on its own: red while releasing it would remove it.
		if (showRulers) {
			const rest = guideDrag ? applyGuideDrag(guides, { ...guideDrag, remove: true }) : guides;
			const left = -panX / zoom;
			const top = -panY / zoom;
			const right = left + hudCanvas.width / dpr / zoom;
			const bottom = top + hudCanvas.height / dpr / zoom;
			const line = (axis: GuideAxis, g: number): void => {
				ctx.beginPath();
				if (axis === 'x') {
					ctx.moveTo(g, top);
					ctx.lineTo(g, bottom);
				} else {
					ctx.moveTo(left, g);
					ctx.lineTo(right, g);
				}
				ctx.stroke();
			};
			ctx.save();
			ctx.lineWidth = 1 / zoom;
			ctx.strokeStyle = '#22d3ee';
			for (const g of rest?.x ?? []) line('x', g);
			for (const g of rest?.y ?? []) line('y', g);
			if (guideDrag) {
				ctx.strokeStyle = guideDrag.remove ? '#f87171' : '#22d3ee';
				line(guideDrag.axis, guideDrag.value);
			}
			ctx.restore();
		}

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		if (animate) drawOnion(ctx);
		drawSelectionOverlay(ctx);
		drawHoverPick(ctx);

		// Always-on-top screen-border overlay. The window frame + play-area (main box) are
		// normally drawn on the BASE canvas (bottom of the z-stack), so stacked art buries
		// them. When toggled on, re-draw them here on the top-most HUD canvas — above every
		// art/rig/FX layer — as a brighter guide so the author can always see the bounds.
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
		drawWorldCamera(ctx);
	}

	/**
	 * A play field's WORLD bounds and the CAMERA's first frame (game-families §4.4, P10.12) over the
	 * active screen, in its main-box coords like its nodes: the world from the origin, the camera as
	 * the design box at the origin, where it starts. A guide only — never picked, never saved.
	 */
	function drawWorldCamera(ctx: CanvasRenderingContext2D): void {
		const frames = worldCameraFrames(scene, mainSizesMap[layoutType]);
		if (!frames) return;
		const dpr = window.devicePixelRatio || 1;
		ctx.save();
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.translate(panX, panY);
		ctx.scale(zoom, zoom);
		const s = mainScale();
		const label = (text: string, x: number, y: number, color: string): void => {
			ctx.fillStyle = color;
			ctx.font = `${12 / zoom}px sans-serif`;
			ctx.fillText(text, x + 6 / zoom, y + 16 / zoom);
		};
		const w = frames.world;
		const wo = mainToWorld({ x: w.x, y: w.y });
		ctx.lineWidth = 2 / zoom;
		ctx.strokeStyle = '#e8a33d';
		ctx.setLineDash([14 / zoom, 6 / zoom, 2 / zoom, 6 / zoom]);
		ctx.strokeRect(wo.x, wo.y, w.w * s, w.h * s);
		label(`world ${w.w} × ${w.h}`, wo.x, wo.y + w.h * s - 22 / zoom, '#e8a33d');
		const c = frames.camera;
		const co = mainToWorld({ x: c.x, y: c.y });
		ctx.strokeStyle = '#5aa9ff';
		ctx.setLineDash([4 / zoom, 4 / zoom]);
		ctx.strokeRect(co.x, co.y, c.w * s, c.h * s);
		ctx.setLineDash([]);
		label('camera (start)', co.x, co.y, '#5aa9ff');
		ctx.restore();
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

	/**
	 * The depth segment the 2D pass is painting (`drawSceneCanvases` sets it per segment; `null` ⇒
	 * everything) and the id path of the node being drawn. A group or component is walked on every
	 * segment, since its children can fall in any of them; a node's OWN art is drawn only on its own.
	 */
	let drawDepth: DepthSlice | null = null;
	const drawPath: string[] = [];

	/** Draw a node — {@link drawNodeAt} with its id path tracked for the depth-segment check. */
	function drawNode(...args: Parameters<typeof drawNodeAt>): void {
		drawPath.push(args[1].id);
		try {
			drawNodeAt(...args);
		} finally {
			drawPath.pop();
		}
	}

	function drawNodeAt(
		ctx: CanvasRenderingContext2D,
		node: LayoutNode,
		sceneCtx: Scene = scene,
		componentDepth = componentNest.depth,
		componentStack: string[] = componentNest.stack,
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
		 * The ENCLOSING componentInstance's AUTHORED preview rig bundle (its first `spine`-kind
		 * param value; see `instancePreviewRigBundle`) — so a nested bound-component that previews a
		 * RIG (the win / free-spin VISUAL) stands in the authored rig, and its readiness check keys
		 * the SAME bundle the WebGL layer renders. Undefined for a top-level node or an instance
		 * whose def declares no rig param ⇒ the catalog default (parity).
		 */
		instanceRigBundle?: string,
	): void {
		// DRAWN with the value-binding preview folded on (a scrubbed test value in "Bind to value") —
		// here only: drags, hit-tests and the selection read the authored transform, so a preview
		// can never be written into the doc.
		const t = nested
			? childLocalTransform(
					node,
					layoutType,
					sceneCtx.space,
					frameWidth,
					frameHeight,
					previewResolveTransform,
				)
			: nodeTransform(node, sceneCtx, previewResolveTransform);
		if (!t.visible) return;

		ctx.save();
		ctx.translate(t.x, t.y);
		if (t.rotation) ctx.rotate(t.rotation);
		const sx = t.scale?.x ?? 1;
		const sy = t.scale?.y ?? 1;
		if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
		if (t.alpha !== undefined) ctx.globalAlpha = t.alpha;
		// Photoshop-style blend. A TOP-LEVEL node on a scene run canvas already has its mode on the
		// element, so applying it here too would blend twice; every other case (a nested child, the
		// shared HUD canvas) blends inline against whatever this surface has already drawn.
		if (nested || !elementCarriesBlend) {
			const op = canvasCompositeOp(t.blendMode);
			if (op !== 'source-over') ctx.globalCompositeOperation = op;
		}
		if (drawDepth && !inDepthSlice(drawDepth, drawPath)) {
			// This node's own art is on another depth segment; its children may be on this one. A
			// bound container walks its children only when it is a skinned part, as below.
			const partSkin = node.bind ? boundComponentSkin(node.bind.component) : undefined;
			const walks =
				!node.bind ||
				(!!partSkin && isPartSkinned(node, partSkin, instanceParams ?? componentParams));
			if (node.kind === 'container' && walks) {
				for (const child of node.children)
					drawNode(
						ctx,
						child,
						sceneCtx,
						componentDepth,
						componentStack,
						instanceParams,
						true,
						instanceRigBundle,
					);
			} else if (node.kind === 'componentInstance') {
				const def = instanceDef(componentMap, node);
				if (def && componentDepth < MAX_COMPONENT_DEPTH && !componentStack.includes(def.id))
					drawComponentInstance(
						ctx,
						node,
						sceneCtx,
						componentDepth,
						componentStack,
						instanceParams ?? componentParams,
					);
			}
			ctx.restore();
			return;
		}
		// The value-binding preview's other outputs: a `fill` reveal clips the art to its rect in the
		// node's local box (the runtime's mask), a `frame` holds a clip frame (below).
		const previewed = previewOutputs(
			node,
			node.kind === 'flipbook' ? clipsById.get(node.clipId)?.frames.length : undefined,
		);
		const previewFill = boundFillShare(previewBindings(node), previewed);
		// A node drawn as a background cover shows whole: the game drops the reveal on a cover.
		const drawnAsCover = !nested && sceneCtx.space === 'background' && isBackgroundCoverKind(node);
		if (
			previewFill &&
			!drawnAsCover &&
			(node.kind === 'sprite' || node.kind === 'rect' || node.kind === 'flipbook')
		) {
			const box = boxOf(node, t);
			// A mirrored clip spans its anchor the other way (the draw flips about the anchor).
			const mirror = node.kind === 'flipbook' ? flipbookMirror(node) : undefined;
			const r = fillMaskRect(
				box.w,
				box.h,
				{ x: mirror?.x ? 1 - box.ax : box.ax, y: mirror?.y ? 1 - box.ay : box.ay },
				previewFill.share,
				previewFill.direction,
			);
			ctx.beginPath();
			ctx.rect(r.x, r.y, r.width, r.height);
			ctx.clip();
		}

		const skin = node.bind ? boundComponentSkin(node.bind.component) : undefined;
		const skinParams = instanceParams ?? componentParams;
		if (skin && isPartSkinned(node, skin, skinParams)) {
			// A skinned coded part (Phase 12c): its picked art, then the author's own nodes inside
			// it — what the game draws in place of the coded drawing — instead of the stand-in chip,
			// then any art the game draws over those nodes.
			drawPartSkin(ctx, skin, skinParams, t, false);
			if (node.kind === 'container')
				for (const child of node.children)
					drawNode(
						ctx,
						child,
						sceneCtx,
						componentDepth,
						componentStack,
						instanceParams,
						true,
						instanceRigBundle,
					);
			drawPartSkin(ctx, skin, skinParams, t, true);
		} else if (node.bind) {
			// Bound nodes (HUD elements, Win/Transition anchors, mount slots) have no
			// editor-renderable art — the game mounts the real component at runtime.
			// A `preview.art` anchor (e.g. the animated Background) gets a real rig/
			// sprite stand-in: rig art is drawn by the WebGL overlay (placeholder
			// until ready, like a rig node); sprite art is drawn here on the 2D canvas.
			// HUD elements carry `preview.style` so we draw a faithful chip; others get
			// a plain placeholder.
			const art = anchorArt(node, instanceRigBundle);
			// A coded TILE part the catalog says an instance can SKIN (the readout's Background —
			// see `TileImageBinding`): the picked frame REPLACES the stand-in chip, drawn at the
			// tile's coded box or the instance's size overrides, so a per-instance background
			// previews here exactly as the game draws it. Read off `bind.component`, never a
			// hardcoded component id; no declaration ⇒ every branch below is unchanged (parity).
			const tile = boundComponentTileImage(node.bind.component);
			const tileParams = instanceParams ?? componentParams;
			const tileNum = (key?: string): number | undefined =>
				key && typeof tileParams[key] === 'number' ? (tileParams[key] as number) : undefined;
			const tileStr = (key?: string): string | undefined =>
				key && typeof tileParams[key] === 'string' && tileParams[key]
					? (tileParams[key] as string)
					: undefined;
			const tileTint = tile ? tileNum(tile.tintParam) : undefined;
			const tileImage = tile ? tileStr(tile.imageParam) : undefined;
			// A picked frame sizes the way the game's part does (`aspectBox`): its own size, or the
			// instance's overrides with one alone keeping the frame's ratio. Only the bare chip falls
			// back to the coded tile box.
			const tileT = tile
				? {
						...t,
						...(tileImage
							? aspectBox(
									tileImageNaturalSize(tileImage),
									tileNum(tile.widthParam),
									tileNum(tile.heightParam),
								)
							: {
									width: tileNum(tile.widthParam) ?? tile.width,
									height: tileNum(tile.heightParam) ?? tile.height,
								}),
					}
				: t;
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
				// ENCLOSING instance's rig param, not the catalog default — so check THAT key
				// for readiness, else the placeholder would linger over the real rig (or double it
				// when the author picks a non-default bundle). Non-riding binds are unchanged.
				let rigKey = art.assetKey;
				const rides = node.bind ? boundComponentRidesBone(node.bind.component) : undefined;
				if (rides && instanceParams) {
					rigKey = resolveBoneRiderRigKey(rides, instanceParams, assets.spines) || art.assetKey;
				}
				if (!readyRigKeys.has(rigKey)) {
					drawPlaceholder(
						ctx,
						t.anchor?.x ?? 0.5,
						t.anchor?.y ?? 0.5,
						'#4a3a5a',
						`rig: ${node.label ?? art.assetKey}`,
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
			// A previewed timeline's tint wins over a param-bound one, as `LayoutNodeView` orders them.
			const tint =
				previewTint(node) ??
				(boundTint !== undefined && boundTint !== 0xffffff ? boundTint : undefined);
			if (region) {
				drawRegionSprite(
					ctx,
					node,
					t,
					region,
					assetKey,
					tint,
					drawsAsCover(node, sceneCtx, nested),
				);
			} else if (!assetKey && nested && gameView) {
				// An art slot nothing is bound to: the game draws nothing there.
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
			// load error) the placeholder box stands in. A nested slot with no rig bound draws
			// nothing in the game, so In-game view draws nothing either.
			const rig =
				boundString(node.paramBindings, 'assetKey', instanceParams ?? componentParams) ??
				node.assetKey;
			if (!rig && nested && gameView) {
				// nothing bound
			} else if (!readyRigKeys.has(node.assetKey)) {
				// Centred like the box `nodeBox` frames an unmeasured rig with: a rig has no anchor.
				drawPlaceholder(ctx, 0.5, 0.5, '#4a3a5a', `rig: ${node.label ?? node.assetKey}`);
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
					instanceRigBundle,
				);
		} else if (node.kind === 'componentInstance') {
			drawComponentInstance(
				ctx,
				node,
				sceneCtx,
				componentDepth,
				componentStack,
				instanceParams ?? componentParams,
			);
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
			const heldClip = clipsById.get(node.clipId);
			const held = boundFrameOutput(previewBindings(node), previewed);
			const frame =
				held !== undefined && heldClip?.frames.length
					? clipFrameAt(heldClip, bindingFrameIndex(held, heldClip.frames.length))
					: flipbookFrame(node.clipId, {
							fps: node.fps,
							// A frame-bound clip walks forward in the game (its frame counts the clip as
							// authored), so it previews that way while no test value holds it.
							direction: node.valueBindings?.some((b) => b.target === 'frame')
								? 'forward'
								: node.direction,
						});
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
		} else if (node.kind === 'spawnLayer') {
			drawSpawnLayer(ctx, node);
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
	function boxOf(node: LayoutNode, t: ResolvedTransform, rigBundle?: string): NodeBox {
		return nodeBox(
			node,
			t,
			naturalSize,
			componentMap,
			layoutType,
			rigBundle,
			node.kind === 'repeater' ? repeaterItemCount(node) : undefined,
			componentDefaults,
			componentParams,
			componentNest,
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
		if (isCountRepeater(node)) {
			drawCountRepeater(ctx, node, t, sceneCtx, componentDepth, componentStack);
			return;
		}
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
			// Expand the REAL component per box. The bind-rig preview bundle is resolved from the
			// def's own params (the per-item values feed no rig param), like `drawComponentInstance`.
			const rigBundle = instancePreviewRigBundle(
				def,
				resolveComponentParams(def, undefined, componentDefaults[def.id]),
			);
			const stack = [...componentStack, def.id];
			for (const box of repeaterBoxes(
				node,
				def,
				g,
				repeaterItemValues(node),
				anchorX,
				anchorY,
				componentDefaults[def.id],
			)) {
				drawNode(
					ctx,
					box.container,
					sceneCtx,
					componentDepth + 1,
					stack,
					box.params,
					true,
					rigBundle,
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
	 * Draw a `spawnLayer` node's stand-in: its children exist only while a flow runs, which the
	 * editor doesn't, so it draws the field they spawn into — a grid layer's cols × rows cells at
	 * pitch (a dot on each spawn point), a free layer a dashed box — labelled with what it may spawn.
	 * The geometry is `spawnLayerPlaceholder`'s, the same box `nodeBox` selects.
	 */
	function drawSpawnLayer(
		ctx: CanvasRenderingContext2D,
		node: Extract<LayoutNode, { kind: 'spawnLayer' }>,
	): void {
		const { spec, box } = spawnLayerPlaceholder(node);
		const left = -box.w * box.ax;
		const top = -box.h * box.ay;
		ctx.fillStyle = 'rgba(120, 220, 190, 0.06)';
		ctx.fillRect(left, top, box.w, box.h);
		ctx.lineWidth = 1;
		ctx.strokeStyle = 'rgba(120, 220, 190, 0.55)';
		const grid = spec.grid;
		if (grid) {
			ctx.beginPath();
			for (let c = 0; c <= grid.cols; c++) {
				ctx.moveTo(left + c * grid.pitch, top);
				ctx.lineTo(left + c * grid.pitch, top + box.h);
			}
			for (let r = 0; r <= grid.rows; r++) {
				ctx.moveTo(left, top + r * grid.pitch);
				ctx.lineTo(left + box.w, top + r * grid.pitch);
			}
			ctx.stroke();
			ctx.fillStyle = 'rgba(120, 220, 190, 0.7)';
			const dot = Math.min(3, grid.pitch / 6);
			for (let r = 0; r < grid.rows; r++)
				for (let c = 0; c < grid.cols; c++)
					ctx.fillRect(c * grid.pitch - dot, r * grid.pitch - dot, dot * 2, dot * 2);
		} else {
			ctx.setLineDash([6, 4]);
			ctx.strokeRect(left, top, box.w, box.h);
			ctx.setLineDash([]);
		}
		ctx.fillStyle = '#e8e8ee';
		ctx.font = '14px sans-serif';
		ctx.fillText(
			`⊕ ${node.label ?? 'Spawn layer'} · ${spec.spawnable.length} spawnable · cap ${spec.cap}`,
			left + 8,
			top + 20,
		);
	}

	/**
	 * Draw a COUNT-MODE repeater (a segmented counter): N = its preview count of segments, each the
	 * real segment component (its first / middle / last variant) with `{ index, count }` params,
	 * at the pose its state machine settles on for its test inputs (`segmentPoseNodes`) — so the
	 * author sees which segments light. Built by `repeaterCountBoxes`, which the text overlay, the
	 * rig layer and the selection box (`nodeBox`) share; a variant naming no def draws the middle
	 * segment there, as in game.
	 */
	function drawCountRepeater(
		ctx: CanvasRenderingContext2D,
		node: CountRepeaterNode,
		t: ResolvedTransform,
		sceneCtx: Scene,
		componentDepth: number,
		componentStack: string[],
	): void {
		const anchorX = t.anchor?.x ?? 0;
		const anchorY = t.anchor?.y ?? 0;
		const { layout, boxes } = repeaterCountBoxes(
			node,
			componentMap,
			layoutType,
			anchorX,
			anchorY,
			componentDefaults,
			(def, inputs, params) => segmentPoseNodes(def, segmentTimelines(def.id), inputs, params),
		);
		if (!(layout.width > 0 && layout.height > 0)) {
			// Nothing to frame (no segment, or unsized ones): a dashed stand-in keeps it selectable.
			const { w, h } = REPEATER_SEGMENT_PLACEHOLDER;
			ctx.lineWidth = 1;
			ctx.strokeStyle = 'rgba(200, 163, 255, 0.5)';
			ctx.setLineDash([4, 4]);
			ctx.strokeRect(-w * anchorX, -h * anchorY, w, h);
			ctx.setLineDash([]);
			ctx.fillStyle = '#e8e8ee';
			ctx.font = '12px sans-serif';
			ctx.fillText(`⧉ ×${layout.offsets.length}`, -w * anchorX + 6, -h * anchorY + 16);
		}
		for (const box of boxes) {
			if (componentDepth >= MAX_COMPONENT_DEPTH || componentStack.includes(box.def.id)) continue;
			drawNode(
				ctx,
				box.container,
				sceneCtx,
				componentDepth + 1,
				[...componentStack, box.def.id],
				box.params,
				true,
				instancePreviewRigBundle(box.def, box.params),
			);
		}
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
	 * geometry itself comes from the shared {@link reelGridGeometry} so the WebGL rig
	 * layer (which draws the RIG symbols) seats them identically.
	 */
	function drawReelGrid(
		ctx: CanvasRenderingContext2D,
		node: Extract<LayoutNode, { kind: 'reelGrid' }>,
		t: ResolvedTransform,
	): void {
		// Board geometry (cell boxes + symbol seats) comes from the SHARED `reelGridGeometry`,
		// the same resolver `EditorRigLayer` reads — so a sprite symbol drawn here and a rig
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
		// engine's `Sprite`/`RigView` `contain`). The static list is cycled across cells so the
		// board looks populated. A RIG static is drawn by the WebGL rig layer (which reads the
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
				// The rig overlay renders this cell's real skeleton once the bundle is ready
				// (it reports the key via `readyRigKeys`) — until then the amber marker stands in,
				// exactly like a rig NODE's placeholder.
				if (!readyRigKeys.has(cell.assetKey)) drawMarker(cx, cy, cellW, cellH, 'spine');
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
			// `Sprite`/`RigView` `contain`. `sizeRatios` (per-cell or the reel global) was removed
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
			// The window, GROWN by the authored symbol overflow — the same growth the game applies to
			// its mask once the board settles (`boardOverflow`). Absent ⇒ `0` on both axes ⇒ the two
			// rects below are the ones that were always drawn.
			const clip = geo.clip;
			if (clip)
				ctx.rect(
					clip.x - geo.overflowX,
					clip.y - geo.overflowY,
					clip.w + geo.overflowX * 2,
					clip.h + geo.overflowY * 2,
				);
			else
				ctx.rect(
					left - geo.overflowX,
					top - geo.overflowY,
					w + geo.overflowX * 2,
					h + geo.overflowY * 2,
				);
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

		drawRespinCellTilesPreview(ctx, geo.seats);
		drawLockedRowPreview(ctx, geo.seats);

		ctx.lineWidth = 2;
		ctx.strokeStyle = '#5db0ff';
		if (geo.outline) {
			outlinePath();
			ctx.stroke();
		} else {
			ctx.strokeRect(left, top, w, h);
		}

		// SYMBOL OVERFLOW: the extra room a settled symbol's art may spill into, dashed so it reads as
		// a clip boundary rather than a second board. Drawn only when authored, so an ordinary board's
		// preview is untouched — and drawn LAST so it sits over the board outline it grows from.
		if (geo.overflowX > 0 || geo.overflowY > 0) {
			const box = geo.clip ?? { x: left, y: top, w, h };
			ctx.lineWidth = 1;
			ctx.strokeStyle = 'rgba(93, 176, 255, 0.55)';
			ctx.setLineDash([6 / zoom, 5 / zoom]);
			ctx.strokeRect(
				box.x - geo.overflowX,
				box.y - geo.overflowY,
				box.w + geo.overflowX * 2,
				box.h + geo.overflowY * 2,
			);
			ctx.setLineDash([]);
		}
	}

	/**
	 * The `respinCells` component's look, while one is SELECTED: the game draws its tiles only on the
	 * Hold and Win respin board, under every cell, which no editor screen shows — so the reel grid
	 * stands in for it. Each cell reads as an empty respin cell on its tile, shrunk by the gap, so the
	 * author sees the tile, its tint and the gap while setting them. Nothing selected ⇒ nothing drawn.
	 */
	function drawRespinCellTilesPreview(
		ctx: CanvasRenderingContext2D,
		seats: readonly ReelGridSeat[],
	): void {
		const selected = selectedId ? findNodeById(selectedId) : null;
		if (selected?.kind !== 'componentInstance' || selected.componentId !== 'respinCells') return;
		const defaults = Object.fromEntries(
			(componentMap.get('respinCells')?.params ?? []).map((p) => [p.key, p.default]),
		);
		const params: Record<string, unknown> = { ...defaults, ...(selected.params ?? {}) };
		const gap = Math.min(Math.max(Number(params.gap) || 0, 0), 0.45);
		const image = typeof params.tileImage === 'string' ? params.tileImage : '';
		const tintText = typeof params.tileTint === 'string' ? params.tileTint : '';
		const tint = /^#[0-9a-f]{6}$/i.test(tintText) ? parseInt(tintText.slice(1), 16) : undefined;
		const scoped = image ? parseScopedFrameRef(image) : null;
		for (const seat of seats) {
			ctx.fillStyle = 'rgba(8, 10, 18, 0.9)';
			ctx.fillRect(seat.x, seat.y, seat.w, seat.h);
			const tw = seat.w * (1 - gap);
			const th = seat.h * (1 - gap);
			if (!scoped) {
				ctx.strokeStyle = 'rgba(255, 196, 93, 0.6)';
				ctx.strokeRect(seat.x + (seat.w - tw) / 2, seat.y + (seat.h - th) / 2, tw, th);
				continue;
			}
			ctx.save();
			// The cell BOX centre — the coded respin board stamps its tile on the cell, not on the
			// symbol's aligned seat.
			ctx.translate(seat.x + seat.w / 2, seat.y + seat.h / 2);
			drawArtRegionSprite(
				ctx,
				scoped.assetKey ?? '',
				scoped.region,
				{ x: 0, y: 0, anchor: { x: 0.5, y: 0.5 }, width: tw, height: th, visible: true },
				undefined,
				tint !== undefined && tint !== 0xffffff ? tint : undefined,
			);
			ctx.restore();
		}
	}

	/**
	 * The `lockedRow` component's look, while one is SELECTED: an expanding respin board draws it over
	 * every locked cell — the rows that grow BELOW the base grid, which no editor screen shows — so one
	 * sample row is drawn under the reel grid, each cell as the game draws a locked cell: the authored
	 * art (tinted), else the coded dark panel marked LOCKED. Nothing selected ⇒ nothing drawn.
	 */
	function drawLockedRowPreview(
		ctx: CanvasRenderingContext2D,
		seats: readonly ReelGridSeat[],
	): void {
		const selected = selectedId ? findNodeById(selectedId) : null;
		if (selected?.kind !== 'componentInstance' || selected.componentId !== 'lockedRow') return;
		if (!seats.length) return;
		const params: Record<string, unknown> = selected.params ?? {};
		const image = typeof params.lockedImage === 'string' ? params.lockedImage : '';
		const tintText = typeof params.lockedTint === 'string' ? params.lockedTint : '';
		const tint = /^#[0-9a-f]{6}$/i.test(tintText) ? parseInt(tintText.slice(1), 16) : undefined;
		const scoped = image ? parseScopedFrameRef(image) : null;
		const bottom = Math.max(...seats.map((seat) => seat.y + seat.h));
		const lastRow = seats.filter((seat) => seat.y + seat.h === bottom);
		const pitch = Math.max(...seats.map((seat) => seat.h));
		for (const seat of lastRow) {
			const y = seat.y + pitch;
			if (scoped) {
				ctx.save();
				ctx.translate(seat.x + seat.w / 2, y + seat.h / 2);
				drawArtRegionSprite(
					ctx,
					scoped.assetKey ?? '',
					scoped.region,
					{ x: 0, y: 0, anchor: { x: 0.5, y: 0.5 }, width: seat.w, height: seat.h, visible: true },
					undefined,
					tint !== undefined && tint !== 0xffffff ? tint : undefined,
				);
				ctx.restore();
				continue;
			}
			ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
			ctx.fillRect(seat.x + seat.w * 0.03, y + seat.h * 0.03, seat.w * 0.94, seat.h * 0.94);
			ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
			ctx.strokeRect(seat.x + seat.w * 0.03, y + seat.h * 0.03, seat.w * 0.94, seat.h * 0.94);
			ctx.fillStyle = '#ffffff';
			ctx.font = `bold ${Math.round(seat.h * 0.15)}px Arial`;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText('LOCKED', seat.x + seat.w / 2, y + seat.h / 2);
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
		/** The enclosing instance's resolved params (the open component's for a top-level node, `{}`
		 * on a screen): what the instance's forwarded params (`params.<key>` bindings) read. */
		outerParams: Record<string, unknown>,
	): void {
		const def = instanceDef(componentMap, node);
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
		// name. The per-project DEFAULTS sidecar (§13.3) sits under the instance's own params,
		// exactly as the runtime `<ComponentInstance>` resolves it — so a shared def carrying
		// this project's appearance previews as the game draws it. (The `componentParams` prop
		// is the Component Editor's open-component preview, a different concern.) No sidecar ⇒
		// `undefined` ⇒ parity.
		// Per-ratio param overrides (`node.overrides[layoutType].params`) merged onto the base
		// instance params for the active device layout, so the canvas previews e.g. a smaller
		// portrait font exactly as the game will resolve it. No override ⇒ `node.params` verbatim.
		// Params the instance forwards from the enclosing one win over its own, as in the game.
		const params = resolveComponentParams(
			def,
			forwardInstanceParams(node, resolveLayoutInstanceParams(node, layoutType), outerParams),
			componentDefaults[def.id],
		);
		// A nested bound-component that previews a RIG (the win / free-spin VISUAL) renders the
		// instance's AUTHORED rig (its first `spine`-kind param value, else the catalog bundle), so
		// the real art shows here + its readiness key matches the rig the WebGL layer draws.
		const rigBundle = instancePreviewRigBundle(def, params);
		for (const child of def.root.children) {
			drawNode(ctx, child, sceneCtx, componentDepth + 1, stack, params, true, rigBundle);
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
		/** Drawn as a window cover: the game ignores `slice` there, so the canvas does too. */
		cover = false,
	): void {
		const assetKey = assetKeyOverride ?? node.assetKey;
		const region = regionOverride ?? node.region ?? '';
		if (node.slice && !cover && drawSlicedRegion(ctx, node.slice, assetKey, region, t, tint))
			return;
		drawArtRegionSprite(
			ctx,
			assetKey,
			region,
			node.keepAspect ? keepAspectTransform(t, frameNaturalSize(assetKey, region)) : t,
			node.label,
			tint,
		);
	}

	const NO_SLICE = { left: 0, top: 0, right: 0, bottom: 0 };

	/**
	 * Whether a top-level node draws as a window cover — the game's `isCover` (`LayoutNodeView`):
	 * any cover kind on a `background` screen, or a `coverFit` one on a `canvas` screen.
	 */
	function drawsAsCover(node: LayoutNode, sceneCtx: Scene, nested: boolean): boolean {
		if (nested) return false;
		if (sceneCtx.space === 'background') return isBackgroundCoverKind(node);
		return sceneCtx.space === 'canvas' && node.coverFit === true && isCoverFitKind(node);
	}

	/** Scratch canvas a TINTED slice is composed on before `drawTintedImage` multiplies it. */
	let sliceScratch: HTMLCanvasElement | null = null;

	/**
	 * A `slice` sprite, as the game's `SlicedSprite` draws it: the region's packed art (never its
	 * Art bounds or trim box), sliced by its insets into the DISPLAYED box, then divided back by the
	 * scale this context already carries, so corners keep their art size whatever the node's scale.
	 * The box is the game's: `width·scale` when sized, the art × scale when not, and the art alone
	 * on an axis left unsized beside a sized one (`LayoutNodeView` drops `scale` once either is
	 * set). A negative box flips about the anchor, as the game's does. False until the region and
	 * its page resolve; the caller then draws the usual placeholder.
	 */
	function drawSlicedRegion(
		ctx: CanvasRenderingContext2D,
		mode: SliceMode,
		assetKey: string,
		regionName: string,
		t: ResolvedTransform,
		tint?: number,
	): boolean {
		const found = regionName ? findRegion(assetKey, regionName) : null;
		if (!found || !found.set.pageKey) return false;
		const img = ensureImage(found.set.pageKey);
		if (!img || !img.complete || img.naturalWidth === 0) return false;
		const { region } = found;
		const sx = t.scale?.x ?? 1;
		const sy = t.scale?.y ?? 1;
		const sized = t.width !== undefined || t.height !== undefined;
		const bw = t.width !== undefined ? t.width * sx : region.w * (sized ? 1 : sx);
		const bh = t.height !== undefined ? t.height * sy : region.h * (sized ? 1 : sy);
		const w = Math.abs(bw);
		const h = Math.abs(bh);
		if (sx === 0 || sy === 0 || !(w > 0) || !(h > 0)) return true;
		const insets = artSliceOf(found.set.assetKey, region.name) ?? NO_SLICE;
		const ax = t.anchor?.x ?? 0;
		const ay = t.anchor?.y ?? 0;
		ctx.save();
		ctx.scale(Math.sign(bw) / sx, Math.sign(bh) / sy);
		ctx.translate(-w * ax, -h * ay);
		if (tint === undefined || tint === 0xffffff) {
			drawNineSlice(ctx, img, region, insets, w, h, mode);
		} else {
			// Composed at the canvas's own pixel density (zoom × DPR), so a tinted slice is as crisp
			// as an untinted one.
			const m = ctx.getTransform();
			const res = Math.min(4, Math.max(1, Math.hypot(m.a, m.b), Math.hypot(m.c, m.d)));
			if (!sliceScratch) sliceScratch = document.createElement('canvas');
			sliceScratch.width = Math.max(1, Math.ceil(w * res));
			sliceScratch.height = Math.max(1, Math.ceil(h * res));
			const sctx = sliceScratch.getContext('2d');
			if (sctx) {
				sctx.scale(res, res);
				drawNineSlice(sctx, img, region, insets, w, h, mode);
				const cw = sliceScratch.width;
				const ch = sliceScratch.height;
				drawTintedImage(ctx, sliceScratch, 0, 0, cw, ch, 0, 0, cw / res, ch / res, tint);
			}
		}
		ctx.restore();
		return true;
	}

	/**
	 * A `keepAspect` sprite's box, as the game's `<Sprite contain>` draws it: the frame fitted inside
	 * the DISPLAYED box (`width·scale` × `height·scale` — the game folds scale into the size), then
	 * divided back by the scale the canvas transform applies. Unsized or unresolved ⇒ unchanged.
	 */
	function keepAspectTransform(
		t: ResolvedTransform,
		natural: { w: number; h: number } | null,
	): ResolvedTransform {
		if (!natural || t.width === undefined || t.height === undefined) return t;
		const sx = t.scale?.x ?? 1;
		const sy = t.scale?.y ?? 1;
		const fit = Math.min((t.width * sx) / natural.w, (t.height * sy) / natural.h);
		return { ...t, width: (natural.w * fit) / sx, height: (natural.h * fit) / sy };
	}

	/**
	 * Draw a skinned part's art layers centred on the part, bottom → top — the same layers, box and
	 * fill reveal the game's coded part draws (`HoldAndWinPot`), with a fill shown at
	 * {@link POT_PREVIEW_FILL_SHARE} so the author sees which way it grows. `overNodes` picks the
	 * layers the game draws over the part's nodes (true) or under them (false).
	 */
	function drawPartSkin(
		ctx: CanvasRenderingContext2D,
		skin: PartSkinBinding,
		params: Record<string, unknown>,
		t: ResolvedTransform,
		overNodes: boolean,
	): void {
		const { width, height } = partSkinSize(skin, params);
		for (const layer of skin.layers) {
			if (!!layer.overNodes !== overNodes) continue;
			const image = partSkinImage(params, layer.imageParam);
			if (!image) continue;
			const { assetKey, region } = parseScopedFrameRef(image);
			const layerT = { ...t, anchor: { x: 0.5, y: 0.5 }, width, height };
			if (!layer.directionParam) {
				drawArtRegionSprite(ctx, assetKey ?? '', region, layerT);
				continue;
			}
			const found = findRegion(assetKey ?? '', region);
			const boxed = found
				? artBoxGeometry(found.set.assetKey, found.region.name, found.region)
				: null;
			const natural = boxed
				? { w: boxed.origW, h: boxed.origH }
				: found
					? regionNaturalSize(found.region)
					: null;
			const w = width ?? natural?.w;
			const h = height ?? natural?.h;
			if (!w || !h) {
				drawArtRegionSprite(ctx, assetKey ?? '', region, layerT);
				continue;
			}
			const picked = params[layer.directionParam];
			const direction = POT_FILL_DIRECTIONS.find((d) => d === picked);
			const reveal = fillMaskRect(
				w,
				h,
				{ x: 0.5, y: 0.5 },
				POT_PREVIEW_FILL_SHARE,
				direction ?? 'right',
			);
			ctx.save();
			ctx.beginPath();
			ctx.rect(reveal.x, reveal.y, reveal.width, reveal.height);
			ctx.clip();
			drawArtRegionSprite(ctx, assetKey ?? '', region, layerT);
			ctx.restore();
		}
	}

	/** The natural size of a picked `<assetKey>::<region>` frame. */
	function tileImageNaturalSize(ref: string): { w: number; h: number } | null {
		const { assetKey, region } = parseScopedFrameRef(ref);
		return frameNaturalSize(assetKey ?? '', region);
	}

	/** A frame's natural size — its box when it declares one, as `drawArtRegionSprite` sizes it —
	 * or null until the region resolves. */
	function frameNaturalSize(assetKey: string, region: string): { w: number; h: number } | null {
		const found = region ? findRegion(assetKey, region) : null;
		if (!found) return null;
		const boxed = artBoxGeometry(found.set.assetKey, found.region.name, found.region);
		return boxed ? { w: boxed.origW, h: boxed.origH } : regionNaturalSize(found.region);
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

	/** rAF loop (runs continuously — cheap when idle): read the rig layers' published rider
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
	// left the loop un-started so the stand-in never drew even though the rig layers were
	// publishing bone transforms. The loop is torn down with the rest on unmount (onMount return).
	$effect(() => {
		if (!riderRaf) riderRaf = requestAnimationFrame(drawRiders);
	});

	/**
	 * Animate's ONION SKIN (Rive plan Phase 9b, editor-only): each ghost frame outlines the nodes the
	 * timeline drives there, earlier frames red and later ones green, fading with distance, with a
	 * dot at each pivot so the path reads. Top-level nodes of the edited screen only: a nested node's
	 * frame would need its parents' sampled too.
	 */
	function drawOnion(ctx: CanvasRenderingContext2D): void {
		const frames = onionPreview();
		if (!frames.length) return;
		const far = Math.max(...frames.map((f) => Math.abs(f.offset)));
		ctx.save();
		ctx.lineWidth = 1.25;
		for (const f of frames) {
			ctx.globalAlpha = 0.75 * (1 - (Math.abs(f.offset) - 1) / (far + 1));
			ctx.strokeStyle = ctx.fillStyle = f.offset < 0 ? '#ff6b6b' : '#7ee0c0';
			for (const node of visibleSceneNodes()) {
				const drive = f.drives.get(node.id);
				if (!drive) continue;
				const t = nodeTransform(node, scene, (n, lt) => onionResolveTransform(n, lt, drive));
				if (!t.visible) continue;
				const corners = nodeCornersWorld(t, boxOf(node, t)).map(worldToScreen);
				ctx.beginPath();
				ctx.moveTo(corners[0].x, corners[0].y);
				for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
				ctx.closePath();
				ctx.stroke();
				const pivot = worldToScreen({ x: t.x, y: t.y });
				ctx.beginPath();
				ctx.arc(pivot.x, pivot.y, 2.5, 0, Math.PI * 2);
				ctx.fill();
			}
		}
		ctx.restore();
	}

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

	/** "Any screen": outline the node a click would pick on ANOTHER screen, tagged with that screen's
	 *  name, so the author sees which screen the click switches to before making it. */
	function drawHoverPick(ctx: CanvasRenderingContext2D): void {
		if (!pickAcross || !hoverPick || hoverPick.sceneId === scene.id) return;
		const { sceneId, nodeId } = hoverPick;
		const s = scenes.find((x) => x.id === sceneId);
		const node = s?.nodes.find((n) => n.id === nodeId);
		if (!s || !node) return;
		const t = nodeTransform(node, s);
		const corners = nodeCornersWorld(t, boxOf(node, t)).map(worldToScreen);
		ctx.save();
		ctx.lineWidth = 1.5;
		ctx.strokeStyle = '#c4a1ff';
		ctx.setLineDash([4, 3]);
		ctx.beginPath();
		ctx.moveTo(corners[0].x, corners[0].y);
		for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
		ctx.closePath();
		ctx.stroke();
		ctx.setLineDash([]);
		const label = `${s.name || s.id} › ${node.label || node.id}`;
		const x = Math.min(...corners.map((c) => c.x));
		const y = Math.min(...corners.map((c) => c.y));
		ctx.font = '11px sans-serif';
		const w = ctx.measureText(label).width + 10;
		const tagY = y >= 18 ? y - 18 : y;
		ctx.fillStyle = '#c4a1ff';
		ctx.fillRect(x, tagY, w, 16);
		ctx.fillStyle = '#0b0b10';
		ctx.textBaseline = 'middle';
		ctx.fillText(label, x + 5, tagY + 8);
		ctx.restore();
	}

	function drawNodeSelection(
		ctx: CanvasRenderingContext2D,
		node: LayoutNode,
		withHandles: boolean,
	): void {
		const t = handleTransform(node);
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

		// A rig sits by its skeleton ORIGIN, which may be anywhere around its art (or outside its
		// box): mark it, so the point the node's x/y moves is visible.
		if (node.kind === 'spine') drawOriginMark(ctx, worldToScreen({ x: t.x, y: t.y }), accent);

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

	/** A crosshair in a ring at a node's origin (screen px). */
	function drawOriginMark(ctx: CanvasRenderingContext2D, p: Vec2, color: string): void {
		ctx.save();
		ctx.strokeStyle = color;
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
		ctx.moveTo(p.x - 9, p.y);
		ctx.lineTo(p.x + 9, p.y);
		ctx.moveTo(p.x, p.y - 9);
		ctx.lineTo(p.x, p.y + 9);
		ctx.stroke();
		ctx.restore();
	}

	// ---------- hit-test ----------

	function hitTestHandle(screen: Vec2): HandleHit | null {
		if (selectedIds.length !== 1 || !selectedId) return null;
		const node = findNodeById(selectedId);
		if (!node || node.locked || isBackgroundCover(node)) return null;
		const t = handleTransform(node);
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

	/** The pointer was over the stage at the last move — a `leave` is reported once, on exit. */
	let stageInside = false;
	/** The deepest node under `world` for the listener preview (`deepHit`), read off the DRAWN
	 *  transform (the value-binding preview folded on), so the pointer hits what the author sees. */
	function deepHitId(world: Vec2): string | null {
		return deepHit(
			visibleSceneNodes(),
			world,
			(node, nested) =>
				nested
					? childLocalTransform(
							node,
							layoutType,
							scene.space,
							frameWidth,
							frameHeight,
							previewPoseTransform,
						)
					: poseTransform(node),
			(node, t, p) => pointInQuad(p, nodeCornersWorld(t, boxOf(node, t))),
		);
	}

	function hitTestNode(world: Vec2, sceneCtx: Scene = scene): LayoutNode | null {
		const list = visibleSceneNodes(sceneCtx);
		for (let i = list.length - 1; i >= 0; i--) {
			const node = list[i];
			// Locked (Rive plan Phase 9a): the stage clicks through it; the Outline still selects it.
			if (node.locked) continue;
			const t = animate ? poseTransform(node, sceneCtx) : nodeTransform(node, sceneCtx);
			const box = boxOf(node, t);
			const corners = nodeCornersWorld(t, box);
			if (pointInQuad(world, corners)) return node;
		}
		return null;
	}

	/** The topmost node drawn under `world` on any screen (see {@link screensTopDown}). */
	function hitTestAnyScreen(world: Vec2): { scene: Scene; node: LayoutNode } | null {
		for (const s of screensTopDown()) {
			const node = hitTestNode(world, s);
			if (node) return { scene: s, node };
		}
		return null;
	}

	/** A plain click with "Any screen" on: a node on another screen first becomes that screen's
	 *  selection through `onPickInScene`. `scene` reads the page's edited screen, so after the switch
	 *  it already holds the picked node. Null when nothing is hit or the page kept its screen. */
	function pickAcrossScreens(world: Vec2): LayoutNode | null {
		const hit = hitTestAnyScreen(world);
		if (!hit) return null;
		if (hit.scene.id !== scene.id) onPickInScene?.(hit.scene.id, hit.node.id);
		return scene.id === hit.scene.id ? findNodeById(hit.node.id) : null;
	}

	function setHoverPick(next: { sceneId: string; nodeId: string } | null): void {
		if (next?.sceneId === hoverPick?.sceneId && next?.nodeId === hoverPick?.nodeId) return;
		hoverPick = next;
		schedule();
	}

	// ---------- drag handlers ----------

	/** Where the selection frame and handles sit: on the drawn (animated) pose in Animate. */
	function handleTransform(node: LayoutNode): ResolvedTransform {
		return animate ? poseTransform(node) : nodeTransform(node);
	}

	/** Animate with a keying panel: a stage gesture keys the timeline instead of editing. */
	const animateKeys = $derived(animate && !!onAnimateTransform);

	/** The fields a gesture can write on a node, put back when an Animate drag ends. */
	const GESTURE_FIELDS = ['x', 'y', 'scale', 'rotation', 'width', 'height', 'params', 'overrides'];
	/**
	 * An Animate drag in flight: each node's fields as they were and its resolved Design pose at the
	 * start. The gesture runs on the Design pose exactly as in Design (so the stage follows the
	 * pointer), and on release the pose is put back and the change is keyed instead.
	 */
	let animDrag: {
		nodes: { id: string; saved: string; start: ResolvedTransform }[];
		ratio?: number;
	} | null = null;

	function beginAnimateDrag(): void {
		if (!dragMode) return;
		const ids = dragMode.kind === 'translate' ? dragMode.group.map((g) => g.id) : [dragMode.nodeId];
		const nodes: { id: string; saved: string; start: ResolvedTransform }[] = [];
		for (const id of ids) {
			const n = findNodeById(id) as unknown as Record<string, unknown> | null;
			if (!n) continue;
			const saved: Record<string, unknown> = {};
			for (const f of GESTURE_FIELDS) if (f in n && n[f] !== undefined) saved[f] = n[f];
			nodes.push({
				id,
				saved: JSON.stringify(saved),
				start: resolveTransform(n as unknown as LayoutNode, layoutType),
			});
		}
		animDrag = { nodes };
		setAnimateDragging(true);
	}

	// Unmounted mid-drag (a mode or route switch): the Design pose goes back, nothing is keyed.
	onDestroy(() => {
		if (!animDrag) return;
		restoreAnimateDrag(animDrag);
		animDrag = null;
		setAnimateDragging(false);
	});

	/** Put each node's gesture fields back as they were, only where the gesture changed one. */
	function restoreAnimateDrag(drag: NonNullable<typeof animDrag>): void {
		for (const { id, saved } of drag.nodes) {
			const n = findNodeById(id) as unknown as Record<string, unknown> | null;
			if (!n) continue;
			const was = JSON.parse(saved) as Record<string, unknown>;
			for (const f of GESTURE_FIELDS) {
				if (JSON.stringify(n[f]) === JSON.stringify(was[f])) continue;
				if (f in was) n[f] = was[f];
				else delete n[f];
			}
		}
	}

	/** Put every dragged node's Design pose back and key what the gesture changed. */
	function finishAnimateDrag(): void {
		const drag = animDrag;
		const kind = dragMode?.kind;
		animDrag = null;
		if (!drag) return;
		const deltas: StageTransformDelta[] = [];
		const ends = drag.nodes.map(({ id }) => {
			const n = findNodeById(id);
			return n ? resolveTransform(n, layoutType) : null;
		});
		restoreAnimateDrag(drag);
		setAnimateDragging(false);
		for (const [i, { id, start }] of drag.nodes.entries()) {
			const end = ends[i];
			if (!end) continue;
			const delta: StageTransformDelta = { nodeId: id };
			if (kind === 'translate') {
				delta.dx = end.x - start.x;
				delta.dy = end.y - start.y;
			} else if (kind === 'scale' && drag.ratio !== undefined) delta.scale = drag.ratio;
			else if (kind === 'rotate')
				delta.rotation = (((end.rotation ?? 0) - (start.rotation ?? 0)) * 180) / Math.PI;
			deltas.push(delta);
		}
		if (deltas.length) onAnimateTransform?.(deltas);
	}

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
		const drawn = handleTransform(node);
		const box = boxOf(node, drawn);
		dragMode = {
			kind: 'scale',
			nodeId: node.id,
			cornerIdx,
			resizeAxis,
			startWorld: world,
			startScale: { x: t.scale?.x ?? 1, y: t.scale?.y ?? 1 },
			startDrawScale: { x: drawn.scale?.x ?? 1, y: drawn.scale?.y ?? 1 },
			startBox: box,
			startTx: drawn.x,
			startTy: drawn.y,
			startRot: drawn.rotation ?? 0,
		};
	}
	function startRotate(node: LayoutNode, world: Vec2): void {
		const t = nodeTransform(node);
		const drawn = handleTransform(node);
		const center = { x: drawn.x, y: drawn.y };
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
		// Snapping reads the authored layout, which an animated stage no longer shows: off in Animate.
		const snapped = animDrag
			? { x: dragMode.startNode.x + dx, y: dragMode.startNode.y + dy }
			: snapTranslate(node, dragMode.startNode.x + dx, dragMode.startNode.y + dy);
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
		const pivot = resizePivot(node, d.startBox);
		// Base (start) signed magnitudes, measured from the pivot; avoid div-by-zero.
		const baseX = (ref.x - pivot.x) * d.startDrawScale.x;
		const baseY = (ref.y - pivot.y) * d.startDrawScale.y;
		const newRefX = baseX + dxl;
		const newRefY = baseY + dyl;
		let sxRatio = baseX === 0 ? 1 : newRefX / baseX;
		let syRatio = baseY === 0 ? 1 : newRefY / baseY;
		// An EDGE handle resizes ONE axis — lock the other to its start size (ratio 1). A CORNER
		// handle defaults to uniform scale (average of the two abs ratios, signed); Shift makes it
		// non-uniform (free per-axis).
		// Animate keys ONE scale channel, so its drag is always uniform: what it shows is what keys.
		if (animDrag) {
			const avg =
				d.resizeAxis === 'x'
					? Math.abs(sxRatio)
					: d.resizeAxis === 'y'
						? Math.abs(syRatio)
						: (Math.abs(sxRatio) + Math.abs(syRatio)) / 2;
			sxRatio = Math.sign(sxRatio || 1) * avg;
			syRatio = Math.sign(syRatio || 1) * avg;
		} else if (d.resizeAxis === 'x') {
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
		if (animDrag) animDrag.ratio = Math.abs(sxRatio);
		const MIN = 0.05;
		let newSx = d.startScale.x * sxRatio;
		let newSy = d.startScale.y * syRatio;
		if (Math.abs(newSx) < MIN) newSx = Math.sign(newSx || 1) * MIN;
		if (Math.abs(newSy) < MIN) newSy = Math.sign(newSy || 1) * MIN;
		writeScale(node, newSx, newSy);
		// A pivot off the origin (a rig's box centre) holds still: the origin moves instead. An
		// Animate drag keys scale alone, so it scales about the origin there.
		if (animDrag || (pivot.x === 0 && pivot.y === 0)) return;
		const moved = resizeOriginShift(
			pivot,
			d.startDrawScale,
			{ x: newSx / (d.startScale.x || 1), y: newSy / (d.startScale.y || 1) },
			d.startRot,
		);
		writeXY(node, d.startTx + moved.x, d.startTy + moved.y);
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
		const def = instanceDef(componentMap, node);
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
		// Ruler guides join the candidates while their snap is on (the toolbar's ⌗ Snap).
		if (showRulers && snapToGuides) {
			xCandidates.push(...(guides?.x ?? []));
			yCandidates.push(...(guides?.y ?? []));
		}
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
		const rect = canvas?.getBoundingClientRect();
		zoomAround(
			zoom * (e.deltaY > 0 ? 0.9 : 1.1),
			rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : undefined,
		);
	}

	/** Zoom to `next` (clamped) keeping the stage point under `at` — the view centre by default — still. */
	function zoomAround(next: number, at?: Vec2): void {
		const z = Math.max(0.05, Math.min(8, next));
		const p = at ?? { x: (wrap?.clientWidth ?? 0) / 2, y: (wrap?.clientHeight ?? 0) / 2 };
		panX = p.x - ((p.x - panX) * z) / zoom;
		panY = p.y - ((p.y - panY) * z) / zoom;
		zoom = z;
		schedule();
	}

	/** ⌘0: 100%, the frame centred in the view. */
	function zoomTo100(): void {
		if (!wrap) return;
		zoom = 1;
		panX = (wrap.clientWidth - frameWidth) / 2;
		panY = (wrap.clientHeight - frameHeight) / 2;
		schedule();
	}

	function onMouseDown(e: MouseEvent): void {
		// Middle / right always pan.
		if (e.button === 1 || e.button === 2) {
			rightDownXY = e.button === 2 ? [e.clientX, e.clientY] : null;
			panning = true;
			lastXY = [e.clientX, e.clientY];
			e.preventDefault();
			return;
		}
		if (e.button !== 0) return;

		const rect = canvas!.getBoundingClientRect();
		const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
		const world = clientToWorld(e.clientX, e.clientY);
		if (animate) onStagePointer?.('down', deepHitId(world));

		// 1) handle hit (transform the lone selected node). Skipped while Shift is held —
		// Shift+click is reserved for multi-select / pan, not scale/rotate.
		if (!e.shiftKey && (!animate || animateKeys)) {
			const hh = hitTestHandle(screen);
			const node = hh && selectedId ? findNodeById(selectedId) : null;
			// A text box resizes its box, never its scale, so in Animate there is nothing to key.
			const boxOnly = !!node && animate && (node.kind === 'text' || isTextBoxInstance(node));
			if (hh && node && !(boxOnly && hh.kind !== 'rotate')) {
				if (hh.kind === 'corner') startScale(node, hh.idx, world);
				else if (hh.kind === 'edge')
					startScale(node, EDGE_TO_CORNER[hh.idx], world, EDGE_TO_AXIS[hh.idx]);
				else if (hh.kind === 'rotate') startRotate(node, world);
				else startTranslate(node, world);
				if (animateKeys) beginAnimateDrag();
				e.preventDefault();
				return;
			}
		}
		// 1b) a ruler guide under the pointer moves (or, dropped on a ruler, removes) it.
		if (!e.shiftKey && !animate && showRulers && onGuidesChange) {
			const hit = hitGuide(guides, world, zoom);
			if (hit) {
				const value = guides?.[hit.axis]?.[hit.index] ?? world[hit.axis];
				guideDrag = { axis: hit.axis, index: hit.index, value, remove: false, from: value };
				e.preventDefault();
				schedule();
				return;
			}
		}
		// 2) body hit on any node (on any drawn screen with "Any screen" on, Shift aside)
		const node = pickAcross && !e.shiftKey ? pickAcrossScreens(world) : hitTestNode(world);
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
			// Background-cover nodes select but never drag (transform is synthesised). Locked
			// nodes never get here: `hitTestNode` clicks through them.
			if ((!animate || animateKeys) && !isBackgroundCover(node)) {
				startTranslate(node, world);
				if (animateKeys) beginAnimateDrag();
			}
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
		if (guideDrag) {
			moveGuideDrag(e);
			return;
		}
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
			setHoverPick(null);
			if (animate && stageInside) onStagePointer?.('leave', null);
			stageInside = false;
			return;
		}
		stageInside = true;
		if (animate && onStagePointer)
			onStagePointer('move', deepHitId(clientToWorld(e.clientX, e.clientY)));
		hoverHandle = hitTestHandle(screen);
		hoverGuideAxis =
			!hoverHandle && !animate && showRulers && onGuidesChange
				? (hitGuide(guides, clientToWorld(e.clientX, e.clientY), zoom)?.axis ?? null)
				: null;
		let hoverId: string | null = null;
		let pick: { sceneId: string; nodeId: string } | null = null;
		if (!hoverHandle) {
			const w = clientToWorld(e.clientX, e.clientY);
			if (pickAcross && !e.shiftKey) {
				const hit = hitTestAnyScreen(w);
				if (hit?.scene.id === scene.id) hoverId = hit.node.id;
				else if (hit) pick = { sceneId: hit.scene.id, nodeId: hit.node.id };
			} else {
				hoverId = hitTestNode(w)?.id ?? null;
			}
		}
		hoverNodeId = hoverId;
		setHoverPick(pick);
	}

	function onWindowMouseUp(e: MouseEvent): void {
		if (guideDrag) {
			endGuideDrag();
			return;
		}
		if (e.button === 2) openInstanceMenuAt(e);
		if (animate && onStagePointer && canvas && e.button === 0) {
			const rect = canvas.getBoundingClientRect();
			const inside =
				e.clientX >= rect.left &&
				e.clientX <= rect.right &&
				e.clientY >= rect.top &&
				e.clientY <= rect.bottom;
			// A release off the stage is no `up` on any node (as in the game).
			onStagePointer('up', inside ? deepHitId(clientToWorld(e.clientX, e.clientY)) : null);
		}
		panning = false;
		lastXY = null;
		if (dragMode) {
			const keying = !!animDrag;
			if (keying) finishAnimateDrag();
			dragMode = null;
			snapLines = [];
			schedule();
			if (!keying) onDirty?.();
		}
	}

	/** The `Shift+/` shortcut sheet is open over the stage. */
	let cheatSheetOpen = $state(false);

	function onKeyDown(e: KeyboardEvent): void {
		// Don't hijack typing in form fields (properties panel inputs etc.).
		if (isTypingTarget(e.target) || dialogQueue.current) return;
		// Both sides' canvases listen on `window`; only the one on screen answers.
		if (!wrap || wrap.getClientRects().length === 0) return;
		if (guideDrag && e.key === 'Escape') {
			guideDrag = null;
			schedule();
			e.preventDefault();
			return;
		}
		if (cheatSheetOpen && (e.key === 'Escape' || e.key === '?')) {
			cheatSheetOpen = false;
			e.preventDefault();
			return;
		}

		if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length > 0 && !animate) {
			// Delete every selected node that isn't locked, in one transaction.
			const ids = selectedIds.filter((id) => {
				const n = findNodeById(id);
				return n && !n.locked;
			});
			if (ids.length === 0) return;
			e.preventDefault();
			if (ids.length === 1 || !onDeleteMany) ids.forEach((id) => onDelete?.(id));
			else onDeleteMany(ids);
			return;
		}
		const action = stageShortcut(e);
		if (!action) return;
		// `Enter` / `Tab` are the stage's only from the stage itself (focus on the page body or inside
		// the canvas); on any focused widget they keep their meaning (press it, move focus on).
		if (
			(action.kind === 'selectFirstChild' || action.kind === 'toggleMode') &&
			!ownsFocusKeys(e.target, document.body, wrap)
		)
			return;
		if (applyStageAction(action)) e.preventDefault();
	}

	/** Run a {@link stageShortcut} action; `false` when it does nothing here (the key stays native). */
	function applyStageAction(action: StageAction): boolean {
		switch (action.kind) {
			case 'selectParent': {
				if (!selectedId) return false;
				selectOnly(parentIdOf(scene.nodes, selectedId));
				schedule();
				return true;
			}
			case 'selectFirstChild': {
				const child = selectedId ? firstChildIdOf(scene.nodes, selectedId) : null;
				if (!child) return false;
				selectOnly(child);
				schedule();
				return true;
			}
			case 'reveal':
				if (!selectedId || !onRevealSelection) return false;
				onRevealSelection(selectedId);
				return true;
			case 'fit':
				fitView();
				return true;
			case 'zoomTo100':
				zoomTo100();
				return true;
			case 'zoomBy':
				zoomAround(zoom * action.factor);
				return true;
			case 'nudge':
				return nudgeSelection(action.dx, action.dy);
			case 'toggleMode':
				if (!onToggleMode) return false;
				onToggleMode();
				return true;
			case 'cheatSheet':
				cheatSheetOpen = !cheatSheetOpen;
				return true;
		}
	}

	/** Arrow nudge (Design): every selected top-level node that the stage could drag moves by
	 *  `dx`/`dy` in its own stored units. */
	function nudgeSelection(dx: number, dy: number): boolean {
		if (animate) return false;
		const nodes = selectedIds
			.map((id) => findNodeById(id))
			.filter(
				(n): n is LayoutNode => !!n && !lockedInTree(scene.nodes, n.id) && !isBackgroundCover(n),
			);
		if (nodes.length === 0) return false;
		for (const n of nodes) {
			const k = isGameSpaceNode(n) ? mainScale() : 1;
			const xy = effectiveXY(n);
			writeXY(n, xy.x + dx * k, xy.y + dy * k);
		}
		bumpFrame();
		schedule();
		onDirty?.();
		return true;
	}

	function onDoubleClick(e: MouseEvent): void {
		if (!onEditInstance || e.button !== 0) return;
		const node = hitTestNode(clientToWorld(e.clientX, e.clientY));
		if (node?.kind !== 'componentInstance') return;
		e.preventDefault();
		onEditInstance(node);
	}

	function onDragOver(e: DragEvent): void {
		if (!e.dataTransfer || animate) return;
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
		if (!e.dataTransfer || animate) return;
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
		// carry an empty `key` by design; only ASSET kinds (region/atlas-page/rig)
		// reference a key. Requiring a key here silently rejected the keyless drops.
		if (!payload || !payload.kind) return;
		const keyless =
			payload.kind === 'text' || payload.kind === 'rect' || payload.kind === 'segments';
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
			// An authored Invisible Flipbook clip (id in `key`). Spawned UNSIZED, like a rig and
			// unlike a region sprite: the frames are atlas art, so the node draws at the frames'
			// native size until the author resizes it — and the sheet behind them may still be
			// loading at drop time, so there is no native size to bake in yet.
			case 'flipbook':
				return { ...base, kind: 'flipbook', clipId: p.key };
			// The Components side's "Repeat (count)" element: a segmented counter of `key`.
			case 'segments':
				return newCountRepeater(base, p.key);
			case 'component':
				return {
					...base,
					kind: 'componentInstance',
					componentId: p.key,
					...(p.version !== undefined ? { componentVersion: p.version } : {}),
				};
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
		void gameView;
		void scenes;
		void scene;
		void layoutType;
		// Toggling the always-on-top screen-border overlay repaints the HUD canvas.
		void showScreenBorder;
		// Rulers and guides: the toggles, the stored guides and a guide in flight.
		void showRulers;
		void snapToGuides;
		void guides;
		void guideDrag;
		// Forced repaint signal (undo/redo): a position-only restore reassigns `scenes`
		// but changes no node count, so without this the composite can stay stale.
		void redrawNonce;
		// A scrubbed value-binding test value ("Bind to value") repaints the preview.
		void previewVersion();
		// A count-mode repeater's segment timelines arriving re-poses its segments.
		void segmentTimelinesVersion();
		// A region's declared BOX lives outside the layout doc (it describes the ART, not a
		// placement), so no doc field changes when one is dragged — this counter is the signal.
		// ONE cheap dependency that changes only when a box does; the boxes themselves stay in a
		// non-reactive map for the same reason `clipsById` does (`draw()` reads it, and several
		// effects call `draw()` synchronously).
		void artBoundsVersion();
		void artSlicesVersion();
		schedule();
	});

	/**
	 * Bake each background-space `componentInstance`'s measured union onto the node
	 * (`coverBox`), so the GAME covers it by the box the editor actually previewed.
	 *
	 * The game cannot re-derive this box. Its `componentDesignSize` walk is fed an `intrinsic`
	 * that sizes only a SPRITE, so a rig / text / flipbook / nested-instance child is skipped
	 * outright — an overlay built from those measured far smaller there than here, and one with
	 * no sprite child at all measured nothing, lost its cover, and rendered at its raw authored
	 * x/y. The editor is the only surface that HAS the measurements (rig setup-pose bounds
	 * from the WebGL overlay, rendered glyph boxes, clip frame rects), so it writes the number
	 * down rather than asking the runtime to guess it.
	 *
	 * BASE bucket only: a per-ratio child override makes the union bucket-dependent, and the
	 * runtime reads one `coverBox` — so authoring in Portrait must not silently re-bake the
	 * value every bucket shares. Written silently (no `onDirty`): it rides along on the next
	 * save rather than making a bucket switch look like an edit.
	 */
	$effect(() => {
		void scenes;
		void componentMap;
		// The measurement maps this union is built from — reassigned wholesale when a rig's
		// bounds or a text node's glyph box lands, so the bake re-runs once the art is real.
		void rigNaturalSizes;
		void textMeasured;
		if (layoutType !== baseLayoutType) return;
		const r3 = (n: number) => Math.round(n * 1000) / 1000;
		for (const sc of scenes) {
			if (sc.space !== 'background') continue;
			for (const n of sc.nodes) {
				if (n.kind !== 'componentInstance') continue;
				const box = boxOf(n, resolveTransform(n, layoutType));
				// `nodeBox`'s generic 160x100 is "could not measure", not a real union — baking it
				// would pin the overlay to a wrong box FOREVER, which is worse than the fallback.
				if (!(box.w > 0) || !(box.h > 0) || (box.w === 160 && box.h === 100)) continue;
				const next = {
					minX: r3(-box.ax * box.w),
					minY: r3(-box.ay * box.h),
					width: r3(box.w),
					height: r3(box.h),
				};
				const prev = n.coverBox;
				if (
					prev &&
					prev.minX === next.minX &&
					prev.minY === next.minY &&
					prev.width === next.width &&
					prev.height === next.height
				)
					continue;
				n.coverBox = next;
			}
		}
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
		// overlay show the rig play toggle + a real subtitle for catalog anchors
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
		// Like a resize drag, a rig holds its box centre still, not its origin.
		const pivot = resizePivot(node, boxOf(node, t));
		if (pivot.x !== 0 || pivot.y !== 0) {
			const shift = resizeOriginShift(
				pivot,
				{ x: t.scale?.x ?? 1, y: t.scale?.y ?? 1 },
				{ x: factor, y: factor },
				t.rotation ?? 0,
			);
			writeXY(node, t.x + shift.x, t.y + shift.y);
		}
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
		if (guideDrag) return guideDrag.axis === 'x' ? 'cursor-ew' : 'cursor-ns';
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
		if (hoverGuideAxis) return hoverGuideAxis === 'x' ? 'cursor-ew' : 'cursor-ns';
		if (hoverHandle?.kind === 'body' || hoverNodeId) return 'cursor-move';
		if (pickAcross && hoverPick) return 'cursor-pick';
		return 'cursor-cross';
	});

	// ---------- Element FX preview (the ▶ on an Element FX row) ----------

	/** The preview playing on this stage, as the function that ends it. */
	let fxPreviewStop: (() => void) | null = null;
	/** How far a node's still reaches past its box, as a share of its larger side: a glow or a
	 *  shadow the element draws past its box comes along. */
	const FX_STILL_MARGIN = 0.12;
	/** Frames the layers get to redraw a changed hidden set: the 2D canvas and the text and FX
	 *  overlays draw on the next frame, the rig overlay every frame. */
	const FX_REDRAW_FRAMES = 3;
	/** A HUD preview's overlay: above the HUD's own layers (1000–1001), below the controls (2000). */
	const FX_HUD_OVERLAY_Z = 1002;
	/** The frozen stage a still is cut under: above every overlay, below the controls. */
	const FX_COVER_Z = 1003;

	/** Node `id` of `s` and the containers above it, outermost first; null when it is not in `s`. */
	function fxChain(s: Scene, id: string): LayoutNode[] | null {
		const above = ancestorIds(s.nodes, id);
		if (!above) return null;
		const chain: LayoutNode[] = [];
		for (const x of [...above, id]) {
			const n = findById(s.nodes, x);
			if (!n) return null;
			chain.push(n);
		}
		return chain;
	}

	/** The stage rect `chain`'s leaf draws in — the selection outline's corners on the DRAWN pose,
	 *  through every container above it — or null when it or a container above it is hidden. */
	function fxNodeRect(s: Scene, chain: LayoutNode[]): StageRect | null {
		const top = (n: LayoutNode): ResolvedTransform => drawTransform(n, s);
		const child = (n: LayoutNode): ResolvedTransform =>
			childLocalTransform(n, layoutType, s.space, frameWidth, frameHeight, previewResolveTransform);
		const own = chain.map((n, i) => (i === 0 ? top(n) : child(n)));
		if (own.some((t) => !t.visible)) return null;
		const t = own[own.length - 1];
		const [a, b, c, d, tx, ty] = composeWorldMatrix(chain.slice(0, -1), top, child);
		const corners = nodeCornersWorld(t, boxOf(chain[chain.length - 1], t)).map((p) =>
			worldToScreen({ x: a * p.x + c * p.y + tx, y: b * p.x + d * p.y + ty }),
		);
		const xs = corners.map((p) => p.x);
		const ys = corners.map((p) => p.y);
		const x = Math.min(...xs);
		const y = Math.min(...ys);
		return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
	}

	/** The composite group game screen `s` draws in. */
	function fxSceneGroup(s: Scene): HTMLElement | null {
		return (
			wrap?.querySelector<HTMLElement>(`.scene-group[data-scene-id="${CSS.escape(s.id)}"]`) ?? null
		);
	}

	/** The HUD screens' 2D art alone, at the HUD canvas's size: that canvas also draws the
	 *  selection, the guides and the onion skin, which must stay out of a still. */
	function paintHudArt(): HTMLCanvasElement | null {
		if (!hudCanvas) return null;
		const out = document.createElement('canvas');
		out.width = hudCanvas.width;
		out.height = hudCanvas.height;
		const ctx = out.getContext('2d');
		if (!ctx) return null;
		const dpr = window.devicePixelRatio || 1;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.translate(panX, panY);
		ctx.scale(zoom, zoom);
		for (const s of scenes) {
			if (hiddenSceneIds.has(s.id) || !isHudScene(s)) continue;
			for (const node of s.nodes) drawNode(ctx, node, s);
		}
		return out;
	}

	/** What a still of screen `s` is copied from, bottom first: its scene group's surfaces, or —
	 *  the HUD screens sharing theirs — the HUD's art and overlays. Never another still's overlay. */
	function fxStillSources(s: Scene, origin: DOMRect): StillSource[] {
		const sources: (StillSource | null)[] = [];
		if (isHudScene(s)) {
			const art = paintHudArt();
			const at = hudCanvas ? stageSource(hudCanvas, origin) : null;
			if (art && at) sources.push({ ...at, canvas: art });
			const layers = '.hud-rig-layer canvas, .hud-text-layer canvas, .hud-effect-layer canvas';
			for (const c of wrap?.querySelectorAll<HTMLCanvasElement>(layers) ?? []) {
				sources.push(stageSource(c, origin));
			}
		} else {
			for (const c of fxSceneGroup(s)?.querySelectorAll('canvas') ?? []) {
				if (!isFxOverlayCanvas(c)) sources.push(stageSource(c, origin));
			}
		}
		return sources.filter((source): source is StillSource => source !== null);
	}

	/** Where a still of a target comes from and goes on this stage. */
	interface FxStillPlan {
		hud: boolean;
		/** The overlay's home: the screen's group, or the stage for a HUD screen. */
		mount: HTMLElement;
		/** The still on the stage, and the target's own box inside it. */
		rect: StageRect;
		element: StageRect;
		/** The canvas's edge cut part of the still off. */
		clipped: boolean;
		/** Hidden while the still is cut: everything on its surfaces but the target. */
		isolate: ReadonlySet<string>;
		/** Hidden while the overlay stands in for it: the target. */
		hide: ReadonlySet<string>;
	}

	/** The still of `target` on screen `s`, or null when this stage does not show it. */
	function fxStillPlan(s: Scene, target: ElementFxPreviewTarget): FxStillPlan | null {
		if (!wrap || !canvas || hiddenSceneIds.has(s.id)) return null;
		const hud = isHudScene(s);
		// The HUD screens share their surfaces, so a HUD still also hides the other HUD screens.
		const besides = hud
			? scenes
					.filter((other) => other !== s && isHudScene(other))
					.flatMap((other) => flattenSceneIds(other.nodes))
			: [];
		let box: StageRect | null;
		let isolate: ReadonlySet<string>;
		let hide: ReadonlySet<string>;
		if (target.kind === 'screen') {
			const a = worldToScreen({ x: 0, y: 0 });
			const b = worldToScreen({ x: frameWidth, y: frameHeight });
			box = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
			isolate = new Set(besides);
			hide = new Set(flattenSceneIds(s.nodes));
		} else {
			const chain = fxChain(s, target.id);
			box = chain && fxNodeRect(s, chain);
			isolate = new Set([...effectiveHiddenIds(s.nodes, new Set(), target.id), ...besides]);
			hide = effectiveHiddenIds(s.nodes, new Set([target.id]), null);
		}
		if (!box) return null;
		const margin = target.kind === 'node' ? FX_STILL_MARGIN * Math.max(box.w, box.h) : 0;
		const whole = {
			x: box.x - margin,
			y: box.y - margin,
			w: box.w + 2 * margin,
			h: box.h + 2 * margin,
		};
		const rect = intersectRect(whole, {
			x: 0,
			y: 0,
			w: canvas.clientWidth,
			h: canvas.clientHeight,
		});
		const inside = rect && intersectRect(box, rect);
		const mount = hud ? wrap : fxSceneGroup(s);
		if (!rect || !inside || !mount) return null;
		const element = { ...inside, x: inside.x - rect.x, y: inside.y - rect.y };
		const clipped = rect.w < whole.w - 0.5 || rect.h < whole.h - 0.5;
		return { hud, mount, rect, element, clipped, isolate, hide };
	}

	/** Cut `plan`'s still from what the stage's surfaces show now. */
	function fxCaptureStill(s: Scene, plan: FxStillPlan): HTMLCanvasElement | null {
		if (!canvas) return null;
		const sources = fxStillSources(s, canvas.getBoundingClientRect());
		return captureStill(sources, plan.rect, window.devicePixelRatio || 1);
	}

	/** The overlays' hidden sets on this stage: ▶'s, the posed effects', and a posed still's cut. */
	const FX_PLAY_OWNER = Symbol('element fx ▶');
	const FX_POSED_OWNER = Symbol('element fx posed');
	const FX_CAPTURE_OWNER = Symbol('element fx posed still');

	/**
	 * Play `entry` on a still of `target` on this stage (see `elementFxPreview.client.svelte.ts`):
	 * hide everything else on its screen, wait for the layers to redraw, copy the screen's surfaces,
	 * then show only the screen around it while the overlay plays. Null when this stage does not show
	 * the target. Escape, a press or a wheel on the stage ends it.
	 *
	 * A screen (not a HUD one, whose surfaces it shares) plays LIVE: its surfaces go on drawing,
	 * hidden, and are copied into the still every frame, so a timeline on it keeps playing under the
	 * effect. A node's still follows where the previewed timeline draws the node.
	 */
	function previewElementFx(
		target: ElementFxPreviewTarget,
		entry: ElementFxEntry,
		finished: () => void,
	): (() => void) | null {
		const stage = wrap;
		if (!stage || stage.clientWidth === 0 || stage.clientHeight === 0) return null;
		const s = scenes.find((x) =>
			target.kind === 'screen' ? x.id === target.sceneId : ancestorIds(x.nodes, target.id) !== null,
		);
		const plan = s && fxStillPlan(s, target);
		if (!s || !plan) return null;

		const view = { panX, panY, zoom, layoutType };
		const liveScreen = target.kind === 'screen' && !plan.hud;
		/** A live screen's own surfaces: drawing on, hidden while its still stands in for them. */
		const hiddenSurfaces: HTMLCanvasElement[] = [];
		const hideSurfaces = (sources: readonly StillSource[]): void => {
			for (const { canvas: surface } of sources) {
				if (hiddenSurfaces.includes(surface)) continue;
				hiddenSurfaces.push(surface);
				surface.style.visibility = 'hidden';
			}
		};
		let over = false;
		let stopOverlay: (() => void) | null = null;
		let uncover = coverStage(stage, FX_COVER_Z);
		const lift = (): void => {
			uncover();
			uncover = () => {};
		};
		// Escape ends the preview only: the stage's own Escape (select the parent) must not run too.
		const onKey = (e: KeyboardEvent): void => {
			if (e.key !== 'Escape') return;
			e.preventDefault();
			e.stopPropagation();
			cancel();
		};
		const close = (): void => {
			window.removeEventListener('keydown', onKey, true);
			stage.removeEventListener('pointerdown', cancel, true);
			stage.removeEventListener('wheel', cancel, true);
			lift();
			setFxPreviewHidden(new Set(), FX_PLAY_OWNER);
			for (const surface of hiddenSurfaces.splice(0)) surface.style.visibility = '';
			if (fxPreviewStop === cancel) fxPreviewStop = null;
			finished();
		};
		const cancel = (): void => {
			if (over) return;
			over = true;
			stopOverlay?.();
			close();
		};
		fxPreviewStop = cancel;
		window.addEventListener('keydown', onKey, true);
		stage.addEventListener('pointerdown', cancel, true);
		stage.addEventListener('wheel', cancel, { capture: true, passive: true });
		setFxPreviewHidden(plan.isolate, FX_PLAY_OWNER);
		void afterFrames(FX_REDRAW_FRAMES).then(() => {
			if (over) return;
			const still = fxCaptureStill(s, plan);
			if (!still) return cancel();
			const chain = target.kind === 'node' ? fxChain(s, target.id) : null;
			const cutAt = chain && invertAffine(fxStageMatrix(s, chain));
			const from = cutAt && matMul(cutAt, [1, 0, 0, 1, plan.rect.x, plan.rect.y]);
			let placed: Affine = [1, 0, 0, 1, plan.rect.x, plan.rect.y];
			/** Where the still goes now: on the node, where the previewed timeline draws it (where it
			 *  last was, if the node is gone). */
			const placement = (): Affine => {
				const now = target.kind === 'node' ? fxChain(s, target.id) : null;
				if (from && now) placed = matMul(fxStageMatrix(s, now), from);
				return placed;
			};
			/** The screen's surfaces as they are now, copied over the still; any new one hidden too. */
			const refresh = (): boolean => {
				if (!canvas) return false;
				const sources = fxStillSources(s, canvas.getBoundingClientRect());
				hideSurfaces(sources);
				return drawStill(still, sources, plan.rect);
			};
			stopOverlay = playOnStill({
				...plan,
				zIndex: plan.hud ? FX_HUD_OVERLAY_Z : undefined,
				still,
				entry,
				refresh: liveScreen ? refresh : undefined,
				placement: from ? placement : undefined,
				onShown: () => {
					if (liveScreen) {
						if (canvas) hideSurfaces(fxStillSources(s, canvas.getBoundingClientRect()));
						void afterFrames(1).then(lift);
						return;
					}
					setFxPreviewHidden(plan.hide, FX_PLAY_OWNER);
					void afterFrames(FX_REDRAW_FRAMES).then(lift);
				},
				onEnd: () => {
					if (over) return;
					over = true;
					close();
				},
				stale: () =>
					panX !== view.panX ||
					panY !== view.panY ||
					zoom !== view.zoom ||
					layoutType !== view.layoutType,
			});
		});
		return cancel;
	}

	// ---------- Element FX posed by a previewed timeline ----------

	/** How long a posed node's art, or a view that crops or blurs its still, must hold before the
	 *  still is cut again: a drag, a pan or a slider re-cuts once, when it settles. */
	const FX_RECUT_MS = 300;
	/** Zooming in past this many times the zoom a still was cut at cuts it again, sharp. */
	const FX_RECUT_ZOOM = 1.25;

	/** A node whose keyed Element FX the previewed timeline poses: an overlay on a still of it. */
	interface PosedFx {
		/** What the still shows (the node's art in the layout); a change cuts it again. */
		signature: string;
		/** The entries the overlay poses; a change re-poses them on the same still. */
		entriesKey: string;
		/** The view the still was cut in, and whether the canvas's edge cropped it. */
		view: { panX: number; panY: number; zoom: number };
		clipped: boolean;
		/** A new cut waiting for the art and the view to settle: what it would cut, and since when. */
		pending: { key: string; since: number } | null;
		/** The node's stage matrix when the still was cut, inverted, then the still's offset — so
		 *  `stage matrix now × from` places the still where the node draws now. */
		from: Affine;
		placement: Affine;
		hide: ReadonlySet<string>;
		/** Null when no still could be cut (tried again once the node or the view changes). */
		overlay: PosedOverlay | null;
	}
	interface PosedCut {
		s: Scene;
		id: string;
		signature: string;
		entries: ElementFxEntry[];
	}
	let posedFx: Record<string, PosedFx> = {};
	/** The node a still is being cut for: one at a time, as each hides the rest of its screen. */
	let posedCutting: string | null = null;
	let posedDisposed = false;
	let posedSettle: ReturnType<typeof setTimeout> | undefined;

	/** Node `id` and the screen it is on. */
	function posedNode(id: string): { s: Scene; node: LayoutNode } | null {
		const s = scenes.find((x) => ancestorIds(x.nodes, id) !== null);
		const node = s ? findById(s.nodes, id) : null;
		return s && node ? { s, node } : null;
	}

	/** What a still of `node` shows: the node but its Element FX (posed on the still) and the
	 *  editor's baked cover box (a measurement the cut itself can move). */
	const posedSignature = (node: LayoutNode): string =>
		JSON.stringify([layoutType, { ...node, elementFx: undefined, coverBox: undefined }]);

	/** The still no longer shows `node` as the stage would: its art changed, or the view moved off a
	 *  still the canvas's edge cropped (or one it could not cut at all), or zoomed in past its
	 *  resolution. */
	function posedOutdated(posed: PosedFx, signature: string): boolean {
		const { view } = posed;
		const moved = panX !== view.panX || panY !== view.panY || zoom !== view.zoom;
		return (
			posed.signature !== signature ||
			((posed.clipped || !posed.overlay) && moved) ||
			zoom > view.zoom * FX_RECUT_ZOOM
		);
	}

	/** `chain`'s leaf's local space → stage px, on the pose the preview draws it at, hidden or not. */
	function fxStageMatrix(s: Scene, chain: LayoutNode[]): Affine {
		const world = composeWorldMatrix(
			chain,
			(n) => nodeTransform(n, s, previewDrawnTransform),
			(n) =>
				childLocalTransform(n, layoutType, s.space, frameWidth, frameHeight, previewDrawnTransform),
		);
		return matMul([zoom, 0, 0, zoom, panX, panY], world);
	}

	function dropPosed(id: string): void {
		posedFx[id]?.overlay?.stop();
		delete posedFx[id];
	}

	/**
	 * Follow the previewed timeline's Element FX poses: a node it poses past rest gets a still and an
	 * overlay posing its keyed entries, which stays up until the preview ends; the real node hides
	 * only while an entry is past its rest. An edit of the entries re-poses them on the same still;
	 * an edit of the node's art, or a view that cropped or blurred the still, cuts a new one once it
	 * has settled, the old one showing meanwhile. Runs on every preview change — a sample, a scrub, a
	 * state change, an edit.
	 */
	function syncPosedFx(): void {
		clearTimeout(posedSettle);
		const live = !posedDisposed && !!wrap && wrap.clientWidth > 0 && previewTimelineActive();
		const ids = live ? [...new Set([...previewElementFxNodeIds(), ...Object.keys(posedFx)])] : [];
		for (const id of Object.keys(posedFx)) if (!ids.includes(id)) dropPosed(id);
		const hidden: string[] = [];
		const now = performance.now();
		let settleIn = Infinity;
		let cut: PosedCut | null = null;
		for (const id of ids) {
			const found = posedNode(id);
			const entries = found ? keyableElementFxEntries(found.node) : [];
			if (!found || !entries.length || hiddenSceneIds.has(found.s.id)) {
				dropPosed(id);
				continue;
			}
			const { s, node } = found;
			const signature = posedSignature(node);
			const past = posedPastRest(entries, (entryId) => previewElementFxPose(id, entryId));
			const posed = posedFx[id];
			const free = !cut && posedCutting === null;
			if (!posed) {
				if (past && free) cut = { s, id, signature, entries };
				continue;
			}
			const entriesKey = JSON.stringify(entries);
			if (posed.entriesKey !== entriesKey) {
				posed.entriesKey = entriesKey;
				posed.overlay?.setEntries(entries);
			}
			if (posedOutdated(posed, signature)) {
				const key = JSON.stringify([signature, panX, panY, zoom]);
				if (posed.pending?.key !== key) posed.pending = { key, since: now };
				const left = posed.pending.since + FX_RECUT_MS - now;
				if (left > 0) settleIn = Math.min(settleIn, left);
				else if (past && free) cut = { s, id, signature, entries };
			} else {
				posed.pending = null;
			}
			const chain = posed.overlay ? fxChain(s, id) : null;
			if (!chain) continue;
			posed.placement = matMul(fxStageMatrix(s, chain), posed.from);
			// A node being cut draws, for its still.
			if (past && posedCutting !== id && cut?.id !== id) hidden.push(...posed.hide);
		}
		setFxPreviewHidden(new Set(hidden), FX_POSED_OWNER);
		if (cut) void cutPosedStill(cut);
		else if (settleIn < Infinity) posedSettle = setTimeout(syncPosedFx, settleIn + 1);
	}

	/** Cut a posed node's still (isolated, as ▶ does, under a frozen stage) and put its overlay up,
	 *  in place of the one it had. A still that cannot be cut leaves a record without an overlay, so
	 *  it is not tried again every sample. */
	async function cutPosedStill({ s, id, signature, entries }: PosedCut): Promise<void> {
		const target = { kind: 'node', id } as const;
		const isolate = fxStillPlan(s, target)?.isolate;
		let uncover = (): void => {};
		posedCutting = id;
		if (isolate && wrap) {
			uncover = coverStage(wrap, FX_COVER_Z);
			setFxPreviewHidden(isolate, FX_CAPTURE_OWNER);
			await afterFrames(FX_REDRAW_FRAMES);
		}
		const chain = fxChain(s, id);
		const plan = isolate ? fxStillPlan(s, target) : null;
		const still = plan && fxCaptureStill(s, plan);
		const cutAt = chain && invertAffine(fxStageMatrix(s, chain));
		posedCutting = null;
		setFxPreviewHidden(new Set(), FX_CAPTURE_OWNER);
		void afterFrames(FX_REDRAW_FRAMES).then(uncover);
		if (posedDisposed || !previewTimelineActive()) return;
		const record: PosedFx = {
			signature,
			entriesKey: JSON.stringify(entries),
			view: { panX, panY, zoom },
			clipped: plan?.clipped ?? false,
			pending: null,
			from: IDENTITY_AFFINE,
			placement: IDENTITY_AFFINE,
			hide: new Set(),
			overlay: null,
		};
		if (plan && still && cutAt) {
			record.placement = [1, 0, 0, 1, plan.rect.x, plan.rect.y];
			record.from = matMul(cutAt, record.placement);
			record.hide = plan.hide;
			record.overlay = poseOnStill({
				...plan,
				zIndex: plan.hud ? FX_HUD_OVERLAY_Z : undefined,
				still,
				entries,
				pose: (entryId) => previewElementFxPose(id, entryId),
				placement: () => record.placement,
			});
		}
		dropPosed(id);
		posedFx[id] = record;
		syncPosedFx();
	}

	$effect(() => {
		void previewVersion();
		void panX;
		void panY;
		void zoom;
		void layoutType;
		void hiddenSceneIds;
		// An edit of a posed node (its art or its Element FX) re-syncs its still.
		for (const id of previewElementFxNodeIds()) void JSON.stringify(posedNode(id)?.node);
		untrack(syncPosedFx);
	});

	onMount(() => {
		const withdraw = addElementFxPreviewHandler(previewElementFx);
		return () => {
			withdraw();
			fxPreviewStop?.();
			posedDisposed = true;
			clearTimeout(posedSettle);
			for (const id of Object.keys(posedFx)) dropPosed(id);
			setFxPreviewHidden(new Set(), FX_POSED_OWNER);
		};
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
		void animate;
		// Re-draw the param-aware text preview when a default changes (§13.4, B3).
		void componentParams;
		schedule();
	});
</script>

<div
	bind:this={wrap}
	class="wrap {cursorClass}"
	class:rulers={showRulers}
	class:animate
	class:dragover={dragOver}
	ondragover={onDragOver}
	ondragleave={onDragLeave}
	ondrop={onDrop}
	oncontextmenu={(e) => e.preventDefault()}
	role="region"
	aria-label="Editor canvas"
>
	{#if instanceMenu}
		{@const menuNode = instanceMenu.node}
		<div
			bind:this={instanceMenuEl}
			class="instance-menu"
			style="left:{instanceMenu.x}px; top:{instanceMenu.y}px"
			role="menu"
		>
			<div class="menu-title">{menuNode.label?.trim() || menuNode.componentId}</div>
			{#if onShowInFlow}
				<button
					type="button"
					role="menuitem"
					disabled={!menuNode.label?.trim()}
					title={menuNode.label?.trim()
						? 'Open Invisible Flow on the node that names this placement'
						: 'Name the instance first — Flow lists named placements only'}
					onclick={() => {
						closeInstanceMenu();
						onShowInFlow?.(menuNode);
					}}
				>
					↗ Show in Flow
				</button>
			{/if}
			{#if onEditInstance}
				<button
					type="button"
					role="menuitem"
					onclick={() => {
						closeInstanceMenu();
						onEditInstance?.(menuNode);
					}}
				>
					◇ Edit component in place
				</button>
			{/if}
		</div>
	{/if}
	<!-- Base canvas: frame backdrop + the interaction surface. The per-scene composite
	     groups above are `pointer-events:none`, so input (select/drag/zoom/pan) always
	     reaches here; hit-testing is world-space math, independent of what's drawn. -->
	<canvas bind:this={canvas} onwheel={onWheel} onmousedown={onMouseDown} ondblclick={onDoubleClick}
	></canvas>

	<!-- One z-ordered group per non-hidden GAME scene, in doc order. Each group stacks
	     (bottom→top) its own 2D canvas, then its rig sublayer, then its text sublayer.
	     `z-index = scene index` makes a LATER scene's whole group sit above an EARLIER
	     scene's whole group — so a Background rig renders below the base-game 2D. The
	     rig/text sublayers are filtered to the one scene + mounted only when present. They
	     draw through two shared WebGL contexts (`sharedGl.client.ts`), never one each: past
	     the browser's ~16 live contexts the oldest is dropped and paints white. -->
	{#each visibleGameScenes() as s (s.id)}
		{@const segs = depthSegments(s, componentMap, componentNest)}
		{@const scrimKey = scrimSegmentKey(segs)}
		<div class="scene-group" data-scene-id={s.id}>
			<!-- One stack per DEPTH SEGMENT (usually exactly one — see `depthSegments`): a
			     segment that starts after an FX draws above that FX, as later art does in the
			     game. Every surface below reports under the segment's key. -->
			{#each segs as seg (seg.key)}
				<!-- One canvas per BLEND RUN (usually exactly one): consecutive top-level nodes that
				     share a blend mode, with the mode on the element so the browser composites the run
				     against everything painted beneath it — earlier scene groups included. See
				     `blendRuns`. -->
				{#each blendRuns(seg) as run (run.key)}
					<canvas
						class="scene-2d"
						style:mix-blend-mode={run.css}
						use:registerSceneCanvasAction={run}
					></canvas>
				{/each}
				{#if sceneHasRig(seg)}
					<EditorRigLayer
						{componentNest}
						{scenes}
						{mainSizesMap}
						{layoutType}
						{frameWidth}
						{frameHeight}
						standardBox={standardFrameBox}
						{panX}
						{panY}
						{zoom}
						{assets}
						{componentMap}
						{componentDefaults}
						{componentParams}
						{rigPreview}
						{rigPreviewNodeId}
						{symbolStatics}
						{gridDimensions}
						worldTransformOf={drawTransform}
						reloadToken={rigReload}
						{hiddenSceneIds}
						sceneFilter={sceneFilterFor(s.id)}
						nodeFilter={normalOverlayFilter(seg)}
						depthSlice={depthSliceFor(seg)}
						activeSceneId={scrimKey === seg.key ? scene.id : null}
						playing={playingRigs}
						{boneRiders}
						onReadyKeysChange={(keys) => {
							mergeRigReady(seg.key, keys);
							schedule();
						}}
						onNaturalSizesChange={(sizes) => {
							mergeRigNatural(seg.key, sizes);
							schedule();
						}}
						onRigMetaChange={(meta) => {
							mergeRigMeta(seg.key, meta);
							schedule();
						}}
						onLoadingChange={(c) => {
							mergeRigLoading(seg.key, c);
						}}
					/>
				{/if}
				{#if sceneHasText(seg)}
					<EditorTextLayer
						{componentNest}
						{scenes}
						{layoutType}
						{panX}
						{panY}
						{zoom}
						worldTransformOf={drawTransform}
						{hiddenSceneIds}
						sceneFilter={sceneFilterFor(s.id)}
						nodeFilter={textOverlayFilter(seg)}
						depthSlice={depthSliceFor(seg)}
						{projectGameName}
						{componentParams}
						{componentDefaults}
						{componentMap}
						{repeaterSources}
						{frameWidth}
						{frameHeight}
						reloadToken={fontReload}
						{redrawNonce}
						onLoadingChange={(c) => {
							mergeFontLoading(seg.key, c);
						}}
						onReadyIdsChange={(ids) => {
							mergeTextReady(seg.key, ids);
							schedule();
						}}
						onMeasuredChange={(sizes) => {
							mergeTextMeasured(seg.key, sizes);
							schedule();
						}}
					/>
				{/if}
				{#if sceneHasEffect(seg)}
					<EditorEffectLayer
						{componentNest}
						{scenes}
						{layoutType}
						{frameWidth}
						{frameHeight}
						{panX}
						{panY}
						{zoom}
						{componentMap}
						{componentParams}
						{componentDefaults}
						worldTransformOf={drawTransform}
						{hiddenSceneIds}
						sceneFilter={sceneFilterFor(s.id)}
						nodeFilter={normalOverlayFilter(seg)}
						depthSlice={depthSliceFor(seg)}
						playing={playingEffects}
						effectParamValues={effectPreviewValues}
						onReadyKeysChange={(ids) => {
							mergeEffectReady(seg.key, ids);
							schedule();
						}}
						onBoundsChange={(bounds) => {
							mergeEffectBounds(seg.key, bounds);
							schedule();
						}}
					/>
				{/if}
				<!-- BLENDED effects: one extra FX overlay per blend mode the scene uses, carrying the
				     mode as CSS `mix-blend-mode` on its own element. Renders nothing when the scene
				     blends nothing (`blendOverlayGroups` is empty), so the common scene mounts exactly
				     the surfaces it always has. Reports go under the group's synthetic key, which
				     `forgetScene` purges with the scene.

				     No blended RIG layer: a Pixi blend cannot reach skeleton geometry (see
				     `canBlendKind`), so `nodeBlendMode` resolves every rig to `normal` and such a
				     layer could only ever be empty — while still costing a canvas and a draw every
				     frame. -->
				{#each blendOverlayGroups(seg) as g (g.key)}
					{#if sceneHasEffect(seg)}
						<EditorEffectLayer
							{componentNest}
							{scenes}
							{layoutType}
							{frameWidth}
							{frameHeight}
							{panX}
							{panY}
							{zoom}
							{componentMap}
							{componentParams}
							{componentDefaults}
							worldTransformOf={drawTransform}
							{hiddenSceneIds}
							sceneFilter={sceneFilterFor(s.id)}
							nodeFilter={g.ids}
							depthSlice={depthSliceFor(seg)}
							blend={g.css}
							playing={playingEffects}
							effectParamValues={effectPreviewValues}
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
			{/each}
		</div>
	{/each}

	<!-- Bone-ridden stand-in symbol overlay (Scene Editor preview): sits ABOVE the scene groups
	     (their rig layers included) so a reveal's symbol rides ON TOP of its rig, and BELOW the
	     HUD layers. Driven by `drawRiders`' own rAF reading the shared `boneRiders` map. -->
	<canvas bind:this={riderCanvas} class="rider-layer"></canvas>

	<canvas bind:this={hudCanvas} class="hud-layer"></canvas>
	<!-- Rulers (P10.9): world pixels along the top and left edges. Drag off one to add a guide;
	     drop a guide back on one to remove it. -->
	<canvas
		bind:this={rulerTop}
		class="ruler ruler-top"
		class:off={!showRulers}
		onwheel={onWheel}
		onmousedown={(e) => startRulerGuide('y', e)}
	></canvas>
	<canvas
		bind:this={rulerLeft}
		class="ruler ruler-left"
		class:off={!showRulers}
		onwheel={onWheel}
		onmousedown={(e) => startRulerGuide('x', e)}
	></canvas>
	<div class="ruler-corner" class:off={!showRulers}></div>
	<!-- HUD rig overlay: like the HUD text overlay below, the HUD scenes draw on the
	     top-most `hudCanvas` and are excluded from the per-game-scene `{#each}` above — so a
	     rig nested in a placed HUD component (a spin button's `R_SpinButton`) would only
	     ever show its 2D placeholder. This live rig layer (filtered to the HUD scenes) sits
	     just above the HUD's 2D canvas, so the editor reflects the in-game button. -->
	{#if hudRigScenes().length > 0}
		<div class="hud-rig-layer">
			<EditorRigLayer
				{componentNest}
				{scenes}
				{mainSizesMap}
				{layoutType}
				{frameWidth}
				{frameHeight}
				standardBox={standardFrameBox}
				{panX}
				{panY}
				{zoom}
				{assets}
				{componentMap}
				{componentDefaults}
				{componentParams}
				{rigPreview}
				{rigPreviewNodeId}
				worldTransformOf={drawTransform}
				reloadToken={rigReload}
				{hiddenSceneIds}
				sceneFilter={hudRigSceneFilter()}
				activeSceneId={null}
				playing={playingRigs}
				onReadyKeysChange={(keys) => {
					mergeRigReady(HUD_RIG_KEY, keys);
					schedule();
				}}
				onNaturalSizesChange={(sizes) => {
					mergeRigNatural(HUD_RIG_KEY, sizes);
					schedule();
				}}
				onRigMetaChange={(meta) => {
					mergeRigMeta(HUD_RIG_KEY, meta);
					schedule();
				}}
				onLoadingChange={(c) => {
					mergeRigLoading(HUD_RIG_KEY, c);
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
				{componentNest}
				{scenes}
				{layoutType}
				{panX}
				{panY}
				{zoom}
				worldTransformOf={drawTransform}
				{hiddenSceneIds}
				sceneFilter={hudTextSceneFilter()}
				{projectGameName}
				{componentParams}
				{componentDefaults}
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
				{componentNest}
				{scenes}
				{layoutType}
				{frameWidth}
				{frameHeight}
				{panX}
				{panY}
				{zoom}
				{componentMap}
				{componentParams}
				{componentDefaults}
				worldTransformOf={drawTransform}
				{hiddenSceneIds}
				sceneFilter={hudEffectSceneFilter()}
				playing={playingEffects}
				effectParamValues={effectPreviewValues}
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
	{#if overlayInfo && !animate}
		<EditorItemOverlay
			info={overlayInfo}
			onDelete={(n) => onDelete?.(n.id)}
			onToggleLock={toggleLock}
			onAnchor={setAnchorPreset}
			onScale={nudgeScale}
			onForward={bringForward}
			onBack={sendBack}
			rigPlaying={playingRigs.has(overlayInfo.node.id)}
			onToggleRigPlay={toggleRigPlay}
		/>
	{/if}
	{#if cheatSheetOpen}
		<div class="cheat-sheet" role="dialog" aria-label="Keyboard shortcuts">
			<div class="cheat-head">
				<span>Keyboard shortcuts</span>
				<button type="button" aria-label="Close" onclick={() => (cheatSheetOpen = false)}>
					×
				</button>
			</div>
			<div class="cheat-groups">
				{#each SHORTCUT_SHEET as group (group.group)}
					<section>
						<h5>{group.group}</h5>
						<dl>
							{#each group.rows as row (row.does)}
								<dt>
									{#each row.keys as key, i (i)}{#if i > 0}<span class="plus">+</span>{/if}<kbd
											>{key}</kbd
										>{/each}
								</dt>
								<dd>{row.does}</dd>
							{/each}
						</dl>
					</section>
				{/each}
			</div>
			<p class="cheat-foot">Keys never fire while you type in a field.</p>
		</div>
	{/if}
	<div class="hint">
		{#if animateKeys}
			Animate: drag / corners / top circle = key the move, scale or turn at the playhead · scroll =
			zoom · shift/middle/right-drag = pan · Esc = deselect
		{:else if animate}
			Animate: click = select the node to key · scroll = zoom · shift/middle/right-drag = pan · Esc
			= parent / deselect · Shift+/ = shortcuts
		{:else}
			click = select{pickAcross ? ' (any screen)' : ''} · drag = move · corners = scale (Shift = non-uniform)
			· top circle = rotate (Shift = 15°) · scroll = zoom · shift/middle/right-drag = pan · Esc = parent
			/ deselect · Shift+/ = shortcuts
		{/if}
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
			<div class="hist-grp" role="group" aria-label="Zoom">
				<button
					class="fit hist"
					type="button"
					title="Zoom out (-)"
					aria-label="Zoom out"
					onclick={() => zoomAround(zoom / ZOOM_STEP)}
				>
					−
				</button>
				<button
					class="fit zoom-pct"
					type="button"
					title="Zoom to 100% (Ctrl/⌘+0)"
					onclick={zoomTo100}
				>
					{Math.round(zoom * 100)}%
				</button>
				<button
					class="fit hist"
					type="button"
					title="Zoom in (+)"
					aria-label="Zoom in"
					onclick={() => zoomAround(zoom * ZOOM_STEP)}
				>
					+
				</button>
				<button class="fit" type="button" title="Fit the frame (F)" onclick={fitView}> Fit </button>
			</div>
			<button
				class="fit"
				type="button"
				class:on={cheatSheetOpen}
				aria-pressed={cheatSheetOpen}
				title="Keyboard shortcuts (Shift+/)"
				aria-label="Keyboard shortcuts"
				onclick={() => (cheatSheetOpen = !cheatSheetOpen)}
			>
				?
			</button>
			<button
				class="fit"
				onclick={refreshAssets}
				type="button"
				title="Reload atlas + rig art from R2 (after you update a PNG) — no full page reload needed"
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
			<button
				class="fit"
				class:on={showRulers}
				onclick={() => {
					showRulers = !showRulers;
					writeFlag(RULERS_KEY, showRulers);
				}}
				type="button"
				aria-pressed={showRulers}
				title={showRulers
					? 'Hide the rulers and guides'
					: 'Show rulers on the canvas edges; drag from a ruler to add a guide'}
			>
				📏 Rulers
			</button>
			{#if showRulers}
				<button
					class="fit"
					class:on={snapToGuides}
					onclick={() => {
						snapToGuides = !snapToGuides;
						writeFlag(SNAP_GUIDES_KEY, snapToGuides);
					}}
					type="button"
					aria-pressed={snapToGuides}
					title={snapToGuides
						? 'Moved objects snap to the guides. Click to stop snapping to guides.'
						: 'Moved objects ignore the guides. Click to snap to them.'}
				>
					⌗ Snap to guides
				</button>
			{/if}
			{#if onPickInScene}
				<button
					class="fit"
					class:on={pickAnyScreen}
					onclick={() => {
						pickAnyScreen = !pickAnyScreen;
						setHoverPick(null);
					}}
					type="button"
					aria-pressed={pickAnyScreen}
					title={pickAnyScreen
						? 'Any screen: a click selects the topmost item drawn under the pointer, on whichever screen it belongs to, and switches to that screen. Shift-click stays on this screen. Click to select on the edited screen only.'
						: 'Clicks select on the edited screen only. Click to select anything drawn on the canvas: an item on another screen switches to that screen.'}
				>
					⌖ Any screen
				</button>
			{/if}
			{#if gameView !== undefined}
				<button
					class="fit"
					class:on={gameView}
					onclick={() => (gameView = !gameView)}
					type="button"
					aria-pressed={gameView}
					title={gameView
						? 'In-game view: only the screens the idle game shows, plus the one you are editing. Click to draw every screen.'
						: 'Drawing every screen at once. Click for In-game view: the idle game plus the screen you are editing.'}
				>
					🎮 In-game view
				</button>
				{#if gameView && viewModes.length > 0}
					<select
						class="fit"
						class:on={viewMode !== undefined}
						value={viewMode ?? ''}
						onchange={(e) => (viewMode = e.currentTarget.value || undefined)}
						aria-label="Game mode shown"
						title="The game mode In-game view shows: the base game, or a mode with every screen it keeps on screen (its board, counter, total), whichever screen you edit. Its intro, outro and popups still draw only while you edit them."
					>
						<option value="">Base game</option>
						{#each viewModes as mode (mode.id)}
							<option value={mode.id}>{mode.label}</option>
						{/each}
					</select>
				{/if}
			{/if}
		</div>
	</div>
</div>

<style>
	.instance-menu {
		position: fixed;
		z-index: 40;
		min-width: 200px;
		padding: 4px;
		background: #14181f;
		border: 1px solid #2a323d;
		border-radius: 6px;
		box-shadow: 0 8px 24px #00000088;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.instance-menu .menu-title {
		padding: 4px 8px;
		font-size: 11px;
		color: #94a3b8;
		border-bottom: 1px solid #2a323d;
	}
	.instance-menu button {
		text-align: left;
		padding: 6px 8px;
		font: inherit;
		font-size: 12px;
		color: #e2e8f0;
		background: transparent;
		border: 0;
		border-radius: 4px;
		cursor: pointer;
	}
	.instance-menu button:hover:not(:disabled) {
		background: #1f2937;
	}
	.instance-menu button:disabled {
		color: #64748b;
		cursor: default;
	}
	.wrap {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		background: #0b0b10;
		/* THE blending boundary. A node's `mix-blend-mode` composites against every layer beneath
		   it inside this box — the base frame canvas and earlier scene groups included, which is
		   what makes an additive glow in one screen lift the BACKGROUND screen's art the way the
		   game does. `isolate` stops it reaching the launcher chrome outside; `overflow:hidden`
		   already clipped everything here, so nothing that used to escape this box now can't. */
		isolation: isolate;
	}
	.wrap.animate {
		background: #0a1424;
		box-shadow: inset 0 0 0 2px #1d3a5c;
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
	.cursor-pick {
		cursor: pointer;
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
	.ruler,
	.ruler-corner {
		position: absolute;
		z-index: 1500;
	}
	.ruler.off,
	.ruler-corner.off {
		display: none;
	}
	.ruler-corner {
		top: 0;
		left: 0;
		width: 18px;
		height: 18px;
		z-index: 1501;
		background: #15151c;
		border-right: 1px solid #3a3a48;
		border-bottom: 1px solid #3a3a48;
	}
	.ruler-top {
		top: 0;
		left: 0;
		width: 100%;
		height: 18px;
		cursor: ns-resize;
	}
	.ruler-left {
		top: 0;
		left: 0;
		width: 18px;
		height: 100%;
		cursor: ew-resize;
	}
	.wrap.rulers .canvas-top {
		top: 26px;
		left: 26px;
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
	.hud-rig-layer {
		/* The HUD's rig overlay — sits just ABOVE the HUD's 2D canvas (z-index 1000) so a
		   placed HUD component's live rig (a spin button) draws over its 2D base sprite,
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
		/* Bottom of each group: this scene's 2D node art. The group's rig + text
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
	.canvas-actions button,
	.canvas-actions select {
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
	.zoom-pct {
		min-width: 52px;
		font-variant-numeric: tabular-nums;
	}
	.cheat-sheet {
		position: absolute;
		top: 48px;
		right: 12px;
		z-index: 2100;
		max-width: min(720px, calc(100% - 24px));
		max-height: calc(100% - 72px);
		overflow: auto;
		background: #121218;
		border: 1px solid #2a2a36;
		border-radius: 8px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
		padding: 10px 14px 12px;
		color: #c8c8d0;
		font-size: 12px;
	}
	.cheat-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-weight: 600;
		color: #e8e8ee;
		margin-bottom: 8px;
	}
	.cheat-head button {
		background: none;
		border: none;
		color: #888;
		font-size: 16px;
		cursor: pointer;
	}
	.cheat-groups {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 12px 20px;
	}
	.cheat-sheet h5 {
		margin: 0 0 6px;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #888;
	}
	.cheat-sheet dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 4px 10px;
		margin: 0;
	}
	.cheat-sheet dt {
		white-space: nowrap;
	}
	.cheat-sheet dd {
		margin: 0;
		color: #aaa;
	}
	.cheat-sheet kbd {
		display: inline-block;
		padding: 1px 5px;
		border: 1px solid #333344;
		border-bottom-width: 2px;
		border-radius: 4px;
		background: #1a1a22;
		color: #e8e8ee;
		font-family: inherit;
		font-size: 11px;
	}
	.cheat-sheet .plus {
		color: #666;
		margin: 0 2px;
	}
	.cheat-foot {
		margin: 10px 0 0;
		color: #666;
		font-size: 11px;
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
