# Cluster — family knowledge

What is always true about the `cluster` kind (cluster pays plus its cascade/tumble) and what has
broken it before. Owner agent: `cluster-games`.

## What it is and must stay

- A cluster game pays a **connected group** of one symbol, `minCluster` cells or more, joined
  orthogonally (default) or also diagonally. Wilds join groups; one wild can join groups of
  different symbols at once. There are no paylines.
- Winners **tumble**: the paying cells explode, survivors fall, the gaps refill from above, and the
  new board is scored again until a board pays nothing. A dead spin never tumbles.
- It is a **slot kind in the shared runtime** (`apps/lines`, the `_runtime/lines` bundle), selected
  by data: the kind in `packages/constants-shared/gameKinds.ts`, the win model
  `{ type: 'cluster', minCluster, adjacency }` in the project's Game Config, and `cascade` (absent ⇒
  the win model's default, which is on for cluster). There is no cluster fork of the runtime.
- `apps/cluster` is the **vanilla upstream sample**, reference only. Nothing builds or publishes it
  (`runtimeFor` in `apps/launcher-api/src/lib/server/publishGame.ts`, `SEED_APP` in
  `scripts/new-game.mjs`). Its config ships empty `paddingReels`, so there is no committed cluster
  config default; an un-authored cluster project plays the compiled lines config.
- The client never decides a win. The RGS sends the wins with their cells; the engine presents them.
- Math is locked: paytable, `minCluster`, adjacency, strips and the cascade switch change only in
  Game Config, by a person.

## Invariants

- **Payout divisor is 1** (a cluster pays against the whole base bet). Client: `payoutDivisor()` in
  `packages/engine-game/src/game/gameConfig.ts`. Mock: `payoutBaseFor` in
  `scripts/mock-rgs-server.mjs`. The two must mirror; `pnpm check:stake` holds them together.
- **Wins price off `round.baseTotal`, never `round.total`**, so a bought round does not pay 100×
  over (`payoutBaseFor`).
- **A cluster win's context is a bare array of `{reel,row}`**, one per cell, with `cluster` (the
  size) riding on it. The facade's `winPositions` reads only that shape
  (`packages/rgs-translator-eagaming/src/engineFacade.ts`). Pinned by `pnpm check:cluster`.
- **A paytable row is a threshold** ("8+"): the highest priced tier at or below the group size pays
  (`evaluateClusters`). A group below `minCluster` or below the table's floor pays nothing.
- **Read the model and the cascade through their resolvers**, never the raw doc fields:
  `resolveWinModel()` (`packages/game-config/src/winModel.ts`), `resolveCascade()`
  (`packages/game-config/src/mechanics.ts`). `cascade` is stored only when it departs from the
  model's default (`packages/game-config/cascade.fixture.ts`).
- **Tools ask `kindCapabilities()`** (`packages/engine-layout/src/lib/kindCapabilities.ts`), not
  `gameType === 'cluster'`. Cluster is a cascade kind and a non-line kind there.
- **The cascade wire is ours, not captured.** The mock emits `tumbleStep`; the facade maps it to the
  engine's `tumbleBoard` book event and shifts every row by the board padding. A real provider's
  cascade replaces this shape; it is not bent to fit (`docs/reference/play4fun-protocol.md`).
- **The cells that paid are the cells that explode**, at every step, and each step carries the wins
  of the board it produced (`cascadeSteps` in `scripts/mock-rgs-server.mjs`).
- **Who turned the cascade on decides dead-spin behaviour.** Authored or protocol-implied ⇒ the
  mechanic (no tumble on a dead spin); the `CASCADE_GAMES` / `CASCADE=1` override ⇒ a demo
  (`cascadeEnabledFor` in `services/test-server/makeMock.mjs`, `nativeCascade` in the mock).
- **The padding contract has one home**: `PAD_ROWS_ABOVE` and `combineTumbleReel` in
  `apps/lines/src/game/tumbleBoardLayout.ts`. The seat offset and the refill stacking read it.
- **Every symbol beat is bounded** (`awaitSymbolBeat`, `TRANSIT_BEAT_CAP_MS`, `WIN_BEAT_CAP_MS`,
  `WIN_BEAT_MIN_MS` in `apps/lines/src/game/symbolBeat.ts`). Never await a symbol's `oncomplete`
  unraced.
- **A game that never tumbles is byte-identical**: `stateTumble.active` stays false and the cascade
  seat is `null` (`apps/lines/src/game/stateTumble.svelte.ts`).
- **Determinism**: tumble patterns are cosmetic and read the seeded `Math.random`; the outcome comes
  only from the book.

## Where the code lives

| What                           | Path                                                                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Kind list, capabilities        | `packages/constants-shared/gameKinds.ts`, `packages/engine-layout/src/lib/kindCapabilities.ts`                                         |
| Win model, cascade flag        | `packages/game-config/src/winModel.ts`, `packages/game-config/src/mechanics.ts`                                                        |
| Divisor, active model          | `packages/engine-game/src/game/gameConfig.ts`                                                                                          |
| Win meter across a chain       | `packages/engine-game/src/game/playBook.ts` (`advanceWinMeter`)                                                                        |
| Tumble state and layout        | `apps/lines/src/game/stateTumble.svelte.ts`, `apps/lines/src/game/tumbleBoardLayout.ts`                                                |
| Tumble overlay and board       | `apps/lines/src/components/TumbleBoard.svelte`, `apps/lines/src/components/Board.svelte`, `apps/lines/src/components/BoardBase.svelte` |
| Book-event handlers            | `apps/lines/src/game/bookEventHandlerMap.ts` (`tumbleBoard`, `updateTumbleWin`, `updateGlobalMult`)                                    |
| Win replay, win-line shape     | `apps/lines/src/game/winSymbolCycle.ts`, `winLineShapeFor` in `apps/lines/src/game/flowEffects.ts`                                     |
| Beats, explode pattern, sound  | `apps/lines/src/game/symbolBeat.ts`, `packages/engine-layout/src/lib/tumblePattern.ts`, `apps/lines/src/game/cascadeSoundStep.ts`      |
| Flow-v2 vocabulary, starter    | `packages/engine-flow-v2/src/reference/cluster.ts`, `packages/engine-flow-v2/src/reference/drivenSeed.ts`                              |
| Reference layout (editor only) | `packages/engine-layout/src/lib/referenceLayouts/cluster.ts`                                                                           |
| Wire translation               | `packages/rgs-translator-eagaming/src/engineFacade.ts` (`tumbleStep`)                                                                  |
| Mock evaluator and chain       | `scripts/mock-rgs-server.mjs` (`evaluateClusters`, `cascadeSteps`)                                                                     |
| Test server                    | `services/test-server/makeMock.mjs`, `services/test-server/server.mjs`                                                                 |
| Launcher mock protocol         | `apps/launcher-api/src/lib/server/mockProtocol.ts`                                                                                     |
| Upstream sample (reference)    | `apps/cluster`                                                                                                                         |

Scatter shares the whole cascade (its vocabulary is built on cluster's) and ways can author one;
coordinate with `scatter-games` and `ways-games` on any cascade change.

## Known failure modes

- **Symptom:** a cluster project paid like a lines game. **Cause:** the mock had no cluster
  evaluator, so it paid paylines; the client was already right. (`scripts/mock-rgs-server.mjs`)
  **Guard:** `pnpm check:cluster`.
- **Symptom:** six connected symbols lit up and paid zero. **Cause:** an exact paytable lookup;
  a sparse authored table (`{5, 8, 12}`) dropped every size in between. (`evaluateClusters`)
  **Guard:** threshold lookup; none specific in `check:cluster` for sparse tables.
- **Symptom:** "clusters don't work" on a test project. **Cause:** `minCluster` below the
  paytable's lowest priced row, so groups form but never pay. (`evaluateClusters`) **Guard:**
  none; keep `minCluster` at or above the table's floor (`check:cluster` does not assert it).
- **Symptom:** the count-up showed a fraction of what the wallet credited. **Cause:** a
  paylines-less model was given phantom regenerated lines and a per-line divisor.
  (`payoutDivisor`, `payoutBaseFor`) **Guard:** `pnpm check:stake`.
- **Symptom:** the spin button would not re-arm after a tumble, intermittently. **Cause:** the
  explode/land beats awaited `oncomplete` from a symbol whose state resolved to the art already on
  screen, which never reports. (`TumbleBoard.svelte`) **Guard:** `awaitSymbolBeat` caps;
  `scripts/verify-swap-in-place-mode.mjs`.
- **Symptom:** a win line came back after the tumble, around cells that never paid. **Cause:** the
  win replay cleared only on `reveal`, not on `tumbleBoard`. (`winSymbolCycle.ts`) **Guard:** none
  beyond the `REPLACES_THE_BOARD` set.
- **Symptom:** after a tumble the next win frames sat on wrong symbols, and a stale row showed in
  the window. **Cause:** refills stacked above the top padding row (`[...adding, ...base]`).
  (`tumbleBoardLayout.ts`) **Guard:** `packages/rgs-translator-eagaming/cascadeBoard.fixture.ts`.
- **Symptom:** a board that still paid just sat there, or came to rest still paying. **Cause:** the
  mock tumbled once, then a 12-step cap cut natural chains short. (`cascadeSteps`) **Guard:**
  `CASCADE_RUNAWAY_GUARD = 200` and `scripts/cascade-chain.fixture.mjs`; hitting it is a math fault.
- **Symptom:** a losing spin tumbled, exploding symbols that never paid. **Cause:** the mock judged
  "native cascade" by win model, so an authored cascade fell to the demo pass.
  (`cascadeEnabledFor`, `nativeCascade`) **Guard:** `scripts/cascade-chain.fixture.mjs`.
- **Symptom:** setting one env var would make the shipped Book of Borut tumble. **Cause:** one test
  server serves every game, and the cascade flag was process-wide. **Guard:** per-game
  `CASCADE_GAMES` plus the project's own `cascade`; an explicit `false` always wins.
- **Symptom:** the cascade overlay never appeared. **Cause:** `TumbleBoard` was registered as
  bindable but never mounted. (`apps/lines/src/components/Game.svelte`) **Guard:** none; contract
  tests cannot see "never mounted". Play the game.
- **Symptom:** every standing symbol restarted its clip twice per tumble. **Cause:** the overlay
  cloned the board, so each hand-over rebuilt every cell. (`stateTumble.svelte.ts`, `BoardBase`)
  **Guard:** one cell, one component (`docs/design/board-cell-continuity.md`); the current-games
  harness.
- **Symptom:** a long dead hold after a paying spin, once per tumble step. **Cause:** a winner with
  no `explosion` bound held the whole beat cap. (`symbolBeat.ts`) **Guard:** none; bind
  `explosion` in `/symbols`.
- **Symptom:** the Win box read 0.00 through a whole chain. **Cause:** nothing consumed each
  `winInfo`'s `totalWin`. (`advanceWinMeter` in `playBook.ts`) **Guard:** forward-only meter.
- **Symptom:** a kind change left another family's flow on the project, and publish shipped it.
  **Cause:** re-scaffold only creates missing files. (`projectScaffold.ts`) **Guard:** the
  `flow-wrong-kind` publish refusal (#1369). A slot flow in a cluster project is not refused.

## How to test

- `pnpm check:cluster` (`scripts/check-cluster-evaluator.mjs`): grouping, adjacency, wilds,
  `minCluster`, SCAT excluded, the wire shape. Part of `pnpm check:rgs`.
- `pnpm check:stake` (divisor parity), `pnpm check:freespins`, `pnpm check:resume`.
- The current-games harness runs `check:cluster` and `check:freespins` for this type
  (`scripts/current-games/lib/gates.mjs`) and plays the screen script
  `scripts/current-games/screens/cluster.json` (base, first win, forced free spins, big-win
  ladder). See `docs/playtest/current-games.md`.
- Cascade fixtures, run by `pnpm check:all`: `scripts/cascade-chain.fixture.mjs`,
  `packages/rgs-translator-eagaming/cascadeBoard.fixture.ts`,
  `packages/game-config/cascade.fixture.ts`, `apps/lines/src/game/cascadeSoundStep.fixture.ts`,
  plus `scripts/verify-swap-in-place-mode.mjs` and `scripts/verify-tumble-pattern.mjs`.
- **Playbook: missing.** There is no `docs/playtest/` playbook for a cluster game (a known gap).
  Scaffold one from `docs/playtest/README.md`; `docs/playtest/ways.md` is the nearest model.
- A reviewer checks: no change to math or the wire shape without the owner; lines and Book-of
  stay byte-identical (no `stateTumble` path taken); every new beat is raced; a step's wins are
  drawn on the board that step produced.

## Read more

- `services/director-worker/families/slot.md`: what Director's runtime agents read about this family
  (its `cluster` section under Kinds, plus the family-wide sections). The pack is the one home of
  that text; edit it there.
- `docs/design/game-type-templates.md` (Phase C win models, Phase F the cascade)
- `docs/status/engine.md` (Open items 0) and `docs/status/engine-history.md` (2026-08-19 to 09-17)
- `docs/status/game-config.md` (cascade and stepped grids)
- `docs/reference/play4fun-protocol.md` (what is captured and what is ours)
- `docs/design/board-cell-continuity.md`
