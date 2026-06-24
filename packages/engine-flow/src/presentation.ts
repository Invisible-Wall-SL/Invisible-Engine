/**
 * Invisible Flow — the presentation HSM (design doc §6, §8, §12).
 *
 * Holds the ACTIVE screen of the macro graph and decides transitions. It is the
 * "presentation state machine" that rides ON TOP of the XState platform FSM — it
 * OBSERVES platform state (idle↔play) and book events and reacts; it NEVER drives a
 * platform transition (§12 "observe, don't model" — no double-driving). It is pure +
 * framework-free: it imports no Svelte-rune modules and no emitter; everything it needs
 * (the running choreography, an `$engine.*` reader) is injected, so it runs identically
 * headlessly and in a real game boot.
 *
 * Transitions fire on the three triggers (§6):
 *   1. `bookEvent`  — a book event of a named `type` arrives (`onBookEvent`).
 *   2. `complete`   — the active screen's exit choreography finished (`onComplete`).
 *   3. `condition`  — an engine condition became true; re-evaluated on `evaluate()`
 *                     (the game pings this when an observed value changes).
 *
 * Each edge carries an optional bounded `guard` and an optional `delayMs` (scaled by the
 * live `timeScale()` like a choreography Delay). Multiple outgoing edges are tried in
 * author `order`; the first whose trigger matches AND whose guard holds wins. An edge
 * with no guard is the author-order default (§6).
 *
 * On a transition the HSM runs the OLD screen's `exit` choreography, swaps the active
 * screen (the mounter reacts to `activeScreenId`), then runs the NEW screen's `enter`
 * choreography. A transition in flight is serialized — a trigger arriving mid-swap is
 * ignored at the HSM level (the platform FSM still owns round gating), matching the
 * coded handler map's serial `sequence()` (§8).
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
	/** Notified whenever the active screen changes (the mounter swaps the mounted scene). */
	onActiveScreenChange?: (screenId: string | undefined) => void;
};

const byOrder = (a: FlowTransition, b: FlowTransition) =>
	(a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);

export const createPresentationMachine = (flowDoc: FlowDoc, host: PresentationHost) => {
	const screensById = new Map<string, FlowScreen>(flowDoc.screens.map((s) => [s.id, s]));
	const initialScreen =
		flowDoc.screens.find((s) => s.initial)?.id ?? flowDoc.screens[0]?.id ?? undefined;

	let activeScreenId: string | undefined = initialScreen;
	/** Serializes transitions: a trigger arriving mid-swap is ignored (the platform FSM,
	 *  not the HSM, owns round gating — §12). Mirrors the coded serial `sequence()`. */
	let transitioning = false;

	const guardScope = (trigger: unknown): FlowScope => ({ trigger, engine: host.engine });

	const guardHolds = (guard: FlowGuard | undefined, trigger: unknown): boolean =>
		evaluateGuard(guard, guardScope(trigger));

	/** Outgoing edges of the active screen, in author order. */
	const outgoing = (): FlowTransition[] =>
		activeScreenId === undefined
			? []
			: flowDoc.transitions.filter((t) => t.from === activeScreenId).sort(byOrder);

	const runPhase = async (
		screenId: string | undefined,
		phase: 'enter' | 'exit',
		trigger: unknown,
	): Promise<void> => {
		const screen = screenId !== undefined ? screensById.get(screenId) : undefined;
		const node: ChoreographyNode | undefined = screen?.choreography?.[phase];
		if (node) await runChoreography(node, host.runtime, guardScope(trigger));
	};

	const performTransition = async (edge: FlowTransition, trigger: unknown): Promise<void> => {
		transitioning = true;
		try {
			const from = activeScreenId;
			if (edge.delayMs && edge.delayMs > 0) {
				await host.runtime.waitForTimeout(edge.delayMs / host.runtime.timeScale());
			}
			await runPhase(from, 'exit', trigger);
			if (screensById.has(edge.to)) {
				activeScreenId = edge.to;
				host.onActiveScreenChange?.(activeScreenId);
			}
			await runPhase(activeScreenId, 'enter', trigger);
		} finally {
			transitioning = false;
		}
	};

	/** Find + fire the first matching outgoing edge for a trigger kind. Returns true when an
	 *  edge fired (so the caller knows the trigger was consumed by the macro graph). */
	const fire = async (
		match: (t: FlowTransition) => boolean,
		trigger: unknown,
	): Promise<boolean> => {
		if (transitioning) return false;
		const edge = outgoing().find((t) => match(t) && guardHolds(t.guard, trigger));
		if (!edge) return false;
		await performTransition(edge, trigger);
		return true;
	};

	return {
		/** The currently active screen id (the mounter renders this one). */
		get activeScreenId() {
			return activeScreenId;
		},
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
		/** The active screen's exit/`complete` pin fired (its choreography signalled done) —
		 *  fire a `complete` edge. This is the genuinely-new self-driving output (§6.2). */
		onComplete: (): Promise<boolean> => fire((t) => t.trigger.kind === 'complete', undefined),
		/** A named runtime signal was emitted (the tap-to-continue path, §6.2) — fire the first
		 *  outgoing edge whose trigger is `{kind:'signal', signal:<name>}`, mirroring the
		 *  `bookEvent` match. A signal with no matching edge is a no-op. */
		onSignal: (signal: string): Promise<boolean> =>
			fire((t) => t.trigger.kind === 'signal' && t.trigger.signal === signal, undefined),
		/** Re-evaluate `condition` edges (the game pings this when an observed engine value
		 *  changes). Fires the first whose guard now holds (§6.3). */
		evaluate: (): Promise<boolean> => fire((t) => t.trigger.kind === 'condition', undefined),
		/** Run the initial screen's `enter` choreography at boot (the flow's entry beat). */
		start: (): Promise<void> => runPhase(activeScreenId, 'enter', undefined),
	};
};

export type PresentationMachine = ReturnType<typeof createPresentationMachine>;
