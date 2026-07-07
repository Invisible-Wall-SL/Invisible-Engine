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
	};
</script>

<script lang="ts">
	import { onDestroy } from 'svelte';

	import { propsSyncEffect } from '../utils.svelte';
	import { getContextSpine } from '../context.svelte';

	const props: Props = $props();
	const spine = getContextSpine();

	let track = $state(spine.state.tracks[props.trackIndex]);

	// Fall back to the skeleton's first animation when no name is given — matches the
	// Symbols tool's "(first animation)" option and its preview (SymbolSpinePreview),
	// and guards `setAnimation(_, null)` which throws "animationName cannot be null"
	// (e.g. a symbol spine bound without an explicit animation, or a Rigger rig whose
	// sole animation is the default `animation`).
	const resolvedAnimationName = $derived(
		props.animationName || spine?.state?.data?.skeletonData?.animations?.[0]?.name || null,
	);

	$effect(() => {
		// Re-apply only when the INTENDED animation changes — NOT when the live track has
		// advanced to the queued `then` animation (`addAnimation` below), which would
		// otherwise restart the primary in a loop. With no `then`, `props.then` is undefined
		// so the extra clause is always true and the guard is byte-identical to before.
		if (
			props.trackIndex !== track?.trackIndex ||
			(resolvedAnimationName !== track?.animation?.name && props.then !== track?.animation?.name)
		) {
			if (track) spine.state.setEmptyAnimation(track.trackIndex, 0);
			if (!resolvedAnimationName) return; // skeleton has no animations — nothing to play
			try {
				track = spine.state.setAnimation(props.trackIndex, resolvedAnimationName, props.loop);
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
		ignore: ['trackIndex', 'animationName', 'then', 'thenLoop'],
	});

	onDestroy(() => {
		spine.state.setEmptyAnimation(props.trackIndex, 0);
	});
</script>
