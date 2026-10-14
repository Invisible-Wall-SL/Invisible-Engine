# Rive-style Scene + Component Editor — Plan (draft, owner review)

> Status: **APPROVED (owner 2026-10-13); Phase 0 done, Phases 1–2 next.** Owner ask (2026-10-08): make the Scene Editor and the
> Component Editor work like [Rive](https://rive.app/) — components built on the stage, timelines
> and a state machine attached to each component, a friendlier interface, and everything wired to
> Invisible Flow. This file is the plan; progress will live in [editor status](../status/editor.md)
> and [component-editor status](../status/component-editor.md).
>
> **Owner direction (2026-10-08, second pass):**
> 1. **A hybrid, not a copy of Rive.** Screens stay — we keep the Screens list, spaces, layer
>    order and Flow driving screens. Rive's ideas are taken where they fit.
> 2. **Timelines are reusable, and there is only one timeline system:** the Rigger's
>    [Invisible Cinematic](invisible-cinematic.md) timeline, extended. No second timeline is built.
>
> ✅ Phase 5 **reverses a standing decision**, and the owner has approved it (2026-10-13):
> [invisible-editor.md §8.7](invisible-editor.md) and §17 deferred "route A — Rive state machine"
> (2026-06-05, re-confirmed 2026-06-09). That deferral is **lifted, scoped to *component* state
> machines only** (§2); screens get none. §17's planned `BehaviorTrack`/`TweenStep` timeline is
> superseded by §4 here; neither was ever built.
>
> **Owner direction (2026-10-09, third pass):** this is part of a bigger plan. The same tools must
> later build **other kinds of games — arcade, match-3** — the way Rive can, so the Flow connection
> has to be seamless and not slot-shaped. And none of it may break the work and the games we already
> have. §6 (the component ↔ Flow contract) and §7 (beyond slots) answer that.
>
> **Owner direction (2026-10-09, fourth pass):** text handling is critical, and every existing
> pipeline connection must keep working so all tools still communicate. §8 (text) and §9 (pipeline
> connections) answer that.

## 1. The hybrid: what we keep, what we take from Rive

| Area | Keep (ours) | Take from Rive |
|---|---|---|
| **Screens** | Screens list, spaces (`game`/`standard`/`canvas`/`background`), list order = layer order, device layouts, In-game view | Screens can carry timelines (enter / exit / idle) played by Flow |
| **Game logic** | **Invisible Flow** is the game's top-level state machine: book events, screens, wins, features | — (Rive's root state machine is what Flow already is) |
| **Components** | `ComponentDef`, params, versions, per-project defaults, value bindings, the ship chain | Edited **in place on the stage**; **Animate mode**; a **state machine** with **inputs**; **listeners** (pointer events → inputs) |
| **Timelines** | The **Timeline** from `/rigger` (format, evaluator, player, UI) | Timelines on any component or screen, reusable across them |
| **Flow ↔ component** | `playCinematic`, `fireCue` | Flow sets a component's inputs, fires its triggers, waits on its states |

So: **screens are where things live, Flow decides what happens, components are the Rive part.**
Rive's artboards map to our components; Rive's main artboard maps to a screen; Rive's state machine
inputs are what Flow drives.

## 2. The scope line

- **Component state machine (new)** — presentation only: states play timelines, transitions fire
  on inputs. No RGS calls, no math, no book reading. Lives on the `ComponentDef`.
- **Screens get no state machine of their own.** Flow already is one; a second would compete with it.
- **Flow (existing)** — owns the game logic and drives component inputs.
- **Game math** — stays in books and Game Config. Untouched.

## 3. One timeline system (the Timeline, extended)

> UI name: **Timeline** (owner 2026-10-13). "Cinematic" survives only as the file format
> (`.icin` / `CinematicDoc`, `engine-cinematic`, `playCinematic`) and as the label of the Rigger's
> multi-rig mode.

What exists today (see [cinematic status](../status/cinematic.md)):

- **Format** — `CinematicDoc` (`engine-layout`) with tracks (`packages/engine-cinematic/types.ts`):
  `animation` (rig clip strips, layers, blends, masks), `property` (keyed x / y / scale / rotation /
  alpha), `visibility`, `cue` (`fx:` / `sfx:` / `music:` / `signal:`), `camera`, and
  **`subCinematic`** (a timeline inside a timeline). A cinematic can already bind a **Scene** as its
  set (`stage.sceneId`).
- **Evaluator** — `engine-cinematic` (`evaluateActor`, channel sampling, `cuesCrossed`),
  deterministic and gated (118/118 headless).
- **Player** — `<Cinematic>` in `engine-layout/svelte`, played from Flow's `playCinematic`.
- **Storage + ship** — `<client>/<project>/cinematics/<id>.json` → `cinematicExport.ts` →
  `deploy/cinematics/` → bake → `bakedCinematic(id)`.
- **UI** — the sequencer + dopesheet in `/rigger` 🎬 Cinematic mode (`static/rigger/cinematic.js`), which keeps that label.

The one limit: **actors are rigs only.** Everything below generalises that, additively.

### 3.1 Node actors

An actor gains a kind:

```ts
type CinematicActor =
	| { id: string; kind?: 'rig'; rig: string; /* today's fields */ }
	| { id: string; kind: 'node'; target: string };   // a node in the host, by node name
```

- A `node` actor is any layout node in the timeline's **host** (§3.2): sprite, text, rect, rig
  node, flipbook, FX, nested component instance.
- `property` channels widen for node actors: `x y scaleX scaleY rotation alpha` (today) + `tint`,
  `frame` (flipbook), `fill` (reveal), `text` (count-up to a number input).
- A rig **node** can still take `animation` strips, so the cinematic rig controls carry over.
- Unknown kinds are skipped by the evaluator already (`types.ts` header), so old players and old
  docs are unaffected. Every existing cinematic keeps `kind` absent, which reads as `'rig'`.

### 3.2 Hosts

A timeline names what it animates:

```ts
host?: { kind: 'cast' }                        // today's cinematic: rigs on their own stage (default)
     | { kind: 'component'; componentId: string }
     | { kind: 'screen'; sceneId: string }
```

Same document, same store, same export and bake. A component's state can point at a timeline id, a
screen's enter/exit can, and Flow's `playCinematic` plays cast and screen timelines. A component
timeline is played by its placed instances instead, each on its own, started by the instance signal
the doc names in `playOn` (Phase 4b): a `playCinematic` would have no instance to drive.

### 3.3 Reuse

Timelines are reusable in four ways:

1. **Same timeline, many callers.** One timeline can be played by Flow (`playCinematic`), by a
   component state, or as a `subCinematic` track inside another timeline.
2. **Bind by node name.** A node actor targets a node *name*, not an id. So a "Pop in" timeline made
   on one component plays on any component or screen that has a node of that name. Tracks that
   find no node are flagged by validation and skipped at runtime (the evaluator already skips
   what it can't resolve).
3. **Shared library.** Timelines can be promoted to `_shared/cinematics/`, like shared components.
   The shared library is where the old §17 "presets" (fade, slide, pop, count-up) live: as real
   timelines anyone can open and edit, not as a coded list.
4. **Instances.** A placed component instance plays its def's timelines. Per-instance overrides
   stay on params, as today; the timeline itself is not forked per instance.

### 3.4 One timeline UI

The sequencer lives in `/rigger`'s static vanilla-JS page; `/editor` is Svelte. Plan: extract the
timeline panel (ruler, tracks, strips, keys, cue rows, inspector, undo) from
`static/rigger/cinematic.js` into a **framework-agnostic module**, `mount(el, { doc, host,
callbacks })`. `/rigger` and `/editor` both mount it; `/editor` wraps it in a small Svelte
component. It ships to the static page the same way `cinematicEval.mjs` does today: a generated
verbatim copy, with a gate that fails when the two differ. `/rigger` keeps the rig-specific parts
(Tweak Mode, inline posing, bone masks) as extensions the module takes.

## 4. Target experience

```
┌ ToolTopBar ───────────────────────── [ Design | Animate ] ── Save · History ┐
│ Screens            │                 Stage                                   │ Inspector │
│  Base game         │   double-click an instance → edit it in place           │           │
│  Win banner ▸      │   breadcrumb:  Base game › Win banner › Coin            │           │
│ Components         │                                                          │           │
│ Library (art/rigs) │                                                          │           │
├────────────────────┴──────────────────────────────────────────────────────────┴───────────┤
│ Animate: [Timelines ▾ intro | win | idle]  ← the shared Timeline sequencer               │
│          [State machine]  Entry → Idle ⇄ Win → Exit   Inputs: win ▸  amount #   (comps)  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Design mode** is today's Scene Editor. Screens are listed first, then components, which are
  edited on the same stage (breadcrumb in, Esc out). `/components` becomes this view with a
  component selected.
- **Animate mode** opens the shared sequencer for whatever is selected: a screen's timelines, or a
  component's timelines plus its state machine tab.
- **Flow** keeps `/flow-v2`. Its palette lists every component's inputs and states, and its
  inspector deep-links to the component or timeline.

## 5. Component state machine (additive to `ComponentDef`)

As built (Phase 5a, 2026-10-13 — `engine-layout/types.ts`, interpreter in
`engine-layout/stateMachine.ts`, interface in `componentInterface.ts`):

```ts
interface ComponentInput { id; kind: 'bool' | 'number' | 'trigger'; default?; source?; note? }
// COMPONENT_INPUT_KINDS is the one exported list (the normalizer imports it); Phase 7 adds `text`.
// `source` (number only): a registered engine value source (`winAmount`) that feeds the input.

interface ComponentStateMachine { layers: SmLayer[] }
interface SmLayer      { id; name?; entry: string /* a state id */; states: SmState[]; transitions: SmTransition[] }
interface SmState      { id; name?; timeline: string /* cinematic id */; speed?; loop? }
interface SmTransition { id; from /* state id | 'any' */; to /* state id | 'exit' */;
                         conditions?: SmCondition[]; exitTime?; blend? /* ms */ }
interface SmCondition  { input; op: 'fired' | '==' | '!=' | '<' | '>'; value? }
```

Deviations from the draft above, found while building: `entry` is a real state's id (no Entry
pseudo-state in the data; the editor draws one); `any` and `exit` are reserved ids a transition
names, never entries in `states`; transitions carry an `id` (the editor selects them); `!=` joins
the ops (a "not win" bool test); a state and a layer may carry a display `name`.

**Interpreter semantics** (`ComponentStateMachineRunner`, pure and Pixi-free — advanced by `dt`
and input changes, it only says "layer L plays timeline X at t, mixing in from Y frozen at u"):

- Every layer starts in its `entry` state, at time 0, when the machine starts (on the instance's
  first visible frame — below).
- **Triggers last one evaluation, unless a transition is only waiting on its exit time.** A
  trigger fired between ticks is seen by every layer on the next tick and used by at most one
  transition per layer (a chain in the same tick cannot re-use it); the transition that takes it
  consumes it for that layer; what no transition took is cleared at the end of the tick (as Rive
  does). The one exception is "finish the current loop, then play win": a layer **holds** a trigger
  while a transition leaving its current state (or `any`) reads it and is blocked by its
  `exitTime` alone — every other condition already holds (a second trigger must arrive in the
  same evaluation, a bool must already be true) and the state is still playing — and drops every
  held trigger the moment the layer changes state, so a hold never outlasts the rest of one loop,
  a resting state holds nothing, and a stale trigger never fires later. A held trigger satisfies
  only the transition it is held for (a sibling `fired win && big` never takes a `win` held for
  `idle → win`); a trigger fired in the same advance as a state change is held for the new
  state's exit-time transition, if one reads it. Firing a trigger IS firing
  the signal of that name on the instance's bus (§12 #4), so it is scoped exactly as a signal is.
- **`any`-state transitions are checked first**, in authored order, then the current state's; the
  first whose conditions all hold and whose `exitTime` has been reached fires. An `any` transition
  never re-enters the state the layer is already in.
- **`exitTime`** is a fraction of the leaving state's timeline the playhead must have reached, or,
  on a looping state, crossed during this tick. A transition with no conditions fires as soon as
  its exit time does — the usual "back to idle when the win ends".
- **Layers run in order**, and a later layer wins each node property both key (per property, not
  per node). Against a `playOn` timeline on the same node: a `playOn` timeline that is still
  playing and started after every layer driving the node wins it (a pop-in started after the
  machine's idle shows); once it ends, or the machine changes state, the layers take the node back
  — a pop-in, then idle, needs no transition. A node no layer drives keeps 4b's rule (the most
  recently started `playOn` timeline holds it, finished or not).
- **`blend`** mixes the target timeline in over that many ms from the pose being left — the
  previous timeline frozen at the moment of leaving (`blendNodeSamples`: offsets from 0, factors
  from 1, tint per colour channel, frame/visible/text stepping at half way). A transition taken
  mid-blend (or reached through a same-tick chain) leaves from the pose on screen: the player
  freezes every driven node's sampled values as a flat snapshot and mixes the next timeline in
  from it, so an interrupted blend never jumps and nothing nests.
- **At most 8 transitions fire per layer per tick** (`SM_MAX_TRANSITIONS_PER_TICK`); a longer
  chain continues next tick. A non-looping timeline holds its last frame.
- **The cues a leaving state crossed on the tick it was left still fire** (`LayerPlay.left`): a
  one-shot's `signal:done` at its very end is not lost to the "back to idle" transition on that
  frame. A layer's slot never seeks, so a big step (a fast `speed`, a capped frame) crosses every
  cue in it.
- **A state with `speed` ≤ 0, or a zero-duration timeline, is at rest**: it shows its pose and
  needs no tick. The normalizer keeps only a finite speed above 0 (validation: `state-speed-
  invalid`), drops a second layer with the same id (`layer-duplicate`) and a `blend` on a
  transition to `exit` (nothing to mix into).
- **The machine starts when its instance is first shown** — the rule 4b's `enter` follows: the
  entry state is entered and its cues at 0 fire on the first visible frame, never on a hidden
  screen at mount; until then every trigger but `enter` is ignored (a win heard while the screen
  was hidden must not play minutes late); from then on its clock runs whether or not the instance
  stays shown, like a `playOn` timeline's, and it keeps its state across re-appearances (Phase 7
  may reset it from Flow). The editor's preview, always visible, shows the entry pose as soon as
  it is built.
- **`exit`** ends the layer: it drives nothing and takes no transition until `reset()`.
- **A missing timeline never crashes the game**: the state is entered and holds (drives nothing,
  its exit gate is open) and the instance warns once with the ids.
- **Values** are derived, never stored: `<layer>.state` is the current state id
  (`componentInterface(def).values`, `runner.values()`); Phase 7's *Wait for state* reads them.
- **Per instance**: each placed instance with a `stateMachine` owns one runner, fed by its own
  signal bus (triggers) and the value sources its number inputs name, advanced on the Pixi ticker,
  each layer placed on its timeline through the 4b player's `drive(slot, layer, play)` — one node-
  driving path. The player binds the component's `playOn` timelines plus the state timelines it
  lacks, with their `playOn` stripped (`instanceTimelineDocs`): a state timeline reused from
  another component never also plays here as a free timeline on that component's signal. No
  `inputs`/`stateMachine` ⇒ no runner, no subscription, no ticker work (parity).

- **Inputs** absorb what `signals` do for behaviour: a signal reads as a trigger input
  (`componentInputs(def)` folds the two — §12 #4), and an engine value source (`winAmount`) can
  feed a number input (`source`). An input's `id` IS its wire contract (the name the game, a Flow
  `fireCue`, a rig `completeSignal` and Phase 7's pins use), so it has no display name: renaming
  an input is delete + add, and fields a newer build added to it are not kept (owner 2026-10-13).
  Layers, states and transitions keep their ids across renames (a display `name` on layers and
  states), which is what the keep-unknown-fields save grafts on.
- **Listeners** (as built, Phase 6a — `engine-layout/types.ts`, runtime in `componentEvents.ts`)
  are a node field, `on?: NodeListener[]`:

  ```ts
  interface NodeListener { id; event: 'down' | 'up' | 'enter' | 'leave' | 'click'; action: ListenerAction }
  type ListenerAction =
  	| { kind: 'fire'; input }                    // a trigger input
  	| { kind: 'set'; input; value: boolean | number } // a bool or number input
  	| { kind: 'toggle'; input }                  // a bool input
  	| { kind: 'raise'; event; payload? }         // one of the def's events (§6.1)
  // NODE_LISTENER_EVENTS / LISTENER_ACTION_KINDS are the exported lists the normalizer imports.
  ```

  `kind` discriminates the action so a later phase only adds kinds; a listener carries an `id` (the
  editor selects it; the keep-unknown save grafts on it). Runtime: only inside a component instance
  (the instance provides the context; a top-level scene node with `on` is inert). A node with
  listeners is wrapped in a `static` hit surface that takes the node's `zIndex` (`down` →
  `pointerdown`, `up` → `pointerup`, `enter`/`leave` → `pointerenter`/`pointerleave`, `click` →
  `pointertap`); a hover-only node keeps the default cursor but, like any hit surface, takes the
  pointer from what lies beneath it. `up` fires over the node only, as Rive's does: a release
  outside it is a `leave`. An instance answers only for its own def's nodes: a node of a layout tree
  a coded part renders inside it gets no wrapper. Listeners act on THEIR instance: `fire` fires the
  trigger exactly as a heard signal is (its rig `cues` play; the state machine, a `playOn` timeline
  and a `hiddenUntilSignal` gate hear it, scoped as the instance's signals are); `set` and `toggle`
  set the instance's runner's input. A wrong kind, an unknown input or an undeclared event does
  nothing (validation reports it). **Coexistence:** a listener on a node that is also a press target
  (`pressAction`, the art-button hit surface, a coded `ButtonFrame`) does not replace it — pointer
  events bubble and nothing stops them, so the press and the listener both fire and nothing about
  the press changes. Order: from the deepest node out, so a `pressAction` container's press runs
  before its own listeners' `up`, and the art-button surface around the whole instance (and its
  `pointerout` hover/pressed reset) after them. Button `stateAnimations` become a seeded state
  machine in Phase 8.
- **States raise events on entry**: `SmState.onEnter?: SmEnterAction[]` (a raise plus an `id`,
  unique within the state, that the editor selects and the keep-unknown save grafts on) — raised
  when the layer's entry state is entered as the machine starts, and for every state a transition
  enters (a same-tick chain raises each state it passes, in order).
- **One ordered raise queue per instance** (`ComponentEventDispatcher`): a state's `onEnter` and an
  `event:` cue are raised from inside a tick, or from the mount when the machine starts there, so
  they are queued and drained after the current work (a microtask in game) — a Flow chain never
  shows or hides screens mid-mount. A pointer event's raise drains the queue at once, after what was
  already queued. Within one tick, the cues the timelines crossed come first, then the states
  entered — so a newly entered state's `onEnter` is raised AFTER the `event:` cues at t=0 of its
  own timeline. The drain sends one raise at a time: a raise a Flow handler causes joins the end of
  the queue, and a destroy mid-drain stops the rest. A destroyed instance raises nothing, queued or
  later.
- **Ids for 6b:** the editor mints listener, `onEnter` and event ids that never collide with an id
  the last-saved def holds — including a row this build could not read (the save keeps it in place),
  the 5b `stateMachineIds` / `reserved` rule.
- The graph editor reuses `@xyflow/svelte`, as `/flow-v2` does.
- Existing `signals`, `cues`, `stateAnimations` and `valueBindings` keep working. Phase 8
  migrates them; nothing is migrated earlier.

## 6. The component ↔ Flow contract (how it all connects)

### 6.1 One interface per component

Every component publishes one typed **interface**. The state machine reads it, Flow wires to it,
and the editor shows it. It is the only thing Flow ever sees of a component:

```ts
interface ComponentInterface {
	inputs:  ComponentInput[];   // bool / number / trigger / text — what Flow can SET or FIRE
	events:  ComponentEvent[];   // what the component TELLS Flow: 'pressed', 'revealDone', 'landed'…
	values:  ComponentValue[];   // what Flow can READ: current state, a counter, a selected index
}
interface ComponentEvent { id: string; payload?: ParamDecl[] }   // ParamDecl = Flow's existing type
```

- **Inputs come in, events go out.** The component decides how it *looks and reacts*: its state
  machine, timelines and listeners. Flow decides what it *means*: logic, game state, which screen
  is shown. Rive draws the same line between its state machine and the host app's code. Here, the
  host app's code is Flow.
- **Events are raised by the component itself:** a listener (`on click → event 'pressed'`), a
  state being entered (`on enter Win → event 'winShown'`), or a timeline cue `event:revealDone`.

**As built (Phase 6a):** `ComponentDef.events?: ComponentEvent[]`, `ComponentEvent = { id;
payload?: ParamDecl[]; note? }` with Flow's own `ParamDecl` (engine-layout imports the type from
`engine-flow-v2`, no copy). `componentInterface(def)` now returns `{ inputs, events, values }`.

- **Cue syntax:** `event:<id>` on a COMPONENT timeline raises event `<id>` of the instance playing
  it. It is distinct from `signal:<id>`, which fires a trigger INTO the instance's own bus; an
  `event:` cue is never broadcast on the game's event emitter — on a def that declares events. A def
  that declares none keeps the cue's old meaning (broadcast by its bare name), so nothing that
  played before changes. Screen and cast timelines are unchanged. A cue carries no payload.
- **Payloads** carry numbers, bools and localization keys only (§8): a raise's `payload` maps a
  declared field to a number, a bool, `{ input: id }` (the current value of a bool or number input)
  or `{ key }`. A bare string is not a value. The stack is source-as-key, so a key IS its source
  text, held to the harvest's rule (`isLocalizationKey`: at least one letter), and the localization
  harvest collects every `{ key }` a placed def raises (`raisedPayloadKeys`, read with the def's
  text) — so no payload text bypasses translation. A field's `ParamDecl.type` is one of
  `EVENT_PAYLOAD_TYPES` (`int` / `float` / `ms` / `bool` / `string`); the normalizer drops any other.
  At runtime only the fields the event declares, each with a value its type takes (an `int` / `ms`
  a whole number), are sent.
- **The runtime road:** a raised event leaves through the same resolver a button's `action` press
  takes — `getFlowPress()(instanceNodeId, eventId, payload, 'event')`, tagged with the placed
  instance's node id and the event id. **Events have their own namespace on it** (coordinator
  decision, 2026-10-13): the resolver matches a `kind: 'event'` call against EVENT pins only, never a
  press or `action` pin of the same name, so an event `confirm` cannot run a `pressAction: 'confirm'`
  chain (`resolveFlowV2Press` returns nothing for it). Event pins are Phase 7's: until then a raised
  event reaches nothing in Flow, and the game plays no press sound for one. Every existing caller
  passes no kind. `observeComponentEvents` lets the editor's events log watch the same raises. Only
  declared events are raised.
- **Validation** (`validateComponentEvents(def, timelines)`): `event-duplicate`,
  `event-payload-duplicate`, `event-payload-type`, `listener-duplicate`, `listener-input-unknown`,
  `listener-input-kind`, `listener-value-kind`, `raise-event-unknown` (from a listener, an `onEnter`
  or an `event:` cue), `raise-payload-unknown`, `raise-payload-type`, `raise-payload-input`,
  `raise-payload-key` — errors;
  `raise-payload-missing` (a required field left empty) and `event-input-collision` — warnings.
- **Decision: an event may share an input's id** (a warning, not an error). They are different wires
  — an input comes in (an exec-in `▸ win`), an event goes out (an exec-out `onWin`), and events
  have their own namespace on the road — but a trigger of that id is also a signal on the
  instance's bus, which the warning says. A declared signal is already both today (a trigger input,
  and a container event the confirm dialog presses), so forbidding it would block Phase 8 from
  turning those signals into events.
- **Normalizer** (`componentEventRows.ts`, used by `componentStorage.ts`): keeps `events`, node `on`
  (the one node field it reads — every other node field still passes through) and `onEnter`,
  fail-closed on the read: a listener whose event, action kind, input, value or payload it cannot
  read — or that carries a key this build does not know inside its action, a payload value or a
  payload field's `type` — is dropped whole, never rebuilt without it; so is an `onEnter` row without an id or not a raise; a
  duplicate event, listener or `onEnter` id keeps the first. **An older build's save loses none of
  it** (#1185's rule): listeners graft a newer build's fields by id within their node, `onEnter`
  rows by id within their state, payload fields by name within their event, and a stored row the
  read dropped (an unknown action kind or pointer event, a payload type Flow cannot carry yet) is
  put back where it stood, as an unreadable input is; a row the author deleted is not. The version
  bump sees those rows too: a promote whose listeners, `onEnter` or payload differ only in what
  this build cannot read still bumps.
- This **generalises what exists**. Today a screen's container already surfaces its components'
  configured `action` events as exec-out pins (`containerEvents.ts`, derived and never stored, so it
  cannot drift). The interface is the same idea in both directions, typed: exec-out pins for events,
  exec-in pins for triggers, data-in pins for inputs, data-out pins for values.

### 6.2 What the author does

1. **In the Scene Editor**, place a component instance on a screen and give it a name: `spinButton`,
   `scoreReadout`, `board`.
2. **In Flow**, that instance appears in the palette under its screen, the way screens already
   appear today (`syncFlowContainers`). Drag it in and you get an **instance node**:
   - one exec-out per event (`spinButton ▸ onPressed`). Its pin id must NOT be the press pins'
     `containerEventDeclId` (`<id>.on<Event>`): on the same node, an event `confirm` would collide
     with the `pressAction: 'confirm'` pin `onConfirm`. Events have their own namespace on the
     runtime road (§6.1), so they get their own pin id form too.
   - one exec-in per trigger (`▸ win`)
   - one data-in per input (`amount #`)
   - one data-out per value (`state`)
3. Wire it like any other node: `spinButton.onPressed → Spin`,
   `winInfo → winBanner.amount ← payload.amount → winBanner.win ▸`,
   `Wait for winBanner.state == Idle`.
4. **Jump between the tools.** In the editor: right-click an instance → *Show in Flow*. In Flow:
   double-click an instance node → *Edit component* (it opens on the stage, in place).
5. **Preview together.** Flow's Preview drives the stage. Firing a trigger in Flow plays the
   component's state machine on the canvas, so logic and animation are checked in one place.

**As built (Phase 7a, 2026-10-13 — format, validator, runtime; the `/flow-v2` UI and the jumps are
7b):**

- **Two node kinds** in `engine-flow-v2` (`types.ts`): `componentInstance { container, instance }`
  — the screen (a container of the flow) and the placed node id — and
  `waitForState { container, instance, layer, state }`. Nothing of the component is stored on the
  node; `inputs` holds only the data-in sources, as on every node.
- **Pins are derived** (`instanceNodes.ts`, `deriveInstancePins`) from `PinContext.instances`: the
  placed, NAMED instances keyed by node id → `FlowInstanceDecl` (screen, name, component id, the
  pinned version, its `InstanceInterface`, or `missing: 'def' | 'version'`). Pin ids: exec-in `set`
  (apply the fed inputs, continue), exec-in `fire:<trigger>` (apply, fire, continue), optional
  data-in `in:<input>` (bool → `bool`, number → `float`, text → `string`), exec-out `exec`, exec-out
  `event:<event>` with data-outs `event:<event>:<field>`, data-out `value:<layer>.state` (string).
  The field is split off with `:`, which no event id or field name may carry (the def's validation
  refuses one, `event-pin-id`, and it gets no pin): an event id may carry a `.`, so `event:a.b`
  must never read as both event `a.b` and field `b` of `a`. The event form is deliberately not
  `containerEventDeclId`'s `<id>.on<Event>`. A number input the ENGINE feeds (`source`) gets no
  pin: the source would overwrite a Flow set on its next emit. No projection, a missing def or a
  decl on another screen ⇒ the base `[set, exec]` only, never guessed.
- **The projection** is the launcher's (`flowV2Projection.ts` `projectFlowInstances`): every
  container's scene tree, each `componentInstance` node with a non-blank `label`, its def resolved
  at the EXACT pinned version (`instanceDefResolver`; a built-in resolves any pin, as
  `loadComponent` does); `withPlacedComponentVersions` loads the pinned snapshots the way the bundle
  does (`collectComponentPins`) — only for a doc with an instance node, so a flow without one
  makes no new read. The `/flow-v2` loader, the publish gate (`validateFlowV2Against`) and the
  localization harvest share it. `engine-layout` turns a def into the Flow shape
  (`flowInstanceInterface`).
- **Validation** (errors, so Publish refuses): `instance-missing` (not placed with a name on that
  screen; def or pinned version lost), `instance-pin-missing` (a wire or stored source to an input,
  event or value the pinned interface lacks; a wait on a missing layer), `instance-state-unknown`,
  `instance-text-key` (a literal fed to a `text` input that is not a key),
  `instance-event-duplicate` (two nodes naming one instance wire the same event — the runtime walks
  the first wire only); a warning, `instance-text-wire`, when a `text` input is wired from a pin
  that is not a harvested key source (an instance event's payload field is; a compute string or a
  game-signal value is not), so no text bypasses localization silently. An event pin is its own
  entry root (`eventOwners`), so a payload data-out wired off its chain is `signal-cross-event`;
  `collapseToFunction` refuses a component node whose event pin is wired, as it refuses an entry
  point. Every check runs only when the caller projects the instances (never guess).
- **Runtime** (`runtime.ts`, env hooks `fireInstanceTrigger` / `setInstanceInput` /
  `readInstanceValue` / `awaitInstanceState`, all optional — a recorder env sets and fires nothing,
  reads `undefined`, never waits): on any exec-in every FED data-in is applied first, a `fire:` inlet
  then fires the trigger; `runFlowInstanceEvent` walks from the `event:<event>` pin's wired target
  with the payload on `$trigger` (the active mode's graph first); `flowOwnsInstanceEvent` is the pure
  ownership read, on the stored doc — a wire inside a collapsed group, or one crossing one or more
  group boundaries (stored from the outermost group's `out_<i>` pin, followed back in through each
  `boundary[].inner`), all count. The preview records each op as an `instance`
  entry.
- **The road:** `resolveFlowV2Press(id, event, payload, 'event')` (`apps/lines`
  `flowV2InterpreterHolder.ts`) resolves against `ownsInstanceEvent` ONLY — never the press pins —
  and the game plays no press sound for it.
- **The live instance** (`engine-layout` `flowInstances.ts`): `<ComponentInstance>` registers a
  handle under its node id while mounted — a TOP-LEVEL placement only (one nested inside another
  def is not Flow's to name); two mounted under one id stack, the last live — built Svelte-free by
  `flowInstanceHandle.ts`: `fire` (through the same `fireTrigger` a listener uses), `setInput`
  (the value read as the input's kind the way the runner reads one — a bool from a boolean or 0/1,
  a number from a number or a numeric string, a text key from a string; bool / number on the
  runner, text kept on the handle; anything else is dropped and the env traces the drop, a value
  replayed from the stash on mount included), `values`,
  `stateOf`, `onChange` (the machine started or changed state, the instance shown or hidden) and
  the screen id (`sceneIdContext`), which the env checks against the node's container on a fire, a
  set, a read and a wait alike (`flowInstanceWaits.ts`, every path gated): a handle on another
  screen is not the addressed placement — a fire, a read or a wait finds nothing there, and a set
  is kept for the addressed screen's own mount (the stash is keyed by screen and input), never set
  on that other handle. The game env's rule for one that is NOT
  registered lives in `apps/lines` `flowInstanceWaits.ts` (Svelte-free, every case gated): its
  screen shown per the mount model ⇒ it is mounting, a fire or a wait defers to the registration
  (250 ms grace, paid on EACH fire or wait against a placement that never registers, say a def the
  game lacks);
  not shown ⇒ a trigger is DROPPED (the state machine's own rule), a value reads `undefined`, a
  wait resolves at once, and an input set is STASHED and applied on the next mount (so "set the
  amount, then show the screen" works). A mounted but HIDDEN instance (its own gate or its screen's,
  `handle.shown()`) is "not on screen" to a wait too: it resolves at once, and a running wait is
  released when the instance hides. A wait is also released by the state, by the instance leaving
  the screen, or by a slam — a round already slammed holds nothing, and a slam during the mount
  grace releases the wait at once (a fire keeps its grace: it must not drop a beat). Every case is
  traced (`?flowlog=1`).
- **`text` inputs** (§8): `COMPONENT_INPUT_KINDS` gains `text`; a default is a localization key;
  `isLocalizationKey` has a twin in each package (engine-layout must not pull the `engine-flow-v2`
  barrel into every game's runtime graph for one regex; the gate holds the two together). The state
  machine
  never conditions on text (`condition-input-text`); the normalizer keeps the kind (an older build's
  save had kept the row in place, #1185); the harvest's **Flow component inputs** section
  (`origin: 'flow'`, `collectInstanceTextKeys`) lists every literal key a flow feeds one. Nothing
  renders a text input's value yet (`handle.input(id)` reads it) — binding it to a param, Rive's
  data binding, is an owner decision (§12).
- **Ship chain:** nothing new. The FlowDoc already ships; the placed def and its pinned version
  ride `resolveReferencedDefs`; the state timelines ride the cinematic export.
- **Gates:** `packages/engine-flow-v2/instanceNodes.fixture.ts` (pins, validation, runtime,
  preview, parity over every starter flow), `check:flow-instance-nodes` (projection, publish gate,
  text inputs, harvest, registry, the event road, the ship chain, source-scanned wiring),
  `check:flow-publish-gate` §14.

**As built (Phase 7b, 2026-10-13 — the editors):** the palette, node, inspector, jumps and the
Preview → stage bridge are described once, for authors, in [the Flow guide](../tools/flow.md)
("Components", "Jumps", "Drive the editor stage") and [the editor guide](../tools/invisible-editor.md)
("↗ Show in Flow"); the build detail and the owner browser checks are in
[status/flow.md](../status/flow.md) (2026-10-13, Phase 7b). Gate: `check:flow-instance-nodes-editor`.

### 6.3 Why it stays safe

- The pins are **derived** from the interface. Change the component and Flow's palette and
  validator follow. A wire to an input that no longer exists is a **validation error**, and
  validation already blocks Publish.
- The interface is **versioned with the `ComponentDef`**. An instance pins its version, as it does
  today, so editing a shared component cannot silently break a game's Flow.
- Today's slot Flow vocabularies, `fireCue`, `playCinematic` and the container events are not
  changed. The instance node is a new node kind alongside them.

## 7. Beyond slots: arcade and match-3 (the bigger plan)

### 7.1 The layers

The goal is that a new kind of game is new **data and vocabulary**, never a fork of the engine.
This is the same rule [game-type-templates.md](game-type-templates.md) set for slot types
(`{ data, mechanic }` + `packages/engine-game`), applied one level up:

| Layer | What it is | Slots (today) | Match-3 | Arcade |
|---|---|---|---|---|
| **Components** (this plan) | Look + react: timelines, state machine, interface | Buttons, banners, symbols | Gem, tile, booster | Player, enemy, pickup |
| **Screens** | Where things live | Base game, HUD, menus | Board screen, HUD | Play field, HUD |
| **Flow** | What things mean: logic, game state | Book events → presentation | Swap → match → cascade → refill | Input → move → collide → score |
| **Mechanic** (code, small) | The bit that must run fast or exactly | Reels, win lines, tumble | Grid model: swap, match find, gravity | Tick loop, movement, collision |
| **Outcome source** | Who decides results | RGS books | RGS books *or* local rules | Local rules (or RGS for prize games) |

Components, screens, timelines and the Flow ↔ component contract (§6) are **game-agnostic by
construction**. Nothing in §3–§6 mentions reels, symbols or books. That is what lets a match-3 or
arcade game reuse all of it unchanged.

### 7.2 What Flow needs for non-slot games (later, additive)

Flow v2's core is already generic: events, actions, branch, forEach, sequence, parallel, compute,
delay, functions, modes. Slot knowledge lives in the per-template **vocabularies**
(`reference/bookOf.ts`, `ways.ts`, `cluster.ts`…). A new game family brings:

1. **Game variables.** Typed, Flow-owned state: `score`, `lives`, `timer`, `level`, `movesLeft`.
   Bindable to component inputs, so a score readout updates without wiring every change (this is
   Rive's data binding).
2. **Input and time events.** Pointer and swipe events from component listeners (§6), keys, a
   **tick** event, and timers.
3. **Spawning.** Create or remove a component instance in a container or grid cell at runtime, and
   loop over the live set with `forEach`. Slots never needed this. Match-3 and arcade cannot work
   without it.
4. **A family vocabulary + mechanic.** Example for match-3: a `board` mechanic in `engine-game`
   (grid model, swap, find matches, gravity, refill) exposed to Flow as actions and events
   (`swap`, `onMatch`, `onSettled`). It builds on the existing cascade work (cluster tumble,
   [game-type-templates.md Phase F](game-type-templates.md)) and `reelGridGeometry`.

None of this belongs in the build of §10. It gets its own plan once §10's Phase 7 has shipped. **The
rule that matters now:** every phase of §10 must stay game-agnostic, so this later work only *adds*.

### 7.3 Protecting what exists

- **Slot games keep their vocabularies, their Flow docs and their coded paths.** New families are
  new templates with new vocabularies. A slot project never sees a match-3 node.
- **Every phase is parity-gated:** the current games still build, pass their tests and look the
  same (the Director "pipeline change" rule and the `regression-guardian` harness), before merge.
- **Nothing is migrated by force.** Old components keep `signals`, `cues` and `stateAnimations`. A
  component gets an interface only when someone opens it and adds one. Phase 8 converts the coded
  overlays one at a time, behind a flag.
- **Formats only grow.** New fields are optional. Older readers already skip what they don't know,
  as the cinematic evaluator does.

## 8. Text: one stack, no new text systems

**Owner direction (2026-10-09):** text handling is critical. Today the game has **one** text stack
([invisible-cinematic.md §12.2](invisible-cinematic.md)), and this plan keeps it that way:

```
Scene text node / Text Box  →  font catalog (Font Maker: web + bitmap)  →  key harvested into
/localization  →  reviewed translations baked  →  engine text resolver swaps by key in game
```

The rule from that §12.2 applies to everything new here: **a timeline, a state machine or a Flow wire
never embeds text. It references text the existing stack renders.**

| New thing | How it handles text | Stays in the stack because… |
|---|---|---|
| **Node actors** (§3.1) | A timeline animates a text node's transform, alpha and tint, like any node. | The node is still a Scene/component text node: same font, same key, same harvest. |
| **`text` channel** (§3.1) | Two modes only: **count-up** to a number (a win amount), formatted by the engine's existing number/currency formatting; or **switch key**, a stepped key that picks one of the node's own declared strings. No free text in a key. | A count-up is a number, not a string. Switched-to strings are text on the node, so they are harvested like any other. |
| **Component text input** (§6.1) | A `text` input carries a **localization key** or a number, never a sentence. | Flow `textMessage` already works this way: its text is the key and is harvested (`origin: 'flow'`). Flow wires to text inputs harvest the same way. |
| **State machine** | States and transitions hold no text. A state that shows different text plays a timeline that switches key. | Nothing to harvest; ids are internal. |
| **Rig text** | Unchanged: localized **art** regions per locale (`invisible-cinematic.md` §12.4a), cast into a timeline like any rig. | It is already in the pipeline. |
| **Shared timelines / components** | Text inside a shared component is harvested per project, as today. | `localizationHarvest.ts` already walks custom-component text. |

What the plan has to add so nothing is missed:

- **Harvest reads timelines.** `localizationHarvest.ts` / `localizationSections.ts` gain a
  `timeline` source: every switch-key string in a cinematic doc becomes a row (new auto `origin`).
  Without this, a key used only in an animation would be silently untranslated, which is the exact
  failure `invisible-cinematic.md` §12.2 warns about.
- **Fonts ship.** A text node a timeline reveals must still have its font exported. That happens
  already because the node is in the scene or component; `check:renderable-fonts` keeps proving it.
- **Editor preview.** Animate mode previews source text, the same as the canvas today. A locale
  preview toggle is a nice-to-have for the Phase 9 UX pass, not a requirement.
- **Win Text** keeps owning big-win/count-up presentation (`bakedWinText`). A component that
  shows a win amount reads the same formatting, so the two never disagree.

## 9. Every pipeline connection keeps working

**Owner direction (2026-10-09):** all tools must still talk to each other exactly as now. This
plan changes *editing*, not the pipeline. The connections it touches and how each is kept:

| Connection today | Format / path | What this plan does to it |
|---|---|---|
| Atlas Maker / Sheet Maker → Scene Editor, Rigger, FX, Flipbook | atlas + region refs | Unchanged. Timelines reference nodes, and nodes keep their region refs. |
| Rigger → Scene Editor, Cinematic, Symbols | `.irig`, `_shared/spines/` | Unchanged. Rig nodes take `animation` strips, as cinematics already do. |
| FX → Scene Editor, Rigger, Cinematic cues | `EffectDoc`, `fx:` cues | Unchanged; timeline cues are the same `fx:` cues. |
| Flipbook → Scene Editor, FX | `FlipbookClip` | Unchanged; the `frame` channel picks frames of the clip the node already has. |
| Font Maker → every text node | font catalog | Unchanged (§8). |
| Scene Editor → Flow | screens as containers (`syncFlowContainers`), component events (`containerEvents.ts`) | **Extended only:** instance nodes join them (§6). Existing container pins are untouched. |
| Component Editor → Scene Editor | `ComponentDef` + version pins + project defaults | **Extended:** optional `interface`, `stateMachine`, listeners. Pins and per-project defaults unchanged. Old instances render exactly as now. |
| Cinematic → Flow | `playCinematic` | Unchanged; it now plays screen timelines too. Component timelines play on their instances (`playOn`, §3.2), so Flow reaches them through the instance's signals (a `fireCue`). |
| Symbols, Win Text, Game Config, Sound, Localization → game | their own docs and bakes | Not touched. |
| Everything → game | export → `deploy/` → bake → pull → register (`runtimeBundle.ts`, `*Export.ts`) | **No new asset class.** Timelines ride the cinematic export; what they reference is added to `collectArtRefs` (rule 8). |
| Invisible Director → tools | `director/ops/*.ts` (`scene.ts`, `localization.ts`, …) | Its writes go through the same storage helpers, which keep fields they don't know. Director ops for timelines and state machines are a later addition, not a dependency. |
| Game Maker publish | published snapshot + flow validation gate | Validation gains the instance-node checks (§6.3). Publish itself is unchanged. |
| Multi-user saves | ETag-conditional saves, backups, History | New docs and fields use the same `saveDoc` / If-Match / backup path (`pipeline-concurrency` agent reviews each new save path). |

**How this is enforced, per phase** (not by promise):

1. **Formats only grow.** New fields are optional. The existing gates
   `check:doc-readers-unknown-fields` and `check:save-keeps-unknown-blocks` prove that every
   reader tolerates unknown fields and every save keeps what it doesn't understand. So an older
   tool opening a newer doc does not strip the new parts.
   **Owner decision (2026-10-13): component saves keep the fields they do not know**, like symbols
   and win text: unknown top-level fields, and inside every entity the author kept (matched by
   id) its unknown fields, on the save, the project defaults, promote and restore. A deleted
   entity is never resurrected. Rules: `docs/conventions/doc-readers.md`, "Round-tripping".
2. **Same storage, same ids.** No R2 path moves. Merging `/components` into `/editor` (Phase 4)
   changes the page, not where or how a component is stored.
3. **Gates run before each merge:** `check:all`, the launcher `check:*` gates (`art-scope`,
   `scene-cues`, `signal-scope`, `flow-publish-gate`, `renderable-fonts`, `pipeline-games`,
   `project-scaffold`, `win-text-doc`, …), the cinematic rigger-spike gates, and the
   `regression-guardian` current-games harness (every game still builds, passes and looks the
   same).
4. **One tool's change is checked from the other side.** Every phase lists the tools that read
   what it writes, and its PR shows each of them still loading a doc saved by the new code.

## 10. Phased build (each phase ships, parity-gated)

| # | Phase | Delivers | Main code | Size |
|---|---|---|---|---|
| 0 | **Decisions + ADR** — ✅ done 2026-10-13 | Owner signed off §12 (4, 6, 7 stay open); `invisible-editor.md` §8.7/§17 point here | docs | S |
| 1 | **Node actors + hosts** | §3.1–3.2 in the format, evaluator and `<Cinematic>` player; existing cinematics byte-identical; localization harvest reads timelines (§8) | `engine-cinematic`, `engine-layout`, rigger-spike gates | M |
| 2 | **Extract the sequencer** | §3.4: `/rigger` runs on the shared module with every cinematic gate still green | `static/rigger/cinematic.js` → shared module | L |
| 3 | **Animate a screen** — built 2026-10-13, owner browser check pending | Animate mode in `/editor` for a screen; Flow `playCinematic` plays it in game. **First end-to-end proof**, no state machine needed | `routes/(app)/editor`, Svelte wrapper | M |
| 4 | **Components in place** — 4a + 4b built 2026-10-13 (4a: components in place, `/components` folded in; 4b: component timelines played per instance), owner browser check pending | Components listed in `/editor`, edit in place with a breadcrumb, `/components` folds in; component timelines | `routes/(app)/editor` (`ComponentWorkspace.svelte`, was `components/+page.svelte`) | L |
| 5 | **Interface + state machine** — 5a (format, interpreter, per-instance runtime, gate `check:component-state-machine`) and 5b (the State Machine panel, the Inputs block, the stage preview; gate `check:component-state-machine-editor`) built 2026-10-13, owner browser check pending | The §6.1 interface (inputs, values) on `ComponentDef`; state machine graph, transition conditions, stage preview with input toggles; runtime interpreter | `engine-layout` (`stateMachine.ts`, `componentInterface.ts`), new editor panel | L |
| 6 | **Listeners + events** — 6a (format, runtime, validation, normalizer; gate `check:component-listeners-events`) on `main` (#1186); 6b (the editor: Listeners, Events, On enter, the pointer preview and Events log; gate `check:component-listeners-events-editor`) built 2026-10-13, owner browser check pending | Pointer events on nodes → inputs; the interface's **events** (from listeners, state entry, timeline cues) | `engine-layout`, `EditorProperties` | M |
| 7 | **Flow instance nodes** — 7a (format, validator, runtime, `text` inputs, gates) and 7b (the `/flow-v2` palette and node, the jumps, Preview drives the stage) built 2026-10-13, owner browser check pending | §6.2: placed instances in Flow's palette; instance node with pins derived from the interface; *Wait for state*; *Show in Flow* / *Edit component* jumps; Flow Preview drives the stage; validator + publish gate check every wire | `engine-flow-v2` (new node kind beside `containerEvents.ts`), `/flow-v2`, `apps/lines` interpreter | L |
| 8 | **Migrate the coded overlays** — plan in §13; **8a (Transition) built 2026-10-14**, owner browser check pending, live games still coded | Transition → Win → free-spin intro/outro → buttons, behind a per-project flag (default off), then retire the coded mounts (`invisible-editor.md` §8.7 "defang, don't gut") | `apps/lines`, built-in components | L each |
| 9 | **Shared library + UX pass** | `_shared/cinematics/` promotion and starter timelines; hierarchy lock/hide/solo, shortcuts, onion skin | editor, storage | M |
| 10 | **Game families plan** | A separate design doc for §7.2 (game variables, input/tick events, spawning, the match-3 `board` mechanic); match-3 first, because it reuses the cascade work | docs → its own phases | — |

**Ship chain (rule 8):** no new asset class. Timelines already travel export → deploy → bake →
pull → register as cinematics. What a node-actor timeline references must also ship: art it swaps
(frames, tints are values) and the FX/sounds its cues fire. Phase 1 adds those to
`collectArtRefs` / `cinematicRigNames` and extends `check:art-scope`.

**Why this order:** Phases 1–3 reuse what exists and give the first visible result: animate a
screen's intro in the Scene Editor, have Flow play it. Components, state machines and Flow inputs
build on that one timeline system rather than a new one. Phases 5–7 build the §6 contract in the
order it is used: what a component accepts, what it reports, then how Flow wires both. Phase 7 is
the point where a non-slot game becomes possible, so §7's work starts after it.

## 11. Alternatives considered

- **Embed the real Rive runtime and import `.riv` files.** Rive draws with its own renderer, not
  PixiJS, so it would not share our atlases, rigs, FX, fonts, device layouts or the bake chain.
  **Not recommended** as the core path.
- **A second timeline just for components** (the old §17 `BehaviorTrack` plan). Two keyframe
  engines, two UIs, two formats. Rejected per owner direction: timelines must be reusable.
- **Rebuild the sequencer in Svelte and embed it in `/rigger`.** Cleaner end state, but it
  re-does a live-verified tool and puts every cinematic gate at risk at once. Extracting the
  existing panel (Phase 2) is lower risk.

## 12. Open decisions (owner)

1. **Lift the `invisible-editor.md` §8.7 deferral** for *component* state machines — **DECIDED
   (owner 2026-10-13): yes, lifted for component state machines only.** Presentation-only; screens
   get no state machine; Flow stays the game's top-level logic.
2. **Merge `/components` into `/editor`** (Phase 4) — **DECIDED (owner 2026-10-13): merge.** One
   Rive-style editor with in-place component editing. Component storage does not change.
3. **Name.** — **DECIDED (owner 2026-10-13): the UI name is *Timeline*.** The Rigger's multi-rig
   mode may keep the label "Cinematic". The file format (`.icin` / `CinematicDoc`) stays.
4. **Inputs vs signals** — **DECIDED (owner 2026-10-13): fold.** One concept: a declared
   signal reads as a trigger input (`componentInputs()` / `componentTriggers()` in
   `engine-layout/componentInterface.ts`), every reader of `ComponentDef.signals` goes through
   that helper, and no def is rewritten (`signals` stays readable forever; Phase 8 migrates). Firing
   a trigger is the same event as firing the signal on the instance's bus, with the same scoping,
   so a Flow `fireCue`, a 4b `playOn` timeline and the state machine all hear it. In the editor,
   "Component variables → Signals" becomes **Inputs** (a kind per row; existing signals show as
   trigger inputs) — Phase 5b.
5. **Which proof first** for Phase 3 — **DECIDED (owner 2026-10-13): a screen intro.** Animate a
   screen's intro in the Scene Editor and have Flow's `playCinematic` play it in game.
6. **Outcome source for the new families.** Are the arcade and match-3 games real-money games
   whose results come from the RGS (the player's moves are presentation, as in a cascade slot), or
   skill / free-play games where the client's own rules decide? This decides how much logic Flow
   must own, and it is the biggest single fork in §7. Not needed before Phase 10.
7. **Rive references.** Screenshots or a short recording of the Rive screens you want copied
   would sharpen Phases 4 and 9.

## 13. Phase 8: overlay migration (plan — 8a Transition first)

> Plan only. Progress lives in [status/engine.md](../status/engine.md),
> [status/component-editor.md](../status/component-editor.md) and [status/cinematic.md](../status/cinematic.md).
> Pilot policy, **decided by the coordinator (2026-10-14), pending the owner**: the flag is **off
> for every live game and project**; the coded Transition stays the default path everywhere; the
> authored Transition is piloted on the `apps/lines` dev build and the parity gate, never turned on
> for a live game in the 8a PR; a test project (test3/4/5) is switched by the owner through the Game
> Settings row for the browser check, and live games only after it. Decisions 13.5 #1–#7 were taken
> the same day (the recommended option each time; #7 as its own pipeline PR after 8a, before 8b).

Phase 8 migrates the coded overlays to authored components one at a time, each behind a flag, in
the order **Transition → Win → free-spin intro/outro → buttons**, and retires each coded mount only
once its authored version matches on screen (`invisible-editor.md` §8.7 "defang, don't gut"). 8a
is the Transition only. The other three are inventoried here so 8b–8d start from the same map;
nothing about them changes in 8a.

### 13.1 Inventory of the coded overlays (2026-10-14, `main` 038bcd9)

Every coded overlay today is a `bind` node inside an authored scene (the §8.7 hatch), and three of
the four already have a `componentInstance` twin whose bound child renders the same coded part at
the node's position (`boundToInstance: true`, the 2026-06-19 "hybrid"). None has a Timeline or a
state machine. The driver for all of them is the Flow v2 reference choreography
(`packages/engine-flow-v2/src/reference/bookOfChoreo.ts`); the coded `bookEventHandlerMap`
handlers in `apps/lines` are state-only and no longer show any of them.

| | **Transition** | **Win** | **Free-spin intro / outro** | **Buttons** |
|---|---|---|---|---|
| **Mounts** | `basegameOverlays` node `bound-transition` → `bind: { component: 'Transition' }` (`referenceLayouts/lines.ts:143-164`, same node in `bookof.ts:206` and `engineSkeleton.ts:166`); the scene is mounted unconditionally (`Game.svelte:2567`). Coded part: `packages/engine-game/src/components/Transition.svelte` + `TransitionAnimation.svelte`; registered in `registerBoundComponents` (`Game.svelte:482-490`). Twin: `TRANSITION_DEF` (`builtinComponents.ts:845-874`, id `transition`), emitted by the fallback doc only when `TRANSITION_INSTANCE` (`apps/lines/src/game/editorFlags.ts:35`, **off**). | `basegameOverlays` `bind:Win` (composer) or `bind:WinGate` + a `game`-space `componentInstance(win)` when split (`lines.ts:170-215`, `WIN_INSTANCE` off). `Win.svelte` = `WinGate` (dim, count-up driver, press, round hold) + `WinVisual` (rig, count, caption, coins). Twin: `WIN_DEF` (`builtinComponents.ts:1170`). `resolveWinMount` (`engine-game/winOwnership.ts`) keeps exactly one `winUpdate` subscriber. | Screens `freeSpinIntro` / `freeSpinOutro` (`engine-layout/freeSpinScenes.ts`): a `tapToContinue` instance + a container `bind:FreeSpinIntroVisual` / `bind:FreeSpinOutroVisual`. Headless `FreeSpinOutroDriver` mounted under a v2 flow (`Game.svelte:2562`). Twins: `FREE_SPIN_INTRO_VISUAL_DEF` / `FREE_SPIN_OUTRO_VISUAL_DEF` (`builtinComponents.ts:887,944`). The coded composers were retired in #807. | Two paths: coded `UI.svelte` → `UIDefault` → `Layout*` (`components-ui-pixi`; cluster / ways / scatter / price, the book-of reference) and the parametric `componentInstance(button)` → `BUTTON_DEF` → bound `ButtonFrame` + `ButtonLabel` (`apps/lines` default, `HUD_BUTTON_INSTANCES = true`). Confirm dialogs: `CONFIRM_DIALOG_DEF` with `pressAction` containers and signals `confirm` / `cancel`. |
| **Renders / animates** | One rig: asset key `transition` (`apps/lines/src/game/assets.ts:265`, static in every game, scale 2), clip `animation`, **≈1.667 s**, no Spine events; `RigProvider` at canvas centre, `height = canvasHeight × 1.7`. No tween, no FX, no sound, no text. | Count-up (`WinCountUpProvider`, linear, `presentDuration` per tier from `winLevelMap.ts`: 0.6 s … 32 s), the `bigwin` rig (`<tier>_win_intro/idle/exit`, escalation chain), coin particles (`fountain`), count text in font `gold` (`bookEventAmountToCurrencyString`), optional tier caption from the Win Text doc, dim 0.5 on big tiers. Sounds from the choreography (`bgm_winlevel_*`, `sfx_bigwin_coinloop`). | Intro: `fsIntro` frame rig + `fsIntroNumber` rig + sprites `freespins_{lang}.png` + the count in font `gold`. Outro: the same frame, `fsOutroNumber`, `winsmall_{lang}.png` / `totalwin.png`, a count-up with `CountUpInteraction`. Sounds from the choreography (`sfx_superfreespin`, `jng_intro_fs`, `sfx_youwon_panel`). | Painted tiles or `image*` state frames (`buttonStateImage.ts` cascade spinning → disabled → pressed → hover → selected), a ticker rotation while spinning, `UiFadeContainer` on `uiShow` / `uiHide`; no tween on the coded tile; press sounds `soundPressGeneral` / `soundPressBet` / `soundPressStop`. `RigNode.stateAnimations` exists for art buttons only. |
| **Driven by** | Emitter event `{ type: 'transition' }`, **awaited**: `Transition.svelte` subscribes and holds `broadcastAsync` until the rig's `complete`. Fired by the v2 `fireCue transition {wait}` in `freeSpinTrigger` (`bookOfChoreo.ts:269`, unskippable) and `freeSpinEnd` (`:332`, raced by the slam); `flowV2Runtime.svelte.ts:642-669` awaits `Promise.all([waitPresentation(cueAnimationMs/timeScale), broadcastAsync])`; `boundComponentMs` (`:521-525`) tells `showContainer.durationMs` the clip length. The v1 fixture (`flowDoc.ts:124,167`) is dev-only. The coded handlers never fire it. | `setWin` → `winShow` · `winUpdate{amount, winLevelData}` (awaited, `awaitCue`; unskippable when big) · `winHide`. Taps through `PressToContinue` / `CountUpInteraction`. Signals `win`, `bigWin`, `winCountUpComplete`; values `winCountUpAmount`, `win`, `totalWin`. | Screen holds from `drivenSeed.ts` `withFreeSpinScreenHolds`: `Show(intro)` … `Show(intro, awaitComplete)` released by the tap; the outro count-up through `awaitPresentation('freeSpinOutroCountUp')`, always raced. Signals `freeSpinStart` / `freeSpinEnd` / `freeSpinOutroCountUpComplete`; values `freeSpinsWon`, `freeSpinOutroTotalWin`. | `pressAction` names → `firePress` → `getFlowPress()` (`resolveFlowV2Press`, container event pins) → else the coded `registerComponentActions` body; gates from XState / `stateBet` (`isSpinButtonDisabled`, `isCelebrationLocked`, …). |
| **Used by** | Every lines / bookOf / ways / scatter / cluster / holdAndWin project carries the node; it plays only under a flow that fires `transition` (every driven-seed project, on free-spin entry and exit). Book of Borut may place the `transition` twin (editor-doc-driven). | Every reference layout (`bind:Win`); Borut places the `win` visual and authors the gate out. | Every reference layout and template seeds both screens; test2–test6 lost theirs pending data migration (#807). | `apps/lines` parametric; the other reference games coded. |
| **Per-game customisation** | None: no params, fixed asset and clip; position only through the twin. | Per-tier params (`<alias>Spine/Slot/Intro/Idle/Outro/Duration`), Win Text doc (`winLevels`, `amountFormat`), `bakedWinPresentationParams()`. | Def params (`introSpine`, `idleAnimation`, `slotName`, …), scene overrides, `tapArmAfterSignal`. | Instance params (`variant`, `tint`, `image*`, `label`), `stateAnimationOverrides`, baked custom defs shadowing `button`. |
| **Gates today** | **None** behavioural (`test-engine-owned-only.mjs` asserts the node's presence only). | `check:engine-game` (`winTapLand`, `winLadder`), `check:big-win-cue`, `check:win-x`, win-text gates, `fs7Win`. | `pressAfterArm`, `winLadder`, `introRevealRetrigger`, `fs7Outro`. | `check:hud-menu-pins`, the listeners/events and state-machine gates (confirm dialog), the harness. |
| **current-games** | No screen targets it; `fs-trigger` is captured at a fixed frame and may or may not land on the wipe. | `bigwin-x10…x120`. | `fs-trigger`, `fs-board`, `fs-spin`, `fs-settled`. | `loaded`, `idle`, `spin`. |

What the inventory decides for the order: the Transition is the only overlay with **no text, no
sound, no params, no round state and one fixed clip**, so it is the pure proof of the
component-timeline path. Win and the free-spin outro share a count-up and a round hold
(`winState` / `freeSpinOutroState`), so 8b–8c reuse one "awaited count-up" pattern after 8a has
proven the hold. Buttons are last because their behaviour is the press road, not an animation;
8d is "`stateAnimations` and `image*` frames become a seeded state machine" on the existing
`button` def.

### 13.2 8a design: the Transition as an authored component

**The component.** A new built-in `ComponentDef`, id `transitionWipe` ("Transition wipe",
`scope: 'shared'`, `category: 'overlay'`), beside — not instead of — the existing `transition`
twin. A new id touches no published doc (every game that baked a copy of `transition` would
otherwise render "as republished" in the harness, and Borut's placed twin would change under it).
Its root is one rig node named **`wipe`**: the engine bundle `transition`, resting on no clip
(nothing drawn until the timeline plays), `coverFit: true`, `fit: 'height'`, `coverScale: 1.7`
— the same cover math a `background` node uses, so the authored wipe sizes to the canvas height
the way `TransitionAnimation`'s `height = canvasHeight × 1.7` does, on every layout type and on an
authored Canvas Size. (If `coverFit` on a rig node inside an instance does not reproduce the coded
box to within the tolerance, the fallback is a per-layoutType scale in the def's device layouts,
measured once per layout type; the parity gate decides.)

**The Timeline.** A built-in `CinematicDoc`, id `c_transitionwipe_wipe` (lower-case, as a project's
cinematic ids are stored, so a project timeline can shadow it), `host: { kind:
'component', componentId: 'transitionWipe' }`, one node actor `wipe` with one **`animation`**
track: a single strip of clip `animation` from 0 to its clip length (read from the loaded skeleton,
≈1667 ms), no loop. `playOn: 'transition'` and the new field below. Built-in timelines are a new
code module, `engine-layout/builtinTimelines.ts` (`BUILTIN_TIMELINES`), registered at boot by
`registerBakedComponents()` as `registerComponentTimelines([...BUILTIN_TIMELINES,
...bakedCinematics()])` — built-ins first, so a project doc with the same id shadows one, exactly
as a project component shadows a built-in def. A built-in timeline is code, like a built-in def:
**no new asset class** (rule 8). The rig it plays is `assets.ts`' static `transition` bundle,
already in every game and in every delivery.

**`animation` strips on rig node actors (new in 8a, §3.1's open item).** The evaluator already
samples `animation` tracks for rig actors; the component player (`componentTimelines.ts`) gains the
same for a `kind: 'node'` actor whose node is a rig: its sample carries `animTime: { animation,
time }`, and the node driver feeds it into the rig's existing `animTime` value-binding fold
(`valueBindings.ts` `animTimeScrubs`, the Hold and Win 12b scrub), so a strip does to a rig node
exactly what a scrubbed binding does. A strip's end holds its last frame (the 4b rule). Screen
timelines get the same for free; `/rigger` cast actors are untouched. Win (8b) and the free-spin
rigs (8c) need this too, so it is built once here. Fallback if the owner judges this too large for
8a: the rig node's existing `cues` ("Plays on signal `transition` → `animation`,
`completeSignal`") with no timeline — rejected as the default because it proves nothing about the
Timeline path Phase 8 exists to prove.

**The trigger and the hold (timing parity).** The game fires `transition` as today: the v2
`fireCue transition {await}` reaches the instance through the open signal bus (`emitComponentSignal`
→ `getComponentSignal('transition')`, the 4b road), and the `playOn` timeline starts. What the
coded part adds — holding the awaited broadcast until the rig completes — becomes one new,
opt-in timeline field: **`CinematicDoc.holdsCue?: true`** ("Holds the cue until done", a tick
beside **Plays on** in Animate). An instance whose started timeline carries it registers the play's
end with a small Svelte-free registry (`engine-layout/cueHolds.ts`: `holdCue(cue, promise)` /
`cueHolds(cue)`); the v2 runtime's awaited `broadcast(cue)` adds `Promise.all(cueHolds(cue))` to
the `Promise.all` it already awaits (`broadcastAsync` + the measured `waitPresentation`). So the
flow continues at the same point: the end of the wipe. The hold is observed, not measured, so it
is right under turbo and on a slow frame, as the coded `complete` is; a looping timeline never
holds; an instance that is not mounted holds nothing (as an unmounted coded part would not
subscribe). `awaitCue` wraps the whole await as today, so the slam rule is unchanged: the
free-spin-entry wipe stays unskippable, the exit wipe stays raced. Default off ⇒ every existing
`playOn` timeline keeps its fire-and-forget timing (parity). The awaited fire is NOT also
measured: today's awaited `transition` measures 0 (`cueAnimationDurationMs` walks rig cues, never
a `bind`), so the hold alone is exact parity; a measured wait on top would stack a second clock
(decided at build time, 2026-10-14). `showContainer.durationMs` keeps its number too:
`sceneAnimationDurationMs` gains `instanceHoldMs` (an instance whose timeline holds a cue measures
as that timeline), the authored twin of `boundComponentMs`, so a screen holding the swapped node
measures the same 1667 ms.

**The flag (per project, default off).** A sparse boolean in the Scene Editor's existing
per-project game settings, `LayoutDoc.settings.authoredOverlays?: { transition?: true }`
(`GameSettings`, `engine-layout/types.ts:1287`), written only when on — the pattern the symbols
doc's `winExplode: { enabled: true }` set ("an implicit trigger would fire on every existing
project and break byte-parity"). It needs no new storage, export, bake or pull: `settings` rides
inside `bundle.doc` through live, publish (`runtime.json`) and the offline bake already. Three
things to thread: `normalizeGameSettings` (`editorStorage.ts:236`, a whitelist — an unthreaded
field round-trips away) and the `check:doc-readers-unknown-fields` §settings case; the `/editor`
Game Settings panel gains an **Authored overlays (pilot)** block with one row, *Transition*, and
`buildGameSettings()` keeps returning `undefined` when every setting is default; and the publish
chip (`gameProfile.ts`) names it, so a publish shows what it ships. The `apps/lines` dev build
pilots it the way its other engine flips are piloted: a module constant
`AUTHORED_TRANSITION = false` in `editorFlags.ts` puts the flag on the fallback doc. **No URL opt-in
exists** (decided at build time, 2026-10-14): a per-boot hook could reach a live runtime, and the
parity gate does not need one — it serves the game a doc with the flag set, the way a published
project is served (with `?flowV2=lines`, the committed reference flow, since the coded handlers
never fire `transition`).

**How the runtime picks the path.** From the doc, when `loadEditorScenes()` settles and before any
of its scenes mount: with the flag on, every `bind: { component: 'Transition' }` node in EVERY
scene becomes `{ kind: 'componentInstance', componentId: 'transitionWipe' }` carrying the coded
node's own x / y / scale / rotation / alpha and per-layout `overrides` (the coded part drew at the
canvas centre inside the node's wrapper; the instance's rig cover-fits the canvas inside the
instance the same way, so a moved Transition stays moved — the reference layouts keep it at the
origin), through the pure `withAuthoredTransitionDoc` (`engine-layout/authoredOverlays.ts`); the
reference overlays scene a doc without its own gets is swapped under the same flag; and the coded
`Transition` part is retired for that boot (`engine-game` `retireCodedOverlay`: it neither
subscribes nor draws), so a project that also placed the `transition` twin (Borut) plays one wipe,
not two; both flow interpreters are built from that swapped doc. ONE rule, `authoredTransitionStatus`,
tells the runtime and the publish chip what the flag does to a doc, so the two never disagree:
`ready` (swap), `nothing-to-replace` (no scene binds a coded Transition and the doc has an overlays
scene of its own: the coded path stays, the chip warns) or `non-canvas-scene` (a coded Transition
sits in a `game`, `standard` or `background` scene, where the authored rig cannot cover-fit: the
coded path stays everywhere, the chip warns).
With the flag off the doc and every scene are the same objects (parity) and `transitionWipe` is a
registered def nothing references (as `TRANSITION_DEF`'s registration is today); it is `internal`,
so no palette offers it during the pilot. The emitter vocabulary, the Flow vocabulary
(`transition` stays a cue), the choreography and every shipped FlowDoc are untouched.

**Removal, later (not in 8a).** When the owner switches the live games: (1) the `transition`
built-in def's next version replaces its bound child with the `wipe` rig node and the timeline
(pinned instances update per instance, the designed path); (2) the reference layouts emit the
authored node; (3) `Transition.svelte`, `TransitionAnimation.svelte`, `boundToInstance`,
`TRANSITION_INSTANCE` and `boundComponentMs`'s Transition case are deleted; (4) the flag becomes a
no-op, is dropped from the normalizer one release later, and the `authoredOverlays` block keeps
only the rows 8b–8d still need. `holdsCue`, built-in timelines and rig-node strips stay: they are
the general mechanism.

### 13.3 The parity proof (gates, all behavioural)

- **Flag off: byte-identical.** The current-games harness must report **0 changed screens** on
  the PR (every fixture and every live doc has no `authoredOverlays`). A new launcher gate,
  `check:authored-transition`, drives the real code: the overlays rewrite returns the same scene
  object for every reference layout and for a doc with the twin placed; `normalizeGameSettings`
  keeps `{ transition: true }` and drops nothing else; the existing component-timeline,
  state-machine and cinematic gates stay green with the built-in timeline registered first; a
  `playOn` timeline without `holdsCue` still returns from an awaited fire at once. The coded part
  itself is proven by the parity gate's coded side (the real game, headless), not by a mount here.
- **Flag on: authored vs coded frames.** A root gate, `check:transition-parity`
  (`scripts/transition-parity/run.mjs`; its CI job is its own workflow file,
  `.github/workflows/transition-parity.yml`, landed as a workflow-only follow-up PR because the
  current-games verdict counts every `.github/workflows/` file as harness and would refuse to vouch
  for the runtime change beside it; the job is advisory, not in the `main` ruleset — the owner may
  make it required): it
  boots the built `apps/lines` twice in the headless shell (`scripts/playtest/headless-shell.mjs`,
  `?ie_determinism=<seed>`, 1280×720, DPR 1, the book mock with `FORCE_TRIGGER=1`, `?flowV2=lines`),
  once on the harness's stand-in snapshot as published and once on the same snapshot with the flag
  set in its layout doc; it steps frames until the `transition` cue
  fires (the determinism probe's `state()` gains an additive `cues` list, the fired cue names in
  order — `DeterminismApi`, `apps/lines/src/game/determinism.ts`), captures the cue frame as the
  reference (no wipe yet on either side) and **200, 400, 800, 1200 and 1600 ms** after it (frames
  12 / 24 / 48 / 72 / 96 at 60 fps), compares each pair with `pixelmatch` under
  `scripts/current-games/tolerance.json`'s defaults (≤ 0.1 % differing pixels, no 16×16 block over
  threshold), and requires each coded frame to differ from the reference by more than 0.5 % of its
  pixels (the wipe IS on screen). It also records the frame at which the next cue
  (`freeSpinIntroShow`) fires on each side; they must be equal ± 1 frame. The gate reports the
  five diff ratios and the two frame numbers; a frame outside tolerance fails it and keeps the
  images as artifacts. The harness's own screen lists are not edited in 8a (editing
  `scripts/current-games/**` fails `current-games` by design); whether an `fs-transition` key
  screen joins `screens/*.json` is a separate pipeline change for the owner (13.5 #7).
- **Timing parity, headless.** In `check:authored-transition`: with a stepped clock, an awaited
  fire of `transition` through the instance's own hold seam resolves at the strip's end and not
  before, an unmount mid-hold releases it, and `showContainer.durationMs` reads the same for the
  coded and the swapped scene; the shipped rig clip's last key equals the timeline's length. The
  parity gate also runs a flow-container variant (the Transition node moved into `hudCorners`, a
  canvas screen the flow mounts), which proves the swap reaches the scenes the interpreters render.
  **Browser check only:** the slam race on the exit wipe (`awaitCue` wraps the whole await,
  unchanged in code) and the hidden-instance rule (no hold registered while the instance is off
  screen) live in the Svelte seam; neither has a headless gate, so both are owner browser-check
  steps in the PR.
- **Text.** The def has no text node; the localization harvest of a doc with the flag on equals
  the harvest with it off (asserted in the gate).

### 13.4 Text and localization

The Transition carries no text, so one thing to prove, not to build: nothing new enters the text
stack (§8). The built-in def declares no text node, the timeline no `text` track, and the harvest
rows of a project are identical with the flag on and off. Later overlays keep their keys: the Win
caption stays a Win Text key, the free-spin count stays a number, and 8b–8c add no key of their
own.

### 13.5 Risks and open questions (owner)

1. **Flag home.** `LayoutDoc.settings.authoredOverlays` (recommended: no new storage, ships in the
   doc) vs a symbols-style sparse switch in another doc. Default: the settings block.
2. **New def id `transitionWipe`** beside `transition` (recommended: no published doc or Borut
   placement changes) vs bumping `transition` to v2 now. Default: the new id; `transition` v2 at
   retirement.
3. **Build `animation` strips on rig node actors in 8a** (recommended: Win and FS need them, the
   fold already has `animTime`) vs the rig-cue fallback with no timeline.
4. **`holdsCue` as an opt-in timeline field** (recommended: existing `playOn` timelines keep their
   timing) vs holding every awaited cue a `playOn` timeline starts.
5. **Pilot surface.** The `apps/lines` dev build plus the parity gate (recommended, verifiable
   without a login) vs a dev/test project in the launcher (needs the owner's browser to set the
   flag and publish). Decided: both, in that order — the gate now, a test project for the owner's
   browser check through the Game Settings row.
6. **Sizing.** `coverFit` height × 1.7 on the rig node (recommended) vs per-layout scales; the gate
   measures it. Risk: the coded box is the rig's authored height, the cover box is the measured
   art; if they differ by more than the tolerance, per-layout scales are the fallback.
7. **Harness.** Add an `fs-transition` key screen (captured a fixed number of frames after the
   `transition` cue) to `screens/*.json` as its own pipeline change? Today no screen targets the
   wipe, so a regression in the coded path would pass the harness.
8. **Risk: the hidden coupling of `basegameOverlays`.** Projects that author the overlays scene
   themselves (Borut) keep the `bound-transition` node only if the reference had it; the rewrite
   covers any `bind:Transition` node wherever it sits, and a project with none and the flag on gets
   no wipe at all — the gate reports that case as a warning in the publish chip.
9. **Risk: a per-boot dev hook.** Resolved by not having one: the flag is read from the doc only,
   so no player URL can flip a live game, and the gate feeds the game a flagged doc instead.
