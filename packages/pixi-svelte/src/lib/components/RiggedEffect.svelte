<script lang="ts" module>
	import type { EffectDoc } from 'engine-fx';

	export type Props = {
		/** The effect to (re)play on each beat — its layers reduce to `<EffectPlayer>`. */
		doc: EffectDoc;
		/** The rig's OWN spine event name that fires this effect (the rebroadcast `type`). */
		event: string;
		/** Host bone on the rig; absent ⇒ the rig origin. Resolved on the host `<SpineProvider>`. */
		bone?: string;
	};
</script>

<script lang="ts">
	/**
	 * Invisible FX rig-timeline direct binding, runtime half (`invisible-fx.md` "rig-timeline direct
	 * FX binding"). A rig plays a chosen effect on the beat of its OWN animation event: when the rig's
	 * spine event named `event` fires, this (re)plays `doc` from t=0, hosted on `bone` (or the rig
	 * origin when absent).
	 *
	 * Mounts INSIDE the rig's `<SpineProvider>` (via `LayoutNodeView`), so `<SpineBoneAttach>` resolves
	 * the host rig through `getContextSpine()` and rides its live bone. The rig's `rebroadcastEvents`
	 * puts each fired event on the shared `utils-event-emitter` bus as `{ type: event.name, … }` — the
	 * SAME bus `<EffectLayer>` subscribes for a Flow cue; here we subscribe the rig's own event name.
	 *
	 * Firing model (v1): one-shot per beat. Each fire bumps `runId`, and the effect is re-mounted under
	 * `{#key runId}` — a clean burst from t=0 every beat. The `<EffectPlayer forceEmit>` makes every
	 * layer emit on mount regardless of its authored trigger (the keyframe IS the trigger), so a bound
	 * effect plays no matter how it was authored — an `event`-mode layer would otherwise sit dormant
	 * waiting for a cue that never comes. Nothing renders before the first fire (the effect is dormant
	 * until then). No-op when there is no event-emitter context (never crashes).
	 */
	import { getContextEventEmitter, type EmitterEventBase } from 'utils-event-emitter';

	import Container from './Container.svelte';
	import EffectPlayer from './EffectPlayer.svelte';
	import SpineBoneAttach from './SpineBoneAttach.svelte';

	const props: Props = $props();

	// Bumped on every matching beat; drives the `{#key runId}` re-mount = a fresh one-shot from t=0.
	// Stays 0 (and mounts nothing) until the first fire, so no particles appear before the beat.
	let runId = $state(0);

	$effect(() => {
		const event = props.event;
		if (!event) return;

		const ctx = getContextEventEmitter<EmitterEventBase>();
		const eventEmitter = ctx?.eventEmitter;
		if (!eventEmitter) return;

		const unsubscribe = eventEmitter.subscribe({
			[event]: () => {
				runId += 1;
			},
		});
		return unsubscribe;
	});
</script>

{#if runId > 0}
	{#key runId}
		{#if props.bone}
			<SpineBoneAttach boneName={props.bone}>
				<EffectPlayer doc={props.doc} forceEmit />
			</SpineBoneAttach>
		{:else}
			<Container>
				<EffectPlayer doc={props.doc} forceEmit />
			</Container>
		{/if}
	{/key}
{/if}
