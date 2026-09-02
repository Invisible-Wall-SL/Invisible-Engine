<script lang="ts" module>
	import type { FlipbookClip } from './Flipbook.svelte';

	export type Props = {
		/**
		 * The clip to (re)play on each beat, with the binding's PLAYBACK overrides already folded in
		 * (`foldFlipbookPlayback` in `engine-layout`).
		 *
		 * Folded by the caller, not passed beside the clip, for the reason that fold documents:
		 * `direction` decides the texture ARRAY `<Flipbook>` builds, so two answers in flight would
		 * walk the frames one way while everything else assumed another.
		 */
		clip: FlipbookClip;
		/** The rig's OWN spine event name that fires this clip (the rebroadcast `type`). */
		event: string;
		/** Animation the bound keyframe lives in. Absent ⇒ fires in any animation (a manifest baked
		 * before beats existed). */
		animation?: string;
		/** The bound keyframe's time, seconds. Absent ⇒ fires on any keyframe of the name. */
		time?: number;
		/** Host bone on the rig; absent ⇒ the rig origin. Resolved on the host `<SpineProvider>`. */
		bone?: string;
		/**
		 * Draw the clip at THIS slot's depth in the skeleton draw order (spine-pixi `addSlotObject`),
		 * instead of on top of the whole rig. An unknown slot name falls back to on-top.
		 *
		 * NOT named `slot`: Svelte still reads a `slot` attribute on a component as the legacy slot
		 * assignment, which must be a static string — so `slot={binding.slot}` would not compile.
		 * (Same rename, same reason, as `<RiggedEffect drawSlot>`.)
		 */
		drawSlot?: string;
		/** Opacity multiplier, 0–1. */
		alpha?: number;
		/** Size multiplier on the whole clip. */
		scale?: number;
		/** Milliseconds to wait after the beat before it starts. */
		delay?: number;
		/** Milliseconds on screen, then taken down. Absent ⇒ the clip decides (a looping clip then
		 * runs until the rig unmounts). */
		duration?: number;
		/** Start on the first beat and keep going, ignoring later fires — so a LOOPING animation does
		 * not chop and restart an ambient clip once per lap. See `RigFlipbookOverrides.continuous`. */
		continuous?: boolean;
	};
</script>

<script lang="ts">
	/**
	 * Invisible Flipbook rig-timeline direct binding, runtime half — the frame-animation twin of
	 * `<RiggedEffect>`. A rig plays a chosen CLIP on the beat of its OWN animation event: when the
	 * rig's spine event named `event` fires, this (re)plays `clip` from frame 0, hosted on `bone` (or
	 * the rig origin when absent), at `drawSlot`'s depth when one is bound.
	 *
	 * It is deliberately the same component shape as `<RiggedEffect>`, because the two solve the same
	 * two problems and any divergence between them would show up as "FX lands on the bone but the
	 * flipbook doesn't":
	 *
	 * 1. **Rig-scoped firing (no cross-talk).** We listen DIRECTLY to the host skeleton's own
	 *    `AnimationState`, NOT the shared `utils-event-emitter` rebroadcast bus. The bus is global and
	 *    keyed only by the bare event NAME, so a different rig firing an event of the same name (two
	 *    board cells showing the same symbol, say) would cross-trigger this clip.
	 *
	 * 2. **Rig-transform inheritance.** `SpineProvider` scales + positions the SPINE object
	 *    (contain-fit into the cell) but leaves its child parent context pointing at the OUTER
	 *    container, so a naively-mounted sprite renders at the board origin at its authored size. We
	 *    mount under `fbParent`, parented DIRECTLY on the host spine, so the clip inherits the rig's
	 *    fit-scale, position and pivot — and rides whatever layer the symbol is on.
	 *
	 * WHERE IT DRAWS. The clip is anchored on its ORIGIN (`anchor 0.5`), which is the space a clip's
	 * `bounds` box is already expressed in (`FlipbookBounds` is top-left relative to the clip origin,
	 * so a centred box is `x = -w/2`). There is deliberately no per-binding x/y offset: a clip's
	 * placement inside its own box is authored ONCE in `/flipbook` as that box, and a second offset
	 * here would be a rival answer to the same question. Move the art by moving the box, or bind a
	 * different bone.
	 *
	 * Firing model: one-shot per beat (each fire bumps `runId`, and `{#key runId}` re-mounts a clean
	 * play from frame 0), unless `continuous` is set — then the first beat arms it and later beats are
	 * deaf. `duration` takes it back down after that many ms; without one, a one-shot clip ends itself
	 * and a looping clip runs until the rig unmounts. Nothing renders before the first fire. No-op
	 * when there is no host spine in context (never crashes).
	 */
	import * as PIXI from 'pixi.js';
	import * as SPINE_PIXI from '@esotericsoftware/spine-pixi-v8';
	import { onDestroy } from 'svelte';

	import { getContextSpine, createContextParent } from '../context.svelte';
	import Flipbook from './Flipbook.svelte';
	import SpineBoneAttach from './SpineBoneAttach.svelte';
	import { riggedBeatMatches } from '../riggedBeat';
	import { attachToSlot } from '../spineSlotHost';

	const props: Props = $props();
	const spine = getContextSpine();

	// The clip renders under this container, which we parent on the host spine so it inherits the
	// rig's fit-scale/position/pivot (see doc note 2).
	const fbParent = new PIXI.Container();
	// A SLOT binding puts `fbParent` under the slot's shared HOST object instead, which spine drives
	// at that slot's place in the draw order. Shared, because spine allows ONE object per slot and
	// `addSlotObject` evicts the previous one — and a binding is one keyframe, so the same clip keyed
	// on one slot in two animations is two mounts (see `spineSlotHost`). Guarded, because
	// `addSlotObject` THROWS on an unknown slot name and a rig re-synced with that slot renamed away
	// must degrade to the old on-top mount, not crash the game.
	const slot =
		props.drawSlot && spine?.skeleton?.findSlot(props.drawSlot) ? props.drawSlot : undefined;
	const detachSlot =
		spine && slot ? attachToSlot(spine, slot, fbParent, () => new PIXI.Container()) : undefined;
	if (!detachSlot) spine?.addChild(fbParent);

	// `alpha`/`scale` live on a SECOND container, not on `fbParent`: on a slot binding the host above
	// `fbParent` is spine's (its `updateSlotObject` rewrites position, rotation, scale AND alpha every
	// frame from the slot's bone and colour). Nesting keeps one code shape for both mounts, and
	// on a slotted binding the two compose.
	const fbLocal = new PIXI.Container();
	fbParent.addChild(fbLocal);
	createContextParent(fbLocal);
	$effect(() => {
		fbLocal.alpha = props.alpha ?? 1;
		fbLocal.scale.set(props.scale ?? 1);
	});
	onDestroy(() => {
		// Leave the shared slot host first (the last binding out unregisters it from spine, so a
		// destroyed-but-still-registered container is never written to every frame).
		detachSlot?.();
		// Shallow, both of them — the clip subtree below is owned by `<Flipbook>`, which tears itself
		// down.
		if (!fbLocal.destroyed) fbLocal.destroy();
		if (!fbParent.destroyed) fbParent.destroy();
	});

	// Bumped on every matching beat; drives the `{#key runId}` re-mount = a fresh play from frame 0.
	// Stays 0 (and mounts nothing) until the first fire, so no art appears before the beat.
	let runId = $state(0);

	let timers: ReturnType<typeof setTimeout>[] = [];
	const clearTimers = (): void => {
		for (const timer of timers) clearTimeout(timer);
		timers = [];
	};

	/** Mount (or re-mount) the clip, and schedule its take-down when the binding bounds it. */
	const start = (): void => {
		runId += 1;
		const duration = props.duration;
		if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) return;
		// Take-down = back to the pre-first-fire state (`runId` 0 unmounts the `{#if}`), so a bounded
		// clip leaves nothing behind — including on a `continuous` binding, whose re-fire guard reads
		// the same value and therefore re-arms correctly on the next beat.
		const timer = setTimeout(() => {
			timers = timers.filter((t) => t !== timer);
			runId = 0;
		}, duration);
		timers.push(timer);
	};

	// `delay` defers the MOUNT, not a play flag: the clip has to start at frame 0 when it does appear,
	// and re-mounting is already how a beat plays one from the top. Each fire schedules its own timer,
	// so two beats inside one delay window still produce two plays.
	const fire = (): void => {
		// A continuous binding is armed by its FIRST beat and then deaf: re-mounting is how a one-shot
		// replays from frame 0, so ignoring the later fires is exactly what keeps the animation
		// unbroken. A pending delay counts too, or a beat landing inside the delay window would queue
		// a second start.
		if (props.continuous && (runId > 0 || timers.length > 0)) return;
		const delay = props.delay;
		if (typeof delay !== 'number' || !Number.isFinite(delay) || delay <= 0) {
			start();
			return;
		}
		const timer = setTimeout(() => {
			timers = timers.filter((t) => t !== timer);
			start();
		}, delay);
		timers.push(timer);
	};
	onDestroy(clearTimers);

	// Attached at INIT, not from an effect. The sibling `<SpineTrack>` sets the animation and poses
	// it (`spine.update(0)`) from ITS effect, and sibling effects run in template order — so a
	// listener attached from an effect here lands AFTER that first apply, and a key at t=0 (fired by
	// that very pose) was lost. A key at 0.01s only ever worked because the ticker fired it a frame
	// later. Attaching during init puts the listener on the state before any track is set.
	//
	// Fire ONLY on THIS rig's own timeline events (scoped to the host skeleton's AnimationState),
	// not the shared rebroadcast bus — otherwise any other rig firing an event of the same name
	// would cross-trigger this clip. And only on THIS binding's beat: the manifest carries the
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
			<SpineBoneAttach boneName={props.bone} followRotation followScale>
				<Flipbook clip={props.clip} anchor={0.5} />
			</SpineBoneAttach>
		{:else}
			<!-- No bone: the rig origin normally, or the SLOT's own bone when this is a slot binding
			     (spine drives `fbParent` there, and this mounts inside it). -->
			<Flipbook clip={props.clip} anchor={0.5} />
		{/if}
	{/key}
{/if}
