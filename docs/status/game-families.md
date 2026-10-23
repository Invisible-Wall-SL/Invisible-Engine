# Game families (Phase 10) — status

> Design: [docs/design/game-families.md](../design/game-families.md) · Guide: [docs/tools/game-config.md](../tools/game-config.md) (_Game family_) · Agents: `invisible-game-config`, `invisible-game-maker`, then per phase

**One-line state:** the owner started Phase 10 on 2026-10-23. **P10.1 (family and outcome in Game
Config) is merged; P10.1b (tools per family) is built** and in review. No runtime behaviour yet: a
match-3 or arcade config can be authored but not published. P10.2 and later have not started.

## Current state

**P10.1b — tools per family (built 2026-10-23; in review).** §6.5.

- **The list:** `FAMILY_TOOLS` beside `TOOLS` in `apps/launcher-api/src/lib/roles.ts` names the
  tools a family does **not** use: slot and match-3 nothing, arcade Symbols and Win Text. A
  project's family is `projectFamily(key, gameType)` (`lib/server/projects.ts`): `familyOfKind()`
  of its recorded kind, and always a slot for the shared `cloud` scope.
- **Home and tool bar:** `(app)/+layout.server.ts` drops the hidden tools from `tools` (which feeds
  the home grid and `ToolTopBar`) and returns `family`. It reads the family of the page's
  `?project=` when the user may reach it, else of the session's project, because the page syncs
  `?project=` into the session only after the layout has run. The read is tracked, so a
  client-side hop to another project's `?project=` re-runs the layout (and only that param does).
  Onboarding keeps the role's whole manifest: it describes what a role may use.
- **The notice:** `(app)/+layout.svelte` renders "<tool> is not used by arcade games", names the
  project, and links home, in place of the page when the URL is a hidden tool's (`familyHiddenToolAt`). The tool's own
  load still runs; nothing renders from it.
- **Director:** `ADAPTER_TOOL_IDS` (`director/adapter.ts`) maps each adapter tool to its launcher
  tool, and `buildRegistry` refuses an op whose tool maps to none. The gate refuses an op on a tool
  the project's family hides with 403 `not_for_family`, after the scope check.
- **Slot parity:** for every role, a slot, legacy (no kind), custom-kind and `cloud` project gets
  exactly `manifestForRole`, and a slot page renders exactly its children.
- **Verified:** `check:family-tools` (151 checks: the list, the real layout load per role and
  family, onboarding, the real layout server-rendered, the real gate), and `check:director-adapters` with its
  fixture op moved onto a mapped tool.
- **Not built here:** Win Text's own "this game pays no money" message for a rules-decided match-3
  game (§6.5's outcome bullet) is not in §8's P10.1b row; it waits for a match-3 project to exist
  (P10.5).

**P10.1 — family and outcome in Game Config (built 2026-10-23; merged #1310).**

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

1. Win Text's outcome message for a rules-decided match-3 game (§6.5), with P10.5 or before it.
2. P10.2 onward, in §8's order. P10.5 replaces the family gate for match-3 with the runtime
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

- 2026-10-23 — **P10.1b built: tools per family.** Arcade projects are not offered Symbols or Win
  Text; a direct link shows a notice; Director's gate refuses those ops. Slot projects unchanged.
  Detail above.

- 2026-10-23 — **P10.1 built: family and outcome in Game Config.** The owner gave the go-ahead
  for Phase 10, and accepted the five P10.1 recommendations and three notes the build raised
  (§9 #20–#27). Detail above.
