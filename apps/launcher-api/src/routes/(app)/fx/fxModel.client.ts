/**
 * Invisible FX — client-side EffectDoc editing model + the pure config helpers the
 * inspector mutates. The in-memory `EffectDoc` (built on the committed `engine-fx`
 * schema) is the SINGLE source of truth while editing; the live `Emitter` is rebuilt
 * from `layer.config` on every change (the library's `emitter.init(config)` re-inits
 * cleanly — see `ParticleEmitter.svelte`).
 *
 * Everything here is PURE (no `$state`, no DOM, no PixiJS) so it can be unit-covered in
 * `tools/fx-spike` the way the rest of Phase 1's data logic is. The Svelte page wraps
 * these in runes; this module never touches a rune so it stays a plain `.ts`.
 */

import {
	EFFECT_DOC_VERSION,
	behaviorsOf,
	type EffectDoc,
	type EmitterConfigV3,
	type EmitterLayer,
} from 'engine-fx';

// `bindArt` (+ `ART_BEHAVIOR_TYPES` / `behaviorsOf` / `BehaviorEntry`/`BehaviorConfig`) now
// live in the SHARED `engine-fx` package — the ONE canonical "V3 config → renderable config"
// seam used by BOTH this authoring stage and the engine runtime (`bakedEffects()`). Re-exported
// here so existing `/fx` imports (`FxStage.svelte`, the harness) keep their import site.
export { bindArt, behaviorsOf } from 'engine-fx';

/** The single tunable curve point shape used by the V3 list-property behaviors. */
interface ListPoint {
	time: number;
	value: number;
}

/**
 * Build a sane DEFAULT `EmitterConfigV3` for a brand-new layer — a small omnidirectional
 * spark burst. This is exactly the V3 `{ type, config }` behavior shape `upgradeConfig`
 * leaves untouched (matched to the round-trip harness's `sparksConfig`), so a new layer
 * is immediately a valid runtime config that the live `Emitter` can eat verbatim.
 */
export function defaultEmitterConfig(): EmitterConfigV3 {
	return {
		lifetime: { min: 0.5, max: 0.8 },
		frequency: 0.012,
		emitterLifetime: -1,
		maxParticles: 200,
		pos: { x: 0, y: 0 },
		addAtBack: false,
		behaviors: [
			{
				type: 'alpha',
				config: {
					alpha: {
						list: [
							{ time: 0, value: 1 },
							{ time: 1, value: 0 },
						],
					},
				},
			},
			{
				type: 'scale',
				config: {
					scale: {
						list: [
							{ time: 0, value: 0.5 },
							{ time: 1, value: 0.15 },
						],
					},
				},
			},
			{
				type: 'moveSpeed',
				config: {
					speed: {
						list: [
							{ time: 0, value: 300 },
							{ time: 1, value: 120 },
						],
					},
				},
			},
			{ type: 'rotationStatic', config: { min: 0, max: 360 } },
			{ type: 'spawnShape', config: { type: 'torus', data: { x: 0, y: 0, radius: 8 } } },
		],
	};
}

/** A fresh, empty EffectDoc (one default layer) the page seeds the in-memory state with. */
export function emptyEffectDoc(id = 'untitled-effect', name = 'Untitled Effect'): EffectDoc {
	return {
		version: EFFECT_DOC_VERSION,
		id,
		name,
		layers: [newLayer('layer-1')],
	};
}

/** A new sprite layer with the default config and no art bound yet. */
export function newLayer(key: string): EmitterLayer {
	return {
		key,
		config: defaultEmitterConfig(),
		art: { assetKey: '', frames: [] },
		placement: { space: 'free' },
		particleKind: 'sprite',
	};
}

/** Allocate a layer key unique within the doc (`layer-N`). */
export function nextLayerKey(doc: EffectDoc): string {
	let n = doc.layers.length + 1;
	const used = new Set(doc.layers.map((l) => l.key));
	while (used.has(`layer-${n}`)) n++;
	return `layer-${n}`;
}

/** The first/last value of a V3 list-property behavior (alpha, scale, moveSpeed). */
export function listEndpoints(
	config: EmitterConfigV3,
	type: 'alpha' | 'scale' | 'moveSpeed',
	prop: 'alpha' | 'scale' | 'speed',
): { start: number; end: number } | undefined {
	const b = behaviorsOf(config).find((x) => x.type === type);
	if (!b) return undefined;
	const holder = b.config[prop] as { list?: ListPoint[] } | undefined;
	const list = holder?.list;
	if (!Array.isArray(list) || list.length === 0) return undefined;
	return { start: list[0].value, end: list[list.length - 1].value };
}

/** The spawn `torus` radius (the core spawn-shape knob the inspector exposes). */
export function spawnRadius(config: EmitterConfigV3): number | undefined {
	const b = behaviorsOf(config).find((x) => x.type === 'spawnShape');
	const data = (b?.config.data as { radius?: number } | undefined) ?? undefined;
	return typeof data?.radius === 'number' ? data.radius : undefined;
}

/**
 * Return a NEW config with one core param changed — the inspector edits go through here so
 * the page can re-`init` the live emitter and re-record the doc immutably (no in-place
 * mutation of the source-of-truth doc). Pure: clones, edits, returns.
 */
export function setCoreParam(
	config: EmitterConfigV3,
	param: 'frequency' | 'maxParticles' | 'lifetimeMin' | 'lifetimeMax',
	value: number,
): EmitterConfigV3 {
	const next: EmitterConfigV3 = JSON.parse(JSON.stringify(config));
	switch (param) {
		case 'frequency':
			next.frequency = value;
			break;
		case 'maxParticles':
			next.maxParticles = value;
			break;
		case 'lifetimeMin':
			next.lifetime = { ...next.lifetime, min: value };
			break;
		case 'lifetimeMax':
			next.lifetime = { ...next.lifetime, max: value };
			break;
	}
	return next;
}

/** Set the start/end value of a list-property behavior (alpha/scale/speed) immutably. */
export function setListEndpoint(
	config: EmitterConfigV3,
	type: 'alpha' | 'scale' | 'moveSpeed',
	prop: 'alpha' | 'scale' | 'speed',
	which: 'start' | 'end',
	value: number,
): EmitterConfigV3 {
	const next: EmitterConfigV3 = JSON.parse(JSON.stringify(config));
	const b = behaviorsOf(next).find((x) => x.type === type);
	if (!b) return next;
	const holder = b.config[prop] as { list?: ListPoint[] } | undefined;
	const list = holder?.list;
	if (!Array.isArray(list) || list.length === 0) return next;
	if (which === 'start') list[0].value = value;
	else list[list.length - 1].value = value;
	return next;
}

// ---------------------------------------------------------------------------
// Placement (Tier B — Spine-attach). These mutate a layer's `placement` block
// IMMUTABLY (never `config` — placement lives OUTSIDE the verbatim library config).
// Kept pure so the harness covers the free↔bone gating + the bone-follow math.
// ---------------------------------------------------------------------------

/** Set whether a layer is `free` (scene origin) or `bone` (follows a rig bone), immutably.
 * Switching to `free` drops the bone name (a free layer has no bone); switching to `bone`
 * keeps any prior bone + offset so toggling back and forth is non-destructive. */
export function setPlacementSpace(layer: EmitterLayer, space: 'free' | 'bone'): EmitterLayer {
	if (space === 'free') {
		return { ...layer, placement: { ...layer.placement, space: 'free', bone: undefined } };
	}
	return { ...layer, placement: { ...layer.placement, space: 'bone' } };
}

/** Set the bone a `bone`-placed layer follows, immutably. */
export function setPlacementBone(layer: EmitterLayer, bone: string): EmitterLayer {
	return { ...layer, placement: { ...layer.placement, space: 'bone', bone } };
}

/** Set the placement pixel offset (added to the scene origin, or the followed bone), immutably. */
export function setPlacementOffset(
	layer: EmitterLayer,
	axis: 'x' | 'y',
	value: number,
): EmitterLayer {
	const current = layer.placement.offset ?? { x: 0, y: 0 };
	return { ...layer, placement: { ...layer.placement, offset: { ...current, [axis]: value } } };
}

/**
 * Does this layer's emitter spawn from a rig bone? True ONLY when `space === 'bone'` AND a
 * non-empty bone name is set — a `bone` layer with no bone yet still spawns at its scene
 * origin (so the preview never silently vanishes mid-edit). The stage uses this to decide
 * whether to drive `updateOwnerPos` from the live bone transform each frame.
 */
export function layerFollowsBone(layer: EmitterLayer): boolean {
	return layer.placement.space === 'bone' && !!layer.placement.bone?.trim();
}

/** A 2x3 affine matrix in PixiJS's `{ a, b, c, d, tx, ty }` shape (its `Matrix`). */
export interface Affine {
	a: number;
	b: number;
	c: number;
	d: number;
	tx: number;
	ty: number;
}

/**
 * Map a point given in Pixi WORLD coordinates into the local space of a container whose
 * world transform is `containerWorld` (i.e. `containerWorld.applyInverse(point)`), done as
 * pure arithmetic so the bone-follow math is unit-coverable WITHOUT a PixiJS `Matrix`.
 *
 * This is the load-bearing coordinate hop of Tier B: the followed bone's position resolves
 * to Pixi WORLD coords (via `spine.skeletonToPixiWorldCoordinates`), but the emitter's
 * `updateOwnerPos` is in its own CONTAINER's local space (which carries the stage pan/zoom).
 * Inverting the emitter container's world transform bridges the two, so the FX rides the
 * bone at any pan/zoom. The formula is the standard affine inverse PixiJS's `applyInverse`
 * computes (`id = 1 / (a*d - b*c)`).
 */
export function worldToContainerLocal(
	world: Affine,
	point: { x: number; y: number },
): { x: number; y: number } {
	const id = 1 / (world.a * world.d - world.b * world.c);
	const dx = point.x - world.tx;
	const dy = point.y - world.ty;
	return {
		x: world.d * id * dx - world.c * id * dy,
		y: world.a * id * dy - world.b * id * dx,
	};
}

/**
 * The emitter spawn (owner) position for a layer, in its emitter container's LOCAL space.
 *
 * - A `free` layer (or a `bone` layer with no bone resolved) spawns at the layer's authored
 *   `offset` DIRECTLY in container-local space. The emitter container is parented under the
 *   stage's centred `world`, so its local origin already IS the scene origin (the canvas
 *   centre) — the offset needs NO world→local mapping. (Mapping a global `{0,0}` here would
 *   anchor the emitter to the canvas TOP-LEFT corner instead of the centre.)
 * - A `bone` layer spawns at the followed bone's WORLD position + the authored `offset`,
 *   mapped into container-local — so the emitter rides the bone every frame at any pan/zoom.
 *
 * `boneWorld` is the bone's already-resolved Pixi WORLD position (or `null` for a free /
 * unresolved layer). Pure — the stage supplies the live bone world point + the emitter
 * container's world matrix each frame.
 */
export function emitterOwnerLocal(
	layer: EmitterLayer,
	boneWorld: { x: number; y: number } | null,
	containerWorld: Affine,
): { x: number; y: number } {
	const offset = layer.placement.offset ?? { x: 0, y: 0 };
	// Free / unresolved-bone: the offset is already in the (centred) container's local space.
	if (!boneWorld) {
		return { x: offset.x, y: offset.y };
	}
	// Bone: the bone point is in Pixi WORLD coords — map it (+offset) into container-local.
	return worldToContainerLocal(containerWorld, {
		x: boneWorld.x + offset.x,
		y: boneWorld.y + offset.y,
	});
}

/** Set the spawn torus radius immutably. */
export function setSpawnRadius(config: EmitterConfigV3, radius: number): EmitterConfigV3 {
	const next: EmitterConfigV3 = JSON.parse(JSON.stringify(config));
	const b = behaviorsOf(next).find((x) => x.type === 'spawnShape');
	if (b) {
		const data = (b.config.data as Record<string, unknown> | undefined) ?? {};
		b.config.data = { ...data, radius };
	}
	return next;
}
