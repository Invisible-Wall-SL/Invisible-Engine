import { SLOT_TEMPLATE_VOCABULARIES, type TemplateVocabulary } from 'engine-flow-v2';

import {
	flowBoardActions as arcadeActions,
	flowVocabularies as arcadeVocabularies,
} from '../families/arcade';
import {
	flowBoardActions as cardActions,
	flowVocabularies as cardVocabularies,
} from '../families/card';
import {
	flowBoardActions as match3Actions,
	flowVocabularies as match3Vocabularies,
} from '../families/match3';

/**
 * The template vocabularies this build plays: the slot ones and each family it carries (the
 * `families/*` seams, `docs/design/phase-11.md` §2.2), so a runtime without a family never bundles
 * that family's words. In an `all` build it holds exactly `engine-flow-v2`'s `TEMPLATE_VOCABULARIES`.
 */
export const runtimeVocabularies = (): Readonly<Record<string, TemplateVocabulary>> => ({
	...SLOT_TEMPLATE_VOCABULARIES,
	...match3Vocabularies,
	...arcadeVocabularies,
	...cardVocabularies,
});

/** Every family action a vocabulary may declare, backed or not yet (the vocabulary coverage check). */
export const familyBoardActions = (): readonly string[] => [
	...match3Actions,
	...arcadeActions,
	...cardActions,
];
