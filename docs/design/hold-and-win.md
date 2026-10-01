# Hold and Win — a new game kind, end to end

> Status: living state in **[docs/status/hold-and-win.md](../status/hold-and-win.md)** — that file
> is also the **hub** other sessions report into. This file is the plan, not the progress.
> Related: [game-type-templates.md](game-type-templates.md) (a kind is data + a mechanic),
> [invisible-game-config.md](invisible-game-config.md), [invisible-flow-v2.md](invisible-flow-v2.md),
> [invisible-symbols-state-machine.md](invisible-symbols-state-machine.md),
> [invisible-win-text.md](invisible-win-text.md), [live-assets.md](live-assets.md),
> [play4fun-protocol](../reference/play4fun-protocol.md).

## Why this exists

We need to author and ship **Hold and Win** games (Hold & Spin / Cash Collect / Lightning-Link
lineage) through the same pipeline as our lines, Book-of and ways games. Every tool has to know
the kind: a Scene Editor template, a Flow vocabulary with its signals and receivers, a Symbols
State Machine that shows the coin options and hides the options this kind does not use, and the same
for Game Config and Win Text. None of that exists today, and the RGS contract for it is not settled.

## 1. The mechanic — what we must model

### 1.1 Core loop (every Hold and Win game)

1. **Base game = a normal lines game.** Low/high line symbols and a WILD (no scatter, no free spins
   in either reference game).
2. **Coin symbols** (called BONUS in 3 Oaks games) land during the base game. Each carries a
   **value**: either cash (a multiple of the total bet, e.g. 1/2/3/5/7/10/15×) or a **jackpot
   label** (MINI / MINOR / MAJOR / GRAND). A coin pays nothing on a line.
3. **Trigger** — enough coins (classic: **6+** on 5×3), or a positional pattern (see Hotfire), or a
   bought feature, or a random "metre" trigger.
4. **Respin feature** — the board switches to the respin board:
   - the coins that triggered **stick**;
   - every non-coin cell spins **on its own**, and only coins/blanks can land;
   - a counter starts at **3**; any respin that lands a new coin **resets it to 3**; a respin with
     nothing new decrements it;
   - the feature ends when the counter hits 0 or the board is full.
5. **Payout** — every coin's value is collected (a per-coin count-up into a Total Win bar), the
   jackpot labels pay their fixed prize, and the sum is paid as one win (then a big-win tier if it
   reaches one).
6. **Full board** classically awards the **GRAND** jackpot.

### 1.2 The three reference games (researched 2026-09-30 from 3 Oaks' own server config and rules)

| | **Grand** (3 Oaks) | **Super Hotfire Diamonds: Hold and Win** (3 Oaks) | **3 Pots of Egypt** (3 Oaks) |
|---|---|---|---|
| Grid / lines | 5×3, 5 fixed lines | **3×3**, 5 fixed lines (3 rows + 2 diagonals) | 5×3, **25** fixed lines |
| Coin (BONUS) values | 1,2,3,4,5,6,7,10 × TB, all reels | 1,2,3,5,7,10,15 × TB, **reels 1 & 3 only** | 1, 1.5, 2, 2.5, 3, 5, 8, 10 × TB (**decimals**), all reels |
| Jackpot coins | MINI 15× · MINOR 30× · MAJOR 100× (Grand is not a coin) | MINI 25× · MINOR 50× · MAJOR 150× · **GRAND 1000× as a coin** | MINI 15× · MINOR 30× · MAJOR 100× as coins · **GRAND 2000× = full board (15 symbols of any type)** |
| Special symbol | **BOOST star** (x2/x3/x5): multiplies every visible coin incl. jackpots. In the base game it also **collects** them as an instant win | **COLLECT** diamond, **reel 2 only**: gathers every visible coin. In the base game a COLLECT + any coin is an instant win | Three coloured specials land in the base game and do nothing there except fill their pot: **BOOST** (red, adds 2–10 × TB to every coin, a *payer*), **COLLECT** (blue, collects every coin into itself), **MULTI** (green, x2/x3/x5 on every coin, *then becomes a 2–10 × TB coin*). **MYSTERY** (feature only) reveals BOOST/COLLECT/MULTI/MINI/MINOR/MAJOR |
| Trigger | 6+ coin/jackpot/boost symbols · **Diamond Metre** (random trigger dressed as a metre) · **Buy 70×** · **Super Buy 300×** (2 guaranteed boosts, more boosts all round) | ≥1 coin on reel 1 + ≥1 coin on reel 3 + ≥1 COLLECT on reel 2 · **Extra Bonus Game** metre (random; adds the symbols needed) · no buy | 6+ coins/specials (specials count) · **a full POT** (12 levels, persistent per player) starts the feature with that booster active · **Lucky Spin** (server-announced base spin that guarantees the trigger; own intro, anticipation on all reels, no skip) · no buy |
| Pre-feature | — | **SUPER WHEEL** once per feature: diamond boost (raise coin values) · +1 / +2 extra collect (single→double→triple collector) · a jackpot | Pots decide which boosters are **active**; only active boosters land. Mystery can unlock the others |
| Stickiness | **All coins stick** | **Only COLLECTs stick**; coins are collected each respin and cleared (a "streak") | All coins stick |
| Board end | **G-R-A-N-D letters**: a column full of coins lights its letter, its coins **fly into the Total Win bar and the column clears**. All 5 letters = GRAND 1000× | Ends only when the respins run out; the collectors' values are summed | Full board (any symbol type) = GRAND |
| Reset | 3 respins, reset on every new symbol | 3 respins, reset on every new coin/jackpot/collect | 3 respins, reset on every new coin |
| Big-win tiers | 15 / 30 / 50 / 80 × TB | 20 / 30 / 50 / 100 × TB | 15 / 25 / 50 / 80 × TB |

### 1.3 The option space the kind must expose

These are the knobs that turn one template into either reference game (or a Lightning-Link classic):

- **Trigger:** `count` (N+ coins; say which symbol kinds count, since specials do in 3 Pots) ·
  `pattern` (per-reel requirements) · `buy` tiers (price, guaranteed specials) · `randomMetre`
  (presentation only, the server decides) · `persistentMeters` (below) · `luckySpin` (a
  server-announced base spin that guarantees the trigger: its own intro, all-reel anticipation,
  skip disabled).
- **Persistent meters (pots):** N independent meters, each filled by its own symbol, with a max level
  and visual size stages. Progress **persists per player between rounds** (server-owned state that
  must reach the client at boot and on every spin). A full meter is a deterministic trigger that
  **enters the feature with specific modifiers active**.
- **Active modifiers:** which specials may land in the respins is decided at entry (pot, wheel, buy);
  a mystery reveal can activate another for the rest of the round.
- **Stickiness:** `allCoins` (classic) · `collectorsOnly` (streak).
- **Respins:** start count, reset rule (`anyCoin` / `anySpecial`), cap.
- **Board end:** `fullBoardJackpot` (tier; which symbol kinds count as filling) · `columnLetters`
  (letters word, jackpot, clear-on-complete) · `none`.
- **Coin value table:** cash values (× TB, **decimals allowed**) and jackpot labels, and which reels
  each can land on.
- **Special symbols (each optional, each with its own value/multiplier table):** collector
  (single/double/triple, sticky, collects per respin or at the end) · multiplier (values, scope,
  whether it multiplies jackpots, **what it leaves behind**, e.g. becomes a coin) · payer (adds a
  value to every coin) · add-respins · upgrade · mystery (a reveal table that can include jackpots
  and inactive modifiers) · the **order** in which specials landing on the same respin apply.
- **Base-game instant collect** (collector or boost + coins pays without the feature).
- **Pre-feature modifier:** wheel with prize list.
- **Jackpots:** list of tiers (name, × TB, fixed). Progressive/platform jackpots are a separate topic
  (§3.3) and not part of the first build.
- **Board expansion** (rows unlock 3→4→5→6) — industry variant, not in either reference; later.

## 2. What we already carry (inventory, 2026-09-30)

| Area | State | Where |
|---|---|---|
| **Respin loop** | **EXISTS in the upstream `apps/price` sample (`superspin` mode) and nowhere else.** Sticky prize coins with a cash label, 3 respins that reset, a blank `X` strip symbol, `newStickySymbols` → `prizeWinInfo` collect. Never ported into `apps/lines`. | `apps/price/src/components/StickyBoard*.svelte`, `StickySymbol.svelte`, `SymbolPrize.svelte`, `apps/price/src/game/{types,stateGame.svelte,config}.ts`, `apps/price/src/stories/data/superspin_books.ts` |
| Reel board | **Column strips only** — one tween per column; no cell can be held while others spin. A per-cell hide seam exists (`ReelSymbol` `covered`/`removed`), and the tumble/swap-in-place overlay already has per-cell seats and tweens. | `packages/utils-slots/src/createReelForSpinning.svelte.ts`, `createEnhanceBoardSpin.ts`, `engine-game/src/game/gameState.svelte.ts`, `apps/lines/src/game/stateTumble.svelte.ts` |
| Value on a symbol | Partial: lines hardcodes `${multiplier}X` BitmapText; price renders a currency label. Engine `RawSymbol` has no `prize`/`jackpot`. | `apps/lines/.../Symbol.svelte:234`, `engine-game/src/game/types.ts` |
| Collect / count-up | Reusable: `boardMultiplierInfo` collect beat, `updateTumbleWin` running meter, `WinCountUpProvider` (`jumpTo`), free-spin outro count-up, win tiers. | `apps/lines/src/game/bookEventHandlerMap.ts`, `components-pixi`, `FreeSpinOutroDriver.svelte` |
| Respin counter | Reusable with care: the free-spin counter (lines shows `amount + 1`; price's superspin counts used spins). | `FreeSpinCounter.svelte`, `state-shared stateUi.freeSpinCounter*` |
| Mock RGS | Missing: protocols are `lines/book/ways/cluster/scatter`. The free-spin **open round over several `play`s** is the template for respins. | `scripts/mock-rgs-server.mjs`, `services/test-server/server.mjs:483`, `launcher mockProtocol.ts` |
| Facade | Missing respin/jackpot cases; unknown events pass through as `_name`. `parseCell` only yields `multiplier`; `gameType` is `basegame|freegame`. | `packages/rgs-translator-eagaming/src/engineFacade.ts` |
| Game kind lists | `holdAndWin` missing from **every** hand-copied list (roles.ts `GAME_KINDS`, editor `GAME_TYPES`, game-spec `GameTypeSchema`, publish-gate `GAME_TYPES`, `gen-flow-vocabulary.mjs`, `protocolFor`, `FULL_SCENE_SOURCES`, `TEMPLATES`, vocab `registry`, `DRIVEN_SEEDS`, `gameProfile` detectors). | see status file §"Touch list" |
| Kind gating in tools | Only narrow: `/symbols` state columns (`visibleStatesFor`), scene sets, flow vocab by `templateId`, config sections by `winModel`. **No gating** for Symbols sections, builtin components, Win Text, config symbol properties. Flow and seed **silently fall back to bookOf**. | tooling report in the status file |

## 3. The RGS contract — the biggest open question

### 3.1 What the partner's reference client does (read 2026-09-30)

The Play4Fun/HyperGaming generic slot core (`p4f-slotty-core`, on disk, read-only):

- **Has a generic respin feature:** each respin is its own context-less `play` (seq +1, with `gid`);
  progress comes from `playedBonusSpin {playing, bonusPlayed, spins}`; `spinTrigger.bonus` names the
  respin key and `occurs` the count; the round closes with `gameEnd` + `collect`. A "reset to 3" would
  surface as the server's `spins` count going back to 3 (inference — nothing handles it explicitly).
- **Has `symbolSetInMatrix {reel,row,symbol}`** — the most plausible existing carrier for held cells,
  but it carries **no value**.
- **Has NO coin values, sticky lists, collector events or per-cell data** in the generic core. A real
  H&W game would subclass the handler (`_handleEventUnknownEvent` etc.); no such game is in the drop.
- **Has a platform jackpot** — `platform.jackpots[] {id,name,value,minValue,maxValue}` (Mini/Minor/
  Major/Grand) refreshed on the balance heartbeat, won via `platform.gameRound.jackpot
  {winJackpotId,win}` with a `lockedPoint` balance hold. That is the **operator's progressive/mystery
  jackpot**, brand-gated, *not* the fixed coin jackpots of a Hold and Win.

### 3.2 Decision: mock-first with our own event family, partner confirmation owed

We cannot wait for the partner, and the engine should not be shaped around a guess of their wire.
So: **we define the engine-side book events** (§4.3), the **mock RGS speaks an invented wire family
for them** (precedent: `tumbleStep` / `multiplierCollect`, also invented), and the facade maps them.
When the partner gives us a Hold and Win sample (owed — ask for a real H&W game's responses or its
handler subclass), only the facade mapping changes.

**Persistent meters are server state.** 3 Pots-style pots survive between rounds per player, so the
RGS must own them and send them at boot (`config`/resume) and after every spin. The client never
computes a pot level. The mock keeps them per demo session.

**Owed to the partner (blocks production only, not authoring):** a sample round from a Hold and Win
game — how coin values, jackpot labels, held cells, the respin counter/reset, collectors, persistent
meters, the Lucky Spin flag and the feature total travel; whether fixed coin jackpots ever use `platform.gameRound.jackpot`.

### 3.3 Out of scope for the first build

The operator platform jackpot (`platform.jackpots[]`, lockedPoint, fake-spin teaser) — a separate,
kind-independent feature. Board expansion. Free spins inside a H&W game (the kind keeps the free-spin
scenes optional, so a hybrid can still be authored later).

## 4. The engine shape

### 4.1 Kind = `holdAndWin`, win model = lines, mechanic = a `holdAndWin` config block

Following [game-type-templates.md](game-type-templates.md): the base game pays by the existing
`lines` win model; the feature is a **mechanic** with a Game Config block, like `cascade` /
`reelBehaviour`. `holdAndWin` is a project **kind** (like `bookOf`), not a `winModel` arm.

### 4.2 The respin board — a dedicated per-cell board, not a rewrite of the reel board

> **Built (Phase 4c, 2026-10-01).** `engine-game` `respinBoard.ts` / `respinBoard.svelte.ts` and
> `apps/lines` `RespinBoard.svelte` + `holdAndWinPresentation.ts`. The decisions it fixed are in the
> status file's findings.

The shared reel board is column-strip based, and everything (anticipation, sequential stop, win
positions, tumble) assumes one reel per column. Rewriting it for per-cell spins would risk every live
game. Instead:

- **Base game** keeps the normal column reels.
- **The feature** mounts a **`RespinBoard`**: `numReels × numRows` one-cell reels, each with its own
  mask (reusing `createReelForSpinning` with a 1-row window), plus a **held layer** that draws the
  stuck coins. A respin spins only the unheld cells; a new coin moves from its cell reel into the
  held layer. Coins keep their value label.
- Hand-over at trigger/end is a swap between the two boards over the same seats (the swap-in-place
  seat maths already exists).
- Ported from `apps/price`: `StickyBoard*` / `StickySymbol` / `SymbolPrize` behaviour, rebuilt on
  engine-game primitives (not copied as an app fork).

### 4.3 Engine book events (the contract the flow, the mock and the facade share)

> **Built (Phase 4a, 2026-10-01).** The contract is code: `HoldAndWinEventFields` in
> `packages/engine-game/src/game/holdAndWin.ts`. The table below is the original sketch; where they
> differ the code wins — positions are visible 0-based, values ride on each cell's `RawSymbol`,
> trigger/end carry the §4.5 mode fields, and `meterLevels` / `randomMetreTrigger` / `cellsCleared` /
> `holdAndWinState` (the resume snapshot) were added. See the status file's findings.

| Event | Payload | Meaning |
|---|---|---|
| `reveal` (existing) | board with coin cells carrying `{value}` or `{jackpot}` | base-game board, coins labelled |
| `coinInstantCollect` | `collector:{reel,row}`, `from:[{reel,row,amount}]`, `total` | base-game collect/boost instant win |
| `meterUpdate` | `meter`, `level`, `max`, `from:[cell]` | a special flew into a persistent pot (also sent at boot) |
| `luckySpin` | — | this base spin is a guaranteed trigger (intro, all-reel anticipation, no skip) |
| `holdAndWinTrigger` | `coins:[cell]`, `respins`, `variant`, `activeModifiers:[…]`, `cause` (`count`/`pattern`/`meter:<id>`/`luckySpin`/`buy`) | feature starts; the triggering coins stick |
| `holdAndWinWheel` | `prize` (`boost`/`extraCollect:n`/`jackpot:<tier>`) | optional pre-feature wheel |
| `respinUpdate` | `left`, `total`, `reset:boolean` | counter changed (reset or decrement) |
| `respinReveal` | `cells:[{reel,row,symbol,value?,jackpot?}]` | the unheld cells' outcome for this respin |
| `coinsLand` | `cells:[cell]` | new coins stick (per-reel land cue) |
| `coinBoost` | `booster:{reel,row}`, `multiplier`, `cells:[{reel,row,from,to}]` | boost multiplies visible coins |
| `coinPay` | `payer:{reel,row}`, `amount`, `cells:[{reel,row,from,to}]` | payer adds a value to every coin |
| `mysteryReveal` | `cells:[{reel,row,becomes,value?,jackpot?}]`, `activates?` | mystery transforms; may activate a modifier |
| `specialBecomesCoin` | `cell`, `value` | e.g. MULTI turns into a coin after applying |
| `coinCollect` | `collector:{reel,row}`, `from:[{reel,row,amount}]`, `collectorTotal` | collector gathers (streak) |
| `columnComplete` | `reel`, `letter`, `amount`, `cleared:boolean` | Grand-style letter lit, column swept |
| `jackpotWin` | `tier`, `amount` | a jackpot is awarded (coin, letters or full board) |
| `holdAndWinEnd` | `coins:[{reel,row,amount}]`, `total` | per-coin collection into the total, then pay |
| `setWin` / `setTotalWin` / `finalWin` (existing) | — | normal win presentation + big-win tier |

A resume snapshot (`createBonusSnapshot`) must carry the held board, the counter and the running
total, so a reload mid-feature rebuilds the respin board.

### 4.4 Flights — things that travel from a cell to a target

Hold and Win is full of **flights**. Each one is a head that travels from a board cell to a target and leaves a particle trail behind:
- specials flying into their pot (3 Pots);
- coins flying into a collector (Hotfire, 3 Pots COLLECT);
- coins flying into the Total Win bar at the feature end, or on a Grand column sweep;
- a boost star's value flying to each coin.

The start point is known only at runtime (whichever cell the symbol landed in), and several flights can run at once. In the references the paths **bend around the cells that are showing a win** instead of crossing them. 3 Oaks' own particle names (`flyRed…Top` / `…Bottom`) suggest they pick between an over-route and an under-route per flight.

**What we already have:**
- **Trail.** An `/fx` emitter that follows a moving owner. The Rigger bone binding already drives `updateOwnerPos` every frame, and particles spawn in the container's space, so a moving owner leaves a trail.
- **Arrival.** Event-triggered effects (cue → effect).
- **Heads.** Spine/flipbook/sprite rendering.
- **Precedent.** A coded "fly to a point" in scatter's `MultiplierBoard`.

**What we don't have:** a flight primitive that computes the path.

**Plan — one engine primitive, authored once, reused by every flight:**
- **`flyTo(from, to, flight, { avoid })`** in engine-game resolves to a Promise when the head arrives. That lets a handler or flow step await it, or fire N flights with a stagger.
  - **Path.** A quadratic/cubic Bézier from the source cell centre to the target's anchor point. A target is a named layout node (pot, collector cell, total bar), looked up through the scene's node registry, so it follows the authored layout and the aspect ratio.
- **Avoidance.** The obstacle set is the rects of the cells currently showing a win (or any rect set the caller passes), padded.
  - The primitive tries a few candidate curves: bend left/right at a few strengths, then an over-route that leaves through the column's top edge. It samples each and keeps the first whose samples miss every padded rect; the cost is the curve length.
  - If none is clean, it picks the one with the fewest hits.
  - This is deterministic for a given board, so a replay or resume draws the same route. It costs a few dozen point-in-rect tests per flight.
- **Timing.** Duration comes from distance (speed plus min/max clamp) with an ease. A stagger per flight index spreads simultaneous flights, and a slam compresses the time without skipping the arrival: the pot still fills, just faster (the slam rules in docs/status/engine.md).
- **Arrival.** A cue per arrival (`flightArrive` with the target id), so the pot bump, the level up and the number increment happen on impact, not when the flight is fired.
- **Z-order.** Flights draw in their own layer above the board and below celebration overlays. The layer uses a fixed zIndex seat, never mount order (pixi-svelte freezes child order at mount).
- **Authoring — a `flights` block in the Symbols doc, keyed by flight kind** (`toMeter:<id>`, `toCollector`, `toTotal`, `boostBeam`):
  - head art (sprite / flipbook / spine clip);
  - trail effect (an `/fx` EffectDoc played as a moving emitter);
  - arrival effect;
  - path style (bend strength, over-route allowed, avoidance on/off with padding);
  - speed, ease and stagger;
  - which win rects to avoid.
  - It travels the normal ship chain (export → bake → pull → register), like `anticipation`. The `/fx` preview gets a "flight" mode: drag a start and an end and watch the route and trail.
- **Beams** (Grand's boost star to each coin) are a sibling primitive: a stretched sprite/spine from A to B with the same avoidance and arrival cue.

Phase 4 builds `flyTo` and a coded default (a plain glow trail) so unauthored games still read correctly. Phase 7 adds the `flights` authoring block and its `/fx` preview. Phase 5's vocabulary exposes `flyTo` as an action (source cell, target node, flight kind, await or not) plus the `flightArrive` event.

### 4.5 Game modes — a bonus is a different game, and modes queue

A Hold and Win feature is not a decoration on the base game. It is a **different game mode** with its own board (the respin board), screens, HUD, counter, music and rules. Other kinds have the same shape: free spins, a wheel, a pick game.

A spin can trigger **more than one** mode, and they must play one after another before the game returns to base. Some combinations:
- free spins that end in a Hold and Win;
- a wheel that leads into Hold and Win (Hotfire);
- two causes of the same feature on one spin (a pot fills while 6 coins land).

**Today (measured 2026-09-30) there are no modes.**
- The "mode" is one string, `stateGame.gameType`, with only two values: `basegame | freegame`. They are keyed off `paddingReels`.
- Three things write that string: each spin's `reveal`, the coded free-spin handlers, and the `setFreeGameType` / `enterFreeSpinOutro` flow actions.
- The FlowDoc is one flat graph. Functions are reusable subgraphs you call; groups are visual folding only. There is no mode scope, no enter/exit hook and no current-mode value.
- Book events play strictly in order (`playBook.ts` `sequence`). **Nothing queues features or knows one is pending.** Two features play in order only because the book lists them in order, and `freeSpinEnd` drops to base even when another feature follows.
- The XState machine has no feature states: a whole bonus runs inside the one `playGame`.
- Resume snapshots only free-spin events.

**Plan — a mode layer in the shared runtime, authored in the flow:**

- **Mode registry.** It lives in the Game Config and is declared per kind. A mode has:
  - an `id` (`basegame`, `freeSpins`, `holdAndWin`, `wheel`, `pick`…);
  - its **board** (`reels` with a `paddingReels` key / `respinBoard` / `wheel` / `none`);
  - its **scenes**: Scene Editor scenes tagged with a new role `mode` + `modeId`, mounted on enter and unmounted on exit;
  - its HUD variant, music, counter source and the values it exposes.
  
  `gameType` widens from the two-value union to the mode id. Existing games map `freegame` → `freeSpins`, so their behaviour doesn't change.
- **A mode stack plus a pending queue**, both engine state:
  - `enterMode(id, payload, { policy })` either **nests** now (push and play; when it exits, the mode below resumes) or **queues** (append to pending; it starts when the current mode exits).
  - When a mode exits and the stack is back at base, the engine pops the next queued mode before returning to idle. `returnToBase` fires only when both the stack and the queue are empty.
  - Two triggers for the same mode on one spin merge into one entry (3 Pots: the server already merges pot + coins into one feature with the modifier active).
  - The server's book stays the source of truth. The queue orders the **presentation**; it never invents a feature.
- **Generic book events.** `modeEnter { mode, cause, payload }` / `modeExit { mode, total }` are emitted by the facade and mock next to (or derived from) today's feature events.
  - `freeSpinTrigger` / `freeSpinEnd` stay as aliases that map to `modeEnter freeSpins` / `modeExit freeSpins`, so Book-of games are untouched.
  - Hold and Win's `holdAndWinTrigger` / `holdAndWinEnd` (§4.3) carry the same mode fields.
- **Flow authoring — per-mode sections of the graph.**
  - Each mode gets its own event sections: **On Enter**, **On Exit**, and that mode's book events. They live in a named mode scope of the FlowDoc (the schema gains `modes: { [id]: { graph } }` beside the global graph).
  - A signal goes first to the **active mode's** graph and then to the global graph. So "reveal" can mean something different in the respin board than in the base game without `branch` nodes on `gameType`.
  - New nodes:
    - **Enter mode** (id, policy nest/queue, payload pins);
    - **Exit mode**;
    - a **Mode trigger** event (fires on `modeEnter` for a chosen id);
    - an **On all modes finished** event (back to base: collect, big-win, idle).
  - The `/flow-v2` editor shows modes as tabs (Base game · Free spins · Hold and Win · Wheel …). Adding a mode tab offers that mode's vocabulary, the §4.3 events for Hold and Win.
- **Resume.** The snapshot carries the mode stack and queue plus each active mode's own state (for Hold and Win: held board, counter, running total, active modifiers, meter levels). A reload re-enters every mode on the stack in order without replaying intros.
- **As built (Phase 4M, 2026-10-01) — the rules the build settled:**
  - **Where it moves.** The stack moves at the play seam (`playBook.ts` `withModes`), on every
    dispatch path (coded, v1, v2): an event that ENTERS a mode opens it before it is presented (the
    event belongs to the mode it opens), an event that EXITS one closes it after. Rules:
    `engine-game` `modeStack.ts`; aliases: `modeEvents.ts`; reactive holder:
    `modeController.svelte.ts`; the game's instance: `apps/lines` `stateModes.svelte.ts`.
  - **`nest` is the default policy**, because it is the only one that matches book order without
    buffering events: the events after a trigger ARE the nested mode's. `queue` is for a book that
    announces a mode which plays later; its Mode trigger fires when it actually starts.
  - **The free-spin aliases keep their own game-type write.** `freeSpinTrigger`/`freeSpinEnd` write
    `stateGame.gameType` at their own moment (the coded handler, or the flow's `setFreeGameType`
    after the intro), so the mode layer skips exactly those two writes; every other transition sets
    the game type of the mode now on top (`GameModeDecl.gameType`, `respin` for Hold and Win).
  - **A mode section OVERRIDES the global graph** for the signals it handles (it does not run before
    it): `reveal` in the `holdAndWin` section replaces the global `reveal` while Hold and Win is on
    top, and an unhandled signal falls back to global. Mode triggers run the mode's own section then
    the global graph; `allModesFinished` runs the `basegame` section then global.
  - **Mode screens:** on the coded path the engine mounts a `role: 'mode'` screen while its mode is
    on the stack. Under a screen-driving v2 flow the flow mounts every screen, mode screens included
    (Mode trigger → Show), which is the 2026-09-02 owner rule for background screens. A mode's `hud`
    replaces the authored HUD while it is on top.
  - **Resume:** the snapshot keeps every stack-moving event, and `createBonusSnapshot` rebuilds the
    stack and queue silently (`restoreModes`, no transitions, no intro) before 4a's
    `holdAndWinState` replay redraws the board.
- **XState stays as it is.** Modes live inside `playGame`, because a Hold and Win feature is still one round (several `play`s, one `collect`). `getBetType` keeps deciding end-of-round and balance.

This is a **shared-runtime change for every game**, so it is its own phase (**Phase 4M**, below). Parity is the gate: every existing Book-of / lines / ways game must play byte-for-byte the same with `freeSpins` as a registered mode.

## 5. Tool by tool — what each authoring surface gets

**Cross-cutting first: one kind-capability source.** Today each tool gates on its own ad-hoc test
(`gameType === 'bookOf'`, `winModel`, cascade flags) and several gate on nothing. Add one
**`kindCapabilities(gameType, config)`** in `engine-layout` (e.g. `{freeSpins, bookReveal,
stackedPictures, cascade, holdAndWin, coinSymbols, winLines}`) and make `/symbols`, `/config`,
`/win-text`, the editor palette and the flow palette read it. This is what "hide the extra options"
means in practice. It also retires the five hand-copied kind lists in favour of one `GAME_KINDS`.

| Tool | Hold and Win gets | Hides for this kind |
|---|---|---|
| **Game Maker** | `holdAndWin` in the picker with two presets — **Classic sticky** (Grand-like 5×3) and **Collector streak** (Hotfire-like 3×3); scaffold seeds scenes, flow, **Game Config**, **Symbols** and **Win Text** defaults (today the last three aren't seeded for any kind); hub profile feature chips (`respin`, `jackpots`, `collector`, `boost`, `payer`, `mystery`, `pots`, `luckySpin`, `columnLetters`, `wheel`); a third preset **Pots** (3 Pots-like) | — |
| **Scene Editor** | `referenceLayouts/holdAndWin.ts` + template: `basegame`, `respinBoard` scene (new role `respinFeature`), `respinCounter`, `totalWinBar`, `jackpotBar` (MINI/MINOR/MAJOR/GRAND values, live × bet), `letters` (G-R-A-N-D), `wheel`, `pots` (N meters with level stages, bound to the meter values), `luckySpin` intro, `featureIntro` / `featureOutro` (total count-up), `jackpotWin` celebration, `buyFeature`/`buyConfirm`; new builtin components for counter / jackpot bar / letters / total bar | `specialBook`, free-spin intro/counter/outro (optional add) |
| **Flow editor** | `engine-flow-v2/src/reference/holdAndWin.ts` vocab: events §4.3; actions `showRespinBoard`/`hideRespinBoard`, `stickCoins`, `spinRespin`, `setRespinCounter`, `collectCoins`, `boostCoins`, `lightLetter`, `clearColumn`, `awardJackpot`, `showJackpotWin`, `countUpTotal`, `spinWheel`, `fillMeter`, `activateMeter`, `payCoins`, `revealMystery`, `playLuckySpinIntro`; cues `respinBoard*`, `coinLand`, `coinCollect*`, `coinBoost*`, `letter*`, `jackpot*`, `wheel*`, `totalWinBar*`; values `respinsLeft`, `respinTotal`, `jackpot.mini…grand`, `featureTotal`, `meter.<id>.level`, `activeModifiers`; a registered **driven seed** + choreography so a new project plays end-to-end with zero authoring | the Book-of expanding-symbol events/actions, tumble/multiplier-board entries |
| **Symbols SM** | symbol roles (the Game Config `special_properties` values): `coin`, `jackpot`, `collector`, `coinMultiplier`, `payer`, `mystery`, `meterSpecial` (flies to a pot), `blank`; states `coinIdle`, `coinLand`, `coinStick`, `coinCollect`, `coinBoost`, `jackpotReveal`, `mysteryReveal`, `flyToMeter`; a **coin value label** section (font, format per cash/jackpot, placement, per-tier styling) through the full ship chain; respin-cell spin blur / land FX | Book symbol VFX, bookIntro/bookIdle, stacked pictures, explosion / tumble pattern, clearReel, transition (unless used); win-line section stays (base game pays lines) |
| **Game Config** | `holdAndWin` block: trigger, respins, reset rule, stickiness, board end, coin value table (value, weight, reels), jackpot tiers (× TB), specials (collector/multiplier/payer/mystery, each with its value table and apply order), meters (count, max level, size stages, filling symbol, modifier it activates), Lucky Spin on/off, wheel prizes, buy tiers; symbol `special_properties` `coin`/`jackpot`/`collector`/`coinMultiplier`/`payer`/`mystery`/`meterSpecial`/`blank` (`coinMultiplier`, because lines already reads `multiplier`); validator + in-play gate; `data/gameConfig/holdAndWin.<pots|classic|collector>.json` defaults (generated from `packages/game-config/src/holdAndWinPresets.ts`); paytable UI shows coin rows as "value table", not pays | win-model picker locked to lines; scatter paytable hints |
| **Win Text** | `jackpots` captions (`MINI`…`GRAND`, award text "{jackpot} JACKPOT {amount}"), respin copy ("{count} RESPINS", "RESPINS RESET"), feature total ("BONUS WIN {amount}"), instant-collect toast; all harvested for Localization | `toast.expanded` ("on N reels", Book-of) |
| **Mock RGS** | `holdAndWin` protocol + generator for both presets, deterministic forced outcomes (trigger, full board/letters, each jackpot, boost, wheel prizes) for playtests | — |
| **Facade** | map the invented wire → §4.3 events; `parseCell` coin values/jackpot labels; `gameType: 'respin'`; resume of the held board | — |
| **Playtester** | `docs/playtest/<game>.md` playbook for both presets | — |

## 6. Build plan (phases — each a PR, each updates the status file)


**Owner decisions (2026-09-30):** **one template makes all three reference games** — Grand, Super
Hotfire Diamonds and 3 Pots of Egypt are *presets* of the same `holdAndWin` kind, not separate
templates, so every option in §1.3 that any of the three uses is core scope, not a later round. The
**first real game is 3 Pots of Egypt**. We build **against our own mock** now; the partner will
deliver their wire later, so the mock and the facade are built around one **wire-translation seam**
(the mock's wire family documented in `docs/reference/hold-and-win-wire.md`) that is expected to be
rewritten when the partner's format arrives — nothing above the facade may depend on the mock's wire.

0. **Hub + plan** (this doc, the status file). ✔ when merged.
1. **Kind plumbing + capability source** — one `GAME_KINDS`, `kindCapabilities()`, `holdAndWin` in
   every list (status file "Touch list"), game-spec symbol kinds, `protocolFor` → `holdAndWin`, and
   the silent-bookOf fallback fixed. No behaviour change for existing kinds (parity gate).
   Agent: `launcher-studio` + `invisible-flow` for the registry.
2. **Game Config `holdAndWin` block — the full option space of §1.3** (triggers incl. pattern, buy,
   random metre, persistent meters, Lucky Spin; stickiness; respins/reset; board end incl. column
   letters; coin value table with decimals and per-reel weights; specials collector / multiplier /
   payer / mystery with value tables, leave-behind and apply order; active modifiers; wheel;
   jackpots), normalizer, validator, `/config` UI section, and **three preset defaults** (`pots`,
   `classic`, `collector`). Agent: `invisible-game-config`. *Runs in parallel with 1.*
3. **Mock RGS `holdAndWin` protocol + wire contract** — the wire family (documented as the swap
   seam), a generator driven by the Phase 2 config for all three presets, persistent meters per demo
   session, forced outcomes for every beat (trigger by count/pattern/meter/Lucky Spin/buy, each
   special, mystery unlock, column letter, full board, each jackpot, wheel prize), a `pnpm check:*`
   fixture gate. Needs 2.
4. **Engine runtime** — `RawSymbol` coin value/jackpot, the coin value label, `RespinBoard` + held
   layer, §4.3 handlers + effects + cues, persistent-meter state at boot, resume snapshot, facade
   mapping of the mock wire. Engine change ⇒ a runtime release on merge: svelte-check + boot a lines
   game unchanged first. Agent: `engine-pixi-svelte`. Needs 3 (can start from the §4.3 contract).
   Build order follows 3 Pots first: sticky coins → payer/collect/multiplier → mystery → pots +
   active modifiers → Lucky Spin → full board; then column letters (Grand), collectors-only streak
   + wheel (Hotfire).
4M. **Game modes** (§4.5) — the mode registry in Game Config, `gameType` widened to a mode id, the mode
   stack + pending queue, `modeEnter`/`modeExit` with the free-spin events as aliases, the FlowDoc
   `modes` scopes + Enter/Exit/Mode-trigger/All-modes-finished nodes + mode tabs in `/flow-v2`, the
   scene role `mode`, and a mode-aware resume snapshot. Parity gate: every existing game unchanged
   with `freeSpins` as a registered mode. Agents: `invisible-flow` + `engine-pixi-svelte`. Needs 4a
   (the event contract); Phase 5 builds the Hold and Win mode's graph on top of it, and Phase 6's
   template tags its respin scenes with the `holdAndWin` mode.
5. **Flow vocabulary + driven seed** — `holdAndWin.ts`, registry, seed + choreography, publish gate,
   `gen-flow-vocabulary`. Agent: `invisible-flow`.
6. **Scene Editor template + components** — reference layout, template, roles, builtin components
   (respin board, counter, jackpot bar, total bar, pots, letters, wheel, Lucky Spin intro).
   Agent: `invisible-components`.
7. **Symbols SM** — roles, states, value-label section + ship chain, kind-gated sections.
   Agent: `invisible-symbols`.
8. **Win Text** — new families + harvest + gating.
9. **Game Maker** — the three presets in the picker, seed config/symbols/win-text, docs
   (`docs/tools/*`), playtest playbooks; build a 3 Pots sample first, then Grand and Hotfire samples,
   each played end to end on the mock.
10. **Partner wire** — when the partner delivers: rewrite the facade mapping (and bring the mock's
    wire in line so the mock keeps matching production), resume, replay; the checks owed on the live
    node.
11. **Beyond the three references** — board expansion, add-respins / upgrade specials, the operator
    platform jackpot (§3.3).

Phases 1 and 2 start now in parallel; 5–8 run in parallel once 4's event contract is merged (the
contract can land ahead of the rendering).
