import { Texture } from 'pixi.js';
import type { ParticleEmitterProps } from 'pixi-svelte';
import { trail } from 'constants-shared/particleConfig';

/**
 * THE CODED FLIGHT LOOK (design §4.4) — what an unauthored game draws for a flight: a soft glow for
 * the head and the same glow as the trail's particle. Phase 7's `flights` authoring block replaces
 * both per flight kind; until then every flight reads as a plain golden streak.
 */

/** The glow texture's side, in texels. Drawn scaled, so this is resolution, not size. */
export const FLIGHT_GLOW_SIZE = 64;

let glow: Texture | undefined;

/**
 * A radial-gradient dot, painted once on a canvas and cached for the session. Browser-only: the
 * first flight asks for it, and no flight runs during SSR.
 */
export const flightGlowTexture = (): Texture => {
	if (glow) return glow;
	const canvas = document.createElement('canvas');
	canvas.width = FLIGHT_GLOW_SIZE;
	canvas.height = FLIGHT_GLOW_SIZE;
	const ctx = canvas.getContext('2d');
	if (ctx) {
		const r = FLIGHT_GLOW_SIZE / 2;
		const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
		gradient.addColorStop(0, 'rgba(255,255,255,1)');
		gradient.addColorStop(0.25, 'rgba(255,255,255,0.85)');
		gradient.addColorStop(0.6, 'rgba(255,255,255,0.25)');
		gradient.addColorStop(1, 'rgba(255,255,255,0)');
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, FLIGHT_GLOW_SIZE, FLIGHT_GLOW_SIZE);
	}
	glow = Texture.from(canvas);
	return glow;
};

/** The head's tint — a coin's gold. */
export const FLIGHT_HEAD_TINT = 0xffd45a;

/**
 * The trail: the shared `trail` config (stationary particles shrinking over half an emitter-second,
 * spawned densely) in gold, additive, fading to nothing — dense additive spawns saturate to white at
 * the coded config's 0.8 alpha. It only reads as a trail because the
 * emitter's OWNER moves (`<ParticleEmitter ownerPos>`); its container must stay still.
 */
export const FLIGHT_TRAIL_CONFIG: ParticleEmitterProps['config'] = {
	...trail,
	alpha: { start: 0.55, end: 0 },
	color: { start: '#ffe9a0', end: '#ff8a00' },
	blendMode: 'add',
};

/** The longest a trail particle lives, in EMITTER seconds — what a finished flight waits out. */
export const FLIGHT_TRAIL_LIFETIME_S = trail.lifetime.max;
