/**
 * The bet-ladder's compact amount format — `1.23M` / `4.56K` / `7.89`.
 *
 * Deliberately NOT `numberToCurrencyString`: a bet grid packs the whole ladder into small tiles, so
 * large stakes are abbreviated and the currency symbol is dropped. One home because two surfaces
 * render the same ladder and must read identically — the HTML `BetMenuAmountGrid` and the
 * `betOptions` repeater source that feeds an authored Pixi bet screen.
 */
export function formatBetAmount(value: number): string {
	const amount = Math.abs(value);
	if (amount > 999999) return `${(amount / 1000000).toFixed(2)}M`;
	if (amount > 999) return `${(amount / 1000).toFixed(2)}K`;
	return amount.toFixed(2);
}
