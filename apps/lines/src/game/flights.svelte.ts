import {
	curveLength,
	flightDuration,
	flightEase,
	flightStagger,
	FLIGHT_TRAIL_LIFETIME_S,
	planFlight,
	pointOnCurve,
	SYMBOL_SIZE,
	type FlightCurve,
	type FlightPoint,
	type FlightRect,
} from 'engine-game';
import { emitterSecondsToWallMs } from 'engine-fx';
import { resolveAnchor, resolveAnchorPoint } from 'pixi-svelte';
import { roundSkip } from 'utils-shared/skipToken';

import { eventEmitter } from './eventEmitter';
import { getSymbolSeat, stateGameDerived } from './stateGame.svelte';
import { inUnskippablePresentation } from './unskippablePresentation';

/**
 * FLIGHTS (design §4.4 of `docs/design/hold-and-win.md`) — a head that travels from a board cell to a
 * target, leaves a trail, and fires `flightArrive` on impact. {@link flyTo} resolves when the HEAD
 * lands, so a beat can await a volley and the pot bump / number increment lands with it; the trail
 * then dies out on its own and the flight unmounts when its last particle has.
 *
 * Drawn by `FlightLayer.svelte`: ONE stage-level container at the fixed `LAYER_BAND_FLIGHTS` seat,
 * empty until a flight runs. Every route is planned in that layer's local space — the ends are
 * resolved globally (a cell through the board's seats, a layout node through its anchor) and
 * converted once — so a flight follows a camera move of the whole stage and its size does not
 * depend on where it was mounted.
 *
 * SLAM: a slam runs the flight clock {@link SLAM_SPEEDUP}× faster (stagger included); it never
 * skips an arrival or its cue. An unskippable presentation keeps the normal pace.
 */

/** Where a flight starts or ends: a global point, a board cell, or a layout node id / `'total'`. */
export type FlightEnd = FlightPoint | { reel: number; row: number } | string;

export type FlyToOptions = {
	/** Cells or global rects the route bends around. */
	avoid?: ({ reel: number; row: number } | FlightRect)[];
	/** Its place in a volley — staggers the start and is reported in `flightArrive`. */
	index?: number;
	/** Ms between two flights of a volley (default {@link FLIGHT_STAGGER_MS}). */
	stagger?: number;
	/** Grows every obstacle by this many BOARD units (default a tenth of a cell). */
	padding?: number;
};

/** The win meter — `'total'` in a flight's target. */
export const FLIGHT_TARGET_TOTAL = 'total';
/** The `hud-win` node is the reference layout's win meter; `LabelWin`/`HudReadout` anchor it too. */
const TOTAL_ANCHOR = 'hud-win';
/** The board's own space, anchored inside the flight layer (`FlightLayer.svelte`). */
export const FLIGHT_BOARD_ANCHOR = 'flights:board';

/** Board units per ms. A five-reel board is ~600 units across. */
const FLIGHT_SPEED = 1.1;
const FLIGHT_MIN_MS = 350;
const FLIGHT_MAX_MS = 900;
export const FLIGHT_STAGGER_MS = 70;
const SLAM_SPEEDUP = 4;
/** The last trail particle's life, wall ms, plus a frame of slack. */
const TRAIL_SETTLE_MS = emitterSecondsToWallMs(FLIGHT_TRAIL_LIFETIME_S) + 50;

export type FlightPhase = 'waiting' | 'flying' | 'trailing';

export type ActiveFlight = {
	id: number;
	flight: string;
	target: string;
	index: number;
	curve: FlightCurve;
	/** Layer-local units per board unit, so heads and trails are cell-sized. */
	scale: number;
	delayMs: number;
	durationMs: number;
	elapsedMs: number;
	settleAtMs: number;
	phase: FlightPhase;
	head: FlightPoint;
};

export const stateFlights = $state({ list: [] as ActiveFlight[] });

type Layer = { toLocal: (point: FlightPoint) => FlightPoint };
let layer: Layer | null = null;
let nextId = 1;
/** Each flight's resolver, until it lands. Bookkeeping, not state — nothing draws from it. */
const arrivals: Record<number, () => void> = {};

/** `FlightLayer` attaches its container while mounted. Without one a flight lands at once. */
export const attachFlightLayer = (container: Layer): (() => void) => {
	layer = container;
	return () => {
		if (layer === container) layer = null;
		stateFlights.list.forEach(arrive);
		stateFlights.list = [];
	};
};

const isCell = (end: unknown): end is { reel: number; row: number } =>
	typeof end === 'object' && end !== null && 'reel' in end && 'row' in end;

const boardContainer = () => resolveAnchor(FLIGHT_BOARD_ANCHOR);

/** A cell's centre, global. */
const cellGlobal = (reel: number, row: number): FlightPoint | undefined => {
	const board = boardContainer();
	if (!board) return undefined;
	const seat = getSymbolSeat(reel, row);
	return board.toGlobal({ x: seat.x, y: seat.y });
};

/** A cell's rect, global (axis-aligned around its centre). */
const cellRectGlobal = (reel: number, row: number): FlightRect | undefined => {
	const board = boardContainer();
	if (!board) return undefined;
	const seat = getSymbolSeat(reel, row);
	const geometry = stateGameDerived.boardGeometry();
	const w = (geometry.cellWidthLocal * seat.scale) / 2;
	const h = (geometry.cellHeightLocal * seat.scale) / 2;
	const a = board.toGlobal({ x: seat.x - w, y: seat.y - h });
	const b = board.toGlobal({ x: seat.x + w, y: seat.y + h });
	return {
		x: Math.min(a.x, b.x),
		y: Math.min(a.y, b.y),
		width: Math.abs(b.x - a.x),
		height: Math.abs(b.y - a.y),
	};
};

/** The board's bottom centre, global — where a target with no anchor on screen falls back to. */
const boardBottomGlobal = (): FlightPoint | undefined => {
	const board = boardContainer();
	if (!board) return undefined;
	const { width, height } = stateGameDerived.boardLayout();
	return board.toGlobal({ x: width / 2, y: height });
};

const resolveEnd = (end: FlightEnd): FlightPoint | undefined => {
	if (typeof end === 'string') {
		const name = end === FLIGHT_TARGET_TOTAL ? TOTAL_ANCHOR : end;
		return resolveAnchorPoint(name) ?? boardBottomGlobal();
	}
	if (isCell(end)) return cellGlobal(end.reel, end.row);
	return end;
};

const targetName = (end: FlightEnd): string => {
	if (typeof end === 'string') return end;
	if (isCell(end)) return `cell:${end.reel},${end.row}`;
	return `point:${Math.round(end.x)},${Math.round(end.y)}`;
};

/** Layer-local units per board unit. */
const boardScaleIn = (target: Layer): number => {
	const board = boardContainer();
	if (!board) return 1;
	const a = target.toLocal(board.toGlobal({ x: 0, y: 0 }));
	const b = target.toLocal(board.toGlobal({ x: SYMBOL_SIZE, y: 0 }));
	return Math.hypot(b.x - a.x, b.y - a.y) / SYMBOL_SIZE || 1;
};

const toLocalRect = (target: Layer, rect: FlightRect): FlightRect => {
	const a = target.toLocal({ x: rect.x, y: rect.y });
	const b = target.toLocal({ x: rect.x + rect.width, y: rect.y + rect.height });
	return {
		x: Math.min(a.x, b.x),
		y: Math.min(a.y, b.y),
		width: Math.abs(b.x - a.x),
		height: Math.abs(b.y - a.y),
	};
};

function arrive(flight: Pick<ActiveFlight, 'id' | 'flight' | 'target' | 'index'>) {
	const resolve = arrivals[flight.id];
	if (!resolve) return;
	delete arrivals[flight.id];
	eventEmitter.broadcast({
		type: 'flightArrive',
		flight: flight.flight,
		target: flight.target,
		index: flight.index,
	});
	resolve();
}

/**
 * Fly `flight` (its kind: `toTotal`, `toMeter:<id>`, `toCollector`…) from `from` to `to`. Resolves
 * when the head lands, after `flightArrive {flight, target, index}` has been broadcast. An end that
 * cannot be resolved (no board, no layer) lands at once — the cue still fires, so nothing waiting on
 * it hangs.
 */
export const flyTo = (
	from: FlightEnd,
	to: FlightEnd,
	flight: string,
	options: FlyToOptions = {},
): Promise<void> => {
	const index = options.index ?? 0;
	const target = targetName(to);
	return new Promise<void>((resolve) => {
		const id = nextId++;
		const record = { id, flight, target, index };
		arrivals[id] = resolve;
		const current = layer;
		const start = resolveEnd(from);
		const end = resolveEnd(to);
		if (!current || !start || !end) {
			arrive(record);
			return;
		}
		const scale = boardScaleIn(current);
		const avoid = (options.avoid ?? [])
			.map((item) => (isCell(item) ? cellRectGlobal(item.reel, item.row) : item))
			.filter((rect): rect is FlightRect => !!rect)
			.map((rect) => toLocalRect(current, rect));
		const route = planFlight(current.toLocal(start), current.toLocal(end), {
			avoid,
			padding: (options.padding ?? SYMBOL_SIZE * 0.1) * scale,
			overMargin: SYMBOL_SIZE * 0.35 * scale,
		});
		const durationMs = flightDuration(curveLength(route.curve) / scale, {
			speed: FLIGHT_SPEED,
			minMs: FLIGHT_MIN_MS,
			maxMs: FLIGHT_MAX_MS,
		});
		stateFlights.list.push({
			...record,
			curve: route.curve,
			scale,
			delayMs: flightStagger(index, options.stagger ?? FLIGHT_STAGGER_MS),
			durationMs,
			elapsedMs: 0,
			settleAtMs: 0,
			phase: 'waiting',
			head: { ...route.curve.p0 },
		});
	});
};

const slammed = () => roundSkip.isSkipped() && !inUnskippablePresentation();

/** Advance every flight by one frame. Driven by `FlightLayer`'s ticker. */
export const tickFlights = (deltaMs: number) => {
	if (stateFlights.list.length === 0) return;
	const step = deltaMs * (slammed() ? SLAM_SPEEDUP : 1);
	let finished = false;
	for (const flight of stateFlights.list) {
		flight.elapsedMs += step;
		if (flight.phase === 'trailing') {
			if (flight.elapsedMs >= flight.settleAtMs) finished = true;
			continue;
		}
		if (flight.elapsedMs < flight.delayMs) continue;
		const t = Math.min(1, (flight.elapsedMs - flight.delayMs) / flight.durationMs);
		const point = pointOnCurve(flight.curve, flightEase(t));
		flight.head.x = point.x;
		flight.head.y = point.y;
		if (flight.phase === 'waiting') flight.phase = 'flying';
		if (t >= 1) {
			flight.phase = 'trailing';
			// The trail lives out in WALL time whatever the slam: the emitter runs on the real clock.
			flight.settleAtMs = flight.elapsedMs + TRAIL_SETTLE_MS * (slammed() ? SLAM_SPEEDUP : 1);
			arrive(flight);
		}
	}
	if (finished) {
		stateFlights.list = stateFlights.list.filter(
			(flight) => flight.phase !== 'trailing' || flight.elapsedMs < flight.settleAtMs,
		);
	}
};
