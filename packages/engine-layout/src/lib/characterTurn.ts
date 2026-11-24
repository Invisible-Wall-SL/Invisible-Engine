/**
 * THE SMOOTH TURN OF A CHARACTER WITH A SHEET (`docs/design/character-pipeline.md` §13): the
 * angles and the weights behind `view.turn`. A view of four or eight facings draws one picture per
 * facing, and without the option the picture changes at once when the facing does. With it the
 * character has a DRAWN HEADING that follows where it moves at a limited rate, the picture is the
 * facing whose sector that heading is in, and a change of picture is a BLEND: the two are mixed
 * for a while, the cycle carried on where it was. A subject seen from above is also rotated by
 * what the heading has left over (its LEAN); an upright one is not, a lean would tip it over.
 *
 * Every heading here is in radians, clockwise from north, on the ground: the screen's direction
 * with its flattening of the ground taken out (`characterClips.ts` `screenFlattening`), which is
 * the space the facings are 45° or 90° apart in. A lean is an angle on the screen, clockwise, the
 * rotation the picture is drawn at.
 *
 * `characterSheet.ts` `createSheetAnimator` and `createSheetRigAnimator` drive these; this module
 * holds no state. Pure and Svelte-free: `scripts/check-character-turn.mjs` runs it in Node.
 */

import type { CharacterView } from 'game-config';

import { CLIP_FACINGS, type ClipFacing } from './characterClips';

const DEGREE = Math.PI / 180;
const TURN = Math.PI * 2;

/** How fast the drawn heading follows when the sheet names no `speed`, degrees a second
 *  (`game-config` `CHARACTER_TURN_SPEED`; the gate holds the two equal). */
export const SHEET_TURN_SPEED = 360;

/** A sheet's smooth turn as the animator reads it, in radians. */
export type SheetTurn = {
	/** The angle between two facings of the view. */
	sector: number;
	/** The most a picture leans from its facing, at most half the sector. */
	lean: number;
	/** How far the drawn heading turns in a second; 0 ⇒ it is the heading aimed at, at once. */
	speed: number;
	/** How long two pictures are mixed when the one drawn changes, ms; 0 ⇒ it changes at once. */
	blend: number;
	/** Whether the lean turns the picture about its feet (its place), not its middle. */
	feet: boolean;
};

/** How long two pictures are mixed when the sheet names no `blend`, ms (`game-config`
 *  `CHARACTER_TURN_BLEND`; the gate holds the two equal). */
export const SHEET_TURN_BLEND = 160;

/**
 * The smooth turn of a view, or `undefined` when it has none: a view with no `turn`, a side view
 * (two facings, nothing to turn through) and a `3d` one (the body's yaw turns the model).
 */
export function sheetTurnOf(view: CharacterView | undefined): SheetTurn | undefined {
	if (!view || view.kind === 'side' || view.kind === '3d' || !view.turn) return undefined;
	const sector = TURN / (view.facings === 8 ? 8 : 4);
	const { lean, speed, blend, pivot } = view.turn;
	// Seen from above, a picture leans half a sector, where the turn is continuous; an upright
	// character in an isometric view does not lean unless its sheet says so.
	const most = lean === undefined ? (view.kind === 'isometric' ? 0 : Infinity) : lean * DEGREE;
	return {
		sector,
		lean: Math.min(Math.max(most, 0), sector / 2),
		speed: Math.max(speed ?? SHEET_TURN_SPEED, 0) * DEGREE,
		blend: Math.max(blend ?? SHEET_TURN_BLEND, 0),
		feet: pivot === 'feet',
	};
}

/** An angle as the one of the same direction between −π (not included) and π. */
export const wrapAngle = (angle: number): number => {
	const wrapped = angle - TURN * Math.round(angle / TURN);
	return wrapped <= -Math.PI ? wrapped + TURN : wrapped;
};

/** The heading a facing looks along: `n` is 0, `e` a quarter turn. */
export const facingHeading = (facing: ClipFacing): number =>
	(CLIP_FACINGS.indexOf(facing) * TURN) / 8;

/** The heading of a direction on the screen (y down), with the screen's `flattening` of the
 *  ground taken out. */
export const headingOf = (dx: number, dy: number, flattening: number): number =>
	Math.atan2(dx, -dy * flattening);

/** Where a ground heading points on the screen, clockwise from straight up. */
const onScreen = (heading: number, flattening: number): number =>
	Math.atan2(Math.sin(heading), Math.cos(heading) / flattening);

/** `heading`, held inside the sector of `facing`: one past its edge is the edge. */
export function headingWithin(heading: number, facing: ClipFacing, sector: number): number {
	const centre = facingHeading(facing);
	const off = wrapAngle(heading - centre);
	return centre + Math.min(Math.max(off, -sector / 2), sector / 2);
}

/** `from` turned towards `to` the short way round, by `step` at most. */
export function turnTowards(from: number, to: number, step: number): number {
	const off = wrapAngle(to - from);
	return Math.abs(off) <= step ? to : from + Math.sign(off) * step;
}

/** A heading on the very edge of a sector is still in it: float noise on the edge two facings
 *  share never changes the picture. */
const EDGE = 1e-9;

/**
 * The facing, of `facings`, a heading is drawn in: `current` while the heading is in its sector
 * (its edges included), else the facing whose middle is nearest.
 */
export function facingOfHeading(
	heading: number,
	facings: readonly ClipFacing[],
	current: ClipFacing,
	sector: number,
): ClipFacing {
	let nearest = current;
	let least = Math.abs(wrapAngle(heading - facingHeading(current)));
	if (facings.includes(current) && least <= sector / 2 + EDGE) return current;
	if (!facings.includes(current)) least = Infinity;
	for (const facing of facings) {
		const off = Math.abs(wrapAngle(heading - facingHeading(facing)));
		if (off < least) {
			least = off;
			nearest = facing;
		}
	}
	return nearest;
}

/**
 * The lean a picture made for `facing` is drawn at while the character heads `heading`: the
 * heading's distance from the facing's middle, `most` at most either way, as the angle that is on
 * the screen (a flattened ground squeezes the angles between its facings). It is the same for a
 * picture drawn mirrored: the lean turns what is seen, after the mirror.
 *
 * A picture may be kept while the heading leaves its `sector` (a one-shot or a hold keeps the
 * facing it started in, a stand-in is another facing's): past the sector's edge the lean eases
 * back, to none when the heading is opposite the picture. So it never flips from one side to the
 * other there, where a heading a hair either way is as far round both ways.
 */
export function leanOf(
	heading: number,
	facing: ClipFacing,
	most: number,
	flattening = 1,
	sector = most * 2,
): number {
	const centre = facingHeading(facing);
	const from = wrapAngle(heading - centre);
	const far = Math.abs(from);
	const kept = Math.min(Math.max((Math.PI - far) / (Math.PI - sector / 2), 0), 1);
	const off = Math.sign(from) * Math.min(far, most) * kept;
	return wrapAngle(onScreen(centre + off, flattening) - onScreen(centre, flattening));
}

/** The direction a picture of `facing` drawn at `lean` is seen heading, on the screen. */
export const drawnDirection = (facing: ClipFacing, lean: number, flattening = 1): number =>
	wrapAngle(onScreen(facingHeading(facing), flattening) + lean);

/**
 * A point of a character (`dx` right of its place, `lift` above it) as it is once the character
 * is drawn at `lean` about its pivot, the point `about` above its place (0 ⇒ its place, its
 * feet): a hand turns with the body.
 */
export function leanedPoint(
	point: { dx: number; lift: number },
	lean: number,
	about = 0,
): { dx: number; lift: number } {
	const cos = Math.cos(lean);
	const sin = Math.sin(lean);
	const lift = point.lift - about;
	return { dx: point.dx * cos + lift * sin, lift: about + lift * cos - point.dx * sin };
}

/**
 * How much of the picture it is turning INTO a blend draws, 0 to 1, once `progress` (0 to 1) of
 * its time has gone: eased at both ends, never back. The picture it leaves has the rest, so the
 * two weights are 1 together; and since the ease is symmetric, a blend turned back at `progress`
 * goes on from `1 - progress` at the same weights.
 */
export function blendWeight(progress: number): number {
	const t = Math.min(Math.max(progress, 0), 1);
	return t * t * (3 - 2 * t);
}

/**
 * The opacity two pictures are drawn at to cross-fade at `weight` (the incoming one's,
 * {@link blendWeight}), the outgoing one under the incoming. Each is opaque for its own half and
 * fades over the other, so where both have paint the character is never seen through
 * (`to + (1 - to) * from` is 1 throughout); only what one has and the other has not fades.
 */
export function fadeAlphas(weight: number): { from: number; to: number } {
	const w = Math.min(Math.max(weight, 0), 1);
	return { from: Math.min(2 * (1 - w), 1), to: Math.min(2 * w, 1) };
}

/**
 * Where a cycle `into` long starts so that it carries on from a cycle `length` long that is at
 * `time`: at the same share of its length (its PHASE), so a walk does not start again from its
 * first step when its facing changes. Times and lengths are in one unit (seconds, or frames);
 * a cycle of no length has no phase, and the next starts at 0.
 */
export function phaseKept(time: number, length: number, into: number): number {
	if (!(length > 0) || !(into > 0)) return 0;
	const phase = (((time % length) + length) % length) / length;
	return phase * into;
}

/** {@link phaseKept} for a clip of whole frames: the frame of `into` at the phase of `frame` of
 *  `count` (the same frame, for two clips as long). */
export const frameKept = (frame: number, count: number, into: number): number =>
	Math.min(Math.floor(phaseKept(frame, count, into) + 1e-9), Math.max(into - 1, 0));
