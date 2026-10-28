# Phase 11: a runtime per family, then online arcade and Salmons (plan)

> **Status:** plan, written 2026-10-28 after the owner approved starting the next phase.
> **Approved by the owner on 2026-10-28: every §4 recommendation is accepted as written, and
> P11.1a is started.** Phase 10 is done
> ([game-families.md](game-families.md) §8, [status/game-families](../status/game-families.md)),
> and so are Cards C1–C3 ([card-games.md](card-games.md) §12); C4, the Card Library, is being built
> separately and is not part of this phase.
>
> Agents: `engine-pixi-svelte` and `infra-railway` (P11.1), `arcade-games` (P11.2–P11.5),
> `invisible-game-config` (`/config` sections), `invisible-game-maker` (publish), `regression-guardian`
> (the current-games proof). State lives in the status files, not here.

## Contents

1. [Why this order](#1-why-this-order)
2. [P11.1 — a runtime per family](#2-p111--a-runtime-per-family)
3. [The build plan](#3-the-build-plan)
4. [Decisions (owner)](#4-decisions-owner)

---

## 1. Why this order

The owner's order, with the reason for each:

1. **The per-family runtime build first.** Every family added in Phase 10 and C3 made every slot
   game's download bigger, though a slot game never runs the code. The measured costs are in
   [status/game-families](../status/game-families.md) (open items 0a, 1a and 9, and P10.15's bundle
   note): the Colyseus SDK about 59 KB gz, its predictor 17.3 KB gz, the card table 17.7 KB gz,
   match-3 and arcade together a few tens of KB gz. All live, paying games are slots. The
   split also has to land before the arcade work below grows the arcade code further.
2. **Online arcade completion.** The things Phase 10 left out
   ([status/game-families](../status/game-families.md) open items 0 and 1, and P10.16's "Known
   limits"). Without them Salmons has no HUD, no round-over screen and no published address.
3. **Salmons' own rules.** The rules that make Salmons more than the P10.16 skeleton
   ([status/salmons](../status/salmons.md) "not yet built"), and the S0 art.
4. **Isometric projection and diamond tiles** ([game-families.md](game-families.md) §4.4, §9 #19).
5. **Offline abilities and zone forces** (open item 15): today only online rooms have them.
6. **Cards C5**, optional, waiting on the owner ([card-games.md](card-games.md) §12, §13 #2–#3).

---

## 2. P11.1 — a runtime per family

### 2.1 The problem

The runtime is one bundle. SvelteKit's `bundleStrategy` is `'inline'` (`'single'` for embed
builds), set in `packages/config-svelte/index.js`. Both inline every dynamic import, so a lazy
`import()` does not keep code out of the file ([game-families.md](game-families.md) §6.4;
P10.5's note in the status file). `apps/lines/src/game/online.ts` already loads `engine-rooms` and
`engine-rooms/predict` lazily, and both still ship in every game. `Game.svelte` imports
`Match3Input`, `ArcadeStage` and `CardTable` statically and mounts one by `mechanic`. So the code
is there for every game. Changing the bundle strategy is not an option: it would change how every
game loads, and a standalone deploy needs a single file.

### 2.2 The shape: one source, one build per family, family code behind seam modules

**Recommended (§4 #1): the same `apps/lines` source built once per family.** Each build replaces
the other families' code with stubs at build time, so the bundler never sees it. There is still
one runtime app and one interpreter, and no copy of the code drifts
([game-families.md](game-families.md) §6.4 option A keeps its reasons). Only the build changes.

- **Seam modules.** Every place the shared code reaches a family imports it through one module per
  family, `apps/lines/src/families/{match3,arcade,card}.ts`, which re-exports what the shared code
  uses: the components (`Match3Input`, `ArcadeStage`, `CardTable`), the mechanic entries, `online.ts`
  and with it `engine-rooms`, the family book-event handlers, the vocab hooks. A sibling
  `families/off/{match3,arcade,card}.ts` exports the same names as inert stubs. A stub component
  renders nothing, and a stub mechanic is `unplayable`.
- **The alias.** `config-vite` (`baseConfig()`, which game repos call too) reads the build's
  family set and aliases each family left out to its `off/` stub. This is how the
  `PUBLIC_RGS_TRANSPORT` alias already works in `apps/lines/vite.config.js`. An alias removes the
  module from the graph, so the result does not depend on how well Svelte or Rollup tree-shake
  component modules with top-level side effects. A `define` plus dead-code elimination does depend
  on that, which is why it is the fallback, not the plan.
- **The set** comes from `PUBLIC_IE_FAMILIES` (`slot`, `match3`, `arcade`, `card`, or `all`).
  Slot is always included: every runtime still carries the reel stack. Taking slot code out of the
  other families' runtimes is not in this phase (§4 #3).
- **A runtime knows what it carries.** `__IE_FAMILIES__` is defined into the bundle. Boot compares
  it with `resolveFamily(config)`. A config whose family the bundle lacks shows the boot-failure
  screen ("this runtime does not play <family> games"). It never renders as a slot or a blank
  board, the failure §9 #26 guarded against.

### 2.3 Runtime ids

| Id | Families | Plays | Note |
|---|---|---|---|
| `lines` | slot | every slot kind (lines, Book-of, ways, cluster, scatter, Hold and Win, bonus modes) | Keeps its id: every published manifest and `SHARED_RUNTIME_ID` already name it (`publishGame.ts` `runtimeFor`) |
| `match3` | slot + match3 | match-3, rules or RGS | |
| `arcade` | slot + arcade | arcade offline and online, both netcodes | Carries `engine-rooms` and the predictor (§4 #2) |
| `card` | slot + card | card games | |
| `all` | every family | nothing published | The dev server and Storybook only. The launcher's `/editor` and `/flow-v2` previews do not use `apps/lines`, and an authoring Play opens the game's test-server entry, so it runs the game's own published id |

**Expected sizes** (gz). Today's runtime is about 1,391 KB gz: P10.15's measured 1,372.2 KB,
plus P10.16's 1.2 KB, plus C3's 17.7 KB. The estimates below add up the per-step measures in the
status file:
- match-3: P10.5 8.0 + P10.6 3.0 ≈ 11 KB;
- arcade: P10.8 6.6 + P10.11 9.1 + P10.12 3.0 + P10.13 4.8 + P10.15 3.9 + P10.16 1.2 ≈ 29 KB;
- P10.14's 59.1 KB, of which the SDK's `Client` is about 53;
- the predictor's 17.3 KB;
- the card table's 17.7 KB.

Each step measured against its own base, so the sum is only a guide. P11.1b measures the real
sizes, and the status file records them.

| Runtime | Expected | Against today |
|---|---|---|
| `lines` (slot) | about 1,255–1,265 KB | about −125 to −135 KB (about −9 to −10 %) |
| `match3` | slot + about 11 KB | about −115 to −125 KB |
| `arcade` | slot + about 105 KB (arcade 29, P10.14 59, predictor 17.3) | about −20 to −30 KB |
| `card` | slot + about 18 KB | about −110 to −115 KB |

### 2.4 How each consumer picks its runtime

- **Publish (online).** `runtimeFor()` in `apps/launcher-api/src/lib/server/publishGame.ts` is
  already the seam. It becomes `runtimeFor(config)` and returns the id for
  `resolveFamily(assembled.config)` (`slot` → `lines`). It refuses a publish where the project's
  kind (`familyOfKind`) and the config's family disagree. The snapshot's `runtime` field and
  `runtimePointer()` take the id unchanged.
- **The test server** (`services/test-server/server.mjs`) serves as it does today. It already
  resolves `_runtime/<id>/current.json` per manifest entry's `runtime` and serves `<id>@<version>`.
  Each id has its own pointer and its own last-good fallback. Its only change is P11.1c's
  listing.
- **Runtime release** (`.github/workflows/runtime-release.yml`):
  - The gates run once.
  - A matrix of the four published ids then builds, uploads and promotes each id.
  - Today the workflow builds `--filter ${RUNTIME}`, which means "built from `apps/<id>`". The
    matrix always builds `--filter lines`, with `PUBLIC_IE_FAMILIES` set per id.
  - Today's concurrency group is workflow-level, and every push lands in
    `runtime-release-lines`. The matrix needs a job-level group keyed on the matrix id.
  - The push trigger and its path filter are unchanged: an engine merge releases all four.
  - A failure in one id does not promote the others. Its "Runtime release failed" issue names the
    id.
  - `apps/launcher-api/scripts/verify-runtime-live.mjs` runs per id.
- **Runtime rollback** (`runtime-rollback.yml`): its `runtime` input becomes a choice of the four
  ids. A rollback is per id, because the pointers are separate. The guide
  ([release-and-rollback](../guides/release-and-rollback.md)) says which id a broken game is on: its
  family.
- **Standalone game repos** (desktop ☁ Publish / 📦 Deliver, `scripts/new-game.mjs`). A game repo
  builds `engine/apps/lines/src` with its own scaffold-day `vite.config.js`, which calls
  `config-vite`'s `baseConfig()`. The alias therefore reaches every existing repo with no edit to
  the repo.
  - `config-vite` takes the family set from `PUBLIC_IE_FAMILIES` when it is set.
  - Otherwise it uses `resolveFamily` on the `config` key of the baked bundle
    (`apps/lines/src/baked-editor-bundle.json`). `bake:doc` writes that file before `vite build`
    in the scaffold's build script, and `build-delivery.mjs` already reads it.
  - A config with no `family` resolves to `slot`. Only a bundle with no `config` key at all (the
    checked-in placeholder) falls back to `all`, with a warning. So an old repo never loses a
    family it needs.
  - `build-delivery.mjs` sets `slot`: delivery is slot-only (§9 #26).
  - The desktop launcher's builds rely on the baked-config default, so nothing changes there.
  - `new-game.mjs` writes nothing new.
  - `check:game-app-deps` gains one rule: `engine-rooms` (and any later family-only workspace
    package) is imported only from its family's seam module, so the stub really removes it.
- **The current-games harness** (`scripts/current-games/lib/runtimes.mjs`):
  - `buildWorkingTree` / `runtimeForRef` build one runtime per id the planned games need, keyed in
    the cache by id. Each game is rendered against the runtime its publish would pick, on both
    sides.
  - On the main side before P11.1c, every game uses `lines`. A slot game's screens then compare
    `lines`(all) against `lines`(slot), which is exactly the proof that removing the code changed
    nothing.
  - The harness is pipeline code, so this change is a review item for the owner (Director rule 2).

### 2.5 Three sub-steps, so no game is ever on a runtime that cannot play it

- **P11.1a — the seams, with no change to what ships.** This adds the seam modules, the `off/`
  stubs, the `config-vite` alias, `__IE_FAMILIES__` and the boot check. The published build stays
  `all`, so every bundle carries the same code as today. Gates: every `check:*`, current-games 0
  changed screens, and an `all` bundle within ±0.5 % of main (it should differ only by the seam
  indirection). P11.1a reads the set from `PUBLIC_IE_FAMILIES` only; reading it from the baked
  config waits for P11.1b, because it would already shrink standalone repos' builds.
- **P11.1b — the four builds and the consumers.** This adds the release matrix, the rollback
  choice, `runtimeFor(config)`, the harness per-id builds, `check:game-app-deps`'s rule and the
  new `check:family-runtimes` (§3.1). The ids `match3`, `arcade` and `card` start releasing. A
  republish now points a non-slot game at its own id. `lines` is still built `all`, so a game not
  yet republished still plays.
- **P11.1c — strip `lines`.** First, every non-slot game is republished: every non-slot entry
  the per-runtime listing shows. This is the owner's or
  coordinator's step, because it needs launcher access. Then `lines` is built `slot` only, and
  every slot game gets the smaller file on the next release. The boot check turns a missed
  non-slot entry into an honest failure screen, never a broken board. The gate is a list of the
  test server's manifest entries by runtime id, showing that no non-slot game is on `lines`.
  Today the public `GET /healthz` returns the game keys and each id's pointer, but not which id
  each game is on. P11.1c adds a games-to-runtime map to it, so no one needs R2 access to check.

---

## 3. The build plan

**In short:** P11.1 (a → b → c) goes first and alone, because every later step touches files it
moves. After P11.1a, Salmons' server-side rules (P11.3) and the isometric drawing (P11.4) can run
beside the rest of P11.1. Online completion (P11.2) waits for P11.1b. S0 is art and runs whenever
a person is at the tools.

| # | Step | Delivers | Main code | Size | After / parallel |
|---|---|---|---|---|---|
| P11.1a | **Family seams** | `families/*` seam modules + `off/` stubs; the `config-vite` alias from `PUBLIC_IE_FAMILIES`; `__IE_FAMILIES__` and the boot check. Every published build stays `all` | `apps/lines` (`Game.svelte`, `online.ts`, the family imports), `packages/config-vite` | M | first; alone |
| P11.1b | **Four runtimes** | The baked-config family default (§2.4); the seams P11.1a found still reached by shared code (`engine-layout`'s `SpawnLayer` / `Tilemap` in `LayoutNodeView`, the `engine-flow-v2` family vocabularies, `game-config`'s card normalizer importing `cards.js`); the release matrix and per-id promote/alert; the rollback choice; `runtimeFor(config)` + the kind/family refusal; the harness per-id builds; the `check:game-app-deps` rule; `check:family-runtimes`; the measured sizes in the status file; the release guide | `.github/workflows/runtime-*.yml`, `apps/launcher-api` (`publishGame.ts`), `scripts/current-games/lib/runtimes.mjs`, `scripts/check-game-app-deps.mjs`, `docs/guides/release-and-rollback.md` | M–L | after P11.1a; P11.3 / P11.4 may run beside it |
| P11.1c | **Strip `lines`** | Non-slot games republished (owner/coordinator), the test server's per-runtime listing, then `lines` built `slot` | `services/test-server` (`/healthz`), the release workflow | S | after P11.1b + the republish |
| P11.2 | **Online arcade completion** | (a) Online Flow events (`onPlayerJoined`, `onPlayerLeft`, `onHit`, `onCaught`, `onRoundEnd`) from the room's `event` messages, and server-owned `var:` sources (read-only, the validator's `variable-server-owned`), which give Salmons a HUD and a round-over screen. (b) Predicted ability events (the swipe drawn on the press) and hiding an `out` player. (c) Publish writes `rooms_url` into an online game's launch URL and refuses an online game with no server address ([realtime-multiplayer.md](realtime-multiplayer.md) §10). (d) `/config` sections for `arcade.online`, its `rules` and its `bots`. (e) A new river per room: the room's seed reaches the device, which generates the same river ([realtime-multiplayer.md](realtime-multiplayer.md) §14 #4) | `apps/lines` (`online.ts`, the arcade seam), `engine-flow-v2` (vocab, validator), `services/game-server`, `packages/game-config`, `apps/launcher-api` (`publishGame.ts`, `/config`), `docs/tools/game-config.md` | L (split a–b, c–e if the review asks) | after P11.1b (same files) |
| P11.3 | **Salmons' rules** | `ONLINE_RULES_MODULES` entries: the waterfall climb by tapping, sandbanks that ground a salmon until it jumps, rocks and one-way waterfalls as solids (per-character solids online, so bears and fishermen stay out of the water), the fisherman's line (hook, reel, land), the golden salmon; `check:online-rules` on recorded Salmons traces; `salmons.js` / `referenceLayouts/salmons.ts` updated; [playtest/salmons.md](../playtest/salmons.md) extended | `packages/engine-mechanics` (`onlineRules.js`, `salmons.js`, `motion.js` solids), `services/game-server` | L | after P11.1a; parallel with P11.1b and P11.4; touches `onlineRules.js` with P11.5, so it goes first |
| S0 | **Salmons art** (owner/art) | The 22 character clips, then the arcade sample's four sprites ([status/salmons](../status/salmons.md) open items 1–4) | no code | L | any time; needs a person at the launcher's tools |
| P11.4 | **Isometric projection and diamond tiles** | The stage draws the flat ground plane 2:1 isometric, sprites in ground-depth order; `tilemap` 2:1 diamond tiles with neighbour autotiling; `/editor` paint mode on a diamond grid; the projection a per-screen setting; Salmons switched to it | `apps/lines` (`ArcadeStage`, behind the arcade seam), `engine-layout` (tilemap, `SpawnLayer`), `/editor` | L | after P11.1a; parallel with P11.1b / P11.3; before P11.2 (e) only if the river is drawn as tiles |
| P11.5 | **Offline abilities and zone forces** | The P10.15 abilities (hit zones, cooldowns, `onHit`) and zone forces for the offline loop, moved out of `onlineRules.js` into one shared module both loops call, so there is one implementation; `ARCADE_VOCAB` gains them; Invisible Characters edits them | `packages/engine-mechanics`, `apps/lines` (`arcade.ts`), `engine-flow-v2`, `/characters` | M–L | after P11.3 (same module) |
| C5 | *(optional, owner decides)* **Card phase switches and more lists** | As [card-games.md](card-games.md) §12 | `engine-mechanics`, launcher | M | after C4; independent of P11.x |

Every step is a pipeline change: its own branch, merged when every pipeline gate passes and the
current-games run shows every game unchanged, with the owner's approval (Director rules 2–3).

### 3.1 Gates

| Step | Check | What it proves |
|---|---|---|
| all | every `check:*` (`check:all`), `check:svelte` not rising, current-games 0 changed screens | No current game changes |
| P11.1a | current-games 0 changed; `all` bundle within ±0.5 % of main; a boot fixture: a config of a family the bundle lacks reaches the failure screen | The seams move code without changing it; a mispointed game fails honestly |
| P11.1b | **`check:family-runtimes`** (new, root): builds each id, asserts that each bundle's `__IE_FAMILIES__` matches its id, that a left-out family's marker exports and `@colyseus` are absent from the file, and that each size is within the budget the owner sets (§4 #4); current-games renders each game on its own id; a dry-run release of the matrix | Each runtime carries only its families; the cost is really gone; the release ships four |
| P11.1b | `check:game-app-deps` (extended) | No family-only package is reachable outside its seam, and a game repo still installs |
| P11.1c | the test server's per-runtime listing shows no non-slot game on `lines`; current-games 0 changed on slot games against `lines`(slot) | Stripping `lines` breaks no published game |
| P11.2 | `check:netcode`, `check:room-sim`, `check:online-rules` extended (events and server-owned scores reach Flow; an `out` player is hidden; a predicted swipe is drawn on the press); validator fixtures for `variable-server-owned`; a publish fixture (`rooms_url` written, an addressless online game refused); `check:game-config-family` for the new sections; `salmons-play.mjs` with a HUD and a round-over; two rooms with different rivers | Salmons gets its screens; the address is never hand-typed |
| P11.3 | `check:online-rules` on recorded Salmons traces (climb, sandbank, line, golden salmon); `check:room-bots`; `salmons-play.mjs`; the load test (`scripts/room-load.mjs`) within P10.16's budget | The rules play, replay exactly and still fit 100 players |
| P11.4 | `check:arcade-platformer` + a projection fixture (ground ↔ screen round-trip, depth order, diamond hit-test); current-games 0 changed (a flat arcade game draws the same); `salmons-play.mjs` in isometric | Isometric draws the same simulation; flat games unchanged |
| P11.5 | `check:arcade-characters` + `check:online-rules` (one ability module, both loops give the same result on the same trace) | Offline and online abilities agree |

---

## 4. Decisions (owner)

**#1–#9 DECIDED (owner, 2026-10-28): every recommendation is accepted as written.**

1. **How to split: one source built per family (seams + aliases), a second runtime app, or a
   different bundle strategy?**
   - *Approved:* **one source built per family** (§2.2). It is the only one of the three that
     removes the cost without a second copy of the engine
     ([game-families.md](game-families.md) §6.4 option B's drift) or a change to how every game
     loads (a split bundle).
2. **The Colyseus netcode's predictor: ship it in `arcade`, or build a fifth runtime for games that
   pick `netcode: colyseus`?**
   - *Approved:* **in `arcade`.** The 17.3 KB gz cost then falls only on arcade games, which are
     free play, and a fifth runtime would mean a fifth pointer to release and roll back for one
     setting.
3. **Should a non-slot runtime also drop the slot code (reels, paylines, Hold and Win)?**
   - *Approved:* **not in this phase.** The slot code is the shared base: boot, HUD, Flow and the
     board that match-3 reuses. Separating it is a refactor of the engine's centre for a saving
     that only free-play games would get.
4. **The size budget `check:family-runtimes` enforces.**
   - *Approved:* **the sizes P11.1b measures, plus 2 %**, recorded in the gate. A step that goes
     over the budget either explains why in its PR, or the owner raises the budget.
5. **The id of the slot runtime: keep `lines`, or rename it `slot`?**
   - *Approved:* **keep `lines`.** Every published manifest and pinned canary already names it,
     and renaming it would need a migration of every live game for a label.
6. **The family default for a standalone game repo with no baked config.**
   - *Approved:* **`all`, with a build warning.** A wrong guess would cost a game its family. A
     game that is too big costs bytes only, and the desktop launcher's builds do bake the config.
7. **P11.2's size: one PR, or split?**
   - *Approved:* **two PRs.** (a–b) covers the device and Flow. (c–e) covers publish, `/config` and
     the river per room. They touch different owners' files (the arcade runtime, the launcher), so
     each review stays small.
8. **Order of P11.3 against P11.4.** Both are what Salmons needs.
   - *Approved:* **run them in parallel after P11.1a.** They share no files. P11.3 is server-side
     rules; P11.4 is drawing.
9. **Cards C5.**
   - *Approved:* **not scheduled.** List it, and start it only on a playtest that asks for
     interleaved play or more verbs ([card-games.md](card-games.md) §13 #2–#3).
