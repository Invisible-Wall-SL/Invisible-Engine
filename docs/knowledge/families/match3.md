# Match-3 — family knowledge

What is always true about match-3 games, and what has gone wrong with them. Owner agent:
`match3-games`.

## What it is and must stay

- A match-3 game is a board of gems. The player swaps two neighbours; a run of `minRun` or more
  explodes, the gems above fall, and new gems refill from the top. Cascades chain until nothing
  matches. A round is a fixed number of moves (or no limit, ended by a goal).
- It is a **slot board that does not spin.** `<Board/>`, `<TumbleBoard/>` and the flight layer stay
  mounted; the spin is never started. Every step after the swap is the cascade the shared runtime
  already plays. It is never a fork of `apps/lines` and never a second engine.
- Each game is **rules-decided** (free play: the board module decides, no wallet) or
  **RGS-decided** (real money: the server decides every board, refill and win). The outcome is a
  per-game option in Game Config, read only through `resolveOutcome()`.
- **Presentation is written once.** Both paths raise the same engine events (`boardInit`, `swap`,
  `tumbleBoard`, …) and the same Flow signals; only the source differs.
- Publishing goes to our test server only. **Delivery is slot-only**: a rules game never, an RGS
  match-3 game not until a real provider's match-3 wire exists (design §9 #2).
- The family's tools: everything except Invisible Characters (`FAMILY_TOOLS` in
  `apps/launcher-api/src/lib/roles.ts` lists what a family hides).

## Invariants

- **One board module, two callers.** `packages/engine-mechanics/src/board.js` is pure ESM with no
  imports. The client and the mock (`scripts/mock-rgs-server-match3.mjs`) import the same file, so
  they cannot disagree about a match. The test-server image copies it and its `package.json`
  (`services/test-server/Dockerfile`).
- **Grid shape.** Column-major `cells[reel][row]`, row 0 at the top, gems as `RawSymbol`. A
  `resolve` step carries a `tumbleBoard` event, refills top first (`board.js`).
- **The client cannot decide money.** In RGS mode the board is built with `rng: null`; any deal,
  pool refill or shuffle throws (`board.js`, `packages/engine-game/src/game/match3RgsSession.ts`).
  Gate: `check:match3-outcome-guard`.
- **The server's board wins.** The client replays each move with the server's refills; a
  difference is logged as a wire bug and the server's settled board is kept. The swap pre-check is
  UX only (`match3RgsSession.ts`).
- **No rules-only Flow nodes in an RGS game.** `withOutcome(vocab, 'rgs')` drops
  `MATCH3_RULES_ONLY_ACTIONS` (`boardResolve`, `boardRefill`, `boardShuffle`); a doc that keeps one
  gets `rules-only-in-rgs` and Publish refuses it (`packages/engine-flow-v2/src/reference/outcome.ts`,
  `packages/engine-flow-v2/src/validate.ts`).
- **Money comes only from books.** A Flow variable cannot shadow win, balance or bet in an RGS game
  (`variable-shadows-money`, `packages/engine-flow-v2/src/variableValidate.ts`). Rules-game score has
  no currency.
- **Wire.** Ours, labelled, versioned `MATCH3_WIRE = 1` (`docs/reference/match3-wire.md`). `move` is
  a stored action under the `gid`; the fetcher advances `seq` by one. Never hand-write an `advance`
  for it. A re-post at an occupied `seq` replays and charges nothing. Gate: `check:match3-wire`.
- **The round ends on `match3RoundEnd`, not `roundEnd`.** Every match-3 flow has a `roundEnd` chain,
  and a book event a flow has a chain for is driven by the flow alone, so a book `roundEnd` never
  closed the round. The runtime raises the `roundEnd` signal itself
  (`packages/rgs-translator-eagaming/src/match3.ts`, `apps/lines/src/game/match3.svelte.ts`).
- **Interactive round.** A book with `boardInit` is interactive: open across player-paced requests,
  collected exactly once (`packages/utils-xstate/src/createPrimaryMachines.ts`,
  `apps/lines/src/game/actor.ts`). Slots pass neither option, so their machine is unchanged.
- **The runtime asks only the mechanic.** `mechanicFor(config)` (`packages/engine-game/src/game/mechanic.ts`)
  answers `spins`, `bets`, `rgsSession`, `boardInput`, `interactiveRound`, `unplayable`. Every
  slot gate reads as before for `REELS_MECHANIC`.
- **Free play never reaches a wallet.** No authenticate, no balance poll; it refuses any delivery
  profile (`packages/components-shared/src/components/Authenticate.svelte`); the delivery gate
  refuses it (`scripts/delivery-family-gate.mjs`); its test-server mock is `freePlay`, which refuses
  every request. An RGS match-3 is `mockOnly`: refused under any partner profile.
- **Defaults are never stored.** `family`, `outcome` and the `match3` win-model arm are dropped when
  default; a slot doc normalizes byte-identically (`packages/game-config/src/family.ts`, gate
  `check:family-defaults-identity`).
- **Every protocol list knows `match3` and `freePlay`.** A list that does not falls back to `lines`
  silently (`apps/launcher-api/src/lib/server/mockProtocol.ts`,
  `apps/launcher-api/src/lib/server/testServerManifest.ts`, `services/test-server/makeMock.mjs`).
- **Seed + moves replay a rules game.** The rng (`createRng`, mulberry32) cannot be saved; a game is
  not resumed in v1. The board seed is `?m3seed=`.

## Where the code lives

| Part                              | Path                                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Board rules                       | `packages/engine-mechanics/src/board.js` (+ `board.d.ts`), replay trace `packages/engine-mechanics/fixtures/board-replay.json`                  |
| Rules session, RGS mirror, driver | `packages/engine-game/src/game/match3Session.ts`, `match3RgsSession.ts`, `match3Driver.ts`                                                      |
| Mechanic                          | `packages/engine-game/src/game/mechanic.ts`, `apps/lines/src/game/mechanic.ts`                                                                  |
| Runtime presenter, input          | `apps/lines/src/game/match3.svelte.ts`, `apps/lines/src/components/Match3Input.svelte`, `apps/lines/src/game/flowBoardEffects.ts`               |
| Cell hit-test                     | `getCellAt` in `packages/engine-game/src/game/gameState.svelte.ts`                                                                              |
| Pointer gesture                   | `packages/engine-layout/src/lib/componentPointer.ts`                                                                                            |
| Flow vocabulary, starters         | `packages/engine-flow-v2/src/reference/match3.ts`, `match3Seed.ts`, `match3RgsSeed.ts`, `outcome.ts`                                            |
| Flow variables and timers         | `packages/engine-flow-v2/src/state.ts`, `apps/lines/src/game/flowV2Runtime.svelte.ts`                                                           |
| Config                            | `packages/game-config/src/family.ts`, `familyValidate.ts`, `match3Mock.ts`                                                                      |
| Scene set, template               | `packages/engine-layout/src/lib/referenceLayouts/match3.ts`, `packages/engine-layout/src/lib/templates/match3.ts`                               |
| Game Maker seeds                  | `apps/launcher-api/src/lib/data/gameConfig/match3.rules.json`, `match3.rgs.json`                                                                |
| Publish gate, contract            | `apps/launcher-api/src/lib/server/familyGate.ts`, `mockContract.ts`, `projectScaffold.ts`                                                       |
| Wire facade                       | `packages/rgs-translator-eagaming/src/match3.ts`, `requestMove` in `engineFacade.ts`; stock stub in `packages/rgs-requests/src/rgs-requests.ts` |
| Mock                              | `scripts/mock-rgs-server-match3.mjs`, `services/test-server/makeMock.mjs`                                                                       |
| Probe, harness                    | `apps/lines/src/game/determinism.ts`, `scripts/current-games/lib/play.mjs`, `scripts/current-games/screens/match3.json`                         |

Shared mechanics have other owners: the Flow format (variables, timers, tick) is `invisible-flow`;
pointer listeners and Align Target are `invisible-components`; spawning and `motion.js` are
`arcade-games` (match-3 does not use spawning). This family owns how match-3 uses them.

## Known failure modes

- **Symptom:** a published match-3 game stalls at its first swap (`moves 0`, `roundOpen false`).
  **Cause:** a kind change plus a create-only re-scaffold kept another family's flow, so a slot flow
  drove the board (`apps/launcher-api/src/lib/server/projectScaffold.ts`). **Guard:**
  `check:project-scaffold`; Publish's `flow-wrong-kind` refusal (#1369).
- **Symptom:** an RGS round never closes. **Cause:** the book event was named `roundEnd`, which every
  match-3 flow chains on, so the flow owned it and nothing collected. **Guard:** the book event is
  `match3RoundEnd`; `packages/rgs-translator-eagaming/match3.fixture.ts`, `check:match3-outcome-guard`
  (P10.6, #1337).
- **Symptom:** a match-3 game is dealt the `lines` mock, or the project card shows protocol drift.
  **Cause:** a protocol list without `match3` / `freePlay` falls back to `lines`. **Guard:**
  `check:match3-wire` (every list), `check:mock-contract`. A game published before P10.6 shows the
  drift chip until re-published.
- **Symptom:** Flow variables never update in the game (score stays 0). **Cause:** `Game.svelte`'s
  Flow-state ticker effect read the Pixi ticker before Pixi's async init and never re-ran. **Fix:**
  keyed on `stateApp.loaded` too (P10.5). **Guard:** none; the `match3-play.mjs` playtest sees it.
- **Symptom:** a rules game's flow fails publish with `variable-shadows-money`. **Cause:** Publish
  validated without the config's outcome, so it assumed RGS. **Guard:** `check:flow-publish-gate`
  runs the match-3 starter as a rules game (P10.5).
- **Symptom:** current-games reports `match3test` failing on every PR. **Cause:** a free-play game
  main cannot play either. **Guard:** the harness's `freePlay` rule turns an identical stall into a
  note (`scripts/current-games/lib/assemble.mjs`, `assemble.fixture.mjs`, #1374).
- **Symptom:** a harness script waits forever on a match-3 board. **Cause:** the probe's `idle`
  stays true (the round machine never runs). **Guard:** scripts wait on `boardBusy`
  (`scripts/current-games/screens/match3.json`).
- **Symptom:** a drag stays open, or Align Target keeps a stale offset. **Cause:** a second finger,
  a cancelled touch (Pixi 8 forwards no `pointercancel`) or a release off a `move`-only node left a
  press open (`componentPointer.ts`). **Guard:** `check:component-pointer-drag` (P10.4).
- **Symptom:** a tap between rows on a perspective board picks no cell. **Cause:** `getCellAt` uses
  the pitch box, which follows the seat, so a row lead other than 0.5 leaves a sliver. **Guard:**
  `check:component-pointer-drag` (known limit, not a bug).
- **Symptom:** an RGS board that cannot be mirrored. **Cause:** server refills that do not fit the
  local chain make `resolve` throw. **Handling:** the round stays open behind the error modal and a
  reload resumes it; it is never collected unplayed (`apps/lines/src/game/match3.svelte.ts`).
- **Symptom:** `resolve` or a deal throws. **Cause:** strips that cannot make a playable board
  (200 deals) or a runaway chain (100 steps). It is a config problem, not a code one (`board.js`).
- **Symptom:** a free-play game still plays with `?sessionID=` in the URL. **Cause:** the runtime
  refuses only a delivery profile, not an operator session id. No money moves. **Guard:** none;
  owner to decide (status "Publishing playable non-slot games").

## How to test

- Root gates: `pnpm check:board-mechanic` (board rules and the seed replay trace),
  `pnpm check:match3-wire` (the real facade against the real mock, plus
  `packages/rgs-translator-eagaming/match3.fixture.ts`; also run by `pnpm check:rgs`).
- Launcher gates (`pnpm --filter launcher-api <script>`): `check:match3-rules`,
  `check:match3-outcome-guard`, `check:game-config-family`, `check:family-defaults-identity`,
  `check:family-tools`, `check:mock-contract`, `check:flow-publish-gate`,
  `check:symbols-kind-gating`, `check:flow-variables`, `check:flow-time-events`,
  `check:component-pointer-drag`, `check:project-scaffold`.
- Playbook: `docs/playtest/match3-sample.md` (S1–S8 free play, R1–R5 RGS), driven by
  `scripts/playtest/match3-play.mjs` and `scripts/playtest/match3-rgs-play.mjs`, or handed to
  `game-playtester`.
- Screens: `scripts/current-games/screens/match3.json` (`loaded`, `board`, `selected`, `refused`,
  `cascaded`) on the `cg-match3` fixture.
- A reviewer checks: no slot path changed (every new branch keyed on a match-3 config, a `match3`
  boot block or a `boardInit` event); no local RNG on an RGS board; `seq` moves by one per move; the
  balance moves only at the bet and the collect; the bundle-size cost is reported.

## Read more

- `services/director-worker/families/match3.md`: what Director's runtime agents read about this
  family (the whole pack). The pack is the one home of that text; edit it there.
- `docs/status/game-families.md` (P10.2–P10.6 and "Publishing playable non-slot games")
- `docs/design/game-families.md` (§2, §3, §4.1, §7, §8)
- `docs/reference/match3-wire.md`, `docs/reference/play4fun-protocol.md`
- `docs/status/flow.md`, `docs/status/game-maker.md`, `docs/status/engine.md`
