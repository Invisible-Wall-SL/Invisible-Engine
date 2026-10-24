# Game families (Phase 10) — status

> Design: [docs/design/game-families.md](../design/game-families.md) · Guide: [docs/tools/game-config.md](../tools/game-config.md) (_Game family_) · Agents: `invisible-game-config`, `invisible-game-maker`, then per phase

**One-line state:** the owner started Phase 10 on 2026-10-23. **P10.1–P10.4 are merged; P10.5
(match-3, rules-decided, end to end) is built** and in review. A match-3 project can be made in
Game Maker and plays in the shared runtime as free play: the board never spins, the player swipes
or taps gems, matches cascade, and the starter flow keeps the score and the moves. Publishing a
game that is not a slot stays off. RGS-decided match-3 (P10.6) is next.

## Current state

**P10.5 — Match-3, rules-decided, end to end (built 2026-10-24; in review).** §8's P10.5 row, in
one PR (the vocabulary, the scene set, Game Maker and the gates move together: registering the
kind is what every scaffold gate loops over).

- **The mechanic, declared once** (game-type-templates Phase B): `engine-game` `mechanic.ts`,
  `mechanicFor(config)` → `GameMechanic` (`id`, `outcome`, `spins`, `rgsSession`, `wallet`,
  `boardInput`, `bookEvents`, `unplayable`). `REELS_MECHANIC` for every slot (and no config);
  `MATCH3_RULES_MECHANIC` (no spin, no RGS session, no wallet, board input);
  `MATCH3_RGS_MECHANIC` and an arcade config are `unplayable` until P10.6 / P10.8. The runtime
  asks only this (`apps/lines` `game/mechanic.ts` `gameMechanic()`).
- **The rules** (`engine-game`): `createMatch3Session(config, seed)` over P10.2's board module
  (deal from the config's strips, `trySwap`, `resolveNow`, `shuffle`, `hint`, the score) and
  `createMatch3Driver({ session, state, signal, present })`, which decides every move: input taken
  or refused, the order of the board's Flow signals, a queue for board work, and the flow's board
  actions. The runtime supplies only `present` (seat, swap, cascade step, mark); the headless gate
  supplies none, so both run the same code.
- **The runtime branch** (`apps/lines`):
  - `+layout.ts` stops an `unplayable` mechanic on the boot-failure screen
    (`refuseUnplayableBoot`); `+layout.svelte` passes `freePlay={!gameMechanic().rgsSession}` to
    `<Authenticate>` (`components-shared`), which then opens no RGS session — no authenticate, no
    balance poll — and refuses to run under any delivery profile (an operator's real-money embed).
  - `Game.svelte`: `mechanic.spins` gates the replacement Space spin hotkey, hold-to-spin and the
    coded HUD; `<Board/>`, `<TumbleBoard/>` and the flight layer stay mounted; `mechanic.boardInput`
    mounts `<Match3Input />` in the reel stack.
  - `<Match3Input />` (`components/Match3Input.svelte`): an invisible surface over the board in the
    board's own space; P10.4's `PointerGesture` feeds it; `getCellAt` picks the cell. A drag that
    travels 0.35 of a cell along an axis swaps with that neighbour (mid-drag); a release that never
    did is a tap: select, then a neighbour swaps. Mounting it starts the session.
  - `game/match3.svelte.ts`: the presenter — the swap on the flight layer (flight kind `swap`, the
    gem as the head in its `static` state, no trail: `flyTo`'s new `symbolState` / `trailless`
    options); each cascade step through `playBookEvents([tumbleBoard])` (the coded handler, with the
    step's cells one row down for the reel's top pad); a deal or shuffle seated with
    `boardSettle`; `select` / `hint` as symbol states. The board's signals go to the v2 flow.
  - `game/flowBoardEffects.ts`: the board actions reach the Flow runtime through a registry the
    session fills, so `flowV2Runtime` never imports the match-3 module.
- **The vocabulary** (`engine-flow-v2` `reference/match3.ts`, registered): the standard palette's
  load / tap-to-start / settings surfaces, sounds, camera and element FX, plus the board's signals
  `boardReady {moves, target}`, `swap {from, to, accepted}`, `match {groups, points, step}`,
  `cascadeStep {step, groups}`, `settled {steps, points}`, `noMoves`, `roundEnd` (RGS, P10.6), the
  actions `boardSelect`, `boardHint`, `boardSwap`, `boardSetInput`, `boardResolve`, `boardRefill`,
  `boardShuffle` (`MATCH3_RULES_ONLY_ACTIONS` names the last three for P10.6's
  `withOutcome('rgs')`), the seven tumble cues, the structs `Position` / `MatchGroup` and the enums
  `MatchShape` / `RoundEndReason`. No reel, spin, bet or payline surface.
- **The starter flow** (`reference/match3Seed.ts`, `DRIVEN_SEEDS.match3`): load → board + HUD;
  `boardReady` sets `score` / `movesLeft` / `target` and opens input; an accepted `swap` spends a
  move; `match` adds its points; `settled` checks the goal, then the moves left — a won or lost
  round locks the board, holds on `roundWon` / `roundLost` until the tap, then `boardRefill` deals
  the next round; `noMoves` shuffles.
- **Game Maker** offers `match3` ("Match-3"): `engine-layout` has its full scene set
  (`referenceLayouts/match3.ts`: loading, background, basegame = a 7 × 7 `reelGrid`, `match3Hud` =
  Text Boxes fed `var:score` / `var:movesLeft` / `var:target`, `roundWon` / `roundLost` = a dimmed
  tap-to-continue and its line) and template (`templates/match3.ts`). A new project is seeded with
  `match3.rules.json` (free play; 7 × 7, six gems, 20 moves, a 1500 goal, 50 / 120 / 250 for runs
  of 3 / 4 / 5), the scene set and the starter flow.
- **`/symbols`**: the `select` and `hint` columns, for a project whose `kindCapabilities()`
  `boardInput` (new; false for every slot) is on. `/win-text`: a rules-decided game gets "This
  game pays no money…" above its editor.
- **Publish** keeps refusing every non-slot config (`familyGate.ts`, owner's rule for this step);
  the message now says a free-play match-3 plays in the authoring preview but publishing a non-slot
  game is not switched on. Publish and `/flow-v2` validation now pass the config's outcome to the
  validator (P10.3's open item).
- **The harness and the sample:** the determinism probe reports `state().board` (`busy`, `moves`,
  `seed`, `cells`) and `cellPoint(reel, row)`; `play.mjs` gains `tap` and `swap` (`from` / `to`,
  or `legal: true|false` picked by `engine-mechanics`' own rules, `orUntil`), real mouse events at
  those pixels; `screens/match3.json` has 5 screens (`loaded`, `board`, `selected`, `refused`,
  `cascaded`). The fixtures write `cg-match3` from the three Game Maker seeds;
  `scripts/playtest/match3-play.mjs` plays a whole round on it and is the sample's launcher
  ([playtest/match3-sample.md](../playtest/match3-sample.md)).
- **Fixed on the way (P10.3):** `Game.svelte`'s Flow-state ticker effect read the Pixi ticker
  before Pixi's async init had made it and, the ticker not being reactive, never re-ran, so a flow
  built from a runtime bundle never flushed its variables. It is keyed on `stateApp.loaded` too.
  No live game declares a variable.
- **Gates:** `check:match3-rules` (42 checks: the starter game won and lost headless on the real
  interpreter, refused swaps, no moves, select / hint / input, seed replay, score, the mechanic,
  the free-play branch source-scanned, the vocabulary); `check:flow-publish-gate` moves `match3`
  into its scaffold loops (the starter flow passes against its scene set as a rules game) and
  limits add-on combos to slot kinds; `check:symbols-kind-gating` pins slot pickers and columns
  without `select` / `hint` and match-3's with them; `check:game-config-family` covers both
  publish refusals and `boardInput`.
- **Verified by playing:** `match3-play.mjs` on the branch runtime (board seed `sample-8`): a
  refused swap left the board as it was; 13 legal swipes reached the goal; the round-won screen
  held and locked the board; the tap dealt a fresh round (SCORE 0, MOVES 20); the page made no
  request but the runtime bundle; no page error. The harness's 5 `match3` screens rendered on the
  local fixture (both sides the branch runtime: no match-3 game is live).
- **Bundle size** (the release build, `index.html`, which inlines the runtime): main 3,644,234 B /
  1,247,187 B gzipped → branch 3,667,004 B / 1,255,211 B: **+22.8 KB raw, +8.0 KB gzipped
  (+0.6 %)**, downloaded by every game, run by none but a match-3 one. `bundle-modules.mjs` could
  not list the modules: the inline bundle strategy references a `.js.map` it never writes.
- **Slot parity:** for a slot (`REELS_MECHANIC`) every new gate reads as before — the spin hotkey,
  hold-to-spin and coded HUD conditions gain `mechanic.spins` (true); `<Authenticate>` gets
  `freePlay={false}`; `<Match3Input />` is never mounted; no board effect is registered; `select` /
  `hint` are in `SYMBOL_STATES` but never offered to a slot or set by one; the flight options are
  opt-in. Edited shared runtime modules: `Game.svelte`, `+layout.ts`, `+layout.svelte`,
  `Authenticate.svelte`, `editor-scenes.ts` (one added export), `flights.svelte.ts`,
  `FlightLayer.svelte`, `flowV2Runtime.svelte.ts`, `determinism.ts`, `stateGame.svelte.ts` (one
  export), `symbolStates.ts`, `symbolCell.ts`, `kindCapabilities.ts`.
- **Chosen in P10.5, owner may overturn** (the plan does not fix them):
  - **one PR**, not split;
  - the swap rides the **flight layer** (§4.1's first slice): the respin board's per-cell reels
    have no cascade, which is most of the value. The `swap` flight kind is not listed in
    `/symbols` → Flights yet, so its look is the coded default without a trail;
  - names: signals `boardReady`, `swap`, `match`, `cascadeStep`, `settled`, `noMoves`, `roundEnd`
    (the plan's `on…` are their pins' labels); actions camel-cased `boardSelect` … `boardShuffle`
    (the plan writes `board.select`); `boardSetInput` is new (a round's end must lock the board);
    `boardRefill` deals a whole new board (a new round), and `boardResolve` resolves what matches
    on the board now;
  - `match` fires per cascade step **before** its explosion with the step's points;
    `cascadeStep` **after** its refill landed;
  - **points** are the runtime's, from the config's score table: each group priced by its gem
    count (the longest run in the table at or under it; an L or T counts all its gems); no table
    pays 10 a gem. The starter flow only adds them;
  - `boardReady`'s `target` is the config's first **score** goal (0 for none); a collect goal is
    the author's to count from `match.groups`;
  - the starter's variables are `game`-scoped and reset by its `boardReady` chain (a match-3 round
    starts at a deal, not a spin press);
  - the board seed is `?m3seed=`, else `Math.random` (seeded under `?ie_determinism=`); a game is
    not saved or resumed in v1 (§P10.2: seed + moves would replay it);
  - flow board actions **queue** behind the move playing and are not awaited by the chain that
    called them (the `settled` and `noMoves` chains call them from inside the move);
    `boardSetInput` alone applies at once (a flag: the round-over chain locks the board while its
    screen holds, inside the move); `noMoves` is not raised when a new deal is already queued;
  - a config with **no Moves** has no limit: `boardReady` sends 0, the starter's `moveLimit` stays
    0 and its out-of-moves branch never fires, so only the goal ends a round;
  - a **shuffle** that no arrangement of the gems can make playable deals the board afresh
    (no `boardReady`: the round goes on); a deal that fails shows the error modal;
  - the **session outlives the board's mount**: a screen change that remounts the board re-seats
    the board the session has, never re-deals;
  - the **wager intents** (`spin`, `autoSpin`, `buyBonus`, `increase`, `decrease`) are no-ops for a
    mechanic that never spins (`engine-game` `runsIntent`), whatever reaches them: an authored HUD
    button, a flow intent such as `startSpin`, the Space key;
  - a swipe swaps once it travels **0.35 of a cell** along one axis, mid-drag; a tap selects; the
    same cell again drops the selection;
  - unauthored, `select` draws the gem's **Win** art and `hint` its **Land** art; a new
    `kindCapabilities()` flag `boardInput` gates them (P10.1's `board` is true for slots);
  - free play refuses **any** delivery profile (`getDeliveryProfileSource() !== 'default'`): the
    game never mounts and `<Authenticate>` itself says why (the error modal lives inside the game);
  - Game Maker seeds only the **rules** outcome and asks nothing: RGS match-3 gets its seed with
    its mock (P10.6). `/config`'s Reel behaviour stays hidden for match-3 (P10.1): no switch reaches
    a board that never spins;
  - Win Text keeps its editor under the notice (hiding it would re-indent the whole slot page);
  - a custom kind stored as `match3` before it was built in is **hidden** behind the built-in, with
    a server-log warning, and never overwritten (every scaffold write is create-only). Nobody read
    R2 to check whether one exists (open item);
  - the `cg-match3` fixture's manifest entry names the `lines` protocol: the test server only
    serves the runtime, and the free-play branch never asks its mock.
- **Not done here:** `/flow-v2`'s Preview does not run the board module (§5.1: it still previews a
  match-3 flow's chains with no board); Game Maker's outcome question and the RGS seed (P10.6);
  listing the `swap` flight kind in `/symbols`; specials (P10.5b). `<Match3Input />` and the board
  module are imported statically, so every slot bundle carries them (+22.8 KB raw / +8.0 KB gz,
  +0.6 %) although none runs them; a dynamic import would keep slot bundles byte-identical (owner's
  call: it adds a load step to a match-3 boot).
- **Known limits** (none reachable by a slot game):
  - the board under a swap shows the two gaps while the gems fly, and a refused swap's gems fly
    back the same way;
  - the stock symbols draw unauthored gems; the round screens' line is one Text Box at 64 px;
  - `noMoves` is hard to reach on the seed board (six gems, 7 × 7): the gate covers it headless;
  - the probe's `idle` stays true on a match-3 board (its round machine never runs); scripts wait
    on `boardBusy`;
  - a Text Box fed a number prints it with the integer fallback's grouping (1,500).

**P10.4 — Pointer move / drag / swipe + Align Target (built 2026-10-24; merged #1327).** §3.2's pointer
and board-cell bullets. No game uses any of it yet.

- **Format** (`packages/engine-layout/src/lib/types.ts`): `NODE_LISTENER_EVENTS` gains `move`,
  `dragStart`, `drag`, `dragEnd` and `swipe` (after the old five); a `swipe` listener may carry
  `swipe: { direction?: left|right|up|down, threshold? }` (`SWIPE_DIRECTIONS`,
  `DEFAULT_SWIPE_THRESHOLD` = 40). `LISTENER_ACTION_KINDS` gains `align`: Align Target,
  `{ kind: 'align', target, preserveOffset?: true, axis?: 'x'|'y' }`. `EventPayloadValue` gains
  `{ pointer: 'x'|'y'|'dx'|'dy' }` (`POINTER_PAYLOAD_FIELDS`).
- **The gesture** (`componentPointer.ts`, pure): `PointerGesture` turns one listening node's Pixi
  events into listener events, each with a reading (`PointerAt`: x / y in the instance's space,
  dx / dy from the press, the stage point). A press is `down`; once it moves `DRAG_SLOP` (4 instance
  px) it sends `dragStart`, then `drag` on every move of that pointer, anywhere; its release sends
  `dragEnd` (if it dragged) and offers `swipe`; a release over the node is `up`, as it always was.
  `move` is a move over the node. `swipeMatches` decides a swipe listener: the press-to-release
  distance reaches the threshold and the longer axis points the asked way (a tie is horizontal).
- **Wiring** (`LayoutNodeView.svelte`): the listener wrapper feeds the gesture from its five
  handlers, mapping `e.global` through the instance's space (`ComponentListen.local`, the placing
  node's container, from `ComponentInstance`). Only a node listening for `move` also gets
  `onpointermove`; only one listening for a drag or a swipe gets `onglobalpointermove` and
  `onpointerupoutside`, so a drag that leaves the node keeps tracking and ends off it (a `move`
  listener or a pointer payload also takes `onpointerupoutside`, so a press released off the node
  ends and later readings are back to dx / dy = 0). A new `down` on a node whose press is still on
  (a second finger, or a touch the browser cancelled: Pixi forwards no `pointercancel`) ends that
  press's drag where it was last heard, then takes over, so no drag is left open. Pixi hands
  `globalpointermove` twice to a container that is both hit and an ancestor of the hit, so the
  gesture drops a move to where it already was.
- **The dispatcher** (`componentEvents.ts`): `pointer(node, event, at?)` runs the event's listeners
  with the reading; a raise's `{ pointer }` value resolves from it (rounded into an `int` / `ms`
  field) and is empty where no pointer runs the raise (a state's On enter / exit, a cue). Align
  Target asks the host for its node (`alignTarget(id)` → `AlignSpace`) and places it on the pointer
  in the node's parent space; `preserveOffset` keeps the offset the node had when the action first
  runs in a press (`PointerAt.press`, a serial unique across nodes); `axis` moves one axis. A
  target node that unmounts detaches itself; where the pointer put it is kept, so a remounted
  target comes back there. `ComponentInstance` keeps the
  placements (`$state`), and a target node's `LayoutNodeView` reads its placement into its position
  (`setComponentAlign` / `getComponentAlign`, provided only when the def aligns something, or to hide
  an outer instance's from a nested def).
- **Validation:** `raise-payload-pointer` (not a reading, or on a raise no pointer runs),
  `listener-align-target` (a node outside the def, or its root), `listener-swipe` (a bad direction
  or threshold).
- **Launcher:** the reader (`componentEventRows.ts`) reads the new events, `align`, `{ pointer }`
  and a swipe listener's filter, and drops a malformed row whole, which the keep-unknown save puts
  back (`componentFields.ts` knows `swipe`). The editor (`EditorListeners.svelte`,
  `EditorRaisePayload.svelte`, `listenerEdit.ts`): the five new events, the swipe row (direction,
  threshold), the *align target* action (node, keep offset, axis), and pointer x / y / dx / dy for a
  number field on a listener's raise.
- **Board cell input** (`packages/engine-game/src/game/gameState.svelte.ts`): `getCellAt(x, y)`
  (board-local) → `{ reel, row }` or `undefined`, the inverse of `getSymbolSeat`: the cell whose
  pitch box (its seat with the art alignment taken out, a column pitch by a row pitch, at the row's
  scale) holds the point. The box follows the seat, not the mask's window, so a perspective board
  with a row lead other than 0.5 can leave a sliver between rows that is no cell. Exported from `createGameState`; no caller until `<Match3Input />` (P10.5).
- **Gate `check:component-pointer-drag`** (`apps/launcher-api/scripts/`, run by `check:all`), 76
  checks: the gesture, the swipe filter, the dispatcher and Align Target, real Pixi (`EventBoundary`,
  a drag leaving the node), validation, the reader and the editor edits, the cell hit-test sliced
  from the real `gameState` over flat, gapped, non-square, led, aligned, stepped and perspective
  lattices, and parity scans. `check:component-listeners-events`' wiring scan now reads the gesture
  handlers; `check:component-listeners-events-editor`'s empty-def default is now Align Target;
  `check:save-keeps-unknown-blocks`' unknown pointer event is `pinch` (it was `swipe`).
- **Slot parity:** a def with no new event, `align` or `{ pointer }` behaves as before: the old five
  events still fire on the same Pixi events, in the same order (the reading they now carry is read
  by nothing); a wrapper gets no new handler; no node reads an Align placement; no built-in uses any
  of it. `getCellAt` has no caller. Edited shared modules: `LayoutNodeView.svelte`,
  `ComponentInstance.svelte`, `componentEvents.ts`, `componentListenerContext.ts`,
  `gameState.svelte.ts` (one added function). Reviewed by `code-reviewer`: no parity blocker; its
  findings in the new features (a stale `preserveOffset` across presses, a press left open by a
  second finger, a cancelled touch or a release off a `move`-only node, a detached target still
  reachable) are fixed and gated.
- **Chosen in P10.4, owner may overturn** (the plan does not fix them):
  - x / y are in the **instance's space** (its root's), dx / dy from the **press point** (0 with no
    press); a pointer reading into an `int` / `ms` field is **rounded**;
  - a drag starts after a **4 px slop** (instance px), `dragStart` carrying the reading at that
    move, and the same move also sends the first `drag`;
  - the swipe's direction and threshold live **on the listener** (`swipe`), the threshold in
    instance px, **default 40**; a swipe is offered on **every release** of a press (dragged or
    not), with no time limit; the longer axis decides and a tie is horizontal;
  - `move` is a move **over the node** (`pointermove`), not anywhere; a tap still ends in a click,
    and so does a drag released over the node (Pixi's tap);
  - Align Target takes **`axis`** (x / y) beside Rive's `preserveOffset`, for sliders and paddles;
    its placement **replaces** the node's x / y (a value binding or timeline on that axis no longer
    moves it) and lasts until the instance remounts; the offset is taken at the action's **first run
    in each press**; the **root** cannot be a target;
  - a **new press** on a node whose press is still on takes over, ending the open drag first;
  - a new listener on a def with no input and no event **aligns its own node** (it used to start as
    an empty *fire*);
  - the hit-test's cell is the **pitch box** (a gap belongs to the nearer cell), visible cells only;
  - the validation codes' names.
- **Not done here:** the State machine tab's stage preview (`listenerPreview.ts` / `EditorCanvas`
  `onStagePointer`) plays only the old five: drag, move, swipe and Align Target run in the game
  only; `/flow-v2`'s preview scripts no pointer (open, with its key scripting); the match-3 swap from
  a drag (P10.5).
- **Known limits** (none reachable by a current game):
  - one press per node at a time: a second finger on a node ends the first finger's drag and drags
    in its place;
  - a touch the browser cancels mid-drag gets its `dragEnd` only at the node's next `down` (Pixi 8
    forwards no `pointercancel`; a native listener on the canvas would close it);
  - Align Target has no bounds; a slider's clamp is Flow's (from the drag's x) until it has one;
  - an Align Target maps through its parent's transform at the moment of the event, so a parent
    that moves during a drag moves the node with it until the next move.

**P10.3 — Flow variables, timers, tick (built 2026-10-24; merged #1326).** §3.1 + §3.2 (tick,
timers, keys).

- **Format** (`packages/engine-flow-v2/src/types.ts`): `FlowDoc.variables` (`game` / `round`),
  `FlowModeScope.variables` (`mode`), `FlowDoc.inputs` (the key map), the accessor `$var.<id>`,
  and nine node kinds: `setVariable`, `changeVariable` (`add` / `sub` / `toggle`, `min` / `max`),
  `onVariable` (`changed` / `crosses` a threshold, up / down / either), `onTick { every? }`,
  `startTimer { timer, repeat }` (data-in `ms`), `stopTimer`, `pauseTimer` (exec-ins `pause` /
  `resume`), `onTimer`, `onInput { action, phase }`. Pins in `pins.ts`.
- **The store** (`src/state.ts`, `createFlowState`): one per session, outside the interpreter,
  reached as `FlowV2Env.state`. A write applies at the node; a wrong kind is dropped; `round`
  variables reset on `resetRound`, a mode's on `enterMode(id)`; a reset is a write. Writes are
  delivered once per frame (`flush`): each `var:<id>` subscriber hears its variable once, and the
  batch runs the `onVariable` entries (`variableEntries`: `changed` once with the latest value,
  `crosses` per crossing write). Timers and ticks advance only through `advance(dtMs)`. One frame
  is `stepFlowState`, which the game's ticker and the preview both run: first the writes since the
  last frame go out, then the timers and ticks due run, all at the frame's moment. A write any of
  those chains makes goes out with the next frame.
- **Entries** (`runFlowStateEntry`): timer, tick and key entries run on the active mode's graph
  when it has one, else the global graph (the signal rule); a variables batch is split per variable
  by the same rule. A chain that throws is reported once per session.
- **Game side** (`apps/lines`): `createLinesFlowV2` builds a store only when `flowUsesState(doc)`;
  it registers each variable as the value source `var:<id>` (a bool as 1 / 0), listens for mapped
  keys (not while typing in a field, no key-repeat), and resets a mode's variables on its `enter`
  transition. `tickFlowV2State` (holder) runs from one ticker callback that `Game.svelte` adds only
  when the handle has a store, so timers stop when the game stops ticking. `resetFlowV2Round` runs
  in `actor.ts` `onNewGameStart`.
- **`source` widened to bool / text:** `<ComponentInstance>` subscribes a bool (to the state
  machine, from on / off or 1 / 0) and a text input (to the Flow handle's text input) with a
  `source`, as it did a number; the launcher normalizer (`componentStorage.ts`) and
  `setInputSource` keep it on all three. The Component Editor's input row shows its "from" field on
  bool and text rows too and suggests the project's flow variables (`/editor` loads them).
- **Preview** (`src/preview.ts`): a doc that uses state runs on a virtual-time event queue (60 fps
  frames running `stepFlowState`, Delays as queue waits, scripted keys; the clock never runs back; a
  horizon, default 5000 ms, held to 60 s). A doc with none keeps the single-chain clock unchanged.
  The `/flow-v2` panel scripts no keys yet, so On input chains do not run there.
- **Validator** (`src/variableValidate.ts`): `variable-unknown`, `variable-type`, `variable-scope`,
  `variable-duplicate`, `variable-shadows-money`, `tick-async`, `tick-fast`, `input-unknown`.
  `validateFlowDoc` takes an optional `outcome` (absent ⇒ RGS).
- **`/flow-v2`:** the Variables panel (`VariablesPanelV2.svelte`, with the key map on the Global
  tab), the *Variables & time* palette group, inspector fields, `$var` in the accessor picker, the
  new codes in Validation, and the preview's horizon and *No event* run.
- **Gates:** `check:flow-variables` (42 checks) and `check:flow-time-events` (35 checks), both run
  by `check:all`; `envFactory.fixture.ts` learns the `state` capability.
- **Slot parity:** a doc with no variable, key map or state node gets no store, no value source, no
  key listener and no ticker callback, previews on the old clock, and gets no new issue (no
  committed seed does). Edited shared modules: `Game.svelte` (the gated ticker effect), `actor.ts`
  (the round reset, a no-op without a store), `flowV2Runtime.svelte.ts`, `flowV2InterpreterHolder.ts`,
  `ComponentInstance.svelte`, and the `engine-flow-v2` interpreter.
- **Chosen in P10.3, owner may overturn** (the coordinator accepted them for now, 2026-10-24):
  - `variable-shadows-money` flags a variable named `balance` / `win` / `totalWin` / `bet`, and a
    variable fed (directly or through a compute) to `amount` on `setWinBookEventAmount`,
    `setBetAmount`, `winUpdate`, `freeSpinOutroCountUp` or `showMessage`, in an RGS game;
  - Pause Timer has `pause` and `resume` inlets; starting a running timer restarts it;
  - an `enum` variable is `{ type: 'enum', values }`, a string on the wire;
  - the input-row picker is a suggestion list on the free-text field;
  - a round starts at `onNewGameStart` (the spin press);
  - `onVariable` fires once per frame, not inside the writing chain; `tick-fast` also warns on an
    every-frame tick; `variable-duplicate` and `input-unknown` are codes the plan did not name.
- **Not done here:** the Data tab (9d); per-frame work belongs to the mechanic (P10.8).
- **Known limits** (none reachable by a current game):
  - an `onVariable` chain that keeps changing its own variable re-runs once a frame, for good;
    nothing flags it yet;
  - a text input on a component nested inside another component does not follow a `var:` source
    (only a top-level placement has the Flow handle that keeps text); nothing draws a text input yet;
  - a timer started mid-frame counts from the next frame (up to 16.7 ms late); a mode's `onTick`
    with `every` keeps counting while its mode is off screen, so its first fire on entry can be early;
  - renaming a variable rewrites this doc's nodes, not a component's `var:<id>` source or a shared
    library function;
  - Publish validates without an `outcome`, so a future rules-decided game would get
    `variable-shadows-money`: pass the config's outcome to `validateFlowDoc` in P10.5.

**P10.2 — the board module (built 2026-10-23; merged #1323).** A new dependency-free package,
`packages/engine-mechanics` (§4.0): `src/board.js`, plain ESM with no imports, and its hand-written
`src/board.d.ts`, re-exported by `index.ts` as `engine-cinematic` does. **No caller yet**, so no
game, bundle or screen changes.

- **The rule set (§4.1):** `createBoard`, `canSwap`, `swap`, `findMatches` (row and column runs of
  `minRun`+, merged into `L` / `T`; a lone run is `line2`–`line5`, `line5` meaning five or more),
  `clear`, `gravity` (with the falls), `refill`, `resolve` (the cascade loop), `findMoves` /
  `hasMoves`, `shuffle`, and `createRng` (mulberry32; a string seed is hashed).
- **The grid is the slot board's:** column-major `cells[reel][row]`, row 0 at the top, gems shaped
  as `RawSymbol`. Each `resolve` step carries a `tumbleBoard` event (no `index`) whose
  `newSymbols[reel]` are the gems dropped into that column top first, exactly as the mock RGS's
  cascade sends them, beside its match groups and falls.
- **Refill sources:** `'pool'` reads the column's strip (`paddingReels`) from a seeded stop, as a
  reel strip is read, wrapping; or a book's `newSymbols`, which must fit the holes exactly.
  `resolve` takes either, one book refill per step, so an RGS board can mirror the server's chain.
- **The RGS guard (§2.2 #1):** a board built with `rng: null` (the default) throws on any deal,
  pool refill or shuffle, even one handed an rng; it takes gems only from given cells and the book.
  A book whose refills outnumber or fall short of the local chain throws too: that is the
  client/server mismatch §2.2 #4 logs.
- **Replay is seed + moves.** The rng is one closure shared by every board derived from the first,
  and its state cannot be saved, so a rules game resumes by replaying from its seed. P10.5 decides
  whether a saved game needs more.
- **Choices this build made** (the plan does not fix them; easy to change before P10.5 calls it):
  - a **dealt board** has no match and at least one move (up to 200 seeded deals, then it throws:
    the strips cannot make a playable board); `shuffle` keeps the same promise;
  - `canSwap` needs the match to **take in one of the two swapped gems**, so a swap beside a run
    that is already on the board is not a move;
  - `resolve` stops after 100 steps and throws (a runaway chain is a strips problem); `refill`
    throws when a hole sits below a gem (gravity has not run);
  - `findMoves` (every legal swap, each pair once) is exported because `board.hint()` needs one.
- **Gate `check:board-mechanic`** (`scripts/check-board-mechanic.mjs`, run by `check:all`): 32
  checks over drawn grids: runs, line shapes, `L` / `T`, `minRun`; legal and illegal swaps;
  gravity's falls; book and pool refills; a chain fed by refills and one made by falls alone; the
  RGS mirror (a pool chain replayed on an `rng: null` board from its own `newSymbols` gives the
  same steps and board); `hasMoves`; shuffle; the deal; malformed input. Three scripted sessions
  (two 7 × 6, one 5 × 5 that dead-ends and shuffles) replay identically and match the committed
  trace, `packages/engine-mechanics/fixtures/board-replay.json` (`--update` rewrites it).
- **Not done here, by plan:** the mock's import and the test-server Dockerfile lines (P10.6), the
  `MATCH3_VOCAB` nodes and any runtime caller (P10.5), specials (P10.5b).

**P10.1b — tools per family (built 2026-10-23; merged in #1324).** §6.5.

- **The list:** `FAMILY_TOOLS` beside `TOOLS` in `apps/launcher-api/src/lib/roles.ts` names the
  tools a family does **not** use: slot and match-3 nothing, arcade Symbols and Win Text. A
  project's family is `projectFamily(key, gameType)` (`lib/server/projects.ts`): `familyOfKind()`
  of its recorded kind, and always a slot for the shared `cloud` scope.
- **Home and tool bar:** `(app)/+layout.server.ts` drops the hidden tools from `tools` (which feeds
  the home grid and `ToolTopBar`) and returns `family`. It reads the family of the page's
  `?project=` when the user may reach it, else of the session's project, because the page syncs
  `?project=` into the session only after the layout has run. The read is tracked, so a
  client-side hop to another project's `?project=` re-runs the layout (and only that param does).
  Onboarding keeps the role's whole manifest: it describes what a role may use.
- **The notice:** `(app)/+layout.svelte` renders "<tool> is not used by arcade games", names the
  project, and links home, in place of the page when the URL is a hidden tool's (`familyHiddenToolAt`). The tool's own
  load still runs; nothing renders from it.
- **Director:** `ADAPTER_TOOL_IDS` (`director/adapter.ts`) maps each adapter tool to its launcher
  tool, and `buildRegistry` refuses an op whose tool maps to none. The gate refuses an op on a tool
  the project's family hides with 403 `not_for_family`, after the scope check.
- **Slot parity:** for every role, a slot, legacy (no kind), custom-kind and `cloud` project gets
  exactly `manifestForRole`, and a slot page renders exactly its children.
- **Verified:** `check:family-tools` (151 checks: the list, the real layout load per role and
  family, onboarding, the real layout server-rendered, the real gate), and `check:director-adapters` with its
  fixture op moved onto a mapped tool.
- **Not built here:** Win Text's own "this game pays no money" message for a rules-decided match-3
  game (§6.5's outcome bullet) is not in §8's P10.1b row; it waits for a match-3 project to exist
  (P10.5, which added it).

**P10.1 — family and outcome in Game Config (built 2026-10-23; merged #1310).**

- **Schema** (`packages/game-config`): four optional fields on `GameConfigDoc`: `family`
  (`match3` / `arcade`; absent ⇒ a slot), `outcome` (`rules`; absent ⇒ `rgs`), and the
  `match3` / `arcade` blocks (`src/family.ts`). The win model gains a fifth arm,
  `{ type: 'match3', minRun }`, which is never stored: `resolveWinModel()` builds it from
  `match3.minRun` for any match-3 doc (§9 #20).
- **Resolvers:** `resolveFamily`, `resolveOutcome` (a slot is always `rgs`), `resolveMatch3`,
  `resolveArcade`. No code reads the raw fields.
- **The normalizer** learns the fields and drops every default: `family: 'slot'`, `outcome: 'rgs'`,
  `minRun: 3`, `fixedHz: 60`, empty blocks, `outcome` on a slot, a block beside the wrong family,
  and a match-3 doc's `winModel` and `cascade`. An arcade doc normalizes with no symbols or strips.
- **Validation follows the family** through one table, `configSectionsFor(family, outcome)`
  (`src/familySections.ts`): each existing check runs only where its `/config` section shows, so
  a slot is checked exactly as before. New checks (`src/familyValidate.ts`):
  - match-3: a rectangular board, and a min run that fits it;
  - match-3 rules: no moves warns, an unreachable goal is refused, a score row below the min run
    warns; an empty `betModes` is allowed;
  - arcade: an RGS-decided arcade game is refused (§9 #21), and a rate outside 30–240 Hz warns.
- **`/config`** reads the same table: a slot project's page is unchanged and has no picker. A
  project whose kind or config is a non-slot family gets **Game family** (family + outcome) and
  the **Match-3** or **Arcade** section (`FamilySection.svelte`, setters in `familyDoc.ts`).
- **`GAME_KINDS`** gains `match3` and `arcade`, with `SLOT_GAME_KINDS`, `GAME_FAMILIES` and
  `familyOfKind()` beside it (pulled forward from P10.1b, §9 #27). The slot-only consumers derive
  from `SLOT_GAME_KINDS`: the Scene Editor's template-type picker, the flow-vocabulary generator and
  game-spec's schema. Game Maker still offers neither kind: it needs a full scene set (P10.5).
- **`kindCapabilities`** takes `family` / `outcome` and gains `wallet`, `betControls` and `board`
  (all `true` for a slot). A match-3 or arcade project is offered none of a slot's sections.
  `projectAddOns()` passes a non-slot config's family and outcome to it, so the tools follow the
  config as `/config` does; a slot config adds neither.
- **The family gate:** the online publish and the desktop bake's config export
  (`/api/game-config/doc`) refuse a non-slot config, with no override, until its runtime exists
  (§9 #26).

**Verified (2026-10-23):**

- `family.fixture.ts`, `check:family-defaults-identity` (every shipped config; 26 normalize, the
  cluster sample's is refused as before), `check:game-config-family`
  (setters vs normalizer; the page server-rendered per family), plus the existing
  `check:symbols-kind-gating` and `check:flow-publish-gate`, moved to the slot kinds.
- Against `main`, by hand:
  - `main`'s own normalizer and validator over 28 shipped configs (the same corpus plus the
    number-picker and price apps): 0 differences.
  - `/config` server-rendered on both sides for seven slot seeds: the same text and markup.
  - The diff runs Prettier over `+page.svelte`. With whitespace ignored, it adds only the `{#if}`
    gates and the family markup.

## Open items / next

1. P10.6 (RGS-decided match-3): the `move` action, the interactive round, the mock, the
   `MATCH3_RGS_MECHANIC` made playable, `withOutcome('rgs')` over `MATCH3_RULES_ONLY_ACTIONS`, Game
   Maker's outcome question and the RGS seed config.
2. **Switching publish on for a non-slot game** is the owner's call (`familyGate.ts` refuses it
   today, by the owner's rule for P10.5). Until then a match-3 game plays only in the authoring
   preview.
3. `/flow-v2` Preview running the board module on its virtual clock with a seed (§5.1).
4. The `swap` flight kind in `/symbols` → Flights, so its look is authorable.
5. The State machine tab's stage preview and the `/flow-v2` preview do not yet drive drag, move,
   swipe or Align Target (P10.4's "Not done here").
6. The `/config` **Characters** link for arcade (§6.2) lands with Invisible Characters (P10.11).
7. **Confirm no custom kind is named `match3` or `arcade`** in R2 (`_shared/editor-kinds/`). A
   `match3` one is now hidden behind the built-in (and warned about in the launcher log, never
   overwritten); an `arcade` one would be when P10.8 lands. Needs R2 access, which this build did
   not have.
8. The runtime still prices and draws the `match3` arm as the lines default (`payoutDivisor`,
   `winLineShapeFor`), unreachable while only rules match-3 plays; P10.6 honours the arm
   (divisor 1).

## Blocked (owner / external)

- Nothing for P10.1. §9 #18 (where an online game's rules run) is still open; it blocks only A4.

## Recent changes

- 2026-10-24 — **P10.5 built: match-3, rules-decided, end to end.** A match-3 project is made in
  Game Maker and plays as free play in the shared runtime; publishing it stays off. Detail above.
- 2026-10-24 — **P10.4 built: pointer move / drag / swipe + Align Target**, and the board cell
  hit-test. Detail above.
- 2026-10-24 — **P10.3 built: Flow variables, timers, tick.** Detail above.

- 2026-10-23 — **P10.2 built: the board module** (`packages/engine-mechanics`, `check:board-mechanic`).
  Detail above.
- 2026-10-23 — **P10.1b built: tools per family.** Arcade projects are not offered Symbols or Win
  Text; a direct link shows a notice; Director's gate refuses those ops. Slot projects unchanged.
  Detail above.

- 2026-10-23 — **P10.1 built: family and outcome in Game Config.** The owner gave the go-ahead
  for Phase 10, and accepted the five P10.1 recommendations and three notes the build raised
  (§9 #20–#27). Detail above.
