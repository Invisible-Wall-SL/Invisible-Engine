<script lang="ts" module>
	import type { EffectDoc } from 'engine-fx';

	export type Props = {
		/** The effect to (re)play on each beat — its layers reduce to `<EffectPlayer>`. */
		doc: EffectDoc;
		/** The rig's OWN spine event name that fires this effect (the rebroadcast `type`). */
		event: string;
		/** Host bone on the rig; absent ⇒ the rig origin. Resolved on the host `<SpineProvider>`. */
		bone?: string;
		/**
		 * Draw the burst at THIS slot's depth in the skeleton draw order (spine-pixi `addSlotObject`),
		 * instead of on top of the whole rig. An unknown slot name falls back to on-top.
		 *
		 * With no `bone`, the slot's own bone hosts the burst (a slot is a bone plus a depth). With a
		 * `bone`, the bone still decides position — `<SpineBoneAttach>` maps through the REAL parent's
		 * world transform, so it stays correct whatever we parented under.
		 *
		 * NOT named `slot`: Svelte still reads a `slot` attribute on a component as the legacy slot
		 * assignment, which must be a static string — so `slot={binding.slot}` would not compile.
		 */
		drawSlot?: string;
		/** Opacity multiplier, 0–1. */
		alpha?: number;
		/** Size multiplier on the whole burst. */
		scale?: number;
		/** Milliseconds to wait after the beat before the burst starts. */
		delay?: number;
		/** Milliseconds of emission, then stop (particles live out their own lifetime). */
		duration?: number;
		/** Time-scale multiplier on the emitters. */
		speed?: number;
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
	// inherits the rig's fit-scale/position/pivot (see doc note 2).
	const fxParent = new PIXI.Container();
	// A SLOT binding hands `fxParent` to spine instead, which then drives it at that slot's place in
	// the draw order. Guarded, because `addSlotObject` THROWS on an unknown slot name (`getSlotFromRef`)
	// and a rig re-synced with that slot renamed away must degrade to the old on-top mount, not crash
	// the game. `followAttachmentTimeline` is deliberately left off: the burst is not the slot's art
	// and must still play on a frame where the slot shows nothing.
	const slot =
		props.drawSlot && spine?.skeleton?.findSlot(props.drawSlot) ? props.drawSlot : undefined;
	if (spine && slot) spine.addSlotObject(slot, fxParent);
	else spine?.addChild(fxParent);

	// `alpha`/`scale` live on a SECOND container, not on `fxParent`, because a slotted `fxParent` is
	// not ours any more: spine's `updateSlotObject` rewrites its position, rotation, scale AND alpha
	// every frame from the slot's bone and colour. Nesting keeps one code shape for both mounts, and
	// on a slotted binding the two compose — the burst inherits the slot's authored opacity and our
	// multiplier on top of it. This is the parent `<EffectPlayer>`/`<SpineBoneAttach>` mount into.
	const fxLocal = new PIXI.Container();
	fxParent.addChild(fxLocal);
	createContextParent(fxLocal);
	$effect(() => {
		fxLocal.alpha = props.alpha ?? 1;
		fxLocal.scale.set(props.scale ?? 1);
	});
	onDestroy(() => {
		// Detach before destroy: spine holds slotted containers in `_slotsObject` and keeps driving
		// them, so a destroyed-but-still-registered container would be written to every frame.
		if (spine && slot && !spine.destroyed) spine.removeSlotObject(fxParent);
		// Shallow, both of them — the effect subtree below is owned by its own components, which tear
		// themselves down. (This is why the original destroyed `fxParent` without `children`.)
		if (!fxLocal.destroyed) fxLocal.destroy();
		if (!fxParent.destroyed) fxParent.destroy();
	});

	// Bumped on every matching beat; drives the `{#key runId}` re-mount = a fresh one-shot from t=0.
	// Stays 0 (and mounts nothing) until the first fire, so no particles appear before the beat.
	let runId = $state(0);

	// `delay` defers the MOUNT, not the emission: the burst has to start at t=0 of the effect when it
	// does appear, and re-mounting is already how a beat plays one from the top. Each fire schedules
	// its own timer, so two beats inside one delay window still produce two bursts.
	let pending: ReturnType<typeof setTimeout>[] = [];
	const fire = (): void => {
		const delay = props.delay;
		if (typeof delay !== 'number' || !Number.isFinite(delay) || delay <= 0) {
			runId += 1;
			return;
		}
		const timer = setTimeout(() => {
			pending = pending.filter((t) => t !== timer);
			runId += 1;
		}, delay);
		pending.push(timer);
	};
	onDestroy(() => {
		for (const timer of pending) clearTimeout(timer);
		pending = [];
	});

	$effect(() => {
		const event = props.event;
		const state = spine?.state;
		if (!event || !state) return;

		// Fire ONLY on THIS rig's own timeline events (scoped to the host skeleton's AnimationState),
		// not the shared rebroadcast bus — otherwise any other rig firing an event of the same name
		// would cross-trigger this effect.
		const listener: SPINE_PIXI.AnimationStateListener = {
			event: (_entry, ev) => {
				if (ev?.data?.name === event) fire();
			},
		};
		state.addListener(listener);
		return () => state.removeListener(listener);
	});
</script>

{#if runId > 0}
	{#key runId}
		{#if props.bone}
			<SpineBoneAttach boneName={props.bone} followRotation followScale>
				<EffectPlayer doc={props.doc} forceEmit emitSpeed={props.speed} emitFor={props.duration} />
			</SpineBoneAttach>
		{:else}
			<!-- No bone: the rig origin normally, or the SLOT's own bone when this is a slot binding
			     (spine drives `fxParent` there, and this mounts inside it). -->
			<EffectPlayer doc={props.doc} forceEmit emitSpeed={props.speed} emitFor={props.duration} />
		{/if}
	{/key}
{/if}
