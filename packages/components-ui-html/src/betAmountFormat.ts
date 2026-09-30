import { amountFractionDigits } from 'utils-shared/amount';

/**
 * The bet-ladder's compact amount format — `1.23M` / `4.56K` / `7.89`.
 *
 * Deliberately NOT `numberToCurrencyString`: a bet grid packs the whole ladder into small tiles, so
 * large stakes are abbreviated and the currency symbol is dropped. One home because two surfaces
 * render the same ladder and must read identically — the HTML `BetMenuAmountGrid` and the
 * `betOptions` repeater source that feeds an authored Pixi bet screen. An unabbreviated stake takes
 * its decimals from the money formatter, so an operator's `#,#` pattern reads `5` here as it does
 * on the HUD; the abbreviations keep two, which is what makes them readable at all.
 */
export function formatBetAmount(value: number): string {
	const amount = Math.abs(value);
	if (amount > 999999) return `${(amount / 1000000).toFixed(2)}M`;
	if (amount > 999) return `${(amount / 1000).toFixed(2)}K`;
	return amount.toFixed(amountFractionDigits(amount));
}
