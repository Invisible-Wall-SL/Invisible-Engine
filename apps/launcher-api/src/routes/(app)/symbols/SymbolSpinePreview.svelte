<script lang="ts">
	import { onMount } from 'svelte';
	import {
		disposeSpineInstance,
		loadSpineInstance,
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
	}
	let { assetKey, animationName, size, onAnimations }: Props = $props();

	let canvas: HTMLCanvasElement | null = $state(null);
	let gl: WebGLRenderingContext | null = null;
	let renderer: SpineSceneRenderer | null = null;
	let instance: SpineInstance | null = null;
	let raf = 0;
	let lastTime = 0;
	let playingAnim: string | null = null;
	let status = $state<'loading' | 'ready' | 'error'>('loading');

	/** Reload whenever the bundle key changes (a new spine cell focuses). */
	let loadedKey = '';
	async function ensure(): Promise<void> {
		if (loadedKey === assetKey && instance) return;
		teardownInstance();
		loadedKey = assetKey;
		status = 'loading';
		if (!ensureGl() || !gl) {
			status = 'error';
			return;
		}
		const inst = await loadSpineInstance(assetKey, gl);
		if (loadedKey !== assetKey) {
			// A newer key won the race — drop this stale instance.
			if (inst) disposeSpineInstance(inst);
			return;
		}
		if (!inst) {
			status = 'error';
			return;
		}
		if (!renderer && canvas && gl) renderer = createSceneRenderer(canvas, gl);
		instance = inst;
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
		playingAnim = null;
	}

	/** Contain-fit the skeleton's setup bounds into the square canvas (centred). */
	function fitSkeleton(inst: SpineInstance, w: number, h: number): void {
		const skel = inst.skeleton;
		const offset = { x: 0, y: 0 };
		const span = { x: 0, y: 0 };
		skel.scaleX = 1;
		skel.scaleY = 1;
		skel.setToSetupPose();
		skel.updateWorldTransform(getSpinePhysics());
		try {
			skel.getBounds(offset, span, []);
		} catch {
			/* bounds unavailable */
		}
		const data = inst.skeleton.data as unknown as { width?: number; height?: number };
		const bw = span.x > 0 ? span.x : (data.width ?? w);
		const bh = span.y > 0 ? span.y : (data.height ?? h);
		const pad = 0.86;
		const s = Math.min(w / bw, h / bh) * pad;
		const cx = span.x > 0 ? offset.x + span.x / 2 : 0;
		const cy = span.y > 0 ? offset.y + span.y / 2 : 0;
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
