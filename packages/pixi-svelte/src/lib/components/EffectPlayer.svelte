<script lang="ts" module>
	import type { EffectDoc } from 'engine-fx';

	export type Props = {
		/** The effect to play — its layers each mount a `<ParticleEmitter>`. */
		doc: EffectDoc;
		/**
		 * Emit-speed forwarded to each layer's `<ParticleEmitter>` (the per-frame multiplier on
		 * `emitter.update`). Defaults to the component's own default.
		 */
		emitSpeed?: number;
		/**
		 * Force every layer to emit from mount, ignoring its authored trigger (rig-timeline DIRECT
		 * binding — `<RiggedEffect>` gates the whole effect on the beat, so it plays regardless of
		 * how each layer was authored). See `<EffectLayer>`'s `forceEmit`.
		 */
		forceEmit?: boolean;
	};
</script>

<script lang="ts">
	/**
	 * Invisible FX runtime player (`invisible-fx.md` §4.4). Renders an authored `EffectDoc` in
	 * a real game: each `EmitterLayer` is mounted by `<EffectLayer>`, which reduces it to a
	 * `<ParticleEmitter key={art.assetKey} config={layer.config}>` — the exact runtime contract
	 * the doc reduces to — wrapped in a `<SpineBoneAttach>` when `placement.space === 'bone'`
	 * (the emitter then rides the HOST game's playing rig; the `<EffectPlayer>` must therefore
	 * sit INSIDE that rig's `<SpineProvider>` for a `bone` layer to resolve), or a plain offset
	 * `<Container>` for a `free` layer.
	 *
	 * Art binding is handled inside `<ParticleEmitter>` (it injects the `key` textures into the
	 * V3 config via the shared `engine-fx` `bindArt`), so the player only supplies the doc.
	 *
	 * Triggering: an `<EffectLayer>` owns its own emit gating. A `trigger.on === 'always'`
	 * (or absent) layer emits continuously (ambient FX); a `trigger.on === 'event'` layer stays
	 * dormant until a game event of its `trigger.eventType` fires on `utils-event-emitter`'s bus
	 * — exactly the `type` a Flow Broadcast emits (§1/§4.4) — then emits for `trigger.duration`
	 * ms (or the config's `emitterLifetime`). The pure `planLayer`/`layerTrigger` seam in
	 * `engine-fx` is the single source of truth for that classification.
	 */
	import EffectLayer from './EffectLayer.svelte';

	const props: Props = $props();
</script>

{#each props.doc.layers as layer (layer.key)}
	<EffectLayer {layer} emitSpeed={props.emitSpeed} forceEmit={props.forceEmit} />
{/each}
