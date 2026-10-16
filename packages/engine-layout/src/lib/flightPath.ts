/**
 * THE ROUTE A FLIGHT TAKES (design §4.4 of `docs/design/hold-and-win.md`) — pure, so a replay or a
 * resume of the same board draws the same route, and so the rules are pinned by
 * `packages/engine-game/fixtures/flightPath.fixture.ts` rather than only observed on screen. It lives
 * in `engine-layout` so the `/symbols` flight preview plans with the same code the game flies with.
 *
 * A route is one cubic Bézier from the source to the target. The candidates, in order: the
 * PREFERRED route — the straight line, or the authored `arc` (a bow even with nothing in the way) —
 * then a bend to the left and to the right of the direction of travel at each strength, then
 * an over-route that rises above every obstacle and comes down onto the target — so the order is
 * the order of growing detour. Each is sampled; the FIRST whose samples miss every padded obstacle
 * wins. When none is clean the one with the fewest hit samples wins, then the shorter, then the
 * earlier.
 *
 * An obstacle that contains the source or the target is ignored: a coin flying out of a winning cell
 * would otherwise start inside its own obstacle, and every route would hit.
 *
 * Coordinates are any one 2D space (y down), as long as the source, the target and the obstacles
 * share it.
 */

import type { FlightEase, ResolvedFlightStyle } from './flightStyle';

export type FlightPoint = { x: number; y: number };
export type FlightRect = { x: number; y: number; width: number; height: number };

/** A cubic Bézier: start, two controls, end. */
export type FlightCurve = { p0: FlightPoint; c1: FlightPoint; c2: FlightPoint; p3: FlightPoint };

export type FlightCandidateKind = 'straight' | 'arc' | 'bendLeft' | 'bendRight' | 'over';

export type FlightRoute = {
	curve: FlightCurve;
	kind: FlightCandidateKind;
	/** The bend or arc strength (a fraction of the straight distance); 0 for straight and over. */
	strength: number;
	/** Samples that fell inside a padded obstacle — 0 for a clean route. */
	hits: number;
	length: number;
};

export type PlanFlightOptions = {
	/**
	 * The preferred route's curvature, a fraction of the straight distance: positive bows it UP on
	 * screen, negative down. Absent or 0 ⇒ the straight line. Avoidance still detours around an
	 * obstacle the arc would cross.
	 */
	arc?: number;
	avoid?: readonly FlightRect[];
	/** Grows every obstacle by this much on each side. */
	padding?: number;
	/** Perpendicular bend, as a fraction of the straight distance, tried in this order. */
	bendStrengths?: readonly number[];
	/** Try the over-route last (default true). */
	overRoute?: boolean;
	/** How far above the highest obstacle the over-route's apex rides. */
	overMargin?: number;
	/** Samples per candidate (the endpoints are not sampled). */
	samples?: number;
};

export const FLIGHT_BEND_STRENGTHS: readonly number[] = [0.2, 0.35, 0.55];
const DEFAULT_SAMPLES = 48;
const DEFAULT_OVER_MARGIN = 40;

export const pointOnCurve = ({ p0, c1, c2, p3 }: FlightCurve, t: number): FlightPoint => {
	const u = 1 - t;
	const a = u * u * u;
	const b = 3 * u * u * t;
	const c = 3 * u * t * t;
	const d = t * t * t;
	return {
		x: a * p0.x + b * c1.x + c * c2.x + d * p3.x,
		y: a * p0.y + b * c1.y + c * c2.y + d * p3.y,
	};
};

/** The direction of travel at `t`, in radians (0 = right, y down): the curve's tangent, or the
 *  straight line from start to end where the tangent vanishes (a control point on an end). */
export const headingOnCurve = ({ p0, c1, c2, p3 }: FlightCurve, t: number): number => {
	const u = 1 - t;
	const x = 3 * u * u * (c1.x - p0.x) + 6 * u * t * (c2.x - c1.x) + 3 * t * t * (p3.x - c2.x);
	const y = 3 * u * u * (c1.y - p0.y) + 6 * u * t * (c2.y - c1.y) + 3 * t * t * (p3.y - c2.y);
	return Math.hypot(x, y) > 1e-6 ? Math.atan2(y, x) : Math.atan2(p3.y - p0.y, p3.x - p0.x);
};

/** Arc length by chords — `steps` segments are plenty for a curve this gentle. */
export const curveLength = (curve: FlightCurve, steps = 32): number => {
	let length = 0;
	let previous = curve.p0;
	for (let i = 1; i <= steps; i++) {
		const next = pointOnCurve(curve, i / steps);
		length += Math.hypot(next.x - previous.x, next.y - previous.y);
		previous = next;
	}
	return length;
};

const lerp = (a: FlightPoint, b: FlightPoint, t: number): FlightPoint => ({
	x: a.x + (b.x - a.x) * t,
	y: a.y + (b.y - a.y) * t,
});

const straightCurve = (from: FlightPoint, to: FlightPoint): FlightCurve => ({
	p0: from,
	c1: lerp(from, to, 1 / 3),
	c2: lerp(from, to, 2 / 3),
	p3: to,
});

/** `side` +1 bends to the travel direction's left (screen space, y down), -1 to its right. */
const bentCurve = (
	from: FlightPoint,
	to: FlightPoint,
	strength: number,
	side: 1 | -1,
): FlightCurve => {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	// The perpendicular scaled by the distance: (dy, -dx) points left of travel when y grows down.
	const ox = dy * strength * side;
	const oy = -dx * strength * side;
	const a = lerp(from, to, 1 / 3);
	const b = lerp(from, to, 2 / 3);
	return {
		p0: from,
		c1: { x: a.x + ox, y: a.y + oy },
		c2: { x: b.x + ox, y: b.y + oy },
		p3: to,
	};
};

/**
 * The side of the direction of travel (`bentCurve`'s `side`) that is UP on screen (y down) for a
 * positive `arc`, down for a negative one. A vertical flight has no up side: a positive arc bows it
 * to its left.
 */
const arcSide = (from: FlightPoint, to: FlightPoint, arc: number): 1 | -1 => {
	// `bentCurve`'s left offset is (dy, -dx): its y is -dx, so left is up when the flight heads right.
	const leftIsUp = to.x - from.x >= 0;
	return leftIsUp === arc > 0 ? 1 : -1;
};

/**
 * Rises straight up from the source, crosses above `apexY` and comes down onto the target. Both
 * controls share one height, chosen so the curve's midpoint (`y(½) = ⅛y0 + ¾c + ⅛y3`) sits on the
 * apex.
 */
const overCurve = (from: FlightPoint, to: FlightPoint, apexY: number): FlightCurve => {
	const controlY = (apexY - 0.125 * (from.y + to.y)) / 0.75;
	return {
		p0: from,
		c1: { x: from.x, y: controlY },
		c2: { x: to.x, y: controlY },
		p3: to,
	};
};

const padRect = (rect: FlightRect, padding: number): FlightRect => ({
	x: rect.x - padding,
	y: rect.y - padding,
	width: rect.width + padding * 2,
	height: rect.height + padding * 2,
});

const inside = (rect: FlightRect, point: FlightPoint): boolean =>
	point.x >= rect.x &&
	point.x <= rect.x + rect.width &&
	point.y >= rect.y &&
	point.y <= rect.y + rect.height;

const countHits = (curve: FlightCurve, obstacles: FlightRect[], samples: number): number => {
	if (obstacles.length === 0) return 0;
	let hits = 0;
	for (let i = 1; i <= samples; i++) {
		const point = pointOnCurve(curve, i / (samples + 1));
		if (obstacles.some((rect) => inside(rect, point))) hits += 1;
	}
	return hits;
};

export const planFlight = (
	from: FlightPoint,
	to: FlightPoint,
	options: PlanFlightOptions = {},
): FlightRoute => {
	const padding = options.padding ?? 0;
	const samples = Math.max(1, Math.floor(options.samples ?? DEFAULT_SAMPLES));
	const obstacles = (options.avoid ?? [])
		.map((rect) => padRect(rect, padding))
		.filter((rect) => !inside(rect, from) && !inside(rect, to));

	const arc = options.arc ?? 0;
	// An arced route that must detour tries the arc's own side first, so it keeps bowing the way the
	// author asked when it can.
	const sides: (1 | -1)[] = arc !== 0 && arcSide(from, to, arc) === -1 ? [-1, 1] : [1, -1];
	const candidates: Omit<FlightRoute, 'hits' | 'length'>[] = [
		arc === 0
			? { curve: straightCurve(from, to), kind: 'straight', strength: 0 }
			: {
					curve: bentCurve(from, to, Math.abs(arc), arcSide(from, to, arc)),
					kind: 'arc',
					strength: Math.abs(arc),
				},
	];
	for (const strength of options.bendStrengths ?? FLIGHT_BEND_STRENGTHS) {
		for (const side of sides) {
			const kind = side === 1 ? 'bendLeft' : 'bendRight';
			candidates.push({ curve: bentCurve(from, to, strength, side), kind, strength });
		}
	}
	if ((options.overRoute ?? true) && obstacles.length > 0) {
		const top = Math.min(...obstacles.map((rect) => rect.y));
		const apexY = Math.min(top, from.y, to.y) - (options.overMargin ?? DEFAULT_OVER_MARGIN);
		candidates.push({ curve: overCurve(from, to, apexY), kind: 'over', strength: 0 });
	}

	let best: FlightRoute | undefined;
	for (const candidate of candidates) {
		const route: FlightRoute = {
			...candidate,
			hits: countHits(candidate.curve, obstacles, samples),
			length: curveLength(candidate.curve),
		};
		if (route.hits === 0) return route;
		if (
			!best ||
			route.hits < best.hits ||
			(route.hits === best.hits && route.length < best.length)
		) {
			best = route;
		}
	}
	return best!;
};

export type FlightDurationOptions = {
	/** Distance units per millisecond. */
	speed: number;
	minMs: number;
	maxMs: number;
};

/** How long a flight of this length takes: distance over speed, clamped to `[minMs, maxMs]`. */
export const flightDuration = (
	distance: number,
	{ speed, minMs, maxMs }: FlightDurationOptions,
): number => {
	const raw = speed > 0 ? Math.abs(distance) / speed : maxMs;
	return Math.min(maxMs, Math.max(minMs, raw));
};

/** When flight `index` of a volley leaves, ms after the first. */
export const flightStagger = (index: number, staggerMs: number): number =>
	Math.max(0, index) * Math.max(0, staggerMs);

/** The flight's progress ease: a soft start and a committed arrival. */
export const flightEase = (t: number): number => {
	const c = Math.min(1, Math.max(0, t));
	return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
};

const unit = (t: number): number => Math.min(1, Math.max(0, t));

const EASES: Record<FlightEase, (t: number) => number> = {
	linear: unit,
	easeIn: (t) => unit(t) ** 3,
	easeOut: (t) => 1 - (1 - unit(t)) ** 3,
	easeInOut: flightEase,
};

/** The progress curve an authored `ease` names (all cubic); the coded one is {@link flightEase}. */
export const flightEaseOf = (ease: FlightEase): ((t: number) => number) =>
	EASES[ease] ?? flightEase;

/**
 * How far toward the camera a depth of 1 lifts the head at mid-flight, as a share of the camera's
 * distance: half the way, so it is drawn twice its size there (and ⅔ of it for a depth of −1).
 */
const DEPTH_RISE = 0.5;

/** How the head is drawn at one moment of its flight ({@link flightHeadPose}). */
export type FlightHeadPose = {
	/** × the head's size: the perspective, 1 when the flight is flat. */
	scale: number;
	/** The head's turn, radians: the heading when it follows the curve, else 0. */
	rotation: number;
	/** × the head's length along its travel (it leans into the screen), 1 unless it follows. */
	stretch: number;
	/** −1 while an upright head heads left (it is mirrored, not turned upside down), else 1. */
	flip: 1 | -1;
	/** The authored turn of the art itself, radians, applied before everything above. */
	artRotation: number;
};

/**
 * THE HEAD'S POSE at eased progress `t` with direction of travel `heading` — the one rule the game
 * and the `/symbols` preview both draw with. Applied as: turn the art by `artRotation`, scale it by
 * `scale × stretch` along x (its travel) and `scale × flip` along y, then turn it by `rotation`.
 *
 * Perspective (`depth`): the head flies the planned route on screen while it rises out of the
 * screen and back, `depth × DEPTH_RISE × sin(πt)` of the camera's distance at `t`, so it is drawn
 * `1 / (1 − that)` times its size — its own size as it leaves and as it lands. The camera is taken to
 * stand as far from the board as the route is long, which makes the rise's slope against the route
 * `depth × DEPTH_RISE × π × cos(πt)` whatever the route's length; a head that follows the curve is
 * foreshortened by it (`cos` of that angle), shortest at both ends and full length at the top.
 */
export const flightHeadPose = (
	style: Pick<ResolvedFlightStyle, 'headAlign' | 'headRotation' | 'depth'>,
	heading: number,
	t: number,
): FlightHeadPose => {
	const rise = style.depth * DEPTH_RISE;
	const angle = Math.PI * unit(t);
	const follows = style.headAlign === 'follow' || style.headAlign === 'upright';
	return {
		scale: 1 / (1 - rise * Math.sin(angle)),
		rotation: follows ? heading : 0,
		stretch: follows ? 1 / Math.hypot(1, rise * Math.PI * Math.cos(angle)) : 1,
		flip: style.headAlign === 'upright' && Math.cos(heading) < 0 ? -1 : 1,
		artRotation: (style.headRotation * Math.PI) / 180,
	};
};

/** How far above the highest obstacle the over-route rides, in cells. */
export const FLIGHT_OVER_MARGIN_CELLS = 0.35;

/**
 * The bend ladder for an authored `bend` (the largest bend tried): the coded ladder scaled so its
 * top rung equals it. Absent ⇒ the coded ladder itself; 0 ⇒ no bends at all.
 */
export const flightBendStrengths = (bend: number | undefined): readonly number[] => {
	if (bend === undefined) return FLIGHT_BEND_STRENGTHS;
	if (bend <= 0) return [];
	const top = FLIGHT_BEND_STRENGTHS[FLIGHT_BEND_STRENGTHS.length - 1];
	return FLIGHT_BEND_STRENGTHS.map((strength) => (strength / top) * bend);
};

/**
 * {@link planFlight}'s options for a resolved style — the ONE mapping the game and the `/symbols`
 * preview both call, so they draw the same route by construction. `cell` is one board cell in the
 * route's units; `avoid` is the caller's obstacle set, dropped when the style turns avoidance off.
 */
export const flightPlanOptions = (
	style: Pick<ResolvedFlightStyle, 'arc' | 'bend' | 'overRoute' | 'avoid' | 'padding'>,
	cell: number,
	avoid: readonly FlightRect[],
): PlanFlightOptions => ({
	arc: style.arc,
	avoid: style.avoid ? avoid : [],
	padding: style.padding * cell,
	overMargin: FLIGHT_OVER_MARGIN_CELLS * cell,
	bendStrengths: flightBendStrengths(style.bend),
	overRoute: style.overRoute,
});
