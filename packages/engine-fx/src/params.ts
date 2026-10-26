/**
 * Invisible FX — EXPOSED PARAMETERS (`invisible-fx.md` §"Direction (2026-10-15)", Step 1).
 *
 * An `EffectDoc` may carry `params`: named values (`intensity`, `heat`) that each DRIVE one or more
 * leaves of the effect — a behaviour's config value, an emitter field, a layer's offset, or the whole
 * effect's alpha / scale / tint / time scale. This module is the one implementation every surface
 * shares: the path grammar, the value mapping, the defaults-in-config writer the normalizer runs, the
 * validation the editor reports, the leaf listing the editor exposes, and the live APPLIER all four
 * renderers drive.
 *
 * The applier never re-initialises an emitter. `Emitter.init` calls `cleanup()`, which kills every
 * live particle, so a value applies by rebuilding ONLY the behaviour it lives in and putting the new
 * instance in the old one's slot of `initBehaviors` / `updateBehaviors` / `recycleBehaviors`, built
 * with the old instance's own `constructor`. Per-particle state lives on the particle, so particles in
 * flight keep running: update behaviours move them to the new value at once, spawn-time behaviours
 * affect new particles only. Emitter fields are public and set directly, with the same coercion
 * `init` applies so a live value and a config value always render alike.
 *
 * Pure and PixiJS-free like the rest of `engine-fx`: the emitter is passed in as a structural
 * {@link FxParamEmitter} (the library's `Emitter` satisfies it).
 */

import type { EmitterConfigV3 } from '@barvynkoa/particle-emitter';
import {
	ART_BEHAVIOR_TYPES,
	RIG_PARTICLE_BEHAVIOR_TYPE,
	behaviorsOf,
	stepCollapsedValueLists,
	type BehaviorEntry,
} from './bindArt';
import {
	fxMaterialIntensity,
	isFxMaterialParamId,
	normalizeEmitterMaterial,
} from './materialLayer';
import type {
	EffectDoc,
	EffectParam,
	EffectParamDrive,
	EffectParamKind,
	EffectParamValue,
	EmitterLayer,
} from './types';

/** The live values a renderer reads each frame, keyed by parameter id. Absent ⇒ the default. */
export type EffectParamValues = Readonly<Record<string, EffectParamValue>>;

export const EFFECT_PARAM_KINDS: readonly EffectParamKind[] = ['number', 'color', 'bool'];

/** `emitter.<field>` targets, in the design table's (`emitter.*`) naming. */
export const FX_PARAM_EMITTER_FIELDS = [
	'frequency',
	'spawnChance',
	'particlesPerWave',
	'maxParticles',
	'emitterLifetime',
	'lifetime.min',
	'lifetime.max',
	'pos.x',
	'pos.y',
] as const;
export type FxParamEmitterField = (typeof FX_PARAM_EMITTER_FIELDS)[number];

/** `effect.<field>` targets — the wrapper container around the layers. */
export const FX_PARAM_EFFECT_FIELDS = ['alpha', 'scale', 'tint', 'timeScale'] as const;
export type FxParamEffectField = (typeof FX_PARAM_EFFECT_FIELDS)[number];

/**
 * Behaviour types no path may drive: the art behaviours `bindArt` injects (their textures are not in
 * the doc), and Tier C's rig-particle behaviour, which owns a `RigView` pool a rebuild would leak.
 */
export const FX_PARAM_UNDRIVABLE_BEHAVIORS: ReadonlySet<string> = new Set([
	...ART_BEHAVIOR_TYPES,
	RIG_PARTICLE_BEHAVIOR_TYPE,
]);

/** A parsed path — what a drive targets. */
export type EffectParamTarget =
	| { scope: 'emitter'; field: FxParamEmitterField }
	| { scope: 'behavior'; type: string; index: number; path: readonly (string | number)[] }
	| { scope: 'placement'; axis: 'x' | 'y' }
	| { scope: 'material'; field: 'intensity' }
	| { scope: 'material'; field: 'param'; id: string }
	| { scope: 'effect'; field: FxParamEffectField };

export type EffectParamPathResult =
	{ ok: true; target: EffectParamTarget } | { ok: false; error: string };

const HEX = /^#[0-9a-fA-F]{6}$/;
const KEY = /^[A-Za-z_$][\w$-]*$/;
const INDEX = /^(0|[1-9]\d*)$/;
const BEHAVIOR_HEAD = /^([A-Za-z_$][\w$-]*)(?:#(0|[1-9]\d*))?$/;
/** Keys a path may never walk through: they would write onto a prototype, not into the config. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const BEHAVIOR_PREFIX = 'behavior:';
const MATERIAL_PARAM_PREFIX = 'material.param.';

/** A material's own value for a param id (never one `Object.prototype` holds, like `toString`). */
const materialParam = (
	params: Readonly<Record<string, EffectParamValue>> | undefined,
	id: string,
): EffectParamValue | undefined => (params && Object.hasOwn(params, id) ? params[id] : undefined);

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

export const isHexColor = (v: unknown): v is string => typeof v === 'string' && HEX.test(v);

const fail = (error: string): EffectParamPathResult => ({ ok: false, error });

/** Parse a drive path (see the grammar table in the design doc). */
export function parseEffectParamPath(path: string): EffectParamPathResult {
	if (typeof path !== 'string' || path === '') return fail('The path is empty.');
	if (path.startsWith(BEHAVIOR_PREFIX)) {
		const rest = path.slice(BEHAVIOR_PREFIX.length);
		const dot = rest.indexOf('.');
		const head = BEHAVIOR_HEAD.exec(dot > 0 ? rest.slice(0, dot) : rest);
		if (!head || dot <= 0) return fail(`"${path}" needs a behaviour type and a leaf.`);
		const type = head[1];
		if (FX_PARAM_UNDRIVABLE_BEHAVIORS.has(type)) {
			return fail(`The "${type}" behaviour cannot be driven.`);
		}
		const segments: (string | number)[] = [];
		for (const segment of rest.slice(dot + 1).split('.')) {
			if (INDEX.test(segment)) segments.push(Number(segment));
			else if (KEY.test(segment) && !FORBIDDEN_KEYS.has(segment)) segments.push(segment);
			else return fail(`"${segment}" is not a valid step in "${path}".`);
		}
		return {
			ok: true,
			target: { scope: 'behavior', type, index: head[2] ? Number(head[2]) : 0, path: segments },
		};
	}
	if (path.startsWith('emitter.')) {
		const field = path.slice('emitter.'.length);
		return (FX_PARAM_EMITTER_FIELDS as readonly string[]).includes(field)
			? { ok: true, target: { scope: 'emitter', field: field as FxParamEmitterField } }
			: fail(`"${field}" is not an emitter field that can be driven.`);
	}
	if (path === 'placement.offset.x' || path === 'placement.offset.y') {
		return { ok: true, target: { scope: 'placement', axis: path.endsWith('x') ? 'x' : 'y' } };
	}
	if (path === 'material.intensity') {
		return { ok: true, target: { scope: 'material', field: 'intensity' } };
	}
	if (path.startsWith(MATERIAL_PARAM_PREFIX)) {
		const id = path.slice(MATERIAL_PARAM_PREFIX.length);
		return isFxMaterialParamId(id)
			? { ok: true, target: { scope: 'material', field: 'param', id } }
			: fail(`"${id}" is not a material param that can be driven.`);
	}
	if (path.startsWith('effect.')) {
		const field = path.slice('effect.'.length);
		return (FX_PARAM_EFFECT_FIELDS as readonly string[]).includes(field)
			? { ok: true, target: { scope: 'effect', field: field as FxParamEffectField } }
			: fail(`"${field}" is not an effect field that can be driven.`);
	}
	return fail(`"${path}" is not a path an effect parameter can drive.`);
}

/** The canonical spelling of a target (`#0` is written as no index). */
export function formatEffectParamPath(target: EffectParamTarget): string {
	switch (target.scope) {
		case 'emitter':
			return `emitter.${target.field}`;
		case 'placement':
			return `placement.offset.${target.axis}`;
		case 'effect':
			return `effect.${target.field}`;
		case 'material':
			return target.field === 'intensity'
				? 'material.intensity'
				: `${MATERIAL_PARAM_PREFIX}${target.id}`;
		case 'behavior':
			return `${BEHAVIOR_PREFIX}${target.type}${target.index ? `#${target.index}` : ''}.${target.path.join('.')}`;
	}
}

/** `path` in canonical form, or `undefined` when it does not parse. */
export function canonicalEffectParamPath(path: string): string | undefined {
	const parsed = parseEffectParamPath(path);
	return parsed.ok ? formatEffectParamPath(parsed.target) : undefined;
}

/** Whether a target belongs to a layer (it needs `drive.layer`) rather than to the whole effect. */
export const isLayerTarget = (target: EffectParamTarget): boolean => target.scope !== 'effect';

// ---------------------------------------------------------------------------------------------------
// Leaves: reading and writing the scalar a target points at.
// ---------------------------------------------------------------------------------------------------

/** The kind of a scalar leaf, or `undefined` when the value is not one a parameter can write. */
export function effectParamLeafKind(value: unknown): EffectParamKind | undefined {
	if (typeof value === 'number') return Number.isFinite(value) ? 'number' : undefined;
	if (typeof value === 'boolean') return 'bool';
	return isHexColor(value) ? 'color' : undefined;
}

/** The `index`-th behaviour entry of `type` in a config (0-based), with its position in the list. */
function nthBehavior(
	config: EmitterConfigV3,
	type: string,
	index: number,
): { entry: BehaviorEntry; at: number } | undefined {
	const list = behaviorsOf(config);
	let seen = 0;
	for (let at = 0; at < list.length; at++) {
		const entry = list[at];
		if (!entry || entry.type !== type) continue;
		if (seen === index) return isObject(entry.config) ? { entry, at } : undefined;
		seen++;
	}
	return undefined;
}

/** Walk `path` from `root`; the container holding the last step + that step, or `undefined`. */
function leafHolder(
	root: unknown,
	path: readonly (string | number)[],
): { holder: Record<string | number, unknown>; key: string | number } | undefined {
	let node: unknown = root;
	for (let i = 0; i < path.length - 1; i++) {
		if (typeof node !== 'object' || node === null) return undefined;
		const next = (node as Record<string | number, unknown>)[path[i]];
		if (typeof next !== 'object' || next === null) return undefined;
		node = next;
	}
	if (typeof node !== 'object' || node === null || path.length === 0) return undefined;
	const key = path[path.length - 1];
	if (!Object.prototype.hasOwnProperty.call(node, key)) return undefined;
	return { holder: node as Record<string | number, unknown>, key };
}

function readPath(root: unknown, path: readonly (string | number)[]): unknown {
	const at = leafHolder(root, path);
	return at ? at.holder[at.key] : undefined;
}

/** The value an emitter field has with `config`, after `Emitter.init`'s own defaults. */
function emitterFieldOf(config: EmitterConfigV3, field: FxParamEmitterField): number {
	const c = config as unknown as Record<string, unknown>;
	const n = (v: unknown, fallback: number): number =>
		typeof v === 'number' && Number.isFinite(v) ? v : fallback;
	const lifetime = isObject(c.lifetime) ? c.lifetime : {};
	const pos = isObject(c.pos) ? c.pos : {};
	switch (field) {
		case 'frequency':
			return n(c.frequency, 1);
		case 'spawnChance':
			return n(c.spawnChance, 1);
		case 'particlesPerWave':
			return n(c.particlesPerWave, 1);
		case 'maxParticles':
			return n(c.maxParticles, 1000);
		case 'emitterLifetime':
			return n(c.emitterLifetime, -1);
		case 'lifetime.min':
			return n(lifetime.min, 0);
		case 'lifetime.max':
			return n(lifetime.max, 0);
		case 'pos.x':
			return n(pos.x, 0);
		case 'pos.y':
			return n(pos.y, 0);
	}
}

/** Integer-valued emitter fields: a mapped value is rounded before it is written anywhere. */
const INTEGER_FIELDS: ReadonlySet<FxParamEmitterField> = new Set([
	'maxParticles',
	'particlesPerWave',
]);

export type EffectParamLeafResult =
	{ ok: true; kind: EffectParamKind; value: EffectParamValue } | { ok: false; error: string };

/** Resolve a LAYER-scoped target against a layer (its config, or the bound copy a renderer built). */
export function resolveEffectParamLeaf(
	layer: Pick<EmitterLayer, 'config' | 'placement' | 'material'>,
	target: EffectParamTarget,
	config: EmitterConfigV3 = layer.config,
): EffectParamLeafResult {
	switch (target.scope) {
		case 'emitter':
			return { ok: true, kind: 'number', value: emitterFieldOf(config, target.field) };
		case 'placement':
			return { ok: true, kind: 'number', value: layer.placement.offset?.[target.axis] ?? 0 };
		case 'material': {
			const material = layer.material;
			if (!material) return { ok: false, error: 'The layer has no material.' };
			if (target.field === 'intensity') {
				return { ok: true, kind: 'number', value: fxMaterialIntensity(material.intensity) };
			}
			const value = materialParam(material.params, target.id);
			const kind = effectParamLeafKind(value);
			if (!kind) {
				return {
					ok: false,
					error:
						value === undefined
							? `The material holds no value for "${target.id}".`
							: `The material's "${target.id}" is not a number, colour or on/off value.`,
				};
			}
			return { ok: true, kind, value: value as EffectParamValue };
		}
		case 'effect':
			return { ok: false, error: 'An effect-level path does not belong to a layer.' };
		case 'behavior': {
			const found = nthBehavior(config, target.type, target.index);
			if (!found) {
				return {
					ok: false,
					error: `The layer has no "${target.type}" behaviour${target.index ? ` #${target.index}` : ''}.`,
				};
			}
			const value = readPath(found.entry.config, target.path);
			const kind = effectParamLeafKind(value);
			if (!kind) {
				return {
					ok: false,
					error:
						value === undefined
							? `"${target.path.join('.')}" is not in the "${target.type}" behaviour.`
							: `"${target.path.join('.')}" is not a number, colour or on/off value.`,
				};
			}
			return { ok: true, kind, value: value as EffectParamValue };
		}
	}
}

/** The kind of an effect-level target. */
export const effectFieldKind = (field: FxParamEffectField): EffectParamKind =>
	field === 'tint' ? 'color' : 'number';

/** The identity value of an effect-level target (what a renderer draws without a drive). */
const EFFECT_FIELD_IDENTITY: Record<FxParamEffectField, EffectParamValue> = {
	alpha: 1,
	scale: 1,
	tint: '#ffffff',
	timeScale: 1,
};

// ---------------------------------------------------------------------------------------------------
// Mapping.
// ---------------------------------------------------------------------------------------------------

const lower = (hex: string): string => hex.toLowerCase();

function hexChannels(hex: string): [number, number, number] {
	const n = Number.parseInt(hex.slice(1), 16);
	return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** An RGB lerp between two `#rrggbb` colours, `t` ∈ 0..1. */
export function lerpHexColor(from: string, to: string, t: number): string {
	const a = hexChannels(from);
	const b = hexChannels(to);
	const ch = (i: number): string =>
		Math.round(a[i] * (1 - t) + b[i] * t)
			.toString(16)
			.padStart(2, '0');
	return `#${ch(0)}${ch(1)}${ch(2)}`;
}

/** `#rrggbb` → `0xrrggbb`. */
export const hexColorNumber = (hex: string): number => Number.parseInt(hex.slice(1), 16);

/** Clamp a number parameter's value into its range (each bound only when it is set). */
function clampToRange(param: EffectParam, v: number): number {
	let out = v;
	if (typeof param.min === 'number') out = Math.max(param.min, out);
	if (typeof param.max === 'number') out = Math.min(param.max, out);
	return out;
}

/** Where a number value sits in its parameter's range, 0..1. No range is read as 0..1. */
function unitOf(param: EffectParam, v: number): number {
	const lo = typeof param.min === 'number' ? param.min : 0;
	const hi = typeof param.max === 'number' ? param.max : 1;
	if (!(hi > lo)) return 0;
	return Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
}

/**
 * The value a parameter holds for `raw`: `raw` when it is of the parameter's kind (a number clamped
 * to the range, a colour lower-cased), otherwise the default — so a missing or mistyped live value
 * reads as the stored look rather than as nothing.
 */
export function effectParamValue(param: EffectParam, raw?: unknown): EffectParamValue {
	const pick = raw === undefined ? param.default : raw;
	switch (param.kind) {
		case 'number': {
			const n =
				typeof pick === 'number' && Number.isFinite(pick)
					? pick
					: typeof param.default === 'number'
						? param.default
						: 0;
			return clampToRange(param, n);
		}
		case 'bool':
			return typeof pick === 'boolean' ? pick : param.default === true;
		case 'color':
			return isHexColor(pick)
				? lower(pick)
				: isHexColor(param.default)
					? lower(param.default)
					: '#ffffff';
	}
}

/**
 * The value a drive writes on a leaf of kind `leaf` when its parameter holds `value`, or `undefined`
 * when the drive cannot write that leaf (it is then inert).
 *
 * - number → number: linear from the parameter's `[min, max]` to `[from, to]`, clamped; with `from`
 *   and `to` both absent the (clamped) value is written as is.
 * - number → colour: an RGB lerp from `from` to `to`.
 * - bool: `from` when false, `to` when true; with both absent, itself on a bool leaf.
 * - colour: itself on a colour leaf.
 */
export function effectParamDriveValue(
	param: EffectParam,
	drive: Pick<EffectParamDrive, 'from' | 'to'>,
	value: EffectParamValue,
	leaf: EffectParamKind,
): EffectParamValue | undefined {
	const { from, to } = drive;
	const identity = from === undefined && to === undefined;
	switch (param.kind) {
		case 'number': {
			if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
			const v = clampToRange(param, value);
			if (identity) return leaf === 'number' ? v : undefined;
			const t = unitOf(param, v);
			if (leaf === 'number' && typeof from === 'number' && typeof to === 'number') {
				return from * (1 - t) + to * t;
			}
			if (leaf === 'color' && isHexColor(from) && isHexColor(to)) return lerpHexColor(from, to, t);
			return undefined;
		}
		case 'bool': {
			if (typeof value !== 'boolean') return undefined;
			if (identity) return leaf === 'bool' ? value : undefined;
			if (leaf === 'number' && typeof from === 'number' && typeof to === 'number') {
				return value ? to : from;
			}
			if (leaf === 'color' && isHexColor(from) && isHexColor(to)) return lower(value ? to : from);
			return undefined;
		}
		case 'color':
			return identity && leaf === 'color' && isHexColor(value) ? lower(value) : undefined;
	}
}

/** Equal as leaf values (colours compare case-insensitively). */
function sameValue(a: unknown, b: unknown): boolean {
	if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
	return a === b;
}

/** The value an emitter field is written with: integer fields are rounded. */
function fieldValue(field: FxParamEmitterField, v: number): number {
	return INTEGER_FIELDS.has(field) ? Math.round(v) : v;
}

/** The value a layer target is written with: an emitter field coerced, a strength clamped. */
function writtenValue(target: EffectParamTarget, value: EffectParamValue): EffectParamValue {
	if (target.scope === 'emitter') return fieldValue(target.field, Number(value));
	if (target.scope === 'material' && target.field === 'intensity')
		return fxMaterialIntensity(Number(value));
	return value;
}

/**
 * The kind of leaf a drive writes on a layer. A material param the material holds no value for yet
 * (it plays its default, which only the compiled effect knows) takes the kind the drive writes, so
 * the defaults writer can put the first value in.
 */
function driveLeafKind(
	layer: Pick<EmitterLayer, 'config' | 'placement' | 'material'>,
	target: EffectParamTarget,
	param: EffectParam,
	drive: Pick<EffectParamDrive, 'from' | 'to'>,
): EffectParamLeafResult {
	const leaf = resolveEffectParamLeaf(layer, target);
	if (
		leaf.ok ||
		target.scope !== 'material' ||
		target.field !== 'param' ||
		!layer.material ||
		materialParam(layer.material.params, target.id) !== undefined
	)
		return leaf;
	const { from, to } = drive;
	const kind: EffectParamKind | undefined =
		from === undefined && to === undefined
			? param.kind
			: typeof from === 'number'
				? 'number'
				: isHexColor(from)
					? 'color'
					: undefined;
	return kind ? { ok: true, kind, value: effectParamValue(param) } : leaf;
}

// ---------------------------------------------------------------------------------------------------
// Drives that apply.
// ---------------------------------------------------------------------------------------------------

/** A drive whose path parsed, with the leaf kind it writes. */
interface ResolvedDrive {
	param: EffectParam;
	drive: EffectParamDrive;
	target: EffectParamTarget;
	kind: EffectParamKind;
}

/** Every drive of `params` aimed at the layer that resolves on its config and can write. */
function layerDrives(
	params: readonly EffectParam[] | undefined,
	layer: Pick<EmitterLayer, 'key' | 'config' | 'placement' | 'material'>,
): ResolvedDrive[] {
	const out: ResolvedDrive[] = [];
	for (const param of params ?? []) {
		for (const drive of param.drives) {
			if (drive.layer !== layer.key) continue;
			const parsed = parseEffectParamPath(drive.path);
			if (!parsed.ok || !isLayerTarget(parsed.target)) continue;
			const leaf = driveLeafKind(layer, parsed.target, param, drive);
			if (!leaf.ok) continue;
			if (effectParamDriveValue(param, drive, param.default, leaf.kind) === undefined) continue;
			out.push({ param, drive, target: parsed.target, kind: leaf.kind });
		}
	}
	return out;
}

/** Every effect-level drive of `params` that can write its target. */
function effectDrives(params: readonly EffectParam[] | undefined): ResolvedDrive[] {
	const out: ResolvedDrive[] = [];
	for (const param of params ?? []) {
		for (const drive of param.drives) {
			if (drive.layer !== undefined) continue;
			const parsed = parseEffectParamPath(drive.path);
			if (!parsed.ok || parsed.target.scope !== 'effect') continue;
			const kind = effectFieldKind(parsed.target.field);
			if (effectParamDriveValue(param, drive, param.default, kind) === undefined) continue;
			out.push({ param, drive, target: parsed.target, kind });
		}
	}
	return out;
}

/** Whether any parameter drives a layer `layerKey` (the renderer then builds an applier for it). */
export function layerHasParamDrives(
	params: readonly EffectParam[] | undefined,
	layerKey: string,
): boolean {
	return !!params?.some((p) => p.drives.some((d) => d.layer === layerKey));
}

/** The keys of every layer some parameter drives. */
export function paramDrivenLayerKeys(params: readonly EffectParam[] | undefined): Set<string> {
	const keys = new Set<string>();
	for (const p of params ?? []) for (const d of p.drives) if (d.layer) keys.add(d.layer);
	return keys;
}

/** Whether the doc has an effect-level drive — the only case a renderer mounts the wrapper. */
export function hasEffectLevelDrives(params: readonly EffectParam[] | undefined): boolean {
	return effectDrives(params).length > 0;
}

// ---------------------------------------------------------------------------------------------------
// Defaults in the config.
// ---------------------------------------------------------------------------------------------------

/** Write `value` at a layer-scoped target, in place on an already-cloned layer. */
function writeLayerLeaf(
	layer: EmitterLayer,
	target: EffectParamTarget,
	value: EffectParamValue,
): void {
	const config = layer.config as unknown as Record<string, unknown>;
	switch (target.scope) {
		case 'emitter': {
			const v = fieldValue(target.field, Number(value));
			switch (target.field) {
				case 'lifetime.min':
				case 'lifetime.max': {
					const lifetime = isObject(config.lifetime) ? config.lifetime : { min: v, max: v };
					config.lifetime = { ...lifetime, [target.field === 'lifetime.min' ? 'min' : 'max']: v };
					return;
				}
				case 'pos.x':
				case 'pos.y': {
					const pos = isObject(config.pos) ? config.pos : { x: 0, y: 0 };
					config.pos = {
						x: typeof pos.x === 'number' ? pos.x : 0,
						y: typeof pos.y === 'number' ? pos.y : 0,
						[target.field === 'pos.x' ? 'x' : 'y']: v,
					};
					return;
				}
				default:
					config[target.field] = v;
					return;
			}
		}
		case 'placement': {
			const offset = layer.placement.offset ?? { x: 0, y: 0 };
			layer.placement = { ...layer.placement, offset: { ...offset, [target.axis]: Number(value) } };
			return;
		}
		case 'material': {
			const material = layer.material;
			if (!material) return;
			// Rebuilt through the normalizer's rule, so its keys stay in their canonical order.
			layer.material =
				normalizeEmitterMaterial(
					target.field === 'intensity'
						? { ...material, intensity: Number(value) }
						: { ...material, params: { ...material.params, [target.id]: value } },
				) ?? material;
			return;
		}
		case 'behavior': {
			const found = nthBehavior(layer.config, target.type, target.index);
			const at = found ? leafHolder(found.entry.config, target.path) : undefined;
			if (at) at.holder[at.key] = value;
			return;
		}
		case 'effect':
			return;
	}
}

/** The value currently stored at a layer-scoped target, for the write-only-on-change check. */
function storedLayerLeaf(layer: EmitterLayer, target: EffectParamTarget): unknown {
	if (target.scope === 'emitter') {
		const c = layer.config as unknown as Record<string, unknown>;
		const lifetime = isObject(c.lifetime) ? c.lifetime : {};
		const pos = isObject(c.pos) ? c.pos : {};
		switch (target.field) {
			case 'lifetime.min':
				return lifetime.min;
			case 'lifetime.max':
				return lifetime.max;
			case 'pos.x':
				return pos.x;
			case 'pos.y':
				return pos.y;
			default:
				return c[target.field];
		}
	}
	if (target.scope === 'placement') return layer.placement.offset?.[target.axis];
	if (target.scope === 'material') {
		return target.field === 'intensity'
			? fxMaterialIntensity(layer.material?.intensity)
			: materialParam(layer.material?.params, target.id);
	}
	if (target.scope === 'behavior') {
		const found = nthBehavior(layer.config, target.type, target.index);
		return found ? readPath(found.entry.config, target.path) : undefined;
	}
	return undefined;
}

/**
 * The stored config IS the effect at its defaults: write every drive's value at its parameter's
 * default into the layers, so a renderer that knows nothing of parameters still draws the default
 * look; a material's driven strength and params land in `material` the same way, so a renderer with
 * no live values draws the material at its defaults too. Pure (a layer is cloned only when a value
 * actually changes; an unchanged doc comes back as the same object) and idempotent. A drive that
 * does not resolve, or cannot write its leaf, is skipped. Effect-level targets have no stored leaf
 * — a renderer applies their defaults itself. When two drives write one leaf, the later one wins
 * (the same order the applier uses).
 */
export function applyEffectParamDefaults(doc: EffectDoc): EffectDoc {
	if (!doc.params?.length) return doc;
	const layers = doc.layers.slice();
	const cloned = new Set<number>();
	for (const param of doc.params) {
		const value = effectParamValue(param);
		for (const drive of param.drives) {
			if (drive.layer === undefined) continue;
			const at = layers.findIndex((l) => l.key === drive.layer);
			if (at === -1) continue;
			const parsed = parseEffectParamPath(drive.path);
			if (!parsed.ok || !isLayerTarget(parsed.target)) continue;
			const leaf = driveLeafKind(layers[at], parsed.target, param, drive);
			if (!leaf.ok) continue;
			const out = effectParamDriveValue(param, drive, value, leaf.kind);
			if (out === undefined) continue;
			const written = writtenValue(parsed.target, out);
			if (sameValue(storedLayerLeaf(layers[at], parsed.target), written)) continue;
			if (!cloned.has(at)) {
				const source = layers[at];
				layers[at] = {
					...source,
					config: JSON.parse(JSON.stringify(source.config)),
					placement: { ...source.placement },
				};
				cloned.add(at);
			}
			writeLayerLeaf(layers[at], parsed.target, written);
		}
	}
	return cloned.size ? { ...doc, layers } : doc;
}

// ---------------------------------------------------------------------------------------------------
// Validation + the leaf listing (the editor's "All parameters" tree).
// ---------------------------------------------------------------------------------------------------

export interface EffectParamIssue {
	param: string;
	drive?: string;
	/** `unresolved` — the drive does nothing; `param-target-duplicate` — another drive writes the
	 * same value, so whichever parameter changes last wins (the later one listed, at the defaults). */
	code: 'unresolved' | 'param-target-duplicate';
	message: string;
}

/** Why one drive does nothing, or `undefined` when it applies. */
export function effectParamDriveIssue(
	doc: Pick<EffectDoc, 'layers'>,
	param: EffectParam,
	drive: EffectParamDrive,
): string | undefined {
	const parsed = parseEffectParamPath(drive.path);
	if (!parsed.ok) return parsed.error;
	let kind: EffectParamKind;
	if (parsed.target.scope === 'effect') {
		if (drive.layer !== undefined) return 'An effect-level path cannot name a layer.';
		kind = effectFieldKind(parsed.target.field);
	} else {
		if (drive.layer === undefined) return 'This path needs a layer.';
		const layer = doc.layers.find((l) => l.key === drive.layer);
		if (!layer) return `There is no layer "${drive.layer}".`;
		const leaf = driveLeafKind(layer, parsed.target, param, drive);
		if (!leaf.ok) return leaf.error;
		kind = leaf.kind;
	}
	if (effectParamDriveValue(param, drive, param.default, kind) === undefined) {
		return drive.from === undefined && drive.to === undefined
			? `A ${param.kind} parameter cannot write a ${kind} value as is.`
			: `A ${param.kind} parameter cannot map this from → to onto a ${kind} value.`;
	}
	return undefined;
}

/**
 * Every drive that does nothing, and why, plus every drive that shares its value with another — the
 * editor shows these as warnings.
 */
export function validateEffectParams(doc: EffectDoc): EffectParamIssue[] {
	const issues: EffectParamIssue[] = [];
	const byTarget = new Map<string, { param: string; drive: string }[]>();
	for (const param of doc.params ?? []) {
		for (const drive of param.drives) {
			const message = effectParamDriveIssue(doc, param, drive);
			if (message) {
				issues.push({ param: param.id, drive: drive.id, code: 'unresolved', message });
				continue;
			}
			const target = `${drive.layer ?? ''}|${canonicalEffectParamPath(drive.path)}`;
			byTarget.set(target, [...(byTarget.get(target) ?? []), { param: param.id, drive: drive.id }]);
		}
	}
	for (const sharing of byTarget.values()) {
		if (sharing.length < 2) continue;
		for (const at of sharing) {
			const others = sharing
				.filter((o) => o !== at)
				.map((o) => `"${o.param}" (${o.drive})`)
				.join(', ');
			issues.push({
				param: at.param,
				drive: at.drive,
				code: 'param-target-duplicate',
				message: `${others} also drive${sharing.length > 2 ? '' : 's'} this value: whichever parameter changes last wins, and the last one listed sets it at the defaults.`,
			});
		}
	}
	return issues;
}

export interface EffectParamLeaf {
	path: string;
	kind: EffectParamKind;
	value: EffectParamValue;
}

/** How deep the leaf listing walks into a behaviour config (configs are a few levels deep). */
const MAX_LEAF_DEPTH = 8;

function collectLeaves(node: unknown, prefix: string, depth: number, out: EffectParamLeaf[]): void {
	if (depth > MAX_LEAF_DEPTH) return;
	if (Array.isArray(node)) {
		node.forEach((child, i) => visit(child, `${prefix}.${i}`, depth, out));
		return;
	}
	if (!isObject(node) || Object.getPrototypeOf(node) !== Object.prototype) return;
	for (const key of Object.keys(node)) {
		if (!KEY.test(key) && !INDEX.test(key)) continue;
		if (FORBIDDEN_KEYS.has(key)) continue;
		visit(node[key], `${prefix}.${key}`, depth, out);
	}
}

function visit(value: unknown, path: string, depth: number, out: EffectParamLeaf[]): void {
	const kind = effectParamLeafKind(value);
	if (kind) out.push({ path, kind, value: value as EffectParamValue });
	else collectLeaves(value, path, depth + 1, out);
}

/**
 * Every scalar leaf of a layer a parameter can drive, as canonical paths: the emitter fields, each
 * drivable behaviour's config values (an `#n` suffix on the second and later behaviour of a type),
 * the placement offset and, on a layer with a material, its strength and the param values it holds.
 */
export function listEffectLayerLeaves(
	layer: Pick<EmitterLayer, 'config' | 'placement' | 'material'>,
): EffectParamLeaf[] {
	const out: EffectParamLeaf[] = FX_PARAM_EMITTER_FIELDS.map((field) => ({
		path: `emitter.${field}`,
		kind: 'number' as const,
		value: emitterFieldOf(layer.config, field),
	}));
	const seen = new Map<string, number>();
	for (const entry of behaviorsOf(layer.config)) {
		if (!entry || typeof entry.type !== 'string') continue;
		const index = seen.get(entry.type) ?? 0;
		seen.set(entry.type, index + 1);
		if (FX_PARAM_UNDRIVABLE_BEHAVIORS.has(entry.type) || !BEHAVIOR_HEAD.test(entry.type)) continue;
		collectLeaves(
			entry.config,
			`${BEHAVIOR_PREFIX}${entry.type}${index ? `#${index}` : ''}`,
			0,
			out,
		);
	}
	for (const axis of ['x', 'y'] as const) {
		out.push({
			path: `placement.offset.${axis}`,
			kind: 'number',
			value: layer.placement.offset?.[axis] ?? 0,
		});
	}
	const material = layer.material;
	if (material) {
		out.push({
			path: 'material.intensity',
			kind: 'number',
			value: fxMaterialIntensity(material.intensity),
		});
		for (const [id, value] of Object.entries(material.params ?? {})) {
			const kind = effectParamLeafKind(value);
			if (kind && isFxMaterialParamId(id))
				out.push({ path: `${MATERIAL_PARAM_PREFIX}${id}`, kind, value });
		}
	}
	return out;
}

// ---------------------------------------------------------------------------------------------------
// The live applier.
// ---------------------------------------------------------------------------------------------------

/** The part of the library's `Emitter` the applier writes. The real `Emitter` satisfies it. */
export interface FxParamEmitter {
	frequency: number;
	spawnChance: number;
	particlesPerWave: number;
	maxParticles: number;
	minLifetime: number;
	maxLifetime: number;
	emitterLifetime: number;
	spawnPos: { x: number; y: number };
	updateSpawnPos(x: number, y: number): void;
	/** Whether it is emitting; setting it true restarts the emission countdown. */
	emit: boolean;
}

/** The emitter's protected state, read structurally (it is not in its public type). */
interface EmitterGuts {
	initBehaviors: unknown[];
	updateBehaviors: unknown[];
	recycleBehaviors: unknown[];
	rotation?: unknown;
}

function behaviorArrays(emitter: FxParamEmitter): EmitterGuts | undefined {
	const e = emitter as unknown as Partial<EmitterGuts>;
	return Array.isArray(e.initBehaviors) &&
		Array.isArray(e.updateBehaviors) &&
		Array.isArray(e.recycleBehaviors)
		? (e as EmitterGuts)
		: undefined;
}

type BehaviorClass = (new (config: unknown) => object) & { type?: unknown };

/**
 * Rebuild the `index`-th live instance of `type` from `config` and put it in the old one's place in
 * all three arrays. `init` builds one instance per known entry and sorts them stably by a per-class
 * `order`, so the n-th instance of a class in `initBehaviors` IS the n-th config entry of its type.
 */
function swapBehavior(
	emitter: FxParamEmitter,
	type: string,
	index: number,
	config: unknown,
): boolean {
	const arrays = behaviorArrays(emitter);
	if (!arrays) return false;
	let seen = 0;
	for (let at = 0; at < arrays.initBehaviors.length; at++) {
		const old = arrays.initBehaviors[at];
		if (typeof old !== 'object' || old === null) continue;
		const ctor = old.constructor as BehaviorClass;
		if (ctor.type !== type) continue;
		if (seen++ !== index) continue;
		const fresh = new ctor(config);
		arrays.initBehaviors[at] = fresh;
		let i = arrays.updateBehaviors.indexOf(old);
		if (i !== -1) arrays.updateBehaviors[i] = fresh;
		i = arrays.recycleBehaviors.indexOf(old);
		if (i !== -1) arrays.recycleBehaviors[i] = fresh;
		return true;
	}
	return false;
}

/** Equal up to float noise — a rotated spawn position round-trips through sin / cos. */
const closeTo = (a: number, b: number): boolean =>
	Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * Set one axis of the spawn position. `init` copies `config.pos` into `spawnPos` at rotation 0, and
 * `Emitter.rotate` then turns `spawnPos` in place, so the axis is set in config space and turned back
 * by the emitter's rotation. A value the emitter already holds writes nothing.
 */
function setSpawnAxis(emitter: FxParamEmitter, axis: 'x' | 'y', v: number): void {
	const rotation = Number((emitter as unknown as EmitterGuts).rotation) || 0;
	const c = Math.cos(rotation);
	const s = Math.sin(rotation);
	const p = emitter.spawnPos;
	let x = p.x * c + p.y * s;
	let y = p.y * c - p.x * s;
	if (axis === 'x') x = v;
	else y = v;
	const nx = x * c - y * s;
	const ny = x * s + y * c;
	if (!closeTo(nx, p.x) || !closeTo(ny, p.y)) emitter.updateSpawnPos(nx, ny);
}

/** Set an emitter field live, with the coercion `Emitter.init` applies to the same config value. */
function setEmitterField(emitter: FxParamEmitter, field: FxParamEmitterField, raw: number): void {
	const v = fieldValue(field, raw);
	switch (field) {
		case 'frequency':
			if (emitter.frequency !== v) emitter.frequency = v;
			return;
		case 'spawnChance': {
			const next = v > 0 ? v : 1;
			if (emitter.spawnChance !== next) emitter.spawnChance = next;
			return;
		}
		case 'particlesPerWave': {
			const next = v > 1 ? v : 1;
			if (emitter.particlesPerWave !== next) emitter.particlesPerWave = next;
			return;
		}
		case 'maxParticles': {
			const next = v > 0 ? v : 1000;
			if (emitter.maxParticles !== next) emitter.maxParticles = next;
			return;
		}
		case 'emitterLifetime': {
			// Latched into the emission countdown when emission (re)starts — see `bindEffectParams`.
			const next = v || -1;
			if (emitter.emitterLifetime !== next) emitter.emitterLifetime = next;
			return;
		}
		case 'lifetime.min':
			if (emitter.minLifetime !== v) emitter.minLifetime = v;
			return;
		case 'lifetime.max':
			if (emitter.maxLifetime !== v) emitter.maxLifetime = v;
			return;
		case 'pos.x':
			setSpawnAxis(emitter, 'x', v);
			return;
		case 'pos.y':
			setSpawnAxis(emitter, 'y', v);
			return;
	}
}

/** A plain-data deep copy of a behaviour config (no textures: art behaviours are never driven). */
const cloneConfig = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * One driven behaviour: its stored config (the layer's own, never the bound copy, whose value lists
 * may carry a render-time `isStepped` that must not outlive the values that needed it), the working
 * copy values land in, and its state.
 */
interface BehaviorSlot {
	type: string;
	index: number;
	stored: unknown;
	working: unknown;
	dirty: boolean;
	changed: boolean;
}

/** A layer drive with where it lands: its behaviour slot, or the emitter field's stored value. */
interface LayerDrive extends ResolvedDrive {
	slot?: BehaviorSlot;
	stored?: number;
}

/** One driving parameter and the value it last wrote — kept in plain arrays, read every frame. */
interface ParamGroup<D> {
	param: EffectParam;
	drives: D[];
	last: EffectParamValue;
}

function groupByParam<D extends ResolvedDrive>(drives: D[]): ParamGroup<D>[] {
	const groups: ParamGroup<D>[] = [];
	for (const d of drives) {
		let group = groups.find((g) => g.param === d.param);
		if (!group) {
			group = { param: d.param, drives: [], last: effectParamValue(d.param) };
			groups.push(group);
		}
		group.drives.push(d);
	}
	return groups;
}

export interface EffectParamApplier {
	/**
	 * Apply the current values (absent ⇒ every default). Only a parameter whose value changed since
	 * the last call is mapped; a behaviour is rebuilt at most once per call and only when a leaf in it
	 * changed. Values equal to the defaults on a freshly initialised emitter do nothing.
	 */
	apply(values?: EffectParamValues): void;
	/** Put every driven leaf back to its stored value — call before discarding the applier while the
	 * emitter lives on (the parameter set changed). At the defaults it writes nothing. */
	restore(): void;
}

/**
 * Where a layer's `material.*` drives land: the material renderer's uniforms (`ParticleMaterial`'s
 * `setIntensity` / `setParams`). A write is a uniform write, never a rebuild.
 */
export interface FxParamMaterial {
	setIntensity(intensity: number): void;
	/** Every param value the material holds (those left out play their defaults). */
	setParams(values: Readonly<Record<string, EffectParamValue>>): void;
}

export interface EffectParamApplierOptions {
	params: readonly EffectParam[] | undefined;
	/** The layer the emitter was initialised from (its `config`, bound by the renderer). Read, never
	 * written: values land on the applier's own copies. */
	layer: Pick<EmitterLayer, 'key' | 'config' | 'placement' | 'material'>;
	emitter: FxParamEmitter;
	/** Moves the layer's offset container. Absent ⇒ `placement.offset` drives are inert. */
	setOffset?: (x: number, y: number) => void;
	/** The layer's material renderer. Absent (no material, or it draws plain) ⇒ `material.*` drives
	 * are inert. */
	material?: FxParamMaterial;
}

/**
 * Build a layer's applier right after its emitter is created or re-initialised. `undefined` when no
 * drive applies to the layer — the renderer then does no per-frame parameter work at all.
 */
export function createEffectParamApplier(
	options: EffectParamApplierOptions,
): EffectParamApplier | undefined {
	const { params, layer, emitter, setOffset, material } = options;
	const config = layer.config;
	const resolved = layerDrives(params, layer).filter(
		(d) =>
			(d.target.scope !== 'placement' || !!setOffset) &&
			(d.target.scope !== 'material' || !!material),
	);
	if (resolved.length === 0) return undefined;

	const slots: BehaviorSlot[] = [];
	const drives: LayerDrive[] = resolved.map((d) => {
		const target = d.target;
		if (target.scope === 'emitter') return { ...d, stored: emitterFieldOf(config, target.field) };
		if (target.scope !== 'behavior') return d;
		let slot = slots.find((s) => s.type === target.type && s.index === target.index);
		if (!slot) {
			const stored = cloneConfig(nthBehavior(config, target.type, target.index)?.entry.config);
			slot = {
				type: target.type,
				index: target.index,
				stored,
				working: cloneConfig(stored),
				dirty: false,
				changed: false,
			};
			slots.push(slot);
		}
		return { ...d, slot };
	});
	const groups = groupByParam(drives);

	const baseOffset = { x: layer.placement.offset?.x ?? 0, y: layer.placement.offset?.y ?? 0 };
	const offset = { ...baseOffset };
	const nextOffset = { ...baseOffset };

	const baseIntensity = fxMaterialIntensity(layer.material?.intensity);
	const baseParams: Record<string, EffectParamValue> = { ...layer.material?.params };
	let intensity = baseIntensity;
	let materialParams = { ...baseParams };
	let intensityDirty = false;
	let paramsDirty = false;

	const write = (d: LayerDrive, out: EffectParamValue): void => {
		const target = d.target;
		if (target.scope === 'emitter') setEmitterField(emitter, target.field, Number(out));
		else if (target.scope === 'placement') nextOffset[target.axis] = Number(out);
		else if (target.scope === 'material') {
			if (target.field === 'intensity') {
				const next = fxMaterialIntensity(Number(out));
				if (next === intensity) return;
				intensity = next;
				intensityDirty = true;
			} else {
				if (sameValue(materialParam(materialParams, target.id), out)) return;
				materialParams[target.id] = out;
				paramsDirty = true;
			}
		} else if (target.scope === 'behavior' && d.slot) {
			const at = leafHolder(d.slot.working, target.path);
			if (!at || sameValue(at.holder[at.key], out)) return;
			at.holder[at.key] = out;
			d.slot.dirty = true;
		}
	};

	const flush = (): void => {
		for (let i = 0; i < slots.length; i++) {
			const slot = slots[i];
			if (!slot.dirty) continue;
			slot.dirty = false;
			const built = stepCollapsedValueLists(cloneConfig(slot.working));
			if (swapBehavior(emitter, slot.type, slot.index, built)) slot.changed = true;
		}
		if (setOffset && (nextOffset.x !== offset.x || nextOffset.y !== offset.y)) {
			offset.x = nextOffset.x;
			offset.y = nextOffset.y;
			setOffset(offset.x, offset.y);
		}
		if (intensityDirty) {
			intensityDirty = false;
			material?.setIntensity(intensity);
		}
		if (paramsDirty) {
			paramsDirty = false;
			material?.setParams(materialParams);
		}
	};

	return {
		apply(values) {
			for (let g = 0; g < groups.length; g++) {
				const group = groups[g];
				const v = effectParamValue(group.param, values?.[group.param.id]);
				if (sameValue(group.last, v)) continue;
				group.last = v;
				for (let i = 0; i < group.drives.length; i++) {
					const d = group.drives[i];
					const out = effectParamDriveValue(group.param, d.drive, v, d.kind);
					if (out !== undefined) write(d, out);
				}
			}
			flush();
		},
		restore() {
			for (const slot of slots) {
				slot.working = cloneConfig(slot.stored);
				slot.dirty = false;
				if (slot.changed) {
					swapBehavior(
						emitter,
						slot.type,
						slot.index,
						stepCollapsedValueLists(cloneConfig(slot.stored)),
					);
				}
				slot.changed = false;
			}
			for (const d of drives) {
				if (d.target.scope === 'emitter' && d.stored !== undefined) {
					setEmitterField(emitter, d.target.field, d.stored);
				}
			}
			nextOffset.x = baseOffset.x;
			nextOffset.y = baseOffset.y;
			intensityDirty = intensity !== baseIntensity;
			intensity = baseIntensity;
			paramsDirty = Object.keys({ ...baseParams, ...materialParams }).some(
				(id) => !sameValue(baseParams[id], materialParams[id]),
			);
			materialParams = { ...baseParams };
			flush();
			for (const group of groups) group.last = effectParamValue(group.param);
		},
	};
}

export interface BindEffectParamsOptions extends EffectParamApplierOptions {
	/** The current values (absent ⇒ the defaults). */
	values?: EffectParamValues;
}

/**
 * What a renderer calls right after it creates or re-initialises an emitter: build the layer's
 * applier and give it the current values. Setting `emit` latches the config's `emitterLifetime` into
 * the emission countdown, before any drive could write it — so when a drive changed it, the
 * countdown is restarted from the driven value, and the burst lasts what the parameter says.
 */
export function bindEffectParams(options: BindEffectParamsOptions): EffectParamApplier | undefined {
	const applier = createEffectParamApplier(options);
	if (!applier) return undefined;
	const { emitter } = options;
	const lifetime = emitter.emitterLifetime;
	applier.apply(options.values);
	if (emitter.emit && emitter.emitterLifetime !== lifetime) emitter.emit = true;
	return applier;
}

/** What the effect-level wrapper draws: alpha, scale, a `0xrrggbb` tint and the emit time scale. */
export interface EffectLevelState {
	alpha: number;
	scale: number;
	tint: number;
	timeScale: number;
}

export interface EffectLevelApplier {
	/** The current state; already holds the defaults when the applier is created. */
	readonly state: Readonly<EffectLevelState>;
	/** Map the values onto the state. True when the state changed (the renderer then writes it). */
	apply(values?: EffectParamValues): boolean;
}

/**
 * The effect-level applier, or `undefined` when the doc has no effect-level drive (then no wrapper is
 * mounted). These targets have no stored leaf, so a renderer applies `state` at mount even with no
 * live values. Alpha is clamped to 0..1 and the time scale to ≥ 0.
 */
export function createEffectLevelApplier(
	params: readonly EffectParam[] | undefined,
): EffectLevelApplier | undefined {
	const drives = effectDrives(params);
	if (drives.length === 0) return undefined;
	const groups = groupByParam(drives);
	const fields: Record<FxParamEffectField, EffectParamValue> = { ...EFFECT_FIELD_IDENTITY };
	const state: EffectLevelState = { alpha: 1, scale: 1, tint: 0xffffff, timeScale: 1 };

	const compute = (values: EffectParamValues | undefined, force: boolean): boolean => {
		let touched = false;
		for (let g = 0; g < groups.length; g++) {
			const group = groups[g];
			const v = effectParamValue(group.param, values?.[group.param.id]);
			if (!force && sameValue(group.last, v)) continue;
			group.last = v;
			for (let i = 0; i < group.drives.length; i++) {
				const d = group.drives[i];
				if (d.target.scope !== 'effect') continue;
				const out = effectParamDriveValue(group.param, d.drive, v, d.kind);
				if (out === undefined) continue;
				fields[d.target.field] = out;
				touched = true;
			}
		}
		if (!touched) return false;
		const alpha = Math.min(1, Math.max(0, Number(fields.alpha)));
		const scale = Number(fields.scale);
		const tint = hexColorNumber(String(fields.tint));
		const timeScale = Math.max(0, Number(fields.timeScale));
		const changed =
			alpha !== state.alpha ||
			scale !== state.scale ||
			tint !== state.tint ||
			timeScale !== state.timeScale;
		state.alpha = alpha;
		state.scale = scale;
		state.tint = tint;
		state.timeScale = timeScale;
		return changed;
	};
	compute(undefined, true);

	return {
		state,
		apply: (values) => compute(values, false),
	};
}
