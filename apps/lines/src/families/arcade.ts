/**
 * The arcade seam (`docs/design/phase-11.md` §2.2): everything shared code uses from the arcade
 * family — the play field and the online room it may join (`engine-rooms`, with `@colyseus/sdk`) —
 * and the only way it reaches that code. A build that leaves arcade out (`PUBLIC_IE_FAMILIES`,
 * `config-vite`) resolves this module to `off/arcade.ts` instead.
 */
export { default as ArcadeStage } from '../components/ArcadeStage.svelte';
export { joinOnlineRoom } from '../game/online';
