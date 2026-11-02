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
import { DEFAULT_EMIT_SPEED, emitterSecondsToWallMs } from './playback';
import type { EffectDoc, EmitterLayer } from './types';

/** How the end of the captured loop meets its start. */
export type EffectBakeSeam = 'crossfade' | 'cut';

/**
 * How a baked group is blended when it plays: the blend of the layers it was captured from (a
 * layer's `blendMode` behavior; none is `normal`).
 */
export type EffectBakeBlend = 'normal' | 'add' | 'screen' | 'multiply';

/**
 * One BLEND GROUP of a bake: a run of consecutive layers (draw order) that share a blend mode,
 * captured on its own so it can be drawn with that blend. Flattening an additive layer into a
 * normal-blend sheet turns its light into paint: the sheet's alpha then hides the background and the
 * dark surround of a glow texture shows as a dark outline (`docs/knowledge/lessons/fx.md`).
 */
export interface EffectBakeGroup {
	blendMode: EffectBakeBlend;
	/** Its frames, in playback order. Every group of a bake has the same count. */
	frames: string[];
}

/** The sheet a "Bake now" produced. Written by `/fx`, never by hand. */
export interface EffectBakeResult {
	/** The sheet's R2 manifest key (a TexturePacker JSON), shipped like any effect atlas. */
	assetKey: string;
	/** The blend groups, in draw order (bottom first); drawn on the same frame index. */
	groups: EffectBakeGroup[];
	/** Playback rate the loop was captured at. */
	fps: number;
	/** Where a frame sits in the effect's own space: top-left and size, in effect pixels. */
	bounds: { x: number; y: number; w: number; h: number };
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
	/** Blend groups (runs of layers that share a blend mode) one bake may hold. */
	groups: 8,
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

const BLENDS: readonly EffectBakeBlend[] = ['normal', 'add', 'screen', 'multiply'];
const isBlend = (v: unknown): v is EffectBakeBlend => BLENDS.includes(v as EffectBakeBlend);
const frameList = (v: unknown): string[] | undefined =>
	Array.isArray(v) && v.length > 0 && v.every((f) => typeof f === 'string' && f.length > 0)
		? [...(v as string[])]
		: undefined;

/**
 * The groups of a stored result. A bake from before blend groups (`frames` + `blendMode`, the whole
 * effect in one sheet) reads as one group, so it keeps playing where its blend still matches the
 * layers ({@link effectBakeGroupsMatch}).
 */
function normalizeGroups(raw: Record<string, unknown>): EffectBakeGroup[] | undefined {
	if (!Array.isArray(raw.groups)) {
		const frames = frameList(raw.frames);
		return frames && [{ blendMode: raw.blendMode === 'add' ? 'add' : 'normal', frames }];
	}
	if (!raw.groups.length || raw.groups.length > EFFECT_BAKE_LIMITS.groups) return undefined;
	const out: EffectBakeGroup[] = [];
	for (const g of raw.groups) {
		const frames = isObject(g) ? frameList(g.frames) : undefined;
		if (!frames || !isBlend(g.blendMode)) return undefined;
		if (out.length && frames.length !== out[0].frames.length) return undefined;
		out.push({ blendMode: g.blendMode, frames });
	}
	return out;
}

function normalizeResult(raw: unknown): EffectBakeResult | undefined {
	if (!isObject(raw)) return undefined;
	const { assetKey, fps, bounds, hash, sheet } = raw;
	if (typeof assetKey !== 'string' || !assetKey.includes('/') || !assetKey.endsWith('.json'))
		return undefined;
	const groups = normalizeGroups(raw);
	if (!groups) return undefined;
	if (!finite(fps) || fps <= 0) return undefined;
	if (!isObject(bounds) || !isObject(sheet)) return undefined;
	const { x, y, w, h } = bounds;
	if (!finite(x) || !finite(y) || !finite(w) || !finite(h) || w <= 0 || h <= 0) return undefined;
	if (!finite(sheet.w) || !finite(sheet.h) || sheet.w <= 0 || sheet.h <= 0) return undefined;
	if (typeof hash !== 'string' || !hash) return undefined;
	return {
		assetKey,
		groups,
		fps,
		bounds: { x, y, w, h },
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

/** The longest particle life of any layer, emitter seconds (0 when no layer sets one). */
export function effectBakeLongestLife(doc: Pick<EffectDoc, 'layers'>): number {
	let longest = 0;
	for (const layer of doc.layers) {
		const life = isObject(layer.config.lifetime) ? layer.config.lifetime : undefined;
		const max = configNum(life, 'max') ?? configNum(life, 'min') ?? 0;
		longest = Math.max(longest, max);
	}
	return longest;
}

/**
 * Emitter seconds to run before the first captured frame, so the loop starts with the effect full:
 * the longest particle life of any layer, plus a margin, capped.
 */
export function effectBakeWarmup(doc: Pick<EffectDoc, 'layers'>): number {
	return Math.min(EFFECT_BAKE_LIMITS.warmupEmitterSeconds, effectBakeLongestLife(doc) * 1.25 + 0.1);
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
	const groups = effectBakeGroups(doc.layers).length;
	if (groups > EFFECT_BAKE_LIMITS.groups)
		out.push(
			`Its layers switch blend mode ${groups - 1} times; a bake holds at most ` +
				`${EFFECT_BAKE_LIMITS.groups} blend groups. Reorder the layers so ones that share a blend sit together.`,
		);
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

/**
 * The result's blend groups are the layers' blend runs, in order. Not so for a bake captured before
 * blend groups from an effect that mixes blends: it flattened them into one normal-blend sheet.
 */
export function effectBakeGroupsMatch(doc: Pick<EffectDoc, 'layers' | 'bake'>): boolean {
	const groups = doc.bake?.result?.groups;
	if (!groups) return false;
	const runs = effectBakeGroups(doc.layers);
	return runs.length === groups.length && runs.every((r, i) => r.blendMode === groups[i].blendMode);
}

/** The bake no longer matches the doc (or there is none yet). */
export function effectBakeStale(doc: Pick<EffectDoc, 'layers' | 'params' | 'bake'>): boolean {
	const result = doc.bake?.result;
	return !result || result.hash !== effectBakeHash(doc) || !effectBakeGroupsMatch(doc);
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

/** Layout of a baked sheet: a grid of equal cells, one per frame of each blend group. */
export interface EffectBakeSheetPlan {
	/** The scale actually used — the requested one, lowered when the sheet would not fit. */
	scale: number;
	cellW: number;
	cellH: number;
	/** Fewest transparent pixels between cells, so filtering never bleeds a neighbour in. */
	gap: number;
	cols: number;
	rows: number;
	width: number;
	height: number;
}

const BAKE_GAP = 2;
/** Cells start on a multiple of this, so no 4×4 block of a compressed (KTX2) page spans two. */
const BAKE_ALIGN = 4;

/** Distance from one cell's origin to the next along an axis: the cell, the gap, then aligned. */
export const effectBakePitch = (cell: number, gap: number): number =>
	Math.ceil((cell + gap) / BAKE_ALIGN) * BAKE_ALIGN;

/** Top-left of cell `i` on the page. Cell `g × frames + f` is frame `f` of group `g`. */
export function effectBakeCellOrigin(
	plan: Pick<EffectBakeSheetPlan, 'cellW' | 'cellH' | 'gap' | 'cols'>,
	i: number,
): { x: number; y: number } {
	return {
		x: (i % plan.cols) * effectBakePitch(plan.cellW, plan.gap),
		y: Math.floor(i / plan.cols) * effectBakePitch(plan.cellH, plan.gap),
	};
}

/** The page size a grid needs: no gutter after the last column or row. */
export function effectBakeSheetSize(
	plan: Pick<EffectBakeSheetPlan, 'cellW' | 'cellH' | 'gap' | 'cols' | 'rows'>,
): { width: number; height: number } {
	return {
		width: (plan.cols - 1) * effectBakePitch(plan.cellW, plan.gap) + plan.cellW,
		height: (plan.rows - 1) * effectBakePitch(plan.cellH, plan.gap) + plan.cellH,
	};
}

const layoutAt = (
	boundsW: number,
	boundsH: number,
	cells: number,
	scale: number,
): EffectBakeSheetPlan => {
	const cellW = Math.max(1, Math.ceil(boundsW * scale));
	const cellH = Math.max(1, Math.ceil(boundsH * scale));
	const cols = Math.max(1, Math.min(cells, Math.ceil(Math.sqrt((cells * cellH) / cellW))));
	const rows = Math.ceil(cells / cols);
	const grid = { cellW, cellH, gap: BAKE_GAP, cols, rows };
	return { scale, ...grid, ...effectBakeSheetSize(grid) };
};

/**
 * Lay out `cells` cells (frames × blend groups) of the captured box (effect pixels) at `scale` into
 * one page no larger than `EFFECT_BAKE_LIMITS.sheetSide`, lowering the scale until it fits.
 * `undefined` when even the smallest scale does not fit.
 */
export function planEffectBakeSheet(
	boundsW: number,
	boundsH: number,
	cells: number,
	scale: number,
): EffectBakeSheetPlan | undefined {
	const side = EFFECT_BAKE_LIMITS.sheetSide;
	const min = EFFECT_BAKE_LIMITS.scale.min;
	let s = clamp(scale, min, EFFECT_BAKE_LIMITS.scale.max);
	for (;;) {
		const plan = layoutAt(boundsW, boundsH, cells, s);
		if (plan.width <= side && plan.height <= side) return plan;
		if (s <= min) return undefined;
		s = Math.max(min, s * Math.min(side / plan.width, side / plan.height, 0.95));
	}
}

/**
 * Name of cell `i` of the bake `hash` (cells run group by group). The hash keeps two baked effects'
 * frames apart: the editor-art export reports a region name packed in two shipped sheets as a
 * collision.
 */
export const effectBakeFrameName = (hash: string, i: number): string =>
	`bake_${hash}_${String(i).padStart(3, '0')}`;

/** The frame names of each blend group of a sheet with `frames` frames per group. */
export const effectBakeGroupFrameNames = (
	hash: string,
	frames: number,
	groups: number,
): string[][] =>
	Array.from({ length: groups }, (_, g) =>
		Array.from({ length: frames }, (_, i) => effectBakeFrameName(hash, g * frames + i)),
	);

/**
 * The TexturePacker (json-hash) description of a baked sheet: what `/api/editor/regions` reads and
 * the editor-art export re-ships, so the sheet takes the same road as any effect atlas.
 */
export function effectBakeSheetJson(
	plan: Pick<EffectBakeSheetPlan, 'cellW' | 'cellH' | 'gap' | 'cols' | 'width' | 'height'>,
	cells: number,
	image: string,
	hash: string,
): {
	frames: Record<string, unknown>;
	meta: { image: string; size: { w: number; h: number }; scale: string; format: string };
} {
	const out: Record<string, unknown> = {};
	for (let i = 0; i < cells; i++) {
		const { x, y } = effectBakeCellOrigin(plan, i);
		out[effectBakeFrameName(hash, i)] = {
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

/** How a layer blends: its `blendMode` behavior, `normal` without one (or with an unknown mode). */
export function effectBakeLayerBlend(layer: EmitterLayer): EffectBakeBlend {
	const mode = behaviorsOf(layer.config).find((b) => b.type === 'blendMode')?.config.blendMode;
	return isBlend(mode) ? mode : 'normal';
}

/**
 * The blend groups a bake captures: consecutive drawn layers (draw order) that share a blend mode.
 * Each run composites exactly on its own and then onto what is below it with its blend, so the
 * groups drawn in order look like the live layers.
 */
export function effectBakeGroups(
	layers: readonly EmitterLayer[],
): { blendMode: EffectBakeBlend; layers: string[] }[] {
	const out: { blendMode: EffectBakeBlend; layers: string[] }[] = [];
	for (const layer of layers) {
		if (layer.particleKind === 'spine') continue;
		const blendMode = effectBakeLayerBlend(layer);
		const last = out[out.length - 1];
		if (last?.blendMode === blendMode) last.layers.push(layer.key);
		else out.push({ blendMode, layers: [layer.key] });
	}
	return out;
}

/** Why a mount plays live although its effect has a bake. */
export type EffectBakeLiveReason =
	'no-bake' | 'off' | 'not-bakeable' | 'stale-blend' | 'driven' | 'missing-art';

export type EffectBakeChoice<T> =
	| { mode: 'baked'; result: EffectBakeResult; textures: T[][] }
	| { mode: 'live'; reason: EffectBakeLiveReason };

/**
 * Which path a mounted effect takes. Baked only when the doc's bake is on, has a result, the effect
 * is still bakeable, the mount does not drive it (a trail owner, live parameter values — a rig beat
 * does not count: the loop plays on the beat, see {@link effectBakeBeatAlpha}), its blend groups
 * are still the layers' blend runs (a bake from before blend groups flattened additive layers into
 * paint), and EVERY frame of the sheet is loaded — a missing sheet falls back to the live emitters.
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
	if (!effectBakeGroupsMatch(doc)) return { mode: 'live', reason: 'stale-blend' };
	if (driven) return { mode: 'live', reason: 'driven' };
	const { assetKey, groups } = bake.result;
	const textures: T[][] = [];
	for (const group of groups) {
		const row: T[] = [];
		for (const frame of group.frames) {
			const tex = lookup(`${assetKey}::${frame}`) ?? lookup(frame);
			if (tex === undefined || tex === null) return { mode: 'live', reason: 'missing-art' };
			row.push(tex);
		}
		textures.push(row);
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

/** The longest fade-in of a baked effect fired by a rig beat, seconds on the particle clock. */
export const EFFECT_BAKE_BEAT_FADE_IN_SECONDS = 0.1;

/** How a baked effect fired by a rig beat fades in at the beat and out once emission ends. */
export interface EffectBakeBeatFades {
	/** Seconds from the beat to full opacity. */
	fadeIn: number;
	/** Seconds from the end of emission to nothing drawn: the longest particle life. */
	fadeOut: number;
}

/**
 * The fades of a baked effect played on a rig beat, in particle-clock seconds. Live, the beat's
 * particles build up and, once emission stops, live out their lifetime; the baked loop starts full
 * and has no particles to let die, so it fades. Out over the longest particle life at the beat's
 * `emitSpeed` (the time the last live particle takes to go); in over a short
 * {@link EFFECT_BAKE_BEAT_FADE_IN_SECONDS}, never longer than that life, so the full loop does not
 * pop in and a short beat still reaches full strength.
 */
export function effectBakeBeatFades(
	doc: Pick<EffectDoc, 'layers'>,
	emitSpeed?: number,
): EffectBakeBeatFades {
	const life = emitterSecondsToWallMs(effectBakeLongestLife(doc), emitSpeed) / 1000;
	return { fadeIn: Math.min(life, EFFECT_BAKE_BEAT_FADE_IN_SECONDS), fadeOut: life };
}

/** The loop's playback rate under a rig beat's `emitSpeed` (1 at the default speed). */
export function effectBakeBeatRate(emitSpeed?: number): number {
	return (emitSpeed || DEFAULT_EMIT_SPEED) / DEFAULT_EMIT_SPEED;
}

/**
 * The opacity of a baked effect `seconds` after its rig beat, emission ending at `endAt` seconds
 * (`undefined`: it never ends). Fades in, holds while emitting, then fades out from wherever it had
 * got to; 0 once the fade-out is over, and the sprite stops drawing.
 */
export function effectBakeBeatAlpha(
	seconds: number,
	endAt: number | undefined,
	fades: EffectBakeBeatFades,
): number {
	const rise = (t: number): number => (fades.fadeIn > 0 ? clamp(t / fades.fadeIn, 0, 1) : 1);
	if (endAt === undefined || seconds < endAt) return rise(Math.max(0, seconds));
	const from = rise(Math.max(0, endAt));
	if (fades.fadeOut <= 0) return 0;
	return from * clamp(1 - (seconds - endAt) / fades.fadeOut, 0, 1);
}
