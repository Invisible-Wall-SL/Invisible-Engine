/**
 * What one Element FX sees on one frame, and the motion it can hand back. Pure: no Pixi, so the
 * samplers in `kinds.ts` can be driven headlessly (`tools/fx-spike/elementFx.ts`).
 */

import type { ElementFxParamValue } from 'constants-shared/elementFx';

export interface FxFrame {
	/** Progress through the current play, 0…1. */
	t: number;
	/** Seconds since the effect started playing (it keeps counting across repeats). */
	seconds: number;
	/** Seconds in one play. */
	playSeconds: number;
	intensity: number;
	params: Readonly<Record<string, ElementFxParamValue>>;
	/** It repeats until stopped: a loop kind plays at full strength with no fade in or out. */
	looping: boolean;
	/** The element's size in its own units (its local bounds). */
	width: number;
	height: number;
}

/**
 * A change to the element's transform, applied in its OWN space about `pivot` before its placement:
 * so a scaled or rotated element shakes, swells and spins in its own frame.
 */
export interface Motion {
	/** Offset in the element's own units. */
	x: number;
	y: number;
	scaleX: number;
	scaleY: number;
	/** Radians. */
	rotation: number;
	skewX: number;
	skewY: number;
	/** Multiplies the element's alpha. */
	alpha: number;
	/** The point the scale and rotation turn about, as a share of the element's box (0.5 = centre). */
	pivotX: number;
	pivotY: number;
}

export const REST: Readonly<Motion> = Object.freeze({
	x: 0,
	y: 0,
	scaleX: 1,
	scaleY: 1,
	rotation: 0,
	skewX: 0,
	skewY: 0,
	alpha: 1,
	pivotX: 0.5,
	pivotY: 0.5,
});

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
export const smoothstep = (a: number, b: number, v: number): number => {
	const k = clamp01((v - a) / (b - a));
	return k * k * (3 - 2 * k);
};
export const easeOutQuad = (t: number): number => 1 - (1 - t) * (1 - t);
export const easeInQuad = (t: number): number => t * t;
export const easeInOutCubic = (t: number): number =>
	t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
/** Overshoots past 1 by about `c1 / 10` and settles. */
export const easeOutBack = (t: number, c1: number): number =>
	1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
export const easeInBack = (t: number, c1: number): number => (c1 + 1) * t * t * t - c1 * t * t;
/** 0 at both ends, 1 in the middle. */
export const bell = (t: number): number => Math.sin(Math.PI * clamp01(t));

/**
 * The strength envelope of a LOOP kind: full while it repeats forever, otherwise eased in over the
 * first 15% and out over the last 15%, so a wave or a glow played on a cue starts and ends at rest.
 */
export const loopEnvelope = (frame: FxFrame): number =>
	frame.looping ? 1 : smoothstep(0, 0.15, frame.t) * (1 - smoothstep(0.85, 1, frame.t));

/** A number param (every kind's spec gives each one a default, so this is never `undefined`). */
export const num = (frame: FxFrame, id: string): number => {
	const v = frame.params[id];
	return typeof v === 'number' ? v : 0;
};

export const str = (frame: FxFrame, id: string): string => {
	const v = frame.params[id];
	return typeof v === 'string' ? v : '';
};

export const flag = (frame: FxFrame, id: string): boolean => frame.params[id] === true;

/** `#rrggbb` → [r, g, b] in 0…1. */
export const rgb = (hex: string): [number, number, number] => {
	const n = Number.parseInt(hex.slice(1), 16);
	if (!Number.isFinite(n)) return [1, 1, 1];
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
