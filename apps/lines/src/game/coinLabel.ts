import { BOOK_AMOUNT_MULTIPLIER } from 'constants-shared/bet';
import { coinLabelText, type RawSymbol } from 'engine-game';
import { resolveCoinLabelLook, resolveCoinLabelPop, type CoinLabelLook } from 'engine-layout';
import { symbolHoldAndWinRoles } from 'game-config';
import { stateI18n } from 'state-shared';
import {
	bookEventAmountToCurrencyString,
	bookEventAmountToNormalisedAmount,
	numberToCurrencyString,
} from 'utils-shared/amount';

import { bakedCoinLabel } from '../editor-scenes';
import { getActiveGameConfig } from './gameConfig';

const separators = new Map<string, string>();
/** The active locale's decimal separator, which the money formatter prints its fraction after. */
const decimalSeparator = (): string => {
	const locale = stateI18n.i18n.locale;
	let separator = separators.get(locale);
	if (separator === undefined) {
		separator =
			new Intl.NumberFormat([locale, 'en'])
				.formatToParts(1.5)
				.find((part) => part.type === 'decimal')?.value ?? '.';
		separators.set(locale, separator);
	}
	return separator;
};

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
		authored && { ...authored, decimalSeparator: decimalSeparator() },
	);
};

/** How a symbol's label draws: its jackpot tier's style over the shared one over the coded look. */
export const coinLabelLookFor = (symbol: RawSymbol): CoinLabelLook =>
	resolveCoinLabelLook(bakedCoinLabel(), symbol.jackpot);

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
