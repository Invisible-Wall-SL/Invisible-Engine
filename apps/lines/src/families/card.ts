/**
 * The card seam (`docs/design/phase-11.md` §2.2): everything shared code uses from the card family,
 * and the only way it reaches that code. A build that leaves cards out (`PUBLIC_IE_FAMILIES`,
 * `config-vite`) resolves this module to `off/card.ts` instead.
 */
import { CARD_MATCH_ACTIONS, CARD_VOCAB, type TemplateVocabulary } from 'engine-flow-v2';

export { default as CardTable } from '../components/CardTable.svelte';
export { startCards } from '../game/cards';

/** The family's Flow vocabulary, keyed by `templateId` (`flowV2Runtime`'s registry). */
export const flowVocabularies: Readonly<Record<string, TemplateVocabulary>> = {
	[CARD_VOCAB.templateId]: CARD_VOCAB,
};
/** The Flow actions the family's mechanic backs (`flowV2Runtime`'s coverage guard). */
export const flowBoardActions: readonly string[] = CARD_MATCH_ACTIONS;
