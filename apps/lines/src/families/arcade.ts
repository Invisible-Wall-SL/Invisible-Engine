/**
 * The arcade seam (`docs/design/phase-11.md` §2.2): everything shared code uses from the arcade
 * family — the play field and the online room it may join (`engine-rooms`, with `@colyseus/sdk`) —
 * and the only way it reaches that code. A build that leaves arcade out (`PUBLIC_IE_FAMILIES`,
 * `config-vite`) resolves this module to `off/arcade.ts` instead.
 */
import { ARCADE_LOOP_ACTIONS, ARCADE_VOCAB, type TemplateVocabulary } from 'engine-flow-v2';

export { default as ArcadeStage } from '../components/ArcadeStage.svelte';
export { joinOnlineRoom } from '../game/online';

/** The family's Flow vocabulary, keyed by `templateId` (`flowV2Runtime`'s registry). */
export const flowVocabularies: Readonly<Record<string, TemplateVocabulary>> = {
	[ARCADE_VOCAB.templateId]: ARCADE_VOCAB,
};
/** The Flow actions the family's mechanic backs (`flowV2Runtime`'s coverage guard). */
export const flowBoardActions: readonly string[] = ARCADE_LOOP_ACTIONS;
