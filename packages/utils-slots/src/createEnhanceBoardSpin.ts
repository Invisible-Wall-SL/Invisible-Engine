import { stateBet } from 'state-shared';
import { waitForResolve } from 'utils-shared/wait';
import { roundSkip } from 'utils-shared/skipToken';

import { stateSlots } from './stateSlots.svelte';
import type { Reel, GetRawSymbolFromReel } from './types';

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
		anticipation: number[];
		paddingPositions?: number[];
	};

	async function spin<RevealEvent extends BaseRevealEvent>({
		revealEvent,
		paddingBoard,
		forceSequentialStop,
	}: {
		revealEvent: RevealEvent;
		paddingBoard?: TRawSymbol[][];
		forceSequentialStop?: boolean;
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
		const globalHasAnticipation = revealEvent.anticipation.some(Boolean);
		const firstAnticipatedReelIndex = revealEvent.anticipation.findIndex(Boolean);
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
			const isAnticipated = (revealEvent.anticipation?.[reelIndex] || 0) > 0;
			// Sequential-stop forces every NON-anticipated reel to stop consecutively via the
			// timing-only `sequential` spinType; a genuinely book-anticipated reel keeps its
			// existing `anticipated` behaviour (anticipation wins). Falsy ⇒ untouched.
			const useSequential = Boolean(forceSequentialStop) && !isAnticipated;
			const noStop = useSequential
				? true
				: globalHasAnticipation && reelIndex >= firstAnticipatedReelIndex;
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
					const nextReelIndex = reelIndex + 1;
					const isNextReelAnticipated = (revealEvent.anticipation?.[nextReelIndex] || 0) > 0;
					// A slammed round must not ARM a new anticipation on the reel that is about to
					// land — `reel.stop()` can only clear the flags that already exist.
					if (isNextReelAnticipated && !roundSkip.isSkipped()) {
						board[nextReelIndex].reelState.anticipating = true;
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
