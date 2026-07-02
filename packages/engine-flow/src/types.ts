/**
 * Invisible Flow — FlowDoc type model (Phase 1: the full authored model).
 *
 * A FlowDoc is the declarative authored presentation graph (design doc §7). It is the
 * "one doc" (design doc §12): a single transition graph (screen-id nodes + edges)
 * plus, per screen, its enter/while/exit choreography sub-graph. It is sibling to
 * `scenes.json`, references LayoutDoc screens by id, and contains NO code — a Broadcast
 * names an emitter event + a payload built from whitelisted accessors (`$trigger.*` /
 * `$item.*`); a transition names a trigger + an optional guard from a small comparison
 * set. The engine owns HOW (mounting, the emitter, the components, the real animations).
 * This is the `declare ≠ implement` contract (design doc §7, §11.4).
 *
 * Sparse + override-friendly (design doc §7 parity rule): a screen with no authored
 * choreography, or an absent FlowDoc entirely, falls through to today's coded mounting +
 * coded `bookEventHandlerMap`, so an un-baked or partially-authored game renders
 * byte-identical to current `main`. Nothing here forces a field that would break that.
 *
 * Phase-0 carried only the `events[]` choreography-binding + screen/transition stubs.
 * Phase 1 promotes the macro graph (typed transition triggers + guards + delays) and
 * the structural-pin model, while keeping the Phase-0 choreography executor types
 * (`ChoreographyNode`, `EventChoreography`, `FlowAccessor`) unchanged so the parity
 * spike and `executor.ts` / `dispatch.ts` keep compiling.
 */

// ---------------------------------------------------------------------------
// Whitelisted value accessors — the bounded "no scripting VM" rule (§11.4).
// ---------------------------------------------------------------------------

/** A whitelisted value accessor (design doc §11.4). Phase 1 adds `engine` (a read off a
 *  registered `ENGINE_PARAM_CATALOG` value feed, e.g. `$engine.win`) to the Phase-0
 *  literal / trigger-payload / forEach-item reads. No arbitrary expressions. */
export type FlowAccessor =
	| { kind: 'literal'; value: FlowValue }
	/** Read a path off the triggering book event payload, e.g. `$trigger.wins`. */
	| { kind: 'trigger'; path: string }
	/** Read a path off the current `forEach` item, e.g. `$item.positions`. */
	| { kind: 'item'; path: string }
	/** Read a path off the per-event dispatch context (`{ bookEvents }`), e.g.
	 *  `$context.bookEvents` — the sibling of the coded handler's second argument. */
	| { kind: 'context'; path: string }
	/** Read a registered engine value feed by `ENGINE_PARAM_CATALOG` key, e.g. `$engine.win`.
	 *  Resolved against the interpreter's bound engine values — never arbitrary code. */
	| { kind: 'engine'; key: string };

export type FlowValue =
	| string
	| number
	| boolean
	| null
	| FlowValue[]
	| { [key: string]: FlowValue };

/** A broadcast payload: a map of literal/accessor fields merged onto `{ type }`. */
export type FlowPayload = Record<string, FlowAccessor>;

// ---------------------------------------------------------------------------
// Guards — a small, closed comparison set (NOT an expression language, §11.4).
// ---------------------------------------------------------------------------

/** The comparison operators a transition/Branch guard may use (design doc §6, §11.4).
 *  A closed set — resist growing this into an expression language. */
export type FlowComparator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';

/** A single bounded predicate: `left <op> right`, both sides whitelisted accessors.
 *  `in` tests membership of `left` in the array `right`. Multiple predicates on a
 *  guard are AND-ed (`all`). */
export interface FlowPredicate {
	left: FlowAccessor;
	op: FlowComparator;
	right: FlowAccessor;
}

/** A transition / Branch guard — an AND of bounded predicates. Absent guard ⇒ the edge
 *  is unconditional (the author-order default, design doc §6). */
export interface FlowGuard {
	all: FlowPredicate[];
}

// ---------------------------------------------------------------------------
// Micro tier — choreography (the per-screen enter/while/exit timeline, §5/§8).
// ---------------------------------------------------------------------------

/** Choreography node — a closed set the executor tree-walks (design doc §8). */
export type ChoreographyNode =
	/** Run children in order, awaiting each — mirrors `sequence()` / a serial `await` chain. */
	| { kind: 'sequence'; children: ChoreographyNode[] }
	/** Run children concurrently, await all — mirrors `Promise.all`. */
	| { kind: 'parallel'; children: ChoreographyNode[] }
	/**
	 * Emit one emitter event. `await: true` ⇒ `broadcastAsync` and the executor awaits
	 * the returned `Promise.all` of subscriber results (a `broadcastAsync` the coded
	 * handler `await`s). `await: false` ⇒ either `broadcast` (sync, fire-and-return) or a
	 * fire-and-forget `broadcastAsync` whose promise is NOT awaited — distinguished by
	 * `async`. This three-way split is the crux of timing parity (design doc §11.1).
	 */
	| { kind: 'broadcast'; event: string; payload?: FlowPayload; async?: boolean; await?: boolean }
	/** Await `ms` milliseconds, divided by the live `timeScale()` (turbo) — the engine's
	 *  `waitForTimeout(ms / timeScale())` call sites (design doc §8). */
	| { kind: 'delay'; ms: number }
	/** Iterate a list accessor; run `body` once per item with `$item` bound — mirrors
	 *  `sequence(list, ...)` (serial) or a `Promise.all(list.map(...))` (parallel). */
	| { kind: 'forEach'; list: FlowAccessor; mode: 'sequence' | 'parallel'; body: ChoreographyNode }
	/** Run `then` when `guard` holds, else `otherwise` (if present) — the Branch node
	 *  (design doc §5). Guard is the same bounded predicate set as a transition. */
	| { kind: 'branch'; guard: FlowGuard; then: ChoreographyNode; otherwise?: ChoreographyNode }
	/**
	 * Invoke a NAMED, game-registered side effect — the `declare ≠ implement` bridge for the
	 * non-emitter work a coded handler does (state mutations like `stateGame.gameType = …`,
	 * board operations like `enhancedBoard.spin(…)`, the win-level sound clusters). The
	 * FlowDoc *declares* an effect `name` + a whitelisted-accessor `payload`; the game
	 * *implements* it at boot in a CLOSED registry injected on the runtime (`FlowRuntime.effect`),
	 * exactly like `registerComponentActions`/`registerComponentValues` (design doc §3). This is
	 * NOT a scripting VM (§11.4) — a closed set of named effects whose bodies live in game code,
	 * never authored here. Awaited like a Broadcast; an unknown name is a no-op (parity-safe).
	 * Phase 5 — needed for full migration of handlers that touch state/board, not just the emitter.
	 */
	| { kind: 'effect'; name: string; payload?: FlowPayload };

/** A screen's choreography — the three timeline phases (design doc §5):
 *  `enter` runs on becoming active, `while` reacts to events during the active state,
 *  `exit` runs on leaving (its completion fires the screen's `complete` pin). */
export interface ScreenChoreography {
	enter?: ChoreographyNode;
	while?: ChoreographyNode;
	exit?: ChoreographyNode;
}

/**
 * A per-event choreography binding (design doc §7). A FlowDoc may bind a choreography
 * directly to a book-event type, which is exactly what replaces one entry of the coded
 * `bookEventHandlerMap`. Absent event ⇒ fall through to the coded handler.
 */
export interface EventChoreography {
	/** The book-event `type` this choreography handles (e.g. `'winInfo'`). */
	event: string;
	choreography: ChoreographyNode;
}

// ---------------------------------------------------------------------------
// Pins — the dynamic-pin vocabulary projected from the four engine registries (§3/§4).
// ---------------------------------------------------------------------------

/**
 * A pin's role — the four dynamic registries plus the fixed structural pins (§4).
 * These are the ONLY pin classes; they are a projection of the existing engine-layout
 * registries, NOT a new vocabulary (design doc §3).
 *
 * Dynamic (derived from the screen's components):
 *  - `value`  ← `registerComponentValues` / `ENGINE_PARAM_CATALOG`  (input)
 *  - `signal` ← `registerComponentSignals` (a spine cue's `signal`)  (input)
 *  - `action` ← `registerComponentActions` (a button's `action`)     (output)
 *  - `gate`   ← `registerComponentVisibility` (`visibleSource`)       (input)
 * Fixed structural (every screen node, contents-independent — drive the macro flow):
 *  - `enter` (input), `complete`/`exited` (output), `active` (state).
 */
export type FlowPinRole = 'value' | 'signal' | 'action' | 'gate' | 'enter' | 'complete' | 'active';

export type FlowPinDirection = 'in' | 'out' | 'state';

/**
 * A derived pin on a screen node (design doc §4). `id` is the STABLE composite
 * `${instanceId}::${role}:${key}` (design doc §12) for a dynamic pin, or
 * `${screenId}::${role}` for a structural pin — never label/position-keyed, so a wire
 * survives renames/reorders. `instanceId` is the LayoutDoc component-instance id the
 * dynamic pin derives from (absent for structural pins). `orphaned` marks a pin whose
 * backing component was deleted — a validation warning, never a silent drop (§4).
 */
export interface FlowPin {
	id: string;
	role: FlowPinRole;
	direction: FlowPinDirection;
	/** The registry key the dynamic pin binds (the `source` / `action` / `visibleSource` /
	 *  spine-cue `signal` value). Absent for structural pins. */
	key?: string;
	/** The LayoutDoc component-instance id this pin derives from. Absent for structural pins. */
	instanceId?: string;
	/** Human label for the canvas handle (component label / catalog label). */
	label: string;
	/** True when the backing component/binding no longer exists (validation warning, §4). */
	orphaned?: boolean;
}

// ---------------------------------------------------------------------------
// Macro tier — the transition graph (screen nodes + edges, §5/§6/§7).
// ---------------------------------------------------------------------------

/** A screen node in the macro graph — references a LayoutDoc screen by id (design doc §7).
 *  Pins are NOT stored here: they are DERIVED from the LayoutDoc screen at load time
 *  (design doc §4), so a wire is validated against the live screen, not a stale copy.
 *  `position` is the canvas layout (authoring only; ignored at runtime). `choreography`
 *  is the screen's micro sub-graph. */
export interface FlowScreen {
	/** The LayoutDoc `Scene.id` this node represents. */
	id: string;
	/** Optional display label (falls back to the LayoutDoc scene name). */
	label?: string;
	/** Canvas position for the editor (authoring only — runtime ignores it). */
	position?: { x: number; y: number };
	/** The screen's enter/while/exit choreography sub-graph (design doc §5). */
	choreography?: ScreenChoreography;
	/** True for the initial active screen at boot (the flow's entry node). */
	initial?: boolean;
}

/**
 * An ENTRANCE transition — the visual treatment applied when an edge ACTIVATES its target
 * screen (design doc §6, the droppable "Transition" node). Edge-backed authoring data, NOT a
 * runtime graph node: screens stay the only real nodes; the interpreter reads `edge.transition`
 * and SURFACES it to the host per activation, and the HOST owns the actual tween (a mount-hidden
 * alpha 0 → 1 over `ms`, scaled by `timeScale()` like `delayMs`, with the chosen easing). An edge
 * with NO `transition` is a hard cut — byte-identical parity with today's instant mount (§7).
 *
 * `kind: 'fade'` is the only kind for now (a mount-hidden alpha fade-in). Kept a bounded, closed
 * shape (NOT an animation scripting language, §11.4): a duration + an easing from a small set.
 */
export interface FlowTransitionEffect {
	/** The entrance treatment. `fade` = mount the target hidden (alpha 0) and tween alpha→1. */
	kind: 'fade';
	/** Fade duration in ms, scaled at runtime by the live `timeScale()` (turbo) like `delayMs`. */
	ms: number;
	/** The easing curve. `linear` (constant), `easeOut` (decelerate in), `easeInOut` (both).
	 *  Absent ⇒ `linear`. The host maps these to its tween easing (design doc §6). */
	easing?: 'linear' | 'easeOut' | 'easeInOut';
}

/** What fires a transition edge (design doc §6). The first three are the original
 *  triggers; `signal` is the tap-to-continue addition — a named runtime signal a
 *  tap-enabled component emits via the interpreter (`emitSignal(name)`), so a user CLICK
 *  can drive the macro flow without inventing a scripting hook (design doc §6.2). */
export type FlowTrigger =
	/** A book event of this `type` arrives (e.g. `freeSpinTrigger`). */
	| { kind: 'bookEvent'; event: string }
	/** The source screen's `complete`/`exited` structural pin fired (its exit choreography
	 *  finished) — the genuinely-new self-driving output (design doc §6.2). */
	| { kind: 'complete' }
	/** An engine condition became true — the guard alone fires the edge (design doc §6.3). */
	| { kind: 'condition' }
	/** A named runtime signal was emitted (`emitSignal(signal)` on the interpreter — the
	 *  tap-to-continue path). Fires every active-screen edge whose `signal` matches, mirroring
	 *  how a `bookEvent` trigger matches the arriving event `type` (design doc §6.2). */
	| { kind: 'signal'; signal: string };

/**
 * A transition edge `from → to` (design doc §6). Fires on its `trigger`, gated by an
 * optional `guard` (a bounded predicate set), after an optional `delay` (ms, scaled by
 * `timeScale()` like a choreography Delay). Multiple outgoing edges are evaluated in
 * author `order`; an edge with no guard is the default (design doc §6).
 */
export interface FlowTransition {
	/** Stable edge id (so the editor can address/undo a specific edge). */
	id: string;
	/** Source screen id (a `FlowScreen.id`). */
	from: string;
	/** Target screen id (a `FlowScreen.id`). */
	to: string;
	trigger: FlowTrigger;
	/** Optional condition — the edge fires only when this holds (design doc §6). */
	guard?: FlowGuard;
	/** Optional delay before the swap, in ms, scaled by `timeScale()`. */
	delayMs?: number;
	/** Author evaluation order among the `from` screen's outgoing edges (ascending). */
	order?: number;
	/**
	 * Optional ENTRANCE transition for the TARGET screen this edge activates (the droppable
	 * "Transition" node, design doc §6). Present ⇒ the host mounts `to` hidden (alpha 0) and
	 * tweens it in over `transition.ms` (scaled by `timeScale()`) with `transition.easing`.
	 * Absent ⇒ a HARD CUT — byte-identical to today's instant mount (parity §7). The interpreter
	 * only SURFACES this per activation (`onActiveScreensChange` `entrances` + `entranceTransition`);
	 * the host owns the tween. A re-activation (target already active) or a transition-less edge
	 * surfaces `undefined`, so no fade replays on a repeat trigger.
	 */
	transition?: FlowTransitionEffect;
}

/** The authored presentation document, sibling to `scenes.json` (design doc §7, §12). */
export interface FlowDoc {
	version: 1;
	/** The project this flow belongs to — mirrors `LayoutDoc.projectKey` for validation. */
	projectKey?: string;
	/** The macro graph's screen nodes (each references a LayoutDoc scene by id). */
	screens: FlowScreen[];
	/** The macro graph's transition edges. */
	transitions: FlowTransition[];
	/**
	 * Per-book-event choreographies that override the coded `bookEventHandlerMap` entry
	 * for that event (design doc §7). Absent event ⇒ fall through to the coded handler.
	 * Retained from Phase 0 — the event-parity slice the interpreter already runs.
	 */
	events?: EventChoreography[];
	updatedAt?: string;
}
