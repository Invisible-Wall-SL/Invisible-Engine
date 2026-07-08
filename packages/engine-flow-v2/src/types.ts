/**
 * Invisible Flow v2 — the schema (data model). The authoritative source is
 * `docs/design/invisible-flow-v2-schema.md`; these types encode it 1:1.
 *
 * The v2 model is a Blueprint-style presentation graph: nodes carry EXEC pins (control:
 * "do this, then that") and DATA pins (typed values). The three artifacts (§0):
 *  - `FlowDoc`            — one per project: the event graph + the containers it shows.
 *  - `FunctionLibraryDoc` — shared across projects/templates: the reusable functions (§5).
 *  - `TemplateVocabulary` — declared by each game TEMPLATE (book-of, lines, …), NOT authored
 *    in the editor: the contract the flow is written against (events, actions, cues,
 *    collections, and the struct/enum types those carry). It is the type checker's source
 *    of truth (§7).
 *
 * THE ANTI-DRIFT RULE (§2): a node stores only a REFERENCE (an event/action/function name).
 * Its pins are DERIVED from that reference + the vocabulary/library (`derivePins`, `pins.ts`),
 * never persisted on the node — so stored pins can never disagree with the effect they call.
 */

// ---------------------------------------------------------------------------
// Identifiers — all opaque strings, aliased for intent at the type sites.
// ---------------------------------------------------------------------------

export type NodeId = string;
export type FunctionId = string;
export type ContainerId = string;

// ---------------------------------------------------------------------------
// §1 — the type system (strict). Every data pin carries a `TypeRef`. Connect-time
// checking is structural equality (`assignable`, `types-check.ts`), with the one
// sanctioned `ms`↔`int` widening (§9.1). Structs/enums are TEMPLATE-declared (§7),
// so `Reel` / `SymbolName` are vocabulary, not built-ins.
// ---------------------------------------------------------------------------

export type TypeRef =
	| { t: 'int' }
	| { t: 'float' }
	| { t: 'bool' }
	| { t: 'string' }
	| { t: 'ms' } // Int milliseconds (semantic alias; still an int — widens to/from `int`, §9.1).
	| { t: 'enum'; name: string } // a template-declared enum (e.g. SymbolName).
	| { t: 'struct'; name: string } // a template-declared struct (Reel, Slot, Win…).
	| { t: 'list'; of: TypeRef }; // a collection (what ForEach iterates).

// ---------------------------------------------------------------------------
// §2 — pins & edges. Pins are DERIVED (shown, not persisted on the node); edges
// wire pin → pin. An exec-in takes at most one incoming exec edge; a data-in at
// most one incoming data edge; a data-out may fan out to many.
// ---------------------------------------------------------------------------

export type PinDir = 'in' | 'out';
export type PinKind = 'exec' | 'data';

/** A derived pin. `dataType` is required iff `kind === 'data'` (enforced by the derivers). */
export interface Pin {
	id: string; // unique within the node: 'exec', 'reels', 'item', 'body', 'done'.
	dir: PinDir;
	kind: PinKind;
	dataType?: TypeRef; // required iff kind === 'data'.
	label?: string;
}

/** A reference to a specific pin on a specific node. */
export interface PinPath {
	node: NodeId;
	pin: string;
}

/** Control flow: an exec-out → an exec-in. */
export interface ExecEdge {
	from: PinPath;
	to: PinPath;
}

/** Value flow: a data-out → a data-in (type-checked at connect time). */
export interface DataEdge {
	from: PinPath;
	to: PinPath;
}

/** The whole graph: nodes + the two edge classes kept apart (control vs value). */
export interface Graph {
	nodes: Node[];
	exec: ExecEdge[];
	data: DataEdge[];
}

// ---------------------------------------------------------------------------
// §4 — data sources. A data-in with no incoming edge falls back to a literal or a
// (read-only) accessor. Arithmetic is NOT in accessors (they only read); to compute
// `index × step` you use a pure `compute` node (§4, decision #2).
// ---------------------------------------------------------------------------

/** A strictly-read accessor, typed against the surrounding scope. */
export type Accessor =
	| { on: 'item'; member?: string } // $item / $item.index inside a forEach.
	| { on: 'index' } // the forEach counter.
	| { on: 'input'; name: string } // a function's input, inside its body.
	| { on: 'engine'; key: string } // a template global read (e.g. reels, slots).
	| { on: 'trigger'; member?: string } // the event payload — whole ($trigger) or a field.
	| { on: 'context'; member?: string }; // the dispatch context (e.g. bookEvents) — whole or a field.

/** Where a data-in gets its value. `wire` means "look at the data edges". */
export type DataSource =
	| { kind: 'wire' }
	| { kind: 'literal'; type: TypeRef; value: unknown }
	| { kind: 'accessor'; path: Accessor };

// ---------------------------------------------------------------------------
// §3 — guards (used by `branch`). A guard is a small, fixed comparison set over
// data sources — deliberately NOT an expression language.
// ---------------------------------------------------------------------------

export type CompareOp = 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte';

export interface Compare {
	left: DataSource;
	op: CompareOp;
	right: DataSource;
}

export interface Guard {
	all?: Compare[];
	any?: Compare[];
}

// ---------------------------------------------------------------------------
// §4 — the `compute` op. A pure, typed value node (no exec) — the ONLY place
// arithmetic/member-get lives. Its output pin's type follows the op + operands.
// ---------------------------------------------------------------------------

/** The pure value ops a `compute` node can carry. `member` reads a struct field. */
export type ComputeOp =
	| { op: 'add'; a: DataSource; b: DataSource }
	| { op: 'sub'; a: DataSource; b: DataSource }
	| { op: 'mul'; a: DataSource; b: DataSource }
	| { op: 'div'; a: DataSource; b: DataSource }
	| { op: 'member'; on: DataSource; member: string }; // read a struct member (e.g. $item.index).

// ---------------------------------------------------------------------------
// §3 — nodes. A discriminated union keyed by `kind`. Every node carries a stable
// `id` and a canvas `pos`; per-kind fields store only the REFERENCE (never pins).
// ---------------------------------------------------------------------------

export type NodeKind =
	| 'event'
	| 'action'
	| 'fireCue'
	| 'delay'
	| 'branch'
	| 'forEach'
	| 'showContainer'
	| 'hideContainer'
	| 'functionCall'
	| 'sequence'
	| 'parallel'
	| 'compute'
	| 'functionEntry'
	| 'functionResult';

/** Shared node fields. `inputs` maps each DATA-IN pin id → its `DataSource` (a `wire`
 *  source defers to the data edges); it is absent for nodes with no data-ins. */
export interface NodeBase {
	id: NodeId;
	kind: NodeKind;
	pos: { x: number; y: number };
	inputs?: Record<string, DataSource>;
}

/** Event (entry point): reacts to a template event. NO exec-in. Data-outs = the payload. */
export interface EventNode extends NodeBase {
	kind: 'event';
	ref: string; // the template event name (resolves in `TemplateVocabulary.events`).
}

/** Action: call a template effect OR command (both typed template functions). */
export interface ActionNode extends NodeBase {
	kind: 'action';
	ref: string; // the template action name (resolves in `TemplateVocabulary.actions`).
}

/** Fire Cue: broadcast a named cue the shown containers' components react to. */
export interface FireCueNode extends NodeBase {
	kind: 'fireCue';
	ref: string; // the cue name (resolves in `TemplateVocabulary.cues`).
	/** AWAIT the cue's subscribers before continuing the exec chain (an awaited `broadcastAsync` —
	 *  e.g. a reveal that must finish before the next event). Default `false` = fire-and-forget. */
	await?: boolean;
}

/** Delay: latent wait (turbo-scaled). One `ms: ms` data-in fed by wire/literal/accessor. */
export interface DelayNode extends NodeBase {
	kind: 'delay';
}

/** Branch: if/else on a guard over data sources. Exec-outs `then` / `else`. */
export interface BranchNode extends NodeBase {
	kind: 'branch';
	guard: Guard;
}

/** ForEach: iterate a list. `body` is whatever's wired from its exec-out (no nested canvas). */
export interface ForEachNode extends NodeBase {
	kind: 'forEach';
	mode: 'sequence' | 'parallel';
}

/** Show Container: mount the referenced scene at its `z` (from the FlowDoc's `containers`). */
export interface ShowContainerNode extends NodeBase {
	kind: 'showContainer';
	ref: ContainerId;
}

/** Hide Container: unmount the referenced container. */
export interface HideContainerNode extends NodeBase {
	kind: 'hideContainer';
	ref: ContainerId;
}

/** Function call: pins mirror the target `FunctionDef`'s declared inputs/outputs. */
export interface FunctionCallNode extends NodeBase {
	kind: 'functionCall';
	ref: FunctionId; // resolves in `FunctionLibraryDoc.functions`.
}

/** Sequence: one exec-in, N ordered exec-outs `then[0..n-1]`, fired in order. */
export interface SequenceNode extends NodeBase {
	kind: 'sequence';
	count: number; // how many `then[i]` exec-outs to expose.
}

/** Parallel: one exec-in, N exec-outs fired concurrently. */
export interface ParallelNode extends NodeBase {
	kind: 'parallel';
	count: number;
}

/** Compute: a pure, typed value op (no exec). One data-out `out`. */
export interface ComputeNode extends NodeBase {
	kind: 'compute';
	compute: ComputeOp;
}

/** Function Entry (§5): the body-side start of a function. Lives ONLY inside a
 *  `FunctionDef.body`, never in the top-level `FlowDoc.graph`. Exposes the function's
 *  declared `inputs` as data-OUTS (the body reads inputs by pulling from here) plus an
 *  exec-OUT. `ref` is the function whose body it belongs to. */
export interface FunctionEntryNode extends NodeBase {
	kind: 'functionEntry';
	ref: FunctionId; // the function whose body this entry belongs to.
}

/** Function Result (§5): the body-side end of a function. Lives ONLY inside a
 *  `FunctionDef.body`. Exposes an exec-IN plus a data-IN per the function's declared
 *  `outputs`; the values wired in become the call node's outputs. `ref` is that function. */
export interface FunctionResultNode extends NodeBase {
	kind: 'functionResult';
	ref: FunctionId; // the function whose body this result belongs to.
}

export type Node =
	| EventNode
	| ActionNode
	| FireCueNode
	| DelayNode
	| BranchNode
	| ForEachNode
	| ShowContainerNode
	| HideContainerNode
	| FunctionCallNode
	| SequenceNode
	| ParallelNode
	| ComputeNode
	| FunctionEntryNode
	| FunctionResultNode;

// ---------------------------------------------------------------------------
// §5 — functions (the reuse model). A function is authored once and dropped as a
// call node anywhere; its `body` graph bridges the call boundary via implicit
// entry/result nodes (like Unreal's function entry/result). `requires` declares the
// template vocabulary it touches, so the editor only offers it where that vocabulary
// exists (§5, decision #2).
// ---------------------------------------------------------------------------

/** Which template vocabulary a function references — the cross-template compatibility gate. */
export interface VocabRequirement {
	events?: string[];
	actions?: string[];
	cues?: string[];
	structs?: string[];
	enums?: string[];
	collections?: string[];
}

export interface FunctionDef {
	id: FunctionId;
	name: string; // 'StaggerStop'.
	inputs: Pin[]; // exposed on the call node: exec-in + data-ins.
	outputs: Pin[]; // exec-out + data-outs.
	body: Graph; // the internal node graph.
	requires: VocabRequirement; // which template events/actions/cues/types it references.
}

export interface FunctionLibraryDoc {
	version: 2;
	functions: FunctionDef[];
}

// ---------------------------------------------------------------------------
// §6 — containers (custom z-order, decision #1). A container is a Scene-Editor scene
// plus an author-assigned, fully-orderable `z`. `showContainer` mounts it at its `z`.
// ---------------------------------------------------------------------------

export interface ContainerRef {
	id: ContainerId;
	sceneId: string; // the Scene-Editor scene (the group of components).
	z: number; // author-assigned, fully orderable stack position (NOT a fixed band).
}

// ---------------------------------------------------------------------------
// §6.1 — container-scoped component events (decision #6). A container SURFACES its
// components' CONFIGURED events as exec-out pins — the exec-out mirror of cue aggregation.
// Derived from the Scene-Editor component config (`deriveContainerEvents`, `containerEvents.ts`),
// NEVER auto-dumped: a component contributes an entry ONLY for the functionality configured on it
// (a button with a `spin` action → one `onSpin`; a decorative sprite or an unwired button → nothing).
// Same anti-drift rule as §2 pins — the set is a projection of the scene, not stored on the node.
// An `event` node addresses one as `<sceneId>/<ContainerEventDecl.id>`.
// ---------------------------------------------------------------------------

export interface ContainerEventDecl {
	id: string; // component-local, unique within the container, e.g. 'spinButton.onSpin'.
	componentId: string; // the Scene-Editor component that declares it.
	event: string; // the configured action/intent name, e.g. 'spin'.
	payload?: ParamDecl[]; // data-outs; usually empty (mirrors `EventDecl`/`CueDecl` payloads).
}

// ---------------------------------------------------------------------------
// §7 — the template vocabulary (the contract). Declared by each template; loaded by
// the editor; the type checker's source of truth.
// ---------------------------------------------------------------------------

/** A named field on a struct — its own `TypeRef`. */
export interface StructField {
	name: string;
	type: TypeRef;
}

export interface StructDecl {
	name: string; // 'Reel', 'Slot', 'Win'.
	fields: StructField[]; // Reel { index:int }.
}

export interface EnumDecl {
	name: string; // 'SymbolName'.
	values: string[]; // the allowed member names.
}

/** A named, typed payload field on an event/action/cue. */
export interface ParamDecl {
	name: string;
	type: TypeRef;
}

export interface EventDecl {
	name: string; // 'reveal'.
	payload: ParamDecl[]; // reveal → { reels: list<Reel> }.
}

/** An action's palette category — a display tag only; both kinds are typed template functions. */
export type ActionCategory = 'effect' | 'command';

export interface ActionDecl {
	name: string; // 'setSpecialSymbol', 'stopReel'.
	params: ParamDecl[]; // typed params → the action node's data-ins.
	category: ActionCategory; // state-effect vs mechanic-command (palette tag only).
}

export interface CueDecl {
	name: string; // 'specialBookReveal'.
	payload: ParamDecl[]; // usually empty (cues rarely carry data).
}

export interface CollectionDecl {
	name: string; // 'reels', 'slots'.
	of: TypeRef; // the element type (a struct), so the list type is `list<of>`.
}

export interface TemplateVocabulary {
	templateId: string;
	structs: StructDecl[];
	enums: EnumDecl[];
	events: EventDecl[];
	actions: ActionDecl[];
	cues: CueDecl[];
	collections: CollectionDecl[]; // engine-readable iterables (also $engine reads, §9.5).
}

// ---------------------------------------------------------------------------
// §0 — the FlowDoc itself.
// ---------------------------------------------------------------------------

/**
 * An EDITOR-ONLY annotation (§0): a labeled, resizable box drawn BEHIND the nodes to visually group
 * and comment a region of the graph (Unreal-Blueprint's "comment" boxes). Purely cosmetic — it has
 * no pins and no runtime meaning, so `runFlowEvent` and `validateFlowDoc` IGNORE it. Persisted on the
 * doc so the layout survives a reload; the game harmlessly carries (and never reads) it.
 */
export interface FlowComment {
	id: string;
	label: string;
	/** Top-left + size in the SAME doc-space coordinates as node positions. */
	x: number;
	y: number;
	width: number;
	height: number;
	/** Accent colour (header tint + border). The editor applies a default when absent. */
	color?: string;
}

export interface FlowDoc {
	version: 2;
	templateId: string; // which TemplateVocabulary this flow targets.
	graph: Graph; // the event graph.
	containers: ContainerRef[]; // the containers this flow shows/hides, each with a z-order.
	/** Editor-only labelled group boxes (see {@link FlowComment}). Ignored by runtime + validation. */
	comments?: FlowComment[];
}
