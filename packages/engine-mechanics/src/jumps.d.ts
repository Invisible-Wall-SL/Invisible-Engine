/**
 * Types for arcade jumps (`jumps.js`, `docs/design/game-families.md` §4.4, P10.13). The spec types
 * mirror game-config's `ArcadeJump` / the `flap` controller structurally. Pinned by
 * `scripts/check-arcade-platformer.mjs`.
 */

import type { Body } from './motion.js';

export type JumpKind = 'gravity' | 'hop';

export type JumpSpec = {
	kind: JumpKind;
	/** px above the take-off at the apex. */
	height: number;
	/** Seconds from take-off to the apex. */
	time: number;
	/** px a tap reaches (hold to jump higher); absent ⇒ every jump reaches `height`. */
	minHeight?: number;
	coyoteMs?: number;
	bufferMs?: number;
	/** 0..1, how much the player steers while airborne; absent ⇒ 1. */
	airControl?: number;
};

export type FlapSpec = { kick: number };

/** Kept per character by the loop. `z` / `vz` are a hop's height (px) and its rate (px/s, up). */
export type JumpState = {
	held: boolean;
	coyote: number;
	buffer: number;
	rising: boolean;
	z: number;
	vz: number;
};

export type JumpProfile = { launch: number; gravity: number; cut: number };

export const DEFAULT_COYOTE_MS: 100;
export const DEFAULT_BUFFER_MS: 100;
export const JUMP_KINDS: JumpKind[];

export function jumpProfile(jump: Pick<JumpSpec, 'height' | 'time' | 'minHeight'>): JumpProfile;
export function createJumpState(): JumpState;
export function stepJump(
	jump: JumpSpec,
	state: JumpState,
	body: Body,
	options: { pressed: boolean; grounded: boolean; dt: number; fallGravity?: number },
): { gravity: number; jumped: boolean };
export function stepHop(
	jump: JumpSpec,
	state: JumpState,
	options: { pressed: boolean; dt: number },
): { airborne: boolean; jumped: boolean; landed: boolean };
export function stepFlap(flap: FlapSpec, state: JumpState, body: Body, pressed: boolean): boolean;
