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
	| { t: 'list'; of: TypeRef } // a collection (what ForEach iterates).
	| { t: 'instance'; component?: string }; // a spawned instance's handle (§3.3); no component ⇒ any.

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
	/** Optional human help — what this pin is / what it carries / how to wire it. Surfaced as the
	 *  editor tooltip; derived from the vocabulary's `description` (an event/param's doc), never
	 *  authored on the node. Absent ⇒ no rich tooltip (the pin just shows its label). */
	doc?: string;
	/** Data-ins only: this pin may be left with NO edge and NO stored source, because the effect
	 *  behind it supplies its own default. Derived from the vocabulary's `ParamDecl.optional`, never
	 *  authored on the node. Absent ⇒ required ⇒ `unfilled-data-in` when nothing feeds it. */
	optional?: boolean;
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
	| { on: 'context'; member?: string } // the dispatch context (e.g. bookEvents) — whole or a field.
	| { on: 'var'; id: string } // a game variable ($var.<id>, game-families §3.1).
	| { on: 'live'; layer: string }; // a spawn layer's live instances ($live.<layer>, §3.3).

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
	| 'gameSignals'
	| 'action'
	| 'fireCue'
	| 'delay'
	| 'branch'
	| 'forEach'
	| 'showContainer'
	| 'hideContainer'
	| 'textMessage'
	| 'playCinematic'
	| 'functionCall'
	| 'sequence'
	| 'parallel'
	| 'compute'
	| 'group'
	| 'functionEntry'
	| 'functionResult'
	| 'modeTrigger'
	| 'allModesFinished'
	| 'enterMode'
	| 'exitMode'
	| 'componentInstance'
	| 'waitForState'
	| 'setVariable'
	| 'changeVariable'
	| 'onVariable'
	| 'onTick'
	| 'onTimer'
	| 'onInput'
	| 'startTimer'
	| 'stopTimer'
	| 'pauseTimer'
	| 'spawn'
	| 'despawn'
	| 'instanceRef';

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

/**
 * Game Signals (§6.2): the SINGLE node that surfaces the TEMPLATE's MECHANIC signals — every vocab
 * event whose `category` is `'book'` or `'lifecycle'` (NOT `'intent'`; intents are the container
 * button pins, §6.1). It has NO `ref` — it represents the template's own signal source, one per
 * flow. Its pins are DERIVED from the vocabulary (anti-drift, never stored): one exec-OUT per
 * non-intent event (id = the event name, label = `on<Event>`) plus one data-OUT per that event's
 * payload field (id = `<eventName>.<field>`). NO exec-in — it is an exec START point (a source),
 * so an author wires presentation off the game's own signals from ONE node instead of scattered
 * per-event nodes.
 */
export interface GameSignalsNode extends NodeBase {
	kind: 'gameSignals';
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
	/**
	 * AWAIT this cue before continuing the exec chain (e.g. a reveal that must finish before the next
	 * event). Default `false` = fire-and-forget.
	 *
	 * WHAT IS AWAITED IS THE ENV'S CALL, and it differs by cue. An ENGINE cue resolves when its
	 * subscribers do (an awaited `broadcastAsync`). A cue the AUTHOR named in the Scene Editor has no
	 * subscriber that can report completion — it travels a bare `subscribe(run)` signal bus — so the
	 * game env waits for the ANIMATION it starts instead, measured off the mounted scenes
	 * (`engine-layout`'s `cueAnimationDurationMs`). The interpreter only awaits what
	 * the env's `broadcast` (`runtime.ts`) returns; it does not know which kind it got.
	 */
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
	/** ROUND-BLOCK HOLD (overlay tap-to-continue): when true, after mounting the container the exec
	 *  chain BLOCKS until this container next completes — its `complete:<id>` fires (a tap on an overlay
	 *  whose `tapToContinue` is on) and it is hidden. The generic replacement for the coded free-spin
	 *  gates: an authored overlay pauses the round until the player taps, then the chain (and the
	 *  awaiting book pump) resumes. Absent/false ⇒ show-and-continue (no hold). */
	awaitComplete?: boolean;
}

/** Hide Container: unmount the referenced container. */
export interface HideContainerNode extends NodeBase {
	kind: 'hideContainer';
	ref: ContainerId;
}

/**
 * Text Message (§6.3): a presentation LEAF that draws one localized line of text at an authored
 * screen position. It is the "generic message" primitive — drop the node, type the text, wire (or
 * state-gate) its visibility. Unlike a `showContainer` (which references a Scene-Editor scene), the
 * node CARRIES its own content: `text` is both the authored default AND the localization key
 * (harvested by `collectTextMessages`, resolved through the catalog at render like any layout text).
 * Storing content on the node is a deliberate, contained exception to the anti-drift rule (§2) —
 * mirroring `group.body` / `comment.label` — because the text IS the node's definition, not a pin.
 *
 * ## Two visibility drivers, OR-ed
 *
 * The interpreter is event-driven; "always while idle" is a sustained STATE, not an event. So a
 * message is visible when EITHER holds:
 *  - `visibleWhile` — a reactive STATE-GATE the game evaluates continuously (`idle`/`spinning`/
 *    `freeSpins`/`always`). `'none'` (or absent) ⇒ no gate; visibility is flow-driven only.
 *  - the FLOW-SHOWN flag — toggled by the node's `show`/`hide` exec-ins (§below). `show` also
 *    schedules an `autoHideMs` auto-clear, so a transient "Good luck" is ONE node, not show+delay+hide.
 *
 * ## Pins
 *
 * exec-in `show` (raise the flow-shown flag + arm `autoHideMs`), exec-in `hide` (clear it), and a
 * single exec-out `exec` that continues from whichever inlet fired (so the node chains). A purely
 * state-gated message wires NEITHER exec-in; a purely transient one leaves `visibleWhile` unset.
 */
export interface TextMessageNode extends NodeBase {
	kind: 'textMessage';
	/** The authored line — the editable default AND the localization key (localize-then-render). */
	text: string;
	/**
	 * WHERE the message draws:
	 *  - `'infoBar'` (default) — routes the text through the game's SHARED message channel
	 *    (`stateMessage` / `showMessage`), the exact single slot win toasts and other in-game
	 *    messages use, so it looks + sits identically to the rest of the game's messaging. Single
	 *    slot: the most-recently-shown message wins (a simultaneous win toast can replace it). `place`
	 *    / `style` are ignored (the info bar's own scene styling governs).
	 *  - `'anchor'` — an INDEPENDENT overlay drawn at `place` with `style`. Use for a persistent or
	 *    specifically-positioned prompt that must not share (or be clobbered by) the single slot.
	 */
	placement?: 'infoBar' | 'anchor';
	/** Normalized 0..1 screen anchor for `placement:'anchor'` (fraction of the game canvas; ignored
	 *  for `'infoBar'`). Distinct from `NodeBase.pos`, the node's position on the EDITOR canvas. */
	place: { x: number; y: number };
	/** The reactive state-gate. Absent/`'none'` ⇒ visibility is driven only by the `show`/`hide`
	 *  exec-ins. `'always'` ⇒ shown whenever the flow that owns it is active. */
	visibleWhile?: 'idle' | 'spinning' | 'freeSpins' | 'always' | 'none';
	/** When shown via the `show` exec, auto-hide after this many ms (turbo-scaled like a `delay`).
	 *  0/absent ⇒ stays shown until a `hide` exec (or, for a state-gated node, until the gate flips). */
	autoHideMs?: number;
	/** Optional inline text style for `placement:'anchor'` (ignored for `'infoBar'`, which inherits the
	 *  game's info-bar styling). Absent fields fall back to the game's default text style:
	 *  - `font` — a FONT REFERENCE (a Font Maker id or a built-in/system family), resolved through the
	 *    game's boot font catalog by `<CatalogText>` (so a bitmap font renders as `<BitmapText>`).
	 *    Absent ⇒ the default HUD font (`proxima-nova`), i.e. the font the rest of the game text uses.
	 *  - `size` / `color` — absent ⇒ the engine's default message size / fill. */
	style?: { font?: string; size?: number; color?: string };
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

/**
 * A boundary pin on a `group` node (§5.2). Unlike a `functionCall` (whose pins are DERIVED from the
 * target `FunctionDef`), a group's pins are STORED here on `boundary` — a deliberate exception to the
 * anti-drift rule (§2), because the boundary IS the group's definition: it records exactly which
 * internal endpoint each external crossing bridges to, one pin per crossing (no exec-in fan-in). Each
 * pin's `inner` names the internal `(node, pin)` on the group's `body` that the external edge attaches
 * to when the group is flattened/expanded.
 */
export interface GroupPin {
	id: string; // unique on the group node (in_<i> / out_<i>).
	dir: PinDir;
	kind: PinKind;
	dataType?: TypeRef; // present iff kind === 'data'.
	label: string; // descriptive, from the inner target/source node's ref/kind (e.g. the action name).
	inner: PinPath; // the internal (node, pin) this boundary pin bridges to.
}

/**
 * Group (§5.2): an INLINE, non-reusable folding of a node selection into ONE node — semantically
 * identical to its expanded form. Unlike `collapseToFunction` (which MERGES exec crossings onto one
 * canonical exec pin and lifts the body into the shared `FunctionLibraryDoc`), a group keeps EACH
 * boundary crossing as its own pin (N external exec edges → N distinct input pins, no fan-in) and
 * stores its `body` ON the node. At runtime + validation the group is FLATTENED back into its nodes
 * (`flattenGroups`) before anything walks it, so the interpreter never sees a `group`. Collapse and
 * `expandGroup` are exact inverses (round-trip identity on graph semantics).
 */
export interface GroupNode extends NodeBase {
	kind: 'group';
	label: string; // display name, e.g. 'Button actions'.
	body: Graph; // the collapsed inner nodes + INTERNAL edges only.
	boundary: GroupPin[]; // one per boundary crossing; the node's pins ARE these.
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

/**
 * Play Cinematic (presentation LEAF): plays an Invisible Cinematic — the multi-rig sequencer
 * authored in `/rigger`'s Cinematic mode. Plan: `docs/design/invisible-cinematic.md`.
 *
 * The cinematic itself owns WHAT happens and WHEN (its own timeline of strips, property and camera
 * keys); this node only says "play that one, now". Everything about its content is authored in the
 * Rigger, so this node deliberately exposes no per-play choreography.
 *
 * ## Pins
 *
 * exec-in `play` (start it from the top) and exec-in `stop` (cut it short), plus ONE exec-out
 * `exec`. With `awaitComplete` the chain resumes when the cinematic REACHES ITS END; otherwise it
 * continues immediately and the cinematic plays alongside the rest of the flow.
 */
export interface PlayCinematicNode extends NodeBase {
	kind: 'playCinematic';
	/** The cinematic's id — matches a `bakedCinematics()` entry (the `.icin` file name). */
	ref: string;
	/**
	 * Loop forever until a `stop` exec (or the screen unmounts). MUTUALLY EXCLUSIVE with
	 * `awaitComplete`: a looping cinematic never completes, so awaiting one would hang the round
	 * exactly like the `showContainer{awaitComplete}`-with-no-release trap. `validate` flags it.
	 */
	loop?: boolean;
	/** Playback rate; 1 (or absent) = the authored speed. */
	speed?: number;
	/** Hold the exec chain until the cinematic finishes. Ignored — and invalid — when `loop`. */
	awaitComplete?: boolean;
}

// ---------------------------------------------------------------------------
// GAME MODES (`docs/design/hold-and-win.md` §4.5) — the engine keeps a stack of active modes plus a
// queue of pending ones; these four nodes are how a flow reacts to it and moves it.
// ---------------------------------------------------------------------------

/** When a {@link ModeTriggerNode} fires: its mode came on screen, left it, or came back to it. */
export type ModeTriggerOn = 'enter' | 'exit' | 'resume';

/**
 * Mode trigger (entry point, NO exec-in): fires when the engine's mode stack moves `modeId` — on
 * `enter` (it starts playing: entered now, or popped from the queue), `exit` (it finished), or
 * `resume` (a mode nested on top of it finished). Data-outs: `mode`, `cause`, `total`.
 * In a mode's own tab this is that mode's On Enter / On Exit.
 */
export interface ModeTriggerNode extends NodeBase {
	kind: 'modeTrigger';
	modeId: string;
	/** Absent ⇒ `enter`. */
	on?: ModeTriggerOn;
}

/** On all modes finished (entry point, NO exec-in): the stack AND the queue are empty — back at base. */
export interface AllModesFinishedNode extends NodeBase {
	kind: 'allModesFinished';
}

/**
 * Enter mode: ask the engine to enter `modeId` — now on top of the current mode (`nest`) or once the
 * current modes finish (`queue`). A mode already active or queued merges. Data-in `cause` (optional).
 */
export interface EnterModeNode extends NodeBase {
	kind: 'enterMode';
	modeId: string;
	/** Absent ⇒ `nest`. */
	policy?: 'nest' | 'queue';
}

/** Exit mode: close `modeId` (the mode on screen when blank). Data-in `total` (optional). */
export interface ExitModeNode extends NodeBase {
	kind: 'exitMode';
	modeId?: string;
}

/**
 * Where a placed component instance lives: the Scene-Editor screen (as a container of this flow)
 * and the placed node's id in that screen. Both are stored, because the game addresses the live
 * instance by node id and the validator judges the pair against the layout.
 */
export interface InstanceRef {
	container: ContainerId;
	instance: string;
}

/**
 * Component INSTANCE node (Rive plan §6.2, Phase 7): a placed component instance on a screen,
 * wired like any other node. Its pins are DERIVED from the instance's pinned `ComponentDef`
 * interface (`PinContext.instances`, projected by whoever holds the LayoutDoc — the same
 * anti-drift rule as §2 and §6.1), never stored:
 *
 *  - exec-in `set` — apply every fed data-in to the instance, then continue;
 *  - exec-in `fire:<trigger>` per trigger input — apply the data-ins, fire the trigger on THAT
 *    instance (its own bus and scope), then continue;
 *  - data-in `in:<input>` per bool / number / text input, all optional (an unfed input is left);
 *  - exec-out `exec` — continues from whichever exec-in fired (the `textMessage` pattern);
 *  - exec-out `event:<event>` per event the component declares, with a data-out
 *    `event:<event>:<field>` per payload field — its OWN entry root, never a continuation of the
 *    chain that set the inputs (the §6.1 container-event pins' rule). The id form is deliberately
 *    NOT `containerEventDeclId` (`<id>.on<Event>`): an event `confirm` must never resolve to a
 *    `pressAction: 'confirm'` chain, on the runtime road or in a saved wire;
 *  - data-out `value:<layer>.state` per state-machine layer — the layer's current state id.
 *
 * Nothing about the component is stored on the node (`inputs` holds only the data-in sources, as
 * on every node), so changing the component changes the pins, and a wire to a pin the interface no
 * longer has is a validation error.
 */
export interface FlowInstanceNode extends NodeBase, InstanceRef {
	kind: 'componentInstance';
}

/**
 * Wait for state (Phase 7): hold the exec chain until the instance's state-machine layer `layer`
 * is in state `state` — at once when it already is. exec-in `exec`, exec-out `exec`. What the wait
 * does for an instance that is not on screen is the game env's rule (`FlowV2Env.awaitInstanceState`).
 *
 * With `componentId` set it waits on a SPAWNED instance of that component instead (§3.3): the
 * handle arrives on its `instance` data-in, and `container` / `instance` are blank.
 */
export interface WaitForStateNode extends NodeBase, InstanceRef {
	kind: 'waitForState';
	layer: string;
	state: string;
	componentId?: string;
}

// ---------------------------------------------------------------------------
// GAME VARIABLES, TIMERS, TICK AND INPUT (`docs/design/game-families.md` §3.1–§3.2). The values and
// timers live in a store the game holds (`state.ts`), reached through `FlowV2Env.state`; none of it
// lives in the per-run interpreter. A doc that declares none of these runs exactly as before.
// ---------------------------------------------------------------------------

/** Set Variable: write the `value` data-in to `variable`, at once, then continue. */
export interface SetVariableNode extends NodeBase {
	kind: 'setVariable';
	variable: string;
}

/** How a {@link ChangeVariableNode} changes its variable: add / subtract its `by` data-in (a
 *  number variable), or flip it (a bool). */
export type ChangeVariableOp = 'add' | 'sub' | 'toggle';

/** Change Variable: one atomic read-modify-write of `variable`, clamped to `min` / `max`. */
export interface ChangeVariableNode extends NodeBase {
	kind: 'changeVariable';
	variable: string;
	op: ChangeVariableOp;
	min?: number;
	max?: number;
}

/** Which way a `crosses` {@link OnVariableNode} watches its threshold. Absent ⇒ `either`. */
export type VariableCrossing = 'up' | 'down' | 'either';

/**
 * On Variable (entry point, NO exec-in): fires when `variable` changes (`changed`, once per frame
 * with its latest value), or when a write takes it across `threshold` (`crosses`: up is from below
 * to at-or-above, down from above to at-or-below). Data-outs `value` and `previous`.
 */
export interface OnVariableNode extends NodeBase {
	kind: 'onVariable';
	variable: string;
	/** Absent ⇒ `changed`. */
	on?: 'changed' | 'crosses';
	threshold?: number;
	direction?: VariableCrossing;
}

/** On Tick (entry point): fires every frame, or every `every` ms. Data-out `dt` (ms since the
 *  last fire). Its chain may not wait on anything (`tick-async`). */
export interface OnTickNode extends NodeBase {
	kind: 'onTick';
	every?: number;
}

/** On Timer (entry point): fires when timer `timer` runs out (each period, for a repeating one). */
export interface OnTimerNode extends NodeBase {
	kind: 'onTimer';
	timer: string;
}

/** On Input (entry point): fires when a key bound to `action` (`FlowDoc.inputs`) goes down / up. */
export interface OnInputNode extends NodeBase {
	kind: 'onInput';
	action: string;
	/** Absent ⇒ `down`. */
	phase?: 'down' | 'up';
}

/** Start Timer: (re)start timer `timer` for the `ms` data-in; `repeat` restarts it each time it
 *  runs out. */
export interface StartTimerNode extends NodeBase {
	kind: 'startTimer';
	timer: string;
	repeat?: boolean;
}

/** Stop Timer: cancel timer `timer` (it does not fire). */
export interface StopTimerNode extends NodeBase {
	kind: 'stopTimer';
	timer: string;
}

/** Pause Timer: exec-in `pause` holds timer `timer` where it is, `resume` lets it run on. */
export interface PauseTimerNode extends NodeBase {
	kind: 'pauseTimer';
	timer: string;
}

// ---------------------------------------------------------------------------
// SPAWNING (`docs/design/game-families.md` §3.3). A `spawnLayer` layout node is a container whose
// children are created while the game runs; these nodes create, remove and address them. The live
// set is held by the game (`spawn.ts` `createSpawnStore`), reached through `FlowV2Env`.
// ---------------------------------------------------------------------------

/** Where a {@link SpawnNode} places its instance: a point (`x` / `y` data-ins, in the layer's space)
 *  or a cell of a grid layer (`col` / `row`). Absent ⇒ `xy`. */
export type SpawnAtMode = 'xy' | 'cell';

/**
 * Spawn: create an instance of `componentId` in spawn layer `layer` (a `spawnLayer` node id), then
 * continue. Data-outs `instance` (its handle, `instance<componentId>`) and `spawned` (false when
 * the layer refused it: full, not spawnable there, a cell off the grid).
 */
export interface SpawnNode extends NodeBase {
	kind: 'spawn';
	layer: string;
	componentId: string;
	at?: SpawnAtMode;
}

/** Despawn: remove the instance on its `instance` data-in (a handle no longer live does nothing). */
export interface DespawnNode extends NodeBase {
	kind: 'despawn';
}

/**
 * Instance ref: the Phase 7 instance node for a SPAWNED instance of `componentId`. Its pins are
 * that component's interface (`deriveInstancePins`) plus a data-in `instance` (the handle to
 * address) and a data-out `handle`. Its `event:<event>` exec-outs run when ANY spawned instance of
 * the component raises the event, with the raising instance in `$trigger.instance` (and on
 * `handle`, when the `instance` data-in is not fed).
 */
export interface InstanceRefNode extends NodeBase {
	kind: 'instanceRef';
	componentId: string;
}

export type Node =
	| EventNode
	| GameSignalsNode
	| ActionNode
	| FireCueNode
	| DelayNode
	| BranchNode
	| ForEachNode
	| ShowContainerNode
	| HideContainerNode
	| TextMessageNode
	| PlayCinematicNode
	| FunctionCallNode
	| SequenceNode
	| ParallelNode
	| ComputeNode
	| GroupNode
	| FunctionEntryNode
	| FunctionResultNode
	| ModeTriggerNode
	| AllModesFinishedNode
	| EnterModeNode
	| ExitModeNode
	| FlowInstanceNode
	| WaitForStateNode
	| SetVariableNode
	| ChangeVariableNode
	| OnVariableNode
	| OnTickNode
	| OnTimerNode
	| OnInputNode
	| StartTimerNode
	| StopTimerNode
	| PauseTimerNode
	| SpawnNode
	| DespawnNode
	| InstanceRefNode;

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
// components' CONFIGURED events as exec-out pins ON THE `showContainer` NODE ITSELF — the
// exec-out mirror of cue aggregation, keyed by the container's `ContainerId`. One fused
// "Base game" node = mount + all its buttons; there is NO separate container-scoped event node.
// Derived from the Scene-Editor component config (`deriveContainerEvents`, `containerEvents.ts`),
// NEVER auto-dumped: a component contributes an entry ONLY for the functionality configured on it
// (a button with a `spin` action → one `onSpin`; a decorative sprite or an unwired button → nothing).
// Same anti-drift rule as §2 pins — the set is a projection of the scene, not stored on the node.
// ---------------------------------------------------------------------------

export interface ContainerEventDecl {
	id: string; // component-local, unique within the container, e.g. 'spinButton.onSpin'.
	componentId: string; // the Scene-Editor component that declares it.
	event: string; // the configured action/intent name, e.g. 'spin'.
	label: string; // the exec-out pin label — the `on<Event>` tail (e.g. 'onSpin').
	payload?: ParamDecl[]; // data-outs; usually empty (mirrors `EventDecl`/`CueDecl` payloads).
}

// ---------------------------------------------------------------------------
// §6.3 — placed component instances (Rive plan §6.2, Phase 7). A `componentInstance` node's pins
// come from the INTERFACE of the instance's pinned `ComponentDef` version: what Flow can set or
// fire (inputs), what the component tells Flow (events) and what Flow can read (values). The
// shape is structural — engine-layout derives it from the def (`componentInterface`) and the
// launcher projects it per placed instance; this package never reads a `ComponentDef`.
// ---------------------------------------------------------------------------

/** A component input's kind. `text` carries a LOCALIZATION KEY (plan §8), never a sentence. */
export type InstanceInputKind = 'bool' | 'number' | 'trigger' | 'text';

export interface InstanceInputDecl {
	id: string;
	kind: InstanceInputKind;
	note?: string;
}

/** An event the component raises; `payload` fields become the event pin's data-outs. */
export interface InstanceEventDecl {
	id: string;
	payload?: ParamDecl[];
	note?: string;
}

/** A value the component reports: a state-machine layer's current state (`<layer>.state`). */
export interface InstanceValueDecl {
	/** `<layer>.state`. */
	id: string;
	layer: string;
	/** The state ids it can read as. */
	states: string[];
}

export interface InstanceInterface {
	inputs: InstanceInputDecl[];
	events: InstanceEventDecl[];
	values: InstanceValueDecl[];
}

/**
 * One placed, NAMED component instance as Flow sees it, keyed in `PinContext.instances` by the
 * placed node's id. Derived from the LayoutDoc and the component defs, never stored.
 */
export interface FlowInstanceDecl extends InstanceRef {
	/** The author's name for the placement (the node's label) — the palette caption. */
	name: string;
	componentId: string;
	/** The pinned `ComponentDef.version`; absent ⇒ latest. */
	version?: number;
	interface: InstanceInterface;
	/** Set when the def (or the exact pinned version) could not be resolved: the pins are then
	 *  derived from nothing and the validator reports `instance-missing`. */
	missing?: 'def' | 'version';
	/** The interface is the LATEST version's, standing in for the pinned one's: the projection was
	 *  taken without the pinned snapshots (a flow naming no instance loads none). The editor shows
	 *  no version warning, marks no wire or pin stale, and re-reads the exact pins once a node names
	 *  the placement. */
	unpinned?: true;
}

/** One component a spawn layer may spawn, as Flow sees it. */
export interface FlowSpawnableDecl {
	componentId: string;
	interface: InstanceInterface;
	/** The def could not be resolved: its pins are derived from nothing. */
	missing?: 'def';
}

/**
 * One `spawnLayer` node placed on a screen, as Flow sees it (§3.3), keyed in
 * `PinContext.spawnLayers` by the node's id. Derived from the LayoutDoc, never stored.
 */
export interface FlowSpawnLayerDecl {
	/** The container whose scene holds the layer. */
	container: ContainerId;
	/** The `spawnLayer` node id. */
	layer: string;
	/** The author's name for it (the node's label), else its id. */
	name: string;
	placement: 'free' | 'grid';
	grid?: { cols: number; rows: number; pitch: number };
	cap: number;
	spawnable: FlowSpawnableDecl[];
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
	/** Optional human help for this data field — what value it carries. Surfaced as the pin's
	 *  editor tooltip (via the derived `Pin.doc`). */
	description?: string;
	/**
	 * This param may be left UNFED — the implementing effect supplies its own default when the
	 * payload field is absent. Absent ⇒ required ⇒ the validator reports `unfilled-data-in` on a
	 * pin with no edge and no stored source.
	 *
	 * Declare it wherever the effect documents an "unset ⇒ …" default, or authoring the node
	 * reports an error for doing exactly what the docs invite (`cameraEffect.durationMs`,
	 * `enableSequentialReelStop.gaps`). It says nothing about the runtime — the effect's own
	 * fallback is what makes it true; this only stops the validator claiming otherwise.
	 */
	optional?: boolean;
}

/**
 * The MECHANIC family a vocab event belongs to — the grouping the vocab already documents
 * informally (§6.2). `'book'` = an RGS `BookEvent` (`reveal`, `winInfo`, `freeSpinTrigger`, …);
 * `'lifecycle'` = a boot/loading/settle SIGNAL (`load`, `tapToStart`, `idle`); `'intent'` = a
 * button-press the player initiates (`spin`, `increase`, …). The `gameSignals` node surfaces
 * `'book'` + `'lifecycle'` events (the template's own signals); intents surface instead as
 * container button pins (§6.1). OPTIONAL, defaulting to `'book'` (an untagged event is treated as
 * a book event → surfaced by `gameSignals`); a real template SHOULD tag all three families.
 */
export type EventCategory = 'book' | 'lifecycle' | 'intent';

export interface EventDecl {
	name: string; // 'reveal'.
	payload: ParamDecl[]; // reveal → { reels: list<Reel> }.
	category?: EventCategory; // the mechanic family; absent ⇒ 'book' (surfaced by `gameSignals`).
	/** Optional human help for this signal — what it is, when it fires, how to wire it. Surfaced
	 *  as the `gameSignals` exec-out pin's editor tooltip (via the derived `Pin.doc`). */
	description?: string;
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

/**
 * A SCALAR the template exposes for a `$engine.<name>` read — the branch/guard sibling of
 * {@link CollectionDecl} (which are the iterables a `forEach` walks).
 *
 * The engine reader has always answered these keys (`balance`, `gameType`, `isFreeGame`, …) but
 * nothing DECLARED them, so both authoring surfaces refused one: the inspector's `$engine` picker
 * listed only collections, and the validator errored `accessor-unresolved` on anything that wasn't
 * one. The effect was that a `branch` could not test game state at all. Declaring them here is what
 * makes a guard authorable — and, because each carries its `type`, connect-time-checkable.
 */
export interface ValueDecl {
	name: string; // 'balance', 'isAutoSpinning'.
	type: TypeRef;
	description?: string;
}

export interface TemplateVocabulary {
	templateId: string;
	structs: StructDecl[];
	enums: EnumDecl[];
	events: EventDecl[];
	actions: ActionDecl[];
	cues: CueDecl[];
	collections: CollectionDecl[]; // engine-readable iterables (also $engine reads, §9.5).
	values: ValueDecl[]; // engine-readable SCALARS — the other half of $engine (§9.5).
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

/** A game variable's type. An `enum` variable holds one of its `values` (a string). */
export type FlowVariableType = 'int' | 'float' | 'bool' | 'string' | 'enum';

/**
 * When a variable goes back to its `initial`: never (`game`), when a round starts (`round`), or
 * when its mode is entered (`mode` — declared in `FlowDoc.modes[id].variables` only).
 */
export type FlowVariableScope = 'game' | 'round' | 'mode';

/** A named, typed value Flow keeps (game-families §3.1): score, lives, moves left, level. */
export interface FlowVariable {
	id: string;
	type: FlowVariableType;
	/** The `enum` type's members. */
	values?: string[];
	initial: number | boolean | string;
	scope: FlowVariableScope;
	/**
	 * The online room's value this variable mirrors (`SERVER_VARIABLE_SOURCES`;
	 * `docs/design/realtime-multiplayer.md` §4): the room writes it and Flow only reads it — the
	 * validator refuses a Set or Change of it (`variable-server-owned`). Absent ⇒ Flow's own.
	 */
	server?: string;
}

/** One action of the key map (game-families §3.2): Flow reads `action`, never a raw key. */
export interface FlowInputBinding {
	action: string;
	/** `KeyboardEvent.key` values (`ArrowLeft`, `a`, ` `). */
	keys: string[];
}

export interface FlowDoc {
	version: 2;
	templateId: string; // which TemplateVocabulary this flow targets.
	graph: Graph; // the event graph.
	containers: ContainerRef[]; // the containers this flow shows/hides, each with a z-order.
	/** Editor-only labelled group boxes (see {@link FlowComment}). Ignored by runtime + validation. */
	comments?: FlowComment[];
	/**
	 * Per-GAME-MODE graphs (`docs/design/hold-and-win.md` §4.5), keyed by mode id (`freeSpins`,
	 * `holdAndWin`, …). A signal goes to the ACTIVE mode's graph first and falls back to `graph` (the
	 * global one) when that mode's graph has no handler for it, so `reveal` can mean something else on
	 * the respin board without a branch on the game type. Absent (every doc authored before modes) ⇒
	 * `graph` handles everything, exactly as before.
	 */
	modes?: Record<string, FlowModeScope>;
	/** The `game` and `round` variables (game-families §3.1). Absent ⇒ none. */
	variables?: FlowVariable[];
	/** The key map `onInput` nodes read (§3.2). Absent ⇒ none. */
	inputs?: FlowInputBinding[];
}

/** One game mode's section of a {@link FlowDoc}. */
export interface FlowModeScope {
	graph: Graph;
	/** The mode's own variables (`scope: 'mode'`), reset each time the mode is entered. */
	variables?: FlowVariable[];
}
