<script lang="ts">
	/**
	 * Scene Editor — the LIVE particle overlay. The 2D canvas can't run a WebGL particle emitter, so a
	 * placed `kind:'effect'` node otherwise shows only a static ✨ placeholder chip. This overlay mounts
	 * ONE `PIXI.Application` (transparent, `pointer-events:none`) over the 2D canvas and plays each
	 * placed effect's authored `EffectDoc` verbatim — mirroring `EditorSpineLayer` (the live spine
	 * overlay) but driving `@barvynkoa/particle-emitter` `Emitter`s (the SAME runtime contract the `/fx`
	 * tool's `FxStage` and the game's `<EffectPlayer>` reduce to: `bindArt` the layer's art textures →
	 * `new Emitter(container, config)` → `emitter.update(dtSeconds)`).
	 *
	 * Transform parity (the load-bearing seam): a placed effect lands EXACTLY where its 2D placeholder
	 * chip / selection box sits. Both are driven by the SAME `worldTransformOf` (== EditorCanvas's
	 * `nodeTransform`) result — a `ResolvedTransform` in canvas WORLD coords (pre pan/zoom). A nested
	 * effect (inside a container / component instance) composes its ancestor chain via the SAME
	 * `composeWorldMatrix` the spine + text overlays use, so the three layers agree by construction.
	 * Unlike the spine overlay (whose vendored WebGL camera forces an x-mirror compensation), Pixi is
	 * natively y-down like the 2D canvas, so we place each node's Container at the raw world transform
	 * and bake the editor PAN/ZOOM once on the parent `world` Container (`world.position = pan`,
	 * `world.scale = zoom`) — the identical `world*zoom + pan` mapping the 2D canvas uses.
	 *
	 * v1 scope: FREE layers only (`placement.space !== 'bone'`). A bone-placed layer needs a live rig
	 * host the editor overlay doesn't provide, so it's skipped here (the node keeps its chip); the game
	 * mounts bone FX on their host rig. A node whose doc/layers resolve NO live emitter keeps its 2D
	 * chip (reported via `onReadyKeysChange`).
	 */
	import { Emitter } from '@barvynkoa/particle-emitter';
	import { bindArt, type EffectDoc, type EmitterLayer } from 'engine-fx';
	import {
		MAX_COMPONENT_DEPTH,
		resolveTransform,
		type ComponentDef,
		type LayoutNode,
		type LayoutType,
		type ResolvedTransform,
		type Scene,
	} from 'engine-layout';
	import { Application, Container, type TextureSource } from 'pixi.js';
	import { framesToTextures, type ResolvedArt } from '$lib/fx/effectEmitter.client';
	import { onMount } from 'svelte';
	import { childLocalTransform, composeWorldMatrix } from './editorCanvas.helpers';

	interface Props {
		/** All doc scenes — the live emitters are driven by these (filtered by
		 * `sceneFilter`/`hiddenSceneIds`), mirroring `EditorSpineLayer`. */
		scenes: Scene[];
		layoutType: LayoutType;
		/** Active scene frame size (world coords) — carried for parity with the spine
		 * overlay's nested-transform math (`childLocalTransform` needs the frame for
		 * `canvas`-space screen anchors). */
		frameWidth: number;
		frameHeight: number;
		/** Editor view transform — kept byte-identical with the 2D canvas + spine overlay. */
		panX: number;
		panY: number;
		zoom: number;
		/** Global play/pause for effect preview (default true). */
		playing: boolean;
		/** Editor-only: scene ids hidden from the composite. */
		hiddenSceneIds?: Set<string>;
		/** Editor-only: when set, render ONLY these scene ids (the per-scene composite passes a
		 * single-id Set so an effect z-orders with its own scene group). Unset = every non-hidden. */
		sceneFilter?: Set<string> | null;
		/** Loaded project component defs, so the overlay can EXPAND a `componentInstance`'s tree and
		 * render effects nested inside it — the same `componentMap` the 2D canvas + overlays use. */
		componentMap?: Map<string, ComponentDef>;
		/** Frames a TOP-LEVEL node into canvas-world coords (EditorCanvas's `nodeTransform`), so a
		 * nested effect's world transform composes from its ancestor chain identically to the 2D
		 * canvas + spine overlay + game runtime. */
		worldTransformOf: (node: LayoutNode, scene: Scene) => ResolvedTransform;
		/** Reports which effect NODE ids now render a live emitter, so the 2D canvas can drop their
		 * placeholder chip. Loading / bone-only / empty nodes stay chipped. */
		onReadyKeysChange?: (nodeIds: Set<string>) => void;
	}

	let {
		scenes,
		layoutType,
		frameWidth,
		frameHeight,
		panX,
		panY,
		zoom,
		playing,
		hiddenSceneIds = new Set<string>(),
		sceneFilter = null,
		componentMap = new Map<string, ComponentDef>(),
		worldTransformOf,
		onReadyKeysChange,
	}: Props = $props();

	let host: HTMLDivElement | null = $state(null);
	let app: Application | null = null;
	/** Flips true once the `Application` has initialised — the props can be set before the canvas
	 * exists, so the rebuild effect gates on this. */
	let ready = $state(false);
	/** The pan/zoom world the per-node effect containers live in. */
	let world: Container | null = null;

	/** One placed effect target the overlay must render: a `kind:'effect'` node + its resolved
	 * canvas-WORLD transform (pre pan/zoom — pan/zoom is baked on the parent `world`). */
	interface EffectTarget {
		nodeId: string;
		effectId: string;
		world: { x: number; y: number; scaleX: number; scaleY: number; rotation: number };
	}

	/** A live per-NODE render: its container (positioned at the node's world transform) + one emitter
	 * per FREE layer. Rebuilt when the node's effectId / doc / transform changes; disposed on removal. */
	interface LiveNode {
		effectId: string;
		/** The world transform this node's container is currently placed at (change ⇒ reposition). */
		placed: EffectTarget['world'];
		container: Container;
		emitters: Emitter[];
		/** True once at least one free layer resolved a visible emitter (art OR placeholder) — drives
		 * the ready report so the 2D chip is only dropped when something actually renders. */
		live: boolean;
	}

	/** Per-node live renders, keyed by node id (a doc may back several placed nodes). */
	const liveNodes = new Map<string, LiveNode>();
	/** Cache of fetched `EffectDoc`s by effectId (one doc can back many nodes). */
	const docCache = new Map<string, Promise<EffectDoc | null>>();
	/** Cache of resolved atlas-page `TextureSource`s by URL (a page decodes once per overlay). */
	const sourceCache = new Map<string, TextureSource>();
	/** Cache of resolved art (manifest key → page + regions), mirroring the `/fx` page. */
	const artCache = new Map<string, Promise<ResolvedArt | null>>();

	/** Resolve an `art.assetKey` (atlas manifest key) to its page URL + region rects — copied from the
	 * `/fx` page so the overlay resolves art identically (regions endpoint → page streamer URL). */
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

	/** Fetch (once) the `EffectDoc` for an effectId. Cached by id; `null` on any failure so a bad id
	 * never crashes the overlay (the node keeps its 2D chip). */
	function loadEffectDoc(effectId: string): Promise<EffectDoc | null> {
		const hit = docCache.get(effectId);
		if (hit) return hit;
		const p = (async (): Promise<EffectDoc | null> => {
			try {
				const res = await fetch(`/api/editor/effect?id=${encodeURIComponent(effectId)}`);
				if (!res.ok) return null;
				const body = (await res.json()) as { doc: EffectDoc };
				return body.doc ?? null;
			} catch {
				return null;
			}
		})();
		docCache.set(effectId, p);
		return p;
	}

	// ---- target collection (mirrors EditorSpineLayer.spineTargets) --------------------------------

	/** Collect every placed effect node (top-level + nested) across the non-hidden / filtered scenes,
	 * each with its resolved canvas-WORLD transform. Mirrors `EditorSpineLayer.spineTargets` +
	 * `collectNestedSpines`: framing is applied ONCE at the top-level node (`worldTransformOf`),
	 * descendants compose in pure local space (`childLocalTransform`) via `composeWorldMatrix`. */
	function effectTargets(): EffectTarget[] {
		const out: EffectTarget[] = [];
		for (const sc of scenes) {
			if (hiddenSceneIds.has(sc.id)) continue;
			if (sceneFilter && !sceneFilter.has(sc.id)) continue;
			for (const n of sc.nodes) {
				const t = resolveTransform(n, layoutType);
				if (!t.visible) continue;
				if (n.kind === 'effect') {
					const wt = worldTransformOf(n, sc);
					out.push({
						nodeId: n.id,
						effectId: n.effectId,
						world: {
							x: wt.x,
							y: wt.y,
							scaleX: wt.scale?.x ?? 1,
							scaleY: wt.scale?.y ?? 1,
							rotation: wt.rotation ?? 0,
						},
					});
				}
				// Effects nested inside a container / component instance: the 2D canvas expands these,
				// so the overlay must too — each nested effect's world transform composes from its
				// ancestor chain (top link framed, descendants pure-local).
				if (n.kind === 'container') {
					collectNested(n.children, sc, out, [n], 0, []);
				} else if (n.kind === 'componentInstance') {
					const def = componentMap.get(n.componentId);
					if (def) collectNested(def.root.children, sc, out, [n], 1, [def.id]);
				}
			}
		}
		return out;
	}

	/** Recursively collect effect targets NESTED inside containers / component instances — mirroring
	 * `EditorSpineLayer.collectNestedSpines`. `chain` is the ancestor path (root-first); each nested
	 * effect's world transform is composed from it via {@link composeWorldMatrix}. */
	function collectNested(
		nodes: LayoutNode[],
		sc: Scene,
		out: EffectTarget[],
		chain: LayoutNode[],
		depth: number,
		stack: string[],
	): void {
		for (const n of nodes) {
			if (!resolveTransform(n, layoutType).visible) continue;
			const nextChain = [...chain, n];
			if (n.kind === 'effect') {
				out.push(nestedTarget(n, sc, nextChain));
			} else if (n.kind === 'container') {
				collectNested(n.children, sc, out, nextChain, depth, stack);
			} else if (n.kind === 'componentInstance') {
				const def = componentMap.get(n.componentId);
				if (!def || depth >= MAX_COMPONENT_DEPTH || stack.includes(def.id)) continue;
				collectNested(def.root.children, sc, out, nextChain, depth + 1, [...stack, def.id]);
			}
		}
	}

	/** Build a target for a nested effect: its world transform composed from the ancestor `chain`
	 * (top link framed via `worldTransformOf`, descendants pure-local via `childLocalTransform` — the
	 * SAME rule the 2D canvas + spine overlay + game runtime use), decomposed to x/y + scale +
	 * rotation. A single-axis flip in the chain (negative scale) is preserved via the determinant. */
	function nestedTarget(
		node: Extract<LayoutNode, { kind: 'effect' }>,
		sc: Scene,
		chain: LayoutNode[],
	): EffectTarget {
		const [a, b, c, d, tx, ty] = composeWorldMatrix(
			chain,
			(top) => worldTransformOf(top, sc),
			(child) => childLocalTransform(child, layoutType, sc.space, frameWidth, frameHeight),
		);
		const sx = Math.hypot(a, b) || 1;
		const sy = Math.hypot(c, d) || 1;
		const det = a * d - b * c;
		const rotation = Math.atan2(b, a);
		return {
			nodeId: node.id,
			effectId: node.effectId,
			world: { x: tx, y: ty, scaleX: sx, scaleY: det < 0 ? -sy : sy, rotation },
		};
	}

	// ---- emitter lifecycle (mirrors FxStage.rebuild) ----------------------------------------------

	function sameTransform(a: EffectTarget['world'], b: EffectTarget['world']): boolean {
		return (
			a.x === b.x &&
			a.y === b.y &&
			a.scaleX === b.scaleX &&
			a.scaleY === b.scaleY &&
			a.rotation === b.rotation
		);
	}

	/** Apply a target's world transform to its container (pan/zoom lives on the parent `world`). */
	function applyContainerTransform(container: Container, w: EffectTarget['world']): void {
		container.position.set(w.x, w.y);
		container.scale.set(w.scaleX, w.scaleY);
		container.rotation = w.rotation;
	}

	/** Dispose a node's live emitters + its container (mirrors FxStage's dispose discipline). A free
	 * sprite emitter has no Tier-C pool, so a plain `destroy()` suffices. */
	function disposeNode(node: LiveNode): void {
		for (const emitter of node.emitters) {
			try {
				emitter.emit = false;
				emitter.destroy();
			} catch {
				/* emitter already torn down */
			}
		}
		node.emitters = [];
		node.container.destroy({ children: true });
	}

	/** Generation token so a fast edit / transform change can't interleave two async rebuilds into
	 * duplicate or torn emitters (mirrors FxStage's `rebuildGen`). */
	let rebuildGen = 0;
	let rebuilding = false;
	let rebuildPending = false;

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

		const targets = effectTargets();
		const seen = new Set<string>();

		// Reposition unchanged nodes; drop nodes whose effect changed (rebuild below).
		for (const tg of targets) {
			seen.add(tg.nodeId);
			const existing = liveNodes.get(tg.nodeId);
			if (existing && existing.effectId === tg.effectId) {
				if (!sameTransform(existing.placed, tg.world)) {
					applyContainerTransform(existing.container, tg.world);
					existing.placed = tg.world;
				}
				continue;
			}
			// New node, or its effectId changed → tear down the stale render, then build fresh.
			if (existing) {
				disposeNode(existing);
				liveNodes.delete(tg.nodeId);
			}
			await buildNode(tg, gen);
			if (gen !== rebuildGen) return; // superseded by a newer rebuild
		}

		// Remove nodes no longer placed anywhere in this filter's scenes.
		let removed = false;
		for (const [id, node] of liveNodes) {
			if (!seen.has(id)) {
				disposeNode(node);
				liveNodes.delete(id);
				removed = true;
			}
		}
		if (removed) publishReady();
	}

	/** Build one placed effect node: fetch its doc, then one `Emitter` per FREE layer (bone layers are
	 * skipped in the editor overlay — no rig host). A node with no resolvable live emitter is not added
	 * to the ready set, so its 2D chip stays. */
	async function buildNode(tg: EffectTarget, gen: number): Promise<void> {
		if (!world) return;
		const doc = await loadEffectDoc(tg.effectId);
		if (gen !== rebuildGen || !world) return;

		const container = new Container();
		applyContainerTransform(container, tg.world);
		world.addChild(container);

		const node: LiveNode = {
			effectId: tg.effectId,
			placed: tg.world,
			container,
			emitters: [],
			live: false,
		};
		liveNodes.set(tg.nodeId, node);

		if (!doc) {
			// Unresolvable doc → keep the container (empty) so a later fix repositions cleanly, but
			// report NOT-ready so the 2D chip stays.
			publishReady();
			return;
		}

		for (const layer of doc.layers) {
			// v1: skip bone-placed layers — they need a live `<SpineProvider>` host the scene overlay
			// doesn't have (the runtime mounts those on their host rig). A free layer spawns here.
			if (layer.placement.space === 'bone') continue;
			await buildLayer(node, layer, gen);
			if (gen !== rebuildGen) return;
		}

		node.live = node.emitters.length > 0;
		publishReady();
	}

	/** Build one FREE layer's live `Emitter` into a node's container (mirrors FxStage's sprite path).
	 * A layer that resolves 0 textures is SKIPPED (the editor overlay renders real art only — the `/fx`
	 * tool's placeholder dots are an authoring aid there, not wanted littering the scene preview). */
	async function buildLayer(node: LiveNode, layer: EmitterLayer, gen: number): Promise<void> {
		const textures = await framesToTextures(layer, resolveArt, sourceCache);
		if (gen !== rebuildGen) return;
		if (textures.length === 0) return; // no art → skip (no placeholder dots in the scene)
		// Weighted mix only when the resolved textures line up 1:1 with `frames` (a skipped region
		// would misalign the weights → fall back to uniform), matching FxStage.
		const weights =
			textures.length === layer.art.frames.length ? layer.art.weights : undefined;
		// bindArt deep-clones the (texture-free) config itself, then attaches the live textures — so
		// the emitter never sees the $state proxy and the result must NOT be re-JSON-cloned.
		const config = bindArt(layer.config, textures, layer.art.animated ?? false, weights);
		const emitter = new Emitter(node.container, config);
		emitter.emit = playing;
		node.emitters.push(emitter);
	}

	// ---- ready reporting (chip suppression) -------------------------------------------------------

	let readyKeys = new Set<string>();
	/** Publish the set of effect NODE ids that render a live emitter, idempotent (only re-emit when the
	 * set changes) so the parent's `$state` doesn't loop — mirroring `EditorSpineLayer.publishReady`. */
	function publishReady(): void {
		const next = new Set<string>();
		for (const [id, node] of liveNodes) if (node.live) next.add(id);
		if (next.size !== readyKeys.size || [...next].some((k) => !readyKeys.has(k))) {
			readyKeys = next;
			onReadyKeysChange?.(next);
		}
	}

	// ---- pan / zoom + play/pause ------------------------------------------------------------------

	/** Bake the editor pan/zoom onto the world container — the identical `world*zoom + pan` mapping the
	 * 2D canvas + spine overlay use. Each node container is placed in raw canvas-world coords, so
	 * pan/zoom composes once here. */
	function applyView(): void {
		if (!world) return;
		world.position.set(panX, panY);
		world.scale.set(zoom);
	}

	function resizeRenderer(): void {
		if (!app || !host) return;
		app.renderer.resize(host.clientWidth, host.clientHeight);
	}

	onMount(() => {
		let disposed = false;
		const created = new Application();
		(async () => {
			// Transparent bg so this overlays the 2D canvas + earlier scene groups; antialias for
			// crisp particle art at zoom. `resizeTo` keeps the backing store matched to the host.
			await created.init({ backgroundAlpha: 0, antialias: true, resizeTo: host ?? undefined });
			if (disposed) {
				created.destroy(true);
				return;
			}
			app = created;
			host?.appendChild(app.canvas);
			world = new Container();
			app.stage.addChild(world);
			applyView();
			ready = true;
			app.ticker.add((ticker) => {
				if (!playing) return;
				const dt = ticker.deltaMS / 1000;
				for (const node of liveNodes.values()) {
					for (const emitter of node.emitters) {
						try {
							emitter.update(dt);
						} catch (err) {
							// A degenerate config (e.g. a 0-lifetime particle → Infinity interpolation) can make
							// the library throw mid-update. Isolate it so one bad emitter doesn't throw out of the
							// ticker and freeze the whole overlay — stop just that emitter.
							console.warn('EditorEffectLayer: emitter.update threw; stopping that emitter', err);
							emitter.emit = false;
						}
					}
				}
			});
			await requestRebuild();
		})();

		return () => {
			disposed = true;
			for (const node of liveNodes.values()) disposeNode(node);
			liveNodes.clear();
			// Force-free the GPU context on real unmount: one context per effect-bearing scene group +
			// groups churning on eye-toggle / reorder can hit the browser's live-context cap (~8–16) and
			// silently drop the oldest → blank previews. `destroy(true)` releases the WebGL context.
			app?.destroy(true);
			app = null;
			world = null;
		};
	});

	// Rebuild whenever the doc's placed effects (or their transforms) change — the scenes are the
	// source of truth. Touch the scene structure + view transform so a move/edit re-runs.
	$effect(() => {
		void JSON.stringify(scenes);
		void layoutType;
		void frameWidth;
		void frameHeight;
		void componentMap;
		if (ready) void requestRebuild();
	});

	// Bake pan/zoom onto the world container (each node container is placed in raw world coords).
	$effect(() => {
		void panX;
		void panY;
		void zoom;
		if (ready) applyView();
	});

	// Keep the renderer's backing store matched to the host on frame resize (resizeTo handles the
	// canvas, but an explicit resize guards a host that changes before the observer fires).
	$effect(() => {
		void frameWidth;
		void frameHeight;
		if (ready) resizeRenderer();
	});

	// Honour global play/pause without a full rebuild — just gate each emitter's emission + the
	// ticker's advance (the ticker early-returns when paused).
	$effect(() => {
		const play = playing;
		for (const node of liveNodes.values()) {
			for (const emitter of node.emitters) emitter.emit = play;
		}
	});
</script>

<div bind:this={host} class="effect-layer"></div>

<style>
	.effect-layer {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
		/* Input always reaches the 2D canvas underneath (selection/handles/drag). */
		pointer-events: none;
	}
</style>
