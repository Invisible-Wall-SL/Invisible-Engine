import type { ModelExportEntry, ModelExportIndex, ModelExportTier } from 'constants-shared/models';
import type { ModelLodScreenSize, ModelTierId } from 'constants-shared/modelTiers';

/** One model's files at the chosen tier: `tiers[tier] ?? tiers.full` (a missing copy equals full). */
export type ModelAt3d = { entry: ModelExportEntry; tier: ModelExportTier; url: string };

/**
 * Where a model of the export index is, at a tier. `base` is the deploy root the game's assets
 * resolve against (a baked build's `assets/`, a runtime bundle's `assetBase`); the index's paths are
 * relative to its `models/` folder (`modelExport.ts`).
 */
export function modelAt3d(
	index: ModelExportIndex | undefined,
	id: string,
	tier: ModelTierId,
	base: string,
): ModelAt3d | undefined {
	const entry = index?.models.find((m) => m.id === id);
	if (!entry) return undefined;
	const at = entry.tiers[tier] ?? entry.tiers.full;
	return { entry, tier: at, url: new URL(`models/${at.glb}`, base).href };
}

/** The LOD bias's bounds: a struggling device switches down earlier, never by more than this. */
const MIN_BIAS = 0.25;
const MAX_BIAS = 4;

/**
 * `THREE.LOD` distances from the export's screen sizes (runtime eval §5.2): a level of radius `r`
 * fills `s` of the viewport's height at `d = r / (s · tan(fov / 2))`, so the distances depend on the
 * FOV only (a resize or a DPR change needs nothing). `shipped` are the master levels the tier's GLB
 * carries, richest first: the first draws from 0 m (at every size above its own threshold), each
 * next one from where the previous level's screen size runs out, and nothing below `cullBelow`.
 * `bias` multiplies every threshold (above 1 switches down sooner).
 *
 * Returns one distance per shipped level, then the cull distance (`Infinity` when `cullBelow` is 0).
 */
export function lodDistances(
	radius: number,
	fovDeg: number,
	shipped: readonly number[],
	sizes: ModelLodScreenSize,
	bias = 1,
): number[] {
	const k = Math.min(Math.max(Number.isFinite(bias) ? bias : 1, MIN_BIAS), MAX_BIAS);
	const tan = Math.tan(((Math.min(Math.max(fovDeg, 1), 179) / 2) * Math.PI) / 180);
	const at = (size: number) => (size > 0 ? radius / (size * k * tan) : Infinity);
	const threshold = (level: number) =>
		level < 0 ? (sizes.ultra ?? sizes.levels[0] ?? 0) : (sizes.levels[level] ?? 0);
	const out = shipped.map((_, i) => (i === 0 ? 0 : at(threshold(shipped[i - 1]))));
	// Distances must not fall: a hand-edited table whose sizes rise is read as "no switch".
	for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1]);
	const cull = at(sizes.cullBelow);
	out.push(Math.max(cull, out[out.length - 1] ?? 0));
	return out;
}

/** The toon look a material asks for in its glTF `extras.toon` (`docs/conventions/blender-3d-assets.md`). */
export type Toon3d = {
	/** The ramp image's name, when the model ships one. */
	ramp?: string;
	/** Inverted-hull outline width, metres; 0 = none. */
	outline: number;
	outlineColor: [number, number, number];
	/** Rim-light strength 0..1. */
	rim: number;
	rimColor: [number, number, number];
};

export const TOON3D_DEFAULTS: Readonly<Toon3d> = Object.freeze({
	outline: 0,
	outlineColor: [0, 0, 0] as [number, number, number],
	rim: 0,
	rimColor: [1, 1, 1] as [number, number, number],
});

/** The widest outline honoured (metres): past it the hull is a modelling mistake. */
export const MAX_OUTLINE_M = 0.1;

const unit = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);
const color = (v: unknown, fallback: readonly number[]): [number, number, number] => {
	const out = [0, 1, 2].map((i) => unit(Array.isArray(v) ? v[i] : undefined) ?? fallback[i]);
	return [clamp01(out[0]), clamp01(out[1]), clamp01(out[2])];
};

/** A material's `extras` read as the toon look: unknown keys ignored, every value clamped. */
export function toonOf(extras: unknown): Toon3d {
	const raw =
		extras && typeof extras === 'object' ? (extras as { toon?: unknown }).toon : undefined;
	if (!raw || typeof raw !== 'object') return { ...TOON3D_DEFAULTS };
	const t = raw as Record<string, unknown>;
	return {
		...(typeof t.ramp === 'string' && t.ramp ? { ramp: t.ramp } : {}),
		outline: Math.min(Math.max(unit(t.outline) ?? 0, 0), MAX_OUTLINE_M),
		outlineColor: color(t.outline_color, TOON3D_DEFAULTS.outlineColor),
		rim: clamp01(unit(t.rim) ?? 0),
		rimColor: color(t.rim_color, TOON3D_DEFAULTS.rimColor),
	};
}

/** `CH_testhero_LOD2` → `{ base: 'CH_testhero', level: 2 }`; `_LODU` → level -1; else null. */
export function lodNameOf(name: string): { base: string; level: number } | null {
	const m = /^(.*)_LOD(\d+|U)$/.exec(name);
	if (!m) return null;
	return { base: m[1], level: m[2] === 'U' ? -1 : Number(m[2]) };
}

/** Clip libraries are the `anim` models (no mesh): the clip names they bring, by model id. */
export const clipLibraries3d = (index: ModelExportIndex | undefined) =>
	(index?.models ?? []).filter((m) => m.class === 'anim');
