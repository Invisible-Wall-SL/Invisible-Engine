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
		/** Editor view transform — kept byte-identical with the 2D canvas. */
		panX: number;
		panY: number;
		zoom: number;
		/** Node ids currently playing their animation (static otherwise). */
		playing: Set<string>;
		/** Reports which `assetKey`s now render a real skeleton, so the 2D canvas
		 * can drop their placeholder. Loading/errored keys stay placeholdered. */
		onReadyKeysChange?: (keys: Set<string>) => void;
	}

	let { scene, layoutType, panX, panY, zoom, playing, onReadyKeysChange }: Props = $props();

	let readyKeys = new Set<string>();
	function publishReady(): void {
		const next = new Set<string>();
		for (const [key, entry] of entries) if (entry.state === 'ready') next.add(key);
		if (next.size !== readyKeys.size || [...next].some((k) => !readyKeys.has(k))) {
			readyKeys = next;
			onReadyKeysChange?.(next);
		}
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
		if (!ensureGl() || !gl) {
			entries.set(assetKey, { state: 'error' });
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
			publishReady();
		}
	}

	/** Visible spine nodes in this scene (containers are 2D-only for the preview). */
	function spineNodes(): Extract<LayoutNode, { kind: 'spine' }>[] {
		const out: Extract<LayoutNode, { kind: 'spine' }>[] = [];
		for (const n of scene.nodes) {
			if (n.kind === 'spine' && resolveTransform(n, layoutType).visible) out.push(n);
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
	function syncPlayback(node: Extract<LayoutNode, { kind: 'spine' }>, entry: Entry): void {
		if (entry.state !== 'ready') return;
		const wantPlay = playing.has(node.id);
		const wantAnim = node.defaultAnimation || entry.instance.firstAnimation;
		if (wantPlay && wantAnim) {
			if (entry.playingAnim !== wantAnim) {
				entry.instance.animationState.setAnimation(0, wantAnim, node.loop ?? true);
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

		const nodes = spineNodes();
		// Kick off loads for any newly-referenced bundles.
		for (const n of nodes) if (!entries.has(n.assetKey)) void ensureInstance(n.assetKey);

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

		for (const node of nodes) {
			const entry = entries.get(node.assetKey);
			if (!entry || entry.state !== 'ready') continue;
			syncPlayback(node, entry);
			const t = resolveTransform(node, layoutType);
			const inst = entry.instance;
			const sx = t.scale?.x ?? 1;
			const sy = t.scale?.y ?? 1;
			inst.skeleton.x = t.x;
			inst.skeleton.y = t.y;
			inst.skeleton.scaleX = sx;
			// Flip Y: the runtime art is y-up; the camera is y-down.
			inst.skeleton.scaleY = -sy;
			if (entry.playingAnim) inst.animationState.update(delta);
			inst.animationState.apply(inst.skeleton);
			inst.skeleton.updateWorldTransform(getSpinePhysics());
			renderer.begin();
			renderer.drawSkeleton(inst.skeleton, inst.premultipliedAlpha);
			renderer.end();
		}
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
		const live = new Set(spineNodes().map((n) => n.assetKey));
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
