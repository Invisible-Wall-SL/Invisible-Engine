# Pots overlay (add-on on any kind) — status + session hub

> Design: [docs/design/pots-overlay.md](../design/pots-overlay.md) · Builds on:
> [status/hold-and-win](hold-and-win.md) · Guide: _none yet (Phase 6)_ · Agents: per phase — see the
> design's build plan.

**One-line state:** Phases 0–3 merged: the `potsOverlay` Game Config block and the additive
`kindCapabilities` (#1008), the composed mock (#1013), and the facade plus the engine event contract
(#1012). The mock deals tokens and pots over the book game, and the facade routes each bonus of an
overlay host by its key. Nothing draws a token yet (Phase 4). A project without the block, which is
every project today, plays exactly as before. Next: Phases 4 and 5a–5d.

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
| 0 | Plan + hub | in review | 3 pots overlay mechanic | #1008 |
| 1 | Contract: `potsOverlay` config block + validator + presets + `resolveMeters` + additive `kindCapabilities` inputs | built, in review | 3 pots overlay mechanic | #1008 |
| 2 | Mock — composed protocol (`withPotsOverlay` over book, reusable H&W feature generator, free-spin hook, forced beats, wire doc, `check:pots-overlay`) | merged | Pots overlay Phase 2 — composed mock | #1013 |
| 3 | Facade + engine event contract (`overlayDrop`, mode-entry `cause`/`meters`, per-bonus routing, pots at boot for any kind) | merged | Pots overlay Phase 3 — facade + event contract | #1012 |
| 4 | Engine runtime (overlay layer, timing, lift-off flights, drain on any mode entry, H&W from an overlay host, resume) | not started (needs 3) | — | — |
| 5a | `/config` Add-ons section | not started (needs 1) | — | — |
| 5b | Scene Editor overlay screens + palette/pickers through the capability | merged | Pots overlay Phase 5b — Scene Editor overlay screens | #1009 |
| 5c | Flow vocabulary composition (editor, publish gate, runtime) + graft | built, in review | Pots overlay Phase 5c — Flow vocabulary composition | #1014 |
| 5d | `/symbols` + `/win-text` + Localization through the capability | not started (needs 1) | — | — |
| 6 | Game Maker add-on action + guides + playbook + `borut-pots-sample` played end to end | not started (needs 2–5) | — | — |
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
    (`FORCE_TRIGGER=1`) deals and drives the whole free-spin round exactly as `main` does. In this
    container neither branch's presentation reaches idle (swiftshader, remote art unreachable), so
    the visual pass is left to a real-clock playtest.
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

0. **Carried into Phase 4 (found in Phase 3):**
   - **Resume of a two-bonus round** cut off mid-respins: the snapshot before the resume point holds
     the free spins' `freeSpinTrigger` AND their `freeSpinEnd`. `createBonusSnapshot` replays the
     last `freeSpinTrigger` whatever follows it, so it would redraw the free-spin intro. Skip it
     when a later `freeSpinEnd` exists (the mode stack already restores correctly).
   - Record `overlayDrop` into a token picture at the play seam (`utils.ts` `recordBookEvent`),
     for the layer, lift-off and resume.
   - The drain on any mode entry reads `modeEntryMeters(entry)`.
   - Phase 2 must emit exactly the wire above. Anything that cannot work as specified goes to the
     hub, not into a silent change.

1. **Merge #1008** (Phases 0–1). Then **Phases 2, 3 and 5a–5d** can start in parallel. Each needs a
   session; see the Phase board.
2. **Carried into later phases (found in Phase 1):**
   - **Phase 4:** `Game.svelte` registers the feature signals, pots included, only when the config
     has a `holdAndWin` block (`featureComponentSignals`, `Game.svelte:1644`). On a pots-only host, an
     authored pot cue would be offered (`pots`) but never fire, so register the pot family under
     `potsOverlay` too. The runtime's `configuredMeters()` must read `resolveMeters`.
   - **Phase 4 (from 5c):** the overlay-only flow actions (show / lift tokens) are not in the
     vocabulary yet: they arrive with their runtime effects. Add them to the overlay fragment in
     `engine-flow-v2/src/reference/addOns.ts`, and give the graft their chain once a coded beat
     exists. Until then the graft adds no `overlayDrop` handler, because owning the event would
     suppress the coded default. The flow's `meter.<id>.*` reads already go through
     `resolveMeters` (`linesEngineReader`); the coded pots' `configuredMeters()` does not yet.
     Phase 3's mode-entry `cause` / `meters` fields are not in the Flow payloads yet: the kind's own
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
   - **Phase 5a:** a new pot row without its token or bonus is dropped on save (normalizer rule), so
     keep draft rows client-side until they are complete.
   - **Phase 5d:** tokens are off the strips, so `symbolsInPlay` leaves them out. `/symbols` and the
     published symbol defaults must add them through `resolveMeters`. `symbolStatesForKind` (pinned
     by `check-symbols-kind-gating.ts`) hides `coinLand` / `coinIdle` / `flyToMeter` from a pots-only
     host, but design §4 wants those states for the tokens. Gate them on `pots` there.
   - **Phase 5c (found in 5b):** `apps/launcher-api/src/lib/sceneCues.ts` still lists the game-driven
     signals with `engineSignalsForKind(gameType)`, without the add-ons. Once Phase 4 registers the
     pot family on an overlay host, pass the config there too.
   - **Phase 6 (found in 5b):** the new-project scaffold (`projectScaffold.ts:119`) calls
     `getFullSceneSet` without add-ons. Pass `SceneSetOptions` (see `$lib/addOns`) when the add-on
     seeds the overlay screens.
   - **Phase 6:** merging `holdAndWinBonus()` symbols into a host's dictionary can clash with the
     host's own names (a host that already has a `BONUS` or a `BLANK`). The add-on needs a rename
     map, or must refuse with a clear message.
   - `pnpm --filter game-config typecheck` already exits 2 on `main` (10 errors: fixtures that import
     `node:*` without Node types). The new fixture adds 4 of the same kind. It is not a gate, and
     `check:all` runs every fixture.

## Owner checklist

1. **Confirm or change the defaults** in the design's §7, especially #5 (import vs live link) and #4
   (host feature and pot bonus in one round).
2. **Phase 6:** duplicate Book of Borut as `borut-pots-sample` (Game Maker → Duplicate, setup
   scope), then publish it once Phase 6 lands. A session cannot sign in.
3. **Phase 8:** ask the partner whether their RGS can deal per-player pots, drops on top of symbols,
   and a bonus routed by pot. The same partner conversation as Hold and Win Phase 10.

## Blocked (owner / external)

- **The partner's RGS** for production play (Phase 8). Authoring and mock play are not blocked.

## Recent changes

- 2026-10-02 — **Phase 5c: Flow vocabulary composition (#1014, in review).** A Book-of (or any) flow can
  now reference the pots overlay and Hold and Win vocabulary when the config carries the block,
  and still publishes. The editor's "＋ Add overlay steps" grafts the pot chain and the Hold and Win
  mode tab without touching authored nodes. Agent `invisible-flow`; guide `docs/tools/flow.md`
  updated by `docs-keeper`. Projects without a block are unchanged.
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
