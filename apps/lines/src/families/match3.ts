/**
 * The match-3 seam (`docs/design/phase-11.md` §2.2): everything shared code uses from the match-3
 * family, and the only way it reaches that code. A build that leaves match-3 out
 * (`PUBLIC_IE_FAMILIES`, `config-vite`) resolves this module to `off/match3.ts` instead.
 */
import { MATCH3_BOARD_ACTIONS, MATCH3_VOCAB, type TemplateVocabulary } from 'engine-flow-v2';

export { default as Match3Input } from '../components/Match3Input.svelte';
export {
	awaitMatch3Round,
	endMatch3Round,
	presentMatch3Board,
	presentMatch3MovesLeft,
} from '../game/match3.svelte';

/** The family's Flow vocabulary, keyed by `templateId` (`flowV2Runtime`'s registry). */
export const flowVocabularies: Readonly<Record<string, TemplateVocabulary>> = {
	[MATCH3_VOCAB.templateId]: MATCH3_VOCAB,
};
/** The Flow actions the family's mechanic backs (`flowV2Runtime`'s coverage guard). */
export const flowBoardActions: readonly string[] = MATCH3_BOARD_ACTIONS;
