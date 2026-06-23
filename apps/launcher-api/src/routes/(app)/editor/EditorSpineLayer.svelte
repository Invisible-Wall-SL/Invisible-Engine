<script lang="ts">
	import {
		backgroundCoverScale,
		backgroundCoverStretch,
		backgroundFit,
		boundComponentOverlayDim,
		computeOverlayPlacement,
		coverTransform,
		resolveAnchorPreviewArt,
		resolveTransform,
		MAX_COMPONENT_DEPTH,
		type ComponentDef,
		type LayoutNode,
		type LayoutType,
		type OverlayPlacement,
		type PlacementGeometry,
		type ResolvedTransform,
		type Scene,
	} from 'engine-layout';
	import { childLocalTransform, composeWorldMatrix } from './editorCanvas.helpers';
	import { onMount } from 'svelte';
	import {
		disposeSpineInstance,
		loadSpineInstance,
		type SpineInstance,
	} from './editorSpine.client';
	import {
		createSceneRenderer,
		getSpinePhysics,
		type SpineMeta,
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
		/** Reports each ready spine's animation + skin + slot name lists per `assetKey`, so
		 * the Properties panel can offer dropdowns instead of free-text. */
		onSpineMetaChange?: (meta: Map<string, SpineMeta>) => void;
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
		/** Editor-only: the id of the ACTIVE (selected) scene. A full-screen-dim overlay
		 * (free-spin intro/outro — `overlayDim` in the catalog) draws its scrim ONLY when
		 * THIS layer is filtered to the active scene, so the "see all screens" composite
		 * never stacks several dims into a black-out. Unset = no scrim. */
		activeSceneId?: string | null;
		/** Loaded project component defs, so the overlay can EXPAND a `componentInstance`'s
		 * tree and render spines nested inside it — the same `componentMap` the 2D canvas +
		 * text overlay use. Without it, only directly-placed spines render. */
		componentMap?: Map<string, ComponentDef>;
		/** Frames a TOP-LEVEL node into canvas-world coords (the 2D canvas's `nodeTransform`),
		 * so a nested spine's world transform composes from its ancestor chain identically to
		 * the 2D canvas + text overlay + game runtime. */
		worldTransformOf: (node: LayoutNode, scene: Scene) => ResolvedTransform;
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
		activeSceneId = null,
		componentMap = new Map<string, ComponentDef>(),
		worldTransformOf,
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
		const meta = new Map<string, SpineMeta>();
		for (const [key, entry] of entries) {
			if (entry.state !== 'ready') continue;
			next.add(key);
			const nat = naturalSizeOf(entry.instance);
			if (nat) sizes.set(key, nat);
			meta.set(key, {
				animations: entry.instance.data.animations.map((a) => a.name),
				skins: entry.instance.data.skins.map((s) => s.name),
				slots: entry.instance.data.slots.map((s) => s.name),
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
			// `getBounds` writes its result by CALLING `.set()` on these — a plain `{x,y}`
			// makes it THROW (silently caught → null), which collapsed the transform box to
			// the default for every rig WITHOUT a skeleton width/height (i.e. every Rigger
			// `.irig`). Pass objects that implement `set()` so the real bounds come back.
			const offset = {
				x: 0,
				y: 0,
				set(x: number, y: number) {
					this.x = x;
					this.y = y;
				},
			};
			const size = {
				x: 0,
				y: 0,
				set(x: number, y: number) {
					this.x = x;
					this.y = y;
				},
			};
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
		/** The spine's `enter`-cue animation: in-game it plays the moment the component /
		 * screen appears, so the preview AUTO-plays it (looped for visibility) instead of
		 * showing the static setup pose. Without this, an author sizes the spine against the
		 * resting pose, which differs from what the game shows once the intro animation runs. */
		enterAnimation?: string;
		enterLoop?: boolean;
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
		/** A spine nested inside a container / component instance: its WORLD transform
		 * (canvas coords, pre pan/zoom) already composed from the ancestor chain via
		 * {@link composeWorldMatrix}, so the renderer places it directly and skips the
		 * top-level space/placement mapping (the chain's top link already applied it). */
		world?: { x: number; y: number; scaleX: number; scaleY: number };
	}

	/** The `enter`-cue animation authored on a spine node (the engine plays it when the
	 * component / screen appears). Drives the preview's auto-play so sizing is WYSIWYG. */
	function spineEnterCue(
		n: Extract<LayoutNode, { kind: 'spine' }>,
	): { animation: string; loop?: boolean } | undefined {
		return n.cues?.find((c) => c.signal === 'enter');
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
						enterAnimation: spineEnterCue(n)?.animation,
						enterLoop: spineEnterCue(n)?.loop,
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
				// Spines nested inside a container or a component instance: the 2D canvas
				// expands these (drawComponentInstance), so the spine overlay must too — else
				// a placed component's spine only ever shows its 2D placeholder box. Each
				// nested spine's world transform is composed from its ancestor chain.
				if (n.kind === 'container') {
					collectNestedSpines(n.children, sc, out, [n], 0, []);
				} else if (n.kind === 'componentInstance') {
					const def = componentMap.get(n.componentId);
					if (def) collectNestedSpines(def.root.children, sc, out, [n], 1, [def.id]);
				}
			}
		}
		return out;
	}

	/**
	 * Recursively collect spine targets NESTED inside containers / component instances —
	 * mirroring the 2D canvas's `drawComponentInstance` + the text overlay's
	 * `collectTextTargets`. `chain` is the ancestor path (root-first); each nested spine's
	 * world transform is composed from it via {@link composeWorldMatrix} so it lands
	 * exactly where the 2D placeholder + game runtime put it.
	 */
	function collectNestedSpines(
		nodes: LayoutNode[],
		sc: Scene,
		out: SpineRenderTarget[],
		chain: LayoutNode[],
		depth: number,
		stack: string[],
	): void {
		for (const n of nodes) {
			if (!resolveTransform(n, layoutType).visible) continue;
			const nextChain = [...chain, n];
			if (n.kind === 'spine') {
				out.push(nestedSpineTarget(n, sc, nextChain));
			} else if (n.kind === 'container') {
				collectNestedSpines(n.children, sc, out, nextChain, depth, stack);
			} else if (n.kind === 'componentInstance') {
				const def = componentMap.get(n.componentId);
				if (!def || depth >= MAX_COMPONENT_DEPTH || stack.includes(def.id)) continue;
				collectNestedSpines(def.root.children, sc, out, nextChain, depth + 1, [...stack, def.id]);
			}
		}
	}

	/** Build a render target for a nested spine: its world transform composed from the
	 * ancestor `chain` (top link framed via `worldTransformOf`, descendants pure-local via
	 * `childLocalTransform` — the SAME rule the 2D canvas + game runtime use), decomposed
	 * to x/y + scale. The spine preview ignores rotation (as the top-level path does), but
	 * a single-axis flip in the chain (negative scale) is preserved via the determinant. */
	function nestedSpineTarget(
		node: Extract<LayoutNode, { kind: 'spine' }>,
		sc: Scene,
		chain: LayoutNode[],
	): SpineRenderTarget {
		const [a, b, c, d, tx, ty] = composeWorldMatrix(
			chain,
			(top) => worldTransformOf(top, sc),
			(child) => childLocalTransform(child, layoutType, sc.space, frameWidth, frameHeight),
		);
		const sx = Math.hypot(a, b) || 1;
		const sy = Math.hypot(c, d) || 1;
		const det = a * d - b * c;
		return {
			nodeId: node.id,
			assetKey: node.assetKey,
			defaultAnimation: node.defaultAnimation,
			skin: node.skin,
			loop: node.loop,
			enterAnimation: spineEnterCue(node)?.animation,
			enterLoop: spineEnterCue(node)?.loop,
			transform: resolveTransform(node, layoutType),
			space: sc.space,
			world: { x: tx, y: ty, scaleX: sx, scaleY: det < 0 ? -sy : sy },
		};
	}

	/**
	 * EDITOR-PREVIEW ONLY scrim alpha for THIS layer. A full-screen-dim overlay (the
	 * free-spin intro/outro gates — `overlayDim` in the catalog) darkens the whole
	 * window behind its centred frame in-game; the editor mirrors that by clearing this
	 * spine canvas to translucent black BEFORE drawing the scene's own spines. Because
	 * this WebGL canvas sits (by scene-order z-index) ABOVE every earlier scene's 2D +
	 * spine group, the translucent clear dims the base-game board AND any spine-drawn
	 * background beneath it via CSS compositing — while the intro/outro frame spine, drawn
	 * into this same canvas afterwards, stays at full brightness on top. Scoped to the
	 * ACTIVE scene only (and gated on the anchor being visible) so the "see all screens"
	 * composite never blacks out from several dims stacking. The largest declared dim
	 * among the active scene's visible dim anchors wins. */
	function scrimAlpha(): number {
		if (!activeSceneId) return 0;
		if (sceneFilter && !sceneFilter.has(activeSceneId)) return 0;
		const sc = scenes.find((s) => s.id === activeSceneId);
		if (!sc || hiddenSceneIds.has(sc.id)) return 0;
		let dim = 0;
		for (const n of sc.nodes) {
			const d = boundComponentOverlayDim(n);
			if (d === undefined || !(d > 0)) continue;
			if (!resolveTransform(n, layoutType).visible) continue;
			if (d > dim) dim = d;
		}
		return Math.min(dim, 1);
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

	/** Spine size debug: log each spine ONCE per id (avoids per-frame flooding). Cleared
	 * when `window.__IW_SPINE_DEBUG__` is toggled off so a re-enable re-logs. */
	const spineDebugLogged = new Set<string>();

	/** Drive each ready instance's play/pause state from the `playing` set. */
	function syncPlayback(target: SpineRenderTarget, entry: Entry): void {
		if (entry.state !== 'ready') return;
		// A spine with an `enter` cue plays that animation in-game the instant its
		// component / screen appears. AUTO-play it in the preview (looped for visibility),
		// taking precedence over the node's default animation, so the author sizes against
		// the SAME pose the game shows — not the static setup pose, which is smaller /
		// different once the intro animation runs. A spine WITHOUT an enter cue is unchanged:
		// static until the user toggles play, then its default / first animation.
		const enterAnim = target.enterAnimation;
		// One-shot → idle hand-off (mirrors the runtime `LayoutNodeView`): an enter cue with
		// a DISTINCT default animation plays the intro ONCE then queues the looping default
		// (idle), so the preview shows intro → idle exactly like the game.
		const handsOffToIdle = !!(
			enterAnim &&
			target.defaultAnimation &&
			target.defaultAnimation !== enterAnim
		);
		const wantPlay = playing.has(target.nodeId) || !!enterAnim;
		const wantAnim = enterAnim || target.defaultAnimation || entry.instance.firstAnimation;
		const wantLoop = handsOffToIdle
			? false
			: enterAnim
				? (target.enterLoop ?? true)
				: (target.loop ?? true);
		if (wantPlay && wantAnim) {
			if (entry.playingAnim !== wantAnim) {
				entry.instance.animationState.setAnimation(0, wantAnim, wantLoop);
				if (handsOffToIdle && target.defaultAnimation) {
					entry.instance.animationState.addAnimation(0, target.defaultAnimation, target.loop ?? true, 0);
				}
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
		// A full-screen-dim overlay (free-spin intro/outro) clears this canvas to
		// translucent black instead of fully transparent: that scrim composites over every
		// earlier scene group beneath this layer (board + spine background), while the
		// overlay's own frame spine draws on top afterwards at full brightness. 0 ⇒ the
		// normal transparent clear (nothing dimmed).
		const scrim = scrimAlpha();
		gl.clearColor(0, 0, 0, scrim);
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
			if (target.world) {
				// A spine nested in a container / component instance: its world transform was
				// already composed from the ancestor chain (the top link applied the scene-space
				// framing), so place it directly. Y is flipped like every other branch (runtime
				// art is y-up; the camera is y-down).
				inst.skeleton.x = target.world.x;
				inst.skeleton.y = target.world.y;
				inst.skeleton.scaleX = target.world.scaleX;
				inst.skeleton.scaleY = -target.world.scaleY;
			} else if (target.placement) {
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
			// Spine size debug (mirror of SpineProvider's [IW-SPINE]). At this point
			// `skeleton.scaleX` is the WORLD scale (nodeScale × mainScale for game space),
			// so `worldScale / mainScale` recovers the node scale and `natural × nodeScale`
			// is the MAIN-box-unit size — directly comparable to the game's mainBoxUnit.
			{
				const dbg =
					typeof window !== 'undefined' &&
					(window as unknown as { __IW_SPINE_DEBUG__?: boolean }).__IW_SPINE_DEBUG__;
				if (!dbg) spineDebugLogged.clear();
				else if (!spineDebugLogged.has(target.nodeId)) {
					spineDebugLogged.add(target.nodeId);
					const ms = mainScale() || 1;
					const wsx = Math.abs(inst.skeleton.scaleX); // world scale (nodeScale × mainScale)
					// Measure the CURRENT (animated) pose bounds. data.width/getBounds-at-setup
					// are 0 for this spine (art is animation-driven), so measure the live pose:
					// skeleton.scaleX here is the world scale, so getBounds returns the rendered
					// size in FRAME px (before pan/zoom). fractionOfFrame = that / the editor frame.
					const offset = { x: 0, y: 0, set(x: number, y: number) {
						this.x = x; this.y = y;
					} };
					const size = { x: 0, y: 0, set(x: number, y: number) {
						this.x = x; this.y = y;
					} };
					try {
						inst.skeleton.updateWorldTransform(getSpinePhysics());
						inst.skeleton.getBounds(offset, size, []);
					} catch {
						/* degenerate pose */
					}
					console.log(
						'[IW-SPINE editor]',
						target.assetKey,
						'renderedFramePx=',
						Math.round(size.x),
						Math.round(size.y),
						'frame=',
						frameWidth,
						frameHeight,
						'fractionOfFrame=',
						Number((size.x / (frameWidth || 1)).toFixed(3)),
						'worldScale=',
						Number(wsx.toFixed(4)),
						'mainScale=',
						Number(ms.toFixed(4)),
					);
				}
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
		// `getBounds` writes via `.set()`, so these MUST implement it (a plain `{x,y}`
		// throws → the cover/contain/positioned math falls back to a degenerate box).
		const offset = {
			x: 0,
			y: 0,
			set(x: number, y: number) {
				this.x = x;
				this.y = y;
			},
		};
		const size = {
			x: 0,
			y: 0,
			set(x: number, y: number) {
				this.x = x;
				this.y = y;
			},
		};
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
		// Centre of the art's sizing rect, in y-up runtime coords. This MUST match the
		// rect the size (`bw`/`bh`) was measured from, or the art lands off from the 2D
		// selection box: that box centres the authored natural-size rect on the origin.
		// `naturalSizeOf` prefers the authored `skeleton.data` canvas (origin-centred by
		// Spine convention) — so when `nat` drove the size, centre on the ORIGIN too,
		// NOT the live `getBounds` centre (an asymmetric setup pose, e.g. a number-frame
		// spine, would otherwise drag the art to a corner while the box stays centred).
		// Only when `nat` is absent (size came from raw `getBounds`) is the bounds centre
		// the right one. Symmetric art is unaffected (its bounds centre ≈ origin).
		const cx = nat ? 0 : offset.x + size.x / 2;
		const cy = nat ? 0 : offset.y + size.y / 2;
		if (result.mode === 'positioned') {
			// Draw at natural size (s = MAIN→canvas scale), positioned so the result's
			// anchor over the art's bounds sits at the mapped MAIN-coord spot.
			const s = mainScale();
			const world = mainToWorld({ x: result.x, y: result.y });
			// The sizing rect spans [originX, originX+bw] × [originY, originY+bh] in
			// runtime (y-up) space. It MUST be the SAME rect `bw`/`bh` came from, to match
			// the 2D box: when `nat` drove the size that rect is the authored canvas
			// (origin-centred → originX/Y = -bw/2, -bh/2); only a pure-`getBounds` size
			// uses the live offset. (Mirror of the cover/contain `cx`/`cy` choice above.)
			const originX = nat ? -bw / 2 : offset.x;
			const originY = nat ? -bh / 2 : offset.y;
			// The anchor point within that rect, expressed in runtime coords:
			const anchorLocalX = originX + bw * result.anchor.x;
			// anchor.y is top-down (0=top); runtime y is up, so top = originY + bh.
			const anchorLocalY = originY + bh * (1 - result.anchor.y);
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
