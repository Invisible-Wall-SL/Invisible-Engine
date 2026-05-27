import { stateBetDerived } from 'state-shared';

import { numberToCurrencyString } from './amount';

// Server-delivered paytable entry (Play4Fun / EAGaming math export shape).
// `occurs` and `pay` are parallel arrays: occurs[i] symbols on a line pays pay[i].
//   { on: { occurs: [2,3,4,5], of: 'PIC1', mode: 'line' }, pay: [10,100,1000,5000] }
//   { on: { occurs: [3,4,5], of: 'SCAT', mode: 'scatter' }, pay: [2,20,200], trigger: 'feature' }
export type PayTableMode = 'line' | 'scatter';

export type ServerPayEntry = {
	on: { occurs: number[]; of: string; mode: PayTableMode };
	pay: number[];
	trigger?: string;
};

export type PayoutCell = {
	occurs: number;
	multiplier: number;
	amount: number;
	amountText: string;
};

export type PayoutRow = {
	symbol: string;
	mode: PayTableMode;
	trigger?: string;
	// highest occurs first (x5, x4, x3 …) to match the EAGaming info-page layout
	payouts: PayoutCell[];
};

// EAGaming convention:
//   line symbols   → multiplier is applied to the bet-per-line (totalBet / numLines)
//   scatter symbol → multiplier is applied to the whole total bet, on every line
// Amounts are formatted with the active currency/locale, recomputed whenever the
// player's bet changes (call inside a $derived to stay reactive).
export const buildPayTableRows = (
	paytable: ServerPayEntry[],
	numLines: number,
): PayoutRow[] => {
	const totalBet = stateBetDerived.betCost();
	const betPerLine = numLines > 0 ? totalBet / numLines : 0;

	return paytable.map((entry) => {
		const base = entry.on.mode === 'scatter' ? totalBet : betPerLine;

		const payouts = entry.on.occurs
			.map((occurs, i) => {
				const multiplier = entry.pay[i] ?? 0;
				const amount = multiplier * base;
				return { occurs, multiplier, amount, amountText: numberToCurrencyString(amount) };
			})
			.sort((a, b) => b.occurs - a.occurs);

		return { symbol: entry.on.of, mode: entry.on.mode, trigger: entry.trigger, payouts };
	});
};
