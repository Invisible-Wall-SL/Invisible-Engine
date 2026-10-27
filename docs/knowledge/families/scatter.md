# Scatter — family knowledge

What is always true about the `scatter` game kind (scatter-pays, pay anywhere), and what has broken
before. Owner agent: `scatter-games`.

## What it is and must stay

- A **scatter** game pays every symbol on its **count anywhere on the board**: eight PIC1s pay
  whether or not they touch or share a line. The project states it in Game Config as
  `winModel: { type: 'scatter', minCount }` (default 8).
- It is a **tumble game**: winners leave, survivors fall, the gap refills and the new board is
  scored again until one pays nothing. On top of the cluster cascade it adds one beat, the
  **multiplier collect**: multiplier cells landed in the refills fly to the centre and multiply the
  whole chain's win.
- It runs in the **shared runtime** (`apps/lines`), like every online kind. It is data plus the
  shared tumble and collect mechanics, not an app fork.
- `apps/scatter` is **upstream reference only**. It is vanilla upstream SDK code with none of the
  Invisible layer, and the runtime release builds only from `apps/lines`. Do not develop it.
- **Kind vs symbol role.** "Scatter" is also a symbol ROLE in every slot: the `SCAT` feature symbol
  (`special_properties: ['scatter']`) that triggers free spins, and the Book-of book (scatter plus
  wild). That role exists in lines, ways and cluster games too. This file is about the KIND. When
  you read code, keep these apart:
  - `evaluateScatterPays` (the win model) vs `evaluateScatters` (the SCAT trigger and its pay, run
    for every model), both in `scripts/mock-rgs-server.mjs`;
  - win `mode: 'scatterPays'` (the model) vs `mode: 'scatter'` with `what: 'SCAT'` (the trigger);
  - manifest `symbolPaytable` (the model's count table) vs `scatterPaytable` (the SCAT symbol's own
    pays).
- **Never change:** math (paytable, `minCount`, strips, free-spin rule) is locked and set only in
  Game Config by a person. A lines, ways or bookOf game must never tumble or collect because of
  scatter work.

## Invariants

- **The client evaluates no win.** The RGS decides and the engine presents. The runtime reads the
  model once through `activeWinModel()` (`packages/engine-game/src/game/gameConfig.ts`), via
  `resolveWinModel()` (`packages/game-config/src/winModel.ts`), never off `doc.winModel`.
- **Divisor 1.** A scatter row pays × the TOTAL stake. `payoutDivisor()` returns 1 for the model and
  the mock's `payoutBaseFor` must mirror it. Gate: `pnpm check:stake`
  (`scripts/check-stake-consistency.mjs`).
- **Rows are thresholds.** A count between tiers takes the highest tier at or below it; above the
  top tier it clamps. Gate: `pnpm check:scatter` (`scripts/check-scatter-evaluator.mjs`).
- **Positions are a bare `{reel,row}` array** in a win's `context`. The facade's `winPositions`
  reads only `Array.isArray(context)` or `context.payline`
  (`packages/rgs-translator-eagaming/src/engineFacade.ts`). A wrapped object lights nothing.
- **Paylines stand down.** No payline diagram or colour, win line drawn as `cells`, anticipation off
  for line reach (a scatter TRIGGER tease still works). `winLines: false` in `kindCapabilities`
  (`packages/engine-layout/src/lib/kindCapabilities.ts`).
- **Cascade defaults on for the kind.** `cascadeDefaultFor` / `resolveCascade`
  (`packages/game-config/src/mechanics.ts`); `CASCADE_PROTOCOLS` in
  `services/test-server/makeMock.mjs`. Only an authored departure (`cascade: false`) is stored.
- **Multiplier collect is scatter-only**, and only for a multiplier symbol that is in play AND has
  `static` art in `/symbols` (`projectMultiplier` in
  `apps/launcher-api/src/lib/server/mockContract.ts`).
- **`tumbleStep` and `multiplierCollect` are OUR wire**, not Play4Fun's
  (`docs/reference/play4fun-protocol.md`). They are fixture-only and labelled at both ends. A real
  provider's shape replaces them; do not bend a real capture to fit them.
- **The free-spin trigger is not re-scored mid-cascade.** Whether scatters landing in a refill
  retrigger is unanswered game math (`cascadeSteps` in `scripts/mock-rgs-server.mjs`).
- **The SCAT trigger never explodes in a cascade.** `payingCells` skips `mode === 'scatter' && what
  === 'SCAT'` by what the win is, not by its context shape.

## Where the code lives

| Part | Path |
|---|---|
| Kind list | `packages/constants-shared/gameKinds.ts` |
| Capability flags (cascade, multiplierCollect, winLines) | `packages/engine-layout/src/lib/kindCapabilities.ts` |
| Win model type, normalizer, cascade default | `packages/game-config/src/types.ts`, `packages/game-config/src/winModel.ts`, `packages/game-config/src/mechanics.ts` |
| Committed config default | `apps/launcher-api/src/lib/data/gameConfig/scatter.json` |
| Reference scene layout | `packages/engine-layout/src/lib/referenceLayouts/scatter.ts` |
| Flow vocabulary (`SCATTER_VOCAB` on `CLUSTER_VOCAB`) | `packages/engine-flow-v2/src/reference/scatter.ts` |
| Runtime: tumble and collect | `apps/lines/src/components/TumbleBoard.svelte`, `apps/lines/src/components/MultiplierBoard.svelte`, `apps/lines/src/game/bookEventHandlerMap.ts`, `apps/lines/src/game/symbolBeat.ts` |
| Facade (`tumbleStep`, `multiplierCollect` → `boardMultiplierInfo`) | `packages/rgs-translator-eagaming/src/engineFacade.ts` |
| Mock evaluator and cascade | `scripts/mock-rgs-server.mjs` (`evaluateScatterPays`, `cascadeSteps`) |
| Test server wiring | `services/test-server/makeMock.mjs`, `services/test-server/server.mjs` |
| Launcher: kind → protocol, manifest | `apps/launcher-api/src/lib/server/mockProtocol.ts`, `apps/launcher-api/src/lib/server/mockContract.ts`, `apps/launcher-api/src/lib/server/testServerManifest.ts` |
| Math verifier | `tools/game-config-spike/scatterMath.ts`, `tools/game-config-spike/scatterCrosscheck.ts` |

## Known failure modes

- **Symptom:** a win plainly on the board paid zero. **Cause:** the evaluator looked up the count as
  an exact row, so a sparse table (`{8,9,10,13}`) priced 11 at nothing (`scripts/mock-rgs-server.mjs`).
  **Guard:** `pnpm check:scatter` sparse-table case; `scattercrosscheck`.
- **Symptom:** a scatter or cluster win dimmed the whole board and lit nothing. **Cause:**
  `evaluateScatters` wrapped SCAT positions as `{ positions }`, which `winPositions` cannot read, so
  the client got `positions: []`. **Guard:** `pnpm check:stake` asserts one position per SCAT.
- **Symptom:** a published scatter game did not tumble. **Cause:** cascade was gated by the
  `CASCADE_GAMES` env allowlist, not by the kind (`services/test-server/makeMock.mjs`). **Guard:**
  `CASCADE_PROTOCOLS` plus the authored `cascade` field; `packages/game-config/cascade.fixture.ts`.
- **Symptom:** the board came to rest still paying. **Cause (1):** the mock exploded the dealt board
  once and never re-scored the refill. **Cause (2):** a 12-step cap cut natural chains short.
  **Guard:** `cascadeSteps` chains to a pay-nothing board, capped only by a 200-step runaway guard;
  `scripts/cascade-chain.fixture.mjs` asserts termination. A runaway is a MATH problem: measure with
  `scattermath`, do not raise the cap.
- **Symptom:** the live `test5` paid about 413× per spin, and win frames looked wrong. **Cause:**
  its math (8x8 board, `minCount` too low for the symbol mix) made nearly every board pay and every
  chain run long. Not an engine bug. **Guard:** `pnpm --filter game-config-spike run scattermath`
  before a `minCount` or strip change ships (`docs/status/game-config.md`, 2026-08-21).
- **Symptom:** the reels vanished with `Cannot read properties of undefined (reading 'static')`.
  **Cause:** the mock dealt `M` multiplier cells that had no art; `getSymbolInfo` threw mid-render
  and unmounted the board. **Guard:** `Symbol.svelte` `missingArt` branch renders nothing and warns;
  the mock deals multipliers only with `static` art bound (`mockContract.ts`). Related: #411.
- **Symptom:** the collect beat never played. **Cause:** `MultiplierBoard` and its handler shipped
  (#377) with no emitter in the mock or the facade. **Guard:**
  `packages/rgs-translator-eagaming/cascadeCollect.fixture.ts` drives the real facade against the
  real mock (multipliers in refills only, `totalWin` keeps the tumbleWin × boardMult ratio).
- **Symptom:** collect cells lit one row off. **Cause:** collect positions not shifted into padded
  board space. **Guard:** `BOARD_PADDING_ROWS` shift in the `multiplierCollect` case;
  `cascadeCollect.fixture.ts` checks it.
- **Symptom:** the spin button never re-armed after a tumble. **Cause:** explode and land beats
  awaited `oncomplete`, which a symbol whose state does not change never fires. **Guard:** every
  beat races a cap through `awaitSymbolBeat` (`apps/lines/src/game/symbolBeat.ts`).
- **Symptom:** the win meter read 0.00 through a whole cascade, then jumped. **Cause:** nothing
  consumed each `winInfo`'s `totalWin`. **Guard:** `advanceWinMeter` (`packages/engine-game/src/game/playBook.ts`);
  `cascadeCollect.fixture.ts` "the climbing meter lands on the round total".
- **Symptom:** the count-up and the wallet disagreed, and the bet declared 13 phantom paylines.
  **Cause:** a lines-less model got the stock 5×3 lines regenerated for its taller board, and the
  mock's pay base did not mirror `payoutDivisor()`. **Guard:** `pnpm check:stake` for all four
  models.
- **Symptom:** a bought feature paid scatter wins 100× over. **Cause:** wins priced off
  `round.total` (with the buy premium) instead of `round.baseTotal`. **Guard:** `pnpm check:buy-cost`
  Part 4 (scatter runs at `minCount 4`).
- **Symptom:** a project set to scatter still plays as lines. **Cause:** the kind was set but
  `/config` was never saved, so the shipped config has no `winModel`. **Guard:** none; check the
  saved config (`docs/status/engine.md` open item 0).
- **Symptom:** a scatter project's `/flow-v2` shows Book-of cues. **Cause:** projects scaffolded
  before 2026-10-01 keep `templateId: 'bookOf'`; the runtime plays it. Not a bug to "fix" by
  replacing the flow (`docs/status/flow.md` open item 9). **Guard:**
  `pnpm --filter launcher-api check:flow-publish-gate`.

## How to test

- **Gates:** `pnpm check:scatter`, `pnpm check:stake`, `pnpm check:buy-cost`, all inside
  `pnpm check:rgs`. `pnpm check:all` also discovers the fixtures above (`*.fixture.*`), including
  `scripts/cascade-chain.fixture.mjs`, `packages/game-config/cascade.fixture.ts` and
  `packages/rgs-translator-eagaming/cascadeCollect.fixture.ts`.
- **Launcher gates:** `pnpm --filter launcher-api check:symbols-kind-gating` (pins scatter's
  capability row), `check:flow-publish-gate`, `check:game-config-defaults` (the committed default).
- **Math:** `pnpm --filter game-config-spike run scattermath` and `run scattercrosscheck`.
- **Mock by hand:** `WIN_MODEL=scatter MIN_COUNT=8 CASCADE=1 MULTIPLIER=1 node
  scripts/mock-rgs-server.mjs`. A purely local boot of `apps/lines` is a scatter server against a
  lines client unless the project config reaches it (see the ways note in `docs/status/engine.md`
  open item 0).
- **Screens:** `scripts/current-games/screens/scatter.json`, 14 screens (base canary, first win,
  forced free spins, five big-win tiers). No published scatter game has a pointer today
  (`test5` has none), so the harness plays only the `cg-scatter` fixture game
  (`scripts/current-games/fixtures.mjs`). See `docs/playtest/current-games.md`.
- **Playbook:** none. There is no scatter playbook in `docs/playtest/`; this is a known gap. The
  shape to follow is `docs/playtest/README.md`, and `docs/playtest/ways.md` is the nearest model.
- **A reviewer looks at:** money (count-up equals wallet), lit cells match the paying cells on the
  board each step produced, the chain ends on a board that pays nothing, the collect falls after
  the last tumble, and no lines/ways/bookOf screen moved.

## Read more

- `docs/design/game-type-templates.md` (Phases C, D and F)
- `docs/status/engine.md` (open item 0) and `docs/status/engine-history.md` (2026-08-20 to 08-31)
- `docs/status/game-config.md` (win model, cascade, `scattermath`)
- `docs/reference/play4fun-protocol.md` (what is real wire and what is ours)
- `docs/design/delivery-builds.md`
