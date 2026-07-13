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
	 * Mounts INSIDE the rig's `<SpineProvider>` (via `LayoutNodeView` / `SymbolSpineMain`). Two things
	 * this component OWNS that the generic mount does NOT give for free:
	 *
	 * 1. **Rig-scoped firing (no cross-talk).** We listen DIRECTLY to the host skeleton's own
	 *    `AnimationState` (`getContextSpine().state`), NOT the shared `utils-event-emitter`
	 *    rebroadcast bus. The bus is global and keyed only by the bare event NAME, so a different rig
	 *    firing an event of the same name (e.g. two symbols that both name an event `hit`, or another
	 *    board cell showing the same symbol) would cross-trigger this effect. Listening on this rig's
	 *    own `AnimationState` scopes each fire to THIS rig instance.
	 *
	 * 2. **Rig-transform inheritance (correct size/place, rides the rig's layer).** `SpineProvider`
	 *    scales + positions the SPINE object (contain-fit into the cell), but leaves its child parent
	 *    context pointing at the OUTER container — so a naively-mounted effect renders at the board
	 *    origin at its authored scale (oversized/off-symbol, then clipped by the board mask). We mount
	 *    the effect subtree under `fxParent`, a container parented DIRECTLY on the host spine, so it
	 *    inherits the rig's fit-scale, position and pivot — and rides whatever layer the symbol is on
	 *    (the unmasked "animate" layer during a win). This also makes `<SpineBoneAttach>`'s bone-follow
	 *    correct: its skeleton→local mapping assumes its parent frame IS the spine, which now holds.
	 *
	 * Firing model (v1): one-shot per beat. Each fire bumps `runId`, and the effect is re-mounted under
	 * `{#key runId}` — a clean burst from t=0 every beat. The `<EffectPlayer forceEmit>` makes every
	 * layer emit on mount regardless of its authored trigger (the keyframe IS the trigger), so a bound
	 * effect plays no matter how it was authored — an `event`-mode layer would otherwise sit dormant
	 * waiting for a cue that never comes. Nothing renders before the first fire (the effect is dormant
	 * until then). No-op when there is no host spine in context (never crashes).
	 */
	import * as PIXI from 'pixi.js';
	import * as SPINE_PIXI from '@esotericsoftware/spine-pixi-v8';
	import { onDestroy } from 'svelte';

	import { getContextSpine, createContextParent } from '../context.svelte';
	import EffectPlayer from './EffectPlayer.svelte';
	import SpineBoneAttach from './SpineBoneAttach.svelte';

	const props: Props = $props();
	const spine = getContextSpine();

	// The effect subtree renders under this container, which we parent on the host spine so it
	// inherits the rig's fit-scale/position/pivot (see doc note 2). Re-scope the child parent
	// context to it, so `<EffectPlayer>` / `<SpineBoneAttach>` mount inside it.
	const fxParent = new PIXI.Container();
	spine?.addChild(fxParent);
	createContextParent(fxParent);
	onDestroy(() => {
		if (!fxParent.destroyed) fxParent.destroy();
	});

	// Bumped on every matching beat; drives the `{#key runId}` re-mount = a fresh one-shot from t=0.
	// Stays 0 (and mounts nothing) until the first fire, so no particles appear before the beat.
	let runId = $state(0);

	$effect(() => {
		const event = props.event;
		const state = spine?.state;
		if (!event || !state) return;

		// Fire ONLY on THIS rig's own timeline events (scoped to the host skeleton's AnimationState),
		// not the shared rebroadcast bus — otherwise any other rig firing an event of the same name
		// would cross-trigger this effect.
		const listener: SPINE_PIXI.AnimationStateListener = {
			event: (_entry, ev) => {
				if (ev?.data?.name === event) runId += 1;
			},
		};
		state.addListener(listener);
		return () => state.removeListener(listener);
	});
</script>

{#if runId > 0}
	{#key runId}
		{#if props.bone}
			<SpineBoneAttach boneName={props.bone}>
				<EffectPlayer doc={props.doc} forceEmit />
			</SpineBoneAttach>
		{:else}
			<EffectPlayer doc={props.doc} forceEmit />
		{/if}
	{/key}
{/if}
