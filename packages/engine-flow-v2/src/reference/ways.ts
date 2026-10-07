/**
 * Invisible Flow v2 — the `ways` template vocabulary.
 *
 * A ways game runs the SAME shared runtime as lines/book-of and adds no mechanic of its own: its
 * `BookEvent` union is a strict SUBSET of the lines one (`apps/ways/src/game/typesBookEvent.ts` —
 * no tumble, no expanding symbol), and its `winInfo` payload is identical field-for-field. So its
 * whole vocabulary is the standard one. Its symbols, like every kind's, come from the project's
 * Game Config (`withSymbols`).
 *
 * Before this existed, `templateVocabulary()` fell back to `BOOK_OF_VOCAB` for an unrecognised id,
 * so a ways project was silently offered the Book-of palette — including `setSpecialSymbol`,
 * `expandBookColumns` and the reveal cues, which no ways book event ever fires.
 */

import type { TemplateVocabulary } from '../types';

import { standardVocabulary } from './standardVocab';

export const WAYS_VOCAB: TemplateVocabulary = standardVocabulary({ templateId: 'ways' });
