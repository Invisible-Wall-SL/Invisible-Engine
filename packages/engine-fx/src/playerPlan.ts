/**
 * Invisible FX — the PURE per-layer mount plan the runtime `<EffectPlayer>` reduces a doc to
 * (`invisible-fx.md` §4.4). Kept here, free of PixiJS/Svelte, so the exact reduction
 * `EffectPlayer.svelte` renders (which layers mount, free vs bone-wrapped, the offset, emit
 * gating) is unit-coverable headlessly in `tools/fx-spike` — the component just maps these
 * decisions onto `<Container>` / `<SpineBoneAttach>` / `<ParticleEmitter>`.
 */

import type { EffectDoc, EmitterLayer } from './types';

/**
 * How a layer decides WHEN it emits (pure classification of `layer.trigger`):
 * - `always` — ambient FX, emits continuously from mount (the only self-contained case).
 * - `event` — emits only while driven by a game event (`trigger.eventType` on the event bus);
 *   `<EffectPlayer>` subscribes the layer to that `type` and pulses the emit flag, stopping
 *   after `duration` ms (or letting the config's `emitterLifetime` govern when omitted).
 */
export type LayerEmitMode = 'always' | 'event';

/** The resolved emit gating for one layer (the seam the runtime trigger stands on). */
export interface LayerEmitPlan {
	/** `always` ⇒ emit from mount; `event` ⇒ dormant until `eventType` fires. */
	mode: LayerEmitMode;
	/** `always` ⇒ true at mount; `event` ⇒ false at mount (the event flips it on). */
	emit: boolean;
	/** The bus `type` an `event` layer subscribes to (`undefined` for `always`, or unset). */
	eventType?: string;
	/** Emit for N ms after the event fires, then stop. `undefined` ⇒ config lifetime governs. */
	duration?: number;
}

/** How a single layer mounts at runtime. */
export interface LayerPlan {
	/** The layer's id (`<ParticleEmitter key>` is `art.assetKey`, distinct from this). */
	key: string;
	/** `false` ⇒ not mounted this increment (Tier C `spine` particles — Phase 3). */
	render: boolean;
	/** `bone` ⇒ wrap in `<SpineBoneAttach boneName=…>`; `free` ⇒ a plain offset `<Container>`. */
	mount: 'free' | 'bone';
	/** The resolved bone name when `mount === 'bone'` (else `undefined`). */
	bone?: string;
	/** Pixel offset applied at the placement origin (scene origin, or the followed bone). */
	offset: { x: number; y: number };
	/** Whether the layer emits right now (ambient `always`; `event` is dormant until fired). */
	emit: boolean;
	/** How this layer is triggered (ambient vs event-bus-driven) — drives the runtime subscription. */
	trigger: LayerEmitPlan;
}

/**
 * Spine-as-particle (Tier C / Phase 3) is not implemented this increment — such a layer is
 * skipped (not mounted) until the pooled `SpineParticle` runtime / flipbook-bake fallback
 * lands. Sprite layers (Tiers A/B) render.
 */
export function isLayerRenderable(layer: EmitterLayer): boolean {
	return layer.particleKind !== 'spine';
}

/**
 * Resolve a layer's emit gating (pure). Ambient (`always`) — or a layer with no `trigger`
 * (treated as ambient) — emits from mount. An `event`-triggered layer is DORMANT at mount
 * (`emit: false`) and carries its `eventType` + `duration` so `<EffectPlayer>` can subscribe
 * it on the event bus (`utils-event-emitter`) and pulse it when a Flow Broadcast / game event
 * of that `type` fires. An `event` layer with no `eventType` can never fire ⇒ it stays
 * dormant (mode `event`, no subscription), the same fail-safe a bone layer with no bone uses.
 */
export function layerTrigger(layer: EmitterLayer): LayerEmitPlan {
	const mode: LayerEmitMode = (layer.trigger?.on ?? 'always') === 'event' ? 'event' : 'always';
	if (mode === 'always') {
		return { mode, emit: true };
	}
	return {
		mode,
		emit: false,
		eventType: layer.trigger?.eventType,
		duration: layer.trigger?.duration,
	};
}

/**
 * Whether a layer is emitting AT MOUNT (ambient `always` ⇒ true; `event` ⇒ false until its
 * `eventType` fires). The runtime drives the live emit flag through {@link layerTrigger}; this
 * preserves the original boolean seam for callers/tests that only need the mount-time state.
 */
export function layerEmits(layer: EmitterLayer): boolean {
	return layerTrigger(layer).emit;
}

/** Resolve one layer's runtime mount decision (pure). */
export function planLayer(layer: EmitterLayer): LayerPlan {
	const offset = layer.placement.offset ?? { x: 0, y: 0 };
	const onBone = layer.placement.space === 'bone' && !!layer.placement.bone;
	const trigger = layerTrigger(layer);
	return {
		key: layer.key,
		render: isLayerRenderable(layer),
		mount: onBone ? 'bone' : 'free',
		bone: onBone ? layer.placement.bone : undefined,
		offset: { x: offset.x, y: offset.y },
		emit: trigger.emit,
		trigger,
	};
}

/** The full mount plan for an effect — one entry per layer, in document order. */
export function planEffect(doc: EffectDoc): LayerPlan[] {
	return doc.layers.map(planLayer);
}
