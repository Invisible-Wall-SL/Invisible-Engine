/**
 * Invisible Engine — the online room client: the one place the game layer reaches
 * `@colyseus/sdk` (`docs/design/realtime-multiplayer.md`).
 *
 * A workspace package rather than a dependency of `apps/lines`, because a standalone game repo
 * compiles `engine/apps/lines/src` but installs from its OWN root `package.json`, written once at
 * scaffold time. A third-party package `apps/lines` declares never reaches that file, so the build
 * fails to resolve it; an engine workspace package installs its own dependencies, and the desktop
 * launcher declares any the game repo predates (`docs/design/games-deploy.md`). Import it
 * dynamically: an offline game must never load the SDK.
 */
export * from './src/client';
