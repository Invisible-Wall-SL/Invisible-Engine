import { SYMBOL_STATES, type SymbolCell } from './symbolsStorage';
import linesDefaults from '$lib/data/symbolDefaults/lines.json';

/**
 * Coded symbol defaults — the dev-parity twin of each game's `SYMBOL_INFO_MAP`,
 * generated from the engine truth and committed under `$lib/data/symbolDefaults/`.
 * They are the grid's SOURCE OF TRUTH for the symbol list, the fixed state set,
 * and the DEFAULT binding of every cell. The authored R2 doc (`symbolsStorage`)
 * is a SPARSE override layered ON TOP of this map, cell by cell.
 *
 * v1 ships only `lines.json`; a project selects its set by `doc.gameType`, with
 * `lines` as the fallback. Mirrors how the editor's `defaultLayout('lines')`
 * imports its basegame truth. See `docs/design/invisible-symbols-state-machine.md`.
 */

export type SymbolState = (typeof SYMBOL_STATES)[number];

/** A coded default binding — same shape as an authored cell. */
export type DefaultCell = SymbolCell;

export interface SymbolDefaults {
	version: number;
	gameType: string;
	/** symbol name → state → coded default binding (dense over the authored states). */
	symbols: Record<string, Partial<Record<SymbolState, DefaultCell>>>;
}

const DEFAULTS_BY_GAME: Record<string, SymbolDefaults> = {
	lines: linesDefaults as SymbolDefaults,
};

const FALLBACK_GAME = 'lines';

/** Resolve the coded defaults for a game type, falling back to `lines` (v1). */
export function symbolDefaultsFor(gameType: string | undefined): SymbolDefaults {
	return DEFAULTS_BY_GAME[gameType ?? FALLBACK_GAME] ?? DEFAULTS_BY_GAME[FALLBACK_GAME];
}
