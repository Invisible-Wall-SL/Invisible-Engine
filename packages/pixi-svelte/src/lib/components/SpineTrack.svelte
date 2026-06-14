<script lang="ts" module>
	import * as SPINE_PIXI from '@esotericsoftware/spine-pixi-v8';

	type SpineState = SPINE_PIXI.Spine['state'];
	type TrackEntry = SPINE_PIXI.TrackEntry;

	export type Props = Partial<TrackEntry> & {
		trackIndex: Parameters<SpineState['setAnimation']>[0];
		animationName: Parameters<SpineState['setAnimation']>[1];
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
		if (
			props.trackIndex !== track?.trackIndex ||
			resolvedAnimationName !== track?.animation?.name
		) {
			if (track) spine.state.setEmptyAnimation(track.trackIndex, 0);
			if (!resolvedAnimationName) return; // skeleton has no animations — nothing to play
			try {
				track = spine.state.setAnimation(props.trackIndex, resolvedAnimationName, props.loop);
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

	propsSyncEffect({ props, target: () => track, ignore: ['trackIndex', 'animationName'] });

	onDestroy(() => {
		spine.state.setEmptyAnimation(props.trackIndex, 0);
	});
</script>
