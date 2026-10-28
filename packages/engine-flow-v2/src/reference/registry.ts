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
import { ARCADE_VOCAB } from './arcade';
import { BOOK_OF_VOCAB } from './bookOf';
import { CARD_VOCAB } from './cards';
import { CLUSTER_VOCAB } from './cluster';
import { HOLD_AND_WIN_VOCAB } from './holdAndWin';
import { MATCH3_VOCAB } from './match3';
import { SCATTER_VOCAB } from './scatter';
import { WAYS_VOCAB } from './ways';

/**
 * `list` keyed by `templateId`, in order. A call the bundler may drop when its result is unused
 * (`@__PURE__` at the call sites): an object literal of `.templateId` reads is kept for their
 * possible side effects, and with it every module it names, so a game runtime that never read
 * these registries still bundled every family's vocabulary and seed (`docs/design/phase-11.md`).
 */
export const byTemplateId = <T extends { templateId: string }>(
	list: readonly T[],
): Record<string, T> => Object.fromEntries(list.map((entry) => [entry.templateId, entry]));

/**
 * The slot templates' vocabularies alone. The game runtime starts from these and adds the families
 * its build carries (`apps/lines/src/families/*`, `docs/design/phase-11.md` §2.2), so a runtime
 * without a family never bundles that family's words.
 */
export const SLOT_TEMPLATE_VOCABULARIES: Readonly<Record<string, TemplateVocabulary>> =
	/* @__PURE__ */ byTemplateId([
		BOOK_OF_VOCAB,
		WAYS_VOCAB,
		CLUSTER_VOCAB,
		SCATTER_VOCAB,
		HOLD_AND_WIN_VOCAB,
	]);

/** Every registered template vocabulary, keyed by `templateId`. */
export const TEMPLATE_VOCABULARIES: Record<string, TemplateVocabulary> =
	/* @__PURE__ */ byTemplateId([
		BOOK_OF_VOCAB,
		WAYS_VOCAB,
		CLUSTER_VOCAB,
		SCATTER_VOCAB,
		HOLD_AND_WIN_VOCAB,
		MATCH3_VOCAB,
		ARCADE_VOCAB,
		CARD_VOCAB,
	]);

/**
 * What an id that is not a registered template (an author-created custom kind, an absent
 * `templateId`) resolves to. It offers the Book-of mechanic's surfaces to a project that never
 * declared them, so a game type with a vocabulary of its own must be REGISTERED — `ways` rode this
 * floor until it was.
 */
export const UNREGISTERED_TEMPLATE_FALLBACK = BOOK_OF_VOCAB.templateId;

/**
 * Built-in kinds that have no vocabulary of their own yet, and the template each one borrows — named
 * so the borrowing is visible rather than a silent floor. An entry may name another entry and the
 * chain is followed, so a kind that borrowed `lines` would move with it when `lines` gets its own.
 *  - `lines`: the shared runtime's reference vocabulary is the Book-of one (parity).
 */
export const VOCABULARY_FALLBACKS: Readonly<Record<string, string>> = {
	lines: BOOK_OF_VOCAB.templateId,
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
 * The vocabulary for a `templateId` in a given registry, by the rule of {@link templateVocabulary}.
 * The registry must hold {@link UNREGISTERED_TEMPLATE_FALLBACK}; every one built on
 * {@link SLOT_TEMPLATE_VOCABULARIES} does.
 */
export const vocabularyIn = (
	registered: Readonly<Record<string, TemplateVocabulary>>,
	templateId: string | undefined,
): TemplateVocabulary =>
	registered[
		resolveTemplateId(templateId, registered, VOCABULARY_FALLBACKS, UNREGISTERED_TEMPLATE_FALLBACK)
	];

/**
 * Resolve the vocabulary for a `templateId` (the editor passes `doc.templateId`; the game passes the
 * loaded v2 doc's `templateId`) — its own when registered, else through {@link VOCABULARY_FALLBACKS},
 * else {@link UNREGISTERED_TEMPLATE_FALLBACK}. Never undefined: the editor + game always have a
 * usable contract.
 */
export const templateVocabulary = (templateId: string | undefined): TemplateVocabulary =>
	vocabularyIn(TEMPLATE_VOCABULARIES, templateId);
