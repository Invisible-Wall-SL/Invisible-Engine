/**
 * THE ROUTE A FLIGHT TAKES (design §4.4 of `docs/design/hold-and-win.md`) — pure, so a replay or a
 * resume of the same board draws the same route, and so the rules are pinned by
 * `packages/engine-game/fixtures/flightPath.fixture.ts` rather than only observed on screen. It lives
 * in `engine-layout` so the `/symbols` flight preview plans with the same code the game flies with.
 *
 * A route is one cubic Bézier from the source to the target. The candidates, in order: the straight
 * line, then a bend to the left and to the right of the direction of travel at each strength, then
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

export type FlightCandidateKind = 'straight' | 'bendLeft' | 'bendRight' | 'over';

export type FlightRoute = {
	curve: FlightCurve;
	kind: FlightCandidateKind;
	/** The bend strength (a fraction of the straight distance); 0 for straight and over. */
	strength: number;
	/** Samples that fell inside a padded obstacle — 0 for a clean route. */
	hits: number;
	length: number;
};

export type PlanFlightOptions = {
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

	const candidates: Omit<FlightRoute, 'hits' | 'length'>[] = [
		{ curve: straightCurve(from, to), kind: 'straight', strength: 0 },
	];
	for (const strength of options.bendStrengths ?? FLIGHT_BEND_STRENGTHS) {
		candidates.push({ curve: bentCurve(from, to, strength, 1), kind: 'bendLeft', strength });
		candidates.push({ curve: bentCurve(from, to, strength, -1), kind: 'bendRight', strength });
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
	style: Pick<ResolvedFlightStyle, 'bend' | 'overRoute' | 'avoid' | 'padding'>,
	cell: number,
	avoid: readonly FlightRect[],
): PlanFlightOptions => ({
	avoid: style.avoid ? avoid : [],
	padding: style.padding * cell,
	overMargin: FLIGHT_OVER_MARGIN_CELLS * cell,
	bendStrengths: flightBendStrengths(style.bend),
	overRoute: style.overRoute,
});
