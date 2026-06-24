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
	import { bindArt, type EmitterLayer } from 'engine-fx';
	import {
		Application,
		Container,
		Rectangle,
		Sprite,
		Texture,
		Assets,
		type TextureSource,
	} from 'pixi.js';
	import { onMount } from 'svelte';
	import { emitterOwnerLocal, layerFollowsBone, type Affine } from './fxModel.client';
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
	/** Per-key live emitter + the container it draws into + whether it has bound art. */
	const live = new Map<string, { emitter: Emitter; container: Container; hasArt: boolean }>();
	/** Cache of resolved page TextureSources by URL (avoid re-loading the same page). */
	const sourceCache = new Map<string, TextureSource>();

	let view = $state({ x: 0, y: 0, scale: 1 });
	/** Generation token so a fast edit can't interleave two async rebuilds. */
	let rebuildGen = 0;
	let rebuilding = false;
	let rebuildPending = false;

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
				const dt = ticker.deltaMS / 1000;
				// Advance the backdrop skeleton (autoUpdate is off so we gate it on play/pause).
				loadedSpine?.spine.update(dt);
				// Ride bone-placed emitters on the live bone transform, THEN advance them — so a
				// flame stays welded to the moving torch tip rather than lagging a frame.
				followBones();
				for (const { emitter } of live.values()) emitter.update(dt);
			});
			await requestRebuild();
		})();

		return () => {
			disposed = true;
			for (const { emitter } of live.values()) {
				emitter.emit = false;
				emitter.destroy();
			}
			live.clear();
			loadedSpine?.spine.destroy();
			loadedSpine = null;
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
		for (const layer of layers) {
			const entry = live.get(layer.key);
			if (!entry) continue;
			let boneWorld: { x: number; y: number } | null = null;
			if (spine && layerFollowsBone(layer)) {
				const pos = spine.getBonePosition(layer.placement.bone!, bonePoint);
				if (pos) {
					// Mutates `pos` (== bonePoint) from skeleton space into Pixi WORLD coords.
					spine.skeletonToPixiWorldCoordinates(pos);
					boneWorld = { x: pos.x, y: pos.y };
				}
			}
			const cw = entry.container.worldTransform;
			const affine: Affine = { a: cw.a, b: cw.b, c: cw.c, d: cw.d, tx: cw.tx, ty: cw.ty };
			const owner = emitterOwnerLocal(layer, boneWorld, affine);
			entry.emitter.updateOwnerPos(owner.x, owner.y);
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

	/** Slice an atlas page into the per-frame textures named by a layer's `art.frames`. */
	async function framesToTextures(layer: EmitterLayer): Promise<Texture[]> {
		const { assetKey, frames } = layer.art;
		if (!assetKey || frames.length === 0) return [];
		const art = await resolveArt(assetKey);
		if (!art) return [];
		let source = sourceCache.get(art.pageUrl);
		if (!source) {
			const loaded = (await Assets.load(art.pageUrl)) as Texture;
			source = loaded.source;
			sourceCache.set(art.pageUrl, source);
		}
		const byName = new Map(art.regions.map((r) => [r.name, r]));
		const out: Texture[] = [];
		for (const name of frames) {
			const r = byName.get(name);
			if (!r) continue;
			out.push(new Texture({ source, frame: new Rectangle(r.x, r.y, r.w, r.h) }));
		}
		return out;
	}

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
				entry.emitter.emit = false;
				entry.emitter.destroy();
				entry.container.destroy();
				live.delete(key);
			}
		}

		// Resolve the reference backdrop from the FIRST layer that has art bound.
		await updateReference();

		for (const layer of layers) {
			const textures = await framesToTextures(layer);
			if (gen !== rebuildGen) return; // a newer rebuild superseded us
			// bindArt deep-clones the (texture-free) config itself, then attaches the live
			// textures — so the emitter never sees the $state proxy and the result is NOT
			// re-cloned (JSON-cloning would destroy the Texture objects).
			const config = bindArt(layer.config, textures, layer.art.animated ?? false);
			let entry = live.get(layer.key);
			if (!entry) {
				const container = new Container();
				world.addChild(container);
				entry = { emitter: new Emitter(container, config), container, hasArt: textures.length > 0 };
				live.set(layer.key, entry);
			} else {
				entry.emitter.init(config);
				entry.hasArt = textures.length > 0;
			}
			entry.emitter.emit = playing && entry.hasArt;
		}
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
		let source = sourceCache.get(art.pageUrl);
		if (!source) {
			const loaded = (await Assets.load(art.pageUrl)) as Texture;
			source = loaded.source;
			sourceCache.set(art.pageUrl, source);
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
