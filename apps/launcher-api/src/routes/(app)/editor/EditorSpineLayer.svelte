<script lang="ts">
	import { resolveTransform, type LayoutNode, type LayoutType, type Scene } from 'engine-layout';
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

	interface Props {
		scene: Scene;
		layoutType: LayoutType;
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
		layoutType,
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
			inst.skeleton.setToSetupPose();
			inst.skeleton.updateWorldTransform(getSpinePhysics());
			const offset = { x: 0, y: 0 };
			const size = { x: 0, y: 0 };
			inst.skeleton.getBounds(offset, size, []);
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
	 * `bind` anchor carrying a `preview.art` spine stand-in (the animated Background
	 * or a centred overlay). When `fit` is set the art is sized to the frame
	 * (`'cover'` fills/crops, `'contain'` fits inside, both centred); otherwise it
	 * renders at the node's resolved transform. `nodeId` is the doc node (for the
	 * `playing` set); `assetKey` keys the shared instance cache.
	 */
	interface SpineRenderTarget {
		nodeId: string;
		assetKey: string;
		defaultAnimation?: string;
		loop?: boolean;
		fit?: 'cover' | 'contain';
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
					fit: undefined,
					transform: t,
				});
			} else {
				const art = n.preview?.art;
				if (art?.kind === 'spine') {
					out.push({
						nodeId: n.id,
						assetKey: art.assetKey,
						defaultAnimation: undefined,
						loop: true,
						fit: art.fit,
						transform: t,
					});
				}
			}
		}
		return out;
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
		// y-down camera (up = -Y) so editor-world (origin top-left, y grows down)
		// maps straight onto the canvas alongside the 2D layer.
		cam.up.x = 0;
		cam.up.y = -1;
		cam.up.z = 0;
		const camZoom = 1 / (zoom * dpr);
		cam.zoom = camZoom;
		cam.position.x = (canvas.width / 2 - panX * dpr) * camZoom;
		cam.position.y = (canvas.height / 2 - panY * dpr) * camZoom;
		cam.position.z = 0;
		cam.update();
		gl.viewport(0, 0, canvas.width, canvas.height);

		for (const target of targets) {
			const entry = entries.get(target.assetKey);
			if (!entry || entry.state !== 'ready') continue;
			syncPlayback(target, entry);
			const t = target.transform;
			const inst = entry.instance;
			if (target.fit) {
				placeFit(inst, target.fit);
			} else {
				const sx = t.scale?.x ?? 1;
				const sy = t.scale?.y ?? 1;
				inst.skeleton.x = t.x;
				inst.skeleton.y = t.y;
				inst.skeleton.scaleX = sx;
				// Flip Y: the runtime art is y-up; the camera is y-down.
				inst.skeleton.scaleY = -sy;
			}
			if (entry.playingAnim) inst.animationState.update(delta);
			inst.animationState.apply(inst.skeleton);
			inst.skeleton.updateWorldTransform(getSpinePhysics());
			renderer.begin();
			renderer.drawSkeleton(inst.skeleton, inst.premultipliedAlpha);
			renderer.end();
		}
	}

	/**
	 * Fit a spine instance to the scene frame — the editor stand-in for a coded
	 * component the editor can't run. Mirrors the 2D canvas's `fitArtTransform`,
	 * centred on the frame:
	 * - `'cover'` (the full-bleed animated Background): `s = max(...)` — both frame
	 *   dims are covered (may crop).
	 * - `'contain'` (centred overlays): `s = min(...)` — the art fits inside (no crop).
	 * Uses the skeleton's setup-pose bounds for the art's size + centre, accounting
	 * for the y-flip (`scaleY = -s`) so a local point (lx, ly) lands at
	 * `(skeleton.x + s*lx, skeleton.y - s*ly)`.
	 */
	function placeFit(inst: SpineInstance, fit: 'cover' | 'contain'): void {
		const nat = naturalSizeOf(inst);
		const offset = { x: 0, y: 0 };
		const size = { x: 0, y: 0 };
		try {
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
			inst.skeleton.x = frameWidth / 2;
			inst.skeleton.y = frameHeight / 2;
			inst.skeleton.scaleX = 1;
			inst.skeleton.scaleY = -1;
			return;
		}
		const s =
			fit === 'cover'
				? Math.max(frameWidth / bw, frameHeight / bh)
				: Math.min(frameWidth / bw, frameHeight / bh);
		const cx = offset.x + size.x / 2;
		const cy = offset.y + size.y / 2;
		inst.skeleton.x = frameWidth / 2 - s * cx;
		inst.skeleton.y = frameHeight / 2 + s * cy;
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
