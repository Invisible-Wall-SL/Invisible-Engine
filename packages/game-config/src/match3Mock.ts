/**
 * What the mock RGS deals a match-3 game from (`scripts/mock-rgs-server-match3.mjs`), in the
 * config's OWN symbol names — the match-3 wire speaks them (`docs/reference/match3-wire.md`). One
 * derivation, read by the launcher's mock contract and by the wire gate, so the gate proves the
 * rounds the test server actually deals.
 */

import { resolveFamily, resolveMatch3 } from './family';
import type { GameConfigDoc } from './types';

export type Match3MockInputs = {
	cols: number;
	rows: number;
	/** One refill strip per column, as names: the `basegame` padding set, else the first set. */
	strips: string[][];
	minRun: number;
	/** The moves a round allows; absent ⇒ the mock's own default. */
	moves?: number;
	/** Per symbol, group size → multiplier of the whole stake (the `match3` win model). */
	paytable: Record<string, Record<string, number>>;
};

/** The mock's inputs for a match-3 doc, or `undefined` for any other family. */
export function match3MockInputs(doc: GameConfigDoc): Match3MockInputs | undefined {
	if (resolveFamily(doc) !== 'match3') return undefined;
	const sets = doc.paddingReels ?? {};
	const set = sets.basegame ?? Object.values(sets)[0];
	if (!set?.length) return undefined;
	const strips = set.map((strip) => strip.map((cell) => cell.name));
	const dealt = new Set(strips.flat());
	const paytable: Record<string, Record<string, number>> = {};
	for (const [name, symbol] of Object.entries(doc.symbols ?? {})) {
		if (!dealt.has(name)) continue;
		const row: Record<string, number> = {};
		for (const entry of symbol.paytable ?? []) {
			for (const [count, pay] of Object.entries(entry)) {
				if (typeof pay === 'number' && Number.isFinite(pay) && pay > 0) row[count] = pay;
			}
		}
		if (Object.keys(row).length) paytable[name] = row;
	}
	const { minRun, moves } = resolveMatch3(doc);
	return {
		cols: doc.numReels,
		rows: doc.numRows[0],
		strips,
		minRun,
		...(moves === undefined ? {} : { moves }),
		paytable,
	};
}
