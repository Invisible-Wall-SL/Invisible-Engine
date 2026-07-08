# Invisible Flow v2 — a Blueprint-style presentation graph

> **Status: DRAFT / strawman for discussion (2026-07-07).** Not yet built. Supersedes the
> authoring model in `invisible-flow.md` (v1) if adopted. The v1 *runtime primitives* mostly
> survive; the *authoring model* is redrawn. Written after the owner decided to rebuild Flow around
> an Unreal-style reusable node graph, before any code.

## 1. Why v2

v1 fused two different paradigms on top of each other and scattered a third:

- a **state machine** (screens + transition edges: layer vs handoff, the active-set), plus
- a **timeline** ("choreography": effect/broadcast/delay/branch/loop) that could be attached to a
  screen phase **and** an edge **and** a book event — the same concept authored in three places,
  none of it visible on the main canvas, some of it behind a modal.

Consequences the owner hit directly: one feature ("book reveal") lived in the macro edge, a hidden
event-response modal, **and** the scene; you had to hand-author game *state* inside a presentation
timeline; connections were implicit name-matches; and it was low-level to repeat.

**v2 goal:** one graph, Unreal-style. Logic is nodes with pins. Reusable **functions**. Screens
dissolve into **containers**. The flow owns **presentation only**; the game template owns the
mechanic.

## 2. The boundary (decided)

- **Templates own the mechanic.** Each game template (book-of, lines, cluster, ways, …) ships its
  own reels, RGS communication, and math. The flow never rebuilds slot logic.
- **Each template exposes a VOCABULARY** the flow is authored against:
  - **Events (in / entry points):** book events (`setExpandingSymbol`, `freeSpinTrigger`, …),
    game intents (`spin`, `buyBonus`), lifecycle (`load`, `idle`). Each carries typed **data**
    (e.g. `setExpandingSymbol` → `symbol`).
  - **Cues (out):** named signals the template's components react to (`specialBookReveal`, …).
  - **Effects (out):** template-provided state mutations (`setSpecialSymbol`, counter updates, …).
- A flow authored against a template's vocabulary is **portable** to any game on that template.

## 3. Core concepts

One canvas, one graph. Nodes have **exec pins** (white — control: "do this, then that") and **data
pins** (typed values). Mirrors Unreal Blueprints.

**Node kinds:**
- **Event node** (entry): fires when the template emits it. Exec-out + data-out pins
  (`setExpandingSymbol` node → `symbol` data pin). Event entry points are either **global** —
  template-wide signals with no owning container (`load`, `idle`, book events like
  `setExpandingSymbol`) — or **container-scoped**: a configured component's event, which appears as
  an exec-out pin *on that container's node* rather than as a free-floating node (see §4). This is
  how the same container stays a single node instead of being redrawn once per button.
- **Effect** — call a template effect by name, wire its payload from data pins
  (`setSpecialSymbol(symbol ← event.symbol)`).
- **Fire Cue** — fire a named cue; components in shown containers bound to that cue react.
- **Delay** — latent; exec continues after the wait (turbo-scaled).
- **Branch** — if/else on a guard over data pins / engine values.
- **Loop / ForEach** — iterate a collection (per-reel, per-symbol …).
- **Show Container / Hide Container** — mount/unmount a container (see §4).
- **Function call** — a reusable sub-graph node (see §5).

## 4. Screens → Containers

- **No "screen" primitive in the flow.** A **container** is a Scene-Editor scene (a group of
  components) plus a declared **z-band**. That's it.
- The flow **Show**s / **Hide**s containers. What makes each container different is only the
  components it mounts — authored in the Scene Editor, unchanged.
- **Layering is author-controlled per container (decided: custom order, not fixed bands).** Each
  container carries an explicit **z-order** the author assigns (a fully orderable stack, not a fixed
  `background/board/overlay/hud` set), and **Show** places it at that z-order. This keeps the good
  part of the old active-set (you set placement once, the engine stacks it; base-persists-under-
  overlay falls out of z-order) and deletes the confusing part (handoff vs layer, transition edges),
  while giving full control over the exact stack.
- Visibility is fully explicit and flow-owned (consistent with the "Flow owns visibility" rule).
- **A container node surfaces its components' declared events as exec-OUT pins** — the mirror of the
  cue-aggregation rule (§8.4). A container that mounts a spin button, a bet stepper, a sound toggle
  and a settings button becomes **one** `Base game` node with pins `onSpin`, `onIncrease`,
  `onDecrease`, `onSoundToggle`, `onSettings`; you wire each to the logic it triggers. Buttons don't
  feed *into* the container — they fire *out* of it. This replaces the confusing v1/spike shape where
  every button drew its own duplicate `Show Base game` node; the container is shown **once** (from
  `load`/`idle`), and its interactive components hang off that single node.
- **The pin set is authored, never auto-dumped.** A component exposes an event pin **only for the
  functionality configured on it** in the Scene Editor — a button with a `spin` action → an `onSpin`
  pin; a button with nothing wired, or a decorative sprite → no pin. The container node's pins are a
  1:1 readout of what the game can actually do; the flow's job is purely to decide **when** each
  declared thing fires. Nothing appears on the node that wasn't put on a component.

## 5. Reuse — Functions (the #3 ask, Unreal-style)

- A **function** = `{ name, inputs: Pin[], outputs: Pin[], body: node graph }`. Authored once;
  dropped as a **call node** anywhere; its pins wire into the surrounding flow.
- Example — `PlayBookReveal(symbol)`:
  `Effect setSpecialSymbol(symbol)` → `Show bookReveal` → `Delay 150` →
  `FireCue specialBookReveal` → `Delay revealMs` → `FireCue specialBookHide` → `Hide bookReveal`.
- **Call site:** the `setExpandingSymbol` event node → `PlayBookReveal` node, wiring
  `symbol ← event.symbol`. That's the whole reveal, as one reusable node.
- **Scope (decided): a shared cross-template library from day one.** Functions live in one shared
  pool, not project-local. Because a function can reference template-specific vocabulary (e.g.
  `PlayBookReveal` uses the `setSpecialSymbol` effect + `specialBookReveal` cue), **each function
  declares the vocabulary it requires** (events/cues/effects it touches), and the editor only offers
  a function in a template whose vocabulary satisfies it. Purely-generic functions (Show/Hide, Delay,
  Branch, Fire-Cue of a param-named cue) are usable everywhere; template-specific ones surface only
  where they fit.
- **Versioning (design detail, settle in build):** shared edits propagate to call sites — needs a
  policy (auto-propagate vs. pin-a-version), decided during the Functions phase.

## 6. How it compiles onto the runtime we already have

The engine cost is smaller than the redraw suggests, because the **executor already runs exec-flow
trees** (sequence/parallel/effect/broadcast/delay/branch/forEach):

- **Per-event compile:** from each Event node, walk its exec-out to build the ordered tree the
  executor runs (today's `EventChoreography`, just authored as connected nodes instead of a modal).
- **Functions** inline (or become callable sub-trees) at bake time.
- **Show/Hide container** → the generic scene **mounter** the interpreter already has, keyed by
  z-band (z-bands already exist in the engine).
- **Fire Cue** → the existing **signal/broadcast** system.
- **Effect** → the existing **effect registry** (`flowEffects`).

So the interpreter's **active-set + transition state machine** is what actually gets replaced (by an
explicit show/hide + z-band mounter); the executor, mounter, signals, effects, and game state are
reused.

## 7. What survives / what's reworked / what's rebuilt

- **Survives:** the Scene Editor (containers), the executor primitives, the signal/cue system, the
  effect registry, game state, and the per-template vocabularies.
- **Reworked:** the FlowDoc **schema** (→ node graph + functions + containers), the `/flow`
  **canvas** (one unified Blueprint UI; the event-response modal goes away — it's inline), and the
  interpreter's **screen/active-set/transition** layer (→ show/hide + z-band).
- **Rebuilt:** the *one* existing flow (book-of reveal + free-spin lifecycle). Preproduction, one
  flow — cheapest it will ever be to change.

## 8. Decisions (resolved 2026-07-07) + the one still open

1. **Layering — DECIDED: custom per-container z-order** (not a fixed band set). See §4.
2. **Functions — DECIDED: shared cross-template library from day one**, gated by declared
   vocabulary requirements. See §5.
3. **Data-pin types — DECIDED: strict.** A typed pin system with **strict connect-time checking**
   that reports errors (no silent coercions). Value types at least: number, string, symbol-name,
   bool, enum; collection types for loops (§5-open).
4. **Cue scoping — DECIDED:** components declare the cues they bind → the container aggregates its
   components' cues → the template vocabulary lists them, so the Fire-Cue picker is scoped, never
   blind.
5. **Loops — OPEN, under discussion.** Whether the flow needs `ForEach` at all, or the template
   should emit granular per-item events instead. The crux: does the flow iterate collections an
   event carries (author controls per-item timing/order), or does the template pre-bake iteration by
   firing one event per item? Trade-off + strawman recommendation being worked out before it lands
   in the schema. (If included: a typed collection pin + `$item` scope + sequential/parallel body.)
6. **Migration — DECIDED: hard cut.** No side-by-side v1/v2; retire v1 authoring, rebuild the one
   existing flow on v2.
7. **Storage — DECIDED: one FlowDoc per project + a separate shared function-library doc.**
8. **Container event pins — DECIDED (2026-07-08); authoring landed (2026-07-08):** a container's
   **configured** component events surface as exec-out pins **on the `showContainer` node itself**
   (mirror of cue aggregation), keyed by `ContainerId`. The pin set is authored via component config
   (`deriveContainerEvents`), never auto-dumped, and a container appears as **one fused node** (mount
   + all its buttons) rather than a duplicate per button. There is **no separate container-scoped
   event node** — the earlier `event`-node path (ref = `<sceneId>/<declId>`) is superseded and
   removed, so there is exactly one mechanism. See §3 (global vs container-scoped events) and §4.
   Consequence: the base game container carries all the game's interactive functionality as pins on
   one node, and the flow decides *when* each fires. Authoring (render + wire + save + validate) is
   implemented; runtime FIRING of these pins (the game emitting the container's component events) is a
   later phase.

## 9. Phased build (strawman — not started)

- **Phase 0** — this doc + a throwaway **canvas spike**: event node → a couple of action nodes → a
  function call node, just to feel the graph. No runtime.
- **Phase 1** — schema v2 + validator. **Drafted in `invisible-flow-v2-schema.md`** (nodes, exec/data
  pins, strict types, functions + shared library, custom-z containers, the template vocabulary
  contract, and the compile-to-existing-runtime map).
- **Phase 2** — `/flow` canvas: event nodes, exec/data pins, action nodes, Show/Hide, wiring, the
  deterministic preview.
- **Phase 3** — Functions: define + call + inline-compile.
- **Phase 4** — runtime interpreter v2 (compile graph → executor; show/hide + z-band mounter).
- **Phase 5** — migrate the book-of flow; retire v1 authoring.
