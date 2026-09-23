/**
 * Multi-stop gradient model + the Photoshop-style stop maths behind `GradientBar.svelte`.
 *
 * A stop carries its colour, its own opacity, and — exactly like Photoshop's gradient
 * editor — a `mid` saying where the 50/50 blend with the NEXT stop lands. Neither CSS
 * nor Canvas has a midpoint concept, so `flattenStops()` resolves that curve into plain
 * offset/colour samples; the CSS preview and the baked `CanvasGradient` are then the
 * same ramp by construction.
 */

export interface GradientStop {
	/** Position along the ramp, 0 → 1. */
	at: number;
	/** `#rrggbb` — opacity lives in `alpha`, not in an 8-digit hex. */
	color: string;
	/** Stop opacity, 0 → 1. */
	alpha: number;
	/** Where the 50/50 blend with the next stop sits, 0 → 1 (0.5 = linear). */
	mid: number;
}

/** Samples emitted per non-linear stop pair when resolving its midpoint curve. */
const MID_SAMPLES = 12;
/** A midpoint at exactly 0 or 1 has no finite exponent — clamp to a usable range. */
const MID_MIN = 0.05;
const MID_MAX = 0.95;
const LINEAR_EPSILON = 0.001;

/** The stops a fresh gradient opens with: opaque white → opaque periwinkle. */
export function defaultGradientStops(): GradientStop[] {
	return [
		{ at: 0, color: '#ffffff', alpha: 1, mid: 0.5 },
		{ at: 1, color: '#9aa0ff', alpha: 1, mid: 0.5 },
	];
}

/** A copy ordered by position (the editor keeps its own array in insertion order). */
export function sortStops(stops: GradientStop[]): GradientStop[] {
	return [...stops].sort((a, b) => a.at - b.at);
}

/** Mirror the ramp end-for-end (positions and midpoints both flip). */
export function reverseStops(stops: GradientStop[]): GradientStop[] {
	const sorted = sortStops(stops);
	return sorted
		.map((s, i) => ({
			...s,
			at: clamp01(1 - s.at),
			// `mid` describes the gap to the NEXT stop, so a flipped stop inherits the
			// mirrored midpoint of the gap that used to precede it.
			mid: i === 0 ? 0.5 : clamp01(1 - (sorted[i - 1].mid ?? 0.5)),
		}))
		.reverse();
}

/** The colour + opacity the ramp shows at `at` — what a click on the bar seeds a new stop with. */
export function stopAt(stops: GradientStop[], at: number): { color: string; alpha: number } {
	const sorted = sortStops(stops);
	if (sorted.length === 0) return { color: '#ffffff', alpha: 1 };
	const p = clamp01(at);
	if (p <= sorted[0].at)
		return { color: hex(rgb(sorted[0].color)), alpha: clamp01(sorted[0].alpha) };
	const last = sorted[sorted.length - 1];
	if (p >= last.at) return { color: hex(rgb(last.color)), alpha: clamp01(last.alpha) };
	for (let i = 0; i < sorted.length - 1; i++) {
		const a = sorted[i];
		const b = sorted[i + 1];
		if (p < a.at || p > b.at) continue;
		const span = b.at - a.at;
		const t = span <= 0 ? 0 : (p - a.at) / span;
		const m = mix(a, b, ease(t, a.mid));
		return { color: hex(m.rgb), alpha: m.alpha };
	}
	return { color: hex(rgb(last.color)), alpha: clamp01(last.alpha) };
}

/**
 * Resolve the stop list into offset/`rgba()` samples that Canvas and CSS both accept:
 * positions sorted + clamped into [0,1], and every non-linear midpoint expanded into
 * `MID_SAMPLES` intermediate samples along its power curve.
 */
export function flattenStops(stops: GradientStop[]): { at: number; css: string }[] {
	const sorted = sortStops(stops);
	if (sorted.length === 0) return [{ at: 0, css: 'rgba(0,0,0,0)' }];
	if (sorted.length === 1) {
		const only = stopCss(sorted[0]);
		return [
			{ at: 0, css: only },
			{ at: 1, css: only },
		];
	}
	const out: { at: number; css: string }[] = [
		{ at: clamp01(sorted[0].at), css: stopCss(sorted[0]) },
	];
	for (let i = 0; i < sorted.length - 1; i++) {
		const a = sorted[i];
		const b = sorted[i + 1];
		const m = clamp(a.mid, MID_MIN, MID_MAX);
		const span = clamp01(b.at) - clamp01(a.at);
		if (span > 0 && Math.abs(m - 0.5) > LINEAR_EPSILON) {
			for (let s = 1; s < MID_SAMPLES; s++) {
				const t = s / MID_SAMPLES;
				const blend = mix(a, b, ease(t, m));
				out.push({ at: clamp01(a.at) + span * t, css: rgba(blend.rgb, blend.alpha) });
			}
		}
		out.push({ at: clamp01(b.at), css: stopCss(b) });
	}
	return out;
}

/** A CSS `linear-gradient(...)` of the same ramp, for the editor bar + any HTML preview. */
export function cssGradient(stops: GradientStop[], direction = 'to right'): string {
	const parts = flattenStops(stops).map((s) => `${s.css} ${(s.at * 100).toFixed(2)}%`);
	return `linear-gradient(${direction}, ${parts.join(', ')})`;
}

/**
 * Anything that takes CSS colour stops: Canvas 2D's `CanvasGradient`, PIXI 8's
 * `FillGradient`. Structural on purpose — the ramp is not tied to one renderer.
 */
export interface ColorStopTarget {
	addColorStop(offset: number, color: string): unknown;
}

/** Paint the ramp onto an already-positioned gradient. */
export function applyStops(target: ColorStopTarget, stops: GradientStop[]): void {
	for (const s of flattenStops(stops)) target.addColorStop(clamp01(s.at), s.css);
}

/** Coerce arbitrary parsed JSON (an older saved doc, say) into a usable stop list. */
export function normalizeStops(raw: unknown): GradientStop[] {
	if (!Array.isArray(raw)) return defaultGradientStops();
	const stops = raw
		.filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
		.map((s) => ({
			at: clamp01(num(s.at, 0)),
			color: hex(rgb(typeof s.color === 'string' ? s.color : '#ffffff')),
			alpha: clamp01(num(s.alpha, 1)),
			mid: clamp(num(s.mid, 0.5), MID_MIN, MID_MAX),
		}));
	return stops.length >= 2 ? stops : defaultGradientStops();
}

/** Two stops from a legacy top→bottom colour pair. */
export function stopsFromPair(top: string, bottom: string): GradientStop[] {
	return [
		{ at: 0, color: hex(rgb(top)), alpha: 1, mid: 0.5 },
		{ at: 1, color: hex(rgb(bottom)), alpha: 1, mid: 0.5 },
	];
}

/** Photoshop's midpoint curve: `t ** k` with `k` chosen so `ease(m, m) === 0.5`. */
function ease(t: number, mid: number): number {
	const m = clamp(mid, MID_MIN, MID_MAX);
	if (Math.abs(m - 0.5) <= LINEAR_EPSILON) return t;
	return Math.pow(t, Math.log(0.5) / Math.log(m));
}

function mix(
	a: GradientStop,
	b: GradientStop,
	t: number,
): { rgb: [number, number, number]; alpha: number } {
	const ca = rgb(a.color);
	const cb = rgb(b.color);
	return {
		rgb: [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t],
		alpha: clamp01(a.alpha) + (clamp01(b.alpha) - clamp01(a.alpha)) * t,
	};
}

/** One stop as a CSS `rgba(...)` — the swatch colour for an editor marker. */
export function stopCss(stop: GradientStop): string {
	return rgba(rgb(stop.color), clamp01(stop.alpha));
}

function rgba(c: [number, number, number], alpha: number): string {
	const [r, g, b] = c.map((v) => Math.round(clamp(v, 0, 255)));
	return `rgba(${r}, ${g}, ${b}, ${Number(alpha.toFixed(3))})`;
}

function rgb(hexColor: string): [number, number, number] {
	const s = hexColor.trim().replace(/^#/, '');
	const full =
		s.length === 3
			? s
					.split('')
					.map((c) => c + c)
					.join('')
			: s;
	const n = /^[0-9a-fA-F]{6}$/.test(full) ? parseInt(full, 16) : 0xffffff;
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hex(c: [number, number, number]): string {
	return (
		'#' +
		c
			.map((v) =>
				Math.round(clamp(v, 0, 255))
					.toString(16)
					.padStart(2, '0'),
			)
			.join('')
	);
}

function num(v: unknown, fallback: number): number {
	return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
	if (!Number.isFinite(n)) return lo;
	return n < lo ? lo : n > hi ? hi : n;
}

function clamp01(n: number): number {
	return clamp(n, 0, 1);
}
