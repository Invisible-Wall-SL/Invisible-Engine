# Invisible Flow v2 — schema (data model)

> **Status: DRAFT / strawman (2026-07-07).** The Phase-1 data model for `invisible-flow-v2.md`.
> TypeScript is used as the spec language; final types will live in an `engine-flow-v2` package.
> Nothing built yet. Open sub-decisions are flagged **[OPEN]**.

## 0. The three artifacts

- **`FlowDoc`** — one per project. The event graph + the containers it shows.
- **`FunctionLibraryDoc`** — shared across projects/templates. The reusable functions (decision §2).
- **`TemplateVocabulary`** — declared by each game **template** (book-of, lines, …), NOT authored in
  the editor. It's the contract the flow is written against: the events it can react to, the actions
  and cues it can fire, the collections it can loop, and the data types those carry. The editor loads
  it to populate palettes and to type-check.

```ts
interface FlowDoc {
  version: 2;
  templateId: string;          // which TemplateVocabulary this flow targets
  graph: Graph;                // the event graph
  containers: ContainerRef[];  // containers this flow shows/hides, each with a z-order
}

interface FunctionLibraryDoc {
  version: 2;
  functions: FunctionDef[];
}
```

## 1. Type system (strict — decision #3)

Every data pin has a `TypeRef`. Connect-time checking is **strict**: a data edge is legal only if the
source type is **assignable** to the target type, which here means **structural equality** (no silent
coercion). Widening/narrowing is done with an explicit `cast`/`compute` node, never implicitly.

```ts
type TypeRef =
  | { t: 'int' } | { t: 'float' } | { t: 'bool' } | { t: 'string' }
  | { t: 'ms' }                         // Int milliseconds (semantic alias; still an int)
  | { t: 'enum'; name: string }         // template-declared enum (e.g. SymbolName)
  | { t: 'struct'; name: string }       // template-declared struct (Reel, Slot, Win…)
  | { t: 'list'; of: TypeRef };         // a collection (what ForEach iterates)
```

Structs/enums are **declared by the template** (§7), so `Reel`, `Slot`, `SymbolName` are template
vocabulary, not built-ins. `assignable(a,b)` = deep-equal `TypeRef`. **[OPEN]** whether `int`→`float`
and `ms`↔`int` get the one sanctioned implicit widening, or require an explicit cast (I lean: allow
`ms`↔`int` since `ms` *is* an int; require a cast for everything else, to honor "strict, report errors").

## 2. Pins & edges

Pins are **derived**, not hand-stored: a node stores a *reference* (event name / action name / function
id / …) and the editor derives its pins from that reference + the vocabulary/library. This is the key
anti-drift rule — you can't have a node whose stored pins disagree with the effect it calls.

```ts
type PinDir = 'in' | 'out';
type PinKind = 'exec' | 'data';

interface Pin {                 // derived at edit/compile time; shown, not persisted on the node
  id: string;                   // unique within the node: 'exec', 'reels', 'item', 'body', 'done'
  dir: PinDir;
  kind: PinKind;
  dataType?: TypeRef;           // required iff kind==='data'
  label?: string;
}

type PinPath = { node: NodeId; pin: string };

interface ExecEdge { from: PinPath; to: PinPath; }  // control flow: an exec-out → an exec-in
interface DataEdge { from: PinPath; to: PinPath; }  // value: a data-out → a data-in (type-checked)

interface Graph {
  nodes: Node[];
  exec: ExecEdge[];
  data: DataEdge[];
}
```

Rules: an exec-in takes **at most one** incoming exec edge (one predecessor); an exec-out drives one
successor (fan-out uses a `sequence`/`parallel` node). A data-in takes **at most one** data edge; a
data-out may fan out to many. Data-ins with no edge fall back to a literal/accessor (§4).

## 3. Nodes

```ts
interface NodeBase { id: NodeId; kind: NodeKind; pos: { x: number; y: number }; }

type NodeKind =
  | 'event' | 'gameSignals'       // entry points: one template event / all mechanic signals (§6.2)
  | 'action' | 'fireCue' | 'delay' | 'branch' | 'forEach'
  | 'showContainer' | 'hideContainer' | 'functionCall'
  | 'textMessage'                 // a localized on-screen text prompt (§6.3)
  | 'sequence' | 'parallel'      // exec fan-out helpers
  | 'compute'                    // pure typed value ops (see §4)
  | 'group';                     // an INLINE collapsed subgraph (§5.2)
```

Per kind (pins listed as they're **derived**):

- **event** — `{ ref: string }` an entry point (**no** exec-in). Pins: out `exec`; one data-out per
  the resolved declaration's payload. `ref` addresses a **global** template event (`reveal` →
  `reels: list<Reel>`, `load`, `idle`) resolved against `TemplateVocabulary.events`. A container's
  **configured component events** are NOT `event` nodes — they surface as exec-out pins on the
  `showContainer` node itself (§6.1), so one container = one fused node carrying mount + all its
  buttons.
- **gameSignals** — `{}` (NO `ref`) an entry point (**no** exec-in): the SINGLE node that surfaces the
  template's **mechanic signals**. It derives, for every vocab event whose `category` is `'book'` or
  `'lifecycle'` (NOT `'intent'` — those are the container button pins, §6.1): one **exec-out** (id =
  the event name, label `on<Event>`) plus one **data-out** per that event's payload field (id =
  `<eventName>.<field>`, typed by the field). One node = all the game's own signals, so presentation
  is wired off them instead of scattered per-event nodes. Pins are DERIVED from the vocabulary (§6.2),
  never stored.
- **action** — `{ ref: string }` a template **effect or command** (both are template functions with
  typed params; `setSpecialSymbol`, `stopReel`, `settleSlot`). Pins: in `exec`, out `exec`; one
  data-in per the `ActionDecl` param. Category (state-effect vs mechanic-command) is a palette tag
  only.
- **fireCue** — `{ ref: string }` a cue name (scoped by the shown containers, decision #4). Pins: in
  `exec`, out `exec`; data-ins only if the cue declares a payload (usually none).
- **delay** — `{}`. Pins: in `exec`, out `exec`, in `ms: ms` (fed by wire / literal / accessor, §4).
- **branch** — `{ guard: Guard }`. Pins: in `exec`, plus the guard's operand data-ins; out `then`
  (exec), out `else` (exec).
- **forEach** — `{ mode: 'sequence' | 'parallel' }`. Pins: in `exec`, in `in: list<T>`, out
  `body` (exec, the loop body), out `item: T`, out `index: int`, out `done` (exec, after all
  iterations). **The loop body is simply whatever's wired from `body`** — no nested canvas.
- **showContainer** — `{ ref: ContainerId }`. Pins: in `exec`, out `exec`, **plus one exec-out per the
  container's configured component event** (§6.1), keyed by `ContainerId` — the fused "mount + all its
  buttons" node. Each event pin's `id` is the decl's `id` (`spinButton.onSpin`, unique on the node) and
  its label is the `on<Event>` tail (`onSpin`). Absent surface for the ref ⇒ just `[exec-in, exec-out]`
  (parity-safe). **hideContainer** — `{ ref: ContainerId }`. Pins: in `exec`, out `exec`.
- **textMessage** (§6.3) — `{ text; place:{x,y}; visibleWhile?; autoHideMs?; style? }`. A presentation
  LEAF that draws one localized line of text at a normalized 0..1 screen `place`. It CARRIES its own
  `text` (a deliberate, contained exception to the anti-drift rule — the text IS the node's definition,
  like `group.body`), which is BOTH the editable default AND the localization key (harvested by
  `collectTextMessages`, resolved through the catalog at render). Pins: two exec-ins **`show`** /
  **`hide`** (both optional) + one exec-out `exec` (continues from whichever inlet fired). Visibility is
  OR-ed: a reactive **state-gate** `visibleWhile` (`idle`/`spinning`/`freeSpins`/`always`/`none`) for the
  sustained-state case the event-driven interpreter can't express, and the flow-shown flag the `show`/
  `hide` inlets toggle (`show` also arms `autoHideMs`, so a transient message is ONE node). The text
  travels inside the baked `bundle.flowV2` (no new baked class); the game renders it via
  `FlowV2Messages.svelte` gated on the xstate idle/spin predicates.
- **functionCall** — `{ ref: FunctionId }`. Pins mirror the `FunctionDef`'s declared `inputs`/
  `outputs` (in `exec` + input data-ins; out `exec` + output data-outs).
- **sequence** — in `exec`; N ordered out execs `then[0..n]`, fired in order. **parallel** — same but
  fired concurrently. (Linear chains don't need these; they're for explicit fan-out.)
- **compute** — a pure, typed value op (no exec). See §4.
- **group** — `{ label: string; body: Graph; boundary: GroupPin[] }` an INLINE, non-reusable folding of
  a node selection into one node (§5.2). Its pins are **stored** on `boundary` (the one deliberate
  exception to derivation — the boundary IS the group's definition), one **per boundary crossing**
  (N external exec edges → N distinct input pins, **no** exec-in fan-in). Flattened back to its nodes
  at runtime + validation, so it is semantically identical to its expanded form.

```ts
interface GroupPin {
  id: string;                 // unique on the group node (in_<i> / out_<i>)
  dir: PinDir; kind: PinKind; dataType?: TypeRef;
  label: string;              // descriptive (from the inner target/source node's ref/kind)
  inner: PinPath;             // the internal (node, pin) this boundary pin bridges to
}
interface GroupNode extends NodeBase {
  kind: 'group';
  label: string;              // display name, e.g. 'Button actions'
  body: Graph;                // the collapsed inner nodes + INTERNAL edges only
  boundary: GroupPin[];       // one per boundary crossing; the node's pins ARE these
}
```

```ts
interface Guard { all?: Compare[]; any?: Compare[]; }
interface Compare { left: DataSource; op: 'eq'|'ne'|'lt'|'lte'|'gt'|'gte'; right: DataSource; }
```

## 4. Data sources & the arithmetic question

A data-in gets its value from one of:

```ts
type DataSource =
  | { kind: 'wire' }                              // a DataEdge targets this pin
  | { kind: 'literal'; type: TypeRef; value: unknown }
  | { kind: 'accessor'; path: Accessor };        // read a value in scope, no math

type Accessor =                                   // strictly a read, typed against scope
  | { on: 'item'; member?: string }               // $item / $item.index inside a forEach
  | { on: 'index' }                               // the forEach counter
  | { on: 'input'; name: string }                 // a function's input, inside its body
  | { on: 'engine'; key: string };                // a template global read (e.g. reels, slots)
```

Node stores `inputs: Record<PinId, DataSource>` for its data-ins (a `wire` source means "look at the
data edges"). **Arithmetic is NOT in accessors** (they only read). To compute `index × 120` you use a
**`compute`** node (typed, pure): `{ op: 'mul', a: DataSource, b: DataSource } → out: number`. This
keeps the type system honest and every value visible.

**DECIDED (option a): pure `compute` nodes.** Arithmetic is authored as typed, pure value nodes
(`mul`, `add`, `sub`, member-get, …) — **no** inline expression mini-language. `index × 120` is
`$index → Multiply(×120) → Delay.ms`. Verbose in the raw, but fully visible + strictly typed, and the
math is authored **once inside a function** (`StaggerStop`) and never seen again. Consequence:
`compute` is a **v1** node kind (§3), not deferred.

## 5. Functions (the reuse model)

```ts
interface FunctionDef {
  id: FunctionId;
  name: string;                 // 'StaggerStop'
  inputs: Pin[];                // exposed on the call node: exec-in + data-ins (reels, step)
  outputs: Pin[];               // exec-out + data-outs
  body: Graph;                  // the internal node graph
  requires: VocabRequirement;   // which template events/actions/cues/types it references
}
```

Inside `body`, two dedicated node kinds bridge the boundary (like Unreal's function entry/result).
They are real `Node`s (`kind: 'functionEntry' | 'functionResult'`, each storing `ref: FunctionId` =
the function whose body it belongs to), and they live **only** inside a `FunctionDef.body` — never
in the top-level `FlowDoc.graph`.
- **`functionEntry`** — the body-side start. Derives an exec-**out** `exec` + one data-**out** per
  the function's `inputs` (the body reads an input by pulling from the entry's matching output).
- **`functionResult`** — the body-side end. Derives an exec-**in** `exec` + one data-**in** per the
  function's `outputs`; the values wired in become the call node's outputs.

So `FunctionDef.inputs` → the entry's data-outs, and `FunctionDef.outputs` → the result's data-ins
(`derivePins`). If a boundary node's `ref` doesn't resolve, only its exec pin is derivable.

**Validation (`validate.ts`).** `validateFlowDoc` rejects any `functionEntry`/`functionResult` in
the top-level graph (`entry-outside-body`). `validateFunctionDef(fn, vocab, library)` validates a
`FunctionDef.body` as its own graph — the same structural/type checks minus `entry-outside-body`,
plus: the body must contain exactly one `functionEntry` and one `functionResult` referencing this
function (`fn-body-entry` / `fn-body-result`).

### 5.1 Collapse to Function (`collapse.ts`)

`collapseToFunction({ doc, library, selection, functionId, functionName }, ctx)` is a **pure,
immutable** transform (Unreal's "Collapse to Function"): it lifts a selection of nodes out of the
main graph into a new `FunctionDef` and replaces them with a single `functionCall` wired to the same
external endpoints — the macro behaviour is unchanged. It returns `{ doc, library, functionId }` or
`{ error }`.

- **Guards.** Error on an empty selection, an id not in `doc.graph.nodes`, or a selection that
  contains an `event` (entry point) or a `functionEntry`/`functionResult` node.
- **Edge partition.** Both `exec` and `data` edges are split by their endpoints' membership in the
  selection `S`: **internal** (both ∈ S), **crossIn** (`to` ∈ S, `from` ∉ S), **crossOut** (`from`
  ∈ S, `to` ∉ S), **external** (neither).
- **Boundary pins.** One function **input** per distinct crossIn target pin (fan-in is 1, so targets
  are unique); one function **output** per distinct crossOut source pin (a data-out may fan out to
  many external targets → still one output). A data input's `dataType` is taken from the crossing's
  **source** data-out (the well-typed side — a target like a `wire`-fed `forEach.in` may be untyped).
  Exec crossings collapse onto a single canonical `exec` pin on the call/entry/result.
- **Body.** The selected nodes (ids kept) + internal edges + a `functionEntry` + a `functionResult`,
  with entry-out → each crossIn target and each crossOut source → result-in.
- **`requires`.** Scanned from the body: `event`/`action`/`fireCue` refs, `$engine.<collection>`
  accessors, and every struct/enum type the body's pins + the function's boundary types touch.
- **New main graph.** Remove S + internal/crossIn/crossOut edges; add the `functionCall` at S's
  centroid; re-attach the **external** side of each crossing to the call's matching pin (external
  edges untouched).

Verified headlessly by `tools/flow-spike/flowV2Collapse.ts` (`pnpm --filter flow-spike v2collapse`).

**Cross-template compatibility (decision #2).** Because a function can touch template-specific
vocabulary, `requires` lists the events/actions/cues/structs it references. The editor offers a
function in a template **only if** that template's vocabulary satisfies `requires`. Purely-generic
functions (Show/Hide, Delay, Branch, a param-named FireCue) satisfy every template and are universal;
`StaggerStop` requires `{ collections: ['reels'?], actions: ['stopReel'], structs: ['Reel'] }` and
surfaces only where those exist. **[OPEN]** versioning — auto-propagate a function edit to all call
sites, or pin a version per call site (Unreal auto-propagates; I lean auto-propagate + a "used by N"
warning).

### 5.2 Collapse to Group (`collapse.ts`, 2026-07-08)

A **group** is a second collapse — an INLINE collapsed subgraph, the counterpart to §5.1's function.
It solves a different need: not *reuse of one behaviour*, but *visual folding of many distinct
nodes into one node while keeping every input/output as its own labelled pin*. The two differ on
exactly the axes that matter:

| | Collapse to **Function** (§5.1) | Collapse to **Group** (§5.2) |
|---|---|---|
| Exec crossings | **merged** onto one canonical `exec` pin | **one pin PER crossing** (no merge) |
| Body lives | in the shared `FunctionLibraryDoc` | **on the node** (`GroupNode.body`) |
| Reusable | yes — drop the call node anywhere | no — inline, one site |
| Pins | derived from the `FunctionDef` | **stored** on `boundary` (the definition) |

The per-crossing rule is the point: N external exec edges into N distinct internal targets become N
distinct group **input** pins, so a block of `onSpin→startSpin`, `onIncrease→increaseBet`, … collapses
into ONE node with one entry pin per button — **no exec-in fan-in** (§2), which a function collapse
would have forced.

- **A group is a pure FOLDING, semantically identical to its expanded form.** `collapseToGroup` and
  `expandGroup` are inverse pure transforms; `flattenGroups(graph)` recursively expands every `group`
  (a body may nest a group) back to its nodes + edges. The runtime + validator **flatten first**, so
  the interpreter never sees a `group` node — no new execution semantics, and "expand / un-collapse"
  falls out for free.
- **`collapseToGroup({ doc, selection, label })`** mirrors §5.1's edge partition (internal / crossIn /
  crossOut / external) but builds ONE `GroupPin` per crossing: each crossIn → an input pin (`inner` =
  the internal target, `label` from that target), each crossOut → an output pin (`inner` = the internal
  source); a data-out fanning to many external targets stays ONE output pin. Same guards as §5.1 (no
  empty selection / unknown id / `event`·`gameSignals`·`functionEntry`·`functionResult` in the
  selection). **`expandGroup(doc, id)`** is its exact inverse (round-trip graph identity).
- **Runtime** (`runtime.ts`) flattens groups at each public entry (`runFlowEvent` /
  `runFlowContainerEvent`); **validation** (`validate.ts`) validates the flattened graph, so exec/data
  rules apply to the real semantics. `derivePins` returns a group's `boundary` pins verbatim.

Verified headlessly by `tools/flow-spike/flowV2Group.ts` (`pnpm --filter flow-spike v2group`): a
fan-in-free two-button collapse validates with 0 issues; `expandGroup` round-trips to the pre-collapse
graph; `runFlowEvent` records identically for collapsed / expanded / raw (transparency); a data
crossing resolves through its boundary pin; the transform is pure and guard-checked.

## 6. Containers (decision #1 — custom z-order)

```ts
interface ContainerRef {
  id: ContainerId;
  sceneId: string;   // the Scene-Editor scene (the group of components)
  z: number;         // author-assigned, fully orderable stack position (NOT a fixed band)
}
```

`showContainer` mounts the referenced scene at its `z`; `hideContainer` unmounts it. Multiple
containers coexist, ordered by `z`. "Base persists under an overlay" is just: the base container has a
lower `z` and is never hidden. Visibility is entirely explicit + flow-owned.

### 6.1 Container-scoped component events (decision #6)

A container **surfaces its components' configured events as exec-out pins on the `showContainer` node
itself** — the exec-out mirror of cue aggregation (§7, decision #4). The rendered `showContainer` node
is a single **fused** node (mount + all its buttons): its base `[exec-in, exec-out]` plus one event
exec-out per configured control. Wiring a button's functionality means wiring *out* of that pin.

```ts
interface ContainerEventDecl {
  id: string;            // 'spinButton.onSpin' — component-local, unique within the container
  componentId: string;   // the Scene-Editor component that declares it
  event: string;         // the configured action/intent name ('spin', 'increaseBet', 'soundToggle')
  label: string;         // the exec-out pin label — the `on<Event>` tail ('onSpin')
  payload?: ParamDecl[]; // data-outs, iff the component's config carries a payload (usually none)
}
```

The set is **derived from the scene, not stored on the node** (same anti-drift rule as §2 pins): a
component contributes an entry **only for the functionality configured on it** in the Scene Editor — a
button with a `spin` action → one `onSpin` entry; a button with nothing wired, or a decorative sprite
→ nothing. So a container's exposed events are a 1:1 readout of what the game can actually do; the flow
decides only **when** each fires. The editor aggregates them per container (`deriveContainerEvents`,
keyed by `ContainerId`) and `derivePins` fuses them onto the matching `showContainer` node; a saved
FlowDoc keeps the wire as `{ from: { node, pin: 'spinButton.onSpin' }, to: {…} }` and the pins
re-derive from the surface on reload (no stored pins). There is **no separate container-scoped event
node** — the pin id `spinButton.onSpin` IS the pin on the fused node. Nothing is auto-dumped — an
unconfigured component surfaces no pins.

### 6.2 The Game Signals node (2026-07-08)

Where §6.1 surfaces a *container's* buttons as pins, the **`gameSignals`** node surfaces the
*template's* **mechanic signals** — one node whose pins are every vocab event the game itself emits.
It is the exec/data-out mirror of the four-registry projection, but for the game's own book +
lifecycle events rather than button intents: an author wires presentation off the game's signals from
**one node** (`onFreeSpinTrigger`, `onWinInfo`, `onLoad`, …) instead of scattering a separate `event`
node per signal.

- **No `ref`.** A `gameSignals` node represents *the template's signal source*, so there is exactly
  one per flow and it carries no reference. It is an entry point — **no exec-in** (a source).
- **Which events surface.** Each `EventDecl` now carries a `category` (§7): `'book'` (an RGS
  `BookEvent`), `'lifecycle'` (a boot/loading/settle signal), or `'intent'` (a player button-press).
  `gameSignals` derives a pin set from the events whose category is **`'book'` OR `'lifecycle'`** —
  the game's *own* signals. **Intents are excluded**: a player-initiated press surfaces instead as a
  container button pin (§6.1), so the two node types partition the event vocabulary with no overlap.
- **Derived pins** (anti-drift, never stored — same rule as §2/§6.1): for each surfaced event, one
  **exec-out** (id = the event name, label = `on<Event>`) plus one **data-out** per that event's
  payload field (id = `<eventName>.<field>`, label = the field name, typed by the field's `TypeRef`).
  So `freeSpinTrigger` yields exec-out `freeSpinTrigger` (`onFreeSpinTrigger`) + data-outs
  `freeSpinTrigger.totalFs` (int) and `freeSpinTrigger.positions` (list<Position>).
- **Runtime firing** (`runtime.ts`). `runFlowEvent(doc, ctx, eventName, payload)` first looks for a
  dedicated `event` node whose `ref === eventName`; failing that it falls back to the `gameSignals`
  node — if the vocab has a **non-intent** event named `eventName`, it walks FROM that node's exec-out
  pin named `eventName` (the same "walk from a specific pin without re-running the node" pattern as
  `runContainerEvent`; the source node is never mid-chain-run). A data-out `<eventName>.<field>`
  resolves to `scope.trigger[field]` — since only the firing event's exec chain runs, `scope.trigger`
  IS that event's payload (the pin id is split on the FIRST `.`; the right side is the field). An
  event with no matching `event` node AND no `gameSignals` pin (an intent, or an unknown/unsurfaced
  event) is a **parity-safe no-op**.

## 7. Template vocabulary (the contract)

Declared by each template; loaded by the editor; **the type checker's source of truth.**

```ts
interface TemplateVocabulary {
  templateId: string;
  structs: StructDecl[];        // Reel { index:int }, Slot { col:int; row:int }, Win {…}
  enums: EnumDecl[];            // SymbolName { … }
  events: EventDecl[];          // name + payload pins + category (reveal → { reels: list<Reel> })
  actions: ActionDecl[];        // effects + commands: name + typed params, + category
  cues: CueDecl[];              // aggregated from components (decision #4): what each accepts
  collections: CollectionDecl[];// engine-readable iterables: reels: list<Reel>, slots: list<Slot>
}
```

**Cue scoping (decision #4)** is realized here: components in the Scene Editor **declare the cues they
bind**; a container aggregates its components' cues; the template vocabulary lists the union, so the
Fire-Cue palette is always scoped to cues something actually listens for — never blind.

**Event category (2026-07-08).** `EventDecl` carries an OPTIONAL `category`:

```ts
type EventCategory = 'book' | 'lifecycle' | 'intent';
interface EventDecl {
  name: string;               // 'reveal'
  payload: ParamDecl[];       // reveal → { reels: list<Reel> }
  category?: EventCategory;    // the mechanic family; absent ⇒ 'book' (surfaced by gameSignals)
}
```

This tags the three families the vocab already documents informally — `'book'` (RGS `BookEvent`s:
`reveal`, `winInfo`, `freeSpinTrigger`, …), `'lifecycle'` (boot/loading/settle: `load`, `tapToStart`,
`idle`), `'intent'` (player button-presses: `spin`, `increase`, …). It is the partition the
`gameSignals` node (§6.2) filters on: book + lifecycle events surface as `gameSignals` pins; intents
surface as container button pins (§6.1). `category` is **optional, defaulting to `'book'`** — an
untagged event is treated as a book event (so it is surfaced by `gameSignals`), which keeps
book-only test fixtures valid without a churn edit — but a real template SHOULD tag all three
families explicitly (the reference `bookOf` vocab does).

## 8. Compiling onto the existing runtime

The v2 graph **compiles** to the trees the current `engine-flow` executor already runs — the engine
lift is bounded:

| v2 node | compiles to (existing runtime) |
|---|---|
| `event` | a per-event entry; walk its exec edges → an ordered tree (today's `EventChoreography`) |
| `action` | an `effect` op (state) or a template command (mechanic) — both already in the effect registry |
| `fireCue` | a `broadcast` (the existing signal/cue system) |
| `delay` | `delay` op (turbo-scaled) |
| `branch` | `branch` op |
| `forEach` | `forEach` op (`body` = the walked sub-tree, `done` = continuation) |
| `showContainer`/`hideContainer` | **new** mounter ops (z-ordered) — replaces the active-set/transition state machine |
| `functionCall` | inline the `FunctionDef.body` at bake, mapping call pins → entry/result |
| `sequence`/`parallel`/`compute` | `sequence`/`parallel` ops; `compute` folds into payload evaluation |

What's genuinely **new** engine-side: the z-ordered show/hide mounter (replacing active-set +
transitions) and a bake-time function inliner. Executor, signals, effect registry, and game state
survive.

## 9. Sub-decisions — resolved (2026-07-07)

1. **Widening:** `ms`↔`int` is implicit (`ms` *is* an int); every other conversion needs an explicit
   `cast`/`compute` node. Honors strict typing.
2. **Arithmetic:** pure `compute` nodes (option a, §4). No inline expression language.
3. **Function versioning:** edits **auto-propagate** to all call sites (Unreal-style), with a
   "used by N flows" warning before a pin-breaking change.
4. **Node set for v1:** ship `compute` (required by #2); ship `sequence`/`parallel` only when a real
   fan-out need appears (linear exec chains cover the rest until then).
5. **Collections:** available BOTH as event payload pins (`reveal → reels`) AND `$engine` global
   reads (`$engine.reels`) — whichever the author reaches for.
6. **Container event pins (2026-07-08):** a container surfaces its components' **configured** events
   as exec-out pins **on the `showContainer` node itself** (§6.1), keyed by `ContainerId` — the exec
   mirror of cue aggregation. The set is derived from the scene — authored via component config, never
   auto-dumped — so a container is one **fused** node (mount + all its buttons); wiring a control means
   wiring out of its pin (`spinButton.onSpin`). There is **no separate container-scoped event node**
   (the earlier `event`-node path with `ref = <sceneId>/<id>` is superseded and removed); `event` nodes
   address only global template events. Authoring (render + wire + save + validate) is implemented;
   runtime firing of these pins is a later phase.

## 10. Runtime — the dedicated v2 interpreter (Phase 4a, `runtime.ts`)

v2 is **NOT compiled onto the v1 `engine-flow` executor** (superseding §8's "compiles to" table).
v2 is genuinely richer than v1's static tree — **dynamic delays** fed by a `compute`, **arithmetic**
nodes, and **function inputs/outputs with recursion** — none of which the v1 tree-walker can express.
So the v2 graph is **walked directly** by a dedicated interpreter in the `engine-flow-v2` package
(`src/runtime.ts`), with the SAME injected-runtime discipline v1 uses: pure logic over an injected
environment, so it's fully testable headlessly and the timing is real (every effect/broadcast/delay
is awaited).

### 10.1 The `FlowV2Env` contract (injected)

The interpreter never imports a Svelte-rune module, the emitter, or `setTimeout`. A game (in Phase 4b)
wires these once to the same primitives the coded path uses; the Phase-4a harness wires a recorder.

```ts
interface FlowV2Env {
  effect(name: string, payload: Record<string, unknown>): void | Promise<void>;   // an `action` node
  broadcast(cue: string, payload: Record<string, unknown>): void | Promise<void>;  // a `fireCue` node
  waitForTimeout(ms: number): Promise<void>;                                       // a `delay` node
  timeScale(): number;                                                             // turbo scalar
  showContainer(containerId: string, z: number): void | Promise<void>;
  hideContainer(containerId: string): void | Promise<void>;
  engineRead(key: string): unknown;                                                // $engine.<key>
}
interface RunContext { vocab: TemplateVocabulary; library: FunctionLibraryDoc; env: FlowV2Env; }
```

The one entry point a game calls when a book/game event fires:

```ts
runFlowEvent(doc: FlowDoc, ctx: RunContext, eventName: string, payload: Record<string, unknown>): Promise<void>
```

**Show/hide go through the env's container mounter** (`showContainer(id, z)` / `hideContainer(id)`),
where `z` is read from `doc.containers` — the interpreter never touches PixiJS; the game supplies the
generic scene mounter behind the env.

### 10.2 Interpretation

- **Entry:** find the `event` node whose `ref === eventName`; seed a `Scope { trigger: payload }`; walk
  its `exec` out-pin. No matching `event` node → **no-op** (parity-safe: falls through to the coded
  handler, honoring the v1 fall-through invariant).
- **Exec walk** `execFrom(node, execPin)`: run the node, then follow its outgoing exec edge from that
  out-pin to the next node; an exec-out with no edge ends the chain (linear chains loop, not recurse).
- **Per-node:** `action` → `await env.effect(ref, payload)`; `fireCue` → `await env.broadcast(...)`;
  `delay` → `await env.waitForTimeout(ms / timeScale())` where **ms is resolved dynamically** (wire /
  literal / accessor / compute); `branch` → evaluate the `guard` (`all`=AND, `any`=OR) and follow
  `then`/`else`; `forEach` → per item seed `{ ...scope, item, index }` and run the `body` chain
  (`sequence`=await in order, `parallel`=`Promise.all`), then follow `done`; `show`/`hideContainer` →
  the env mounter; `sequence`/`parallel` → its `then[i]` subchains in order / concurrently;
  `functionCall` → resolve the call's declared data inputs in the CURRENT scope, run the target
  function's body seeded `{ trigger, input }`, capture the `functionResult`'s data-ins as the call's
  outputs (**cached by call id** for later reads), then continue the outer chain (recurse — no
  pre-inlining). `event`/`functionEntry` are exec START points; `functionResult` ends a body;
  `compute` is never exec-run (pulled during data resolution).
- **Data resolution** `resolveDataIn(node, pin)`: a data edge feeding the pin resolves its SOURCE
  (`event`→`trigger[field]`, `forEach`→`item`/`index`, `functionEntry`→`input[name]`, `functionCall`→
  its cached output, `compute`→`evalCompute`); otherwise the node's own `DataSource` (`literal`→value,
  `accessor`→scope read incl. `$engine.<key>` via `env.engineRead`, unwired `wire`→`undefined`).
- **Robustness:** unknown refs, missing edges, and authored-but-incomplete graphs resolve to a sensible
  no-op / `undefined` — the interpreter **never throws** on a partial graph (mirrors v1's parity-safe
  stance), so a half-authored flow degrades gracefully rather than crashing a live round.

### 10.3 Verified headlessly

> Build status: see [docs/status/flow.md](../status/flow.md); detailed done-log in [docs/history.md](../history.md).

### 10.4 Firing a container-event pin (`runFlowContainerEvent`)

A container's configured component events surface as FUSED exec-out pins on the `showContainer` node
(§6.1), keyed `containerEventDeclId(componentId, event)` = `<componentId>.on<Event>` (the SINGLE
id/label format, shared by the deriver and the runtime via `containerEvents.ts` so they can never
drift). Those pins are the entry point for a component press (a button's `onSpin`) — a second runtime
entry alongside `runFlowEvent`:

```ts
runFlowContainerEvent(doc, ctx, componentId, event, payload?, context?): Promise<void>
flowOwnsContainerEvent(doc, componentId, event): boolean   // pure static graph read — no ctx/env
```

- **Entry (critical):** find the authored exec edge whose `from.pin === containerEventDeclId(...)` and
  whose `from.node` is a `showContainer` node, then walk from the edge's **target** — the `showContainer`
  node is **NOT re-run** (re-running it would re-mount the container). No wired edge → **no-op**
  (parity-safe: the coded press runs).
- **Ownership:** `flowOwnsContainerEvent` returns true iff such an exec edge exists. The game (Part 2)
  calls it to SUPPRESS the coded press when the flow owns the pin, so the two never double-fire.
- **Verified headlessly:** `tools/flow-spike/flowV2ContainerFire.ts` (`pnpm --filter flow-spike
  v2containerfire`) — a `showContainer(base)` whose `spinButton.onSpin` wires `startSpin → fireCue
  boardShow`: firing records `effect startSpin, broadcast boardShow` and NO `show base`; an unwired
  press records nothing; the ownership predicate is true for the wired pin, false otherwise.

### 10.5 Firing a game signal (the `gameSignals` node, §6.2)

`runFlowEvent` gains a second dispatch path: after the `event`-node lookup fails, it falls back to the
single `gameSignals` node. If the vocab has a **non-intent** event named `eventName`, it walks FROM
that node's exec-out pin named `eventName` via `runExecChain` — the same "walk from a specific pin
without re-running the node" pattern as `runFlowContainerEvent` (§10.4). A gameSignals data-out
`<eventName>.<field>` resolves to `scope.trigger[field]` (only the firing event's chain runs, so
`scope.trigger` is that event's payload; the pin id is split on the first `.`). The node is an exec
START point — `runNode` treats an accidental visit as a safe no-op. An intent, or an
unknown/unsurfaced event, is a parity-safe no-op.

- **Verified headlessly:** `tools/flow-spike/flowV2GameSignals.ts` (`pnpm --filter flow-spike
  v2gamesignals`) — `derivePins(gameSignals)` over the real `book-of` vocab surfaces `freeSpinTrigger`
  / `reveal` / `load` (book + lifecycle) and NOT `spin` / `increase` (intents), with typed data-outs
  `freeSpinTrigger.totalFs` (int) + `freeSpinTrigger.positions` (list<Position>) and no exec-in; and a
  `gameSignals` node whose `freeSpinTrigger` exec-out → `showContainer(freespin)` → `action
  setFreeSpinCounterTotal`, with `freeSpinTrigger.totalFs` wired to the action's `total`, records `show
  freespin@10, effect setFreeSpinCounterTotal({total:10})` for `runFlowEvent('freeSpinTrigger',
  {totalFs:10})` (payload resolved THROUGH the pin); an intent / unwired / unknown event records
  nothing. NO launcher UI + NO apps/ wiring — that is Part 2.
