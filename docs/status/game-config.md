# Invisible Game Config — status

> Design: [docs/design/invisible-game-config.md](../design/invisible-game-config.md) · Guide: — (due with Phase 4) · Agent: `.claude/agents/invisible-game-config.md`

**One-line state:** Phases 1–2 landed — the schema, the in-play gate, the validator, R2 storage and
the per-template seed exist and are fixture-verified; **the game still doesn't read any of it**, so
every online project runs the one compiled `apps/lines/src/game/config.ts` until Phase 3.

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

**Deviation from the design doc, deliberate:** Phase 1 called for a Zod `GameConfigDoc` in the
launcher. It has none. A Zod mirror would be a second, hand-copied answer to "what is a valid
config" inside an app whose `build` is not a type-check — the `COMPONENT_PARAM_KINDS` failure mode
(see `apps/launcher-api/CLAUDE.md`). The canonicalizer + validator are that one answer and produce
better 400s. Reversible if a use case demands Zod.

## Open items / next

1. **Phase 3 — the runtime carries it.** `config` into `assembleRuntimeBundle` + the bake,
   `bakedGameConfig()` beside `bakedSymbolMap()`, resolution `runtime → baked → compiled template`.
   **The risky phase:** `SymbolName` is `keyof typeof config.symbols`, a COMPILE-TIME type imported
   at module scope by `types.ts` / `constants.ts` / `paytable.ts`. It must widen to `string` at the
   boundary, with runtime validation + a loud boot warning replacing the lost guarantee. Do it
   behind a memoised `getActiveGameConfig()` reset on runtime-bundle apply. `resolveGameConfig()`
   from Phase 2 is what the bundle assembly should call — don't re-implement the precedence.
2. **Phase 4 — the tool** (`/config` + `roles.ts` + `docs/tools/game-config.md` in the SAME change,
   repo rule 9).
3. **Phase 5 — retire the duplication**, incl. pointing `publish-symbol-defaults.mjs` at the
   authored doc rather than the compiled module.

## Blocked (owner / external)

- Nothing. Phases 3–5 are ours to build.

## Recent changes

- 2026-07-24 — Phase 2: `generate-game-config-defaults.ts` + the committed
  `$lib/data/gameConfig/lines.json`, `gameConfigDefaults.ts` (`resolveGameConfig` owns the
  precedence + provenance), drift gate in both the script and the fixture.
- 2026-07-24 — Phase 1: `packages/game-config` (schema + in-play gate + validator),
  `gameConfigStorage.ts` with ETag CAS, `game-config-spike` fixture, `invisible-game-config` agent.
