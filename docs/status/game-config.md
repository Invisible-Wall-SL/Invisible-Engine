# Invisible Game Config — status

> Design: [docs/design/invisible-game-config.md](../design/invisible-game-config.md) · Guide: — (due with Phase 4) · Agent: `.claude/agents/invisible-game-config.md`

**One-line state:** Phase 1 landed — the schema, the in-play gate, the validator and R2 storage
exist and are fixture-verified; **nothing reads them yet**, so the game still runs the one compiled
`apps/lines/src/game/config.ts` every online project shares.

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

**Deviation from the design doc, deliberate:** Phase 1 called for a Zod `GameConfigDoc` in the
launcher. It has none. A Zod mirror would be a second, hand-copied answer to "what is a valid
config" inside an app whose `build` is not a type-check — the `COMPONENT_PARAM_KINDS` failure mode
(see `apps/launcher-api/CLAUDE.md`). The canonicalizer + validator are that one answer and produce
better 400s. Reversible if a use case demands Zod.

## Open items / next

1. **Phase 2 — seed from the template.** Committed per-template defaults
   (`$lib/data/gameConfig/<template>.json`) generated from the template's own `config.ts` so the
   two cannot drift (the `publish-symbol-defaults.mjs` producer pattern). "Reset to template
   default" as a first-class action.
2. **Phase 3 — the runtime carries it.** `config` into `assembleRuntimeBundle` + the bake,
   `bakedGameConfig()` beside `bakedSymbolMap()`, resolution `runtime → baked → compiled template`.
   **The risky phase:** `SymbolName` is `keyof typeof config.symbols`, a COMPILE-TIME type imported
   at module scope by `types.ts` / `constants.ts` / `paytable.ts`. It must widen to `string` at the
   boundary, with runtime validation + a loud boot warning replacing the lost guarantee. Do it
   behind a memoised `getActiveGameConfig()` reset on runtime-bundle apply.
3. **Phase 4 — the tool** (`/config` + `roles.ts` + `docs/tools/game-config.md` in the SAME change,
   repo rule 9).
4. **Phase 5 — retire the duplication**, incl. pointing `publish-symbol-defaults.mjs` at the
   authored doc rather than the compiled module.

## Blocked (owner / external)

- Nothing. Phases 2–5 are ours to build.

## Recent changes

- 2026-07-24 — Phase 1: `packages/game-config` (schema + in-play gate + validator),
  `gameConfigStorage.ts` with ETag CAS, `game-config-spike` fixture, `invisible-game-config` agent.
