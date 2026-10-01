import { BOOK_AMOUNT_MULTIPLIER } from 'constants-shared/bet';
import { coinLabelText, moneyDecimalSeparator, type RawSymbol } from 'engine-game';
import { resolveCoinLabelLook, resolveCoinLabelPop, type CoinLabelLook } from 'engine-layout';
import { symbolHoldAndWinRoles } from 'game-config';
import {
	bookEventAmountToCurrencyString,
	bookEventAmountToNormalisedAmount,
	numberToCurrencyString,
} from 'utils-shared/amount';

import { bakedCoinLabel } from '../editor-scenes';
import { getActiveGameConfig } from './gameConfig';

/**
 * What a Hold and Win symbol prints on itself, in this game's currency, by its role in the active
 * Game Config and the label authored in the Symbols tool (`bakedCoinLabel`). Null for every symbol
 * that carries no value or jackpot — every symbol of every other kind — so a lines or Book-of board
 * never reaches the config read. Unauthored ⇒ the coded label, byte-identical.
 */
export const coinLabelFor = (symbol: RawSymbol): string | null => {
	if (symbol.value === undefined && symbol.jackpot === undefined) return null;
	const roles = symbolHoldAndWinRoles(getActiveGameConfig().symbols[symbol.name]);
	const authored = bakedCoinLabel();
	return coinLabelText(
		symbol,
		roles,
		(multiple, decimals) => {
			const amount = multiple * BOOK_AMOUNT_MULTIPLIER;
			return decimals === undefined
				? bookEventAmountToCurrencyString(amount)
				: numberToCurrencyString(bookEventAmountToNormalisedAmount(amount), decimals);
		},
		authored && {
			...authored,
			// Read off the SAME formatter that prints the amount, never the locale's plain numbers.
			decimalSeparator: moneyDecimalSeparator((amount) => numberToCurrencyString(amount)),
		},
	);
};

/** How a symbol's label draws: its jackpot tier's style over the shared one over the coded look. */
export const coinLabelLookFor = (symbol: RawSymbol): CoinLabelLook =>
	resolveCoinLabelLook(bakedCoinLabel(), symbol.jackpot);

/**
 * A count-up length under the authored `coinLabel.animation.countMs`, else `coded`. `countMs` is
 * authored against `reference` (the payer/boost count); a beat coded shorter or longer than it is
 * scaled in proportion, so a collect step stays as much quicker than a payer count as it was coded.
 */
export const coinLabelCountMs = (coded: number, reference = coded): number => {
	const countMs = bakedCoinLabel()?.animation?.countMs;
	return countMs === undefined ? coded : Math.round((countMs * coded) / reference);
};

/** One pop of a label: a fresh `id` replays it. */
export type CoinLabelPopCue = { id: number; scale: number; ms: number };

/** The authored label pops, resolved — null for one that is off (the coded label never pops). */
export const coinLabelPops = () => {
	const animation = bakedCoinLabel()?.animation;
	return {
		land: resolveCoinLabelPop(animation?.landPop),
		boost: resolveCoinLabelPop(animation?.boostPop),
	};
};
