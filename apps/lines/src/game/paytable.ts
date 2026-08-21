import type { ServerPayEntry } from 'utils-shared/paytable';

import { getActiveGameConfig, getSymbolsInPlay, payoutDivisor } from './gameConfig';
import type { SymbolName } from './types';

/**
 * The display paytable, derived from the ACTIVE game config (Invisible Game Config) rather than the
 * compiled `config.ts` — so a project shows ITS payouts and its line count, not the sample's.
 *
 * Everything here is a function, not a `const`. That is the point: the previous module-scope
 * constants were computed at import time, which is BEFORE the live runtime bundle resolves, so an
 * online game would freeze to the template paytable no matter what it had authored. Reading through
 * `getActiveGameConfig()` on access means the first paint after the bundle lands is already right.
 * Cheap — a handful of symbols and a couple of dozen lines — so there is no memo to go stale.
 */

/**
 * The stake a paytable multiplier is quoted against, as a divisor of the total bet
 * (`buildPayTableRows` computes `base = totalBet / this`).
 *
 * Was `getNumLines()`. It now follows the win model — the line count for a lines game, the WAYS
 * count for a ways game (a spin buys every way, so the per-way stake is `totalBet / ways`), and 1
 * for cluster/scatter, whose multipliers apply to the whole bet. Without this a ways game priced
 * every payout against `totalBet / 20` — the RGS's payline count, which decides nothing there.
 *
 * The name stays `numLines` because `InfoManifest` declares that field; it is only ever used as a
 * divisor and is never rendered as a label. See `payoutDivisor` in `engine-game`.
 */
export const numLines = (): number => payoutDivisor();

/**
 * Display order, high-value first. A PREFERENCE, not a filter: a symbol the config has that isn't
 * named here still appears, after these, in config order. Otherwise a project whose symbols aren't
 * called `H1..L5` would render an EMPTY paytable — the same "the sample is hardcoded into everyone's
 * game" failure this tool exists to remove.
 */
const PREFERRED_ORDER = ['W', 'H1', 'H2', 'H3', 'H4', 'L1', 'L2', 'L3', 'L4', 'L5'];

const toLineEntry = (name: SymbolName, rows: Record<string, number>[]): ServerPayEntry => {
	const occurs: number[] = [];
	const pay: number[] = [];
	for (const row of rows) {
		const [count, value] = Object.entries(row)[0];
		occurs.push(Number(count));
		pay.push(value);
	}
	return { on: { occurs, of: name, mode: 'line' }, pay };
};

/**
 * The paying line symbols, in display order.
 *
 * Gated on the STRIPS, not the dictionary (`getSymbolsInPlay`). `config.symbols` is the symbol
 * DICTIONARY — art, properties, payouts — and legitimately describes symbols a given game does not
 * deal. The upstream sample defines `W` as a wild+multiplier, but neither RGS the engine talks
 * to emits one, so the paytable advertised a 20/10/5 wild the player could never win. The strips are
 * the one statement of what reaches the board, so they are the gate — self-maintaining in both
 * directions: a game whose math DOES deal a wild puts it back on its strips and the row returns with
 * no code change.
 */
function lineEntries(): ServerPayEntry[] {
	const config = getActiveGameConfig();
	const inPlay = new Set(getSymbolsInPlay());
	const names = Object.keys(config.symbols).filter((name) => inPlay.has(name));
	names.sort((a, b) => {
		const ai = PREFERRED_ORDER.indexOf(a);
		const bi = PREFERRED_ORDER.indexOf(b);
		if (ai === bi) return 0;
		if (ai === -1) return 1;
		if (bi === -1) return -1;
		return ai - bi;
	});
	return names.flatMap((name) => {
		const rows = config.symbols[name].paytable;
		return rows?.length ? [toLineEntry(name, rows)] : [];
	});
}

/**
 * The scatter row. Still synthesized: the scatter pays from ×3 on the whole total bet, and those
 * multipliers have no home in the engine config shape, so the config cannot state them yet. The
 * SYMBOL is read from the config (the first in-play one carrying the `scatter` property) instead of
 * assumed to be `S`, so a project that names its scatter differently still gets the right row.
 *
 * This is the last hardcoded corner of the paytable; it goes when the RGS exposes the real payload.
 */
function scatterEntry(): ServerPayEntry | undefined {
	const config = getActiveGameConfig();
	const inPlay = new Set(getSymbolsInPlay());
	const name = Object.keys(config.symbols).find(
		(id) => inPlay.has(id) && config.symbols[id].special_properties?.includes('scatter'),
	);
	if (!name) return undefined;
	return {
		on: { occurs: [3, 4, 5], of: name, mode: 'scatter' },
		pay: [2, 20, 200],
		trigger: 'feature',
	};
}

/**
 * The display paytable, in the server-delivered `{ on: { occurs, of, mode }, pay, trigger? }` shape
 * (Play4Fun / EAGaming). Line multipliers come from the active config; the scatter row is still
 * synthesized — see {@link scatterEntry}.
 */
export function paytable(): ServerPayEntry[] {
	const scatter = scatterEntry();
	return scatter ? [...lineEntries(), scatter] : lineEntries();
}
