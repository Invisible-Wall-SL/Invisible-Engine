<script lang="ts">
	import { OnMount } from 'components-shared';
	import { SECOND } from 'constants-shared/time';
	import { Rectangle } from 'pixi-svelte';

	import { getContext } from '../game/context';
	import { SYMBOL_SIZE } from '../game/constants';
	import {
		armedReelIndices,
		activeReelIndices,
		isAnticipationActive,
		activeMaxTier,
		reelCenterX,
		ANTICIPATION_TIER_FX,
	} from '../game/anticipationPresentation';
	import Anticipation from './Anticipation.svelte';

	// Reel-anticipation presentation (`docs/design/reel-anticipation.md`, Phase 3): the per-reel overlay
	// spine STACK, the grey-out of the non-anticipating reels, and the escalating SFX. Rendered INSIDE
	// the `AnticipationCamera`, so all of it zooms with the board. Mounted by `Game.svelte` only while
	// `stateGame.anticipationMode` is on ⇒ nothing here exists when the mode is off (byte-parity).

	const context = getContext();

	const armed = $derived(armedReelIndices());
	const active = $derived(activeReelIndices());
	const anyActive = $derived(isAnticipationActive());

	// Grey out every reel that is NOT actively anticipating while ANY reel is (the settled/losing
	// reels), so the held reel stands alone. Empty ⇒ no dim (clean clear the instant nothing is active).
	// Gated on the Flow-authored `anticipationGreyOut` toggle (default on ⇒ Phase 3 behaviour unchanged);
	// off ⇒ no dim rects render, the spine stack + zoom still play.
	const dimmedReels = $derived(
		anyActive && context.stateGame.anticipationGreyOut
			? context.stateGame.board
					.map((reel) => reel.reelIndex)
					.filter((index) => !active.includes(index))
			: [],
	);

	const boardHeight = $derived(context.stateGameDerived.boardLayout().height);
	const boardCenterY = $derived(context.stateGameDerived.boardLayout().y);
</script>

<!-- SFX — reuse the registered `sfx_anticipation` loop with the recovered fade-in / fade-out, mounted
	 only while a reel is actively anticipating. The fade-in target is the current max tier's volume, so
	 a mega/massive tease is louder than a plain big one (a per-tier mid-hold ramp is a Phase-5 seam). -->
{#if anyActive}
	<OnMount
		onmount={() => {
			const volume = ANTICIPATION_TIER_FX[activeMaxTier() ?? 'big'].soundVolume;
			context.eventEmitter.broadcast({ type: 'soundLoop', name: 'sfx_anticipation' });
			context.eventEmitter.broadcast({
				type: 'soundFade',
				name: 'sfx_anticipation',
				from: 0,
				to: volume,
				duration: SECOND,
			});

			return () => {
				context.eventEmitter.broadcast({ type: 'soundStop', name: 'sfx_anticipation' });
			};
		}}
	/>
{/if}

<!-- Grey-out: a dim rectangle over each non-anticipating reel column. A per-column `ColorMatrixFilter`
	 desaturate is impractical here — symbols render by POSITION, not per-reel containers — so this is
	 the design's sanctioned dim-overlay fallback (a dark, near-desaturated wash). -->
{#each dimmedReels as reelIndex (reelIndex)}
	<Rectangle
		anchor={{ x: 0.5, y: 0.5 }}
		x={reelCenterX(reelIndex)}
		y={boardCenterY}
		width={SYMBOL_SIZE}
		height={boardHeight}
		backgroundColor={0x05070f}
		backgroundAlpha={0.58}
	/>
{/each}

<!-- Per-reel overlay spine STACK — one per ARMED reel, kept until its `out` finishes. -->
{#each armed as reelIndex (reelIndex)}
	<Anticipation reel={context.stateGame.board[reelIndex]} />
{/each}
