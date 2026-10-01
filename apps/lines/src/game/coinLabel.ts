import { BOOK_AMOUNT_MULTIPLIER } from 'constants-shared/bet';
import { coinLabelText, type RawSymbol } from 'engine-game';
import { symbolHoldAndWinRoles } from 'game-config';
import { bookEventAmountToCurrencyString } from 'utils-shared/amount';

import { getActiveGameConfig } from './gameConfig';

/**
 * What a Hold and Win symbol prints on itself, in this game's currency, by its role in the active
 * Game Config. Null for every symbol that carries no value or jackpot — every symbol of every other
 * kind — so a lines or Book-of board never reaches the config read.
 */
export const coinLabelFor = (symbol: RawSymbol): string | null => {
	if (symbol.value === undefined && symbol.jackpot === undefined) return null;
	const roles = symbolHoldAndWinRoles(getActiveGameConfig().symbols[symbol.name]);
	return coinLabelText(symbol, roles, (multiple) =>
		bookEventAmountToCurrencyString(multiple * BOOK_AMOUNT_MULTIPLIER),
	);
};
