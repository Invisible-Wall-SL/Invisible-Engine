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
 * Expand a texture list into a WEIGHTED multiset for the library's (uniform) `textureRandom`:
 * repeating a texture N times makes it N× as likely to be picked. `weights` is parallel to
 * `textures` (relative shares). Falls back to the input list (uniform) when there's nothing to
 * weight — ≤1 texture, no/short/degenerate weights, or a zero total. The multiset is capped at
 * ~`RESOLUTION` entries (percentage granularity) so a lopsided mix can't balloon the array; a
 * positive-but-tiny share still gets at least one entry so a chosen frame never silently vanishes.
 */
export function weightedTextures(textures: unknown[], weights?: number[]): unknown[] {
	if (textures.length <= 1) return textures;
	if (!Array.isArray(weights) || weights.length !== textures.length) return textures;
	const clean = weights.map((w) => (typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : 0));
	const sum = clean.reduce((a, b) => a + b, 0);
	if (sum <= 0) return textures;
	const RESOLUTION = 100;
	const out: unknown[] = [];
	for (let i = 0; i < textures.length; i++) {
		if (clean[i] <= 0) continue; // a 0-share frame is excluded from the mix
		const n = Math.max(1, Math.round((clean[i] / sum) * RESOLUTION));
		for (let k = 0; k < n; k++) out.push(textures[i]);
	}
	return out.length ? out : textures;
}

/**
 * Bind resolved particle TEXTURES into a V3 config's `behaviors`, returning a NEW config the
 * library's `Emitter` can render. We add (or replace) exactly the art behavior, leaving every
 * other behavior byte-identical so the authored `EmitterConfigV3` stays the verbatim contract.
 *
 * - 0 textures ⇒ strip any art behavior (an unbound layer renders nothing, by design).
 * - 1 texture, or >1 non-animated ⇒ `textureRandom` (a static particle, random of the set —
 *   WEIGHTED by `weights` when given, via a repeated-texture multiset).
 * - >1 texture + `animated` ⇒ `animatedSingle` flipbook, played at the layer's authored
 *   `framerate`/`loop` (`anim`) or, absent those, at `framerate: -1` = match particle life —
 *   the same `matchLife` default `upgradeConfig` would produce, so every effect authored before
 *   the speed knob existed is byte-identical. `weights` are ignored here (a flipbook particle
 *   plays every frame).
 *
 * NOTE on looping: `loop` is passed ONLY with a real (> 0) framerate. The library forces
 * `loop: false` whenever `framerate <= 0` (`particle-emitter.es.js`: `loop: framerate > 0 ?
 * !!anim.loop : false`), so a `loop: true` in match-life mode is dead config that reads as if the
 * flipbook loops when it cannot — dropping it keeps the shipped config honest.
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
	weights?: number[],
	anim?: { framerate?: number; loop?: boolean },
): EmitterConfigV3 {
	const next: EmitterConfigV3 = JSON.parse(JSON.stringify(config));
	const behaviors = behaviorsOf(next).filter((b) => !ART_BEHAVIOR_TYPES.has(b.type));
	if (textures.length > 0) {
		const art: BehaviorEntry =
			animated && textures.length > 1
				? { type: 'animatedSingle', config: { anim: { ...flipbookPlayback(anim), textures } } }
				: { type: 'textureRandom', config: { textures: weightedTextures(textures, weights) } };
		behaviors.push(art);
	}
	(next as { behaviors: BehaviorEntry[] }).behaviors = behaviors;
	return next;
}

/**
 * The `framerate`/`loop` half of an `animatedSingle` `anim` block. A non-positive/absent
 * framerate is match-life (`-1`), where the library ignores `loop` — so `loop` is emitted only
 * alongside a real fps.
 */
export function flipbookPlayback(anim?: { framerate?: number; loop?: boolean }): {
	framerate: number;
	loop?: boolean;
} {
	const fps = Number(anim?.framerate);
	if (!Number.isFinite(fps) || fps <= 0) return { framerate: -1 };
	return anim?.loop ? { framerate: fps, loop: true } : { framerate: fps };
}
