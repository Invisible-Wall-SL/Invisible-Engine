/**
 * Invisible Flow v2 — the TEMPLATE VOCABULARY registry (schema §7).
 *
 * A `FlowDoc.templateId` names which template's `TemplateVocabulary` it targets; the editor + game
 * look it up here instead of hardcoding a single import, so adding a template later is a data change
 * (register its vocab) rather than an edit to every consumer. An unknown id falls back to the
 * reference `bookOf` vocab so a partially-configured project never renders a blank palette / an
 * un-typed graph.
 */

import type { TemplateVocabulary } from '../types';
import { BOOK_OF_VOCAB } from './bookOf';
import { CLUSTER_VOCAB } from './cluster';
import { WAYS_VOCAB } from './ways';

/** Every registered template vocabulary, keyed by `templateId`. */
export const TEMPLATE_VOCABULARIES: Record<string, TemplateVocabulary> = {
	[BOOK_OF_VOCAB.templateId]: BOOK_OF_VOCAB,
	[WAYS_VOCAB.templateId]: WAYS_VOCAB,
	[CLUSTER_VOCAB.templateId]: CLUSTER_VOCAB,
};

/**
 * Resolve the vocabulary for a `templateId`. Falls back to the reference `bookOf` vocab for an
 * unknown/absent id (parity-safe — the editor + game always have a usable contract). The editor
 * passes `doc.templateId`; the game passes the loaded v2 doc's `templateId`.
 *
 * The fallback is a floor, not a router: it offers the Book-of mechanic's surfaces to a project
 * that never declared it, so a game type with a vocabulary of its own must be REGISTERED above —
 * `ways` rode this fallback until it was.
 */
export const templateVocabulary = (templateId: string | undefined): TemplateVocabulary =>
	(templateId ? TEMPLATE_VOCABULARIES[templateId] : undefined) ?? BOOK_OF_VOCAB;
