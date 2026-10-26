# Game families: match-3 first, arcade next, cards after (Phase 10 plan)

> Status: **PLAN APPROVED (owner, 2026-10-20): all nine §9 decisions accepted as recommended.
> STARTED 2026-10-23: the owner gave the go-ahead for Phase 10. P10.1–P10.8 are built; progress
> lives in [status/game-families.md](../status/game-families.md).**
>
> **Amended 2026-10-22 from the owner's questions:** whole tools are shown or hidden per family
> (§6.5); `/config` shows only the family's sections (§6.2); arcade grows past one screen in three
> tiers, with characters, movement, jumps and a scrolling camera (§4.3, §4.4, P10.11–P10.13);
> Salmons is the arcade reference project (§1); card games are a fourth family with a plan of their
> own (§10). New decisions §9 #10–#19.
>
> **Owner answers, 2026-10-22:** Salmons is the 100-player real-time multiplayer game (each player a
> salmon, a bear or a fisherman), so multiplayer is **in scope for arcade** as tier A4 (§4.5,
> P10.14–P10.16); character data lives in Game Config; the card family is confirmed; card-game PvP
> stays later. Later the same day: Colyseus is the game server, and Salmons is isometric; its art
> gets a pass before the rebuild (§1). §9 #13–#17 and #19 decided; #18 decided 2026-10-25 with the
> A4 design.
>
> This is Phase 10 of
> [rive-style-editor.md](rive-style-editor.md) §10. It is the separate design that §7.2 promised for
> games that are not slots. The owner approved starting it on 2026-10-20. Progress lives in
> [status/game-families.md](../status/game-families.md), with each tool's own detail in the status
> file of the tool a phase touches ([flow](../status/flow.md), [engine](../status/engine.md),
> [component-editor](../status/component-editor.md), [game-config](../status/game-config.md),
> [game-maker](../status/game-maker.md)), not here.
>
> **Owner decision #6 (2026-10-20, recorded in rive-style-editor.md §12 #6):** the outcome source
> is **a per-game option, not a property of the family**. A match-3 or arcade game is either:
> - a **real-money** game whose results come from the RGS (the player's moves are presentation, as
>   in a cascade slot); or
> - a **skill / free-play** game whose own rules decide.
>
> Phase 10 supports both. Flow owns the rules logic only in a rules-decided game.
>
> Grounded against `main` 6b082c4 (2026-10-20); the 2026-10-22 amendments against `main` 8db411a.
> "Exists" means it is in that tree; "new" means it is proposed here.

## Contents

1. [Scope and non-goals](#1-scope-and-non-goals)
2. [Outcome source: the two paths](#2-outcome-source-the-two-paths-decision-6)
3. [Flow additions](#3-flow-additions-rive-style-editor-72)
4. [The mechanic layer](#4-the-mechanic-layer-small-code)
5. [Editor surfaces](#5-editor-surfaces-and-the-rive-later-items)
6. [Pipeline](#6-pipeline-create-build-bake-publish-boot)
7. [Testing and parity](#7-testing-and-parity)
8. [Phased build plan](#8-phased-build-plan)
9. [Decisions (owner)](#9-decisions-owner)
10. [The card family (outline)](#10-the-card-family-outline)

---

## 1. Scope and non-goals

**In short:** match-3 comes first because most of it already exists. A match-3 board is a slot board
that does not spin: a grid of symbols, with matches that explode, fall and refill. The engine has
done that since the cascade work. Arcade comes second because it needs things nothing has today: a
per-frame loop, moving objects, collisions, and creating objects while the game runs.

### What "a family" means

A **family** is a group of game kinds that share one way of playing: slot, match-3, arcade or card.
All current kinds are slots: `lines`, `ways`, `cluster`, `scatter`, `bookOf` and `holdAndWin`
(`packages/constants-shared/gameKinds.ts`).

A family decides three things in the pipeline, not one: which **tools** a project sees (§6.5), which
**Game Config** sections it holds (§6.2), and which sections each tool offers inside itself
(`kindCapabilities`, §6.1).

The rule from [game-type-templates.md](game-type-templates.md) is that a game type is
`{ data, mechanic }`, never an app fork. This plan applies that rule one level up. **A new family is
new data, a new Flow vocabulary and one small mechanic module. It is never a fork of `apps/lines`,
and never a second copy of the engine.**

### In scope

- **Match-3 v1.** A board of gems. The player swaps two adjacent gems. A run of 3 or more explodes,
  the survivors fall, and new gems refill from the top. Cascades chain until nothing matches. A
  round is a limited number of moves. Both outcome sources are supported (§2).
- **Arcade v1 (tier A1).** A single-screen game with a frame loop: objects move, the player
  steers or taps, objects collide, and the game keeps score and lives. One sample genre, a catcher
  or dodger (§9 #6: a Salmons slice). It is rules-decided first; an RGS-decided arcade game is a
  later, optional phase (§8, P10.10).
- **Arcade past one screen (tiers A2 and A3, added 2026-10-22).** Characters that act on their own,
  player controllers and paths (A2, §4.3); a world bigger than the screen with a following camera
  and parallax, then gravity, jumps and painted levels (A3, §4.4).
- **Arcade online (tier A4, added 2026-10-22).** Real-time rooms of up to 100 players on a game
  server of ours, because Salmons needs them (§4.5). A4 gets a design doc of its own before it is
  built.
- **Card games** (Magic / Hearthstone style) are a fourth family. This plan only outlines them
  (§10); they get a design of their own before any build.
- **The Flow primitives both families need:** game variables, input / tick / timer events, and
  spawning (§3).
- **The editor surfaces they need,** including the Rive "Later" items that are prerequisites (§5).
- **The full pipeline:** a match-3 or arcade project is created in Game Maker, configured in
  `/config`, built in `/editor` and `/flow-v2`, and published and played like any game (§6).

### Non-goals (v1)

- **No physics engine.** Arcade motion is kinematic: velocity, acceleration, bounds and box/circle
  overlap, plus (from A2) solid bodies that stop a mover and (A3) one constant gravity for jumps.
  There is no rigid-body simulation: nothing rolls, stacks, trades momentum by mass or hangs on a
  joint.
- **No match-3 specials in v1.** Striped / bomb / colour-bomb gems, boosters, blockers (ice, chains)
  and a level map are left out. The board module is shaped so specials can be added later as data:
  "a run of shape S makes special X" (§4.1, P10.5b).
- **No real-money skill games.** A rules-decided game never touches a wallet (§2.3). "Skill for
  prizes" is a regulated product of its own and is out of scope.
- **No multiplayer before A4.** Tiers A1–A3 are single player. Real-time multiplayer is arcade
  tier A4 (§4.5), because Salmons needs it (§9 #16); card-game PvP stays later. **No server-side
  leaderboards** and no persistent progression (accounts, unlocks) in Phase 10.
- **No change to any slot game.** Slot projects keep their vocabularies, Flow docs, coded paths and
  pixels (§7).
- **No second runtime app** unless §6.4's recommendation is overturned (§9 #3).

### Reference project: Salmons (owner, 2026-10-22)

**Salmons** is the owner's arcade game, and the target the arcade tiers are built towards
(§9 #13).

- **The game:** real-time multiplayer for up to **100 players**. Each player is a **salmon**, a
  **bear** or a **fisherman**. A salmon jumps up the river and moves around it, avoiding the bears'
  attacks and the fishermen.
- **Where it is today:** the portal has the project `salmons` (client `invisible_wall`) with no
  published game. The game itself lives outside this repository (`GuiltyForever/Salmon-`): a
  Colyseus 0.15 game server (Node.js) and a PixiJS 8 + Svelte 5 client. Its server already has much
  of the shape A4 needs: the room owns the state, players send inputs, and every rule runs on the
  server in one 60 Hz `update()`; state patches also go out at 60 Hz. What A4 changes is in
  [realtime-multiplayer.md](realtime-multiplayer.md) §2.
- **How it comes onto the engine:** the client is **rebuilt on the shared runtime as data**
  (screens, components, characters, Flow), never ported in as a second engine (the rule in "What a
  family means"). The server keeps Colyseus, and its `update()` rules are replaced by
  `engine-mechanics`, so the server and the client's prediction run one simulation (§4.5).
- **Its art comes first (owner, 2026-10-22).** It was made as a test and is not ready for the
  pipeline: loose images instead of atlas sheets, two JPEGs whose backgrounds are cut out while the
  game loads, one drawing per character at three different angles (a side-view salmon, a top-down
  bear, and a fisherman drawn in code), no animation frames or facing directions, and the riverbed,
  water and sea drawn in code. An **art pass (S0)** fixes this in today's tools (ComfyUI, Atlas
  Maker, Flipbook, FX) before the rebuild: one isometric angle, characters animated per facing,
  transparent props, diamond tilesets, all in the `salmons` project. It needs no Phase 10 step, so
  it can start whenever the owner says go. **The owner said go on 2026-10-26.** Much of it was
  already done in the Salmon repository by then (its `docs/art-pass.md`: the art in the
  pipeline's sheet and clip formats, the look and the generation recipes). What is left is
  generating the characters' clips; the work list is in [status/salmons.md](../status/salmons.md).

| Tier | What Salmons needs from it |
|---|---|
| A1 (P10.8) | Nothing on its own; the first sample becomes a single-screen Salmons dodger with its art (§9 #6) |
| A2 (P10.11) | Three playable characters with their own controls and **abilities** (the bear's swipe, the fisherman's hook); the river's **current**; bots, run by brains, that fill empty places |
| A3 (P10.12–P10.13) | A long river world with a following camera, drawn **isometric**; the salmon's **jump** (a `hop`); diamond tiles |
| A4 (P10.14–P10.16) | Rooms of 100; the server owns the game; prediction and smoothing on the device |

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
family?: 'match3' | 'arcade';        // absent ⇒ slot (every doc today); 'card' comes with §10's plan
outcome?: 'rules';                   // absent ⇒ 'rgs' (every doc today)
match3?: Match3Block;                // only when family === 'match3' (§4.1)
arcade?: ArcadeBlock;                // only when family === 'arcade' (§4.2)
winModel?: … | { type: 'match3'; minRun: number };   // a fifth arm of the existing union (RGS match-3 pricing)
```

The fifth arm is never stored (§9 #20): `resolveWinModel()` builds it from `match3.minRun` for any
match-3 doc, so `minRun` has one home. A slot doc never stores `outcome` (§9 #25).

This follows the `winModel` precedent exactly (game-type-templates.md Phase C):

- **Defaults are never stored.** The normalizer drops `family` when it would mean slot, and drops
  `outcome` when it would mean `rgs`. Every config authored before these fields existed therefore
  normalizes **byte-identically**, and no stored doc is rewritten.
- **The normalizer has to learn the fields first.** `normalizeGameConfigDoc`
  (`src/normalize.ts:322`) rebuilds the doc from a whitelist, so it would drop `family`, `outcome`,
  `match3` and `arcade` today. It also returns `undefined` for a doc with no `symbols` or
  `paddingReels`, which is one reason a match-3 doc keeps both (below). An arcade doc has neither,
  so that rule gets a family arm: an arcade doc normalizes without them. P10.1 teaches it the new
  fields and the arm.
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
  default deletes the field rather than writing it. A slot project is never shown it (§9 #22).

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

Tiers A2 and A3 add to it (§4.3, §4.4):

- events `onCharacterState {instance, from, to}`, `onHit {attacker, target, ability}`, `onLanded`,
  `onEnterView`, `onLeaveView`;
- actions `character.setState`, `camera.follow`, `camera.moveTo`, `camera.shake`,
  `camera.setAutoScroll`;
- the camera's position as two read-only `$engine` keys, so Flow can spawn ahead of the view.

A4 adds `onPlayerJoined` and `onPlayerLeft` (§4.5).

---

## 4. The mechanic layer (small code)

**In short:** two small modules of plain logic, with no drawing in them. One knows how a match-3
board works and the other knows how arcade objects move and collide. Everything else — what a gem
looks like, what happens on a match, the score, the sounds — is data authored in the tools.

### 4.0 Where it lives

A new dependency-free package, **`packages/engine-mechanics`** (new). It holds `board.js`,
`motion.js` and, from tier A2, `behaviours.js` (§4.3), written as plain ESM JavaScript with
hand-written `.d.ts` beside them. That is the
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

  A level's static shapes (solids, one-way solids, zones) are indexed once per level in the same
  grid, so a body tests only the cells it touches, and the step works on plain objects. Salmons'
  server, which tested every body against all ~1,700 of its river's shapes each tick, filled a core
  at about 50 players until it did both
  ([realtime-multiplayer.md](realtime-multiplayer.md) §2.1, §6).

  A **fixed timestep** (60 Hz accumulator) makes a seed replay exactly, at any frame rate.
- **The loop** is one ticker callback per arcade screen, in `engine-game` (new
  `arcadeLoop.svelte.ts`). It runs: read input → `step` → write each spawned instance's `x`/`y`
  → `overlaps` → queue Flow events (`onCollide`, `onLeaveBounds`) → dispatch them after the frame.
  Flow is never inside the integration step.
- **Config, `GameConfigDoc.arcade`:** play-field bounds, `fixedHz`, and a per-component body
  (`{shape, w, h | r, tags, solid}`). The body could equally live on the `ComponentDef`; §9 #7
  recommends the config, to keep game rules out of shared components.

### 4.3 Characters, controllers and paths (tier A2, P10.11)

**In short:** a character is a component that moves and decides on its own: a guard that patrols,
a fish that flees, a boss that chases. Its look is a component, as today. Its brain is new, and it
is game data, not part of the component.

| Part | Example | Home | Today |
|---|---|---|---|
| **Look** | idle, run, jump, hit and die animations, switched by inputs such as `speed` or `grounded` | A component: its timelines and state machine (`engine-layout/src/lib/stateMachine.ts`), art from Rigger or Flipbook | exists; 1D blend states (idle → run by speed) move into P10.11 (§5.2) |
| **Body** | shape, size, tags, solid, movement settings | `GameConfigDoc.arcade` (§9 #7) | shape and tags are P10.8; movement settings are new |
| **Brain** | patrol; chase the player within 200 px; flee after being hit; shoot every 2 s | `GameConfigDoc.arcade.characters` (§9 #14) | new |

**Why the brain is not in the Component Editor.** Components are shared and presentation only
(rive-style-editor.md §2): one goblin component should patrol in one game and chase in another. A
component's state machine also has no world, so it cannot see where the player is.

**Why not plain Flow.** Flow could do it ("every tick, for each enemy, if the distance is under
X…"), but every designer would rebuild "chase" from math nodes, and Flow's tick is for game rules
(the validator warns under 100 ms, §3.2), not per-frame steering. Flow keeps the game (score,
lives, waves) and can override a brain with `character.setState`.

**The brain** is a small state machine whose states are **behaviours** and whose transitions are
**world conditions**:

- **Behaviours** are presets with a few numbers each, in
  `packages/engine-mechanics/src/behaviours.js` (new; pure and seeded, so a replay is exact):
  `idle`, `wander`, `patrol` (between points or along a path), `followPath`,
  `chase {tag, range, speed}`, `flee {tag, range}`, `keepDistance`, `hover` (a sine bob) and
  `shootAt {tag, every, componentId}`, which asks the loop to spawn into a `spawnLayer` (§3.3). A
  behaviour returns a desired velocity; it never moves a body itself.
- **Conditions:** `targetWithin` / `targetBeyond {tag, px}`, `touching {tag}`, `hitSolid`,
  `timer {ms}`, `variable {id, op, value}` (a Flow variable, §3.1) and `random {chance}` (seeded).
- **Shape:** `{ initial, states: {id, behaviour, params}[], transitions: {from, to, when}[] }`. It
  mirrors the component state machine's states and transitions on purpose, so the tool reuses that
  canvas (§5.1).

**Movement.** `motion.js` grows past P10.8's velocity and bounds:

- per body: `accel`, `decel`, `maxSpeed`, `turnRate`;
- **solid response:** a mover stops at a `solid` body and slides along it, resolved one axis at a
  time (move x and push out, then y). P10.8's `overlaps` only *reports* a touch; this is what lets
  a guard turn at a wall (`hitSolid`);
- **paths:** a `path` layout node drawn in the Scene Editor (points, smoothing, open or looped),
  used by `patrol` and `followPath`;
- **zone forces:** a zone that pushes every body inside it, as a velocity added each step: a
  river's current, wind. Swimming upstream is moving against it;
- **player controllers**, presets fed by the input map (§3.2): `pointer` (follow the pointer on one
  or both axes: a paddle), `topDown` (8-way) and `sideScroll` (run; A3 adds the jump).

**Playable characters, abilities and bots.**

- **A character can be played.** A game lists its playable characters (Salmons: salmon, bear,
  fisherman). The player's pick takes a controller instead of a brain; the pick is a Flow variable
  (§3.1), so the choosing screen is authored like any other screen.
- **Abilities:** an input that plays an animation, opens a short-lived **hit zone** (shape, offset,
  the frames it is live, the tags it hits) and starts a cooldown: the bear's swipe, the fisherman's
  hook. A hit raises `onHit` for Flow. A brain uses abilities too.
- **Bots:** a playable character can also run on its brain, so an empty place is filled by a bot.

**The loop** (P10.8's `arcadeLoop.svelte.ts`) gains one stage: read input → **controllers and
brains** → `step` (with solids) → write positions **and the look's inputs** → `overlaps` → Flow
events. A character maps its state onto its component's inputs (`speed`, `grounded`, `facing`, the
brain's state) through an explicit `animInputs` map, so the component's state machine switches
animations with no Flow wire.

**Where it is authored:** a new tool, **Invisible Characters** (§5.1, §6.5).

### 4.4 A bigger world, the camera, jumps and levels (tier A3, P10.12–P10.13)

**In short:** in A1 the screen is the whole play field. A3 lets the world be bigger than the screen
and scroll (P10.12), then adds gravity, jumps and levels painted from tiles (P10.13). For Salmons
the camera comes first (§8).

**World and camera (P10.12).** The only cameras today are scripted: the Timeline's `camera` track
(`engine-cinematic`) and the slot reel-anticipation zoom (`registerSceneCameraTransform`,
`engine-layout/src/lib/registerSceneCameraTransform.ts`). Neither follows anything.

- A play-field screen gets a `world {w, h}` larger than its design size, and a `camera` block:
  `follow` (a tag, usually `player`), a dead zone, smoothing, look-ahead, `clampToWorld`,
  `autoScroll {x, y}` (px/s, for runners and shooters) and `shake`.
- `<ArcadeStage />` applies it as one transform on the world container. HUD screens are separate
  screens already, so they never scroll.
- **Parallax:** a per-container `parallax {x, y}` factor (0 = fixed to the screen, 1 = moves with
  the world).
- **Spawning against the view:** `spawnLayer` gains `despawnOutsideView {margin}`; Flow spawns
  ahead from the camera keys and `onEnterView` (§3.4). Off-view instances are culled (Pixi's
  `cullable`), so a long level draws only what is near.
- **Projection:** the simulation always runs on a flat ground plane (plus a height, for `hop`).
  The stage draws it either flat or **isometric** (2:1), and in isometric it draws sprites in
  ground-depth order, further up the screen first. Salmons is isometric (§9 #19).
- A Timeline can still take the camera for a cutscene: `playCinematic` holds it and hands it back
  when it ends.
- The camera steps on the fixed timestep, so a seed replays the same framing.

**Gravity, jumps and levels (P10.13).**

- `motion.js`: a per-body `gravity` and `maxFall`; `grounded` and `onWall` from the solid response;
  **one-way platforms** (solid only from above, while falling); sub-steps, so a fast fall never
  passes through a thin tile.
- The `sideScroll` controller gets its jump, set by **height and time** rather than raw velocities,
  plus what makes a jump feel right: hold to jump higher, **coyote time** (a jump just after leaving
  a ledge still counts), a **jump buffer** (a press just before landing still counts) and air
  control. A `flap` controller (tap for an upward kick) lands here too.
- **Two kinds of jump.** `gravity` is the side-view jump above. `hop` is the top-down one: the body
  leaves the ground on a height arc (drawn as a lift and a shadow) and, while airborne, passes over
  ground obstacles and cannot be hit by ground-only attacks. Salmons, which is isometric, uses
  `hop` (§9 #19).
- **Levels:** a new `tilemap` layout node: a tile size, a grid of tile indices and a tileset of
  **atlas regions**, each tile marked `none`, `solid` or `oneWay`. It is painted in the Scene Editor
  (§5.1) and is part of the layout doc, so it ships with it; its regions ship through the art
  export (§6.3).
- **Isometric tiles:** the grid is square, or 2:1 diamonds (Salmons: 64 × 32). Edge and corner
  pieces are picked from the neighbours (autotiling), as Salmons' 3 × 3 grass and sand sets
  already work. Bodies collide by their footprint on the ground, never by their picture.
- Slopes, moving platforms and ladders come later.

### 4.5 Online arcade: real-time rooms (tier A4, P10.14–P10.16)

**In short:** up to 100 players in one game, each on their own device. The server owns the game; a
device only sends what its player presses and draws what the server says, with its own player
predicted so the controls feel instant. This is new ground for the engine, so A4 gets a design doc
of its own, [realtime-multiplayer.md](realtime-multiplayer.md) (approved by the owner
2026-10-25), before any build. This section records its shape; that doc owns the detail.

- **The server owns the game.** It runs the simulation (`engine-mechanics`: motion, behaviours,
  abilities) at a fixed 60 Hz and sends state at 20 Hz (Salmons sends at 60 Hz today; the A4 doc's §5
  explains the change). A device sends
  **inputs only** (move, jump, ability), never positions or hits, so a modified client cannot
  teleport or claim a catch. It is §2.2's "the client cannot decide money", applied to the game.
- **One simulation, two places.** `engine-mechanics` is dependency-free plain JS for exactly this
  reason (§4.0): the server imports it, and the device runs the same code to **predict its own
  player** and **reconcile** when the server's answer arrives. Every other player is
  **interpolated** between the last two server states, about 100 ms behind.
- **The game server** is a new service, `services/game-server` (new), on Railway, speaking
  WebSocket. Colyseus is recommended because Salmons already runs on it (§9 #17): its rooms, state
  schema and lobby are the pattern; its own movement and collision rules give way to
  `engine-mechanics`.
- **Rules move to the server.** In a single-player rules game, Flow owns the rules on the device
  (§2.3). Online, the rules that decide the game (who was caught, who scored, when the round ends)
  must run on the server, as `engine-mechanics` data, with a named rules module for what the data
  cannot say (§9 #18). Presentation stays in the device's Flow.
- **Config:** `GameConfigDoc.arcade.online`: `maxPlayers` (Salmons: 100), the playable characters
  and how many of each a room allows, the tick rates, and whether bots fill empty places.
- **The runtime** gets an online branch, as it has a free-play one (§2.3): it joins a room instead
  of starting an RGS round. The server's address is supplied at boot, as the RGS address is today.
  Still one runtime (§6.4).
- **Scale is measured, not assumed:** a load test with 100 bot clients at real latency. Sending each
  device only what is near its player is added only if that test shows the bandwidth needs it.
- **A dropped player** rejoins the same room while it lasts.
- **Not in A4:** accounts, persistent progression, server leaderboards, money.

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
| **Launcher home + tool bar** | Show only the tools the active project's family uses; a direct link to another tool explains why it is not offered (§6.5) | P10.1b |
| **Invisible Characters** (new tool, `/characters`) | A list of the project's characters; per character the look (a component), body, movement, abilities, controller or brain; the brain on the state-machine canvas the Component Editor already has (`ComponentWorkspace.svelte`); a sandbox play field with a keyboard-driven dummy player. It edits `GameConfigDoc.arcade.characters` (§9 #14). A new tool, so rule 9 applies: `docs/tools/invisible-characters.md`, its README row and the onboarding link ship with it | P10.11 |
| **Scene Editor (`/editor`), arcade** | The `path` node (draw points, smoothing, open / looped) | P10.11 |
| | `world` size and the `camera` block on a play-field screen; the camera frame drawn on the stage; per-container `parallax` | P10.12 |
| | The `tilemap` node and a paint mode (brush, erase, fill, pick; per-tile `none` / `solid` / `oneWay`) | P10.13 |

### 5.2 Scheduling the Rive "Later" items

| Rive Later item (rive-reference.md §5) | Why a family needs it | Lands in | Size |
|---|---|---|---|
| **Pointer move / drag listeners + Align Target** | Swipe-to-swap; drag a paddle; a slider | **P10.4** | M |
| **View models** | Replaced by Flow variables + `source: var:<id>` (§3.1), later shown in the 9d Data tab. Not built as Rive's | **P10.3** | (in P10.3) |
| **Tags** | Arcade collision filters (`enemy`, `pickup`); a `spawnable` group | **P10.8** | S |
| **N-slice** | Goal panels, progress bars and HUD frames that resize per board size and device layout | **P10.9** | M |
| **Rulers and guides** | Laying out a play field and board precisely | **P10.9** | S |
| **Graph Editor + Elastic / Bounce** | Match-3 "juice": gems that land with a bounce, pops that overshoot | **P10.9**. Elastic / Bounce as `CinematicEase` presets: ✅ built 2026-10-25 | M |
| **Blend states (1D)** | An arcade character's idle → run, blended by speed | **P10.11** (characters need it; moved from P10.10 on 2026-10-22) | L |
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
- `kindCapabilities` only hides **sections inside** a tool. Hiding a **whole tool** a family never
  uses (Win Text for an arcade game) is §6.5's job.

### 6.2 What Game Config holds

Covered in §2.1 and §4: `family`, `outcome`, `match3` / `arcade` blocks, symbols, paytable (RGS
only), and `numReels` / `numRows` / `paddingReels` reused. Nothing a slot doc holds is moved or
renamed: that rule protects the slot games' stored docs, and does **not** mean a non-slot project is
shown slot fields.

**`/config` shows only the project's family (owner, 2026-10-22).** The page reads the family and the
outcome and shows the sections that family uses; the rest are not rendered at all. A slot project
sees exactly today's page.

| `/config` section (today's headings) | Slot | Match-3, RGS | Match-3, rules | Arcade |
|---|---|---|---|---|
| Return to player | ✓ | ✓ | — | — |
| Grid | ✓ | ✓ (board size) | ✓ (board size) | — |
| Bet modes, Big win tiers | ✓ | ✓ | — | — |
| Symbols | ✓ | ✓ (gems, with pays) | ✓ (gems, no pays) | — |
| How wins are decided | ✓ | ✓ (the `match3` arm only) | — | — |
| Free spins, Expanding symbol, Coins, Paylines, the Hold and Win / bonus / coin board / coin overlay sections | ✓ (as each kind and add-on allows today) | — | — | — |
| Reel behaviour | ✓ | only the switches the first board's arrival uses (P10.5 decides which; hidden until then) | same as RGS | — |
| **Match-3** (new: min run; moves, goals, score table for rules) | — | ✓ | ✓ | — |
| **Arcade** (new: play field, fixed rate, bodies; from A3 the world) | — | — | — | ✓ |
| Characters | — | — | — | a link to Invisible Characters (§4.3) |
| Raw JSON | ✓ | ✓ | ✓ | ✓ |

The refill strips of a match-3 doc (§2.1) are edited in the Match-3 section. The validator follows
the same table (§2.1), so a section the page hides is never the reason a save is refused.

### 6.3 Build, bake, publish (rule 8)

- **No new R2 asset class.** A match-3 game is made of scenes, components, symbols, timelines,
  sounds, fonts, config and Flow, and every one of them already travels export → `deploy/` → bake →
  pull → register (`runtimeBundle.ts` and the `*Export.ts` exporters).
- **One gap to close, P10.7:** the export must collect every `spawnLayer.spawnable` component id
  (and its art) as it collects placed instances. `check:art-scope` is extended to fail a spawnable
  component that does not ship.
- **The same gap, twice more:** a character's look component and its `shootAt` spawn (P10.11), and
  a `tilemap`'s tileset regions (P10.13), are collected the same way, and `check:art-scope` is
  extended for each. Characters and tilemaps are data inside the config and the layout doc, so they
  need no new asset class.
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
(§9 #3). **Re-checked 2026-10-25 (P10.8): option A stands** — arcade needs the Flow state, spawning,
free-play boot and determinism already in the shared runtime, and its size is the owner's accepted
static cost; the reasoning is in [status/game-families](../status/game-families.md) (P10.8).

### 6.5 Which tools a family uses (owner, 2026-10-22; P10.1b)

**In short:** a project sees only the tools its kind of game uses. Win Text is a slot tool, so an
arcade project never sees it. Today the launcher filters tools by **role** only (`manifestForRole`,
`apps/launcher-api/src/lib/roles.ts`), so every project sees every tool the user's role allows.

| Tool | Slot | Match-3 | Arcade | Card (§10) |
|---|---|---|---|---|
| Game Maker, Game Config, Director, Scene Editor, Flow, Component Editor, Localization | ✓ | ✓ | ✓ | ✓ |
| Atlas Maker, ComfyUI, Sheet Maker, Font Maker, Sound, Rigger, Flipbook, FX | ✓ | ✓ | ✓ | ✓ |
| Rig Viewer, Storybook, FTP Browser, Pipeline Changes, the desktop Invisible Launcher | ✓ | ✓ | ✓ | ✓ |
| Symbols State Machine | ✓ | ✓ (gems are symbols, §9 #9) | — | — |
| Win Text | ✓ | RGS only (only that game pays money) | — | — |
| Invisible Characters (new, §4.3) | — | — | ✓ | — |
| Invisible Card Library (new, §10) | — | — | — | ✓ |

- **One list, one home:** `FAMILY_TOOLS` beside `TOOLS` in `roles.ts`, because the registry owns
  the tool ids. It lists the tools a family does **not** use, so a new tool is offered to every
  family until someone says otherwise: a tool shown where it is useless is harmless, a tool hidden
  by accident is not. The slot family excludes nothing, so slot projects see exactly today's list.
- **The family comes from the project's kind,** through a `familyOfKind()` beside `GAME_KINDS`
  (`packages/constants-shared/gameKinds.ts`); an author-created custom kind is a slot, as every
  consumer already treats it. The project rows `(app)/+layout.server.ts` already
  loads (`accessibleProjects`) carry `gameType`, so this costs no R2 read per page.
- **A tool that depends on the outcome** (Win Text for match-3) stays listed for the family and
  checks the outcome itself from the config: a rules-decided game gets "this game pays no money, so
  there is no win text to author".
- **Where it applies:** the launcher home's tool grid and the `ToolTopBar` switcher, both fed
  `tools` by `(app)/+layout.server.ts`, for the active project. The role still decides what a user
  may open; the family only narrows it. The `/admin` per-role and per-user overrides are unchanged.
- **A direct link** to a tool the family does not use opens a short notice ("Win Text is not used
  by arcade games") with a link home: not an error, and not the tool. It is one guard in the `(app)`
  layout, not one per tool.
- **Director obeys the same list.** Its gate (`apps/launcher-api/src/lib/server/director/gate.ts`)
  refuses an adapter op (`ops/symbols.ts`, `ops/wintext.ts`, …) for a project whose family does not
  use that tool, so an agent cannot author symbols for an arcade game. Director making non-slot
  games at all is Director's own plan (`docs/director/`), not this one's.
- **The shared `cloud` scope**, and a project with no recorded kind (`DEFAULT_GAME_KIND` is
  `lines`), see every tool, as today.

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
| P10.1 | `check:family-defaults-identity`, `check:game-config-family` | Defaults dropped; family validation; `/config` picker mirrors the normalizer; `/config` shows each family exactly §6.2's sections, and a slot project today's page |
| P10.1b | `check:family-tools` | Every id in `FAMILY_TOOLS` is a real tool; the slot family hides nothing (a slot project's manifest is unchanged); a hidden tool's URL gets the notice; Director's gate refuses a hidden tool's ops |
| P10.2 | `check:board-mechanic` | Match finding (runs, L/T), gravity, refill from book vs seeded pool, cascade chain, `hasMoves`, a seed replays identically |
| P10.3 | `check:flow-variables`, `check:flow-time-events` | Scopes reset correctly; `onVariable` thresholds; `tick-async` rejected; timers on the virtual clock; `var:` bindings |
| P10.4 | `check:component-pointer-drag` | The move / drag / swipe events and Align Target; the cell hit-test is the inverse of `getSymbolX/Y` over the perspective lattice |
| P10.5 | `check:match3-rules`, `check:flow-publish-gate` (extended with the match-3 starter) | A starter rules game plays headless to a goal; the free-play branch sends no RGS request |
| P10.6 | `check:match3-outcome-guard`, `check:match3-wire` | RGS mode has no local RNG; `withOutcome('rgs')` strips rules-only nodes; facade translation fixtures (`move` → `swap` + `tumbleBoard`…); `seq` advances by 1 per move; replay at the same seq; the interactive round opens, takes N moves and collects once; every protocol list knows `match3` |
| P10.7 | `check:flow-spawn`, `check:art-scope` (extended) | Spawn cap; despawn inside `forEach`; spawnable components ship |
| P10.8 | `check:arcade-motion` | Fixed-timestep determinism; overlap by tag; bounds; the grid finds the same static shapes as a full scan |
| P10.11 | `check:arcade-characters`, `check:art-scope` (extended) | Each behaviour preset and brain transition replays under a seed; solid response stops and slides; controllers follow the input map; `animInputs` reach the look; a character's components ship |
| P10.12 | `check:arcade-camera` | Follow with dead zone and smoothing; clamp to the world; auto-scroll; parallax offsets; despawn outside the view; the same framing on replay |
| P10.13 | `check:arcade-platformer`, `check:art-scope` (extended) | Jump height and time match their settings; coyote time and jump buffer; one-way platforms; no tunnelling at `maxFall`; tile solidity; tileset regions ship |
| P10.14 | `check:room-sim` | The server and the device step the same inputs to the same state; the server accepts inputs only; join, leave and rejoin |
| P10.15 | `check:netcode` | Prediction and reconciliation converge under simulated latency, jitter and loss; interpolation stays smooth |
| P10.16 | a `room-load` script (outside CI) | 100 bot clients hold the tick rates; bandwidth per device is within budget |

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

**In short:** small, shippable steps. Match-3 rules games are playable after P10.5, and real-money
match-3 (on our mock) after P10.6. Arcade follows: one screen in P10.8, then characters, the camera
and jumps (P10.11–P10.13), then online rooms (P10.14–P10.16). Card games get their own plan
(§10). Every step is gated as in §7, and no step changes a slot game.

| # | Phase | Delivers | Main code | Size |
|---|---|---|---|---|
| P10.0 | **Plan + decisions** (this doc) — ✅ approved 2026-10-20 | Owner review of §9; sign-off recorded in §9 | docs | S |
| P10.1 | **Family and outcome in Game Config** — ✅ built 2026-10-23 | `family`, `outcome`, `match3` / `arcade` blocks and the `match3` win-model arm (optional, defaults dropped; the normalizer's whitelist learns them, and its no-symbols rule gets the arcade arm); `resolveFamily` / `resolveOutcome`; family-aware validation (paylines, empty `betModes` for rules games, board bounds); the `/config` picker and its per-family sections (§6.2); `GAME_KINDS` + `kindCapabilities` flags. No runtime behaviour yet | `packages/game-config`, `constants-shared`, `engine-layout/kindCapabilities.ts`, `/config` | M |
| P10.1b | **Tools per family** — ✅ built 2026-10-23 | `FAMILY_TOOLS` + `familyOfKind()`; the launcher home and `ToolTopBar` list only the family's tools; the hidden-tool notice; Director's gate refuses a hidden tool's ops (§6.5) | `apps/launcher-api` (`roles.ts`, `(app)/+layout.server.ts`, `director/gate.ts`), `constants-shared` | S |
| P10.2 | **The board module** — ✅ built 2026-10-23 | `packages/engine-mechanics/board.js` (+ `.d.ts`) with the full match-3 rule set, fixtures. No caller yet | new package | M |
| P10.3 | **Flow variables, timers, tick** — ✅ built 2026-10-24 | §3.1 + §3.2 (tick / timers / keys): format, validator; the variable and timer store in the game-side holder, reached through the env; the preview's virtual-time event queue; the Variables panel; `var:<id>` value sources (numbers), and `source` widened to bool / text | `engine-flow-v2`, `apps/lines` (`flowV2InterpreterHolder.ts`, value sources), `/flow-v2`, `engine-layout` (`ComponentInstance`), `componentStorage.ts` | L |
| P10.4 | **Pointer move / drag / swipe + Align Target** — ✅ built 2026-10-24 | Rive Later item; the listener events with the new pointer payload kind (normalizer + keep-unknown); global move / up-outside tracking; the board cell hit-test (`getCellAt`) | `engine-layout` (`LayoutNodeView`, `ComponentInstance`, `types.ts`, `componentPointer.ts`, `componentEvents.ts`), `engine-game` (`gameState`), `componentEventRows.ts`, `EditorListeners.svelte` | M |
| P10.5 | **Match-3, rules-decided, end to end** — ✅ built 2026-10-24 (publishing it stays off) | `MATCH3_VOCAB` + seed; the family branch in the shared runtime (`<Board/>` kept, spin never started, `<Match3Input />`); the swap on the flight layer (first slice: flights vs the per-cell respin board, §4.1) and the select / hint states; the free-play runtime branch; the layout template and full scene set, which is what puts `match3` in Game Maker; seed config; publish gates; the declared mechanic interface (game-type-templates Phase B); scripted-input steps in the harness's screen scripts; the bundle-size cost reported; a sample game and its playbook | `engine-flow-v2/reference/match3.ts`, `apps/lines`, `engine-game`, `engine-layout` templates, `scripts/current-games/`, launcher | L |
| P10.5b | *(optional)* **Match-3 specials** | The `specials` table (§4.1) | `engine-mechanics`, `/config` | M |
| P10.6 | **Match-3, RGS-decided** — ✅ built 2026-10-25 (on our mock; live real money waits on the partner) | The `move` action and events (ours, labelled); the **interactive round** path in the primary machine (a round open across player-paced requests); the `move` request exported from both transports; `mock-rgs-server-match3.mjs` (deals from the project's config, fixed-at-bet math, resume mid-round), with the Dockerfile copying `board.js` + its `package.json`, and `match3` added to every protocol list; facade translation; `withOutcome('rgs')`; the outcome guards; the RGS sample. **Live real money waits on the partner (§9 #2)** | `rgs-translator-eagaming`, `rgs-requests`, `utils-xstate`, `scripts/`, `services/test-server`, `engine-flow-v2`, launcher | L+ |
| P10.7 | **Spawning** — ✅ built 2026-10-25 | `spawnLayer` node, `spawn` / `despawn` / `instanceRef`, `live:<layer>` sets, cap, the ship-chain collection of spawnables | `engine-layout`, `engine-flow-v2`, `apps/lines`, exporters | M–L |
| P10.8 | **Arcade, rules-decided** — ✅ built 2026-10-25 (publishing it stays off) | `motion.js`, the fixed-step loop, tags, `ARCADE_VOCAB` + seed, `<ArcadeStage />`, the arcade layout template, a catcher / dodger sample + playbook. Re-checks §6.4 before starting | `engine-mechanics`, `engine-game`, `engine-flow-v2`, `apps/lines`, launcher | L |
| P10.9 | **Editor polish (Rive Later)** | N-slice; rulers and guides; the Graph Editor; Elastic / Bounce eases (✅ built 2026-10-25) | `/editor`, `engine-cinematic` (ease presets), `engine-layout` | M each |
| P10.10 | *(optional, after a decision)* **Arcade on the RGS** | A server-decided "prize" arcade (the server sends the result, the arcade plays to it). 1D blend states moved to P10.11 | `rgs-translator-eagaming` | L |
| P10.11 | **Arcade A2: characters** | `behaviours.js` and the brain; `motion.js` acceleration, solid response and paths; the player controllers; `animInputs`; 1D blend states; the `path` node; **Invisible Characters** (`/characters`) with its sandbox, and its docs under rule 9; a sample with an enemy that patrols and chases | `engine-mechanics`, `engine-game`, `engine-layout` (state machine, `path`), `engine-flow-v2`, `packages/game-config`, launcher | L |
| P10.12 | **Arcade A3a: world and camera** | `world` + `camera` on a play-field screen; follow, dead zone, auto-scroll, shake; parallax; despawn outside the view; culling; the camera Flow nodes and keys | `engine-game` (`<ArcadeStage />`), `engine-layout`, `engine-flow-v2`, `/editor` | M–L |
| P10.13 | **Arcade A3b: gravity, jumps and levels** | Gravity, grounded, one-way platforms, sub-steps; the `gravity` and `hop` jumps and the `flap` controller; the `tilemap` node, its paint mode and the tileset export | `engine-mechanics`, `engine-layout`, `/editor`, exporters | L |
| P10.14 | **Arcade A4a: the game server** | Per the A4 design ([realtime-multiplayer.md](realtime-multiplayer.md), approved 2026-10-25). `services/game-server` (§9 #17) running `engine-mechanics` at a fixed step; rooms; join, leave and rejoin; inputs-only messages; `GameConfigDoc.arcade.online`; the runtime's online branch | new service, `engine-mechanics`, `apps/lines`, `packages/game-config`, `docs/INFRA.md` | L |
| P10.15 | **Arcade A4b: netcode** | Own-player prediction and reconciliation; interpolation of everyone else; the online rules, as §9 #18 decides | `engine-game`, `apps/lines`, the game server | L |
| P10.16 | **Arcade A4c: 100 players and Salmons** | Server-side bots that fill places (A2 brains); the 100-bot load test; nearby-only sending if the test needs it; Salmons rebuilt as data on the engine from S0's art, with `docs/playtest/salmons.md` | the game server, launcher, docs | L |
| S0 | **Salmons art pass** — approved by the owner 2026-10-26. Not a build step: it runs in today's tools, beside the P10 steps (§1) | §1's target art in R2: the four arcade-sample sprites first, then characters per facing, props, 64 × 32 diamond tilesets and effects. Work list, owner choices and blockers: [status/salmons.md](../status/salmons.md) | no code: ComfyUI, Atlas Maker, Flipbook, FX | L |

**Why this order.**

- P10.1–P10.2 are cheap, invisible and unlock everything else.
- P10.3–P10.4 are the generic Flow and input pieces both families need, and they are useful to slots
  too (a timer, a drag slider).
- P10.5 is the first playable non-slot game, built mostly from cascade parts that already exist.
- The RGS path (P10.6) comes after the rules path, because the rules path proves the presentation
  with nothing external in the way. The RGS path then only swaps the source of events, which §2.3
  made identical by design.
- Spawning waits for arcade because match-3 does not need it.
- P10.1b needs only the family from P10.1, so it follows it directly: no project can be given a
  non-slot kind before the launcher knows which tools that kind uses.
- P10.11–P10.13 follow P10.8, because each builds on its loop. For Salmons the order is P10.12
  (its river is bigger than the screen), P10.11 (three playable characters, their abilities and the
  current), then P10.13 (the jump).
- A4 comes last: netcode is far easier to get right over a simulation that is already finished and
  replays exactly.
- **Salmons' art pass (S0) is not a build step.** It runs in the existing tools and can happen any
  time before P10.16. Done early, it gives the arcade samples real art to test against.

---

## 9. Decisions (owner)

**#1–#9 DECIDED (owner 2026-10-20): every recommendation is accepted as written.** The owner also
asked that nothing be started yet: P10.1 onward waits for the owner's go. **The owner gave the
go-ahead on 2026-10-23** ("I think we can start on phase 10 as well … it's a long phase, so take it
easy, there is no hurry"). #20–#27 were raised by the P10.1 build and decided the same day.

**#10–#19 added 2026-10-22** from the owner's questions. #10 and #11 are the owner's own asks, and
so is #12's scope (its shape is a recommendation); the owner answered #13–#16 the same day;
#17–#19 are open.

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
   - *Recommend (2026-10-22):* make it a **Salmons slice**: its salmon dodging bears and hooks on
     one screen, with its art. Salmons as a whole needs A2–A4 (§1).
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
10. **Does a family hide whole tools, or only sections inside them?** *(owner's ask, 2026-10-22)*
    - **Whole tools** (§6.5): an exclusion list beside the registry, empty for slots; Win Text
      decided by the outcome; Director's gate obeys it. Sections inside a tool stay
      `kindCapabilities`' job.
11. **Does `/config` show only what the family needs?** *(owner's ask, 2026-10-22)*
    - **Yes** (§6.2's table). Slot projects see today's page.
12. **Arcade past one screen: characters, movement, jumps, camera.** *(owner's ask, 2026-10-22)*
    - *Recommend:* **three tiers after P10.8**: characters (P10.11), world and camera (P10.12),
      gravity, jumps and levels (P10.13); still no rigid-body physics (§1).
    - *Recommend:* a character's **brain is game data**, authored in a new tool, **Invisible
      Characters**, not in the Component Editor, which keeps the look (§4.3).
13. **Salmons.** *(owner, 2026-10-22)*
    - It is the **real-time multiplayer game for 100 players**: each player is a salmon, a bear or a
      fisherman; a salmon jumps up the river and moves around, avoiding the bears' attacks and the
      fishermen (§1).
    - It is rebuilt on the shared runtime as data, and it sets the arcade order: P10.12, P10.11,
      P10.13, then A4 (§8).
14. **Where characters live.** *(owner, 2026-10-22: Game Config, for now)*
    - **Inside `GameConfigDoc.arcade.characters`.** It reuses the config's bake, versions and lease,
      with no new ship chain. The cost: Game Config and Invisible Characters share one lease, so two
      people cannot edit both at once.
    - A doc of its own stays possible later; it would need its own export → bake → pull → register
      (rule 8).
15. **Card games.** *(owner, 2026-10-22: confirmed)*
    - A **fourth family with a design of its own**, written once P10.7 has shipped (it needs
      variables, drag and spawning). v1: single player against an on-device AI, fixed decks, effects
      as data from a closed list, rules-decided only (#4). Outline in §10.
16. **Multiplayer.** *(owner, 2026-10-22)*
    - **In scope for arcade, as tier A4** (§4.5, P10.14–P10.16), because Salmons is multiplayer.
    - **Card-game PvP stays later**, for now.
17. **Which game server for A4?** *(owner, 2026-10-22: Colyseus)*
    - **Colyseus**, in a new `services/game-server`, because Salmons already runs on it and its
      rooms, schema and lobby are proven there. Its movement and collision move to
      `engine-mechanics`, so there is one simulation.
18. **Where an online game's rules run.** *(owner, 2026-10-25: on the server, as `engine-mechanics`
    data)*
    - The choice was the Flow interpreter running headless on the server, so online rules are
      authored in Flow as single-player ones are, or online rules limited to `engine-mechanics`
      data. Presentation stays on the device either way.
    - Decided with the A4 design: **`engine-mechanics` data on the server**, with a named rules
      module for what the data cannot say ([realtime-multiplayer.md](realtime-multiplayer.md) §4,
      §14 #2).
19. **Salmons' view.** *(owner, 2026-10-22: "sort of isometric")*
    - **Isometric**, on 2:1 diamond tiles (its map uses 64 × 32). So P10.12 builds the isometric
      projection and depth order, and P10.13 builds the `hop` jump and diamond tiles first (§4.4).

20. **Where `minRun` lives.** *(owner, 2026-10-23)*
    - **`match3.minRun` is its only stored home.** A match-3 doc never stores `winModel`; the
      normalizer drops one. `resolveWinModel()` returns `{ type: 'match3', minRun }`, built from the
      block, for any match-3 doc.
21. **Arcade's outcome.** *(owner, 2026-10-23)*
    - "Absent ⇒ `rgs`" stays the one rule. An arcade doc that resolves to `rgs` is a validation
      error until P10.10, so `/config` offers arcade only **Rules**, and the arcade seed writes
      `outcome: 'rules'`.
22. **The family picker on a slot page.** *(owner, 2026-10-23)*
    - **Never shown to a slot project.** It shows only when the project's kind is `match3` or
      `arcade`, or its config already names a family, so a slot project's page is exactly today's.
      The outcome picker sits beside it.
23. **Sections §6.2's table leaves out.** *(owner, 2026-10-23)*
    - Coin board, Coin overlay, Bonus modes and Game modes are slot only (the table's "bonus" row).
      **Sounds** shows for slot and match-3, and is hidden for arcade.
24. **A stepped match-3 board.** *(owner, 2026-10-23)*
    - A validation error: the board module is rectangular in v1.
25. **`outcome` on a slot doc.** *(owner, 2026-10-23)*
    - Dropped by the normalizer. Slots are RGS-decided only.
26. **Publishing a non-slot config before its runtime.** *(owner, 2026-10-23)*
    - The online publish and the desktop bake's config export refuse a match-3 or arcade config,
      with no override, until the runtime plays that family (P10.5, P10.8). Otherwise the shared
      runtime would play it as a slot, or draw a blank board.
    - **Switched on 2026-10-25** *(owner)*: the gate is on playability, not family. A config is
      refused only while `mechanicFor(config).unplayable` is set, so match-3 (rules or RGS)
      publishes to our test server now and arcade does once P10.8 makes it playable. A rules game
      is dealt the `freePlay` protocol, whose mock refuses every request. Delivery stays slot-only:
      `build-delivery.mjs` refuses every non-slot config (a rules game for any delivery profile, an
      RGS match-3 until the partner wire, §9 #2).
27. **`familyOfKind()` lands in P10.1**, not P10.1b. *(owner, 2026-10-23)*
    - Adding `match3` and `arcade` to `GAME_KINDS` needs it, so that the slot-only consumers (the
      Scene Editor's template-type picker, the flow-vocabulary generator and game-spec's schema)
      stay unchanged. P10.1b reuses it.
28. **How many facings a character has.** *(owner, 2026-10-26)*
    - **A per-game option: 4 or 8.** P10.11's character data names its facings, and the look
      picks the clip for the nearest one. Four are the isometric diagonals, as Salmons draws them
      today: south-east and north-east, with the west twins mirrored. Eight add the four straight
      directions, so a game draws five and mirrors three. Either way a missing west-facing clip is
      its east twin mirrored.

---

## 10. The card family (outline)

**In short:** a two-player duel with decks, hands, a board and a resource that grows each turn, in
the style of Magic: The Gathering or Hearthstone. It is the most rules-heavy family, so it gets a
design of its own (`docs/design/card-games.md`, not written yet) once P10.7 has shipped (§9 #15).
This section records what is already clear.

- **Outcome:** rules-decided only. A card game is free play with no wallet (§9 #4); an RGS-decided
  card game is not planned.
- **What it reuses:**
  - Flow variables and timers (P10.3): health, mana, the turn number, a turn timer.
  - Drag and Align Target (P10.4): drag a card from the hand onto the board or onto a target.
  - Spawning and live sets (P10.7): cards in the hand and on the board are spawned instances, and
    `forEach` walks "my minions".
  - Components with state machines: the card frame (`inHand`, `hover`, `playable`, `attacking`,
    `dying`), its text and number inputs bound per card (P10.3 widens `source` to text).
  - Timelines for attacks and effects; Localization for card text (no family has more text); the
    seeded RNG for shuffles, so a match replays.
- **What is new:**
  - **A rules engine,** `packages/engine-mechanics/src/cards.js`: zones (deck, hand, board,
    discard), turn phases (start → draw → main → combat → end), the resource, legal plays, and an
    ordered queue that resolves one effect at a time.
  - **Effects as data, not scripts:** a closed list of verbs (deal damage, heal, draw, summon, buff,
    destroy, give a keyword), targets (self, a chosen target, all enemies, a random enemy) and
    triggers (on play, on death, at turn start, on attack, on damage), plus a small keyword set
    (must be attacked first, attacks at once, a one-hit shield).
  - **The opponent:** an on-device AI in v1 that plays its best affordable card and takes good
    trades, with difficulty settings, seeded so a match replays.
  - **Invisible Card Library** (`/cards`, a new tool, so rule 9 applies): every card shown in the
    real card-frame component; stats, keywords and effects edited as a form; rules text generated
    from the effects and sent to Localization; the starter and AI decks.
  - **A `card` family** in Game Config and `GAME_KINDS`, added by that plan. Where card data lives
    (the config or a doc of its own: §9 #14's question again) is decided there.
- **Not in its v1:** online play (§9 #16), packs, collections or an economy, deck-building for
  players, scripted custom effects, money.
- **Ours, not theirs:** the mechanics are common to the genre; card names, rules text, frames and
  art must be our own or the client's (the Director's ownership rule).
