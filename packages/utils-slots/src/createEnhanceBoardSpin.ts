import { stateBet } from 'state-shared';
import { waitForResolve } from 'utils-shared/wait';
import { roundSkip } from 'utils-shared/skipToken';

import { stateSlots } from './stateSlots.svelte';
import type { Reel, GetRawSymbolFromReel, ReelAnticipationArming } from './types';

export function createEnhanceBoardSpin<TReel extends Reel<any, any>>({
	board,
}: {
	board: TReel[];
}) {
	type TRawSymbol = GetRawSymbolFromReel<TReel>;

	type BaseRevealEvent = {
		index: number;
		type: 'reveal';
		board: TRawSymbol[][];
		paddingPositions?: number[];
	};

	async function spin<RevealEvent extends BaseRevealEvent>({
		revealEvent,
		paddingBoard,
		forceSequentialStop,
		computeArming,
	}: {
		revealEvent: RevealEvent;
		paddingBoard?: TRawSymbol[][];
		forceSequentialStop?: boolean;
		// Client-computed reel ANTICIPATION (docs/design/reel-anticipation.md), the single source now
		// that the server `anticipation[]` flag is gone. Given a reel index it returns that reel's
		// arming (level/tier) or `null` when it is not armed. ABSENT ⇒ the whole anticipation block is
		// skipped and the spin is byte-identical to a plain spin (parity — the same OFF-by-default
		// discipline as sequential reel stop). The game builds this from the FINAL board + its config;
		// the engine stays config-agnostic.
		computeArming?: (reelIndex: number) => ReelAnticipationArming | null;
	}) {
		if (stateSlots.isPreSpinning) {
			await Promise.all(
				board.map(async (reel) => {
					await waitForResolve((resolve) => (reel.reelState.readyToSpin = resolve));
				}),
			);
		}

		stateSlots.isPreSpinning = false;

		const globalSpinType = stateBet.isTurbo ? 'fast' : 'normal';
		const getSpinType = ({
			noStop,
			isAnticipated,
		}: {
			noStop: boolean;
			isAnticipated: boolean;
		}) => {
			if (isAnticipated) return 'anticipated';
			if (noStop) return 'normal';
			return globalSpinType;
		};

		board.reduce((previousPaddingSize, reel, reelIndex) => {
			// A reel is ARMED when the client arming policy says a qualifying win/trigger is still
			// reachable as it is about to settle. An armed reel physically HOLDS (the `anticipated`
			// spinType → `reelPaddingMultiplierAnticipated`): that hold IS the migrated anticipation
			// mechanic, now CLIENT-driven instead of the removed server flag. No policy ⇒ no armed
			// reels ⇒ byte-parity.
			const arming = computeArming ? computeArming(reelIndex) : null;
			const isAnticipated = (arming?.level ?? 0) > 0;
			// Reset this reel's anticipation state at the start of each spin; it re-arms progressively
			// as the previous reel settles (`onSpinFinishing`). Only written when a policy is supplied,
			// so an un-armed game never touches the fields (parity).
			if (computeArming) {
				reel.reelState.anticipationLevel = 0;
				reel.reelState.anticipationTier = null;
			}
			// Sequential-stop forces every NON-anticipated reel to stop consecutively via the
			// timing-only `sequential` spinType; a client-armed reel keeps its `anticipated` hold
			// (anticipation wins). Falsy ⇒ untouched.
			//
			// TURBO WINS over it. Sequential stop is a PACING choice the feature makes on the
			// player's behalf (each reel settles a beat after the last, at the slower default
			// spin options — `sequential` is not a `fast` spinType, so it reads SPIN_OPTIONS_DEFAULT);
			// turbo is the player explicitly asking for that pacing to be dropped. Without this the
			// free-spin mode silently overrode a held turbo for every spin of the feature — turbo
			// worked in the base game and stopped working the moment free spins started.
			const useSequential = Boolean(forceSequentialStop) && !isAnticipated && !stateBet.isTurbo;
			const noStop = useSequential ? true : isAnticipated;
			const spinType = useSequential ? 'sequential' : getSpinType({ noStop, isAnticipated });
			const symbols = revealEvent.board[reelIndex] as TRawSymbol[];
			const paddingReel = paddingBoard?.[reelIndex];
			const paddingPosition = revealEvent?.paddingPositions?.[reelIndex];

			const paddingSize = reel.prepareToSpin({
				noStop,
				spinType,
				symbols,
				// @ts-ignore Ignored because paddingReel is not required by createCascadingReel
				paddingReel,
				// @ts-ignore Ignored because paddingPosition is not required by createCascadingReel
				paddingPosition,
				previousPaddingSize,
				onSpinFinishing: () => {
					reel.onReelStopping();
					// Self-arming tease: as this reel lands, arm the NEXT reel (the one about to settle).
					// A slammed round must not ARM a new anticipation on the reel about to land —
					// `reel.stop()` can only clear the flags that already exist — and an un-armed game
					// (no policy) never arms.
					if (!computeArming) return;
					const nextReelIndex = reelIndex + 1;
					if (nextReelIndex >= board.length) return;
					const nextArming = computeArming(nextReelIndex);
					if (nextArming && nextArming.level > 0 && !roundSkip.isSkipped()) {
						board[nextReelIndex].reelState.anticipationLevel = nextArming.level;
						board[nextReelIndex].reelState.anticipationTier = nextArming.tier;
					}
				},
			});

			return paddingSize;
		}, 0);

		await Promise.all(
			board.map(async (reel) => {
				await reel.spin();
			}),
		);
	}

	return { spin };
}
