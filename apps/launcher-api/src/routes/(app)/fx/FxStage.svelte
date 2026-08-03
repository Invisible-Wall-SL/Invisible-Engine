<script lang="ts">
	/**
	 * Invisible FX — the WebGL preview stage. Mounts its OWN `PIXI.Application` (the
	 * launcher already deps `pixi.js@8.8.1`) and drives a live `@barvynkoa/particle-emitter`
	 * `Emitter` straight from the in-memory `EffectDoc`'s layers — the SAME runtime contract
	 * `packages/pixi-svelte/.../ParticleEmitter.svelte` reduces to: bind the layer's art
	 * textures into its V3 config (`bindArt`) → `new Emitter(container, config)` →
	 * `emitter.update(dtSeconds)`.
	 *
	 * NB — the art seam: a V3 config carries its texture art as a `textureRandom` /
	 * `animatedSingle` BEHAVIOR. The library's `upgradeConfig(config, art)` is a NO-OP for a
	 * V3 config (its `art` arg only feeds the legacy V1/V2 upgrade), so we inject the resolved
	 * textures via `bindArt` instead — otherwise the emitter spawns invisible, textureless
	 * particles (compiles + runs, renders nothing). `bindArt` clones the texture-free config,
	 * THEN attaches the live `Texture` objects, so its result must NOT be JSON-cloned again.
	 *
	 * This is the `/spine`-stage fork the design doc calls for, done Svelte-natively (like
	 * Flow) instead of a static `view.html`, because the particle library is an npm dep:
	 * a render loop + pan/zoom (drag + wheel) + play/pause, with the chosen atlas page drawn
	 * as a faint placement reference behind the particles.
	 *
	 * Source of truth = the doc. On any `layers` change the stage rebuilds every emitter
	 * (`emitter.init` re-inits cleanly), so the preview always reflects the doc verbatim.
	 */
	import { Emitter } from '@barvynkoa/particle-emitter';
	import type * as SPINE from '@esotericsoftware/spine-pixi-v8';
	import { bindArt, behaviorsOf, emitterDeltaSeconds, type EmitterLayer } from 'engine-fx';
	import {
		createPixiSpineBackingFactory,
		registerSpineParticleBehavior,
		SpineParticleBehavior,
		SPINE_PARTICLE_BEHAVIOR_TYPE,
		type LayerHostLike,
		type SpineParticleBehaviorConfig,
	} from 'pixi-svelte';
	import { Application, Container, Sprite, Texture, type TextureSource } from 'pixi.js';
	import { framesToTextures, loadPageSource } from '$lib/fx/effectEmitter.client';
	import { onMount } from 'svelte';
	import {
		emitterOwnerLocal,
		layerFollowsBone,
		spineParticleReady,
		worldToContainerLocal,
		type Affine,
	} from './fxModel.client';
	import {
		applyFxSkin,
		loadFxSpine,
		playFxAnimation,
		type FxSkeletonEntry,
		type LoadedFxSpine,
	} from './fxSpine.client';

	interface Props {
		/** The effect's layers — the live emitters mirror these verbatim. */
		layers: EmitterLayer[];
		/** Whether the emitters are running (play/pause). Also drives the backdrop skeleton. */
		playing: boolean;
		/**
		 * Resolve an `art.assetKey` (an atlas manifest key) to its page URL + per-frame
		 * rects, so the stage can slice per-frame textures. Supplied by the page (which owns
		 * the `/api/editor/regions` + `/api/editor/asset` fetches); the stage stays I/O-free
		 * beyond the page-image `Assets.load`.
		 */
		resolveArt: (assetKey: string) => Promise<ResolvedArt | null>;
		/**
		 * Resolve a `spineParticle.skeletonKey` (the project skeleton-entry key) to a loaded
		 * skeleton, so a `particleKind:'spine'` layer (Tier C) can pool `Spine` instances each
		 * playing a clip — the SAME `SkeletonData`/factory the runtime `<EffectLayer>` uses. Supplied
		 * + cached by the page (which owns the `/spine/skeletons` list); the stage stays I/O-free
		 * beyond the per-skeleton `loadFxSpine`. Returns `null` for an unknown/unloadable key — the
		 * layer then shows placeholder dots, never crashing.
		 */
		resolveSkeleton?: (skeletonKey: string) => Promise<LoadedFxSpine | null>;
		/**
		 * The Spine skeleton to load as the Tier-B authoring backdrop, or `null` for none.
		 * When set, the stage loads it (once), plays `spineAnimation`, applies `spineSkin`,
		 * and — for any `bone`-placed layer — rides the emitter on the live bone transform.
		 */
		spineEntry?: FxSkeletonEntry | null;
		/** The animation clip to play on the backdrop skeleton (looping). */
		spineAnimation?: string;
		/** The skin to apply on the backdrop skeleton (best-effort). */
		spineSkin?: string;
		/** Surface the loaded skeleton's animation / skin / bone lists back to the page (for
		 * the inspector dropdowns). Called once per successful load (or with empty lists on
		 * unload / failure). */
		onSpineMeta?: (meta: { animations: string[]; skins: string[]; bones: string[] }) => void;
	}

	export interface ResolvedArt {
		pageUrl: string;
		pageWidth: number;
		pageHeight: number;
		regions: { name: string; x: number; y: number; w: number; h: number; rotated?: boolean }[];
	}

	let {
		layers,
		playing,
		resolveArt,
		resolveSkeleton,
		spineEntry = null,
		spineAnimation = '',
		spineSkin = '',
		onSpineMeta,
	}: Props = $props();

	let host: HTMLDivElement | null = $state(null);
	let app: Application | null = null;
	/** Flips true once the `Application` has initialised — drives the spine/rebuild effects
	 * to run after async mount (the props can be set before the canvas exists). */
	let ready = $state(false);
	/** The pan/zoom world the emitters + reference sprite + backdrop skeleton live in. */
	let world: Container | null = null;
	/** The faint atlas reference sprite (last-resolved art's page), behind particles. */
	let reference: Sprite | null = null;
	/** The loaded Tier-B backdrop skeleton (or null). The live `Spine` lives in `world`. */
	let loadedSpine: LoadedFxSpine | null = null;
	/** The skeleton-entry key currently loaded — so we only reload when it actually changes. */
	let loadedSpineKey: string | null = null;
	/** Generation token for spine loads (a fast backdrop switch can't mount two skeletons). */
	let spineGen = 0;
	/** Reused point for the per-frame bone-follow (avoid per-frame allocation). */
	const bonePoint = { x: 0, y: 0 };
	const DEG_TO_RAD = Math.PI / 180;
	/** Per-key live emitter + the container it draws into + whether it has bound art (a sprite
	 * layer with textures OR a spine-particle layer with a bound pool — either spawns visibly). */
	const live = new Map<string, { emitter: Emitter; container: Container; hasArt: boolean }>();
	/** Cache of resolved page TextureSources by URL (avoid re-loading the same page). */
	const sourceCache = new Map<string, TextureSource>();

	let view = $state({ x: 0, y: 0, scale: 1 });
	/** Generation token so a fast edit can't interleave two async rebuilds. */
	let rebuildGen = 0;
	let rebuilding = false;
	let rebuildPending = false;

	// Tier C: the pooled-`Spine`-particle behavior must be registered with the library before any
	// `Emitter` whose config carries a `spineParticle` entry inits. Idempotent — safe to call here.
	registerSpineParticleBehavior();

	/**
	 * Dispose an emitter's Tier-C `Spine` pool (the pooled skeletons the emitter's own `destroy`
	 * never sees), THEN tear down the emitter — mirroring `<ParticleEmitter>`'s `onDestroy`. A
	 * sprite emitter has no such behavior, so this is a no-op for Tiers A/B (parity).
	 */
	function disposeEmitter(emitter: Emitter): void {
		emitter.emit = false;
		const behavior = emitter.getBehavior(SPINE_PARTICLE_BEHAVIOR_TYPE);
		if (behavior instanceof SpineParticleBehavior) behavior.dispose();
		emitter.destroy();
	}

	onMount(() => {
		let disposed = false;
		const created = new Application();
		(async () => {
			await created.init({ background: '#0b0e13', antialias: true, resizeTo: host ?? undefined });
			if (disposed) {
				created.destroy(true);
				return;
			}
			app = created;
			host?.appendChild(app.canvas);
			world = new Container();
			app.stage.addChild(world);
			centerWorld();
			ready = true;
			app.ticker.add((ticker) => {
				if (!playing) return;
				// The backdrop SKELETON advances in real seconds (a spine clip is wall-clock) …
				const dtSeconds = ticker.deltaMS / 1000;
				// … but the EMITTERS must advance by the SAME scalar the in-game runtime uses
				// (`ParticleEmitter.svelte`), or the preview plays FX at a different speed than the
				// game — the ~2.34× drift that made authored delays never match (see
				// `engine-fx` `emitterDeltaSeconds` / `DEFAULT_EMIT_SPEED`).
				const dtEmitter = emitterDeltaSeconds(ticker.deltaMS);
				// Advance the backdrop skeleton (autoUpdate is off so we gate it on play/pause).
				loadedSpine?.spine.update(dtSeconds);
				// Ride bone-placed emitters on the live bone transform, THEN advance them — so a
				// flame stays welded to the moving torch tip rather than lagging a frame.
				followBones();
				for (const { emitter } of live.values()) {
					try {
						emitter.update(dtEmitter);
					} catch (err) {
						// A degenerate config (e.g. a 0-lifetime particle → Infinity interpolation) can
						// make the library throw mid-update. Isolate it so one bad emitter doesn't throw
						// out of the ticker callback and FREEZE the whole preview — stop just that emitter.
						console.warn('FxStage: emitter.update threw; stopping that emitter', err);
						emitter.emit = false;
					}
				}
			});
			await requestRebuild();
		})();

		return () => {
			disposed = true;
			for (const { emitter } of live.values()) disposeEmitter(emitter);
			live.clear();
			loadedSpine?.spine.destroy();
			loadedSpine = null;
			placeholder?.destroy(true);
			placeholder = null;
			app?.destroy(true);
			app = null;
		};
	});

	/**
	 * Replicate `<SpineBone>` IMPERATIVELY: for each `bone`-placed layer, resolve the
	 * followed bone's live world position and weld the emitter's spawn (owner) position to it
	 * + the authored offset, every frame, accounting for the stage pan/zoom.
	 *
	 * The coordinate hop (the load-bearing bit `SpineBone` hides): the bone position is in
	 * SKELETON space; `spine.getBonePosition` + `spine.skeletonToPixiWorldCoordinates` lift it
	 * to Pixi WORLD coords; the emitter's `updateOwnerPos` is in its CONTAINER's local space
	 * (which carries the pan/zoom `world` transform). Inverting the emitter container's world
	 * matrix bridges the two (`emitterOwnerLocal`/`worldToContainerLocal`, harness-covered), so
	 * the FX rides the bone at any pan/zoom. A `free` layer keeps spawning at its container
	 * origin + offset.
	 */
	function followBones(): void {
		const spine = loadedSpine?.spine;
		const wt = world?.worldTransform;
		const worldAffine: Affine = wt
			? { a: wt.a, b: wt.b, c: wt.c, d: wt.d, tx: wt.tx, ty: wt.ty }
			: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
		for (const layer of layers) {
			const entry = live.get(layer.key);
			if (!entry) continue;
			const offset = layer.placement.offset ?? { x: 0, y: 0 };

			let bone: SPINE.Bone | null = null;
			let boneWorld: { x: number; y: number } | null = null;
			if (spine && layerFollowsBone(layer)) {
				const pos = spine.getBonePosition(layer.placement.bone!, bonePoint);
				if (pos) {
					// Mutates `pos` (== bonePoint) from skeleton space into Pixi WORLD coords.
					spine.skeletonToPixiWorldCoordinates(pos);
					boneWorld = { x: pos.x, y: pos.y };
					bone = spine.skeleton.findBone(layer.placement.bone!);
				}
			}

			if (boneWorld) {
				// Fully RIDE the bone (position + rotation + scale), matching the runtime
				// `<SpineBoneAttach followRotation followScale>`: place the emitter CONTAINER on the
				// bone (world → the pan/zoom `world`'s local frame), orient + scale it by the bone's
				// world transform, and spawn from the container origin — so EXISTING particles ride
				// the bone too, not just new spawns. Offset is applied in world coords then mapped
				// (parity with the runtime). The backdrop spine is unscaled/unrotated under `world`,
				// so the bone's world rotation/scale map straight onto the container; skeleton space
				// is CCW / y-up vs Pixi y-down, so rotation is negated (same inversion `<SpineBone>`).
				const p = worldToContainerLocal(worldAffine, {
					x: boneWorld.x + offset.x,
					y: boneWorld.y + offset.y,
				});
				entry.container.position.set(p.x, p.y);
				if (bone) {
					entry.container.rotation = -bone.getWorldRotationX() * DEG_TO_RAD;
					entry.container.scale.set(bone.getWorldScaleX(), bone.getWorldScaleY());
				}
				entry.emitter.updateOwnerPos(0, 0);
			} else {
				// Free layer (or an unresolved bone): identity container, spawn at the authored offset
				// in container-local (the container origin already IS the scene centre).
				entry.container.position.set(0, 0);
				entry.container.rotation = 0;
				entry.container.scale.set(1, 1);
				const owner = emitterOwnerLocal(layer, null, worldAffine);
				entry.emitter.updateOwnerPos(owner.x, owner.y);
			}
		}
	}

	/**
	 * Load (or unload) the backdrop skeleton when the picked entry changes. Generation-guarded
	 * so a fast switch can't leave two skeletons mounted; surfaces the loaded skeleton's
	 * animation / skin / bone lists to the page for the inspector dropdowns.
	 */
	async function syncSpine(): Promise<void> {
		if (!app || !world) return;
		const key = spineEntry ? `${spineEntry.dir_b64}/${spineEntry.skeleton_file}` : null;
		if (key === loadedSpineKey) return; // already loaded (or already none)
		const gen = ++spineGen;

		// Tear down any prior backdrop.
		loadedSpine?.spine.destroy();
		loadedSpine = null;
		loadedSpineKey = key;

		if (!spineEntry) {
			onSpineMeta?.({ animations: [], skins: [], bones: [] });
			return;
		}
		try {
			const loaded = await loadFxSpine(spineEntry);
			if (gen !== spineGen || !world) {
				loaded.spine.destroy();
				return;
			}
			loadedSpine = loaded;
			// Draw the skeleton behind the particles but in front of the faint atlas reference.
			world.addChildAt(loaded.spine, reference ? 1 : 0);
			playFxAnimation(loaded.spine, spineAnimation);
			applyFxSkin(loaded.spine, spineSkin);
			loaded.spine.update(0);
			onSpineMeta?.({
				animations: loaded.animations,
				skins: loaded.skins,
				bones: loaded.bones,
			});
		} catch {
			if (gen === spineGen) onSpineMeta?.({ animations: [], skins: [], bones: [] });
		}
	}

	function centerWorld(): void {
		if (!app || !world) return;
		view = { x: app.screen.width / 2, y: app.screen.height / 2, scale: 1 };
		applyView();
	}

	function applyView(): void {
		if (!world) return;
		world.position.set(view.x, view.y);
		world.scale.set(view.scale);
	}

	/** A soft white dot used as a STAND-IN particle while a layer has no art bound yet, so the
	 * emitter is visible (its shape, rate, motion are tunable) during authoring — preview-only,
	 * never saved into the EffectDoc and never used by the runtime `<EffectPlayer>`. */
	let placeholder: Texture | null = null;
	function placeholderTexture(): Texture {
		if (placeholder) return placeholder;
		const size = 32;
		const cv = document.createElement('canvas');
		cv.width = cv.height = size;
		const ctx = cv.getContext('2d');
		if (ctx) {
			const r = size / 2;
			const g = ctx.createRadialGradient(r, r, 0, r, r, r);
			g.addColorStop(0, 'rgba(255,255,255,1)');
			g.addColorStop(0.4, 'rgba(255,255,255,0.85)');
			g.addColorStop(1, 'rgba(255,255,255,0)');
			ctx.fillStyle = g;
			ctx.fillRect(0, 0, size, size);
		}
		placeholder = Texture.from(cv);
		return placeholder;
	}

	// `loadPageSource` + `framesToTextures` (atlas-page load + per-frame slice) now live in the shared
	// `$lib/fx/effectEmitter.client` so the Scene Editor's live overlay resolves art identically.

	/**
	 * (Re)build every live emitter from the current `layers`. Guarded by a generation token:
	 * a rebuild requested while one is in flight is coalesced (runs once more after), and a
	 * resolved `await` whose generation is stale bails — so two fast inspector edits can't
	 * interleave into duplicate/torn emitters.
	 */
	async function requestRebuild(): Promise<void> {
		if (rebuilding) {
			rebuildPending = true;
			return;
		}
		rebuilding = true;
		try {
			do {
				rebuildPending = false;
				await rebuild();
			} while (rebuildPending);
		} finally {
			rebuilding = false;
		}
	}

	async function rebuild(): Promise<void> {
		if (!app || !world) return;
		const gen = ++rebuildGen;

		// Tear down emitters whose layer no longer exists.
		const keys = new Set(layers.map((l) => l.key));
		for (const [key, entry] of live) {
			if (!keys.has(key)) {
				disposeEmitter(entry.emitter);
				entry.container.destroy();
				live.delete(key);
			}
		}

		// Resolve the reference backdrop from the FIRST layer that has art bound.
		await updateReference();

		for (const layer of layers) {
			// Tier C: a `particleKind:'spine'` layer pools `Spine` instances each playing a clip —
			// the SAME mechanism `<EffectLayer>` mounts (`bindSpineParticle` → the pooled behavior),
			// reproduced here imperatively against the stage's own emitter. A half-authored spine
			// layer (no skeleton/clip, or an unloadable one) falls through to the placeholder-dot
			// sprite path so the preview never crashes or silently vanishes.
			if (layer.particleKind === 'spine') {
				await buildSpineLayer(layer, gen);
				if (gen !== rebuildGen) return;
				continue;
			}

			const real = await framesToTextures(layer, resolveArt, sourceCache);
			if (gen !== rebuildGen) return; // a newer rebuild superseded us
			// Preview aid: with no art bound, spawn soft placeholder DOTS so the emitter is
			// visible while authoring (the saved doc keeps NO art; the runtime stays empty for
			// an unbound layer). Once a region is picked, the real textures take over.
			const usePlaceholder = real.length === 0;
			const textures = usePlaceholder ? [placeholderTexture()] : real;
			// Weighted mix (a static multi-frame layer's per-frame %) — only when the resolved
			// textures line up 1:1 with `frames` (a skipped region would misalign the weights, so
			// fall back to uniform). Ignored for the placeholder + flipbook paths.
			const weights =
				usePlaceholder || real.length !== layer.art.frames.length ? undefined : layer.art.weights;
			// bindArt deep-clones the (texture-free) config itself, then attaches the live
			// textures — so the emitter never sees the $state proxy and the result is NOT
			// re-cloned (JSON-cloning would destroy the Texture objects).
			const config = bindArt(
				layer.config,
				textures,
				usePlaceholder ? false : (layer.art.animated ?? false),
				weights,
			);
			let entry = live.get(layer.key);
			if (!entry) {
				const container = new Container();
				world.addChild(container);
				entry = { emitter: new Emitter(container, config), container, hasArt: true };
				live.set(layer.key, entry);
			} else {
				// A sprite layer that USED to be a spine layer carries a pool — dispose it before
				// re-init so its skeletons don't leak. `disposeEmitter` no-ops for a sprite emitter.
				disposeEmitterPool(entry.emitter);
				entry.emitter.init(config);
				entry.hasArt = true;
			}
			entry.emitter.emit = playing;
		}
	}

	/**
	 * Build (or rebuild) a Tier-C spine-particle layer's live emitter. Each particle is a pooled
	 * `Spine` playing the layer's clip; the pool is built from the loaded `SkeletonData`
	 * (`createPixiSpineBackingFactory`) the page resolves via `resolveSkeleton`. A spine emitter is
	 * ALWAYS recreated (not re-`init`ed) on rebuild: a fresh pool must replace any prior one cleanly,
	 * and disposing the old emitter frees the old pool's skeletons — re-init would otherwise strand
	 * them parented in the world. An unloadable/half-authored layer renders placeholder dots.
	 */
	async function buildSpineLayer(layer: EmitterLayer, gen: number): Promise<void> {
		if (!world) return;
		const loaded =
			spineParticleReady(layer) && resolveSkeleton
				? await resolveSkeleton(layer.spineParticle!.skeletonKey)
				: null;
		if (gen !== rebuildGen) return;

		// Recreate the emitter from scratch so the pool is rebuilt cleanly (dispose any prior one).
		let container = live.get(layer.key)?.container ?? null;
		const prior = live.get(layer.key);
		if (prior) {
			disposeEmitter(prior.emitter);
			live.delete(layer.key);
		}
		if (!container) {
			container = new Container();
			world.addChild(container);
		}

		if (!loaded) {
			// Half-authored / unloadable: show placeholder dots so the emitter (shape/rate) is still
			// tunable, exactly like an art-less sprite layer.
			const config = bindArt(layer.config, [placeholderTexture()], false);
			const emitter = new Emitter(container, config);
			emitter.emit = playing;
			live.set(layer.key, { emitter, container, hasArt: false });
			return;
		}

		const spineParticle: SpineParticleBehaviorConfig = {
			animation: layer.spineParticle!.animation,
			loop: layer.spineParticle!.loop ?? false,
			prewarm: layer.config.maxParticles ?? 0,
			layerHost: container as unknown as LayerHostLike,
			createBacking: createPixiSpineBackingFactory(loaded.skeletonData),
		};
		const config = bindSpineParticleConfig(layer.config, spineParticle);
		const emitter = new Emitter(container, config);
		emitter.emit = playing;
		live.set(layer.key, { emitter, container, hasArt: true });
	}

	/**
	 * Inject the Tier-C `spineParticle` behavior into a V3 config, returning a NEW config — the
	 * EXACT shape `<ParticleEmitter>`'s `bindSpineParticle` builds (clone the textureless config,
	 * replace any prior `spineParticle` entry, attach the live factory + layer host AFTER cloning so
	 * the result is NOT re-JSON-cloned). Kept here (not pulled from the Svelte component) because
	 * the stage drives the emitter imperatively.
	 */
	function bindSpineParticleConfig(
		config: EmitterLayer['config'],
		spineParticle: SpineParticleBehaviorConfig,
	): EmitterLayer['config'] {
		const next = JSON.parse(JSON.stringify(config)) as EmitterLayer['config'];
		const behaviors = behaviorsOf(next).filter((b) => b.type !== SPINE_PARTICLE_BEHAVIOR_TYPE);
		behaviors.push({
			type: SPINE_PARTICLE_BEHAVIOR_TYPE,
			config: spineParticle as unknown as Record<string, unknown>,
		});
		(next as { behaviors: unknown[] }).behaviors = behaviors;
		return next;
	}

	/** Dispose only the Tier-C pool of an emitter (not the emitter), so a spine→sprite re-init
	 * doesn't strand the old skeletons. No-op for a sprite emitter. */
	function disposeEmitterPool(emitter: Emitter): void {
		const behavior = emitter.getBehavior(SPINE_PARTICLE_BEHAVIOR_TYPE);
		if (behavior instanceof SpineParticleBehavior) behavior.dispose();
	}

	async function updateReference(): Promise<void> {
		if (!world) return;
		const withArt = layers.find((l) => l.art.assetKey && l.art.frames.length > 0);
		if (!withArt) {
			reference?.destroy();
			reference = null;
			return;
		}
		const art = await resolveArt(withArt.art.assetKey);
		if (!art) return;
		let source: TextureSource;
		try {
			source = await loadPageSource(art.pageUrl, sourceCache);
		} catch (err) {
			console.warn('FxStage: reference page image load failed', art.pageUrl, err);
			return;
		}
		if (!reference) {
			reference = new Sprite();
			reference.alpha = 0.12;
			reference.anchor.set(0.5);
			world.addChildAt(reference, 0);
		}
		reference.texture = new Texture({ source });
	}

	// Rebuild whenever the doc's layers change — the doc is the source of truth.
	$effect(() => {
		// Touch the layers (deep) so this re-runs on any inspector edit.
		void JSON.stringify(layers);
		if (app) void requestRebuild();
	});

	// Honour play/pause without a full rebuild. Only art-bound emitters emit (an unbound
	// layer would otherwise spawn invisible particles).
	$effect(() => {
		for (const { emitter, hasArt } of live.values()) {
			emitter.emit = playing && hasArt;
		}
	});

	// Load / unload the Tier-B backdrop skeleton whenever the picked entry changes (the page
	// drives `spineEntry` from its backdrop picker). `syncSpine` is generation-guarded + keyed,
	// so a no-op change returns early and a fast switch can't mount two skeletons.
	$effect(() => {
		void (spineEntry ? `${spineEntry.dir_b64}/${spineEntry.skeleton_file}` : null);
		if (ready) void syncSpine();
	});

	// Re-play the chosen clip / re-apply the chosen skin on an ALREADY-loaded skeleton (a fresh
	// load applies them in `syncSpine`; these handle the picker changing afterwards).
	$effect(() => {
		const animation = spineAnimation;
		if (ready && loadedSpine) playFxAnimation(loadedSpine.spine, animation);
	});
	$effect(() => {
		const skin = spineSkin;
		if (ready && loadedSpine) applyFxSkin(loadedSpine.spine, skin);
	});

	// --- pan / zoom -----------------------------------------------------------
	let dragging = false;
	let lastX = 0;
	let lastY = 0;

	function onPointerDown(e: PointerEvent): void {
		dragging = true;
		lastX = e.clientX;
		lastY = e.clientY;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function onPointerMove(e: PointerEvent): void {
		if (!dragging) return;
		view = { ...view, x: view.x + (e.clientX - lastX), y: view.y + (e.clientY - lastY) };
		lastX = e.clientX;
		lastY = e.clientY;
		applyView();
	}
	function onPointerUp(e: PointerEvent): void {
		dragging = false;
		(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
	}
	function onWheel(e: WheelEvent): void {
		e.preventDefault();
		const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
		const next = Math.min(8, Math.max(0.1, view.scale * factor));
		view = { ...view, scale: next };
		applyView();
	}

	export function resetView(): void {
		centerWorld();
	}
</script>

<div
	class="stage"
	bind:this={host}
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onwheel={onWheel}
></div>

<style>
	.stage {
		width: 100%;
		height: 100%;
		touch-action: none;
		cursor: grab;
		overflow: hidden;
	}
	.stage:active {
		cursor: grabbing;
	}
</style>
