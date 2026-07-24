# Invisible Game Config — status

> Design: [docs/design/invisible-game-config.md](../design/invisible-game-config.md) · Guide: — (due with Phase 4) · Agent: `.claude/agents/invisible-game-config.md`

**One-line state:** Phases 1–3 landed — a project's authored config now **reaches the running
game** and drives its paytable, line count, paylines and reel strips. The remaining gap is the tool
(Phase 4): there is no `/config` page, so a config can only arrive by writing the R2 doc directly.

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

## Open items / next

1. **Phase 4 — the tool** (`/config` + `roles.ts` + `docs/tools/game-config.md` in the SAME change,
   repo rule 9). The page loads via `resolveGameConfig()`, which already returns the doc, its
   provenance and its ETag — don't re-implement the precedence or the compare-and-swap.
   **This is now the only thing standing between the plumbing and an author using it.**
2. **Phase 5 — retire the duplication**, incl. pointing `publish-symbol-defaults.mjs` at the
   authored doc rather than the compiled module, and `packages/game-spec`'s generator, which still
   emits const-based `paytable.ts`/`infoManifest.ts` for a scaffolded game and so would ignore the
   authored config.
3. **Grid dimensions from the config** — `BOARD_DIMENSIONS` still derives from `INITIAL_BOARD`, so
   an authored `numReels`/`numRows` doesn't resize the board (see above). Its own change.
4. **Validate against the RGS** (design doc open decision 3) — compare the config's symbol set to
   the first `reveal` and warn on a mismatch. `warnOnGameConfigIssues()` is the natural home; it
   would have caught the wild on the first spin.

## Blocked (owner / external)

- Nothing. Phases 4–5 are ours to build.

## Recent changes

- 2026-07-24 — Phase 3: `config` in both bundle paths + `GET /api/game-config/doc`,
  `bakedGameConfig()`, `game/gameConfig.ts` (memoised resolution + boot validation), `SymbolName`
  widened to `string`, and the paytable/strips/info-manifest consumers moved off the compiled
  module. Verified live in the running game.

- 2026-07-24 — Phase 2: `generate-game-config-defaults.ts` + the committed
  `$lib/data/gameConfig/lines.json`, `gameConfigDefaults.ts` (`resolveGameConfig` owns the
  precedence + provenance), drift gate in both the script and the fixture.
- 2026-07-24 — Phase 1: `packages/game-config` (schema + in-play gate + validator),
  `gameConfigStorage.ts` with ETag CAS, `game-config-spike` fixture, `invisible-game-config` agent.
