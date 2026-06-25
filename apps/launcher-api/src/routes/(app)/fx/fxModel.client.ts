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
	type SpineParticleConfig,
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

// ---------------------------------------------------------------------------
// Spawn shape (the inspector's shape picker). The `@barvynkoa/particle-emitter`
// `spawnShape` behavior carries `config: { type, data }`, where `type` is the
// library's registered shape name (`'torus'` | `'rect'` | `'polygonalChain'`) and
// `data` is that shape's param block. We expose four AUTHORING shapes that all map
// onto those two library shapes — point/circle/ring are one `torus` (point = radius
// 0, ring = innerRadius > 0), rectangle is `rect`. Switching shape REWRITES only the
// `spawnShape` behavior's `type`+`data` (config is otherwise byte-identical), exactly
// like `setSpawnRadius`. Kept PURE so the harness covers the shape mapping.
// ---------------------------------------------------------------------------

/** The four authoring spawn shapes the inspector offers (a friendlier projection of the library shapes). */
export type SpawnShapeKind = 'point' | 'circle' | 'ring' | 'rectangle';

/** The library `torus` shape data (circle/ring/point all share it). */
interface TorusData {
	x: number;
	y: number;
	radius: number;
	innerRadius?: number;
}

/** The library `rect` shape data. We author it CENTRED, so `x`/`y` are the top-left = `-w/2`/`-h/2`. */
interface RectData {
	x: number;
	y: number;
	w: number;
	h: number;
}

/**
 * Read the authoring shape + its params out of a config's `spawnShape` behavior. Returns
 * `undefined` when there is no `spawnShape` behavior (a config that never had one). A `torus`
 * with `innerRadius > 0` reads as a `ring`, `radius === 0` as a `point`, otherwise a `circle`;
 * a `rect` reads as a `rectangle` (width/height recovered from its `w`/`h`).
 */
export function spawnShape(config: EmitterConfigV3):
	| {
			kind: SpawnShapeKind;
			x: number;
			y: number;
			radius: number;
			innerRadius: number;
			width: number;
			height: number;
	  }
	| undefined {
	const b = behaviorsOf(config).find((x) => x.type === 'spawnShape');
	if (!b) return undefined;
	const type = b.config.type as string | undefined;
	const data = (b.config.data as Record<string, unknown> | undefined) ?? {};
	const numAt = (k: string, fallback = 0): number =>
		typeof data[k] === 'number' ? (data[k] as number) : fallback;
	if (type === 'rect') {
		const width = numAt('w');
		const height = numAt('h');
		return { kind: 'rectangle', x: 0, y: 0, radius: 0, innerRadius: 0, width, height };
	}
	// Default + everything else: treat as a torus (circle / ring / point).
	const x = numAt('x');
	const y = numAt('y');
	const radius = numAt('radius');
	const innerRadius = numAt('innerRadius');
	const kind: SpawnShapeKind = radius === 0 ? 'point' : innerRadius > 0 ? 'ring' : 'circle';
	return { kind, x, y, radius, innerRadius, width: 0, height: 0 };
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

/**
 * Replace (or add) the `spawnShape` behavior immutably with the library `{ type, data }` for the
 * given config. The ONLY behavior touched is `spawnShape`; everything else is byte-identical. If no
 * `spawnShape` behavior exists, one is APPENDED (a config without one degrades gracefully — the
 * picker can introduce it). Centre `x`/`y` are carried so a shape sits over the emitter origin.
 */
function writeSpawnShape(
	config: EmitterConfigV3,
	type: 'torus' | 'rect',
	data: TorusData | RectData,
): EmitterConfigV3 {
	const next: EmitterConfigV3 = JSON.parse(JSON.stringify(config));
	const behaviors = behaviorsOf(next);
	const b = behaviors.find((x) => x.type === 'spawnShape');
	if (b) {
		b.config.type = type;
		b.config.data = data;
	} else {
		behaviors.push({ type: 'spawnShape', config: { type, data } });
	}
	return next;
}

/**
 * Switch the authoring spawn shape immutably, preserving any params shared with the prior shape
 * (centre, radius, inner radius, width/height) so toggling between shapes is non-destructive:
 * - `point`    → `torus` radius 0
 * - `circle`   → `torus` radius R (innerRadius 0)
 * - `ring`     → `torus` radius R + innerRadius r (defaulting to a sensible inner if none yet)
 * - `rectangle`→ `rect` centred (x/y = -w/2, -h/2) of width/height
 * The current params are read from the existing `spawnShape` (or defaults if absent).
 */
export function setSpawnShape(config: EmitterConfigV3, kind: SpawnShapeKind): EmitterConfigV3 {
	const cur = spawnShape(config);
	const x = cur?.x ?? 0;
	const y = cur?.y ?? 0;
	const radius = cur && cur.radius > 0 ? cur.radius : 32;
	const inner = cur && cur.innerRadius > 0 ? cur.innerRadius : Math.max(1, Math.round(radius / 2));
	const width = cur && cur.width > 0 ? cur.width : 64;
	const height = cur && cur.height > 0 ? cur.height : 64;
	switch (kind) {
		case 'point':
			return writeSpawnShape(config, 'torus', { x, y, radius: 0 });
		case 'circle':
			return writeSpawnShape(config, 'torus', { x, y, radius });
		case 'ring':
			return writeSpawnShape(config, 'torus', { x, y, radius, innerRadius: inner });
		case 'rectangle':
			return setSpawnRect(config, width, height);
	}
}

/** Set a `ring` spawn shape's inner + outer radius immutably (forces `torus`, keeps the centre). */
export function setSpawnRing(
	config: EmitterConfigV3,
	radius: number,
	innerRadius: number,
): EmitterConfigV3 {
	const cur = spawnShape(config);
	return writeSpawnShape(config, 'torus', {
		x: cur?.x ?? 0,
		y: cur?.y ?? 0,
		radius,
		innerRadius,
	});
}

/**
 * Set a `rectangle` spawn shape's width + height immutably, CENTRED on the emitter origin (the
 * library `rect` is top-left anchored, so `x`/`y` = `-w/2`/`-h/2`). Forces `rect`.
 */
export function setSpawnRect(
	config: EmitterConfigV3,
	width: number,
	height: number,
): EmitterConfigV3 {
	return writeSpawnShape(config, 'rect', {
		x: -width / 2,
		y: -height / 2,
		w: width,
		h: height,
	});
}

// ---------------------------------------------------------------------------
// Trigger (Phase 4 — Flow seam). These mutate a layer's `trigger` block IMMUTABLY
// (never `config` — the trigger lives OUTSIDE the verbatim library config). Flow owns
// "when" by default (§4.4/§9): `on:'always'` is the only self-contained case (ambient FX);
// `on:'event'` binds to a `type` from the game's `EmitterVocabulary` so a Flow Broadcast
// node is the fire button. Kept pure so the harness covers the always↔event gating and the
// save→reopen survival of an authored trigger.
// ---------------------------------------------------------------------------

/**
 * Set whether a layer fires `always` (ambient) or on an `event`, immutably. Switching to
 * `always` DROPS `eventType`/`duration` (an ambient layer has no event binding — mirrors how
 * `setPlacementSpace('free')` drops the bone); switching to `event` keeps any prior
 * `eventType`/`duration` so toggling back and forth is non-destructive.
 */
export function setTriggerMode(layer: EmitterLayer, on: 'always' | 'event'): EmitterLayer {
	if (on === 'always') {
		return { ...layer, trigger: { on: 'always' } };
	}
	const prev = layer.trigger;
	const trigger: EmitterLayer['trigger'] = { on: 'event' };
	if (prev?.eventType) trigger.eventType = prev.eventType;
	if (prev?.duration !== undefined) trigger.duration = prev.duration;
	return { ...layer, trigger };
}

/**
 * Set the bus `type` an `event`-triggered layer fires on, immutably. Forces `on:'event'` (a
 * layer can't carry an `eventType` while ambient). An empty value clears the binding (the
 * layer stays `event` but dormant — it can never fire, the fail-safe).
 */
export function setTriggerEvent(layer: EmitterLayer, eventType: string): EmitterLayer {
	const clean = eventType.trim();
	const trigger: EmitterLayer['trigger'] = { on: 'event' };
	if (clean) trigger.eventType = clean;
	if (layer.trigger?.duration !== undefined) trigger.duration = layer.trigger.duration;
	return { ...layer, trigger };
}

/**
 * Set the emit `duration` (ms) of an `event`-triggered layer immutably — emit for N ms then
 * stop. A non-finite/blank value (NaN) CLEARS the duration so the config's `emitterLifetime`
 * governs the burst instead. Forces `on:'event'` (duration is meaningless for ambient).
 */
export function setTriggerDuration(layer: EmitterLayer, duration: number): EmitterLayer {
	const trigger: EmitterLayer['trigger'] = { on: 'event' };
	if (layer.trigger?.eventType) trigger.eventType = layer.trigger.eventType;
	if (Number.isFinite(duration)) trigger.duration = duration;
	return { ...layer, trigger };
}

/** The layer's trigger mode for the inspector readout (no trigger ⇒ `always`, the ambient default). */
export function triggerMode(layer: EmitterLayer): 'always' | 'event' {
	return layer.trigger?.on === 'event' ? 'event' : 'always';
}

// ---------------------------------------------------------------------------
// Particle kind (Tier C — spine-clips-AS-particles). These mutate a layer's
// `particleKind` + `spineParticle` block IMMUTABLY (never `config`, never `art`/`placement`/
// `trigger`). `sprite` (Tiers A/B) binds atlas-region textures; `spine` pools `Spine`
// instances each playing a clip (the Phase-0 native verdict). Kept pure so the harness
// covers the sprite↔spine non-destructive switch + the spine-particle setters.
// ---------------------------------------------------------------------------

/**
 * Set whether a layer's particles are `sprite` (atlas art) or `spine` (pooled `Spine` clips),
 * immutably. NON-DESTRUCTIVE: switching to `spine` keeps any prior `spineParticle` (so a toggle
 * back and forth preserves the skeleton/clip/loop), and switching to `sprite` LEAVES the
 * `spineParticle` block in place too (the runtime + `normalizeEffectDoc` both ignore it for a
 * `sprite` layer, so it's a dormant draft the author can return to — mirrors how
 * `setPlacementSpace('bone')` keeps a prior bone). Only `particleKind` flips. The author's atlas
 * `art` is untouched either way, so the sprite path is byte-identical when toggled back.
 */
export function setParticleKind(layer: EmitterLayer, kind: 'sprite' | 'spine'): EmitterLayer {
	if (layer.particleKind === kind) return layer;
	return { ...layer, particleKind: kind };
}

/**
 * Set the loaded skeleton bundle key a `spine`-particle layer pools, immutably. Forces
 * `particleKind: 'spine'` (a skeleton binding is meaningless for a sprite layer). Keeps any prior
 * `animation`/`loop`. An empty key clears the binding (the layer stays `spine` but renders nothing
 * — the fail-safe, mirroring an `event` layer with no `eventType`).
 */
export function setSpineParticleSkeleton(layer: EmitterLayer, skeletonKey: string): EmitterLayer {
	const clean = skeletonKey.trim();
	const prev = layer.spineParticle;
	const spineParticle: SpineParticleConfig = {
		skeletonKey: clean,
		animation: prev?.animation ?? '',
	};
	if (prev?.loop !== undefined) spineParticle.loop = prev.loop;
	return { ...layer, particleKind: 'spine', spineParticle };
}

/**
 * Set the clip each pooled particle skeleton plays, immutably. Forces `particleKind: 'spine'`;
 * keeps any prior `skeletonKey`/`loop`. An empty clip clears the animation (the layer stays
 * `spine` but pools static poses — never throws).
 */
export function setSpineParticleAnimation(layer: EmitterLayer, animation: string): EmitterLayer {
	const prev = layer.spineParticle;
	const spineParticle: SpineParticleConfig = {
		skeletonKey: prev?.skeletonKey ?? '',
		animation: animation.trim(),
	};
	if (prev?.loop !== undefined) spineParticle.loop = prev.loop;
	return { ...layer, particleKind: 'spine', spineParticle };
}

/**
 * Set whether each particle's clip loops, immutably. Forces `particleKind: 'spine'`; keeps the
 * prior `skeletonKey`/`animation`.
 */
export function setSpineParticleLoop(layer: EmitterLayer, loop: boolean): EmitterLayer {
	const prev = layer.spineParticle;
	const spineParticle: SpineParticleConfig = {
		skeletonKey: prev?.skeletonKey ?? '',
		animation: prev?.animation ?? '',
		loop,
	};
	return { ...layer, particleKind: 'spine', spineParticle };
}

/**
 * Whether a `spine`-particle layer is fully bound (a skeleton AND a clip chosen). The stage uses
 * this to decide whether to pool real `Spine` instances or fall through to the placeholder dots —
 * a half-authored spine layer never crashes (the fail-safe analogue of `layerFollowsBone`).
 */
export function spineParticleReady(layer: EmitterLayer): boolean {
	return (
		layer.particleKind === 'spine' &&
		!!layer.spineParticle?.skeletonKey?.trim() &&
		!!layer.spineParticle?.animation?.trim()
	);
}
