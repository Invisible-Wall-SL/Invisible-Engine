import type * as Card from '../card';
import Off from './Off.svelte';

/** The card seam in a build without cards (`config-vite` `PUBLIC_IE_FAMILIES`): inert. The boot
 *  refuses a card config first (`game/runtimeFamilies.ts`), so none of it is reached. */
export const CardTable: typeof Card.CardTable = Off;
export const startCards: typeof Card.startCards = () => () => {};
