<script lang="ts" module>
	import * as SPINE_PIXI from '@esotericsoftware/spine-pixi-v8';

	type SpineState = SPINE_PIXI.Spine['state'];
	type TrackEntry = SPINE_PIXI.TrackEntry;

	export type Props = Partial<TrackEntry> & {
		trackIndex: Parameters<SpineState['setAnimation']>[0];
		animationName: Parameters<SpineState['setAnimation']>[1];
		/** Animation to QUEUE after `animationName` finishes (Spine `addAnimation`, delay 0).
		 * Used for one-shot → loop hand-offs, e.g. a free-spin intro spine playing its
		 * `intro` once then settling into an `idle` loop. Omit for a single animation. */
		then?: string;
		/** Loop the queued {@link then} animation (default `true` — the idle/resting loop). */
		thenLoop?: boolean;
		/** Monotonic FIRE token for event-driven animation (a "Plays on signal" spine cue). Bump it
		 * to re-apply `animationName` from the top even when the name is unchanged — a repeat cue is
		 * otherwise indistinguishable from a no-op re-render and leaves a finished one-shot track
		 * frozen on its last frame. Omit for a declarative binding (unchanged behaviour). */
		replay?: number;
		/** Called when a ONE-SHOT (non-looping) primary animation COMPLETES — the moment it hands off
		 * to the queued {@link then}. Used by the free-spin-intro pattern to fire an author-named
		 * completion signal (reveal the amount + tap only after the intro plays). Attached only when
		 * `loop` is falsy (a loop has no single completion). Omit ⇒ no listener (unchanged behaviour). */
		oncomplete?: () => void;
	};
</script>

<script lang="ts">
	import { onDestroy } from 'svelte';

	import { propsSyncEffect } from '../utils.svelte';
	import { getContextSpine } from '../context.svelte';
	import { shouldApplySpineAnimation } from '../spineTrackReplay';

	const props: Props = $props();
	const spine = getContextSpine();

	let track = $state(spine.state.tracks[props.trackIndex]);
	let appliedReplay: number | undefined = undefined;

	// Fall back to the skeleton's first animation when no name is given — matches the
	// Symbols tool's "(first animation)" option and its preview (SymbolSpinePreview),
	// and guards `setAnimation(_, null)` which throws "animationName cannot be null"
	// (e.g. a symbol spine bound without an explicit animation, or a Rigger rig whose
	// sole animation is the default `animation`).
	const resolvedAnimationName = $derived(
		props.animationName || spine?.state?.data?.skeletonData?.animations?.[0]?.name || null,
	);

	$effect(() => {
		// Re-apply when the INTENDED animation changes, or when an event-driven cue FIRES AGAIN
		// (`replay`) — but NOT when the live track has merely advanced to the queued `then`
		// animation (`addAnimation` below), which would otherwise restart the primary in a loop.
		// The decision lives in `shouldApplySpineAnimation` so it is testable without a renderer.
		if (
			shouldApplySpineAnimation({
				trackIndex: props.trackIndex,
				animationName: resolvedAnimationName,
				then: props.then,
				replay: props.replay,
				appliedReplay,
				track: track
					? { trackIndex: track.trackIndex, animationName: track.animation?.name }
					: null,
			})
		) {
			appliedReplay = props.replay;
			if (track) spine.state.setEmptyAnimation(track.trackIndex, 0);
			if (!resolvedAnimationName) return; // skeleton has no animations — nothing to play
			try {
				track = spine.state.setAnimation(props.trackIndex, resolvedAnimationName, props.loop);
				// Completion NOTIFIER (free-spin-intro sequencing): fire `oncomplete` once a ONE-SHOT
				// primary animation finishes (its hand-off to the queued `then`). Attached to THIS entry
				// only — never the queued `then` — and only for a non-looping primary (a loop's `complete`
				// fires every cycle). The author-named completion signal it drives reveals the amount/tap.
				if (props.oncomplete && !props.loop) {
					const fire = props.oncomplete;
					track.listener = { complete: () => fire() };
				}
				// Queue the follow-up (e.g. idle) right after the primary (intro) finishes.
				if (props.then) {
					spine.state.addAnimation(props.trackIndex, props.then, props.thenLoop ?? true, 0);
				}
				// Pose the skeleton to the just-set animation's FIRST frame right now, before the
				// next render. A freshly-mounted symbol spine (e.g. a cell entering `land`/`win`)
				// otherwise paints its setup pose for one frame until the ticker first advances it —
				// read on the reels as the landing symbol art "blinking". `update(0)` applies the
				// animation state without advancing time, so this is a pure pose, not a skip.
				spine.update(0);
			} catch (error) {
				console.error(error);
				const animations = spine?.state?.data?.skeletonData?.animations;
				if (animations) {
					console.log(
						'Available animation names:',
						animations.map((animation) => animation.name),
					);
				}
			}
		}
	});

	propsSyncEffect({
		props,
		target: () => track,
		ignore: ['trackIndex', 'animationName', 'then', 'thenLoop', 'replay', 'oncomplete'],
	});

	onDestroy(() => {
		spine.state.setEmptyAnimation(props.trackIndex, 0);
	});
</script>
