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
 * It is idempotent: re-normalizing a normalized doc yields an identical doc (the
 * save→reload fixed point the headless round-trip harness asserts).
 */

import {
	EFFECT_DOC_VERSION,
	type EffectDoc,
	type EmitterArt,
	type EmitterLayer,
	type EmitterPlacement,
	type EmitterTrigger,
	type SpineParticleConfig,
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

const normalizeSpineParticle = (raw: unknown): SpineParticleConfig | undefined => {
	if (!isObject(raw)) return undefined;
	const skeletonKey = str(raw.skeletonKey);
	const animation = str(raw.animation);
	if (!skeletonKey || !animation) return undefined;
	const sp: SpineParticleConfig = { skeletonKey, animation };
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
	// this save-time canonicalizer. (A SPINE layer's particle is a pooled `Spine` and legitimately
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
		const spineParticle = normalizeSpineParticle(raw.spineParticle);
		if (spineParticle) layer.spineParticle = spineParticle;
	}
	const trigger = normalizeTrigger(raw.trigger);
	if (trigger) layer.trigger = trigger;
	return layer;
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
	return { version: EFFECT_DOC_VERSION, id, name, layers };
};
