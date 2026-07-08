# Invisible Flow

An online node editor for a game's **presentation flow**, built as a Blueprint-style
graph. You wire **event → logic → presentation** the way Unreal wires Blueprints: nodes
carry **exec pins** (control flow — "do this, then that") and typed **data pins** (values),
and the game runs the graph you author at runtime. The document you build (a **FlowDoc**)
auto-saves to the project's cloud storage and drives the real game.

## What it is

A single wiring graph over one game. The game dispatches **events** into the flow — book
events from the RGS (`reveal`, `winInfo`, `freeSpinTrigger`, …), lifecycle signals
(`load`, `tapToStart`, `idle`), and player **intents** (`spin`, `stop`, `buyBonus`). Each
event node is an **entry point**: you run an exec chain off it that fires the game's real
**actions** (state effects and mechanic commands), broadcasts **cues** (presentation
signals components listen for), waits with **delays**, forks on **branches**, loops with
**forEach**, and **shows / hides containers** (screens, stacked by an author-assigned
z-order).

- **Nodes store a reference, pins are derived.** An event / action / cue / function node
  stores only a *name*; its pins are **derived** from the template's vocabulary (the
  contract of what the game can react to and fire). You never hand-declare a pin, so a
  node can't render pins that disagree with the effect it calls. Rename or retype the
  underlying event and the node's pins follow.
- **Exec pins vs data pins.** **Exec** pins are the white/square control handles that
  sequence what happens; **data** pins are the colored round handles that carry typed
  values (`int`, `float`, `bool`, `string`, `ms`, template `enum`s like `SymbolName`,
  `struct`s like `Win`, and `list<T>`). A wire's color reads the same as the dot it leaves,
  so a value's type is legible from the wire alone. Wires are **type-checked at connect
  time** — an incompatible wire simply won't drop.
- **It validates against a template vocabulary.** The flow is written against the game
  template's declared **events / actions / cues / collections** (today only the
  `book-of` template exists). The palette offers exactly those names, and a live
  **Validation** panel flags anything unresolved or mis-wired.
- **Deterministic preview.** Pick one of your event nodes and run its handler headlessly
  against a fixed sample; the panel lists the resulting ordered timeline (each effect /
  cue / delay / show / hide with its virtual millisecond stamp). It proves the **order and
  timing** of your graph — it is not a live visual of the game animating.

- **Where it runs:** the launcher itself, at `/flow-v2` — a real full-page tool inside the
  authed `(app)` area, **never an iframe**. The route gates on auth + the `flow` tool
  entitlement and resolves the active project, then renders the graph client-side (SSR is
  off because the canvas touches `window`).
- **Access:** the `admin`, `developer` and `artist` roles get it by default (`ROLE_TOOLS`
  in `src/lib/roles.ts`); the `animator` role does not. Like any tool it is overridable
  per role/user in the admin panel. The save endpoint (`POST /api/flow-v2/save`) is
  `flow`-gated and scoped to your session's active project.

## How to use it

### Open it and pick a project

Sign in to the launcher (`app.invisiblewall.org`) and open **Invisible Flow** (the top-bar
switcher lists it as **Flow**). The FlowDoc is scoped to the project selected in the top
bar — the sub-bar shows the active `client / project`. Switching projects loads that
project's saved flow. If a project has no saved flow yet the editor opens on a built-in
**sample** graph so you always have something to work from; a sample that isn't bound to a
real project is marked **"sample · not saved"** and is never persisted.

### Read the sub-bar

Across the top the sub-bar shows the active **client / project** scope, an **exec / data**
legend, a live **node / exec / data** count, and a validation pill (**✓ valid** or **⚠ N
issues**). The **save pill** on the right reports the auto-save state — **Saving…**,
**Unsaved changes**, **Saved**, or **Save failed — retry** (click to retry).

### Add nodes (the palette)

When no node is selected, the left panel is the **Add node** palette. Its sections are
projected live from the template's vocabulary plus the flow's own containers and the shared
function library:

- **Events** — one entry per template event the game can dispatch (book events, lifecycle
  signals, intents). Adds an **event** entry-point node.
- **Actions** — the game's real effects and mechanic commands (`revealBoard`, `winShow`,
  `stopReel`, `startSpin`, …), each tagged with its category.
- **Cues** — presentation signals to broadcast (`boardShow`, `specialBookReveal`,
  `freeSpinIntroShow`, `soundMusic`, …). Adds a **fireCue** node.
- **Functions** — reusable sub-graphs from the shared library (see *Collapse to Function*).
  Each row also has **✎** (edit its body) and **✕** (delete it, blocked while it is in use).
- **Containers** — a **show** and a **hide** button per container the flow declares
  (`show basegame`, `hide loading`, …). Adds a **showContainer** / **hideContainer** node.
- **Control** — the flow-control kinds: **Delay**, **Branch**, **ForEach**, **Sequence**,
  **Parallel**, **Compute**.

A **Filter…** box narrows every section as you type. **Drag** a palette entry onto the
canvas to drop the node at the cursor, or **click** it to add near the centre of the graph.

### Wire the graph

Drag from a pin on one node to a pin on another. Two wire classes:

- **Exec wires** (white, arrow-headed) sequence control: an exec-out → an exec-in. An
  exec-in accepts at most one incoming exec edge.
- **Data wires** (thin, dashed, colored by type) carry a value: a data-out → a data-in. A
  data-in accepts at most one incoming data edge; a data-out can fan out to many.

Wiring is **strict** — a wire only drops if it is legal: exec must meet exec and data must
meet data, directions must be right, the data types must be assignable, and the target
in-pin must be free. An illegal wire is simply refused (nothing stray is created).

To **delete** an edge, click it (it highlights) and press **Delete** / **Backspace**; the
same keys delete selected nodes (and their incident edges).

### Edit a node (the inspector)

Click a node to open its **Inspector** in the left panel (the **✕** returns you to the
palette). It shows the node's derived pins and a kind-specific editor:

- **Reference** — for event / action / cue / functionCall / show/hideContainer nodes, a
  dropdown of the valid names from the vocabulary (or the library / declared containers).
- **Data-in Inputs** — for each unwired data-in, a source editor: **literal** (a typed
  value — number, text, checkbox, or an enum dropdown), or **accessor** (a read-only read
  of `$item` / `$index` / `$engine.<key>` / `$input`). A data-in that is **fed by a wire**
  shows a **wired** tag instead (the wire supplies it).
- **ForEach** — a **Mode** toggle (**sequence** = one item at a time, **parallel** = all
  at once).
- **Sequence / Parallel** — a **Count** (how many ordered / concurrent exec-outs to
  expose).
- **Compute** — an **Op** (`add` / `sub` / `mul` / `div`, or `member` to read a struct
  field) plus its operands. Compute is the *only* place arithmetic and member-reads live
  (accessors only read, they never compute).
- **Branch** — a **Guard** as an *all-of* list of comparisons; add rows with **+ add**,
  each a left source, an operator (`eq` / `ne` / `lt` / `lte` / `gt` / `gte`), and a right
  source. With no comparisons the branch always takes **then**.

### Containers (screens as z-ordered layers)

A **container** is a Scene-Editor scene given an author-assigned **z** (a fully orderable
stack position, not a fixed band). **showContainer** mounts a container at its z;
**hideContainer** unmounts it. Because z is explicit, a celebration screen layers *over* a
live board simply by having a higher z. The set of containers a flow can show/hide is part
of the FlowDoc; the palette and the show/hide reference dropdowns are built from it.

### Reusable functions (Collapse to Function)

Select two or more nodes (marquee-drag or shift-click) and the sub-bar's **⤵ Collapse**
button appears. Name the new function and it is extracted into a **functionCall** node in
its place, with its logic moved into a reusable **function body**. Functions live in a
**shared library** (global across every project, not project-scoped), so a function you
collapse in one project is available everywhere.

- **Edit a function's body** by double-clicking its call node, clicking **✎** in the
  palette's Functions section, or using the crumb. The sub-bar breadcrumb reads
  **Flow ↳ &lt;FunctionName&gt;** while you edit a body; **← Back to flow** returns you. A
  body has fixed **Entry** and **Result** nodes (the function's signature) that you wire
  between; those two can't be deleted.
- **Rename** the open function inline in the breadcrumb (its id stays stable, so existing
  call sites keep resolving). **Delete** a function from the palette's **✕** — blocked with
  a message while any call site still references it.

### Validation

The left **Validation** panel lists every issue from the live type-checker (unresolved
reference, unfilled data-in, type mismatch, fan-in violation, unresolved accessor,
function-vocabulary requirement, …) as a code + message. Node- and pin-located issues are
**click-to-focus** — clicking one selects and highlights the offending node on the canvas.
The sub-bar's **⚠ N issues** / **✓ valid** pill mirrors the count. Validation never blocks
authoring; it is a running honesty check.

### Preview (deterministic timeline)

The left **Preview** panel runs a chosen **event** node's handler headlessly through the
real interpreter on a virtual clock. Pick an event, pick a **speed** (**1×** or **2×**),
and click **Run**: the panel lists the ordered side-effect timeline — each **effect / cue /
delay / show / hide** with its resolved payload and virtual **at** stamp, plus the total
step count and duration. Changing the graph clears a stale run. This proves the **order and
timing** of your flow; it is **not** a live visual of the game — that is the running game's
job.

### Auto-save

There is **no Save button** — the editor **auto-saves**. Every edit marks the doc dirty and
(re)starts a short (~0.8s) debounce; when it settles the editor POSTs the current FlowDoc to
`/api/flow-v2/save`, which gates on the `flow` tool + your session's active project and
writes the project's `editor/flow-v2.json`. A burst of edits coalesces into one save. The
save pill in the sub-bar reflects the state (**Saving… / Unsaved changes / Saved / Save
failed — retry**). The shared **function library** auto-saves the same way to its global
key, shown as a separate **Library …** pill. The standalone dev sample (no real project) is
never persisted.

The game reads the saved `editor/flow-v2.json` at runtime through the bake → bundle chain,
so authoring here is what the shipped game actually runs.

## What it does not do yet

- **It does not edit the platform state machine or the math.** The XState platform FSM
  (bet / balance / auto-spin / RGS protocol) and the RGS-determined outcomes are off-limits
  — Flow rides on top of them, reacting to the lifecycle and book events they emit.
- **No live visual preview.** The Preview panel is a *deterministic timeline* of the
  effects, cues and delays you authored — useful for verifying order and timing, but it
  does not show the game actually animating.

## Known limitations / TODOs

- **Containers and the template are data-only.** The set of containers (scene id + z) and
  the flow's `templateId` are part of the FlowDoc but are not yet editable in the UI — the
  palette shows/hides whatever containers the document already declares. Only the `book-of`
  template vocabulary exists today; an unknown template id falls back to it.
- **A cue's await flag isn't authorable yet.** A **fireCue** node can be an awaited
  broadcast (wait for its subscribers before continuing the exec chain) in the data model,
  but the inspector has no toggle for it yet — a cue authored through the UI is
  fire-and-forget.
- **Function inputs/outputs are fixed once created.** A function body's **Entry** / **Result**
  signature (its inputs/outputs) can't be edited yet; adding or removing a function's
  parameters is a later feature.
- The `/flow-v2` editor is the successor to the v1 `/flow` graph and is still on the
  cutover track — the runtime dispatch, book-event ownership and full bake→ship chain are
  landing incrementally (see `docs/STATUS.md`), so verify a project's authored flow against
  the live game before relying on it.

## For developers

- **Design + schema:** [`../design/invisible-flow-v2.md`](../design/invisible-flow-v2.md)
  and `invisible-flow-v2-schema.md` are the source of truth (the Blueprint model, the three
  artifacts, the pin/type taxonomy, the phased plan). Current state + the cutover track are
  in [`../STATUS.md`](../STATUS.md).
- **The tool page:** `apps/launcher-api/src/routes/(app)/flow-v2/` — `+page.server.ts`
  gates on the `flow` entitlement, resolves the active project (`resolveToolScope`) and
  loads the project's FlowDoc (`loadFlowV2Doc`, R2 `flowV2DocKey`) plus the global function
  library (`loadFlowV2Library`, `_shared/flow-v2/functions.json`); `+page.svelte` is the
  authoring canvas (Svelte Flow / `@xyflow/svelte`), owns the doc `$state`, the debounced
  auto-save, and function-view navigation. `FlowCanvasV2.svelte` hosts the flow render +
  drop-at-cursor; `FlowV2Node.svelte` renders a generic node with derived pins;
  `AddNodePalette.svelte` is the palette; `NodeInspector.svelte` is the per-node editor;
  `ValidationPanelV2.svelte` and `PreviewPanelV2.svelte` are the two panels; `graphOps.ts`
  holds the pure graph mutations; `dnd.ts` is the palette→canvas drag contract; `palette.ts`
  is the type → color/label map.
- **Save endpoints:** `POST /api/flow-v2/save` (FlowDoc → project `editor/flow-v2.json`)
  and `POST /api/flow-v2/library/save` (the shared library → `_shared/flow-v2/functions.json`),
  both `flow`-gated.
- **The shared package:** `packages/engine-flow-v2` — the schema (`types.ts`), pin
  derivation (`pins.ts`), connect-time type checking (`assignable`), validation
  (`validateFlowDoc` / `validateFunctionDef`), the `collapseToFunction` op, the deterministic
  `previewFlowEvent`, and the runtime interpreter the game backs. The reference `book-of`
  vocabulary — the events, actions, cues and collections an author works with — is in
  `src/reference/bookOf.ts` (`BOOK_OF_VOCAB`), transcribed verbatim from the `apps/lines`
  game so the contract is honest.
