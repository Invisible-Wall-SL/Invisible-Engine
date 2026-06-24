# Invisible Flow

An online node editor for a game's **presentation flow**, built on the screens you
author in the Invisible Scene Editor. Each screen becomes a node; you wire screens
together with **transition edges** to describe how the game moves from one screen to
the next. The authored graph (a **FlowDoc**) is saved alongside the Scene Editor's
`scenes.json` in the project's cloud storage.

> **Status (as of 2026-06-24):** this is **Phase 2 — macro authoring**. What ships now
> is the *macro* graph: placing screens, drawing/editing transitions between them, and
> saving/loading the FlowDoc. It is an **authoring surface only** — saving writes the
> document to cloud storage but does **not yet change how any game runs**. The *micro*
> choreography editor (a screen's enter/while/exit animation timelines) is **Phase 3**,
> and wiring the saved FlowDoc into the build pipeline so a shipped game actually runs
> from it is **Phase 6**. See "What it does not do yet" below.

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
  the node and in the sub-bar) rather than silently dropped, so a stale wire is always
  visible.
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
create a transition edge. A new edge defaults to the **on complete** trigger; select
the edge to change it. Book-event edges are drawn animated so they stand out.

### Edit a transition

Click an edge to open the **Transition** inspector on the left. You can set:

- **Trigger** — *Book event* (then type the event type, e.g. `freeSpinTrigger`),
  *Screen complete*, or *Engine condition*.
- **Delay (ms)** — an optional pause before the transition (leave blank for none).
- **Order** — when a screen has several outgoing edges, the order they are evaluated in.
- **Guard (optional)** — a single bounded comparison: a left value, an operator
  (`eq`/`neq`/`gt`/`gte`/`lt`/`lte`/`in`), and a right value. Values are **whitelisted
  accessors**, not free code: `$engine.<key>` reads a registered engine value (e.g.
  `$engine.winLevel`), `$trigger.<path>` reads the triggering book event payload,
  `$item.<path>` reads a per-iteration item, and anything else is a literal (a number
  when numeric, else a string). This is a small, closed comparison set by design — not
  an expression language. Use **Set guard** to apply it, **clear** to remove it.

Use **Delete transition** in the inspector to remove an edge.

### Edit a screen node

Click a node to open its inspector: tick **Initial screen** to make it the flow's entry
node (clears the flag on any other node), or **Remove screen** to take it off the canvas
(which also removes any transitions touching it; if it was the initial screen, the first
remaining node is promoted).

### Undo / redo

Every change — place, move, wire, edit, delete — goes through an undo/redo command
stack. Use the **Undo** / **Redo** buttons in the sub-bar, or **Ctrl+Z** / **Ctrl+Y**
(**Ctrl+Shift+Z** also redoes). A drag is coalesced into a single undo step.

### Save

Click **Save** to write the FlowDoc to the project's cloud storage (it lives next to
the Scene Editor's `scenes.json`). The button is disabled until you have unsaved
changes and shows **Saved** when the document is up to date. Reopening the project
loads the saved flow back onto the canvas.

## What it does not do yet

- **It does not edit the platform state machine or the math.** The XState platform FSM
  (bet/balance/auto-spin/RGS protocol) and the RGS-determined outcomes are off-limits —
  Flow is designed to ride on top of them, reacting to the lifecycle and book events
  they emit.
- **No choreography editor yet.** Authoring a screen's enter/while/exit animation
  timeline (Sequence/Parallel/Delay/Branch/ForEach + a speed dial) is **Phase 3** — the
  node has no double-click "open the micro editor" surface in this phase.
- **Saving does not yet change a running game.** Wiring the FlowDoc through
  export → bake → pull → register so a shipped game runs from it is **Phase 6**. Until
  then a game runs its coded mounting and book-event handlers exactly as before; the
  FlowDoc you author and save here does not reach any running game.

## Known limitations / TODOs

- Guard authoring edits a **single predicate** (the first comparison of a guard);
  multi-predicate AND guards are stored faithfully if already present but not yet fully
  editable in the inspector.
- The macro authoring surface is built and the launcher build is green; the in-browser
  authoring UX has not yet been owner-verified on the live deployed page.

## For developers

- **Design + build plan:** [`../design/invisible-flow.md`](../design/invisible-flow.md)
  is the source of truth (scoping, node/pin taxonomy, the interpreter contract, the
  phased plan, the Phase-0 gate).
- **The tool page:** `apps/launcher-api/src/routes/(app)/flow/` — `+page.server.ts`
  loads the LayoutDoc, components and saved FlowDoc; `+page.svelte` is the authoring
  canvas (Svelte Flow / `@xyflow/svelte`); `FlowScreenNode.svelte` is the screen node;
  `EdgeInspector.svelte` is the transition editor; `flowModel.client.ts` is the typed
  model + pure command helpers + undo/redo stack.
- **Save endpoint:** `POST /api/flow/save` (`flow`-gated via the shared `gate` helper,
  mirroring `/api/rigger/save`); R2 read/write in `src/lib/server/flowStorage.ts` at the
  `flowDocKey` path — `<client>/<project>/editor/flow.json`, a sibling of `scenes.json`.
- **The shared package:** `packages/engine-flow` — the FlowDoc schema (`types.ts`),
  pin-derivation (`pins.ts`), the serialize/deserialize contract (`normalize.ts`), and
  the runtime interpreter (executor + dispatch with fall-through), which is the Phase-6
  consumer not yet wired into the build.
