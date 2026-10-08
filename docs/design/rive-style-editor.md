# Rive-style Scene + Component Editor — Plan (draft, owner review)

> Status: **PROPOSED, not started.** Owner ask (2026-10-08): make the Scene Editor and the
> Component Editor work like [Rive](https://rive.app/) — components built on the stage, timelines
> and a state machine attached to each component, a friendlier interface, and everything wired to
> Invisible Flow. This file is the plan; progress will live in [editor status](../status/editor.md)
> and [component-editor status](../status/component-editor.md).
>
> ⚠️ This **reverses a standing decision**: [invisible-editor.md §8.7](invisible-editor.md) and §17
> deferred "route A — Rive state machine" (2026-06-05, re-confirmed 2026-06-09). Phase 3 below needs
> the owner to lift that deferral, scoped to *presentation* state machines (§2).

## 1. What Rive does, and what we already have

Rive's model, in the order an author meets it:

| Rive concept | What it is | Our nearest piece today | Gap |
|---|---|---|---|
| **One file, many artboards** | Every screen and every reusable piece is an artboard in one editor | Screens in `/editor`, `ComponentDef`s in `/components` — two pages | Two tools, two saves, two mental models |
| **Nested artboards** | An artboard placed inside another, edited in place | Component instances; "Edit as component" deep-links out to `/components` | Not edited in place; nesting capped at depth 2 |
| **Design / Animate mode** | One toggle: the same stage becomes a keyframe editor | None in the scene tools. `/rigger` Cinematic mode has a strip/keyframe timeline for rigs | **No timeline for components** (§8.5 / §17 designed, unbuilt) |
| **Timelines** | Named animations: keys on any property, curves, loop/ping-pong | `BehaviorTrack`/`TweenStep` type only; rig `cues`, `stateAnimations` (button states), flipbook cues | Authoring UI + runtime interpreter |
| **State machine** | Per artboard: layers of states (each plays a timeline), transitions with conditions and blend time | Rig `stateAnimations` (a fixed hover/pressed/… cascade); the Symbols State Machine (fixed per-symbol states); Flow v2 (game level) | **No authorable per-component state machine** |
| **Inputs** (bool / number / trigger) | The state machine's public surface the host app drives | Component **params** (engine + custom) and **signals** | Close — needs one typed "inputs" list the state machine reads |
| **Listeners** | Pointer events on shapes set inputs / fire triggers | Per-instance `action` binding, container events in Flow | Only "click → action"; no hover/down/up → input |
| **Data binding (view models)** | Bind properties to data | `valueBindings` (number → transform/visibility/fill/frame/rig scrub) | Mostly there |
| **Layouts / constraints** | Flex-like layout, follow/stretch | Device layouts, space modes, anchors | Fine for slots; not a priority |
| **Host runtime** | App sets inputs, listens to events | **Invisible Flow** drives screens, fires cues, plays cinematics | Flow can't set a component's inputs or wait on its state |

**Read:** the plumbing (stage, nesting, params, signals, value bindings, Flow, a keyframe evaluator
in `engine-cinematic`, an `@xyflow/svelte` graph canvas in `/flow-v2`) is about two thirds there.
What is missing is the *authoring* layer Rive is known for — timelines, a state machine, and one
editor that holds it all — plus the Flow ↔ component seam.

**Not "easy", but incremental.** No rewrite: every phase below is additive, parity-gated
(nothing renders differently until a component opts in), and ships on its own.

## 2. The scope line (what keeps this tractable)

Rive's state machine is a *presentation* state machine: it decides which animation plays, from
inputs the host sets. That is exactly the line we keep:

- **Component state machine (new)** — presentation only: states, timelines, transitions on inputs.
  No RGS calls, no math, no book reading. It lives on the `ComponentDef`.
- **Invisible Flow (existing)** — the game's logic: book events, screens, wins, features. It
  *drives* component state machines by setting inputs and firing triggers, and can wait for a state.
- **Game math** — stays in books and Game Config. Untouched.

This is why lifting the §8.7 deferral is safe: we are not building a scripting language, we are
building Rive's state machine, whose ceiling is "which timeline, blended how".

## 3. Target experience

One page, **Invisible Editor** (`/editor`), Rive-shaped:

```
┌ ToolTopBar ─────────────────────── [ Design | Animate ] ── Save · History ┐
│ Assets / Hierarchy │            Stage (screen or component)              │ Inspector │
│  • Screens         │   double-click an instance → edit it in place        │  (props,  │
│  • Components      │   breadcrumb: Base game › Win Banner › Coin          │  inputs,  │
│  • Art / Rigs / FX │                                                       │  bindings)│
├────────────────────┴───────────────────────────────────────────────────────┴───────────┤
│ Animate mode: [Timelines ▾ idle | win | exit]  keyframe dopesheet + curve view         │
│               [State Machine] graph: Entry → Idle ⇄ Win → Exit   Inputs: win▸ amount#   │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Design mode** = today's Scene Editor, with components listed beside screens and edited on the
  same stage (breadcrumb in, Esc out). `/components` becomes this view with a component selected.
- **Animate mode** = the bottom panel: a timeline dopesheet for the selected screen or component
  and, in a tab beside it, its state machine graph and inputs list.
- **Flow** keeps its own page (`/flow-v2`), but its palette lists every component's inputs and
  states, and the inspector there deep-links back to the component.

## 4. Data model (additive to `ComponentDef`, `engine-layout/types.ts`)

```ts
interface ComponentInput { id: string; kind: 'bool' | 'number' | 'trigger'; default?: boolean | number }

interface ComponentTimeline {           // replaces the unbuilt BehaviorTrack/TweenStep
	id: string; duration: number; loop?: 'once' | 'loop' | 'pingPong';
	keys: PropertyTrack[];              // per node: x/y/scale/rotation/alpha/tint/visible/frame/text
	cues?: TimelineCue[];               // rig clip, flipbook clip, FX burst, sound, count-up
}

interface ComponentStateMachine {
	layers: { id: string; states: SmState[]; transitions: SmTransition[]; entry: string }[];
}
// SmState: plays one timeline (or 'any'/'exit' pseudo-states)
// SmTransition: from → to, conditions over inputs (bool ==, number > < ==, trigger fired),
//               optional exitTime + blend duration
```

- **Inputs** absorb what `signals` + custom params do for behaviour: a signal becomes a trigger
  input; an engine param (`winAmount`) can feed a number input. Existing `signals`, `cues`,
  `stateAnimations` and `valueBindings` keep working — Phase 6 migrates them, not Phase 1.
- **Listeners** are a node field: `on: 'down' | 'up' | 'enter' | 'leave' | 'click'` → set an input
  or fire a trigger (Rive's listeners). Button `stateAnimations` become a seeded state machine.
- **Evaluator reuse:** timelines evaluate through `packages/engine-cinematic` (strip/key sampling,
  envelopes), not a new GSAP layer. One keyframe engine for `/rigger` Cinematic and components.

## 5. Phased build (each phase ships, parity-gated)

| # | Phase | Delivers | Main code | Size |
|---|---|---|---|---|
| 0 | **Decisions + ADR** | Owner signs off §7; §8.7/§17 updated to point here | docs | S |
| 1 | **One editor shell** | Components listed in `/editor`; edit an instance in place (breadcrumb); `/components` folds in as a mode; Design/Animate toggle stub | `routes/(app)/editor`, `components/+page.svelte`, `componentStorage.ts` | L |
| 2 | **Timelines** | Schema + runtime player in `<ComponentInstance>` / `LayoutNodeView`; Animate-mode dopesheet (keys, easing curves, scrub, play) on the stage | `engine-layout`, `engine-cinematic`, new `EditorTimeline.svelte` | L |
| 3 | **State machine** | Inputs list, graph editor (reuse `@xyflow/svelte` from `/flow-v2`), transition conditions, live preview with input toggles on the stage; runtime interpreter | `engine-layout` (new `stateMachine.ts`), new `EditorStateMachine.svelte` | L |
| 4 | **Listeners** | Pointer events on nodes → inputs; buttons rebuilt on it | `engine-layout`, `EditorProperties` | M |
| 5 | **Flow attachment** | Flow v2 nodes: *Set Input*, *Fire Trigger*, *Wait for State*, *On State Entered* (exec + typed data pins projected per component instance); validator checks refs | `engine-flow-v2`, `/flow-v2`, `apps/lines` interpreter | M |
| 6 | **Migrate the coded overlays** | Transition → Win → FS intro/outro → buttons as authored components with state machines; retire their coded mounts behind a flag (§8.7 "defang, don't gut") | `apps/lines`, built-in components | L, per overlay |
| 7 | **UX pass** | Rive-grade polish: hierarchy with lock/hide/solo, keyboard shortcuts, onion-skin, inline asset drag onto the timeline, empty states | editor | M |

Ship chain (rule 8): timelines and state machines live **inside** the `ComponentDef` / `scenes.json`,
which already travel export → deploy → bake → pull → register — no new asset class. Assets a
timeline cues (rigs, clips, FX) must be added to `collectArtRefs` so they ship (Phase 2 and 3 gate).

Suggested first slice to prove the loop end to end: **Phase 2 minimal (one timeline, x/y/alpha/scale
keys) + Phase 3 minimal (two states, one trigger) + Phase 5 *Fire Trigger*,** on the `Transition`
overlay. That is the "Rive moment" — animate on stage, wire a state machine, fire it from Flow —
before investing in the full shell.

## 6. Alternatives considered

- **Embed the real Rive runtime and import `.riv` files.** Rive's runtimes are open source, but it
  renders through its own renderer, not PixiJS, so it would not share our atlases, rigs, FX, fonts,
  device layouts or the bake chain, and every piece would be a foreign surface inside a Pixi scene.
  It also re-introduces a third-party editor dependency for authoring. **Not recommended** as the
  core path; possible later as one more placeable node kind if an artist already works in Rive.
- **Keep two editors, add timelines to the Component Editor only** (the §17 Tier 0/1 plan).
  Cheaper, but misses the part the owner called out — building components on the stage, in one
  place. Phases 2–5 still apply unchanged if Phase 1 is postponed.

## 7. Open decisions (owner)

1. **Lift the §8.7 deferral** for presentation state machines (scope as §2)?
2. **Merge `/components` into `/editor`** (Phase 1), or keep two pages that share the new panels?
3. **State machines on screens too**, or components only? (Rive: every artboard. Recommendation:
   components first; a screen can be wrapped in one.)
4. **Inputs vs signals:** migrate `signals` into trigger inputs (one concept), or keep both?
   Recommendation: one concept, with signals read as triggers for back-compat.
5. **Timeline engine:** reuse `engine-cinematic` (recommended) or GSAP as §8.5 planned?
6. **Which overlay is the proof** — `Transition` (simplest) or the `Win` banner (most visible)?
7. **Which Rive screens matter most to you?** Screenshots or a short screen recording of the Rive
   workflows you want copied would sharpen Phases 1 and 7.
