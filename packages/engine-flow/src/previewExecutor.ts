/**
 * Deterministic choreography preview (design doc §9 Phase-3 / §11.6 live-preview
 * determinism). This is the HEADLESS, reproducible half of "live preview": it runs an
 * authored choreography through the REAL {@link runChoreography} executor against a
 * recording runtime, producing the ordered broadcast + delay timeline with the speed
 * scalar applied — the same shape the Phase-0 parity harness logs.
 *
 * Why this is the honest scope for Phase 3 (§11.6, owner direction): a TRUE visual
 * preview needs the running game + its real emitter + Pixi components mounted — that is
 * the live generic mounter (Phase 4) and is explicitly NOT in scope here. What IS in
 * scope, and what makes delay/speed tuning reproducible, is the deterministic ORDER +
 * TIMING of the emitter calls. Feeding a FIXED book payload (the mock-RGS/test-server
 * feed, never a random outcome) makes the same choreography produce the same timeline
 * every run, so an author can tune a delay and see the millisecond shift immediately.
 *
 * Determinism guarantees:
 *  - the executor is driven with the EXACT same async semantics the runtime uses
 *    (the real {@link runChoreography}, the real three-way broadcast split);
 *  - delays are NOT real-time waited — `waitForTimeout` resolves on a microtask and the
 *    elapsed clock is accumulated from the (already speed-scaled) requested ms, so a
 *    preview of a 30s choreography returns instantly with the exact authored timeline;
 *  - the recorded `at` stamp is the accumulated virtual-clock ms, so two runs of the
 *    same doc at the same speed are byte-identical.
 */

import type { ChoreographyNode } from './types';
import { runChoreography } from './executor';
import type { FlowRuntime } from './runtime';
import type { FlowScope } from './accessor';

/** One entry in the deterministic preview timeline. */
export type PreviewEntry =
	| {
			kind: 'broadcast';
			/** Virtual-clock ms at which the broadcast was issued. */
			at: number;
			event: string;
			/** Resolved payload (accessors evaluated against the fixed feed), `type` excluded. */
			payload?: Record<string, unknown>;
			/** `sync` = `broadcast`; `awaited` / `fire-and-forget` = `broadcastAsync` shape. */
			mode: 'sync' | 'awaited' | 'fire-and-forget';
	  }
	| {
			kind: 'delay';
			/** Virtual-clock ms at which the delay STARTED. */
			at: number;
			/** The authored ms (pre-scale). */
			ms: number;
			/** The effective ms after dividing by the speed scalar (what actually elapsed). */
			scaledMs: number;
	  }
	| {
			kind: 'effect';
			/** Virtual-clock ms at which the effect was invoked. */
			at: number;
			/** The named game-side effect (its body is NOT run in the deterministic preview —
			 *  effects mutate live state/board the preview doesn't model; the timeline shows the
			 *  invocation order so an author can read where each effect fires). */
			name: string;
			/** Resolved payload (accessors evaluated against the fixed feed). */
			payload?: Record<string, unknown>;
	  };

export interface PreviewResult {
	/** The ordered timeline of broadcasts + delays with virtual-clock stamps. */
	timeline: PreviewEntry[];
	/** Total virtual-clock ms the choreography spans (sum of awaited delays on the path). */
	durationMs: number;
	/** The speed scalar applied (1 = normal, 2 = turbo) — echoed for the UI dial. */
	speed: number;
}

/**
 * A small FIXED preview feed (design doc §11.6) — a deterministic stand-in for the
 * mock-RGS / test-server book a real `winInfo`/`freeSpinTrigger` carries. It mirrors the
 * payload SHAPE the coded handlers read (`wins[].positions`, `totalFs`, `winLevel`), so a
 * `$trigger.wins` / `$trigger.totalFs` accessor in an authored choreography resolves to a
 * stable value every run — the reproducibility §11.6 requires. NOT a random outcome; the
 * SAME object every call. (Phase 6 can swap this for the actual mock-RGS book payload; the
 * preview is agnostic to the source, it just reads `$trigger`.)
 */
export const FIXED_PREVIEW_TRIGGER: Record<string, unknown> = {
	wins: [
		{
			symbol: 'H1',
			positions: [
				{ reel: 0, row: 1 },
				{ reel: 1, row: 1 },
				{ reel: 2, row: 1 },
			],
		},
		{
			symbol: 'H2',
			positions: [
				{ reel: 0, row: 0 },
				{ reel: 1, row: 0 },
			],
		},
	],
	amount: 250,
	winLevel: 3,
	totalFs: 10,
	positions: [
		{ reel: 3, row: 2 },
		{ reel: 4, row: 2 },
	],
};

/**
 * A small FIXED dispatch-context feed (design doc §11.6) — a deterministic stand-in for
 * the `{ bookEvents }` dispatch context the coded handler's second argument carries (the
 * surrounding book-event list a reveal's multiple-reveal check reads). It mirrors the
 * mock-RGS book SHAPE, so a `$context.bookEvents` accessor in an authored effect payload
 * resolves to a stable value every run — the reproducibility §11.6 requires. NOT a random
 * outcome; the SAME object every call.
 */
export const FIXED_PREVIEW_CONTEXT: Record<string, unknown> = {
	bookEvents: [
		{ index: 0, type: 'reveal' },
		{ index: 1, type: 'reveal' },
	],
};

/** A small FIXED `$engine.*` feed for the preview (deterministic engine reads). */
export const FIXED_PREVIEW_ENGINE: Record<string, unknown> = {
	win: 250,
	winLevel: 3,
	betAmount: 1,
	balanceAmount: 1000,
};

export interface PreviewOptions {
	/** The speed scalar (the authored Speed dial / live `timeScale()`); divides every delay. */
	speed?: number;
	/** The fixed trigger payload (the deterministic book event) accessors read via `$trigger`. */
	trigger?: unknown;
	/** The fixed dispatch context (`{ bookEvents }`) accessors read via `$context`. */
	context?: unknown;
	/** Optional `$engine.*` feed reader for the preview (fixed values for reproducibility). */
	engine?: (key: string) => unknown;
}

/**
 * Run an authored choreography deterministically and return its timeline. No real time
 * passes: delays advance a virtual clock. The SAME {@link runChoreography} the runtime
 * uses drives the recording, so the previewed order/timing matches what the game will do
 * (modulo the real subscribers' own async work, which only the live mounter can show).
 */
export const previewChoreography = async (
	node: ChoreographyNode,
	options: PreviewOptions = {},
): Promise<PreviewResult> => {
	const speed = options.speed && options.speed > 0 ? options.speed : 1;
	const timeline: PreviewEntry[] = [];
	let clock = 0;

	const record = (entry: PreviewEntry): void => {
		timeline.push(entry);
	};

	const runtime: FlowRuntime = {
		emitter: {
			broadcast: (emitterEvent) => {
				const { type, ...payload } = emitterEvent;
				record({
					kind: 'broadcast',
					at: clock,
					event: type,
					...(Object.keys(payload).length > 0 ? { payload } : {}),
					mode: 'sync',
				});
			},
			broadcastAsync: async (emitterEvent) => {
				const { type, ...payload } = emitterEvent;
				// The executor distinguishes awaited vs fire-and-forget by whether it awaits
				// the returned promise; both call broadcastAsync. We record the issue point as
				// the broadcastAsync entry; the awaited/fire-and-forget distinction is implied
				// by the executor's `await`. Mark as `awaited` here and downgrade nothing — the
				// recording captures issue order, which is what tuning needs.
				record({
					kind: 'broadcast',
					at: clock,
					event: type,
					...(Object.keys(payload).length > 0 ? { payload } : {}),
					mode: 'awaited',
				});
				return [];
			},
		},
		timeScale: () => speed,
		// Virtual clock: do not wait real time. The executor passes the ALREADY-scaled ms
		// (it divides by timeScale() itself), so advance the clock by exactly that and
		// resolve on a microtask to preserve the async ordering.
		waitForTimeout: async (scaledMs: number) => {
			record({
				kind: 'delay',
				at: clock,
				ms: scaledMs * speed,
				scaledMs,
			});
			clock += scaledMs;
		},
		// Deterministic preview: record the effect invocation (order + resolved payload) but
		// do NOT run a body — effects mutate live state/board the preview cannot model. The
		// executor awaits a resolved promise, so the timeline order is preserved.
		effect: (name: string) => (payload: Record<string, unknown>) => {
			record({
				kind: 'effect',
				at: clock,
				name,
				...(Object.keys(payload).length > 0 ? { payload } : {}),
			});
		},
	};

	const scope: FlowScope = {
		trigger: options.trigger,
		context: options.context,
		engine: options.engine,
	};

	await runChoreography(node, runtime, scope);

	return { timeline, durationMs: clock, speed };
};
