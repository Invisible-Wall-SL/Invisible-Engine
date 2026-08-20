/**
 * Invisible Flow v2 — the `ways` template vocabulary.
 *
 * A ways game runs the SAME shared runtime as lines/book-of and adds no mechanic of its own: its
 * `BookEvent` union is a strict SUBSET of the lines one (`apps/ways/src/game/typesBookEvent.ts` —
 * no tumble, no expanding symbol), and its `winInfo` payload is identical field-for-field. So its
 * whole vocabulary is the standard one; the only per-type value is the symbol set.
 *
 * Before this existed, `templateVocabulary()` fell back to `BOOK_OF_VOCAB` for an unrecognised id,
 * so a ways project was silently offered the Book-of palette — including `setSpecialSymbol`,
 * `expandBookColumns` and the reveal cues, which no ways book event ever fires.
 */

import type { TemplateVocabulary } from '../types';

import { standardVocabulary } from './standardVocab';

/**
 * `apps/ways` `config.symbols` keys. Deliberately NOT the lines set: ways ships `H5` and no `L5`,
 * so sharing one hardcoded list would put a symbol in the dropdown that the game never deals.
 */
const WAYS_SYMBOLS = ['H1', 'H2', 'H3', 'H4', 'H5', 'L1', 'L2', 'L3', 'L4', 'S', 'W'] as const;

export const WAYS_VOCAB: TemplateVocabulary = standardVocabulary({
	templateId: 'ways',
	symbolNames: WAYS_SYMBOLS,
});
