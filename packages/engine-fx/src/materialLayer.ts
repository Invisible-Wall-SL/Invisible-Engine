/**
 * Invisible FX — a layer's MATERIAL as data (Invisible Shader Graph step 8d,
 * `docs/design/shader-graph-particles.md` §8 / §10): the normalizer's rule, the validation that names
 * a material the project does not compile, the mount decision the game makes, the game's cap on
 * material layers and the capacity a layer's buffer is sized to. Pure and PixiJS-free; the renderer
 * itself is `pixi-svelte`'s `ParticleMaterial`.
 */

import { isCustomElementFxKind } from 'constants-shared/elementFx';
import type { EffectDoc, EffectParam, EmitterLayer, EmitterMaterial } from './types';

/** The strongest a material plays (design §8): `intensity` is clamped to 0…this. */
export const FX_MATERIAL_INTENSITY_MAX = 4;

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

/**
 * The most particles a layer may hold while it plays: its Max particles at mount, raised to the
 * highest value any exposed parameter's `emitter.maxParticles` drive can write across the parameter's
 * range (a number's mapping is linear, so its ends bound it). A drive on a parameter with no max
 * that writes its value as is has no bound and is not counted: driven above the mount value, that
 * layer turns plain. The material renderer sizes its buffer to this (capped at its 512).
 */
export function fxMaterialPeakParticles(
	layer: Pick<EmitterLayer, 'key' | 'config'>,
	params: readonly EffectParam[] | undefined,
): number {
	const mount = (layer.config as { maxParticles?: unknown }).maxParticles;
	let peak = typeof mount === 'number' && Number.isFinite(mount) ? mount : 0;
	for (const param of params ?? []) {
		for (const drive of param.drives) {
			if (drive.layer !== layer.key || drive.path !== 'emitter.maxParticles') continue;
			if (typeof drive.from === 'number' && typeof drive.to === 'number') {
				peak = Math.max(peak, drive.from, drive.to);
			} else if (drive.from === undefined && drive.to === undefined && param.kind === 'number') {
				if (typeof param.max === 'number') peak = Math.max(peak, param.max);
			}
		}
	}
	return Math.round(peak);
}
