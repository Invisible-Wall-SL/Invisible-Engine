/**
 * Invisible Flow — the presentation HSM (design doc §6, §8, §12).
 *
 * Holds the ACTIVE SET of the macro graph and decides transitions. It is the
 * "presentation state machine" that rides ON TOP of the XState platform FSM — it
 * OBSERVES platform state (idle↔play) and book events and reacts; it NEVER drives a
 * platform transition (§12 "observe, don't model" — no double-driving). It is pure +
 * framework-free: it imports no Svelte-rune modules and no emitter; everything it needs
 * (the running choreography, an `$engine.*` reader) is injected, so it runs identically
 * headlessly and in a real game boot.
 *
 * ACTIVE SET, not a single active screen (the pin-driven active-SET model). A screen's
 * content renders while its node is active. The interpreter tracks an ORDERED set of
 * concurrently-active screens (base first, later-activated on top), so a base-game screen
 * PERSISTS while an overlay screen layers over it. Activation is pin-driven:
 *   - a screen becomes active on its Enter/activate pin (added to the set, on top);
 *   - a screen turns ITSELF OFF when it fires its Complete/exit pin (removed from the set);
 *   - an edge from a screen's Complete pin activates the target's Enter.
 * The base game never fires Complete (no `complete`-triggered outgoing edge), so it stays
 * active under everything; an overlay activated over it removes itself on Complete, leaving
 * the base intact. This falls out of the graph — NO per-game magic ids.
 *
 * Transitions fire on the three triggers (§6):
 *   1. `bookEvent`  — a book event of a named `type` arrives (`onBookEvent`).
 *   2. `complete`   — a screen's exit choreography finished (`onComplete`).
 *   3. `condition`  — an engine condition became true; re-evaluated on `evaluate()`
 *                     (the game pings this when an observed value changes).
 *
 * How a trigger affects the active set:
 *   - a `complete` edge DEACTIVATES its source (that screen fired its own Complete pin) and
 *     ACTIVATES its target (the target's Enter) — the loading→basegame / overlay→base return;
 *   - a `bookEvent` / `signal` / `condition` edge ACTIVATES its target LAYERED ON TOP and
 *     LEAVES the source active — the base-game persists under a celebration overlay.
 * Either way the target's `enter` choreography runs; a `complete` edge additionally runs the
 * source's `exit` choreography before removing it.
 *
 * Each edge carries an optional bounded `guard` and an optional `delayMs` (scaled by the
 * live `timeScale()` like a choreography Delay). For a given trigger, EVERY active screen's
 * outgoing edges are considered (so an overlay can complete while the base ignores the same
 * trigger); among an active screen's own outgoing edges, the first in author `order` whose
 * trigger matches AND whose guard holds wins. An edge with no guard is the author-order
 * default (§6).
 *
 * The `complete` trigger is the ONE exception to first-match-wins: it FANS OUT. When a screen
 * fires its own Complete pin it hands off to EVERY one of its outgoing `complete`-edge targets
 * whose guard holds — the source is deactivated ONCE and each guard-holding target is activated
 * (`loading --complete--> basegame` + `loading --complete--> HUD` light up BOTH on the tap).
 * Mutually-exclusive guards still yield exactly one target (guarded branching is preserved);
 * multiple UNGUARDED complete edges from one screen now all fire. The completing SOURCE is the
 * first active screen (scanned top-of-stack first) that owns a guard-holding complete edge; only
 * its complete edges fan out. Every OTHER trigger (`bookEvent`/`signal`/`condition`) keeps strict
 * first-match-wins layer semantics — never fanned out.
 *
 * A transition in flight is serialized — a trigger arriving mid-swap is ignored at the HSM
 * level (the platform FSM still owns round gating), matching the coded handler map's serial
 * `sequence()` (§8).
 */

import type { ChoreographyNode, FlowDoc, FlowGuard, FlowScreen, FlowTransition } from './types';
import type { FlowRuntime } from './runtime';
import { runChoreography } from './executor';
import { evaluateGuard, type FlowScope } from './accessor';

/** The injected surface the HSM reads — never imports the rune modules (§8). */
export type PresentationHost = {
	runtime: FlowRuntime;
	/** Read a registered engine value feed by `ENGINE_PARAM_CATALOG` key (`$engine.*`),
	 *  for guard evaluation. Absent ⇒ guards over `$engine.*` read `undefined`. */
	engine?: (key: string) => unknown;
	/** Notified whenever the active SET changes (a screen was added/removed). The ids are
	 *  render-ordered (base first, later-activated on top); the last entry is the topmost
	 *  active screen. The game mirrors this into a rune so the mounted scenes re-render. */
	onActiveScreensChange?: (screenIds: readonly string[]) => void;
};

const byOrder = (a: FlowTransition, b: FlowTransition) =>
	(a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);

export const createPresentationMachine = (flowDoc: FlowDoc, host: PresentationHost) => {
	const screensById = new Map<string, FlowScreen>(flowDoc.screens.map((s) => [s.id, s]));
	const initialScreen =
		flowDoc.screens.find((s) => s.initial)?.id ?? flowDoc.screens[0]?.id ?? undefined;

	/** The ORDERED active set — base first, later-activated on top. The initial screen (if any)
	 *  is the base. Never contains duplicates; re-activating an already-active screen is a no-op
	 *  that leaves its position (a `complete` edge returning to the still-active base keeps the
	 *  base underneath its siblings, not above them). */
	const activeScreenIds: string[] = initialScreen !== undefined ? [initialScreen] : [];

	/** Serializes transitions: a trigger arriving mid-swap is ignored (the platform FSM,
	 *  not the HSM, owns round gating — §12). Mirrors the coded serial `sequence()`. */
	let transitioning = false;

	const notify = (): void => host.onActiveScreensChange?.([...activeScreenIds]);

	const guardScope = (trigger: unknown): FlowScope => ({ trigger, engine: host.engine });

	const guardHolds = (guard: FlowGuard | undefined, trigger: unknown): boolean =>
		evaluateGuard(guard, guardScope(trigger));

	/** Outgoing edges of EVERY active screen, in each source's author order. Screens are
	 *  scanned top-of-stack first, so an overlay consumes a shared trigger before the base. */
	const outgoing = (): FlowTransition[] => {
		const edges: FlowTransition[] = [];
		for (let i = activeScreenIds.length - 1; i >= 0; i--) {
			const from = activeScreenIds[i];
			edges.push(...flowDoc.transitions.filter((t) => t.from === from).sort(byOrder));
		}
		return edges;
	};

	const runPhase = async (
		screenId: string | undefined,
		phase: 'enter' | 'exit',
		trigger: unknown,
	): Promise<void> => {
		const screen = screenId !== undefined ? screensById.get(screenId) : undefined;
		const node: ChoreographyNode | undefined = screen?.choreography?.[phase];
		if (node) await runChoreography(node, host.runtime, guardScope(trigger));
	};

	/** Add a screen to the active set (on top). Idempotent: re-activating an ALREADY-active
	 *  screen is a no-op that LEAVES its position — so a `complete` edge returning to the base
	 *  (already active underneath a sibling overlay) keeps the base underneath, not above it. */
	const activate = (screenId: string): void => {
		if (!screensById.has(screenId)) return;
		if (activeScreenIds.includes(screenId)) return;
		activeScreenIds.push(screenId);
	};

	/** Remove a screen from the active set (it fired its own Complete pin). */
	const deactivate = (screenId: string): void => {
		const existing = activeScreenIds.indexOf(screenId);
		if (existing !== -1) activeScreenIds.splice(existing, 1);
	};

	/**
	 * Whether firing `edge` would actually CHANGE the active set. A layer edge (any non-`complete`
	 * trigger) whose target is already active is a NO-OP: the source persists and `activate` would
	 * no-op, so there is no state change to make. Firing it anyway would re-run the target's `enter`
	 * choreography and `notify()` on EVERY matching trigger — and the game pings `evaluate()` on
	 * every observed engine-value change, so a live layered overlay would replay its entrance
	 * animation repeatedly. A `complete` edge always changes state (it deactivates its source), even
	 * when the target is already active (a legitimately re-entrant handoff), so it is never skipped.
	 */
	const changesActiveSet = (edge: FlowTransition): boolean =>
		edge.trigger.kind === 'complete' || !activeScreenIds.includes(edge.to);

	const performTransition = async (edge: FlowTransition, trigger: unknown): Promise<void> => {
		transitioning = true;
		try {
			if (edge.delayMs && edge.delayMs > 0) {
				await host.runtime.waitForTimeout(edge.delayMs / host.runtime.timeScale());
			}
			// A `complete` edge means the SOURCE fired its own Complete pin: run its `exit` and
			// remove it. Any other trigger LAYERS the target over the (persisting) source.
			if (edge.trigger.kind === 'complete') {
				await runPhase(edge.from, 'exit', trigger);
				deactivate(edge.from);
			}
			if (screensById.has(edge.to)) activate(edge.to);
			// The set changed (a `complete` removed the source and/or `activate` added the target) —
			// notify once, then run the target's enter. `changesActiveSet` gated the call, so this
			// never fires for a no-op layer re-trigger.
			notify();
			await runPhase(edge.to, 'enter', trigger);
		} finally {
			transitioning = false;
		}
	};

	/**
	 * The `complete` FAN-OUT (§6.2). A screen firing its Complete pin hands off to EVERY one of its
	 * guard-holding outgoing `complete` edges: the source's `exit` runs once, the source is removed
	 * once, and each target is activated — a single `loading` Complete lighting up BOTH `basegame`
	 * and `HUD`. `edges` are the completing source's guard-holding complete edges in author order;
	 * the set change is notified ONCE (after every activation) so the game re-mounts the full new set
	 * in one pass, then each newly-activated target's `enter` runs in order.
	 */
	const performCompleteFanOut = async (
		edges: FlowTransition[],
		trigger: unknown,
	): Promise<void> => {
		transitioning = true;
		try {
			const maxDelay = Math.max(0, ...edges.map((e) => e.delayMs ?? 0));
			if (maxDelay > 0) await host.runtime.waitForTimeout(maxDelay / host.runtime.timeScale());
			// All edges share the completing source; run its exit + remove it ONCE.
			const source = edges[0].from;
			await runPhase(source, 'exit', trigger);
			deactivate(source);
			// Each DISTINCT target activates (idempotent — a `complete` handoff back to an
			// already-active base keeps it underneath) and re-runs its `enter`, matching the
			// single-edge `performTransition` (a `complete` is a legitimately re-entrant handoff,
			// §changesActiveSet). De-duped so two edges to the same target don't double-enter.
			const targets: string[] = [];
			for (const e of edges) {
				if (screensById.has(e.to) && !targets.includes(e.to)) targets.push(e.to);
			}
			for (const to of targets) activate(to);
			notify();
			for (const to of targets) await runPhase(to, 'enter', trigger);
		} finally {
			transitioning = false;
		}
	};

	/** Find + fire the first matching outgoing edge for a trigger kind. Returns true when an
	 *  edge fired (so the caller knows the trigger was consumed by the macro graph). A matching
	 *  edge whose firing would NOT change the active set (a layer edge onto an already-active
	 *  target) is skipped — no re-`enter`, no `notify()`, but still "consumed" (returns true) so
	 *  the trigger isn't treated as unhandled. */
	const fire = async (
		match: (t: FlowTransition) => boolean,
		trigger: unknown,
	): Promise<boolean> => {
		if (transitioning) return false;
		const edge = outgoing().find((t) => match(t) && guardHolds(t.guard, trigger));
		if (!edge) return false;
		if (!changesActiveSet(edge)) return true;
		await performTransition(edge, trigger);
		return true;
	};

	/**
	 * Fire the `complete` trigger with FAN-OUT (§6.2). The completing SOURCE is the first active
	 * screen (top-of-stack first) that owns a guard-holding outgoing `complete` edge — its OWN
	 * guard-holding complete edges (in author order) all hand off. Mutually-exclusive guards still
	 * fire exactly one; multiple unguarded edges from that source all fire. Returns true when a
	 * complete edge was consumed. This is the only fan-out path — every other trigger routes through
	 * `fire` (strict first-match-wins layer semantics), unchanged.
	 */
	const fireComplete = async (trigger: unknown): Promise<boolean> => {
		if (transitioning) return false;
		// Scan active screens top-of-stack first; the first with a guard-holding complete edge is
		// the completing source. `outgoing()` already yields each source's edges in author order.
		for (let i = activeScreenIds.length - 1; i >= 0; i--) {
			const source = activeScreenIds[i];
			const edges = flowDoc.transitions
				.filter(
					(t) => t.from === source && t.trigger.kind === 'complete' && guardHolds(t.guard, trigger),
				)
				.sort(byOrder);
			if (edges.length === 0) continue;
			await performCompleteFanOut(edges, trigger);
			return true;
		}
		return false;
	};

	return {
		/** The topmost active screen id (the last-activated screen). `undefined` when the active
		 *  set is empty. Kept for callers that want a single "current" screen; the full ordered
		 *  set is `activeScreenIds`. */
		get activeScreenId() {
			return activeScreenIds[activeScreenIds.length - 1];
		},
		/** The ORDERED active set — base first, later-activated on top. A defensive copy so a
		 *  caller can't mutate the machine's internal list. */
		get activeScreenIds(): readonly string[] {
			return [...activeScreenIds];
		},
		/** Whether a screen id is currently active (in the set). */
		isActive: (screenId: string): boolean => activeScreenIds.includes(screenId),
		/** True while a screen swap is in flight (a trigger is ignored, §8 serial gate). */
		get isTransitioning() {
			return transitioning;
		},
		/** A book event arrived — fire a `bookEvent` edge whose `event` matches its `type`.
		 *  Returns true when the macro graph consumed it (took a transition). The dispatcher
		 *  still runs the event's own choreography/coded handler regardless (§6.1 is a
		 *  TRANSITION trigger, orthogonal to the per-event presentation). */
		onBookEvent: (bookEvent: { type: string }): Promise<boolean> =>
			fire((t) => t.trigger.kind === 'bookEvent' && t.trigger.event === bookEvent.type, bookEvent),
		/** A screen's exit/`complete` pin fired (its choreography signalled done) — hand off from
		 *  the completing screen to EVERY guard-holding outgoing `complete` edge (the fan-out, §6.2):
		 *  the source deactivates once and all matching targets activate. Guarded branching still
		 *  yields exactly one; multiple unguarded edges fan out. */
		onComplete: (): Promise<boolean> => fireComplete(undefined),
		/** A named runtime signal was emitted (the tap-to-continue path, §6.2) — fire the first
		 *  outgoing edge whose trigger is `{kind:'signal', signal:<name>}`, mirroring the
		 *  `bookEvent` match. A signal with no matching edge is a no-op. */
		onSignal: (signal: string): Promise<boolean> =>
			fire((t) => t.trigger.kind === 'signal' && t.trigger.signal === signal, undefined),
		/** Re-evaluate `condition` edges (the game pings this when an observed engine value
		 *  changes). Fires the first whose guard now holds (§6.3). */
		evaluate: (): Promise<boolean> => fire((t) => t.trigger.kind === 'condition', undefined),
		/** Run the initial screen's `enter` choreography at boot (the flow's entry beat). It does
		 *  NOT emit an initial `onActiveScreensChange` — the host seeds its own `activeScreenIds`
		 *  from `flow.activeScreenIds` directly at boot (as `Game.svelte` does); the callback fires
		 *  only on subsequent set changes. */
		start: (): Promise<void> =>
			runPhase(activeScreenIds[activeScreenIds.length - 1], 'enter', undefined),
	};
};

export type PresentationMachine = ReturnType<typeof createPresentationMachine>;
