/**
 * Invisible FX — the PURE per-layer mount plan the runtime `<EffectPlayer>` reduces a doc to
 * (`invisible-fx.md` §4.4). Kept here, free of PixiJS/Svelte, so the exact reduction
 * `EffectPlayer.svelte` renders (which layers mount, free vs bone-wrapped, the offset, emit
 * gating) is unit-coverable headlessly in `tools/fx-spike` — the component just maps these
 * decisions onto `<Container>` / `<SpineBoneAttach>` / `<ParticleEmitter>`.
 */

import type { EffectDoc, EmitterLayer } from './types';

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
	/** Whether the layer emits right now (ambient `always`; `event` is dormant until wired). */
	emit: boolean;
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
 * Whether a layer is emitting right now. Ambient (`always`) — or a layer with no `trigger`
 * (treated as ambient) — emits; an `event`-triggered layer stays dormant until the event-bus
 * subscription lands (a LATER Phase-4 trigger increment binds `trigger.eventType` on
 * `utils-event-emitter`). This is the single seam that increment flips.
 */
export function layerEmits(layer: EmitterLayer): boolean {
	return (layer.trigger?.on ?? 'always') === 'always';
}

/** Resolve one layer's runtime mount decision (pure). */
export function planLayer(layer: EmitterLayer): LayerPlan {
	const offset = layer.placement.offset ?? { x: 0, y: 0 };
	const onBone = layer.placement.space === 'bone' && !!layer.placement.bone;
	return {
		key: layer.key,
		render: isLayerRenderable(layer),
		mount: onBone ? 'bone' : 'free',
		bone: onBone ? layer.placement.bone : undefined,
		offset: { x: offset.x, y: offset.y },
		emit: layerEmits(layer),
	};
}

/** The full mount plan for an effect — one entry per layer, in document order. */
export function planEffect(doc: EffectDoc): LayerPlan[] {
	return doc.layers.map(planLayer);
}
