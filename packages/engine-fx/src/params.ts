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
import { ART_BEHAVIOR_TYPES, behaviorsOf, type BehaviorEntry } from './bindArt';
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
 * the doc), and Tier C's `spineParticle`, which owns a `RigView` pool a rebuild would leak. The type
 * string is restated here because `pixi-svelte` (which owns `RIG_PARTICLE_BEHAVIOR_TYPE`) sits above
 * this package.
 */
export const FX_PARAM_UNDRIVABLE_BEHAVIORS: ReadonlySet<string> = new Set([
	...ART_BEHAVIOR_TYPES,
	'spineParticle',
]);

/** A parsed path — what a drive targets. */
export type EffectParamTarget =
	| { scope: 'emitter'; field: FxParamEmitterField }
	| { scope: 'behavior'; type: string; index: number; path: readonly (string | number)[] }
	| { scope: 'placement'; axis: 'x' | 'y' }
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
	layer: Pick<EmitterLayer, 'config' | 'placement'>,
	target: EffectParamTarget,
	config: EmitterConfigV3 = layer.config,
): EffectParamLeafResult {
	switch (target.scope) {
		case 'emitter':
			return { ok: true, kind: 'number', value: emitterFieldOf(config, target.field) };
		case 'placement':
			return { ok: true, kind: 'number', value: layer.placement.offset?.[target.axis] ?? 0 };
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

/** Every drive of `params` aimed at the layer `layerKey` that resolves on `config` and can write. */
function layerDrives(
	params: readonly EffectParam[] | undefined,
	layer: Pick<EmitterLayer, 'key' | 'config' | 'placement'>,
	config: EmitterConfigV3,
): ResolvedDrive[] {
	const out: ResolvedDrive[] = [];
	for (const param of params ?? []) {
		for (const drive of param.drives) {
			if (drive.layer !== layer.key) continue;
			const parsed = parseEffectParamPath(drive.path);
			if (!parsed.ok || !isLayerTarget(parsed.target)) continue;
			const leaf = resolveEffectParamLeaf(layer, parsed.target, config);
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
	if (target.scope === 'behavior') {
		const found = nthBehavior(layer.config, target.type, target.index);
		return found ? readPath(found.entry.config, target.path) : undefined;
	}
	return undefined;
}

/**
 * The stored config IS the effect at its defaults: write every drive's value at its parameter's
 * default into the layers, so a renderer that knows nothing of parameters still draws the default
 * look. Pure (a layer is cloned only when a value actually changes; an unchanged doc comes back as
 * the same object) and idempotent. A drive that does not resolve, or cannot write its leaf, is
 * skipped. Effect-level targets have no stored leaf — a renderer applies their defaults itself.
 * When two drives write one leaf, the later one wins (the same order the applier uses).
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
			const leaf = resolveEffectParamLeaf(layers[at], parsed.target);
			if (!leaf.ok) continue;
			const out = effectParamDriveValue(param, drive, value, leaf.kind);
			if (out === undefined) continue;
			const written =
				parsed.target.scope === 'emitter' ? fieldValue(parsed.target.field, Number(out)) : out;
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
		const leaf = resolveEffectParamLeaf(layer, parsed.target);
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

/** Every drive that does nothing, and why — the editor shows these as warnings. */
export function validateEffectParams(doc: EffectDoc): EffectParamIssue[] {
	const issues: EffectParamIssue[] = [];
	for (const param of doc.params ?? []) {
		for (const drive of param.drives) {
			const message = effectParamDriveIssue(doc, param, drive);
			if (message) issues.push({ param: param.id, drive: drive.id, message });
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
 * drivable behaviour's config values (an `#n` suffix on the second and later behaviour of a type)
 * and the placement offset.
 */
export function listEffectLayerLeaves(
	layer: Pick<EmitterLayer, 'config' | 'placement'>,
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
}

/** The emitter's protected behaviour arrays, read structurally (they are not in its public type). */
interface BehaviorArrays {
	initBehaviors: unknown[];
	updateBehaviors: unknown[];
	recycleBehaviors: unknown[];
}

function behaviorArrays(emitter: FxParamEmitter): BehaviorArrays | undefined {
	const e = emitter as unknown as Partial<BehaviorArrays>;
	return Array.isArray(e.initBehaviors) &&
		Array.isArray(e.updateBehaviors) &&
		Array.isArray(e.recycleBehaviors)
		? (e as BehaviorArrays)
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
		for (const list of [arrays.updateBehaviors, arrays.recycleBehaviors]) {
			const i = list.indexOf(old);
			if (i !== -1) list[i] = fresh;
		}
		return true;
	}
	return false;
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
			// Read by the emitter when emission (re)starts, so a change lands on the next start.
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
			if (emitter.spawnPos.x !== v) emitter.updateSpawnPos(v, emitter.spawnPos.y);
			return;
		case 'pos.y':
			if (emitter.spawnPos.y !== v) emitter.updateSpawnPos(emitter.spawnPos.x, v);
			return;
	}
}

/** A plain-data deep copy of a behaviour config (no textures: art behaviours are never driven). */
const cloneConfig = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * The copy a behaviour is rebuilt from, made safe for the library's value lists. Its
 * `PropertyNode.createList` keeps only the first node of a one-entry list, or of a two-entry list
 * whose values are equal, and a non-stepped list with one node throws on the first update. A drive
 * sweeping one end of a curve through the other's value would hit exactly that, so such a list is
 * rebuilt STEPPED — the same constant, read safely. Only this copy is marked; the stored config and
 * the working copy never are, so the flag is gone again as soon as the ends differ.
 */
function rebuildConfig(working: unknown): unknown {
	const copy = cloneConfig(working);
	const visit = (node: unknown, depth: number): void => {
		if (depth > MAX_LEAF_DEPTH || typeof node !== 'object' || node === null) return;
		if (Array.isArray(node)) {
			for (const child of node) visit(child, depth + 1);
			return;
		}
		const holder = node as Record<string, unknown>;
		const list = holder.list;
		if (Array.isArray(list) && !holder.isStepped) {
			const single =
				list.length === 1 ||
				(list.length === 2 &&
					isObject(list[0]) &&
					isObject(list[1]) &&
					list[0].value === list[1].value);
			if (single) holder.isStepped = true;
		}
		for (const key of Object.keys(holder)) visit(holder[key], depth + 1);
	};
	visit(copy, 0);
	return copy;
}

/** One driven behaviour: its stored config, the working copy values land in, and its state. */
interface BehaviorSlot {
	type: string;
	index: number;
	stored: unknown;
	working: unknown;
	dirty: boolean;
	changed: boolean;
}

export interface EffectParamApplier {
	/**
	 * Apply the current values (absent ⇒ every default). Only a parameter whose value changed since
	 * the last call is mapped; a behaviour is rebuilt at most once per call and only when a leaf in it
	 * changed. Values equal to the defaults on a freshly initialised emitter do nothing.
	 */
	apply(values?: EffectParamValues): void;
	/** Put every driven leaf back to its stored value — call before discarding the applier while the
	 * emitter lives on (the parameter set changed). */
	restore(): void;
}

export interface EffectParamApplierOptions {
	params: readonly EffectParam[] | undefined;
	layer: Pick<EmitterLayer, 'key' | 'config' | 'placement'>;
	/** The config the emitter was initialised from — the BOUND copy (art attached), never the doc. */
	config: EmitterConfigV3;
	emitter: FxParamEmitter;
	/** Moves the layer's offset container. Absent ⇒ `placement.offset` drives are inert. */
	setOffset?: (x: number, y: number) => void;
}

/**
 * Build a layer's applier right after its emitter is created or re-initialised. `undefined` when no
 * drive applies to the layer — the renderer then does no per-frame parameter work at all.
 */
export function createEffectParamApplier(
	options: EffectParamApplierOptions,
): EffectParamApplier | undefined {
	const { params, layer, config, emitter, setOffset } = options;
	const drives = layerDrives(params, layer, config).filter(
		(d) => d.target.scope !== 'placement' || !!setOffset,
	);
	if (drives.length === 0) return undefined;

	const byParam = new Map<EffectParam, ResolvedDrive[]>();
	for (const d of drives) byParam.set(d.param, [...(byParam.get(d.param) ?? []), d]);
	const slots = new Map<string, BehaviorSlot>();
	const slotOf = (target: Extract<EffectParamTarget, { scope: 'behavior' }>): BehaviorSlot => {
		const key = `${target.type}#${target.index}`;
		let slot = slots.get(key);
		if (!slot) {
			const stored = nthBehavior(config, target.type, target.index)?.entry.config;
			slot = {
				type: target.type,
				index: target.index,
				stored,
				working: cloneConfig(stored),
				dirty: false,
				changed: false,
			};
			slots.set(key, slot);
		}
		return slot;
	};
	for (const d of drives) if (d.target.scope === 'behavior') slotOf(d.target);

	const baseOffset = { x: layer.placement.offset?.x ?? 0, y: layer.placement.offset?.y ?? 0 };
	const offset = { ...baseOffset };
	const nextOffset = { ...baseOffset };
	const last = new Map<EffectParam, EffectParamValue>();
	const seedDefaults = (): void => {
		for (const param of byParam.keys()) last.set(param, effectParamValue(param));
	};
	seedDefaults();

	const write = (d: ResolvedDrive, out: EffectParamValue): void => {
		switch (d.target.scope) {
			case 'emitter':
				setEmitterField(emitter, d.target.field, Number(out));
				return;
			case 'placement':
				nextOffset[d.target.axis] = Number(out);
				return;
			case 'behavior': {
				const slot = slotOf(d.target);
				const at = leafHolder(slot.working, d.target.path);
				if (!at || sameValue(at.holder[at.key], out)) return;
				at.holder[at.key] = out;
				slot.dirty = true;
				return;
			}
		}
	};

	const flush = (): void => {
		for (const slot of slots.values()) {
			if (!slot.dirty) continue;
			slot.dirty = false;
			if (swapBehavior(emitter, slot.type, slot.index, rebuildConfig(slot.working))) {
				slot.changed = true;
			}
		}
		if (setOffset && (nextOffset.x !== offset.x || nextOffset.y !== offset.y)) {
			offset.x = nextOffset.x;
			offset.y = nextOffset.y;
			setOffset(offset.x, offset.y);
		}
	};

	return {
		apply(values) {
			for (const [param, list] of byParam) {
				const v = effectParamValue(param, values?.[param.id]);
				if (sameValue(last.get(param), v)) continue;
				last.set(param, v);
				for (const d of list) {
					const out = effectParamDriveValue(param, d.drive, v, d.kind);
					if (out !== undefined) write(d, out);
				}
			}
			flush();
		},
		restore() {
			for (const slot of slots.values()) {
				slot.working = cloneConfig(slot.stored);
				slot.dirty = false;
				if (slot.changed) swapBehavior(emitter, slot.type, slot.index, rebuildConfig(slot.stored));
				slot.changed = false;
			}
			for (const d of drives) {
				if (d.target.scope === 'emitter') {
					setEmitterField(emitter, d.target.field, emitterFieldOf(config, d.target.field));
				}
			}
			nextOffset.x = baseOffset.x;
			nextOffset.y = baseOffset.y;
			flush();
			last.clear();
			seedDefaults();
		},
	};
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
	const byParam = new Map<EffectParam, ResolvedDrive[]>();
	for (const d of drives) byParam.set(d.param, [...(byParam.get(d.param) ?? []), d]);
	const fields: Record<FxParamEffectField, EffectParamValue> = { ...EFFECT_FIELD_IDENTITY };
	const state: EffectLevelState = { alpha: 1, scale: 1, tint: 0xffffff, timeScale: 1 };
	const last = new Map<EffectParam, EffectParamValue>();

	const compute = (values: EffectParamValues | undefined, force: boolean): boolean => {
		let touched = false;
		for (const [param, list] of byParam) {
			const v = effectParamValue(param, values?.[param.id]);
			if (!force && sameValue(last.get(param), v)) continue;
			last.set(param, v);
			for (const d of list) {
				if (d.target.scope !== 'effect') continue;
				const out = effectParamDriveValue(param, d.drive, v, d.kind);
				if (out === undefined) continue;
				fields[d.target.field] = out;
				touched = true;
			}
		}
		if (!touched) return false;
		const next: EffectLevelState = {
			alpha: Math.min(1, Math.max(0, Number(fields.alpha))),
			scale: Number(fields.scale),
			tint: hexColorNumber(String(fields.tint)),
			timeScale: Math.max(0, Number(fields.timeScale)),
		};
		const changed =
			next.alpha !== state.alpha ||
			next.scale !== state.scale ||
			next.tint !== state.tint ||
			next.timeScale !== state.timeScale;
		Object.assign(state, next);
		return changed;
	};
	compute(undefined, true);

	return {
		state,
		apply: (values) => compute(values, false),
	};
}
