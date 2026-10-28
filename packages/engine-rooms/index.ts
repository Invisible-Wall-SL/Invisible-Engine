/**
 * Invisible Engine — the online room client: the one place the game layer reaches `@colyseus/sdk`.
 * A workspace package rather than an `apps/lines` dependency so game repos can install it
 * (`docs/design/games-deploy.md`). Import it dynamically: an offline game must never load the SDK.
 * The SDK's own prediction is a separate entry, `engine-rooms/predict`, imported only by a game
 * whose `arcade.online.netcode` is `colyseus`.
 */
export * from './src/client';
