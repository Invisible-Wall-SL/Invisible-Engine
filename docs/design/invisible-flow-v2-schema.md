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
  | 'event' | 'action' | 'fireCue' | 'delay' | 'branch' | 'forEach'
  | 'showContainer' | 'hideContainer' | 'functionCall'
  | 'sequence' | 'parallel'      // exec fan-out helpers
  | 'compute';                   // pure typed value ops (see §4)
```

Per kind (pins listed as they're **derived**):

- **event** — `{ ref: string }` the template event name. Entry point: **no** exec-in. Pins:
  out `exec`; one data-out per the `EventDecl`'s payload (e.g. `reveal` → `reels: list<Reel>`).
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
- **showContainer** / **hideContainer** — `{ ref: ContainerId }`. Pins: in `exec`, out `exec`.
- **functionCall** — `{ ref: FunctionId }`. Pins mirror the `FunctionDef`'s declared `inputs`/
  `outputs` (in `exec` + input data-ins; out `exec` + output data-outs).
- **sequence** — in `exec`; N ordered out execs `then[0..n]`, fired in order. **parallel** — same but
  fired concurrently. (Linear chains don't need these; they're for explicit fan-out.)
- **compute** — a pure, typed value op (no exec). See §4.

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

Inside `body`, two implicit nodes bridge the boundary (like Unreal's function entry/result):
- **Entry** — an entry point exposing the function's `inputs` as data-outs + an exec-out.
- **Result** — an exec-in + a data-in per output, whose values become the call node's outputs.

**Cross-template compatibility (decision #2).** Because a function can touch template-specific
vocabulary, `requires` lists the events/actions/cues/structs it references. The editor offers a
function in a template **only if** that template's vocabulary satisfies `requires`. Purely-generic
functions (Show/Hide, Delay, Branch, a param-named FireCue) satisfy every template and are universal;
`StaggerStop` requires `{ collections: ['reels'?], actions: ['stopReel'], structs: ['Reel'] }` and
surfaces only where those exist. **[OPEN]** versioning — auto-propagate a function edit to all call
sites, or pin a version per call site (Unreal auto-propagates; I lean auto-propagate + a "used by N"
warning).

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

## 7. Template vocabulary (the contract)

Declared by each template; loaded by the editor; **the type checker's source of truth.**

```ts
interface TemplateVocabulary {
  templateId: string;
  structs: StructDecl[];        // Reel { index:int }, Slot { col:int; row:int }, Win {…}
  enums: EnumDecl[];            // SymbolName { … }
  events: EventDecl[];          // name + payload pins (reveal → { reels: list<Reel> })
  actions: ActionDecl[];        // effects + commands: name + typed params, + category
  cues: CueDecl[];              // aggregated from components (decision #4): what each accepts
  collections: CollectionDecl[];// engine-readable iterables: reels: list<Reel>, slots: list<Slot>
}
```

**Cue scoping (decision #4)** is realized here: components in the Scene Editor **declare the cues they
bind**; a container aggregates its components' cues; the template vocabulary lists the union, so the
Fire-Cue palette is always scoped to cues something actually listens for — never blind.

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
