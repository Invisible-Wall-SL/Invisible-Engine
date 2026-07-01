# Invisible Flow

An online node editor for a game's **presentation flow**, built on the screens you
author in the Invisible Scene Editor. Each screen becomes a node; you wire screens
together with **transition edges** to describe how the game moves from one screen to
the next. The authored graph (a **FlowDoc**) is saved alongside the Scene Editor's
`scenes.json` in the project's cloud storage.

> **Status (as of 2026-06-24):** Phases 0–6 are complete and **Phase 7 — Authoring UX**
> is in. The tool authors two tiers — the *macro* graph (placing screens, drawing/editing
> transitions) and the *micro* **choreography sub-editor** (enter/while/exit animation
> timeline, opened by double-clicking a screen node) — and the authored FlowDoc now ships
> end-to-end (export → bake → register), so a baked game runs its presentation from the
> document with safe fall-through to the coded path for anything un-authored. Phase 7 adds
> the **authoring conveniences**: palette + canvas **search**, **copy/paste** of screen
> subgraphs, a **validation** panel (unreachable / dead-end / no-initial / orphaned-pin /
> stuck-overlay warnings), an **authored-vs-coded diff** view, and pin **tooltips**.
>
> **Active-SET model (2026-07-01):** the runtime tracks a *set* of active screens, not one.
> A screen turns ITSELF off when it fires its **Complete** pin, and an edge's trigger decides
> what happens: a **Screen complete** edge is a **handoff** (the source screen hides, the
> target activates); every other trigger (**book event / tap signal / engine condition**) is a
> **layer** (the target activates OVER the source, which stays active underneath). A screen with
> no outgoing Complete edge **persists** — the base game's defining trait — so celebrations layer
> over a live board. The canvas shows this: handoff edges are solid slate, layer edges are dashed
> amber, and a persistent screen wears a **persistent** badge. The choreography
> editor's preview is still a **deterministic timeline** (ordered broadcasts + delays); a
> true live-animating visual preview is not part of this tool. See "What it does not do
> yet" below.

## What it is

A visual wiring layer over the Scene Editor. The Scene Editor lets you place art,
spine, text and components on game **screens** (scenes). Invisible Flow takes those
same screens and lets you describe the **flow between them** — which screen is the
starting one, and what makes the game transition from screen A to screen B.

- **A node is a whole screen.** It references a Scene Editor scene by id, so a node
  always reflects the live screen — rename the scene and the node label follows.
- **Pins are derived, not hand-declared.** Each screen node shows typed **pins**
  projected from the components already on that screen: value inputs (a readout bound
  to `win`/`balance`), action outputs (a button's `spin`/`buyBonus`), signal inputs (a
  spine cue), and the screen's visibility **gate** — plus three fixed structural pins
  (`enter`, `complete`, `active`) that drive the flow. If you delete the component a
  pin came from, the pin is shown **orphaned** (struck through, with a warning count on
  the node, a `⚠ N issues` badge in the sub-bar, and an entry in the Validation panel)
  rather than silently dropped, so a stale wire is always visible.
- **Transitions describe the flow.** An edge from screen A to screen B fires on one of
  three triggers: a **book event** arriving, the source screen's **complete** signal
  (its exit finished), or an **engine condition**. Edges can carry an optional **guard**
  (a bounded comparison), an optional **delay**, and an **author order**.

- **Where it runs:** the launcher itself, at `/flow` — a real full-page tool inside the
  authed `(app)` area, **never an iframe**. The route gates on auth + the `flow` tool
  entitlement and resolves the active project, then renders the graph client-side.
- **Access:** the `admin`, `developer` and `artist` roles get it by default
  (`ROLE_TOOLS` in `src/lib/roles.ts`); the `animator` role does not. Like any tool it
  is overridable per role/user in the admin panel. The save endpoint
  (`POST /api/flow/save`) is `flow`-gated and scoped to your session's active project.

## How to use it

### Open it and pick a project

Sign in to the launcher (`app.invisiblewall.org`) and open **Invisible Flow** (the
top-bar switcher lists it as **Flow**, next to the Scene Editor). The graph and the
saved FlowDoc are scoped to the project selected in the top bar — the same project
selector the Scene Editor uses. Switching projects loads that project's screens and
its saved flow. The sub-bar shows a "macro graph" tag plus a live count of screens and
transitions.

### Place screens

The left **Screens** palette lists every Scene Editor screen in the project that is
**not yet on the canvas**. Click a screen to place it as a node (new nodes are
staggered so they don't stack). The first screen you place is marked the **initial**
screen (the flow's entry node, badged `start`) automatically. Placed screens disappear
from the palette; remove a node and the screen returns to the palette. If every screen
is already placed the palette shows "All screens placed"; if the project's layout has
no screens at all the canvas says so.

### Wire transitions

Drag from a node's **output** handle (a `complete`, action, or other right-side pin) to
another node's **input** handle (its left-side `Enter` pin is the natural target) to
create a transition edge. The trigger is **inferred from the pin you dragged from**: from a
screen's **Complete** pin you get an **on complete** (handoff) edge — the natural "when this
screen finishes, move to the next"; from any other output pin you get a **book event** (layer)
edge with the event type left blank for you to fill in. Either way, select the edge to change
the trigger.

The edge's look tells you its active-SET semantic at a glance (the legend in the sub-bar spells
it out): **handoff** edges (Screen complete) are **solid slate** — the source screen hides;
**layer** edges (book event / tap signal / engine condition) are **dashed amber** — the target
activates OVER the source, which stays active underneath. Book-event edges are also animated so
they stand out. A layer edge means you usually want a **Complete** edge back OUT of the overlay
so it can dismiss itself (the validation panel flags a "stuck overlay" that has none).

### Edit a transition

Click an edge to open the **Transition** inspector on the left. You can set:

- **Trigger** — *Book event* (then type the event type, e.g. `freeSpinTrigger`), *Screen
  complete*, *Tap signal* (then a signal name), or *Engine condition*. A live line under the
  selector spells out the effect: **⇥ Handoff** (Screen complete — the source screen hides) vs
  **⧉ Layer** (any other trigger — the target activates over the still-active source).
- **Delay (ms)** — an optional pause before the transition (leave blank for none).
- **Order** — when a screen has several outgoing edges, the order they are evaluated in.
- **Guard (optional)** — a single bounded comparison: a left value, an operator
  (`eq`/`neq`/`gt`/`gte`/`lt`/`lte`/`in`), and a right value. Values are **whitelisted
  accessors**, not free code: `$engine.<key>` reads a registered engine value (e.g.
  `$engine.winLevel`), `$trigger.<path>` reads the triggering book event payload,
  `$context.<path>` reads the surrounding dispatch context (e.g. `$context.bookEvents`,
  the book-event list the coded handler's second argument carries), `$item.<path>` reads
  a per-iteration item, and anything else is a literal (a number when numeric, else a
  string). This is a small, closed comparison set by design — not an expression language.
  Use **Set guard** to apply it, **clear** to remove it.

Use **Delete transition** in the inspector to remove an edge.

### Edit a screen node

Click a node to open its inspector: tick **Initial screen** to make it the flow's entry
node (clears the flag on any other node), **Copy** / **Paste** the screen with its
choreography (see below), or **Remove screen** to take it off the canvas (which also
removes any transitions touching it; if it was the initial screen, the first remaining
node is promoted).

A node that has **no outgoing Screen-complete edge** wears a computed, read-only
**persistent** badge — it never fires its own Complete pin, so it stays active in the set
(overlays layer over it and it remains underneath). This is how you designate the **base
game**: make it the **initial** screen and give it no outgoing complete edge (its
book-event/condition edges to overlays keep it persistent). The badge is derived from the
edges, not a setting you toggle.

Hovering a screen node's pin shows a **tooltip** with the pin's full role + binding (the
handle row truncates long labels like `Loading / Intro · loadingProgress`), so you can
always read exactly what a wire points at without it being cut off.

### Search (palette + canvas)

Two filter boxes help once a project has many screens:

- **Filter screens** (top of the **Screens** palette) narrows the list of *unplaced*
  scenes by name or id as you type, so you can find the one to place.
- **Find on canvas** (below the palette, shown once at least one screen is placed) lists
  *placed* screens matching your query; click a match to **select and focus** that node
  on the canvas. The validation and diff panels (below) are also click-to-focus.

### Copy and paste

Select a screen and **Copy** (or **Ctrl+C**) puts that screen — *with its authored
choreography* — and any transitions wholly inside the selection on an internal clipboard.
**Paste** (or **Ctrl+V**) re-creates it with **fresh ids**: a pasted screen is always a
new node (it never recycles an id), and pasted transitions get new ids with their
endpoints remapped onto the pasted screens.

Because a screen node *is* its backing Scene Editor scene (and a scene can be on the
canvas only once), pasting maps each copied screen onto a backing scene: it re-pastes the
*same* scene when that scene is currently free (e.g. after you removed it), otherwise onto
the next **unplaced** scene in the project — carrying the choreography across. If no scene
is free to receive the paste, nothing is pasted. Paste, like every edit, is a single
undoable step.

### Validation

The left **Validation** panel lists authoring problems as **warnings** — it never blocks
authoring, and the sub-bar shows a `⚠ N issues` badge. Each issue is one of:

- **Unreachable screen** — no transition path from the initial screen reaches it.
- **Dead-end screen** — a non-initial screen with no outgoing transition (the flow can
  land on it but never leave via the graph). A single-screen flow is terminal by design
  and is *not* flagged.
- **No initial screen** / **Multiple initial screens** — the flow has no entry, or more
  than one.
- **Orphaned pins** — the screen has pins whose backing component was deleted.
- **Stuck overlay** — a screen reached by a **layer** edge (book event / tap signal / engine
  condition, so it stacks over a persistent source) that has **no outgoing Screen-complete
  edge**. In the active-SET model a screen only leaves the set by firing its own Complete pin,
  so such an overlay would never remove itself — it stays stuck over the base. Add a Complete
  edge back out to dismiss it. (The initial/base screen persists by design and is not flagged.)
- **Unresolved accessor** — a choreography `$engine.<key>` or `$context.<path>` accessor
  whose key/root isn't a known engine value or context root. A typo here silently falls
  through to a literal string at runtime, so this warning is the only guard against it.
  (Unregistered Effect *names* are warned inline in the inspector, not in this panel.)

A flagged screen is also marked **inline** on the canvas (an amber node border). Click any
node-scoped issue to select and focus the offending screen.

### Authored-vs-coded diff

The **Authored vs coded** panel makes the fall-through model legible: it shows, per screen
and per book event, whether the FlowDoc **authors** it (the interpreter drives it) or it
falls through to the **coded** default (the game's hard-coded mounting / book-event
handler). A compact summary line reads e.g. *"3 of 4 screens authored · 5 of 11 events
authored"*; each screen row shows which of its **enter / while / exit** phases are
authored and is click-to-focus. This is exactly the boundary the runtime enforces — it
reports what the document overrides versus inherits, it does not change behaviour.

### Author a screen's choreography (the micro editor)

The macro graph says *which* screen runs next; the **choreography sub-editor** says *what
animates* when a screen enters, while it is active, and as it exits. Open it two ways:
**double-click a screen node** (two clicks on the same node within ~350ms — Svelte Flow has
no native double-click event, so the editor detects the pair), or select the node and click
**Edit choreography…** in its inspector. Either opens a full-screen modal titled
**Choreography · <screen name>**.

- **Phase tabs.** Across the top you pick the phase you are authoring: **enter** (plays as
  the screen appears), **while** (plays while it is active), or **exit** (plays as it
  leaves). Each phase has its own independent timeline; switching tabs clears the current
  selection. A phase with nothing authored shows **+ Start a Sequence** to seed an empty
  ordered container to build into.
- **Root toggle.** A choreography's outermost container is either a **Sequence** (children
  run one after another) or a **Parallel** (children run together). The **Root:**
  Sequence / Parallel buttons switch the top-level container.
- **The node graph.** The timeline is drawn as a left-to-right node tree on the same Svelte
  Flow canvas as the macro graph: a container links out to its children, deeper nesting
  moves right. Click a node to edit it; click a Sequence or Parallel to add children to it.
- **Node kinds** (these map one-to-one onto the engine's choreography executor — there is no
  invented vocabulary):
  - **Broadcast** — fire one real emitter event. The event is chosen from a dropdown of the
    game's actual emitter vocabulary, grouped by source (Board, Win, Sound, Free spins,
    Special book, Transition, UI). That list is the project's **exported vocabulary** —
    resolved from the project's game type — so you only see events the game can actually emit;
    an unrecognized game falls back to a bundled default list (see "Where the vocabulary comes
    from" below). You also pick a **dispatch shape** — *broadcast (sync)*, *broadcastAsync —
    await* (wait for subscribers to finish), or *broadcastAsync — fire-and-forget* — and, when
    the chosen event declares payload fields, fill each field with a bounded accessor
    (`$trigger.x`, `$context.x`, `$engine.x`, `$item.x`, or a literal).
  - **Sequence** / **Parallel** — containers you add children into. The **Add child** grid in
    the inspector offers Broadcast, Delay, Sequence, Parallel, Branch and ForEach.
  - **Delay** — a pause in milliseconds. The delay is divided by the current speed, so a
    300ms delay becomes 150ms at 2×.
  - **Branch** — a guarded fork. You set a single comparison (a left accessor, an operator
    `eq`/`neq`/`gt`/`gte`/`lt`/`lte`/`in`, and a right value) and reset its **then** /
    **else** slots to fresh Sequences; the matching branch runs.
  - **ForEach** — repeat a body for each item of a **list accessor** (e.g.
    `$trigger.wins`), either *sequence* (one item at a time) or *parallel*. Inside the body,
    `$item.x` reads the current item.
  - **Effect** — invoke a **named, game-registered side effect** (the FlowDoc's escape hatch
    for behaviour that can't be expressed as a plain broadcast, where the game wires the actual
    implementation at boot). When the project's exported vocabulary lists effects, the
    inspector shows a **dropdown of those registered effect names**; otherwise it falls back to
    a free-text field. If you name an effect the game doesn't register, the inspector flags it
    with a **"Not a registered effect for this game"** warning. An Effect's payload fields
    accept the same bounded accessors as a Broadcast — including `$context.bookEvents` (the
    surrounding book-event list) — so an effect can read the dispatch context without leaving
    the bounded accessor model. Note: an Effect node is **authored as data** — it is *editable*
    when one is present in the document, but it is **not** in the **Add child** grid, so you
    can't create one through the UI yet.
- **Editing and removing.** Each selected node opens its own inspector on the right with just
  its fields. **Remove node** deletes a non-root node; on the root the button reads **Clear
  this phase** and empties that phase's timeline.
- **Undo / save are shared with the macro graph.** Every choreography edit goes through the
  same undo/redo command stack and the same **Save** as the macro graph — close the modal and
  Undo/Redo and Save behave exactly as below; you do not save the choreography separately.

#### Speed dial and the deterministic preview

The modal's right panel runs a **deterministic preview** of the phase you are authoring. Pick
a **Speed** (1× normal or 2× turbo) and click **Run preview**: the editor runs your authored
choreography through the real executor against a **fixed** sample book (never random) and lists
the resulting timeline — each Broadcast (with its dispatch mode and payload) and each Delay, in
order, with the time it fires and the scaled delay (a 300ms delay shows `300ms → 150ms` at 2×).
This is a *timeline* preview that proves the order and timing of your broadcasts and delays. It
is **not** a live visual of the game animating — that requires the runtime mounter and is
Phase 4 (the panel says so).

#### Where the Broadcast / Effect vocabulary comes from

The Broadcast event list and the Effect-name list are not a single hard-coded set: the page
resolves the **exported vocabulary for the project's game type** and feeds it to the
choreography editor, so the picker offers exactly the events and effects that game can emit
(for the `lines` reference game this is ~35 events plus its registered effects). If a project's
game type isn't recognised, the editor falls back to a **bundled default** vocabulary so the
picker is never empty. This is **authoring fidelity only** — it changes which names the picker
offers, never what the game does at runtime (the executor broadcasts / invokes whatever the
FlowDoc declares, registered or not).

### Undo / redo

Every change — place, move, wire, edit, delete, paste — goes through an undo/redo command
stack. Use the **Undo** / **Redo** buttons in the sub-bar, or **Ctrl+Z** / **Ctrl+Y**
(**Ctrl+Shift+Z** also redoes). A drag is coalesced into a single undo step. The
Ctrl+Z/Y/C/V shortcuts are suppressed while you are typing in a text field so they don't
fight the browser's own editing.

### Save

Click **Save** to write the FlowDoc to the project's cloud storage (it lives next to
the Scene Editor's `scenes.json`). The button is disabled until you have unsaved
changes and shows **Saved** when the document is up to date. Reopening the project
loads the saved flow back onto the canvas.

Authoring is **incremental and safe**: anything you have *not* authored falls through to the
game's coded behaviour, and an empty FlowDoc (or one the baked game can't find) behaves exactly
like a game with no Flow document at all. So you can author one screen or one event at a time
and the rest of the game keeps running on its coded path — the **Authored vs coded** panel above
shows you precisely where that boundary sits.

## What it does not do yet

- **It does not edit the platform state machine or the math.** The XState platform FSM
  (bet/balance/auto-spin/RGS protocol) and the RGS-determined outcomes are off-limits —
  Flow is designed to ride on top of them, reacting to the lifecycle and book events
  they emit.
- **No live visual preview.** The choreography editor's preview is a *deterministic
  timeline* of the broadcasts and delays you authored — useful for verifying order and
  timing, but it does not show the game actually animating. A live visual of the game is
  the running game's job, not this authoring tool.

## Known limitations / TODOs

- **No "Add Effect" in the UI.** The choreography model has an **Effect** node (a named
  game-registered side effect) and the inspector can edit one — with a registered-effect-name
  picker — but Effect is not in the **Add child** grid, so an Effect node can only enter a
  document by being authored as data, not created through the canvas. (The `$context.<path>`
  accessor it reads — e.g. `$context.bookEvents` — *is* now authorable in the inspector's
  accessor fields, alongside `$engine` / `$trigger` / `$item` / literal.)
- Guard authoring edits a **single predicate** (the first comparison of a guard);
  multi-predicate AND guards are stored faithfully if already present but not yet fully
  editable in the inspector.
- Copy/paste is **internal to the tool** (a Ctrl+C/V clipboard in the page), not the OS
  clipboard, so you cannot paste a subgraph between two browser tabs.
- The launcher build is green and the Phase-7 helpers are headless-tested; the in-browser
  authoring UX (search, copy/paste, validation panel, diff panel, tooltips) still needs an
  owner visual-verify on the live deployed page.

## For developers

- **Design + build plan:** [`../design/invisible-flow.md`](../design/invisible-flow.md)
  is the source of truth (scoping, node/pin taxonomy, the interpreter contract, the
  phased plan, the Phase-0 gate).
- **The tool page:** `apps/launcher-api/src/routes/(app)/flow/` — `+page.server.ts`
  loads the LayoutDoc, components and saved FlowDoc, and resolves the choreography
  vocabulary by game type (`resolveFlowVocabulary(doc.gameType)` from
  `$lib/flowVocabularies.ts`, falling back to `DEFAULT_EMITTER_VOCABULARY`); `+page.svelte`
  is the authoring canvas (Svelte Flow / `@xyflow/svelte`), hosts the double-click →
  choreography modal, and passes the resolved `vocabulary` into it; `FlowScreenNode.svelte`
  is the screen node; `EdgeInspector.svelte` is the transition editor; `flowModel.client.ts`
  is the typed model + pure command helpers + undo/redo stack.
- **The choreography sub-editor:** `ChoreographyEditor.svelte` is the modal (phase tabs,
  root toggle, canvas, inspector, preview), `ChoreoNode.svelte` is a micro node,
  `ChoreoNodeInspector.svelte` is the per-node field editor (the Broadcast event picker via
  `groupEmitterVocabulary` + `findEmitterEvent`, and the Effect-name picker via
  `findEmitterEffect`), `ChoreoPreview.svelte` is the speed dial + deterministic timeline.
  `choreographyModel.client.ts` is the pure, path-addressed command layer (each helper
  returns a new FlowDoc), routed through the SAME `createFlowHistory` undo/redo stack +
  `POST /api/flow/save` as the macro graph. The deterministic preview runs
  `previewChoreography` against `FIXED_PREVIEW_TRIGGER` / `FIXED_PREVIEW_ENGINE`.
- **The exported vocabulary:** generated at build time, not pipeline-exported (the emitter
  union + `flowEffects` keys are a per-*game* source constant, identical across a game's
  projects). `scripts/gen-flow-vocabulary.mjs` (`pnpm gen:flow-vocab[:check]`) parses the
  game source and emits the per-game vocab (e.g. `apps/lines/src/game/flowVocabulary.ts`) plus
  the launcher registry `apps/launcher-api/src/lib/flowVocabularies.ts`, keyed by LayoutDoc
  `gameType` with `resolveFlowVocabulary()` falling back to the bundled default. The shared
  shapes (`EmitterVocabulary`, `EmitterEffectDef`, `findEmitterEffect`,
  `DEFAULT_EMITTER_VOCABULARY`) live in `packages/engine-flow/src/emitterVocabulary.ts` and are
  headless-tested by `tools/flow-spike/vocabulary.ts`.
- **Save endpoint:** `POST /api/flow/save` (`flow`-gated via the shared `gate` helper,
  mirroring `/api/rigger/save`); R2 read/write in `src/lib/server/flowStorage.ts` at the
  `flowDocKey` path — `<client>/<project>/editor/flow.json`, a sibling of `scenes.json`.
- **Phase-7 authoring UX:** `ValidationPanel.svelte` + `FlowDiffPanel.svelte` render the
  validation and diff panels; the palette/canvas search, copy/paste and focus logic live in
  `+page.svelte`; the copy/paste command helpers (`copyScreens` / `pasteScreens`) are in
  `flowModel.client.ts`. The pure helpers behind the panels are in `packages/engine-flow`:
  `validate.ts` (`validateFlowDoc`) and `diff.ts` (`diffFlowDoc` + `DEFAULT_CODED_EVENTS`).
  All three are headless-tested by `tools/flow-spike/phase7Authoring.ts`
  (`pnpm --filter flow-spike run phase7`).
- **The shared package:** `packages/engine-flow` — the FlowDoc schema (`types.ts`),
  pin-derivation (`pins.ts`), the serialize/deserialize contract (`normalize.ts`),
  validation (`validate.ts`), the authored-vs-coded diff (`diff.ts`), and the runtime
  interpreter (executor + dispatch with fall-through), which ships the baked FlowDoc into
  a real game (Phase 4–6).
