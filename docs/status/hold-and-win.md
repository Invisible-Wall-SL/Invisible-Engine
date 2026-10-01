# Hold and Win (game kind) — status + session hub

> Design: [docs/design/hold-and-win.md](../design/hold-and-win.md) · Guide: _none yet (per-tool
> guides get a Hold and Win section as each phase ships)_ · Agents: per phase — see the design's
> build plan.

**One-line state:** Phase 4 (engine runtime) build COMPLETE, all merged and live (2026-10-01,
`lines@e4bca6077db0`) — the shared runtime plays a whole Hold and Win feature with coded default
presentations for all three presets: coin value labels; a per-cell respin board with sticky coins and
a resetting counter; payer / multiplier (+ becomes-coin) / collector / mystery (+ unlock); persistent
pots seeded from boot that specials fly into; Lucky Spin; full-board and banked jackpots; the
feature-end count-up into the Total Win bar by coin flights; Grand's column letters and sweeps; a
base-game instant collect; Hotfire's collector streak and pre-feature wheel; and a resume that
rebuilds the board mid-feature. Phases 5–8 author on top of it (flow vocab, Scene Editor template,
Symbols SM, Win Text). Production is blocked on the partner's Hold and Win wire format; authoring is
not (mock-first).

## How sessions use this file (the hub)

This work spans many sessions. **This file is the shared memory. It is committed, so every session
and every teammate sees it.** The coordinating ("hub") session is the Claude Code desktop session
titled **"Hold and win game pipeline"**.

- **Starting a phase:** read the design doc's §6 build plan and this file. Take the next unclaimed
  phase and put your session title next to it in the Phase board below.
- **Finishing (or stopping):** update the Phase board row and add a dated entry to "Recent changes":
  what landed, the PR, what is left, and any surprise. If you are a Claude session, also send the
  hub session a short message so it can re-plan. Use `SendMessage` to the session titled "Hold and
  win game pipeline", or `list_sessions` to find it.
- **Found something that changes the plan** (a contract change, a blocker, a partner answer)? Add it
  to "Decisions & findings" and tell the hub.
- **The committed file wins over any message.** If they disagree, fix the file.

## Phase board

| # | Phase | State | Owner session | PR |
|---|---|---|---|---|
| 0 | Hub + plan | merged | Hold and win game pipeline | #900 |
| 1 | Kind plumbing + `kindCapabilities()` | merged | Hold and Win Phase 1: register the kind everywhere | #917 |
| 2 | Game Config `holdAndWin` block (full option space, 3 presets) | merged | Hold and Win Phase 2 — Game Config block | #919 |
| 3 | Mock RGS `holdAndWin` protocol + wire contract (swap seam) | merged | Hold and Win Phase 3 — mock RGS + wire | #924 |
| 4 | Engine runtime (RespinBoard, coin labels, events, facade, resume) | merged — build complete (follow-ups in Open items) | Hold and Win Phase 4 — engine runtime | 4a #928 · 4b #931 · 4c #934 · resume #938 · 4d #939 · flights #942 · 4e #943 · 4f #945 |
| 4M | Game modes: registry, mode stack + queue, per-mode flow graphs, resume | merged | Hold and Win Phase 4M — Game modes | #930, #933 |
| 5 | Flow vocabulary + driven seed | not started | — | — |
| 6 | Scene Editor template + components | not started | — | — |
| 7 | Symbols SM (coin roles/states, value label, kind gating) | not started | — | — |
| 8 | Win Text (jackpot + respin copy, gating) | in progress — part 1 (contract, /win-text sections, harvest) in review; part 2 (runtime reads the templates, see "Win Text literals for Phase 8") next | Hold and Win Phase 8 — Win Text | part 1: #946 |
| 9 | Game Maker presets + docs + playtest, sample games (3 Pots first) | not started | — | — |
| 10 | Partner wire (facade + mock brought in line) | blocked on partner | — | — |
| 11 | Beyond the references (expansion, add-respins/upgrade, platform jackpot) | not started | — | — |

## Current state

- **The research is recorded in the design doc.** §1 covers the mechanics and the three reference games, §2 what we carry, and §3 the partner protocol.
- **The upstream `apps/price` `superspin` sample is the only existing respin code.** It has sticky prize coins, a reset counter and a collect event. It is the reference for Phase 4, to be rebuilt on engine-game primitives rather than forked.

## What each kind resolves to (Phase 1, pinned by `check:flow-publish-gate` §4)

| Kind | Starter flow (`freshDrivenSeedDoc`) | Flow vocabulary (`templateVocabulary`) | Mock protocol → mock that deals it | `/flow` emitter vocab |
|---|---|---|---|---|
| `lines` | bookOf seed (`DRIVEN_SEED_FALLBACKS`) | bookOf (`VOCABULARY_FALLBACKS`) | `lines` → lines | lines |
| `ways` | ways seed | ways | `ways` → lines mock, ways evaluator | lines |
| `cluster` | cluster seed (since 2026-10-01; a project scaffolded before keeps its stored `bookOf` flow) | cluster | `cluster` | default |
| `scatter` | scatter seed (since 2026-10-01; same caveat) | scatter | `scatter` | default |
| `bookOf` | bookOf seed | bookOf | `book` | lines |
| `holdAndWin` | → `lines` → bookOf seed | → `lines` → bookOf | `holdAndWin` → **Hold and Win mock** (Phase 3); the lines mock, with a logged warning, only when the contract carries no `holdAndWin` block | lines |
| custom kind / absent | bookOf seed (`UNREGISTERED_TEMPLATE_FALLBACK`) | bookOf | `lines` | default |

Existing kinds resolve exactly as before Phase 1. `holdAndWin` follows `lines` by alias, so Phase 5
only has to register its own vocab + seed.

## Decisions & findings

- 2026-10-01 — **Phase 8 (Win Text): what the presentation must call.** The copy lives in
  `bakedWinText()` (`resolveWinText`); render with `formatWinText(template, vars)` and NEVER build the
  string first. Map of today's literals → templates (for these the defaults are byte-equal, so the swap is
  invisible; the six fields under "Authored but not drawn yet" are NEW copy):
  - `<tier> JACKPOT` → `jackpots.award` with `{ jackpot: jackpotCaption(r, tier) }`; its detail
    `amount` → `jackpots.awardDetail`, `FULL BOARD  ${amount}` → `jackpots.fullBoardDetail`; the coin
    banner title `tier` → `jackpots.coin`.
  - `RESPINS ${left}` (RespinCounter) → `respins.counter` `{ count }`; the modifiers line under it →
    `specialDisplayName` per kind (it uppercases ids today — same output for the four known kinds).
  - `LUCKY SPIN` → `feature.luckySpin`; 4f's `INSTANT WIN` → `feature.instantCollect`.
  - `<names> ACTIVE` → `feature.modifiersActive`, `UNLOCKED: <names>` →
    `feature.modifiersUnlocked`, with `{ modifiers: kinds.map((k) => specialDisplayName(r, k)).join(', ') }`
    (replaces `SPECIAL_NAMES` in `holdAndWinPresentation.ts`).
  - Authored but not drawn yet (a beat or Phase 6 screen may adopt them): `respins.award` / `reset` /
    `last`, `feature.total` / `intro` / `outro` / `meterFull` (`{meter}` = `specialDisplayName` of what
    the pot activates).
  - 4f's wheel / collector-level / pot labels have NO template yet (full list: "Win Text literals
    for Phase 8") — part 2 adds fields for them. Coin labels belong to Phase 7 (`bakedCoinLabel`).
  - **Jackpot tiers are the config's** (`holdAndWin.jackpots[].name`); the page lists one caption box
    per tier, and Localization lists each tier's caption (defaulting to the name) for a Hold and Win
    project only.

- 2026-10-01 — **Step 10: Grand + Hotfire.** Things a later phase must know:
  - **A swept column reaches the Total Win bar DURING the feature.** `presentColumnComplete` counts
    the column's `amount` into the bar as its coins land (shares by worth, `cellWorth` + `countSteps`,
    the last landing exact) and remembers it (`featureCountedIntoBar`); the end's tally takes it off
    `banked` and `total`, so the bar still ends on start + total once. A flow that owns
    `columnComplete` without the `lightLetter` effect leaves it at 0 and the end adds the whole
    banked part, as before.
  - **The letters row and the collector level are display copies**, like the held layer: the play
    seam has recorded a lit column and a raised collector before their beat. Letters copy
    `lettersLit` at the trigger and every snapshot and light on their own beat; the wheel pins the
    old collector level (`stateHoldAndWinShown`) until it has landed, or the counter would read
    "DOUBLE COLLECTOR" before the wheel spun (seen in the first Storybook run).
  - **Instant collect flies to the SPECIAL, not to the bar.** The bar belongs to the round's own
    `setWin` / `setTotalWin`, which follow and count the instant amount with the line wins; flying
    into the bar would count it twice. Each coin goes to its nearest special; the banner shows the
    multiplier and `times` when above 1.
  - **The wheel follows the free-spin intro's slam rule but is not unskippable:** re-armed before it
    (`startsCelebration`), a press while it turns lands it at once on the very rotation the spin was
    easing onto, and the landed segment and the prize banner each hold at least 700 ms on a bare
    timer. Its segments are the config's prizes when the config's prize at `segment` matches the
    server's; otherwise a one-segment wheel of the server's prize (it never lands on something not
    awarded). A jackpot prize gets no banner: the `jackpotWin {source: 'wheel'}` that follows
    celebrates.
  - **Contract fix: the wheel's prize position is `segment`, not `index`.** A book event's `index` is
    its ordinal in the book, and the facade builds every event as `{index: ordinal, ...fields}`, so a
    payload field named `index` overwrote it (4a's contract named it so). Renamed in the contract,
    the facade, the presentation and the recorded books, and in the `wheelSpin` / `wheelLand` cues
    (which carry the segment DRAWN). The facade fixture checks every event keeps its ordinal.
  - **New flight kind `toCollector`** (streak collect and instant collect); Phase 7's `flights` block
    should author it beside `toTotal` / `toMeter:<id>`.
  - **Value sources:** `collectorLevel`, `lettersLit` (value) and `letter.<reel>.lit` (visibility),
    the last two only for a `columnLetters` config.

- 2026-10-01 — **Steps 6–8: pots, Lucky Spin, full board + feature end.** Things a later phase must
  know:
  - **Boot meter levels travel through a facade global** (`__IE_HOLD_AND_WIN_METERS__`, written at
    `config` capture only for a wire-1 Hold and Win server that declares meters) and are seeded once
    as a `meterLevels` through the reducer, so `stateHoldAndWin` keeps one writer. Seeding stands
    down once any book event recorded meters (a resume's `meterLevels` wins).
  - **The reducer now empties the meters a `meter` trigger names** (`payload.meters`, "now 0" on the
    wire): the server's word, applied at the trigger instead of waiting for the play's
    `meterLevels`, so the pots read empty while the feature runs.
  - **A pot's drawn level is a display override**, like a coin label's: the play seam has recorded
    the server's level before the beat starts, so `meterUpdate` pins the pot at `level − from.length`
    and ticks it per `flightArrive`, then lets go on the server's level. A forced full meter
    (`forced: true`, the level set one short first) therefore jumps to `max − n` before ticking.
  - **`'meter:<id>'` is the pot's anchor, `'toMeter:<id>'` its flight kind**; Phase 6's authored pots
    must anchor the same names (a pot node with that id does it through `LayoutNodeView`), and bind
    `meter.<id>.level` / `meter.<id>.max`. Without an anchor the flight lands on the board's bottom
    centre and the level still ticks.
  - **The meter beat lights each special on the BASE board** (`win`, padded row = visible row + 1)
    while it flies; flight seats themselves take the visible row (`getSymbolSeat`'s lattice row).
    No avoidance: `meterUpdate` comes right after the reveal, before any win is shown.
  - **Lucky Spin = an explicit one-shot, not faked scatters.** The intro beat arms it; every
    `presentReveal` takes it; the dispatch seam reads it to run that reveal unskippable. The reels
    hold on every reel after the first at level 1 (the lowest big tier's alias); the anticipation
    OVERLAYS (spine stack, grey-out, camera) still need the project's `anticipationMode`, so a project
    without it sees long holds only. In the sample config each armed reel holds ~2 s, so a Lucky Spin
    reveal takes ~8 s — tune `reelPaddingMultiplierAnticipated` if that reads long.
  - **Celebrations without a screen.** `holdAndWinEnd` and a banked `jackpotWin` re-arm the slam
    (`startsCelebration`) and run inside the unskippable window, which is what locks the button for a
    coded celebration that mounts no `bigWin`/intro/outro screen. When Phase 6 authors them as
    screens, the screen lock takes over and the unskippable window stays harmless (no tap holds).
  - **The Total Win bar count-up starts from what the bar read** (the trigger spin's line wins, if
    any): it lands the coins' share exactly on `start + total − banked`, adds the banked part after a
    350 ms beat, and ends on `start + total` — the same figure `setTotalWin` then assigns, so nothing
    jumps. Coins land in flight order, not list order, so each arrival adds ITS amount
    (`tallyCountUp`, fixture-pinned for out-of-order arrivals and rounded per-coin amounts).
  - **The coded banner** (Lucky Spin, jackpots) is one at a time, English literals until Phase 8,
    centred on the board in the flights band above the flight layer.
  - **Storybook does mount the board** — the reference flow parks on its loading screen; completing
    it (`completeActiveScreen()` from `/src/game/flowInterpreterHolder.ts`) shows the reels, so the
    4c/4d "no board in Storybook" note was the loading screen, not a missing mount.

- 2026-10-01 — **Flights are built (step 9).** Things a later phase must know:
  - **A trail needs a STILL emitter parent plus `ownerPos`.** Moving the container (what every other
    mount does) carries the particles rigidly. Any `/fx` flight preview or authored trail must go
    through `<ParticleEmitter ownerPos>` / `<EffectPlayer ownerPos>` (free layers only).
  - **There was no "scene node registry".** A layout node's on-screen position is now resolved through
    `pixi-svelte` named anchors registered by the node mounts (id = the node id). Ids are per scene, so
    two mounted scenes with the same id resolve to the most recently mounted one that is visible.
  - **`'total'` = the `hud-win` anchor** (the reference win meter id, also registered by every win
    readout whatever its id). A game whose win meter is something else names its node id instead.
  - **The flight layer sits ABOVE the HUD** (8500) so a head lands on the meter; it would also draw
    over an un-pinned celebration overlay in the list band. Celebrations follow the volley today, so
    nothing overlaps; revisit if a beat flies during a celebration.
  - **The feature-end volley uses no avoidance**: every coin leaves at once, so there is nothing to
    bend around. The specials beats (pots, collectors) pass the win cells as `avoid`.
  - **Not built**: Phase 7's `flights` authoring block (head art, `/fx` trail, arrival effect, path
    style per kind), beams, a re-aimed target that moves mid-flight (the route is fixed at launch).
- 2026-10-01 — **Phase 4d: the specials and mystery beats.** Decisions a later phase must know:
  - **A count-up is a display override, never a write.** The play seam has already recorded the
    final value when a `coinPay` / `coinBoost` / `coinCollect` beat starts, so the beat pins each
    changed label at its OLD value (`stateRespinBoard.heldDisplay[key]`, a `Tween` per cell, set in
    the same tick as the held layer syncs) and lets go when the count ends; the label then reads the
    recorded value. `Symbol.svelte` takes the override as `labelOverride` and applies it to the label
    only, so a ticking label never re-resolves the art. The reducer stays the source of truth.
  - **The collect's per-coin moment is one function, `presentCollectStep`** (coin pulses, collector
    label rises by that coin's share). When `flyTo` ships (Phase 4 step 9) it replaces that
    function's body: the head flies coin → collector and the rise lands on `flightArrive`. The legs
    come from `countSteps` (engine-game `respinCount.ts`): proportional to each coin's `amount`, last
    leg exactly on the server's `value`.
  - **Terminal states hold.** `explosion` (a mystery opening) and `clearReel` (a streak's coin
    leaving) are not settled back to `static` on completion — that showed the old symbol for a
    frame — the sync that follows replaces or removes the cell.
  - **Symbol states used by the coded defaults:** `win` (payer, multiplier, collected coin, jackpot
    coin; held at least 400 ms so a sprite is seen), `land` (a multiplier becoming a coin, a revealed
    mystery), `explosion` (mystery opening), `clearReel` (streak clear). Phase 7 authors them.
  - **Toasts are English literals for now** ("UNLOCKED: PAYER", "MINI JACKPOT €15.00"), through
    `showMessage` like the free-spin award. Phase 8 (Win Text) owns their copy and localization.
  - **A `jackpotWin` with `banked: false` gets no toast**, only the coin highlight when
    `source: 'coin'` — its money is already in a tally cell or a collector.
- 2026-10-01 — **4c live check (#934, merged as `lines@28b09d57cd88`).** Borut parity held (14 base
  spins, a natural and a bought feature, every balance = the RGS, 0 exceptions). On
  `hw-3pots-sample` the respin board covers exactly the reel seats, held coins stay, only free cells
  roll, the counter reads the server's `left` after every `respinUpdate`, a slam compresses a 13-respin
  chain from ~20 s to 5.6 s with every coin landing, and every balance matches. Follow-ups (not
  regressions): the "RESPINS 3" counter shows ~0.7 s before the board swaps; a ~100–130 ms frame
  hitch at the start of every respin (probably the per-cell strip mount — profile); the base reels
  come back showing the trigger board and the big win plays over it.
- 2026-10-01 — **Resume did NOT reach the snapshot path, and why.** The Play4Fun facade plays the
  whole round (every respin + collect) within ~1.6 s of the bet, before anything is presented, so a
  plain reload finds the round closed. A round left OPEN (requests failed mid-feature) resumed by full
  replay (`round.event = '0'`), so the trigger played again and `holdAndWinState`'s rebuild was never
  used. Fixed in the facade: a mid-feature Hold and Win round now resumes at the end of what the
  server had stored (`holdAndWinResumePoint`), so the engine folds the trigger and the last snapshot
  into `createBonusSnapshot` and presents only the respins still to come. Other kinds keep `0`.
  What a snapshot resume does NOT carry, on purpose: the trigger spin's `reveal`/`winInfo` are
  folded away, so after the feature the reels come back on the boot board and that spin's line wins
  are not drawn (the money is right — `gameEnd`'s `setTotalWin` carries the full total); a
  `meterUpdate` from the trigger spin is not replayed (meter beats would re-present), but the server
  restates every meter in `meterLevels` after each `play`, and the snapshot keeps the last one. A
  feature that had already ended before the break resumes at 0 (the whole book plays again).
- 2026-10-01 — **Pre-existing, every flow-driven game: a resumed book starts playing BEHIND the
  loading screen.** `ResumeBet` broadcasts `resumeBet` on mount, and a flow-driven game mounts it
  under the flow's loading/tap-to-start screen, so a resumed feature runs (and can finish, big win
  included) before the player taps in. Seen on `hw-3pots-sample`; Borut's resume goes through the
  same path. Owner of the fix: the flow / game-modes area (gate `resumeBet` on the loading screen
  being dismissed).

- 2026-10-01 — **Flights: a moving /fx owner does NOT leave a trail today** (read-only measure for
  step 9; design §4.4 corrected). Every renderer — `/fx` preview, `SpineBoneAttach`, `RiggedEffect`,
  the symbol `fx` layer, launcher overlays — moves the emitter's container, so particles move
  rigidly. The library trails via `emitter.updateOwnerPos` on a still parent, which no game path
  calls. `flyTo` therefore adds an `ownerPos` getter to `pixi-svelte` `ParticleEmitter.svelte` (and
  fixes its leaked ticker callback); the coded default can use the unused
  `constants-shared/particleConfig/trail.ts` plus a generated glow texture. Any future `/fx` "flight"
  preview must use the same `updateOwnerPos` path, or it becomes a fourth hand-synced renderer.
  Stale comments describing the old behaviour: `apps/launcher-api/src/routes/(app)/fx/fxModel.client.ts`
  (:385, :408).

- 2026-10-01 — **Phase 4c: the respin board.** `engine-game` builds it: `respinBoard.ts` is pure and
  pinned by `fixtures/respinBoard.fixture.ts` (which cells spin and onto what, which cells a new
  picture releases, what each cell shows at mount); `respinBoard.svelte.ts` makes `reels × rows`
  one-cell `createReelForSpinning` reels, columns stopping left to right. `apps/lines` wires and draws
  it (`stateRespinBoard.svelte.ts`, `RespinBoard`/`RespinCell`/`RespinHeldSymbol`/`RespinCounter`).
  Decisions a later phase must know:
  - **One function per beat** (`holdAndWinPresentation.ts`), called by the coded handler AND by the
    flow effect of the same beat (`showRespinBoard`, `spinRespin`, `stickCoins`, `setRespinCounter`,
    `restoreRespinBoard`, `hideRespinBoard`). The cues (`respinBoardShow`/`Hide`/`Spin`,
    `respinCoinsLand`, `respinCounterUpdate`) are NOTIFICATIONS for authored sound/FX — broadcasting
    one does not move the board. Phase 5 wires the effects, not the cues.
  - **No beat records its event.** Since 4M (#933) the play seam (`createPlayBook`'s
    `recordBookEvent`) folds every Hold and Win event into `stateHoldAndWin` before any path presents
    it, so a flow-owned event reads the same picture and nothing is applied twice (the wheel's
    `extraCollect`, a banked `jackpotWin` and a cleared `columnComplete` are NOT idempotent). The
    unpresented events' handler is `syncHoldAndWin`: it only re-syncs the held layer.
  - **The held layer is a copy of the picture**, re-synced on every Hold and Win event while the board
    is up and kept through the end, so the final board stays on screen until the swap back. A cell
    that leaves it (a streak clear, a column sweep, a snapshot correcting the client) has its reel
    settled to the blank first.
  - **`respinReveal` re-arms the slam**, as `updateFreeSpin` does per free spin
    (`SPIN_REARM_BOOK_EVENTS`): a press lands the rolling respin, the next one rolls at full pace.
  - **A base `reveal` always takes the respin board down** (`presentReveal`), so a feature whose end
    never arrived (a respin refused mid-feature) cannot leave the next round's reels rolling unseen.
  - **Respin strips:** the config's `respin` strips, else the base game's. Blank = the symbol tagged
    `blank`, else `BLANK`; with no art bound it draws nothing.
  - **Coded counter** "RESPINS n" above the board; `respinsLeft` (value) and `respinCounterShow`
    (visibility) are registered so Phase 6's authored counter binds the same state.
  - **Not covered:** stepped grids (the board assumes every column has the board's row count);
    perspective boards seat the resting cell exactly but roll on the flat pitch.

- 2026-10-01 — **First published Hold and Win project: `hw-3pots-sample`** (Invisible_Wall, Pots
  preset; playbook [docs/playtest/hw-3pots-sample.md](../playtest/hw-3pots-sample.md)). **Trap:** a
  freshly scaffolded `holdAndWin` project has NO authored Game Config, so its mock contract carries
  no `holdAndWin` block and the test server deals it plain LINES (5 paylines, `PIC*`) even though the
  Game Maker card shows the Pots defaults. Saving the config once in `/config` (then Re-publish)
  fixed it; both mocks then report `protocol: "holdAndWin"`. Phase 9's config seeding should close
  this for good.

- 2026-10-01 — **Phase 4b: the facade maps the Hold and Win wire** (`packages/rgs-translator-eagaming/src/holdAndWin.ts`,
  the swap seam; gated on the boot config's `holdAndWin.wire === 1`, any other wire is refused with
  a console error and the feature is not shown). A Hold and Win server maps symbols by IDENTITY
  (`pickMappingForConfig`). Its feature is NOT free spins any more: `enterBonus` /
  `playedBonusSpin` become `holdAndWinState` (the facade computes `total` from the roles and the
  jackpot table, and takes `stickiness` from the config), each respin's `playedSpin` becomes
  `respinReveal` (every cell, visible coordinates), and `gameEnd` closes on `setWin` (big-win tier)
  + `setTotalWin` as in the base game. **Consequence until the RespinBoard ships (4c):** the respins
  play with nothing on screen moving — the base board stays, the state is recorded, and the round
  pays the right total at the end. No Hold and Win project is published, so no player sees it.
- 2026-10-01 — **Mock quirk (wire, not facade):** when a full board or the last letter ends the
  feature, that respin's `respinUpdate` reports a reset (`left` back to the start) while its closing
  `playedBonusSpin` snapshot says `left: 0`. The engine takes the snapshot. Harmless; fix in the
  mock + wire doc together if anyone needs the counter to read 0 on that beat.

- 2026-10-01 — **Phase 4a: the engine's Hold and Win event contract is code, not a table.** One home:
  `HoldAndWinEventFields` in `packages/engine-game/src/game/holdAndWin.ts`; `apps/lines`
  `typesBookEvent.ts` spells each arm out from it. Where it differs from the design's §4.3 sketch
  (the design table now points here): **positions are VISIBLE 0-based** (no padding row — the respin
  board has none; a base-board consumer adds it); a coin's value / jackpot label / factor ride on the
  cell's `RawSymbol` (`value`, `jackpot`, `factor`), so every event carries cells as
  `{reel, row, symbol}`; `holdAndWinTrigger` is `{mode: 'holdAndWin', cause, payload: {cells,
  respins, stickiness, activeModifiers, meters?}}` and `holdAndWinEnd` is `{mode: 'holdAndWin',
  total, payload: {cells, banked}}` — the §4.5 `modeEnter`/`modeExit` shape, so Phase 4M aliases
  them without a payload change; `cause` is `count|pattern|meter|luckySpin|randomMetre|buy` with the
  meter ids in `payload.meters`. Added beyond §4.3, because the wire carries them and the client
  must show them: `meterLevels` (the server restating every meter after each `play`),
  `randomMetreTrigger`, `cellsCleared`, and `holdAndWinState` (the server's whole picture of an open
  feature after every respin — the resume snapshot).
- 2026-10-01 — **Phase 4a: resume = the last `holdAndWinState` + the last `meterLevels`.** Kept by
  name in the engine's resume snapshot (`HOLD_AND_WIN_SNAPSHOT_EVENTS`, with `holdAndWinEnd`) and
  replayed by `createBonusSnapshot`, so a reload rebuilds the board from the server's picture without
  replaying the trigger's intro — unless a `holdAndWinEnd` follows that snapshot, when the feature
  stays closed. Meters are NOT part of a feature snapshot: they have their own events and survive it.
  The facade emits `holdAndWinState` from the wire's bonus snapshots (4b), computing `total` and
  taking `stickiness` from the boot config (the wire snapshot carries neither).
- 2026-10-01 — **Phase 4a: the client's picture is a pure reducer** (`applyHoldAndWinEvent`,
  pinned by `packages/engine-game/fixtures/holdAndWinState.fixture.ts` in `check:engine-game`), held
  in `apps/lines` `stateHoldAndWin`. Every Hold and Win handler records into it and presents nothing
  until its beat ships; the server's `holdAndWinState` replaces it wholesale after each respin, so a
  misread step self-corrects. `total` is never summed client-side.
- 2026-10-01 — **`flightArrive` is an emitter cue, not a book event** (`EmitterEventFlight` in
  `engine-game/src/game/flight.ts`, `{flight, target, index}`), in the `/flow` palette under
  "Flights". Nothing broadcasts it until `flyTo` ships.

- 2026-09-30 — **Phase 3: the wire is ours and documented as the swap seam**
  ([hold-and-win-wire.md](../reference/hold-and-win-wire.md)). The respin scaffolding is the
  partner's own model (`spinTrigger bonus: "respin"`, `enterBonus`, one context-less `play` per
  respin, `playedBonusSpin {played, left}`, `gameEnd`, `collect`); only the Hold and Win events are
  invented. Consequence worth knowing for Phase 4: the CURRENT facade already drives a whole round and
  settles the balance, so the engine work is presentation, not round plumbing.
- 2026-09-30 — **Phase 3: symbols travel in the project's OWN names** (`BONUS`, `BOOST`, …), not the
  lines `PIC*` vocabulary, and a value rides on its cell (`BONUS:1.5`, `JACKPOT:MINI*2`). Phase 4's
  facade needs an identity mapping for this protocol and a `parseCell` that reads a jackpot label.
- 2026-09-30 — **Phase 3 rules the design left open**, now fixed in the mock (change them in the wire
  doc + mock together): triggering specials do not stick (they activate their kind when
  `fromTriggeringSpecials`); payers/multipliers stay on the board inert after applying (they count
  for a full board and for column letters); a sticky-coins collector collects the cash coins once when
  it lands and keeps that value; a streak collector takes coins AND jackpot coins every respin; a
  mystery that reveals a coin counts as a new coin for the reset; the wheel's coin boost applies to the
  held coins and every later coin; all letters lit ends the feature; meters fill in the base game only.
- 2026-09-30 — **Phase 3: `jackpotWin` never adds money.** Banked jackpots (wheel, letters, full
  board) are in `holdAndWinEnd.banked`; every other `jackpotWin` is presentation of an amount already
  inside a tally cell, a collector, a column or an instant collect.
- 2026-09-30 — **Phase 3: a forced full meter says `forced: true`** on its `meterUpdate` — the force
  sets the level one short first, so the level is not the last one plus `from`.
- 2026-09-30 — **Phase 3: a `bet` over an open round opens a new round** (the partner's behaviour);
  the mock plays the abandoned feature out and credits it. Every batch is atomic (a refusal stores
  and charges nothing), fresh actions must go to the next free `seq`, and a played round's
  `play`/`collect` must carry its `gid` — found in review, pinned by the gate.
- 2026-09-30 — **Phase 3: forcing is an authoring tool.** On the test server a runtime game's PLAYER
  mock refuses forces; its authoring twin (`/api/<key>/authoring/force?…`) allows them. A playtest
  must boot through an authoring link to force a beat.
- 2026-09-30 — **Phase 3 pacing:** an empty respin cell lands something 6% of the time. At 10%, Grand
  (letters that sweep their column, so the board never fills) ran 25+ respin features.
- 2026-09-30 — **Owner: a bonus is a different game mode, and modes must queue.** A bonus-game signal can switch to a completely different mode, and two modes can be queued up to play one after another. Measured: nothing like this exists today. There is only `gameType` = `basegame | freegame`, a flat FlowDoc, strictly ordered book events, no feature queue, and a free-spin-only resume. Planned as design §4.5 / **Phase 4M**: a mode registry, a mode stack with a nest-or-queue policy, `modeEnter`/`modeExit` with the free-spin events as aliases, per-mode flow graphs shown as tabs, a scene role `mode`, and a mode-aware resume. It is a shared-runtime change, so parity is the gate.
- 2026-09-30 — **Flights (things that travel from a cell to a target, e.g. coins/specials into pots): one `flyTo` primitive, planned in design §4.4.** It computes a Bézier route at runtime that bends around the cells showing a win. The trail is an `/fx` emitter following the moving head (the moving-owner mechanism already exists for Rigger bones). A cue fires on arrival. Authoring is a `flights` block in the Symbols doc. Phase 4 builds the primitive, Phase 7 the authoring, Phase 5 the flow action.
- 2026-09-30 — **Phase 2: the config shape Phase 3 generates from** is `doc.holdAndWin`
  (`packages/game-config/src/holdAndWin.ts`; detail in [game-config.md](game-config.md)). Roles are
  `special_properties` values: `coin`, `jackpot`, `collector`, **`coinMultiplier`** (not
  `multiplier` — the lines mock contract already deals multiplier cells for that tag), `payer`,
  `mystery`, `meterSpecial`, `blank`. Specials never name their symbol; meters do. A cash coin
  draws as the `coin` symbol, a jackpot coin as the `jackpot` symbol (or the coin symbol if there is
  none). A buy tier's price is its bet mode's `cost`. Reel indices are 0-based. Every preset has a
  `respin` padding strip set (coins/specials/blank) beside `basegame`.
- 2026-09-30 — **Preset numbers the design doesn't give are placeholders**: line pays, every draw
  weight, the payer's and leave-behind coin's steps (2–10 as 2,3,…,10), the mystery table, Pots'
  `fromTriggeringSpecials: true`, and Hotfire's wheel coin boost (×2).
- 2026-09-30 — **Normalization drops half-typed entries on save** (a jackpot with no name, a meter
  with no symbol, letters with no word, a buy with no mode), consistent with the rest of the config.
  A reference to a dropped jackpot then shows as a validator error. Revisit if authors trip on it.

- 2026-09-30 — **Owner: one template makes all three reference games.** Grand, Super Hotfire Diamonds and 3 Pots of Egypt are presets of the same kind. Every option any of them uses is core scope (design §6).
- 2026-09-30 — **Owner: 3 Pots of Egypt is the first real game.** It sets the Phase 4 build order.
- 2026-09-30 — **Owner: build against our own mock now.** The partner delivers their wire later. The mock's wire is a documented **swap seam**, to be rewritten when their format arrives (Phase 10). Nothing above the facade may depend on it.
- 2026-09-30 — **Third reference, 3 Pots of Egypt** (user-supplied). It adds these to the design's option space: persistent per-player pot meters (server state), a feature entered with specific modifiers active, specials counting toward the trigger, a payer, a multiplier that becomes a coin, a mystery that unlocks modifiers, per-special value tables, apply order, a server-announced Lucky Spin, and decimal coin values. Game Maker gets a third preset, **Pots**.
- 2026-09-30 — **`holdAndWin` is a kind + a mechanic. It is not a new `winModel`.** The base game pays by `lines`.
- 2026-09-30 — **The feature runs on a dedicated per-cell `RespinBoard`.** The shared column-strip reel board is left untouched: rewriting it would put every live game at risk.
- 2026-09-30 — **Mock-first contract.** We define the engine book events (design §4.3) and the mock speaks an invented wire for them. The facade maps them. Only the facade changes when the partner confirms their format.
- 2026-09-30 — **The partner core has a generic respin but no Hold and Win data.** It has one `play` per respin and the `playedBonusSpin` counters. It has no coin values, sticky cells or collector. Its Mini/Minor/Major/Grand jackpot is the operator **platform** jackpot (`platform.jackpots[]`), not our fixed coin jackpots. That is out of scope for the first build.
- 2026-09-30 — **"Hide options per kind" needs one capability source (`kindCapabilities`).** Today only `/symbols` state columns, scene sets, the flow vocab and config-by-winModel gate at all.
- 2026-09-30 — **Trap to fix in Phase 1:** flow vocab and driven seed fall back to **bookOf** silently. Lines, cluster, scatter and custom kinds are all scaffolded with `templateId: 'bookOf'`.
- 2026-09-30 — **Phase 1: the kind list lives in `constants-shared/gameKinds.ts`**, not engine-layout or game-spec. That package is dependency-free and already imported by the launcher, engine-layout and engine-flow-v2, so nothing gains a package→app import. game-spec gained the dependency. `gen-flow-vocabulary.mjs` now imports it and runs under `node --experimental-strip-types`, which CI's Lint job now passes.
- 2026-09-30 — **Phase 1: cluster/scatter projects never reach their own flow vocabularies.** Their starter flow is the bookOf seed, whose `templateId` is `bookOf`, so `CLUSTER_VOCAB`/`SCATTER_VOCAB` are registered but unused by any scaffolded project. Parity kept on purpose; it is a separate fix, outside this initiative.
- 2026-09-30 — **Phase 1: `kindCapabilities()` is wired only where it is a drop-in.** That means `/symbols` `visibleStatesFor` (book + cascade columns) and the `gameProfile` detectors (cascade, multiplier collect, expanding book, and the new "Hold and Win respins" chip). For every existing kind `freeSpins` and `stackedPictures` are `true`, the flags nothing gated before. `holdAndWin` has them `false`, but no tool reads them yet: Phases 6–8 do.
- 2026-09-30 — **Desktop builds are unverified for `holdAndWin`.** A desktop build of a `holdAndWin` project is stamped `protocol: 'holdAndWin'`. `resolveActiveMapping()` maps an unknown `PUBLIC_RGS_GAME` to the lines mapping, so that is safe. The desktop launcher's own (Python) handling of an unknown protocol was not checked.

## Touch list (every place a new kind must be registered — from the 2026-09-30 inventory)

- `apps/launcher-api/src/lib/roles.ts:47-55` (`GameKind`/`GAME_KINDS`)
- `apps/launcher-api/src/routes/(app)/editor/+page.svelte:~2119` (`GAME_TYPES`)
- `packages/game-spec/src/schema.ts:25` (`GameTypeSchema`) and `:28` (`SymbolKindSchema`), `scaffold.ts:52`
- `apps/launcher-api/scripts/check-flow-publish-gate.ts:32`
- `scripts/gen-flow-vocabulary.mjs:70` → regenerates `lib/emitterVocabularies.ts` (`/fx` suggestions)
- `apps/launcher-api/src/lib/server/mockProtocol.ts` `protocolFor()`; `testServerManifest.ts:217` + `services/test-server/server.mjs:483` `MOCK_PROTOCOLS`; `server.mjs` `makeMock` / `hydrateOnce`
- `packages/engine-layout/src/lib/referenceLayouts/index.ts` `FULL_SCENE_SOURCES`; `templates/index.ts` `TEMPLATES`; `sceneRole.ts` `SCENE_ROLE_LABELS` + `types.ts` role union
- `packages/engine-flow-v2/src/reference/registry.ts` `TEMPLATE_VOCABULARIES`; `drivenSeed.ts` `DRIVEN_SEEDS`
- `apps/launcher-api/src/lib/server/gameProfile.ts` `FEATURE_DETECTORS`
- `apps/launcher-api/src/lib/server/gameConfigDefaults.ts` + `scripts/generate-game-config-defaults.ts`
- `apps/launcher-api/src/lib/server/symbolDefaults.ts` (only `lines.json` exists)
- `apps/launcher-api/src/routes/(app)/symbols/symbols.client.ts` `visibleStatesFor`
- runtime: `apps/lines/src/game/{typesBookEvent,bookEventHandlerMap,flowEffects}.ts`, `engine-game/src/game/{types,bookEvents}.ts`
- facade: `packages/rgs-translator-eagaming/src/{engineFacade,gameMappings,sessionState}.ts`

## Win Text literals for Phase 8

Every player-facing string the Phase 4 coded defaults print, for Phase 8 to move onto `formatWinText`
(through `apps/lines/src/game/holdAndWinText.ts`). All are English literals today; nothing else in the
Hold and Win beats prints copy.

| Literal (as printed) | Where | Beat |
|---|---|---|
| `RESPINS {left}` | `components/RespinCounter.svelte` | the respin counter |
| modifier line `MYSTERY · COLLECTOR · PAYER` (special names joined by ` · `) | `RespinCounter.svelte` | active modifiers |
| `SINGLE` / `DOUBLE` / `TRIPLE` `COLLECTOR` (counter line) | `engine-game` `holdAndWinWheel.ts` `collectorLevelName` + `RespinCounter.svelte` | collector level |
| special names `COLLECTOR`, `MULTIPLIER`, `PAYER`, `MYSTERY` | `game/holdAndWinPresentation.ts` `specialName` | toasts below |
| `{SPECIALS} ACTIVE` (toast) | `holdAndWinPresentation.ts` `presentMeterConsume` | a full pot enters the feature |
| `UNLOCKED: {SPECIALS}` (toast) | `holdAndWinPresentation.ts` `presentMysteryReveal` | a mystery unlocks a modifier |
| `LUCKY SPIN` (banner) | `holdAndWinPresentation.ts` `presentLuckySpin` | Lucky Spin intro |
| `{TIER} JACKPOT` + detail `{amount}` or `FULL BOARD  {amount}` (banner) | `holdAndWinPresentation.ts` `presentJackpotWin` | banked jackpot |
| `{TIER}` + `{amount}` (small banner) | `holdAndWinPresentation.ts` `presentJackpotWin` | coin jackpot in the tally |
| `INSTANT WIN` + `×{factor}` … `{amount}` (banner) | `holdAndWinPresentation.ts` `presentInstantCollect` | base-game instant collect |
| wheel segment labels `COIN BOOST ×{n}`, `+{n} COLLECT`, `{TIER}` | `engine-game` `holdAndWinWheel.ts` `wheelPrizeLabel` | the wheel |
| wheel prize detail `EVERY COIN ×{n}`, `{LEVEL} COLLECT`, `JACKPOT` | `holdAndWinPresentation.ts` `wheelPrizeDetail` | the wheel's prize banner |
| pot labels `{METER ID} {level}/{max}` and the `activates` name | `components/HoldAndWinPot.svelte` | the pots |
| letters row (the config's `boardEnd.letters`, not a literal) | `components/HoldAndWinLetters.svelte` | Grand letters |
| coin labels `MINI`, `MINI ×{n}`, `×{n}`, `+{money}` (tier names come from the config) | `engine-game` `coinLabel.ts` | every coin |

## Open items / next

- **Flip `HOLD_AND_WIN_KEEPS_GAME_TYPE`** (`engine-game` `modeEvents.ts`) once Phase 6 gives
  `Background.svelte` a `respin` branch. The respin board already rolls `paddingReels.respin`
  (`getPaddingReels('respin')`, base strips only for a config without them); writing `gameType:
  'respin'` before the background handles it would hide both backgrounds. A one-line flip + a parity
  boot.
- **Facade `modeEnter` / `modeExit`** for a QUEUED mode: today's wire has no mode change other than
  the aliased `holdAndWinTrigger`/`End` (the wheel is part of the entry, not a mode). Map them when
  the mock announces one — proposed wire `modeEnter {mode, cause, payload?}` / `modeExit {mode,
  total?}`, `total` in credits.

1. **Phase 4 follow-ups** (the build is complete; none blocks authoring):
   - **Grand and Hotfire are verified in Storybook only** (facade-recorded books, every bar = the
     feature total). Publish a Classic and a Collector sample project — save `/config` once on the
     preset (the unauthored-config trap above), then Re-publish — and play their letters, instant
     collect, streak flights and wheel live. Start their playbooks beside
     [hw-3pots-sample.md](../playtest/hw-3pots-sample.md).
   - **Random metre** (`randomMetreTrigger`) is the one Hold and Win event with no beat of its own
     (its coins already stick through the trigger).
   - **From the live checks (not regressions):** the "RESPINS 3" counter shows ~0.7 s before the
     board swaps; a ~100–130 ms frame hitch at the start of every respin (likely the per-cell strip
     mount — profile it); the respin cells show half-cropped symbols while they roll; the base reels
     come back on the trigger spin's board (or the boot board after a snapshot resume); the Total
     Win bar lands in the same frame the respin board hides; a banked jackpot's 350 ms beat is hidden
     while coins are still counting.
   - **Accepted on purpose:** `holdAndWinEnd` and banked jackpots run inside the unskippable window,
     so the end volley plays at full length even under turbo/autoplay.
   - **Not covered:** stepped grids; perspective boards roll at the flat row pitch; the respin cells
     use the coded spin profile, not the editor's `resolveReelSpinProfile`.
   - **`hw-3pots-sample` draws no toasts** ("UNLOCKED", "PAYER ACTIVE", "Good luck" are set, never
     drawn): its layout has no message host — Phase 6's template should carry one.
2. **Ask the partner** for a Hold and Win sample round or their handler subclass (design §3.2).
3. **A playtest playbook** per preset (Phase 9) can drive every beat through the force endpoint.

## Blocked (owner / external)

- **Partner Hold and Win wire format.** This blocks production RGS play only. Authoring and mock play are not blocked.

## Recent changes

- 2026-10-01 — **Phase 8 part 1: Win Text families + gating** (branch `claude/hw-phase8-win-text`).
  `WinTextDoc` gains `jackpots` / `respins` / `feature`, with defaults equal to the presentation's
  literals where it draws one (six fields are new copy with no draw site yet); `/win-text` shows them only for `holdAndWin` and hides `toast.expanded` without
  `bookReveal` (Free spins without `freeSpins`); win-level rows come from the config's big tiers;
  Localization harvests the families for Hold and Win projects only. Both bundle paths ship the
  normalized doc, so the new keys reach the game (fixture-pinned). Every real `win-text.json` in R2
  normalizes and harvests byte-identically. PR #946. Left: part 2 (the presentation reads the
  templates) — the call-site map is in Decisions & findings. Details: [win-text](win-text.md).

- 2026-10-01 — **Phase 4 (engine runtime) build complete** (session "Hold and Win Phase 4 — engine
  runtime"). Merged in order, each a runtime release verified by `X-Runtime-Release`: 4a contract
  #928 · 4b facade + coin labels #931 · 4c respin board #934 · resume through the snapshot #938 · 4d
  specials + mystery #939 · flights #942 · 4e pots, Lucky Spin, feature end #943 · 4f Grand + Hotfire
  #945 (live `lines@e4bca6077db0`). Every PR had a code review and a real-clock live check: Borut
  parity (balances = RGS, spin button live, no new console errors) plus forced beats on
  `hw-3pots-sample`; #943 was merged on the owner's order before its live check finished, and the
  check then passed on the merged code. Coordination: the Win Text literals are listed above for
  Phase 8; Phase 7 owns the coin-label and flights authoring on top of the coded defaults (kind keys
  `toTotal`, `toCollector`, `toMeter:<id>`).

- 2026-10-01 — **Phase 4, step 10: Grand + Hotfire** (branch `engine/hold-win-4f-grand-hotfire`, on
  `engine/hold-win-4e-pots-lucky-end` / #943; no PR yet). One function per beat in
  `holdAndWinPresentation.ts`, each with a coded handler, a flow effect and cues:
  - **Column letters** (`lightLetter`, `columnComplete`): a coded "G R A N D" row above the respin
    board from `boardEnd.letters` (`HoldAndWinLetters`/`HoldAndWinLetter`, mounted only while the
    board is up on a `columnLetters` config). The letter lights and pulses with its column; a cleared
    column's coins fly to the Total Win bar, which counts up by the column's amount, and the cells play
    `clearReel` and go. Cues `respinColumnComplete`, `respinColumnStep`.
  - **Instant collect** (`instantCollect`, `coinInstantCollect`, base game): specials and coins
    light on the base board (padded row = visible + 1), each coin flies into its nearest special
    (`toCollector`), then "INSTANT WIN ×3 $12.00"; the round's own win presentation follows. Cue
    `instantCollectWin`.
  - **Streak collect by flight:** `presentCollectStep` flies each coin into its collector
    (`flyTo(cell, collector, 'toCollector')`); the collector's label rises on each arrival.
  - **Jackpot factor step:** a jackpot coin a boost multiplies steps `MINI` → `MINI ×2` on its turn
    and lights, instead of waiting among the counting coins.
  - **Wheel** (`spinWheel`, `holdAndWinWheel`): a Graphics wheel of the config's prizes
    (`HoldAndWinWheel.svelte`, flights band, zIndex between the flights and the banner, which moved
    to 2), 4 turns in 3.2 s with a quartic ease onto the server's `index` (`engine-game`
    `holdAndWinWheel.ts`), then "COIN BOOST ×2 / EVERY COIN ×2" or "+1 COLLECT / DOUBLE COLLECT";
    the counter's line reads "DOUBLE COLLECTOR". Cues `wheelShow`, `wheelSpin`, `wheelLand`.
  - **Verified:** `check:engine-game` 9/9 (new `holdAndWinWheel` fixture: every index of 1–12
    segments lands centred under the pointer, turn bounds, wrap, labels, `cellWorth`, a column's
    split; two planted mutants fail it), `check:holdandwin` (820 facade checks), `gen:flow-vocab:check`
    (86 events, 60 effects), `pnpm lint`, svelte-check at baseline and completed (apps/lines 165,
    engine-game 38), `check-all` 324/324. Storybook from `C:\IW-4f2` on a real clock (GPU headless
    shell): `MODE_HOLD_AND_WIN/grand` (classic mock: `letter`, `letters`, `special:multiplier` with a
    MINI, `instant`) and `MODE_HOLD_AND_WIN/hotfire` (collector mock on a 3×3 window: `trigger`,
    `chain`, `wheel:extraCollect`, `wheel:coinBoost`, `wheel:jackpot:GRAND`), books in
    `stories/data/hold_and_win_grand_hotfire_books.ts`. Every story's bar ended on its feature total
    (3400, 103900, 6200, 1200, 4600, 8800, 2000, 2000, 101000), 0 exceptions. `letters`: G-R-A-N-D
    lit in turn, the bar stepped 800 → 1300 → 2100 → 3000 → 3900 as 15 coins landed, the GRAND
    banner with the button locked, the GRAND joined at the end → 103900. `chain`: 12 coins flew into
    the double collector, 11 clears. Wheel: landed on index 0 / 1 / 6 at exactly 4 turns; slammed
    mid-spin (`roundSkip.skip()` at 2.2 s) it landed on the same rotation within one frame, then held
    the segment and the banner about 700 ms each.

- 2026-10-01 — **Phase 4, steps 6–8: pots, Lucky Spin, full board + feature end** (branch
  `engine/hold-win-4e-pots-lucky-end`, off `engine/hold-win-flights`). Coded default presentations,
  each beat one function in `holdAndWinPresentation.ts` shared by its coded handler and a flow effect:
  - **Pots** (`fillMeter`, `meterUpdate`): boot levels from the facade, seeded at game start; coded
    pots above the board (`HoldAndWinPots`/`HoldAndWinPot`: one bar per config meter, "RED 10/12",
    what it activates, a size step per `sizeStages`, a pulse when full or consumed). Each special in
    `from` lights on the base board and flies into its pot; the pot ticks a level per arrival and
    pulses when the update filled it. Cues `potFill`, `potFull`; value sources `meter.<id>.level` /
    `meter.<id>.max`.
  - **Entry with modifiers** (inside `showRespinBoard`, `holdAndWinTrigger` `cause: 'meter'`): the
    consumed pots drain to empty, "PAYER ACTIVE" toasts, then the board swaps; the respin counter
    shows the active modifiers under it ("MYSTERY · COLLECTOR · PAYER", following mystery unlocks).
    Cue `potsConsume`; value source `activeModifiers`.
  - **Lucky Spin** (`playLuckySpinIntro`, `luckySpin`): a "LUCKY SPIN" banner holds 1.6 s,
    unskippable; the reveal it arms anticipates on every reel and runs unskippable. Cue
    `luckySpinIntro`.
  - **Jackpots** (`showJackpotWin`): a banked jackpot (full board, letters, wheel) is a held
    celebration banner "GRAND JACKPOT / FULL BOARD $2,000.00" (a full board also lights every held
    cell), slam re-armed and button inert; a coin jackpot named in the tally lights with a small
    "MINI $15.00" banner, slammable. Cue `jackpotCelebration`.
  - **Feature end** (`hideRespinBoard`): the coins fly to the Total Win bar and the bar counts up per
    arrival by that coin's amount, the banked part last, landing exactly on the feature total; then
    the round's `setWin` / `setTotalWin` as before. A celebration (re-armed, button inert). Cue
    `respinTallyStep {index, amount, total}`.
  - **Verified:** `check:engine-game` 8/8 (new: the meter-cause reducer case; `tallyCountUp` lands
    exactly for in-order, out-of-order, short and over-rounded amounts), the facade fixture (boot
    meters published for pots, absent for classic/collector; a planted no-publish mutant fails 10
    checks), `check:holdandwin`, `gen:flow-vocab:check` (80 events, 57 effects), eslint, svelte-check
    at baseline (apps/lines 166, engine-game 38, completed), `check-all` 322/322. Storybook
    `MODE_HOLD_AND_WIN/pots` from `C:\IW-4e` on a real clock (headless shell, GPU): four books
    recorded from the pots mock through the real facade (`meter:red`, `lucky`, `fullBoard`,
    `jackpot:MINI`). `meter:red`: two heads fly into RED, 10 → 12 and a pulse, three into BLUE 0 → 3,
    RED drains 12 → 0, the counter shows "MYSTERY · COLLECTOR · PAYER", the tally steps the bar 150 →
    250 → 450 = the total. `lucky`: banner up with the button locked, the reveal holds reels 1–4 in
    turn (`01000` → `01111`) with the button still locked; 85 of 129 spammed presses refused (intro,
    reveal, end), the respins in between slammed, and the tally still landed on 1700. `fullBoard`: the
    GRAND banner with every cell lit, button inert; 15 coins step the bar to 4000, then the GRAND
    joins 366 ms later at 204000 = the total. `jackpot:MINI`: the MINI coin lit with its small banner,
    button live; the bar lands on 4350. A free-spin bonus story plays with no pots, no banner and no
    lock.

- 2026-10-01 — **Phase 4, step 9: flights** (branch `engine/hold-win-flights`, off
  `engine/hold-win-4c-respin-board`). A head that travels from a cell to a target, leaves a trail and
  fires `flightArrive {flight, target, index}` on impact (design §4.4).
  - **Route** (`engine-game` `flightPath.ts`, pure): one cubic Bézier; candidates are straight, bend
    left/right at 0.2/0.35/0.55 of the distance, then an over-route whose apex clears the highest
    obstacle. The FIRST candidate whose 48 samples miss every padded obstacle wins (the order is the
    order of growing detour); none clean ⇒ fewest hit samples, then shorter, then earlier. An
    obstacle around the source or the target is ignored. `flightDuration` (distance / speed, clamped),
    `flightStagger`, `flightEase`. Pinned by `fixtures/flightPath.fixture.ts` (14 checks).
  - **Runtime** (`apps/lines` `flights.svelte.ts`): `flyTo(from, to, flight, {avoid, index, stagger,
    padding})` → a Promise resolved when the HEAD lands, after the cue. Ends: a global point, a cell
    `{reel,row}` (the board's seats), a layout node id, or `'total'` (the win meter, falling back to the
    board's bottom centre). Routes are planned in the flight layer's local space; speed is in BOARD
    units (1.1/ms, 350–900 ms), stagger 70 ms. A slam runs the flight clock 4× (stagger included) and
    never skips an arrival; an unskippable presentation keeps the pace. No layer mounted / no board ⇒
    the flight lands at once and still fires its cue.
  - **Layer**: `FlightLayer.svelte`, one unconditional container at `LAYER_BAND_FLIGHTS` (8500, new in
    `engine-layout` `layerOrder.ts`) — above the board, the HUD and the win line (a head lands ON the
    meter), below the pinned celebrations. Idle it holds two transform-only containers (the board's
    space, so a cell resolves while the reel board is hidden) and draws nothing.
  - **Look** (`engine-game` `flightGlow.ts` + `FlightView.svelte`): a radial-gradient glow generated
    once on a canvas (head, gold tint, additive) and the shared `constants-shared` `trail` config in
    gold as the trail, cell-sized from the board's scale. On arrival the head goes, `emit` turns off,
    and the flight unmounts after the trail's max particle lifetime (`emitterSecondsToWallMs`).
  - **Trail mechanism**: `pixi-svelte` `ParticleEmitter` gained an `ownerPos` getter (details in
    [status/engine](engine.md)); `EffectPlayer`/`EffectLayer` forward it to FREE layers for Phase 7's
    authored trails.
  - **Targets**: new `pixi-svelte` named anchors (`<Anchor name>` / `resolveAnchor` /
    `resolveAnchorPoint`). `LayoutNodeView` anchors every bind / container / componentInstance node by
    its id, the coded HUD's `LayoutEditable` anchors its component instances, and the win readouts
    (`LabelWin`, `HudValue`/`HudReadout` with source `win`) anchor `hud-win` — what `'total'` resolves.
  - **Uses**: the feature end (`holdAndWinFlights.ts` `flyCoinsToTotal`, called from
    `presentHoldAndWinEnd` after the final-board hold and before the swap back): every tallied coin, in
    column order, staggered, awaited. A flow effect `flyTo` (`cells` or `reel`+`row`, `target`
    default `'total'`, `flight` default `toTotal`, `avoid`, `stagger`, `await` default true);
    vocabulary regenerated (48 effects).
  - **Verified**: `check:engine-game` 7/7, `gen:flow-vocab:check`, `pnpm lint`, `check-all` 319/319,
    svelte-check at baseline and completed (apps/lines 166, engine-game 38, pixi-svelte 14,
    engine-layout 296, components-ui-pixi 23). Storybook from `C:\IW-4f`
    (`MODE_HOLD_AND_WIN/flights`: a 5×3 volley into the win meter, avoidance, over-route, with the
    obstacles and routes drawn): heads land on the Win meter above the HUD, routes miss every red
    cell, the layer goes back to its 4 idle nodes after each volley, no console errors. The recorded
    `MODE_HOLD_AND_WIN/book` trigger round, probed through the real bus: 5 `flightArrive` (indices
    0–4, target `total`, flight `toTotal`), the board swaps back 2 ms after the last; slammed at the
    last counter update, the same 5 cues fire and counter-zero → last landing drops from 1834 ms to
    201 ms.

- 2026-10-01 — **Phase 4d: specials and mystery beats** (session "Hold and Win Phase 4 — engine
  runtime", branch `engine/hold-win-4d-specials`, stacked on 4c). Each beat is one function in
  `holdAndWinPresentation.ts`, called by its coded handler and by a new flow effect:
  `payCoins` (`coinPay`: payer `win`, then every coin counts up `from` → `to`, staggered),
  `boostCoins` (`coinBoost`: booster `win` when `source: 'special'`, then the counts; a jackpot's
  factor steps `MINI` → `MINI ×2`), `turnSpecialIntoCoin` (`specialBecomesCoin`: lands as a coin),
  `collectCoins` (`coinCollect`: each coin pulses via `presentCollectStep`, the collector's label
  climbs to its new value), `revealMystery` (`mysteryReveal`: `explosion`, becomes what it revealed,
  `land`; an unlock shows "UNLOCKED: <KIND>"), `clearRespinCells` (`cellsCleared`: `clearReel`, then
  gone), `showJackpotWin` (`jackpotWin`: a jackpot coin lights; a banked jackpot gets a toast). New
  cues (notifications): `respinCoinPay`, `respinCoinBoost`, `respinSpecialBecomesCoin`,
  `respinCoinCollect`, `respinCollectStep` (once per collected coin), `respinMysteryReveal`,
  `respinModifierUnlock`, `respinCellsCleared`, `respinJackpotWin`; flow vocabulary regenerated. A
  slam compresses every wait and count and skips no state change; every symbol beat is capped
  (650 ms). Other games: one optional `Symbol.svelte` prop nobody else passes. Storybook
  `MODE_HOLD_AND_WIN/book` gained five rounds recorded from the pots mock through the real facade
  (`trigger,special:payer`, `special:multiplier`, `special:collector`, `mystery:jackpot:MINI`,
  `unlock:payer`; specials on H1–H4, role-tagged in the story). Verified: svelte-check at baseline
  (apps/lines 166, engine-game 38, completed), eslint, `gen:flow-vocab:check`, `check:engine-game`
  (new `respinCount` fixture), `check:holdandwin`, `check-all` 319/319. All five stories played in
  Storybook from a short path, with the respin board's state probed every 250 ms off the live
  modules: each label is pinned at `from` while the picture already holds `to`, counts up staggered
  and lets go on the final value; the collector climbs 0 → 8.5 as its five coins pulse in turn; a
  mystery goes `explosion` → becomes `W MINI` / the payer → `land`; a slam in the payer's beat
  ended every count on its final value within 0.1 s and the next respin rolled at full pace.
  **Not seen as pixels:** this Storybook mounts no board for ANY story (`MODE_BASE/book` too — the
  stage has no reel or respin subtree; `Game.svelte` gates the reel stack on
  `!isFlowDriven || isBasegameActive`), so the 4c visual check on a live published project still
  covers 4d's beats too.

- 2026-10-01 — **4c merged (#934): the respin board** — live as `lines@28b09d57cd88` (findings
  above). **Then: Hold and Win resume through the snapshot** — the facade hands the engine the
  resume point of a mid-feature round (`holdAndWinResumePoint`, `engineFacade.ts`), pinned by the
  facade fixture's resume case (starts at the next `respinReveal`, the snapshot before it is the board
  held at the break, the trigger is not presented again; a mutant that resumes at 0 fails 4 checks).
- 2026-10-01 — **Phase 4c: respin board, sticky coins, respin counter** (session "Hold and Win
  Phase 4 — engine runtime", branch `engine/hold-win-4c-respin-board`). `holdAndWinTrigger` swaps
  the reel board for the respin board over the same seats, triggering coins held; `respinReveal`
  spins the free cells onto the revealed symbols; `coinsLand` sticks them (a `land` beat);
  `respinUpdate` moves the counter and a reset pulses it; `holdAndWinState` rebuilds the whole board
  with no intro (resume); `holdAndWinEnd` holds the final board, then swaps back. Six flow effects and
  five cues; flow vocabulary regenerated. Other games: one empty container in the board stack and one
  `stopButtonClick` subscription — the reels are built on the first feature only. Verified:
  `check:engine-game` (new respin-board fixture; 4 planted mutants caught), the facade fixture,
  `gen:flow-vocab:check`, eslint, svelte-check (engine-game 38 = baseline; apps/lines 169 on this
  branch and on its base alike — the 3 over baseline are a Windows long-path `svelte(style)` artefact
  of the checkout). NOT rendered locally: the checkout's path is past Windows `MAX_PATH`, which breaks
  Vite; the Storybook story `MODE_HOLD_AND_WIN/book` (two rounds recorded from the pots mock through
  the real facade, symbols renamed onto the sample art) is there to run from a short path.

- 2026-10-01 — **Phase 4b: facade mapping + coin labels** (session "Hold and Win Phase 4 — engine
  runtime"). The facade translates every wire Hold and Win event into the 4a contract (cell values,
  jackpot labels and factors parsed off `BONUS:1.5` / `JACKPOT:MINI*2`; credits → book units),
  pinned by `packages/rgs-translator-eagaming/holdAndWin.fixture.ts` (in `check:holdandwin`): the real
  facade against the real mock, 18 forced beats over the three presets, every book folded through
  the engine reducer and compared with the server's snapshot after every respin. Symbols print their
  value (`coinLabelText` in engine-game, drawn by `Symbol.svelte` over the art): money for a coin or
  collector (decimals, the operator's currency), `MINI ×2` for a jackpot, `×3` for a multiplier,
  `+$4.00` for a payer — the coded default until Phase 7 authors it.
- 2026-10-01 — **Phase 4M: game modes** (session "Hold and Win Phase 4M — Game modes"; PRs #930
  registry, #933 engine + flow).
  - **Registry** (`packages/game-config/src/modes.ts`): sparse `doc.modes`; built-ins `basegame`,
    `freeSpins` (game type `freegame`), `holdAndWin` (respin board, game type `respin`, only with a
    `holdAndWin` block). `/config` Game modes section; Scene Editor role **game mode** + `modeId`.
  - **Engine stack + queue** (`engine-game` `modeStack.ts` / `modeEvents.ts` /
    `modeController.svelte.ts`, `apps/lines` `stateModes.svelte.ts`): nest / queue / same-mode merge,
    the queue drains only at base, `allFinished` only when both are empty. `modeEnter`/`modeExit` book
    events; `freeSpinTrigger`/`freeSpinEnd` and 4a's `holdAndWinTrigger`/`holdAndWinEnd` are aliases
    (4a's `{mode, cause, payload}` shape is read as is). `GameType` widened to any mode game type.
  - **Flow:** `FlowDoc.modes: {[id]: {graph}}`, active-mode-first dispatch, nodes Mode trigger
    (enter/exit/resume), On all modes finished, Enter mode (nest/queue), Exit mode; validator codes
    `mode-unset` / `mode-entry-scope`, ids unique across sections; `check:flow-publish-gate` §6;
    `/flow-v2` mode tabs. `$engine.activeMode` / `modeDepth` / `queuedModes`.
  - **Resume:** stack + queue rebuilt silently from the snapshot; Hold and Win's own state comes back
    through 4a's `holdAndWinState` replay.
  - **Hold and Win state is recorded at the play seam** (taken over from Phase 5 at the hub's request):
    `createPlayBook`'s new `recordBookEvent` runs `recordHoldAndWinEvent` for every Hold and Win
    event BEFORE any path presents it (`isHoldAndWinEvent`, `engine-game` `holdAndWin.ts`), so a flow
    that owns one no longer leaves `stateHoldAndWin` stale. The coded handlers present nothing.
  - **Parity:** a real-clock free-spin round of `bookofborutremake`'s live authored data on the local
    book mock, `main` vs branch: same 10 spins' structure, same intro/outro holds, same
    `setFreeGameType` → `enterFreeSpinOutro` → `exitFreeSpinOutro` order and game-type moments, no
    exceptions; the stack goes `freeSpins` at the trigger and back to base after `freeSpinEnd`.
  - **Hold and Win keeps `gameType` unchanged for now** (`HOLD_AND_WIN_KEEPS_GAME_TYPE`,
    `modeEvents.ts`): its mode is declared with game type `respin`, but writing it today would hide both
    backgrounds (`Background.svelte` keys on basegame/freegame) and pad the reels from no strips.
    Flip the flag when the respin board and the background read `respin` (Phase 4 / 6).
  - **Known gaps (code review, not parity):** (1) `playBet` resets the stack silently — a mode a FLOW
    entered must be exited within its round (book-driven modes always are). (2) Two ownership probes
    run once and see only the global graph + base: `Game.svelte` `flowOwnsSetWin` (boot) and
    `flowEffects.ts` `showWinInfoMessage`'s `ownsEvent('freeSpinTrigger')` (during the base reveal) — a
    mode tab that alone owns `setWin` / `freeSpinTrigger` is not seen there. (3) `freeSpinEnd` for a
    SUSPENDED free-spins mode (Hold and Win nested on top) lets the coded handler write `basegame` under
    Hold and Win; an unusual book order. (4) `/flow-v2`'s "Fix duplicate ids" repairs only the open
    graph; the editor and collapse mint ids unique across sections, so only a hand-edited doc collides.
  - **Left for Phase 5/6:** the Hold and Win mode's graph and its respin screens (tag them `mode` +
    `holdAndWin`); the facade/mock emit no `modeEnter` yet (nothing needs a queued mode until a game
    announces one).

- 2026-10-01 — **Phase 4a merged (#928, runtime release `lines@f6b3207671a9`): the Hold and Win book-event contract** (session "Hold and Win Phase 4 —
  engine runtime"). The §4.3 events as typed arms of the shared runtime's union (payloads in
  `engine-game` `holdAndWin.ts`), `RawSymbol` `value`/`jackpot`/`factor`, the `HoldAndWinSnapshot`
  resume shape, state-only default handlers into `stateHoldAndWin`, `flightArrive` cue, regenerated
  flow vocabulary (20 book events + `flightArrive`; the codegen now resolves a `.ts` re-export from a
  package). No game changes: no RGS sends these events yet — the facade still passes the wire's
  Hold and Win events through as `_name` until 4b maps them. A runtime release on merge.

- 2026-09-30 — **Phase 3 merged (#924): mock RGS `holdAndWin` protocol + wire contract** (session "Hold and Win
  Phase 3 — mock RGS + wire").

  - `scripts/mock-rgs-server-holdandwin.mjs`: deals from `doc.holdAndWin` + symbols + paylines only
    (base game through the lines evaluator), all three presets — count / pattern / meter / Lucky Spin /
    random metre / buy triggers, `allCoins` and `collectorsOnly`, both reset rules and the cap, full
    board, column letters with clear, payer / multiplier (+ leave-behind, + jackpots) / collector /
    mystery (+ unlock) in `applyOrder`, active modifiers, the wheel, base-game instant collect,
    persistent meters per session (at boot, on every `play`, across a contract swap), resume + replay.
  - Forced outcomes for every beat: `play.context = "force:<spec>"`, the test server's
    `/api/<key>/force?sid=&beat=`, or `FORCE=`.
  - Test server: `holdAndWin` gets its own mock from the contract (`MOCK_FALLBACKS` removed); the
    launcher's mock contract carries `holdAndWinMockInputs(doc)` (new in game-config) for both the
    published and the authoring mock (`check:mock-contract` pins the split).
  - `pnpm check:holdandwin` (in `check:rgs` and `check:all`): 240 rounds per preset rebuilt cell by cell
    from the events and compared with the server's snapshot after every respin — counter, stickiness,
    special order, payout sums, meters, `seq`/`gid` — plus every forced beat, meters, resume/replay and
    close rules. Eight planted mock bugs each fail it.
  - game-spec's `SymbolKindSchema` now imports the Hold and Win roles from game-config (`jackpot`,
    `coinMultiplier`), closing the Phase 1/2 naming mismatch.
- 2026-09-30 — **Phase 2 merged (#919)** (session "Hold and Win Phase 2 — Game Config block").
  - `packages/game-config`: the `holdAndWin` block, its normalizer and validator, and the three presets
    `pots` / `classic` / `collector` (numbers per design §1.2).
  - Committed defaults: `data/gameConfig/holdAndWin.<preset>.json`. `holdAndWin` defaults to `pots`.
  - `/config`: a Hold and Win section and "Reset to preset", gated on `kindCapabilities().holdAndWin`.
  - Game Maker: ten profile detectors.
  - Left for later phases: nothing reads the block at runtime yet (Phase 4), the mock doesn't generate
    from it (Phase 3), and the roles aren't offered in `/symbols` (Phase 7).
  - **Role-name mismatch with Phase 1:** game-spec's `SymbolKindSchema` (#917) says `jackpotCoin` and
    reuses `multiplier`, while the config's `special_properties` roles are `jackpot` and
    `coinMultiplier`. Phase 7 (Symbols) should align game-spec to the config names.
- 2026-09-30 — **Phase 1: kind plumbing + `kindCapabilities()`** — merged as #917, a runtime release (session "Hold and Win Phase 1: register the kind everywhere").
  - **One kind list.** `GAME_KINDS` lives in `packages/constants-shared/gameKinds.ts`. These now derive from it: roles.ts (its copy removed), `kindStorage`, `projects.ts`, the editor template picker, game-spec `GameTypeSchema`, the publish gate, `verify-launcher-profile` and `gen-flow-vocabulary.mjs`, which gives lines' emitter vocab to every kind except cluster/scatter.
  - **`kindCapabilities(gameType, config?)`** is in `engine-layout`.
  - **game-spec symbol roles:** `coin`, `jackpotCoin`, `collector`, `payer`, `mystery`, `meterSpecial` and `blank` (`multiplier` already existed).
  - **Mock protocol:** `protocolFor('holdAndWin') = 'holdAndWin'`. It is in `MOCK_PROTOCOLS` (launcher, test server, the two publish scripts). The test server deals it with the lines mock through the named `MOCK_FALLBACKS`, and `mockContract` requires paylines for it as for lines.
  - **Flow fallbacks** are explicit and named (table above).
  - **Scene set:** a 5×3 engine-skeleton `holdAndWin` set ("Hold and Win") is in `FULL_SCENE_SOURCES`, so the Game Maker/admin picker offers it and the kind chip reads "Hold and Win".
  - **Left for later phases:** `TEMPLATES`, `SCENE_ROLE_LABELS`, `DRIVEN_SEEDS`/`TEMPLATE_VOCABULARIES` entries, config/symbol defaults and the runtime/facade.

- 2026-09-30 — **Owner decisions recorded** (one template / three presets, 3 Pots first, mock-first with a swap seam). Build plan re-cut: Phase 10 is now the partner wire and Phase 11 covers what goes beyond the three references.

- 2026-09-30 — **Plan and hub created** (session "Hold and win game pipeline").
  - Researched 3 Oaks *Grand*, *Super Hotfire Diamonds* and *3 Pots of Egypt* from their server config and rules strings.
  - Read the partner core's respin and jackpot handling.
  - Inventoried the engine: found the `apps/price` superspin loop.
  - Inventoried every tool's kind plumbing.
  - Wrote the design doc and this hub.
