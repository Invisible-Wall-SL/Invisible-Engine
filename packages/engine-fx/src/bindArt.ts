/**
 * Invisible FX — the canonical "EffectDoc V3 config → library-renderable config" seam.
 *
 * `@barvynkoa/particle-emitter`'s `upgradeConfig(config, art)` is a NO-OP for a V3 config
 * (its `art` arg only feeds the legacy V1/V2 flat-config upgrade — verified against the
 * library source), so a V3 config MUST carry its art as its OWN `textureRandom` /
 * `animatedSingle` BEHAVIOR. The default authored config has no art behavior, so without
 * this seam every emitter would spawn TEXTURELESS, INVISIBLE particles (compiles + ships +
 * runs, renders nothing — the exact trap [[feedback_validate_data_contracts_offline]] warns
 * of, caught in Phase-1 increment 2).
 *
 * This lives in the SHARED `engine-fx` package — NOT duplicated — because BOTH consumers
 * need the identical reduction: the `/fx` authoring stage (`FxStage.svelte` → `fxModel.client.ts`)
 * and the engine runtime (`<ParticleEmitter>` / `bakedEffects()`'s `<EffectPlayer>`). It is
 * PURE (no PixiJS import — textures are typed opaquely) so it stays unit-coverable in
 * `tools/fx-spike`.
 */

import type { EmitterConfigV3 } from '@barvynkoa/particle-emitter';

/** The art-binding behavior types `@barvynkoa/particle-emitter` recognises for a V3 config. */
export const ART_BEHAVIOR_TYPES = new Set([
	'textureSingle',
	'textureRandom',
	'animatedSingle',
	'animatedRandom',
	'textureOrdered',
]);

/** A behavior entry's `config` is an opaque record; read it defensively. */
export type BehaviorConfig = Record<string, unknown>;
export interface BehaviorEntry {
	type: string;
	config: BehaviorConfig;
}

/** The config's `behaviors` array, narrowed (defensive — an arbitrary doc may lack it). */
export function behaviorsOf(config: EmitterConfigV3): BehaviorEntry[] {
	return Array.isArray(config.behaviors) ? (config.behaviors as BehaviorEntry[]) : [];
}

/**
 * Bind resolved particle TEXTURES into a V3 config's `behaviors`, returning a NEW config the
 * library's `Emitter` can render. We add (or replace) exactly the art behavior, leaving every
 * other behavior byte-identical so the authored `EmitterConfigV3` stays the verbatim contract.
 *
 * - 0 textures ⇒ strip any art behavior (an unbound layer renders nothing, by design).
 * - 1 texture, or >1 non-animated ⇒ `textureRandom` (a static particle, random of the set).
 * - >1 texture + `animated` ⇒ `animatedSingle` flipbook (`framerate: -1` = match particle
 *   life, the same `matchLife` default `upgradeConfig` would produce; `loop` true).
 *
 * `textures` are real PIXI `Texture` objects (typed opaquely here so this module stays free
 * of a PixiJS import and unit-coverable in `tools/fx-spike`). `bindArt` clones the
 * texture-free config FIRST, THEN attaches the live `Texture` objects, so its result must NOT
 * be JSON-cloned again (that would destroy the live `Texture` instances).
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
