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
 * A look with `facings: 8` (game-families §9 #28) has the four straight facings too
 * ({@link clipFacing8Of}): the nearest of eight, 45° apart on the ground. Its stand-ins are the
 * mirror twin, then the nearest facings outward by angle, each before its own mirror twin
 * ({@link resolveCharacterClip}), so a character drawn in five facings covers all eight and one
 * drawn only in the diagonals still plays.
 *
 * Pure and Svelte-free: `scripts/check-character-clips.mjs` runs it in Node.
 */

import { editorArtTextureKey, isManifestAssetKey, parseScopedFrameRef } from './editorArtKey';
import type { FlipbookClipEntry } from './registerFlipbooks';
import { CHARACTER_CLIP_EVENTS, type CharacterClipEvent, type CharacterClips } from './types';

/** The four isometric diagonals: every facing of a look that names no `facings` (or 4). */
export type ClipDiagonal = 'se' | 'sw' | 'ne' | 'nw';

/** The eight facings of a look with `facings: 8`, clockwise from north as the screen draws them. */
export const CLIP_FACINGS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;
export type ClipFacing = (typeof CLIP_FACINGS)[number];

export const CLIP_MIRROR: Readonly<Record<ClipDiagonal, ClipDiagonal>> = {
	se: 'sw',
	sw: 'se',
	ne: 'nw',
	nw: 'ne',
};
export const CLIP_VERTICAL: Readonly<Record<ClipDiagonal, ClipDiagonal>> = {
	se: 'ne',
	ne: 'se',
	sw: 'nw',
	nw: 'sw',
};

const isDiagonal = (facing: ClipFacing): facing is ClipDiagonal => facing.length === 2;

/** A facing's mirror twin, whose clip drawn mirrored stands in for it; `n` and `s` have none. */
export const clipMirrorOf = (facing: ClipFacing): ClipFacing | undefined =>
	isDiagonal(facing)
		? CLIP_MIRROR[facing]
		: facing === 'e'
			? 'w'
			: facing === 'w'
				? 'e'
				: undefined;

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

/** How long a one-shot plays when its clip's length cannot be read. */
export const CLIP_ONE_SHOT_MS = 1000;

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
export function clipFacingOf(dx: number, dy: number, previous: ClipDiagonal): ClipDiagonal {
	const length = Math.hypot(dx, dy);
	if (length < 1e-3) return previous;
	const ns = Math.abs(dy) > CLIP_FACING_DEADBAND * length ? (dy < 0 ? 'n' : 's') : previous[0];
	const ew = Math.abs(dx) > CLIP_FACING_DEADBAND * length ? (dx < 0 ? 'w' : 'e') : previous[1];
	return `${ns}${ew}` as ClipDiagonal;
}

/** How many times flatter than wide the 2:1 isometric screen draws the ground. */
const ISO_FLATTENING = 2;

/**
 * How many times flatter than wide a screen draws the ground, read off its projection of a world
 * vector (`projection.ts` `IsoProjector.project`): 2 on the 2:1 isometric screen, mirrored or not,
 * and 1 on a flat one.
 */
export function screenFlattening(
	project: (x: number, y: number) => { x: number; y: number },
): number {
	const x = project(1, 0);
	const y = project(0, 1);
	const down = Math.hypot(x.y, y.y);
	return down > 0 ? Math.hypot(x.x, y.x) / down : 1;
}

const EIGHTH = Math.PI / 4;

/** How far past the edge of its 45° sector a direction must be to turn a character of eight
 *  facings, in radians (7.5°): one moving along the edge between two facings keeps the one it
 *  has. */
export const CLIP_FACING8_DEADBAND = Math.PI / 24;

/**
 * The facing, of eight, of a screen direction: the nearest, 45° apart on the ground, so the
 * screen's `flattening` of the ground is taken out first ({@link screenFlattening}). On the 2:1
 * isometric screen `e` is straight right and `se` runs down a cell's edge, 26.6° below it: the
 * eight directions the screen's keys move a character in are the eight facings' middles.
 * Standing still keeps `previous`, and so does a direction within {@link CLIP_FACING8_DEADBAND}
 * of its sector's edge.
 */
export function clipFacing8Of(
	dx: number,
	dy: number,
	previous: ClipFacing,
	flattening = ISO_FLATTENING,
): ClipFacing {
	const down = dy * flattening;
	if (Math.hypot(dx, down) < 1e-3) return previous;
	// Clockwise from north: the screen's y runs down.
	const turn = Math.atan2(dx, -down);
	const from = turn - CLIP_FACINGS.indexOf(previous) * EIGHTH;
	const off = Math.abs(Math.atan2(Math.sin(from), Math.cos(from)));
	if (off <= EIGHTH / 2 + CLIP_FACING8_DEADBAND) return previous;
	return CLIP_FACINGS[(Math.round(turn / EIGHTH) + 8) % 8];
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

/** How far towards the viewer (south) and towards the east a facing looks, −2 to 2, by its place
 *  in {@link CLIP_FACINGS}. */
const southOf = (index: number) => 2 - Math.abs(4 - index);
const eastOf = (index: number) => southOf((index + 2) % 8);

/**
 * The clips a look of eight facings tries for `facing`, nearest first, each with whether it is
 * drawn mirrored: the facings seen outward by angle (itself, then 45° either side, and so on to
 * its opposite), each as made before its mirror twin's clip drawn mirrored. Of two as near, the
 * one `prefer`red (the facing last seen) comes first, else the one looking more towards the
 * viewer, else the eastern (drawn as made).
 */
function standIns8(facing: ClipFacing, prefer: ClipFacing | undefined): [ClipFacing, boolean][] {
	const at = CLIP_FACINGS.indexOf(facing);
	const near: [ClipFacing, boolean][] = [];
	for (let away = 0; away <= 4; away++) {
		const a = (at + away) % 8;
		const b = (at - away + 8) % 8;
		const bFirst =
			CLIP_FACINGS[b] === prefer ||
			(CLIP_FACINGS[a] !== prefer &&
				(southOf(b) > southOf(a) || (southOf(b) === southOf(a) && eastOf(b) > eastOf(a))));
		for (const index of a === b ? [a] : bFirst ? [b, a] : [a, b]) {
			const seen = CLIP_FACINGS[index];
			near.push([seen, false]);
			const twin = clipMirrorOf(seen);
			if (twin) near.push([twin, true]);
		}
	}
	return near;
}

/** The facing a resolved clip is seen in: its own, or its mirror twin's when drawn mirrored. */
function seenFacing({ clipId, flipX }: ResolvedCharacterClip): ClipFacing {
	const made = clipId.slice(clipId.lastIndexOf('_') + 1) as ClipFacing;
	return (flipX && clipMirrorOf(made)) || made;
}

/**
 * The clip `state` is drawn with facing `facing`, or `undefined` when neither it nor any state it
 * falls back to has a clip in any facing. `has` says whether a clip id is registered. A look of
 * eight facings breaks a tie between two stand-ins as near by `prefer`, the facing it was last
 * seen in ({@link standIns8}).
 */
export function resolveCharacterClip(
	look: CharacterClips,
	state: string,
	facing: ClipFacing,
	marked: boolean,
	has: (clipId: string) => boolean,
	prefer?: ClipFacing,
): ResolvedCharacterClip | undefined {
	const near: [ClipFacing, boolean][] =
		look.facings === 8 || !isDiagonal(facing)
			? standIns8(facing, prefer)
			: [
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
	/** The screen's projection of a world vector (`projection.ts` `IsoProjector.project`: a mirrored
	 *  screen's); absent ⇒ {@link projectedVelocity}. */
	project?: (x: number, y: number) => { x: number; y: number };
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
	/** The state of the one-shot waiting to start or playing at `atMs`, if any. */
	oneShot(atMs: number): string | undefined;
	/** Forget the one-shot and the turn in hand (a player gone, or moved by the room); the facing
	 *  is kept. */
	reset(): void;
	readonly facing: ClipFacing;
};

/** A player's clips, frame to frame: its facing, its loop and the one-shot it is playing. */
export function createCharacterAnimator(
	look: CharacterClips,
	clips: CharacterClipSource,
	facing: ClipFacing = 'se',
): CharacterAnimator {
	const eight = look.facings === 8;
	let lastMovedAt = -Infinity;
	let turning: { to: ClipFacing; since: number } | undefined;
	let pending: string | undefined;
	let oneShot: (ResolvedCharacterClip & { until: number; play: number }) | undefined;
	let plays = 0;
	/** The facing its loop was last seen in: of two stand-ins as near, a look of eight keeps it. */
	let seen: ClipFacing | undefined;
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
		oneShot(atMs) {
			return pending ?? (oneShot && atMs < oneShot.until ? oneShot.state : undefined);
		},
		reset() {
			pending = undefined;
			oneShot = undefined;
			turning = undefined;
		},
		frame({ atMs, vx, vy, holding, marked, project }) {
			if (Math.hypot(vx, vy) > CLIP_STILL_SPEED) {
				const on = project?.(vx, vy);
				const { dx, dy } = on ? { dx: on.x, dy: on.y } : projectedVelocity(vx, vy);
				const to = eight
					? clipFacing8Of(dx, dy, facing, project ? screenFlattening(project) : ISO_FLATTENING)
					: clipFacingOf(dx, dy, isDiagonal(facing) ? facing : 'se');
				if (to === facing) turning = undefined;
				else if (turning?.to !== to) turning = { to, since: atMs };
				else if (atMs - turning.since >= CLIP_TURN_MS) {
					facing = to;
					turning = undefined;
				}
				lastMovedAt = atMs;
			} else turning = undefined;
			const moving = atMs - lastMovedAt <= CLIP_MOVING_HOLD_MS;
			const loopState =
				holding && look.holding ? look.holding : moving ? (look.walk ?? look.idle) : look.idle;
			const loop = resolveCharacterClip(look, loopState, facing, marked, has, seen);
			if (eight && loop) seen = seenFacing(loop);
			if (pending !== undefined) {
				const next = resolveCharacterClip(look, pending, facing, marked, has, seen);
				pending = undefined;
				// A one-shot that falls back to the loop already playing would only restart it.
				if (next && next.state !== loop?.state) {
					plays += 1;
					const ms = clips.cycleMs(next.clipId) ?? CLIP_ONE_SHOT_MS;
					oneShot = { ...next, until: atMs + ms, play: plays };
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
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

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
	if (r.facings === 4 || r.facings === 8) out.facings = r.facings;
	const hand = (r.hand ?? {}) as Record<string, unknown>;
	if (finite(hand.x) && finite(hand.y)) out.hand = { x: hand.x, y: hand.y };
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

/**
 * The clips a character plays in a game that names clips for it itself (Salmons): its component's
 * block, or the game's when the component names none; and a block that names no `facings` (one
 * saved before a character could have eight) takes the game's for that character. A block that
 * names its `facings` is played as written.
 */
export function characterClipsIn(
	own: CharacterClips | undefined,
	game: CharacterClips | undefined,
): CharacterClips | undefined {
	if (!own) return game;
	return own.facings === undefined && game?.facings ? { ...own, facings: game.facings } : own;
}

/** Where a character's hand is on its clip's box when its look names none: on its leading side,
 *  two fifths of the way down. */
export const CLIP_HAND = { x: 0.75, y: 0.4 } as const;

/**
 * A clip's box in art px, as `<SpawnLayer>` draws it: its Bounds box, else its first frame's size.
 * `undefined` until that frame's texture is in `assets` (the app's loaded assets): until then the
 * clip is not drawn. (`<SpawnLayer>` keeps its own test of this: it is in every runtime's bundle,
 * this module only in an arcade one.)
 */
export function clipBox(
	clip: FlipbookClipEntry,
	assets: Record<string, unknown> | undefined,
): { w: number; h: number } | undefined {
	const first = clip.frames[0];
	if (!first) return undefined;
	const { assetKey, region } = parseScopedFrameRef(first);
	const sheet = assetKey ?? clip.assetKey;
	const scoped = isManifestAssetKey(sheet)
		? assets?.[editorArtTextureKey(sheet, region)]
		: undefined;
	const frame = (scoped ?? assets?.[region]) as { width?: number; height?: number } | undefined;
	if (!frame?.width || !frame.height) return undefined;
	const { bounds } = clip;
	return bounds && bounds.w > 0 && bounds.h > 0
		? { w: bounds.w, h: bounds.h }
		: { w: frame.width, h: frame.height };
}

/**
 * The points of a character drawn by a clip, from its place (its feet) in px as drawn: its `hand`
 * (`dx` right of the place, `lift` above it: a line it holds starts there) and its `middle` (how
 * far above the place). `box` is the clip's ({@link clipBox}), drawn `displayWidth` wide with its
 * feet at `anchorY`; a clip drawn mirrored (`flipX`) has its hand on the other side.
 */
export function clipPoints(
	look: CharacterClips,
	box: { w: number; h: number },
	flipX: boolean,
): { hand: { dx: number; lift: number }; middle: number } {
	const hand = look.hand ?? CLIP_HAND;
	const height = (look.displayWidth * box.h) / box.w;
	const feet = look.anchorY ?? 1;
	const across = (hand.x - 0.5) * look.displayWidth;
	return {
		hand: { dx: flipX ? -across : across, lift: (feet - hand.y) * height },
		middle: (feet - 0.5) * height,
	};
}
