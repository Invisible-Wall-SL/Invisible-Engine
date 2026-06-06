<script lang="ts">
	import {
		boundComponentDefault,
		computeOverlayPlacement,
		resolveAnchorPreviewArt,
		resolveTransform,
		STANDARD_MAIN_SIZES_MAP,
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
		nodeBox,
		nodeCornersWorld,
		topMidWorld,
		pointInQuad,
		type Vec2,
		type NodeBox,
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
	import EditorSpineLayer from './EditorSpineLayer.svelte';
	import EditorTextLayer from './EditorTextLayer.svelte';
	import { clearFontCatalogCache } from './fonts.client';

	interface AssetDragPayload {
		kind: 'atlas-page' | 'atlas-manifest' | 'sheet' | 'spine';
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
		onSpawn: (node: LayoutNode, pos: { x: number; y: number }) => void;
		/** Hoisted selection — bound from the page so the properties panel can read it. */
		selectedId?: string | null;
		/** Called once after any doc-mutating gesture (drag-spawn, translate/scale/rotate end). */
		onDirty?: () => void;
		/** Remove the node with this id from the active scene + clear selection. */
		onDelete?: (id: string) => void;
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
	}

	let {
		scene,
		scenes,
		mainSizesMap,
		frameWidth,
		frameHeight,
		layoutType,
		assets,
		onSpawn,
		selectedId = $bindable(null),
		onDirty,
		onDelete,
		fillRequest = null,
		hiddenSceneIds = new Set<string>(),
	}: Props = $props();

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
	 * world coords:
	 * - `canvas`: `screenAnchor` is folded into x/y (HUD corners pin to frame edges).
	 * - `background`: the node is cover-fit to the frame, centred, exactly like the
	 *   engine's `normalBackgroundLayout` (the node's `scale.x` is the cover scale,
	 *   default 0.5). We set explicit width+height + a centre anchor so the 2D
	 *   draw/box math matches the live game's full-bleed cover.
	 * Other scenes pass through unchanged.
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
		if (space === 'canvas' && t.screenAnchor) {
			return {
				...t,
				x: t.screenAnchor.x * frameWidth + t.x,
				y: t.screenAnchor.y * frameHeight + t.y,
			};
		}
		if (space === 'background' && (node.kind === 'sprite' || node.kind === 'spine')) {
			return backgroundTransform(node, t);
		}
		return t;
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
	 * Editor mirror of `createBackgroundLayout` (utils-layout): centre the node at
	 * the frame centre and size it to COVER the frame at the node's cover scale.
	 * The engine compares the canvas ratio against the background art ratio to pick
	 * which dimension drives the cover; here the frame plays the canvas and the
	 * node's natural art ratio plays the background ratio (it has no live layout
	 * context). With scale, exactly one of width/height drives; the other keeps the
	 * art's aspect — same as the engine. Falls back to plain cover when the art size
	 * isn't loaded yet (so it never misrenders to a tiny offset sprite).
	 */
	function backgroundTransform(node: LayoutNode, t: ResolvedTransform): ResolvedTransform {
		const coverScale = node.scale?.x ?? 0.5;
		const nat = naturalSize(node);
		const frameRatio = frameWidth / (frameHeight || 1);
		const artRatio = nat ? nat.w / (nat.h || 1) : frameRatio;
		// Engine rule: canvasRatio < ratio → height-driven; else width-driven.
		const widthDriven = frameRatio >= artRatio;
		const width = widthDriven ? frameWidth * coverScale : undefined;
		const height = widthDriven ? undefined : frameHeight * coverScale;
		// Resolve the undefined dimension from the art's aspect so box/hit-test math
		// has a concrete size (the 2D canvas can't lean on the texture's intrinsic
		// aspect the way pixi's Sprite does).
		const resolvedW = width ?? (height ?? frameHeight * coverScale) * artRatio;
		const resolvedH = height ?? (width ?? frameWidth * coverScale) / artRatio;
		return {
			...t,
			x: frameWidth / 2,
			y: frameHeight / 2,
			anchor: { x: 0.5, y: 0.5 },
			scale: { x: 1, y: 1 },
			rotation: 0,
			width: resolvedW,
			height: resolvedH,
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
		// cover / contain: centred, sized to the frame by the art's natural aspect.
		const fit = result.mode === 'cover' ? 'cover' : 'contain';
		const nat = artNaturalSize(node);
		const frameRatio = frameWidth / (frameHeight || 1);
		const artRatio = nat ? nat.w / (nat.h || 1) : frameRatio;
		let width: number;
		let height: number;
		if (fit === 'cover') {
			// Drive by the dimension that would otherwise leave a gap: width-driven
			// when the art is relatively narrower than the frame (its height overflows).
			const widthDriven = artRatio <= frameRatio;
			width = widthDriven ? frameWidth : frameHeight * artRatio;
			height = widthDriven ? frameWidth / artRatio : frameHeight;
		} else {
			// Contain: drive by the dimension that hits the frame edge first → the
			// art fits inside. width-driven when the art is relatively wider.
			const widthDriven = artRatio >= frameRatio;
			width = widthDriven ? frameWidth : frameHeight * artRatio;
			height = widthDriven ? frameWidth / artRatio : frameHeight;
		}
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
		if (scene.space === 'canvas' && sa) {
			x -= sa.x * frameWidth;
			y -= sa.y * frameHeight;
		}
		// Preview-art anchor (positioned/centred): x/y arrive as effective world coords
		// (placement base + offset). Store the OFFSET from the placement base so the game
		// applies the same raw x/y on top of the coded component's own placement. Raw
		// scene-canvas px == world px (the frame is world 1:1), so no extra scaling.
		const art = anchorArt(node);
		if (art && art.placement !== 'cover') {
			const base = placementWorldBase(node, art.placement);
			x -= base.x;
			y -= base.y;
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
	function writeScale(node: LayoutNode, sx: number, sy: number): void {
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
		return scene.space === 'background' && (node.kind === 'sprite' || node.kind === 'spine');
	}

	let canvas: HTMLCanvasElement | null = $state(null);
	let wrap: HTMLDivElement | null = $state(null);

	let panX = $state(0);
	let panY = $state(0);
	let zoom = $state(0.5);
	let panning = $state(false);
	let lastXY: [number, number] | null = null;
	let dragOver = $state(false);

	type DragMode =
		| { kind: 'translate'; nodeId: string; startWorld: Vec2; startNode: Vec2 }
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
	 * skips their placeholder box so only the live preview shows. */
	let readySpineKeys = $state<Set<string>>(new Set());
	/** Setup-pose natural size per spine `assetKey`, reported by the WebGL overlay —
	 * lets the 2D canvas cover-fit `preview.art` spine anchors by the art's aspect. */
	let spineNaturalSizes = $state<Map<string, { w: number; h: number }>>(new Map());
	/** Text node ids the PIXI text overlay renders with a real (catalog) font — the
	 * 2D canvas skips their `fillText` placeholder so there's no double-draw. */
	let readyTextIds = $state<Set<string>>(new Set());
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
	// endpoint is `no-store`, but a distinct `?v=` also defeats any HTTP/disk
	// cache, so updated R2 art re-fetches without a full page reload.
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
		clearRegionCache(); // also drop the module-level fetchRegions cache (page key + rects)
		clearFontCatalogCache(); // drop the module-level font catalog so it re-fetches
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
				regSettled++;
				console.warn('[editor] region load failed', assetKey, err);
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
		const set = ensureRegionSet(assetKey);
		if (!set) return null;
		const region = set.regions.find((r) => r.name === regionName);
		return region ? { set, region } : null;
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
		for (const key of regionContainerKeys()) {
			void fetchRegions(key)
				.then((set) => {
					if (!set.regions.length) return;
					const next = new Map(spriteRegionIndex);
					let added = false;
					for (const r of set.regions) {
						// First manifest that packs a region name wins (stable + deterministic
						// over the listing order); the resolved key is what `findRegion` loads.
						if (!next.has(r.name)) {
							next.set(r.name, set.assetKey);
							added = true;
						}
					}
					if (added) {
						spriteRegionIndex = next;
						draw();
					}
				})
				.catch(() => {
					/* a bad manifest just contributes no regions */
				});
		}
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
	function naturalSize(node: LayoutNode): { w: number; h: number } | null {
		// A `preview.art` bind anchor borrows the art's natural size (so box/hit-test
		// math frames the rendered art, not an empty container).
		const art = artNaturalSize(node);
		if (art) return art;
		if (node.kind === 'sprite' && node.region) {
			const found = findRegion(node.assetKey, node.region);
			if (found) return regionNaturalSize(found.region);
			return null;
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
		if (!canvas || !wrap) return;
		const dpr = window.devicePixelRatio || 1;
		const w = Math.floor(wrap.clientWidth * dpr);
		const h = Math.floor(wrap.clientHeight * dpr);
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w;
			canvas.height = h;
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

	function findNodeById(id: string): LayoutNode | null {
		for (const n of scene.nodes) if (n.id === id) return n;
		return null;
	}

	// ---------- draw ----------

	function draw(): void {
		if (!canvas) return;
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

		ctx.fillStyle = '#14141c';
		ctx.fillRect(0, 0, frameWidth, frameHeight);
		ctx.lineWidth = 2 / zoom;
		ctx.strokeStyle = '#3a3a4a';
		ctx.setLineDash([12 / zoom, 8 / zoom]);
		ctx.strokeRect(0, 0, frameWidth, frameHeight);
		ctx.setLineDash([]);

		// Composite all non-hidden screens (editor-only "see all screens" view), each
		// in its OWN coordinate space, in doc order so layering matches the game. The
		// eye toggle is authoritative: a hidden screen never draws, even when it's the
		// selected one. The active scene stays the only INTERACTIVE one; its selection
		// overlay is drawn last (below), on top of everything.
		for (const s of scenes) {
			if (hiddenSceneIds.has(s.id)) continue;
			for (const node of s.nodes) drawNode(ctx, node, s);
		}

		// Snap guide lines (world-space; covers all frame + visible).
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

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		drawSelectionOverlay(ctx);
	}

	function drawNode(
		ctx: CanvasRenderingContext2D,
		node: LayoutNode,
		sceneCtx: Scene = scene,
	): void {
		const t = nodeTransform(node, sceneCtx);
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
				if (!readySpineKeys.has(art.assetKey)) {
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
				drawHudChip(ctx, t, node.preview, node.label ?? node.bind.component);
			} else if (!node.preview?.style) {
				drawPlaceholder(
					ctx,
					t.anchor?.x ?? 0.5,
					t.anchor?.y ?? 0.5,
					'#2f5d57',
					node.label ?? node.bind.component,
				);
			}
		} else if (node.kind === 'sprite' && node.region) {
			drawRegionSprite(ctx, node, t);
		} else if (node.kind === 'sprite') {
			const img = ensureImage(node.assetKey);
			if (img && img.complete && img.naturalWidth > 0) {
				const w = t.width ?? img.naturalWidth;
				const h = t.height ?? img.naturalHeight;
				const ax = t.anchor?.x ?? 0;
				const ay = t.anchor?.y ?? 0;
				ctx.drawImage(img, -w * ax, -h * ay, w, h);
			} else {
				drawPlaceholder(ctx, t.anchor?.x ?? 0.5, t.anchor?.y ?? 0.5, '#3a4a5a', node.label ?? '…');
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
			// The PIXI text overlay owns nodes whose font resolved through the catalog
			// (real bitmap/web font); the 2D canvas only draws the fallback for the rest.
			if (!readyTextIds.has(node.id)) {
				ctx.fillStyle = `#${(node.style?.fill ?? 0xffffff).toString(16).padStart(6, '0')}`;
				ctx.font = `${node.style?.fontWeight ?? 'normal'} ${node.style?.fontSize ?? 24}px ${
					node.style?.fontFamily ?? 'sans-serif'
				}`;
				ctx.fillText(node.text, 0, 0);
			}
		} else if (node.kind === 'container') {
			for (const child of node.children) drawNode(ctx, child, sceneCtx);
		}

		ctx.restore();
	}

	function drawRegionSprite(
		ctx: CanvasRenderingContext2D,
		node: Extract<LayoutNode, { kind: 'sprite' }>,
		t: import('engine-layout').ResolvedTransform,
	): void {
		drawArtRegionSprite(ctx, node.assetKey, node.region ?? '', t, node.label);
	}

	/** Core atlas-region draw, shared by region sprite NODES and `preview.art` sprite
	 * anchors. `assetKey` = manifest/atlas key, `region` = packed frame; honours the
	 * resolved transform's anchor + explicit width/height (else the region's native
	 * size). Falls back to a placeholder until the page image + rect resolve. */
	function drawArtRegionSprite(
		ctx: CanvasRenderingContext2D,
		assetKey: string,
		regionName: string,
		t: import('engine-layout').ResolvedTransform,
		label?: string,
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
			// Page pixels are packed rotated; restore upright. The compose packs
			// upright→page with PIL `rotate(-90)` (the PixiJS-standard CW pack), so
			// the inverse here is a -90° (counter-clockwise, canvas y-down) rotation,
			// drawing the (h × w) page rect into a (ch × cw) local box translated to
			// (cx, cy + ch) so the content lands upright in the (cw × ch) box —
			// matching what the game (PixiJS rotate:2) shows.
			ctx.save();
			ctx.translate(cx, cy + ch);
			ctx.rotate(-Math.PI / 2);
			ctx.drawImage(img, region.x, region.y, pw, ph, 0, 0, ch, cw);
			ctx.restore();
		} else {
			ctx.drawImage(img, region.x, region.y, pw, ph, cx, cy, cw, ch);
		}
	}

	/** Faithful 2D preview of a HUD `bind` element (the real component is a shape +
	 * text, so this is close to what the game renders): buttons = dark rounded
	 * square + centered icon label; labels = ticker + label + value; logo/name =
	 * text. Drawn in the node's already-scaled space (drawNode applied scale). */
	function drawHudChip(
		ctx: CanvasRenderingContext2D,
		t: ResolvedTransform,
		preview: NonNullable<LayoutNode['preview']>,
		label: string,
	): void {
		const ax = t.anchor?.x ?? 0.5;
		const ay = t.anchor?.y ?? 0.5;
		const w = preview.w ?? 160;
		const h = preview.h ?? 100;
		const x = -w * ax;
		const y = -h * ay;
		const isText = preview.style === 'text';
		if (!isText) {
			const r = Math.min(preview.style === 'button' ? 36 : 26, h / 2);
			ctx.beginPath();
			ctx.roundRect(x, y, w, h, r);
			ctx.fillStyle = 'rgba(8,8,10,0.92)';
			ctx.fill();
			ctx.lineWidth = 2;
			ctx.strokeStyle = '#3a3a46';
			ctx.stroke();
		}
		ctx.save();
		ctx.textAlign = 'center';
		if (preview.style === 'label') {
			ctx.textBaseline = 'top';
			ctx.font = '600 30px sans-serif';
			ctx.fillStyle = '#e8e8ee';
			ctx.fillText(label, x + w / 2, y + 14);
			ctx.fillStyle = '#7ee0c0';
			ctx.fillText('0.00', x + w / 2, y + 14 + 38);
		} else if (preview.style === 'button') {
			ctx.textBaseline = 'middle';
			ctx.font = '600 28px sans-serif';
			ctx.fillStyle = '#e8e8ee';
			ctx.fillText(label, x + w / 2, y + h / 2);
		} else {
			ctx.textBaseline = 'middle';
			ctx.font = '600 30px sans-serif';
			ctx.fillStyle = '#c8a3ff';
			ctx.fillText(label, x + w / 2, y + h / 2);
		}
		ctx.restore();
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

	function drawSelectionOverlay(ctx: CanvasRenderingContext2D): void {
		if (!selectedId) return;
		const node = findNodeById(selectedId);
		if (!node) return;
		const t = nodeTransform(node);
		if (!t.visible) return;
		const box = nodeBox(node, t, naturalSize);
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
		if (!selectedId) return null;
		const node = findNodeById(selectedId);
		if (!node || node.locked || isBackgroundCover(node)) return null;
		const t = nodeTransform(node);
		if (!t.visible) return null;
		const box = nodeBox(node, t, naturalSize);
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
			if (node.locked) continue;
			const t = nodeTransform(node);
			const box = nodeBox(node, t, naturalSize);
			const corners = nodeCornersWorld(t, box);
			if (pointInQuad(world, corners)) return node;
		}
		return null;
	}

	// ---------- drag handlers ----------

	function startTranslate(node: LayoutNode, world: Vec2): void {
		const start = effectiveXY(node);
		dragMode = {
			kind: 'translate',
			nodeId: node.id,
			startWorld: world,
			startNode: start,
		};
	}
	function startScale(node: LayoutNode, cornerIdx: number, world: Vec2): void {
		const t = nodeTransform(node);
		const box = nodeBox(node, t, naturalSize);
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
		let nx = dragMode.startNode.x + dx;
		let ny = dragMode.startNode.y + dy;
		const snapped = snapTranslate(node, nx, ny);
		nx = snapped.x;
		ny = snapped.y;
		writeXY(node, nx, ny);
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
		const box = nodeBox(node, t, naturalSize);
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
			const ob = nodeBox(other, ot, naturalSize);
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
		if (e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey)) {
			panning = true;
			lastXY = [e.clientX, e.clientY];
			e.preventDefault();
			return;
		}
		if (e.button !== 0) return;

		const rect = canvas!.getBoundingClientRect();
		const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
		const world = clientToWorld(e.clientX, e.clientY);

		// 1) handle hit
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
		// 2) body hit on any node
		const node = hitTestNode(world);
		if (node) {
			selectedId = node.id;
			// Background-cover nodes select but never drag (transform is synthesised).
			if (!isBackgroundCover(node)) startTranslate(node, world);
			schedule();
			e.preventDefault();
			return;
		}
		// 3) empty space
		if (selectedId !== null) {
			selectedId = null;
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

		if (e.key === 'Escape' && selectedId !== null) {
			selectedId = null;
			schedule();
			return;
		}
		if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId !== null) {
			const node = findNodeById(selectedId);
			if (node && !node.locked) {
				e.preventDefault();
				onDelete?.(selectedId);
			}
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
		if (!payload || !payload.key || !payload.kind) return;
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
	$effect(() => {
		hiddenSceneIds;
		scenes;
		scene;
		layoutType;
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
		const box = nodeBox(node, t, naturalSize);
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
		void selectedId;
		void snapLines.length;
		void layoutType;
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
	<canvas bind:this={canvas} onwheel={onWheel} onmousedown={onMouseDown}></canvas>
	<EditorSpineLayer
		{scene}
		{scenes}
		{mainSizesMap}
		{layoutType}
		{frameWidth}
		{frameHeight}
		{panX}
		{panY}
		{zoom}
		{assets}
		reloadToken={spineReload}
		{hiddenSceneIds}
		playing={playingSpines}
		onReadyKeysChange={(keys) => {
			readySpineKeys = keys;
			schedule();
		}}
		onNaturalSizesChange={(sizes) => {
			spineNaturalSizes = sizes;
			schedule();
		}}
		onLoadingChange={(c) => {
			spineStarted = c.started;
			spineSettled = c.settled;
		}}
	/>
	<EditorTextLayer
		{scenes}
		{layoutType}
		{panX}
		{panY}
		{zoom}
		worldTransformOf={nodeTransform}
		{hiddenSceneIds}
		reloadToken={fontReload}
		onLoadingChange={(c) => {
			fontStarted = c.started;
			fontSettled = c.settled;
		}}
		onReadyIdsChange={(ids) => {
			readyTextIds = ids;
			schedule();
		}}
	/>
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
	<button
		class="fit"
		onclick={refreshAssets}
		type="button"
		title="Reload atlas + spine art from R2 (after you update a PNG) — no full page reload needed"
	>
		↻ Reload art
	</button>
	<button class="fit" onclick={fitView} type="button">Fit</button>
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
	.hint {
		position: absolute;
		left: 12px;
		bottom: 10px;
		color: #666;
		font-size: 11px;
		pointer-events: none;
		text-shadow: 0 1px 2px #000;
	}
	.fit {
		position: absolute;
		top: 10px;
		right: 10px;
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
