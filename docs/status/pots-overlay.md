# Pots overlay (add-on on any kind) — status + session hub

> Design: [docs/design/pots-overlay.md](../design/pots-overlay.md) · Builds on:
> [status/hold-and-win](hold-and-win.md) · Guide: [add-pots-overlay](../guides/add-pots-overlay.md) · Agents: per phase — see the
> design's build plan.

**One-line state:** Phases 0–6 merged (2026-10-02/03): #1008, #1013, #1012, #1015 (4a), #1019 (4b),
#1010, #1009, #1014, #1011 and #1017 (6). A Book-of project can switch the pots overlay on in
`/config`, or in one click from Game Maker ("＋ Pots overlay"). The mock deals it. The shared runtime
draws tokens over the host's symbols (after the stop, or reel by reel), flies each token as its own
flight head into its pot, drains the pot and starts its bonus (Hold and Win, or the host's free
spins). Overlays may be pots-only, coins-only or both, with 0–5 pots (`/config` **How many**, 2026-10-03).
An add-on symbol with no art draws a coded placeholder disc. The overlay screens, Flow steps (including
`showTokens` / `liftTokens` / `drainPots`), symbol states and Win Text are authorable. A project
without the block, which is every live project today, plays exactly as before. Next: the owner makes
`borut-pots-sample` (Owner checklist 2); then Phase 7 (import a bonus from another project); Phase 8
waits on the partner.

## How sessions use this file (the hub)

The work spans several sessions. **This file is the shared memory.** The coordinating ("hub")
session is the Claude Code session titled **"3 pots overlay mechanic"**.

- **Starting a phase:** read the design's §6 build plan and this file. Take the next unclaimed
  phase and put your session title in the Phase board.
- **Finishing (or stopping):** update the Phase board row and add a dated entry to "Recent changes":
  what landed, the PR, what is left, and any surprise. A Claude session also sends the hub a short
  message (`SendMessage` to "3 pots overlay mechanic", or `list_sessions` to find it).
- **Found something that changes the plan** (a contract change, a blocker, a partner answer)? Add it
  to "Decisions & findings" and tell the hub.
- **The committed file wins over any message.** If they disagree, fix the file.
- **Hold and Win parity is a gate here too.** Phases 2–4 touch the Hold and Win mock, the facade and
  the runtime. `check:holdandwin`'s digests and `check:freespins` must not move, and Book of Borut
  plays unchanged.

## Phase board

| # | Phase | State | Owner session | PR |
|---|---|---|---|---|
| 0 | Plan + hub | merged | 3 pots overlay mechanic | #1008 |
| 1 | Contract: `potsOverlay` config block + validator + presets + `resolveMeters` + additive `kindCapabilities` inputs | merged | 3 pots overlay mechanic | #1008 |
| 2 | Mock — composed protocol (`withPotsOverlay` over book, reusable H&W feature generator, free-spin hook, forced beats, wire doc, `check:pots-overlay`) | merged | Pots overlay Phase 2 — composed mock | #1013 |
| 3 | Facade + engine event contract (`overlayDrop`, mode-entry `cause`/`meters`, per-bonus routing, pots at boot for any kind) | merged | Pots overlay Phase 3 — facade + event contract | #1012 |
| 4 | Engine runtime (overlay layer, timing, lift-off flights, drain on any mode entry, H&W from an overlay host, resume) | merged | Pots overlay Phase 3 — facade + event contract | 4a: #1015, 4b: #1019 |
| 5a | `/config` Add-ons section | merged | Pots overlay Phase 5a — /config Add-ons | #1010 |
| 5b | Scene Editor overlay screens + palette/pickers through the capability | merged | Pots overlay Phase 5b — Scene Editor overlay screens | #1009 |
| 5c | Flow vocabulary composition (editor, publish gate, runtime) + graft | merged | Pots overlay Phase 5c — Flow vocabulary composition | #1014 |
| 5d | `/symbols` + `/win-text` + Localization through the capability | merged | Pots overlay Phase 5d — Symbols + Win Text | #1011 |
| 6 | Game Maker add-on action + guides + playbook + `borut-pots-sample` played end to end | merged (the published sample is the owner's) | Pots overlay Phase 6 — Game Maker add-on + sample | #1017 |
| 7 | Bonus import from another project (provenance, re-sync, pot → imported mode) | not started (needs 6) | — | — |
| 8 | Partner wire | blocked on partner | — | — |

## Current state

What exists, measured 2026-10-02 against `main` e5f94b1. These are the seams the phases change.

- **Runtime — already keyed on the config block, not the kind.**
  - The Hold and Win book-event handlers are always registered (`apps/lines/src/game/bookEventHandlerMap.ts:405-431`).
  - `RespinBoard`, the flight layer, the wheel and the banner are mounted for every game (`Game.svelte:2268, 2552-2558`).
  - The coded pots draw whenever the config declares meters (`HoldAndWinPots.svelte:32`).
  - Pot seeding at boot is a no-op without the global (`holdAndWinMeters.svelte.ts:78-84`).
  - Feature signals are registered only when `getActiveGameConfig().holdAndWin` is set (`Game.svelte:1644`).
  - The `holdAndWin` mode exists when the block does (`packages/game-config/src/modes.ts:69-78`).
  - A flight starts from a cell's seat, not its symbol (`flights.svelte.ts:167-172, 259-306`).
- **Not built — a token on a cell.** `RawSymbol` has `value`/`jackpot`/`factor`/`multiplier` on the
  symbol (`engine-game/src/game/types.ts:19-31`). The coin label is drawn inside `Symbol.svelte`
  (`:83-89, 266-270`). No layer draws a thing over an arbitrary symbol.
- **Not built — a pot that names a bonus.** `HoldAndWinMeter.activates` is a Hold and Win special
  only (`game-config/src/holdAndWin.ts:250-260, 612`). The mock's trigger cause is `'meter'`
  (`mock-rgs-server-holdandwin.mjs:1810-1815`).
- **Facade — a captured `holdAndWin` block takes over every bonus.**
  - Free-spin counters are dropped (`engineFacade.ts:722`).
  - `enterBonus` becomes respins (`:998-1004`).
  - `playedBonusSpin` becomes `holdAndWinState` (`:1029-1033`).
  - Capture happens at `:244-249`.
- **Mock — one protocol per game.**
  - `protocolFor(kind)` (`apps/launcher-api/src/lib/server/mockProtocol.ts:20-34`) and
    `makeMock` (`services/test-server/server.mjs:312-336`).
  - The book mock knows no meters (`scripts/mock-rgs-server-book.mjs`). The H&W mock deals no free spins.
- **Tools — gated on the kind.**
  - `kindCapabilities` sets `holdAndWin`/`coinSymbols` from the kind only
    (`packages/engine-layout/src/lib/kindCapabilities.ts:63-71`). Its helpers follow:
    `symbolStatesForKind`, `engineSignalsForKind` (`componentCatalog.ts:733`) and
    `componentOfferedForKind` (`builtinComponents.ts:2411`).
  - `/config` is the exception: it shows the section when the block exists (`config/+page.svelte:91-93`),
    but has no button to add one, and its presets replace the whole doc
    (`gameConfigDefaults.ts:71`, `+page.svelte:984`).
  - Flow vocabulary is one per `templateId` (`engine-flow-v2/src/reference/registry.ts:19-25`), and
    the Hold and Win vocab's parts are not exported (`reference/holdAndWin.ts:947-958`).
  - The publish gate refuses a Hold and Win ref in a book flow (`flowV2Validation.ts:49-58`).
  - The Scene Editor's "Add missing screens" compares against the kind's set
    (`editor/+page.svelte:1442-1477`), and a scaffold load replaces the layout (`:1196-1240`).
- **Cross-project — no import exists.**
  - `POST /api/game-maker/duplicate` copies a whole project onto a NEW key (`projectDuplicate.ts`).
  - Spines under another project's prefix export nothing (`editorArtExport.ts:929-938`).
  - The runtime holds one `RuntimeBundle` (`apps/lines/src/editor-scenes.ts:496-497`).

## Decisions & findings

- 2026-10-02 — **Phase 4b runtime, as built** (the session that built Phases 3 and 4a). Pinned by
  new cases in `engine-game`'s `potsOverlay.fixture.ts` (`boardDropCells`) and game-config's
  (`timing`), and by `check:flow-publish-gate` §11 (the graft).
  - **The token is its flight's head.** `flyTo` takes a `symbol` (drawn as the head in its
    `flyToMeter` state, in place of the kind's authored or coded head; the trail stays the kind's)
    and an `onStart` hook, fired as the head leaves after its stagger. A fill's `meterUpdate` moves
    its tokens into `stateOverlayLeaving`: they stay drawn at rest until `liftToken` takes each off
    as its own flight leaves. This removes the (N−1)×70 ms empty cell. The next event recorded (or
    the next spin) clears any token nothing flew, so a flow that owns `meterUpdate` without
    `fillMeter` leaves none behind. The cell under a token is not lit (`lightBaseCell` already
    skipped a host symbol).
  - **Per-reel timing:** `potsOverlay.timing: 'perReel'` (sparse; absent ⇒ after the stop, the
    default). `/config` → Add-ons → Presentation → "Tokens appear". `presentReveal`, the reveal both
    drivers call, reads the board's drop ahead in the book (`boardDropCells`: the `overlayDrop` after
    this reveal, before the next `reveal` or `tumbleBoard`). engine-game's new `onReelStopping(reel)`
    dep then puts each reel's tokens down as it stops, landing, with their sound. The drop later
    finds them down and neither restarts their landing nor replays their sound. Tokens a reel did not
    show (a board that swaps in place has no reel stop) appear with the drop, as after the stop.
  - **Flow actions** (overlay fragment, `addOns.ts`; effects in `flowEffects.ts`):
    - `showTokens` (`overlayDrop`) — the coded drop beat.
    - `liftTokens` (`meterUpdate`) — takes a fill's tokens off their cells without flying, for a
      flow that presents the fill its own way (`fillMeter` already flies each off as its head).
    - `drainPots` (`freeSpinTrigger` / `modeEnter`) — the coded drain of the pots that started the
      mode; an entry no pot started drains nothing. Hold and Win's `showRespinBoard` drains its own.
  - **A pot always drains** (the hub's review of #1019). When a v2 flow owns a pot-started
    `freeSpinTrigger` / `modeEnter` (the `potsToFreeSpins` preset's case) and the chain it runs has
    no `drainPots`, the play seam plays `presentMeterConsume` before dispatching (`playBook`'s new
    optional `beforeFlowOwnedEvent`). The test is `signalChainCallsAction` (engine-flow-v2): the
    exec chain from the signal's `event` nodes and `gameSignals` pin, in the scope the runtime
    picks (the active mode's graph when it handles the signal), a group counting whole; a call into
    the function library is not followed. Pinned by `check:flow-publish-gate` §11. A Hold and Win
    entry is not covered: its drain is `showRespinBoard`'s, and a flow that owns
    `holdAndWinTrigger` without that beat shows none.
  - **One token per cell in the drop beat too:** `presentOverlayDrop` reads the drop through the
    reducer (last named wins), so a cell named twice arms its beat and plays its sound once.
  - **A token keeps its size as it lifts off:** the head is drawn at the cell's seat scale
    (`flyTo`'s `symbolScale`), so a perspective board's token does not jump. It keeps that size all
    the way to the pot.
  - **The graft** now adds `overlayDrop` → `showTokens` beside `meterUpdate` → `fillMeter`. It is
    still idempotent and never touches an authored node. The Hold and Win starter flow with an
    overlay gains only the `overlayDrop` chain.
  - **Real-clock verification** (headless shell, ~4 fps; local mocks only, no R2):
    - **Borut-style parity** (book mock, one forced free-spin round): reaches idle; the 261-line
      flow trace is identical to the earlier `main` run; the same emitter event types; balance
      $5000 → $5023.50; only the four environmental errors (Typekit, `boot.json` 404).
    - **`pot:red`, after the stop** (threePots on a book host, a throwaway local config): the token
      drops, then leaves its cell as its own flight starts, with the `POT_RED` token as the head (a
      20 ms sampler saw the token, then the token-headed flight); Hold and Win plays; back to idle;
      0 exceptions.
    - **`overlay:coins:4`, per reel:** every token was shown by its reel as it stopped, in reel order
      (0, 1, 2, 4), before the drop restated them in its own order without restarting them; back
      to idle; 0 exceptions.
    - **Harness trap, not a game bug:** after any Vite HMR update (a config swap, a branch switch)
      the driver's `import('/src/game/actor.ts')` gets a fresh, never-started actor, which reads
      `rendering` forever. Restart Vite after every file change before a run.
  - **Not done, on purpose:** the mode-entry `cause` / `meters` fields are still not in the
    standard Flow payloads. `drainPots` reads the whole entry event, so an author needs no pin for
    them, and adding them would change every kind's vocabulary.
- 2026-10-03 — **Phase 6, as built** (session "Pots overlay Phase 6 — Game Maker add-on + sample",
  #1017). Pinned by `check:pots-overlay-add-on` (launcher), the game-config fixtures and
  `check:pots-overlay`. Reviewed by `pipeline-concurrency` and `code-reviewer`; every finding is fixed.
  - **The add-on** (`POST /api/game-maker/add-on`, `apps/launcher-api/src/lib/server/projectAddOn.ts`):
    - the config gets `addPotsOverlay` (which pairs the Hold and Win bonus), saved `If-Match` the
      loaded ETag; a refusal returns its `reason` (409), and `renamed` is shown;
    - then each part is its own conditional write and reports `added` / `present` / `conflict` /
      `skipped` / `failed`. Re-running with no preset seeds only what is missing;
    - **symbols:** placeholder art for every token (3 Pots specials by pot, else the coin) and, when
      the block is the overlay's bonus, its role symbols as `holdAndWinSymbolsSeed` binds them. Names
      after renames; an existing binding is never touched (`potsOverlaySymbolsSeed`);
    - **layout:** the Scene Editor's "＋ Add overlay screens" merge, server-side. On a Hold and Win
      game, whose Pots screen already exists, it appends one Pot Meter per new overlay pot and never
      moves an existing node;
    - **Win Text: nothing.** Every pot line has a coded default, and writing it in would freeze it as
      authored copy (a renamed pot reads `RED_2` until named);
    - **Flow:** never seeded; the 5c graft only when the user ticks it, on a stored flow;
    - **never over an unreadable doc:** a config that does not parse is refused, and a layout or
      symbols doc that does not parse is skipped (the loaders now flag `corrupt`);
    - **tools:** besides `gameMaker`, it needs `gameConfig`, `symbols`, `editor` (+ `flow` for the
      graft). No lease check: `If-Match` is the floor, and an open tab's next save gets its banner.
  - **Create a game:** an optional preset; the same path after the scaffold. A failed add-on is
    reported and the game is kept.
  - **Scaffold:** `getFullSceneSet(kind, sceneSetOptionsFor(kind, storedConfig))`, byte-identical for
    every config without an overlay (pinned for every kind and preset). Seed PUTs now carry
    `If-None-Match: *` (a first save landing between the HEAD and the PUT was erased).
  - **One home:** `$lib/addOns` `projectAddOns` reads `flowAddOnsOf`. 5d's three nits are fixed.
  - **Coins only** (design §7 #8): the validator errors only with neither pots nor coin drops, and
    a coins-only overlay on a Hold and Win BASE game is an error (its coins could start nothing).
    `coinsOnly` preset: Classic bonus, `chance` 0.1, `maxPerSpin` 8 (trigger min 6 + 2), one coin
    row. The mock sends `pots: []` and no `meterLevels`; the test server accepts it; the facade needed
    no change. `/config` keeps the last pot unless coins can start the bonus; the Game Maker hides
    zero-pot presets on a Hold and Win kind.
  - **The 3 Pots preset routes all three pots to Hold and Win.** The sample re-routes green to
    `freeSpins` in `/config` (Owner checklist 2); the preset stays the 3 Pots of Egypt shape.

- 2026-10-02 — **Phase 5d: symbols and copy, as built** (session "Pots overlay Phase 5d — Symbols +
  Win Text"). Pinned by `check:symbols-kind-gating` (265 checks) and `check:win-text-doc` §5.
  - **One reader of the add-ons, shared with 5b:** `apps/launcher-api/src/lib/addOns.ts`.
    `projectAddOns(doc).addOns` is what every `kindCapabilities` call in `/symbols`, `/win-text`,
    Localization and `gameProfile` now passes, and its `potIds` are the meter rows. 5d added
    `overlayTokenPots(doc)` beside it (each overlay token → its pots).
  - **States:** `symbolStatesForKind` and `visibleStatesFor` have three answers. With `holdAndWin`,
    every Hold and Win state. With `pots` alone, only `POTS_TOKEN_SYMBOL_STATES` (`coinLand`,
    `coinIdle`, `flyToMeter`, in `engine-layout`'s `symbolStates.ts`). Otherwise none, as before.
    The Scene Editor's state picker passes the add-ons (#1009), so it offers the same three.
  - **Tokens in `/symbols`:** only `source: 'overlay'` symbols join the rows, never a Hold and Win
    meter's symbol, so a project without the overlay gets no new row. A token row carries a
    `token → <pot>` chip.
  - **Flights:** shown on `pots`. A pots-only host lists `toMeter` and one `toMeter:<id>` row per
    pot, selected first (it has no `toTotal`); the picked row stays listed while it is picked.
  - **Win Text:** Jackpots, Respins, Hold and Win feature and Wheel stay on `holdAndWin` (the kind
    OR the block). A pots-only host gets a "Pots" section instead: `WIN_TEXT_POT_FIELDS` (Pot full,
    Pot label) and one name per pot. `collectWinTextTemplates` takes `pots`. Without an overlay,
    `pots` equals `holdAndWin`, and 120 side-by-side harvests matched `main`.
  - **Profile chip:** "Pots overlay (N pots)" when the block has pots.
- 2026-10-02 — **Phase 5c, as built** (session "Pots overlay Phase 5c — Flow vocabulary
  composition").
  - **`withAddOns(kindVocab, addOns)`** (`engine-flow-v2/src/reference/addOns.ts`). `addOns` is
    structural (`{holdAndWin, potsOverlay, meters}`); `game-config`'s `flowAddOnsOf(doc)` builds it,
    with `meters` from `resolveMeters`.
    - It returns the kind's vocabulary itself without a block, or when nothing new is added (the
      Hold and Win kind with its own block is `HOLD_AND_WIN_VOCAB`).
    - Entries are de-duplicated by name; the kind's own entry wins. Base events go after `reveal`,
      feature events at the end, fragment cues first.
    - **Hold and Win fragment:** `HOLD_AND_WIN_FRAGMENT`, the parts `HOLD_AND_WIN_VOCAB` is built from.
    - **Overlay fragment:** the new event `overlayDrop` (struct `OverlayCell`; struct fields cannot be
      optional, so a cell without `pot`/`value`/`jackpot` reads them as absent), `meterUpdate`,
      `meterLevels`, the pot cues and `flightArrive`, the actions `flyTo` and `fillMeter`, and the values
      `meter.<id>.level|max|stage|full`. These values are offered with the overlay only.
      `linesEngineReader` answers them for every `resolveMeters` id (an undeclared id reads
      `undefined`), so an overlay pot reports its config max and stages before any server level.
  - **Applied at three seams:** the `/flow-v2` editor, the publish gate (`validateFlowV2Against`
    takes `addOns`; the shipped check uses the bundle's own config) and the runtime
    (`flowV2Runtime.svelte.ts`, from `getActiveGameConfig()`). The cue harvest passes the same flags
    to `engineSignalsForKind`, so game-driven pot signals are not offered as author cues.
  - **`unusedByKind`'s regex is gone.** The standard entries per capability are listed by name
    (`STANDARD_CAPABILITY_ENTRIES`), filtered by `HOLD_AND_WIN_KIND_CAPABILITIES`. The gate pins both
    to `kindCapabilities('holdAndWin')` and to the old regex.
  - **Graft ("＋ Add overlay steps", `graftAddOnSteps`):**
    - **Overlay:** adds `meterUpdate` → `fillMeter` to the base graph as its own event node, unless the
      graph already handles the signal. It never wires a pin on the authored gameSignals node.
    - **Hold and Win block:** adds `modes.holdAndWin` from the seed's mode graph when absent, plus
      ContainerRefs for the screens that section shows (a ref without a scene validates and mounts
      nothing).
    - **Ids and placement:** a free prefix (`overlay`, `hw`, `hw2`…), new nodes right of the existing ones.
    - Idempotent, never mutates its input, never touches an authored node or an existing mode tab.
  - **Parity:** every registered vocabulary, starter flow and per-kind resolution is byte-identical to
    `main` (a JSON snapshot diff), and `check:flow-publish-gate` sections 7–12 pin it.
  - **Found, not fixed:** a branch guard's inline `$engine` operand is not validated (it is not a
    pin), so an unknown key in a guard passes the gate. This predates the phase.
- 2026-10-02 — **Phase 5a: the add-on merge helpers + the `/config` Add-ons section** (session
  "Pots overlay Phase 5a — /config Add-ons"). Pinned by `packages/game-config/addOns.fixture.ts`.
  - **The helpers** (`packages/game-config/src/addOns.ts`): `addPotsOverlay(doc, presetId)`,
    `addHoldAndWinBonus(doc, presetId)` and `removePotsOverlay(doc)`. They are pure (the input is
    never mutated) and return the merged doc UN-normalized, so a half-typed field in an editor's live
    doc survives an add. An add returns `{ok: true, doc, renamed}` or `{ok: false, reason}`. Phase 6's
    Game Maker action calls the same three.
  - **Name clashes are RENAMED, not refused** (the Phase 1 open item). A preset symbol or pot id the
    project already uses takes the first free `_2`, `_3`… suffix everywhere the add-on names it: its
    respin strips, its pot tokens, its drop table. `renamed.symbols` / `renamed.pots` list each change
    and `/config` says so. A host symbol is never shared or redefined, which is what lets a remove take
    back only what was added. Pot ids are renamed against the Hold and Win block's meter ids (a 3 Pots
    Hold and Win game adding the 3 Pots overlay gets `red_2`, `blue_2`, `green_2`).
  - **What an add refuses:** a second overlay; a Hold and Win bonus when the project already has a
    block; a bonus whose respin game type (`respin`, or the authored mode override's) already has
    strips, which are never overwritten. When the overlay preset pairs a Hold and Win bonus and the
    project already has a block (a Hold and Win game, or a bonus added first), the project's block is
    kept and the preset adds only the overlay.
  - **＋ Hold and Win bonus inserts the whole bonus** — the block, its respin-board symbols and its
    respin strips — not the bare block: a block with no respin strips deals nothing. `/config`
    offers it ONLY beside an overlay. Without one the block is the base game
    (`holdAndWinIsOverlayBonus` is false, the Phase 1 rule, unchanged), which would lock a ways or
    Book host's win model to lines. The code review caught that. A bonus added beside an overlay is
    the overlay's bonus however it was added, so removing the overlay removes it.
  - **Remove** takes out the overlay. When the block is the overlay's bonus, it also takes the block,
    its respin strips and a `holdAndWin` mode override, because without the overlay nothing could start
    it. It deletes only symbols no strip deals any more that an add-on makes: a bare token (exactly
    `meterSpecial`, no paytable) or a Hold and Win role symbol. A token the author has since given a
    payout or another role is kept. Strips another mode pads from are never removed. Add then remove
    gives back the original doc (fixture: both presets, with renames, and on all three Hold and Win
    games).
  - **`/config`:** the Add-ons section shows for every kind, between Bet modes and Hold and Win. A
    new pot row stays a client-side DRAFT until it has a token and a bonus ("Add pot"), so a save never
    drops a half-typed pot. The page passes `{holdAndWin, potsOverlay}` presence into
    `kindCapabilities`, and the win model is locked to lines only when a Hold and Win block is NOT the
    overlay's bonus (`winModelLinesOnly`). Validator issues show under the pot or drop row they name,
    and the field gets a red border.
- 2026-10-02 — **Phase 4a runtime, as built** (#1015; the session that built Phase 3). Pinned by
  `packages/engine-game/src/game/potsOverlay.fixture.ts` (now run by `check:pots-overlay`, with
  game-config's Phase 1 fixture, which was not run by any gate before) and `check:signal-scope`'s
  new pots-only case. `code-reviewer`: nothing blocking; its should-fix items are folded in below.
  - **The token picture** (`engine-game` `applyOverlayEvent`, recorded at the play seam into
    `apps/lines` `stateOverlay`):
    - `overlayDrop` puts tokens down.
    - A pot's `meterUpdate` lifts its own tokens at its `from` cells.
    - The next base `reveal`, a cascade step, or a `holdAndWinEnd` clears the rest, and so does
      the next round's spin press (`clearOverlay`, beside `clearWinPresentation`), so no token sits
      over rolling reels. A value coin that did not fly is gone by the next spin. Hold and Win's
      dropped coins stay on the base board while its pots drain, then live on the respin board
      (which covers the reels, tokens and all) until the feature ends.
    - The record is the timing: an event is recorded as its beat starts. Tokens therefore appear
      when `overlayDrop` plays (after the board stops) and leave as their fill's flights start.
  - **The layer:** `OverlayTokens.svelte`, mounted for every game right after `<Board />` (above the
    symbols, under the win line and the flights) and empty without a token. Each token is a
    `Symbol` at its cell's seat (`getSymbolSeat`, visible rows), so its art, its states and a value
    coin's label come from `/symbols`. Hidden while the respin board is up.
  - **The drop beat** (`overlayPresentation.ts`): `coinLand`, awaited (capped, raced against the
    slam), then `coinIdle`.
  - **Pots:** `configuredMeters()` now reads `resolveMeters`, so the coded pots, the
    `meter.<id>.*` value sources and the flights cover overlay pots. The pot signal family
    registers when either block is present (`featureComponentSignals(…, holdAndWin, pots)`).
  - **The drain on any mode a pot starts:** `drainedMeters(event)` names the pots a `freeSpinTrigger`
    or `modeEnter` with `cause: 'meter'` consumed. The play seam empties them, as Hold and Win's
    own reducer does for its trigger. The coded `freeSpinTrigger` and `modeEnter` handlers play the
    same drain beat as Hold and Win (`presentMeterConsume(ids)`) before anything else.
  - **Resume:** `createBonusSnapshot` no longer replays a `freeSpinTrigger` (or its counter) when a
    `freeSpinEnd` closed those free spins AND another bonus entered after it (`holdAndWinTrigger` or
    `modeEnter`). A two-bonus round therefore resumes on that bonus. A round with no later bonus
    (every plain free-spin game, Borut included) replays exactly as before. The trigger it does
    replay drops its `meters`, so a resume never re-plays a drain; the pots are restated by
    `meterLevels`.
  - **One token per cell** (the last named wins), so a duplicate in a drop cannot break the layer's
    keyed list. A cascade step (`tumbleBoard`) clears the tokens, like a new board.
  - **Tokens mount already landing:** the play seam sets `coinLand` as it records the drop, so no
    frame shows them at rest first. With a flow owning `overlayDrop`, the token's own completion
    settles it.
  - **`{meter}` in Win Text's "Pot full"** is the special a full pot activates, as before. For a pot
    that activates none (it starts free spins or another mode), it is the pot's own name
    (`potCaption`). A Hold and Win game's meters always activate a special, so their banner is
    unchanged. The `/win-text` hint says so; its preview still shows the special case.
  - **Tokens ship** (rule 8): `publish-symbol-defaults.mjs` keeps a symbol that is a pot's token
    (`resolveMeters`), not only symbols on a strip, so the published symbol defaults carry the
    token rows. The `/symbols` export never filtered by in-play, so an authored token binding
    already travels export → bake → pull → register.
  - **`configuredMeters()`** is resolved once per config object, so a pot's per-frame reads allocate
    nothing.
  - **Several modes in one round:** the facade now closes the bonus before at the next one's ENTRY
    (below), so a pot's stub mode after the host's free spins plays after them, not nested inside:
    enter freeSpins → exit → enter pickBonus → exit, each reaching `allFinished`.
  - **The hub's review of #1012, folded in** (no live-game impact; the hub's parity run found 0
    differences on 15,391 events):
    - **Resume of free spins → Hold and Win, mid-respins:** `freeSpinsGaveWay` (engine-game,
      pure) decides; `createBonusSnapshot` skips the ended free spins' trigger and counter. Pinned
      with the hub's round in `engine-game`'s fixture.
    - **Bonuses close at the next ENTRY** (`holdAndWinTrigger`, `enterBonus`, a pot's stub
      `modeEnter`), never at a `spinTrigger`, which the partner may send for a retrigger. A Hold and
      Win feature followed by free spins leaves the respin board there too.
    - **The look-ahead resets at each `spinStart`,** so a server that sends a drop after its board's
      `playedSpin` binds it to that board, not the next.
    - **A Hold and Win GAME that adds an overlay keeps identity names** (its boot `symbols` lists
      its Hold and Win symbols; a host whose block is the overlay's bonus does not). The mapping
      gate reads `POTS_OVERLAY_WIRE`, now defined in the dependency-free `gameMappings.ts`.
    - **No unknown-symbol warnings** for an overlay host's tokens and respin symbols.
    - **`potsOverlay.fixture.ts` moved** from `check:holdandwin` to `check:pots-overlay`.
    - **Validator:** a pot whose bonus is a reels mode it also drops in (free spins with
      `drops.modes` listing `freeSpins`) warns: it can refill during its own bonus and chain without
      end.
  - **The hub's review of #1015, folded in:**
    - A trigger board between a Hold and Win feature's end and the next bonus is a reel `reveal`,
      not a `respinReveal`: an overlay host's feature leaves the respin board at its
      `holdAndWinEnd`, and its total joins the round's win there (pinned in the facade fixture).
    - Pots a mode entry drains are pinned at their shown level as the drain is recorded
      (`pinDrainedMeters`), so they do not read empty during the mode's transition and then refill
      for the drain beat. The beat pins its own; a flow-owned entry's pins go at the next event.
    - The coded handlers call the drain only when a pot started the entry (no extra await for any
      other game).
    - A token whose art reports complete on mount, before its beat is armed, resolves the beat at
      once instead of waiting out the cap.
    - `publish-symbol-defaults.mjs` normalizes the config before `resolveMeters` and falls back to
      no tokens with a warning, so a raw compiled config cannot abort a publish.
    - `docs/tools/win-text.md` states the `{meter}` rule for a pot that activates no special.
  - **Real-clock verification** (`game-playtester`, headless shell over a CDP pipe, `--no-sandbox`
    as root; ~4 fps software rendering, page visible; local mocks only, no R2):
    - **Borut-style parity**, `main` vs this branch at e817f06, one forced free-spin round on the
      book mock: both reach idle; all 13 RGS answers byte-identical; the full ordered flow trace
      (262 lines) identical; the same 39 emitter-event types (one count, `soundScatterCounterIncrease`,
      varies run to run on either branch at this frame rate); balance $5000 → $4999 → $5023.50 on
      both, exactly the mock's; only the 4 environmental errors (Typekit, the boot.json 404).
    - **Overlay, `pot:red` on Phase 2's mock** (threePots on a book host, a throwaway local config):
      the token drops, the pot fills 0 → 12 and drains, Hold and Win plays its respins, back to
      idle, money exact, 0 exceptions.
    - **`pot:red,feature`:** the host's free spins play, end once (outro once), then the pot drains
      and Hold and Win plays, back to idle, money exact, 0 exceptions.
    - The earlier "cannot reach idle" was the harness: `win-countup-repro.mjs` looks for
      `chrome-headless-shell` (the binary here is `headless_shell`), and as root the shell needs
      `--no-sandbox`. Only the Typekit font fails remotely. **Fixed** in the scripts' shared launch
      (`scripts/playtest/headless-shell.mjs`), which finds either name and adds `--no-sandbox` as
      root — see [the headless real clock](../playtest/README.md#the-headless-real-clock).
  - **Parity:** without a drop, the layer is one empty container. Without a meter-caused entry,
    nothing drains. A game with no `potsOverlay` registers the same signals as before. A legacy
    resume replays exactly what it did. The svelte-check ratchet holds (lines 164).

- 2026-10-02 — **Phase 3 contract, as built** (session "Pots overlay Phase 3 — facade + event
  contract", #1012). Pinned by `packages/rgs-translator-eagaming/potsOverlay.fixture.ts` (75 checks
  on hand-built wire that follows Phase 2's wire doc; it runs in `check:holdandwin`) and new
  `modeStack.fixture.ts` cases. A throwaway driver also played the facade against Phase 2's real
  `withPotsOverlay` book mock (branch `claude/pots-overlay-phase2`, after its review): every
  forced beat plus 150 random rounds, 1,688 checks, 0 failures.
  - **The engine events** (`engine-game` `potsOverlay.ts`):
    - `overlayDrop {cells: [{reel, row, token, pot?, value?, jackpot?}]}`. Positions are VISIBLE
      0-based, like every Hold and Win position. `token` is the symbol name, mapped through the
      host's mapping (an overlay name passes through). A value coin carries `value` OR `jackpot`.
    - `ModeEntryCause {cause?, meters?}` is on `freeSpinTrigger` and `modeEnter`
      (`holdAndWinTrigger` already had both). The mode layer keeps `cause` on the entry and
      `meters` in its payload, for every entry kind: a `freeSpinTrigger` op now has `cause`, and a
      `modeEnter` with a nested `payload` merges a top-level `meters` into it.
      `modeEntryMeters(entry)` reads them back; Phase 4's drain on any mode entry uses it.
    - `apps/lines` registers `overlayDrop` as a no-op handler. It crosses `recordBookEvent` like
      every event, but nothing records it yet (Phase 4 owns the token picture).
  - **The facade** (`rgs-translator-eagaming` `potsOverlay.ts` + `engineFacade.ts`). Everything
    below happens only under a captured `config.potsOverlay` with `wire: 1`. Another wire is
    refused loudly, and the game then plays as a host without pots.
    - **Boot:** pot levels go out on the existing `__IE_HOLD_AND_WIN_METERS__` global, in
      `resolveMeters` order (the Hold and Win block's own meters first, then the pots), for any
      kind.
    - **Mapping:** with the block (wire 1, the facade's own gate), `pickMappingForConfig` keeps the HOST's mapping (book / lines)
      even when a `holdAndWin` block is present. Without it, a Hold and Win block still means
      identity names. The Hold and Win bonus names and token names are in no host's table, so they
      pass through.
    - **Order:** the wire puts `overlayDrop` right after `spinStart`. The facade binds each drop to
      the next `playedSpin` and emits it right after that board's `reveal`, before its `winInfo`s.
      A spin that also enters the host's own feature sends its `meterUpdate`s before `playedSpin`.
      The facade holds those until that board has paid, so a pot never fills before its board
      shows (§3.2: reveal → drop → wins → fills).
    - **A pot already full with no bonus waiting** (at boot, or left full by the previous round)
      enters its bonus on the next base spin with no drop and no `meterUpdate` before it. The
      entry carries `cause: 'meter', meters` all the same, so Phase 4's drain plays from the
      boot level. At most one Hold and Win per round: a second Hold and Win pot merges into the
      waiting entry (`meters` unioned) or waits for the next round. The mock decides both; the
      facade passes them through.
    - **A boot pot whose bonus names a mode the game lacks** is ignored: the host's own rounds
      translate as usual.
      Under an overlay, the overlay translation runs first, ahead of the Hold and Win one, for
      `overlayDrop`, `meterUpdate`, `meterLevels`, `modeEnter` and `modeExit`. The builders are
      shared, so the pot meters translate the same with or without a Hold and Win block. Only the
      overlay's `modeEnter` keeps `meters`, so a Hold and Win wire without the block is unchanged.
    - **A pot routed to any other mode** arrives as the `modeEnter {cause: 'meter', meters}` +
      `modeExit {total: 0}` stub. It passes through even on a host with no Hold and Win block.
    - **Routing:** `spinTrigger.bonus` → `potsOverlay.bonuses[key]` → `holdAndWin` plays on the
      respin board (`enterBonus` / `playedBonusSpin` → `holdAndWinState`), and anything else plays
      on the reels (free spins). A key the block does not list falls back to the Hold and Win
      block's own key (`config.holdAndWin.bonus`, default `respin`). The route holds from one
      `spinTrigger` to the next, so the free-spin counter only counts reels bonus spins. The
      facade has no Game Config doc, so it reads the route off the wire and never re-derives
      `holdAndWinIsOverlayBonus`. A route to Hold and Win with no Hold and Win block captured plays
      on the reels: there is no respin board to play it on.
    - **A pot's free spins:** `spinTrigger {cause, meters}` → `freeSpinTrigger {cause, meters}`
      with `positions: []` (no scatter caused it). The base spin's wins are banked at entry
      (`setTotalWin`), because a pot's trigger arrives after the reveal.
    - **Several bonuses in one round**, in whatever order the server sends them. Each later
      `spinTrigger` closes the bonus before it.
      - Free spins end with a synthesized `freeSpinEnd`. Its `amount` and its `winLevel` both come
        from the round's win so far, so they always agree. It is the `gameEnd` they would have had.
      - A Hold and Win feature leaves the respin board, and its `holdAndWinEnd` total joins the
        round's win, so the meter never steps back.
      - The round's own `gameEnd` then closes it as a base round, and a big round total gets its
        `setWin` there, as a Hold and Win round's does.
      - `playOutRound` needed no change: it already plays to the `gameEnd` after the LAST
        `enterBonus`.
    - **The coded free-spin intro** reads "A full pot awards N Free Spins" for `cause: 'meter'`,
      instead of "0 Scatters award…". A flow that owns `freeSpinTrigger` never reaches this text.
    - **Resume:** an overlay host resumes mid-respins at the next respin (as a Hold and Win game
      does) only when the open bonus is respins. A pot's free spins replay whole, as every
      free-spin round does.
  - **Parity:** with no block, the facade is byte-identical to `main`. A throwaway harness ran the
    old facade and this one against 36 seeded rounds (book, book free spins, lines, the three Hold
    and Win presets, a queued second mode, a forced meter trigger): 4,396 book events, 0
    differences. `check:holdandwin` (1892), `check:resume`, `check:freespins`, `check:rgs` and `check:engine-game` pass unchanged. The svelte-check ratchet
    holds (lines 164, engine-game 37, launcher 53). `apps/lines` booted on the local book mock
    (`FORCE_TRIGGER=1`) deals and drives the whole free-spin round exactly as `main` does. (Phase 4a's
    real-clock run later showed the container CAN reach idle: the earlier stalls were the harness —
    see Phase 4a below.)
- 2026-10-02 — **Phase 2 mock, as built** (session "Pots overlay Phase 2 — composed mock"). The wire
  is the reference's "Pots overlay" section; `pnpm check:pots-overlay` pins it (in `check:rgs`).
  - **Composition is through a host seam, not an HTTP post-processor.** A pot bonus has to keep open
    a round the host would close, and the host owns rounds, replay and resume. So
    `withPotsOverlay(createHost, inputs)` (`scripts/mock-pots-overlay.mjs`) returns a factory with
    the host's own signature and plugs into the host's `overlay` option. The book mock calls six
    hooks (`configContext`, `refuse`, `beginPlay`, `playOwned`, `takeOver`, `endPlay`) and exposes
    its free-spin entry as `startFreeSpins`. Without the option the book mock deals byte for byte
    what `main` (e4a78f1) dealt: three pinned digests.
  - **The Hold and Win engine is its own module:** `scripts/mock-holdandwin-engine.mjs`
    (`createHoldAndWinEngine`), with the H&W mock now only its sessions and HTTP.
    - `base: false` lifts the base game's needs (paylines, line symbols).
    - `rand` draws from the caller's stream.
    - `startFeature(…, activates)` takes the pots' specials.
    - `holdAndWinConfig(session)` is the boot block alone.
    - `check:holdandwin`'s digests did not move.
  - **The host deals the same game either way.** Drops draw from the overlay's own RNG
    (`<seed>:potsOverlay`). The gate replays 150 seeded rounds with and without the overlay (pots too
    deep to fill) and the host's events and balances are identical. Only a pot's free spins draw
    from the host's RNG, through its own hook.
  - **Pots live in `session.meters`**, beside a Hold and Win game's meters, so a contract swap
    (`carrySession`) keeps them.
  - **Wire choices the brief left open** (sent to the hub before Phase 3 started):
    - Array order: `overlayDrop` right after `spinStart`; the `meterUpdate`s after the host's wins
      and `playedSpin`, before its feature entry or `gameEnd`; `meterLevels` last on every play.
    - Boot pots carry an optional `activates`. `bonuses` = `{feature: 'freeSpins'}`, plus
      `respin: 'holdAndWin'` with a Hold and Win bonus. That boot block goes beside it with
      `meters: []`.
    - Pot → free spins: the book's `spinTrigger` with `occurs: 0`, `cause`, `meters`; `spins` =
      `bonus.spins`, else the book's 10.
    - Several bonuses in a round: the host's own feature first, then Hold and Win (every pot routed
      to it plus the coins, ONE feature, `cause: 'meter'` when a pot is in it), then the other pots
      in config order. Each one's end carries the next one's entry instead of `gameEnd`.
    - Any other mode is a stub until Phase 7: `modeEnter {cause: 'meter', meters}` +
      `modeExit {total: 0}`, then the round goes on.
    - A full pot waiting behind another bonus gets no more tokens. Its level stays at max until its
      bonus starts.
    - At most ONE Hold and Win per round (from the code review, sent to the hub). What starts one
      while one waits joins it. A Hold and Win pot that fills after the feature has played waits
      for the next round, and coins then start nothing.
    - A pot that is full with nothing waiting starts its bonus on the next round's first base spin,
      with no `meterUpdate` for it. That covers the case above, an abandoned round, a contract swap
      and a lowered `maxLevel`. Without this rule such a pot stayed full for good, because a full
      pot is dealt no tokens.
    - A pot routed to Hold and Win in a project with no Hold and Win bonus makes the overlay refuse
      to build. The test server then deals the plain book game and warns once.
    - The held coins are the value coins of the spin that started the feature. Coins below the
      trigger with no feature starting are shown and gone.
    - Force tokens: the brief's four, plus `feature` (the host's own feature on the same spin).
      They are refused before anything in the batch is dealt (the book mock is not atomic
      otherwise).
  - **A Hold and Win GAME's own count trigger counts landed coin symbols only** (Phase 1's open
    question). A dropped coin is not on its board. The overlay's coins are their own count, and only
    on a host whose block is the overlay's bonus.
  - **Test server:** a `book` contract carries `grid.potsOverlay` (`potsOverlayMockInputs`, the
    launcher's mock contract), shape-checked in `validGrid`. `makeMock` wraps the book mock.
    Forcing works only on the authoring twin or a standalone build, as on Hold and Win. An overlay
    that cannot be built deals the plain book game and warns once. The Dockerfile copies the two new
    modules (the H&W gate checks the copy).
- 2026-10-02 — **Phase 5b, Scene Editor + Component Editor, as built** (session "Pots overlay Phase
  5b — Scene Editor overlay screens", #1009). Pinned by `packages/engine-layout/scripts/test-hold-and-win-template.mjs`.
  - **Flags.** `apps/launcher-api/src/lib/addOns.ts` (`projectAddOns`) turns the resolved Game
    Config into `{holdAndWin, potsOverlay}` and the pot ids (`resolveMeters`). The Scene Editor
    palette, the properties panel's signal and symbol-state pickers, and the Component Editor's
    pickers pass the flags. Without a block, both flags are `false`, which `kindCapabilities`
    treats exactly like no config.
  - **Screens.** `getFullSceneSet(kind, SceneSetOptions)` merges the add-on screens into any kind but
    `holdAndWin` when a flag is set:
    - either add-on: the `pots` screen, with one Pot Meter per resolved meter;
    - with a Hold and Win bonus: also `jackpotBar` and all nine `holdAndWin` mode screens (respin
      background, board, counter, total bar, letters, wheel, intro, jackpot win, outro).
    - Not merged: `luckySpin` (an error on an overlay host's bonus), and the base game's message
      host (a node on an existing screen; a merge never edits one).
    - The screens come from the Hold and Win reference, so they are placed for its 5×3 board in the
      same main box as Book-of. They are centred, not fitted to the host's own board.
  - **Merge.** `mergeMissingScreens(current, reference, ids)` is one pure helper, used by both "Add
    missing screens" and the new **＋ Add overlay screens**. It puts each missing screen after the
    nearest preceding present screen and skips an id that already exists, so a second merge adds
    nothing. **＋ Add overlay screens** adds only `addOnSceneIds(kind, options)`, so a hand-authored
    layout like Borut's keeps every other screen unchanged even if it lacks other reference screens.
  - **Pot ids.** `HoldAndWinTemplateOptions.potIds` drives the pots: absent ⇒ red/blue/green (every
    kind's set with no options is byte-identical; hashes pinned); empty ⇒ no Pots screen. The editor
    passes the config's ids, so a **Hold and Win project on the Classic or Collector preset (no
    meters) no longer gets an empty Pots screen** from the scaffold or "Add missing screens". This
    is a deliberate change.
  - **Not covered:** the server-side new-project scaffold (`projectScaffold.ts:119`) passes no
    add-ons. It is Phase 6's to seed the overlay screens there.

- 2026-10-02 — **Phase 1 contract, as built** (session "3 pots overlay mechanic", #1008). Pinned by
  `packages/game-config/potsOverlay.fixture.ts` (115 assertions) and the kind-gating /
  signal-scope / hold-and-win-template gates. A code review's five findings were fixed before
  merge; they are folded in below.
  - **The block** (`packages/game-config/src/potsOverlay.ts`). It is the design's §3.1 shape.
    - `normalizePotsOverlay` is structural: a block with no pot and no drop is no block. A pot
      missing its token or bonus is dropped whole, as a Hold and Win meter is, so the 5a editor
      must keep draft rows client-side.
    - A block with pots but no `drops` stores `chance: 0.1, maxPerSpin: 1`. A drop entry without a
      weight weighs 1.
    - The default dropping modes (`['basegame']`) are not stored. An empty `reels` or `modes` list is
      kept as authored and reported by the validator ("No reel can receive a token" / "No mode
      drops").
  - **Tokens never sit on a strip.** A token on any `paddingReels` strip is an error. A token is
    exempt from the general "in the dictionary but on no strip" warning, but a token with a paytable
    still warns, because it can never pay.
  - **Drops:**
    - A weight must be above 0, which is stricter than the Hold and Win tables (they allow a 0
      entry). The chance is in (0, 1].
    - A dropping mode must play on the `reels`. A respin board, a wheel or `none` has no cell for a
      token.
    - Value coins with no `holdAndWin.trigger.count` → warning: they can never start the feature.
    - Value coins with `maxPerSpin` below `trigger.count.min` → warning. The `threePots` preset
      therefore sets `maxPerSpin` to the trigger's count (6).
  - **`resolveMeters(doc)`** lists the Hold and Win block's meters first (`source: 'symbol'`, bonus
    `{mode: 'holdAndWin', activates}`), then the overlay's pots (`source: 'overlay'`). It returns
    copies. Nothing reads it yet: Phase 4 moves the runtime's `configuredMeters()` onto it, and
    Phase 5 moves the tools.
  - **Bonus or base game: `holdAndWinIsOverlayBonus(doc)`** (`holdAndWin.ts`; it lives there to avoid
    an import cycle). The data decides, in this one place: with an overlay present, the block is the
    BONUS when the base game's strips deal no Hold and Win symbol. The base game's strips are found
    through the mode registry (`gameTypeForMode`). Phases 2–4 must call this helper, never re-derive
    it.
    - **As a bonus** (a Book-of or lines host):
      - The lines-only rule is skipped.
      - The feature starts only from a pot routed to `holdAndWin`, or from value-coin drops with
        `trigger.count`. The no-trigger error says exactly that.
      - `trigger.pattern`, `luckySpin`, `randomMetre`, `buy`, `instantCollectInBaseGame` (on the
        collector and the multiplier) and symbol-filled `meters` are errors ("not built for an
        overlay host yet").
      - A `trigger.count` with no value-coin drop → warning.
    - **As the base game** (a Hold and Win game that adds an overlay): every rule applies unchanged,
      and a pot routed to `holdAndWin` is one more trigger. The fixture validates pots-to-free-spins
      on all three Hold and Win presets clean.
    - The "nothing activates a special" warning counts a pot with `activates`.
  - **Presets** (`potsOverlayPresets.ts`):
    - `potsOverlayPreset(id)` builds a fresh `{potsOverlay, tokens, holdAndWin?}` on each call, so a
      game bundle never carries `HOLD_AND_WIN_PRESETS` (checked with a Rollup probe). Merging a preset
      into a doc is Phase 5a / 6, never a whole-doc reset.
    - `threePots` is built from the 3 Pots meters (red → payer, blue → collector, green →
      multiplier).
    - `holdAndWinBonus(id, host)` gives the paired Hold and Win block, its symbols and its respin
      strips, cycled to the host's `numReels` (3 Pots on a 6-reel host and the 3×3 Collector on a
      5-reel host both validate clean). It drops `luckySpin`, the block's meters and the
      `meterSpecial` tags, and turns instant collect off.
    - `potsToFreeSpins`: one `gold` pot → `{mode: 'freeSpins', spins: 10}`.
  - **`modes.ts`** now exports `HOLD_AND_WIN_MODE` and `GAME_MODE_ID`, the id shape pots share
    because both become anchors and value-source path segments.
  - **Capabilities** (`kindCapabilities.ts`):
    - Two presence flags in, `holdAndWin` and `potsOverlay`.
    - `holdAndWin` and `coinSymbols` = kind OR block. `pots` = `holdAndWin` OR overlay.
      `potsOverlay` = block.
    - `freeSpins`, `stackedPictures`, `bookSymbolVfx`, `tumblePattern` and `symbolTransition` stay
      on the kind.
    - The Pot Meter and the six pot signals (`potFill`, `potLand`, `potLevelUp`, `potStageUp`,
      `potFull`, `potActivate`) moved to `pots`.
    - `symbolStatesForKind`, `engineSignalsForKind` and `componentOfferedForKind` take an optional
      config. No consumer passes one yet.
  - **Parity:** 168 docs normalize and validate identically to `main`. They are every Hold and Win
    preset and fixture plus every committed default, each also under mutations including lucky spin,
    pattern, random metre and instant collect variants. `check:holdandwin` (1892 facade checks) and
    `check:freespins` pass unchanged, and the svelte-check ratchet holds (launcher 53, lines 164,
    engine-layout 291).
- 2026-10-02 — **Owner request + plan** (session "3 pots overlay mechanic").
  - The request: the 3 Pots mechanic as an optional overlay on any game. Coins appear on top of the
    symbols and fly to pots. A full pot cues a bonus: a classic Hold and Win, or "other games I
    already did".
  - The plan is the design doc. Its §7 lists the defaults the hub took for the owner's open
    decisions: tokens and value coins both; one pot per token; no drops in free spins; host feature
    first when both trigger on one spin; import (not live link) for another project's bonus; mock
    first; never test on live Borut.
  - Key structural choice: **an add-on is a config block, not a kind.** Capabilities become "kind OR
    block", and only the overlay's own parts follow the block. `freeSpins`, `bookReveal` and the
    rest stay on the kind.

## Open items / next

0. **Left after Phase 4b:**
   - ~~**Phase 6:** a token with no art in `/symbols` draws nothing.~~ Done 2026-10-03: it bit
     every overlay added in `/config` too, which seeds no art (only the Game Maker add-on does). A pot
     token, and a Hold and Win coin, jackpot or special, with no art now draws a coded disc
     (`apps/lines` `symbolPlaceholder.ts`). Seeding `/config` adds the Game Maker way is still open.
   - **Resume between a drop and its fills** shows no tokens: neither `overlayDrop` nor `reveal` is
     in the resume snapshot. The following `meterUpdate` still flies from the cell (with the coded
     head, as no token is there to carry).
   - **Order:** the drain plays inside the free-spin / mode entry beat, after the mode layer has
     entered the mode (`modes.before`), so the new mode's screens and music are already up. Hold
     and Win's drain has always worked this way. Moving the drain into a mode hook would put it
     first. Inside `freeSpinTrigger` it is also unskippable, which Hold and Win's drain is not.
   - **Coin over the win frame — decided 2026-10-02** (owner, design §7 #9). The overlay layer
     stays above the per-cell frames drawn in `Symbol.svelte`, as 4a built it. Design §3.4 now
     says so, and 4b does not restructure it.
   - **Per-reel timing reads the book ahead**, so it needs the drop in the same book as its board.
     The facade emits it there; a partner wire that sends drops in a later request would show them
     after the stop.
   - **Human eyes** on token pop-in (both timings), the token flights and the drain with REAL token
     art, at full frame rate (the container renders at ~4 fps). Two things to judge (the hub's
     review of #1019, no code yet):
     - per-reel tokens appear at the reel's stop beat (`onSpinFinishing`, the start of its bounce),
       so the strip is still settling under a token already at rest;
     - tokens on stopped reels sit above the anticipation dim and are not darkened with them.

1. **Phase 6 (#1017)** built the Game Maker add-on, the scaffold's scene options, the one-home
   add-ons helper (`$lib/addOns` on `flowAddOnsOf`) and 5d's three nits; see Decisions. Left: the
   owner makes and publishes `borut-pots-sample` (Owner checklist 2), then a session plays it on
   its authoring mock with the playbook.
2. **Owner decisions** (asked and answered 2026-10-02):
   - **(a) Decided 2026-10-02: the coin draws over the win frame** (design §7 #9). This is 4a's
     layering, so nothing is to build.
   - **(b) Decided 2026-10-02: pots and coins are each optional** (design §7 #8). An overlay may be
     coins-only (no pots: value coins over the host's symbols, N+ start a classic Hold and Win) or
     pots-only, but needs at least one. Built in Phase 6 (#1017):
     - the validator allows zero pots when the drop table has a coin row, and errors only when there
       are neither pots nor coin drops;
     - a `coinsOnly` preset paired with the Classic Hold and Win bonus;
     - `/config` lets the last pot be removed and offers the preset;
     - the mock and runtime are checked with zero pots (no Pots screen, no pot flights);
     - the Game Maker action offers it.
3. **Carried into later phases (found in Phase 1):**
   - Phase 3's mode-entry `cause` / `meters` fields are not in the Flow payloads yet: the kind's own
     `freeSpinTrigger` / `modeEnter` decls win over a fragment's (de-duplication keeps the kind's), so
     adding them is an edit to `standardVocab.ts` that every kind's vocabulary picks up.
   - **After Phase 2 (mock):**
     - Only a `book` host deals the overlay. `lines` / `ways` hosts were not cheap: the lines mock
       has no seam, and it has a cascade path. A Hold and Win game with an overlay is dealt as its
       own game without pots. Each needs the same six hooks.
     - A Hold and Win bonus's progressive tiers stay at their seed on an overlay host: no growth
       per bet and no `jackpotLevels`.
     - The book mock still accepts a second base `play` in a round (its old laxness). The overlay
       refuses one only after its own feature has ended.
   - `pnpm --filter game-config typecheck` already exits 2 on `main` (10 errors: fixtures that import
     `node:*` without Node types). The new fixture adds 4 of the same kind. It is not a gate, and
     `check:all` runs every fixture.

## Phase 8 checklist (partner wire)

- **Retriggers:** the facade closes free spins at the next bonus's entry. If the partner's wire
  announces a retrigger with an `enterBonus` (it has no `retrigger` event), that would end the free
  spins early; check their retrigger shape before switching.

## Owner checklist

1. **Confirm or change the defaults** in the design's §7, especially #5 (import vs live link) and #4
   (host feature and pot bonus in one round). Open items 2 (a) and (b) are answered.
2. **Phase 6 — make the sample** (a session cannot sign in to the launcher). Once #1017 is merged
   and the launcher and test server have redeployed:
   1. Game Maker → **Book of Borut** card → **Duplicate**: key `borut-pots-sample`, scope **setup**.
      Never add the overlay to the live `bookofborutremake`.
   2. On the new `borut-pots-sample` card → **＋ Pots overlay…** → preset **3 Pots** → **Add**
      (leave "Also add the overlay steps to the Flow" unticked: the coded defaults play). Read the
      report: config added, symbols and overlay screens seeded.
   3. `/config` (project `borut-pots-sample`) → **Add-ons** → the **green** pot → bonus mode
      **`freeSpins`** → Save. The preset routes all three pots to Hold and Win; this makes green start
      Borut's own free spins (design §6) and is the first hands-on check that a pot's bonus is
      authorable.
   4. Game Maker → `borut-pots-sample` → **Publish**.
   5. Tell the hub (or any session): a session then plays it with `game-playtester` and
      [docs/playtest/borut-pots-sample.md](../playtest/borut-pots-sample.md).
3. **Phase 8:** ask the partner whether their RGS can deal per-player pots, drops on top of symbols,
   and a bonus routed by pot. The same partner conversation as Hold and Win Phase 10.

## Blocked (owner / external)

- **The partner's RGS** for production play (Phase 8). Authoring and mock play are not blocked.

## Recent changes

- 2026-10-03 — **0–5 pots, and visible tokens and coins** (session "3 pots overlay config", branch
  `claude/three-pots-overlay-config-nedyqc`). From an owner report on Book of Borut: the game did not
  show after adding 3 Pots; they wanted 0 to 5 pots; and no pot coins showed in Borut. Merged with
  Phase 6, whose coins-only rules, `coinsOnly` preset, zero-pot mock and profile chip are main's.
  - **Pot count:** `setOverlayPotCount(doc, n)` (game-config `addOns.ts`), plus `addPotsOverlay`'s
    optional `pots` argument, drives `/config`'s **How many** picker (0–5, also offered on add).
    - Raising the count adds pots at the end. Each takes the next free id of `OVERLAY_POT_IDS` (red,
      blue, green, gold, purple, the coded pots' named colours) and its own `POT_<ID>` token. A
      leftover `meterSpecial` token of that name is reused. It copies the last pot's size, drop weight
      and bonus. A Hold and Win pot takes the next special no pot or meter starts with: payer,
      collector, multiplier (the 3 Pots order), then mystery… With none left it starts with none.
    - Lowering it removes pots from the end, with their drop rows and bare tokens.
    - 0 is Phase 6's coins-only rule. It is allowed only when the block is the overlay's bonus and
      has a coin count trigger. A coin row is added if the table has none. "Most per spin" is raised
      to trigger + 2 when it could not reach the trigger, as the `coinsOnly` preset sets it. The
      picker disables 0 otherwise, and the last pot's × follows the same rule.
    - A count picked on add is what the coins-only refusal checks, so Coins only with 3 pots is
      allowed on a Hold and Win game.
    - A rename is reported only while the pot or token it names survives the count.
    - The coded pots keep a minimum spacing (`SYMBOL_SIZE * 0.95`), so more pots than columns spread
      past the board's edges instead of overlapping (a 3 Pots Hold and Win game with 5 overlay pots
      has 8). At five or fewer on a 5-reel board, the layout is unchanged.
    - The validator errors on more than `MAX_OVERLAY_POTS` (5). `+ pot` stops at 5.
    - Pinned by `addOns.fixture.ts` §6 and the `potsOverlay` fixture. `check:pots-overlay` §4 adds a
      count-0 route and a fifth-pot route.
  - **Placeholders for add-on symbols** (`apps/lines` `symbolPlaceholder.ts` + `SymbolPlaceholder.svelte`,
    drawn by `Symbol.svelte` when no art is bound). This is why the coins did not show in Borut: an
    overlay added in `/config` seeds no art, so its tokens and Hold and Win symbols had none. Tokens
    landed and flew invisibly, and the respin board showed bare value labels.
    - A pot token now draws a disc in its pot's colour with its name. A Hold and Win coin draws a gold
      disc under its value. A jackpot or special draws its own colour and tag, hidden under a value
      label. `BLANK` and every other artless symbol still draw nothing.
    - Bound art wins, including Phase 6's seeded placeholders.
    - The disc completes after a 400 ms hold, as a missing flipbook clip does. Otherwise a token's
      `coinLand` would end in the same flush and its flight would leave before the disc was seen.
    - `potColour` is shared with the coded pot and keyed off `OVERLAY_POT_IDS`, so a renamed `red_2`
      stays red. The Hold and Win role looks apply only to a config with a Hold and Win block.
    - `code-reviewer`: nothing blocking. Its four should-fixes and the nits are folded in above.
    - Pinned by `symbolPlaceholder.fixture.ts`. Verified on a real clock, local mocks, with the 3
      Pots config in effect: tokens, coins and specials visible; 5 pots in a row; a special-less fifth
      pot's Hold and Win played out; money exact.
  - **"The game is not showing up" — NOT reproduced.** The live game and launcher are outside this
    container's network policy, so Borut's live bundle could not be read. Every local variant booted
    and played (headless shell, `apps/lines` dev):
    - the lines reference flow (Book-of vocabulary), with 3 and with 5 pots;
    - the Book-of reference layout with every add-on screen merged;
    - the overlay mock;
    - the plain book mock (a server that deals no overlay).
    - Also ruled out:
      - the runtime release lagging: every phase's Runtime release run succeeded;
      - a test-server image missing a module;
      - Win Text without a `feature` section: `resolveWinText` defaults per field.
    - Open: the page's console errors, or network access to `games.invisiblewall.org` and
      `app.invisiblewall.org`. One lead: `/config`'s save gate refuses any doc with a validator error,
      so an add that produced one was never stored. That would also hide the add-on from the other
      tools.

- 2026-10-03 — **Hub: second wave merged** (session "3 pots overlay mechanic"). The owner said
  "merge when green"; the hub merged each PR once its independent `code-reviewer` should-fixes had
  landed and CI was green on the head.
  - **#1017 (Phase 6)** merged first, as a9a0aca. The hub review's five fixes landed in 19a7b20:
    - refuse while another session holds a lease on a target doc;
    - a re-run never revives a deleted screen or duplicates a Pot Meter;
    - only clean presets are offered, with readable errors;
    - corrupt or wrong-shaped docs are left byte-unchanged;
    - all of it is pinned in `check:pots-overlay-add-on`.
  - **#1019 (4b)** merged second, as 9247a0b, after merging main in. The review found no blocker;
    parity held (the Borut reference flow, same seed: the same 1,212-line flow trace, 2,030
    broadcasts and `flyTo` records as `main`). Its two should-fixes landed in 7a180a5:
    - a pot always drains, even when a flow owns the bonus entry without `drainPots` (the play seam
      plays the coded drain first; `holdAndWinTrigger` excluded, so no double drain);
    - one beat and one land sound per drop cell.
    The nits (shared `beat` helper, seat-scaled token head) went in too; the two per-reel timing
    points are on the human-eyes list in Open items.

- 2026-10-02 — **Phase 4b: the token flies as its own head, per-reel timing, overlay Flow actions
  (#1019).** Details under Decisions. Agent rule 7: built in this session on the
  `engine-pixi-svelte` patterns, reviewed by `code-reviewer`. `/config` gains "Tokens appear"
  (`docs/tools/game-config.md`). A project without the block is unchanged.
- 2026-10-03 — **Phase 6: the Game Maker add-on, coins only and the sample playbook (#1017).**
  "＋ Pots overlay" on a project card and on Create; coins-only overlays; the guide
  [add-pots-overlay](../guides/add-pots-overlay.md) and the playbook
  [borut-pots-sample](../playtest/borut-pots-sample.md). Rules under Decisions.
  - **Played end to end locally** (`game-playtester`, d9e7420, headless shell `--no-sandbox`, ~4 fps,
    local mocks only, no R2): a Borut-shaped book host plus `threePots` with green → `freeSpins`, plus
    a coins-only config. Drop over the host's own board; three pots fill; red → drain → Hold and Win
    with the payer (blue → collector); green → drain → the host's free spins (on a coded host; a flow
    that owns `freeSpinTrigger` snapped the pot, fixed in 4b #1019: the play seam drains it); 6 coins → Hold and Win with the six
    held, 5 → nothing; `pot:red,feature` → free spins then Hold and Win in one round with one
    `gameEnd`; pots persist across rounds and a reload; bad force specs refused. Every round idle,
    money exact, 0 exceptions. Parity: the same host without the block vs `main` — 13 RGS answers
    byte-identical (round id aside), 244-line flow trace identical, same balances.
  - **Left:** the owner makes and publishes `borut-pots-sample` (Owner checklist 2), then a session
    replays the playbook on its authoring mock with real art; human eyes on pop-in, flights and drain.

- 2026-10-02 — **Hub: first wave merged** (session "3 pots overlay mechanic").
  - Six phase sessions ran in parallel from #1008. Phases 2, 3, 4a, 5a, 5b, 5c and 5d each merged
    on the owner's instruction, every one green on CI.
  - The hub ran an independent `code-reviewer` pass on the two runtime PRs (#1012, #1015). Each
    found no change for non-overlay games:
    - #1012: 83 sessions and 15,391 events with 0 differences;
    - #1015: 649 records with 0 differences, besides unseeded book round ids.
  - Their should-fix findings landed before merge: #1012's in #1015; #1015's in #1015 itself.
  - #1015 also ran real-clock Borut parity: identical answers, flow trace, emitter set and balance.
  - The hub relayed the Phase 2 ↔ 3 wire and the shared `$lib/addOns.ts` helper between sessions,
    so nothing diverged.
  - The board, one-line state and Open items above are brought up to date after the parallel merges.

- 2026-10-02 — **Phase 5d: `/symbols`, `/win-text` and Localization read the add-ons** (session
  "Pots overlay Phase 5d — Symbols + Win Text", agent `invisible-symbols`). Tokens get rows, the
  three token states, a chip and `toMeter:<id>` flights. Win Text gets a Pots section, and
  Localization harvests it. A Hold and Win bonus on any kind gets the full coin sections. The
  symbols and Win Text guides were updated. Rules under Decisions. Its two follow-ups (tokens in the published defaults, `{meter}` for
  a pot with no special) were closed by 4a.
- 2026-10-02 — **Phase 5c: Flow vocabulary composition (#1014, merged).** A Book-of (or any) flow can
  now reference the pots overlay and Hold and Win vocabulary when the config carries the block,
  and still publishes. The editor's "＋ Add overlay steps" grafts the pot chain and the Hold and Win
  mode tab without touching authored nodes. Agent `invisible-flow`; guide `docs/tools/flow.md`
  updated by `docs-keeper`. Projects without a block are unchanged.
- 2026-10-02 — **Phase 5a: `/config` Add-ons (#1010).** The pure merge helpers `addPotsOverlay`,
  `addHoldAndWinBonus` and `removePotsOverlay` (`packages/game-config/src/addOns.ts`), with
  `addOns.fixture.ts`. The kind-independent Add-ons section in `/config` (`AddOnsSection.svelte`)
  adds, edits and removes the overlay, and adds a Hold and Win bonus. Capabilities take the config's
  presence flags, and the win model stays free when the block is the overlay's bonus. A project with
  neither block sees `/config` as before plus the Add-ons buttons. The decisions are recorded above
  (renames, refusals, remove). The runtime that draws the tokens is Phase 4 (#1015).
- 2026-10-02 — **Phase 4a: the runtime (#1015).** The token picture and the overlay layer, the drop
  beat, lift-off as a pot fills, meters through `resolveMeters` and the pot signals for overlay
  hosts, the drain on any meter-caused mode entry, and the two-bonus resume. 4b (the per-reel
  timing option, the token as the flight head) and the 5c flow action are under Open items.

- 2026-10-02 — **Phase 3: facade + event contract (#1012, merged).** `overlayDrop` and the mode-entry
  `cause` / `meters` in `engine-game`. The facade under a captured `potsOverlay`: pots seeded at boot
  for any kind, drops and pot meters translated, each bonus routed by its key, a pot's free spins
  marked `cause: 'meter'`, a second bonus in one round, and the resume point. The fixture
  `potsOverlay.fixture.ts` covers all of it on hand-built wire. Byte parity without the block. The
  contract is under Decisions; the Phase 4 follow-ups are under Open items. Agent:
  `engine-pixi-svelte` scope, reviewed by `code-reviewer`.
- 2026-10-02 — **Phase 2: the composed mock** (draft PR, session "Pots overlay Phase 2 — composed
  mock").
  - `withPotsOverlay` over the book mock: drops, per-session pots, and the three routes (Hold and
    Win with the coins held, the book's own free spins through `startFreeSpins`, a mode stub).
  - Host feature first, then the pot bonus, in one round. Forced beats on both routes
    (`play.context` and `…/force`).
  - The Hold and Win engine split out of its mock (`mock-holdandwin-engine.mjs`).
  - `potsOverlayMockInputs` in game-config; the launcher's book contract carries it (agent
    `launcher-studio`).
  - The wire section in `docs/reference/hold-and-win-wire.md`.
  - `pnpm check:pots-overlay` covers seeded rounds re-derived from the wire, each route,
    persistence, both on one spin, every forced beat, replay and resume, and the book's
    byte-parity digests. It is part of `check:rgs`.
  - `check:holdandwin`, `check:freespins`, `check:book-paytable` and the rest of `check:rgs` pass
    unchanged.
  - Surprise: the brief's "post-process each play" could not keep a round open that the host had
    closed, hence the seam (Decisions).
- 2026-10-02 — **Phase 5b: Scene Editor overlay screens (#1009).** The Scene Editor palette, its pickers
  and the Component Editor's pickers follow the config's add-on blocks. "Add missing screens" is
  capability-based, and a new **＋ Add overlay screens** merges only the Pots screen (pot ids from
  `resolveMeters`), plus the Jackpot bar and the `holdAndWin` mode screens for a Hold and Win bonus.
  Agent `invisible-components`, guides via `docs-keeper`. Details under Decisions.
  - **Left for later:** `sceneCues.ts` (the flow's game-driven signal list) still reads the kind
    only; that is Phase 5c's, along with the runtime registering pot signals (Phase 4). The
    new-project scaffold is Phase 6's.
- 2026-10-02 — **Phase 1: the contract (#1008).** The `potsOverlay` Game Config block with its
  normalizer, validator, `resolveMeters` and two presets (Phase 1a, agent `invisible-game-config`).
  The additive `kindCapabilities` with the new `pots` / `potsOverlay` capabilities (Phase 1b, agent
  `invisible-components`). The rules settled are under Decisions; the follow-ups are under Open
  items. No consumer reads the new block or flags yet, so nothing changes in any tool or game.
- 2026-10-02 — **Plan + hub (Phase 0).** Design `docs/design/pots-overlay.md` and this hub were
  written from three code surveys (runtime, tools, cross-project), with the file references above.
