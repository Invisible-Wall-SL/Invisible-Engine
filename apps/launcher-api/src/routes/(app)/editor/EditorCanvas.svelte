<script lang="ts">
	import { resolveTransform, type LayoutNode, type LayoutType, type Scene } from 'engine-layout';
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
		fetchRegions,
		regionNaturalSize,
		type EditorRegion,
		type RegionDragPayload,
		type RegionSet,
	} from './editorRegions.client';
	import EditorItemOverlay from './EditorItemOverlay.svelte';
	import EditorSpineLayer from './EditorSpineLayer.svelte';

	interface AssetDragPayload {
		kind: 'atlas-page' | 'atlas-manifest' | 'sheet' | 'spine';
		key: string;
		name: string;
	}
	type DragPayload = AssetDragPayload | RegionDragPayload;

	interface Props {
		scene: Scene;
		frameWidth: number;
		frameHeight: number;
		/** Active authoring layoutType; non-`desktop` puts edits into override mode. */
		layoutType: LayoutType;
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
	}

	let {
		scene,
		frameWidth,
		frameHeight,
		layoutType,
		onSpawn,
		selectedId = $bindable(null),
		onDirty,
		onDelete,
		fillRequest = null,
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
	/** Write `x`/`y` for the active layoutType (base when desktop, sparse override otherwise). */
	function writeXY(node: LayoutNode, x: number, y: number): void {
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
		const t = resolveTransform(node, layoutType);
		return { x: t.x, y: t.y };
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
	function toggleSpinePlay(node: LayoutNode): void {
		const next = new Set(playingSpines);
		if (next.has(node.id)) next.delete(node.id);
		else next.add(node.id);
		playingSpines = next;
	}

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

	const images = new Map<string, HTMLImageElement | null>();
	function ensureImage(key: string): HTMLImageElement | null {
		if (images.has(key)) return images.get(key) ?? null;
		images.set(key, null);
		const img = new Image();
		img.onload = () => {
			images.set(key, img);
			schedule();
		};
		img.onerror = () => {
			images.set(key, null);
		};
		img.src = `/api/editor/asset?key=${encodeURIComponent(key)}`;
		return null;
	}

	// ---------- region (atlas/sheet frame) resolution ----------
	// A region sprite stores `{ assetKey, region }`. Preview data (the packed page
	// key + per-frame rects) is editor-side only — resolved here, never saved.
	// Keyed by `assetKey` so a reopened doc re-fetches automatically.
	const regionSets = new Map<string, RegionSet | null>();
	function ensureRegionSet(assetKey: string): RegionSet | null {
		if (regionSets.has(assetKey)) return regionSets.get(assetKey) ?? null;
		regionSets.set(assetKey, null);
		void fetchRegions(assetKey).then((set) => {
			regionSets.set(assetKey, set);
			if (set.pageKey) ensureImage(set.pageKey);
			schedule();
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

	/** Natural draw size for a node — region size for region sprites, page/native otherwise. */
	function naturalSize(node: LayoutNode): { w: number; h: number } | null {
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

		ctx.fillStyle = '#14141c';
		ctx.fillRect(0, 0, frameWidth, frameHeight);
		ctx.lineWidth = 2 / zoom;
		ctx.strokeStyle = '#3a3a4a';
		ctx.setLineDash([12 / zoom, 8 / zoom]);
		ctx.strokeRect(0, 0, frameWidth, frameHeight);
		ctx.setLineDash([]);

		for (const node of scene.nodes) drawNode(ctx, node);

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

	function drawNode(ctx: CanvasRenderingContext2D, node: LayoutNode): void {
		const t = resolveTransform(node, layoutType);
		if (!t.visible) return;

		ctx.save();
		ctx.translate(t.x, t.y);
		if (t.rotation) ctx.rotate(t.rotation);
		const sx = t.scale?.x ?? 1;
		const sy = t.scale?.y ?? 1;
		if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
		if (t.alpha !== undefined) ctx.globalAlpha = t.alpha;

		if (node.kind === 'sprite' && node.region) {
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
			ctx.fillStyle = `#${(node.style?.fill ?? 0xffffff).toString(16).padStart(6, '0')}`;
			ctx.font = `${node.style?.fontWeight ?? 'normal'} ${node.style?.fontSize ?? 24}px ${
				node.style?.fontFamily ?? 'sans-serif'
			}`;
			ctx.fillText(node.text, 0, 0);
		} else if (node.kind === 'container') {
			for (const child of node.children) drawNode(ctx, child);
		}

		ctx.restore();
	}

	function drawRegionSprite(
		ctx: CanvasRenderingContext2D,
		node: Extract<LayoutNode, { kind: 'sprite' }>,
		t: import('engine-layout').ResolvedTransform,
	): void {
		const found = node.region ? findRegion(node.assetKey, node.region) : null;
		const ax = t.anchor?.x ?? 0;
		const ay = t.anchor?.y ?? 0;
		if (!found || !found.set.pageKey) {
			drawPlaceholder(ctx, ax || 0.5, ay || 0.5, '#3a4a5a', node.label ?? node.region ?? '…');
			return;
		}
		const img = ensureImage(found.set.pageKey);
		const { region } = found;
		const nat = regionNaturalSize(region);
		// Destination box: respect explicit width/height, else the region's native size.
		const dw = t.width ?? nat.w;
		const dh = t.height ?? nat.h;
		if (!img || !img.complete || img.naturalWidth === 0) {
			drawPlaceholder(ctx, ax || 0.5, ay || 0.5, '#3a4a5a', node.label ?? region.name);
			return;
		}
		// Trim offset: the packed frame may be a tight crop of a larger original
		// (origW/origH). Place the trimmed crop at its offset inside the dest box,
		// scaled to match the dest/native ratio.
		const scaleX = dw / nat.w;
		const scaleY = dh / nat.h;
		const offX = (region.offX ?? 0) * scaleX;
		const offY = (region.offY ?? 0) * scaleY;
		const cropW = region.w * scaleX;
		const cropH = region.h * scaleY;
		const baseX = -dw * ax + offX;
		const baseY = -dh * ay + offY;
		// Rotation note: packed `rotated` frames (90° in the atlas) are drawn
		// upright here (best-effort) — the geometry is correct, orientation isn't.
		ctx.drawImage(img, region.x, region.y, region.w, region.h, baseX, baseY, cropW, cropH);
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
		const t = resolveTransform(node, layoutType);
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
		if (!node || node.locked) return null;
		const t = resolveTransform(node, layoutType);
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
			const t = resolveTransform(node, layoutType);
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
		const t = resolveTransform(node, layoutType);
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
		const t = resolveTransform(node, layoutType);
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
		const t = resolveTransform(node, layoutType);
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
			const ot = resolveTransform(other, layoutType);
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
			startTranslate(node, world);
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
		const t = resolveTransform(node, layoutType);
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
		return {
			node,
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
		const t = resolveTransform(node, layoutType);
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
		{layoutType}
		{panX}
		{panY}
		{zoom}
		playing={playingSpines}
		onReadyKeysChange={(keys) => {
			readySpineKeys = keys;
			schedule();
		}}
	/>
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
</style>
