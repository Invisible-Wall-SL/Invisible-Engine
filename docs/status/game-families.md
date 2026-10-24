# Game families (Phase 10) — status

> Design: [docs/design/game-families.md](../design/game-families.md) · Guide: [docs/tools/game-config.md](../tools/game-config.md) (_Game family_) · Agents: `invisible-game-config`, `invisible-game-maker`, then per phase

**One-line state:** the owner started Phase 10 on 2026-10-23. **P10.1–P10.3 are merged; P10.4
(pointer move / drag / swipe + Align Target) is built** and in review. A component can now react to
a drag or a swipe, hand Flow the pointer's position, and move one of its nodes with the pointer; the
board can say which cell a point is in. Nothing non-slot plays yet: P10.5 (the first match-3
runtime) is next.

## Current state

**P10.4 — Pointer move / drag / swipe + Align Target (built 2026-10-24; in review).** §3.2's pointer
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
  ends and later readings are back to dx / dy = 0). A second pointer on a pressed node is a `down`
  and an `up`; the first press keeps its drag. Pixi hands
  `globalpointermove` twice to a container that is both hit and an ancestor of the hit, so the
  gesture drops a move to where it already was.
- **The dispatcher** (`componentEvents.ts`): `pointer(node, event, at?)` runs the event's listeners
  with the reading; a raise's `{ pointer }` value resolves from it (rounded into an `int` / `ms`
  field) and is empty where no pointer runs the raise (a state's On enter / exit, a cue). Align
  Target asks the host for its node (`alignTarget(id)` → `AlignSpace`) and places it on the pointer
  in the node's parent space; `preserveOffset` keeps the offset the node had when the action first
  runs in a press (a `down` on the node starts a new press); `axis` moves one axis. A target node
  that unmounts detaches itself. `ComponentInstance` keeps the
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
- **Gate `check:component-pointer-drag`** (`apps/launcher-api/scripts/`, run by `check:all`), 74
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
  four findings in the new features (a stale `preserveOffset` across presses, a second finger ending
  nobody's drag, a press left open by a release off a `move`-only node, a detached target still
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
  - a **second pointer** on a pressed node does not take the press over: it is a `down` / `up`, and
    the first press keeps its drag;
  - a new listener on a def with no input and no event **aligns its own node** (it used to start as
    an empty *fire*);
  - the hit-test's cell is the **pitch box** (a gap belongs to the nearer cell), visible cells only;
  - the validation codes' names.
- **Not done here:** the State machine tab's stage preview (`listenerPreview.ts` / `EditorCanvas`
  `onStagePointer`) plays only the old five: drag, move, swipe and Align Target run in the game
  only; `/flow-v2`'s preview scripts no pointer (open, with its key scripting); the match-3 swap from
  a drag (P10.5).
- **Known limits** (none reachable by a current game):
  - one press per node at a time: a second finger on a pressed node cannot drag it;
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
  (P10.5).

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

1. Win Text's outcome message for a rules-decided match-3 game (§6.5), with P10.5 or before it.
2. P10.5 onward, in §8's order. P10.5 is the board module's first caller (the rules runtime
   branch and the `/flow-v2` preview); P10.6 the mock's. P10.5 replaces the family gate for
   match-3 with the runtime
   branch, and registers the match-3 scene set, vocabulary and starter flow. It moves `match3` into
   the slot-only loops of `check:flow-publish-gate` and decides which Reel behaviour switches
   match-3 shows.
3. P10.5's `<Match3Input />` is the first caller of `getCellAt` and of the drag / swipe
   listeners (a drag or swipe from cell A into `swap(A, B)`, §3.2).
4. The State machine tab's stage preview and the `/flow-v2` preview do not yet drive drag, move, swipe or
   Align Target (P10.4's "Not done here").
5. The `/config` **Characters** link for arcade (§6.2) lands with Invisible Characters (P10.11).
6. **Confirm no custom kind is named `match3` or `arcade`** in R2 (`_shared/editor-kinds/`). Such a
   kind would now read as that family, and the built-in id would hide it from the pickers. Needs R2
   access, which this build did not have.
7. The runtime still prices and draws the `match3` arm as the lines default (`payoutDivisor`,
   `winLineShapeFor`), and `engine-game/src/game/gameConfig.ts`'s note about a fifth win model
   still stands. That code path is unreachable while the family gate holds; P10.6 honours the arm
   (divisor 1) when RGS match-3 lands.

## Blocked (owner / external)

- Nothing for P10.1. §9 #18 (where an online game's rules run) is still open; it blocks only A4.

## Recent changes

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
