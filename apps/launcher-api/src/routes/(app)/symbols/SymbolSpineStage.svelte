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
		measureSpineBounds,
		type SpineArtBounds,
		type SpineInstance,
	} from '../editor/editorSpine.client';
	import {
		createSceneRenderer,
		getSpinePhysics,
		type SpineSceneRenderer,
	} from '../editor/spineRuntime.client';
	import {
		createFxOverlay,
		type FxOverlayApi,
		type FxPlayOptions,
		type FxTransform,
	} from '$lib/fx/fxOverlay.client';
	import {
		boneScreenX,
		cellSkeletonX,
		stageGeometry,
		type StageGeometry,
	} from './symbolStageGeometry';

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

	/**
	 * One timed rig→FX binding on the playing animation's timeline (from `/api/editor/rig-fx`).
	 * Extends {@link FxPlayOptions} so the keyframe's authored overrides (opacity, size, delay,
	 * duration, speed) travel straight into `overlay.play` — this grid and the Rigger stage share the
	 * overlay, so they must also share what they hand it, or the two previews of one binding disagree.
	 */
	interface TimedFx extends FxPlayOptions {
		time: number;
		effectId: string;
		bone?: string;
	}
	type Entry =
		| { state: 'loading' | 'error' }
		| {
				state: 'ready';
				instance: SpineInstance;
				anim: string | null;
				/** Natural setup-pose bounds, measured ONCE at load (pose-independent), so per-frame
				 * fitting never has to `setToSetupPose()` — which would wipe the applied animation frame. */
				bounds: SpineArtBounds;
				/** The bundle key this instance loaded from — the `fxTimelines` lookup key. */
				resolveKey: string;
				/** Playing animation's duration (s) — the fallback wrap period for the fx playhead. */
				fxDur: number;
				/** Wrapped playhead (s) at the END of the previous frame; `-1` before the first frame so
				 * a keyframe AT t=0 fires on frame 1. Owns the per-instance FX crossing state. */
				fxPrev: number;
				/** Keyframes crossed THIS frame (computed once per instance, fired per visible cell). */
				fxCrossed: TimedFx[];
				/** True when the playhead wrapped/scrubbed back this frame → visible cells clear their
				 * live effects so a looping animation doesn't pile up a burst every loop. */
				fxLooped: boolean;
		  };
	// Keyed by `${resolveKey}\n${animation}` — one skeleton per (bundle, animation) so
	// cells that share a bundle but play DIFFERENT anims (e.g. the M low-multiplier) each
	// animate independently; cells sharing the SAME (bundle, anim) reuse one instance.
	const instances = new Map<string, Entry>();

	const specKey = (resolveKey: string, anim: string): string => `${resolveKey}\n${anim}`;

	// ── Live FX overlay (mirrors the Rigger's `view.html` fx preview) ──────────────────────────
	// A transparent Pixi overlay (the SHARED `createFxOverlay` core, reused verbatim from the Rigger)
	// draws each fx-bound symbol's particle burst ON the beat of its animation, riding the bound bone.
	// Everything here is INERT until a bound keyframe actually crosses on a VISIBLE cell: no Pixi
	// Application is created for a board with no bound symbols, so a plain spine grid pays nothing.
	let fxHost: HTMLElement | null = $state(null);
	let fxOverlay: FxOverlayApi | null = null;
	let fxInitStarted = false;
	/** Per-bundle fx timeline: `Record<anim, TimedFx[]>` or `null` (no bindings / a `.skel` / failed).
	 * Keyed by `resolveKey`; fetched once per bundle from `/api/editor/rig-fx`. */
	const fxTimelines = new Map<string, Record<string, TimedFx[]> | null>();
	const fxPending = new Set<string>();
	/** Per-CELL live effect handles. The crossing is per-INSTANCE (shared playhead), but a bundle can
	 * be drawn into many cells, so each visible cell owns its own handles + rides the bone itself.
	 * A `WeakMap` on the cell element → the entry is GC'd when the grid re-renders the cell away. */
	let cellFx = new WeakMap<HTMLElement, { active: { handle: number; bone?: string }[] }>();
	/** Shared empty crossing list for the (common) frames with no crossings — never mutated. */
	const EMPTY_FX: TimedFx[] = [];

	/** Fetch (once) a bundle's fx timeline. Cached even when empty so we don't re-hit the endpoint. */
	function ensureFxTimeline(resolveKey: string): void {
		if (fxTimelines.has(resolveKey) || fxPending.has(resolveKey)) return;
		fxPending.add(resolveKey);
		void (async () => {
			try {
				const bust = reloadToken ? `&v=${reloadToken}` : '';
				const res = await fetch(`/api/editor/rig-fx?key=${encodeURIComponent(resolveKey)}${bust}`);
				if (!res.ok) {
					fxTimelines.set(resolveKey, null);
					return;
				}
				const body = (await res.json()) as { animations?: Record<string, TimedFx[]> };
				const anims = body.animations;
				fxTimelines.set(resolveKey, anims && Object.keys(anims).length ? anims : null);
			} catch {
				fxTimelines.set(resolveKey, null);
			} finally {
				fxPending.delete(resolveKey);
			}
		})();
	}

	/** Lazily create + init the overlay the FIRST time a bound keyframe fires. Returns `null` until the
	 * host div is mounted (never before onMount). */
	function ensureOverlay(): FxOverlayApi | null {
		if (!fxHost) return null;
		if (!fxOverlay) fxOverlay = createFxOverlay();
		if (!fxInitStarted) {
			fxInitStarted = true;
			void fxOverlay.init(fxHost);
		}
		return fxOverlay;
	}

	/** Wrapped playhead (s) of a ready instance's track 0 — READ from the live entry (not accumulated)
	 * so the FX crossing stays in lockstep with the pose `apply` just produced. */
	function fxAnimTime(entry: Extract<Entry, { state: 'ready' }>): number {
		const te = entry.instance.animationState.getCurrent(0);
		if (!te) return 0;
		const dur = te.animation?.duration || entry.fxDur;
		return dur > 0 ? te.trackTime % dur : te.trackTime;
	}

	/** Project a posed bone into THIS cell's on-screen affine transform (CSS px, relative to the
	 * canvas / fx host, both `inset:0`), so the effect rides the bone's position + ROTATION + per-axis
	 * SCALE — not just its origin. `drawCell` placed the skeleton in a CSS-px world with X mirrored
	 * about the viewport centre (`skel.scaleX < 0`, `skel.x = cw - preX`) and Y running downward
	 * (`scaleY < 0` flips the y-up rig); undoing that mirror is the linear map `[[-1,0],[0,1]]` plus
	 * the `cw` translate, so the origin is `(cw - worldX, worldY)` and the bone's world axes
	 * `(b.a,b.c)` / `(b.b,b.d)` — which already carry the cell-fit scale (`skel.scaleX/Y = ±s`) and the
	 * bone's own rotation/scale — map to screen as `(-b.a,b.c)` / `(-b.b,b.d)`. `bone` absent ⇒ the rig
	 * origin (root bone `bones[0]`). Must be read RIGHT AFTER this cell's `drawCell` — the skeleton is
	 * shared, so the next cell repositions it.
	 *
	 * `cw` is the CANVAS's own CSS width, which is also the FX host's — see `frame`. It was the scroll
	 * container's `clientWidth`, and being short by a scrollbar put every burst on a different x scale
	 * from the rig it was supposed to ride. */
	function fxBoneTransform(
		instance: SpineInstance,
		bone: string | undefined,
		geo: StageGeometry,
	): FxTransform | null {
		const skel = instance.skeleton;
		const b = bone ? skel.findBone(bone) : skel.bones[0];
		if (!b) return null;
		return { x: boneScreenX(geo, b.worldX), y: b.worldY, a: -b.a, b: b.c, c: -b.b, d: b.d };
	}

	/** Drive one cell's live FX for this frame: clear on loop, fire newly-crossed keyframes at the
	 * bound bone (projected into this cell's rect), then ride the bone for every active effect. Called
	 * immediately after the cell's `drawCell`, so the shared skeleton is posed for THIS cell. */
	function updateCellFx(
		el: HTMLElement,
		entry: Extract<Entry, { state: 'ready' }>,
		geo: StageGeometry,
	): void {
		let cf = cellFx.get(el);
		// Loop / scrub-back: drop this cell's live effects so a looping symbol doesn't accumulate a
		// fresh burst every loop (mirrors `view.html`'s `RiggerFx.clear()` on wrap).
		if (entry.fxLooped && cf && cf.active.length) {
			for (const fx of cf.active) fxOverlay?.stop(fx.handle);
			cf.active = [];
		}
		// Fire newly-crossed keyframes. The overlay (and its Pixi context) is created only HERE, on the
		// first real fire — a board with no bound symbols never reaches this.
		if (entry.fxCrossed.length) {
			const overlay = ensureOverlay();
			if (overlay) {
				for (const b of entry.fxCrossed) {
					const t = fxBoneTransform(entry.instance, b.bone, geo);
					if (!t) continue;
					if (!cf) {
						cf = { active: [] };
						cellFx.set(el, cf);
					}
					// Hand the keyframe’s own overrides to the overlay, not just the transform.
					const { time: _time, effectId: _id, bone: _bone, ...overrides } = b;
					cf.active.push({ handle: overlay.play(b.effectId, t, overrides), bone: b.bone });
				}
			}
		}
		// Ride the bone: reposition every active effect for this cell each frame.
		if (cf && cf.active.length && fxOverlay) {
			for (const fx of cf.active) {
				const t = fxBoneTransform(entry.instance, fx.bone, geo);
				if (t) fxOverlay.follow(fx.handle, t);
			}
		}
	}

	function ensureGl(): boolean {
		if (gl && renderer) return true;
		if (!canvas) return false;
		const ctx = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true });
		if (!ctx) return false;
		gl = ctx;
		return true;
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
			const fxDur = play
				? (instance.data.animations.find((a) => a.name === play)?.duration ?? 0)
				: 0;
			instances.set(key, {
				state: 'ready',
				instance,
				anim: play,
				bounds: measureSpineBounds(instance),
				resolveKey,
				fxDur,
				fxPrev: -1,
				fxCrossed: EMPTY_FX,
				fxLooped: false,
			});
		} catch {
			instances.set(key, { state: 'error' });
		}
	}

	/**
	 * NO inset: a spine cell contain-fits its DECLARED canvas to the cell exactly, which is both
	 * what the board does and what the sprite thumbnail beside it does.
	 *
	 * The game's numbers look like they disagree and don't: a symbol bundle is baked with
	 * `SYMBOL_SPINE_LOAD_SCALE` (2) and `SymbolSpineMain` contain-fits it to
	 * `cell × SYMBOL_SPINE_FILL` (0.5) — but `parser.scale` scales skeleton GEOMETRY while
	 * `SkeletonJson` copies `data.width/height` through UNSCALED, so `spineSizeScale` divides by
	 * the raw canvas and the 2 × 0.5 nets out to one full cell (the "tuned pair" in
	 * `spineLoadScale.ts`). The preview loads at `EDITOR_SPINE_LOAD_SCALE` (1) and fits to the
	 * same raw canvas, so it is already 1:1 with the board — a `0.86` pad here used to be the
	 * ONLY thing making a spine cell read smaller than its sprite neighbours.
	 *
	 * Consequence to keep in mind: a win animation peaks well past the resting canvas (1.4–1.8×
	 * for h1–h5), and this stage has no per-cell clip, so a pop can bleed over its neighbours.
	 * That is the same overflow the board shows, and hiding it behind an inset also hid the
	 * loose rig canvases it was masking.
	 */

	/** Place + draw one ready instance into a cell rect (CSS px, relative to the canvas).
	 *  Same fit + camera-mirror compensation as `SymbolSpinePreview`, generalised to an
	 *  arbitrary cell offset on a full-grid canvas of width `cw`. The fit scale `s` it computes
	 *  is baked into `skel.scaleX/Y`, so the FX overlay recovers it (plus the bone's own
	 *  rotation/scale) straight off the posed bone's world matrix in `fxBoneTransform`. */
	function drawCell(
		entry: Extract<Entry, { state: 'ready' }>,
		x: number,
		y: number,
		w: number,
		h: number,
		geo: StageGeometry,
	): void {
		if (!gl || !renderer) return;
		const { offX, offY, bw, bh } = entry.bounds;
		const skel = entry.instance.skeleton;
		const s = Math.min(w / bw, h / bh);
		const cx = bw > 0 ? offX + bw / 2 : 0;
		const cy = bh > 0 ? offY + bh / 2 : 0;
		// Art centre at cell centre (pre-mirror), y-up runtime → y-down canvas (scaleY < 0).
		skel.y = y + h / 2 + s * cy;
		// The camera (up=(0,-1,0)) mirrors X about the viewport centre — compensate by
		// placing the origin at `cw - preX` and negating scaleX (identical to the single
		// cell case where cw == cell size).
		skel.x = cellSkeletonX(geo, x, w, s, cx);
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
		// Geometry comes from the CANVAS's own box, never the scroll container's.
		//
		// They are not the same box, and the difference is a scrollbar. `container` is `.grid-scroll`
		// (`overflow:auto`), while this canvas and the FX layer are its SIBLINGS — all three are
		// `inset:0` inside `.grid-area`, so the canvas spans the full width while the container's
		// `clientWidth` is short by the scrollbar (measured live: 885 vs 900).
		//
		// Sizing the backing store from the short number then displaying it across the full box
		// STRETCHED everything drawn here by ~1.7%, growing with x — a cell at x=885 landed at 900.
		// The rig cells drifted right, and the FX overlay (a separate Pixi canvas correctly sized to
		// its own box) did not, so a bound burst pulled away from its symbol the further right it sat.
		// That was the reported "FX is offset in the Symbols state machine".
		//
		// Reading our own box fixes both halves at once: the backing store matches what it is
		// displayed across (no stretch), the mirror axis below matches the cell rects — which are
		// already measured against `canvas.getBoundingClientRect()` — and the FX host, being the same
		// box, agrees by construction rather than by coincidence.
		const geo = stageGeometry(canvas, dpr);
		const cw = geo.cssWidth;
		const ch = geo.cssHeight;
		if (cw === 0 || ch === 0) return; // laid out to nothing (hidden panel) — nothing to draw
		if (canvas.width !== geo.backingWidth || canvas.height !== geo.backingHeight) {
			canvas.width = geo.backingWidth;
			canvas.height = geo.backingHeight;
		}

		const delta = lastTime ? (now - lastTime) / 1000 : 0;
		lastTime = now;

		const cells = container.querySelectorAll<HTMLElement>('[data-spine-key]');
		// Kick off any not-yet-loaded (bundle, anim) + fetch each bundle's fx bindings once.
		for (const el of cells) {
			const rk = el.dataset.spineKey;
			if (!rk) continue;
			const key = specKey(rk, el.dataset.spineAnim ?? '');
			if (!instances.has(key)) void ensureInstance(key, rk, el.dataset.spineAnim ?? '');
			ensureFxTimeline(rk);
		}

		if (!gl) return;
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		if (!renderer) return;

		// Advance each ready animation ONCE per frame (then it may be drawn into many cells), and
		// compute its FX crossing ONCE (fired per-cell below). The crossing is per-instance because the
		// playhead is shared across every cell that reuses this (bundle, anim) instance.
		for (const entry of instances.values()) {
			if (entry.state !== 'ready' || !entry.anim) continue;
			entry.instance.animationState.update(delta);
			entry.instance.animationState.apply(entry.instance.skeleton);
			// Only bundles with authored fx bindings for the playing anim do any crossing work.
			const tl = fxTimelines.get(entry.resolveKey)?.[entry.anim];
			entry.fxLooped = false;
			if (tl && tl.length) {
				const cur = fxAnimTime(entry);
				// Interval (lo, cur] crossed this frame. On a loop-wrap / scrub-back drop `lo` below 0 so
				// a keyframe AT (or near) t=0 fires on the wrap — a plain `prev < time` can't cross t=0.
				let lo = entry.fxPrev;
				if (cur < entry.fxPrev - 1e-4) {
					entry.fxLooped = true;
					lo = -1;
				}
				const crossed: TimedFx[] = [];
				for (const b of tl) if (lo < b.time && cur >= b.time) crossed.push(b);
				entry.fxCrossed = crossed;
				entry.fxPrev = cur;
			} else {
				entry.fxCrossed = EMPTY_FX;
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
			drawCell(entry, x, y, r.width, r.height, geo);
			// FX (fire on the beat + ride the bone) reads the skeleton posed by `drawCell` for THIS
			// cell — so it MUST run right after, before the shared skeleton is reposed for the next cell.
			updateCellFx(el, entry, geo);
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
			// Drop the FX caches + live effects too: a re-exported rig may change its bindings, and the
			// stale cell handles reference a skeleton about to be disposed. The overlay itself is kept
			// (its Pixi context is reusable) — only its live effects are cleared.
			fxTimelines.clear();
			fxPending.clear();
			cellFx = new WeakMap();
			fxOverlay?.clear();
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
			// Force-free the overlay's Pixi/WebGL context — the browser caps live contexts (~8–16), so a
			// stage that mounts/unmounts (panel toggles, navigation) must release it (RiggerFx discipline).
			try {
				fxOverlay?.destroy();
			} catch {
				/* overlay already torn down */
			}
			fxOverlay = null;
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
<!-- The FX overlay's transparent Pixi canvas mounts INTO this host, above the spine canvas (later in
     DOM ⇒ on top), so particle bursts render over their symbol. Stays empty until a bound effect fires. -->
<div bind:this={fxHost} class="fx-layer"></div>

<style>
	.stage {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
		pointer-events: none;
	}
	.fx-layer {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
		pointer-events: none;
	}
</style>
