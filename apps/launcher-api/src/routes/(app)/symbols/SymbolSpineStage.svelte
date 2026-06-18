<script lang="ts">
	// One shared WebGL canvas that draws EVERY visible spine cell in the grid — the
	// per-cell `SymbolSpinePreview` can't scale (browsers cap WebGL contexts at ~16,
	// and a board has ~30 spine cells). Mirrors the editor's `EditorSpineLayer`: one
	// gl context + SceneRenderer, a cache of skeletons, and a single rAF loop. The
	// canvas overlays the grid's scroll viewport (pointer-events:none); each frame it
	// finds the live screen rect of every `[data-spine-key]` cell (so it tracks
	// scrolling) and draws that cell's animation, looping, into it.
	import { onMount, untrack } from 'svelte';
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

	interface Props {
		/** The scroll container whose `[data-spine-key]` cells this draws over. */
		container: HTMLElement | null;
		/** Bumped by the page's "Reload from R2" — drops every cached bundle so the
		 *  rAF loop re-loads each one with a fresh `?v=` (mirrors EditorSpineLayer). */
		reloadToken?: number;
	}
	let { container, reloadToken = 0 }: Props = $props();

	let canvas: HTMLCanvasElement | null = $state(null);
	let gl: WebGLRenderingContext | null = null;
	let renderer: SpineSceneRenderer | null = null;
	let raf = 0;
	let lastTime = 0;

	interface Bounds {
		offX: number;
		offY: number;
		bw: number;
		bh: number;
	}
	type Entry =
		| { state: 'loading' | 'error' }
		| { state: 'ready'; instance: SpineInstance; anim: string | null; bounds: Bounds };
	// Keyed by `${resolveKey}\n${animation}` — one skeleton per (bundle, animation) so
	// cells that share a bundle but play DIFFERENT anims (e.g. the M low-multiplier) each
	// animate independently; cells sharing the SAME (bundle, anim) reuse one instance.
	const instances = new Map<string, Entry>();

	const specKey = (resolveKey: string, anim: string): string => `${resolveKey}\n${anim}`;

	function ensureGl(): boolean {
		if (gl && renderer) return true;
		if (!canvas) return false;
		const ctx = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true });
		if (!ctx) return false;
		gl = ctx;
		return true;
	}

	/** Natural setup-pose bounds (pose-independent), so per-frame fitting never has to
	 *  `setToSetupPose()` (which would wipe the applied animation frame). */
	function measureBounds(inst: SpineInstance): Bounds {
		const data = inst.skeleton.data as unknown as { width?: number; height?: number };
		if (data.width && data.height && data.width > 0 && data.height > 0) {
			return { offX: -data.width / 2, offY: -data.height / 2, bw: data.width, bh: data.height };
		}
		const skel = inst.skeleton;
		const sx = skel.scaleX;
		const sy = skel.scaleY;
		skel.scaleX = 1;
		skel.scaleY = 1;
		skel.setToSetupPose();
		skel.updateWorldTransform(getSpinePhysics());
		const offset = { x: 0, y: 0 };
		const size = { x: 0, y: 0 };
		try {
			skel.getBounds(offset, size, []);
		} catch {
			/* bounds unavailable */
		}
		skel.scaleX = sx;
		skel.scaleY = sy;
		if (size.x > 0 && size.y > 0) return { offX: offset.x, offY: offset.y, bw: size.x, bh: size.y };
		return { offX: -50, offY: -50, bw: 100, bh: 100 };
	}

	async function ensureInstance(key: string, resolveKey: string, anim: string): Promise<void> {
		if (instances.has(key)) return;
		instances.set(key, { state: 'loading' });
		if (!ensureGl() || !gl) {
			instances.set(key, { state: 'error' });
			return;
		}
		try {
			const instance = await loadSpineInstance(resolveKey, gl, reloadToken);
			if (!instance) {
				instances.set(key, { state: 'error' });
				return;
			}
			if (!renderer && canvas && gl) renderer = createSceneRenderer(canvas, gl);
			const play = anim || instance.firstAnimation;
			if (play) {
				try {
					instance.animationState.setAnimation(0, play, true);
				} catch {
					/* unknown animation — leave default */
				}
			}
			instances.set(key, {
				state: 'ready',
				instance,
				anim: play,
				bounds: measureBounds(instance),
			});
		} catch {
			instances.set(key, { state: 'error' });
		}
	}

	const PAD = 0.86;

	/** Place + draw one ready instance into a cell rect (CSS px, relative to the canvas).
	 *  Same fit + camera-mirror compensation as `SymbolSpinePreview`, generalised to an
	 *  arbitrary cell offset on a full-grid canvas of width `cw`. */
	function drawCell(
		entry: Extract<Entry, { state: 'ready' }>,
		x: number,
		y: number,
		w: number,
		h: number,
		cw: number,
	): void {
		if (!gl || !renderer) return;
		const { offX, offY, bw, bh } = entry.bounds;
		const skel = entry.instance.skeleton;
		const s = Math.min(w / bw, h / bh) * PAD;
		const cx = bw > 0 ? offX + bw / 2 : 0;
		const cy = bh > 0 ? offY + bh / 2 : 0;
		// Art centre at cell centre (pre-mirror), y-up runtime → y-down canvas (scaleY < 0).
		const preX = x + w / 2 - s * cx;
		skel.y = y + h / 2 + s * cy;
		// The camera (up=(0,-1,0)) mirrors X about the viewport centre — compensate by
		// placing the origin at `cw - preX` and negating scaleX (identical to the single
		// cell case where cw == cell size).
		skel.x = cw - preX;
		skel.scaleX = -s;
		skel.scaleY = -s;
		skel.updateWorldTransform(getSpinePhysics());
		renderer.begin();
		renderer.drawSkeleton(skel, entry.instance.premultipliedAlpha);
		renderer.end();
	}

	function frame(now: number): void {
		raf = requestAnimationFrame(frame);
		if (!canvas || !container) return;

		const dpr = window.devicePixelRatio || 1;
		const cw = container.clientWidth;
		const ch = container.clientHeight;
		const W = Math.floor(cw * dpr);
		const H = Math.floor(ch * dpr);
		if (canvas.width !== W || canvas.height !== H) {
			canvas.width = W;
			canvas.height = H;
		}

		const delta = lastTime ? (now - lastTime) / 1000 : 0;
		lastTime = now;

		const cells = container.querySelectorAll<HTMLElement>('[data-spine-key]');
		// Kick off any not-yet-loaded (bundle, anim).
		for (const el of cells) {
			const rk = el.dataset.spineKey;
			if (!rk) continue;
			const key = specKey(rk, el.dataset.spineAnim ?? '');
			if (!instances.has(key)) void ensureInstance(key, rk, el.dataset.spineAnim ?? '');
		}

		if (!gl) return;
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		if (!renderer) return;

		// Advance each ready animation ONCE per frame (then it may be drawn into many cells).
		for (const entry of instances.values()) {
			if (entry.state === 'ready' && entry.anim) {
				entry.instance.animationState.update(delta);
				entry.instance.animationState.apply(entry.instance.skeleton);
			}
		}

		// Static screen-space camera (CSS px → backing px via 1/dpr), y-down — identical
		// to SymbolSpinePreview so the per-cell fit math carries over unchanged.
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

		const base = canvas.getBoundingClientRect();
		for (const el of cells) {
			const rk = el.dataset.spineKey;
			if (!rk) continue;
			const entry = instances.get(specKey(rk, el.dataset.spineAnim ?? ''));
			if (!entry || entry.state !== 'ready') continue;
			const r = el.getBoundingClientRect();
			const x = r.left - base.left;
			const y = r.top - base.top;
			if (x + r.width < 0 || y + r.height < 0 || x > cw || y > ch) continue; // cull off-screen
			drawCell(entry, x, y, r.width, r.height, cw);
		}
	}

	// "Reload from R2": when the token bumps, drop every cached bundle (freeing GPU)
	// so the always-on rAF loop re-ensures them — re-fetching the skeleton + page
	// textures from R2 with the new `?v=`. `untrack` so only `reloadToken` retriggers
	// this (the `instances` map reads/writes aren't reactive dependencies).
	let lastReloadToken = 0;
	$effect(() => {
		const t = reloadToken;
		if (t === lastReloadToken) return;
		lastReloadToken = t;
		untrack(() => {
			for (const entry of instances.values()) {
				if (entry.state === 'ready') disposeSpineInstance(entry.instance);
			}
			instances.clear();
		});
	});

	onMount(() => {
		raf = requestAnimationFrame(frame);
		return () => {
			if (raf) cancelAnimationFrame(raf);
			for (const entry of instances.values()) {
				if (entry.state === 'ready') disposeSpineInstance(entry.instance);
			}
			instances.clear();
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

<canvas bind:this={canvas} class="stage"></canvas>

<style>
	.stage {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
		pointer-events: none;
	}
</style>
