<script lang="ts">
	import { OnMount } from 'components-shared';
	import { SECOND } from 'constants-shared/time';
	import { Rectangle } from 'pixi-svelte';

	import { getContext } from '../game/context';
	import {
		armedReelIndices,
		activeReelIndices,
		isAnticipationActive,
		activeMaxTier,
		reelCenterX,
		reelColumnWidth,
		boardColumnHeight,
		boardCenterYWorld,
		resolveTierFx,
		resolveActivationSound,
		resolveLoopSound,
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
</script>

<!-- SFX — a one-shot activation STING at arm, then the `sfx_anticipation` LOOP with the recovered
	 fade-in / fade-out, mounted only while a reel is actively anticipating. Both names resolve through
	 the anticipation choke points (authored `activationSound`/`loopSound` ?? the coded defaults). The
	 fade-in target is the current max tier's LOOP volume and the sting plays at that tier's STING volume,
	 so a mega/massive tease is louder than a plain big one (the escalating volume ramp). -->
{#if anyActive}
	<OnMount
		onmount={() => {
			const fx = resolveTierFx(activeMaxTier());
			const loopName = resolveLoopSound();
			// The activation sting — one-shot, at the tier's sting volume (per-play, relative to the
			// master SFX volume). A missing/unknown sprite is declined silently by howler.
			context.eventEmitter.broadcast({
				type: 'soundOnce',
				name: resolveActivationSound(),
				volume: fx.stingVolume,
			});
			context.eventEmitter.broadcast({ type: 'soundLoop', name: loopName });
			context.eventEmitter.broadcast({
				type: 'soundFade',
				name: loopName,
				from: 0,
				to: fx.soundVolume,
				duration: SECOND,
			});

			return () => {
				context.eventEmitter.broadcast({ type: 'soundStop', name: loopName });
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
		y={boardCenterYWorld()}
		width={reelColumnWidth()}
		height={boardColumnHeight()}
		backgroundColor={0x05070f}
		backgroundAlpha={0.58}
	/>
{/each}

<!-- Per-reel overlay spine STACK — one per ARMED reel, kept until its `out` finishes. -->
{#each armed as reelIndex (reelIndex)}
	<Anticipation reel={context.stateGame.board[reelIndex]} />
{/each}
