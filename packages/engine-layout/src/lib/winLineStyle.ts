/**
 * THE STYLED PAYLINE — the optional look fields of the Invisible Symbols State Machine's
 * `winLine.line` (a white-hot core, an additive glow, a tail that fades toward the line's start, an
 * asset riding the moving tip, Invisible FX trailing it, and a sound as it draws and as it lands),
 * and the path maths the game draws them with.
 *
 * Shared by every half on purpose: the `/symbols` tool and the server prune with
 * {@link pruneWinLineStyle}, the runtime bundle and the bake keep the effects
 * {@link winLineEffectIds} names, and `WinLine.svelte` traces the line, places the tip and moves the
 * trail's owner with {@link pathSlice} / {@link pathHeadPose} — so the head the tip sits on is the
 * end of the stroke the line draws.
 *
 * Every field is optional and absent means the line as it always drew: no field here changes a
 * project that does not set it.
 *
 * No value import here: fixtures run this file under `node --experimental-strip-types`.
 */

export type WinLinePoint = { x: number; y: number };

/** How the glow halo combines with the board: `add` brightens it (a hot, light-emitting glow). */
export const WIN_LINE_BLENDS = ['normal', 'add'] as const;
export type WinLineBlend = (typeof WIN_LINE_BLENDS)[number];

/** What rides the moving tip: an atlas region, an Invisible Flipbook clip, or an Invisible FX effect. */
export const WIN_LINE_TIP_KINDS = ['sprite', 'flipbook', 'effect'] as const;
export type WinLineTipKind = (typeof WIN_LINE_TIP_KINDS)[number];

/** What the tip does once the line is drawn: stays at the end, fades out, or bursts (plays an
 *  optional end effect at the final point) and is removed. */
export const WIN_LINE_TIP_ENDS = ['stay', 'fade', 'burst'] as const;
export type WinLineTipEnd = (typeof WIN_LINE_TIP_ENDS)[number];

export const WIN_LINE_TIP_KIND_LABELS: Record<WinLineTipKind, string> = {
	sprite: 'Sprite',
	flipbook: 'Flipbook',
	effect: 'Effect',
};

export const WIN_LINE_TIP_END_LABELS: Record<WinLineTipEnd, string> = {
	stay: 'Stay at the end',
	fade: 'Fade out',
	burst: 'Burst and go',
};

/**
 * The asset at the line's moving head. `assetKey` (a scoped atlas region) for a sprite, `clipId`
 * for a flipbook, `effectId` for an effect — only the kind's own field is kept. `scale` multiplies
 * a cell (1 = one cell); `rotateWithLine` turns it to the line's direction at the head (art drawn
 * pointing right); `blend: 'add'` draws a sprite / flipbook / effect additively. `endEffectId` is
 * the burst's effect, kept only with `atEnd: 'burst'`.
 */
export type WinLineTip = {
	kind: WinLineTipKind;
	assetKey?: string;
	clipId?: string;
	effectId?: string;
	scale?: number;
	rotateWithLine?: boolean;
	blend?: WinLineBlend;
	atEnd?: WinLineTipEnd;
	endEffectId?: string;
};

/**
 * The tail fade: the line's alpha and width at its START, as a fraction of the tip's (0…1). Both
 * ramp up linearly to full at the tip. Absent (or 1) ⇒ no fade.
 */
export type WinLineTaper = { alpha?: number; width?: number };

/** The styled-payline fields of `winLine.line`. */
export type WinLineStyleFields = {
	/** An inner hot-core stroke (`#rrggbb`), thinner than the line and drawn on top of it. */
	coreColor?: string;
	/** The glow halo's blend. Absent ⇒ normal. */
	blend?: WinLineBlend;
	taper?: WinLineTaper;
	tip?: WinLineTip;
	/** Invisible FX effect ids played while the line draws, their emitter following the tip. */
	trailFx?: string[];
	/** A sound (a library or engine sound name) played as an animated path starts drawing. */
	drawSound?: string;
	/** A sound played as the line is drawn complete — its impact. */
	endSound?: string;
};

export const WIN_LINE_TRAIL_FX_MAX = 4;

export const WIN_LINE_STYLE_LIMITS = {
	tipScale: { min: 0.05, max: 8 },
	taper: { min: 0, max: 1 },
} as const;

/** The hot core's width as a fraction of the line's. */
export const WIN_LINE_CORE_RATIO = 0.4;

/** How many pieces a tapered line is stroked in. */
export const WIN_LINE_TAPER_STEPS = 8;

/** A tip fading out at the end takes this long, ms. */
export const WIN_LINE_TIP_FADE_MS = 300;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const nonBlank = (value: unknown): string | undefined =>
	typeof value === 'string' && value.trim() ? value.trim() : undefined;

const finite = (value: unknown): number | undefined =>
	typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** A tip with its kind's asset, defaults dropped — or undefined when it has no asset (nothing to
 *  draw, nothing to ship). */
export function normalizeWinLineTip(raw: unknown): WinLineTip | undefined {
	if (!isRecord(raw)) return undefined;
	const kind = raw.kind;
	if (!(WIN_LINE_TIP_KINDS as readonly unknown[]).includes(kind)) return undefined;
	const tip: WinLineTip = { kind: kind as WinLineTipKind };
	const asset =
		kind === 'sprite'
			? nonBlank(raw.assetKey)
			: kind === 'flipbook'
				? nonBlank(raw.clipId)
				: nonBlank(raw.effectId);
	if (!asset) return undefined;
	if (kind === 'sprite') tip.assetKey = asset;
	else if (kind === 'flipbook') tip.clipId = asset;
	else tip.effectId = asset;
	const scale = finite(raw.scale);
	if (scale !== undefined && scale !== 1) {
		tip.scale = clamp(
			scale,
			WIN_LINE_STYLE_LIMITS.tipScale.min,
			WIN_LINE_STYLE_LIMITS.tipScale.max,
		);
	}
	if (raw.rotateWithLine === true) tip.rotateWithLine = true;
	if (raw.blend === 'add') tip.blend = 'add';
	if (raw.atEnd === 'fade' || raw.atEnd === 'burst') tip.atEnd = raw.atEnd;
	const endEffectId = tip.atEnd === 'burst' ? nonBlank(raw.endEffectId) : undefined;
	if (endEffectId) tip.endEffectId = endEffectId;
	return tip;
}

/** A taper clamped into 0…1 with its no-fade values (1) dropped, or undefined when nothing fades. */
export function normalizeWinLineTaper(raw: unknown): WinLineTaper | undefined {
	if (!isRecord(raw)) return undefined;
	const taper: WinLineTaper = {};
	for (const key of ['alpha', 'width'] as const) {
		const value = finite(raw[key]);
		if (value === undefined) continue;
		const clamped = clamp(value, WIN_LINE_STYLE_LIMITS.taper.min, WIN_LINE_STYLE_LIMITS.taper.max);
		if (clamped < 1) taper[key] = clamped;
	}
	return Object.keys(taper).length ? taper : undefined;
}

/** Trimmed, non-blank, unique effect ids, at most {@link WIN_LINE_TRAIL_FX_MAX}; undefined if none. */
export function normalizeWinLineTrailFx(raw: unknown): string[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const ids: string[] = [];
	for (const item of raw) {
		const id = nonBlank(item);
		if (id && !ids.includes(id)) ids.push(id);
		if (ids.length === WIN_LINE_TRAIL_FX_MAX) break;
	}
	return ids.length ? ids : undefined;
}

/**
 * `winLine.line` with its styled-payline fields made canonical: the defaults dropped (`blend:
 * 'normal'`, a taper of 1, a tip with no asset, an empty trail), the rest normalized. Every other
 * field is copied as it is. A NEW object, in a fixed key order for the styled fields so the page's
 * dirty signature and the saved doc agree.
 */
export function pruneWinLineStyle<T extends object>(style: T): T {
	const line = style as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(line)) {
		if (key === 'coreColor' || key === 'blend' || key === 'taper' || key === 'tip') continue;
		if (key === 'trailFx' || key === 'drawSound' || key === 'endSound') continue;
		out[key] = value;
	}
	const coreColor = nonBlank(line.coreColor);
	if (coreColor) out.coreColor = coreColor;
	if (line.blend === 'add') out.blend = 'add';
	const taper = normalizeWinLineTaper(line.taper);
	if (taper) out.taper = taper;
	const tip = normalizeWinLineTip(line.tip);
	if (tip) out.tip = tip;
	const trailFx = normalizeWinLineTrailFx(line.trailFx);
	if (trailFx) out.trailFx = trailFx;
	const drawSound = nonBlank(line.drawSound);
	if (drawSound) out.drawSound = drawSound;
	const endSound = nonBlank(line.endSound);
	if (endSound) out.endSound = endSound;
	return out as T;
}

/** What {@link winLineEffectIds} reads — loose enough for the server's Zod-typed doc and the bake. */
type WinLineEffectRefs = {
	line?: {
		tip?: { kind?: string; effectId?: string; atEnd?: string; endEffectId?: string };
		trailFx?: readonly string[];
	};
};

/** Every Invisible FX effect the styled line plays (an effect tip, its burst, the trail) — what
 *  must ship with the game even when no scene places it. */
export function winLineEffectIds(winLine: WinLineEffectRefs | undefined): string[] {
	const ids = new Set<string>();
	const tip = winLine?.line?.tip;
	if (tip?.kind === 'effect' && tip.effectId) ids.add(tip.effectId);
	if (tip?.atEnd === 'burst' && tip.endEffectId) ids.add(tip.endEffectId);
	for (const id of winLine?.line?.trailFx ?? []) if (id) ids.add(id);
	return [...ids];
}

/** Total length of the polyline. */
export function pathLength(pts: readonly WinLinePoint[]): number {
	let total = 0;
	for (let i = 1; i < pts.length; i += 1) {
		total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
	}
	return total;
}

/** The point `distance` along the polyline (clamped to its ends). */
function pointAt(pts: readonly WinLinePoint[], distance: number): WinLinePoint {
	let acc = 0;
	for (let i = 1; i < pts.length; i += 1) {
		const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
		if (acc + d >= distance) {
			const t = d > 0 ? (distance - acc) / d : 0;
			return {
				x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
				y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t,
			};
		}
		acc += d;
	}
	return { ...pts[pts.length - 1] };
}

/**
 * The polyline drawn up to progress `to` (0…1 of its length), starting at progress `from` — the
 * vertices it passes and the interpolated ends. `pathSlice(pts, 0, p)` is what the line strokes
 * while it draws, so its last point IS the head. `to >= 1` with `from <= 0` is the whole line.
 */
export function pathSlice(pts: readonly WinLinePoint[], from: number, to: number): WinLinePoint[] {
	if (!pts.length) return [];
	if (from <= 0 && to >= 1) return pts.map((pt) => ({ ...pt }));
	const total = pathLength(pts);
	const start = Math.max(0, from) * total;
	const target = Math.min(1, to) * total;
	const out: WinLinePoint[] = [start > 0 ? pointAt(pts, start) : { ...pts[0] }];
	let acc = 0;
	for (let i = 1; i < pts.length; i += 1) {
		const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
		if (acc + d <= target) {
			if (start === 0 || acc + d > start) out.push({ ...pts[i] });
			acc += d;
		} else {
			const t = d > 0 ? (target - acc) / d : 0;
			out.push({
				x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
				y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t,
			});
			return out;
		}
	}
	return out;
}

/** Where the head is and which way the line runs there (radians, 0 = right, y down). */
export type WinLineHeadPose = { x: number; y: number; angle: number };

const degenerate = (pts: readonly WinLinePoint[], index: number) =>
	pts[index - 1].x === pts[index].x && pts[index - 1].y === pts[index].y;

/** The direction of segment `index` (`pts[index - 1]` → `pts[index]`), or — when it has no length —
 *  of the nearest one before it that has, else the nearest after. */
function segmentAngle(pts: readonly WinLinePoint[], index: number): number {
	for (let i = index; i >= 1; i -= 1) {
		if (!degenerate(pts, i)) return Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x);
	}
	for (let i = index + 1; i < pts.length; i += 1) {
		if (!degenerate(pts, i)) return Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x);
	}
	return 0;
}

/** The segment the head is on at progress `p`, by {@link pathSlice}'s walk: the one it is part way
 *  along, or — standing exactly on a vertex — the one that brought it there. */
function headSegment(pts: readonly WinLinePoint[], p: number): number {
	if (p >= 1) return pts.length - 1;
	const target = pathLength(pts) * p;
	let acc = 0;
	for (let i = 1; i < pts.length; i += 1) {
		const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
		if (acc + d <= target) {
			acc += d;
			continue;
		}
		return target - acc <= 0 && i > 1 ? i - 1 : i;
	}
	return pts.length - 1;
}

/**
 * The head at progress `p`: the last point of {@link pathSlice}`(pts, 0, p)`, and the tangent of the
 * segment it sits on. At `p = 0` the tangent is the first segment's, at the end the last one's, on a
 * vertex the incoming one's — a zero-length segment never decides it. Undefined for fewer than two
 * points (no line to head).
 */
export function pathHeadPose(pts: readonly WinLinePoint[], p: number): WinLineHeadPose | undefined {
	if (pts.length < 2) return undefined;
	const slice = pathSlice(pts, 0, p);
	return { ...slice[slice.length - 1], angle: segmentAngle(pts, headSegment(pts, p)) };
}

/** One piece of a tapered stroke: the progress range it covers and its alpha and width factor. */
export type WinLineTaperPiece = { from: number; to: number; alpha: number; width: number };

/**
 * The pieces a tapered line is stroked in, start to tip: `steps` equal spans of the drawn length,
 * each at the alpha and width the ramp reaches at its middle — `startAlpha` / `startWidth` at the
 * start rising linearly to 1 at the tip. Each piece is stroked once on its own (no overlap), so its
 * alpha is the alpha the board sees there.
 */
export function taperPieces(
	startAlpha: number,
	startWidth: number,
	steps = WIN_LINE_TAPER_STEPS,
): WinLineTaperPiece[] {
	const pieces: WinLineTaperPiece[] = [];
	for (let k = 0; k < steps; k += 1) {
		const ramp = steps > 1 ? k / (steps - 1) : 1;
		pieces.push({
			from: k / steps,
			to: (k + 1) / steps,
			alpha: startAlpha + (1 - startAlpha) * ramp,
			width: startWidth + (1 - startWidth) * ramp,
		});
	}
	return pieces;
}

/** One stroked run of a tapered line: its points and its alpha and width factor. */
export type WinLineTaperRun = { points: WinLinePoint[]; alpha: number; width: number };

/**
 * The line drawn up to progress `p`, cut into the {@link taperPieces} it is stroked in. The pieces
 * are butt-ended (they meet edge to edge, nothing doubles), so a cut is moved `clearance` past any
 * corner it lands within `clearance` of — a butt end AT a corner would leave the corner's outer
 * wedge unpainted. A cut that cannot move clear (past the next one, or the head) is dropped and its
 * two pieces join, the later one's alpha and width kept.
 */
export function taperRuns(
	pts: readonly WinLinePoint[],
	p: number,
	startAlpha: number,
	startWidth: number,
	clearance: number,
	steps = WIN_LINE_TAPER_STEPS,
): WinLineTaperRun[] {
	if (pts.length < 2) return [];
	const total = pathLength(pts);
	const drawn = total * Math.min(1, Math.max(0, p));
	if (drawn <= 0) return [];
	const corners: number[] = [];
	let acc = 0;
	for (let i = 1; i < pts.length - 1; i += 1) {
		acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
		corners.push(acc);
	}
	const pieces = taperPieces(startAlpha, startWidth, steps);
	const runs: WinLineTaperRun[] = [];
	let from = 0;
	for (let k = 0; k < pieces.length; k += 1) {
		const last = k === pieces.length - 1;
		let cut = pieces[k].to * drawn;
		if (!last) {
			const near = corners.find((corner) => Math.abs(cut - corner) < clearance);
			if (near !== undefined) cut = near + clearance;
			if (cut >= pieces[k + 1].to * drawn || cut >= drawn) continue;
		} else cut = drawn;
		if (cut <= from) continue;
		runs.push({
			points: pathSlice(pts, from / total, cut / total),
			alpha: pieces[k].alpha,
			width: pieces[k].width,
		});
		from = cut;
	}
	return runs;
}
