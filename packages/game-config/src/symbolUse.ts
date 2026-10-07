import { symbolsInPlay } from './inPlay';
import { resolveMeters } from './potsOverlay';
import type { GameConfigDoc } from './types';

/**
 * What a symbol is FOR on the board — the one answer to "is this symbol unused?". Invisible Game
 * Config badges each dictionary symbol with it and Invisible Symbols lists exactly the symbols it does
 * not call `unused`, so the two tools cannot disagree about a symbol (`check:symbols-follow-config`).
 *
 * - `inPlay` — a reel strip deals it: THE GATE, {@link symbolsInPlay}.
 * - `token` — a pots overlay drops it OVER a cell. It is never on a strip, yet the board draws it, so
 *   it needs art like any dealt symbol. On a strip as well, it is `inPlay` (the validator's error).
 * - `unused` — neither: a dictionary entry that never reaches the board.
 */
export type SymbolUse = 'inPlay' | 'token' | 'unused';

/**
 * Every symbol the config names, with its use: each dictionary entry, plus any name a strip deals or
 * a pot drops without one (a validator error, but still drawn).
 */
export function symbolUses(doc: GameConfigDoc): Record<string, SymbolUse> {
	const uses: Record<string, SymbolUse> = {};
	for (const name of Object.keys(doc.symbols)) uses[name] = 'unused';
	for (const meter of resolveMeters(doc)) {
		if (meter.source === 'overlay' && meter.symbol) uses[meter.symbol] = 'token';
	}
	for (const name of symbolsInPlay(doc)) uses[name] = 'inPlay';
	return uses;
}

/** Every symbol the board can show, sorted: the strips' and the overlay's tokens. */
export const symbolsUsed = (doc: GameConfigDoc): string[] =>
	Object.entries(symbolUses(doc))
		.filter(([, use]) => use !== 'unused')
		.map(([name]) => name)
		.sort();
