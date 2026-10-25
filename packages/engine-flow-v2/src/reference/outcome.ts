/**
 * Invisible Flow v2 — the vocabulary layered by WHO DECIDES THE ROUND
 * (`docs/design/game-families.md` §2.2 #2). {@link withOutcome} is applied wherever a vocabulary is
 * resolved for a project — the `/flow-v2` editor, the publish gate and the game — the way
 * `withAddOns` layers add-ons.
 *
 * In an RGS-decided game the server deals, refills and resolves the board, so the actions that
 * decide it locally (`MATCH3_RULES_ONLY_ACTIONS`) are not offered, and a doc that still calls one
 * is refused with `rules-only-in-rgs` (`validate.ts`). Money is guarded by
 * `variable-shadows-money`.
 */

import type { TemplateVocabulary } from '../types';
import { MATCH3_RULES_ONLY_ACTIONS } from './match3';

/** Who decides a round: the server (`rgs`, every slot) or the game's own Flow and board
 *  (`rules`). Structural, because this package depends on no config package (`game-config`'s
 *  `GameOutcome`). */
export type FlowOutcome = 'rgs' | 'rules';

/** Is `action` one only a rules-decided game may call, called while `outcome` is not `rules`?
 *  Absent ⇒ the RGS, as for every slot. */
export const isRulesOnlyInRgs = (action: string, outcome: FlowOutcome | undefined): boolean =>
	outcome !== 'rules' && MATCH3_RULES_ONLY_ACTIONS.includes(action);

/**
 * A vocabulary for a game whose rounds `outcome` decides: for `rgs`, without the rules-only board
 * actions. `rules`, absent, or a vocabulary that has none of them ⇒ `vocab` itself, identity
 * included, so every slot vocabulary resolves exactly as before.
 */
export function withOutcome(
	vocab: TemplateVocabulary,
	outcome: FlowOutcome | undefined,
): TemplateVocabulary {
	if (outcome !== 'rgs') return vocab;
	const actions = vocab.actions.filter((a) => !MATCH3_RULES_ONLY_ACTIONS.includes(a.name));
	return actions.length === vocab.actions.length ? vocab : { ...vocab, actions };
}
