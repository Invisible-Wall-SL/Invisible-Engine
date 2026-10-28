/**
 * Invisible FX — a sprite layer's MATERIAL in `/fx` (Invisible Shader Graph step 8d.5,
 * `docs/design/shader-graph-particles.md` §9 / §10): the edits the Material section makes, the
 * picker's list, the load the meter shows and the notes under it. Pure, like `fxModel.client.ts`:
 * the page wraps these in runes and `tools/fx-spike` (`model`) runs them headlessly.
 *
 * Every edit goes through `normalizeEmitterMaterial`, so what the page holds is byte for byte what
 * Save stores and a reopen reads back.
 */

import {
	CUSTOM_ELEMENT_FX_PREFIX,
	type CustomElementFx,
	type ElementFxParamSpec,
} from 'constants-shared/elementFx';
import type { ParticleMaterialPlain } from 'pixi-svelte/particleMaterial';
import {
	FX_LIBRARY_MAX_PARTICLES,
	FX_MATERIAL_LAYER_CAP,
	FX_MATERIAL_LAYER_LOAD_BUDGET,
	FX_MATERIAL_PARTICLE_CAP,
	canonicalEffectParamPath,
	fxMaterialLoadEstimate,
	fxMaterialLoadLevel,
	fxMaterialPeakParticles,
	normalizeEmitterMaterial,
	type EffectParam,
	type EmitterLayer,
	type EmitterMaterial,
	type EmitterMaterialTime,
	type FxMaterialLoadLevel,
	type FxMaterialMountPlain,
} from 'engine-fx';
import { PARTICLE_COST_BUDGET, PARTICLE_SAMPLE_BUDGET } from 'engine-shadergraph';

/** What `GET /api/shaders/effects` says of a compiled graph beside its effect. */
export interface FxMaterialCost {
	id: string;
	shared: boolean;
	cost: number;
	samples: number;
}

/** A graph of the project's set that does not compile (the route's `skipped`). */
export interface FxMaterialSkip {
	id: string;
	name: string;
	errors: string[];
}

/** The graph id of a `custom:<id>` kind. */
export const materialGraphId = (kind: string): string =>
	kind.startsWith(CUSTOM_ELEMENT_FX_PREFIX) ? kind.slice(CUSTOM_ELEMENT_FX_PREFIX.length) : kind;

/** `material` rebuilt through the normalizer, or the layer without one. */
function withMaterial(layer: EmitterLayer, material: EmitterMaterial | undefined): EmitterLayer {
	const next = { ...layer };
	const kept = material && normalizeEmitterMaterial(material);
	if (kept) next.material = kept;
	else delete next.material;
	return next;
}

/**
 * Pick the layer's material: a compiled effect's `custom:<id>`, or '' for plain sprites. A new kind
 * starts at its own defaults (the old kind's params mean nothing to it); its time and strength stay.
 * A rig-clip layer takes none (the normalizer would drop it on save).
 */
export function setLayerMaterial(layer: EmitterLayer, kind: string): EmitterLayer {
	if (!kind || layer.particleKind !== 'sprite') return withMaterial(layer, undefined);
	const prev = layer.material;
	if (prev?.kind === kind) return layer;
	return withMaterial(layer, {
		kind: kind as EmitterMaterial['kind'],
		...(prev?.time ? { time: prev.time } : {}),
		...(prev?.intensity !== undefined ? { intensity: prev.intensity } : {}),
	});
}

/** Over the particle's life (stored absent) or looped at the effect's length. */
export function setMaterialTime(layer: EmitterLayer, time: EmitterMaterialTime): EmitterLayer {
	const prev = layer.material;
	if (!prev) return layer;
	const next: EmitterMaterial = { ...prev };
	if (time === 'loop') next.time = 'loop';
	else delete next.time;
	return withMaterial(layer, next);
}

/** The material's strength, 0…4; 1 is stored absent, as the defaults writer leaves it. */
export function setMaterialIntensity(layer: EmitterLayer, intensity: number): EmitterLayer {
	const prev = layer.material;
	if (!prev || !Number.isFinite(intensity)) return layer;
	const next: EmitterMaterial = { ...prev, intensity };
	if (intensity === 1) delete next.intensity;
	return withMaterial(layer, next);
}

/** One param's value on the layer's material. */
export function setMaterialParam(
	layer: EmitterLayer,
	id: string,
	value: number | string | boolean,
): EmitterLayer {
	const prev = layer.material;
	if (!prev) return layer;
	return withMaterial(layer, { ...prev, params: { ...prev.params, [id]: value } });
}

/** A param's value on the layer: what it holds, else the effect's default. */
export function materialParamValue(
	layer: EmitterLayer,
	spec: ElementFxParamSpec,
): number | string | boolean {
	const held = layer.material?.params;
	const value = held && Object.hasOwn(held, spec.id) ? held[spec.id] : undefined;
	return value !== undefined && typeof value === typeof spec.default ? value : spec.default;
}

/** One effect in the Material picker. */
export interface FxMaterialChoice {
	kind: string;
	label: string;
	/** Made for particles in Shader Graph (`madeFor`): listed first. */
	particles: boolean;
}

/**
 * The picker's list: the project's compiled effects made for particles first, then the rest, each
 * group by name. Any effect may be a material; the order only says which were made as one.
 */
export function materialChoices(effects: readonly CustomElementFx[]): FxMaterialChoice[] {
	return effects
		.map((e) => ({
			kind: e.spec.kind as string,
			label: e.spec.label || e.spec.kind,
			particles: e.madeFor === 'particles',
		}))
		.sort(
			(a, b) =>
				Number(b.particles) - Number(a.particles) ||
				a.label.localeCompare(b.label) ||
				a.kind.localeCompare(b.kind),
		);
}

/**
 * The layer's largest frame (by area) among the resolved atlas regions it names: the size the
 * preview cuts it at, which is the untrimmed size the renderer pads.
 */
export function largestFrame(
	layer: EmitterLayer,
	regions: readonly { name: string; w: number; h: number }[] | undefined,
): { w: number; h: number } {
	let largest = { w: 0, h: 0 };
	for (const name of layer.art.frames) {
		const r = regions?.find((x) => x.name === name);
		if (r && r.w * r.h > largest.w * largest.h) largest = { w: r.w, h: r.h };
	}
	return largest;
}

/** A layer's load: measured once its material has drawn, else the §10 estimate. */
export interface FxMaterialLoad {
	load: number;
	budget: number;
	level: FxMaterialLoadLevel;
	measured: boolean;
}

export function materialLayerLoad(options: {
	layer: EmitterLayer;
	effect: CustomElementFx | undefined;
	cost: number | undefined;
	frame: { w: number; h: number };
	/** The peak covered pixels the stage measured, or undefined before it has drawn. */
	measuredArea: number | undefined;
}): FxMaterialLoad | undefined {
	const { layer, effect, cost } = options;
	if (!layer.material || !effect || cost === undefined) return undefined;
	const measured = options.measuredArea !== undefined && options.measuredArea > 0;
	const load = measured
		? options.measuredArea! * cost
		: fxMaterialLoadEstimate({
				config: layer.config,
				frame: options.frame,
				padding: effect.padding,
				cost,
			}).load;
	const budget = FX_MATERIAL_LAYER_LOAD_BUDGET;
	return { load, budget, level: fxMaterialLoadLevel(load, budget), measured };
}

/** `12.3 M`, `840 k`, `95`: a load or a pixel count, short. */
export function shortCount(n: number): string {
	if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} M`;
	if (n >= 1e3) return `${Math.round(n / 1e3)} k`;
	return String(Math.round(n));
}

/** Why the stage draws a material layer plain: the renderer's reasons and the mount's. */
export type FxStagePlain = ParticleMaterialPlain | FxMaterialMountPlain;

/**
 * Each plain reason as a note, or `null` where another note already says it (the cap, no frames,
 * a kind not compiled) or the section is not shown (rig clips). Every reason is listed, so a new or
 * renamed one fails the type-check here.
 */
const STAGE_PLAIN_TEXT: Record<FxStagePlain, string | null> = {
	'no effect': null,
	'not registered': null,
	'rig particles': null,
	'over capacity': null,
	'Max particles can be driven over 512': null,
	'Max particles driven with no bound': null,
	'no frames when it mounted': null,
	'frames on several textures':
		"The layer's frames sit on two atlas pages: a material draws one page, so the particles draw plain.",
	'program does not link':
		"This GPU did not compile the material's program, so the particles draw plain.",
	'shell refuses the body':
		"This effect's graph cannot be drawn on particles (the particle shell refuses it), so they draw plain.",
	'over the game cap': `More than ${FX_MATERIAL_LAYER_CAP} material layers draw at once here: this one draws plain, as one more would in a game.`,
	'not WebGL': 'The preview is not on WebGL, so the particles draw plain.',
};

const MATERIAL_PARAM_PATH = 'material.param.';

export type FxMaterialNoteLevel = 'info' | 'warn' | 'off';

export interface FxMaterialNote {
	/** `off`: the particles draw plain; `warn`: over a budget; `info`: worth knowing. */
	level: FxMaterialNoteLevel;
	text: string;
}

/**
 * The exposed parameters driving a `material.param.<id>` of this layer that `effect` has no param
 * for (they were made on another material): kept, as the author's, but they drive nothing. The
 * renderer only writes the uniforms its effect declares, so such a value never reaches the GPU.
 */
export function strayMaterialDrives(
	layer: EmitterLayer,
	params: readonly EffectParam[] | undefined,
	effect: CustomElementFx,
): { param: string; id: string }[] {
	const known = new Set(effect.spec.params.map((p) => p.id));
	const out: { param: string; id: string }[] = [];
	for (const param of params ?? [])
		for (const drive of param.drives) {
			if (drive.layer !== layer.key) continue;
			const path = canonicalEffectParamPath(drive.path);
			if (!path?.startsWith(MATERIAL_PARAM_PATH)) continue;
			const id = path.slice(MATERIAL_PARAM_PATH.length);
			if (!known.has(id)) out.push({ param: param.id, id });
		}
	return out;
}

/** How many of an effect's layers carry a material: past the game cap, some draw plain. */
export const materialLayerCount = (layers: readonly EmitterLayer[]): number =>
	layers.filter((l) => l.material).length;

/**
 * The notes under the Material section, as they apply (§9): the passes and motion particles
 * ignore, a graph or a load over its budget, more material layers in the effect than a game draws
 * at once, Max particles over the cap (or drivable past it, or without a bound), no frames yet,
 * frames on two atlas pages, and a material whose graph was deleted or does not compile
 * (`notCompiled`, from `validateEffectMaterials`; then it is the only note). `stagePlain` is why the
 * preview draws the layer plain, when it does.
 */
export function materialNotes(options: {
	layer: EmitterLayer;
	params: readonly EffectParam[] | undefined;
	/** The effect's layers carrying a material ({@link materialLayerCount}). */
	materialLayers: number;
	effect: CustomElementFx | undefined;
	/** `validateEffectMaterials` named this layer against the registered set. */
	notCompiled: boolean;
	skipped: readonly FxMaterialSkip[];
	cost: FxMaterialCost | undefined;
	load: FxMaterialLoad | undefined;
	stagePlain: FxStagePlain | undefined;
}): FxMaterialNote[] {
	const { layer, effect } = options;
	const kind = layer.material?.kind;
	if (!kind) return [];
	const notes: FxMaterialNote[] = [];
	if (options.notCompiled) {
		const skip = options.skipped.find((s) => s.id === materialGraphId(kind));
		notes.push({
			level: 'off',
			text: skip
				? `"${skip.name}" does not compile, so these particles draw as plain sprites: ${skip.errors[0] ?? 'see it in Shader Graph'}.`
				: `${kind} is not a Shader Graph effect of this project (deleted, or never made), so these particles draw as plain sprites.`,
		});
		return notes;
	}
	if (!effect) return notes;
	const ignored = [
		...(effect.passes.length ? ['its passes'] : []),
		...(effect.motion ? ['its motion'] : []),
		...(effect.break ? ['its break'] : []),
	];
	if (ignored.length)
		notes.push({
			level: 'info',
			text: `${ignored.join(' and ')} do not play on particles: each particle's own behaviours move it.`,
		});
	const cost = options.cost;
	if (cost && (cost.cost > PARTICLE_COST_BUDGET || cost.samples > PARTICLE_SAMPLE_BUDGET))
		notes.push({
			level: 'warn',
			text: `The graph does ${cost.cost} units of work and ${cost.samples} reads a pixel, over the ${PARTICLE_COST_BUDGET} / ${PARTICLE_SAMPLE_BUDGET} a particle material affords on a phone.`,
		});
	if (options.load?.level === 'red')
		notes.push({
			level: 'warn',
			text: `Over its load budget (${shortCount(options.load.load)} of ${shortCount(options.load.budget)}): fewer, smaller or shorter-lived particles, or a lighter graph.`,
		});
	if (options.materialLayers > FX_MATERIAL_LAYER_CAP)
		notes.push({
			level: 'warn',
			text: `This effect has ${options.materialLayers} material layers, and a game draws ${FX_MATERIAL_LAYER_CAP} at once (every effect on screen counted), so at least ${options.materialLayers - FX_MATERIAL_LAYER_CAP} of them draw as plain sprites.`,
		});
	const max = (layer.config as { maxParticles?: unknown }).maxParticles;
	const held = typeof max === 'number' && max > 0 ? Math.ceil(max) : FX_LIBRARY_MAX_PARTICLES;
	const peak = fxMaterialPeakParticles(layer, options.params);
	if (held > FX_MATERIAL_PARTICLE_CAP)
		notes.push({
			level: 'off',
			text: `Max particles is ${held}, over the ${FX_MATERIAL_PARTICLE_CAP} a material layer draws: the material is off and the particles draw as plain sprites.`,
		});
	else if (peak === Infinity)
		notes.push({
			level: 'off',
			text: `A parameter drives Max particles with no upper bound: the material is off. Give the parameter a max of ${FX_MATERIAL_PARTICLE_CAP} or less.`,
		});
	else if (peak > FX_MATERIAL_PARTICLE_CAP)
		notes.push({
			level: 'off',
			text: `A parameter can drive Max particles to ${peak}, past ${FX_MATERIAL_PARTICLE_CAP}: the material is off.`,
		});
	if (layer.art.frames.length === 0)
		notes.push({
			level: 'off',
			text: 'No art yet: the material draws once the layer has frames (a game draws a layer with none as plain).',
		});
	const plainText = options.stagePlain && STAGE_PLAIN_TEXT[options.stagePlain];
	if (plainText) notes.push({ level: 'off', text: plainText });
	for (const { param, id } of strayMaterialDrives(layer, options.params, effect))
		notes.push({
			level: 'warn',
			text: `Parameter "${param}" drives "${id}", which this material doesn't have, so it does nothing here: remove that drive, or pick the material it was made for.`,
		});
	return notes;
}
