/**
 * The card seam (`docs/design/phase-11.md` §2.2): everything shared code uses from the card family,
 * and the only way it reaches that code. A build that leaves cards out (`PUBLIC_IE_FAMILIES`,
 * `config-vite`) resolves this module to `off/card.ts` instead.
 */
export { default as CardTable } from '../components/CardTable.svelte';
export { startCards } from '../game/cards';
