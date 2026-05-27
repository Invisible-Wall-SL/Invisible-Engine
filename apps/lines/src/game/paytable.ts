import type { ServerPayEntry } from 'utils-shared/paytable';

import config from './config';
import type { SymbolName } from './types';

// Number of paylines for this game — drives the bet-per-line divisor for
// line-symbol payouts (total bet / numLines). Read from config so it stays
// correct per game.
export const NUM_LINES = Object.keys(config.paylines).length;

// Display order, high-value symbols first; scatter is appended last.
const LINE_ORDER: SymbolName[] = ['W', 'H1', 'H2', 'H3', 'H4', 'L1', 'L2', 'L3', 'L4', 'L5'];

const toLineEntry = (name: SymbolName): ServerPayEntry => {
	const rows = (config.symbols[name] as { paytable?: Record<string, number>[] }).paytable ?? [];
	const occurs: number[] = [];
	const pay: number[] = [];
	for (const row of rows) {
		const [count, value] = Object.entries(row)[0];
		occurs.push(Number(count));
		pay.push(value);
	}
	return { on: { occurs, of: name, mode: 'line' }, pay };
};

// Hardcoded stand-in for the server-delivered paytable (Play4Fun / EAGaming
// `{ on: { occurs, of, mode }, pay, trigger? }` shape). Line multipliers are
// lifted from config.symbols; the scatter is defined here — it pays from x3 on
// the whole total bet. Replace with the real server payload once the RGS
// exposes it.
export const PAYTABLE: ServerPayEntry[] = [
	...LINE_ORDER.filter((name) => name in config.symbols).map(toLineEntry),
	{ on: { occurs: [3, 4, 5], of: 'S', mode: 'scatter' }, pay: [2, 20, 200], trigger: 'feature' },
];
