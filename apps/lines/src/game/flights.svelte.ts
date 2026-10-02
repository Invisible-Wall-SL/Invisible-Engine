import {
	curveLength,
	flightDuration,
	flightStagger,
	FLIGHT_TRAIL_LIFETIME_S,
	planFlight,
	pointOnCurve,
	SYMBOL_SIZE,
	type FlightCurve,
	type FlightPoint,
	type FlightRect,
} from 'engine-game';
import { emitterSecondsToWallMs, type EffectDoc } from 'engine-fx';
import {
	FLIGHT_METER_PREFIX,
	flightEaseOf,
	flightPlanOptions,
	resolveFlightStyle,
	type FlightEase,
	type FlightHead,
	type ResolvedFlightStyle,
} from 'engine-layout';
import { resolveAnchor, resolveAnchorPoint } from 'pixi-svelte';
import { scopeOf } from 'utils-event-emitter';
import { roundSkip } from 'utils-shared/skipToken';

import { bakedEffects, bakedFlights } from '../editor-scenes';
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
 *
 * STYLE: each flight resolves its kind's authored style (the Invisible Symbols `flights` block,
 * `bakedFlights()`) through `engine-layout`'s `resolveFlightStyle` — exact kind, then the `toMeter`
 * family for a `toMeter:<id>`, then the coded default, field by field. An absent block resolves to
 * the coded flight (1.1 board units/ms, 350–900 ms, 70 ms stagger, cubic ease in-out, the coded glow
 * and gold trail), so an unauthored game flies exactly as it did.
 */

/** Where a flight starts or ends: a global point, a board cell, or a layout node id / `'total'`. */
export type FlightEnd = FlightPoint | { reel: number; row: number } | string;

export type FlyToOptions = {
	/** Cells or global rects the route bends around. */
	avoid?: ({ reel: number; row: number } | FlightRect)[];
	/** Its place in a volley — staggers the start and is reported in `flightArrive`. */
	index?: number;
	/** Ms between two flights of a volley (default: the kind's authored stagger, coded 70). */
	stagger?: number;
	/** Grows every obstacle by this many BOARD units (default: the kind's authored padding, coded a
	 *  tenth of a cell). */
	padding?: number;
	/** Text carried on the head (an add-respins special's "+2"). Absent ⇒ the head alone. */
	label?: string;
	/** A symbol that IS the head, in place of the kind's authored or coded one (a pots overlay's
	 *  token flying into its pot), drawn in its `flyToMeter` state. The trail stays the kind's. */
	symbol?: FlightSymbol;
	/** Called once, as the head leaves its start (after its stagger), or at once when it cannot fly —
	 *  so the thing it carries leaves its cell then, not when the volley is set up. */
	onStart?: () => void;
};

/** The symbol a flight carries as its head ({@link FlyToOptions.symbol}). */
export type FlightSymbol = { name: string; value?: number; jackpot?: string };

/** The win meter — `'total'` in a flight's target. */
export const FLIGHT_TARGET_TOTAL = 'total';
/** The `hud-win` node is the reference layout's win meter; `LabelWin`/`HudReadout` anchor it too. */
const TOTAL_ANCHOR = 'hud-win';
/** The board's own space, anchored inside the flight layer (`FlightLayer.svelte`). */
export const FLIGHT_BOARD_ANCHOR = 'flights:board';

const SLAM_SPEEDUP = 4;
/** A frame of slack after the last trail particle's life. */
const TRAIL_SLACK_MS = 50;
/** The coded trail's last particle, wall ms. */
const CODED_TRAIL_SETTLE_MS = emitterSecondsToWallMs(FLIGHT_TRAIL_LIFETIME_S) + TRAIL_SLACK_MS;

export type FlightPhase = 'waiting' | 'flying' | 'trailing';

export type ActiveFlight = {
	id: number;
	flight: string;
	target: string;
	index: number;
	/** `meter:<id>` for a `toMeter:<id>` flight — its `flightArrive`'s scope (Phase 12a). */
	scope?: string;
	curve: FlightCurve;
	/** Layer-local units per board unit, so heads and trails are cell-sized. */
	scale: number;
	delayMs: number;
	durationMs: number;
	elapsedMs: number;
	/** WALL time since the head landed — the trail's particles live on the real clock. */
	trailMs: number;
	phase: FlightPhase;
	head: FlightPoint;
	ease: FlightEase;
	/** The authored head; absent ⇒ the coded glow. */
	headStyle?: FlightHead;
	/** Text riding on the head ({@link FlyToOptions.label}). */
	label?: string;
	/** The symbol that is the head ({@link FlyToOptions.symbol}). */
	symbol?: FlightSymbol;
	/** The trail: `'coded'` (the gold glow), the id of an authored effect the bundle carries, or
	 *  `null` (none). An id, not the doc: this list is deep `$state`, and an emitter config must not
	 *  be proxied. */
	trail: 'coded' | { effectId: string } | null;
	/** The effect played at the target on impact, if one is authored. */
	arrivalEffectId?: string;
	/** WALL ms the flight stays mounted after landing — its trail's last particle. */
	settleMs: number;
	/** The arrival effect has played out (true when there is none). */
	arrivalDone: boolean;
};

export const stateFlights = $state({ list: [] as ActiveFlight[] });

type Layer = { toLocal: (point: FlightPoint) => FlightPoint };
let layer: Layer | null = null;
let nextId = 1;
/** Each flight's resolver, until it lands. Bookkeeping, not state — nothing draws from it. */
const arrivals: Record<number, () => void> = {};
/** Each flight's {@link FlyToOptions.onStart}, until its head leaves. Bookkeeping, like `arrivals`. */
const starts: Record<number, () => void> = {};

const start = (id: number) => {
	const onStart = starts[id];
	if (!onStart) return;
	delete starts[id];
	onStart();
};

/** `FlightLayer` attaches its container while mounted. Without one a flight lands at once. */
export const attachFlightLayer = (container: Layer): (() => void) => {
	layer = container;
	return () => {
		if (layer === container) layer = null;
		stateFlights.list.forEach((flight) => {
			start(flight.id);
			arrive(flight);
		});
		stateFlights.list = [];
	};
};

/** The longest particle an effect spawns, wall ms — what its trail waits out after landing. */
const effectSettleMs = (doc: EffectDoc): number =>
	Math.max(0, ...doc.layers.map((item) => emitterSecondsToWallMs(item.config.lifetime?.max ?? 0))) +
	TRAIL_SLACK_MS;

/** The trail and how long it outlives the head. An authored effect the bundle does not carry draws
 *  nothing rather than the coded glow: the author asked for something else, and the
 *  reachable-effects set is what guarantees it ships. */
const trailOf = (style: ResolvedFlightStyle): Pick<ActiveFlight, 'trail' | 'settleMs'> => {
	if (!style.trail) return { trail: 'coded', settleMs: CODED_TRAIL_SETTLE_MS };
	const effectId = 'effectId' in style.trail ? style.trail.effectId : undefined;
	const doc = effectId ? bakedEffects().find((item) => item.id === effectId) : undefined;
	return doc
		? { trail: { effectId: doc.id }, settleMs: effectSettleMs(doc) }
		: { trail: null, settleMs: 0 };
};

/** Called by `FlightLayer` when a flight's arrival effect has played out. */
export const arrivalPlayed = (id: number) => {
	const flight = stateFlights.list.find((item) => item.id === id);
	if (flight) flight.arrivalDone = true;
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

function arrive(flight: Pick<ActiveFlight, 'id' | 'flight' | 'target' | 'index' | 'scope'>) {
	const resolve = arrivals[flight.id];
	if (!resolve) return;
	delete arrivals[flight.id];
	eventEmitter.broadcast({
		type: 'flightArrive',
		flight: flight.flight,
		target: flight.target,
		index: flight.index,
		...(flight.scope ? { scope: flight.scope } : {}),
	});
	resolve();
}

/** The meter a `toMeter:<id>` flight flies into; `undefined` for every other kind. */
const meterOfFlight = (flight: string): string | undefined =>
	flight.startsWith(FLIGHT_METER_PREFIX) ? flight.slice(FLIGHT_METER_PREFIX.length) : undefined;

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
		const record = { id, flight, target, index, scope: scopeOf('meter', meterOfFlight(flight)) };
		arrivals[id] = resolve;
		if (options.onStart) starts[id] = options.onStart;
		const current = layer;
		const origin = resolveEnd(from);
		const end = resolveEnd(to);
		if (!current || !origin || !end) {
			start(id);
			arrive(record);
			return;
		}
		const style = resolveFlightStyle(bakedFlights(), flight);
		const scale = boardScaleIn(current);
		const avoid = (options.avoid ?? [])
			.map((item) => (isCell(item) ? cellRectGlobal(item.reel, item.row) : item))
			.filter((rect): rect is FlightRect => !!rect)
			.map((rect) => toLocalRect(current, rect));
		const plan = flightPlanOptions(style, SYMBOL_SIZE * scale, avoid);
		if (options.padding !== undefined) plan.padding = options.padding * scale;
		const route = planFlight(current.toLocal(origin), current.toLocal(end), plan);
		const durationMs = flightDuration(curveLength(route.curve) / scale, style);
		stateFlights.list.push({
			...record,
			curve: route.curve,
			scale,
			delayMs: flightStagger(index, options.stagger ?? style.stagger),
			durationMs,
			elapsedMs: 0,
			trailMs: 0,
			phase: 'waiting',
			head: { ...route.curve.p0 },
			ease: style.ease,
			...(style.head ? { headStyle: style.head } : {}),
			...(options.label ? { label: options.label } : {}),
			...(options.symbol ? { symbol: { ...options.symbol } } : {}),
			...trailOf(style),
			...(style.arrival ? { arrivalEffectId: style.arrival.effectId } : {}),
			arrivalDone: !style.arrival,
		});
	});
};

/** Landed, its trail has died out and its arrival effect has played. */
const settled = (flight: ActiveFlight) => flight.trailMs >= flight.settleMs && flight.arrivalDone;

const slammed = () => roundSkip.isSkipped() && !inUnskippablePresentation();

/** Advance every flight by one frame. Driven by `FlightLayer`'s ticker. */
export const tickFlights = (deltaMs: number) => {
	if (stateFlights.list.length === 0) return;
	const step = deltaMs * (slammed() ? SLAM_SPEEDUP : 1);
	let finished = false;
	// A snapshot: an arrival cue may start another flight, which must not get a step this frame.
	for (const flight of [...stateFlights.list]) {
		if (flight.phase === 'trailing') {
			// Counted in raw frame time, so a slam that starts or ends after the landing neither cuts
			// the trail short nor keeps a spent emitter mounted.
			flight.trailMs += deltaMs;
			if (settled(flight)) finished = true;
			continue;
		}
		flight.elapsedMs += step;
		if (flight.elapsedMs < flight.delayMs) continue;
		const t = Math.min(1, (flight.elapsedMs - flight.delayMs) / flight.durationMs);
		const point = pointOnCurve(flight.curve, flightEaseOf(flight.ease)(t));
		flight.head.x = point.x;
		flight.head.y = point.y;
		if (flight.phase === 'waiting') {
			flight.phase = 'flying';
			start(flight.id);
		}
		if (t >= 1) {
			flight.phase = 'trailing';
			arrive(flight);
		}
	}
	if (finished) {
		stateFlights.list = stateFlights.list.filter(
			(flight) => flight.phase !== 'trailing' || !settled(flight),
		);
	}
};
