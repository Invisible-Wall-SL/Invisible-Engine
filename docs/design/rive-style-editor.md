# Rive-style Scene + Component Editor — Plan (draft, owner review)

> Status: **PROPOSED, not started.** Owner ask (2026-10-08): make the Scene Editor and the
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
> ⚠️ Phase 5 **reverses a standing decision**: [invisible-editor.md §8.7](invisible-editor.md) and
> §17 deferred "route A — Rive state machine" (2026-06-05, re-confirmed 2026-06-09). The owner
> needs to lift that deferral, scoped to *component* state machines (§2). §17's planned
> `BehaviorTrack`/`TweenStep` timeline is superseded by §4 here; neither was ever built.
>
> **Owner direction (2026-10-09, third pass):** this is part of a bigger plan. The same tools must
> later build **other kinds of games — arcade, match-3** — the way Rive can, so the Flow connection
> has to be seamless and not slot-shaped. And none of it may break the work and the games we already
> have. §6 (the component ↔ Flow contract) and §7 (beyond slots) answer that.

## 1. The hybrid: what we keep, what we take from Rive

| Area | Keep (ours) | Take from Rive |
|---|---|---|
| **Screens** | Screens list, spaces (`game`/`standard`/`canvas`/`background`), list order = layer order, device layouts, In-game view | Screens can carry timelines (enter / exit / idle) played by Flow |
| **Game logic** | **Invisible Flow** is the game's top-level state machine: book events, screens, wins, features | — (Rive's root state machine is what Flow already is) |
| **Components** | `ComponentDef`, params, versions, per-project defaults, value bindings, the ship chain | Edited **in place on the stage**; **Animate mode**; a **state machine** with **inputs**; **listeners** (pointer events → inputs) |
| **Timelines** | The **Cinematic** timeline from `/rigger` (format, evaluator, player, UI) | Timelines on any component or screen, reusable across them |
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

## 3. One timeline system (the Cinematic timeline, extended)

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
- **UI** — the sequencer + dopesheet in `/rigger` 🎬 Cinematic mode (`static/rigger/cinematic.js`).

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
screen's enter/exit can, and Flow's `playCinematic` can play any of them.

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
│ Animate: [Timelines ▾ intro | win | idle]  ← the shared Cinematic sequencer              │
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

```ts
interface ComponentInput { id: string; kind: 'bool' | 'number' | 'trigger'; default?: boolean | number }

interface ComponentStateMachine {
	layers: { id: string; entry: string; states: SmState[]; transitions: SmTransition[] }[];
}
// SmState:      { id, timeline: string /* cinematic id */, speed?, loop? } | 'any' | 'exit'
// SmTransition: { from, to, conditions: (bool == | number < > == | trigger fired)[],
//                 exitTime?, blend? }
```

- **Inputs** absorb what `signals` do for behaviour: a signal reads as a trigger input, and an
  engine param (`winAmount`) can feed a number input.
- **Listeners** are a node field: `on: 'down' | 'up' | 'enter' | 'leave' | 'click'` sets an input or
  fires a trigger. Button `stateAnimations` become a seeded state machine.
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
  state being entered (`on enter Win → event 'winShown'`), or a timeline cue
  (`signal:revealDone`).
- This **generalises what exists**. Today a screen's container already surfaces its components'
  configured `action` events as exec-out pins (`containerEvents.ts`, derived and never stored, so it
  cannot drift). The interface is the same idea in both directions, typed: exec-out pins for events,
  exec-in pins for triggers, data-in pins for inputs, data-out pins for values.

### 6.2 What the author does

1. **In the Scene Editor**, place a component instance on a screen and give it a name: `spinButton`,
   `scoreReadout`, `board`.
2. **In Flow**, that instance appears in the palette under its screen, the way screens already
   appear today (`syncFlowContainers`). Drag it in and you get an **instance node**:
   - one exec-out per event (`spinButton ▸ onPressed`)
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

None of this belongs in the build of §8. It gets its own plan once §8's Phase 7 has shipped. **The
rule that matters now:** every phase of §8 must stay game-agnostic, so this later work only *adds*.

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

## 8. Phased build (each phase ships, parity-gated)

| # | Phase | Delivers | Main code | Size |
|---|---|---|---|---|
| 0 | **Decisions + ADR** | Owner signs off §10; `invisible-editor.md` §8.7/§17 point here | docs | S |
| 1 | **Node actors + hosts** | §3.1–3.2 in the format, evaluator and `<Cinematic>` player; existing cinematics byte-identical | `engine-cinematic`, `engine-layout`, rigger-spike gates | M |
| 2 | **Extract the sequencer** | §3.4: `/rigger` runs on the shared module with every cinematic gate still green | `static/rigger/cinematic.js` → shared module | L |
| 3 | **Animate a screen** | Animate mode in `/editor` for a screen; Flow `playCinematic` plays it in game. **First end-to-end proof**, no state machine needed | `routes/(app)/editor`, Svelte wrapper | M |
| 4 | **Components in place** | Components listed in `/editor`, edit in place with a breadcrumb, `/components` folds in; component timelines | `routes/(app)/editor`, `components/+page.svelte` | L |
| 5 | **Interface + state machine** | The §6.1 interface (inputs, values) on `ComponentDef`; state machine graph, transition conditions, stage preview with input toggles; runtime interpreter | `engine-layout` (`stateMachine.ts`), new editor panel | L |
| 6 | **Listeners + events** | Pointer events on nodes → inputs; the interface's **events** (from listeners, state entry, timeline cues) | `engine-layout`, `EditorProperties` | M |
| 7 | **Flow instance nodes** | §6.2: placed instances in Flow's palette; instance node with pins derived from the interface; *Wait for state*; *Show in Flow* / *Edit component* jumps; Flow Preview drives the stage; validator + publish gate check every wire | `engine-flow-v2` (new node kind beside `containerEvents.ts`), `/flow-v2`, `apps/lines` interpreter | L |
| 8 | **Migrate the coded overlays** | Transition → Win → free-spin intro/outro → buttons, behind a flag, then retire the coded mounts (`invisible-editor.md` §8.7 "defang, don't gut") | `apps/lines`, built-in components | L each |
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

## 9. Alternatives considered

- **Embed the real Rive runtime and import `.riv` files.** Rive draws with its own renderer, not
  PixiJS, so it would not share our atlases, rigs, FX, fonts, device layouts or the bake chain.
  **Not recommended** as the core path.
- **A second timeline just for components** (the old §17 `BehaviorTrack` plan). Two keyframe
  engines, two UIs, two formats. Rejected per owner direction: timelines must be reusable.
- **Rebuild the sequencer in Svelte and embed it in `/rigger`.** Cleaner end state, but it
  re-does a live-verified tool and puts every cinematic gate at risk at once. Extracting the
  existing panel (Phase 2) is lower risk.

## 10. Open decisions (owner)

1. **Lift the `invisible-editor.md` §8.7 deferral** for *component* state machines (screens stay on Flow, §2)?
2. **Merge `/components` into `/editor`** (Phase 4), or keep two pages that share the new panels?
3. **Name.** Keep calling the shared timeline a *Cinematic* everywhere, or rename it *Timeline*
   in the UI (the file format can stay `.icin`)?
4. **Inputs vs signals:** fold `signals` into trigger inputs (one concept, signals read as
   triggers for back-compat), or keep both?
5. **Which proof first** for Phase 3: a screen intro, the `Transition` overlay, or the Win banner?
6. **Outcome source for the new families.** Are the arcade and match-3 games real-money games
   whose results come from the RGS (the player's moves are presentation, as in a cascade slot), or
   skill / free-play games where the client's own rules decide? This decides how much logic Flow
   must own, and it is the biggest single fork in §7. Not needed before Phase 10.
7. **Rive references.** Screenshots or a short recording of the Rive screens you want copied
   would sharpen Phases 4 and 9.
