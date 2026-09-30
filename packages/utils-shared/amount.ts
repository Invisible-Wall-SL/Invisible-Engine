import { stateI18n } from 'state-shared';

import { BOOK_AMOUNT_MULTIPLIER } from 'constants-shared/bet';
import { stateBet, stateOperator } from 'state-shared';

import { formatMoney, moneyFractionDigits, parseMoneyPattern } from './money';

// bookEventAmount: is the amount or win numbers in the events of books, e.g. the amount in setTotalWin bookEvent
// {
// 	"index": 3,
// 	"type": "setTotalWin",
// 	"amount": 100
// },
// if betting on $1,   100 bookEventAmount equals to $1.    betAmountMultiplier is (100 / BOOK_AMOUNT_MULTIPLIER =) 1
// if betting on $1,    50 bookEventAmount equals to $0.5.  betAmountMultiplier is ( 50 / BOOK_AMOUNT_MULTIPLIER =) 0.5
// if betting on $0.5, 100 bookEventAmount equals to $0.5.  betAmountMultiplier is (100 / BOOK_AMOUNT_MULTIPLIER =) 1
// if betting on $0.5,  50 bookEventAmount equals to $0.25. betAmountMultiplier is ( 50 / BOOK_AMOUNT_MULTIPLIER =) 0.5

export const bookEventAmountToBetAmountMultiplier = (bookEventAmount: number) =>
	bookEventAmount / BOOK_AMOUNT_MULTIPLIER;

export const bookEventAmountToNormalisedAmount = (bookEventAmount: number) => {
	const betAmountMultiplier = bookEventAmountToBetAmountMultiplier(bookEventAmount);
	return stateBet.wageredBetAmount * betAmountMultiplier;
};

export const numberToFloat = (value: number) => Number.parseFloat(`${value}`);

/**
 * THE money formatter: every amount the player reads — HUD, win text, buy prices, the info page —
 * comes through here, so the operator's `currencySymbol` / `currencyFormat` reach all of them. The
 * rules live in `money.ts` (`formatMoney`).
 */
export const numberToCurrencyString = (value: number, minimumDecimals?: number) =>
	formatMoney(value, {
		locale: stateI18n.i18n.locale,
		currency: stateBet.currency,
		symbol: stateOperator.currencySymbol,
		pattern: stateOperator.currencyFormat,
		minimumDecimals,
	});

/**
 * The decimals a bare, symbol-less amount prints with: two, unless the operator's `currencyFormat`
 * states fewer and the amount has nothing below them. For the surfaces that print money without the
 * currency rendering (the bet ladder), so they agree with it on decimals.
 */
export const amountFractionDigits = (value: number): number => {
	const pattern = stateOperator.currencyFormat
		? parseMoneyPattern(stateOperator.currencyFormat)
		: null;
	return pattern ? moneyFractionDigits(value, pattern.decimals) : 2;
};

export const bookEventAmountToCurrencyString = (bookEventAmount: number) => {
	const normalisedAmount = bookEventAmountToNormalisedAmount(bookEventAmount);
	return numberToCurrencyString(normalisedAmount);
};
