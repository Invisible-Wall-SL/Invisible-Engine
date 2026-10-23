# Game families (Phase 10) — status

> Design: [docs/design/game-families.md](../design/game-families.md) · Guide: [docs/tools/game-config.md](../tools/game-config.md) (_Game family_) · Agents: `invisible-game-config`, `invisible-game-maker`, then per phase

**One-line state:** the owner started Phase 10 on 2026-10-23. **P10.1 (family and outcome in Game
Config) is merged; P10.2 (the board module) is built** and in review. No runtime behaviour yet: a
match-3 or arcade config can be authored but not published, and nothing calls the board module.
P10.1b runs in parallel; P10.3 and later have not started.

## Current state

**P10.2 — the board module (built 2026-10-23; in review).** A new dependency-free package,
`packages/engine-mechanics` (§4.0): `src/board.js`, plain ESM with no imports, and its hand-written
`src/board.d.ts`, re-exported by `index.ts` as `engine-cinematic` does. **No caller yet**, so no
game, bundle or screen changes.

- **The rule set (§4.1):** `createBoard`, `canSwap`, `swap`, `findMatches` (row and column runs of
  `minRun`+, merged into `L` / `T`; a lone run is `line2`–`line5`, `line5` meaning five or more),
  `clear`, `gravity` (with the falls), `refill`, `resolve` (the cascade loop), `findMoves` /
  `hasMoves`, `shuffle`, and `createRng` (mulberry32; a string seed is hashed).
- **The grid is the slot board's:** column-major `cells[reel][row]`, row 0 at the top, gems shaped
  as `RawSymbol`. Each `resolve` step carries a `tumbleBoard` event (no `index`) whose
  `newSymbols[reel]` are the gems dropped into that column top first, exactly as the mock RGS's
  cascade sends them, beside its match groups and falls.
- **Refill sources:** `'pool'` reads the column's strip (`paddingReels`) from a seeded stop, as a
  reel strip is read, wrapping; or a book's `newSymbols`, which must fit the holes exactly.
  `resolve` takes either, one book refill per step, so an RGS board can mirror the server's chain.
- **The RGS guard (§2.2 #1):** a board built with `rng: null` (the default) throws on any deal,
  pool refill or shuffle, even one handed an rng; it takes gems only from given cells and the book.
  A book whose refills outnumber or fall short of the local chain throws too: that is the
  client/server mismatch §2.2 #4 logs.
- **Replay is seed + moves.** The rng is one closure shared by every board derived from the first,
  and its state cannot be saved, so a rules game resumes by replaying from its seed. P10.5 decides
  whether a saved game needs more.
- **Choices this build made** (the plan does not fix them; easy to change before P10.5 calls it):
  - a **dealt board** has no match and at least one move (up to 200 seeded deals, then it throws:
    the strips cannot make a playable board); `shuffle` keeps the same promise;
  - `canSwap` needs the match to **take in one of the two swapped gems**, so a swap beside a run
    that is already on the board is not a move;
  - `resolve` stops after 100 steps and throws (a runaway chain is a strips problem); `refill`
    throws when a hole sits below a gem (gravity has not run);
  - `findMoves` (every legal swap, each pair once) is exported because `board.hint()` needs one.
- **Gate `check:board-mechanic`** (`scripts/check-board-mechanic.mjs`, run by `check:all`): 32
  checks over drawn grids: runs, line shapes, `L` / `T`, `minRun`; legal and illegal swaps;
  gravity's falls; book and pool refills; a chain fed by refills and one made by falls alone; the
  RGS mirror (a pool chain replayed on an `rng: null` board from its own `newSymbols` gives the
  same steps and board); `hasMoves`; shuffle; the deal; malformed input. Three scripted sessions
  (two 7 × 6, one 5 × 5 that dead-ends and shuffles) replay identically and match the committed
  trace, `packages/engine-mechanics/fixtures/board-replay.json` (`--update` rewrites it).
- **Not done here, by plan:** the mock's import and the test-server Dockerfile lines (P10.6), the
  `MATCH3_VOCAB` nodes and any runtime caller (P10.5), specials (P10.5b).

**P10.1 — family and outcome in Game Config (built 2026-10-23; merged in #1310).**

- **Schema** (`packages/game-config`): four optional fields on `GameConfigDoc`: `family`
  (`match3` / `arcade`; absent ⇒ a slot), `outcome` (`rules`; absent ⇒ `rgs`), and the
  `match3` / `arcade` blocks (`src/family.ts`). The win model gains a fifth arm,
  `{ type: 'match3', minRun }`, which is never stored: `resolveWinModel()` builds it from
  `match3.minRun` for any match-3 doc (§9 #20).
- **Resolvers:** `resolveFamily`, `resolveOutcome` (a slot is always `rgs`), `resolveMatch3`,
  `resolveArcade`. No code reads the raw fields.
- **The normalizer** learns the fields and drops every default: `family: 'slot'`, `outcome: 'rgs'`,
  `minRun: 3`, `fixedHz: 60`, empty blocks, `outcome` on a slot, a block beside the wrong family,
  and a match-3 doc's `winModel` and `cascade`. An arcade doc normalizes with no symbols or strips.
- **Validation follows the family** through one table, `configSectionsFor(family, outcome)`
  (`src/familySections.ts`): each existing check runs only where its `/config` section shows, so
  a slot is checked exactly as before. New checks (`src/familyValidate.ts`):
  - match-3: a rectangular board, and a min run that fits it;
  - match-3 rules: no moves warns, an unreachable goal is refused, a score row below the min run
    warns; an empty `betModes` is allowed;
  - arcade: an RGS-decided arcade game is refused (§9 #21), and a rate outside 30–240 Hz warns.
- **`/config`** reads the same table: a slot project's page is unchanged and has no picker. A
  project whose kind or config is a non-slot family gets **Game family** (family + outcome) and
  the **Match-3** or **Arcade** section (`FamilySection.svelte`, setters in `familyDoc.ts`).
- **`GAME_KINDS`** gains `match3` and `arcade`, with `SLOT_GAME_KINDS`, `GAME_FAMILIES` and
  `familyOfKind()` beside it (pulled forward from P10.1b, §9 #27). The slot-only consumers derive
  from `SLOT_GAME_KINDS`: the Scene Editor's template-type picker, the flow-vocabulary generator and
  game-spec's schema. Game Maker still offers neither kind: it needs a full scene set (P10.5).
- **`kindCapabilities`** takes `family` / `outcome` and gains `wallet`, `betControls` and `board`
  (all `true` for a slot). A match-3 or arcade project is offered none of a slot's sections.
  `projectAddOns()` passes a non-slot config's family and outcome to it, so the tools follow the
  config as `/config` does; a slot config adds neither.
- **The family gate:** the online publish and the desktop bake's config export
  (`/api/game-config/doc`) refuse a non-slot config, with no override, until its runtime exists
  (§9 #26).

**Verified (2026-10-23):**

- `family.fixture.ts`, `check:family-defaults-identity` (every shipped config; 26 normalize, the
  cluster sample's is refused as before), `check:game-config-family`
  (setters vs normalizer; the page server-rendered per family), plus the existing
  `check:symbols-kind-gating` and `check:flow-publish-gate`, moved to the slot kinds.
- Against `main`, by hand:
  - `main`'s own normalizer and validator over 28 shipped configs (the same corpus plus the
    number-picker and price apps): 0 differences.
  - `/config` server-rendered on both sides for seven slot seeds: the same text and markup.
  - The diff runs Prettier over `+page.svelte`. With whitespace ignored, it adds only the `{#if}`
    gates and the family markup.

## Open items / next

1. **P10.1b — tools per family** (§6.5): `FAMILY_TOOLS`, the filtered launcher home and tool bar,
   the hidden-tool notice, and Director's gate. `familyOfKind()` is already in place.
2. P10.3 onward, in §8's order. P10.5 is the board module's first caller (the rules runtime branch
   and the `/flow-v2` preview); P10.6 the mock's. P10.5 replaces the family gate for match-3 with the runtime
   branch, and registers the match-3 scene set, vocabulary and starter flow. It moves `match3` into
   the slot-only loops of `check:flow-publish-gate` and decides which Reel behaviour switches
   match-3 shows.
3. The `/config` **Characters** link for arcade (§6.2) lands with Invisible Characters (P10.11).
4. **Confirm no custom kind is named `match3` or `arcade`** in R2 (`_shared/editor-kinds/`). Such a
   kind would now read as that family, and the built-in id would hide it from the pickers. Needs R2
   access, which this build did not have.
5. The runtime still prices and draws the `match3` arm as the lines default (`payoutDivisor`,
   `winLineShapeFor`), and `engine-game/src/game/gameConfig.ts`'s note about a fifth win model
   still stands. That code path is unreachable while the family gate holds; P10.6 honours the arm
   (divisor 1) when RGS match-3 lands.

## Blocked (owner / external)

- Nothing for P10.1. §9 #18 (where an online game's rules run) is still open; it blocks only A4.

## Recent changes

- 2026-10-23 — **P10.2 built: the board module** (`packages/engine-mechanics`, `check:board-mechanic`).
  Detail above.
- 2026-10-23 — **P10.1 built: family and outcome in Game Config.** The owner gave the go-ahead
  for Phase 10, and accepted the five P10.1 recommendations and three notes the build raised
  (§9 #20–#27). Detail above.
