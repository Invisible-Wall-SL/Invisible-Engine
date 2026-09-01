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
 *
 * It also plays Invisible Flipbook CLIPS ({@link FxOverlayApi.playFlipbook}), because the Rigger can
 * bind either to an animation event and both must ride the same bone through the same `follow()`.
 * One overlay rather than a second canvas per host: a burst and a clip bound to the same beat have
 * to be in ONE scene to layer against each other at all, and the browser caps live WebGL contexts
 * (~16) — the reason the FX overlay is already lazy per band.
 */

import { Emitter } from '@barvynkoa/particle-emitter';
import {
	bindArt,
	emitterDeltaSeconds,
	normalizeEffectDoc,
	planLayer,
	type EffectDoc,
	type EmitterLayer,
} from 'engine-fx';
import {
	AnimatedSprite,
	Application,
	Container,
	Matrix,
	type Ticker,
	type TextureSource,
} from 'pixi.js';
import { framesToTextures, type ResolvedArt } from './effectEmitter.client';
import { clipToTextures, type OverlayClip } from './flipbookFrames.client';

/** Re-exported so a host types its clip list against the same shape the overlay consumes. */
export type { OverlayClip };

/**
 * A bone's on-screen affine transform (all in CSS px in host space): `(x,y)` is the bone origin,
 * and `(a,b)` / `(c,d)` are the on-screen images of the bone's local +X / +Y axes — i.e. a Pixi
 * `Matrix` linear part. Carrying the full 2×2 (not just a uniform scale) lets an effect ride the
 * bone's position + ROTATION + per-axis SCALE, matching the game's
 * `<SpineBoneAttach followRotation followScale>`. Each host computes it by mapping the bone's world
 * matrix through its own stage projection.
 *
 * That projection is a MIRROR on every host we have — both stages draw a y-up skeleton into a y-down
 * canvas, and the Symbols grid mirrors x as well — so the basis handed here routinely has a negative
 * determinant. It is stripped before it reaches a container ({@link fxMatrix}), never carried:
 * see that function for why a reflection is a projection detail and not part of the transform.
 */
export interface FxTransform {
	x: number;
	y: number;
	a: number;
	b: number;
	c: number;
	d: number;
}

/**
 * The per-binding overrides a rig keyframe can carry, as the overlay consumes them. Structurally the
 * numeric half of `engine-layout`'s `RigFxOverrides` — `slot` is absent BY DESIGN: this overlay is a
 * separate Pixi canvas layered over a raw-WebGL rig canvas, so it can draw above or below the whole
 * rig but never between two of its slots. The host decides which BAND a slot binding lands in; the
 * game honours the real depth. (Same constraint the cinematic already states for its `fx:` cues.)
 */
export interface FxPlayOptions {
	/** Opacity multiplier, 0–1. */
	alpha?: number;
	/** Size multiplier on the whole burst. */
	scale?: number;
	/** Milliseconds to wait before the burst starts. */
	delay?: number;
	/** Milliseconds of emission, then stop. Overrides the preview's own {@link PREVIEW_HOLD_MS} cap. */
	duration?: number;
	/** Time-scale multiplier on this effect's emitters. */
	speed?: number;
	/**
	 * This burst is meant to run continuously, so do NOT apply {@link PREVIEW_HOLD_MS}.
	 *
	 * That cap exists so an infinite effect does not emit forever in a preview nobody is watching. A
	 * continuous binding is the one case where forever is the point — capping it would show the author
	 * the exact stutter they set the flag to remove. An authored `duration` still bounds it, because
	 * that is a decision rather than a guess.
	 */
	continuous?: boolean;
}

/**
 * The per-binding overrides a rig keyframe's CLIP binding can carry, as the overlay consumes them.
 * Structurally the burst half of `engine-layout`'s `RigFlipbookOverrides`; the PLAYBACK half
 * (`fps`/`loop`/`direction`/`flipX`/`flipY`) is not here for the same reason it is not a prop on
 * `<RiggedFlipbook>` — the caller folds it into the clip object it passes, so the direction walk and
 * the frame rate have exactly one answer. `slot` is absent BY DESIGN, as for FX: this overlay is a
 * separate canvas layered over a raw-WebGL rig canvas, so it draws above or below the whole rig but
 * never between two of its slots.
 */
export interface FlipbookPlayOptions {
	/** Opacity multiplier, 0–1. */
	alpha?: number;
	/** Size multiplier on the whole clip. */
	scale?: number;
	/** Milliseconds to wait before it starts. */
	delay?: number;
	/** Milliseconds on screen, then taken down. Overrides the preview's own hold cap. */
	duration?: number;
	/** This clip is meant to run continuously, so do NOT apply the preview hold cap. */
	continuous?: boolean;
}

/** The imperative surface each host drives (the Rigger assigns an instance to `window.RiggerFx`). */
export interface FxOverlayApi {
	/** Create the transparent overlay `Application` inside `hostEl` + start its ticker. Idempotent. */
	init(hostEl: HTMLElement): Promise<void>;
	/** Re-fit the renderer to the host (call on host resize). */
	resize(): void;
	/** Play an effect by id, riding the bone's on-screen transform `t`, with the keyframe's authored
	 * overrides applied. Returns a handle. */
	play(effectId: string, t: FxTransform, opts?: FxPlayOptions): number;
	/**
	 * Play an Invisible Flipbook CLIP by value, riding the bone's on-screen transform `t`.
	 *
	 * The clip is passed WHOLE rather than by id (unlike `play`, which fetches an `EffectDoc`):
	 * every host already holds the project's clip list — it is what the author picked from — and the
	 * binding's playback overrides have to be folded into it before the texture array is built
	 * anyway, so there is no id whose lookup would not immediately be re-folded.
	 *
	 * Returns a handle in the SAME space as `play`, so `follow`/`stop`/`clear` need no clip variant.
	 */
	playFlipbook(clip: OverlayClip, t: FxTransform, opts?: FlipbookPlayOptions): number;
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
	/** Rides the bone — `follow()` overwrites its whole matrix every frame, so nothing else may
	 * live on it. */
	container: Container;
	/** Child of `container`, where `scale` (and the layer offsets) actually live, precisely BECAUSE
	 * the parent's matrix is rewritten per frame. Mirrors `<RiggedEffect>`'s `fxLocal`, which nests
	 * for the same reason — there, spine rewrites the parent instead. */
	inner: Container;
	emitters: Emitter[];
	/** Live flipbook sprites (a clip play builds one; an effect play builds none). Advanced from the
	 * overlay's own ticker rather than `autoUpdate`, so a clip and a burst are clocked by the SAME
	 * tick — two clocks is how a preview drifts from what it previews. */
	sprites: AnimatedSprite[];
	/** Time-scale multiplier for this effect's emitters (the binding's `speed`). */
	speed: number;
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

/** Playback default when a clip omits `fps`. Mirrors `engine-flipbook`'s `DEFAULT_FLIPBOOK_FPS` and
 * `<Flipbook>`'s own literal — restated here rather than imported for the same reason both of those
 * are: one number, and this module's import list is load-bearing (it is vendored into a bundle with
 * no module system). */
const DEFAULT_FLIPBOOK_FPS = 24;

/**
 * The Pixi matrix that places a burst on its bone — the host's projected basis with any REFLECTION
 * removed, keeping only rotation and per-axis size.
 *
 * A host derives `(a,b)`/`(c,d)` by pushing the bone's world axes through its own stage projection,
 * and every stage we have flips y (a y-up skeleton drawn into a y-down canvas; the Symbols grid
 * mirrors x too). Handing that basis to a container verbatim draws the burst mirrored about the
 * bone — invisible on a near-symmetric particle burst, glaring on a flipbook clip, which has an up
 * and a down.
 *
 * The game is the arbiter and it does NOT mirror: `<SpineBoneAttach followRotation followScale>`
 * takes `rotation = -bone.getWorldRotationX()` and sizes by `Math.hypot` MAGNITUDES, precisely so a
 * negative axis (a y-flip, a mirrored skin) sizes the attachment instead of flipping it. Same rule
 * here, so a preview and the shipped frame cannot disagree on which way up a clip plays.
 *
 * `atan2(b, a)` survives the flip untouched: a bone at spine rotation θ projects to `(z·cosθ,
 * −z·sinθ)`, so the angle reads back as `−θ` — the number `<SpineBoneAttach>` assigns directly.
 */
function fxMatrix(t: FxTransform): Matrix {
	const rotation = Math.atan2(t.b, t.a);
	const scaleX = Math.hypot(t.a, t.b);
	const scaleY = Math.hypot(t.c, t.d);
	const cos = Math.cos(rotation);
	const sin = Math.sin(rotation);
	return new Matrix(cos * scaleX, sin * scaleX, -sin * scaleY, cos * scaleY, t.x, t.y);
}

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

	/** Advance every active emitter AND flipbook sprite one tick, isolating a degenerate config so one
	 * bad emitter can't throw out of the ticker and freeze the whole overlay.
	 *
	 * Takes the ticker, not a scalar, because the two need different clocks off the same beat: an
	 * emitter wants the engine's own `emitterDeltaSeconds` scaling (so the preview runs at game speed
	 * — see `engine-fx`), while an `AnimatedSprite` wants PIXI's `deltaTime`, which is what its own
	 * `animationSpeed` (`fps / 60`) is expressed against. */
	function tick(ticker: Ticker): void {
		const emitterSeconds = emitterDeltaSeconds(ticker.deltaMS);
		for (const effect of effects.values()) {
			const scaled = emitterSeconds * effect.speed;
			for (const emitter of effect.emitters) {
				try {
					emitter.update(scaled);
				} catch (err) {
					console.warn('FxOverlay: emitter.update threw; stopping that emitter', err);
					emitter.emit = false;
				}
			}
			for (const sprite of effect.sprites) {
				try {
					sprite.update(ticker);
				} catch (err) {
					console.warn('FxOverlay: flipbook update threw; stopping that clip', err);
					sprite.stop();
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
			// Advance the emitters by the SAME scalar the in-game runtime uses (`ParticleEmitter.svelte`),
			// so this Rigger/Symbols overlay plays FX at the real game speed — not the old 1× real-seconds
			// (`deltaMS / 1000`) that made the preview ~2.34× slower than the game. See `engine-fx`
			// `emitterDeltaSeconds` / `DEFAULT_EMIT_SPEED`. (That scaling now happens inside `tick`,
			// which also clocks the flipbook sprites off the same ticker.)
			app.ticker.add(tick);
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
		holdMs: number | null,
	): Promise<void> {
		const textures = await framesToTextures(layer, resolveArt, sourceCache);
		if (effect.disposed || textures.length === 0) return;
		// Weighted mix only when the resolved textures line up 1:1 with `frames` (a skipped region
		// would misalign the weights → fall back to uniform), matching the Scene-Editor overlay.
		const weights = textures.length === layer.art.frames.length ? layer.art.weights : undefined;
		// bindArt deep-clones the (texture-free) config, then attaches the live textures — the result
		// must NOT be JSON-cloned again (that would destroy the Texture objects).
		const config = bindArt(layer.config, textures, layer.art.animated ?? false, weights, {
			framerate: layer.art.framerate,
			loop: layer.art.loop,
		});
		// Honor the layer's placement OFFSET (authored in /fx). The game applies it via the layer's own
		// offset `<Container>` / `<SpineBoneAttach offset>`; mirror that with a per-layer offset
		// container nested in the zoom-scaled effect container, so the offset tracks stage scale.
		const layerContainer = new Container();
		layerContainer.position.set(plan.offset?.x ?? 0, plan.offset?.y ?? 0);
		effect.inner.addChild(layerContainer);
		const emitter = new Emitter(layerContainer, config);
		// Force-emit ALL layers from mount, ignoring layer.trigger — the keyframe IS the trigger, and
		// `emitterLifetime` bounds the burst (the same `forceEmit` contract the rig-bound runtime uses).
		emitter.emit = true;
		// Bounded burst: stop emitting after `holdMs` so an INFINITE-lifetime effect doesn't run
		// forever. A finite emitter has already self-stopped by then (this is a no-op). `holdMs` is
		// the binding's authored `duration` when it has one, and only otherwise the preview's own
		// PREVIEW_HOLD_MS guess — an authored duration is a decision, not a fallback, and the game
		// honours the same number.
		if (holdMs !== null) {
			effect.timers.push(
				setTimeout(() => {
					try {
						emitter.emit = false;
					} catch {
						/* emitter already torn down */
					}
				}, holdMs),
			);
		}
		effect.emitters.push(emitter);
	}

	/** Play an effect. Returns a numeric handle synchronously; textures resolve asynchronously and the
	 * emitters activate when they land (a ready-guard against the effect being stopped meanwhile). */
	function play(effectId: string, t: FxTransform, opts?: FxPlayOptions): number {
		const handle = nextHandle++;
		// If init hasn't resolved yet, the container is added lazily once `world` exists (below).
		const container = new Container();
		container.setFromMatrix(fxMatrix(t));
		// Opacity rides the OUTER container (a plain multiplier `follow()` never touches) while size
		// rides the inner one (the outer's matrix is rewritten every frame from the bone).
		container.alpha = opts?.alpha ?? 1;
		const inner = new Container();
		inner.scale.set(opts?.scale ?? 1);
		container.addChild(inner);
		const effect: LiveEffect = {
			container,
			inner,
			emitters: [],
			sprites: [],
			timers: [],
			disposed: false,
			speed: opts?.speed ?? 1,
		};
		effects.set(handle, effect);
		// `null` = never force-stop (a continuous burst with no authored duration).
		const holdMs = opts?.duration ?? (opts?.continuous ? null : PREVIEW_HOLD_MS);
		const delay = opts?.delay ?? 0;

		void (async () => {
			await (initPromise ?? Promise.resolve());
			if (effect.disposed || !world) return;
			world.addChild(container);
			const doc = await loadEffectDoc(effectId);
			if (effect.disposed || !doc) return;
			const build = async (): Promise<void> => {
				for (const layer of doc.layers) {
					const plan = planLayer(layer);
					// Skip non-rendering layers + Tier-C spine-particle layers (no pooled Spine host here).
					if (!plan.render || plan.particleKind === 'spine') continue;
					await buildLayer(effect, layer, plan, holdMs);
					if (effect.disposed) return;
				}
			};
			// `delay` holds the BUILD, not just the emit flag, so the burst starts at t=0 of the effect
			// when it does appear — matching `<RiggedEffect>`, which defers its mount for the same reason.
			// The handle already exists, so `follow()`/`stop()` work normally during the wait. Scheduled
			// rather than awaited: `disposeEffect` clears the timer, and an awaited one would leave a
			// promise that never settles, pinning the doc and the effect for the life of the page.
			if (delay > 0) {
				effect.timers.push(
					setTimeout(() => {
						if (!effect.disposed) void build();
					}, delay),
				);
				return;
			}
			await build();
		})();

		return handle;
	}

	/**
	 * Play an Invisible Flipbook clip. Returns a numeric handle synchronously (the same space `play`
	 * uses, so `follow`/`stop`/`clear` are shared); textures resolve asynchronously and the sprite
	 * appears when they land, guarded against the play having been stopped meanwhile.
	 *
	 * The clip arrives with its binding's PLAYBACK overrides already folded in, so `fps`, `loop`,
	 * `direction` and the mirroring read straight off it — exactly as `<Flipbook>` reads them in the
	 * game.
	 */
	function playFlipbook(clip: OverlayClip, t: FxTransform, opts?: FlipbookPlayOptions): number {
		const handle = nextHandle++;
		const container = new Container();
		container.setFromMatrix(fxMatrix(t));
		// Same split as `play`: opacity on the OUTER container (a plain multiplier `follow()` never
		// touches), size on the inner one, because the outer's matrix is rewritten every frame.
		container.alpha = opts?.alpha ?? 1;
		const inner = new Container();
		inner.scale.set(opts?.scale ?? 1);
		container.addChild(inner);
		const effect: LiveEffect = {
			container,
			inner,
			emitters: [],
			sprites: [],
			timers: [],
			disposed: false,
			speed: 1,
		};
		effects.set(handle, effect);

		// The hold cap is NOT the FX rule. There it bounds an infinite emitter; here the only clip that
		// would run forever is a LOOPING one, and a one-shot clip longer than the cap would be cut in
		// half by it — the preview then shows an animation ending where it does not. So: an authored
		// duration always wins, a continuous binding is never capped, a non-looping clip ends itself,
		// and only a looping clip gets the guess.
		const loops = clip.loop ?? true;
		const holdMs = opts?.duration ?? (opts?.continuous || !loops ? null : PREVIEW_HOLD_MS);
		const delay = opts?.delay ?? 0;

		void (async () => {
			await (initPromise ?? Promise.resolve());
			if (effect.disposed || !world) return;
			world.addChild(container);
			const build = async (): Promise<void> => {
				const textures = await clipToTextures(clip, resolveArt, sourceCache);
				if (effect.disposed || textures.length === 0) return;
				const sprite = new AnimatedSprite({ textures, autoUpdate: false });
				sprite.anchor.set(0.5);
				// `fps / 60`: PIXI advances `currentFrame` by `animationSpeed` per 60Hz-normalized tick.
				// The same formula `<Flipbook>` uses, with the same 24 default, so the preview and the
				// game run the clip at one rate.
				sprite.animationSpeed = (clip.fps && clip.fps > 0 ? clip.fps : DEFAULT_FLIPBOOK_FPS) / 60;
				sprite.loop = loops;
				// Mirroring is a render transform on the sprite's own anchor — `AnimatedSprite.svelte`
				// applies it exactly this way, so a mirrored clip previews as it will draw.
				sprite.scale.set(clip.flipX ? -1 : 1, clip.flipY ? -1 : 1);
				sprite.play();
				effect.inner.addChild(sprite);
				effect.sprites.push(sprite);
				if (holdMs !== null) {
					effect.timers.push(setTimeout(() => stop(handle), holdMs));
				}
			};
			// `delay` holds the BUILD, not a play flag, so the clip starts at frame 0 when it appears —
			// matching `<RiggedFlipbook>`, which defers its mount for the same reason.
			if (delay > 0) {
				effect.timers.push(
					setTimeout(() => {
						if (!effect.disposed) void build();
					}, delay),
				);
				return;
			}
			await build();
		})();

		return handle;
	}

	/** Update an effect's container transform so it rides the bone (position + rotation + scale). */
	function follow(handle: number, t: FxTransform): void {
		const effect = effects.get(handle);
		if (!effect) return;
		effect.container.setFromMatrix(fxMatrix(t));
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
		// Stop before the container destroy takes them: a running `AnimatedSprite` whose textures are
		// destroyed under it keeps ticking against freed sources.
		for (const sprite of effect.sprites) {
			try {
				sprite.stop();
			} catch {
				/* already torn down */
			}
		}
		effect.sprites = [];
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

	return { init, resize, play, playFlipbook, follow, stop, clear, destroy };
}
