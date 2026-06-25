<script lang="ts" module>
	import type { EmitterLayer } from 'engine-fx';

	export type Props = {
		/** The layer to mount (one emitter of the parent effect). */
		layer: EmitterLayer;
		/** Emit-speed forwarded to the layer's `<ParticleEmitter>`. */
		emitSpeed?: number;
	};
</script>

<script lang="ts">
	/**
	 * Invisible FX — one mounted emitter layer (`invisible-fx.md` §4.4). Splitting the per-layer
	 * mount out of `<EffectPlayer>` gives each layer its OWN reactive `emit` flag + trigger
	 * lifecycle, so an `event`-driven layer can subscribe the event bus and pulse on independently.
	 *
	 * The pure `planLayer` (`engine-fx`) decides the mount shape (free vs bone-wrapped, offset,
	 * spine-particle skip) AND the trigger mode (ambient `always` vs event-bus `event`). This
	 * component maps that plan onto `<Container>` / `<SpineBoneAttach>` / `<ParticleEmitter>` and
	 * — for an `event` layer — subscribes `trigger.eventType` on `utils-event-emitter`'s bus
	 * (the SAME bus a Flow Broadcast fires, §1/§4.4), pulsing `emit` true on each matching event
	 * and back to false after `trigger.duration` ms (or, when no duration is set, leaving the
	 * config's own `emitterLifetime` to govern the burst — we re-arm emit on every event).
	 */
	import { onDestroy } from 'svelte';
	import { planLayer } from 'engine-fx';
	import { getContextEventEmitter, type EmitterEventBase } from 'utils-event-emitter';

	import Container from './Container.svelte';
	import ParticleEmitter from './ParticleEmitter.svelte';
	import SpineBoneAttach from './SpineBoneAttach.svelte';

	const props: Props = $props();
	const plan = $derived(planLayer(props.layer));

	// Live emit flag: ambient layers start emitting; event layers start dormant and the
	// subscription below flips this on when their `eventType` fires.
	let emitting = $state(plan.trigger.emit);

	let stopTimer: ReturnType<typeof setTimeout> | undefined;
	const clearStop = (): void => {
		if (stopTimer !== undefined) {
			clearTimeout(stopTimer);
			stopTimer = undefined;
		}
	};

	// Subscribe an `event`-mode layer to its bus `type`. The bus is reached through the shared
	// event-emitter context (so this engine component never imports a specific game's union); a
	// game that mounts an `<EffectPlayer>` always has a `setContextEventEmitter` in scope. An
	// `event` layer with no `eventType` (or no bus in context) never fires — it stays dormant,
	// the fail-safe analogue of a bone layer with no bone.
	$effect(() => {
		const trigger = plan.trigger;
		if (trigger.mode !== 'event' || !trigger.eventType) {
			emitting = trigger.emit;
			return;
		}

		const ctx = getContextEventEmitter<EmitterEventBase>();
		const eventEmitter = ctx?.eventEmitter;
		if (!eventEmitter) return;

		const eventType = trigger.eventType;
		const duration = trigger.duration;
		const unsubscribe = eventEmitter.subscribe({
			[eventType]: () => {
				emitting = true;
				clearStop();
				if (typeof duration === 'number' && duration >= 0) {
					stopTimer = setTimeout(() => {
						emitting = false;
						stopTimer = undefined;
					}, duration);
				}
			},
		});

		return () => {
			unsubscribe();
			clearStop();
			emitting = false;
		};
	});

	onDestroy(clearStop);
</script>

{#if plan.render}
	{#if plan.mount === 'bone' && plan.bone}
		<SpineBoneAttach boneName={plan.bone} offset={plan.offset}>
			<ParticleEmitter
				key={props.layer.art.assetKey}
				config={props.layer.config}
				animated={props.layer.art.animated ?? false}
				emit={emitting}
				emitSpeed={props.emitSpeed}
			/>
		</SpineBoneAttach>
	{:else}
		<Container x={plan.offset.x} y={plan.offset.y}>
			<ParticleEmitter
				key={props.layer.art.assetKey}
				config={props.layer.config}
				animated={props.layer.art.animated ?? false}
				emit={emitting}
				emitSpeed={props.emitSpeed}
			/>
		</Container>
	{/if}
{/if}
