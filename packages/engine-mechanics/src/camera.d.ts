/**
 * Types for the arcade camera (`camera.js`, `docs/design/game-families.md` §4.4). Behaviour is
 * pinned by `apps/launcher-api/scripts/check-arcade-camera.ts`.
 */

import type { Aabb } from './motion';

/** A play-field screen's `camera` block, as authored (every field optional). */
export type CameraSpec = {
	/** The tag of the body to follow (the first carrying it, in spawn order). */
	follow?: string;
	/** A rectangle centred on the view the followed body moves in without moving the camera. */
	deadZone?: { w?: number; h?: number };
	/** Seconds the camera takes to close ~63 % of the way to its aim. 0 / absent ⇒ snaps. */
	smoothing?: number;
	/** Seconds of the followed body's velocity the camera leads it by. */
	lookAhead?: number;
	/** Hold the view inside the world. Absent ⇒ true. */
	clampToWorld?: boolean;
	/** px/s per axis; an axis that scrolls is not aimed. */
	autoScroll?: { x?: number; y?: number };
};

export type ResolvedCameraSpec = {
	follow: string | undefined;
	deadZone: { w: number; h: number };
	smoothing: number;
	lookAhead: number;
	clampToWorld: boolean;
	autoScroll: { x: number; y: number };
};

export type CameraFollow = { tag: string } | { id: string };

export type Camera = {
	readonly spec: ResolvedCameraSpec;
	/** The view's top-left, world px. */
	x: number;
	y: number;
	follow: CameraFollow | undefined;
	goal: { x: number; y: number } | undefined;
	autoScroll: { x: number; y: number };
	snapNext: boolean;
	shake: { strength: number; totalMs: number; leftMs: number };
	/** This step's drawn-only shake. */
	offsetX: number;
	offsetY: number;
	random: () => number;
};

export type Size = { w: number; h: number };

export function resolveCameraSpec(spec?: CameraSpec): ResolvedCameraSpec;
export function createCamera(spec: CameraSpec | undefined, random: () => number): Camera;
export function stepCamera(
	camera: Camera,
	dt: number,
	frame: {
		view: Size;
		world?: Size;
		target?: { x: number; y: number; vx: number; vy: number };
	},
): Camera;
export function followWith(camera: Camera, follow: CameraFollow | undefined, snap?: boolean): void;
export function moveCameraTo(camera: Camera, x: number, y: number, snap?: boolean): void;
export function shakeCamera(camera: Camera, strength: number, durationMs: number): void;
export function viewRect(camera: Camera, view: Size): Aabb;
export function parallaxOffset(
	camera: Pick<Camera, 'x' | 'y'>,
	factor: { x: number; y: number },
): { x: number; y: number };
