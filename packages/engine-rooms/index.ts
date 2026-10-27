/**
 * Invisible Engine — the online room client: the one place the game layer reaches `@colyseus/sdk`.
 * A workspace package rather than an `apps/lines` dependency so game repos can install it
 * (`docs/design/games-deploy.md`). Import it dynamically: an offline game must never load the SDK.
 * `Predict` is the SDK's own prediction, used by a game whose `arcade.online.netcode` is `colyseus`.
 */
export * from './src/client';
export { Client, Predict } from '@colyseus/sdk';
export type { Reconciler, Room } from '@colyseus/sdk';
