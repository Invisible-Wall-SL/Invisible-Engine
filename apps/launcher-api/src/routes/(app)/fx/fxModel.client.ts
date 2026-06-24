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
	type EffectDoc,
	type EmitterConfigV3,
	type EmitterLayer,
} from 'engine-fx';

/** The single tunable curve point shape used by the V3 list-property behaviors. */
interface ListPoint {
	time: number;
	value: number;
}

/** The art-binding behavior types `@barvynkoa/particle-emitter` recognises for a V3 config. */
const ART_BEHAVIOR_TYPES = new Set([
	'textureSingle',
	'textureRandom',
	'animatedSingle',
	'animatedRandom',
	'textureOrdered',
]);

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

/** A behavior entry's `config` is an opaque record; read it defensively. */
type BehaviorConfig = Record<string, unknown>;
interface BehaviorEntry {
	type: string;
	config: BehaviorConfig;
}

function behaviorsOf(config: EmitterConfigV3): BehaviorEntry[] {
	return Array.isArray(config.behaviors) ? (config.behaviors as BehaviorEntry[]) : [];
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
 * Bind resolved particle TEXTURES into a V3 config's `behaviors`, returning a NEW config the
 * library's `Emitter` can render. **This is the load-bearing seam the runtime contract turns
 * on:** `upgradeConfig(config, art)` is a NO-OP for a V3 config (it only injects `art` when
 * upgrading a legacy V1/V2 flat config — verified against the library source), so a V3
 * config MUST carry its art as its OWN `textureRandom` / `animatedSingle` behavior. We add
 * (or replace) exactly that behavior, leaving every other behavior byte-identical so the
 * authored `EmitterConfigV3` stays the verbatim contract.
 *
 * - 0 textures ⇒ strip any art behavior (an unbound layer renders nothing, by design).
 * - 1 texture, or >1 non-animated ⇒ `textureRandom` (a static particle, random of the set).
 * - >1 texture + `animated` ⇒ `animatedSingle` flipbook (`framerate: -1` = match particle
 *   life, the same `matchLife` default `upgradeConfig` would produce; `loop` true).
 *
 * `textures` are real PIXI `Texture` objects (typed opaquely here so this module stays free
 * of a PixiJS import and unit-coverable in `tools/fx-spike`). The same injection is what the
 * engine-side `bakedEffects()` player will run at register time — kept pure + shared here.
 */
export function bindArt(
	config: EmitterConfigV3,
	textures: unknown[],
	animated: boolean,
): EmitterConfigV3 {
	const next: EmitterConfigV3 = JSON.parse(JSON.stringify(config));
	const behaviors = behaviorsOf(next).filter((b) => !ART_BEHAVIOR_TYPES.has(b.type));
	if (textures.length > 0) {
		const art: BehaviorEntry =
			animated && textures.length > 1
				? {
						type: 'animatedSingle',
						config: { anim: { framerate: -1, loop: true, textures } },
					}
				: { type: 'textureRandom', config: { textures } };
		behaviors.push(art);
	}
	(next as { behaviors: BehaviorEntry[] }).behaviors = behaviors;
	return next;
}
