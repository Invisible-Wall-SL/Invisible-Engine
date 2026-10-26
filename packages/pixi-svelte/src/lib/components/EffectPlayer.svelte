<script lang="ts" module>
	import type { EffectDoc, EffectParamValues } from 'engine-fx';

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
		/** With `forceEmit`, stop every layer emitting this many ms after mount — the rig binding's
		 * `duration` override. See `<EffectLayer>`'s `emitFor`. */
		emitFor?: number;
		/** A moving owner for a trail, forwarded to every FREE layer. See `<EffectLayer>`'s `ownerPos`. */
		ownerPos?: () => { x: number; y: number };
		/** The owner's rotation, radians, forwarded to every FREE layer — `<EffectLayer>`'s. */
		ownerRotation?: () => number;
		/** The scope of the component the effect sits in — see `<EffectLayer>`'s `scope`. */
		scope?: string;
		/**
		 * The live values of the effect's exposed parameters (`doc.params`), keyed by id. A GETTER read
		 * on the Pixi ticker, not a reactive prop: a driver may change them every frame, and that must
		 * not run Svelte reactivity through every bound node. A missing value is the parameter's
		 * default, which the stored config already holds — so without this the effect draws its
		 * default look and does no per-frame parameter work.
		 */
		params?: () => EffectParamValues | undefined;
	};
</script>

<script lang="ts">
	/**
	 * Invisible FX runtime player (`invisible-fx.md` §4.4). Renders an authored `EffectDoc` in
	 * a real game: each `EmitterLayer` is mounted by `<EffectLayer>`, which reduces it to a
	 * `<ParticleEmitter key={art.assetKey} config={layer.config}>` — the exact runtime contract
	 * the doc reduces to — wrapped in a `<RigBoneAttach>` when `placement.space === 'bone'`
	 * (the emitter then rides the HOST game's playing rig; the `<EffectPlayer>` must therefore
	 * sit INSIDE that rig's `<RigProvider>` for a `bone` layer to resolve), or a plain offset
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
	import { hasEffectLevelDrives, paramDrivenLayerKeys } from 'engine-fx';
	import EffectLayer from './EffectLayer.svelte';
	import EffectParamGroup from './EffectParamGroup.svelte';

	const props: Props = $props();

	// Exposed parameters: a layer applies them only when it is driven AND values are supplied; the
	// effect-level wrapper mounts only when some drive targets `effect.*` (its defaults have no stored
	// leaf). An effect without parameters renders exactly as before — no wrapper, no ticker work.
	const drivenLayers = $derived(
		props.params ? paramDrivenLayerKeys(props.doc.params) : new Set<string>(),
	);
	const effectLevel = $derived(hasEffectLevelDrives(props.doc.params));
</script>

{#snippet layers(timeScale?: () => number)}
	{#each props.doc.layers as layer (layer.key)}
		<EffectLayer
			{layer}
			emitSpeed={props.emitSpeed}
			forceEmit={props.forceEmit}
			emitFor={props.emitFor}
			ownerPos={props.ownerPos}
			ownerRotation={props.ownerRotation}
			scope={props.scope}
			params={drivenLayers.has(layer.key) ? props.doc.params : undefined}
			paramValues={drivenLayers.has(layer.key) ? props.params : undefined}
			{timeScale}
			effectId={props.doc.id}
		/>
	{/each}
{/snippet}

{#if effectLevel}
	<EffectParamGroup params={props.doc.params} values={props.params} children={layers} />
{:else}
	{@render layers()}
{/if}
