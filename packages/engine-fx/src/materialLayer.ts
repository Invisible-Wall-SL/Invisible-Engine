/**
 * Invisible FX — a layer's MATERIAL as data (Invisible Shader Graph step 8d,
 * `docs/design/shader-graph-particles.md` §8 / §10): the normalizer's rule, the validation that names
 * a material the project does not compile, the mount decision the game makes, the game's cap on
 * material layers and the capacity a layer's buffer is sized to. Pure and PixiJS-free; the renderer
 * itself is `pixi-svelte`'s `ParticleMaterial`.
 */

import type { EmitterConfigV3 } from '@barvynkoa/particle-emitter';
import { isCustomElementFxKind } from 'constants-shared/elementFx';
import { behaviorsOf } from './bindArt';
import type { EffectDoc, EffectParam, EmitterLayer, EmitterMaterial } from './types';

/** The strongest a material plays (design §8): `intensity` is clamped to 0…this. */
export const FX_MATERIAL_INTENSITY_MAX = 4;

/** The most particles a material layer draws (design §10): a layer allowing more draws plain. */
export const FX_MATERIAL_PARTICLE_CAP = 512;

/** The most material layers that draw at once in a game (design §10): the next ones draw plain. */
export const FX_MATERIAL_LAYER_CAP = 8;

/** Param ids a material's `params` never holds: they would write onto a prototype. */
const FORBIDDEN_IDS = new Set(['__proto__', 'prototype', 'constructor']);

/** Whether `id` can name a material param (in `params` and in a `material.param.<id>` path). */
export const isFxMaterialParamId = (id: string): boolean =>
	id.length > 0 && id.length <= 64 && !FORBIDDEN_IDS.has(id);

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** A material's strength, clamped (absent or not finite ⇒ 1). */
export const fxMaterialIntensity = (v: unknown): number =>
	typeof v === 'number' && Number.isFinite(v)
		? Math.min(FX_MATERIAL_INTENSITY_MAX, Math.max(0, v))
		: 1;

/**
 * A material as the normalizer keeps it: a well-formed `custom:<id>` kind, a known time mode, a
 * finite strength clamped to 0…4, and params whose values are numbers, strings or booleans (an
 * empty set is left out). `undefined` for anything without a well-formed kind, so the layer drops
 * it and draws plain.
 */
export function normalizeEmitterMaterial(raw: unknown): EmitterMaterial | undefined {
	if (!isObject(raw) || !isCustomElementFxKind(raw.kind)) return undefined;
	const material: EmitterMaterial = { kind: raw.kind };
	if (raw.time === 'life' || raw.time === 'loop') material.time = raw.time;
	if (typeof raw.intensity === 'number' && Number.isFinite(raw.intensity))
		material.intensity = fxMaterialIntensity(raw.intensity);
	if (isObject(raw.params)) {
		const params: Record<string, number | string | boolean> = {};
		for (const [id, value] of Object.entries(raw.params)) {
			if (!isFxMaterialParamId(id)) continue;
			if (
				(typeof value === 'number' && Number.isFinite(value)) ||
				typeof value === 'string' ||
				typeof value === 'boolean'
			)
				params[id] = value;
		}
		if (Object.keys(params).length) material.params = params;
	}
	return material;
}

export interface EffectMaterialIssue {
	layer: string;
	kind: string;
	code: 'material-not-compiled';
	message: string;
}

/**
 * Every layer whose material names an effect the project does not compile (its graph was deleted or
 * does not compile): those particles will draw plain. `isCompiled` answers for the project's
 * compiled set (`isPlayableElementFxKind` once the set is registered, or a set of kinds).
 */
export function validateEffectMaterials(
	doc: Pick<EffectDoc, 'layers'>,
	isCompiled: (kind: string) => boolean,
): EffectMaterialIssue[] {
	const issues: EffectMaterialIssue[] = [];
	for (const layer of doc.layers) {
		const kind = layer.material?.kind;
		if (!kind || isCompiled(kind)) continue;
		issues.push({
			layer: layer.key,
			kind,
			code: 'material-not-compiled',
			message: `Layer "${layer.key}": its material "${kind}" is not a compiled Shader Graph effect of this project, so its particles draw as plain sprites.`,
		});
	}
	return issues;
}

/** Why a material layer draws plain before its renderer is built. */
export type FxMaterialMountPlain = 'rig particles' | 'not registered' | 'over the game cap';

/** The game-wide count of material layers drawing (design §10's cap of 8). */
export interface FxMaterialSlots {
	readonly cap: number;
	/** Layers holding a slot now. */
	readonly drawing: number;
	/** Take a slot; false when every one is held. */
	claim(): boolean;
	/** Give a slot back. */
	release(): void;
}

export function createFxMaterialSlots(cap = FX_MATERIAL_LAYER_CAP): FxMaterialSlots {
	let drawing = 0;
	return {
		cap,
		get drawing() {
			return drawing;
		},
		claim() {
			if (drawing >= cap) return false;
			drawing++;
			return true;
		},
		release() {
			drawing = Math.max(0, drawing - 1);
		},
	};
}

export type FxMaterialMount = { on: true } | { on: false; plain: FxMaterialMountPlain };

/**
 * Whether a layer with a material mounts its renderer, decided once at mount: never on Tier-C rig
 * particles, never for a kind this runtime has not registered, and only while a game slot is free
 * (the slot is claimed here; the caller releases it when the layer stops drawing through it). A
 * layer refused here keeps its plain sprites for its whole life, so nothing pops.
 */
export function fxMaterialMount(options: {
	rigParticles: boolean;
	registered: boolean;
	slots: FxMaterialSlots;
}): FxMaterialMount {
	if (options.rigParticles) return { on: false, plain: 'rig particles' };
	if (!options.registered) return { on: false, plain: 'not registered' };
	if (!options.slots.claim()) return { on: false, plain: 'over the game cap' };
	return { on: true };
}

/** The library's Max particles for a value that is not a positive whole number (`Emitter.init`). */
export const FX_LIBRARY_MAX_PARTICLES = 1000;

/** What the emitter holds when Max particles is set to `v`: rounded, and 1000 at 0 or below. */
const heldMaxParticles = (v: number): number => {
	const n = Math.round(v);
	return n > 0 ? n : FX_LIBRARY_MAX_PARTICLES;
};

/**
 * The most particles a layer may hold while it plays: its Max particles at mount, raised to the
 * highest value any exposed parameter's `emitter.maxParticles` drive can write across the parameter's
 * range (a mapping is linear, so the range's ends bound it). A written value at or below 0 is the
 * library's 1000, as the applier sets it. A drive that writes its parameter's value as is, on a
 * parameter with no max, has no bound: `Infinity`. The material renderer sizes its buffer to this,
 * and refuses the layer at mount (plain for its whole life) when it is over its cap of 512, so a
 * drive can never turn a drawing layer plain mid-play.
 */
export function fxMaterialPeakParticles(
	layer: Pick<EmitterLayer, 'key' | 'config'>,
	params: readonly EffectParam[] | undefined,
): number {
	const mount = (layer.config as { maxParticles?: unknown }).maxParticles;
	let peak = typeof mount === 'number' && Number.isFinite(mount) ? heldMaxParticles(mount) : 0;
	for (const param of params ?? []) {
		for (const drive of param.drives) {
			if (drive.layer !== layer.key || drive.path !== 'emitter.maxParticles') continue;
			if (typeof drive.from === 'number' && typeof drive.to === 'number') {
				peak = Math.max(peak, heldMaxParticles(drive.from), heldMaxParticles(drive.to));
			} else if (drive.from === undefined && drive.to === undefined && param.kind === 'number') {
				if (typeof param.max !== 'number') return Infinity;
				const lowest = typeof param.min === 'number' ? param.min : -Infinity;
				peak = Math.max(peak, heldMaxParticles(param.max), heldMaxParticles(lowest));
			}
		}
	}
	return peak;
}

/**
 * A material layer's load budget (design §10): graph cost × the pixels its particles cover, overdraw
 * and padding included, in the layer's own pixels. A warning, never a cap: amber from
 * {@link FX_MATERIAL_LOAD_AMBER} of it, red over it.
 */
export const FX_MATERIAL_LAYER_LOAD_BUDGET = 32_000_000;
/** An effect's load budget: its material layers' loads summed. A warning. */
export const FX_MATERIAL_EFFECT_LOAD_BUDGET = 64_000_000;
/** The share of a load budget from which the meter turns amber. */
export const FX_MATERIAL_LOAD_AMBER = 0.75;

export type FxMaterialLoadLevel = 'ok' | 'amber' | 'red';

/** Where `load` sits against `budget`: under 75 %, from 75 %, or over. */
export const fxMaterialLoadLevel = (load: number, budget: number): FxMaterialLoadLevel =>
	load > budget ? 'red' : load >= budget * FX_MATERIAL_LOAD_AMBER ? 'amber' : 'ok';

const finiteNumber = (v: unknown): number | undefined =>
	typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/** The largest scale a config's scale behaviour gives a particle (1 without one). */
function largestScale(config: EmitterConfigV3): number {
	let largest: number | undefined;
	for (const entry of behaviorsOf(config)) {
		const c = entry.config ?? {};
		if (entry.type === 'scale' || entry.type === 'fxScale') {
			const list = (c.scale as { list?: { value?: unknown }[] } | undefined)?.list ?? [];
			for (const step of list) {
				const v = finiteNumber(step?.value);
				if (v !== undefined) largest = Math.max(largest ?? 0, Math.abs(v));
			}
		} else if (entry.type === 'scaleStatic') {
			for (const v of [finiteNumber(c.min), finiteNumber(c.max)])
				if (v !== undefined) largest = Math.max(largest ?? 0, Math.abs(v));
		}
	}
	return largest ?? 1;
}

/**
 * What a material layer will cost before it has played (design §10's estimate): the particles alive
 * at once, `min(Max particles, per wave × the longest life ÷ frequency)`, each its largest frame at
 * its largest scale, grown by the padding on every side as the renderer grows a quad (the padding ×
 * the frame's larger side, on each side), × the graph's cost. In layer pixels, as the measured load
 * is. `frame` is the largest frame's untrimmed size in pixels (the size the renderer pads).
 */
export function fxMaterialLoadEstimate(options: {
	config: EmitterConfigV3;
	frame: { w: number; h: number };
	padding: number;
	cost: number;
}): { live: number; covered: number; load: number } {
	const { config } = options;
	const max = finiteNumber(config.maxParticles);
	const held = max !== undefined && max > 0 ? Math.ceil(max) : FX_LIBRARY_MAX_PARTICLES;
	const perWave = Math.max(1, finiteNumber(config.particlesPerWave) ?? 1);
	const life = Math.max(0, finiteNumber(config.lifetime?.max) ?? 0);
	const frequency = finiteNumber(config.frequency) ?? 0;
	const live =
		frequency > 0
			? Math.min(held, Math.ceil((perWave * life) / frequency))
			: Math.min(held, perWave);
	const scale = largestScale(config);
	const w = Math.max(0, options.frame.w);
	const h = Math.max(0, options.frame.h);
	const room = 2 * Math.max(0, options.padding) * Math.max(w, h);
	const covered = live * (w + room) * (h + room) * scale * scale;
	return { live, covered, load: covered * Math.max(0, options.cost) };
}
