/**
 * Invisible FX — `EffectDoc` normalization (design doc `invisible-fx.md` §4 / §6).
 *
 * The canonicalizer the `POST /api/fx/save` endpoint and the loader both run, mirroring
 * `engine-flow`'s `normalizeFlowDoc`. It does ONE structural job and one contract job:
 *
 *  1. Strip anything that isn't part of the `EffectDoc` schema — so editor-only state can
 *     never leak in (that belongs in the `.fx.meta.json` sidecar, §4), and a malformed
 *     layer is dropped rather than poisoning the runtime.
 *  2. Keep `layer.config` PURE — the nested `EmitterConfigV3` is passed through VERBATIM
 *     (we deliberately do NOT reshape it), so it round-trips into `@barvynkoa/particle-
 *     emitter` untouched ([[feedback_validate_data_contracts_offline]]).
 *
 * Exposed `params` are kept fail-closed — a malformed parameter or drive is dropped, a drive whose
 * path parses but no longer resolves is KEPT (validation reports it; it is inert at runtime) — and
 * every drive's value at its parameter's default is written into the configs
 * (`applyEffectParamDefaults`), so the stored config is the effect at its defaults. A sprite layer's
 * `material` is kept when well-formed (clamped, `normalizeEmitterMaterial`), dropped otherwise.
 *
 * It is idempotent: re-normalizing a normalized doc yields an identical doc (the
 * save→reload fixed point the headless round-trip harness asserts).
 */

import {
	applyEffectParamDefaults,
	EFFECT_PARAM_KINDS,
	isHexColor,
	isLayerTarget,
	formatEffectParamPath,
	parseEffectParamPath,
} from './params';
import { normalizeEmitterMaterial } from './materialLayer';
import {
	EFFECT_DOC_VERSION,
	type EffectDoc,
	type EffectParam,
	type EffectParamDrive,
	type EffectParamKind,
	type EmitterArt,
	type EmitterLayer,
	type EmitterPlacement,
	type EmitterTrigger,
	type RigParticleConfig,
} from './types';

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

const normalizeArt = (raw: unknown): EmitterArt | undefined => {
	if (!isObject(raw)) return undefined;
	const assetKey = str(raw.assetKey);
	if (!assetKey) return undefined;
	const frames = Array.isArray(raw.frames)
		? raw.frames.filter((f): f is string => typeof f === 'string')
		: [];
	const art: EmitterArt = { assetKey, frames };
	const animated = bool(raw.animated);
	if (animated !== undefined) art.animated = animated;
	// Weights: parallel to `frames`, only meaningful for a >1-frame mix. Kept only when it's a clean
	// array (same length, finite, ≥0, at least one positive) — otherwise dropped so the pick is uniform.
	if (Array.isArray(raw.weights) && raw.weights.length === frames.length && frames.length > 1) {
		const w = raw.weights.map((v) =>
			typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : -1,
		);
		if (w.every((v) => v >= 0) && w.some((v) => v > 0)) art.weights = w;
	}
	// Flipbook playback (`animated` only). A non-positive framerate IS match-life, which is also
	// the default — so it's dropped rather than stored, keeping an untouched doc byte-identical.
	// `loop` follows the same rule the library enforces: meaningless without a real fps.
	const framerate = num(raw.framerate);
	if (art.animated && framerate !== undefined && Number.isFinite(framerate) && framerate > 0) {
		art.framerate = framerate;
		if (bool(raw.loop)) art.loop = true;
	}
	return art;
};

const normalizePlacement = (raw: unknown): EmitterPlacement => {
	const space = isObject(raw) && raw.space === 'bone' ? 'bone' : 'free';
	const placement: EmitterPlacement = { space };
	if (isObject(raw)) {
		const bone = str(raw.bone);
		if (space === 'bone' && bone) placement.bone = bone;
		if (isObject(raw.offset)) {
			const x = num(raw.offset.x);
			const y = num(raw.offset.y);
			if (x !== undefined && y !== undefined) placement.offset = { x, y };
		}
	}
	return placement;
};

const normalizeRigParticle = (raw: unknown): RigParticleConfig | undefined => {
	if (!isObject(raw)) return undefined;
	const skeletonKey = str(raw.skeletonKey);
	const animation = str(raw.animation);
	if (!skeletonKey || !animation) return undefined;
	const sp: RigParticleConfig = { skeletonKey, animation };
	const loop = bool(raw.loop);
	if (loop !== undefined) sp.loop = loop;
	return sp;
};

const normalizeTrigger = (raw: unknown): EmitterTrigger | undefined => {
	if (!isObject(raw)) return undefined;
	const on = raw.on === 'event' ? 'event' : raw.on === 'always' ? 'always' : undefined;
	if (!on) return undefined;
	const trigger: EmitterTrigger = { on };
	const eventType = str(raw.eventType);
	if (on === 'event' && eventType) trigger.eventType = eventType;
	const duration = num(raw.duration);
	if (duration !== undefined) trigger.duration = duration;
	const stopEventType = str(raw.stopEventType);
	if (on === 'event' && stopEventType) trigger.stopEventType = stopEventType;
	const scope = str(raw.scope)?.trim();
	if (on === 'event' && scope) trigger.scope = scope;
	return trigger;
};

const normalizeLayer = (raw: unknown): EmitterLayer | undefined => {
	if (!isObject(raw)) return undefined;
	const key = str(raw.key);
	if (!key) return undefined;
	// `config` is the nested EmitterConfigV3 — kept VERBATIM. We require it to be an object
	// (a missing/garbage config = a broken layer), but we DO NOT reshape its contents.
	if (!isObject(raw.config)) return undefined;

	const particleKind = raw.particleKind === 'spine' ? 'spine' : 'sprite';
	// A layer with no (or unbound) art is NEVER dropped — it keeps an EMPTY `{ assetKey:'', frames:[] }`
	// block. The `/fx` editor explicitly supports authoring a layer before binding art ("No art bound
	// yet — tune the emitter"), so dropping it here would silently destroy the author's work at
	// save→reopen. Empty art is safe at runtime (`bindArt` with 0 textures just renders nothing) and the
	// dangling-`assetKey` case is caught LOUDLY at bake (§8), which is the correct ship-time gate — not
	// this save-time canonicalizer. (A RIG layer's particle is a pooled `RigView` and legitimately
	// carries empty art too.)
	const art = normalizeArt(raw.art) ?? { assetKey: '', frames: [] };

	const layer: EmitterLayer = {
		key,
		config: raw.config as unknown as EmitterLayer['config'],
		art,
		placement: normalizePlacement(raw.placement),
		particleKind,
	};
	if (particleKind === 'spine') {
		const rigParticle = normalizeRigParticle(raw.spineParticle);
		if (rigParticle) layer.spineParticle = rigParticle;
	}
	const trigger = normalizeTrigger(raw.trigger);
	if (trigger) layer.trigger = trigger;
	// A material draws sprites only (§10: none on Tier-C rig particles).
	const material = particleKind === 'sprite' ? normalizeEmitterMaterial(raw.material) : undefined;
	if (material) layer.material = material;
	return layer;
};

/** A drive's `from` / `to`: a finite number or a `#rrggbb` colour (lower-cased). */
const driveEnd = (v: unknown): number | string | undefined | null => {
	if (v === undefined) return undefined;
	if (typeof v === 'number') return Number.isFinite(v) ? v : null;
	return isHexColor(v) ? v.toLowerCase() : null;
};

const normalizeDrive = (raw: unknown, kind: EffectParamKind): EffectParamDrive | undefined => {
	if (!isObject(raw)) return undefined;
	const id = str(raw.id)?.trim();
	const parsed = parseEffectParamPath(str(raw.path) ?? '');
	if (!id || !parsed.ok) return undefined;
	if (raw.layer !== undefined && (typeof raw.layer !== 'string' || raw.layer === ''))
		return undefined;
	const layer = raw.layer as string | undefined;
	if (isLayerTarget(parsed.target) !== (layer !== undefined)) return undefined;
	const from = driveEnd(raw.from);
	const to = driveEnd(raw.to);
	if (from === null || to === null) return undefined;
	// Both or neither, of one type; a colour parameter only ever writes itself.
	if ((from === undefined) !== (to === undefined)) return undefined;
	if (from !== undefined && typeof from !== typeof to) return undefined;
	if (kind === 'color' && from !== undefined) return undefined;
	return {
		id,
		...(layer !== undefined ? { layer } : {}),
		path: formatEffectParamPath(parsed.target),
		...(from !== undefined && to !== undefined ? { from, to } : {}),
	};
};

const normalizeParam = (raw: unknown): EffectParam | undefined => {
	if (!isObject(raw)) return undefined;
	const id = str(raw.id)?.trim();
	const kind = EFFECT_PARAM_KINDS.find((k) => k === raw.kind);
	if (!id || !kind) return undefined;
	let def: EffectParam['default'];
	let min: number | undefined;
	let max: number | undefined;
	if (kind === 'number') {
		const n = num(raw.default);
		if (n === undefined || !Number.isFinite(n)) return undefined;
		min = num(raw.min);
		max = num(raw.max);
		if (min !== undefined && !Number.isFinite(min)) min = undefined;
		if (max !== undefined && !Number.isFinite(max)) max = undefined;
		if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min];
		def = Math.min(max ?? n, Math.max(min ?? n, n));
	} else if (kind === 'bool') {
		const b = bool(raw.default);
		if (b === undefined) return undefined;
		def = b;
	} else {
		if (!isHexColor(raw.default)) return undefined;
		def = raw.default.toLowerCase();
	}
	const drives: EffectParamDrive[] = [];
	const seen = new Set<string>();
	for (const entry of Array.isArray(raw.drives) ? raw.drives : []) {
		const drive = normalizeDrive(entry, kind);
		if (!drive || seen.has(drive.id)) continue;
		seen.add(drive.id);
		drives.push(drive);
	}
	const note = str(raw.note);
	return {
		id,
		kind,
		default: def,
		...(min !== undefined ? { min } : {}),
		...(max !== undefined ? { max } : {}),
		...(note ? { note } : {}),
		drives,
	};
};

/** Exposed parameters, fail-closed. An empty list reads as none, so the key is then omitted. */
const normalizeParams = (raw: unknown): EffectParam[] | undefined => {
	if (!Array.isArray(raw)) return undefined;
	const out: EffectParam[] = [];
	const ids = new Set<string>();
	for (const entry of raw) {
		const param = normalizeParam(entry);
		if (!param || ids.has(param.id)) continue;
		ids.add(param.id);
		out.push(param);
	}
	return out.length ? out : undefined;
};

/**
 * Canonicalize an arbitrary value into a valid `EffectDoc`. An absent/garbage doc yields an
 * empty effect (no layers) under the supplied id/name — the parity-safe fall-through.
 */
export const normalizeEffectDoc = (raw: unknown, fallbackId = 'effect'): EffectDoc => {
	const obj = isObject(raw) ? raw : {};
	const id = str(obj.id) ?? fallbackId;
	const name = str(obj.name) ?? id;
	const layers = Array.isArray(obj.layers)
		? obj.layers.map(normalizeLayer).filter((l): l is EmitterLayer => l !== undefined)
		: [];
	const doc: EffectDoc = { version: EFFECT_DOC_VERSION, id, name, layers };
	const params = normalizeParams(obj.params);
	if (!params) return doc;
	doc.params = params;
	return applyEffectParamDefaults(doc);
};
