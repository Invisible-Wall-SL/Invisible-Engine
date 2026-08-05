<script lang="ts">
	import { SpineProvider, SpineTrack } from 'pixi-svelte';
	import { stateBetDerived } from 'state-shared';

	import { getContext } from '../game/context';
	import type { Reel } from '../game/stateGame.svelte';
	import { SYMBOL_SIZE } from '../game/constants';
	import {
		resolveTierFx,
		resolveAnticipationSpineKey,
		reelCenterX,
	} from '../game/anticipationPresentation';

	type Props = {
		reel: Reel;
	};

	const props: Props = $props();
	const context = getContext();

	type AnimationName = 'anticipation_intro' | 'anticipation_loop' | 'anticipation_out';

	let animationName = $state<AnimationName>('anticipation_intro');
	// Self-hide once `out` finishes: the reel keeps its `anticipationLevel` until the next spin (it
	// clears in `createEnhanceBoardSpin`), so the parent keeps this mounted — stop rendering the spine
	// after the out completes rather than leaving a frozen final frame on a settled reel.
	let done = $state(false);

	// This reel's tier FX (intensity climbs big → mega → massive), resolved through the single choke
	// point — the authored Symbols SM override ?? the coded `ANTICIPATION_TIER_FX` default.
	const fx = $derived(resolveTierFx(props.reel.reelState.anticipationTier ?? 'big'));
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
		width={SYMBOL_SIZE * 0.56 * fx.overlayScale}
		height={SYMBOL_SIZE * 1.6 * fx.overlayScale}
		x={reelCenterX(props.reel.reelIndex)}
		y={context.stateGameDerived.boardLayout().y - SYMBOL_SIZE * 0.06}
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
