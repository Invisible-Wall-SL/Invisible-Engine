/**
 * The Particles element of Invisible Shader Graph's preview (step 8d.7,
 * `docs/design/shader-graph-particles.md` §9): two stock emitters the edited effect is drawn on as a
 * particle material, through the game's renderer (`particlePreview.client.ts` mounts them). Pure,
 * so `check:shader-editor` reads the configs.
 *
 * Every length here is in wall seconds and world units (the stage's smaller side is
 * {@link PARTICLE_VIEW} units), turned into the emitter's own seconds at the game's speed
 * (`DEFAULT_EMIT_SPEED`), so the preview plays as a game would.
 */
import type { EmitterConfigV3 } from '@barvynkoa/particle-emitter';
import { DEFAULT_EMIT_SPEED } from 'engine-fx';

export const PARTICLE_PREVIEW_SHAPES = [
	{ id: 'burst', label: 'Burst' },
	{ id: 'fountain', label: 'Fountain' },
] as const;

export type ParticlePreviewShape = (typeof PARTICLE_PREVIEW_SHAPES)[number]['id'];

/** The stage's smaller side, in the units the stock emitters are written in. */
export const PARTICLE_VIEW = 400;

/** The burst: a ring of this many particles, replayed every {@link BURST_PERIOD_S} seconds. */
export const BURST_COUNT = 24;
export const BURST_PERIOD_S = 2;
const BURST_LIFE_S = 1.5;
/** The fountain: particles a second, and how long each lives. */
const FOUNTAIN_RATE = 40;
const FOUNTAIN_LIFE_S = { min: 1.4, max: 1.6 };

/** A particle's larger side, in world units, on each emitter. */
export const PARTICLE_SIZE: Record<ParticlePreviewShape, number> = { burst: 44, fountain: 30 };

/** Emitter seconds per wall second at the game's speed. */
export const EMITTER_SECONDS_PER_SECOND = DEFAULT_EMIT_SPEED * 1000;

const emitterSeconds = (wall: number): number => wall * EMITTER_SECONDS_PER_SECOND;

/** The scale that gives a `width`×`height` frame the larger side its emitter's particles have. */
export function particleScale(shape: ParticlePreviewShape, width: number, height: number): number {
	const side = Math.max(width, height);
	return side > 0 && Number.isFinite(side) ? PARTICLE_SIZE[shape] / side : 1;
}

const fadeOut = {
	type: 'alpha',
	config: {
		alpha: {
			list: [
				{ value: 1, time: 0 },
				{ value: 1, time: 0.6 },
				{ value: 0, time: 1 },
			],
		},
	},
};

/**
 * The stock emitter `shape`, its particles at `scale` (art not bound: `bindArt` adds it). Burst: a
 * ring of {@link BURST_COUNT} flying out from the centre and slowing, one wave every
 * {@link BURST_PERIOD_S} s, each gone before the next. Fountain: a steady jet rising from below the
 * centre and falling back.
 */
export function particlePreviewConfig(
	shape: ParticlePreviewShape,
	scale: number,
): EmitterConfigV3 & { maxParticles: number } {
	const size = { type: 'scaleStatic', config: { min: scale, max: scale } };
	if (shape === 'burst') {
		const life = emitterSeconds(BURST_LIFE_S);
		// Units an emitter second, slowing from 4 to 1: about 140 units out over a life.
		const speed = 140 / (2.5 * life);
		return {
			lifetime: { min: life, max: life },
			frequency: emitterSeconds(BURST_PERIOD_S),
			particlesPerWave: BURST_COUNT,
			emitterLifetime: -1,
			maxParticles: BURST_COUNT,
			pos: { x: 0, y: 0 },
			addAtBack: false,
			behaviors: [
				{ type: 'spawnBurst', config: { spacing: 360 / BURST_COUNT, start: 0, distance: 12 } },
				{
					type: 'moveSpeed',
					config: {
						speed: {
							list: [
								{ value: 4 * speed, time: 0 },
								{ value: speed, time: 1 },
							],
						},
						minMult: 1,
					},
				},
				size,
				fadeOut,
			],
		};
	}
	const life = {
		min: emitterSeconds(FOUNTAIN_LIFE_S.min),
		max: emitterSeconds(FOUNTAIN_LIFE_S.max),
	};
	// Rising 220 units to its top halfway through a life and back down by its end.
	const half = (life.min + life.max) / 4;
	const rise = (2 * 220) / half;
	return {
		lifetime: life,
		frequency: emitterSeconds(1 / FOUNTAIN_RATE),
		emitterLifetime: -1,
		maxParticles: Math.ceil(FOUNTAIN_RATE * FOUNTAIN_LIFE_S.max) + 8,
		pos: { x: 0, y: 130 },
		addAtBack: false,
		behaviors: [
			{ type: 'spawnPoint', config: {} },
			{ type: 'rotationStatic', config: { min: 258, max: 282 } },
			{
				type: 'moveAcceleration',
				config: {
					accel: { x: 0, y: rise / half },
					minStart: rise * 0.9,
					maxStart: rise,
					rotate: false,
				},
			},
			size,
			fadeOut,
		],
	};
}
