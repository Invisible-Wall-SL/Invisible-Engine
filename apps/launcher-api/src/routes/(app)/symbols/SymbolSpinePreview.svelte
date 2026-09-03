<script lang="ts">
	import { onMount } from 'svelte';
	import {
		disposeSpineInstance,
		loadSpineInstance,
		measureSpineBounds,
		type SpineArtBounds,
		type SpineInstance,
	} from '../editor/editorSpine.client';
	import {
		createSceneRenderer,
		getSpinePhysics,
		type SpineSceneRenderer,
	} from '../editor/spineRuntime.client';
	import CellLoading from './CellLoading.svelte';

	interface Props {
		/** Spine bundle key (the `assetKey` of a spine cell). */
		assetKey: string;
		/** Animation to play; falls back to the skeleton's first animation. */
		animationName?: string;
		/** Square CSS size of the preview canvas. */
		size: number;
		/** Reports the bundle's animation names once loaded (drives the cell editor). */
		onAnimations?: (names: string[]) => void;
		/** Bumped by the page's "Reload from R2" — re-fetches the skeleton + pages
		 *  (with a fresh `?v=`) so a re-exported bundle refreshes without a reload. */
		reloadToken?: number;
	}
	let { assetKey, animationName, size, onAnimations, reloadToken = 0 }: Props = $props();

	let canvas: HTMLCanvasElement | null = $state(null);
	let gl: WebGLRenderingContext | null = null;
	let renderer: SpineSceneRenderer | null = null;
	let instance: SpineInstance | null = null;
	// Measured ONCE per instance: `measureSpineBounds` runs `setToSetupPose()` on its
	// fallback path, which would wipe the applied animation frame if the render loop
	// re-measured. The rect is pose-independent, so once is also correct.
	let artBounds: SpineArtBounds | null = null;
	let raf = 0;
	let lastTime = 0;
	let playingAnim: string | null = null;
	let status = $state<'loading' | 'ready' | 'error'>('loading');

	// Attempt the load ONCE per key. `ensure()` runs every animation frame, so the
	// guard must short-circuit after the FIRST attempt whether it succeeded or FAILED
	// — otherwise a failing key (missing spine, 404, network) re-fetches every frame
	// and floods the browser (ERR_INSUFFICIENT_RESOURCES). `loadedKey` is set
	// synchronously before the await, so the very next frame already short-circuits.
	// Guard key folds in `reloadToken` so a "Reload from R2" bump re-runs the load
	// (re-fetching the descriptor + skeleton + pages with the new `?v=`) for the
	// SAME bundle key, exactly as a key change would.
	let loadedKey = '';
	const wantKey = $derived(`${assetKey}\n${reloadToken}`);
	async function ensure(): Promise<void> {
		// Canvas/GL not ready yet → don't claim the key; retry next frame.
		if (!ensureGl() || !gl) return;
		if (loadedKey === wantKey) return;
		loadedKey = wantKey;
		teardownInstance();
		status = 'loading';
		const inst = await loadSpineInstance(assetKey, gl, reloadToken);
		if (loadedKey !== wantKey) {
			// A newer key won the race — drop this stale instance.
			if (inst) disposeSpineInstance(inst);
			return;
		}
		if (!inst) {
			status = 'error';
			return;
		}
		if (!renderer && canvas) renderer = createSceneRenderer(canvas, gl);
		instance = inst;
		artBounds = measureSpineBounds(inst);
		playingAnim = null;
		status = 'ready';
		onAnimations?.(inst.data.animations.map((a) => a.name));
	}

	function ensureGl(): boolean {
		if (gl) return true;
		if (!canvas) return false;
		const ctx = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true });
		if (!ctx) return false;
		gl = ctx;
		return true;
	}

	function teardownInstance(): void {
		if (instance) {
			disposeSpineInstance(instance);
			instance = null;
		}
		artBounds = null;
		playingAnim = null;
	}

	/**
	 * Contain-fit the rig into the square canvas (centred) against `measureSpineBounds` —
	 * the AUTHORED skeleton box, read where the header puts it, which is the same rect the
	 * game's `spineSizeScale` + `centreBox` and the Scene Editor's reel cells fit. This
	 * preview used to fit live setup-pose
	 * bounds instead, which disagrees with what ships whenever a rig's canvas and its
	 * resting art differ: the scatter's invisible ray burst (bones scaled ×4) made the grid
	 * draw a gem a third the size the board shows.
	 */
	function fitSkeleton(inst: SpineInstance, w: number, h: number): void {
		const skel = inst.skeleton;
		const { offX, offY, bw, bh } = (artBounds ??= measureSpineBounds(inst));
		skel.scaleX = 1;
		skel.scaleY = 1;
		skel.setToSetupPose();
		skel.updateWorldTransform(getSpinePhysics());
		// No inset — the declared canvas fills the box, matching the board and the grid's own
		// `SymbolSpineStage`. See the sizing note there for why the game's ×2 load scale and
		// ×0.5 `SYMBOL_SPINE_FILL` net out to one full cell.
		const s = Math.min(w / bw, h / bh);
		const cx = offX + bw / 2;
		const cy = offY + bh / 2;
		skel.x = w / 2 - s * cx;
		skel.y = h / 2 + s * cy;
		skel.scaleX = s;
		// Runtime art is y-up; the camera is y-down → flip.
		skel.scaleY = -s;
	}

	function frame(now: number): void {
		raf = requestAnimationFrame(frame);
		if (!canvas) return;
		void ensure();
		const delta = lastTime ? (now - lastTime) / 1000 : 0;
		lastTime = now;
		if (!gl || !renderer || !instance) return;

		const dpr = window.devicePixelRatio || 1;
		const w = Math.floor(size * dpr);
		const h = Math.floor(size * dpr);
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w;
			canvas.height = h;
		}
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);

		const cam = renderer.camera;
		cam.viewportWidth = canvas.width;
		cam.viewportHeight = canvas.height;
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

		const want = animationName || instance.firstAnimation;
		if (want && playingAnim !== want) {
			try {
				instance.animationState.setAnimation(0, want, true);
				playingAnim = want;
			} catch {
				/* unknown animation — leave whatever plays */
			}
		}

		fitSkeleton(instance, size, size);
		// The camera (up=(0,-1,0)) mirrors X about the viewport centre; negate scaleX
		// + place the origin at `size - x` to compensate, mirroring the editor layer.
		instance.skeleton.x = size - instance.skeleton.x;
		instance.skeleton.scaleX = -instance.skeleton.scaleX;
		if (playingAnim) instance.animationState.update(delta);
		instance.animationState.apply(instance.skeleton);
		instance.skeleton.updateWorldTransform(getSpinePhysics());
		renderer.begin();
		renderer.drawSkeleton(instance.skeleton, instance.premultipliedAlpha);
		renderer.end();
	}

	onMount(() => {
		raf = requestAnimationFrame(frame);
		return () => {
			if (raf) cancelAnimationFrame(raf);
			teardownInstance();
			try {
				renderer?.dispose();
			} catch {
				/* context teardown */
			}
			renderer = null;
			gl?.getExtension('WEBGL_lose_context')?.loseContext();
			gl = null;
		};
	});
</script>

<div class="wrap" style:width="{size}px" style:height="{size}px">
	<canvas bind:this={canvas} style:width="{size}px" style:height="{size}px"></canvas>
	{#if status === 'loading'}
		<div class="ld"><CellLoading {size} /></div>
	{:else if status === 'error'}
		<span class="overlay err">no spine</span>
	{/if}
</div>

<style>
	.wrap {
		position: relative;
		display: grid;
		place-items: center;
		border-radius: 4px;
		background: #0b0b10;
	}
	canvas {
		display: block;
	}
	.ld {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		pointer-events: none;
	}
	.overlay {
		position: absolute;
		font-size: 10px;
		color: #666;
		pointer-events: none;
	}
	.overlay.err {
		color: #8a5a5a;
	}
</style>
