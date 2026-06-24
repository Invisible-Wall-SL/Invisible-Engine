/**
 * Invisible Flow — FlowDoc type model (Phase 0 minimal slice).
 *
 * A FlowDoc is the declarative authored presentation graph (design doc §7). This
 * Phase-0 slice carries only what the `winInfo` choreography parity spike needs: the
 * screen → transition stub plus the per-screen enter/while/exit choreography sub-graph
 * built from Sequence / Parallel / Broadcast / Delay / ForEach nodes. The macro
 * transition vocabulary (book-event / `complete` / condition triggers, guards) and the
 * dynamic-pin projection arrive in later phases; they are intentionally NOT modelled
 * here so the spike stays honest about what it proves.
 *
 * Nothing in this model contains code: a Broadcast names an emitter event + a payload
 * built from whitelisted accessors (`$trigger.*` / `$item.*`); the engine owns HOW the
 * broadcast is delivered. This is the `declare ≠ implement` contract (design doc §7).
 */

/** A whitelisted value accessor — the bounded "no scripting VM" rule (design doc §11.4).
 *  Phase 0 needs only literals and trigger-payload / forEach-item reads. */
export type FlowAccessor =
	| { kind: 'literal'; value: FlowValue }
	/** Read a path off the triggering book event payload, e.g. `$trigger.wins`. */
	| { kind: 'trigger'; path: string }
	/** Read a path off the current `forEach` item, e.g. `$item.positions`. */
	| { kind: 'item'; path: string };

export type FlowValue =
	| string
	| number
	| boolean
	| null
	| FlowValue[]
	| { [key: string]: FlowValue };

/** A broadcast payload: a map of literal/accessor fields merged onto `{ type }`. */
export type FlowPayload = Record<string, FlowAccessor>;

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
	| { kind: 'forEach'; list: FlowAccessor; mode: 'sequence' | 'parallel'; body: ChoreographyNode };

/** A screen's choreography — the three timeline phases (design doc §5). Phase 0 exercises
 *  only `enter` for the `winInfo` event; `while`/`exit` are part of the model for later. */
export type ScreenChoreography = {
	enter?: ChoreographyNode;
	while?: ChoreographyNode;
	exit?: ChoreographyNode;
};

/**
 * A per-event choreography binding. In the full model a screen's choreography is keyed by
 * screen + transition; for the Phase-0 event-parity slice a FlowDoc may also bind a
 * choreography directly to a book-event type, which is exactly what replaces one entry of
 * the coded `bookEventHandlerMap`.
 */
export type EventChoreography = {
	/** The book-event `type` this choreography handles (e.g. `'winInfo'`). */
	event: string;
	choreography: ChoreographyNode;
};

/** A screen node in the macro graph (stub — only `id` + structural choreography here). */
export type FlowScreen = {
	id: string;
	choreography?: ScreenChoreography;
};

/** A transition edge (stub — the trigger/guard vocabulary lands in Phase 2/4). */
export type FlowTransition = {
	from: string;
	to: string;
	/** The book-event type that fires this edge, when trigger is a book event. */
	onEvent?: string;
};

/** The authored presentation document, sibling to `scenes.json` (design doc §7). */
export type FlowDoc = {
	version: 1;
	screens: FlowScreen[];
	transitions: FlowTransition[];
	/** Per-book-event choreographies that override the coded `bookEventHandlerMap` entry
	 *  for that event. Absent event ⇒ fall through to the coded handler (design doc §7). */
	events?: EventChoreography[];
};
