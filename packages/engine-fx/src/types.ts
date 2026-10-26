/**
 * Invisible FX — the `EffectDoc` save contract (design doc `invisible-fx.md` §4).
 *
 * `EffectDoc` is OUR schema: a named particle effect = a stack of emitter layers. It
 * *contains* the library's `EmitterConfigV3` VERBATIM (never reshaped) plus the wiring the
 * runtime `ParticleEmitter.svelte` can't infer — art source, placement, particle kind, and
 * an optional trigger. Pure config stays nested and untouched so it round-trips into
 * `@barvynkoa/particle-emitter` cleanly via `upgradeConfig` ([[feedback_validate_data_contracts_offline]]).
 *
 * The runtime contract this reduces to is `ParticleEmitter.svelte`:
 *   <ParticleEmitter key={layer.art.assetKey} config={layer.config} emit emitSpeed=… />
 * i.e. exactly `config` (an `EmitterConfigV3`) + `key` (a `loadedAssets` sprite-sheet key)
 * + `emit`/`emitSpeed`. See `packages/pixi-svelte/src/lib/components/ParticleEmitter.svelte`.
 *
 * EDITOR-ONLY state (camera, last-selected layer, swatches) NEVER lives here — it goes in
 * a `.fx.meta.json` sidecar (§4), the same out-of-band discipline the Rigger uses. Keep
 * this schema pure so the launcher save endpoint and the engine `bakedEffects()` player
 * can both import it without dragging editor state through the pipeline.
 */

import type { EmitterConfigV3 } from '@barvynkoa/particle-emitter';

/** Re-export the library config type so consumers nest the EXACT same shape (no copy). */
export type { EmitterConfigV3 } from '@barvynkoa/particle-emitter';

/** Schema version — bump only on a breaking `EffectDoc` shape change (migration hook). */
export const EFFECT_DOC_VERSION = 1 as const;

/**
 * Where a layer's particle ART comes from. `assetKey` references an atlas/sheet bundle that
 * ALREADY travels the pipeline (the Atlas Maker produced it) — FX never re-packs textures,
 * it points by key. A dangling `assetKey` = an invisible effect, so the player/bake must
 * verify it resolves in `loadedAssets` (the particle analogue of a geometry-less region).
 */
export interface EmitterArt {
	/** `loadedAssets` key = an atlas/sheet bundle (the `key` prop of `ParticleEmitter`). */
	assetKey: string;
	/** Region/frame names within that bundle. >1 + `animated` ⇒ a flipbook particle. */
	frames: string[];
	/** True ⇒ AnimatedParticle (`animatedSingle`/`animatedRandom`); false ⇒ static texture. */
	animated?: boolean;
	/**
	 * Optional RELATIVE spawn weights, parallel to `frames`, for a static (non-`animated`) MIX:
	 * each particle picks one frame at random with probability ∝ its weight (a 70/30 boot/bottle
	 * mix, say). Omitted / invalid ⇒ a uniform pick. Ignored when `animated` (a flipbook particle
	 * plays ALL frames). The library's `textureRandom` is uniform, so `bindArt` realises the weights
	 * by repeating a frame's texture in the list proportional to its share.
	 */
	weights?: number[];
	/**
	 * Flipbook playback SPEED in frames/second (`animated` only). `-1` (or omitted) ties the
	 * sequence to the particle's lifetime so it plays through exactly once however long the
	 * particle lives — the original, and still the default, so an existing effect is unchanged.
	 */
	framerate?: number;
	/**
	 * Whether the flipbook repeats within one particle's life (`animated` only). The library
	 * FORCES `loop: false` whenever `framerate <= 0`, so this only bites with a real fps —
	 * `bindArt` drops it in match-life mode rather than shipping config that reads as looping
	 * when it can't.
	 */
	loop?: boolean;
}

/** Where the emitter sits: free in the scene, or pinned to follow a rig bone (Tier B). */
export interface EmitterPlacement {
	/** `free` = positioned in the scene; `bone` = wrap the emitter in `<RigBone boneName=…>`. */
	space: 'free' | 'bone';
	/** Bone name to follow when `space === 'bone'`. */
	bone?: string;
	/** Pixel offset from the placement origin (scene origin, or the bone transform). */
	offset?: { x: number; y: number };
}

/** Rig-as-particle config (Tier C, Phase 0-gated) — only when `particleKind === 'spine'`. */
export interface RigParticleConfig {
	/** A loaded rig bundle key in `loadedAssets`. */
	skeletonKey: string;
	/** The clip each pooled particle skeleton plays. */
	animation: string;
	/** Whether each particle's clip loops. */
	loop?: boolean;
}

/**
 * When a layer emits — resolved by Flow at runtime (Flow owns "when" by default, §4.4/§9).
 * `on: 'always'` is the only self-contained case (ambient FX); `on: 'event'` binds to a
 * `type` from the game's `EmitterVocabulary` so a Flow Broadcast node is the fire button.
 */
export interface EmitterTrigger {
	/** `always` = emit continuously (ambient); `event` = play on a broadcast event. */
	on: 'always' | 'event';
	/** A `type` from the game's `EmitterVocabulary` (required when `on === 'event'`). */
	eventType?: string;
	/** Emit for N ms then stop. Omitted ⇒ the config's `emitterLifetime` governs. */
	duration?: number;
	/**
	 * Optional SECOND cue (`on: 'event'` only) that STOPS emission — fire on `eventType`, keep
	 * emitting, stop on `stopEventType`. For a continuous effect Flow switches on and off with two
	 * cues. Omitted ⇒ emission stops by `duration` / the config's `emitterLifetime` instead (a burst).
	 * A `stopEventType` equal to `eventType` is ignored (a cue can't both start and stop).
	 */
	stopEventType?: string;
	/**
	 * Optional SCOPE filter (`on: 'event'` only; Phase 12a, `docs/design/hold-and-win.md` §8): fire
	 * only on events about this one part — a meter id (`red`, or `meter:red`), a jackpot tier
	 * (`grand`), a reel — matched against the event's `scope`. An event that carries no scope still
	 * fires the layer; `*` fires on every part. Omitted ⇒ the scope of the component the effect is
	 * placed in, else every event.
	 */
	scope?: string;
}

/** How a material's Time input runs on a particle: over its life, or looped at the effect's length. */
export type EmitterMaterialTime = 'life' | 'loop';

/**
 * A layer's MATERIAL (Invisible Shader Graph step 8d, `docs/design/shader-graph-particles.md` §8):
 * its particles drawn through a compiled Shader Graph effect. Sprite layers only. Named by kind, so
 * it rides the effect and the compiled shader through the chains that already ship them.
 */
export interface EmitterMaterial {
	/** A compiled Shader Graph effect, `custom:<id>`. Unregistered at runtime ⇒ plain sprites. */
	kind: `custom:${string}`;
	/** Absent ⇒ `life`. */
	time?: EmitterMaterialTime;
	/** The material's strength, 0…4. Absent ⇒ 1. */
	intensity?: number;
	/** Param values by the effect's param id. A param left out plays its default. */
	params?: Record<string, number | string | boolean>;
}

/** One emitter layer of an effect (sparks, smoke, glow — stacked into one named effect). */
export interface EmitterLayer {
	/** Layer id, unique within the effect. */
	key: string;
	/** The library config, VERBATIM → `ParticleEmitter.svelte` `config` prop. Never reshaped. */
	config: EmitterConfigV3;
	/** Where the particle art comes from. */
	art: EmitterArt;
	/** Where the emitter sits (free / on a bone). */
	placement: EmitterPlacement;
	/** `sprite` (Tiers A/B) or `spine` (Tier C, Phase 0-gated). */
	particleKind: 'sprite' | 'spine';
	/** Required when `particleKind === 'spine'`. */
	spineParticle?: RigParticleConfig;
	/** When this layer emits (optional — Flow may drive it externally). */
	trigger?: EmitterTrigger;
	/** Draw the particles through a compiled Shader Graph effect (sprite layers only). */
	material?: EmitterMaterial;
}

/** The kind of value an exposed parameter holds. */
export type EffectParamKind = 'number' | 'color' | 'bool';

/** A parameter's value: a number, a `#rrggbb` colour or a boolean. */
export type EffectParamValue = number | string | boolean;

/**
 * One thing an exposed parameter changes (`invisible-fx.md` §"Direction (2026-10-15)"). The path
 * grammar, the mapping and the applier live in `params.ts`.
 */
export interface EffectParamDrive {
	/** Unique within its parameter (the editor selects it). */
	id: string;
	/** An `EmitterLayer.key`; absent ⇒ an effect-level target (`effect.*`). */
	layer?: string;
	/**
	 * `emitter.<field>`, `behavior:<type>[#n].<dot.path>`, `placement.offset.x|y`,
	 * `material.intensity`, `material.param.<id>` or `effect.<field>`.
	 */
	path: string;
	/** The target's value at the parameter's min (or at false). */
	from?: number | string;
	/** The target's value at its max (or at true). Both absent ⇒ the value is written as is. */
	to?: number | string;
}

/** A named value the outside world sets on a placed effect; it drives one or more leaves. */
export interface EffectParam {
	/** The wire name (`intensity`, `heat`), unique in the effect. */
	id: string;
	kind: EffectParamKind;
	/** The value the stored config is written at. A colour is `#rrggbb`. */
	default: EffectParamValue;
	/** Number only: the range sliders, bindings and drives use. Absent ⇒ 0..1 for a mapping. */
	min?: number;
	max?: number;
	note?: string;
	drives: EffectParamDrive[];
}

/** A named particle effect = a stack of emitter layers. The saved artifact of Invisible FX. */
export interface EffectDoc {
	/** Schema version (`EFFECT_DOC_VERSION`). */
	version: number;
	/** Stable id (the file stem under `<bundle>/<id>.fx.json`). */
	id: string;
	/** Human-readable name. */
	name: string;
	/** The emitter stack. */
	layers: EmitterLayer[];
	/** Exposed parameters. Absent on an effect that exposes none (byte-identical to before). */
	params?: EffectParam[];
}
