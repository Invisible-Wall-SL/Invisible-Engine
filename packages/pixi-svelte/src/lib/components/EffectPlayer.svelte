<script lang="ts" module>
	import type { EffectDoc, EmitterLayer } from 'engine-fx';

	export type Props = {
		/** The effect to play — its layers each mount a `<ParticleEmitter>`. */
		doc: EffectDoc;
		/**
		 * Emit-speed forwarded to each layer's `<ParticleEmitter>` (the per-frame multiplier on
		 * `emitter.update`). Defaults to the component's own default.
		 */
		emitSpeed?: number;
	};
</script>

<script lang="ts">
	/**
	 * Invisible FX runtime player (`invisible-fx.md` §4.4). Renders an authored `EffectDoc` in
	 * a real game: for each `EmitterLayer` it mounts a `<ParticleEmitter key={art.assetKey}
	 * config={layer.config}>` — the exact runtime contract the doc reduces to — wrapped in a
	 * `<SpineBoneAttach>` when `placement.space === 'bone'` (the emitter then rides the HOST
	 * game's playing rig; the `<EffectPlayer>` must therefore sit INSIDE that rig's
	 * `<SpineProvider>` for a `bone` layer to resolve), or a plain offset `<Container>` for a
	 * `free` layer.
	 *
	 * Art binding is handled inside `<ParticleEmitter>` (it injects the `key` textures into the
	 * V3 config via the shared `engine-fx` `bindArt`), so the player only supplies the doc.
	 *
	 * Triggering: `trigger.on === 'event'` (a Flow Broadcast / `EmitterVocabulary` event) is
	 * DEFERRED to a later Phase-4 increment — the seam is `layerEmits` in `engine-fx`'s
	 * `playerPlan`. For now a layer emits continuously (ambient `on: 'always'`, the only
	 * self-contained case, §4.4).
	 */
	import { planLayer } from 'engine-fx';

	import Container from './Container.svelte';
	import ParticleEmitter from './ParticleEmitter.svelte';
	import SpineBoneAttach from './SpineBoneAttach.svelte';

	const props: Props = $props();

	/** The pure runtime mount plan for a layer (shared with the headless harness). */
	function plan(layer: EmitterLayer) {
		return planLayer(layer);
	}
</script>

{#each props.doc.layers as layer (layer.key)}
	{@const p = plan(layer)}
	{#if p.render}
		{#if p.mount === 'bone' && p.bone}
			<SpineBoneAttach boneName={p.bone} offset={p.offset}>
				<ParticleEmitter
					key={layer.art.assetKey}
					config={layer.config}
					animated={layer.art.animated ?? false}
					emit={p.emit}
					emitSpeed={props.emitSpeed}
				/>
			</SpineBoneAttach>
		{:else}
			<Container x={p.offset.x} y={p.offset.y}>
				<ParticleEmitter
					key={layer.art.assetKey}
					config={layer.config}
					animated={layer.art.animated ?? false}
					emit={p.emit}
					emitSpeed={props.emitSpeed}
				/>
			</Container>
		{/if}
	{/if}
{/each}
