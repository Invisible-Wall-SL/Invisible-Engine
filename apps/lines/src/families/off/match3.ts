import type * as Match3 from '../match3';
import Off from './Off.svelte';

/** The match-3 seam in a build without match-3 (`config-vite` `PUBLIC_IE_FAMILIES`): inert. The
 *  boot refuses a match-3 config first (`game/runtimeFamilies.ts`), so none of it is reached. */
export const Match3Input: typeof Match3.Match3Input = Off;
export const awaitMatch3Round: typeof Match3.awaitMatch3Round = async () => {};
export const endMatch3Round: typeof Match3.endMatch3Round = async () => {};
export const presentMatch3Board: typeof Match3.presentMatch3Board = async () => {};
export const presentMatch3MovesLeft: typeof Match3.presentMatch3MovesLeft = () => {};
export const flowVocabularies: typeof Match3.flowVocabularies = {};
export const flowBoardActions: typeof Match3.flowBoardActions = [];
