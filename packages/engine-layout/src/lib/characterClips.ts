/**
 * WHICH CLIP AN ARCADE CHARACTER PLAYS (Salmons' S0 art, `docs/status/salmons.md` "S0 on the
 * engine"): a component's {@link CharacterClips} names its clips `<prefix>_<state>_<facing>`, and
 * the online runtime (`apps/lines` `game/online.ts`) asks this, once a frame per player, which one
 * to draw; `<SpawnLayer>` draws it (`arcadeClips.svelte.ts`). The rules are the old Salmon client's
 * `characterLook.js`:
 *
 * - the facing is one of the four isometric diagonals, from the drawn world velocity projected
 *   2:1 (`dx = vx − vy`, `dy = (vx + vy) / 2`); standing still keeps the last one;
 * - a missing facing is stood in for by its mirror twin (drawn mirrored), then its vertical twin,
 *   then that twin's mirror, before a missing state falls back to a near one
 *   ({@link CLIP_STATE_FALLBACK}); the right action facing slightly wrong beats the wrong action;
 * - a one-shot (a hop, a swipe, a cast, a catch) plays to its end before a loop takes over.
 *
 * Pure and Svelte-free: `scripts/check-character-clips.mjs` runs it in Node.
 */

import { CHARACTER_CLIP_EVENTS, type CharacterClipEvent, type CharacterClips } from './types';

export type ClipFacing = 'se' | 'sw' | 'ne' | 'nw';

export const CLIP_MIRROR: Readonly<Record<ClipFacing, ClipFacing>> = {
	se: 'sw',
	sw: 'se',
	ne: 'nw',
	nw: 'ne',
};
export const CLIP_VERTICAL: Readonly<Record<ClipFacing, ClipFacing>> = {
	se: 'ne',
	ne: 'se',
	sw: 'nw',
	nw: 'sw',
};

/** Where a state with no clip in any facing looks next; a state not listed (`caught`) has none. */
export const CLIP_STATE_FALLBACK: Readonly<Record<string, string>> = {
	hop: 'swim',
	swim: 'idle',
	swipe: 'idle',
	cast: 'reel',
	reel: 'idle',
	walk: 'idle',
	idle: 'walk',
};

/** How many fallbacks a state is followed through. */
const FALLBACK_HOPS = 4;

/** Below this drawn speed (world px/s) a character stands still. */
export const CLIP_STILL_SPEED = 15;

/** How long after it last moved a character still counts as moving, so a frame the interpolation
 *  holds it in place does not flick its walk to idle and back. */
export const CLIP_MOVING_HOLD_MS = 200;

/** How long a new facing must hold before the character turns: one pushed back and forth (by a
 *  bank's push, or a prediction corrected at a waterfall's foot) keeps the facing it had. */
export const CLIP_TURN_MS = 150;

/** A world velocity as drawn on the 2:1 isometric screen. */
export const projectedVelocity = (vx: number, vy: number): { dx: number; dy: number } => ({
	dx: vx - vy,
	dy: (vx + vy) / 2,
});

/** How far off an axis a direction must be to turn the facing across it, as a share of its
 *  length: moving along the screen's x or y axis does not flick between two facings. */
export const CLIP_FACING_DEADBAND = 0.25;

/** The facing of a screen direction; standing still keeps `previous`, and so does each half of it
 *  while the direction is within {@link CLIP_FACING_DEADBAND} of the other axis. */
export function clipFacingOf(dx: number, dy: number, previous: ClipFacing): ClipFacing {
	const length = Math.hypot(dx, dy);
	if (length < 1e-3) return previous;
	const ns = Math.abs(dy) > CLIP_FACING_DEADBAND * length ? (dy < 0 ? 'n' : 's') : previous[0];
	const ew = Math.abs(dx) > CLIP_FACING_DEADBAND * length ? (dx < 0 ? 'w' : 'e') : previous[1];
	return `${ns}${ew}` as ClipFacing;
}

/** A clip found for a state: its id, whether it is drawn mirrored, the state it plays and whether
 *  it is the marked prefix's (drawn as made, not tinted). */
export type ResolvedCharacterClip = {
	clipId: string;
	flipX: boolean;
	state: string;
	marked: boolean;
};

/** The prefixes tried, nearest first: a marked player's own clips, then the base ones. */
const prefixesOf = (look: CharacterClips, marked: boolean) =>
	marked && look.prefixes.marked
		? [
				{ prefix: look.prefixes.marked, marked: true },
				{ prefix: look.prefixes.base, marked: false },
			]
		: [{ prefix: look.prefixes.base, marked: false }];

/**
 * The clip `state` is drawn with facing `facing`, or `undefined` when neither it nor any state it
 * falls back to has a clip in any facing. `has` says whether a clip id is registered.
 */
export function resolveCharacterClip(
	look: CharacterClips,
	state: string,
	facing: ClipFacing,
	marked: boolean,
	has: (clipId: string) => boolean,
): ResolvedCharacterClip | undefined {
	const near: [ClipFacing, boolean][] = [
		[facing, false],
		[CLIP_MIRROR[facing], true],
		[CLIP_VERTICAL[facing], false],
		[CLIP_MIRROR[CLIP_VERTICAL[facing]], true],
	];
	for (const { prefix, marked: own } of prefixesOf(look, marked)) {
		let s: string | undefined = state;
		for (let hops = 0; s && hops < FALLBACK_HOPS; s = CLIP_STATE_FALLBACK[s], hops++) {
			for (const [clipFacing, flipX] of near) {
				const clipId = `${prefix}_${s}_${clipFacing}`;
				if (has(clipId)) return { clipId, flipX, state: s, marked: own };
			}
		}
	}
	return undefined;
}

/** The registered clips a character resolves against. */
export type CharacterClipSource = {
	has(clipId: string): boolean;
	/** How long one pass of a clip played once takes, in ms. */
	cycleMs(clipId: string): number | undefined;
};

/** What a character is doing this frame, as drawn: when, its world velocity (px/s), whether its
 *  line holds a player and whether the room marks it. */
export type CharacterFrame = {
	atMs: number;
	vx: number;
	vy: number;
	holding: boolean;
	marked: boolean;
};

/** The clip to draw: `play` changes each time a one-shot starts, so a repeat plays again. */
export type CharacterClipFrame = {
	clipId: string;
	flipX: boolean;
	loop: boolean;
	play: number;
	marked: boolean;
};

export type CharacterAnimator = {
	/** A room event about the player. Its one-shot starts on the next frame; whether the look has
	 *  one for it. */
	event(event: CharacterClipEvent): boolean;
	/** The clip of this frame, or `undefined` when the look has none (the component is drawn). */
	frame(frame: CharacterFrame): CharacterClipFrame | undefined;
	/** Whether `event`'s one-shot has a clip in some facing, without a fallback state. */
	plays(event: CharacterClipEvent, marked: boolean): boolean;
	/** Whether a one-shot is waiting to start or playing at `atMs`. */
	busy(atMs: number): boolean;
	readonly facing: ClipFacing;
};

/** A player's clips, frame to frame: its facing, its loop and the one-shot it is playing. */
export function createCharacterAnimator(
	look: CharacterClips,
	clips: CharacterClipSource,
	facing: ClipFacing = 'se',
): CharacterAnimator {
	let lastMovedAt = -Infinity;
	let turning: { to: ClipFacing; since: number } | undefined;
	let pending: string | undefined;
	let oneShot: (ResolvedCharacterClip & { until: number; play: number }) | undefined;
	let plays = 0;
	const has = (clipId: string) => clips.has(clipId);
	return {
		get facing() {
			return facing;
		},
		event(event) {
			const state = look.on?.[event];
			if (!state) return false;
			pending = state;
			return true;
		},
		plays(event, marked) {
			const state = look.on?.[event];
			if (!state) return false;
			// From `se` every facing is tried, its own state first.
			return resolveCharacterClip(look, state, 'se', marked, has)?.state === state;
		},
		busy(atMs) {
			return pending !== undefined || (!!oneShot && atMs < oneShot.until);
		},
		frame({ atMs, vx, vy, holding, marked }) {
			if (Math.hypot(vx, vy) > CLIP_STILL_SPEED) {
				const { dx, dy } = projectedVelocity(vx, vy);
				const to = clipFacingOf(dx, dy, facing);
				if (to === facing) turning = undefined;
				else if (turning?.to !== to) turning = { to, since: atMs };
				else if (atMs - turning.since >= CLIP_TURN_MS) {
					facing = to;
					turning = undefined;
				}
				lastMovedAt = atMs;
			}
			const moving = atMs - lastMovedAt <= CLIP_MOVING_HOLD_MS;
			const loopState =
				holding && look.holding ? look.holding : moving ? (look.walk ?? look.idle) : look.idle;
			const loop = resolveCharacterClip(look, loopState, facing, marked, has);
			if (pending !== undefined) {
				const next = resolveCharacterClip(look, pending, facing, marked, has);
				pending = undefined;
				// A one-shot that falls back to the loop already playing would only restart it.
				if (next && next.state !== loop?.state) {
					plays += 1;
					oneShot = { ...next, until: atMs + (clips.cycleMs(next.clipId) ?? 0), play: plays };
				}
			}
			if (oneShot && atMs < oneShot.until) {
				const { clipId, flipX, play, marked: own } = oneShot;
				return { clipId, flipX, loop: false, play, marked: own };
			}
			oneShot = undefined;
			if (!loop) return undefined;
			return { clipId: loop.clipId, flipX: loop.flipX, loop: true, play: 0, marked: loop.marked };
		},
	};
}

const name = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/**
 * A component's `characterClips` as saved: the known fields of the right shape, or `undefined`
 * when there is no base prefix, no idle state or no positive width (then the component draws its
 * own tree). The launcher's save keeps it through this (`componentStorage` `normalizeComponent`).
 */
export function normalizeCharacterClips(raw: unknown): CharacterClips | undefined {
	if (!raw || typeof raw !== 'object') return undefined;
	const r = raw as Record<string, unknown>;
	const prefixes = (r.prefixes ?? {}) as Record<string, unknown>;
	const width = r.displayWidth;
	if (!name(prefixes.base) || !name(r.idle)) return undefined;
	if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) return undefined;
	const out: CharacterClips = {
		prefixes: {
			base: prefixes.base,
			...(name(prefixes.marked) ? { marked: prefixes.marked } : {}),
		},
		displayWidth: width,
		idle: r.idle,
	};
	if (typeof r.anchorY === 'number' && Number.isFinite(r.anchorY)) out.anchorY = r.anchorY;
	if (name(r.walk)) out.walk = r.walk;
	if (name(r.holding)) out.holding = r.holding;
	const on: Partial<Record<CharacterClipEvent, string>> = {};
	const rawOn = (r.on ?? {}) as Record<string, unknown>;
	for (const event of CHARACTER_CLIP_EVENTS) {
		const state = rawOn[event];
		if (name(state)) on[event] = state;
	}
	if (Object.keys(on).length) out.on = on;
	return out;
}

/** The clip prefixes a component's `characterClips` names (what ships its clips, rule 8). */
export function characterClipPrefixes(look: CharacterClips | undefined): string[] {
	if (!look) return [];
	return [look.prefixes.base, ...(look.prefixes.marked ? [look.prefixes.marked] : [])];
}
