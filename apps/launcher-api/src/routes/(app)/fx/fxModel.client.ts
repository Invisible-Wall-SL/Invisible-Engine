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
	FX_ALPHA_BEHAVIOR_TYPE,
	FX_COLOR_OVERLAY_BEHAVIOR_TYPE,
	FX_SCALE_BEHAVIOR_TYPE,
	FX_SPEED_BEHAVIOR_TYPE,
	behaviorsOf,
	type BehaviorEntry,
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

/**
 * The sentinel id a brand-new (never-saved) effect carries. While the doc still holds this id,
 * Save keys the R2 file stem off the effect's NAME (so distinct names save to distinct files);
 * once saved/opened the id is the stable server-slugged stem and a rename relabels in place.
 */
export const UNTITLED_EFFECT_ID = 'untitled-effect';

/** A fresh, empty EffectDoc (one default layer) the page seeds the in-memory state with. */
export function emptyEffectDoc(id = UNTITLED_EFFECT_ID, name = 'Untitled Effect'): EffectDoc {
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

// ---------------------------------------------------------------------------
// Art MIX weights (a static multi-frame layer's per-frame spawn share). The
// weights are RELATIVE (parallel to `art.frames`); the runtime/preview realise
// them by repeating a frame's texture proportionally (see `bindArt`). These
// helpers keep the array aligned to `frames` and expose a normalized-% readout.
// ---------------------------------------------------------------------------

/** The effective relative weights for a layer's frames — the stored array when it's clean +
 * aligned, else a uniform `1` per frame. Always length === `frames.length`. */
export function frameWeights(layer: EmitterLayer): number[] {
	const n = layer.art.frames.length;
	const w = layer.art.weights;
	if (
		Array.isArray(w) &&
		w.length === n &&
		w.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0) &&
		w.some((x) => x > 0)
	) {
		return w.slice();
	}
	return new Array(n).fill(1);
}

/** The mix as PERCENTAGES (each frame's normalized share, summing ~100) for the inspector readout. */
export function frameMixPercents(layer: EmitterLayer): number[] {
	const w = frameWeights(layer);
	const sum = w.reduce((a, b) => a + b, 0) || 1;
	return w.map((x) => (x / sum) * 100);
}

/** The raw slider values for the Mix control: the STORED weights when present, else the equal
 * normalized percentages — so the sliders start on a sensible 0–100 scale (each frame's share)
 * even before any weight has been authored. */
export function frameWeightInputs(layer: EmitterLayer): number[] {
	const stored = layer.art.weights;
	if (Array.isArray(stored) && stored.length === layer.art.frames.length) return stored.slice();
	return frameMixPercents(layer);
}

/** Set one frame's mix weight immutably. The base is the current slider scale (stored weights, or
 * the equal percentages) so dragging one frame reads intuitively against the others. A frame not in
 * `art.frames` is a no-op; negatives clamp to 0 (that frame drops out of the mix). */
export function setFrameWeight(layer: EmitterLayer, frame: string, weight: number): EmitterLayer {
	const idx = layer.art.frames.indexOf(frame);
	if (idx === -1) return layer;
	const weights = frameWeightInputs(layer);
	weights[idx] = Math.max(0, Number.isFinite(weight) ? weight : 0);
	return { ...layer, art: { ...layer.art, weights } };
}

/** Toggle a frame in a layer's `art.frames`, keeping any `weights` array aligned (a new frame
 * inherits the current average share; a removed frame drops its slot; art `weights` is cleared
 * when it falls back to a single frame). Pure — the page calls this for the region checkboxes. */
export function toggleArtFrame(layer: EmitterLayer, frame: string): EmitterLayer {
	const frames = layer.art.frames;
	const have = frames.includes(frame);
	const nextFrames = have ? frames.filter((f) => f !== frame) : [...frames, frame];
	let weights = layer.art.weights;
	if (Array.isArray(weights) && weights.length === frames.length) {
		if (have) {
			const idx = frames.indexOf(frame);
			weights = weights.filter((_, i) => i !== idx);
		} else {
			const avg = weights.length ? weights.reduce((a, b) => a + b, 0) / weights.length : 1;
			weights = [...weights, avg];
		}
	} else {
		weights = undefined;
	}
	const art = { ...layer.art, frames: nextFrames } as EmitterLayer['art'];
	if (nextFrames.length > 1 && weights) art.weights = weights;
	else delete art.weights;
	return { ...layer, art };
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
	const v = Number.isFinite(value) ? value : 0;
	switch (param) {
		case 'frequency':
			// 0 ⇒ infinite spawns per frame; keep a small positive floor.
			next.frequency = Math.max(0.001, v);
			break;
		case 'maxParticles':
			next.maxParticles = Math.max(1, Math.round(v));
			break;
		case 'lifetimeMin': {
			// A particle whose lifetime is 0 makes the library's age/lifetime lerp Infinity, which
			// walks an alpha/scale/speed curve off its end and throws (null.time) — clamp > 0.
			const min = Math.max(MIN_LIFETIME, v);
			next.lifetime = { ...next.lifetime, min, max: Math.max(next.lifetime.max, min) };
			break;
		}
		case 'lifetimeMax': {
			const max = Math.max(MIN_LIFETIME, v);
			next.lifetime = { ...next.lifetime, max, min: Math.min(next.lifetime.min, max) };
			break;
		}
	}
	return next;
}

/** A particle must live a non-zero time — 0 ⇒ Infinity interpolation ⇒ the library throws. */
const MIN_LIFETIME = 0.01;

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
	if (prev?.stopEventType) trigger.stopEventType = prev.stopEventType;
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
	if (layer.trigger?.stopEventType) trigger.stopEventType = layer.trigger.stopEventType;
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
	if (layer.trigger?.stopEventType) trigger.stopEventType = layer.trigger.stopEventType;
	return { ...layer, trigger };
}

/**
 * Set the SECOND cue that STOPS an `event`-triggered layer, immutably — fire on `eventType`, keep
 * emitting, stop on this cue (for a continuous effect Flow switches off). Forces `on:'event'`; keeps
 * the prior `eventType`/`duration`. An empty value CLEARS the stop cue (the layer then stops by
 * `duration` / the config's `emitterLifetime` only). A value equal to the fire cue is dropped at
 * runtime (`layerTrigger`) — a cue can't both start and stop.
 */
export function setTriggerStopEvent(layer: EmitterLayer, stopEvent: string): EmitterLayer {
	const clean = stopEvent.trim();
	const trigger: EmitterLayer['trigger'] = { on: 'event' };
	if (layer.trigger?.eventType) trigger.eventType = layer.trigger.eventType;
	if (layer.trigger?.duration !== undefined) trigger.duration = layer.trigger.duration;
	if (clean) trigger.stopEventType = clean;
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

// ===========================================================================
// Advanced emitter behaviors — the "professional FX" authoring surface.
//
// Each helper reads/writes ONE `@barvynkoa/particle-emitter` behavior in the
// config's verbatim `behaviors` array, the same immutable-clone discipline the
// spawn-shape/list-endpoint setters above use (clone → edit → return; never
// mutate the source). The behavior `type` strings + config shapes are the
// library's own (verified against its `behaviors/*.d.ts` example configs:
// `moveAcceleration`, `rotation`/`rotationStatic`, `color`, `blendMode`), so a
// saved config round-trips into the runtime `<ParticleEmitter>` untouched —
// these are NOT a new schema, just more of the existing one exposed.
// ===========================================================================

/** Deep-clone a config so an edit is immutable (the source-of-truth doc is never mutated). */
function cloneConfig(config: EmitterConfigV3): EmitterConfigV3 {
	return JSON.parse(JSON.stringify(config));
}

/** Replace the config's `behaviors` array on a (cloned) config. */
function withBehaviors(config: EmitterConfigV3, behaviors: BehaviorEntry[]): EmitterConfigV3 {
	(config as { behaviors: BehaviorEntry[] }).behaviors = behaviors;
	return config;
}

/** Drop every behavior of the given type(s) immutably (returns a NEW config). */
function removeBehaviors(config: EmitterConfigV3, ...types: string[]): EmitterConfigV3 {
	const next = cloneConfig(config);
	const drop = new Set(types);
	return withBehaviors(
		next,
		behaviorsOf(next).filter((b) => !drop.has(b.type)),
	);
}

/**
 * Upsert a behavior immutably: if one of `type` exists, hand it to `edit` to mutate its config
 * in place (on the clone); otherwise append `{ type, config: make() }`. Returns a NEW config.
 */
function upsertBehavior(
	config: EmitterConfigV3,
	type: string,
	make: () => Record<string, unknown>,
	edit?: (b: BehaviorEntry) => void,
): EmitterConfigV3 {
	const next = cloneConfig(config);
	const behaviors = behaviorsOf(next);
	const existing = behaviors.find((b) => b.type === type);
	if (existing) {
		edit?.(existing);
	} else {
		behaviors.push({ type, config: make() });
	}
	return withBehaviors(next, behaviors);
}

// ---------------------------------------------------------------------------
// Emission direction + spread, and particle spin.
//
// `@barvynkoa/particle-emitter` gives a particle its launch DIRECTION via a
// rotation behavior — `rotationStatic { min, max }` (no spin) or `rotation
// { minStart, maxStart, minSpeed, maxSpeed, accel }` (with spin). Both speak
// the library's angle convention: **0° = right, 90° = up, 180° = left, 270° =
// down.** The MOVEMENT behavior (`moveSpeed` / `moveAcceleration`) then pushes
// the particle along that direction — so direction + a gravity model = a
// fountain. We author direction as CENTRE + SPREAD (half-angle), the natural
// FX knobs, and project them onto the behavior's min/max angles.
// ---------------------------------------------------------------------------

/** Find the single rotation behavior driving emission direction (`rotation` or `rotationStatic`). */
function rotationBehavior(config: EmitterConfigV3): BehaviorEntry | undefined {
	return behaviorsOf(config).find((b) => b.type === 'rotation' || b.type === 'rotationStatic');
}

/** Read the start-angle min/max out of whichever rotation behavior is present. */
function rotationStartRange(b: BehaviorEntry): { min: number; max: number } {
	const c = b.config;
	if (b.type === 'rotation') {
		return { min: Number(c.minStart ?? 0), max: Number(c.maxStart ?? 0) };
	}
	return { min: Number(c.min ?? 0), max: Number(c.max ?? 0) };
}

/**
 * The emission CENTRE (degrees) + SPREAD (half-angle, degrees) read from the config's rotation
 * behavior. `undefined` when the config has no rotation behavior (degrades gracefully). A full
 * `0..360` static rotation reads as centre 180 / spread 180 (omnidirectional).
 */
export function emissionArc(
	config: EmitterConfigV3,
): { center: number; spread: number } | undefined {
	const b = rotationBehavior(config);
	if (!b) return undefined;
	const { min, max } = rotationStartRange(b);
	return { center: (min + max) / 2, spread: Math.abs(max - min) / 2 };
}

/**
 * Set the emission centre + spread immutably, writing min = centre − spread / max = centre + spread
 * into whichever rotation behavior exists (preserving any spin on a `rotation`); if none exists, a
 * `rotationStatic` is appended. ONLY the rotation behavior changes.
 */
export function setEmissionArc(
	config: EmitterConfigV3,
	center: number,
	spread: number,
): EmitterConfigV3 {
	const min = center - spread;
	const max = center + spread;
	const b = rotationBehavior(config);
	const type = b?.type ?? 'rotationStatic';
	return upsertBehavior(
		config,
		type,
		() => ({ min, max }),
		(entry) => {
			if (entry.type === 'rotation') {
				entry.config.minStart = min;
				entry.config.maxStart = max;
			} else {
				entry.config.min = min;
				entry.config.max = max;
			}
		},
	);
}

/** The particle spin (rotation-over-life) read from a `rotation` behavior — all zero for `rotationStatic`. */
export function particleSpin(config: EmitterConfigV3): {
	minSpeed: number;
	maxSpeed: number;
	accel: number;
} {
	const b = rotationBehavior(config);
	if (!b || b.type !== 'rotation') return { minSpeed: 0, maxSpeed: 0, accel: 0 };
	return {
		minSpeed: Number(b.config.minSpeed ?? 0),
		maxSpeed: Number(b.config.maxSpeed ?? 0),
		accel: Number(b.config.accel ?? 0),
	};
}

/**
 * Set particle spin immutably. When all of min/max speed + accel are zero we DOWNGRADE to the
 * lighter `rotationStatic` (direction only); any non-zero spin UPGRADES to `rotation`, carrying
 * the existing emission arc across so the launch direction is preserved. The two rotation
 * behaviors never coexist — exactly one drives both direction and spin.
 */
export function setParticleSpin(
	config: EmitterConfigV3,
	spin: { minSpeed: number; maxSpeed: number; accel: number },
): EmitterConfigV3 {
	const arc = emissionArc(config) ?? { center: 180, spread: 180 };
	const min = arc.center - arc.spread;
	const max = arc.center + arc.spread;
	const stripped = removeBehaviors(config, 'rotation', 'rotationStatic');
	const spinning = spin.minSpeed !== 0 || spin.maxSpeed !== 0 || spin.accel !== 0;
	const next = cloneConfig(stripped);
	const behaviors = behaviorsOf(next);
	behaviors.push(
		spinning
			? {
					type: 'rotation',
					config: {
						minStart: min,
						maxStart: max,
						minSpeed: spin.minSpeed,
						maxSpeed: spin.maxSpeed,
						accel: spin.accel,
					},
				}
			: { type: 'rotationStatic', config: { min, max } },
	);
	return withBehaviors(next, behaviors);
}

// ---------------------------------------------------------------------------
// Burst spawn — a fifth spawn KIND (explosions, fireworks, coin pops).
//
// `spawnBurst` sends particles out in evenly-spaced angles from a point or
// ring. It is a SPAWN-position behavior like `spawnShape`, and the two have no
// defined order between them in the library — so they are MUTUALLY EXCLUSIVE
// (exactly one spawn-position behavior). Critically, `spawnBurst` also SETS each
// particle's launch `rotation` (its fan angle), and runs FIRST (order Spawn);
// the `rotation`/`rotationStatic` behaviors run later (order Normal) and `+=`
// onto it — so an omnidirectional `rotationStatic{0,360}` would randomize the
// burst back into a plain spray. Therefore burst OWNS direction: selecting it
// strips the rotation behavior (the Emission section hides), and switching back
// to a shape restores an omnidirectional `rotationStatic` so movement has a
// direction again. `setSpawnKind` is the single switch that keeps this invariant.
// ---------------------------------------------------------------------------

/** Every authoring spawn kind: the four shapes plus the burst emitter. */
export type SpawnKind = SpawnShapeKind | 'burst';

/** Default burst params for a fresh burst — a fine, even ring fan from the origin. */
function defaultBurst(): Record<string, unknown> {
	return { spacing: 30, start: 0, distance: 0 };
}

/** The burst params (`undefined` when the config has no `spawnBurst` behavior). */
export function burst(
	config: EmitterConfigV3,
): { spacing: number; start: number; distance: number } | undefined {
	const b = behaviorsOf(config).find((x) => x.type === 'spawnBurst');
	if (!b) return undefined;
	return {
		spacing: Number(b.config.spacing ?? 0),
		start: Number(b.config.start ?? 0),
		distance: Number(b.config.distance ?? 0),
	};
}

/**
 * The active spawn kind: `'burst'` when a `spawnBurst` behavior is present, otherwise the
 * `spawnShape` kind (point/circle/ring/rectangle), or `undefined` for a config with neither.
 */
export function spawnKind(config: EmitterConfigV3): SpawnKind | undefined {
	if (behaviorsOf(config).some((b) => b.type === 'spawnBurst')) return 'burst';
	return spawnShape(config)?.kind;
}

/**
 * Switch the spawn kind immutably, keeping exactly one spawn-position behavior:
 * - `'burst'` → drop `spawnShape` + BOTH rotation behaviors, add `spawnBurst` (preserving any
 *   prior burst params). Burst owns direction, so the Emission controls drop out.
 * - a shape → drop `spawnBurst`; if no rotation behavior remains (e.g. coming back FROM burst),
 *   restore an omnidirectional `rotationStatic` so movement has a launch direction again; then
 *   write the shape via `setSpawnShape` (params preserved / defaulted exactly as before).
 */
export function setSpawnKind(config: EmitterConfigV3, kind: SpawnKind): EmitterConfigV3 {
	if (kind === 'burst') {
		const prior = burst(config);
		const stripped = removeBehaviors(config, 'spawnShape', 'rotation', 'rotationStatic');
		return upsertBehavior(
			stripped,
			'spawnBurst',
			() => (prior as Record<string, unknown> | undefined) ?? defaultBurst(),
		);
	}
	let next = removeBehaviors(config, 'spawnBurst');
	if (!rotationBehavior(next)) {
		const seeded = cloneConfig(next);
		behaviorsOf(seeded).push({ type: 'rotationStatic', config: { min: 0, max: 360 } });
		next = seeded;
	}
	return setSpawnShape(next, kind);
}

/** Set one burst field immutably (forces a `spawnBurst` behavior, stripping any `spawnShape`/rotation). */
export function setBurst(
	config: EmitterConfigV3,
	field: 'spacing' | 'start' | 'distance',
	value: number,
): EmitterConfigV3 {
	const seeded = burst(config) ? config : setSpawnKind(config, 'burst');
	return upsertBehavior(
		seeded,
		'spawnBurst',
		() => ({ ...defaultBurst(), [field]: value }),
		(b) => {
			b.config[field] = value;
		},
	);
}

// ---------------------------------------------------------------------------
// Movement model — eased speed vs gravity (acceleration).
//
// `moveSpeed` (a speed curve along the launch direction) and `moveAcceleration`
// (an initial speed + a constant acceleration vector — GRAVITY) are BOTH the
// library's Movement behavior and are mutually exclusive (two would double-move
// a particle). So the inspector models movement as a MODE: switching swaps one
// behavior for the other, carrying a sensible start speed across.
// ---------------------------------------------------------------------------

export type MovementModel = 'speed' | 'gravity';

/** Which movement behavior the config carries (`moveAcceleration` ⇒ gravity, else eased speed). */
export function movementModel(config: EmitterConfigV3): MovementModel {
	return behaviorsOf(config).some((b) => b.type === 'moveAcceleration') ? 'gravity' : 'speed';
}

/** The gravity params read from a `moveAcceleration` behavior (`undefined` in the speed model). */
export function gravity(config: EmitterConfigV3):
	| {
			accelX: number;
			accelY: number;
			minStart: number;
			maxStart: number;
			maxSpeed: number;
			rotate: boolean;
	  }
	| undefined {
	const b = behaviorsOf(config).find((x) => x.type === 'moveAcceleration');
	if (!b) return undefined;
	const accel = (b.config.accel as { x?: number; y?: number } | undefined) ?? {};
	return {
		accelX: Number(accel.x ?? 0),
		accelY: Number(accel.y ?? 0),
		minStart: Number(b.config.minStart ?? 0),
		maxStart: Number(b.config.maxStart ?? 0),
		maxSpeed: Number(b.config.maxSpeed ?? 0),
		rotate: b.config.rotate === true,
	};
}

/** The default gravity block when first switching into the gravity model — a downward fall. */
function defaultGravity(startSpeed: number): Record<string, unknown> {
	return {
		accel: { x: 0, y: 1200 },
		minStart: startSpeed,
		maxStart: startSpeed,
		rotate: false,
		maxSpeed: 0,
	};
}

/** The default eased-speed block when first switching into the speed model. */
function defaultSpeed(startSpeed: number): Record<string, unknown> {
	return {
		speed: {
			list: [
				{ time: 0, value: startSpeed },
				{ time: 1, value: Math.round(startSpeed * 0.4) },
			],
		},
		minMult: 1,
	};
}

/**
 * Switch the movement model immutably, swapping `moveSpeed` ⇄ `moveAcceleration`. The start speed
 * is carried across (the speed curve's first value ⇄ the acceleration's start speed) so the toggle
 * is roughly volume-preserving. A no-op when already in the requested model.
 */
export function setMovementModel(config: EmitterConfigV3, model: MovementModel): EmitterConfigV3 {
	if (movementModel(config) === model) return config;
	if (model === 'gravity') {
		// `curveRange`, not `listEndpoints`: the latter matches the stock `moveSpeed` type only and
		// would miss a speed curve that variation has swapped to `fxSpeed`, silently carrying 300.
		const speed = curveRange(config, 'speed');
		const startSpeed = speed ? speed.startMax : 300;
		const stripped = removeBehaviors(
			config,
			'moveSpeed',
			'moveSpeedStatic',
			FX_SPEED_BEHAVIOR_TYPE,
		);
		const next = cloneConfig(stripped);
		behaviorsOf(next).push({ type: 'moveAcceleration', config: defaultGravity(startSpeed) });
		return next;
	}
	const g = gravity(config);
	const startSpeed = g ? g.minStart || 300 : 300;
	const stripped = removeBehaviors(config, 'moveAcceleration');
	const next = cloneConfig(stripped);
	behaviorsOf(next).push({ type: 'moveSpeed', config: defaultSpeed(startSpeed) });
	return next;
}

/** Set one gravity field immutably (forces the gravity model — adds `moveAcceleration` if absent). */
export function setGravity(
	config: EmitterConfigV3,
	field: 'accelX' | 'accelY' | 'minStart' | 'maxStart' | 'maxSpeed' | 'rotate',
	value: number | boolean,
): EmitterConfigV3 {
	const seeded = movementModel(config) === 'gravity' ? config : setMovementModel(config, 'gravity');
	return upsertBehavior(
		seeded,
		'moveAcceleration',
		() => defaultGravity(300),
		(b) => {
			const accel = (b.config.accel as { x?: number; y?: number } | undefined) ?? { x: 0, y: 0 };
			switch (field) {
				case 'accelX':
					b.config.accel = { ...accel, x: Number(value) };
					break;
				case 'accelY':
					b.config.accel = { ...accel, y: Number(value) };
					break;
				case 'rotate':
					b.config.rotate = value === true;
					break;
				default:
					b.config[field] = Number(value);
			}
		},
	);
}

// ---------------------------------------------------------------------------
// Colour over life (tint) + blend mode.
//
// `color` applies an interpolated tint across the particle's life (6-digit hex
// in the library's `ValueList<string>`); `blendMode` sets the Pixi blend at
// init (`add`/`screen` give the additive GLOW that fire/sparks/magic want).
// ---------------------------------------------------------------------------

/** The start/end tint of a `color` behavior, or `undefined` when the layer has no colour behavior. */
export function particleColor(config: EmitterConfigV3): { start: string; end: string } | undefined {
	const b = behaviorsOf(config).find((x) => x.type === 'color');
	const list = (b?.config.color as { list?: { value: string }[] } | undefined)?.list;
	if (!Array.isArray(list) || list.length === 0) return undefined;
	return { start: list[0].value, end: list[list.length - 1].value };
}

/** Enable/disable the colour tint immutably. Enabling seeds a gentle warm gradient as a starting point. */
export function setColorEnabled(config: EmitterConfigV3, on: boolean): EmitterConfigV3 {
	if (!on) return removeBehaviors(config, 'color');
	if (particleColor(config)) return config;
	const next = cloneConfig(config);
	behaviorsOf(next).push({
		type: 'color',
		config: {
			color: {
				list: [
					{ time: 0, value: '#fff1a8' },
					{ time: 1, value: '#ff5a3c' },
				],
			},
		},
	});
	return next;
}

/** Set the start or end tint of the `color` behavior immutably (adds the behavior if absent). */
export function setParticleColor(
	config: EmitterConfigV3,
	which: 'start' | 'end',
	hex: string,
): EmitterConfigV3 {
	const seeded = particleColor(config) ? config : setColorEnabled(config, true);
	return upsertBehavior(
		seeded,
		'color',
		() => ({ color: { list: [{ time: 0, value: hex }] } }),
		(b) => {
			const holder = b.config.color as { list?: { time: number; value: string }[] } | undefined;
			const list = holder?.list;
			if (!Array.isArray(list) || list.length === 0) return;
			if (which === 'start') list[0].value = hex;
			else list[list.length - 1].value = hex;
		},
	);
}

/** The four blend modes the inspector offers (`normal` = no `blendMode` behavior, the clean default). */
export type BlendKind = 'normal' | 'add' | 'screen' | 'multiply';

/** The layer's blend mode (`normal` when no `blendMode` behavior is present). */
export function blendMode(config: EmitterConfigV3): BlendKind {
	const b = behaviorsOf(config).find((x) => x.type === 'blendMode');
	const mode = b?.config.blendMode;
	return mode === 'add' || mode === 'screen' || mode === 'multiply' ? mode : 'normal';
}

/**
 * Set the blend mode immutably. `normal` REMOVES the `blendMode` behavior (keeps the config clean
 * — normal is the library default), any other mode upserts it.
 */
export function setBlendMode(config: EmitterConfigV3, mode: BlendKind): EmitterConfigV3 {
	if (mode === 'normal') return removeBehaviors(config, 'blendMode');
	return upsertBehavior(
		config,
		'blendMode',
		() => ({ blendMode: mode }),
		(b) => {
			b.config.blendMode = mode;
		},
	);
}

// ---------------------------------------------------------------------------
// Preset library — full, known-good configs the author can drop in then tune.
//
// Each preset BUILDS a complete `EmitterConfigV3` (the library's verbatim shape),
// so `applyPreset` replaces a layer's `config` while keeping its art / placement
// / trigger. They're the fast path to a professional look — and a live demo of
// every knob above (direction, gravity, colour, blend). All use a `torus` spawn
// shape so the spawn-shape picker stays consistent after applying one.
// ---------------------------------------------------------------------------

const alpha = (start: number, end: number): BehaviorEntry => ({
	type: 'alpha',
	config: {
		alpha: {
			list: [
				{ time: 0, value: start },
				{ time: 1, value: end },
			],
		},
	},
});
const scale = (start: number, end: number): BehaviorEntry => ({
	type: 'scale',
	config: {
		scale: {
			list: [
				{ time: 0, value: start },
				{ time: 1, value: end },
			],
		},
	},
});
const colorList = (start: string, end: string): BehaviorEntry => ({
	type: 'color',
	config: {
		color: {
			list: [
				{ time: 0, value: start },
				{ time: 1, value: end },
			],
		},
	},
});
const torus = (radius: number, innerRadius?: number): BehaviorEntry => ({
	type: 'spawnShape',
	config: {
		type: 'torus',
		data: innerRadius ? { x: 0, y: 0, radius, innerRadius } : { x: 0, y: 0, radius },
	},
});
const rotStatic = (center: number, spread: number): BehaviorEntry => ({
	type: 'rotationStatic',
	config: { min: center - spread, max: center + spread },
});
const accel = (
	x: number,
	y: number,
	minStart: number,
	maxStart: number,
	rotate = false,
): BehaviorEntry => ({
	type: 'moveAcceleration',
	config: { accel: { x, y }, minStart, maxStart, rotate, maxSpeed: 0 },
});
const moveSpeed = (start: number, end: number): BehaviorEntry => ({
	type: 'moveSpeed',
	config: {
		speed: {
			list: [
				{ time: 0, value: start },
				{ time: 1, value: end },
			],
		},
		minMult: 0.8,
	},
});
const burstShape = (spacing: number, start: number, distance: number): BehaviorEntry => ({
	type: 'spawnBurst',
	config: { spacing, start, distance },
});
const blend = (mode: BlendKind): BehaviorEntry => ({
	type: 'blendMode',
	config: { blendMode: mode },
});

function baseConfig(over: {
	lifetime: { min: number; max: number };
	frequency: number;
	maxParticles: number;
	behaviors: BehaviorEntry[];
	emitterLifetime?: number;
}): EmitterConfigV3 {
	return {
		lifetime: over.lifetime,
		frequency: over.frequency,
		emitterLifetime: over.emitterLifetime ?? -1,
		maxParticles: over.maxParticles,
		pos: { x: 0, y: 0 },
		addAtBack: false,
		behaviors: over.behaviors,
	} as EmitterConfigV3;
}

/** A named, ready-to-tune effect config. */
export interface FxPreset {
	key: string;
	label: string;
	build: () => EmitterConfigV3;
}

/**
 * The preset menu. Ordered roughly by how common they are in slot FX. Each is a self-contained
 * config — `applyPreset` swaps it onto the selected layer (art is preserved, so binding a spark/
 * smoke texture afterward makes it real).
 */
export const FX_PRESETS: FxPreset[] = [
	{
		key: 'fountain',
		label: 'Fountain',
		build: () =>
			baseConfig({
				lifetime: { min: 1, max: 1.4 },
				frequency: 0.008,
				maxParticles: 400,
				behaviors: [
					alpha(1, 0),
					scale(0.4, 0.18),
					colorList('#bfe6ff', '#3b82f6'),
					rotStatic(90, 16),
					accel(0, 1500, 520, 720),
					torus(8),
					blend('add'),
				],
			}),
	},
	{
		key: 'fire',
		label: 'Fire',
		build: () =>
			baseConfig({
				lifetime: { min: 0.5, max: 0.9 },
				frequency: 0.01,
				maxParticles: 300,
				behaviors: [
					alpha(0.85, 0),
					scale(0.5, 0.9),
					colorList('#fff1a8', '#ff3b1d'),
					rotStatic(90, 28),
					moveSpeed(140, 60),
					torus(14),
					blend('add'),
				],
			}),
	},
	{
		key: 'smoke',
		label: 'Smoke',
		build: () =>
			baseConfig({
				lifetime: { min: 1.4, max: 2.2 },
				frequency: 0.05,
				maxParticles: 120,
				behaviors: [
					alpha(0.5, 0),
					scale(0.5, 1.6),
					colorList('#9aa3ad', '#3b4250'),
					rotStatic(90, 22),
					moveSpeed(70, 30),
					torus(18),
				],
			}),
	},
	{
		key: 'sparks',
		label: 'Sparks',
		build: () =>
			baseConfig({
				lifetime: { min: 0.4, max: 0.8 },
				frequency: 0.004,
				maxParticles: 400,
				behaviors: [
					alpha(1, 0),
					scale(0.35, 0.05),
					colorList('#fff7cc', '#ff8a1f'),
					rotStatic(90, 60),
					accel(0, 1800, 500, 900, true),
					torus(6),
					blend('add'),
				],
			}),
	},
	{
		key: 'explosion',
		label: 'Explosion (burst)',
		build: () =>
			baseConfig({
				lifetime: { min: 0.4, max: 0.9 },
				frequency: 0.001,
				maxParticles: 600,
				emitterLifetime: 0.12,
				behaviors: [
					alpha(1, 0),
					scale(0.6, 0.1),
					colorList('#fff3c2', '#ff3b1d'),
					accel(0, 400, 800, 1200, true),
					burstShape(8, 0, 4),
					blend('add'),
				],
			}),
	},
	{
		key: 'rain',
		label: 'Rain',
		build: () =>
			baseConfig({
				lifetime: { min: 0.7, max: 1 },
				frequency: 0.006,
				maxParticles: 400,
				behaviors: [
					alpha(0.6, 0.4),
					scale(0.4, 0.4),
					colorList('#cfe8ff', '#9ec5ff'),
					rotStatic(270, 4),
					accel(0, 2200, 900, 1100, true),
					torus(0),
					{
						type: 'spawnShape',
						config: { type: 'rect', data: { x: -400, y: -300, w: 800, h: 20 } },
					},
				],
			}),
	},
	{
		key: 'snow',
		label: 'Snow',
		build: () =>
			baseConfig({
				lifetime: { min: 3, max: 5 },
				frequency: 0.04,
				maxParticles: 200,
				behaviors: [
					alpha(0.9, 0.7),
					scale(0.3, 0.3),
					colorList('#ffffff', '#e8f1ff'),
					{
						type: 'rotation',
						config: { minStart: 250, maxStart: 290, minSpeed: -40, maxSpeed: 40, accel: 0 },
					},
					moveSpeed(90, 70),
					{
						type: 'spawnShape',
						config: { type: 'rect', data: { x: -400, y: -320, w: 800, h: 20 } },
					},
				],
			}),
	},
	{
		key: 'confetti',
		label: 'Confetti',
		build: () =>
			baseConfig({
				lifetime: { min: 1.4, max: 2.2 },
				frequency: 0.012,
				maxParticles: 300,
				behaviors: [
					alpha(1, 0.6),
					scale(0.35, 0.35),
					{
						type: 'rotation',
						config: { minStart: 60, maxStart: 120, minSpeed: -260, maxSpeed: 260, accel: 0 },
					},
					accel(0, 700, 500, 900, false),
					torus(10),
				],
			}),
	},
	{
		key: 'magic',
		label: 'Magic glow',
		build: () =>
			baseConfig({
				lifetime: { min: 0.8, max: 1.4 },
				frequency: 0.02,
				maxParticles: 200,
				behaviors: [
					{
						type: 'alpha',
						config: {
							alpha: {
								list: [
									{ time: 0, value: 0 },
									{ time: 0.3, value: 1 },
									{ time: 1, value: 0 },
								],
							},
						},
					},
					scale(0.2, 0.7),
					colorList('#d8b4fe', '#7c3aed'),
					rotStatic(90, 180),
					moveSpeed(40, 10),
					torus(26),
					blend('add'),
				],
			}),
	},
];

/**
 * Replace the selected layer's emitter config with a preset's, immutably. Art, placement,
 * particle kind, and trigger are PRESERVED (a preset tunes the emitter, not where it lives or
 * what it's made of). An unknown key is a no-op.
 */
export function applyPreset(layer: EmitterLayer, presetKey: string): EmitterLayer {
	const preset = FX_PRESETS.find((p) => p.key === presetKey);
	if (!preset) return layer;
	return { ...layer, config: preset.build() };
}

// ===========================================================================
// Per-particle VARIATION — the min/max seam.
//
// `@barvynkoa/particle-emitter` expresses "this value differs per particle" as
// a `minMult` on a curve behavior: one random multiplier in `[minMult, 1]` is
// picked per particle and applied to the WHOLE curve for that particle's life
// (`ScaleBehavior`/`SpeedBehavior`). So a min/max pair projects onto the curve
// as `max` = the authored endpoint and `min` = `max × minMult`.
//
// Because the multiplier is per-particle-per-life, the SAME ratio governs both
// ends of the curve — a particle that spawns small stays proportionally small.
// That's the library's physics, not a shortcut: the inspector shows four boxes
// (start min/max, end min/max) linked by that one ratio, and editing any `min`
// re-derives it.
//
// `alpha` is the one curve the library gives no `minMult`. `fxAlpha` (our own
// behavior, `engine-fx/src/behaviors.ts`) is byte-identical to the stock `alpha`
// config plus that knob, so the two swap by TYPE alone — and a config only ever
// carries `fxAlpha` while variation is actually on (`minMult < 1`), keeping every
// other effect 100% stock. Same downgrade discipline as `rotation`↔`rotationStatic`.
// ===========================================================================

/** The three curve properties that support per-particle variation. */
export type CurveProp = 'alpha' | 'scale' | 'speed';

interface CurveSpec {
	/** Behavior type(s) that can hold this curve (alpha has a stock + a varied twin). */
	types: string[];
	/** The behavior-config key holding the `ValueList` (`alpha` / `scale` / `speed`). */
	key: 'alpha' | 'scale' | 'speed';
	/** The behavior type to use when variation is ON, and when it's OFF. */
	varied: string;
	plain: 'alpha' | 'scale' | 'moveSpeed';
	/** The curve a freshly-enabled behavior starts from. */
	defaults: [number, number];
}

const CURVE_SPECS: Record<CurveProp, CurveSpec> = {
	alpha: {
		types: ['alpha', FX_ALPHA_BEHAVIOR_TYPE],
		key: 'alpha',
		varied: FX_ALPHA_BEHAVIOR_TYPE,
		plain: 'alpha',
		defaults: [1, 0],
	},
	scale: {
		types: ['scale', FX_SCALE_BEHAVIOR_TYPE],
		key: 'scale',
		varied: FX_SCALE_BEHAVIOR_TYPE,
		plain: 'scale',
		defaults: [0.5, 0.15],
	},
	speed: {
		types: ['moveSpeed', FX_SPEED_BEHAVIOR_TYPE],
		key: 'speed',
		varied: FX_SPEED_BEHAVIOR_TYPE,
		plain: 'moveSpeed',
		defaults: [300, 120],
	},
};

/** Find whichever behavior currently holds a curve property (stock or varied twin). */
function curveBehavior(config: EmitterConfigV3, prop: CurveProp): BehaviorEntry | undefined {
	const spec = CURVE_SPECS[prop];
	return behaviorsOf(config).find((b) => spec.types.includes(b.type));
}

/** A curve property's authored endpoints plus the per-particle range each one spans. */
export interface CurveRange {
	/** The authored curve endpoints — the TOP of each end's range. */
	startMax: number;
	endMax: number;
	/** The bottom of each end's range (`max × that end's floor`). Equals max with no variation. */
	startMin: number;
	endMin: number;
	/** The two INDEPENDENT per-end floors, 0–1 (1 ⇒ that end doesn't vary). */
	startMult: number;
	endMult: number;
	/**
	 * Whether the inspector shows the min/max pairs. Keyed off the behavior TYPE, never off the
	 * numbers: deriving it from "some floor < 1" made the toggle switch ITSELF off the moment a
	 * min was dragged up to its max, taking the four sliders with it.
	 */
	varied: boolean;
}

/** Clamp a stored floor into 0..1 (absent/garbage ⇒ 1 = that end doesn't vary). */
function floorOf(v: unknown): number {
	const n = Number(v);
	return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}

/**
 * Read a curve property's min/max ranges. `undefined` when the config has no behavior for it
 * (the inspector then offers to ADD one rather than silently hiding the section).
 *
 * The library's own `minMult` is a SINGLE whole-curve ratio, so a config carrying one (a preset,
 * or anything authored before the split) reads as both floors — it renders exactly as it did.
 */
export function curveRange(config: EmitterConfigV3, prop: CurveProp): CurveRange | undefined {
	const spec = CURVE_SPECS[prop];
	const b = curveBehavior(config, prop);
	if (!b) return undefined;
	const holder = b.config[spec.key] as { list?: ListPoint[] } | undefined;
	const list = holder?.list;
	if (!Array.isArray(list) || list.length === 0) return undefined;
	const startMax = list[0].value;
	const endMax = list[list.length - 1].value;
	const legacy = b.config.minMult !== undefined ? floorOf(b.config.minMult) : undefined;
	const startMult = b.config.startMult !== undefined ? floorOf(b.config.startMult) : (legacy ?? 1);
	const endMult = b.config.endMult !== undefined ? floorOf(b.config.endMult) : (legacy ?? 1);
	return {
		startMax,
		endMax,
		startMin: startMax * startMult,
		endMin: endMax * endMult,
		startMult,
		endMult,
		// A legacy `minMult` counts as varied so a preset's built-in spread is visible and editable
		// rather than silently applied by the runtime behind an unticked box.
		varied: b.type === spec.varied || (legacy !== undefined && legacy < 1),
	};
}

/** A fresh behavior entry for a curve property, at its default endpoints. */
function newCurveBehavior(prop: CurveProp): BehaviorEntry {
	const spec = CURVE_SPECS[prop];
	return {
		type: spec.plain,
		config: {
			[spec.key]: {
				list: [
					{ time: 0, value: spec.defaults[0] },
					{ time: 1, value: spec.defaults[1] },
				],
			},
		},
	};
}

/**
 * Add or remove a curve property's behavior immutably. Removing drops BOTH the stock and varied
 * twins; adding seeds the default curve. Already in the requested state ⇒ a no-op, so the
 * inspector's checkbox is idempotent.
 */
export function setCurveEnabled(
	config: EmitterConfigV3,
	prop: CurveProp,
	on: boolean,
): EmitterConfigV3 {
	const present = !!curveBehavior(config, prop);
	if (present === on) return config;
	if (!on) return removeBehaviors(config, ...CURVE_SPECS[prop].types);
	const next = cloneConfig(config);
	behaviorsOf(next).push(newCurveBehavior(prop));
	return next;
}

/**
 * Set a curve behavior's variation TYPE + its two per-end floors immutably.
 *
 * `varied` decides the behavior type on its own — never the numbers. Deriving it from "some floor
 * < 1" is what made the toggle switch itself off (and the four sliders vanish) the moment a min
 * was dragged up to its max. A varied behavior with both floors at 1 renders exactly like the
 * stock one, so leaving the type alone costs nothing.
 *
 * Switching to the stock type drops BOTH new floors and the library's legacy `minMult`, so an
 * effect with variation turned off carries no trace of it.
 */
function writeVariation(
	config: EmitterConfigV3,
	prop: CurveProp,
	opts: { varied: boolean; startMult?: number; endMult?: number },
): EmitterConfigV3 {
	const spec = CURVE_SPECS[prop];
	const next = cloneConfig(config);
	const b = behaviorsOf(next).find((x) => spec.types.includes(x.type));
	if (!b) return next;
	if (!opts.varied) {
		b.type = spec.plain;
		delete b.config.startMult;
		delete b.config.endMult;
		delete b.config.minMult;
		return next;
	}
	const cur = curveRange(config, prop);
	const clamp = (n: number): number => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 1));
	b.type = spec.varied;
	b.config.startMult = clamp(opts.startMult ?? cur?.startMult ?? 1);
	b.config.endMult = clamp(opts.endMult ?? cur?.endMult ?? 1);
	// The library's single whole-curve ratio is now expressed by the pair above — carrying both
	// would double-apply for a reader that honours `minMult`.
	delete b.config.minMult;
	return next;
}

/** The floor a freshly-enabled variation starts at — a visible but sane spread. */
const DEFAULT_MIN_MULT = 0.5;

/**
 * Turn per-particle variation on/off for a curve property immutably. Turning it ON keeps any
 * floors already present (including a legacy `minMult`, migrated onto both ends) and otherwise
 * seeds a half-strength spread; turning it OFF pins every particle to the authored curve and
 * drops back to the stock behavior.
 */
export function setCurveVaried(
	config: EmitterConfigV3,
	prop: CurveProp,
	on: boolean,
): EmitterConfigV3 {
	const range = curveRange(config, prop);
	if (!range) return config;
	if (!on) return writeVariation(config, prop, { varied: false });
	const seeded = range.startMult < 1 || range.endMult < 1;
	return writeVariation(config, prop, {
		varied: true,
		startMult: seeded ? range.startMult : DEFAULT_MIN_MULT,
		endMult: seeded ? range.endMult : DEFAULT_MIN_MULT,
	});
}

/**
 * Set one bound of one end of a curve property, immutably. The four bounds are INDEPENDENT: the
 * start and end each carry their own floor, so moving one never drags the others.
 *
 * - `max` writes the authored curve endpoint, holding that end's `min` at its current ABSOLUTE
 *   value (the floor is re-derived) — dragging a max must not yank its own min along.
 * - `min` sets that end's floor (`mult = min / max`), clamped so it can never exceed its max.
 *
 * A zero `max` can't express a ratio, so that end's floor pins to 1 — and, unlike before, that is
 * confined to the end being edited and can no longer switch the whole mode off.
 */
export function setCurveBound(
	config: EmitterConfigV3,
	prop: CurveProp,
	which: 'start' | 'end',
	bound: 'min' | 'max',
	value: number,
): EmitterConfigV3 {
	const range = curveRange(config, prop);
	if (!range) return config;
	const v = Number.isFinite(value) ? value : 0;
	const spec = CURVE_SPECS[prop];
	const key = which === 'start' ? 'startMult' : 'endMult';

	if (bound === 'max') {
		// NOT `setListEndpoint`: it matches the behavior by its exact stock `type`, which misses a
		// curve once variation has swapped it to its `fx*` twin. Resolve through `curveBehavior`.
		const next = cloneConfig(config);
		const b = behaviorsOf(next).find((x) => spec.types.includes(x.type));
		const list = (b?.config[spec.key] as { list?: ListPoint[] } | undefined)?.list;
		if (!Array.isArray(list) || list.length === 0) return next;
		if (which === 'start') list[0].value = v;
		else list[list.length - 1].value = v;
		if (!range.varied) return next;
		// Hold the absolute min where the author put it: re-derive this end's floor against the new
		// max. A max dragged below its min collapses that end to no variation (floor 1).
		const min = which === 'start' ? range.startMin : range.endMin;
		return writeVariation(next, prop, { varied: true, [key]: v ? Math.min(1, min / v) : 1 });
	}

	const max = which === 'start' ? range.startMax : range.endMax;
	const mult = max ? Math.min(1, Math.max(0, v / max)) : 1;
	return writeVariation(config, prop, { varied: true, [key]: mult });
}

// ---------------------------------------------------------------------------
// Emission arc + rotation lock.
//
// `setEmissionArc` already UPSERTS a rotation behavior, but a config carrying
// none at all (a burst, or a hand-authored config) used to show NO Emission
// section, leaving the author no way to introduce a launch direction. These make
// the section additive, and expose the library's `noRotation` — which pins the
// particle's VISUAL angle after the movement behaviors have already read the
// launch direction, so art can travel in an arc without spinning to face it.
// ---------------------------------------------------------------------------

/** Whether the config carries a launch-direction (rotation) behavior at all. */
export function hasEmission(config: EmitterConfigV3): boolean {
	return !!rotationBehavior(config);
}

/** Add or remove the launch-direction behavior immutably (omnidirectional when added). */
export function setEmissionEnabled(config: EmitterConfigV3, on: boolean): EmitterConfigV3 {
	if (!on) return removeBehaviors(config, 'rotation', 'rotationStatic');
	if (rotationBehavior(config)) return config;
	const next = cloneConfig(config);
	behaviorsOf(next).push({ type: 'rotationStatic', config: { min: 0, max: 360 } });
	return next;
}

/** The locked particle angle (°), or `undefined` when particles are free to face their travel. */
export function rotationLock(config: EmitterConfigV3): number | undefined {
	const b = behaviorsOf(config).find((x) => x.type === 'noRotation');
	if (!b) return undefined;
	const v = Number(b.config.rotation ?? 0);
	return Number.isFinite(v) ? v : 0;
}

/**
 * Pin (or release) the particle's visual angle immutably. `null` removes the lock. The lock runs
 * AFTER the movement behaviors have read the launch direction, so locked particles still travel
 * along the emission arc — they just don't rotate to face it (what flat art like confetti,
 * snowflakes or a flipbook usually wants).
 */
export function setRotationLock(config: EmitterConfigV3, angle: number | null): EmitterConfigV3 {
	if (angle === null) return removeBehaviors(config, 'noRotation');
	const rotation = Number.isFinite(angle) ? (angle as number) : 0;
	return upsertBehavior(
		config,
		'noRotation',
		() => ({ rotation }),
		(b) => {
			b.config.rotation = rotation;
		},
	);
}

// ---------------------------------------------------------------------------
// Colour overlay (our `fxColorOverlay` behavior) — a colour laid over each
// particle at a PER-PARTICLE random intensity. The stock `color` behavior
// interpolates identically for every particle, so a varied tint has no library
// equivalent; this composes ON TOP of it (it runs late), which is why the two
// are independent toggles rather than one mode switch.
// ---------------------------------------------------------------------------

/** The overlay colour + its per-particle intensity range. */
export interface ColorOverlay {
	color: string;
	min: number;
	max: number;
}

/** Read the colour overlay, or `undefined` when the layer has none. */
export function colorOverlay(config: EmitterConfigV3): ColorOverlay | undefined {
	const b = behaviorsOf(config).find((x) => x.type === FX_COLOR_OVERLAY_BEHAVIOR_TYPE);
	if (!b) return undefined;
	const min = Number(b.config.minIntensity ?? 1);
	const max = Number(b.config.maxIntensity ?? min);
	return {
		color: typeof b.config.color === 'string' ? b.config.color : '#ffffff',
		min: Number.isFinite(min) ? min : 1,
		max: Number.isFinite(max) ? max : 1,
	};
}

/** The overlay a freshly-enabled layer starts with — a warm gold at a wide intensity spread. */
function defaultOverlay(): Record<string, unknown> {
	return { color: '#ffd166', minIntensity: 0.3, maxIntensity: 1 };
}

/** Add or remove the colour overlay immutably. */
export function setColorOverlayEnabled(config: EmitterConfigV3, on: boolean): EmitterConfigV3 {
	if (!on) return removeBehaviors(config, FX_COLOR_OVERLAY_BEHAVIOR_TYPE);
	if (colorOverlay(config)) return config;
	const next = cloneConfig(config);
	behaviorsOf(next).push({ type: FX_COLOR_OVERLAY_BEHAVIOR_TYPE, config: defaultOverlay() });
	return next;
}

/**
 * Set one colour-overlay field immutably (adds the overlay if absent). The intensity bounds are
 * clamped to 0..1 and kept ordered, so dragging `min` past `max` pushes `max` rather than
 * inverting the range (which would read as a silently dead control).
 */
export function setColorOverlayField(
	config: EmitterConfigV3,
	field: 'color' | 'min' | 'max',
	value: string | number,
): EmitterConfigV3 {
	const seeded = colorOverlay(config) ? config : setColorOverlayEnabled(config, true);
	return upsertBehavior(seeded, FX_COLOR_OVERLAY_BEHAVIOR_TYPE, defaultOverlay, (b) => {
		if (field === 'color') {
			b.config.color = String(value);
			return;
		}
		const v = Math.min(1, Math.max(0, Number(value) || 0));
		const min = Number(b.config.minIntensity ?? 0);
		const max = Number(b.config.maxIntensity ?? 1);
		if (field === 'min') {
			b.config.minIntensity = v;
			if (v > max) b.config.maxIntensity = v;
		} else {
			b.config.maxIntensity = v;
			if (v < min) b.config.minIntensity = v;
		}
	});
}

// ---------------------------------------------------------------------------
// Flipbook playback (`art.framerate` / `art.loop`) — an ANIMATED layer's frames
// played at an authored fps instead of always being stretched across the
// particle's lifetime. Lives on `art` (not `config`) because it describes the
// art; `bindArt` folds it into the `animatedSingle` behavior.
// ---------------------------------------------------------------------------

/** A flipbook layer's playback settings (`fps: null` ⇒ match the particle's lifetime). */
export function flipbookPlay(layer: EmitterLayer): { fps: number | null; loop: boolean } {
	const fps = layer.art.framerate;
	const on = typeof fps === 'number' && Number.isFinite(fps) && fps > 0;
	return { fps: on ? fps : null, loop: on && layer.art.loop === true };
}

/**
 * Set a flipbook layer's playback speed immutably. `null` restores match-life (the sequence
 * spans the particle's whole life), which also drops `loop` — the library ignores looping
 * without a real fps, so keeping it would be config that lies.
 */
export function setFlipbookFps(layer: EmitterLayer, fps: number | null): EmitterLayer {
	const art = { ...layer.art };
	if (fps === null || !Number.isFinite(fps) || fps <= 0) {
		delete art.framerate;
		delete art.loop;
	} else {
		art.framerate = fps;
	}
	return { ...layer, art };
}

/** Set whether a flipbook repeats within one particle's life immutably (needs a real fps). */
export function setFlipbookLoop(layer: EmitterLayer, loop: boolean): EmitterLayer {
	const art = { ...layer.art };
	if (loop) art.loop = true;
	else delete art.loop;
	return { ...layer, art };
}

// ---------------------------------------------------------------------------
// Layer stack operations — duplicate / copy-paste / reorder.
//
// Layer order IS draw order (each layer's emitter is added to the world in
// document order), so moving a layer up or down the list restacks the effect.
// All pure: the page hands the result straight back to its `doc` rune.
// ---------------------------------------------------------------------------

/** A layer key unique within the doc, derived from `desired` (`x`, `x-2`, `x-3`, …). */
export function uniqueLayerKey(doc: EffectDoc, desired: string): string {
	const used = new Set(doc.layers.map((l) => l.key));
	const base = desired.trim() || 'layer';
	if (!used.has(base)) return base;
	let n = 2;
	while (used.has(`${base}-${n}`)) n++;
	return `${base}-${n}`;
}

/** A deep, independent copy of a layer under a new key (no shared config references). */
export function cloneLayerAs(layer: EmitterLayer, key: string): EmitterLayer {
	return { ...(JSON.parse(JSON.stringify(layer)) as EmitterLayer), key };
}

/**
 * Insert a copy of `layer` immediately after `afterKey` (or at the end), under a fresh unique
 * key derived from the layer's own. Returns the new doc AND the key so the page can select it.
 */
export function insertLayerCopy(
	doc: EffectDoc,
	layer: EmitterLayer,
	afterKey?: string,
): { doc: EffectDoc; key: string } {
	const key = uniqueLayerKey(doc, layer.key);
	const copy = cloneLayerAs(layer, key);
	const at = afterKey ? doc.layers.findIndex((l) => l.key === afterKey) : -1;
	const layers = doc.layers.slice();
	layers.splice(at === -1 ? layers.length : at + 1, 0, copy);
	return { doc: { ...doc, layers }, key };
}

/** Duplicate a layer in place (the copy lands directly beneath the original). */
export function duplicateLayer(doc: EffectDoc, key: string): { doc: EffectDoc; key: string } {
	const layer = doc.layers.find((l) => l.key === key);
	if (!layer) return { doc, key };
	return insertLayerCopy(doc, layer, key);
}

/**
 * Move a layer `delta` slots in the stack (negative = earlier/behind, positive = later/in front),
 * immutably. Clamped at both ends, so holding the up/down button is safe.
 */
export function moveLayer(doc: EffectDoc, key: string, delta: number): EffectDoc {
	const from = doc.layers.findIndex((l) => l.key === key);
	if (from === -1) return doc;
	const to = Math.min(doc.layers.length - 1, Math.max(0, from + delta));
	if (to === from) return doc;
	const layers = doc.layers.slice();
	const [moved] = layers.splice(from, 1);
	layers.splice(to, 0, moved);
	return { ...doc, layers };
}
