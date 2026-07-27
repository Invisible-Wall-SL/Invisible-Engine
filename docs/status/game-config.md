# Invisible Game Config — status

> Design: [docs/design/invisible-game-config.md](../design/invisible-game-config.md) · Guide: [docs/tools/game-config.md](../tools/game-config.md) · Agent: `.claude/agents/invisible-game-config.md`

**One-line state:** All five build-plan phases landed AND the grid-dimensions enhancement — an
authored config now drives the symbols/paytable/paylines/bet-modes AND resizes the board in the
game, the mock RGS and the Scene Editor preview. **Live-verify owed:** the `/config` + `/editor`
pages render only inside the launcher (Postgres + R2 + session), and a non-5×3 end-to-end spin needs
the test-server; the game-board resize and the mock are verified locally, the launcher surfaces are
the owner's click-through.

## Current state

**Phase 1 — schema + storage (done).**
- `packages/game-config` — dependency-free, Node-resolvable (mirrors `engine-flipbook`):
  - `types.ts` — `GameConfigDoc`, byte-compatible with the Stake export (`special_properties`,
    `max_win`, single-entry paytable rows kept verbatim so paste-in works).
  - `normalize.ts` — `normalizeGameConfigDoc`, idempotent. Returns **`undefined`**, never an empty
    config, when the input can't describe a game: "no doc" must mean *fall through to the template*,
    not *blank board*. Accepts the friendly shorthands (`numRows: 3`, bare-string strip cells,
    multi-key paytable objects) so a hand-written config isn't rejected for being tidier.
  - `inPlay.ts` — **the gate**: `symbolsInPlay` / `symbolsInPlayForGameType` / `isSymbolInPlay` /
    `symbolFrequencies`, all reading the STRIPS, not the dictionary. One implementation, so the
    `W`-never-lands class of bug has a single place to be right.
  - `validate.ts` — `validateGameConfigDoc` / `gameConfigErrors`, severity-tagged and field-pathed.
    Errors block a ship (payline off the grid, strip dealing an undrawable symbol, wrong reel
    count); warnings describe a config that renders but lies (`W` pays but is never dealt).
- `apps/launcher-api/src/lib/server/gameConfigStorage.ts` — load/save with the standard ETag
  compare-and-swap, `InvalidGameConfigError` (carries the issue list → a useful 400),
  `ConflictError` → 409. Key `gameConfigDocKey()` → `<client>/<project>/config/config.json`
  (new `SUB.config`).
- `tools/game-config-spike` — 40 offline checks, run against the **real** `apps/lines` config so
  the fixture breaks the day the template stops satisfying the contract:
  `pnpm --filter game-config-spike run doc`. All passing. It asserts the `W` case directly:
  `W` is in the dictionary, absent from the in-play set, and warned about.

**Phase 2 — seed from the template (done).**
- `apps/launcher-api/scripts/generate-game-config-defaults.ts` — derives
  `$lib/data/gameConfig/<gameType>.json` from that game type's own `src/game/config.ts`, so the
  committed default and the compiled template cannot drift. Refuses to write a default that has
  blocking errors. `pnpm --filter launcher-api gen:game-config-defaults` /
  `check:game-config-defaults` (the `--check` gate writes nothing and exits 1 on drift — verified
  by mutating the JSON).
- `$lib/data/gameConfig/lines.json` — generated, the only committed default today (`bookOf` has no
  config module in this repo; a shipped game generates its own with `--game-type` + `--config`).
  Unknown game types fall back to `lines`, the same fallback `symbolDefaultsFor` uses.
- `gameConfigDefaults.ts` — `gameConfigDefaultFor()`, `listGameConfigTemplates()` (the "Reset to
  template default" menu), and `resolveGameConfig()`, the ONE entry point that owns the precedence
  `authored R2 doc → committed template default → compiled config`. It returns provenance
  (`source: 'authored' | 'template'`) plus the ETag, so the tool can say "inherited from the lines
  template" and still send the right compare-and-swap precondition on first save.
- The spike re-derives the committed JSON and compares bytes, so drift fails a fixture run even if
  nobody runs `--check` — a generator nobody runs is a generator that lies. 44 checks, all passing.

**Phase 3 — the runtime carries it (done).** The risky one; it landed with the compile-time
guarantee traded for a runtime one, as planned.
- `config` joins the bundle on BOTH paths — `assembleRuntimeBundle` (live) and
  `bake-editor-doc.mjs` via the new token-gated `GET /api/game-config/doc` (baked). Omitted when
  un-authored, so an un-authored project's bundle is byte-identical and the game runs its compiled
  `config.ts`. Neither path seeds the template default: the default is what the TOOL opens with, so
  an author adopts it knowingly rather than having it ship the day a template changes.
- `bakedGameConfig()` in `editor-scenes.ts` beside `bakedSymbolMap()`; `game/gameConfig.ts` owns the
  `runtime → baked → compiled` resolution behind a memoised `getActiveGameConfig()`, with
  `resetGameConfigCache()` wired into `Game.svelte` next to `resetSymbolMapCache()` — without that
  reset an online game freezes to the template, which is the exact bug this tool exists to kill.
- **`SymbolName` widened from `keyof typeof config.symbols` to `string`.** The compile-time union
  described the *sample* game, so it would have rejected a correct symbol id from an authored
  config. `BetMode`/`GameType` deliberately did NOT widen — they are shared vocabulary with the RGS,
  so they can't be freely invented per project.
- The lost guarantee is replaced by `warnOnGameConfigIssues()` at boot: every validator issue, plus
  an ERROR naming any symbol the strips deal that has no art (it would render as nothing mid-spin —
  the most expensive failure to diagnose).
- Consumers now read the active config instead of importing `config.ts`: `paytable.ts` (`NUM_LINES`
  → `numLines()`, `PAYTABLE` → `paytable()`), `constants.ts` (`PADDING_REELS` → `paddingReels()`,
  4 call sites), `infoManifest.ts` (config-derived fields are accessors now). They HAD to stop being
  module-scope constants: those evaluate before the async runtime bundle resolves.
- The paytable's display order became a PREFERENCE, not a filter — the old
  `LINE_ORDER.filter(...)` would have rendered an empty paytable for any project whose symbols
  aren't named `H1..L5`.
- **Verified in the running game** (`pnpm --filter lines dev`, modules imported live in the page):
  with no authored config it resolves the template (20 lines, 5×217-cell strips, paytable without
  the wild); with `bakedGameConfig()` temporarily stubbed to an authored 3-reel `ACE/KING/SCAT`
  config, the identity, line count (2), paytable rows, strips and the whole info manifest all
  followed, and the boot check correctly errored that the three symbols have no art. Stub reverted;
  re-verified back to template values.

**Still hardcoded, on purpose:** grid dimensions. `BOARD_DIMENSIONS`/`BOARD_SIZES` derive from
`INITIAL_BOARD`, not from `numReels`/`numRows`, so an authored grid size does NOT yet resize the
board — scene geometry and layout coordinates are pinned to it, and that deserves its own change.
The scatter paytable row is also still synthesized (`[2, 20, 200]`) because those multipliers have
no home in the Stake config shape; only the scatter's SYMBOL is read from the config now.

**Deviation from the design doc, deliberate:** Phase 1 called for a Zod `GameConfigDoc` in the
launcher. It has none. A Zod mirror would be a second, hand-copied answer to "what is a valid
config" inside an app whose `build` is not a type-check — the `COMPONENT_PARAM_KINDS` failure mode
(see `apps/launcher-api/CLAUDE.md`). The canonicalizer + validator are that one answer and produce
better 400s. Reversible if a use case demands Zod.

All five build-plan phases are done, plus the grid-dimensions enhancement. What remains is
verification the local environment couldn't reach, plus one deferred follow-up.

## The grid-dimensions enhancement (numReels/numRows resize the board)

Authoring the grid now resizes the board everywhere, not just in the `/config` Grid panel. Three
commits, three surfaces:
- **Game** (`game-config-grid` Phase 1) — `boardDimensions()`/`boardSizes()`/`initialBoard()` in
  `gameConfig.ts` replace the hardcoded `BOARD_DIMENSIONS`/`INITIAL_BOARD`; `stateGame`'s board is a
  `buildBoard()` factory rebuilt by `Game.svelte`'s `rebuildBoard()` after the runtime bundle lands
  (the online async-freeze pattern). ~9 consumers read the accessors. **Verified in-browser**: a
  stubbed 6×4 config rebuilt the board to 6 reels × (4+2) cells; reverting → 5×3 (parity).
- **Mock RGS** (Phase 2) — `createMockRgs({ reels, rows, paylines })`; the test-server injects the
  config's grid from `lines.json`. The Play4Fun facade's one 5×3 assumption (a warning) is dropped;
  `clampBoardToGrid`/`padReel` already generalized. **Verified** with a node harness: a 6×4 reveal is
  6×4, defaults stay 5×3.
- **Scene Editor** (Phase 3) — `drawReelGrid` draws the config's grid count (node still owns layout);
  `reelGridWarnings` compares the node to the config, not the template. Build-verified; the rendered
  preview is owner-verify-owed (launcher-only).

**Deliberately still hardcoded:** grid dimensions are the board COUNT + pixel size. Nothing else
about the grid (the scene-geometry anchors, the HUD layout) is config-driven — those remain authored
in the Scene Editor per game.

## Open items / next

1. **Live-verify the launcher surfaces** (owner click-through) — render `/config` (load a config,
   edit panels, off-grid payline blocks save, raw-JSON paste validates, save round-trips) AND
   `/editor` (the reelGrid preview draws the authored grid; a mismatched node warns). Plus a non-5×3
   end-to-end spin via the test-server + a dev game. The only things offline verification couldn't
   reach. **New this pass:** change the reel count → `Match grid` clears the errors and the new
   reels get strip boxes; colour a payline → its win line (and glow) draws in that colour in-game and
   `stateGame.winLineColor` carries it for the round.
2. **Validate against the RGS** (design doc open decision 3) — compare the config's symbol set to
   the first `reveal` and warn on a mismatch. `warnOnGameConfigIssues()` is the natural home; it
   would have caught the wild on the first spin.

**Not a gap:** `packages/game-spec`'s generator emits const-based `paytable.ts`/`infoManifest.ts`,
but it is a standalone CLI that `new-game.mjs` does NOT call — the scaffold copies `src/` from an
existing game (now `apps/lines`, with the accessor-based files), so a new game inherits the authored
-config wiring automatically. Left as-is on purpose.

## Blocked (owner / external)

- **Live-verify** waits on a launcher deploy + a click-through — the `/config` page can't render
  locally (Postgres + R2 + session). Not blocking the merge; it's a post-deploy check.

## Recent changes

- 2026-07-27 — **Grid-resize repair UX + per-payline colours** (this change; launcher surface
  owner-verify-owed, engine + schema build + typecheck-verified):
  - **`/config` Grid** — a `Match grid` button appears whenever a strip set or payline no longer
    matches `numReels` (the state a reel-count change leaves), padding/truncating every strip and
    payline to the grid in one click (new reels clone the last reel; new payline cells start on row
    0). The Reel-strips editor now renders a column PER `numReels`, not per existing strip entry, so
    the reels a widen added are authorable instead of a dead-end error. Fixes the "changed board
    size → error with no way to add strips" report.
  - **Per-payline colour** — new OPTIONAL `paylineColors: Record<lineId, '#rrggbb'>` on
    `GameConfigDoc` (an Invisible-Engine extension, NOT part of the Stake export; a paste-in config
    omits it). `normalizePaylineColors` keeps only colours for a line that exists and is a valid hex
    (`#rgb`/`#rrggbb`, expanded), so it's idempotent and an un-coloured config is byte-identical to
    before. Rides the existing config bake→pull chain — no new asset class. `/config` Paylines panel
    gets a colour swatch per line (tints the line id + active cells; ⌫ clears).
  - **Runtime** — `paylineColor(lineIndex)` in `game/gameConfig.ts` maps a win's `meta.lineIndex` →
    payline id → colour. `winLineColorFor()` in `flowEffects.ts` feeds it to all three `winLineShow`
    dispatch sites (coded `winInfo` handler, `showWinLine` flow effect, resting win cycle) as a new
    `winLineShow.color`. `WinLine.svelte` draws the core line + glow in that colour when set (else
    the single Symbols-tool default → parity), and publishes it as `stateGame.winLineColor` (cleared
    on hide) — the REUSABLE win-colour hook any asset component can read to tint itself to the
    winning line. `apps/lines` build passes; `game-config` typecheck + spike pass (the pre-existing
    CRLF `lines.json` byte-identical drift check is unrelated).

- 2026-07-27 — **Fix: online reel stopped rolling.** The grid-dimensions `rebuildBoard()` reassigned
  `stateGame.board = buildBoard()`, orphaning the `enhancedBoard` (createEnhanceBoard) that closes
  over the board array at module init and drives every preSpin/spin/settle — so online (the only path
  that calls `rebuildBoard`, after the live bundle lands) the rendered reels were static while spin
  animated the old detached reels. Fixed by rebuilding IN PLACE (`stateGame.board.splice(0, len,
  ...buildBoard())`) so render + enhancedBoard stay on the same reels. Also repointed the dangling
  `boardRaw()` `board` reference (left undeclared when #97 removed `const board`) to `stateGame.board`.
  Ships to online games via a Runtime release.
- 2026-07-27 — Grid-dimensions enhancement (branch `game-config-grid`): the authored numReels/numRows
  resize the board in the game (`boardDimensions()` + `rebuildBoard()`), the mock RGS (parameterized
  `createMockRgs`), and the Scene Editor preview (`drawReelGrid` from config, `reelGridWarnings` vs
  config). Fixed a latent CRLF drift-gate bug (`.gitattributes` `eol=lf` for the generated config
  JSON). Game + mock verified locally; launcher surfaces owner-verify-owed.
- 2026-07-24 — Phase 5: `publish-symbol-defaults.mjs` now gates its symbol set on the AUTHORED game
  config (fetched from `GET /api/game-config/doc`) when a project has one, falling back to the
  compiled module — so the Symbols grid mirrors what actually ships. Fixed a self-inflicted
  regression: `constants.ts` (imported standalone by that script) must not pull in
  `gameConfig`→`editor-scenes`, so the `paddingReels()` accessor moved to `gameConfig.ts` and its
  consumers import it there.

- 2026-07-24 — Phase 4: the `/config` tool — `roles.ts` registration (icon, TOOLS, ROLE_TOOLS,
  TOOL_BAR_ORDER, TOOL_DOC_SLUG), the page (Identity/Grid/Bet modes/Symbols/Paylines/Reel
  strips/raw-JSON panels, in-play badges + strip frequencies from the gate, inline validation), the
  session-gated `PUT/GET /api/game-config`, and the `docs/tools/game-config.md` guide. Page render +
  save round-trip are live-verify owed (needs the launcher); build + parsers fixture-verified.

- 2026-07-24 — Phase 3: `config` in both bundle paths + `GET /api/game-config/doc`,
  `bakedGameConfig()`, `game/gameConfig.ts` (memoised resolution + boot validation), `SymbolName`
  widened to `string`, and the paytable/strips/info-manifest consumers moved off the compiled
  module. Verified live in the running game.

- 2026-07-24 — Phase 2: `generate-game-config-defaults.ts` + the committed
  `$lib/data/gameConfig/lines.json`, `gameConfigDefaults.ts` (`resolveGameConfig` owns the
  precedence + provenance), drift gate in both the script and the fixture.
- 2026-07-24 — Phase 1: `packages/game-config` (schema + in-play gate + validator),
  `gameConfigStorage.ts` with ETag CAS, `game-config-spike` fixture, `invisible-game-config` agent.
