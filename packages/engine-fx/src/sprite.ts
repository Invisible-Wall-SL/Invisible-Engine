/**
 * Invisible FX — SPRITE TRANSFORM: a fixed rotation offset and a pivot (anchor) for the particle's
 * art, as ONE custom `@barvynkoa/particle-emitter` behavior (`fxSprite`).
 *
 * Both are display-only. The particle's `rotation` is also its launch direction (the movement
 * behaviors read it at init) and the target of every rotation writer (spin, `noRotation`,
 * `moveAcceleration`'s rotate-to-travel), so the offset is NOT added to it. It is carried on
 * `skew` instead: PIXI builds the local matrix from `rotation + skew.y` (x axis) and
 * `rotation − skew.x` (y axis), so `skew = (−θ, θ)` draws the sprite at `rotation + θ` with no
 * shear, whatever the other behaviors do to `rotation`. The library never touches `skew` or
 * `anchor`, so the pair survives the particle's whole life. The pivot is the particle's anchor —
 * the point of the art that sits on the spawn position and that the art turns around.
 *
 * A layer carries `fxSprite` only when either knob is off its default, so every other effect stays
 * 100% stock. Particles are pooled and `Particle.init` resets neither field, so recycling restores
 * the library's centred, unskewed default — otherwise switching the behavior off in the editor
 * (`emitter.init` recycles live particles through the OLD behaviors) would leave stale art.
 */

export const FX_SPRITE_BEHAVIOR_TYPE = 'fxSprite';

/** `fxSprite`'s config. `rotation` is degrees; the anchor is 0..1 across the art (0.5 = centre). */
export interface FxSpriteConfig {
	rotation?: number;
	anchorX?: number;
	anchorY?: number;
}

/** The clamped, defaulted form every reader goes through. */
export interface FxSpriteTransform {
	rotation: number;
	anchorX: number;
	anchorY: number;
}

export const FX_SPRITE_DEFAULT: FxSpriteTransform = { rotation: 0, anchorX: 0.5, anchorY: 0.5 };

/** The slice of the library's `Particle` this behavior touches (structural — no PixiJS import). */
export interface FxSpriteParticleLike {
	anchor: { set(x: number, y?: number): void };
	skew: { set(x: number, y?: number): void };
	next: FxSpriteParticleLike | null;
}

/** After `noRotation` (`BehaviorOrder.Late + 1`), so nothing inits later. Order only sorts. */
const ORDER_AFTER_ROTATION = 7;

function finite(v: unknown, fallback: number): number {
	const n = Number(v);
	return Number.isFinite(n) ? n : fallback;
}

/** Wrap an angle into −180..180 so a saved value stays readable on the ± slider. */
function wrapDeg(deg: number): number {
	const w = (((deg + 180) % 360) + 360) % 360;
	return w - 180;
}

/** The one clamp: NaN → default, rotation wrapped to −180..180, anchor pinned to 0..1. */
export function readFxSprite(config: FxSpriteConfig | undefined): FxSpriteTransform {
	const clamp01 = (v: unknown) => Math.min(1, Math.max(0, finite(v, 0.5)));
	return {
		rotation: wrapDeg(finite(config?.rotation, 0)),
		anchorX: clamp01(config?.anchorX),
		anchorY: clamp01(config?.anchorY),
	};
}

/** Whether a transform is the library's own default (centred, unrotated) — i.e. needs no behavior. */
export function isDefaultFxSprite(t: FxSpriteTransform): boolean {
	return (
		t.rotation === FX_SPRITE_DEFAULT.rotation &&
		t.anchorX === FX_SPRITE_DEFAULT.anchorX &&
		t.anchorY === FX_SPRITE_DEFAULT.anchorY
	);
}

export class FxSpriteBehavior {
	static type = FX_SPRITE_BEHAVIOR_TYPE;
	order = ORDER_AFTER_ROTATION;
	private skewRad: number;
	private anchorX: number;
	private anchorY: number;

	constructor(config: FxSpriteConfig) {
		const t = readFxSprite(config);
		this.skewRad = (t.rotation * Math.PI) / 180;
		this.anchorX = t.anchorX;
		this.anchorY = t.anchorY;
	}

	initParticles(first: FxSpriteParticleLike): void {
		for (let p: FxSpriteParticleLike | null = first; p; p = p.next) {
			p.anchor.set(this.anchorX, this.anchorY);
			p.skew.set(-this.skewRad, this.skewRad);
		}
	}

	recycleParticle(particle: FxSpriteParticleLike): void {
		particle.anchor.set(FX_SPRITE_DEFAULT.anchorX, FX_SPRITE_DEFAULT.anchorY);
		particle.skew.set(0, 0);
	}
}
