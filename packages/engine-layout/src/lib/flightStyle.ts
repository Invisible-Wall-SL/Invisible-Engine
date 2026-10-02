/**
 * THE AUTHORED LOOK AND FEEL OF A FLIGHT (design §4.4 of `docs/design/hold-and-win.md`) — the
 * `flights` block of the Invisible Symbols State Machine doc, keyed by flight kind, and the one rule
 * that turns it into the style a flight actually flies with.
 *
 * Shared by both halves on purpose: the `/symbols` tool normalizes and previews with it, the server
 * normalizes the saved doc with it, and the game resolves each `flyTo` with it — so a value the tool
 * shows is the value the game uses. The route math that consumes the resolved style lives next door
 * in `flightPath.ts`.
 *
 * Keys: `toTotal` · `toCollector` · `boostBeam` · `toCounter` · `upgradeBeam` · `unlockRow` ·
 * `toMeter` (every meter) · `toMeter:<id>` (one meter). Resolution is FIELD BY FIELD: the exact key, then (for
 * `toMeter:<id>`) the `toMeter` family, then the coded default ({@link FLIGHT_DEFAULTS}). An absent
 * block resolves to exactly the coded flight, so an unauthored game flies as it always did.
 *
 * No value import here: the engine-game fixtures run this file under `node --experimental-strip-types`.
 */

export const FLIGHT_KINDS = [
	'toTotal',
	'toCollector',
	'boostBeam',
	'toCounter',
	'upgradeBeam',
	'unlockRow',
	'toMeter',
] as const;
export type FlightKind = (typeof FLIGHT_KINDS)[number];

export const FLIGHT_KIND_LABELS: Record<FlightKind, string> = {
	toTotal: 'Into the total win',
	toCollector: 'Into a collector',
	boostBeam: 'Boost beam',
	toCounter: 'Into the respin counter',
	upgradeBeam: 'Upgrade beam',
	unlockRow: 'Unlock into its row',
	toMeter: 'Into a meter (every meter)',
};

/** The respin counter's flight anchor (`<Anchor name>`): the coded counter and the Scene Editor's
 *  `respinCounter` component both register it; an add-respins head flies into it (`toCounter`). */
export const RESPIN_COUNTER_ANCHOR = 'respinCounter';

/** An authored Total Win Bar's flight anchor (Phase 12c): registered only while the bar catches the
 *  coins (`catchesCoins`); the feature end's `toTotal` volley then lands on it instead of the HUD's
 *  win meter. */
export const TOTAL_WIN_BAR_ANCHOR = 'totalWinBar';

/** `toMeter:<id>` — one meter's flight, falling back to `toMeter` field by field. */
export const FLIGHT_METER_PREFIX = 'toMeter:';

export const meterFlightKey = (meterId: string): string => `${FLIGHT_METER_PREFIX}${meterId}`;

/** A key the `flights` block may carry: a kind, or `toMeter:` plus a non-blank meter id. */
export const isFlightKey = (key: string): boolean => {
	if ((FLIGHT_KINDS as readonly string[]).includes(key)) return true;
	if (!key.startsWith(FLIGHT_METER_PREFIX)) return false;
	const id = key.slice(FLIGHT_METER_PREFIX.length);
	return id.length > 0 && id.trim() === id;
};

export const FLIGHT_HEAD_KINDS = ['glow', 'sprite', 'spine', 'flipbook', 'none'] as const;
export type FlightHeadKind = (typeof FLIGHT_HEAD_KINDS)[number];

/**
 * What travels. `glow` is the coded radial glow (re-tinted / re-sized); `sprite` / `spine` /
 * `flipbook` carry the same fields a symbol layer does (`assetKey` a frame or bundle,
 * `animationName` the looping clip, `clipId` the Invisible Flipbook clip) and render through the
 * game's symbol-layer path; `none` flies only the trail. `scale` multiplies the head's size (a glow
 * is 0.45 of a cell, an art head one cell); `tint` is `#rrggbb`.
 */
export type FlightHead = {
	kind: FlightHeadKind;
	assetKey?: string;
	animationName?: string;
	clipId?: string;
	scale?: number;
	tint?: string;
};

/** The trail: an Invisible FX effect played as a MOVING emitter, or switched off. Absent ⇒ coded. */
export type FlightTrail = { effectId: string } | { off: true };

/** A one-shot Invisible FX effect at the target on impact. Absent ⇒ none. */
export type FlightArrival = { effectId: string };

/**
 * The route. `arc` curves the PREFERRED route, as a fraction of the straight distance: positive bows
 * it up on screen, negative down, absent/0 flies straight. `bend` is the largest DETOUR tried around
 * a win cell, as a fraction of the straight distance (the coded ladder is scaled so its top rung
 * equals it; 0 = no bends). `padding` grows every obstacle, in
 * cells. `avoid: false` flies straight through the win cells.
 */
export type FlightPathStyle = {
	arc?: number;
	bend?: number;
	overRoute?: boolean;
	avoid?: boolean;
	padding?: number;
};

export const FLIGHT_EASES = ['linear', 'easeIn', 'easeOut', 'easeInOut'] as const;
export type FlightEase = (typeof FLIGHT_EASES)[number];

export const FLIGHT_EASE_LABELS: Record<FlightEase, string> = {
	linear: 'Linear',
	easeIn: 'Ease in',
	easeOut: 'Ease out',
	easeInOut: 'Ease in-out',
};

/** One flight kind's authored style. Sparse: every absent field falls through. */
export type FlightStyle = {
	head?: FlightHead;
	trail?: FlightTrail;
	arrival?: FlightArrival;
	path?: FlightPathStyle;
	/** Board units per millisecond. */
	speed?: number;
	minMs?: number;
	maxMs?: number;
	ease?: FlightEase;
	/** Ms between two flights of a volley. */
	stagger?: number;
};

/** Keyed by flight kind (see {@link isFlightKey}); a kind with no entry flies the coded style. */
export type FlightsConfig = Record<string, FlightStyle>;

/** The coded flight — what every field resolves to when nothing authors it. */
export const FLIGHT_DEFAULTS = {
	speed: 1.1,
	minMs: 350,
	maxMs: 900,
	stagger: 70,
	ease: 'easeInOut' as FlightEase,
	/** Cells. */
	padding: 0.1,
	overRoute: true,
	avoid: true,
} as const;

/** The ranges a value is clamped into on save — out-of-range is a typo, not an intent. */
export const FLIGHT_LIMITS = {
	speed: { min: 0.05, max: 20 },
	/** A frame at least: a 0 ms flight would land before it is drawn (and divide 0 by 0). */
	ms: { min: 16, max: 10_000 },
	stagger: { min: 0, max: 2_000 },
	bend: { min: 0, max: 1 },
	arc: { min: -1, max: 1 },
	padding: { min: 0, max: 2 },
	headScale: { min: 0.05, max: 5 },
} as const;

/** What a flight flies with once the authored block and the coded default are merged. */
export type ResolvedFlightStyle = {
	head?: FlightHead;
	trail?: FlightTrail;
	arrival?: FlightArrival;
	/** Absent ⇒ the coded bend ladder. */
	bend?: number;
	/** Absent ⇒ straight. */
	arc?: number;
	overRoute: boolean;
	avoid: boolean;
	/** Cells. */
	padding: number;
	speed: number;
	minMs: number;
	maxMs: number;
	ease: FlightEase;
	stagger: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const finite = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value);

const clamp = (value: number, { min, max }: { min: number; max: number }): number =>
	Math.min(max, Math.max(min, value));

const nonBlank = (value: unknown): value is string =>
	typeof value === 'string' && value.trim().length > 0;

const HEX = /^#[0-9a-fA-F]{6}$/;

export function normalizeFlightHead(raw: unknown): FlightHead | undefined {
	if (!isRecord(raw)) return undefined;
	const kind = raw.kind;
	if (!(FLIGHT_HEAD_KINDS as readonly unknown[]).includes(kind)) return undefined;
	const head: FlightHead = { kind: kind as FlightHeadKind };
	if (head.kind === 'none') return head;
	if (head.kind === 'sprite' || head.kind === 'spine') {
		if (!nonBlank(raw.assetKey)) return undefined;
		head.assetKey = raw.assetKey;
	}
	if (head.kind === 'spine') {
		if (!nonBlank(raw.animationName)) return undefined;
		head.animationName = raw.animationName;
	}
	if (head.kind === 'flipbook') {
		if (!nonBlank(raw.clipId)) return undefined;
		head.clipId = raw.clipId;
		if (nonBlank(raw.assetKey)) head.assetKey = raw.assetKey;
	}
	if (finite(raw.scale) && raw.scale > 0) head.scale = clamp(raw.scale, FLIGHT_LIMITS.headScale);
	if (typeof raw.tint === 'string' && HEX.test(raw.tint)) head.tint = raw.tint.toLowerCase();
	return head;
}

function normalizePath(raw: unknown): FlightPathStyle | undefined {
	if (!isRecord(raw)) return undefined;
	const path: FlightPathStyle = {};
	if (finite(raw.bend)) path.bend = clamp(raw.bend, FLIGHT_LIMITS.bend);
	if (finite(raw.arc)) path.arc = clamp(raw.arc, FLIGHT_LIMITS.arc);
	if (typeof raw.overRoute === 'boolean') path.overRoute = raw.overRoute;
	if (typeof raw.avoid === 'boolean') path.avoid = raw.avoid;
	if (finite(raw.padding)) path.padding = clamp(raw.padding, FLIGHT_LIMITS.padding);
	return Object.keys(path).length ? path : undefined;
}

/** One kind's style, rebuilt field by field: junk and invalid values dropped, numbers clamped.
 *  Undefined when nothing survives, so a cleared style leaves no key. */
export function normalizeFlightStyle(raw: unknown): FlightStyle | undefined {
	if (!isRecord(raw)) return undefined;
	const style: FlightStyle = {};
	const head = normalizeFlightHead(raw.head);
	if (head) style.head = head;
	if (isRecord(raw.trail)) {
		if (raw.trail.off === true) style.trail = { off: true };
		else if (nonBlank(raw.trail.effectId)) style.trail = { effectId: raw.trail.effectId };
	}
	if (isRecord(raw.arrival) && nonBlank(raw.arrival.effectId)) {
		style.arrival = { effectId: raw.arrival.effectId };
	}
	const path = normalizePath(raw.path);
	if (path) style.path = path;
	if (finite(raw.speed) && raw.speed > 0) style.speed = clamp(raw.speed, FLIGHT_LIMITS.speed);
	if (finite(raw.minMs)) style.minMs = Math.round(clamp(raw.minMs, FLIGHT_LIMITS.ms));
	if (finite(raw.maxMs)) style.maxMs = Math.round(clamp(raw.maxMs, FLIGHT_LIMITS.ms));
	if ((FLIGHT_EASES as readonly unknown[]).includes(raw.ease)) style.ease = raw.ease as FlightEase;
	if (finite(raw.stagger)) style.stagger = Math.round(clamp(raw.stagger, FLIGHT_LIMITS.stagger));
	return Object.keys(style).length ? style : undefined;
}

/** Kinds first in {@link FLIGHT_KINDS} order, then meters by id — a stable doc and signature. */
const keyRank = (key: string): string => {
	const kind = (FLIGHT_KINDS as readonly string[]).indexOf(key);
	return kind >= 0 ? `0${kind}` : `1${key}`;
};

/** The whole block: unknown keys dropped, each style normalized, empty ⇒ undefined (no key). */
export function normalizeFlights(raw: unknown): FlightsConfig | undefined {
	if (!isRecord(raw)) return undefined;
	const out: FlightsConfig = {};
	const keys = Object.keys(raw)
		.filter(isFlightKey)
		.sort((a, b) => (keyRank(a) < keyRank(b) ? -1 : keyRank(a) > keyRank(b) ? 1 : 0));
	for (const key of keys) {
		const style = normalizeFlightStyle(raw[key]);
		if (style) out[key] = style;
	}
	return Object.keys(out).length ? out : undefined;
}

/**
 * The style flight `kind` flies with: the exact key, then the `toMeter` family for a
 * `toMeter:<id>`, then {@link FLIGHT_DEFAULTS} — field by field. `head` / `trail` / `arrival` are
 * taken whole (a head's art and its tint belong together); `path` merges per field.
 */
export function resolveFlightStyle(
	config: FlightsConfig | undefined,
	kind: string,
): ResolvedFlightStyle {
	const exact = normalizeFlightStyle(config?.[kind]);
	const family = kind.startsWith(FLIGHT_METER_PREFIX)
		? normalizeFlightStyle(config?.toMeter)
		: undefined;
	const pick = <T>(get: (style: FlightStyle) => T | undefined): T | undefined => {
		const own = exact ? get(exact) : undefined;
		return own !== undefined ? own : family ? get(family) : undefined;
	};
	const resolved: ResolvedFlightStyle = {
		overRoute: pick((s) => s.path?.overRoute) ?? FLIGHT_DEFAULTS.overRoute,
		avoid: pick((s) => s.path?.avoid) ?? FLIGHT_DEFAULTS.avoid,
		padding: pick((s) => s.path?.padding) ?? FLIGHT_DEFAULTS.padding,
		speed: pick((s) => s.speed) ?? FLIGHT_DEFAULTS.speed,
		minMs: pick((s) => s.minMs) ?? FLIGHT_DEFAULTS.minMs,
		maxMs: pick((s) => s.maxMs) ?? FLIGHT_DEFAULTS.maxMs,
		ease: pick((s) => s.ease) ?? FLIGHT_DEFAULTS.ease,
		stagger: pick((s) => s.stagger) ?? FLIGHT_DEFAULTS.stagger,
	};
	const head = pick((s) => s.head);
	if (head) resolved.head = head;
	const trail = pick((s) => s.trail);
	if (trail) resolved.trail = trail;
	const arrival = pick((s) => s.arrival);
	if (arrival) resolved.arrival = arrival;
	const bend = pick((s) => s.path?.bend);
	if (bend !== undefined) resolved.bend = bend;
	const arc = pick((s) => s.path?.arc);
	if (arc !== undefined) resolved.arc = arc;
	return resolved;
}

/** What {@link flightEffectIds} reads of a style — loose enough for the server's Zod-typed doc. */
type FlightEffectRefs = {
	trail?: { effectId?: string; off?: boolean };
	arrival?: { effectId?: string };
};

/** Every Invisible FX effect the block plays (trails and arrivals) — what must ship with the game. */
export function flightEffectIds(
	config: Record<string, FlightEffectRefs | undefined> | undefined,
): string[] {
	const ids = new Set<string>();
	for (const style of Object.values(config ?? {})) {
		if (style?.trail?.effectId && style.trail.off !== true) ids.add(style.trail.effectId);
		if (style?.arrival?.effectId) ids.add(style.arrival.effectId);
	}
	return [...ids];
}
