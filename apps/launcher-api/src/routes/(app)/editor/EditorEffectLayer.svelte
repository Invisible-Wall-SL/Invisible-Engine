<script lang="ts">
	/**
	 * Scene Editor — the LIVE particle overlay. The 2D canvas can't run a WebGL particle emitter, so a
	 * placed `kind:'effect'` node otherwise shows only a static ✨ placeholder chip. This overlay mounts
	 * ONE `PIXI.Application` (transparent, `pointer-events:none`) over the 2D canvas and plays each
	 * placed effect's authored `EffectDoc` verbatim — mirroring `EditorRigLayer` (the live rig
	 * overlay) but driving `@barvynkoa/particle-emitter` `Emitter`s (the SAME runtime contract the `/fx`
	 * tool's `FxStage` and the game's `<EffectPlayer>` reduce to: `bindArt` the layer's art textures →
	 * `new Emitter(container, config)` → `emitter.update(dtSeconds)`).
	 *
	 * Transform parity (the load-bearing seam): a placed effect lands EXACTLY where its 2D placeholder
	 * chip / selection box sits. Both are driven by the SAME `worldTransformOf` (== EditorCanvas's
	 * `nodeTransform`) result — a `ResolvedTransform` in canvas WORLD coords (pre pan/zoom). A nested
	 * effect (inside a container / component instance) composes its ancestor chain via the SAME
	 * `composeWorldMatrix` the rig + text overlays use, so the three layers agree by construction.
	 * Every placement of one component shares its nodes' ids, so each nested effect renders under
	 * its id PATH (as the text overlay keys its objects): three placed copies preview three emitters,
	 * each with its own params, as the game draws them.
	 * Unlike the rig overlay (whose vendored WebGL camera forces an x-mirror compensation), Pixi is
	 * natively y-down like the 2D canvas, so we place each node's Container at the raw world transform
	 * and bake the editor PAN/ZOOM once on the parent `world` Container (`world.position = pan`,
	 * `world.scale = zoom`) — the identical `world*zoom + pan` mapping the 2D canvas uses.
	 *
	 * v1 scope: FREE layers only (`placement.space !== 'bone'`). A bone-placed layer needs a live rig
	 * host the editor overlay doesn't provide, so it's skipped here (the node keeps its chip); the game
	 * mounts bone FX on their host rig. Each free layer's emitter sits in its own child container at
	 * the layer's `placement.offset` (resolved by the same `planLayer` the game's `<EffectLayer>`
	 * mounts from), so an offset layer previews where it plays. A node whose doc/layers resolve NO
	 * live emitter keeps its 2D chip (reported via `onReadyKeysChange`).
	 */
	import { Emitter } from '@barvynkoa/particle-emitter';
	import {
		bindArt,
		bindEffectParams,
		createEffectLevelApplier,
		planLayer,
		type EffectDoc,
		type EffectLevelApplier,
		type EffectLevelState,
		type EffectParamApplier,
		type EffectParamValues,
		type EmitterLayer,
	} from 'engine-fx';
	import {
		MAX_COMPONENT_DEPTH,
		forwardInstanceParams,
		resolveComponentParams,
		resolveLayoutInstanceParams,
		type ComponentDef,
		type ComponentInstanceNode,
		type EffectNode,
		type LayoutNode,
		type LayoutType,
		type ResolvedTransform,
		type Scene,
	} from 'engine-layout';
	import { Application, Container, type TextureSource } from 'pixi.js';
	import { framesToTextures, type ResolvedArt } from '$lib/fx/effectEmitter.client';
	import { onMount } from 'svelte';
	import {
		childLocalTransform,
		composeWorldMatrix,
		depthKey,
		inDepthSlice,
		unionBox,
		type DepthSlice,
		type SpreadBox,
	} from './editorCanvas.helpers';
	import { withEditorProject } from './editorProject.client';
	import { notePlacedEffect } from './placedEffects.client.svelte';
	import { previewResolveTransform, previewVersion } from './valuePreview.client.svelte';

	interface Props {
		/** All doc scenes — the live emitters are driven by these (filtered by
		 * `sceneFilter`/`hiddenSceneIds`), mirroring `EditorRigLayer`. */
		scenes: Scene[];
		layoutType: LayoutType;
		/** Active scene frame size (world coords) — carried for parity with the rig
		 * overlay's nested-transform math (`childLocalTransform` needs the frame for
		 * `canvas`-space screen anchors). */
		frameWidth: number;
		frameHeight: number;
		/** Editor view transform — kept byte-identical with the 2D canvas + rig overlay. */
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
		/** Restrict this layer to a SUBSET of each filtered scene's top-level nodes (nested effects
		 * follow their top-level ancestor) — see `EditorRigLayer.nodeFilter`. `null` ⇒ every node
		 * (parity). */
		nodeFilter?: Set<string> | null;
		/** The depth segment this layer draws: an effect inside a group or component that the split
		 * crosses is drawn only by the segment it falls in (see `EditorCanvas`'s `depthSegments`).
		 * `null` ⇒ the whole scene. */
		depthSlice?: DepthSlice | null;
		/** CSS `mix-blend-mode` for this layer's canvas — see `EditorRigLayer.blend`. An additive
		 * emitter blended INSIDE this transparent overlay is a no-op, so the blend rides the element
		 * and composites against the art beneath, exactly as the game's `<Container blendMode>` does. */
		blend?: string;
		/** Loaded project component defs, so the overlay can EXPAND a `componentInstance`'s tree and
		 * render effects nested inside it — the same `componentMap` the 2D canvas + overlays use. */
		componentMap?: Map<string, ComponentDef>;
		/** Frames a TOP-LEVEL node into canvas-world coords (EditorCanvas's `nodeTransform`), so a
		 * nested effect's world transform composes from its ancestor chain identically to the 2D
		 * canvas + rig overlay + game runtime. */
		worldTransformOf: (node: LayoutNode, scene: Scene) => ResolvedTransform;
		/** Reports which effect NODE ids now render a live emitter in any placement, so the 2D canvas
		 * can drop their placeholder chip. Loading / bone-only / empty nodes stay chipped. */
		onReadyKeysChange?: (nodeIds: Set<string>) => void;
		/** Reports each live effect's measured particle SPREAD in the node's LOCAL (scene-world)
		 * space — a running-MAX rect `{ x, y, w, h }` where `x`/`y` are the top-left offset from the
		 * node origin (particles above/left of the origin give negative `x`/`y`), so the 2D canvas
		 * can fit the selection box to the real spread instead of the fixed placeholder. Keyed by
		 * NODE id — a node placed several times (inside a component) reports the union of its
		 * placements' spreads — idempotent (only re-emitted when a box meaningfully grows). */
		onBoundsChange?: (bounds: Map<string, SpreadBox>) => void;
		/** The open component's resolved preview params (the Component Editor; empty on a screen) —
		 * what an effect placed at the top level of that component reads a `params.<id>` value from. */
		componentParams?: Record<string, unknown>;
		/** Per-component-id project param defaults, so a nested effect reads the params its instance
		 * resolves (`resolveComponentParams`), as the rig layer does. */
		componentDefaults?: Record<string, Record<string, unknown>>;
		/** The live values of a placed effect's exposed parameters — for the placed node, the doc it
		 * plays and the params of the instance it sits in — read on the ticker. Absent ⇒ every effect
		 * draws its defaults (already in its stored config). */
		effectParamValues?: (
			node: EffectNode,
			doc: EffectDoc,
			params: Readonly<Record<string, unknown>>,
		) => EffectParamValues | undefined;
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
		nodeFilter = null,
		depthSlice = null,
		blend = 'normal',
		componentMap = new Map<string, ComponentDef>(),
		worldTransformOf,
		onReadyKeysChange,
		onBoundsChange,
		componentParams = {},
		componentDefaults = {},
		effectParamValues,
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
		/** Unique per drawn placement: the `depthKey` of the node's id path from the top of its
		 * screen. Every placement of one component shares its nodes' ids, so a nested effect needs
		 * the path, and a top-level effect's is its own id. */
		key: string;
		/** The bare node id — what the chip + selection-box reports are keyed by. */
		nodeId: string;
		effectId: string;
		/** The placed node, as the current scenes hold it (its bindings drive the parameters). */
		node: EffectNode;
		/** The resolved params of the instance it sits in (the open component's at the top level). */
		params: Record<string, unknown>;
		world: { x: number; y: number; scaleX: number; scaleY: number; rotation: number };
	}

	/** A live per-PLACEMENT render: its container (positioned at the placement's world transform) +
	 * one emitter per FREE layer, each in a child container at that layer's offset. Rebuilt when the
	 * node's effectId changes; repositioned when its transform does; disposed on removal. */
	interface LiveNode {
		nodeId: string;
		effectId: string;
		/** The placed node and its instance's params, refreshed on every rebuild — what
		 * `effectParamValues` is asked for. */
		node: EffectNode;
		params: Record<string, unknown>;
		/** The doc it plays, once loaded. */
		doc: EffectDoc | null;
		/** The world transform this node's container is currently placed at (change ⇒ reposition). */
		placed: EffectTarget['world'];
		container: Container;
		emitters: Emitter[];
		/** The `effect.*` drives and the wrapper they move, when the doc has any. */
		fx?: { applier: EffectLevelApplier; wrapper: Container };
		/** One applier per driven layer, only when live values are supplied. */
		appliers: EffectParamApplier[];
		/** True once at least one free layer resolved a visible emitter (art OR placeholder) — drives
		 * the ready report so the 2D chip is only dropped when something actually renders. */
		live: boolean;
		/** Running-MAX particle spread in the node's LOCAL space (`container.getLocalBounds()`,
		 * BEFORE the container's own transform + the world pan/zoom — i.e. scene-world units, exactly
		 * what `nodeBox` wants). `null` until the first non-degenerate frame. Grows only (never
		 * shrinks), so a burst that fans out then dies still keeps a stable enclosing box. Reset (a
		 * fresh `LiveNode`) whenever the node's effectId/doc rebuilds. */
		bounds: SpreadBox | null;
	}

	/** Live renders keyed by placement (`EffectTarget.key`), so each placed copy of a component plays
	 * its own emitters with its own params. */
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
				pageVersion?: string;
				pageWidth: number;
				pageHeight: number;
				regions: { name: string; x: number; y: number; w: number; h: number; rotated?: boolean }[];
			};
			if (!set.pageKey) return null;
			const v = set.pageVersion ? `&v=${encodeURIComponent(set.pageVersion)}` : '';
			return {
				pageUrl: `/api/editor/asset?key=${encodeURIComponent(set.pageKey)}${v}`,
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
				const res = await fetch(
					withEditorProject(`/api/editor/effect?id=${encodeURIComponent(effectId)}`),
				);
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

	// ---- target collection (mirrors EditorRigLayer.rigTargets) --------------------------------

	/** Collect every placed effect node (top-level + nested) across the non-hidden / filtered scenes,
	 * each with its resolved canvas-WORLD transform. Mirrors `EditorRigLayer.rigTargets` +
	 * `collectNestedRigs`: framing is applied ONCE at the top-level node (`worldTransformOf`),
	 * descendants compose in pure local space (`childLocalTransform`) via `composeWorldMatrix`. */
	function effectTargets(): EffectTarget[] {
		const out: EffectTarget[] = [];
		for (const sc of scenes) {
			if (hiddenSceneIds.has(sc.id)) continue;
			if (sceneFilter && !sceneFilter.has(sc.id)) continue;
			for (const n of sc.nodes) {
				if (nodeFilter && !nodeFilter.has(n.id)) continue;
				if (!previewResolveTransform(n, layoutType).visible) continue;
				if (n.kind === 'effect' && inDepthSlice(depthSlice, [n.id])) {
					const wt = worldTransformOf(n, sc);
					out.push({
						key: depthKey([n.id]),
						nodeId: n.id,
						effectId: n.effectId,
						node: n,
						params: componentParams,
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
					collectNested(n.children, sc, out, [n], 0, [], componentParams);
				} else if (n.kind === 'componentInstance') {
					const def = componentMap.get(n.componentId);
					if (def) {
						const params = instanceParams(def, n, componentParams);
						collectNested(def.root.children, sc, out, [n], 1, [def.id], params);
					}
				}
			}
		}
		return out;
	}

	/** The params `node` (an instance of `def`) resolves, with the ones it takes from the instance
	 * it sits in (`outer`) forwarded — what the effects inside it read. */
	function instanceParams(
		def: ComponentDef,
		node: ComponentInstanceNode,
		outer: Record<string, unknown>,
	): Record<string, unknown> {
		return resolveComponentParams(
			def,
			forwardInstanceParams(node, resolveLayoutInstanceParams(node, layoutType), outer),
			componentDefaults[def.id],
		);
	}

	/** Recursively collect effect targets NESTED inside containers / component instances — mirroring
	 * `EditorRigLayer.collectNestedRigs`. `chain` is the ancestor path (root-first); each nested
	 * effect's world transform is composed from it via {@link composeWorldMatrix}. `params` are the
	 * resolved params of the instance `nodes` sit in. */
	function collectNested(
		nodes: LayoutNode[],
		sc: Scene,
		out: EffectTarget[],
		chain: LayoutNode[],
		depth: number,
		stack: string[],
		params: Record<string, unknown>,
	): void {
		for (const n of nodes) {
			if (!previewResolveTransform(n, layoutType).visible) continue;
			const nextChain = [...chain, n];
			if (n.kind === 'effect') {
				const ids = nextChain.map((c) => c.id);
				if (inDepthSlice(depthSlice, ids))
					out.push(nestedTarget(n, sc, nextChain, depthKey(ids), params));
			} else if (n.kind === 'container') {
				collectNested(n.children, sc, out, nextChain, depth, stack, params);
			} else if (n.kind === 'componentInstance') {
				const def = componentMap.get(n.componentId);
				if (!def || depth >= MAX_COMPONENT_DEPTH || stack.includes(def.id)) continue;
				collectNested(
					def.root.children,
					sc,
					out,
					nextChain,
					depth + 1,
					[...stack, def.id],
					instanceParams(def, n, params),
				);
			}
		}
	}

	/** Build a target for a nested effect: its world transform composed from the ancestor `chain`
	 * (top link framed via `worldTransformOf`, descendants pure-local via `childLocalTransform` — the
	 * SAME rule the 2D canvas + rig overlay + game runtime use), decomposed to x/y + scale +
	 * rotation. A single-axis flip in the chain (negative scale) is preserved via the determinant. */
	function nestedTarget(
		node: Extract<LayoutNode, { kind: 'effect' }>,
		sc: Scene,
		chain: LayoutNode[],
		key: string,
		params: Record<string, unknown>,
	): EffectTarget {
		const [a, b, c, d, tx, ty] = composeWorldMatrix(
			chain,
			(top) => worldTransformOf(top, sc),
			(child) =>
				childLocalTransform(
					child,
					layoutType,
					sc.space,
					frameWidth,
					frameHeight,
					previewResolveTransform,
				),
		);
		const sx = Math.hypot(a, b) || 1;
		const sy = Math.hypot(c, d) || 1;
		const det = a * d - b * c;
		const rotation = Math.atan2(b, a);
		return {
			key,
			nodeId: node.id,
			effectId: node.effectId,
			node,
			params,
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

		// Reposition unchanged placements; drop ones whose effect changed (rebuild below).
		for (const tg of targets) {
			seen.add(tg.key);
			const existing = liveNodes.get(tg.key);
			if (existing && existing.effectId === tg.effectId) {
				existing.node = tg.node;
				existing.params = tg.params;
				if (!sameTransform(existing.placed, tg.world)) {
					applyContainerTransform(existing.container, tg.world);
					existing.placed = tg.world;
				}
				continue;
			}
			// New placement, or its effectId changed → tear down the stale render, then build fresh.
			if (existing) {
				disposeNode(existing);
				liveNodes.delete(tg.key);
			}
			await buildNode(tg, gen);
			if (gen !== rebuildGen) return; // superseded by a newer rebuild
		}

		// Remove placements no longer in this filter's scenes.
		let removed = false;
		for (const [key, node] of liveNodes) {
			if (!seen.has(key)) {
				disposeNode(node);
				liveNodes.delete(key);
				removed = true;
			}
		}
		if (removed) {
			publishReady();
			// A removed / rebuilt node must drop its reported box too, else a stale spread lingers on
			// a node id that no longer renders (its accumulator was reset with the fresh LiveNode).
			publishBounds();
		}

		// Outline order IS draw order, as in the game's one scene graph. A node's container is only
		// ADDED when it is built (on top), and a kept node is only repositioned, so a reorder, a
		// hide → show or an effect swap left the stack in build order. Re-append in target order
		// (tree order) every rebuild; `addChild` moves an existing child to the end. Same fix as
		// `FxStage`'s layer restack.
		for (const tg of targets) {
			const live = liveNodes.get(tg.key);
			if (live && live.container.parent === world) world.addChild(live.container);
		}
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
			nodeId: tg.nodeId,
			effectId: tg.effectId,
			node: tg.node,
			params: tg.params,
			doc,
			placed: tg.world,
			container,
			emitters: [],
			appliers: [],
			live: false,
			bounds: null,
		};
		liveNodes.set(tg.key, node);

		if (!doc) {
			// Unresolvable doc → keep the container (empty) so a later fix repositions cleanly, but
			// report NOT-ready so the 2D chip stays.
			publishReady();
			return;
		}
		notePlacedEffect(doc);

		// `effect.*` drives move a wrapper around the layers — mounted only when the doc has one. Their
		// targets have no stored leaf, so the defaults are written here even with no live values.
		const fx = createEffectLevelApplier(doc.params);
		if (fx) {
			const wrapper = new Container();
			container.addChild(wrapper);
			node.fx = { applier: fx, wrapper };
			fx.apply(effectParamValues?.(tg.node, doc, tg.params));
			writeEffectLevel(wrapper, fx.state);
		}

		for (const layer of doc.layers) {
			// v1: skip bone-placed layers — they need a live `<RigProvider>` host the scene overlay
			// doesn't have (the runtime mounts those on their host rig). A free layer spawns here.
			if (layer.placement.space === 'bone') continue;
			await buildLayer(node, layer, gen, doc);
			if (gen !== rebuildGen) return;
		}

		node.live = node.emitters.length > 0;
		publishReady();
	}

	/** Build one FREE layer's live `Emitter` into a node's container (mirrors FxStage's sprite path),
	 * inside a child container at the layer's offset — the game's `<EffectLayer>` free-mount shape.
	 * A layer that resolves 0 textures is SKIPPED (the editor overlay renders real art only — the `/fx`
	 * tool's placeholder dots are an authoring aid there, not wanted littering the scene preview). */
	async function buildLayer(
		node: LiveNode,
		layer: EmitterLayer,
		gen: number,
		doc: EffectDoc,
	): Promise<void> {
		const textures = await framesToTextures(layer, resolveArt, sourceCache);
		if (gen !== rebuildGen) return;
		if (textures.length === 0) return; // no art → skip (no placeholder dots in the scene)
		// Weighted mix only when the resolved textures line up 1:1 with `frames` (a skipped region
		// would misalign the weights → fall back to uniform), matching FxStage.
		const weights = textures.length === layer.art.frames.length ? layer.art.weights : undefined;
		// bindArt deep-clones the (texture-free) config itself, then attaches the live textures — so
		// the emitter never sees the $state proxy and the result must NOT be re-JSON-cloned.
		const config = bindArt(layer.config, textures, layer.art.animated ?? false, weights, {
			framerate: layer.art.framerate,
			loop: layer.art.loop,
		});
		const { offset } = planLayer(layer);
		const layerContainer = new Container();
		layerContainer.position.set(offset.x, offset.y);
		(node.fx?.wrapper ?? node.container).addChild(layerContainer);
		const emitter = new Emitter(layerContainer, config);
		const applier = effectParamValues
			? bindEffectParams({
					params: doc.params,
					layer,
					emitter,
					setOffset: (x, y) => layerContainer.position.set(x, y),
					values: effectParamValues(node.node, doc, node.params),
				})
			: undefined;
		if (applier) node.appliers.push(applier);
		emitter.emit = playing;
		node.emitters.push(emitter);
	}

	/** Write the effect-level state onto its wrapper. */
	function writeEffectLevel(wrapper: Container, state: Readonly<EffectLevelState>): void {
		wrapper.alpha = state.alpha;
		wrapper.scale.set(state.scale);
		wrapper.tint = state.tint;
	}

	// ---- ready reporting (chip suppression) -------------------------------------------------------

	let readyKeys = new Set<string>();
	/** Publish the set of effect NODE ids that render a live emitter in any placement, idempotent (only
	 * re-emit when the set changes) so the parent's `$state` doesn't loop — mirroring
	 * `EditorRigLayer.publishReady`. */
	function publishReady(): void {
		const next = new Set<string>();
		for (const node of liveNodes.values()) if (node.live) next.add(node.nodeId);
		if (next.size !== readyKeys.size || [...next].some((k) => !readyKeys.has(k))) {
			readyKeys = next;
			onReadyKeysChange?.(next);
		}
	}

	// ---- particle-spread reporting (selection-box fit) --------------------------------------------

	/** Min growth (px, node-local units) before a node's max-bounds counts as "meaningfully bigger"
	 * and we re-emit. Keeps `onBoundsChange` from reassigning the parent's `$state` every frame as a
	 * burst breathes by a fraction of a pixel. */
	const BOUNDS_GROW_EPS = 4;
	/** Sample the particle spread every N ticker frames (≈ 10 Hz at 60fps) — measuring + publishing
	 * every frame would churn the parent's `$state` for a purely best-effort selection box. */
	const BOUNDS_SAMPLE_EVERY = 6;
	let boundsTick = 0;
	/** The bounds set last handed to the parent, so `publishBounds` only re-emits on real change. */
	let publishedBounds = new Map<string, SpreadBox>();

	/** Accumulate each live node's particle spread into its running-MAX box (in node-LOCAL /
	 * scene-world units via `container.getLocalBounds()` — before the container's own transform +
	 * the world pan/zoom). Returns true when any node's box grew past {@link BOUNDS_GROW_EPS}, so the
	 * ticker only publishes on meaningful growth (not every frame). Degenerate/empty bounds (no live
	 * particles yet) are ignored so an idle effect keeps its placeholder box. */
	function accumulateBounds(): boolean {
		let grew = false;
		for (const node of liveNodes.values()) {
			if (node.emitters.length === 0) continue;
			// getLocalBounds measures the container's children (the live particles) BEFORE the
			// container's own position/scale/rotation — i.e. offsets from the node origin, which is
			// exactly the local box space `nodeBox` frames.
			const b = node.container.getLocalBounds();
			if (!(b.width > 0) || !(b.height > 0)) continue;
			const prev = node.bounds;
			// Running MAX rect: union the new frame's extent with the accumulated one so a burst that
			// fans out then dies keeps a stable enclosing box (best-effort framing for dynamic art).
			const frame = { x: b.x, y: b.y, w: b.width, h: b.height };
			const next = prev ? unionBox(prev, frame) : frame;
			node.bounds = next;
			if (
				!prev ||
				Math.abs(next.x - prev.x) > BOUNDS_GROW_EPS ||
				Math.abs(next.y - prev.y) > BOUNDS_GROW_EPS ||
				Math.abs(next.w - prev.w) > BOUNDS_GROW_EPS ||
				Math.abs(next.h - prev.h) > BOUNDS_GROW_EPS
			) {
				grew = true;
			}
		}
		return grew;
	}

	/** Publish the per-node max-bounds to the 2D canvas — a node placed several times reports the
	 * union of its placements' boxes (all in the node's own local space) — idempotent: only re-emit
	 * when the set of nodes changed or a box grew past {@link BOUNDS_GROW_EPS} (values rounded so a
	 * sub-px jitter doesn't churn the parent's `$state`). */
	function publishBounds(): void {
		const next = new Map<string, SpreadBox>();
		for (const node of liveNodes.values()) {
			if (!node.bounds) continue;
			const prev = next.get(node.nodeId);
			next.set(node.nodeId, prev ? unionBox(prev, node.bounds) : node.bounds);
		}
		for (const [id, b] of next) {
			next.set(id, {
				x: Math.round(b.x),
				y: Math.round(b.y),
				w: Math.round(b.w),
				h: Math.round(b.h),
			});
		}
		let changed = next.size !== publishedBounds.size;
		if (!changed) {
			for (const [id, b] of next) {
				const p = publishedBounds.get(id);
				if (
					!p ||
					Math.abs(b.x - p.x) > BOUNDS_GROW_EPS ||
					Math.abs(b.y - p.y) > BOUNDS_GROW_EPS ||
					Math.abs(b.w - p.w) > BOUNDS_GROW_EPS ||
					Math.abs(b.h - p.h) > BOUNDS_GROW_EPS
				) {
					changed = true;
					break;
				}
			}
		}
		if (changed) {
			publishedBounds = next;
			onBoundsChange?.(next);
		}
	}

	// ---- pan / zoom + play/pause ------------------------------------------------------------------

	/** Bake the editor pan/zoom onto the world container — the identical `world*zoom + pan` mapping the
	 * 2D canvas + rig overlay use. Each node container is placed in raw canvas-world coords, so
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
					let nodeDt = dt;
					if (effectParamValues && node.doc && (node.fx || node.appliers.length)) {
						const values = effectParamValues(node.node, node.doc, node.params);
						if (node.fx?.applier.apply(values)) {
							writeEffectLevel(node.fx.wrapper, node.fx.applier.state);
						}
						for (const applier of node.appliers) applier.apply(values);
					}
					if (node.fx) nodeDt *= node.fx.applier.state.timeScale;
					for (const emitter of node.emitters) {
						try {
							emitter.update(nodeDt);
						} catch (err) {
							// A degenerate config (e.g. a 0-lifetime particle → Infinity interpolation) can make
							// the library throw mid-update. Isolate it so one bad emitter doesn't throw out of the
							// ticker and freeze the whole overlay — stop just that emitter.
							console.warn('EditorEffectLayer: emitter.update threw; stopping that emitter', err);
							emitter.emit = false;
						}
					}
				}
				// Measure the particle spread a few times a second (not every frame) and only publish
				// when a box meaningfully grew — the selection-box fit is best-effort framing, so a
				// coarse cadence is plenty and keeps the parent's `$state` from reassigning constantly.
				if (++boundsTick >= BOUNDS_SAMPLE_EVERY) {
					boundsTick = 0;
					if (accumulateBounds()) publishBounds();
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
		// A param a placed effect reads (`params.<id>`) re-reads with the open component's params.
		void JSON.stringify(componentParams);
		void JSON.stringify(componentDefaults);
		void nodeFilter;
		void depthSlice;
		// A scrubbed value-binding test value moves / hides an effect like any other node.
		void previewVersion();
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

<div bind:this={host} class="effect-layer" style:mix-blend-mode={blend}></div>

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
