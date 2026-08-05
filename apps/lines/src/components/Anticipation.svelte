<script lang="ts">
	import { SpineProvider, SpineTrack } from 'pixi-svelte';
	import { stateBetDerived } from 'state-shared';

	import type { Reel } from '../game/stateGame.svelte';
	import {
		resolveTierFx,
		resolveAnticipationSpineKey,
		reelCenterX,
		overlayBaseWidth,
		overlayBaseHeight,
		boardCenterYWorld,
	} from '../game/anticipationPresentation';

	type Props = {
		reel: Reel;
	};

	const props: Props = $props();

	type AnimationName = 'anticipation_intro' | 'anticipation_loop' | 'anticipation_out';

	let animationName = $state<AnimationName>('anticipation_intro');
	// Self-hide once `out` finishes: the reel keeps its `anticipationLevel` until the next spin (it
	// clears in `createEnhanceBoardSpin`), so the parent keeps this mounted — stop rendering the spine
	// after the out completes rather than leaving a frozen final frame on a settled reel.
	let done = $state(false);

	// This reel's tier FX (intensity climbs with the config big tiers), resolved through the single
	// choke point — the authored Symbols SM override ?? the coded ramp. A null tier (trigger-only arm)
	// resolves to the ramp's lowest step.
	const fx = $derived(resolveTierFx(props.reel.reelState.anticipationTier));
	// The overlay spine key — authored `anticipation.spineKey` ?? the coded `anticipation` spine.
	const spineKey = $derived(resolveAnticipationSpineKey());

	$effect(() => {
		if (props.reel.reelState.motion === 'stopped' && animationName !== 'anticipation_out') {
			animationName = 'anticipation_out';
		}
	});
</script>

{#if !done}
	<SpineProvider
		key={spineKey}
		width={overlayBaseWidth() * fx.overlayScale}
		height={overlayBaseHeight() * fx.overlayScale}
		x={reelCenterX(props.reel.reelIndex)}
		y={boardCenterYWorld()}
		alpha={fx.overlayAlpha}
		tint={fx.overlayTint}
	>
		<SpineTrack
			trackIndex={0}
			{animationName}
			loop={animationName === 'anticipation_loop'}
			timeScale={stateBetDerived.timeScale()}
			listener={{
				complete: () => {
					if (animationName === 'anticipation_intro') {
						animationName = 'anticipation_loop';
					}

					if (animationName === 'anticipation_out') {
						done = true;
					}
				},
			}}
		/>
	</SpineProvider>
{/if}
