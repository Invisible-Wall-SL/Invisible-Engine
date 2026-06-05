<script lang="ts">
	import {
		computeOverlayPlacement,
		resolveAnchorPreviewArt,
		resolveTransform,
		type LayoutType,
		type OverlayPlacement,
		type PlacementGeometry,
		type Scene,
	} from 'engine-layout';
	import { onMount } from 'svelte';
	import {
		disposeSpineInstance,
		loadSpineInstance,
		type SpineInstance,
	} from './editorSpine.client';
	import {
		createSceneRenderer,
		getSpinePhysics,
		type SpineSceneRenderer,
	} from './spineRuntime.client';

	/** Structural view of the project's spines (mirrors `ProjectAssets`) — used to
	 * resolve catalog-default spine preview art for `bind` anchors, the SAME way
	 * the 2D canvas does, so both layers agree on which spine an anchor previews. */
	interface ProjectAssets {
		spines: { name: string; key: string }[];
	}

	interface Props {
		scene: Scene;
		/** All doc scenes — used to locate the `boardFrame` node for board-relative
		 * (positioned) spine previews (Win = board centre), mirroring the 2D canvas. */
		scenes: Scene[];
		/** The game's main-layout sizes per layoutType — the space a positioned overlay
		 * preview is mapped from to canvas world coords. */
		mainSizesMap: Record<LayoutType, { width: number; height: number }>;
		layoutType: LayoutType;
		/** The project's asset listing — resolves catalog-default spine preview art. */
		assets: ProjectAssets;
		/** Active scene frame size (world coords) — used to cover-fit `preview.art`
		 * spine anchors, identical to the 2D canvas's `coverArtTransform`. */
		frameWidth: number;
		frameHeight: number;
		/** Editor view transform — kept byte-identical with the 2D canvas. */
		panX: number;
		panY: number;
		zoom: number;
		/** Node ids currently playing their animation (static otherwise). */
		playing: Set<string>;
		/** Reports which `assetKey`s now render a real skeleton, so the 2D canvas
		 * can drop their placeholder. Loading/errored keys stay placeholdered. */
		onReadyKeysChange?: (keys: Set<string>) => void;
		/** Reports each ready spine's setup-pose natural size per `assetKey`, so the
		 * 2D canvas can cover-fit `preview.art` spine anchors by the art's aspect. */
		onNaturalSizesChange?: (sizes: Map<string, { w: number; h: number }>) => void;
		/** Monotonic spine-bundle load tally, so the 2D canvas can fold spine loads
		 * into its global progress overlay. `started`/`settled` only ever grow. */
		onLoadingChange?: (counts: { started: number; settled: number }) => void;
	}

	let {
		scene,
		scenes,
		mainSizesMap,
		layoutType,
		assets,
		frameWidth,
		frameHeight,
		panX,
		panY,
		zoom,
		playing,
		onReadyKeysChange,
		onNaturalSizesChange,
		onLoadingChange,
	}: Props = $props();

	// Monotonic counters: one bundle load = one started + (eventually) one settled.
	let loadStarted = 0;
	let loadSettled = 0;
	function reportLoading(): void {
		onLoadingChange?.({ started: loadStarted, settled: loadSettled });
	}

	let readyKeys = new Set<string>();
	function publishReady(): void {
		const next = new Set<string>();
		const sizes = new Map<string, { w: number; h: number }>();
		for (const [key, entry] of entries) {
			if (entry.state !== 'ready') continue;
			next.add(key);
			const nat = naturalSizeOf(entry.instance);
			if (nat) sizes.set(key, nat);
		}
		if (next.size !== readyKeys.size || [...next].some((k) => !readyKeys.has(k))) {
			readyKeys = next;
			onReadyKeysChange?.(next);
		}
		onNaturalSizesChange?.(sizes);
	}

	/** Setup-pose bounds size of an instance (for cover-fit ratio + the 2D canvas's
	 * hit-test box). Measured once on the static setup pose; `null` if degenerate. */
	function naturalSizeOf(inst: SpineInstance): { w: number; h: number } | null {
		try {
			const skel = inst.skeleton;
			// Measure at unit scale: the render loop bakes the editor zoom into the
			// skeleton's scale, so getBounds would otherwise return zoom-scaled bounds.
			const sx = skel.scaleX;
			const sy = skel.scaleY;
			skel.scaleX = 1;
			skel.scaleY = 1;
			skel.setToSetupPose();
			skel.updateWorldTransform(getSpinePhysics());
			const offset = { x: 0, y: 0 };
			const size = { x: 0, y: 0 };
			skel.getBounds(offset, size, []);
			skel.scaleX = sx;
			skel.scaleY = sy;
			if (size.x > 0 && size.y > 0) return { w: size.x, h: size.y };
		} catch {
			/* runtime not ready / bounds unavailable */
		}
		return null;
	}

	let canvas: HTMLCanvasElement | null = $state(null);
	let gl: WebGLRenderingContext | null = null;
	let renderer: SpineSceneRenderer | null = null;
	let raf = 0;
	let lastTime = 0;

	type Entry =
		| { state: 'loading' }
		| { state: 'error' }
		| { state: 'ready'; instance: SpineInstance; playingAnim: string | null };
	/** Per-spine-node cache keyed by `assetKey` (one bundle = one shared instance). */
	const entries = new Map<string, Entry>();

	function ensureGl(): boolean {
		if (gl && renderer) return true;
		if (!canvas) return false;
		const ctx = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true });
		if (!ctx) return false;
		gl = ctx;
		return true;
	}

	/** Build the shared SceneRenderer lazily once a runtime is loaded (the first
	 * `loadSpineInstance` pulls in the global; only then is `SceneRenderer` known). */
	async function ensureInstance(assetKey: string): Promise<void> {
		if (entries.has(assetKey)) return;
		entries.set(assetKey, { state: 'loading' });
		loadStarted++;
		reportLoading();
		let settled = false;
		const settle = (): void => {
			if (settled) return;
			settled = true;
			loadSettled++;
			reportLoading();
		};
		if (!ensureGl() || !gl) {
			entries.set(assetKey, { state: 'error' });
			settle();
			return;
		}
		try {
			const instance = await loadSpineInstance(assetKey, gl);
			if (!instance) {
				entries.set(assetKey, { state: 'error' });
				return;
			}
			if (!renderer && canvas && gl) renderer = createSceneRenderer(canvas, gl);
			entries.set(assetKey, { state: 'ready', instance, playingAnim: null });
		} catch {
			entries.set(assetKey, { state: 'error' });
		} finally {
			settle();
			publishReady();
		}
	}

	/**
	 * One spine the overlay must render — either a real `kind:'spine'` node or a
	 * `bind` anchor carrying a spine stand-in (animated Background, Win, intros). When
	 * `placement` is set the art is placed by its catalog placement (cover/contain size
	 * to the frame, centred; board-relative ones land at a MAIN-coord spot mapped like
	 * `<MainContainer>`); otherwise it renders at the node's resolved transform.
	 * `nodeId` is the doc node (for the `playing` set); `assetKey` keys the cache.
	 */
	interface SpineRenderTarget {
		nodeId: string;
		assetKey: string;
		defaultAnimation?: string;
		loop?: boolean;
		placement?: OverlayPlacement;
		transform: ReturnType<typeof resolveTransform>;
	}

	/** Visible spine render targets in this scene: real spine nodes + `preview.art`
	 * spine bind anchors (containers are otherwise 2D-only for the preview). */
	function spineTargets(): SpineRenderTarget[] {
		const out: SpineRenderTarget[] = [];
		for (const n of scene.nodes) {
			const t = resolveTransform(n, layoutType);
			if (!t.visible) continue;
			if (n.kind === 'spine') {
				out.push({
					nodeId: n.id,
					assetKey: n.assetKey,
					defaultAnimation: n.defaultAnimation,
					loop: n.loop,
					placement: undefined,
					transform: t,
				});
			} else {
				// Resolve the anchor's stand-in art the SAME way the 2D canvas does
				// (explicit override → shared catalog default), so both layers agree.
				const art = resolveAnchorPreviewArt(n, assets);
				if (art?.kind === 'spine' && art.assetKey) {
					out.push({
						nodeId: n.id,
						assetKey: art.assetKey,
						defaultAnimation: undefined,
						loop: true,
						placement: art.placement,
						transform: t,
					});
				}
			}
		}
		return out;
	}

	/** Uniform MAIN→canvas-world scale (same as the 2D canvas's `mainScale`). */
	function mainScale(): number {
		const main = mainSizesMap[layoutType];
		return Math.min(frameWidth / (main.width || 1), frameHeight / (main.height || 1));
	}
	/** Map a MAIN-coord point to canvas world coords, like `<MainContainer>`. */
	function mainToWorld(p: { x: number; y: number }): { x: number; y: number } {
		const main = mainSizesMap[layoutType];
		const s = mainScale();
		return {
			x: frameWidth / 2 + s * (p.x - main.width / 2),
			y: frameHeight / 2 + s * (p.y - main.height / 2),
		};
	}
	/** The board rect in MAIN coords from the doc's `boardFrame` node (scan all
	 * scenes — it lives in basegame, not the overlay scene). Mirrors the 2D canvas. */
	function boardRect(): PlacementGeometry['board'] {
		for (const s of scenes) {
			for (const n of s.nodes) {
				if (n.slotId !== 'boardFrame') continue;
				const bt = resolveTransform(n, layoutType);
				if (bt.width === undefined || bt.height === undefined) continue;
				return { x: bt.x, y: bt.y, width: bt.width, height: bt.height };
			}
		}
		return undefined;
	}

	function resizeCanvas(): void {
		if (!canvas) return;
		const dpr = window.devicePixelRatio || 1;
		const w = Math.floor(canvas.clientWidth * dpr);
		const h = Math.floor(canvas.clientHeight * dpr);
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w;
			canvas.height = h;
		}
	}

	/** Drive each ready instance's play/pause state from the `playing` set. */
	function syncPlayback(target: SpineRenderTarget, entry: Entry): void {
		if (entry.state !== 'ready') return;
		const wantPlay = playing.has(target.nodeId);
		const wantAnim = target.defaultAnimation || entry.instance.firstAnimation;
		if (wantPlay && wantAnim) {
			if (entry.playingAnim !== wantAnim) {
				entry.instance.animationState.setAnimation(0, wantAnim, target.loop ?? true);
				entry.playingAnim = wantAnim;
			}
		} else if (entry.playingAnim !== null) {
			// Return to the static setup pose.
			entry.instance.skeleton.setToSetupPose();
			entry.instance.animationState.setEmptyAnimation(0, 0);
			entry.playingAnim = null;
		}
	}

	function frame(now: number): void {
		raf = requestAnimationFrame(frame);
		if (!canvas) return;
		resizeCanvas();
		const delta = lastTime ? (now - lastTime) / 1000 : 0;
		lastTime = now;

		const targets = spineTargets();
		// Kick off loads for any newly-referenced bundles.
		for (const tg of targets) if (!entries.has(tg.assetKey)) void ensureInstance(tg.assetKey);

		if (!gl) {
			// No nodes have triggered GL yet — nothing to clear.
			return;
		}
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		if (!renderer) return;

		const dpr = window.devicePixelRatio || 1;
		const cam = renderer.camera;
		cam.viewportWidth = canvas.width;
		cam.viewportHeight = canvas.height;
		// STATIC screen-space camera: editor-world units map 1:1 to CSS px (×dpr in the
		// backing store), y-down. The editor PAN/ZOOM is NOT in the camera — it's baked
		// into each skeleton's transform below. This is the same camera config that was
		// correct at zoom=1 (app zoom + pan factored out), so the spine overlay uses the
		// IDENTICAL `world*zoom + pan` mapping as the 2D canvas at EVERY zoom level.
		// (Driving zoom through the camera drifted the spine off the 2D box when zooming.)
		cam.up.x = 0;
		cam.up.y = -1;
		cam.up.z = 0;
		const camZoom = 1 / dpr;
		cam.zoom = camZoom;
		cam.position.x = (canvas.width / 2) * camZoom;
		cam.position.y = (canvas.height / 2) * camZoom;
		cam.position.z = 0;
		cam.update();
		gl.viewport(0, 0, canvas.width, canvas.height);

		for (const target of targets) {
			const entry = entries.get(target.assetKey);
			if (!entry || entry.state !== 'ready') continue;
			syncPlayback(target, entry);
			const t = target.transform;
			const inst = entry.instance;
			if (target.placement) {
				// The node's raw x/y is a POSITIONAL OFFSET (scene-canvas px at the
				// reference frame == world px) applied on top of the placement, matching
				// the game's verbatim use of x/y for these canvas anchors. Offset 0 →
				// identical to the Level-1 placement-only spot. cover stays pinned.
				const off = target.placement === 'cover' ? { x: 0, y: 0 } : { x: t.x, y: t.y };
				placeArt(inst, target.placement, off);
			} else {
				const sx = t.scale?.x ?? 1;
				const sy = t.scale?.y ?? 1;
				inst.skeleton.x = t.x;
				inst.skeleton.y = t.y;
				inst.skeleton.scaleX = sx;
				// Flip Y: the runtime art is y-up; the camera is y-down.
				inst.skeleton.scaleY = -sy;
			}
			// Bake the editor pan/zoom into the skeleton so it maps EXACTLY like the 2D
			// canvas: backing px = (world*zoom + pan)*dpr (the static camera supplies the
			// *dpr). placeArt / the plain path set world-space x/y/scale above; this is the
			// single world→screen step that keeps the spine pixel-locked to its 2D box.
			inst.skeleton.x = inst.skeleton.x * zoom + panX;
			inst.skeleton.y = inst.skeleton.y * zoom + panY;
			inst.skeleton.scaleX *= zoom;
			inst.skeleton.scaleY *= zoom;
			if (entry.playingAnim) inst.animationState.update(delta);
			inst.animationState.apply(inst.skeleton);
			inst.skeleton.updateWorldTransform(getSpinePhysics());
			renderer.begin();
			renderer.drawSkeleton(inst.skeleton, inst.premultipliedAlpha);
			renderer.end();
		}
	}

	/**
	 * Place a spine instance by its catalog `placement` — the editor stand-in for a
	 * coded component the editor can't run. Mirrors the 2D canvas's `placedArtTransform`.
	 * - `cover` (full-bleed Background): `s = max(...)` — both frame dims covered (crops).
	 * - `contain` (centred overlays): `s = min(...)` — the art fits inside (no crop).
	 * - `positioned` (board-relative — Win = board centre): natural size at the
	 *   MAIN-coord spot mapped to canvas world via `mainToWorld`, scaled by the
	 *   MAIN→canvas scale, placed by the result's anchor over the art's bounds.
	 * All paths use the skeleton's setup-pose bounds for size+centre, accounting for the
	 * y-flip (`scaleY = -s`): a local point (lx, ly) lands at `(x + s*lx, y - s*ly)`.
	 */
	function placeArt(
		inst: SpineInstance,
		placement: OverlayPlacement,
		posOffset: { x: number; y: number },
	): void {
		const nat = naturalSizeOf(inst);
		const offset = { x: 0, y: 0 };
		const size = { x: 0, y: 0 };
		try {
			// Measure at unit scale (scale is re-set at the end of this fn + the loop
			// bakes zoom into it), so offset/size are the art's true natural bounds.
			inst.skeleton.scaleX = 1;
			inst.skeleton.scaleY = 1;
			inst.skeleton.setToSetupPose();
			inst.skeleton.updateWorldTransform(getSpinePhysics());
			inst.skeleton.getBounds(offset, size, []);
		} catch {
			/* bounds unavailable — fall through to safe defaults below */
		}
		const bw = nat?.w ?? size.x;
		const bh = nat?.h ?? size.y;
		if (!(bw > 0) || !(bh > 0)) {
			// Degenerate bounds: centre at 1:1 so something still shows.
			inst.skeleton.x = frameWidth / 2 + posOffset.x;
			inst.skeleton.y = frameHeight / 2 + posOffset.y;
			inst.skeleton.scaleX = 1;
			inst.skeleton.scaleY = -1;
			return;
		}
		const result = computeOverlayPlacement(placement, {
			main: mainSizesMap[layoutType],
			board: boardRect(),
			art: { width: bw, height: bh },
		});
		// Setup-pose bounds centre (y-up runtime coords).
		const cx = offset.x + size.x / 2;
		const cy = offset.y + size.y / 2;
		if (result.mode === 'positioned') {
			// Draw at natural size (s = MAIN→canvas scale), positioned so the result's
			// anchor over the art's bounds sits at the mapped MAIN-coord spot.
			const s = mainScale();
			const world = mainToWorld({ x: result.x, y: result.y });
			// The art's bounds span [offset, offset+size] in runtime (y-up) space. The
			// anchor point within those bounds, expressed in runtime coords:
			const anchorLocalX = offset.x + size.x * result.anchor.x;
			// anchor.y is top-down (0=top); runtime y is up, so top = offset.y + size.y.
			const anchorLocalY = offset.y + size.y * (1 - result.anchor.y);
			// world = skeleton + s*(anchorLocal) with the y-flip → solve skeleton.
			// The node's stored offset adds in world px on top of the placement.
			inst.skeleton.x = world.x - s * anchorLocalX + posOffset.x;
			inst.skeleton.y = world.y + s * anchorLocalY + posOffset.y;
			inst.skeleton.scaleX = s;
			inst.skeleton.scaleY = -s;
			return;
		}
		const s =
			result.mode === 'cover'
				? Math.max(frameWidth / bw, frameHeight / bh)
				: Math.min(frameWidth / bw, frameHeight / bh);
		// cover ignores the offset (caller passes 0); contain adds it in world px.
		inst.skeleton.x = frameWidth / 2 - s * cx + posOffset.x;
		inst.skeleton.y = frameHeight / 2 + s * cy + posOffset.y;
		inst.skeleton.scaleX = s;
		inst.skeleton.scaleY = -s;
	}

	onMount(() => {
		raf = requestAnimationFrame(frame);
		return () => {
			if (raf) cancelAnimationFrame(raf);
			for (const entry of entries.values()) {
				if (entry.state === 'ready') disposeSpineInstance(entry.instance);
			}
			entries.clear();
			try {
				renderer?.dispose();
			} catch {
				/* context teardown */
			}
			renderer = null;
			gl = null;
		};
	});

	// Drop cached instances whose node was removed from the scene (free GPU memory).
	$effect(() => {
		const live = new Set(spineTargets().map((tg) => tg.assetKey));
		let removed = false;
		for (const [key, entry] of entries) {
			if (!live.has(key)) {
				if (entry.state === 'ready') disposeSpineInstance(entry.instance);
				entries.delete(key);
				removed = true;
			}
		}
		if (removed) publishReady();
	});
</script>

<canvas bind:this={canvas} class="spine-layer"></canvas>

<style>
	.spine-layer {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
		/* Input always reaches the 2D canvas underneath (selection/handles/drag). */
		pointer-events: none;
	}
</style>
