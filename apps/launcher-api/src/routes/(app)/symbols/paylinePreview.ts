/**
 * THE PAYLINE PREVIEW's pure half (Invisible Symbols → Win lines → Payline style): which sample line
 * it draws on which board, the resolved style it draws with, when it replays, and the timeline of
 * one play — the draw, the tip's end, the trail and the burst — as the game's `WinLine.svelte` runs
 * them. `PaylinePreview.svelte` is the thin host that paints it (`engine-layout` `paintWinLine`,
 * the strokes the game makes) and mounts the effects. Offline-checked by `check:payline-preview`.
 */
import { emitterSecondsToWallMs, type EffectDoc, type EmitterLayer } from 'engine-fx';
import {
	normalizeWinLineColor,
	normalizeWinLineTaper,
	normalizeWinLineTip,
	normalizeWinLineTrailFx,
	WIN_LINE_TIP_FADE_MS,
	winLineDrawMs,
	type WinLinePaintStyle,
	type WinLinePoint,
	type WinLineTip,
	type WinLineTipEnd,
} from 'engine-layout';
import type { WinLineLineStyle } from './symbols.client';

/** One cell in board units — the game's `SYMBOL_SIZE`, which every win-line size multiplies. */
export const PREVIEW_CELL = 120;

/** The game's coded `winLine.line` defaults (`bakedWinLineConfig` in `apps/lines/src/editor-scenes.ts`;
 *  `check:payline-preview` reads them off that source so the two cannot drift). */
export const PREVIEW_LINE_DEFAULTS = {
	color: '#ffcc00',
	width: 0.03,
	glow: false,
	animated: false,
	speed: 1,
	fullPayline: false,
	fullPaylineColor: '#4a90d9',
	useConfigColor: true,
} as const;

/** A one-shot effect with no bound of its own emits this long — the game's `TRANSIT_BEAT_CAP_MS`. */
export const PREVIEW_BURST_FALLBACK_MS = 650;

/** The beat before the line starts drawing, so a replay reads as a new line. */
export const PREVIEW_WAIT_MS = 350;

/** How long after a setting stops changing the preview replays. */
export const PREVIEW_REPLAY_DEBOUNCE_MS = 300;

/** `winLine.line` resolved as the game resolves it: every unset field its coded default. */
export type PreviewLine = WinLinePaintStyle & {
	enabled: boolean;
	animated: boolean;
	speed: number;
	tip: WinLineTip | undefined;
	trailFx: string[];
	drawSound: string | undefined;
	endSound: string | undefined;
};

/** The doc's sparse line style with the game's defaults filled in (`bakedWinLineConfig().line`). */
export function resolvePreviewLine(
	line: WinLineLineStyle | undefined,
	enabled = true,
): PreviewLine {
	const w = line ?? {};
	const D = PREVIEW_LINE_DEFAULTS;
	const color = w.color ?? D.color;
	const taper = normalizeWinLineTaper(w.taper);
	return {
		enabled,
		color,
		width: w.width ?? D.width,
		glow: w.glow ?? D.glow,
		glowColor: w.glowColor ?? color,
		animated: w.animated ?? D.animated,
		speed: w.speed ?? D.speed,
		fullPayline: w.fullPayline ?? D.fullPayline,
		fullPaylineColor: w.fullPaylineColor ?? D.fullPaylineColor,
		useConfigColor: w.useConfigColor ?? D.useConfigColor,
		coreColor: normalizeWinLineColor(w.coreColor),
		blend: w.blend === 'add' ? 'add' : 'normal',
		taper: { alpha: taper?.alpha ?? 1, width: taper?.width ?? 1 },
		tip: normalizeWinLineTip(w.tip),
		trailFx: normalizeWinLineTrailFx(w.trailFx) ?? [],
		drawSound: w.drawSound?.trim() || undefined,
		endSound: w.endSound?.trim() || undefined,
	};
}

/** One of the project's paylines: its id, the row it takes on each reel, its authored colour. */
export type PreviewPayline = { id: string; rows: number[]; color?: string };

/** The board the preview draws: reels, each reel's row count, and the project's paylines. */
export type PreviewBoard = { reels: number; rows: number[]; paylines: PreviewPayline[] };

/** The Game Config fields the board is read from. */
type BoardSource = {
	numReels?: unknown;
	numRows?: unknown;
	paylines?: unknown;
	paylineColors?: unknown;
};

const MAX_REELS = 12;
const MAX_ROWS = 12;
const MAX_PAYLINES = 100;

const count = (value: unknown, fallback: number, max: number): number =>
	typeof value === 'number' && Number.isInteger(value) && value >= 1
		? Math.min(value, max)
		: fallback;

/**
 * The preview board for a project's Game Config: its reels and rows (5 × 3 without one) and every
 * payline that names a real row on each reel, in the config's order, with its colour when that is a
 * valid hex. A payline that does not fit the board is left out rather than drawn off it.
 */
export function previewBoardOf(doc: BoardSource | null | undefined): PreviewBoard {
	const reels = count(doc?.numReels, 5, MAX_REELS);
	const declared = Array.isArray(doc?.numRows) ? doc.numRows : [];
	const fallbackRows = count(declared[0], 3, MAX_ROWS);
	const rows = Array.from({ length: reels }, (_, reel) =>
		count(declared[reel], fallbackRows, MAX_ROWS),
	);
	const colors =
		doc?.paylineColors && typeof doc.paylineColors === 'object'
			? (doc.paylineColors as Record<string, unknown>)
			: {};
	const paylines: PreviewPayline[] = [];
	const source =
		doc?.paylines && typeof doc.paylines === 'object' && !Array.isArray(doc.paylines)
			? Object.entries(doc.paylines as Record<string, unknown>)
			: [];
	for (const [id, line] of source) {
		if (paylines.length === MAX_PAYLINES) break;
		if (!Array.isArray(line) || line.length < reels) continue;
		const picked = line.slice(0, reels);
		const fits = picked.every(
			(row, reel) =>
				typeof row === 'number' && Number.isInteger(row) && row >= 0 && row < rows[reel],
		);
		if (!fits) continue;
		const color = normalizeWinLineColor(colors[id]);
		paylines.push({ id, rows: picked as number[], ...(color ? { color } : {}) });
	}
	return { reels, rows, paylines };
}

/** How many times a payline turns (goes up after down, or down after up) — how much it shows of a
 *  tip turning with the line and a taper cut clear of the corners. */
function turns(rows: readonly number[]): number {
	let turned = 0;
	let last = 0;
	for (let i = 1; i < rows.length; i += 1) {
		const step = Math.sign(rows[i] - rows[i - 1]);
		if (step !== 0 && last !== 0 && step !== last) turned += 1;
		if (step !== 0) last = step;
	}
	return turned;
}

const bends = (rows: readonly number[]): number =>
	rows.slice(1).filter((row, i) => row !== rows[i]).length;

/**
 * The payline the preview starts on: the project's most zig-zagging one (most turns, then most
 * steps between rows, then the first declared), so the corners, the turning tip and the taper all
 * show. Undefined when the project has no payline — the preview then draws {@link zigzagRows}.
 */
export function sampleLineId(board: PreviewBoard): string | undefined {
	let best: PreviewPayline | undefined;
	for (const line of board.paylines) {
		if (
			!best ||
			turns(line.rows) > turns(best.rows) ||
			(turns(line.rows) === turns(best.rows) && bends(line.rows) > bends(best.rows))
		) {
			best = line;
		}
	}
	return best?.id;
}

/** A sample line for a board with no paylines: a triangle wave from the top row down and back up
 *  (0, 1, 2, 1, 0 on 5 × 3), clamped to each reel's rows. */
export function zigzagRows(board: Pick<PreviewBoard, 'reels' | 'rows'>): number[] {
	const span = Math.max(0, Math.min(...board.rows) - 1);
	return Array.from({ length: board.reels }, (_, reel) => {
		if (span === 0) return 0;
		const phase = reel % (span * 2);
		return Math.min(phase <= span ? phase : span * 2 - phase, board.rows[reel] - 1);
	});
}

/** The rows the preview traces: the picked payline's, else the zig-zag. */
export function sampleRows(board: PreviewBoard, lineId: string | undefined): number[] {
	return board.paylines.find((line) => line.id === lineId)?.rows ?? zigzagRows(board);
}

/** The board's size in board units (one cell = {@link PREVIEW_CELL}). */
export function boardSize(board: Pick<PreviewBoard, 'reels' | 'rows'>): {
	width: number;
	height: number;
} {
	return { width: board.reels * PREVIEW_CELL, height: Math.max(...board.rows) * PREVIEW_CELL };
}

/** A cell's centre in board units, origin the board's top-left. A reel shorter than the tallest is
 *  centred in it. */
export function cellCentre(
	board: Pick<PreviewBoard, 'rows'>,
	reel: number,
	row: number,
): WinLinePoint {
	const tallest = Math.max(...board.rows);
	const inset = ((tallest - board.rows[reel]) * PREVIEW_CELL) / 2;
	return { x: (reel + 0.5) * PREVIEW_CELL, y: inset + (row + 0.5) * PREVIEW_CELL };
}

/** The points a win of `ofAKind` symbols traces (the paying cells, from the first reel), and the
 *  whole payline for the full-payline underlay — what `winLinePointsFor` hands the game's line. */
export function samplePoints(
	board: PreviewBoard,
	rows: readonly number[],
	ofAKind: number,
): { points: WinLinePoint[]; fullPoints: WinLinePoint[] } {
	const fullPoints = rows.map((row, reel) => cellCentre(board, reel, row));
	const paying = Math.min(rows.length, Math.max(2, Math.round(ofAKind)));
	return { points: fullPoints.slice(0, paying), fullPoints };
}

/**
 * What a play of the preview depends on — the line style and the sample. A change to any of them
 * replays the line; the stamped amount's settings (`winLine.text`) do not.
 */
export function previewReplayKey(
	line: PreviewLine,
	sample: { lineId: string | undefined; ofAKind: number },
): string {
	return JSON.stringify([line, sample.lineId ?? null, sample.ofAKind]);
}

/** How long a one-shot effect emits, as the game's `SymbolLayer` times a burst: the longest of its
 *  layers' own bounds (`trigger.duration`, else `emitterLifetime`), {@link PREVIEW_BURST_FALLBACK_MS}
 *  for a layer with neither. */
export function burstEmitMs(doc: Pick<EffectDoc, 'layers'> | null | undefined): number {
	let ms = 0;
	for (const layer of doc?.layers ?? []) {
		const lifetime = layer.config.emitterLifetime;
		const own =
			layer.trigger?.duration ??
			(typeof lifetime === 'number' && lifetime > 0 ? emitterSecondsToWallMs(lifetime) : undefined);
		ms = Math.max(ms, own ?? PREVIEW_BURST_FALLBACK_MS);
	}
	return ms;
}

/** The longest particle life in an effect, wall ms — how long its last particle outlives emission. */
export function effectSettleMs(doc: Pick<EffectDoc, 'layers'> | null | undefined): number {
	let ms = 0;
	for (const layer of doc?.layers ?? []) {
		ms = Math.max(ms, emitterSecondsToWallMs(layer.config.lifetime?.max ?? 0));
	}
	return ms;
}

/**
 * Effects as one set of layers for one stage: every layer FREE (a trail has no rig to
 * ride — the game's `FlightView` frees a bone layer the same way, offset kept) and keyed by its
 * effect, so two effects' layers never share a key.
 */
export function freeLayers(docs: readonly Pick<EffectDoc, 'id' | 'layers'>[]): EmitterLayer[] {
	return docs.flatMap((doc) =>
		doc.layers.map((layer) => ({
			...layer,
			key: `${doc.id}/${layer.key}`,
			placement:
				layer.placement.space === 'bone'
					? { space: 'free' as const, offset: layer.placement.offset }
					: layer.placement,
		})),
	);
}

/** One play's timing (ms from the replay). */
export type PreviewPlan = {
	/** When the line appears (and, animated, starts drawing). */
	startMs: number;
	/** How long it draws: `winLineDrawMs`, or 0 for a line that is not animated (drawn at once). */
	drawMs: number;
	/** The trail emits while the line draws — only an animated line has a trail. */
	trails: boolean;
	tipEnd: WinLineTipEnd;
	/** A burst effect plays as the tip goes. */
	bursts: boolean;
	burstMs: number;
};

export function previewPlan(
	line: PreviewLine,
	pathLength: number,
	burstDoc: Pick<EffectDoc, 'layers'> | null | undefined,
): PreviewPlan {
	const drawMs = line.animated ? winLineDrawMs(pathLength, line.speed, PREVIEW_CELL) : 0;
	const tipEnd = line.tip?.atEnd ?? 'stay';
	return {
		startMs: PREVIEW_WAIT_MS,
		drawMs,
		trails: line.animated && line.trailFx.length > 0,
		tipEnd,
		bursts: tipEnd === 'burst' && !!line.tip?.endEffectId,
		burstMs: burstEmitMs(burstDoc),
	};
}

/** What the preview shows `t` ms after a replay. */
export type PreviewFrame = {
	/** The line is up (it appears at {@link PreviewPlan.startMs}). */
	shown: boolean;
	/** Draw progress 0…1 — linear in time, as the game's tween. */
	progress: number;
	/** The trail is emitting. */
	trailing: boolean;
	tipShown: boolean;
	tipAlpha: number;
	/** The burst effect is emitting. */
	bursting: boolean;
};

/**
 * The frame at `t`, as `WinLine.svelte` plays a line: it draws at a constant rate; the trail emits
 * until it lands; then the tip stays, fades over `WIN_LINE_TIP_FADE_MS`, or is removed while the
 * burst emits at the end point.
 */
export function previewFrame(plan: PreviewPlan, t: number): PreviewFrame {
	const since = t - plan.startMs;
	if (since < 0) {
		return {
			shown: false,
			progress: 0,
			trailing: false,
			tipShown: false,
			tipAlpha: 1,
			bursting: false,
		};
	}
	const landedFor = since - plan.drawMs;
	const progress = plan.drawMs > 0 ? Math.min(1, since / plan.drawMs) : 1;
	const landed = landedFor >= 0;
	let tipShown = true;
	let tipAlpha = 1;
	if (landed && plan.tipEnd === 'fade') {
		tipAlpha = Math.max(0, 1 - landedFor / WIN_LINE_TIP_FADE_MS);
		tipShown = landedFor < WIN_LINE_TIP_FADE_MS;
	}
	if (landed && plan.tipEnd === 'burst') tipShown = false;
	return {
		shown: true,
		progress,
		trailing: plan.trails && !landed,
		tipShown,
		tipAlpha,
		bursting: plan.bursts && landed && landedFor < plan.burstMs,
	};
}

/** The line's sounds due between `from` (exclusive) and `to` (inclusive): the draw sound as an
 *  animated line starts drawing (never a line drawn at once, as in the game), the impact as it is
 *  drawn complete. */
export function previewCues(plan: PreviewPlan, from: number, to: number): ('draw' | 'end')[] {
	const cues: ('draw' | 'end')[] = [];
	const crosses = (at: number) => from < at && at <= to;
	if (plan.drawMs > 0 && crosses(plan.startMs)) cues.push('draw');
	if (crosses(plan.startMs + plan.drawMs)) cues.push('end');
	return cues;
}
