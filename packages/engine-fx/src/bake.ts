/**
 * Invisible FX — BAKED effects (`invisible-fx.md` §"Baked effects"). An effect can be rendered
 * once, in `/fx`, into a looping sprite sheet; the game then plays that sheet as one animated sprite
 * instead of simulating its emitters. Opt-in per effect and off by default: an effect without
 * `bake`, or with `bake.enabled` false, plays exactly as before.
 *
 * Everything here is pure (no Pixi, no DOM), so the decisions — what may bake, when a bake is stale,
 * how big the sheet is, which path the runtime takes, where an instance starts its loop — are covered
 * by `tools/fx-spike/effectBake.ts` against these exact functions.
 */

import { behaviorsOf } from './bindArt';
import type { EffectDoc, EmitterLayer } from './types';

/** How the end of the captured loop meets its start. */
export type EffectBakeSeam = 'crossfade' | 'cut';

/** How the baked sheet is blended when it plays. */
export type EffectBakeBlend = 'normal' | 'add';

/** The sheet a "Bake now" produced. Written by `/fx`, never by hand. */
export interface EffectBakeResult {
	/** The sheet's R2 manifest key (a TexturePacker JSON), shipped like any effect atlas. */
	assetKey: string;
	/** Its frames, in playback order. */
	frames: string[];
	/** Playback rate the loop was captured at. */
	fps: number;
	/** Where a frame sits in the effect's own space: top-left and size, in effect pixels. */
	bounds: { x: number; y: number; w: number; h: number };
	/** `add` when every layer draws additively (the capture holds light, not paint). */
	blendMode: EffectBakeBlend;
	/** {@link effectBakeHash} of the doc the sheet was captured from. A mismatch is a stale bake. */
	hash: string;
	/** The sheet's page size in pixels. */
	sheet: { w: number; h: number };
}

/** The `bake` block of an `EffectDoc`: the author's settings, and the last bake's output. */
export interface EffectBake {
	/** Play the baked sheet in games. Off by default. */
	enabled: boolean;
	/** Capture rate, frames per second. */
	fps: number;
	/** Length of the loop, wall-clock seconds. */
	loopSeconds: number;
	/** Sheet pixels per effect pixel (0.05…1). */
	scale: number;
	seam: EffectBakeSeam;
	result?: EffectBakeResult;
}

export const EFFECT_BAKE_DEFAULTS = {
	fps: 24,
	loopSeconds: 2,
	scale: 0.5,
	seam: 'crossfade' as EffectBakeSeam,
};

export const EFFECT_BAKE_LIMITS = {
	fps: { min: 6, max: 60 },
	loopSeconds: { min: 0.25, max: 8 },
	scale: { min: 0.05, max: 1 },
	/** Frames in one loop. */
	frames: { min: 2, max: 120 },
	/** Longest side of the sheet page, pixels. */
	sheetSide: 4096,
	/** Largest effect-space box a frame may cover; beyond it a frame is clipped to the box. */
	captureSide: 2048,
	/** Longest warm-up, emitter seconds. */
	warmupEmitterSeconds: 30,
};

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function normalizeResult(raw: unknown): EffectBakeResult | undefined {
	if (!isObject(raw)) return undefined;
	const { assetKey, frames, fps, bounds, blendMode, hash, sheet } = raw;
	if (typeof assetKey !== 'string' || !assetKey.includes('/') || !assetKey.endsWith('.json'))
		return undefined;
	if (!Array.isArray(frames) || frames.length === 0) return undefined;
	if (!frames.every((f): f is string => typeof f === 'string' && f.length > 0)) return undefined;
	if (!finite(fps) || fps <= 0) return undefined;
	if (!isObject(bounds) || !isObject(sheet)) return undefined;
	const { x, y, w, h } = bounds;
	if (!finite(x) || !finite(y) || !finite(w) || !finite(h) || w <= 0 || h <= 0) return undefined;
	if (!finite(sheet.w) || !finite(sheet.h) || sheet.w <= 0 || sheet.h <= 0) return undefined;
	if (typeof hash !== 'string' || !hash) return undefined;
	return {
		assetKey,
		frames: [...frames],
		fps,
		bounds: { x, y, w, h },
		blendMode: blendMode === 'add' ? 'add' : 'normal',
		hash,
		sheet: { w: sheet.w, h: sheet.h },
	};
}

/**
 * Canonicalise a doc's `bake` block. Anything that is not an object is no bake at all (`undefined`,
 * so a doc that never had one stays byte-identical); settings are clamped into range; a malformed
 * result is dropped, which leaves the effect playing live.
 */
export function normalizeEffectBake(raw: unknown): EffectBake | undefined {
	if (!isObject(raw)) return undefined;
	const { fps, loopSeconds, scale } = EFFECT_BAKE_LIMITS;
	const bake: EffectBake = {
		enabled: raw.enabled === true,
		fps: finite(raw.fps) ? clamp(Math.round(raw.fps), fps.min, fps.max) : EFFECT_BAKE_DEFAULTS.fps,
		loopSeconds: finite(raw.loopSeconds)
			? clamp(raw.loopSeconds, loopSeconds.min, loopSeconds.max)
			: EFFECT_BAKE_DEFAULTS.loopSeconds,
		scale: finite(raw.scale) ? clamp(raw.scale, scale.min, scale.max) : EFFECT_BAKE_DEFAULTS.scale,
		seam: raw.seam === 'cut' ? 'cut' : 'crossfade',
	};
	const result = normalizeResult(raw.result);
	if (result) bake.result = result;
	return bake;
}

/** A fresh `bake` block with the defaults, off. */
export function defaultEffectBake(): EffectBake {
	return { enabled: false, ...EFFECT_BAKE_DEFAULTS };
}

/** Frames in one captured loop. */
export function effectBakeFrameCount(bake: Pick<EffectBake, 'fps' | 'loopSeconds'>): number {
	const { min, max } = EFFECT_BAKE_LIMITS.frames;
	return clamp(Math.round(bake.fps * bake.loopSeconds), min, max);
}

/** Frames captured past the loop and blended over its start (`crossfade`), else 0. */
export function effectBakeSeamFrames(bake: Pick<EffectBake, 'seam'>, frameCount: number): number {
	return bake.seam === 'crossfade' ? Math.max(1, Math.round(frameCount / 4)) : 0;
}

/**
 * How much to output frame `i` of the loop is the captured frame `i` (`1 - weight` of it is the
 * frame `frameCount + i`). Crossfading the head of the loop into the frames captured just after its
 * end makes the last frame flow into the first: frame `N-1` is capture `N-1`, frame 0 is capture `N`
 * (weight 0), and by frame `seam` the loop is back on pure capture.
 */
export function effectBakeSeamWeight(i: number, seamFrames: number): number {
	if (seamFrames <= 0 || i >= seamFrames) return 1;
	return i / seamFrames;
}

const configNum = (config: unknown, key: string): number | undefined => {
	const v = isObject(config) ? config[key] : undefined;
	return finite(v) ? v : undefined;
};

/**
 * Emitter seconds to run before the first captured frame, so the loop starts with the effect full:
 * the longest particle life of any layer, plus a margin, capped.
 */
export function effectBakeWarmup(doc: Pick<EffectDoc, 'layers'>): number {
	let longest = 0;
	for (const layer of doc.layers) {
		const life = isObject(layer.config.lifetime) ? layer.config.lifetime : undefined;
		const max = configNum(life, 'max') ?? configNum(life, 'min') ?? 0;
		longest = Math.max(longest, max);
	}
	return Math.min(EFFECT_BAKE_LIMITS.warmupEmitterSeconds, longest * 1.25 + 0.1);
}

/** Why an effect cannot bake, one line per reason; empty ⇒ it can. */
export function effectBakeBlockers(doc: Pick<EffectDoc, 'layers' | 'params'>): string[] {
	const out: string[] = [];
	if (!doc.layers.length) out.push('The effect has no layers.');
	if (doc.params?.length)
		out.push(
			'It exposes parameters, which games set live per placement — a baked loop cannot follow them.',
		);
	for (const layer of doc.layers) {
		const name = `Layer "${layer.key}"`;
		if (layer.particleKind === 'spine') out.push(`${name} emits rig clips (Tier C).`);
		if (layer.placement.space === 'bone') out.push(`${name} rides a rig bone.`);
		if (layer.trigger?.on === 'event') out.push(`${name} waits for a cue, so it is not ambient.`);
		else if (finite(layer.trigger?.duration))
			out.push(`${name} stops after ${layer.trigger.duration} ms, so it does not loop.`);
		const life = configNum(layer.config, 'emitterLifetime');
		if (life !== undefined && life > 0)
			out.push(`${name} is a one-shot burst (emitter lifetime ${life}s), so it does not loop.`);
	}
	return out;
}

const stable = (v: unknown): string => {
	if (Array.isArray(v))
		return `[${v.map((x) => (x === undefined ? 'null' : stable(x))).join(',')}]`;
	if (isObject(v)) {
		const keys = Object.keys(v)
			.filter((k) => v[k] !== undefined)
			.sort();
		return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
	}
	return JSON.stringify(v) ?? 'null';
};

/** FNV-1a, 32-bit, as 8 hex digits. */
export function fnv1a(text: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * What a bake was captured from: the layers, the parameters and the capture settings — not the
 * name, not `enabled`, not the result itself. Hash the NORMALIZED doc (what Save stores), so the
 * page and the export agree. Key order does not matter.
 */
export function effectBakeHash(doc: Pick<EffectDoc, 'layers' | 'params' | 'bake'>): string {
	const bake = doc.bake ?? defaultEffectBake();
	return fnv1a(
		stable({
			layers: doc.layers,
			params: doc.params ?? [],
			capture: { fps: bake.fps, loopSeconds: bake.loopSeconds, scale: bake.scale, seam: bake.seam },
		}),
	);
}

/** The bake no longer matches the doc (or there is none yet). */
export function effectBakeStale(doc: Pick<EffectDoc, 'layers' | 'params' | 'bake'>): boolean {
	const result = doc.bake?.result;
	return !result || result.hash !== effectBakeHash(doc);
}

/**
 * Whether the bake travels to games: on, captured, current, and the effect still bakeable. Read at
 * export, which strips every other `bake` block, so a game only ever sees bakes that ship.
 */
export function effectBakeShips(doc: EffectDoc): boolean {
	return (
		doc.bake?.enabled === true &&
		!!doc.bake.result &&
		!effectBakeStale(doc) &&
		effectBakeBlockers(doc).length === 0
	);
}

/**
 * The doc as it is exported to games: `bake` kept only when it ships (and then only what the
 * runtime reads: on, and the result). Any other doc comes back untouched.
 */
export function exportableEffectDoc(doc: EffectDoc): EffectDoc {
	if (!doc.bake) return doc;
	const { bake, ...rest } = doc;
	if (!effectBakeShips(doc) || !bake.result) return rest;
	return { ...rest, bake: { ...bake, result: bake.result } };
}

/** Layout of a baked sheet: a grid of equal cells, one per frame. */
export interface EffectBakeSheetPlan {
	/** The scale actually used — the requested one, lowered when the sheet would not fit. */
	scale: number;
	cellW: number;
	cellH: number;
	/** Transparent pixels between cells, so filtering never bleeds a neighbour in. */
	gap: number;
	cols: number;
	rows: number;
	width: number;
	height: number;
}

const BAKE_GAP = 2;

const layoutAt = (
	boundsW: number,
	boundsH: number,
	frames: number,
	scale: number,
): EffectBakeSheetPlan => {
	const cellW = Math.max(1, Math.ceil(boundsW * scale));
	const cellH = Math.max(1, Math.ceil(boundsH * scale));
	const cols = Math.max(1, Math.min(frames, Math.ceil(Math.sqrt((frames * cellH) / cellW))));
	const rows = Math.ceil(frames / cols);
	return {
		scale,
		cellW,
		cellH,
		gap: BAKE_GAP,
		cols,
		rows,
		width: cols * cellW + (cols - 1) * BAKE_GAP,
		height: rows * cellH + (rows - 1) * BAKE_GAP,
	};
};

/**
 * Lay out `frames` cells of the captured box (effect pixels) at `scale` into one page no larger than
 * `EFFECT_BAKE_LIMITS.sheetSide`, lowering the scale until it fits. `undefined` when even the
 * smallest scale does not fit.
 */
export function planEffectBakeSheet(
	boundsW: number,
	boundsH: number,
	frames: number,
	scale: number,
): EffectBakeSheetPlan | undefined {
	const side = EFFECT_BAKE_LIMITS.sheetSide;
	const min = EFFECT_BAKE_LIMITS.scale.min;
	let s = clamp(scale, min, EFFECT_BAKE_LIMITS.scale.max);
	for (;;) {
		const plan = layoutAt(boundsW, boundsH, frames, s);
		if (plan.width <= side && plan.height <= side) return plan;
		if (s <= min) return undefined;
		s = Math.max(min, s * Math.min(side / plan.width, side / plan.height, 0.95));
	}
}

/** Name of frame `i` in a baked sheet. */
export const effectBakeFrameName = (i: number): string => `bake_${String(i).padStart(3, '0')}`;

/** The R2 stem a bake's sheet is written under (`<stem>.json` + `<stem>.png`). */
export const effectBakeStem = (effectId: string, hash: string): string =>
	`fxbake_${effectId}_${hash}`;

/**
 * The TexturePacker (json-hash) description of a baked sheet: what `/api/editor/regions` reads and
 * the editor-art export re-ships, so the sheet takes the same road as any effect atlas.
 */
export function effectBakeSheetJson(
	plan: Pick<EffectBakeSheetPlan, 'cellW' | 'cellH' | 'gap' | 'cols' | 'width' | 'height'>,
	frames: number,
	image: string,
): {
	frames: Record<string, unknown>;
	meta: { image: string; size: { w: number; h: number }; scale: string; format: string };
} {
	const out: Record<string, unknown> = {};
	for (let i = 0; i < frames; i++) {
		const x = (i % plan.cols) * (plan.cellW + plan.gap);
		const y = Math.floor(i / plan.cols) * (plan.cellH + plan.gap);
		out[effectBakeFrameName(i)] = {
			frame: { x, y, w: plan.cellW, h: plan.cellH },
			rotated: false,
			trimmed: false,
			spriteSourceSize: { x: 0, y: 0, w: plan.cellW, h: plan.cellH },
			sourceSize: { w: plan.cellW, h: plan.cellH },
		};
	}
	return {
		frames: out,
		meta: { image, size: { w: plan.width, h: plan.height }, scale: '1', format: 'RGBA8888' },
	};
}

/** `add` when every layer that draws blends additively; otherwise `normal`. */
export function effectBakeBlend(layers: readonly EmitterLayer[]): EffectBakeBlend {
	const drawn = layers.filter((l) => l.particleKind !== 'spine');
	if (!drawn.length) return 'normal';
	return drawn.every(
		(l) => behaviorsOf(l.config).find((b) => b.type === 'blendMode')?.config.blendMode === 'add',
	)
		? 'add'
		: 'normal';
}

/** Why a mount plays live although its effect has a bake. */
export type EffectBakeLiveReason = 'no-bake' | 'off' | 'not-bakeable' | 'driven' | 'missing-art';

export type EffectBakeChoice<T> =
	| { mode: 'baked'; result: EffectBakeResult; textures: T[] }
	| { mode: 'live'; reason: EffectBakeLiveReason };

/**
 * Which path a mounted effect takes. Baked only when the doc's bake is on, has a result, the effect
 * is still bakeable, the mount does not drive it (a trail owner, a forced rig beat, live parameter
 * values), and EVERY frame of the sheet is loaded — a missing sheet falls back to the live emitters.
 * `lookup` reads `loadedAssets`; a frame resolves as `<assetKey>::<frame>` first, then bare (the
 * editor-art key scheme, as `EffectLayer` resolves particle art).
 */
export function effectBakeChoice<T>(
	doc: Pick<EffectDoc, 'layers' | 'params' | 'bake'>,
	lookup: (key: string) => T | undefined,
	driven = false,
): EffectBakeChoice<T> {
	const bake = doc.bake;
	if (!bake) return { mode: 'live', reason: 'no-bake' };
	if (!bake.enabled || !bake.result) return { mode: 'live', reason: 'off' };
	if (effectBakeBlockers(doc).length) return { mode: 'live', reason: 'not-bakeable' };
	if (driven) return { mode: 'live', reason: 'driven' };
	const { assetKey, frames } = bake.result;
	const textures: T[] = [];
	for (const frame of frames) {
		const tex = lookup(`${assetKey}::${frame}`) ?? lookup(frame);
		if (tex === undefined || tex === null) return { mode: 'live', reason: 'missing-art' };
		textures.push(tex);
	}
	return { mode: 'baked', result: bake.result, textures };
}

/**
 * The loop frame an instance starts on, so several copies of one baked effect do not pulse in step.
 * Deterministic in `key` (the effect, the mount and where it sits), never `Math.random`, so a seeded
 * render stays stable.
 */
export function effectBakeStartFrame(key: string, frameCount: number): number {
	if (frameCount <= 1) return 0;
	return parseInt(fnv1a(key), 16) % frameCount;
}

/** The desync key for one mount: the effect, the caller's instance key, and its rounded position. */
export function effectBakeInstanceKey(
	effectId: string,
	instanceKey: string | undefined,
	x: number,
	y: number,
): string {
	return `${effectId}|${instanceKey ?? ''}|${Math.round(x)},${Math.round(y)}`;
}

/** The frame showing `seconds` after an instance started on `start`. */
export function effectBakeFrameAt(
	start: number,
	seconds: number,
	fps: number,
	frameCount: number,
): number {
	if (frameCount <= 0) return 0;
	return (start + Math.floor(Math.max(0, seconds) * fps)) % frameCount;
}
