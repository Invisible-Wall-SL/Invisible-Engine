# Lines — family knowledge

What is always true about payline slots, the Book of Thermopylae preset and free spins, and what has
gone wrong with them. Owner agent: `lines-games`.

## What it is and must stay

- **A lines game** pays left-to-right runs of one symbol along fixed paylines. Scatters pay
  anywhere and can trigger free spins. A wild substitutes on lines. `lines` is the default kind
  (`DEFAULT_GAME_KIND` in `packages/constants-shared/gameKinds.ts`): a project with no recorded kind
  plays as lines.
- **`apps/lines` is the shared runtime, not one game.** Every online game of every kind boots the
  bundle built from `apps/lines` and `packages/*` (`runtime:lines`). A merge to `main` that touches
  either path runs `.github/workflows/runtime-release.yml` and re-points every online game. So a
  "lines" change has the widest blast radius in the repo: it reaches ways, cluster, scatter, Hold
  and Win, match-3 and arcade games too. Rollback is `.github/workflows/runtime-rollback.yml`.
- **The Book-of mechanic is a lines feature, not a kind.** A Book-of game is a lines game whose
  Game Config carries `freeSpins.expandingSymbol`, and whose scatter is usually also wild (the
  "book"). Design: `docs/design/book-feature.md`. Its parts:
  - **The book:** one symbol with `special_properties` `['scatter', 'wild']`. 3+ anywhere trigger
    free spins; on a line it substitutes. Only one such symbol is allowed (validator).
  - **The expanding special:** when free spins start the server draws one paying symbol. On each
    free spin, if it covers at least `minReels` reels, those reels morph into it and it pays like a
    scatter (line row for the reel count × base stake). Then the other symbols pay their lines.
  - **Presentation:** the reveal shuffle, the column morph, the `bookIntro` / `bookIdle` symbol
    states. All event-driven; none of it reads the kind.
- **The retired `bookOf` kind.** It is still in `SLOT_GAME_KINDS` and still stored on old projects.
  How it is treated today:
  - `RETIRED_GAME_KINDS` (`apps/launcher-api/src/lib/server/gameKinds.ts`) hides it from every "new
    game" picker; existing projects keep it and still show its name.
  - Game Maker makes a new Book-of game as **lines + the Book of Thermopylae preset**
    (`LINES_PRESET_IDS` in `apps/launcher-api/src/lib/server/gameConfigDefaults.ts`), scaffolded
    from the `bookOf` reference scene set (`LINES_PRESET_SCENE_SET` in
    `apps/launcher-api/src/lib/server/projectScaffold.ts`).
  - A `bookOf` project is still dealt by the **book mock** (`protocolFor` →
    `'book'`, `apps/launcher-api/src/lib/server/mockProtocol.ts`), and `kindCapabilities` still ORs
    the kind into `bookReveal` (`packages/engine-layout/src/lib/kindCapabilities.ts`). That OR is
    the transition shim.
  - **Migration** (book-feature Phase 6): `/admin` → Migrate Book-of projects to Lines
    (`apps/launcher-api/src/lib/server/bookOfMigration.ts`) moves each project to `lines` with the
    mechanic in its config, then republishes it. **Built, not yet run** (owner runbook in
    `docs/status/game-config.md`, "Book-of migration"). Phase 7 deletes the kind, the book
    protocol and the shim after that.
  - The flow vocabulary id `'bookOf'` is stored in flow docs and is **not** being renamed.
- **Must never change:** a lines config with no `expandingSymbol` is dealt byte for byte as before
  the mechanic came to the lines mock. The partner's Book of Borut keeps playing the partner RGS
  unchanged. Math (paytable, strips, bet modes, feature rules) changes only in Game Config, by a
  person.

## Invariants

- **The client never decides a win.** It presents the server's book events. Money must be exact
  and agree with the server: `pnpm check:rgs`.
- **Book events are the contract.** The union is `apps/lines/src/game/typesBookEvent.ts`; the coded
  handlers are `apps/lines/src/game/bookEventHandlerMap.ts`; flow v2 handles the same events in
  `apps/lines/src/game/flowEffects.ts`. A flow that owns an event suppresses its coded handler. A
  mechanic not in the union cannot reach a published game.
- **Feature order:** `reveal` → `winInfo` (scatters) → `freeSpinTrigger` → `setExpandingSymbol`;
  per free spin `reveal` → `expandBookColumns` (only when the special qualifies) → `winInfo`
  (translated in `packages/rgs-translator-eagaming/src/engineFacade.ts`).
- **The special lives in state for the whole feature.** `setExpandingSymbol` sets
  `stateGame.specialSymbol`; `freeSpinEnd` clears it and `expandedSymbol` and broadcasts
  `specialBookHide`. The state is created in `packages/engine-game/src/game/gameState.svelte.ts`.
- **The reels that morph are the reels that pay.** The mock and the facade must use the same
  threshold. Lines mock: the authored `minReels`. Facade: `expandMinReels` reads
  `__IE_EXPAND_MIN_REELS__` (published by `packages/engine-game/src/game/gameConfig.ts`) on a
  lines-vocabulary server only; a book-vocabulary server (partner, book mock) keeps the captured
  rule, `PIC1` from 2 reels, the rest from 3.
- **The book reveal is unskippable.** `setExpandingSymbol` is in `UNSKIPPABLE_BOOK_EVENTS`
  (`apps/lines/src/game/unskippablePresentation.ts`).
- **`bookIntro` / `bookIdle` inherit the symbol's effective `win` binding** unless bound
  (`INHERITS` in `packages/engine-game/src/game/symbolCell.ts`; list in
  `packages/engine-layout/src/lib/symbolStates.ts`). Fixture: `symbolCell.fixture.ts`.
- **One expanding-symbol resolver.** Every reader goes through `resolveExpandingSymbol`
  (`packages/game-config/src/expandingSymbol.ts`); rules in `packages/game-config/src/validate.ts`
  (lines win model only, no base-game Hold and Win, one book).
- **The preset and the capture are one game.** `bookOfThermopylaePreset()`
  (`packages/game-config/src/bookOfPresets.ts`) equals `BOOK_OF_THERMOPYLAE` in
  `scripts/mock-rgs-server-book.mjs` through `bookMapping`: `check:book-preset`.
- **Only in-play symbols are drawn** (`getSymbolsInPlay`), including the book shuffle.
- **Determinism:** `?ie_determinism=<seed>` (`apps/lines/src/game/determinism.ts`) makes two renders
  of one forced book pixel-identical; the current-games harness depends on it.

## Where the code lives

| What                                         | Path                                                                                                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Book events, handlers, flow effects          | `apps/lines/src/game/typesBookEvent.ts`, `bookEventHandlerMap.ts`, `flowEffects.ts`                                                                        |
| Reveal and expand presentation               | `apps/lines/src/components/SpecialBook.svelte`, `ExpandingSymbol.svelte`, `FreeSpinIntroSymbolReveal.svelte`, `RevealSymbolRider.svelte`, `BookVfx.svelte` |
| Free-spin HUD and outro                      | `apps/lines/src/components/FreeSpinCounter.svelte`, `FreeSpinOutroDriver.svelte`, `WinLine.svelte`                                                         |
| Slam carve-outs, beat caps                   | `apps/lines/src/game/unskippablePresentation.ts`, `apps/lines/src/game/symbolBeat.ts`                                                                      |
| Book anticipation                            | `apps/lines/src/game/anticipation.ts`                                                                                                                      |
| Board state, config resolver                 | `packages/engine-game/src/game/gameState.svelte.ts`, `packages/engine-game/src/game/gameConfig.ts`                                                         |
| Coded symbol map                             | `apps/lines/src/game/constants.ts` (`SYMBOL_INFO_MAP`)                                                                                                     |
| Config: free spins, expanding symbol, preset | `packages/game-config/src/freeSpins.ts`, `expandingSymbol.ts`, `bookOfPresets.ts`                                                                          |
| Book-of flow choreography                    | `packages/engine-flow-v2/src/reference/bookOfChoreo.ts`                                                                                                    |
| Wire translation                             | `packages/rgs-translator-eagaming/src/engineFacade.ts`, `gameMappings.ts` (`linesMapping`, `bookMapping`, `pickMappingForConfig`)                          |
| Mocks                                        | `scripts/mock-rgs-server.mjs` (lines), `scripts/mock-rgs-server-book.mjs` (book)                                                                           |
| Kind retirement and migration                | `apps/launcher-api/src/lib/server/gameKinds.ts`, `bookOfMigration.ts`, `mockProtocol.ts`                                                                   |
| Preset JSON                                  | `apps/launcher-api/src/lib/data/gameConfig/lines.bookOfThermopylae.json`                                                                                   |

## Known failure modes

- **Symptom:** a resumed free-spin feature played every spin, then sat on "You won: $0.00".
  **Cause:** the win ladder was published from `Game.svelte`, which mounts after the resume is
  translated, so the facade stamped coded levels the authored ladder lacked
  (`apps/lines/src/routes/+layout.ts`). **Guard:** ladder published in `+layout.ts`;
  `check:resume`.
- **Symptom:** the round froze on the outro or a big win with the button dead. **Cause:** a win
  level missing from the ladder mounted no count-up, so the tap never armed. **Guard:**
  `ladderLevel` presents it on the nearest tier (`packages/engine-game/src/game/gameConfig.ts`).
- **Symptom:** client parked at free spin 7/20. **Cause:** a refused step mid-feature still
  presented a book with no `gameEnd`. **Guard:** the fetcher abandons and shows "Reload to continue"
  (`packages/rgs-translator-eagaming/src/eagamingFetcher.ts`); `check:connection` §10.
- **Symptom:** a feature died mid-round after any publish. **Cause:** a test-server refresh rebuilt
  every mock with `round: null`. **Guard:** `services/test-server/openRounds.mjs` holds open rounds;
  `openRounds.fixture.mjs`.
- **Symptom:** a 100× buy card debited 1×; the bought feature's special paid 100× too much.
  **Cause:** the book mock read `bet [x, M]` as a cost, not an option index, and paid the special on
  the round total (`scripts/mock-rgs-server-book.mjs`). **Guard:** `check:buy-cost`
  (`scripts/verify-buy-cost.mts`).
- **Symptom:** free spins started underneath a book reveal still on screen. **Cause:** a slam
  released `setExpandingSymbol` early. **Guard:** `UNSKIPPABLE_BOOK_EVENTS`.
- **Symptom:** the column morph could hang the round forever. **Cause:** `explosion` is one-shot;
  a cell that never reports `complete` blocks the await. **Guard:** capped at `TRANSIT_BEAT_CAP_MS`
  in `expandBookColumns` (`apps/lines/src/game/symbolBeat.ts`); no dedicated gate.
- **Symptom:** the book shuffle showed `W` / `H5`, symbols the game never deals. **Cause:** it cycled
  every key of the coded symbol map. **Guard:** it cycles `getSymbolsInPlay()`; the facade's book
  detection accepts any royal.
- **Symptom:** a project's own trigger symbol lit nothing on trigger. **Cause:** trigger positions
  came only from a `SCAT` win. **Guard:** the facade reads `spinTrigger.trigger.of`;
  `check:freespins` §15.
- **Symptom:** an expansion plays on screen and pays nothing. **Cause:** the special passes the reel
  gate on a count its line row does not price. Known, unreachable with today's tables. **Guard:**
  validator warning; `check:book-paytable` (no NaN).
- **Symptom:** a big win stepped its tiers but would not dismiss (Book of Borut remake). **Cause:**
  outro authored as the tier's own idle clip, plus no tap surface after the count-up. **Guard:**
  `tierHasExit` (`packages/engine-game/src/game/winEscalation.ts`) and a capped outro wait;
  `packages/engine-game/fixtures/winEscalationOutro.fixture.ts`.
- **Symptom:** a slammed free-spin outro crashed with `effect_update_depth_exceeded`. **Cause:** a
  signal source emitting synchronously on subscribe inside a tracked `$effect`
  (`packages/engine-layout/src/lib/ComponentInstance.svelte`). **Guard:** subscription in
  `untrack`; none beyond that.
- **Symptom:** every online board blank for ~20 min (HUD drew, symbols did not). **Cause:** an
  undefined identifier in a Svelte script shipped by the auto runtime release (PR #566). **Guard:**
  `pnpm check:undefined-names`; boot the game before merging engine code (PR #567).
- **Symptom:** a Book-of desktop build rendered black. **Cause:** the game repo pinned an older
  Svelte than the engine. **Guard:** `packages/config-vite/svelteVersions.js`;
  `pnpm check:svelte-pins`.
- **Symptom:** a count-up "stalls" at its amount in a test. **Cause:** a hidden pane or a hand-stepped
  rAF clock, not the engine. **Guard:** test on a real clock (`scripts/playtest/win-countup-repro.mjs`).

## How to test

- **Wire and money:** `pnpm check:rgs`. For this family the parts are `check:freespins`,
  `check:lines-parity`, `check:expanding-symbol`, `check:book-paytable`, `check:book-preset`,
  `check:lines-scatter-paytable`, `check:buy-cost`, `check:resume`, `check:connection`,
  `check:win-x`.
- **Everything offline:** `pnpm check:all` (discovers fixtures such as
  `packages/game-config/expandingSymbol.fixture.ts`), `pnpm check:svelte`,
  `pnpm check:undefined-names`.
- **Launcher:** `pnpm --filter launcher-api` `check:lines-presets`, `check:book-of-migration`,
  `check:mock-contract`, `check:deal-parity`, `check:flow-symbols-follow-config`,
  `check:game-config-defaults`.
- **Play:** `docs/playtest/lines.md` (the `apps/lines` dev build on the book mock, with
  `FORCE_TRIGGER=1` / `BIG_WIN=1`) and `docs/playtest/borut-remake.md` (the live published game).
  Hand either to `game-playtester`. Animation on a hidden tab is human-eyes, never a fail.
- **Current games:** screen scripts `scripts/current-games/screens/lines.json` and
  `scripts/current-games/screens/bookOf.json`, played by the current-games harness on every
  published game of the kind (`docs/playtest/current-games.md`).
- **A reviewer looks at:** a byte-identical deal for configs without the new field, the money in
  the bet response matching the HUD, the book reveal and morph order, and that every other kind
  still boots (it is the same bundle).

## Read more

- `docs/design/book-feature.md` (the mechanic and the kind's retirement plan)
- `docs/design/game-type-templates.md` (a game type is data plus a mechanic)
- `docs/design/free-spin-intro-symbol-reveal.md`, `docs/design/reel-anticipation.md`
- `docs/status/engine.md`, `docs/status/engine-history.md`, `docs/status/game-config.md`
- `docs/reference/play4fun-protocol.md`
