# Ways — family knowledge

What a ways game is, what must not move, and what has broken before. Owner agent: `ways-games`.

## What it is and must stay

- A ways slot pays a symbol that lands on adjacent reels from the leftmost one, on any row. Every
  matching cell on every contributing reel is part of the win. A 5×3 board pays 3⁵ = 243 ways.
- It is NOT its own app or bundle. A ways project boots the one shared runtime (`apps/lines`) and
  differs from lines only in its Invisible Game Config: a `winModel` of type `ways`, with
  `direction` and `minKind` (`packages/game-config/src/types.ts`). The kind `ways` picks the starter template,
  flow vocabulary and mock protocol; the CONFIG's `winModel` decides how the game pays.
- `apps/ways` is the upstream sample, reference only. It is never built or served (the runtime
  release builds `apps/lines`; see `apps/launcher-api/src/lib/server/publishGame.ts`). Its one live
  use: `apps/ways/src/game/config.ts` is the source of the ways Game Config default
  (`apps/launcher-api/scripts/generate-game-config-defaults.ts`). Its strips are cosmetic, not math.
- The client evaluates no win. The RGS decides and the engine presents. The one place the client
  reads a board for value is reel anticipation.
- The live ways game is `test6` "Ways on Waves" (desktop key `waysofwavesbuild`): stepped
  5×[3,4,4,4,4], perspective board, authored cascade. `test3` is a ways test project with a cascade.
- Math is locked: paytable, strips, bet modes and `winModel` change only in `/config`, by a person.

## Invariants

- **Absent `winModel` means lines.** Read it through `resolveWinModel`
  (`packages/game-config/src/winModel.ts`) or `activeWinModel()`
  (`packages/engine-game/src/game/gameConfig.ts`), never `doc.winModel`.
- **Stake per way = total bet ÷ ways count.** Ways count = the PRODUCT of each reel's visible rows,
  read off the resolved grid (`activeWaysCount()`), never `rows ** reels`. 5×[3,4,4,4,4] = 768.
- **Client divisor and mock base agree.** `payoutDivisor()` (engine-game `gameConfig.ts`) must
  mirror `payoutBaseFor` (`scripts/mock-rgs-server.mjs`). Guard: `pnpm check:stake`.
- **Wins sum; no dedupe.** Each symbol whose run reaches a paying length emits its own `spinWin`;
  `gameEnd.win` is the sum. `evaluateWays` in `scripts/mock-rgs-server.mjs`.
- **Run is left-anchored and contiguous.** It stops at the first reel without the symbol (wilds
  substitute). `occurs` = contributing reels. `context.ways` = product of per-reel counts.
- **Positions are a bare `{reel,row}` array.** `winPositions` in
  `packages/rgs-translator-eagaming/src/engineFacade.ts` reads `Array.isArray(ctx)`; an object
  wrapper pays and lights nothing. Guard: `scripts/check-ways-protocol.mjs`.
- **The config event declares `paylines: []`.** A ways game has no lines; the mock never
  synthesises them (`paylinesLess` in the mock). The facade then buys one unit: `betLineCount`
  returns 1 for an empty list, so a line-config ways bet is `[1, stake]`.
- **Pays round once, at the wire**, to whole cents with a one-cent floor (`payCents` /
  `roundPays` in the mock). The per-way base stays fractional.
- **Wins price off the base stake** (`round.baseTotal`), never a bought round's total.
- **Payline surfaces stand down.** `getPaylines()` returns `[]`, payline colour is off, and
  `winLineShapeFor` (`apps/lines/src/game/flowEffects.ts`) draws `reels`: one merged bar per
  winning reel.
- **Anticipation uses `createWaysReach`** (`packages/utils-slots/src/anticipationReach.ts`, chosen
  in `apps/lines/src/game/anticipation.ts`): a running product, summed across symbols; `max`
  never rises and `min` never falls as reels lock.
- **Kind capabilities:** `kindCapabilities('ways')` gives `winLines: false` unless the config says
  `lines`, and `cascade` follows the config (`packages/engine-layout/src/lib/kindCapabilities.ts`).
- **Book events are the lines union.** The ways template, layout and vocabulary are the standard
  ones with no Book-of beats (`packages/engine-layout/src/lib/templates/ways.ts`,
  `packages/engine-flow-v2/src/reference/ways.ts`).

## Where the code lives

| What                                             | Path                                                                                                                                                           |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Win model type, resolver, normalizer             | `packages/game-config/src/types.ts`, `packages/game-config/src/winModel.ts`                                                                                    |
| Grid (per-reel rows, stepped)                    | `packages/game-config/src/grid.ts`                                                                                                                             |
| Runtime read: divisor, ways count, paylines      | `packages/engine-game/src/game/gameConfig.ts`                                                                                                                  |
| Win line shape, anticipation                     | `apps/lines/src/game/flowEffects.ts`, `apps/lines/src/game/anticipation.ts`                                                                                    |
| Ways reach                                       | `packages/utils-slots/src/anticipationReach.ts`                                                                                                                |
| Kind flags                                       | `packages/engine-layout/src/lib/kindCapabilities.ts`                                                                                                           |
| Template, reference layout, flow vocab           | `packages/engine-layout/src/lib/templates/ways.ts`, `packages/engine-layout/src/lib/referenceLayouts/ways.ts`, `packages/engine-flow-v2/src/reference/ways.ts` |
| Facade (bet encoding, win positions)             | `packages/rgs-translator-eagaming/src/engineFacade.ts`                                                                                                         |
| Mock evaluator (`evaluateWays`, `payoutBaseFor`) | `scripts/mock-rgs-server.mjs`                                                                                                                                  |
| Test server: kind → protocol, grid to mock       | `apps/launcher-api/src/lib/server/mockProtocol.ts`, `apps/launcher-api/src/lib/server/mockContract.ts`, `services/test-server/makeMock.mjs`                    |
| Ways Game Config default                         | `apps/ways/src/game/config.ts` → `apps/launcher-api/src/lib/server/gameConfigDefaults.ts`                                                                      |
| Math check (RTP of any doc's strips)             | `tools/game-config-spike/waysMath.ts`, `tools/game-config-spike/waysCrosscheck.ts`                                                                             |

## Known failure modes

- **Symptom:** a ways win paid a multiple of what its paytable quoted; the count-up showed a
  fraction of what the wallet credited. **Cause:** the mock priced per phantom LINE: an empty
  paylines list read as "absent", the stock set was regenerated into 13 lines, and the facade
  hardcoded a 5-line bet (`payoutBaseFor`, `betLineCount`). **Guard:** `pnpm check:stake` in
  `pnpm check:rgs`.
- **Symptom:** a ways project played on 5×3 whatever grid it authored. **Cause:** `projectGrid`
  sent no grid for `ways`, so the mock fell back to the `apps/lines` board
  (`apps/launcher-api/src/lib/server/mockContract.ts`). **Guard:** `check:mock-contract` (launcher)
  covers the ways contract; none specific to the grid (#432).
- **Symptom:** a desktop ways build dealt Hot Fruits symbols and its bottom row never exploded.
  **Cause:** the test server read the config under the GAME key (`waysofwavesbuild`), not the
  project key (`test6`), got a 401 and fell back to the built-in mock
  (`services/test-server/server.mjs`). **Guard:** `projectKey` on the manifest entry, plus a
  one-time `[test-server] … has no project pointer` warning.
- **Symptom:** symbols set in `/config` never landed, and wins paid captured Hot Fruits values.
  **Cause:** the wire had no names for `H5`/`L3`/`L4`, and the project paytable rode only for
  `scatter` (`EXTENDED_LINE_SYMBOLS`, `payRowOf` in the mock). **Guard:**
  `scripts/cascade-chain.fixture.mjs`.
- **Symptom:** on a ways game with a tumble, every losing spin exploded symbols that paid nothing.
  **Cause:** the mock chose the demo cascade by win model, not by who turned the cascade on
  (`cascadeEnabledFor` in `services/test-server/server.mjs`). **Guard:**
  `scripts/cascade-chain.fixture.mjs` ("a dead spin never tumbles").
- **Symptom:** after a tumble the win frames sat on symbols that never paid (`test3`). **Cause:**
  the refills were stacked above the top padding row, shifting the column
  (`apps/lines/src/game/tumbleBoardLayout.ts`). **Guard:**
  `packages/rgs-translator-eagaming/cascadeBoard.fixture.ts` (60 ways rounds).
- **Symptom:** a stepped ways board paid the wrong multiple during anticipation. **Cause:** the
  reach was handed the bounding-box slice, keeping a padding row in short columns
  (`buildAnticipationArming`). **Guard:** the ragged section of
  `packages/utils-slots/anticipationWaysReach.fixture.ts`.
- **Symptom:** a win pays but nothing lights up. **Cause:** positions sent wrapped in an object;
  `winPositions` reads only a bare array. **Guard:** `scripts/check-ways-protocol.mjs`.
- **Symptom:** a long hold after every paying spin on `test6`. **Cause:** a winner with no
  `explosion` bound falls back to the art already on screen, never reports complete, and the pop
  waits out the cap (`symbolBeat.ts`). **Guard:** none specific; see `docs/status/engine-history.md`
  2026-09-15.
- **Symptom:** a thin line drawn over the symbols between the first two columns of `test6`.
  **Cause:** on a stepped perspective board each column sampled the shared mask edge at its own
  rows (`boardMaskColumns`). **Guard:** the shared-edge scanline in
  `scripts/verify-symbol-seat.mjs`.
- **Symptom:** a $1 base spin on a ways game charged as the 100× buy. **Cause:** a tab kept its
  boot bet shape after the game gained a buy table on a test-server refresh. **Guard:**
  `pnpm check:buy-cost` Part 4 (all four models).
- **Symptom:** a local ways playtest shows payline diagrams and wrong info-page prices. **Cause:**
  not a bug: a plain local boot is a ways SERVER with a LINES client. Only `?runtime=1` brings the
  ways config. **Guard:** `docs/playtest/ways.md` Route A/B table.
- **Symptom:** a `/config` project set to ways still plays as lines. **Cause:** a game ships only
  an authored config; the kind alone sets nothing until `/config` is saved. **Guard:** none; see
  `docs/tools/game-config.md`.

## How to test

- `pnpm check:ways`: `scripts/check-ways-evaluator.mjs` (evaluator units) and
  `scripts/check-ways-protocol.mjs` (wire shape over HTTP).
- `pnpm check:rgs`: all models plus `check:stake` (client divisor = mock base), `check:buy-cost`,
  `check:resume` (a ways feature resumed), `check:win-x`.
- `node scripts/verify-stepped-grid.mjs` and
  `node packages/utils-slots/anticipationWaysReach.fixture.ts`.
- `node scripts/cascade-chain.fixture.mjs` and
  `packages/rgs-translator-eagaming/cascadeBoard.fixture.ts` for a ways game with a cascade.
- Launcher: `check:game-config-defaults` (the ways default matches `apps/ways`),
  `check:mock-contract`.
- Playbook: `docs/playtest/ways.md` (S1–S8). Route A proves the server and the money; only Route B
  (`?runtime=1&project=test6&k=…`) proves the ways client. Hand it to `game-playtester`.
- Screen script: `scripts/current-games/screens/ways.json` (base, line-win, free-spins,
  big-wins), run by the current-games harness on the `cg-ways` fixture
  (`scripts/current-games/fixtures.mjs`).
- A reviewer checks: wins summed and not deduped, positions a bare array, `paylines: []`, the pay
  formula in `docs/playtest/ways.md`, a stepped board's ways count, and no change to a lines game.

## Read more

- `docs/status/engine.md` (open item 0, game-type templates) and `docs/status/engine-history.md`
- `docs/status/game-config.md` ("Stepped grids")
- `docs/design/game-type-templates.md` (Phases C and D, "What is left")
- `docs/design/stepped-grid.md`, `docs/design/reel-anticipation.md`
- `docs/reference/play4fun-protocol.md` ("The first bet argument", `maxWays`)
- `docs/playtest/ways.md`
