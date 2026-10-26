/**
 * Invisible FX — the MATERIAL behaviour (`fxMaterial`, Invisible Shader Graph step 8d,
 * `docs/design/shader-graph-particles.md` §6–7): what a particle carries for a material that the
 * library keeps nowhere, written at spawn.
 *
 *  - its SEED, a whole number 0…97: the material's Seed input. Whole, because the shell hands it to
 *    the fragment as an interpolated varying, and an integer stays exact at all four corners even at
 *    mediump, where a fraction under a hash could speckle inside one particle;
 *  - its WAVE INDEX: its place in its spawn wave ÷ (wave size − 1), 0 for a wave of one. The library
 *    calls an init behaviour once per wave with the wave's first particle, so the behaviour sees the
 *    wave's size;
 *  - its SPAWN ORDER: its spawn number ÷ the emitter's Max particles (read live, so a drive on it
 *    counts), wrapping.
 *
 * They live in the particle's scratch bag under {@link FX_MATERIAL_KEYS} and go back to 0 when it is
 * recycled. The behaviour is never stored: the material renderer injects it into the bound config
 * ({@link bindFxMaterial}), as `bindArt` injects the art, so an authored config stays pure.
 */

import type { EmitterConfigV3 } from '@barvynkoa/particle-emitter';
import { behaviorsOf, type BehaviorEntry } from './bindArt';

export const FX_MATERIAL_BEHAVIOR_TYPE = 'fxMaterial';

/** How many seeds a particle draws from: 0…97, the range an element's seed spans. */
export const FX_MATERIAL_SEEDS = 98;

/** Where a particle's material values sit in its scratch bag. */
export const FX_MATERIAL_KEYS = { seed: 'fxSeed', wave: 'fxWave', order: 'fxOrder' } as const;

/** The library's `Emitter.init` default for a config with no positive Max particles. */
const LIBRARY_MAX_PARTICLES = 1000;

/** The library's `BehaviorOrder.Normal`; the values depend on no other behaviour. */
const ORDER_NORMAL = 2;

/** The slice of the library's `Particle` the behaviour touches (structural — no PixiJS import). */
export interface FxMaterialParticleLike {
	config: Record<string, unknown>;
	emitter: { maxParticles: number } | null;
	next: FxMaterialParticleLike | null;
}

export class FxMaterialBehavior {
	static type = FX_MATERIAL_BEHAVIOR_TYPE;
	order = ORDER_NORMAL;
	private spawned = 0;

	initParticles(first: FxMaterialParticleLike): void {
		let size = 0;
		for (let p: FxMaterialParticleLike | null = first; p; p = p.next) size++;
		const max = first.emitter?.maxParticles;
		const wrap = typeof max === 'number' && max > 0 ? max : LIBRARY_MAX_PARTICLES;
		let i = 0;
		for (let p: FxMaterialParticleLike | null = first; p; p = p.next, i++) {
			p.config[FX_MATERIAL_KEYS.seed] = Math.floor(Math.random() * FX_MATERIAL_SEEDS);
			p.config[FX_MATERIAL_KEYS.wave] = size > 1 ? i / (size - 1) : 0;
			p.config[FX_MATERIAL_KEYS.order] = (this.spawned % wrap) / wrap;
			this.spawned = (this.spawned + 1) % wrap;
		}
	}

	recycleParticle(particle: FxMaterialParticleLike): void {
		particle.config[FX_MATERIAL_KEYS.seed] = 0;
		particle.config[FX_MATERIAL_KEYS.wave] = 0;
		particle.config[FX_MATERIAL_KEYS.order] = 0;
	}
}

/**
 * `config` with the `fxMaterial` behaviour added (once), as a NEW config: the input is not touched,
 * and nothing is cloned past the behaviour list, so a config `bindArt` gave (live textures in it)
 * stays usable.
 */
export function bindFxMaterial(config: EmitterConfigV3): EmitterConfigV3 {
	const behaviors: BehaviorEntry[] = [
		...behaviorsOf(config).filter((b) => b.type !== FX_MATERIAL_BEHAVIOR_TYPE),
		{ type: FX_MATERIAL_BEHAVIOR_TYPE, config: {} },
	];
	return { ...config, behaviors } as EmitterConfigV3;
}
