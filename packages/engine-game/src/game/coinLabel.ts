import type { CoinLabelConfig } from 'engine-layout';

import type { RawSymbol } from './types';

/** The authored formatting a label reads (`doc.coinLabel`), plus the locale's decimal separator so a
 *  fraction can be trimmed in any locale's money. */
export type CoinLabelFormat = Pick<CoinLabelConfig, 'cash' | 'jackpots'> & {
	decimalSeparator?: string;
};

/** A multiple of the total bet as the player's currency; `decimals` asks for at least that many. */
export type CoinLabelMoney = (betMultiple: number, decimals?: number) => string;

/** The most fraction digits a `× bet` label prints before trimming. */
const BET_MULTIPLE_DIGITS = 4;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Drop TRAILING zeros from the one fraction in `text` (the digits after `separator`), keeping at
 * least `keep` of them and the separator only while a digit follows it. Never touches a non-zero
 * digit, so a trimmed amount can never read as a different amount.
 */
export const trimFractionZeros = (text: string, separator: string, keep: number): string =>
	text.replace(new RegExp(`(\\d)${escapeRegExp(separator)}(\\d+)(?!\\d)`), (_, lead, digits) => {
		let fraction: string = digits;
		while (fraction.length > keep && fraction.endsWith('0')) fraction = fraction.slice(0, -1);
		return fraction ? `${lead}${separator}${fraction}` : lead;
	});

/**
 * The text a Hold and Win symbol prints on itself — by the symbol's role (its Game Config
 * `special_properties`):
 *
 * - a jackpot coin: its tier, and the factor a multiplier gave it (`MINI`, `MINI ×2`);
 * - a multiplier: `×3` — a factor, not money;
 * - a payer: `+$4.00` — what it adds to every coin;
 * - a coin, a collector, anything else with a value: the money it is worth (`$1.50`).
 *
 * `money` formats a multiple of the total bet as the player's currency. Null ⇒ print nothing (no
 * value, or a mystery that has not revealed).
 *
 * `format` is the Symbols tool's authored label (`doc.coinLabel`): a tier's own text, and the cash
 * format (money or `× bet`, the fewest decimals, trimmed zeros). Absent ⇒ exactly the coded text.
 */
export const coinLabelText = (
	symbol: Pick<RawSymbol, 'value' | 'jackpot' | 'factor'>,
	roles: readonly string[],
	money: CoinLabelMoney,
	format?: CoinLabelFormat,
): string | null => {
	if (symbol.jackpot !== undefined) {
		const name = format?.jackpots?.[symbol.jackpot]?.text?.trim() || symbol.jackpot;
		return symbol.factor && symbol.factor > 1 ? `${name} ×${symbol.factor}` : name;
	}
	if (symbol.value === undefined || roles.includes('mystery')) return null;
	if (roles.includes('coinMultiplier')) return `×${symbol.value}`;
	const cash = cashText(symbol.value, money, format);
	return roles.includes('payer') ? `+${cash}` : cash;
};

const cashText = (value: number, money: CoinLabelMoney, format?: CoinLabelFormat): string => {
	const cash = format?.cash;
	if (!cash) return money(value);
	const keep = cash.trimZeros ? 0 : cash.decimals;
	if (cash.format === 'betMultiple') {
		return `${trimFractionZeros(value.toFixed(BET_MULTIPLE_DIGITS), '.', keep ?? 0)}×`;
	}
	const text = money(value, cash.decimals);
	return keep === undefined ? text : trimFractionZeros(text, format?.decimalSeparator ?? '.', keep);
};
