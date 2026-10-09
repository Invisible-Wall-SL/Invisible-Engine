import { shownPaytable } from 'game-config';
import type { ServerPayEntry } from 'utils-shared/paytable';

import { activePaytableInputs, payoutDivisor } from './gameConfig';

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

const rank = (entry: ServerPayEntry): number => {
	const i = PREFERRED_ORDER.indexOf(entry.on.of);
	return i === -1 ? PREFERRED_ORDER.length : i;
};

/**
 * The display paytable, in the server-delivered `{ on: { occurs, of, mode }, pay, trigger? }` shape
 * (Play4Fun / EAGaming): `game-config`'s `shownPaytable` — the SAME rows `/config` and the publish
 * gate compare with a partner's declared table — with the line rows in display order.
 *
 * Gated on the STRIPS, not the dictionary (`getSymbolsInPlay`). `config.symbols` is the symbol
 * DICTIONARY and legitimately describes symbols a given game does not deal — the upstream sample
 * defines a `W` neither RGS the engine talks to emits, so the paytable advertised a wild the player
 * could never win. The strips are the one statement of what reaches the board.
 *
 * The scatter row is the scatter symbol's own authored `paytable` (× total bet), or the default row
 * when it authors none.
 *
 * While a spins bonus mode is on top it is THAT game's table — its own pays, the symbols its strips
 * deal (`activePaytableInputs`), priced against its own divisor — beside its paylines and grid, which
 * the info page already reads off the mode.
 */
export function paytable(): ServerPayEntry[] {
	const { symbols, inPlay } = activePaytableInputs();
	const entries = shownPaytable(symbols, inPlay);
	const lines = entries.filter((entry) => entry.on.mode !== 'scatter');
	const scatter = entries.find((entry) => entry.on.mode === 'scatter');
	lines.sort((a, b) => rank(a) - rank(b));
	return scatter ? [...lines, { ...scatter, trigger: 'feature' }] : lines;
}
