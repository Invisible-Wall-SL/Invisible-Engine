/**
 * Invisible FX — the shared LIVE FX overlay CORE (framework-agnostic).
 *
 * A transparent Pixi `Application` that mounts OVER a raw `spine-webgl` stage and plays authored
 * Invisible FX `EffectDoc`s as live particle bursts, riding a host bone via per-frame `follow()`.
 * It is deliberately plain TS / Pixi-only: the load-bearing logic (`engine-fx`'s
 * `normalizeEffectDoc`/`planLayer`/`bindArt`, the shared art helper `effectEmitter.client.ts`) is
 * already Svelte-free, so only the imperative shell lives here.
 *
 * ONE core, TWO hosts (the house "prefer reuse over duplication" rule):
 *  - the Invisible Rigger's static `view.html` — via `src/rigger-fx/main.ts`, a thin IIFE that
 *    creates one instance and exposes it as `window.RiggerFx` (built by `vite.rigger-fx.config.ts`);
 *  - the Invisible Symbols State-Machine stage — `SymbolSpineStage.svelte` creates its OWN instance
 *    and drives it from the same rAF loop that draws the grid's spine cells.
 * Making this a FACTORY (`createFxOverlay()`) rather than the module-singleton it used to be is what
 * lets each host own an independent overlay (independent Pixi context + effect handles) instead of
 * sharing hidden module state.
 *
 * Two gotchas handled explicitly: (1) never `Assets.load` the query-string `/api/editor/asset?key=…`
 * URL — `framesToTextures` fetch→`createImageBitmap`→`ImageSource` instead; (2) never JSON-clone a
 * `bindArt` result — it holds live `Texture` objects (`bindArt` already deep-cloned the config).
 *
 * Scope: sprite-particle layers (Tiers A/B). A `particleKind:'spine'` layer (Tier C) is SKIPPED here
 * (it needs a pooled `Spine` host the overlay doesn't provide), matching the v1 preview scope — the
 * SAME scope both hosts share.
 */

import { Emitter } from '@barvynkoa/particle-emitter';
import {
	bindArt,
	normalizeEffectDoc,
	planLayer,
	type EffectDoc,
	type EmitterLayer,
} from 'engine-fx';
import { Application, Container, Matrix, type TextureSource } from 'pixi.js';
import { framesToTextures, type ResolvedArt } from './effectEmitter.client';

/**
 * A bone's on-screen affine transform (all in CSS px in host space): `(x,y)` is the bone origin,
 * and `(a,b)` / `(c,d)` are the on-screen images of the bone's local +X / +Y axes — i.e. a Pixi
 * `Matrix` linear part. Carrying the full 2×2 (not just a uniform scale) lets an effect ride the
 * bone's position + ROTATION + per-axis SCALE, matching the game's
 * `<SpineBoneAttach followRotation followScale>`. Each host computes it by mapping the bone's world
 * matrix through its own stage projection (so it's correct under any zoom/pan/mirror).
 */
export interface FxTransform {
	x: number;
	y: number;
	a: number;
	b: number;
	c: number;
	d: number;
}

/** The imperative surface each host drives (the Rigger assigns an instance to `window.RiggerFx`). */
export interface FxOverlayApi {
	/** Create the transparent overlay `Application` inside `hostEl` + start its ticker. Idempotent. */
	init(hostEl: HTMLElement): Promise<void>;
	/** Re-fit the renderer to the host (call on host resize). */
	resize(): void;
	/** Play an effect by id, riding the bone's on-screen transform `t`. Returns a handle. */
	play(effectId: string, t: FxTransform): number;
	/** Update an active effect's transform (call every frame to ride the bone). */
	follow(handle: number, t: FxTransform): void;
	/** Dispose one effect's emitters + its container. */
	stop(handle: number): void;
	/** Stop every active effect. */
	clear(): void;
	/** `clear()` + force-free the WebGL context. */
	destroy(): void;
}

/** A live per-`play()` render: its container + one emitter per resolved sprite layer. */
interface LiveEffect {
	container: Container;
	emitters: Emitter[];
	/** Pending emit-stop timers (the bounded-burst caps) — cleared on dispose. */
	timers: ReturnType<typeof setTimeout>[];
	/** True once torn down — a late texture resolve then skips wiring an emitter into a dead effect
	 * (the ready-guard, mirroring `EditorEffectLayer`'s generation check). */
	disposed: boolean;
}

/** Preview burst cap (ms). A finite `emitterLifetime` self-stops earlier; this only bounds an
 * INFINITE (continuous) effect so it doesn't emit forever in a preview — the effect would otherwise
 * "keep looping" whether or not the animation is playing. Particles still live out their own lifetime
 * after emission stops. */
const PREVIEW_HOLD_MS = 1500;

/**
 * Build one independent FX overlay. All state is closed over per instance — two overlays on two
 * pages (or, defensively, on one) never collide.
 */
export function createFxOverlay(): FxOverlayApi {
	// --- instance state ------------------------------------------------------------------------
	let app: Application | null = null;
	let world: Container | null = null;
	let host: HTMLElement | null = null;
	/** The in-flight (or resolved) init — `play()` may be called before it resolves, so it awaits this. */
	let initPromise: Promise<void> | null = null;

	/** Active effects keyed by their numeric handle. */
	const effects = new Map<number, LiveEffect>();
	let nextHandle = 1;

	/** Cache of fetched `EffectDoc`s by effectId (one doc can back many plays). */
	const docCache = new Map<string, Promise<EffectDoc | null>>();
	/** Cache of resolved atlas-page `TextureSource`s by URL (a page decodes once per overlay). */
	const sourceCache = new Map<string, TextureSource>();
	/** Cache of resolved art (manifest key → page + regions). */
	const artCache = new Map<string, Promise<ResolvedArt | null>>();

	// --- fetch closures (same-origin; the session cookie flows) --------------------------------

	/** Resolve an `art.assetKey` (atlas manifest key) to its page URL + region rects — the exact shape
	 * `framesToTextures` expects, mirroring the `/fx` + Scene-Editor overlays. */
	function resolveArt(assetKey: string): Promise<ResolvedArt | null> {
		const hit = artCache.get(assetKey);
		if (hit) return hit;
		const p = (async (): Promise<ResolvedArt | null> => {
			const res = await fetch(`/api/editor/regions?sheet=${encodeURIComponent(assetKey)}`);
			if (!res.ok) return null;
			const set = (await res.json()) as {
				pageKey: string;
				pageWidth: number;
				pageHeight: number;
				regions: { name: string; x: number; y: number; w: number; h: number; rotated?: boolean }[];
			};
			if (!set.pageKey) return null;
			return {
				pageUrl: `/api/editor/asset?key=${encodeURIComponent(set.pageKey)}`,
				pageWidth: set.pageWidth,
				pageHeight: set.pageHeight,
				regions: set.regions,
			};
		})();
		artCache.set(assetKey, p);
		return p;
	}

	/** Fetch (once) + normalize the `EffectDoc` for an effectId. `null` on any failure so a bad id
	 * never crashes the overlay. */
	function loadEffectDoc(effectId: string): Promise<EffectDoc | null> {
		const hit = docCache.get(effectId);
		if (hit) return hit;
		const p = (async (): Promise<EffectDoc | null> => {
			try {
				const res = await fetch(`/api/editor/effect?id=${encodeURIComponent(effectId)}`);
				if (!res.ok) return null;
				const body = (await res.json()) as { doc: unknown };
				if (!body.doc) return null;
				return normalizeEffectDoc(body.doc, effectId);
			} catch {
				return null;
			}
		})();
		docCache.set(effectId, p);
		return p;
	}

	// --- lifecycle ------------------------------------------------------------------------------

	function resize(): void {
		if (!app || !host) return;
		app.renderer.resize(host.clientWidth, host.clientHeight);
	}

	/** Advance every active emitter one tick, isolating a degenerate config so one bad emitter can't
	 * throw out of the ticker and freeze the whole overlay. */
	function tick(deltaSeconds: number): void {
		for (const effect of effects.values()) {
			for (const emitter of effect.emitters) {
				try {
					emitter.update(deltaSeconds);
				} catch (err) {
					console.warn('FxOverlay: emitter.update threw; stopping that emitter', err);
					emitter.emit = false;
				}
			}
		}
	}

	async function init(hostEl: HTMLElement): Promise<void> {
		if (initPromise) return initPromise;
		host = hostEl;
		initPromise = (async () => {
			const created = new Application();
			// Transparent bg so this overlays the raw-WebGL stage; `resolution: devicePixelRatio`
			// keeps stage coords in CSS px (so containers place directly at the host-space (x,y) the
			// caller computed the same way it positions its bone marker).
			await created.init({
				backgroundAlpha: 0,
				antialias: true,
				resizeTo: hostEl,
				resolution: window.devicePixelRatio || 1,
			});
			app = created;
			const canvas = app.canvas;
			canvas.style.position = 'absolute';
			canvas.style.inset = '0';
			canvas.style.pointerEvents = 'none';
			hostEl.appendChild(canvas);
			world = new Container();
			app.stage.addChild(world);
			app.ticker.add((ticker) => {
				tick(ticker.deltaMS / 1000);
			});
		})();
		return initPromise;
	}

	// --- play / follow / stop -------------------------------------------------------------------

	/** Build one sprite layer's live `Emitter` into an effect's container. A layer that resolves 0
	 * textures is SKIPPED (real art only — no placeholder dots in the preview). */
	async function buildLayer(
		effect: LiveEffect,
		layer: EmitterLayer,
		plan: ReturnType<typeof planLayer>,
	): Promise<void> {
		const textures = await framesToTextures(layer, resolveArt, sourceCache);
		if (effect.disposed || textures.length === 0) return;
		// Weighted mix only when the resolved textures line up 1:1 with `frames` (a skipped region
		// would misalign the weights → fall back to uniform), matching the Scene-Editor overlay.
		const weights = textures.length === layer.art.frames.length ? layer.art.weights : undefined;
		// bindArt deep-clones the (texture-free) config, then attaches the live textures — the result
		// must NOT be JSON-cloned again (that would destroy the Texture objects).
		const config = bindArt(layer.config, textures, layer.art.animated ?? false, weights);
		// Honor the layer's placement OFFSET (authored in /fx). The game applies it via the layer's own
		// offset `<Container>` / `<SpineBoneAttach offset>`; mirror that with a per-layer offset
		// container nested in the zoom-scaled effect container, so the offset tracks stage scale.
		const layerContainer = new Container();
		layerContainer.position.set(plan.offset?.x ?? 0, plan.offset?.y ?? 0);
		effect.container.addChild(layerContainer);
		const emitter = new Emitter(layerContainer, config);
		// Force-emit ALL layers from mount, ignoring layer.trigger — the keyframe IS the trigger, and
		// `emitterLifetime` bounds the burst (the same `forceEmit` contract the rig-bound runtime uses).
		emitter.emit = true;
		// Bounded preview: stop emitting after the hold cap so an INFINITE-lifetime effect doesn't run
		// forever. A finite emitter has already self-stopped by then (this is a no-op).
		effect.timers.push(
			setTimeout(() => {
				try {
					emitter.emit = false;
				} catch {
					/* emitter already torn down */
				}
			}, PREVIEW_HOLD_MS),
		);
		effect.emitters.push(emitter);
	}

	/** Play an effect. Returns a numeric handle synchronously; textures resolve asynchronously and the
	 * emitters activate when they land (a ready-guard against the effect being stopped meanwhile). */
	function play(effectId: string, t: FxTransform): number {
		const handle = nextHandle++;
		// If init hasn't resolved yet, the container is added lazily once `world` exists (below).
		const container = new Container();
		container.setFromMatrix(new Matrix(t.a, t.b, t.c, t.d, t.x, t.y));
		const effect: LiveEffect = { container, emitters: [], timers: [], disposed: false };
		effects.set(handle, effect);

		void (async () => {
			await (initPromise ?? Promise.resolve());
			if (effect.disposed || !world) return;
			world.addChild(container);
			const doc = await loadEffectDoc(effectId);
			if (effect.disposed || !doc) return;
			for (const layer of doc.layers) {
				const plan = planLayer(layer);
				// Skip non-rendering layers + Tier-C spine-particle layers (no pooled Spine host here).
				if (!plan.render || plan.particleKind === 'spine') continue;
				await buildLayer(effect, layer, plan);
				if (effect.disposed) return;
			}
		})();

		return handle;
	}

	/** Update an effect's container transform so it rides the bone (position + rotation + scale). */
	function follow(handle: number, t: FxTransform): void {
		const effect = effects.get(handle);
		if (!effect) return;
		effect.container.setFromMatrix(new Matrix(t.a, t.b, t.c, t.d, t.x, t.y));
	}

	/** Dispose one effect's emitters + its container. */
	function disposeEffect(effect: LiveEffect): void {
		effect.disposed = true;
		for (const t of effect.timers) clearTimeout(t);
		effect.timers = [];
		for (const emitter of effect.emitters) {
			try {
				emitter.emit = false;
				emitter.destroy();
			} catch {
				/* emitter already torn down */
			}
		}
		effect.emitters = [];
		effect.container.destroy({ children: true });
	}

	function stop(handle: number): void {
		const effect = effects.get(handle);
		if (!effect) return;
		disposeEffect(effect);
		effects.delete(handle);
	}

	function clear(): void {
		for (const effect of effects.values()) disposeEffect(effect);
		effects.clear();
	}

	function destroy(): void {
		clear();
		app?.destroy(true);
		app = null;
		world = null;
		host = null;
		initPromise = null;
	}

	return { init, resize, play, follow, stop, clear, destroy };
}
