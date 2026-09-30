/**
 * Invisible Flow v2 — the TEMPLATE VOCABULARY registry (schema §7).
 *
 * A `FlowDoc.templateId` names which template's `TemplateVocabulary` it targets; the editor + game
 * look it up here instead of hardcoding a single import, so adding a template later is a data change
 * (register its vocab) rather than an edit to every consumer. An id with no vocabulary of its own
 * resolves through {@link VOCABULARY_FALLBACKS} and then {@link UNREGISTERED_TEMPLATE_FALLBACK}, so
 * a partially-configured project never renders a blank palette / an un-typed graph.
 */

import type { TemplateVocabulary } from '../types';
import { BOOK_OF_VOCAB } from './bookOf';
import { CLUSTER_VOCAB } from './cluster';
import { SCATTER_VOCAB } from './scatter';
import { WAYS_VOCAB } from './ways';

/** Every registered template vocabulary, keyed by `templateId`. */
export const TEMPLATE_VOCABULARIES: Record<string, TemplateVocabulary> = {
	[BOOK_OF_VOCAB.templateId]: BOOK_OF_VOCAB,
	[WAYS_VOCAB.templateId]: WAYS_VOCAB,
	[CLUSTER_VOCAB.templateId]: CLUSTER_VOCAB,
	[SCATTER_VOCAB.templateId]: SCATTER_VOCAB,
};

/**
 * What an id that is not a registered template (an author-created custom kind, an absent
 * `templateId`) resolves to. It offers the Book-of mechanic's surfaces to a project that never
 * declared them, so a game type with a vocabulary of its own must be REGISTERED — `ways` rode this
 * floor until it was.
 */
export const UNREGISTERED_TEMPLATE_FALLBACK = BOOK_OF_VOCAB.templateId;

/**
 * Built-in kinds that have no vocabulary of their own yet, and the template each one borrows — named
 * so the borrowing is visible rather than a silent floor. A chain resolves (`holdAndWin` → `lines` →
 * `bookOf`), so a kind that follows `lines` moves with it when `lines` gets its own.
 *  - `lines`: the shared runtime's reference vocabulary is the Book-of one (parity).
 *  - `holdAndWin`: plays as a lines game until Hold and Win Phase 5 registers its vocabulary.
 */
export const VOCABULARY_FALLBACKS: Readonly<Record<string, string>> = {
	lines: BOOK_OF_VOCAB.templateId,
	holdAndWin: 'lines',
};

/**
 * Follow `fallbacks` from `id` to an id `registered` holds, else `floor`. Shared by the vocabulary
 * registry and the driven-seed registry so both resolve a kind the same way.
 */
export function resolveTemplateId(
	id: string | undefined,
	registered: Readonly<Record<string, unknown>>,
	fallbacks: Readonly<Record<string, string>>,
	floor: string,
): string {
	const seen = new Set<string>();
	let current = id;
	while (current && !seen.has(current)) {
		if (Object.hasOwn(registered, current)) return current;
		seen.add(current);
		current = Object.hasOwn(fallbacks, current) ? fallbacks[current] : undefined;
	}
	return floor;
}

/**
 * Resolve the vocabulary for a `templateId` (the editor passes `doc.templateId`; the game passes the
 * loaded v2 doc's `templateId`) — its own when registered, else through {@link VOCABULARY_FALLBACKS},
 * else {@link UNREGISTERED_TEMPLATE_FALLBACK}. Never undefined: the editor + game always have a
 * usable contract.
 */
export const templateVocabulary = (templateId: string | undefined): TemplateVocabulary =>
	TEMPLATE_VOCABULARIES[
		resolveTemplateId(
			templateId,
			TEMPLATE_VOCABULARIES,
			VOCABULARY_FALLBACKS,
			UNREGISTERED_TEMPLATE_FALLBACK,
		)
	];
