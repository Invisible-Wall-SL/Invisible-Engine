import { createEnhanceBoardPreSpin } from './createEnhanceBoardPreSpin';
import { stateSlots } from './stateSlots.svelte';
import { createEnhanceBoardSpin } from './createEnhanceBoardSpin';
import type { Reel, GetRawSymbolFromReel } from './types';

export function createEnhanceBoard() {
	function enhanceBoard<TReel extends Reel<any, any>>({ board }: { board: TReel[] }) {
		type TRawSymbol = GetRawSymbolFromReel<TReel>;

		const { preSpin } = createEnhanceBoardPreSpin({ board });
		const { spin } = createEnhanceBoardSpin({ board });
		const settle = (rawBoard?: TRawSymbol[][]) =>
			board.forEach((reel, reelIndex) => {
				const rawSymbols = rawBoard?.[reelIndex] || [];
				reel.setSymbolsWithRawSymbols(rawSymbols);
			});
		const stop = () => board.forEach((reel) => reel.stop());
		/** End a pre-spin roll that no spin will follow (see the reel's `cancelPreSpin`). A cascading
		 *  reel has no roll to end. */
		const cancelPreSpin = async () => {
			stateSlots.isPreSpinning = false;
			await Promise.all(
				board.map((reel) => ('cancelPreSpin' in reel ? reel.cancelPreSpin() : undefined)),
			);
		};
		const readyToSpinEffect = () => {
			board.forEach((reel) => reel.readyToSpinEffect());
		};

		return {
			board,
			preSpin,
			spin,
			settle,
			stop,
			cancelPreSpin,
			readyToSpinEffect,
		};
	}

	return { enhanceBoard };
}
