# Game families: match-3 first, arcade next (Phase 10 plan)

> Status: **PLAN, for owner review. No feature code until the owner approves it.** This is Phase 10 of
> [rive-style-editor.md](rive-style-editor.md) §10. It is the separate design that §7.2 promised for
> games that are not slots. The owner approved starting it on 2026-10-20. Progress will live in the
> status files of the tools each phase touches ([flow](../status/flow.md),
> [engine](../status/engine.md), [component-editor](../status/component-editor.md),
> [game-config](../status/game-config.md), [game-maker](../status/game-maker.md)), not here.
>
> **Owner decision #6 (2026-10-20, recorded in rive-style-editor.md §12 #6):** the outcome source
> is **a per-game option, not a property of the family**. A match-3 or arcade game is either:
> - a **real-money** game whose results come from the RGS (the player's moves are presentation, as
>   in a cascade slot); or
> - a **skill / free-play** game whose own rules decide.
>
> Phase 10 supports both. Flow owns the rules logic only in a rules-decided game.
>
> Grounded against `main` 6b082c4 (2026-10-20). "Exists" means it is in that tree; "new" means it is
> proposed here.

## Contents

1. [Scope and non-goals](#1-scope-and-non-goals)
2. [Outcome source: the two paths](#2-outcome-source-the-two-paths-decision-6)
3. [Flow additions](#3-flow-additions-rive-style-editor-72)
4. [The mechanic layer](#4-the-mechanic-layer-small-code)
5. [Editor surfaces](#5-editor-surfaces-and-the-rive-later-items)
6. [Pipeline](#6-pipeline-create-build-bake-publish-boot)
7. [Testing and parity](#7-testing-and-parity)
8. [Phased build plan](#8-phased-build-plan)
9. [Open decisions for the owner](#9-open-decisions-for-the-owner)

---

## 1. Scope and non-goals

**In short:** match-3 comes first because most of it already exists. A match-3 board is a slot board
that does not spin: a grid of symbols, with matches that explode, fall and refill. The engine has
done that since the cascade work. Arcade comes second because it needs things nothing has today: a
per-frame loop, moving objects, collisions, and creating objects while the game runs.

### What "a family" means

A **family** is a group of game kinds that share one way of playing: slot, match-3 or arcade. All
current kinds are slots: `lines`, `ways`, `cluster`, `scatter`, `bookOf` and `holdAndWin`
(`packages/constants-shared/gameKinds.ts`).

The rule from [game-type-templates.md](game-type-templates.md) is that a game type is
`{ data, mechanic }`, never an app fork. This plan applies that rule one level up. **A new family is
new data, a new Flow vocabulary and one small mechanic module. It is never a fork of `apps/lines`,
and never a second copy of the engine.**

### In scope

- **Match-3 v1.** A board of gems. The player swaps two adjacent gems. A run of 3 or more explodes,
  the survivors fall, and new gems refill from the top. Cascades chain until nothing matches. A
  round is a limited number of moves. Both outcome sources are supported (§2).
- **Arcade v1.** A single-screen game with a frame loop: objects move, the player steers or taps,
  objects collide, and the game keeps score and lives. One sample genre, a catcher or dodger (§9
  #6). It is rules-decided first; an RGS-decided arcade game is a later, optional phase (§8, P10.10).
- **The Flow primitives both families need:** game variables, input / tick / timer events, and
  spawning (§3).
- **The editor surfaces they need,** including the Rive "Later" items that are prerequisites (§5).
- **The full pipeline:** a match-3 or arcade project is created in Game Maker, configured in
  `/config`, built in `/editor` and `/flow-v2`, and published and played like any game (§6).

### Non-goals (v1)

- **No physics engine.** Arcade motion is kinematic: velocity, bounds, and box/circle overlap. There
  is no rigid-body simulation, gravity solver or joints.
- **No match-3 specials in v1.** Striped / bomb / colour-bomb gems, boosters, blockers (ice, chains)
  and a level map are left out. The board module is shaped so specials can be added later as data:
  "a run of shape S makes special X" (§4.1, P10.5b).
- **No real-money skill games.** A rules-decided game never touches a wallet (§2.3). "Skill for
  prizes" is a regulated product of its own and is out of scope.
- **No multiplayer, no server-side leaderboards** and no persistent progression in v1.
- **No change to any slot game.** Slot projects keep their vocabularies, Flow docs, coded paths and
  pixels (§7).
- **No second runtime app** unless §6.4's recommendation is overturned (§9 #3).

---

## 2. Outcome source: the two paths (decision #6)

**In short:** each game says in its Game Config who decides the result. "RGS" means the server
decides everything that is worth money: the board, every refill and every win. The client only
shows it and passes on the player's choices. "Rules" means the game's own Flow and board module
decide, and no money is involved. The default is RGS, so no existing game changes.

### 2.1 How a game declares it

Game Config (`packages/game-config`) is the home. It is the doc the runtime already reads at boot
(`bakedGameConfig()` in `apps/lines/src/editor-scenes.ts:894` → `createGameConfig` in
`packages/engine-game/src/game/gameConfig.ts`). It is also the doc that the mock RGS is dealt from
(`GET /api/game-config/mock`) and that the publish gate already checks.

Two new optional fields on `GameConfigDoc` (`packages/game-config/src/types.ts:465`):

```ts
family?: 'match3' | 'arcade';        // absent ⇒ slot (every doc today)
outcome?: 'rules';                   // absent ⇒ 'rgs' (every doc today)
match3?: Match3Block;                // only when family === 'match3' (§4.1)
arcade?: ArcadeBlock;                // only when family === 'arcade' (§4.2)
winModel?: … | { type: 'match3'; minRun: number };   // a fifth arm of the existing union (RGS match-3 pricing)
```

This follows the `winModel` precedent exactly (game-type-templates.md Phase C):

- **Defaults are never stored.** The normalizer drops `family` when it would mean slot, and drops
  `outcome` when it would mean `rgs`. Every config authored before these fields existed therefore
  normalizes **byte-identically**, and no stored doc is rewritten.
- **The normalizer has to learn the fields first.** `normalizeGameConfigDoc`
  (`src/normalize.ts:322`) rebuilds the doc from a whitelist, so it would drop `family`, `outcome`,
  `match3` and `arcade` today. It also returns `undefined` for a doc with no `symbols` or
  `paddingReels`, which is one reason a match-3 doc keeps both (below). P10.1 teaches it the new
  fields.
- **Always read through a resolver,** `resolveFamily(doc)` and `resolveOutcome(doc)` (new, in
  `packages/game-config/src/family.ts`). No code reads the raw field. This is the same rule as
  `resolveWinModel()`.
- **The project's kind seeds the field.** The project's kind (`projects.gameType`, `GAME_KINDS`)
  gains `match3` and `arcade`. Game Maker writes `family` from the kind when it seeds the config.
  The runtime reads the config, not the project row, because the config is what reaches the bundle.
- **Validation follows the family.** A match-3 doc skips the payline checks, as a non-lines
  `winModel` already does, and gets board checks instead. Three existing rules also need a family
  arm:
  - An empty `betModes` is an **error** today (`src/validate.ts:195`). A rules game has no stake, so
    it is exempt.
  - The strips must number `numReels` and be at least as long as the visible rows
    (`validate.ts:67–91`). A match-3 board already satisfies this: one strip per column.
  - An RGS match-3 doc with no `winModel` would resolve to `lines` and get payline checks and lines
    pricing (`activeWinModel()`, `engine-game/src/game/gameConfig.ts:589`). So an RGS match-3 states
    the new `match3` arm: no paylines, priced on the whole bet (divisor 1) like `cluster`, and
    checked so that `minRun` fits the board.
- **The strips keep their meaning.** `paddingReels` stays the **in-play set** (`symbolsInPlay`,
  `src/inPlay.ts`). In a match-3 doc each column's strip is that column's **refill source**. A rules
  board refills a column by reading its strip from a seeded random stop, exactly as a reel strip is
  read, so the strips stay ordered strips and are not reinterpreted as weights. In an RGS game the
  strips only seat the cosmetic first board before `boardInit` lands. Either way the in-play gate,
  `/symbols` and the export keep working unchanged.
- **`/config` gets a picker** for family and outcome. Like the `winModel` picker, choosing the
  default deletes the field rather than writing it.

### 2.2 The RGS-decided path (real money)

**The guarantee, in one line: the client cannot decide money.** It can propose a move. It cannot
choose a gem, a refill, a match result or a win amount.

**Who validates a move.** The server. It owns the board and the client's board is a mirror of it.
The client may pre-check a swap locally on the server's own board, so that an obviously illegal swap
snaps back without a round trip. This is UX only. The server re-checks every move it receives and
answers an illegal one with a rejection that changes nothing.

**What the client sends.** A round on the Play4Fun-shaped wire
([play4fun-protocol.md](../reference/play4fun-protocol.md)):

```
bet+play                    → events: match3Board { board, movesLeft }            (opens the round, binds gid)
move {from:[c,r], to:[c,r]} → events: match3Move  { accepted, steps[], movesLeft, roundWin }
… one move request per player move, each a STORED action (seq advances by 1) …
collect                     → closes the round (as today)
```

- `move` is a new in-round action. It has the same shape as the partner's own player-choice
  actions, `pickRandomly` and `gamble`: a stored action carrying the player's choice, posted with
  `&gid=`. It is built with the existing `buildSingleAction`
  (`packages/rgs-translator-eagaming/src/translator.ts:86`).
- It advances the position (`seq`) by one **automatically**. The fetcher already advances by the
  number of stored actions in each body it posts (`eagamingFetcher.ts:308`,
  `storedActionCount`; only `config` is non-stored), so `move` needs no hand-written `advance`
  (one would double-advance). Our facade sends no in-round player action today, so this is the
  first.
- **A round that stays open across many player-paced requests is new.** Today the facade closes a
  round inside one call: `engineFacade.ts:2135–2141` plays any bonus loop, then posts `collect`. The
  round lifecycle (bet → book → end) is owned by `packages/utils-xstate/src/createPrimaryMachines.ts`.
  P10.6 adds an **interactive round** path to that machine (bet → board → await move ⇄ resolve →
  end → collect) and a `move` request. That request is exported from **both** transports, the
  default `packages/rgs-requests/src/rgs-requests.ts` and `packages/rgs-translator-eagaming/engine-facade.ts`,
  because the transport is chosen at build time by a Vite alias and the non-play4fun build must
  still compile.
- **The wire is ours, not the partner's,** exactly as `tumbleStep` and `multiplierCollect` are. It is
  labelled at both ends as a mock extension, to be replaced by a real provider's shape when one
  exists. The protocol reference already records the risk: our cascade vocabulary was invented, and
  a real capture will settle it (§9 #2).

**The book shape the engine sees.** `engineFacade.ts` translates the wire into engine book events,
reusing what the cascade already renders:

| Book event (engine) | New? | What it carries | Rendered by |
|---|---|---|---|
| `boardInit` | new | the starting board `RawSymbol[][]`, `movesLeft` | the existing `boardSettle` cue seats it on the reel board (§4.1) |
| `swap` | new | `from`, `to`, `accepted` | board view: two gems trade places, or swap and swap back |
| `tumbleBoard` | **exists** | `explodingSymbols: Position[]`, `newSymbols` (`apps/lines/src/game/typesBookEvent.ts:125`) | the existing `TumbleBoard` overlay (`bookEventHandlerMap.ts:324`) |
| `updateTumbleWin` | **exists** | the running win | existing handler |
| `movesLeft` | new | count | a HUD readout bound to it (§3.1) |
| `roundEnd` | new | `totalWin`, reason (`noMoves` / `movesUsed`) | Flow, then the existing win presentation |

One accepted move becomes `swap`, then N × (`tumbleBoard` + `updateTumbleWin`) for the cascade
chain, then `movesLeft`. This is the reason match-3 is cheap: **every step after the swap is the
cascade the shared runtime already plays.**

**Moves as presentation (decision #6's wording).** Decision #6 describes the player's moves in an
RGS game as presentation, as in a cascade slot. The client contract above is the same whichever of
the two server models below is chosen. The difference is entirely in the math:

- **Fixed at the bet (recommended, §9 #1).** The round's total is drawn when the bet is placed. Each
  move reveals the next part of it, and the server steers through the refills it chooses. The
  immediate match of a swap is a fact of the visible board, so the server cannot lie about it, but
  everything that falls in afterwards is its choice. RTP does not depend on skill, and the game
  certifies like a slot.
- **Resolved per move.** The server applies the swap and draws refills at random. Skill then moves
  RTP, which most jurisdictions treat as a different product.

**The guarantees, and how each is enforced in code, not by promise:**

1. **Server-owned board.** In an RGS game the board module's `refill` takes its gems from the book,
   never from a local RNG. In RGS mode the runtime constructs the board with no RNG at all
   (`createBoard({ rng: null })`), so a local refill throws. Gate:
   `check:match3-outcome-guard` (new).
   - The pre-check of item 4 and the `canSwap` UX check only *read* the server's board.
2. **No rules-only Flow nodes in an RGS game.** The Flow vocabulary is layered by outcome, the way
   `withAddOns` layers add-ons today (`packages/engine-flow-v2/src/reference/addOns.ts`):
   `withOutcome(vocab, 'rgs')` removes `board.resolve`, `board.refill`, `board.shuffle` and every
   write to a money-shaped value. The validator reports `rules-only-in-rgs` if a doc still holds
   one, and the publish gate (`checkFlowV2ForPublish`) refuses it.
3. **Money values come only from books.** Win, balance and bet stay engine values (`$engine.win`,
   etc., `standardVocab.ts`). A Flow game variable (§3.1) can never be bound to the win readout or
   the balance in an RGS game. The validator code is `variable-shadows-money`.
4. **Consistency check, not authority.** In dev and in the playtester, the client runs its local
   `findMatches` on the server's board and swap, and logs a mismatch with the server's
   `explodingSymbols` as a wire bug. It never overrides the server.
5. **A round can always finish without the client.** If the player leaves mid-round, the server
   settles it. Resume across player input is listed in the protocol reference under "Things we have
   no equivalent for", so this needs the partner (§9 #2). The mock implements it first (P10.6).

### 2.3 The rules-decided path (skill / free play)

**The guarantee, in one line: a rules game has no wallet.** It cannot take a stake or pay a win, so
there is nothing for a cheat to win.

**Who validates a move.** The board module (§4.1), called from Flow. A swap is legal if it makes a
run. The board resolves matches, gravity and refills from its **own seeded RNG**, passed in by the
runtime (`createBoard({ rng })`), so a seed replays a game exactly in production as well as in tests.
It does not rely on `?ie_determinism=` (`apps/lines/src/game/determinism.ts`). That is a test-only
harness that virtualizes the clock and seeds `Math.random`; the playtester and the current-games
harness use it on top.

**What the client sends.** Nothing to an RGS. This is **a runtime branch, not a separate
transport.** The transport is a build-time Vite alias (`PUBLIC_RGS_TRANSPORT` in
`apps/lines/vite.config.js`), and the one shared runtime is always built with `play4fun`
(`.github/workflows/runtime-release.yml:144`).

So the runtime reads `resolveOutcome(config)` at boot. For `rules` it never starts an RGS round:
- no bet, no play, no collect, no balance heartbeat;
- the primary machine's round path is not entered, and Flow drives play from `load` and input
  events instead.

Score, moves, level and lives are Flow game variables (§3.1).

The HUD's bet and balance parts are hidden in the game by the same `resolveOutcome(config)` read.
The runtime does not know the project's kind, and `kindCapabilities` is authoring-only: nothing in
`apps/lines` or `engine-game` imports it. The authoring tools get matching flags (`wallet`,
`betControls`) through `kindCapabilities`' `KindCapabilityConfig` (`kindCapabilities.ts:27`), fed
from the config, because `engine-layout` does not depend on `game-config`.

**Book shape.** None. The same engine events (`boardInit`, `swap`, `tumbleBoard`, …) are raised
locally by the board module, so **the presentation code is identical on both paths.** Only the source
of the events differs. This matters: the board view, the TumbleBoard overlay, the symbol states and
the authored Flow presentation are written once.

**Guarantees:**

1. **A rules game cannot reach a real-money RGS.** Publish refuses `outcome: 'rules'` with any
   delivery profile that carries a real RGS. At boot, the runtime refuses a rules config when it was
   launched with a real-money session (a delivery profile or an operator session id). The refusal
   uses the honest boot-failure screen that exists today (`[runtime] boot stopped —`,
   `editor-scenes.ts:2013`).
2. **The reverse holds too:** an RGS-decided config never takes the free-play branch.
3. **Score is not money.** Rules-game variables have no currency formatting and are never shown as
   a win amount. High scores, if any, are local to the device in v1 (§9 #8).

### 2.4 What changes on each path (summary)

| | RGS-decided | Rules-decided |
|---|---|---|
| Who owns the board | Server | Board module (client), seeded |
| Who validates a move | Server (client pre-check is UX only) | Board module |
| What the client sends | `bet+play`, `move` × N, `collect` | Nothing |
| Where refills come from | Book (`tumbleBoard.newSymbols`) | Seeded read of each column's strip (`paddingReels`) |
| Who computes the win | Server (`updateTumbleWin`, `roundEnd`) | Flow (score variable); no money |
| What Flow owns | Presentation only | Presentation **and** rules (goals, moves, win/lose) |
| Flow vocabulary | `withOutcome(…, 'rgs')`: no rules-only nodes | Full family vocabulary |
| HUD | Bet, balance, win (slot HUD) | Score, moves, goals; no wallet |
| Mock | `mock-rgs-server-match3.mjs` (new) | None; the free-play runtime branch |

---

## 3. Flow additions (rive-style-editor §7.2)

**In short:** Flow already has the control structure a game needs: events, branches, loops,
sequences, functions and modes. It is missing four things: memory (variables), a sense of time and
input (tick, timers, keys, drags), the ability to create and remove things while playing
(spawning), and the words for each family (vocabularies). All four are additive. A slot Flow doc
never contains them and runs exactly as today.

What exists today (`packages/engine-flow-v2`):

- **Node kinds** (`src/types.ts:152–176`): `event`, `gameSignals`, `modeTrigger`,
  `allModesFinished`, `action`, `fireCue`, `delay`, `showContainer`, `hideContainer`, `textMessage`,
  `playCinematic`, `branch`, `forEach`, `sequence`, `parallel`, `compute`, `functionCall` /
  `functionEntry` / `functionResult`, `group`, `enterMode` / `exitMode`, and the Phase 7
  `componentInstance` and `waitForState`.
- **Data accessors:** `item`, `index`, `input`, `engine`, `trigger`, `context` (`types.ts:102`).
  `$engine` is read-only and `compute` is pure (`add`/`sub`/`mul`/`div`/`member`).
- **Not there:** no variables of any kind, no tick / timer / key events (the only time primitive is
  `delay`), and no runtime spawning. Instance nodes only address instances already placed in a
  screen, and only top-level ones (`packages/engine-layout/src/lib/flowInstances.ts`).

### 3.1 Typed game variables, bound to component inputs

**In short:** named values that Flow keeps, such as score, lives, moves left or level. A component
can show one without any wiring: a score readout just says "my value is `score`".

- **Format:** `FlowDoc.variables?: FlowVariable[]`, where
  `{ id, type: 'int'|'float'|'bool'|'string'|'enum<…>', initial, scope: 'game'|'round'|'mode' }`.
  - `round` variables reset when a round starts.
  - `mode` variables live in `FlowDoc.modes[id]` and reset on `enterMode`.
- **Nodes:**
  - `setVariable` (exec; one data-in).
  - `changeVariable` (exec; `add` / `sub` / `toggle`; clamps to optional `min` / `max`).
  - A new accessor kind, `var`, so any data-in can read `$var.score`.
  - An entry node, `onVariable` (`changed` / `crosses` a threshold, e.g. `lives` reaches 0). This
    is how "game over" is written without polling.
- **Binding to components.** Component inputs already have a `source`: "a `number` input the engine
  feeds", a registered value-source name such as `winAmount` or `balance`
  (`packages/engine-layout/src/lib/types.ts:1676–1680`). `flowInstanceInterface()` already drops
  inputs that have one (`componentInterface.ts:112–118`).
  - **Numbers come almost free.** Each Flow variable is registered as a value source named
    `var:<id>` in the existing registry (`registerComponentValues.ts` / `registerFlowValueSource.ts`,
    resolved through `linesValueResolver`). A number input with `source: 'var:score'` then updates on
    every change with no wire, and with **no change** to `ComponentInstance`.
  - **`bool` and `text` bindings are new work.** `source` is number-only today:
    `ComponentInstance.svelte:941` skips any other kind, and the launcher normalizer keeps `source`
    only on number inputs (`componentStorage.ts:922`), so a bool or text binding would be dropped on
    save. P10.3 widens both, behind the keep-unknown gates.

  This is the part of Rive's view models we need (rive-reference.md §4 deferred "view models" to
  here). We do **not** build Rive's full view-model system; variables plus the existing interface
  cover it. **Seeing and binding variables:** the Variables panel in `/flow-v2`, plus a source picker
  in the Component Editor's input row. The 9d read-only **Data tab** is not built yet. When it lands
  it lists the variables too, but P10.3 does not wait on it (§5).
- **Where the values live.** Not in `FlowInterpreter`. That class is private to a run and is
  created fresh for every event (`runFlowEvent`, `src/runtime.ts:875–884`; also `:1023`, `:1052`,
  `:1155`).
  - The store lives in the game-side holder, beside the interpreter handle in
    `apps/lines/src/game/flowV2InterpreterHolder.ts`. It is reached through the env (`FlowV2Env`,
    `runtime.ts:61`) and the run context, as `$engine` reads are today.
  - Chains run concurrently, so the ordering rule is explicit: a write applies **synchronously at
    the node that makes it**. `changeVariable` is one atomic read-modify-write; there is no
    interleaving inside a node. The last write in execution order wins.
  - Change notifications are batched to one per frame, so a cascade of ten score changes does not
    re-render ten times.
- **Validator:** codes `variable-unknown`, `variable-type`, `variable-scope` (a `mode` variable read
  outside its mode), and `variable-shadows-money` (§2.2).

### 3.2 Input, tick and timer events

**In short:** Flow can react to time passing and to the player's hands, not only to the server's
books.

- **Pointer.** Component listeners exist, but only `down`, `up`, `enter`, `leave` and `click`
  (`NODE_LISTENER_EVENTS`, `types.ts:367`; wired in `LayoutNodeView.svelte:1759`). No pointermove
  handler exists anywhere in `engine-layout`. New listener events:
  - `move`;
  - `dragStart`, `drag` and `dragEnd`, with `x`, `y`, `dx`, `dy`;
  - `swipe`, with a direction enum and a threshold.

  These are the Rive "pointer move/drag" Later item. They surface on instance nodes as `event:<e>`
  outputs through the Phase 6/7 path that exists today, so they need no new **Flow** plumbing. They
  do need **layout schema** work:
  - Today's listener carries no coordinates (`LayoutNodeView.svelte:1759–1763`).
  - An event payload value can only be a number, a bool, `{input}` or `{key}`
    (`EventPayloadValue`, `types.ts:380`). A new `{pointer: 'x'|'y'|'dx'|'dy'}` payload kind is
    needed, with normalizer and keep-unknown support.
  - A drag must keep tracking off the node, so it listens on `globalpointermove` and
    `pointerupoutside`, not on node-local handlers.

  **Align Target** (Rive's "follow the pointer" listener action) lands with them as a fifth
  listener action.
- **Board cell input.** A board-level hit-test maps a pointer position to a cell. It is the inverse
  of the resting-seat expressions `getSymbolX` / `getSymbolY`
  (`packages/engine-game/src/game/gameState.svelte.ts:242`), so it follows the authored grid pitch,
  lead and nudge. The match-3 vocabulary turns a drag or swipe from cell A into a `swap(A, B)`
  intent (§3.4).
- **Keys.** A project-level input map, `FlowDoc.inputs?: { action: 'left', keys: ['ArrowLeft','a'] }[]`,
  and an entry node `onInput { action, phase: down|up }`. Flow reads actions, not raw keys, so
  rebinding a key does not touch the graph.
- **Tick.** An entry node `onTick { every?: ms }` with a `dt` payload.
  - Per-frame work belongs to the mechanic (§4), not to Flow. Flow's tick is for game rules: spawn a
    meteor every 800 ms, speed up every 10 s.
  - The validator therefore forbids awaits in a tick chain (`tick-async`: no `delay`, no awaited
    `fireCue` or `playCinematic`) and warns under `every: 100` ms.
  - The tick is driven by one ticker callback, the pattern `FlightLayer.svelte:51–58` already uses
    for `tickFlights`. Under `?ie_determinism=` it runs on the harness's virtual clock like
    everything else.
- **Timers.** Actions `startTimer { id, ms, repeat }`, `stopTimer`, `pauseTimer`; an entry node
  `onTimer { id }`. They pause when the game pauses.
  - **In game,** timers live in the same game-side holder as the variables, driven by the ticker.
  - **In the headless preview,** a scheduler is new work. The preview clock (`src/preview.ts:159–175`)
    only adds up the awaited `delay`s of a single chain; it cannot fire a repeating `onTimer` entry.
    P10.3 turns it into a small virtual-time event queue that fires timer and tick entries
    deterministically. The `check:flow-time-events` gate pins it.

### 3.3 Spawning, despawning and `forEach` over the live set

**In short:** create a copy of a component (an enemy, a coin, a falling star) at a place on the
screen while the game runs, remove it later, and loop over "all enemies alive right now".

- **Today the only dynamic path is the `repeater` layout node** (`types.ts:1163–1194`,
  `Repeater.svelte`, `registerRepeaterSources.ts`). It renders one `ComponentInstance` per item of a
  source the game registers at boot. It is used by the buy menu and the HUD menus. It lays items out
  in a row or grid; it does not place freely, does not address an item from Flow, and has a known
  ship gap: per-item `componentId` overrides are not collected for the bake.
- **New layout node kind `spawnLayer`.** It is a container whose children are created at runtime.
  - **Fields:** `{ spawnable: componentId[], placement: 'free'|'grid', grid?: {cols, rows, pitch}, cap }`.
  - **Rendering** reuses `ComponentInstance` exactly as the repeater does.
  - **`spawnable` is declared on the node** so the export can collect every component a game may
    spawn. This is rule 8: a spawned component must ship. It closes for spawn layers the gap the
    repeater still has.
  - **`cap`** bounds the live count. A spawn over the cap is dropped and logged; it never grows
    without limit.
- **Flow nodes:**
  - `spawn { layer, componentId, at: {x,y} | {cell} }` → a data-out `instance<componentId>`, a new
    pin type.
  - `despawn { instance }`.
  - A new `instanceRef` node: the Phase 7 instance node, with its pins derived from the same
    interface (`flowInstanceInterface()`), but fed a handle instead of a placed node id. Set its
    inputs, fire its triggers, wait for its states.
- **Live sets.** A `spawnLayer` exposes its live instances as a `list<instance<…>>` through a new
  accessor kind, `live` (`$live.<layerId>`). The `Accessor` union (`types.ts:102`) has no such kind
  today, and the `$engine` keys are a closed set (`LINES_ENGINE_KEYS`).
  - `forEach` already iterates any list (`runForEach`, `runtime.ts:558`), so "for each enemy, if it
    is below the floor, despawn it" needs no new loop.
  - `runForEach` iterates the array it is handed **without copying it**. So the `live` accessor
    returns a **fresh array** on every read, which makes a despawn inside the loop safe.
- **Events from spawned instances.** These are the instance's own interface events (`event:<e>`),
  delivered to `instanceRef` chains with the handle in `$trigger`.
- **Match-3 does not need spawning.** Gems are board cells (§4.1). Spawning arrives with arcade
  (P10.7). Match-3's floating score pops can use it once it exists.

### 3.4 Per-family vocabularies

**In short:** each family gets its own palette of events and actions in `/flow-v2`, as each slot
kind has today.

Vocabularies are registered in `packages/engine-flow-v2/src/reference/registry.ts`
(`TEMPLATE_VOCABULARIES`: `bookOf`, `ways`, `cluster`, `scatter`, `holdAndWin`; `VOCABULARY_FALLBACKS`
maps `lines` to `bookOf`, and an unknown id falls back to `bookOf`). The new files are `reference/match3.ts` and `reference/arcade.ts`, each with a
starter seed in `drivenSeed.ts`. The fallback stays as it is, and the new ids are registered
explicitly, so a match-3 doc never silently opens on the Book-of palette.

**Match-3 vocabulary** (`MATCH3_VOCAB`). Built on the standard palette's presentation surfaces
(screens, cues, sounds, text) but **not** its reels / spin / paylines surfaces:

| Kind | Name | Both paths | Rules only | Notes |
|---|---|---|---|---|
| event | `onBoardReady` | ✓ | | `boardInit` landed |
| event | `onSwap {from, to, accepted}` | ✓ | | |
| event | `onMatch {groups: list<MatchGroup>}` | ✓ | | `MatchGroup = {symbol, cells, shape: line3/line4/line5/L/T}` |
| event | `onCascadeStep {step, groups}` | ✓ | | one per `tumbleBoard` |
| event | `onSettled` | ✓ | | the chain ended |
| event | `onNoMoves` | ✓ | | RGS: from `roundEnd`; rules: `hasMoves() === false` |
| event | `onRoundEnd {totalWin, reason}` | ✓ (RGS) | | |
| action | `board.select(cell)` / `board.hint()` | ✓ | | presentation |
| action | `board.swap(from, to)` | ✓ | | RGS: sends `move`; rules: resolves locally |
| action | `board.resolve()` / `board.refill()` / `board.shuffle()` | | ✓ | removed by `withOutcome('rgs')` |
| cues | the existing tumble cues | ✓ | | `tumbleBoardExplode`, `…SlideDown`, … (Phase F) |

**Arcade vocabulary** (`ARCADE_VOCAB`):

- events `onTick`, `onInput`, `onCollide {a, b, tagA, tagB}`, `onEnterZone`, `onLeaveBounds`,
  `onTimer`;
- actions `spawn`, `despawn`, `setVelocity`, `moveTo`, `setTag`, `startTimer`, `stopTimer`.

Collision filters are by **tag** (§5: the Rive "tags" Later item).

---

## 4. The mechanic layer (small code)

**In short:** two small modules of plain logic, with no drawing in them. One knows how a match-3
board works and the other knows how arcade objects move and collide. Everything else — what a gem
looks like, what happens on a match, the score, the sounds — is data authored in the tools.

### 4.0 Where it lives

A new dependency-free package, **`packages/engine-mechanics`** (new). It holds `board.js` and
`motion.js`, written as plain ESM JavaScript with hand-written `.d.ts` beside them. That is the
pattern `packages/engine-cinematic/src/cinematicEval.js` already uses, and it is chosen for the same
reason: two very different callers must share it.

- **The client.** `apps/lines` and `engine-game`, through the workspace dependency.
- **The mock RGS.** `scripts/mock-rgs-server-match3.mjs` (new) imports it by relative path, as
  `services/test-server/makeMock.mjs` already imports `../../scripts/mock-rgs-server.mjs`.
  - The test-server image copies only the files its Dockerfile lists, and only `scripts/*.mjs`
    today (`services/test-server/Dockerfile:10`); nothing under `packages/` reaches it. P10.6 adds
    `packages/engine-mechanics/src/board.js` **and** the package's `package.json`
    (`"type": "module"`, as `engine-cinematic`'s has). Without the latter, Node falls back to syntax
    detection.
  - Any other non-package consumer follows the `scripts/sync-cinematic-eval.mjs` precedent.

One module, two callers, so the mock and a rules-decided game can never disagree about what a match
is. The cascade work already paid for the alternative: `evaluateClusters` lives only in the mock
(`scripts/mock-rgs-server.mjs:540`) and has no client twin.

This also triggers a point game-type-templates.md Phase B left open. It said the mechanic seam
should be "declared once as a single mechanic interface … the moment a second one exists". Match-3
is that moment, so P10.5 declares it.

### 4.1 The match-3 `board`

- **Grid model.** Column-major `RawSymbol[][]` with `Position {reel, row}`. This is the shape the
  slot board, `tumbleBoard` and `respinBoard.ts` already use, so no adapter is needed between the
  board and the cascade presentation.
- **Pure functions:**
  - `createBoard({cols, rows, pool, rng})`
  - `canSwap(board, a, b)`
  - `swap`
  - `findMatches(board, {minRun})` → `MatchGroup[]` (runs of `minRun`+ in rows and columns, merged
    into L/T shapes)
  - `clear(board, groups)`
  - `gravity(board)` → moves
  - `refill(board, source)`, where the source is a book's `newSymbols` or the seeded pool
  - `resolve(board)`, the cascade loop, emitting steps shaped as `tumbleBoard` events
  - `hasMoves(board)`
  - `shuffle(board, rng)`
- **Reuse.** The board is drawn by the **existing** slot board, still mounted, with its spin
  suppressed:
  - **The cascade cannot run without that board.** `TumbleBoard.svelte` adopts its cells from
    `stateGame.board[reel].reelState.symbols` (`:331`) and mints refills with
    `stateGame.board[reel].createSymbols` (`:279`). The `tumbleBoard` handler broadcasts
    `boardHide` / `boardSettle` / `boardShow` to that same board, and `Game.svelte:2500–2522` mounts
    `<TumbleBoard/>` beside `<Board/>`. So a match-3 game still mounts `<Board/>` and its reels.
    "Non-spinning" means the spin is never started, not that the component is swapped out.
  - **The handlers accept locally raised events.** They are plain book events through
    `playBookEvents`, which is what lets the rules path (§2.3) reuse them unchanged.
  - The `reelGrid` layout node gives the authored geometry (cell size, pitch, lead, nudge,
    perspective). `reelGridGeometry` (`apps/launcher-api/src/routes/(app)/editor/editorCanvas.helpers.ts:929`)
    previews it in the editor, pinned to the engine by `scripts/verify-reel-grid-geometry.mjs`.
  - Seats come from `getSymbolX/Y`.
  - Cells come from `BoardBase.svelte`, cascades from `TumbleBoard.svelte` and `stateTumble.svelte.ts`,
    and the explosion order from `engine-layout/src/lib/tumblePattern.ts`.
  - Gem looks come from **symbol states in `/symbols`**: `explosion` already exists and is not
    book-only.
- **The swap is the real new presentation work, and it is not just a tween.**
  - Cells live in per-reel (column) objects, and the cascade seat is y-only
    (`ReelSymbolCascadeSeat = { y: Tween<number> }`, `packages/utils-slots/src/createReelForSpinning.svelte.ts:27`).
    A horizontal swap moves a cell **between two reels**, and that model has no x seat for it.
  - **Recommended:** carry the two gems across on the existing **flight** layer (`FlightLayer.svelte`,
    `flights.svelte.ts`), then write the swapped symbols into both reels and re-seat them. A
    vertical swap can tween the y seat directly.
  - **The alternative to evaluate** in P10.5's first slice is Hold and Win's per-cell board:
    `packages/engine-game/src/game/respinBoard.ts` (pure cell rules), `respinBoard.svelte.ts`
    (one-cell reels) and `apps/lines/src/components/RespinBoard.svelte`. Every cell is its own reel
    there, but that board has no cascade, so it would need the tumble rebuilt on it. The flight
    route keeps the cascade, which is most of the value.
  - The **select / hint** highlight may become new symbol states, `select` and `hint`, offered only
    to `match3` through `kindCapabilities`.
- **Config, `GameConfigDoc.match3`:**
  - `minRun` (default 3);
  - `diagonal: false` (reserved);
  - rules only: `moves`, `goals` (e.g. `{type:'score', target}` or `{type:'collect', symbol, count}`)
    and `scoreTable` (points per run length);
  - RGS: moves come from the server; `scoreTable` is ignored, and the paytable prices wins as for a
    cascade slot.

  The grid size reuses `numReels` / `numRows`. The refill source is each column's `paddingReels`
  strip (§2.1).
- **Specials (P10.5b, optional).** A `specials` table, `shape → special symbol`, plus a per-special
  clear pattern (row / column / radius). It is data, read by `findMatches` / `clear`, with no new
  code path per special.

### 4.2 The arcade tick loop, movement and collision

- **`motion.js`:**
  - `step(bodies, dt)` (position += velocity · dt, clamped to bounds, with optional wrap);
  - `overlaps(bodies, pairsByTag)` (box and circle, with a uniform-grid broad phase above ~64 bodies);
  - `inZone`.

  A **fixed timestep** (60 Hz accumulator) makes a seed replay exactly, at any frame rate.
- **The loop** is one ticker callback per arcade screen, in `engine-game` (new
  `arcadeLoop.svelte.ts`). It runs: read input → `step` → write each spawned instance's `x`/`y`
  → `overlaps` → queue Flow events (`onCollide`, `onLeaveBounds`) → dispatch them after the frame.
  Flow is never inside the integration step.
- **Config, `GameConfigDoc.arcade`:** play-field bounds, `fixedHz`, and a per-component body
  (`{shape, w, h | r, tags, solid}`). The body could equally live on the `ComponentDef`; §9 #7
  recommends the config, to keep game rules out of shared components.

---

## 5. Editor surfaces and the Rive "Later" items

**In short:** the editor needs to show a board, a play field, variables, spawn layers and the new
Flow nodes. Several Rive features we put off (rive-reference.md §5 "Later") are needed here, and
each one is assigned to the phase that first needs it.

### 5.1 By surface

| Surface | What it needs | Phase |
|---|---|---|
| **`/config`** | Family + outcome picker; the `match3` / `arcade` blocks; family-aware validation | P10.1 |
| **Game Maker** | `match3` / `arcade` in the kind list (`selectableGameKinds()`), a seed config per outcome (`apps/launcher-api/src/lib/data/gameConfig/match3.rules.json`, `match3.rgs.json`) | P10.5 |
| **Scene Editor (`/editor`)** | A `match3` layout template (`packages/engine-layout/src/lib/templates/`): board screen with a non-spinning `reelGrid`, a score / moves / goals HUD; later an `arcade` template with a `spawnLayer` play field; the `spawnLayer` node (placeholder drawing like the repeater, plus its `spawnable` list) | P10.5, P10.7 |
| **Component Editor** | Pointer move / drag / swipe listeners and Align Target in `EditorListeners.svelte`; the input `source: var:<id>` binding in Properties | P10.4, P10.3 |
| **`/symbols`** | `select` / `hint` states for gems (match-3 only, via `kindCapabilities`) | P10.5 |
| **`/flow-v2`** | A **Variables** panel (declare / type / initial / scope); the `setVariable`, `changeVariable`, `onVariable`, `onTick`, `onTimer`, `onInput`, `spawn`, `despawn` and `instanceRef` nodes in `AddNodePalette.svelte`; the match-3 / arcade palettes; Preview runs the board module on its virtual clock with a seed (rules) or forced books (RGS) | P10.3, P10.5, P10.7 |
| **Data tab** (9d, read-only; **not built yet**, Phase 9 has shipped through 9c) | When 9d lands it lists Flow variables too. P10.3 does not depend on it: its Variables panel and the input-row source picker carry the binding | after 9d |

### 5.2 Scheduling the Rive "Later" items

| Rive Later item (rive-reference.md §5) | Why a family needs it | Lands in | Size |
|---|---|---|---|
| **Pointer move / drag listeners + Align Target** | Swipe-to-swap; drag a paddle; a slider | **P10.4** | M |
| **View models** | Replaced by Flow variables + `source: var:<id>` (§3.1), later shown in the 9d Data tab. Not built as Rive's | **P10.3** | (in P10.3) |
| **Tags** | Arcade collision filters (`enemy`, `pickup`); a `spawnable` group | **P10.8** | S |
| **N-slice** | Goal panels, progress bars and HUD frames that resize per board size and device layout | **P10.9** | M |
| **Rulers and guides** | Laying out a play field and board precisely | **P10.9** | S |
| **Graph Editor + Elastic / Bounce** | Match-3 "juice": gems that land with a bounce, pops that overshoot | **P10.9** (Elastic/Bounce as `CinematicEase` presets can land earlier, with P10.5) | M |
| **Blend states (1D)** | An arcade character's idle → run, blended by speed | **P10.10** (only if the arcade sample needs it) | L |
| **Text modifiers** | Per-glyph score pops | Stays **Later**; not needed for v1 | — |

---

## 6. Pipeline (create, build, bake, publish, boot)

**In short:** a match-3 game is made, shipped and played through the same pipeline as every game
today. It needs no new asset class. The two new things are a mock RGS for RGS-decided match-3 and a
free-play mode for rules-decided games. The recommendation is to keep **one** runtime for all
games.

### 6.1 Create (Game Maker)

- `GAME_KINDS` gains `match3` and `arcade` (`packages/constants-shared/gameKinds.ts`). Its
  consumers derive from that one list, and an unknown id is treated as a custom kind, so older
  readers degrade safely.
- **Game Maker's kind picker is the exception.** `selectableGameKinds()`
  (`apps/launcher-api/src/lib/server/gameKinds.ts:31`) offers a kind only once `engine-layout` has a
  **full scene set** for it (`listFullSceneSets()`). So `match3` appears in Game Maker in the same
  change that adds its layout template (P10.5), not in P10.1.
- Game Maker asks for the outcome (RGS / Rules) when the kind is `match3` or `arcade`, and seeds:
  - the config (`family`, `outcome`, `match3` block, pool strips);
  - the layout template;
  - the starter Flow from `drivenSeed.ts`;
  - the symbol set (gems).
- `kindCapabilities()` gains the family flags for the **authoring tools**: `wallet`, `betControls`
  and `board`, plus `freeSpins: false`, `winLines: false` and `holdAndWin: false`. The other tools
  then simply do not offer slot sections to a match-3 project. The game itself never reads
  `kindCapabilities`; it reads the config (§2.3).

### 6.2 What Game Config holds

Covered in §2.1 and §4: `family`, `outcome`, `match3` / `arcade` blocks, symbols, paytable (RGS
only), and `numReels` / `numRows` / `paddingReels` reused. Nothing a slot doc holds is moved or
renamed.

### 6.3 Build, bake, publish (rule 8)

- **No new R2 asset class.** A match-3 game is made of scenes, components, symbols, timelines,
  sounds, fonts, config and Flow, and every one of them already travels export → `deploy/` → bake →
  pull → register (`runtimeBundle.ts` and the `*Export.ts` exporters).
- **One gap to close, P10.7:** the export must collect every `spawnLayer.spawnable` component id
  (and its art) as it collects placed instances. `check:art-scope` is extended to fail a spawnable
  component that does not ship.
- **Publish** (`apps/launcher-api/src/lib/server/publishGame.ts`) keeps its gates. It gains:
  - the outcome gates of §2.2 and §2.3;
  - `protocolFor('match3')` → `'match3'` for an RGS game, or a `'freePlay'` protocol for a rules
    game (no mock RGS; the test server serves the runtime only). The new protocols must be added in
    **every** list of protocols, because a protocol a list does not know falls back to `lines`
    silently:
    - `mockProtocol.ts:20`;
    - `MOCK_PROTOCOLS` in `testServerManifest.ts:219`, which warns about exactly this;
    - the test server's own `MOCK_PROTOCOLS` / `protocolOf` (`services/test-server/server.mjs:240–245`);
    - the desktop `PUBLIC_RGS_GAME` mapping (`launcherProfile.ts:88`), which `protocolFor` feeds;
  - `runtimeFor()` unchanged: it still returns `SHARED_RUNTIME_ID`.
- **Delivery** (`build-delivery.mjs`): an RGS match-3 delivery waits on the partner wire (§9 #2).
  A rules game is refused for any real-money delivery profile.

### 6.4 Boot: the shared runtime or its own app? (recommendation)

**Recommendation: boot non-slot games in the shared `apps/lines` runtime,** behind a family branch
read from the config.

Today `Game.svelte` always mounts `<Board />` (`apps/lines/src/components/Game.svelte:2500`), and
the runtime branches on config (`activeWinModel()`, the Hold and Win blocks, the coin board). It
never branches on a template. The family branch is one more branch of the same kind, driven by
`resolveFamily(config)`:
- **Match-3** keeps `<Board />` mounted (the cascade needs it, §4.1), never starts a spin, and adds
  `<Match3Input />` (cell hit-test, swap flights, select / hint) beside it.
- **Arcade** mounts `<ArcadeStage />` (the play field and loop) instead of the reel stack.

**There are no lazy chunks.** The runtime is built with SvelteKit's `bundleStrategy: 'inline'`, or
`'single'` for embed builds (`packages/config-svelte/index.js:87`). Both produce **one** bundle with
dynamic imports inlined. So the family code ships inside every game's runtime bundle, slots
included. It never *runs* for a slot game, but slot players download it.

P10.5 measures the size cost and reports it in its PR. If the cost is too high, the choices are a
second runtime (option B) or a split bundle strategy. A split bundle changes how every game loads,
so it would be a pipeline change of its own.

| | **A. Shared runtime + a family branch (recommended)** | B. A second runtime app (`apps/arcade`) |
|---|---|---|
| Reuse | Everything: RGS facade, HUD, Flow interpreter, components, symbols, board, cascade, determinism, boot screen, live assets | Must first extract the symbol renderer and cascade, which are still in `apps/lines` (`stateTumble.svelte.ts:22`), or copy them |
| Releases | One `runtime-release.yml`, one versioned `_runtime/lines@<v>` | A second release pipeline, a second `current.json`, a second rollback |
| Harness | The current-games harness already builds one runtime per side | It must learn a second runtime |
| Drift | None: one copy | The exact failure game-type-templates.md "Why this exists" describes |
| Risk to slots | Real: every family change touches the slot bundle, so every phase must prove 0 changed (§7) | Low: separate bundle |
| Bundle size | Slots download the family code too (one inlined bundle); measured per phase | Separate |
| Seam | `runtimeFor()` stays a constant | `runtimeFor()` (`publishGame.ts:137`) is already the seam: it would return `'arcade'` |

Option A wins on reuse and drift. Its two costs are risk to slots, which this repo already has the
tooling to measure (§7), and a bigger download, which P10.5 measures. Option B stays available:
`runtimeFor()` is the seam if a family ever needs bespoke compiled code, or its size becomes a
problem. Arcade shares the least with slots, so P10.8 re-checks the choice before it starts
(§9 #3).

---

## 7. Testing and parity

**In short:** no slot game may change, and this is proved, not promised, before every merge. Each
phase also adds its own checks, and a sample match-3 game gets a playtest script so the playtester
agent can play it.

### 7.1 Slot games stay identical, every phase

Under the Director pipeline-change rules, every Phase 10 PR is a pipeline change:

1. **Docs stay byte-identical.** New fields are optional, and defaults are dropped (§2.1). Every
   stored Game Config, Flow doc, layout and `ComponentDef` normalizes unchanged. This is proved by
   `check:doc-readers-unknown-fields` and `check:save-keeps-unknown-blocks`, plus a new
   `check:family-defaults-identity` that normalizes every committed seed config and fixture and
   diffs the bytes.
2. **Published snapshots are untouched.** No Phase 10 code rewrites R2.
3. **The runtime bundle's change is accounted for.** `scripts/bundle-modules.mjs` reads the one
   bundle's source map (module set + per-module hashes). Because the bundle is one inlined file
   (§6.4), the family's modules appear in it as **new modules**. The rule is that the diff may list
   only new modules plus the named shared modules a phase had to edit (e.g. `Game.svelte`'s family
   branch, the interpreter). Each edited module is named in the PR, with the reason, and covered by
   item 4. Any other changed hash fails the review.
4. **The current-games harness reports 0 changed screens** (`scripts/current-games/`, ADR-0004).
   Every live game is rendered on main's and the branch's runtime with a fixed seed and compared by
   pixel diff under `tolerance.json`. The `regression-guardian` agent runs it.
5. **`check:all`, the launcher `check:*` gates and `check:svelte`** stay green, and the svelte-check
   baseline does not rise.

### 7.2 New gates, per phase

| Phase | New gate | Proves |
|---|---|---|
| P10.1 | `check:family-defaults-identity`, `check:game-config-family` | Defaults dropped; family validation; `/config` picker mirrors the normalizer |
| P10.2 | `check:board-mechanic` | Match finding (runs, L/T), gravity, refill from book vs seeded pool, cascade chain, `hasMoves`, a seed replays identically |
| P10.3 | `check:flow-variables`, `check:flow-time-events` | Scopes reset correctly; `onVariable` thresholds; `tick-async` rejected; timers on the virtual clock; `var:` bindings |
| P10.4 | `check:component-pointer-drag` | The move / drag / swipe events and Align Target; the cell hit-test is the inverse of `getSymbolX/Y` over the perspective lattice |
| P10.5 | `check:match3-rules`, `check:flow-publish-gate` (extended with the match-3 starter) | A starter rules game plays headless to a goal; the free-play branch sends no RGS request |
| P10.6 | `check:match3-outcome-guard`, `check:match3-wire` | RGS mode has no local RNG; `withOutcome('rgs')` strips rules-only nodes; facade translation fixtures (`move` → `swap` + `tumbleBoard`…); `seq` advances by 1 per move; replay at the same seq; the interactive round opens, takes N moves and collects once; every protocol list knows `match3` |
| P10.7 | `check:flow-spawn`, `check:art-scope` (extended) | Spawn cap; despawn inside `forEach`; spawnable components ship |
| P10.8 | `check:arcade-motion` | Fixed-timestep determinism; overlap by tag; bounds |

### 7.3 Playtest playbook for a sample match-3

The playtest playbook is a new file, `docs/playtest/match3-sample.md`, written in P10.5 in the shape
of `docs/playtest/ways.md`. It drives the `game-playtester` agent. Its outline:

1. **Boot** the rules sample with a fixed board seed (and `?ie_determinism=<seed>` for the clock).
   Expect the board seated on the authored grid, no console errors, and score 0 with N moves.
2. **An illegal swap** snaps back; moves are unchanged.
3. **A legal swap** of a known pair (from the seed): the gems explode in the authored pattern,
   fall, and refill. Score rises by `scoreTable[run]`; moves drop by 1.
4. **A chain:** a seed with a two-step cascade fires `onCascadeStep` twice, then `onSettled`.
5. **No moves:** a seed that dead-ends shuffles (rules) and shows the authored message.
6. **Goal reached** → the win screen; **moves used** → the lose screen; restart resets the round
   variables.
7. **The RGS sample** (P10.6) on the test server's `match3` mock. Bet → board; move → steps; the
   balance changes only by `roundEnd`; a refresh mid-round resumes on the same board.
8. **Screens** for the current-games harness (`scripts/current-games/screens/match3.json`): board
   ready, mid-cascade, round end. They are added the day the first match-3 game goes live.
   - The harness today plays **forced books** through the mock's authoring channel. An RGS match-3
     fits that once the mock can force a board and a move.
   - A rules game has no books, so its screen script must **drive input**: scripted swaps at named
     cells, with the board seed pinned. P10.5 adds that step type to the harness's screen-script
     format.

---

## 8. Phased build plan

**In short:** ten small, shippable steps. Match-3 rules games are playable after P10.5, and
real-money match-3 (on our mock) after P10.6. Arcade follows. Every step is gated as in §7, and no
step changes a slot game.

| # | Phase | Delivers | Main code | Size |
|---|---|---|---|---|
| P10.0 | **Plan + decisions** (this doc) | Owner review of §9; ADR-style sign-off recorded here | docs | S |
| P10.1 | **Family and outcome in Game Config** | `family`, `outcome`, `match3` / `arcade` blocks and the `match3` win-model arm (optional, defaults dropped; the normalizer's whitelist learns them); `resolveFamily` / `resolveOutcome`; family-aware validation (paylines, empty `betModes` for rules games, board bounds); the `/config` picker; `GAME_KINDS` + `kindCapabilities` flags. No runtime behaviour yet | `packages/game-config`, `constants-shared`, `engine-layout/kindCapabilities.ts`, `/config` | S–M |
| P10.2 | **The board module** | `packages/engine-mechanics/board.js` (+ `.d.ts`) with the full match-3 rule set, fixtures. No caller yet | new package | M |
| P10.3 | **Flow variables, timers, tick** | §3.1 + §3.2 (tick / timers / keys): format, validator; the variable and timer store in the game-side holder, reached through the env; the preview's virtual-time event queue; the Variables panel; `var:<id>` value sources (numbers), and `source` widened to bool / text | `engine-flow-v2`, `apps/lines` (`flowV2InterpreterHolder.ts`, value sources), `/flow-v2`, `engine-layout` (`ComponentInstance`), `componentStorage.ts` | L |
| P10.4 | **Pointer move / drag / swipe + Align Target** | Rive Later item; the listener events with the new pointer payload kind (normalizer + keep-unknown); global move / up-outside tracking; the board cell hit-test | `engine-layout` (`LayoutNodeView`, `types.ts`), `EditorListeners.svelte` | M |
| P10.5 | **Match-3, rules-decided, end to end** | `MATCH3_VOCAB` + seed; the family branch in the shared runtime (`<Board/>` kept, spin never started, `<Match3Input />`); the swap on the flight layer (first slice: flights vs the per-cell respin board, §4.1) and the select / hint states; the free-play runtime branch; the layout template and full scene set, which is what puts `match3` in Game Maker; seed config; publish gates; the declared mechanic interface (game-type-templates Phase B); scripted-input steps in the harness's screen scripts; the bundle-size cost reported; a sample game and its playbook | `engine-flow-v2/reference/match3.ts`, `apps/lines`, `engine-game`, `engine-layout` templates, `scripts/current-games/`, launcher | L |
| P10.5b | *(optional)* **Match-3 specials** | The `specials` table (§4.1) | `engine-mechanics`, `/config` | M |
| P10.6 | **Match-3, RGS-decided** | The `move` action and events (ours, labelled); the **interactive round** path in the primary machine (a round open across player-paced requests); the `move` request exported from both transports; `mock-rgs-server-match3.mjs` (deals from the project's config, fixed-at-bet math, resume mid-round), with the Dockerfile copying `board.js` + its `package.json`, and `match3` added to every protocol list; facade translation; `withOutcome('rgs')`; the outcome guards; the RGS sample. **Live real money waits on the partner (§9 #2)** | `rgs-translator-eagaming`, `rgs-requests`, `utils-xstate`, `scripts/`, `services/test-server`, `engine-flow-v2`, launcher | L+ |
| P10.7 | **Spawning** | `spawnLayer` node, `spawn` / `despawn` / `instanceRef`, `live:<layer>` sets, cap, the ship-chain collection of spawnables | `engine-layout`, `engine-flow-v2`, `apps/lines`, exporters | M–L |
| P10.8 | **Arcade, rules-decided** | `motion.js`, the fixed-step loop, tags, `ARCADE_VOCAB` + seed, `<ArcadeStage />`, the arcade layout template, a catcher / dodger sample + playbook. Re-checks §6.4 before starting | `engine-mechanics`, `engine-game`, `engine-flow-v2`, `apps/lines`, launcher | L |
| P10.9 | **Editor polish (Rive Later)** | N-slice; rulers and guides; the Graph Editor; Elastic / Bounce eases | `/editor`, `engine-cinematic` (ease presets), `engine-layout` | M each |
| P10.10 | *(optional, after a decision)* **Arcade on the RGS; blend states** | A server-decided "prize" arcade (the server sends the result, the arcade plays to it); 1D blend states if the sample needs them | `rgs-translator-eagaming`, `engine-layout` state machine | L |

**Why this order.**

- P10.1–P10.2 are cheap, invisible and unlock everything else.
- P10.3–P10.4 are the generic Flow and input pieces both families need, and they are useful to slots
  too (a timer, a drag slider).
- P10.5 is the first playable non-slot game, built mostly from cascade parts that already exist.
- The RGS path (P10.6) comes after the rules path, because the rules path proves the presentation
  with nothing external in the way. The RGS path then only swaps the source of events, which §2.3
  made identical by design.
- Spawning waits for arcade because match-3 does not need it.

---

## 9. Open decisions for the owner

Each has a recommendation. None blocks P10.1–P10.4.

1. **RGS match-3: outcome fixed at the bet, or resolved per move?**
   - *Recommend:* **fixed at the bet.** The player's moves are presentation (decision #6's wording),
     RTP does not depend on skill, and the game certifies like a cascade slot.
   - Per-move resolution makes skill move RTP, which is a different regulated product.
2. **Whose wire for RGS match-3?**
   - *Recommend:* **ours for the mock now** (labelled like `tumbleStep`), and **no live real-money
     match-3 until the partner confirms or provides the shape**, including resume mid-round, which
     their protocol does not cover today.
   - If the math is ours, the wire is ours to define, as game-type-templates.md Phase F already says.
3. **Shared runtime or a separate runtime app?**
   - *Recommend:* **the shared `apps/lines` runtime** (§6.4), re-checked before arcade.
   - The runtime is one inlined bundle, so slot players also download the family code (it never
     runs for them). P10.5 reports the size, and the owner accepts it or chooses option B.
4. **Can a rules-decided game ever involve money or prizes?**
   - *Recommend:* **no.** Rules games are free play, demo or promo only, with no wallet. Skill for
     prizes is a separate regulated product and is out of scope.
5. **Match-3 v1 scope.**
   - *Recommend:* **plain gems and a moves-limited round** (a score goal in rules games; moves from
     the server in RGS games).
   - Specials are an optional P10.5b. Boosters, blockers and a level map come later.
6. **First arcade sample.**
   - *Recommend:* **a single-screen catcher or dodger** (tick, spawn, collide, score, lives).
   - It exercises every new primitive without physics.
7. **Where an arcade body's shape and tags live: Game Config, or the `ComponentDef`?**
   - *Recommend:* **Game Config.** Game rules stay out of shared components, which are presentation
     only (rive-style-editor.md §2). The tags themselves are the Rive tags feature, on nodes.
8. **High scores for rules games.**
   - *Recommend:* **on the device only in v1.** A server leaderboard is a backend and an anti-cheat
     problem of its own.
9. **Gems as symbols (`/symbols`) or as components?**
   - *Recommend:* **symbols.** They reuse the symbol states (`explosion` already exists), the
     explosion pattern, the in-play gate and the ship chain. Components remain for HUD and
     overlays.
