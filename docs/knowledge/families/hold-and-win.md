# Hold and Win — family knowledge

What is always true about the `holdAndWin` kind, where it lives and what has broken before.
Owner agent: `hold-and-win-games`.

## What it is and must stay

- **A slot kind whose feature is a respin board.** Enough coins land, the board turns into a
  per-cell respin board, coins stick, a counter resets on each new coin, and the feature ends when
  the counter runs out or the board fills. Then every held value is paid.
- **One template, presets.** Game Maker's preset picker seeds the Game Config: **Pots** (3 Pots,
  the default), **Classic sticky** (Grand: column letters, boost) and **Collector streak** (Super
  Hotfire: pattern trigger, wheel, collector streak). Presets are config, not code
  (`packages/game-config/src/holdAndWinPresets.ts`).
- **The coin board** (Phase 13) is a Hold and Win with no line game: the base game deals coins and
  blanks on the paying cells only (the cells an active payline crosses); the Line Overlay draws the
  lines. Plan: `docs/design/hold-and-win-coin-board.md`.
- **Mock-first, our wire.** The partner has never shown a Hold and Win round. Every Hold and Win
  event is ours, a swap seam rewritten in Phase 10 (`docs/reference/hold-and-win-wire.md`).
  Nothing above the facade may depend on the wire.
- **Not this agent's:** the coin overlay or pots overlay on another kind, several bonus modes in one
  project, and a Hold and Win imported as a bonus of another project. Those are `bonus-games`
  (`docs/status/bonus-games.md`, `docs/status/pots-overlay.md`). The respin game itself, the
  `holdAndWin` kind, its presets and the coin board are this family. When a change touches both,
  this agent owns the respin engine and hands the overlay or mode routing to `bonus-games`.
- **Must never change:** the math (Game Config only, by a person), the money rules below, the
  partner-owned parts of the wire, and how any current game looks.

## Invariants

- **Money is the server's.** `holdAndWinEnd.total = banked + Σ cells.amount`; a `jackpotWin` with
  `banked: false` is presentation only and is never added on top. Wire "Money";
  `scripts/check-holdandwin-protocol.mjs` re-derives every sum from the events.
- **The client never sums `total`.** The picture is a pure reducer (`applyHoldAndWinEvent`,
  `packages/engine-game/src/game/holdAndWin.ts`); the server's `holdAndWinState` replaces it after
  each respin. Pinned by `packages/engine-game/fixtures/holdAndWinState.fixture.ts`.
- **Values are × the base total stake.** A buy's premium never raises them. Cell syntax
  `BONUS:1.5`, `JACKPOT:MINI` (wire "Symbols and cells").
- **Partner parts kept exactly:** `seq` as a position, atomic batches, two-pass events, the respin
  feature as context-less `play`s between `enterBonus` and `gameEnd`. Facade:
  `packages/rgs-translator-eagaming/src/holdAndWin.ts`, `engineFacade.ts`; fixture
  `packages/rgs-translator-eagaming/holdAndWin.fixture.ts`.
- **Counter rule:** after a respin it is `reset ? max(start, left) : left − 1`; the feature-ending
  respin says `left: 0, reset: false` (`check:holdandwin`).
- **Mode:** the feature enters as a mode with `gameType: 'respin'` and exits to the one underneath
  (`packages/engine-game/src/game/modeEvents.ts`, `modeStack.fixture.ts`).
- **The deal is the Game Config's only.** The launcher sends a `lines` contract carrying the
  `holdAndWin` inputs (`holdAndWinMockInputs`, `packages/game-config/src/holdAndWinMock.ts`;
  `protocolFor` in `apps/launcher-api/src/lib/server/mockProtocol.ts`). Draw rates are the mock's
  pacing, not math.
- **Coin board stake** is lines × bet per line; a fixed board sends its active line count
  (`apps/lines/src/game/coinBoardStake.ts`, `coinBoardStake.fixture.ts`).
- **Forcing is authoring-only.** A player mock refuses forces; the authoring twin
  (`/api/<key>/authoring/…`) takes them (`services/test-server/makeMock.mjs`).

## Where the code lives

| Layer            | Paths                                                                                                                                                                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Config + presets | `packages/game-config/src/holdAndWin.ts`, `holdAndWinPresets.ts`, `holdAndWinGame.ts`, `coinBoard.ts`; seeds in `apps/launcher-api/src/lib/data/gameConfig`                                                                                                                                    |
| Mock RGS         | `scripts/mock-holdandwin-engine.mjs` (shared with the pots overlay), `scripts/mock-rgs-server-holdandwin.mjs`, `services/test-server/makeMock.mjs`                                                                                                                                             |
| Facade           | `packages/rgs-translator-eagaming/src/holdAndWin.ts`, `engineFacade.ts`                                                                                                                                                                                                                        |
| Engine logic     | `packages/engine-game/src/game/` (`holdAndWin.ts`, `respinBoard.ts`, `respinCount.ts`, `holdAndWinWheel.ts`, `coinLabel.ts`, `flight.ts`, `coinBoardTally.ts`, `modeEvents.ts`)                                                                                                                |
| Runtime          | `apps/lines/src/game/` (`stateHoldAndWin.svelte.ts`, `stateRespinBoard.svelte.ts`, `holdAndWinPresentation.ts`, `holdAndWinText.ts`, `coinBoard.svelte.ts`); `apps/lines/src/components/` (`RespinBoard.svelte`, `PotMeter.svelte`, `HoldAndWinPots.svelte`, `CoinBoardLineOverlay.svelte`, …) |
| Layout + flow    | `packages/engine-layout/src/lib/referenceLayouts/holdAndWin.ts`, `templates/holdAndWin.ts`, `holdAndWinBanners.ts`, `kindCapabilities.ts`; `packages/engine-flow-v2/src/reference/holdAndWin.ts`, `drivenSeed.ts`                                                                              |
| Launcher         | `apps/launcher-api/src/routes/(app)/config/HoldAndWinRules.svelte`, `CoinBoardSection.svelte`; `apps/launcher-api/src/lib/server/projectScaffold.ts`, `symbolDefaults.ts`; `apps/launcher-api/src/lib/data/symbolDefaults/holdAndWin.json`                                                     |

A new kind or role touches many registries: the status file's "Touch list" names each one.

## Known failure modes

- **Symptom:** a new Hold and Win project plays plain lines (`PIC*`, five paylines), no feature.
  **Cause:** no stored Game Config, so the contract carried no `holdAndWin` block and the mock fell
  back to lines (`projectScaffold.ts`). **Guard:** the scaffold seeds the preset config;
  `check:project-scaffold`; Publish warns on a missing block (#956).
- **Symptom:** a feature never comes and nothing errors. **Cause:** malformed `holdAndWin` inputs;
  the test server deals the base game as lines and warns once in its log (`makeMock.mjs`).
  **Guard:** the warning; read the test-server log before blaming the runtime.
- **Symptom:** a scaffolded project draws no coin art. **Cause:** symbols were assumed to "resolve
  by kind", but `symbolDefaultsFor` feeds only the tool pages (`symbolDefaults.ts`). **Guard:**
  `holdAndWinSymbolsSeed` at scaffold, `check:project-scaffold` (#969).
- **Symptom:** the mock deals a special or meter symbol `/config` badges unused, or cash coins the
  game values at nothing. **Cause:** `holdAndWinMockInputs` passed every role symbol, not only those
  a strip deals. **Guard:** `check:unused-symbols-in-game`; `/config` refuses a config with no coin
  symbol on a strip.
- **Symptom:** every held coin label draws black. **Cause:** pixi's `BitmapText` sets a white `fill`
  only in its constructor; a re-rendered inline style without `fill` tints it black
  (`apps/lines/src/components/CoinLabel.svelte`). **Guard:** none general; pass `fill` (#963).
- **Symptom:** a Pots game crawls at boot with `effect_update_depth_exceeded`. **Cause:**
  `PotMeter.svelte` counted itself in from a tracked `$effect` that read what it wrote. **Guard:**
  `scripts/verify-pot-meter-mount.mjs` (#998).
- **Symptom:** a reload mid-feature replays the trigger and the whole feature. **Cause:** the
  facade resumed an open round by full replay. **Guard:** `holdAndWinResumePoint` in
  `engineFacade.ts`, the facade fixture's resume case.
- **Symptom:** screens keyed by game type show nothing during a forced queued mode. **Cause:**
  `gameType` read the undeclared mode id. **Guard:** `createModeGameTypeResolver`,
  `modeStack.fixture.ts`.
- **Symptom:** a project's Letter Tile (or any part named by a `component` param) shows in the
  editor but the published game draws the coded one. **Cause:** bake, bundle and art export followed
  only instance nodes. **Guard:** `resolveComponentClosure` shared by all three (#1006).
- **Symptom:** deleting the `Pot` part from a Pot Meter copy leaves the pot uncounted with no anchor.
  **Cause:** the deleted-part trap. **Guard:** `ComponentDef.standsFor`;
  `packages/engine-layout/scripts/test-pot-skin.mjs` (#1006).
- **Symptom:** a per-respin hitch, and rolling cells cropped at every row edge. **Cause:**
  `RespinCell` mounted every strip symbol and rolled the generated in-play strip instead of the
  config's `respin` strips. **Guard:** none beyond the polish fix; profile before blaming art (#973).
- **Symptom:** a kind change in `/admin` ships another kind's flow. **Cause:** Rescaffold only adds
  missing files. **Guard:** `replaceOtherKindDocs` and the `flow-wrong-kind` publish refusal (#1369).
  Older Hold and Win projects legitimately keep a `bookOf` flow, so it is not replaced.
- **Symptom:** an author changed the project but players see the old game. **Cause:** players boot
  the published snapshot; `authoring=1` shows the live docs. **Guard:** re-publish from Game Maker.
- **Symptom:** two playtests diverge from their seeds. **Cause:** both used the same local mock
  port and consumed one RNG. **Guard:** rule: every run gets its own free port, never 7788.

## How to test

- **Root gates:** `pnpm check:holdandwin` (the mock proven over HTTP for every preset and the coin
  board, every forced beat, plus the facade and bonus-mode fixtures); it runs inside
  `pnpm check:rgs`. `pnpm check:engine-game` runs the engine fixtures.
- **Fixtures** (found by `pnpm check:all --only <name>`):
  `packages/game-config/holdAndWin.fixture.ts`, `coinBoard.fixture.ts`,
  `packages/rgs-translator-eagaming/coinBoard.fixture.ts`,
  `packages/engine-layout/scripts/test-hold-and-win-template.mjs`, `test-coin-board-template.mjs`,
  `test-pot-skin.mjs`, `test-respin-counter-part.mjs`, `scripts/verify-pot-meter-mount.mjs`.
- **Launcher gates** (`pnpm --filter launcher-api run check:<name>`): `project-scaffold`,
  `flow-publish-gate`, `unused-symbols-in-game`, `symbols-kind-gating`, `coin-label`,
  `respin-land`, `respin-counter-text`, `signal-scope`.
- **Playbooks:** `docs/playtest/hw-3pots-sample.md`, `docs/playtest/hw-classic-sample.md`,
  `docs/playtest/hw-collector-sample.md`, `docs/playtest/hold-and-win-coin-board.md`. Force beats
  through the authoring link on a free port; balance must equal before − stake + win; 0 console
  errors. `game-playtester` can run them.
- **Screens:** `scripts/current-games/screens/holdAndWin.json` (base, line win, feature, jackpot,
  multiplier, pots) through `scripts/current-games/run.mjs`.
- **A reviewer looks at:** money only from server events; a change gated so every other kind and
  every existing Hold and Win set hashes as before; a template change re-pinned on purpose, never
  silently; Borut parity (a book game's free-spin round) for shared-runtime changes.

## Read more

- `docs/status/hold-and-win.md` — Phase board, Decisions, Open items, Owner checklist, Touch list.
- `docs/design/hold-and-win.md` (§4 engine shape, §6 build plan, §7–8 Phases 11–12).
- `docs/design/hold-and-win-coin-board.md`.
- `docs/reference/hold-and-win-wire.md` and `docs/reference/play4fun-protocol.md`.
- Boundary: `docs/design/bonus-games.md`, `docs/design/pots-overlay.md`.
