/**
 * Invisible Flow v2 — a project's SYMBOLS.
 *
 * Which symbols a game deals is a property of its Game Config, never of its kind: a lines project may
 * drop `W`, a ways project may add `H6`, a pots overlay adds its coins. So every vocabulary declares
 * the one {@link SYMBOL_ENUM} enum EMPTY, and {@link withSymbols} supplies the project's symbols —
 * `game-config`'s `symbolsUsed(doc)` (this package depends on no config package, so the caller
 * passes the list in). An empty list means the project's symbols are UNKNOWN (the game, the publish
 * gate, a bare harness): the validator then judges no symbol literal.
 */

import type { TemplateVocabulary } from './types';

/** The enum every symbol-typed pin, field and param names. */
export const SYMBOL_ENUM = 'SymbolName';

/** The symbols a vocabulary offers — empty when the project's symbols are unknown. */
export const symbolsOf = (vocab: TemplateVocabulary): readonly string[] =>
	vocab.enums.find((entry) => entry.name === SYMBOL_ENUM)?.values ?? [];

/**
 * `vocab` with the project's `symbols` (deduped, in order) as its {@link SYMBOL_ENUM} values. No
 * symbols ⇒ `vocab` itself, identity included, like `withAddOns`.
 */
export function withSymbols(
	vocab: TemplateVocabulary,
	symbols: readonly string[],
): TemplateVocabulary {
	if (symbols.length === 0) return vocab;
	const values = [...new Set(symbols)];
	return {
		...vocab,
		enums: vocab.enums.map((entry) => (entry.name === SYMBOL_ENUM ? { ...entry, values } : entry)),
	};
}
