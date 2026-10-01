import type { RawSymbol } from './types';

/**
 * The text a Hold and Win symbol prints on itself — the coded default until the Symbols tool
 * authors the label (Phase 7). By the symbol's role (its Game Config `special_properties`):
 *
 * - a jackpot coin: its tier, and the factor a multiplier gave it (`MINI`, `MINI ×2`);
 * - a multiplier: `×3` — a factor, not money;
 * - a payer: `+$4.00` — what it adds to every coin;
 * - a coin, a collector, anything else with a value: the money it is worth (`$1.50`).
 *
 * `money` formats a multiple of the total bet as the player's currency. Null ⇒ print nothing (no
 * value, or a mystery that has not revealed).
 */
export const coinLabelText = (
	symbol: Pick<RawSymbol, 'value' | 'jackpot' | 'factor'>,
	roles: readonly string[],
	money: (betMultiple: number) => string,
): string | null => {
	if (symbol.jackpot !== undefined) {
		return symbol.factor && symbol.factor > 1
			? `${symbol.jackpot} ×${symbol.factor}`
			: symbol.jackpot;
	}
	if (symbol.value === undefined || roles.includes('mystery')) return null;
	if (roles.includes('coinMultiplier')) return `×${symbol.value}`;
	if (roles.includes('payer')) return `+${money(symbol.value)}`;
	return money(symbol.value);
};
