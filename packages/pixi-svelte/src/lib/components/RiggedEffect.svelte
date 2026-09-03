<script lang="ts" module>
	import type { EffectDoc } from 'engine-fx';

	export type Props = {
		/** The effect to (re)play on each beat — its layers reduce to `<EffectPlayer>`. */
		doc: EffectDoc;
		/** The rig's OWN spine event name that fires this effect (the rebroadcast `type`). */
		event: string;
		/** Animation the bound keyframe lives in. Absent ⇒ fires in any animation (a manifest baked
		 * before beats existed). */
		animation?: string;
		/** The bound keyframe's time, seconds. Absent ⇒ fires on any keyframe of the name. */
		time?: number;
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
		/** Start on the first beat and keep going, ignoring later fires — so a LOOPING animation does
		 * not chop and restart an ambient effect once per lap. See `RigFxOverrides.continuous`. */
		continuous?: boolean;
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

	import {
		getContextSpine,
		getContextSpineLoadScale,
		createContextParent,
	} from '../context.svelte';
	import EffectPlayer from './EffectPlayer.svelte';
	import SpineBoneAttach from './SpineBoneAttach.svelte';
	import { riggedBeatMatches } from '../riggedBeat';
	import { attachToSlot } from '../spineSlotHost';

	const props: Props = $props();
	const spine = getContextSpine();
	// The effect is authored in RIG units (the Rigger and /symbols load every rig at 1); the host
	// bundle may be read at another load scale, which moves bones and scales attachments but not a
	// Pixi child — so the burst is scaled by it here. See `setContextSpineLoadScale`.
	const loadScale = getContextSpineLoadScale();

	// The effect subtree renders under this container, which we parent on the host spine so it
	// inherits the rig's fit-scale/position/pivot (see doc note 2).
	const fxParent = new PIXI.Container();
	// A SLOT binding puts `fxParent` under the slot's shared HOST object instead, which spine drives
	// at that slot's place in the draw order. Shared, because spine allows ONE object per slot and
	// `addSlotObject` evicts the previous one — and a binding is one keyframe, so the same effect keyed
	// on one slot in two animations is two mounts (see `spineSlotHost`). Guarded, because
	// `addSlotObject` THROWS on an unknown slot name and a rig re-synced with that slot renamed away
	// must degrade to the old on-top mount, not crash the game.
	const slot =
		props.drawSlot && spine?.skeleton?.findSlot(props.drawSlot) ? props.drawSlot : undefined;
	const detachSlot =
		spine && slot ? attachToSlot(spine, slot, fxParent, () => new PIXI.Container()) : undefined;
	if (!detachSlot) spine?.addChild(fxParent);

	// `alpha`/`scale` live on a SECOND container, not on `fxParent`: on a slot binding the host above
	// `fxParent` is spine's (its `updateSlotObject` rewrites position, rotation, scale AND alpha every
	// frame from the slot's bone and colour). Nesting keeps one code shape for both mounts, and
	// on a slotted binding the two compose — the burst inherits the slot's authored opacity and our
	// multiplier on top of it. This is the parent `<EffectPlayer>`/`<SpineBoneAttach>` mount into.
	const fxLocal = new PIXI.Container();
	fxParent.addChild(fxLocal);
	createContextParent(fxLocal);
	$effect(() => {
		fxLocal.alpha = props.alpha ?? 1;
		fxLocal.scale.set((props.scale ?? 1) * loadScale());
	});
	onDestroy(() => {
		// Leave the shared slot host first (the last binding out unregisters it from spine, so a
		// destroyed-but-still-registered container is never written to every frame).
		detachSlot?.();
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
		// A continuous binding is armed by its FIRST beat and then deaf: re-mounting is how a one-shot
		// replays from t=0, so ignoring the later fires is exactly what keeps the emitter unbroken.
		// `runId > 0` means it is already mounted; a pending delay counts too, or a beat landing inside
		// the delay window would queue a second start.
		if (props.continuous && (runId > 0 || pending.length > 0)) return;
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

	// Attached at INIT, not from an effect. The sibling `<SpineTrack>` sets the animation and poses
	// it (`spine.update(0)`) from ITS effect, and sibling effects run in template order — so a
	// listener attached from an effect here lands AFTER that first apply, and a key at t=0 (fired by
	// that very pose) was lost. A key at 0.01s only ever worked because the ticker fired it a frame
	// later. Attaching during init puts the listener on the state before any track is set.
	//
	// Fire ONLY on THIS rig's own timeline events (scoped to the host skeleton's AnimationState),
	// not the shared rebroadcast bus — otherwise any other rig firing an event of the same name
	// would cross-trigger this effect. And only on THIS binding's beat: the manifest carries the
	// keyframe's animation + time beside the name, so two keys of one name are two bindings.
	const listener: SPINE_PIXI.AnimationStateListener = {
		event: (entry, ev) => {
			if (
				riggedBeatMatches(
					{ event: props.event, animation: props.animation, time: props.time },
					{ name: ev?.data?.name, animation: entry?.animation?.name, time: ev?.time },
				)
			) {
				fire();
			}
		},
	};
	spine?.state?.addListener(listener);
	onDestroy(() => spine?.state?.removeListener(listener));
</script>

{#if runId > 0}
	{#key runId}
		{#if props.bone}
			<SpineBoneAttach boneName={props.bone} followRotation followScale rigUnits>
				<EffectPlayer doc={props.doc} forceEmit emitSpeed={props.speed} emitFor={props.duration} />
			</SpineBoneAttach>
		{:else}
			<!-- No bone: the rig origin normally, or the SLOT's own bone when this is a slot binding
			     (spine drives `fxParent` there, and this mounts inside it). -->
			<EffectPlayer doc={props.doc} forceEmit emitSpeed={props.speed} emitFor={props.duration} />
		{/if}
	{/key}
{/if}
