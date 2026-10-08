# Bonus games (Hold and Win as its own game, coin overlay as an option) — status + session hub

> Design: [docs/design/bonus-games.md](../design/bonus-games.md) · Builds on:
> [status/hold-and-win](hold-and-win.md), [status/pots-overlay](pots-overlay.md) · Guide: _per phase_
> · Agents: per phase — see the design's build plan.

**One-line state:** Phases 1, 2, 3 and 5b are merged: normalized docs carry the split form plus a
legacy compat mirror, the mock plays one Hold and Win engine per respin mode, and the facade reads
the rules per mode. Phase 5a (`/config` Bonus modes + Coin overlay) is in review as PR #1136. The
game still plays only `holdAndWin` until Phase 4.

## How sessions use this file (the hub)

**This file is the shared memory**, and the committed file wins over any message. The coordinating
("hub") session is the Claude Code session titled **"Hold and Wins as standalone project"**. It
starts the phase sessions, reviews their PRs and merges them.

- **Starting a phase:** read the design's §3 and this file, and claim your row in the Phase board.
- **Finishing (or stopping):** update your Phase board row and add a dated entry under "Recent
  changes" (what landed, the PR, what's left, any surprise). Then message the hub session
  (`SendMessage` / `send_message` to "Hold and Wins as standalone project").
- **Found something that changes the plan?** Add it to "Decisions & findings" and tell the hub.
- **Parity is the gate:**
  - `check:holdandwin` and `check:pots-overlay` digests don't move;
  - `check:all` is green;
  - the three Hold and Win samples and `borut-pots-sample` play unchanged.
- **Don't merge your own PR.** The hub reviews and merges.

## Phase board

| # | Phase | State | Owner session | PR |
|---|---|---|---|---|
| 0 | Plan + hub | merged | Hold and Wins as standalone project | #1131 |
| 1 | Contract: config split + migration | merged | Bonus games Phase 1 — config split + migration | #1133 |
| 2 | Mock: per-mode engines | merged | Bonus games Phase 2: Mock RGS, one Hold and Win engine per respin mode | #1138 |
| 3 | Facade + wire + event types | in review | Bonus games Phase 3: Facade, wire and event types, per mode | #1139 |
| 4 | Engine runtime: active-mode rules | in review | Bonus games Phase 4: the engine runtime plays the active respin mode | #1141 |
| 5a | `/config` Bonus modes + Coin overlay | in review | Bonus games Phase 5a — /config Bonus modes + Coin overlay | #1136 |
| 5b | Scene Editor + capabilities + `/symbols` | in review | Bonus games Phase 5b: capabilities, Scene Editor and /symbols, per mode | #1137 |
| 5c | Flow v2 vocabulary by board | in review | Bonus games Phase 5c: Flow v2 vocabulary by board | #1147 |
| 5d | Win Text + Localization per mode | in review | Bonus games Phase 5d: Win Text + Localization per mode | #1146 |
| 6 | Game Maker: template + Add a bonus mode… | in review | Bonus games Phase 6: Game Maker template + "Add a bonus mode…" | #1149 |
| 7 | Migrate and prove (samples, current-games) | not started (needs 6) | — | — |

## Decisions & findings

- 2026-10-08 — **The owner's model** (hub session): the coin overlay (classic / 3 Pots / Collector)
  is an option a base game turns on, and it only triggers. The bonus stage is a game of its own,
  and a project can have several bonus modes. A Hold and Win project is editable, duplicable and
  reskinnable, and any project can add it as a bonus mode. The owner confirmed design §6 4–6:
  the `coinOverlay` rename, retiring the `holdAndWin` kind (it stays as a template), and overlay +
  buy triggers only (no scatter → Hold and Win).
- 2026-10-08 — **Seams measured** against `main` 72f7a0c. The single-Hold-and-Win assumptions are
  listed in design "What is wrong today".

- 2026-10-08 — **Phase 1: how the split form and the legacy keys live together.** The Phase 1
  session proposed this and the hub approved it as option (A). The canonical rules are in design
  §2.1, "Transition (Phases 1–6)".
  - No equality test decides which side wins. Applying an unchanged mirror is a no-op, and a stale
    mirror always wins.
  - So a split-form writer must delete the legacy keys before it saves.
  - Hold and Win is removed only through `removeHoldAndWin(doc)`. `takeOutHoldAndWinBonus` uses
    it.
  - A Hold and Win mode stays on the respin board, whatever an override says (hub review of
    #1133).
  - Until Phase 5a, a respin mode without rules or strips is a warning, not an error. Phase 5a
    raises it to an error once `/config` can author them. The reason is that `prepareGameConfigDoc`
    refuses to save a doc with errors.
  - Base-game flags for a special that no respin mode configures are pruned on normalize.
  - An import brings the source mode's `blank`.
  - The mirror is dropped in Phase 7.
  - `bonusGames.fixture.ts` §4b and §4c pin this. About 80 files outside game-config read `doc.holdAndWin` /
    `doc.potsOverlay` directly. That includes the `.mjs` mocks and `test-server`, which read the
    stored JSON. So a normalized doc stores the split form (`coinOverlay`, and the declared
    `holdAndWin` mode with its `holdAndWin` rules) **and** both legacy keys as a compat mirror derived
    from it. The rule (`bonusGames.ts` header):
  - When the input carries a legacy key, the legacy pair wins for everything the mirror shows. That
    is the primary respin mode's rules, the pots, drops and timing, the routes to that mode and the
    base-game flags. Everything else in the split form is kept.
  - When the input carries neither key, the split form wins.
  - **What later phases must follow:**
    - A writer of the split form (5a, 6) deletes both legacy keys before it saves. Otherwise its
      edit is overwritten by the stale mirror.
    - The mirror shows one respin mode: `holdAndWin`, else the first respin mode with rules.
    - Drop the mirror in Phase 7, once no reader is left.
  - Inside game-config, the writers (`addOns`, `imports`) call `withLegacyPair` first and
    `syncBonusSplit` last, so their results are already normalize fixed points.
- 2026-10-08 — **Phase 1: `BuyTier.mode` is the BET mode** (`betModes` key), not the bonus mode it
  starts. In the split form a buy route is `{ betMode, mode, guaranteed, boostedSpecials }`. Every
  route's `mode` is the game mode it starts:
  - `count`: `{ min, roles, mode }`;
  - `pattern`: `{ mode, requirements }`;
  - `randomMetre`: `{ name, mode }`;
  - `luckySpin`: `{ mode }`;
  - a meter: `HoldAndWinMeter & { mode }`.
- 2026-10-08 — **Phase 1: two things derived rather than stored.**
  - "Coins land on the reels" is not a field. It is what the base strips deal, as
    `holdAndWinIsOverlayBonus` decides today, so it cannot disagree with the strips.
  - `coinOverlay.coins` (the base-game coin values) is sparse. Absent means the started respin
    mode's table, so the migration does not copy it.
  - `coinOverlay.style` is stored. A legacy doc gets an inferred style: `pots` with pots or
    meters, `collector` when a collector pattern starts it, else `classic`.
- 2026-10-08 — **Phase 1: what the later phases inherit.**
  - `builtinGameModes()` no longer takes a doc and no longer lists `holdAndWin`. Its three callers
    changed only their call: the Scene Editor suggestions add `holdAndWinModeDecl()`,
    `GameModesSection` and `stateModes`.
  - `resolveGameModes` still lists `holdAndWin` for an unnormalized legacy doc, by reading the
    block.
  - `/config` → Game modes now lists Hold and Win as a mode of the project's own, with a "Hold and
    Win" chip. Its fields stay editable, but its board is locked and it has no ×. It goes with its
    block. Phase 5a replaces this section.
  - A `respinBoard` mode without rules or strips is a **warning** in Phase 1. Before, an own respin
    mode added in Game modes was inert; Phase 5a raises it to an error.
  - Mode-level validation of a SECOND respin mode's rules is still owed. Only the mirrored primary
    goes through `validateHoldAndWin`; Phase 2 or 5a should run it per mode.

- 2026-10-08 — **Phase 5a: what the `/config` writer settled** (PR #1136).
  - **`/config` is a split-form writer.** The page holds `splitFormOf(doc)` and PUTs it, so neither
    legacy key is ever sent; its readers and validators see the mirror through
    `withLegacyPair(snapshot)`. The add-on helpers still return docs with the legacy pair, so the
    page runs `splitFormOf` on every result. Phase 6 writers should do the same.
  - **Removing a respin mode** is `removeRespinMode(doc, id)`. The primary still goes through
    `removeHoldAndWin`. `removeHoldAndWin` itself still leaves the pots that named the mode,
    because the overlay's removal takes them and an import replace re-declares the id.
    `removeRespinMode` re-routes them to free spins when free spins are on. Otherwise it removes
    them with their drops, and a note says so.
  - **Per-mode validation.** Every respin mode except the mirrored one runs through
    `validateHoldAndWin` on a view where it is the primary. Its issues are reported under
    `modes.<id>.holdAndWin.*`. The doc-wide issues (win model, paytables) stay with the primary's
    run. Two fixes in the legacy validators came with it:
    - `validateHoldAndWin` reads pot routes against the primary's id, not the literal `holdAndWin`;
    - a symbol tagged for a special that another respin mode configures is no longer reported as
      doing nothing.

    `validatePotsOverlay` lets a pot activate a special of any respin mode it starts. All three
    changes only relax errors.

  - **Severity** (superseded in part by the review round in "Recent changes": a non-primary respin
    mode nothing starts never errors). A respin mode without rules is an ERROR only when a route starts it, because
    Bonus modes fixes that in one click; an unstarted one stays a warning. "No strips" stays a
    warning: `/config` has no strip editor, so it cannot fix it. A project that saved before
    still saves.
  - **Ids.** `holdAndWin` keeps its id until Phase 4: the game, its screens and its Flow tab know
    it by that name. `holdAndWin` is also refused as a new id beside another primary, because it
    would take over the mirror. A renamed mode keeps its strips: its `gameType` is pinned to the
    old one.
  - **A new respin mode from a preset** brings its rules, respin strips and symbols (renamed on a
    clash). It adds no route and no base-game flag: the author routes it in Coin overlay.
  - **For Phase 2 (mock):**
    - `coinOverlay.coins` (the base-game coin values) can now be authored, but nothing reads it
      yet;
    - `holdAndWinMockInputs(doc).symbols` lists every respin mode's role symbols, because the
      dictionary is shared. Mode 1's entries are unchanged.
- 2026-10-08 — **Phase 5b: what the capability keys on** (hub decision on the 5b question).
  - `kindCapabilities().holdAndWin` (and so `coinSymbols`) is on when a declared respin mode has
    RULES (`board: 'respinBoard'` with a `holdAndWin` game, the predicate `primaryRespinMode` uses;
    hub review of #1137). A rule-less respin mode is inert and lights nothing, so a ways project's
    win model is never locked to lines by one, and every rule-bearing mode has a mirror, so Flow
    (which still reads the mirror) and the tools agree. A coin overlay alone does NOT turn on coin roles:
    a pots-only host's tokens carry no cash value, so every current doc stays byte-identical.
    **Follow-up:** widen it when an overlay deals valued coins without a respin mode.
  - The overlay's own parts (`potsOverlay`, the Pots screen) key on `overlayDropsTokens(coinOverlay)`
    (game-config). That is the predicate the legacy `potsOverlay` mirror uses, so the two cannot
    drift, and dropping the mirror in Phase 7 changes nothing. `bonusCapabilityInputs` now returns
    `potsOverlay` too. A classic Hold and Win project has a `coinOverlay` but drops nothing, so it
    gets no Pots screen.
  - A second respin mode's screens carry `-<modeId>` on their scene and node ids (children too),
    and the mode's label in brackets after the screen name. The `holdAndWin` mode keeps the
    reference ids. Each mode is laid out for its own `maxRows`, the base grid for the tallest.
  - **Phase 4 must-dos** (the runtime still keys these screens by plain id):
    - the coded banner beats (`HOLD_AND_WIN_BANNER_SCREENS`) must find the active mode's banner
      screen by `modeId` + role, not by id;
    - `RESERVED_SCENE_IDS` in `apps/lines/src/components/Game.svelte` lists `featureIntro`,
      `featureOutro`, `wheel` and `jackpotWin` by plain id, so the `-<modeId>` copies would mount
      as always-on overlays (the tap dim, a doubled jackpot banner) once a second mode plays.
      Reserve by base id with the suffix stripped, or by `role: 'mode'` + base id.
  - **For 5c:** `flowAddOnsOf` still reads the mirror. Move it onto `bonusCapabilityInputs` so Flow
    stops reading the mirror before Phase 7.
  - `/symbols` keeps coin-label jackpot text by tier name (no schema change). The Mode picker only
    chooses whose tiers are listed, so two modes sharing a tier name share its label.

- 2026-10-08 — **Phase 2: the wire emit rule and the "classic overlay over lines"** (hub-approved).
  - **Emit rule:** `bonusModes` and `mode` are sent only when the respin set is not the lone default,
    so every existing game is byte-identical. Phase 7 deletes the condition.
  - **Routing order for readers:** `context.mode`, else `bonuses[spinTrigger.bonus]`, else the
    primary.
  - **"The classic overlay composes over the lines mock"** is done by contract, not by wrapping
    `createLinesMock`. A `holdAndWin`-kind project now gets a `lines` contract carrying its base-game
    Hold and Win inputs, and is dealt on the Hold and Win engine, whose base game IS the lines
    evaluator plus the classic overlay. Truly composing it over `createLinesMock` would change the RNG
    streams and so every dealt board. That is deferred to Phase 7, and only if the owner wants it.
  - **Decided by the KIND until Phase 7** (hub review of #1138, ground rule 3): only a
    `holdAndWin`-kind project is dealt on the Hold and Win engine. Deciding it from the doc would
    re-deal a lines-kind game whose overlay coin is also on a base strip (dropping its pots and its
    lines fields). Phase 7 moves the decision onto the doc as a migration item.
  - **Limits on the game mock** (coins on the base reels):
    - base-game coins and specials are the primary mode's, whichever mode a route starts;
    - a route that two modes both claim goes to the first mode that has it;
    - jackpot tiers that share a name share one progressive pool, with the first mode's numbers (on
      the overlay too);
    - a full meter starts its own mode and consumes only that mode's meters, so a full meter of
      another mode waits until its symbol lands again;
    - dropped value coins are the coin mode's symbols, so they ride only that mode's feature.

- 2026-10-08 — **Phase 3: what the facade reads, for Phase 2 and Phase 4** (the hub's review of
  #1139). The facade follows the wire agreed with Phase 2 (`hold-and-win-wire.md` "Several respin
  modes").
  - **Routing.** In order:
    1. a named mode: a top-level `mode` on the six naming contexts, or `spinTrigger.trigger.mode`
       when it names a respin mode (a free spins' `scatter` names nothing);
    2. else the overlay's `bonuses[spinTrigger.bonus]`;
    3. else the primary, the first `bonusModes` entry.

    A named mode holds for the untagged events inside its feature and **ends at its
    `holdAndWinEnd`**. The closing `playedBonusSpins` doesn't reopen it, and the rest of the round
    is the primary's (on an overlay host, nobody's until the next bonus).
  - **Fails closed.** A respin feature of a mode the boot declares no rules for is not shown at
    all, neither under another mode's rules nor as free spins. That covers a named uncaptured mode
    and an overlay route to one. It is warned once per `sid:mode`. Its overlay events (the pot
    emptying) and the round's close still translate.
  - **A `bonusModes` with every entry refused** falls back to the legacy `holdAndWin`.
  - **Book events.** All four carry the resolved mode, `holdAndWin` for a legacy game. `mode` stays
    optional on `respinReveal` / `holdAndWinState` in `engine-game` and in the Flow vocabulary
    ("absent ⇒ `holdAndWin`"), so hand-built books stay valid. The facade always sends it.
  - **Progressive pools are shared by tier name**, as the mock deals them. A `jackpotLevels` (in a
    round or on the heartbeat) moves the tier of that name in every captured mode.
    **Open for Phase 7:** per-mode progressive pools would need `mode` on `jackpotLevels`.
    `meterLevels` per round is fine as it is.
  - **Boot globals stay primary-only.** The boot meters and pools published to the game still come
    from the legacy (primary) block. Per-mode display is Phase 4's.
  - **For Phase 4.** The runtime should key the board on the mode on top of the stack; every board
    event names it.

- 2026-10-08 — **Phase 4: what the runtime reads, and the play setting** (hub-approved; for 5c, 5d
  and 6).
  - **One accessor.** The runtime reads a respin mode's rules only through `activeRespinMode()`
    (`apps/lines` `activeRespinMode.svelte.ts`). It returns the respin mode nearest the top of the
    mode stack, else the PRIMARY. Its data is game-config `respinModeRules(doc)`: each respin mode's
    rules (in the legacy block's shape), strip key, blank and play setting, the primary first.
    - The primary's rules ARE the legacy mirror object, and the lone default keeps the game-wide
      blank (`holdAndWinBlankSymbol`), so a game with one respin mode reads exactly what it read.
    - The decisions are pure (`respinModes.ts`) and gated by `pnpm check:respin-modes`.
  - **The board** is rebuilt whenever the active mode differs from the one it was built for, even at
    the same size. It rolls `paddingReels[<the mode's game type>]`. Only the PRIMARY's final board is
    settled onto the base reels at the end, because only its coins land there (Phase 2's limit).
  - **Boot-time sources cover every mode.** `jackpot.<tier>` registers each tier name once across
    all modes; `letter.<reel>.lit` registers up to the most letters any mode has; `rowsOpen` /
    `rowsMax` register when any mode expands. A tier's worth is the active mode's, else the first
    mode that has it. Pools stay shared by tier name.
  - **Meters.** `resolveMeters` now lists every respin mode's symbol meters under its own mode
    (`bonus.mode`), the primary's first. It used to list the primary's only, with a hard-coded
    `holdAndWin`. This widens every consumer (`/symbols` defaults, Flow add-ons, `symbolUse`) on a
    two-mode doc only; a one-mode doc's list is unchanged.
  - **Screens.** The banner beats and `RESERVED_SCENE_IDS` find a mode's own copy by `role: 'mode'`
    + `modeId` + its base id (the id without `-<modeId>`). The `holdAndWin` mode's copies keep the
    reference ids.
  - **Resume.** Nothing new was needed. The snapshot already keeps `holdAndWinTrigger` (with its
    `mode`), so `restoreModes` puts the mode on the stack before the `holdAndWinState` replay.
  - **The `mode` pin.** `respinReveal` / `holdAndWinState` without a `mode` get `holdAndWin` at the
    play seam's record step, so a flow never reads `undefined`.
  - **Play setting.** `GameModeDecl.holdAndWin.play?: 'auto' | 'manual'`. It lives in the rules, so
    it splits, mirrors and imports with the mode. Absent means `auto`, which is today's behaviour.
    - **Measured first:** today's Hold and Win plays with no player input. The intro and outro are
      timed banners, and a tap only slams. Free spins also play their spins with no input, but their
      flowed intro and outro hold on a tap.
    - The hub confirmed the setting (owner's words: "advance on their own"):
      - intro and outro stay timed in both settings;
      - `manual` parks before EACH `respinReveal` of that mode, on the free-spin hold (`armSpinHold`),
        including the first after the intro and the first after a resume;
      - it never parks under autoplay or space-hold (`isContinuousBet`, as `holdAfterBigWin`).
    - It hangs off a new optional `createPlayBook` seam, `holdBeforeEvent`, on every dispatch path. An
      event that does not hold costs not even a microtask.
    - **For 5a (follow-up):** the `/config` control is not built.
  - **For 5c:** the Flow vocabulary should key on `board: 'respinBoard'`. Its actions already target
    the active board, because the presentation reads `activeRespinMode()`.
  - **For 5d:** the Win Text lines (`featureIntroText`, jackpot, wheel) are still one family for
    every mode.

- 2026-10-08 — **Phase 5d: Win Text per mode** (hub-approved contract, review of #1146).
  - **Shape.** `WinTextDoc.modes[<id>]` holds every respin mode but the primary, keyed by its plain
    id (not Phase 4's `-<modeId>` screen naming). The primary's lines are the top-level families, so
    a one-mode doc never carries the key. A mode's line falls back to the primary's field by field.
  - **The primary moves, the lines don't.** If `holdAndWin` is removed, or with no `holdAndWin` the
    first respin mode changes, a former `modes.<id>` becomes the primary: it now speaks the
    top-level lines, and its old entry is saved and shipped but never read. A renamed mode strands
    `modes[<old>]` the same way. `/win-text` lists such entries ("Lines for a mode that no longer
    exists") with **Move to…** (swaps with that mode's lines, the primary's families included) and
    **Remove**. `/config` makes no cross-doc write.
  - **Round-trip.** A save keeps what a newer build wrote inside a mode's lines (fields inside a
    family, and whole families), as for the top-level families.
  - **Follow-up (Director):** `director/ops/wintext.ts`'s `PATH` regex cannot address
    `modes.<id>.<family>.<field>`, so Director's Win Text adapter cannot write a non-primary mode's
    lines yet.
  - **For 6:** an imported mode's `play` travels with its rules. Re-sync carries it.
  - **For 6: screen naming.** The runtime finds a respin mode's screens as `<reference id>-<modeId>`
    (5b's seeding). The importer's own `-2` / `-3` copy naming (`projectBonusImport.ts` `freeIn`)
    does not follow that, so "Add a bonus mode…" must name the copies `-<modeId>`.
  - **A one-mode project whose primary is not the default** (another id, or another strip) changes
    in two ways. It now takes its blank from `respinModeBlank` (the mock's pick for that set). Its
    symbol meters' `bonus.mode` is the primary's id instead of the hard-coded `holdAndWin`. Every
    current game's primary is the default, so none of them changes.
  - **Hub review of #1141** (no blockers; folded into the same push):
    - the `-<modeId>` scene reservation covers RESPIN modes only (`respinModeById`), so a current
      game's `betMenu-freeSpins` still mounts;
    - Manual never parks while autoplay runs, including its LAST round. The counter is decremented
      after the round, so the guard is `autoSpinsCounter > 0 || isSpaceHold`, not `isContinuousBet`.
      `holdAfterBigWin` is unchanged;
    - while a Manual respin is parked, a tap anywhere (or Space) releases it (`Game.svelte`, a
      `PressToContinue` on `stateRespinPark.parked`), so a HUD without a spin button strands nobody;
    - **memo:** `resolveMeters` costs about 0.26 ms a call through `bonusSplitOf`. Its runtime
      callers read it through a per-config memo instead (`configuredMeters`; the flow reader now uses
      it). `respinModeBlocks` itself is NOT memoised per doc: `/config` mutates its live doc deeply
      in place, so a doc-keyed WeakMap would serve stale meters there;
    - meter ids two modes share resolve to one pot, the first mode's.

- 2026-10-08 — **Phase 5c: how "keyed on the board" reads in Flow** (for 6 and 7).
  - **The vocabulary stays one per doc.** A respin feature event never reaches a non-respin tab (a
    signal goes to the on-screen mode's tab, then Global), so that tab's palette hides them and the
    validator WARNS. It does not refuse: an error would refuse a stored flow that published before.
  - A tab is a respin tab when its id is one of the add-ons' `respinModes`, or `holdAndWin` (the
    Hold and Win kind's own, which resolves even without a saved config).
  - **For 6:** a new mode's Flow tab is `graftAddOnSteps(doc, flowAddOnsOf(config))` after the
    config is saved. Its screens must exist as `<reference id>-<modeId>` scenes (5b's seeding); the
    importer's `-2` naming would leave them `container-scene-missing` warnings.
  - **For 7:** `FlowAddOns.respinModes` is emitted only off the lone default (like the wire's emit
    rule). Phase 7 can always emit it.

- 2026-10-08 — **Phase 6: what "Add a bonus mode…" settled** (for the hub and Phase 7).
  - **Two import paths, told apart by the record.** "Add a bonus mode…" adds a respin mode through
    `importRespinMode` (game-config `imports.ts`), which works on the split form only and returns no
    legacy keys. Its `imports` record carries `asMode: true`, and `resyncBonus` sends such a record back
    through `importRespinMode`. A record without the marker (today's "Import a bonus…" of the primary
    `holdAndWin`) re-syncs through `importBonus` exactly as before. The old replace path is no longer
    offered in the UI ("an added mode never replaces one"). The API keeps `replace` for those old
    re-syncs and the old gate.
  - **Ids.** A clash takes `_2`, `_3`… on the id's base, so a copy of `holdAndWin_2` becomes
    `holdAndWin_3`, not `holdAndWin_2_2`. `respinModeIdProblem` still refuses `holdAndWin` beside
    another primary. The strip key is `respinGameTypeFor(id)`, made free when taken. A re-sync keeps
    the id, the game type, the label and the HUD the host gave it.
  - **Routes are the author's pick.** They are the host's pots, overlay triggers (count / pattern /
    Lucky Spin / random metre), meters, and a buy tier on any buy-bonus bet mode (a new buy route
    creates a minimal `coinOverlay` on a host that has none). Never scatters. A pot taken over starts
    the mode plain, as the old import did. A meter whose special the mode lacks is refused.
  - **A mode that would be the host's only Hold and Win needs a route.** The primary keeps today's
    "Nothing can start the feature" error (5a). So the importer refuses up front with a clear reason
    rather than failing the save. A second mode may wait unstarted (a warning, as 5a set).
  - **What travels:**
    - the rules whole, `play` included, with `blank` renamed;
    - the strips cycled to the host's reels;
    - the strip symbols (and the blank), each renamed on a clash and stripped of `meterSpecial`. They
      are never shared with the host, as the old Hold and Win import did it.
  - **Screens** are copied as `<reference id>-<newModeId>` on scene AND node ids
    (`respinModeCopyId`: the source mode's `-<sourceMode>` suffix stripped, then `modeScreenId`). The
    `holdAndWin` mode keeps the plain ids. `freeIn` is only a fallback on a real clash. A reels import
    keeps today's naming.
  - **The Flow tab** is the source's tab, rehomed (`mergeImportedModeFlow`):
    - every node id gets a free `hw`/`hw2`/… prefix;
    - show/hide refs follow the layout merge's screen renames, and missing containers are declared at
      the source's z;
    - a container event pin (`<componentId>.on…`) follows its node's rename;
    - mode triggers / enter / exit name the new mode.

    With no source tab, the starter (`holdAndWinModeGraph`) is seeded only when the host has no tab
    for the mode (`seedModeFlow`). A re-sync replaces the tab from the source, as today's import
    replaces its section.
  - **Win Text** uses 5d's merge unchanged: `modes[<newId>]`, or the families when the new mode is the
    host's primary.
  - **Template.** `scaffoldProject` saves `splitFormOf(seed)`. `normalize` of it is byte-identical to
    the old stored config for all three presets, mirror included. The engine-layout scene template
    (`templates/holdAndWin.ts`) needed no change: it lists screens, not config.
  - **"＋ Coin overlay…"** (hub-approved as proposed; no new Collector preset, since that is new
    math (ground rule 4). The hub is asking the owner whether they want one as a follow-up):
    - Style **Classic** → the Coins only preset;
    - **3 Pots** → 3 Pots or Pots to free spins;
    - **Collector** → listed with no preset, because a collector lands on the base reels and the add-on
      never edits a game's strips.

    The add-on saves `splitFormOf(added.doc)`, which normalizes byte-identically on every host and
    preset (gated). The card still keys "parts…" on the overlay dropping tokens (the
    `potsOverlay` mirror), as before.
  - **Only routes the mock deals are offered (hub decision on #1149: never save a route that
    silently won't play).** One helper, game-config `modeRouteRefusal(doc, route, hostKind)`, is read
    by both `importRespinMode` and the dialog (`modeRouteOptions`).
    - **A Hold and Win KIND** deals every route.
    - **Any other kind** composes the overlay over its own mock (`withPotsOverlay`), which starts a
      respin mode only from a full pot, or from the count trigger when the overlay drops value coins.
      A buy, pattern, Lucky Spin, random-metre or meter route there is refused: "route a pot to it —
      buy and trigger routes on a lines game arrive in Phase 7".
    - **A plain lines host with no overlay** can't take its first Hold and Win (it needs a route),
      and the refusal says "Add a coin overlay with pots first". After "＋ Coin overlay… → 3 Pots" it
      takes it on a pot route. `check:add-bonus-mode` §3 pins both.
  - **Phase 7 must-do:** lift the `modeRouteRefusal` guard (and its gate cases) when the deal
    decision moves from the kind onto the doc, so a lines game deals buy and trigger routes to a
    respin mode. Until then, the pot route into a Book-of host with a second respin mode is what
    plays (gate §1). The sample host playing two Hold and Win bonuses stays Phase 7's proof.

## Recent changes

- 2026-10-08 — **Phase 6: Game Maker template + "Add a bonus mode…"** (PR #1149, `game-config`
  `imports.ts` / `bonusImports.ts`, launcher `projectBonusImport.ts`, `projectScaffold.ts`,
  `projectAddOn.ts`, `/game-maker`, `/api/game-maker/import`).
  - **What landed:**
    - The Hold and Win template writes the split form (a lines base game, a coin overlay, and one
      `holdAndWin` mode with the preset's rules).
    - **Add a bonus mode…** is on every card. It copies any respin mode with rules of a same-client
      project as a NEW mode (`_2` on a clash), with its rules (`play` included), strips, symbols, art,
      `-<mode>` screens, Flow tab and Win Text, routed to the pots, triggers, meters or buy tiers the
      author ticks.
    - Re-sync updates that mode alone.
    - **＋ Coin overlay…** replaces "＋ Pots overlay…", with a style picker.
    - Guides: `docs/tools/game-maker.md`, `docs/guides/add-pots-overlay.md` and
      `docs/tools/game-config.md` (docs-keeper).
  - **Gates:**
    - new `pnpm --filter launcher-api check:add-bonus-mode`, over the real import, scaffold, add-on and
      stores on an in-memory R2:
      - `hw-classic-sample` (set to Manual) into a 3 Pots Book-of host that has `holdAndWin` becomes
        `holdAndWin_2`, with its rules and `play`, renamed symbols and art, `featureIntro-holdAndWin_2`…
        screens, a rehomed Flow tab that publishes clean with no new warning, Win Text under
        `modes.holdAndWin_2`, pot `green` routed to it, and nothing else of the host moved;
      - a re-sync after a source edit moves only `holdAndWin_2`;
      - a plain lines host with no overlay refuses a buy route (its mock would not deal it before
        Phase 7) and refuses no route ("add a coin overlay with pots first"); after "＋ Coin overlay…
        → 3 Pots" it takes the mode on a pot route;
      - a second unstarted mode saves;
      - template and add-on parity.

      Mutations that turn it red: no `-<mode>` screen naming (2), Flow mode triggers not rehomed (1),
      the re-sync not dispatched on `asMode` (1), the route guard off (4).
    - `imports.fixture.ts` §9.
    - `check:holdandwin` 1892/0 + 428/0 and `check:pots-overlay` 112/0, both with `MAIN_DIGESTS`
      unchanged;
    - `check:freespins` and `check:respin-modes` 141/0 pass;
    - `check:bonus-import`, `check:pots-overlay-add-on`, `check:flow-bonus-modes` 88, `check:win-text-bonus-modes` 73,
      `check:bonus-modes-tools` 82, `check:config-bonus-modes`, `check:mock-contract`,
      `check:game-config-defaults`, `check:symbols-kind-gating`, `check:flow-publish-gate` and
      `check:launcher-gates` pass;
    - `check:all` 419/419 (plus the new gate, which it now discovers), `check:svelte` launcher-api
      is at its baseline of 48, and lint is clean on the touched files.
  - **Not run here:** the live samples need R2 and the browser playtester. CI's Current games renders
    them. No current game's stored config changes: the template affects new projects only, and the
    add-on's and import's old paths normalize byte-identically.

- 2026-10-08 — **Phase 5c: the Flow v2 vocabulary keyed on the board** (PR #1147,
  `game-config`, `engine-flow-v2`, `/flow-v2`).
  - **What landed:**
    - `flowAddOnsOf` reads the split form (`bonusCapabilityInputs` + the new `respinModeIds`, on
      `respinModeDecls`: the one "respin modes with rules, primary first" list that
      `respinModeBlocks` and the launcher's `respinModesOf` now build on too), so
      Flow no longer reads the legacy mirror. It adds `respinModes` (the primary first) only when the
      set is not the lone `holdAndWin`, so every current doc's add-ons are byte-identical.
    - `graftAddOnSteps` ("＋ Add overlay steps") seeds a Hold and Win starter section for EVERY
      respin mode the flow has no tab for. `holdAndWinModeGraph(prefix, modeId)` names its Mode
      triggers for that mode and shows that mode's `-<modeId>` screens (`modeScreenId`); the prefixes
      (`hw`, `hw2`, …) keep node ids unique, and missing containers are declared at the reference z.
    - Tabs by board: a respin mode's tab (`isRespinTab`) is offered and accepts the whole vocabulary.
      Any other mode tab's palette leaves out the events that fire only inside a respin feature
      (`vocabForTab`; `jackpotWin`, `holdAndWinTrigger` and `holdAndWinWheel` stay, since they can
      arrive outside it), and one
      handled there is a new `respin-event-off-board` WARNING (`respinTabIssues`, added by the editor
      and the publish gate). A warning, so nothing that published before is refused.
    - The `mode` field descriptions of `respinReveal` and `holdAndWinState` read "absent ⇒ the
      primary respin mode" (editor text only). They are the one difference in a current doc's
      vocabulary.
    - **Runtime:** nothing to change. The interpreter hands a signal to `stateModes.active()`'s
      section, the Hold and Win beats read `activeRespinMode()`, and the banners and reserved
      screens find the active mode's copy (Phase 4). The gate pins the mode-2 graph running while
      mode 2 is on the stack.
  - **Gates:** new `pnpm --filter launcher-api check:flow-bonus-modes` (88 checks): a lines doc with two
    respin modes (both tabs seeded, distinct node ids, per-mode screens that are all in the scene set,
    publishes clean and warning free, idempotent graft); the runtime predicates per mode; tabs by
    board; a second mode on the `holdAndWin` kind; and byte-identical add-ons, grafted seed and
    publish verdict to `main` for 12 current docs (`MAIN_DIGESTS`). Their vocabulary is
    byte-identical except the two reworded descriptions: the gate pins the new wording on exactly
    those two fields and hashes them as `main` words them. `check:bonus-modes-tools`' "before" baseline now reads the legacy
    keys directly, since `flowAddOnsOf` no longer does.
  - **What's left:** nothing for 5c. Phase 6's "Add a bonus mode…" gets the new mode's Flow tab from
    the graft (or seeds it itself with `holdAndWinModeGraph(prefix, modeId)`).

- 2026-10-08 — **Phase 5d: Win Text and Localization per respin mode** (PR #1146, `engine-layout`
  `winText.ts`, launcher `winTextStorage.ts` / `/win-text` / `localizationHarvest.ts` /
  `projectBonusImport.ts`, `apps/lines` `holdAndWin` text).
  - **The shape.** `WinTextDoc.modes?: Record<modeId, WinTextModeLines>` holds every respin mode but
    the PRIMARY: its `jackpots` (captions + banners), `respins`, `wheel` and the feature's frame
    (`WIN_TEXT_MODE_FEATURE_FIELDS`: total, intro, outro). The primary's lines stay the top-level
    families, so a one-mode doc never carries the key: no migration, the stored JSON unchanged.
    The pot lines and the special / collector / pot names stay game-wide (they are the overlay's).
  - **Fallback.** `resolveWinTextForMode(doc, mode)` puts a mode's own lines over the primary's
    resolved ones, field by field; `undefined` is the primary (`resolveWinText`).
  - **Runtime.** `holdAndWinText.ts` reads the counter, jackpot, wheel and total/intro/outro lines
    through `bakedWinTextFor(<active mode>)` (`activeRespinMode()`, the primary as `undefined`). The
    doc ships verbatim through both bundle paths, so `modes` travels export → bake → pull with no new
    step.
  - **`/win-text`.** With several respin modes an "Editing" picker chooses the mode; tiers and the
    wheel come from that mode's rules (`winTextRespinModes`, `respinModeBlocks` → `decl.holdAndWin`,
    never the mirror). A non-primary mode edits only its total / intro / outro feature lines.
  - **Localization.** `harvestProjectWinText` (shared by every harvest caller) keeps the "Win text"
    section and adds `Win text — <mode>` (`__winText:<mode>`) per other mode, listing what the player
    reads there, inherited lines included.
  - **Import.** As the target's primary: today's family replace. As another respin mode:
    `mergeImportedModeWinText` writes `modes[<mode>]` from `spokenModeLines(source, sourceMode)` and
    replaces no family. That branch is unreachable until Phase 6 can import a second respin mode.
  - **Hub review (one push):** a /win-text panel re-homes the lines of a mode that no longer exists;
    a save keeps a newer build's fields inside `modes[<id>]`; the page reads a mode's lines by own
    key only (`constructor` is a valid mode id); Localization names a mode's section by its label;
    an import copies only the receiving mode's tier captions.
  - **Gates:** new `check:win-text-bonus-modes` (73 checks, mutation-tested). It runs the real
    `saveWinTextDoc` over an in-memory R2, the runtime bundle's `winText` step (`shippedWinText`),
    and the game's own selection sliced from `apps/lines` (`modeWinText`, `isPrimaryRespinMode`,
    `bakedWinTextFor`). `check:bonus-import` gained the per-mode merge case.

- 2026-10-08 — **Phase 4: the engine runtime plays the active respin mode** (PR #1141, `apps/lines`,
  `engine-game` `playBook.ts`, game-config).
  - **What landed:** every single-config read moved onto `activeRespinMode()`:
    - the respin board (its strip, blank, rows and expansion), rebuilt per mode;
    - the letters, the jackpots and the wheel;
    - `Game.svelte`'s value sources and component gating;
    - the coded banner screens, and the reserved `-<modeId>` scene copies.
  - **Also:** the `mode` pin default; per-mode meters and jackpot tiers; the `play` setting with Manual
    parking on SPIN.
  - **Gates:**
    - New `pnpm check:respin-modes` (`scripts/check-respin-modes-runtime.mts`, run by `check:all`). It plays Phase 2's REAL
      two-mode mock through the REAL facade and walks every round through the mode stack as the play
      seam moves it:
      - red pot → mode 1 and green pot → mode 2, each on its own rules, strip, blank, rows,
        stickiness, jackpots, counter and screens, and the board built once per feature;
      - both pots in one round;
      - a resume mid mode 2;
      - Automatic vs Manual on both modes: parks before every Manual respin, never under autoplay or
        space-hold, never at the intro or outro;
      - parity for the three presets, the test fixtures and a 3 Pots host.

      Mutations caught: the stack ignored (21 checks fail), no rebuild per mode (1), screens by
      plain id (3), no autoplay guard (3).
    - Its §6 drives the REAL play seam: `createPlayBook` + `createModeController`, with
      `holdBeforeRespin` / `ensureBoard` / `respinStrip` sliced from source, on the coded and flow
      branches and through a resume. 141/0. Mutations that turn it red:
      - dropping `holdBeforeEvent: holdBeforeRespin`: 1 check fails;
      - the hold after the presentation: 2 (flow branch) and 2 (coded branch);
      - `ensureBoard` without `sameRespinBoard`: 2;
      - `respinStrip` reading `paddingReels.respin`: 4;
      - the `isContinuousBet` guard: 2.
    - `bonusGames.fixture.ts` §8 pins `play` and `respinModeRules`.
    - `check:respin-modes` 141/0, and `bonusGames.fixture.ts` passes;
    - `check:holdandwin` 1892/0 and `check:pots-overlay` 112/0, both with `MAIN_DIGESTS` unchanged;
    - `check:bonus-modes`, `check:engine-game` 11/11, `check:resume` and `check:freespins` pass;
    - `check:all` 413/413, `check:svelte` at baseline, and lint and prettier are clean on the
      changed files;
    - **local current-games**, main vs branch on the stand-ins `cg-hw-pots`, `cg-hw-classic` and
      `cg-bookof-pots`: 3 pass, 0 changed screens (Hold and Win, jackpot, pots and free-spins
      scenarios included);
    - three source-text gates were updated to the new reads: `check:signal-scope`,
      `check:unused-symbols-in-game` and `verify-win-explode-pop`.
    - **Not run here:** the live samples (`hw-*-sample`, `borut-pots-sample`) need R2 and the browser
      playtester, and this cloud session has neither. CI's Current games renders them.
  - **Item 7 and the 5a follow-up** (after #1136 merged):
    - `validateBonusModes` no longer warns that a route to a non-`holdAndWin` respin mode is not
      played. `/config` drops the "played today" / "not played yet" chips, and `removeRespinMode` no
      longer asks to rename the last mode to `holdAndWin`.
    - `holdAndWin` still keeps its id (`renameRespinMode`), now because its screens and Flow tab
      know it by that id.
    - **Play picker:** Bonus modes → rules → Respins → **Play: Automatic / Manual**. It writes
      `play: 'manual'` only, and choosing Automatic deletes the key (`pageDoc.ts` `setRespinPlay`).
      `check:config-bonus-modes` pins it through a save and a reload, and `bonusModes.fixture` follows
      the dropped note.

- 2026-10-08 — **Phase 5a: the hub's review round** (PR #1136).
  - **A respin mode other than `holdAndWin` is said to be unplayed by the game.** Until Phase 4
    the game plays only `holdAndWin` (the mock and the facade play every mode since Phases 2/3). So a route to
    another respin mode saves with a WARNING: in the game, a full pot or trigger there ends with no
    win. **Phase 4 removes this
    warning** (`validateBonusModes`). The "played today" chip keys on `holdAndWin`, and every other
    respin mode's card says "not played yet". Removing `holdAndWin` while another respin mode is left
    adds a note: rename that one to `holdAndWin`.
  - **The base-game coin values panel is hidden** until a reader exists. The field stays in the
    schema. A stored `coinOverlay.coins` jackpot row must name a tier of some respin mode (an
    error), and renaming a tier in Bonus modes carries those rows along. **Open for Phase 7:** wire
    `coinOverlay.coins` into the mirror and the mock.
  - **Adding a mode never blocks a save.** Every issue of a non-primary respin mode that nothing
    starts is a warning, and its trigger issue reads "route a trigger or a pot to `<id>` in Coin
    overlay". It shows on the mode's card. The primary keeps today's errors. Empty rules start with
    one cash coin.
  - **The page's own shaping is gated.** `config/pageDoc.ts` (`openDoc`, `bodyFor`, `adoptSaved`)
    is what the page and `check:config-bonus-modes` both call. The control saves the stale doc
    through `saveGameConfigDoc` and shows the edit lost.
  - **Nits:**
    - the unrelated hint reflows are reverted;
    - `respinModeIdProblem` reads the primary from `doc.modes`;
    - the Symbols table's coin values come from every respin mode;
    - the guide points re-tagging at the Scene Editor and Flow.

- 2026-10-08 — **Phase 5a: `/config` Bonus modes + Coin overlay, and a split-form writer** (PR
  #1136).
  - **Coin overlay** (`CoinOverlaySection.svelte`, the former Add-ons section; its UI label is
    now "Coin overlay") edits:
    - the style;
    - the pots and drops;
    - the base-game coin values and special flags;
    - the triggers and the meters, each with a "starts →" picker over the respin modes. Pots list
      every bonus mode, free spins included.
  - **Bonus modes** (`BonusModesSection.svelte`) lists every bonus mode with what starts it. Each
    respin mode has its own rules editor (`HoldAndWinRules.svelte`, the old section pointed at
    `modes[i].holdAndWin`). A respin mode is added from a preset (Classic, 3 Pots or Collector) or
    empty, and is renamed and removed there. Game modes keeps the respin modes' presentation fields
    only.
  - **`game-config`:**
    - `splitFormOf`;
    - `addRespinMode` / `renameRespinMode` / `removeRespinMode` and the respin-mode id rules
      (`src/bonusModes.ts`);
    - `retargetRoutes`;
    - per-mode validation.
  - **Gates:**
    - new `bonusModes.fixture.ts` and launcher `check:config-bonus-modes`. The gate runs the real
      save/load over an in-memory R2. Its control shows that an edit beside a stale mirror would be
      lost.
    - `check:holdandwin`: 1892/0, `MAIN_DIGESTS` unchanged.
    - `check:pots-overlay`: 112/0, `MAIN_DIGESTS` unchanged.
    - `check:freespins` passes.
    - The launcher's `check:bonus-import`, `check:pots-overlay-add-on`, `check:mock-contract`,
      `check:game-config-defaults`, `check:symbols-kind-gating`, `check:flow-publish-gate` and
      `check:launcher-gates` pass.
    - `check:svelte` stays at the launcher-api baseline (48), and lint is clean.
    - `check:all`: 412/412.
  - **Done-when, as pinned by the gate:**
    - a lines project adds a Coin overlay and two respin modes with different presets, routes pot
      A → mode 1 and pot B → mode 2, and saves and reloads intact;
    - an edit to mode 2 survives a save and a reload;
    - the three Hold and Win samples and `borut-pots-sample` open, save and reload with no diff;
    - the stored JSON still carries mode 1's legacy mirror.
  - The flow was also clicked through in a throwaway browser harness that mounts the three
    sections, with no console errors.
  - **What's left:** a click-through on a real local launcher with the mock (needs Postgres and
    R2, which the build session lacked). Findings are under "Decisions & findings".
- 2026-10-08 — **Phase 5b: capabilities, Scene Editor and `/symbols` per mode** (PR #1137).
  - **Capabilities.** `projectAddOns` reads `bonusCapabilityInputs`: the respin feature is a
    declared respin mode with rules, and the pots overlay is `overlayDropsTokens` (the new
    game-config helper the mirror uses too). The `holdAndWin` kind resolves as before.
  - **Scene Editor.** `SceneSetOptions.respinModes` (from `respinModesOf` / `sceneSetOptionsFor`)
    seeds the reference respin screens once per respin mode, tagged `modeId`. Each mode is laid
    out for its own `maxRows`, and the base grid reserves the tallest. The `holdAndWin` kind adds
    only its other modes' screens.
  - **`/symbols`.** Coin-label jackpot tiers come from the respin mode being edited (the primary
    first), with a **Mode** picker when there are several. Role chips follow the capability.
  - **Guides:** `docs/tools/invisible-editor.md` and `docs/tools/symbols-state-machine.md`. Design
    §2.4 is corrected to the hub's decision.
  - **Gates:**
    - The new `check:bonus-modes-tools` (82 checks) covers:
      - a lines doc with two respin modes: both screen sets with distinct `modeId`s, no duplicate
        scene or node ids, per-mode `maxRows`, the capability on, per-mode tiers;
      - a second mode on the `holdAndWin` kind (its own mode keeps its own layout);
      - a rule-less respin mode on lines and ways: inert, main's add-ons, capabilities and screens;
      - every doc without a second mode (the presets, an expanding Hold and Win, lines + overlays,
        `borut-pots-sample`): byte-identical add-ons, scene sets and tiers, and the same add-ons
        with the legacy keys stripped.
    - `check:flow-publish-gate`, `check:symbols-kind-gating`, `check:pots-overlay-add-on`,
      `check:bonus-import` and `bonusGames.fixture` (its §6 now pins `potsOverlay`) pass.
    - `check:all` 411/411. `check:holdandwin` 1892/0 and `check:pots-overlay` 112/0, both with
      `MAIN_DIGESTS` unchanged (byte-identical to main). `check:svelte` is at baseline, and lint,
      prettier and `check:undefined-names` are clean.
  - **What's left:** the Phase 4 must-dos and the 5c `flowAddOnsOf` move (Decisions & findings).
    5d covers Win Text and Localization tiers per mode.

- 2026-10-08 — **Phase 3: the hub's review round** (PR #1139).
  - **Blocking 1:** `spinTrigger.trigger.mode` names the mode. The fixture's proxy writes the
    agreed shape and pins the case where only the trigger names it.
  - **Should-fix 2:** an uncaptured named mode, or an overlay route to one, fails closed and warns
    once.
  - **Should-fix 3:** a `bonusModes` with every entry refused falls back to the legacy block.
  - **Should-fix 4:** the mode ends at `holdAndWinEnd`. Pools apply to every captured mode with
    that tier.
  - **Should-fix 5:** the fixture now plays a mode-B resume (`round.event` and the mode on its
    snapshot), and a coin overlay over a lines host whose pot starts B, both tagged and by the
    overlay route alone.
  - **Nits:** `readHoldAndWinConfig` is no longer exported. The Flow pin says "absent ⇒
    `holdAndWin`". The routing helpers (`respinModesOf`, `applyPools`) moved to `holdAndWin.ts` to
    be pinned directly.
  - **Gates:**
    - `check:holdandwin`: 1892/0, digests unchanged;
    - `bonusModes.fixture.ts`: 428/0 after merging Phase 2. It now also plays Phase 2's REAL
      two-mode mock with no proxy: red pot → `holdAndWin`, green pot → `holdAndWin_2`, and both in
      one round. Mutations that drop the `trigger.mode` read or the fail-closed path fail 11 and 4
      checks;
    - `check:bonus-modes` passes;
    - `check:pots-overlay`: 112/0, digests unchanged;
    - `check:engine-game` 11/11, `check:resume`, `check:freespins` and `check:all` 412/412 all
      pass.
- 2026-10-08 — **Phase 3: the facade reads respin rules per mode** (PR #1139, packages
  `rgs-translator-eagaming` and `engine-game`, plus the Flow v2 vocabulary that mirrors the types).
  - **Boot capture.** The facade captures `config.bonusModes` per mode (`readHoldAndWinModes`, the
    first entry is the primary). A boot without it reads the legacy `holdAndWin` block as mode
    `holdAndWin`.
  - **Routing and events.** Each Hold and Win event translates under its own mode's rules, and the
    four book events carry the resolved mode. The overlay's `bonusRoutes` now returns
    `{ respins: mode } | 'reels'`. `expansion.maxRows` and `blank` are read per mode. The runtime
    is unchanged (Phase 4).
  - **Cross-checked against Phase 2's real mock** (`bonus-games-phase2` merged in a scratch
    worktree), on its two-mode lines host:
    - red pot → `holdAndWin`;
    - green pot → `holdAndWin_2`;
    - both pots in one round, played in turn.

    Each round is translated with its own mode and rules, and every snapshot is rebuilt.

- 2026-10-08 — **Phase 2: the mock has one Hold and Win engine per respin mode** (PR #1138, scripts,
  `test-server`, game-config's mock inputs, the launcher's mock protocol).
  - **Inputs:** `holdAndWinMockInputs(doc).modes` lists each respin mode, primary first, as
    `{ mode, gameType, block, blank, symbols }`. `block` is the mode's rules joined with its routes.
    `symbols` are the role symbols on its own strip (the primary's on the base strip too), so two
    modes' coins never mix. The field is absent for the lone default mode.
  - **Engine** (`mock-holdandwin-engine.mjs`): `mode`, `bonus` (the strip key), `blank` and `wire`
    options replace the hard-coded `mode: 'holdAndWin'` and `RESPIN_BONUS`. `setRouter` lets the
    base engine start another mode's engine on the dealt board.
  - **Game mock** (`createRespinEngines`): the primary deals the base game with every mode's routes
    on its trigger. Count, pattern, Lucky Spin, random metre, a buy tier and a meter each start the
    mode that owns the route. Respins dispatch by `round.feature.mode`.
  - **Overlay** (`mock-pots-overlay.mjs`): one engine per mode. Each pot starts its own mode, and
    the coins start the first mode with a count route. `bonuses` maps each strip key to its mode. A
    round plays each respin mode at most once, in turn.
  - **Wire:** `bonusModes` and `mode` on six contexts, under the emit rule (design §2.2, wire
    reference "Several respin modes").
  - **Protocol:** `protocolFor('holdAndWin')` is gone (`mockProtocol.ts`, `current-games/lib/plan.mjs`).
    - A `holdAndWin`-KIND project's lines contract carries its Hold and Win inputs, and the test
      server deals it on the Hold and Win engine. Every other kind keeps main's contract exactly.
    - A stored `protocol: 'holdAndWin'` entry reads as `lines`, so it fingerprints as the live
      contract: no mock rebuild or "config changed" on each refresh. The game card no longer calls
      it a drift. Malformed Hold and Win inputs on a lines contract are still reported.
  - **Validator:** `validateBonusModes` refuses two respin modes on one strip key, and so does the
    mock.
  - **Gates:**
    - New `check:bonus-modes` (in `check:rgs`, and the current-games `holdAndWin` / `bookOf` gates)
      runs the two-mode host on the book and lines mocks: each pot deals its own mode's rules on its
      own symbols, every context is tagged, and a respin of mode 2 resent mid-feature is replayed
      and resumes. It also covers the lone default (no new keys), a lone non-default mode, a buy
      route and a meter route to a second mode, one strip key shared, and, on the real test server,
      a stored `holdAndWin` stamp vs the live `lines` contract and malformed inputs.
    - `check:holdandwin` (1892/0) and `check:pots-overlay` (112/0): `MAIN_DIGESTS` unchanged.
    - A seeded comparison against main on the real test server: the three Hold and Win samples (on
      the stored `holdAndWin` path AND the new `lines` path) and `borut-pots-sample` (book and lines
      hosts) deal byte-identical answers. Their mock inputs are byte-identical.
    - `check:mock-contract` is extended: the `lines` protocol, per-mode inputs, a lines-kind game
      with base-strip coins keeps main's contract, and a block-less `holdAndWin` kind keeps main's
      board. `check:freespins`,
      `check:bonus-import`, `check:pots-overlay-add-on`, `check:game-config-defaults`,
      `check:symbols-kind-gating`, lint and `check:undefined-names` all pass.


- 2026-10-08 — **Phase 1: the hub's review fixes** (PR #1133).
  - **Blocking 1:** a `reels` / `none` override of the Hold and Win mode no longer drops its block.
    The mode is forced onto the respin board, and Game modes takes a new entry's board from the
    resolved mode.
  - **Blocking 2:** a respin mode without rules or strips is a warning, not an error.
  - **Should-fix 3:** the Hold and Win row has a locked board and no ×.
  - **Should-fix 4:** there is one `removeHoldAndWin` helper.
  - **Nits:** orphan base-game flags are pruned; an import brings the source's `blank`; the
    expanding-symbol pin strips only the `holdAndWin` mode.
  - Pinned in `bonusGames.fixture.ts` §5 and §7.
- 2026-10-08 — **Phase 1: the config split and migration** (PR #1133, `packages/game-config` plus
  fixtures). No consumer outside game-config reads the split yet.
  - **New modules:**
    - `holdAndWinGame.ts`: `HoldAndWinGame`, the respin half with no base-game flags and an
      optional `blank`, plus a lossless `splitHoldAndWin` / `joinHoldAndWin`.
    - `coinOverlay.ts`: `CoinOverlay`, which holds style, pots, drops, timing, base-game `coins`,
      `baseGame` flags, `trigger` routes and `meters`, each route naming its mode.
    - `bonusGames.ts`:
      - `normalizeBonusGames` (the migration plus the mirror);
      - the compat accessors `legacyHoldAndWin` / `legacyPotsOverlay`, plus `withLegacyPair`,
        `syncBonusSplit` and `bonusSplitOf`;
      - `resolveBonusModes`, `bonusCapabilityInputs` and `respinModeBlank`;
      - `validateBonusModes`.
  - `GameModeDecl.holdAndWin` carries a respin mode's rules. `builtinGameModes` no longer invents
    `holdAndWin`.
  - `holdAndWinBonusFrom` now uses the split instead of stripping the flags by hand.
  - The mock inputs, `resolveMeters`, the add-ons, the import and the presets read the legacy
    blocks through the accessors.
  - The committed `holdAndWin.<preset>.json` defaults were regenerated. The change is additions
    only: the legacy blocks are byte-identical.
  - **Gates:**
    - The new `bonusGames.fixture.ts` proves legacy ≡ split (the doc, the mirror byte for byte,
      both mock inputs, modes, meters, bonus modes and issues) for the three presets
      (`hw-*-sample`), the five test fixtures, the three overlay presets on a book host,
      `borut-pots-sample`, a 3 Pots game with pots, and an imported bonus. It also covers the
      compat rule, two respin modes and the validators.
    - `check:holdandwin`: 1892/0 facade checks, with the `MAIN_DIGESTS` unchanged.
    - `check:pots-overlay`: 112/0, plus its fixtures, with its `MAIN_DIGESTS` unchanged.
    - `check:freespins` passes.
    - `check:engine-game` and the launcher's `check:bonus-import`, `check:pots-overlay-add-on`,
      `check:mock-contract`, `check:flow-publish-gate`, `check:game-config-defaults` and
      `check:symbols-kind-gating` pass.
    - `check:all`: 409/409.
  - **What's left:** Phases 2, 3, 5a and 5b can start. See "Decisions & findings" for the rules
    they inherit.
- 2026-10-08 — Phase 0: design + hub written (hub session).
