<script lang="ts">
	import {
		backgroundCoverScale,
		backgroundCoverStretch,
		backgroundFit,
		computeOverlayPlacement,
		coverTransform,
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
		/** All doc scenes — `spineTargets()` is driven by these (filtered by
		 * `sceneFilter`/`hiddenSceneIds`); also locates the `boardFrame` node for
		 * board-relative (positioned) spine previews (Win = board centre). */
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
		/** Reports each ready spine's animation + skin name lists per `assetKey`, so the
		 * Properties panel can offer dropdowns instead of free-text. */
		onSpineMetaChange?: (meta: Map<string, { animations: string[]; skins: string[] }>) => void;
		/** Monotonic spine-bundle load tally, so the 2D canvas can fold spine loads
		 * into its global progress overlay. `started`/`settled` only ever grow. */
		onLoadingChange?: (counts: { started: number; settled: number }) => void;
		/** Bumped by the editor's "Reload art" — drops every cached spine bundle so
		 * the RAF loop re-fetches fresh skeletons + page textures from R2. */
		reloadToken?: number;
		/** Editor-only: scene ids hidden from the composite. The active scene always
		 * renders; other non-hidden scenes' spines render too (the "see all" view). */
		hiddenSceneIds?: Set<string>;
		/** Editor-only: when set, render ONLY these scene ids. Used by the per-scene
		 * composite (EditorCanvas stacks one layer group per scene, z-ordered by screen
		 * order) so a scene's spine sits above/below ANOTHER scene's 2D art per the doc
		 * order — not always on top. Unset = render every non-hidden scene (legacy). */
		sceneFilter?: Set<string> | null;
	}

	let {
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
		onSpineMetaChange,
		onLoadingChange,
		reloadToken = 0,
		hiddenSceneIds = new Set<string>(),
		sceneFilter = null,
	}: Props = $props();

	// Monotonic counters: one bundle load = one started + (eventually) one settled.
	let loadStarted = 0;
	let loadSettled = 0;
	function reportLoading(): void {
		onLoadingChange?.({ started: loadStarted, settled: loadSettled });
	}

	let readyKeys = new Set<string>();
	// Cache the last-published meta key-set so we only re-emit when the ready bundle
	// set changes (the animation/skin lists are fixed per `assetKey`), matching the
	// idempotent style of `readyKeys` above so the parent's `$state` doesn't loop.
	let metaKeys = new Set<string>();
	function publishReady(): void {
		const next = new Set<string>();
		const sizes = new Map<string, { w: number; h: number }>();
		const meta = new Map<string, { animations: string[]; skins: string[] }>();
		for (const [key, entry] of entries) {
			if (entry.state !== 'ready') continue;
			next.add(key);
			const nat = naturalSizeOf(entry.instance);
			if (nat) sizes.set(key, nat);
			meta.set(key, {
				animations: entry.instance.data.animations.map((a) => a.name),
				skins: entry.instance.data.skins.map((s) => s.name),
			});
		}
		if (next.size !== readyKeys.size || [...next].some((k) => !readyKeys.has(k))) {
			readyKeys = next;
			onReadyKeysChange?.(next);
		}
		if (meta.size !== metaKeys.size || [...meta.keys()].some((k) => !metaKeys.has(k))) {
			metaKeys = new Set(meta.keys());
			onSpineMetaChange?.(meta);
		}
		onNaturalSizesChange?.(sizes);
	}

	/** Natural size of an instance (for cover-fit ratio + the 2D canvas's hit-test box).
	 * Prefers the authored setup-bounds rect from the skeleton DATA — it's pose-
	 * independent and always present in the export. `skeleton.getBounds()` at the setup
	 * pose returns 0 when the art's attachments are driven by an animation/skin (no
	 * attachments in the raw setup pose), which would strand cover-fit at scale 1 = the
	 * raw, oversized art. Falls back to a live setup-pose measure for skeletons whose
	 * data omits a size, then `null` if even that is degenerate. */
	function naturalSizeOf(inst: SpineInstance): { w: number; h: number } | null {
		const data = inst.skeleton.data;
		if (data && data.width > 0 && data.height > 0) return { w: data.width, h: data.height };
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
		| {
				state: 'ready';
				instance: SpineInstance;
				playingAnim: string | null;
				/** Skin currently applied to the shared skeleton (the instance is cached per
				 * `assetKey`, so two targets with different skins re-apply per draw). Empty
				 * string means the skeleton's default skin is active. */
				appliedSkin: string;
		  };
	/** Per-spine-node cache keyed by `assetKey` (one bundle = one shared instance). */
	const entries = new Map<string, Entry>();

	// "Reload art": when the token bumps, drop every cached bundle (freeing GPU)
	// so the always-on RAF loop (`frame`) re-ensures them — re-fetching the
	// skeleton + page textures from R2 with the new `?v=`.
	let lastReloadToken = 0;
	$effect(() => {
		const t = reloadToken;
		if (t === lastReloadToken) return;
		lastReloadToken = t;
		for (const entry of entries.values()) {
			if (entry.state === 'ready') disposeSpineInstance(entry.instance);
		}
		entries.clear();
		publishReady();
	});

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
			const instance = await loadSpineInstance(assetKey, gl, reloadToken);
			if (!instance) {
				entries.set(assetKey, { state: 'error' });
				return;
			}
			if (!renderer && canvas && gl) renderer = createSceneRenderer(canvas, gl);
			entries.set(assetKey, { state: 'ready', instance, playingAnim: null, appliedSkin: '' });
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
		/** Authored skin name (real spine nodes only); empty/undefined = default skin. */
		skin?: string;
		loop?: boolean;
		placement?: OverlayPlacement;
		transform: ReturnType<typeof resolveTransform>;
		/** The owning scene's coordinate space — drives the non-placement mapping into
		 * the fixed window (game → main→window scale; background → full-bleed cover). */
		space?: Scene['space'];
		/** For `background` space: the node's doc-driven cover multiplier
		 * (`backgroundCoverScale`, default 1), per-axis stretch (`backgroundCoverStretch`,
		 * default `{1,1}`) + cover fit (`backgroundFit`, default `'cover'`) — the SAME
		 * canonical readers the game runtime + 2D canvas use. */
		coverScale?: number;
		stretch?: { x: number; y: number };
		fit?: 'cover' | 'contain';
	}

	/** Visible spine render targets in this scene: real spine nodes + `preview.art`
	 * spine bind anchors (containers are otherwise 2D-only for the preview). */
	function spineTargets(): SpineRenderTarget[] {
		const out: SpineRenderTarget[] = [];
		// Composite every non-hidden screen (the active scene always renders) so the
		// "see all screens" view shows real spine art across screens, matching the 2D
		// canvas. Placement/transform are space-independent here (catalog placement),
		// so backdrop scenes render correctly without per-scene space handling.
		for (const sc of scenes) {
			if (hiddenSceneIds.has(sc.id)) continue;
			if (sceneFilter && !sceneFilter.has(sc.id)) continue;
			for (const n of sc.nodes) {
				const t = resolveTransform(n, layoutType);
				if (!t.visible) continue;
				if (n.kind === 'spine') {
					out.push({
						nodeId: n.id,
						assetKey: n.assetKey,
						defaultAnimation: n.defaultAnimation,
						skin: n.skin,
						loop: n.loop,
						placement: undefined,
						transform: t,
						space: sc.space,
						coverScale: backgroundCoverScale(n),
						stretch: backgroundCoverStretch(n),
						fit: backgroundFit(n),
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
							// A `cover`-placement anchor (the full-bleed Background bind) reads its
							// doc-driven cover scale + stretch + fit from `preview.art.fit` /
							// `coverScale` / `scale` — the SAME canonical readers the game runtime +
							// 2D canvas use.
							coverScale: backgroundCoverScale(n),
							stretch: backgroundCoverStretch(n),
							fit: backgroundFit(n),
						});
					}
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

	/** Apply a target's chosen skin to the shared skeleton, idempotent per draw. The
	 * instance is cached per `assetKey` and shared across targets, so two nodes that use
	 * the same bundle with different skins each set theirs right before their own draw.
	 * Empty/undefined skin restores the skeleton's default skin. Unknown names are
	 * swallowed so a stale doc value can't blank the preview. */
	function applySkin(target: SpineRenderTarget, entry: Entry): void {
		if (entry.state !== 'ready') return;
		const data = entry.instance.data;
		const want = target.skin ?? '';
		if (entry.appliedSkin === want) return;
		const skeleton = entry.instance.skeleton;
		try {
			if (want) {
				skeleton.setSkinByName(want);
			} else {
				const def = data.skins.find((s) => s.name === 'default') ?? data.skins[0];
				if (def) skeleton.setSkinByName(def.name);
			}
			skeleton.setSlotsToSetupPose();
			entry.appliedSkin = want;
		} catch {
			/* unknown skin name — leave the current skin in place */
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
				placeArt(
					inst,
					target.placement,
					off,
					target.coverScale ?? 1,
					target.stretch ?? { x: 1, y: 1 },
					target.fit ?? 'cover',
				);
			} else if (target.space === 'background') {
				// Full-bleed cover of the fixed window (§10.2) — same true-cover helper the
				// game runtime + 2D canvas use. Art is centred on the skeleton origin.
				const nat = naturalSizeOf(inst);
				const bgStretch = target.stretch ?? { x: 1, y: 1 };
				const cover = coverTransform({
					artWidth: nat?.w ?? frameWidth,
					artHeight: nat?.h ?? frameHeight,
					targetWidth: frameWidth,
					targetHeight: frameHeight,
					coverScale: target.coverScale ?? 1,
					stretchX: bgStretch.x,
					stretchY: bgStretch.y,
					fit: target.fit ?? 'cover',
				});
				inst.skeleton.x = cover.x;
				inst.skeleton.y = cover.y;
				inst.skeleton.scaleX = cover.scaleX;
				inst.skeleton.scaleY = -cover.scaleY;
			} else if (target.space === 'standard' || target.space === 'canvas') {
				// standard == window (identity fit); canvas authors raw window coords.
				const sx = t.scale?.x ?? 1;
				const sy = t.scale?.y ?? 1;
				inst.skeleton.x = t.x;
				inst.skeleton.y = t.y;
				inst.skeleton.scaleX = sx;
				inst.skeleton.scaleY = -sy;
			} else {
				// game space: map the main-box origin into the window the way <MainContainer>
				// does (centre + mainScale), matching the 2D canvas's `nodeTransform`.
				const s = mainScale();
				const world = mainToWorld({ x: t.x, y: t.y });
				const sx = (t.scale?.x ?? 1) * s;
				const sy = (t.scale?.y ?? 1) * s;
				inst.skeleton.x = world.x;
				inst.skeleton.y = world.y;
				inst.skeleton.scaleX = sx;
				// Flip Y: the runtime art is y-up; the camera is y-down.
				inst.skeleton.scaleY = -sy;
			}
			// Bake the editor pan/zoom into the skeleton so it maps EXACTLY like the 2D
			// canvas. The vendored OrthoCamera is set up with up=(0,-1,0) to cancel
			// WebGL's bottom-left y-origin (so Y maps straight) — but that same up vector
			// makes lookAt's x-axis (-1,0,0), i.e. it MIRRORS X about the viewport centre.
			// So we compensate on X only: target backing px = (world*zoom + pan)*dpr, and
			// since the camera renders `screen.x = vpW - skeleton.x*dpr` (vpW = clientW*dpr),
			// place the origin at `clientW - (world*zoom + pan)` and negate scaleX so the
			// content isn't left-right flipped. Y is already correct, so it passes through.
			const clientW = canvas.clientWidth;
			inst.skeleton.x = clientW - (inst.skeleton.x * zoom + panX);
			inst.skeleton.y = inst.skeleton.y * zoom + panY;
			inst.skeleton.scaleX = -inst.skeleton.scaleX * zoom;
			inst.skeleton.scaleY = inst.skeleton.scaleY * zoom;
			// Apply this target's skin to the shared instance just before its draw, so two
			// nodes sharing one bundle with different skins each render correctly.
			applySkin(target, entry);
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
		coverScale: number,
		stretch: { x: number; y: number },
		fit: 'cover' | 'contain',
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
		// When the setup-pose getBounds is degenerate (animation/skin-driven art) but we
		// know the authored natural size, synthesize a centred bounds rect from it so
		// cover/contain/positioned size correctly instead of falling back to raw scale 1
		// (= the un-fitted, oversized art). Assumes the art is centred on the skeleton
		// origin, the norm for backgrounds/overlays.
		if ((!(size.x > 0) || !(size.y > 0)) && nat) {
			size.x = nat.w;
			size.y = nat.h;
			offset.x = -nat.w / 2;
			offset.y = -nat.h / 2;
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
		// cover/contain sized to the fixed WINDOW via the shared true-cover helper. A
		// `cover` placement (the full-bleed Background) reads the node's DOC-DRIVEN cover
		// scale + fit (§10.3 step 4) — unified with the 2D canvas + the game runtime;
		// `coverScale 1` + `fit cover` is exact full-bleed. A `contain` placement (centred
		// overlays) is always contain at scale 1.
		const isCover = result.mode === 'cover';
		const { scaleX: sx, scaleY: sy } = coverTransform({
			artWidth: bw,
			artHeight: bh,
			targetWidth: frameWidth,
			targetHeight: frameHeight,
			coverScale: isCover ? coverScale : 1,
			stretchX: isCover ? stretch.x : 1,
			stretchY: isCover ? stretch.y : 1,
			fit: isCover ? fit : 'contain',
		});
		// cover ignores the offset (caller passes 0); contain adds it in world px. The
		// bounds centre is scaled per-axis so a stretched cover stays centred.
		inst.skeleton.x = frameWidth / 2 - sx * cx + posOffset.x;
		inst.skeleton.y = frameHeight / 2 + sy * cy + posOffset.y;
		inst.skeleton.scaleX = sx;
		inst.skeleton.scaleY = -sy;
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
			// Force-free the GPU context: with one context per spine-bearing scene and
			// groups churning on every eye-toggle/screen reorder, browsers cap live WebGL
			// contexts (~8–16) and silently drop the oldest → blank previews. Only here
			// (real unmount), NOT the reload-token path (that keeps the same context).
			gl?.getExtension('WEBGL_lose_context')?.loseContext();
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
