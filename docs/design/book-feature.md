# Book-of as a feature: the expanding symbol on any lines game, and no more `bookOf` kind

> Status: the plan. Each phase reports its living state into
> **[docs/status/game-config.md](../status/game-config.md)** (schema, `/config`, the contract) and
> **[docs/status/engine.md](../status/engine.md)** (mock, facade, runtime, harness). This file is
> the plan, not the progress. Precedent: [pots-overlay.md](pots-overlay.md) §2 ("a kind plus optional
> add-ons") and [game-type-templates.md](game-type-templates.md) ("a game type is data plus a
> mechanic"). Related: [invisible-game-config.md](invisible-game-config.md),
> [free-spin-intro-symbol-reveal.md](free-spin-intro-symbol-reveal.md),
> [play4fun-protocol](../reference/play4fun-protocol.md),
> [current-games playbook](../playtest/current-games.md).

## Why this exists

Owner decision, 2026-10-07: retire `bookOf` as a game KIND. The Book-of mechanic becomes a
feature that any lines-family game switches on in Invisible Game Config, and every current Book-of
project moves onto it and still builds, plays and looks the same. There is no live game to protect,
so breaking changes are allowed, but every current game must keep working.

The trigger was the **Free spins** section in `/config` (#1099: on/off, trigger symbol and count,
award tables, random range). It is hidden for `bookOf`, because a Book-of project runs on a
different mock (`scripts/mock-rgs-server-book.mjs`), a different protocol (`protocolFor('bookOf')`
→ `'book'`) and a different symbol mapping (`bookMapping`). None of the lines-mock settings reach
it: authored bet modes, grid, paylines, free-spin rules and wild settings are all ignored. The owner wants every lines
setting to apply to a book game, and the book mechanic to be addable to any lines game.

**The investigation found that most of the work is already done.** The shared runtime never reads
the kind:

- the expanding-symbol events are handled for every project;
- `lines` projects already run the Book-of flow vocabulary and starter flow;
- the `lines` reference layout already carries the `specialBook` scene;
- the client picks its symbol mapping from the server's own boot `config`.

The kind still matters in two places:

1. **On our side of the wire**: which mock deals the game, and which mapping translates the
   contract.
2. **In four tool gates** that read `kindCapabilities().bookReveal`.

So this plan:

- moves the mechanic's switch into the config;
- teaches the lines mock the mechanic;
- migrates the projects;
- deletes the kind.

## 1. What the Book-of mechanic is, part by part

| Part | What it is | Where it lives today | Mechanic or data? |
|---|---|---|---|
| **a. The book symbol** | One symbol that is both scatter (3+ anywhere trigger free spins) and wild (substitutes on lines). | Mock only. `mock-rgs-server-book.mjs` `evaluatePaylines` counts `SCAT` as wild after the first reel. `buildConfigContext` declares `wildSymbols: ['SCAT']`. `bookMapping` sets `scatter: 'S', wild: 'S'`. The client never decides a win. It reads `special_properties` for anticipation (`apps/lines/src/game/anticipation.ts` `isWild`), the rules role (`infoManifest.ts`) and land sounds (`game-config` `landSlotForSymbol`, scatter first). | **Data.** `special_properties: ['scatter', 'wild']` on one symbol already says it. The lines mock cannot deal it yet: its wild is a separate `WILD` symbol. |
| **b. The expanding special** | When free spins start, the server draws one paying symbol (`pickRandomly`). On each free spin, if that symbol covers at least N reels, it expands to fill those reels. It pays like a scatter: its line-row value for the reel count × the base stake. Then the other symbols pay their lines on the expanded board, with the special left out. | **Server:** `mock-rgs-server-book.mjs`: `startFreeSpins` → `pickSpecialSymbol` (`SPECIAL_WEIGHTS`), `pickRandomly` after `enterBonus`, `specialExpandsAt` (PIC1 from 2 reels, the rest from 3), `evaluateExpandingSpecial`, `expandSpecialBoard`. **Facade:** `engineFacade.ts` `adaptEventsForEngine`. `case 'pickRandomly'` → `setExpandingSymbol`. The `playedSpin` case emits `expandBookColumns` with its own copy of the gate: `minReels = specialRaw === 'PIC1' ? 2 : 3`. **Engine:** `typesBookEvent.ts`, `bookEventHandlerMap.ts`, `flowEffects.ts` (`setSpecialSymbol`, `expandBookColumns`), `stateGame.specialSymbol` / `expandedSymbol` (`engine-game` `gameState.svelte.ts`). | **The mechanic.** The draw weights and the expand threshold are data. The pick, the expansion and the payout rule are code. Today that code exists only in the book mock. |
| **c. Presentation** | The reveal shuffle (`SpecialBook.svelte`), its authored replacements (`ExpandingSymbol.svelte`, `FreeSpinIntroSymbolReveal.svelte`, `RevealSymbolRider.svelte`). The `bookIntro` / `bookIdle` symbol states. Book symbol VFX (`BookVfx.svelte`, the symbols doc's `bookVfx`). The column morph. The `cells` win-line shape. The `toast.expanded` win text. The flow choreography (`engine-flow-v2` `bookOfChoreo.ts`, wired by `BOOK_OF_DRIVEN_SEED_DOC`). | `apps/lines` and `packages/engine-flow-v2`. All of it is event-driven and **none of it reads the kind**. `Game.svelte` mounts `specialBook` from the layout, or else from the bundled fallback scenes. `BookVfx` keys on free spins plus `specialSymbol`. | **Mechanic, but already shared.** Every lines project already carries it. The tool gates are what hide it (§5). |
| **d. Everything else in the sample game** | 5×3, 10 paylines, the captured paytable, `betOptions [10, 1000]` (one 100× buy), 10 free spins, +10 per retrigger, the scatter paying nothing (`cf1db93`), `lineCoinciding: false`, resume through `config.actions` + `resume: true`, `maxWinMp [10000]`. | Constants in `mock-rgs-server-book.mjs`. Partly mirrored in `packages/game-spec/examples/book-of-thermopylae.spec.ts`. | **Data.** A lines config already expresses all of it except three things the lines mock lacks: resume at boot, a scatter that pays nothing, and the book dialect's unnamed bet table (§4). |

So a Book-of game is **any lines game with (b) switched on, whose scatter is usually also wild
(a), with Book of Thermopylae's numbers (d)**. (c) is already in every lines project.

## 2. The server question: whose vocabulary is `PIC1 … TEN, SCAT`?

**Finding: the vocabulary belongs to the server game. The client already reads it from the
server, on every path, without the kind.**

**`bookofborutpartner` is a project published on the shared runtime that plays a partner's real
Book-of RGS, not our mock.** The evidence:

- It has a published snapshot (the current-games harness renders it). It has **no test-server
  manifest entry**: the public index at `games.invisiblewall.org/`, read on 2026-10-07, lists 18
  games and not this one, and `/bookofborutpartner/` answers 404.
- The only partner path in the repo is `?rgs_profile=2complex-bookof`, with sessions minted by
  `GET /api/partner-session` (`partnerRgs.ts`).
- The profile `packages/delivery-profile/profiles/2complex.json` describes the 2-complex node's
  "game 2 (Book-of math, alias BookOfBetOptions)": 5×3, 10 lines, `SCAT` scatter+wild,
  `betOptions [10,1000]`. That is the Book of Thermopylae wire shape.
- `docs/status/engine-history.md` (2026-09-17) records "Book of Borut on the runtime with
  `rgs_profile=2complex`" buying the feature on that node.
- The 2026-09-24 entry says only game 1 (Stargate) was probed then. Phase 0 confirms the card URL.

How the mapping is chosen today:

| Path | How the mapping is chosen | Uses the kind? |
|---|---|---|
| **(i) Shared online runtime** (all Game Maker games, and the partner game) | `engineFacade.ts` starts from `resolveActiveMapping()`. That is `PUBLIC_RGS_GAME`, which `runtime-release.yml` does not set, so it starts on `linesMapping`. `captureConfig` then calls `pickMappingForConfig(cfg)` (`gameMappings.ts`) on the boot `config`. Any of `ACE … TEN` ⇒ `bookMapping`; `PIC5–7` ⇒ `linesMapping`; a captured Hold and Win block ⇒ identity. The server's own declaration decides. | **No** |
| **(ii) Test-server mock contract** | `resolveMockContract` → `protocolFor(projectGameType)` (`mockProtocol.ts`). `'book'` chooses `createBookMock` (`services/test-server/server.mjs` `makeBookMock`). Then `projectGrid`'s `book` branch translates client names to server names with `bookMapping` (`projectSymbolPaytable`, `projectLineSymbols`, `inServerNames` for the overlay). Every other protocol uses `linesMapping`. | **Yes**: it decides which mock deals the game, and so which vocabulary the contract is written in. |
| **(iii) Desktop / standalone builds** | `launcherProfile.ts` `derivePublishBlock` stamps `protocol: protocolFor(gameType)` (the mock the test server deals the build). `PUBLIC_RGS_GAME=book` comes from `game-spec` `backendFor` (dev runs in the desktop launcher's config) and `seed-project-profile.mjs --env`. At runtime it is only the starting mapping, and the boot `config` corrects it as in (i). Delivery builds (`build-delivery.mjs`) do not set it. | Protocol: **yes**. Mapping: **no**, in effect. |
| Current-games harness | `scripts/current-games/lib/plan.mjs` `contractFor`. A game with no manifest entry (the partner game) gets `{ protocol: protocolFor(gameType) }` → the book mock. That is why the partner game renders as a Book-of game in CI. | **Yes** |

**Afterwards: no new field.**

- The live client keeps reading the server's declaration.
- A partner is chosen by its delivery profile (`?rgs_profile=`, or baked into a delivery). That
  record already names the server game: `2complex-bookof`.
- On our side the book dialect goes away. Book games are dealt by the lines mock (§4), so the
  contract has one vocabulary (`linesMapping`).
- The harness derives a manifest-less game's contract from its **published snapshot's config**
  (`mockContractOfBundle`), not from its kind.
- `PUBLIC_RGS_GAME` stays a valid pre-boot hint. `MAPPINGS.book` stays, because it describes a
  server vocabulary, not a client kind. Nothing derives the hint from a kind any more.

**Nothing changes for the partner game.** Its client never read the kind. Its expand gate keeps
today's rule unless its own config says otherwise (§3.4). Its tools gain the book parts from the
config block instead of the kind.

Decision 7: no field.

Two small fixes ride along:

- `pickMappingForConfig` gains `PIC8–PIC10` as lines markers. A lines-mock pool without `PIC5–7`
  (for example a book pool missing `L1`, `L2` and `L5`) would otherwise read as undecidable.
- `projectFreeSpinsTrigger` takes the protocol's mapping instead of hard-coding `linesMapping`.

## 3. The contract

### 3.1 Config shape: `freeSpins.expandingSymbol`

Sparse and departure-only, like every `GameConfigDoc` block. **Absent ⇒ a project with no expanding
special, byte-identical to today.**

```ts
// packages/game-config/src/types.ts
type FreeSpinsConfig = {
	// …enabled, triggerSymbol, triggerCount, randomAwards, awards, retriggerAwards (#1099)
	/** The Book-of expanding special. Present (even `{}`) ⇒ on. Kept while `enabled` is false,
	 *  like the trigger fields, so switching free spins back on loses nothing. */
	expandingSymbol?: ExpandingSymbolConfig;
};

type ExpandingSymbolConfig = {
	/** Draw weight per symbol id. Absent ⇒ every eligible in-play symbol, equally. */
	weights?: Record<string, number>;
	/** Fewest reels the special must cover to expand and pay, per symbol. Absent ⇒ 3. */
	minReels?: Record<string, number>;
};
```

**Nested in `freeSpins`, not its own block.**

- The special exists only in the host's own free spins (the built-in `freeSpins` mode).
  `freeSpins.enabled: false` makes it inert by construction.
- `/config` shows it inside the Free spins section, which is where an owner looks.
- The mock contract already carries the free-spin rule through `projectFreeSpins`.
- It is not an add-on in the pots-overlay sense. It brings no screens of its own (`specialBook` is
  already in the `lines` set). It needs no flow fragment either: the book events are already in
  the base vocabulary (§5, Flow).
- Imported reels modes keep no special (pots-overlay Phase 7 behaviour), and that is unchanged.

**The book symbol is not a new field.** It is a symbol whose `special_properties` holds both
`'scatter'` and `'wild'`:

- its `paytable` is its scatter pay, because scatter takes precedence, as `isScatterSymbol` already
  says;
- the lines mock substitutes it on lines (§4);
- the mechanic does not require it: a lines game can have an expanding special and a plain scatter.

Reading it:

- `resolveExpandingSymbol(doc)` returns `{ candidates: { symbol, weight, minReels }[] }` or
  `undefined`.
- Candidates are the eligible symbols, in dictionary order.
- Eligible means: dealt (`symbolsInPlay`), has a line `paytable`, and is none of scatter, wild, a
  Hold and Win role, or a pots-overlay token.
- Every reader goes through this resolver: the contract, `/config`, the engine bridge (§3.4) and
  the fixtures.
- `normalizeFreeSpins` keeps `expandingSymbol` whenever it is present. It drops weights that are
  not positive numbers on string keys, and `minReels` entries that are not whole numbers of 1 or
  more.

### 3.2 Validator (`validate.ts`, paths `freeSpins.expandingSymbol.…`)

- The win model is not `lines` ⇒ **error**. An expanded reel "pays on every line". A ways, cluster
  or scatter game would need a payout rule of its own.
- A base-game `holdAndWin` block (`!holdAndWinIsOverlayBonus(doc)`) ⇒ **error**. That kind has no
  free spins.
- A weight on a symbol outside the dictionary, off the strips, or not eligible ⇒ **error**.
- No eligible symbol left, or every weight is zero ⇒ **error**.
- `minReels` above `numReels` ⇒ **error**.
- `minReels` on a symbol with no weight ⇒ **warning** (it can never be drawn).
- A candidate whose line row has no pay at its `minReels` ⇒ **warning**. It would expand on
  screen and pay nothing; the book mock's comment on `evaluateExpandingSpecial` describes this
  case.
- `enabled: false` with the block present ⇒ **warning** (inert).
- A second symbol that is both scatter and wild ⇒ **error**. One book.

### 3.3 Capabilities: `kindCapabilities` reads the config, not the kind

```ts
// packages/engine-layout/src/lib/kindCapabilities.ts
interface KindCapabilityConfig {
	cascade?; winModel?; holdAndWin?; potsOverlay?;
	/** `resolveExpandingSymbol(doc) !== undefined`. */
	expandingSymbol?: boolean;
}
bookReveal: !!config.expandingSymbol, // Phases 2–6: kind === 'bookOf' || !!config.expandingSymbol
```

- `ProjectAddOns` / `projectAddOns` (`apps/launcher-api/src/lib/addOns.ts`) gain `expandingSymbol`.
  Every caller that passes add-ons (`/config`, `/symbols`, `/win-text`, `/editor`, `/components`,
  `gameProfile.ts`, `localizationSections.ts`, `symbolsPageConfig.ts`) then gets it with no other
  edit.
- `flowAddOnsOf` does not change. The flow vocabulary does not change with the feature.
- The OR with the kind is the transition shim. Phase 7 deletes it.
- `bookSymbolVfx` stays as it is: on for every kind with free spins.

### 3.4 The expand threshold, client and server alike

The reels that morph must be exactly the reels that pay. Today the threshold is written twice:
`specialExpandsAt` in the book mock and `minReels = specialRaw === 'PIC1' ? 2 : 3` in the facade.
After the move both read the authored `minReels`:

- **The mock** gets it in the contract (§4).
- **The facade** gets it through an engine→facade bridge, beside `__IE_WIN_LEVELS__`.
  `engine-game` `gameConfig.ts` publishes `__IE_EXPAND_MIN_REELS__` (client symbol → reels) from
  the resolved block. The facade maps `specialRaw` to its client name before the lookup.
  **No bridge ⇒ today's rule**, so the partner game and every un-republished snapshot play
  exactly as now.

### 3.5 The Book of Thermopylae preset

The captured numbers become data, in the same pattern as `holdAndWinPresets.ts`:

- source `packages/game-config/src/bookOfPresets.ts` (`bookOfThermopylaePreset()`, built on call),
  Phase 2;
- generated `apps/launcher-api/src/lib/data/gameConfig/lines.bookOfThermopylae.json` through the
  generator's preset path, and offered by `gameConfigPresetsFor('lines')` (Phase 5a) and
  `gameConfigSeedFor('lines', 'bookOfThermopylae')` (Phase 5c) — generated when something offers it,
  so no committed default sits unread.

This is "make a copy of Book of Thermopylae" as one click. The preset holds:

- **Board:** 5×3 and the ten captured paylines.
- **Symbols:** `H1–H4` / `L1–L5` with the captured rows (`H1` `2:10 3:100 4:1000 5:5000` …).
- **The book:** `S` with `['scatter', 'wild']`, its scatter row `3:2 4:20 5:200`, paid (decision 1).
- **Strips:** padding strips of those ten symbols.
- **Bet modes:** `base` at 1 and one buy at 100 (`max_win` 10000).
- **Free spins:** `{ retriggerAwards: [{ count: 3, spins: 10 }], expandingSymbol: { weights:
  <SPECIAL_WEIGHTS in client names>, minReels: { H1: 2 } } }`.

A new gate, `check:book-preset`, holds the preset and the book mock's constants (exported as one
record, `BOOK_OF_THERMOPYLAE`) equal through `bookMapping`. The fixture mock (§4) and the preset then cannot drift.

## 4. The mock: the lines mock deals the mechanic; the book mock becomes a fixture

**The lines mock (`scripts/mock-rgs-server.mjs`) gains the book mechanic.** That gives a book game
every lines setting: authored grid and paylines, bet modes, free spins on/off, trigger and awards,
wild, stacked pictures, scatter pays.

It also makes the mechanic addable to any lines game. The new options on `createMockRgs`:

- **`expandingSymbol: { candidates: [{ symbol, weight, minReels }] }`** (server names).
  - When free spins start (scatter trigger, `FORCE_TRIGGER`, a buy, or a pot's `startFreeSpins`
    hook), draw the special from the in-play candidates.
  - Emit `pickRandomly` right after `enterBonus`, in the book mock's shape: `{ items, state, scope:
    'enterState', item: { state, prob } }`. That is the shape the facade reads (`context.item.state`).
  - On each free spin, port `evaluateExpandingSpecial` / `expandSpecialBoard`:
    - pay `row[reelsCovered] × baseTotal`, with `mode: 'scatter'` and every cell of the covered
      reels as positions;
    - then the line pass on the expanded board, with the special left out;
    - `bonusWin` wrappers as today;
    - `spinStart.symbolsPay.scatter` gains the special.
  - The special never retriggers.
- **`scatterWild: true`.** `SCAT` substitutes in the payline evaluator (leading books substitute too,
  decision 2) and is declared in `wildSymbols`. The contract sends it when the in-play scatter
  is also wild. **`projectWild` must skip a scatter.** Today it would pick `S` (wild, with a
  paytable) and make the mock deal a separate `WILD` (mapped to `W`, with no art in a book project).
- **Resume at boot.** For a session with an open round, the boot `config` carries the round's
  stored `actions` plus `resume: true`, as the book mock and the partner do. The lines mock already
  stores and replays actions per position. It just never told a reloading client. Without this, a
  migrated Borut would lose resume-on-reload. Today every lines game abandons an open round on
  reload, so this is a fix for all of them (`check:resume` grows a lines-mock section).
- **No "scatter pays nothing" rule is needed**: decision 1 pays the book's scatter row, so the
  lines mock's existing authored scatter pays (`scatterPaytable`) cover it.
- **Parity:** a configuration without these options draws no extra RNG value. The seeded responses
  of every existing configuration stay byte-identical. The `check:freespins` sections and a new
  `check:expanding-symbol` digest hold this.

**What changes for a book game moving from the book mock to the lines mock.** It is a different
dealer, so seeded boards differ; the round shape does not.

- The restricted-pool deal is uniform otherwise. The book itself is dealt at the book mock's 5% a
  cell (the lines mock's other scatters keep 4%), and a forced or bought board carries four books,
  as the book mock forces: both keyed on `scatterWild`, so the trigger (about 3.6% of base spins),
  the retrigger and the feature length match the book mock (coordinator decision, 2026-10-07). With
  decision 1, those four books pay the scatter row's 4-of (20× the bet) on every forced or bought
  round.
- `paylineId` is 0-based. The facade resolves lines by shape, so the client sees no difference.
- `betOptionsName` is now declared. The table is still `[10, 1000]` for 10 lines and one 100× buy,
  but the client matches the option by name.
- `maxWinMp` is not declared, so the remake's 5,000-vs-10,000 boot warning goes.
- Each open tab must reload once. Its session has no pinned bet table, so the lines mock refuses
  its next bet with "reload the game".

**The book mock.**

- It stops dealing games once the census shows no manifest entry with `protocol: 'book'`.
- It is kept as **the partner-dialect fixture**. It is the only replica of the partner's Book wire:
  unnamed `betOptions`, the nested `{line, scatter}` paytable, `AUTO_COLLECT=0`, 1-based lines.
  The facade gates exercise those shapes: `check:resume`, `check:connection`, `check:buy-cost`,
  `check:platform-jackpot`, `check:book-paytable`, `verify-server-paytable*`.
- It leaves `services/test-server/server.mjs`, its `Dockerfile` `COPY`, and `MOCK_PROTOCOLS` (both
  the test server's and `testServerManifest.ts`).
- The Phase 1 contract fields (below) come out of it again in Phase 7, unless a fixture exercises
  them.

**The pots overlay** composes over the book mock only today
(`withPotsOverlay(createBookMock, …)` in `makeBookMock`). The lines mock has no host seam. The
pots-overlay status records that gap: "Only a `book` host deals the overlay … the lines mock has no
seam". So `borut-pots-sample` cannot move until the lines mock gains the six hooks the book mock
calls:

- `refuse`, `beginPlay`, `playOwned`, `takeOver`, `endPlay`, `configContext` (plus `inBonus`);
- and `startFreeSpins`, which draws the special when the block is present.

That is Phase 4. It also closes the pots-overlay gap for every lines host. `check:pots-overlay`
then runs over both hosts, and the book host's digests must not move.

## 5. Inventory: every place the kind, the `book` protocol, `bookMapping` or `bookReveal` is used

"Stays" means unchanged by this plan.

**Kind registry and capabilities**

| File | Today | Becomes |
|---|---|---|
| `packages/constants-shared/gameKinds.ts` | `GAME_KINDS` lists `bookOf` | Drops it (Phase 7). `kindStorage.ts` `BUILTIN_KIND_IDS` follows, so the migration must run first. |
| `packages/engine-layout/src/lib/kindCapabilities.ts` | `bookReveal: kind === 'bookOf'` | `!!config.expandingSymbol` (§3.3) |
| `apps/launcher-api/src/lib/addOns.ts`, `game-config/src/flowAddOns.ts` | `{holdAndWin, potsOverlay}` | `projectAddOns` gains `expandingSymbol` |
| `launcher-api/src/lib/server/projects.ts`, `db/schema.ts` (`projects.game_type`), `admin/+page.server.ts` `setProjectGameType`, `gameKinds.ts` `selectableGameKinds` | Store and offer `bookOf` | The migration rewrites rows. Pickers stop offering it (Phase 5). |

**Game Config**

| File | Today | Becomes |
|---|---|---|
| `game-config/src/types.ts`, `freeSpins.ts`, `normalize.ts`, `validate.ts` | No expanding block | `expandingSymbol`, its resolver and validator rules (Phase 2) |
| `game-config/src/serverPaytable.ts` | Scatter helpers | Stays. Scatter precedence already covers a scatter-wild. |
| `launcher-api/src/lib/server/gameConfigDefaults.ts`, `scripts/generate-game-config-defaults.ts` | `bookOf` falls back to `lines.json`. The comment cites `--game-type bookOf`. | Gains the `lines.bookOfThermopylae` preset. The fallback comment loses `bookOf`. |
| `routes/(app)/config/+page.svelte` | `offersFreeSpins = freeSpins && !bookReveal` | Phase 1: `capabilities.freeSpins`. Phase 5: an "Expanding symbol" panel inside Free spins (on/off, weight and reels per candidate) and "Reset to preset → Book of Thermopylae". |

**Launcher tools**

| File | Today | Becomes |
|---|---|---|
| `routes/(app)/symbols/symbols.client.ts` `visibleStatesFor`, `+page.svelte` | `bookIntro`/`bookIdle` columns only when `caps.bookReveal` | The same flag, now driven by the config. The page passes `expandingSymbol`. |
| `routes/(app)/win-text/+page.svelte` | The `toast.expanded` line only with `bookReveal` | Same flag, driven by the config |
| `lib/server/gameProfile.ts` | `expandingBook` chip from `bookReveal`; `protocol` / `protocolDrift` chips from `protocolFor(kind)` | Chip from the config. `protocolDrift` correctly flags migrated games until they are republished. |
| `routes/(app)/editor/+page.svelte`, `+page.server.ts` | "Import composed reference" offers `lines` and `bookOf`; cross-type guard against `doc.gameType` | The Book-of layout stays importable as a **reference** (Borut's look, `gameType: 'lines'`), not a kind (Phase 7 splits `listImportableKinds` from the scene-set kinds) |
| `lib/emitterVocabularies.ts` (generated, `/flow` v1) | A `bookOf` entry, byte-equal to `lines` once the key is renamed (checked 2026-10-07) | The entry is dropped at regeneration. `tools/flow-spike/vocabulary.ts` stops asserting it. |
| Game Maker: `routes/(app)/game-maker/+page.server.ts`, `lib/server/projectScaffold.ts`, `duplicateProject.ts` | Create offers the "Book of" kind. The scaffold seeds the layout, flow and config per kind. Duplicate copies the kind. | Create offers **Lines + "Book of Thermopylae" preset**. The preset names the Book-of reference scene set to scaffold from (Phase 5). Duplicate needs no change; the migration is re-runnable for copies made in the window. |
| `lib/server/localizationSections.ts`, `symbolsPageConfig.ts`, `routes/(app)/components` | `kindCapabilities` callers, no `bookReveal` read | Pass add-ons; nothing else |

**Mock, test server and mock contract**

| File | Today | Becomes |
|---|---|---|
| `launcher-api/src/lib/server/mockProtocol.ts` `protocolFor` | `'bookOf'` → `'book'` | Line removed (Phase 7) |
| `lib/server/mockContract.ts` | `projectGrid` `book` branch (paytable, pool, overlay through `bookMapping`). `projectFreeSpinsTrigger` uses only `linesMapping`. `projectWild` would pick a scatter-wild. | Phase 1: the book branch also sends the free-spin fields. Phase 3: the lines branch sends `expandingSymbol` / `scatterWild` (last, only when present) and `projectWild` skips scatters. Phase 7: the book branch goes. |
| `lib/server/testServerManifest.ts` | `MOCK_PROTOCOLS` includes `book`; grid types | New grid fields; `book` dropped in Phase 7 |
| `lib/server/publishGame.ts` | Stamps `protocolFor(kind)` | Unchanged code; the kind moves |
| `scripts/mock-rgs-server-book.mjs` | Deals every book game | Phase 1: honours the free-spin fields. After Phase 7: fixture only (§4). |
| `scripts/mock-rgs-server.mjs` | No special, no scatter-wild, no resume at boot, no overlay seam | Gains all four (Phases 3–4) |
| `scripts/mock-pots-overlay.mjs` | Book host only | Any lines-family host (Phase 4) |
| `services/test-server/server.mjs` (`makeBookMock`, `makeMock`, `MOCK_PROTOCOLS`, `normalizeContract`, `validGrid`), `Dockerfile`, `openRounds.fixture.mjs` | `book` protocol | `validGrid` shape-checks the new fields. `makeBookMock` and `book` go in Phase 7. The fixture moves to `lines`. |
| `launcher-api/scripts/publish-game-bundle.mjs`, `publish-game-via-portal.mjs`, `seed-project-profile.mjs` | Default to `book` when the key matches `/book\|borut/` | Default `lines` |

**Play4Fun facade (`packages/rgs-translator-eagaming`)**

| File | Today | Becomes |
|---|---|---|
| `src/gameMappings.ts` | `bookMapping`, `MAPPINGS.book`, `pickMappingForConfig` | Stays (server vocabulary). `PIC8–10` become lines markers (§2). |
| `src/engineFacade.ts` | `pickRandomly` → `setExpandingSymbol`; expand gate hard-codes `PIC1` | Gate reads the bridge, with today's rule as the fallback (§3.4) |
| `src/paytable.ts`, `betOptions/connection/platformJackpot/resume.fixture.ts` | Read and exercise the book wire | Stay, against the fixture mock. `resume` gains a lines-mock section. |

**Engine runtime**

| File | Today | Becomes |
|---|---|---|
| `apps/lines/src/game/{typesBookEvent,bookEventHandlerMap,flowEffects,utils,types}.ts`, `components/{SpecialBook,ExpandingSymbol,FreeSpinIntroSymbolReveal,RevealSymbolRider,BookVfx,Game}.svelte`, `editor-scenes.ts` | Event-driven, kind-agnostic | Stays |
| `packages/engine-game/src/game/gameConfig.ts` | Publishes `__IE_WIN_LEVELS__` | Also publishes `__IE_EXPAND_MIN_REELS__` (runtime release) |
| `packages/engine-game/src/game/gameState.svelte.ts`, `apps/lines/src/game/flowEffects.ts` | Comments name `bookOf` | Comment edits |

**Flow v2 reference and vocabulary**

| File | Today | Becomes |
|---|---|---|
| `packages/engine-flow-v2/src/reference/{bookOf,bookOfChoreo,drivenSeed,registry,starterDoc,standardVocab,addOns,holdAndWinChoreo,cluster,scatter,ways}.ts`, `types.ts`, `index.ts` | `BOOK_OF_VOCAB` (`templateId: 'bookOf'`) is also `lines`' vocabulary and seed (`VOCABULARY_FALLBACKS` / `DRIVEN_SEED_FALLBACKS`: `lines → bookOf`) | **Stays.** `'bookOf'` here is a vocabulary id stored in every lines and book flow doc in R2, not a kind. Renaming it would rewrite every flow doc for no gain. The same reasoning kept the `_runtime/lines` bundle id and kept paylines out of `winModel`. The book surfaces stay in the base vocabulary: they are inert without the server event, and making them a fragment would turn every lines project's seeded book choreography into a publish-gate error. |
| `apps/lines/src/game/{flowV2Doc,flowV2StackedDoc}.ts`, `flowV2PotsScreen.fixture.ts`, `tools/flow-spike/*` | `templateId: 'bookOf'`; the fixture scaffolds `scenesOf('bookOf')` | `templateId` stays. The fixture uses the Book-of reference set by its new id. |

**engine-layout templates and reference layouts**

| File | Today | Becomes |
|---|---|---|
| `src/lib/templates/{bookof,index,standard}.ts` | A `bookOf` slot template (`freegame` slots, no `boardGlow`) | Dropped in Phase 7 after the layouts are migrated. Slots are editor hints the runtime never reads. |
| `src/lib/referenceLayouts/{bookof,index}.ts`, `scenes/bookof.json`, `scripts/gen-scene-sets.mjs` | `FULL_SCENE_SOURCES.bookOf` (a kind) | A named reference/scaffold set, not a kind, with `gameType: 'lines'` |
| `src/lib/referenceLayouts/lines.ts` | Already has `specialBook` | Stays |
| `src/lib/types.ts` (`LayoutDoc.gameType` doc comment), `scripts/test-hold-and-win-template.mjs`, `test-resting-scenes.mjs` | Name `bookOf` | Edits |

**Current-games harness**

| File | Today | Becomes |
|---|---|---|
| `scripts/current-games/lib/plan.mjs` | `SCRIPT_FOR_KIND.bookOf`, `protocolFor(gameType)` fallback | Script chosen by the contract. A manifest-less contract comes from the snapshot config (§2). |
| `lib/gates.mjs` | `BY_TYPE.bookOf` | Folded into `lines` |
| `screens/bookOf.json` | lines scenarios plus `pots` | Merged into `lines.json`; the `pots` scenario stays gated on `grid.potsOverlay` |
| `fixtures.mjs` | `cg-bookof`, `cg-bookof-pots` (`gameType: 'bookOf'`, `protocol: 'book'`) | `cg-book`, `cg-book-pots`: lines plus the preset |

**game-spec, scaffolding and the desktop profile**

| File | Today | Becomes |
|---|---|---|
| `packages/game-spec/src/{schema,scaffold}.ts`, `examples/book-of-thermopylae.spec.ts`, `README.md` | `type: 'bookOf'`; `backendFor` picks the book mock and `PUBLIC_RGS_GAME=book` | `type: 'lines'` plus an optional `expandingSymbol` section; lines mock |
| `scripts/new-game.mjs` | Comment: "a Book-of game is apps/lines plus a bookOf scene set" | Edit |
| `launcher-api/scripts/seed-game-editor.mjs` | Writes `gameType: 'bookOf'` | `'lines'` |
| `launcher-api/src/lib/server/launcherProfile.ts`, `scripts/verify-launcher-profile.mts` | `protocol: protocolFor(gameType)` | `lines` for every Book-of game |

**Gates that name the kind** (each is updated in the phase that changes its subject):

- launcher: `check-{flow-publish-gate,symbols-kind-gating,pots-overlay-add-on,unused-symbols-in-game,mock-contract,signal-scope,project-scaffold,bonus-import}.ts`, `gameProfileChips.fixture.ts`;
- root: `check-{book-paytable,platform-jackpot,pots-overlay-protocol,win-x}.mjs`,
  `verify-{buy-cost,server-paytable,server-paytable-import}.mts`,
  `verify-test-server-project-pin.mjs`, `playtest/{determinism-proof,win-countup-repro}.mjs`,
  `screenshot-info.mjs`.

**Docs and agents** (Phase 7, through `docs-keeper`):

- agents: `.claude/agents/book-of-game.md` (rewritten around "lines plus the Thermopylae preset"),
  `invisible-game-config`, `invisible-game-maker`;
- tools: `docs/tools/{game-config,game-maker,invisible-editor}.md`;
- guides and playbooks: `guides/build-your-first-game.md`, `playtest/{borut-remake,borut-pots-sample,current-games}.md`;
- design: `design/{game-type-templates,pots-overlay,invisible-editor,invisible-game-maker,invisible-flow-v2-schema}.md`;
- reference: `reference/play4fun-protocol.md` (the book mock becomes a fixture);
- the status files.

## 6. Migrating the current projects

**Where a project's kind lives:**

- **Postgres** `projects.game_type` (`projectGameType`), read by every tool, `resolveMockContract`,
  `publishGame`, `launcherProfileFor` and `/api/pipeline/games`;
- a **LayoutDoc** `gameType` in R2 (`<client>/<project>/editor/scenes.json`): editor slots, the
  `/flow` v1 palette, and the cross-type guard;
- the **test-server manifest** (`test_server/games.json`): `protocol: 'book'` as written at publish;
- possibly a global **`_shared/editor-templates/bookOf.json`** override.

Flow docs, symbols docs and win-text docs hold nothing kind-specific.

**Known Book-of games:**

- `bookofborutremake` (shared runtime, book mock);
- `borut-pots-sample` (shared runtime, book mock plus the overlay);
- `bookofborutpartner` (shared runtime, partner RGS, no manifest entry);
- `bookofborut` and `bookofborutremakebuild` (desktop builds with their own bundles, `book` in the
  manifest).

**Phase 0 census.** A read-only script lists every `game_type = 'bookOf'` row and the facts the
migration needs. Duplicates made during the window are found by re-running it. For each project:

- whether it has an authored config;
- `S`'s `special_properties`;
- its bet modes and its `freeSpins` block;
- whether it has a `potsOverlay`;
- its layout's `gameType`;
- its manifest entry (protocol, runtime, `projectKey`, own bundle);
- its card URL (this confirms §2 for the partner game).

**The migration.** One-time and idempotent: a project already migrated is a no-op.

- It is an **admin-only launcher action** with a dry-run preview (decision 6). It runs inside
  the launcher with the launcher's own DB and R2 access, so no owner credential leaves the server.
  The `/admin` Re-scaffold backfill is the precedent.
- The alternative is the same steps as a script the owner runs with `DATABASE_URL` and R2 keys.

Per project, in order:

1. **Config**, through the config store (compare-and-swap plus a History backup):
   - add `freeSpins.expandingSymbol` with the Thermopylae weights and `minReels: { H1: 2 }`;
   - add `'wild'` to the book scatter;
   - write the departures that make the lines mock deal what the book mock deals now: the 10
     captured paylines, `retriggerAwards` +10, and a bet modes table of base plus the one 100× buy
     under its existing card name (decision 4);
   - set the scatter row to `3:2 4:20 5:200`, paid (decision 1).
   - An **un-authored** project gets the preset (the census flags these for the owner).

   Adding `'wild'` to `S` also lets anticipation count books as wilds (`anticipation.ts` `isWild`).
   That is more correct for a book game, and anticipation is opt-in per flow. The census reports
   which projects already have it.
2. **Layout** `gameType: 'bookOf'` → `'lines'`, through the editor store (compare-and-swap plus a
   backup). Nothing else in the doc changes. The runtime never reads the field.
3. **Kind**: `setProjectGameType(key, 'lines')`.
4. **Republish** the shared-runtime games that have a published pointer (`publishGame`), so the
   snapshot carries the block and the manifest gets the `lines` contract.
   - The player mock follows `source=published`: the snapshot's config with the live kind. So
     between steps 3 and 4 the players get the lines mock without the special. That is about one
     publish (~30 s), done in the same request.
   - A publish gate that refuses (flow, paytable drift, sounds) is reported and needs the admin
     override.
   - **The partner game is not republished** if its card is not a test-server card. Publishing
     would rewrite that card and add a manifest entry. Its client does not need the block (§3.4),
     and its tools read the live config.
5. **Desktop builds** cannot follow by data alone.
   - Each pinned build re-reads its project's contract (`refreshContract`). It would flip to the
     lines mock, and `sellableGrid` would strip its bet table, because a desktop bundle may predate
     tables. Its buy would stop working.
   - So before step 3 they are rebuilt from the desktop launcher (☁ Publish advances the engine) on
     a Phase 3+ engine.
   - `register-game` / `publish-game-bundle.mjs` stamp the build as table-capable, and
     `sellableGrid` keys on that stamp.
   - (Decision 5: they are rebuilt, not retired.)

**Transition window: yes, and it is explicit.** From Phase 2 to Phase 7 the `bookOf` kind, the
`book` protocol and `bookReveal = kind OR block` all work side by side. That is the only window in
which the repo carries a back-compat shim, and **Phase 7 deletes all of it**. Phase 7 merges only
when the census returns zero `bookOf` rows, zero `book` manifest entries and no
`_shared/editor-templates/bookOf.json`. No permanent read-time alias is added. A stray row after
Phase 7 would read as a custom kind, which every surface already treats as lines.

## 7. Build plan

> Where it stands: Phases 1–5 merged (#1114, #1119, #1120, #1123, #1126); Phase 6 tooling and the
> table-capable stamp in #1132 and #1135 (the owner runs the migration). Phase 7 is built as a DRAFT that merges only once the
> `/admin` Book-of census is clear; see [status/game-config](../status/game-config.md) ("The
> Book-of kind is removed") and [status/engine](../status/engine.md).

**Every phase:**

- is a PR, or a few PRs, that leave `main` green;
- passes `pnpm check:rgs`, `pnpm check:all`, `pnpm check:svelte`, the launcher `check:*` (the Lint
  workflow), and the **current-games** harness with every current game unchanged (main vs branch);
- updates its status files.

An engine change (`apps/lines`, `packages/*`) means a runtime release on merge, so it is booted on
both mocks before review. Mock, contract and test-server changes need the launcher and the test
server deployed.

0. **Plan and census** (S). This doc, plus the read-only census script, run by the owner.
1. **Free spins for Book-of games, on the book mock** (S–M, no runtime release).
   - The `book` branch of `projectGrid` sends `freeSpins: false`, `freeSpinsTrigger` (always
     `SCAT`: decision 9) and `freeSpinsAwards`, each only on a departure from the BOOK defaults.
   - `mock-rgs-server-book.mjs` honours them:
     - off: no feature, and a buy is refused with errorCode 101;
     - the trigger count is counted on the book, base and retrigger;
     - a forced trigger places `count` books;
     - awards and the random range work as in the lines mock;
     - the pure `awardTable` / `drawAward` move out of the lines mock's closure so both mocks share
       one copy, which `check:freespins` holds to `freeSpinsAwardFor`.
   - Defaults are per kind (decision 8): `freeSpinsDefaultsFor(kind)` gives `bookOf` 10 / +10 and
     every other kind 10 / +5. `/config`, the contract and the mock all read it. The normalizer no
     longer drops a table equal to a default (it cannot know the kind); `/config`, which does,
     deletes a table edited back to its kind's default.
   - `/config`: `offersFreeSpins = capabilities.freeSpins`.
   - Gates: `check:freespins` gains a book section; `check:mock-contract`. Seeded book responses
     with none of the fields are byte-identical to `main`'s book mock.
2. **The contract** (M, no consumer change).
   - `freeSpins.expandingSymbol`: types, normalizer, `resolveExpandingSymbol`, the validator rules
     in §3.2, the scatter-wild rule.
   - The Thermopylae preset source and `check:book-preset` (its JSON default comes with 5a).
   - No authoring UI: the "Expanding symbol" panel is Phase 5a. Until then the block is set through
     `/config`'s raw JSON, and its issues show in the Free spins section.
   - `KindCapabilityConfig.expandingSymbol` and `bookReveal = kind OR block`.
   - `projectAddOns`.
   - Gates: `expandingSymbol.fixture.ts` (preset is a fixed point with zero issues; absent ⇒ every
     committed default byte-identical; garbage and each impossible config named by path),
     `check:game-config-defaults`, `check:symbols-kind-gating`.
3. **The lines mock deals the mechanic** (L; 3a–3c can be parallel PRs).
   - 3a: the `expandingSymbol` and `scatterWild` options, the contract fields, `projectWild`
     skipping scatters, `validGrid`. Gate: `check:expanding-symbol`:
     - the `pickRandomly` shape and position;
     - the expansion pay;
     - the line pass without the special;
     - no retrigger from the special;
     - the buy and the forced trigger;
     - the special drawn only from in-play candidates;
     - every existing configuration byte-identical;
     - the facade translating the preset's feature round to the same engine-event types, in the
       same order, as it translates the book mock's.
   - 3b: resume at boot on the lines mock, with `check:resume` against both mocks.
   - 3c: the `__IE_EXPAND_MIN_REELS__` bridge (`engine-game` `gameConfig.ts` → the facade gate),
     plus `PIC8–10` in `pickMappingForConfig` (runtime release). A facade fixture checks that with
     no bridge the gate is today's.
4. **The pots-overlay seam on the lines mock** (L). The six hooks plus `startFreeSpins` drawing the
   special. `check:pots-overlay` runs over both hosts, with the book host's digests unmoved.
   `check:unused-symbols-in-game` covers the new host.
5. **Tools follow the block** (M; 5a–5d in parallel once Phase 2 is merged):
   - 5a: the `/config` "Expanding symbol" panel and preset;
   - 5b: `/symbols`, `/win-text` and the profile chip reading the add-on;
   - 5c: Game Maker creates "Book of Thermopylae" as lines plus the preset (and stops offering the
     kind); `/editor` imports the Book-of reference as a reference;
   - 5d: the rules page states the expanding symbol (`engine-layout` `uiText.ts` / `infoManifest.ts`
     options, harvested for `/localization`; runtime release).
   - Guides go in the same change (rule 9 does not apply: no registry entry changes).
6. **Migrate** (M, owner-triggered).
   - The admin action (§6), dry run, then apply. Then republish the runtime games, and rebuild or
     retire the desktop builds.
   - Proof:
     - the census is clean;
     - a `current-games` run dispatched on `main` passes every migrated game through the lines
       script, free spins (book reveal and expansion) and pots included;
     - `loaded` / `idle` are byte-identical before and after;
     - `scripts/playtest/determinism-proof.mjs` runs on the lines mock with the preset;
     - the `game-playtester` agent runs `docs/playtest/borut-remake.md`.
7. **Remove the kind** (M–L, mostly mechanical).
   - Every "Becomes" in §5 marked Phase 7: `GAME_KINDS`, `protocolFor`, `book` in both
     `MOCK_PROTOCOLS`, the slot template, the `/flow` v1 entry, the scene-set kind.
   - The harness: plan, gates, screens and fixtures.
   - game-spec, scaffolds and the publish scripts' defaults.
   - The shim, the admin action, and the Phase 1 fields in the fixture mock.
   - The docs and agents.
   - Gate: everything above plus the census at zero.

Dependencies:

- 1 is independent.
- 2 can run beside 1.
- 3 needs 2. 4 needs 3a.
- 5 needs 2 and can run beside 3 and 4.
- 6 needs 3, 4 and 5.
- 7 needs 6.

**Done when:**

- `bookofborutremake`, `borut-pots-sample` and `bookofborutpartner` are `lines` projects with
  `freeSpins.expandingSymbol`;
- the first two are dealt by the lines mock, and their Free spins, bet modes and grid settings act
  on it;
- the partner game still plays the partner RGS unchanged;
- a fresh lines project adds the mechanic in `/config` alone and plays it on the mock;
- no `bookOf` kind or `book` protocol remains;
- every current game passes the harness.

## 8. Decisions (owner, 2026-10-07)

1. **The book scatter pays its scatter pay**, `3:2 4:20 5:200` × total bet, as the info page and
   the captured declaration say. This reverses the book mock's zero pay (`cf1db93`) when the game
   moves to the lines mock; Phase 1 does not change it.
2. **Books on a line count as wilds**, leading books included (the generic wild rule). Lines mock,
   Phase 3; Phase 1 does not change it.
3. **The book mock becomes a test fixture only** (§4) once no game is dealt by it.
4. **Borut's buy menu stays base plus the one 100× buy**, under its current card name. More cards
   are a `/config` edit later.
5. **The desktop builds `bookofborut` and `bookofborutremakebuild` are rebuilt** on the Phase 3+
   engine, with the table-capable stamp, before the migration.
6. **The migration runs from an admin-only launcher button** (dry run, then apply), deleted in
   Phase 7.
7. **No "server game" field.** The boot `config` and the delivery profile already say which server
   a game talks to (§2).
8. **A Book-of game's default retrigger award is +10** (the captured Book of Thermopylae rule, which our Book of Borut remake is dealt today), so nothing changes
   until an author edits it. The lines default stays +5. The default is per kind until Phase 7,
   when the migration writes +10 explicitly into each Book-of config and the per-kind default goes
   with the kind.
9. **Phase 1: the trigger symbol of a Book-of game is fixed to the book** (the in-play scatter).
   `/config` shows it but offers no picker; the count, on/off and the awards are authorable. A
   different trigger symbol on a book game would be a different game; it becomes possible once the
   game runs on the lines mock (Phase 6), which already supports one.

## Not in this plan

- Renaming the flow vocabulary id `'bookOf'`. It is stored in every flow doc; see §5.
- The expanding special on `ways` / `cluster` / `scatter` games. The validator refuses it until a
  payout rule exists.
- Carrying the special into an imported bonus mode.
- Per-type runtime bundles.
