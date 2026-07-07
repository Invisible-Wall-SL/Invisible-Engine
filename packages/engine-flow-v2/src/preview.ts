/**
 * Invisible Flow v2 — the DETERMINISTIC editor preview (Phase 2d, design §9 Phase 2 "the
 * deterministic preview").
 *
 * This is the HEADLESS, reproducible half of "preview": it runs an authored flow's event handler
 * through the REAL `runFlowEvent` interpreter against a RECORDING `FlowV2Env`, producing the ordered
 * timeline of every effect / cue / delay / show / hide — with each entry's RESOLVED payload and a
 * virtual-clock `at` stamp. No real time passes: `waitForTimeout` resolves on a microtask and the
 * clock accumulates the (already speed-scaled) requested ms, so a preview of a 30s flow returns
 * instantly with the exact authored timing.
 *
 * Why this is the honest editor scope (mirrors v1's `previewExecutor`): a TRUE VISUAL preview needs
 * the running game — its real emitter + Pixi components + the container mounter — which is the
 * RUNTIME (Phase 4b/5), explicitly not in the editor. What IS in scope, and what makes delay/stagger
 * tuning reproducible, is the deterministic ORDER + TIMING of the flow's side effects. Feeding a
 * FIXED sample trigger + engine feed (never a random outcome) makes the same flow produce the same
 * timeline every run, so an author tweaks a `delay`/`compute` and sees the millisecond shift at once.
 *
 * The interpreter drives it with the SAME async semantics the game uses (the real `runFlowEvent`,
 * the real forEach/branch/functionCall walk), so the previewed order matches what the game will do —
 * modulo the real subscribers' own async work, which only the live runtime can show.
 */

import { runFlowEvent, type FlowV2Env, type RunContext } from './runtime';
import type { EventDecl, FlowDoc, FunctionLibraryDoc, TemplateVocabulary, TypeRef } from './types';

// ---------------------------------------------------------------------------
// The timeline.
// ---------------------------------------------------------------------------

export type FlowPreviewEntry =
	| { kind: 'effect'; at: number; name: string; payload?: Record<string, unknown> }
	| { kind: 'cue'; at: number; name: string; payload?: Record<string, unknown> }
	/** A `delay` node — `ms` is the ELAPSED (already speed-scaled) duration the clock advanced. */
	| { kind: 'delay'; at: number; ms: number }
	| { kind: 'show'; at: number; container: string; z: number }
	| { kind: 'hide'; at: number; container: string };

export interface FlowPreviewResult {
	/** The ordered side-effect timeline with virtual-clock `at` stamps. */
	timeline: FlowPreviewEntry[];
	/** Total virtual-clock ms the flow spans (the final clock value). */
	durationMs: number;
	/** The speed scalar applied (1 = normal, 2 = turbo) — echoed for the UI dial. */
	speed: number;
}

export interface FlowPreviewOptions {
	/** The speed scalar (the authored Speed dial / live `timeScale()`); divides every delay. */
	speed?: number;
	/** Override the synthesized sample trigger payload (else one is built from the EventDecl). */
	payload?: Record<string, unknown>;
	/** Override the fixed `$engine.<key>` feed (else `FIXED_PREVIEW_ENGINE`). */
	engine?: (key: string) => unknown;
}

// ---------------------------------------------------------------------------
// A deterministic FIXED `$engine.*` feed — stable values so a `$engine.reels` forEach or a
// branch guard resolves the same every run (reproducibility). `reels` is a 5-reel list so a
// per-reel stagger shows five iterations.
// ---------------------------------------------------------------------------

export const FIXED_PREVIEW_ENGINE: Record<string, unknown> = {
	reels: [{ index: 0 }, { index: 1 }, { index: 2 }, { index: 3 }, { index: 4 }],
	balance: 1000,
	win: 250,
	totalWin: 250,
	bet: 1,
	gameType: 'basegame',
	isFreeGame: false,
	freeSpinsRemaining: 10,
	freeSpinsTotal: 10,
};

// ---------------------------------------------------------------------------
// Sample-payload synthesis — a deterministic value for a `TypeRef`, so the preview's trigger
// matches the event's declared payload shape (a `$trigger.<field>` accessor resolves stably).
// ---------------------------------------------------------------------------

/** A deterministic sample value for a type (list index threads through so struct `index` fields
 *  get distinct ordinals — a `list<Reel>` becomes `[{index:0},{index:1},{index:2}]`). */
const sampleValue = (type: TypeRef, vocab: TemplateVocabulary, ordinal = 0): unknown => {
	switch (type.t) {
		case 'int':
		case 'ms':
			return ordinal;
		case 'float':
			return 250;
		case 'bool':
			return true;
		case 'string':
			return 'sample';
		case 'enum': {
			const decl = vocab.enums.find((e) => e.name === type.name);
			return decl?.values[0] ?? type.name;
		}
		case 'struct': {
			const decl = vocab.structs.find((s) => s.name === type.name);
			const obj: Record<string, unknown> = {};
			for (const f of decl?.fields ?? []) {
				// An `index` int field gets the element ordinal (so list elements are distinct).
				obj[f.name] =
					f.name === 'index' && (f.type.t === 'int' || f.type.t === 'ms')
						? ordinal
						: sampleValue(f.type, vocab, ordinal);
			}
			return obj;
		}
		case 'list':
			return [0, 1, 2].map((i) => sampleValue(type.of, vocab, i));
	}
};

/** Build a deterministic sample trigger payload for an event from its declared payload fields. */
export const samplePayloadForEvent = (
	vocab: TemplateVocabulary,
	eventName: string,
): Record<string, unknown> => {
	const decl: EventDecl | undefined = vocab.events.find((e) => e.name === eventName);
	const payload: Record<string, unknown> = {};
	for (const p of decl?.payload ?? []) payload[p.name] = sampleValue(p.type, vocab);
	return payload;
};

// ---------------------------------------------------------------------------
// The preview.
// ---------------------------------------------------------------------------

/**
 * Run `eventName`'s authored handler deterministically and return its side-effect timeline. No real
 * time passes — delays advance a virtual clock. The SAME `runFlowEvent` the game uses drives it, so
 * the order/timing matches what the game will do (modulo the real subscribers' async work).
 */
export const previewFlowEvent = async (
	doc: FlowDoc,
	lookups: { vocab: TemplateVocabulary; library: FunctionLibraryDoc },
	eventName: string,
	options: FlowPreviewOptions = {},
): Promise<FlowPreviewResult> => {
	const speed = options.speed && options.speed > 0 ? options.speed : 1;
	const engine = options.engine ?? ((key: string) => FIXED_PREVIEW_ENGINE[key]);
	const trigger = options.payload ?? samplePayloadForEvent(lookups.vocab, eventName);

	const timeline: FlowPreviewEntry[] = [];
	let clock = 0;
	const withPayload = (payload: Record<string, unknown>) =>
		Object.keys(payload).length > 0 ? { payload } : {};

	const env: FlowV2Env = {
		effect: (name, payload) => {
			timeline.push({ kind: 'effect', at: clock, name, ...withPayload(payload) });
		},
		broadcast: (cue, payload) => {
			timeline.push({ kind: 'cue', at: clock, name: cue, ...withPayload(payload) });
		},
		// Virtual clock: record the START stamp, advance by the (already speed-scaled) ms, resolve
		// on a microtask so ordering reflects genuine async sequencing without real waiting.
		waitForTimeout: async (ms) => {
			const elapsed = Number.isFinite(ms) ? ms : 0;
			timeline.push({ kind: 'delay', at: clock, ms: elapsed });
			clock += elapsed;
			await Promise.resolve();
		},
		timeScale: () => speed,
		showContainer: (container, z) => {
			timeline.push({ kind: 'show', at: clock, container, z });
		},
		hideContainer: (container) => {
			timeline.push({ kind: 'hide', at: clock, container });
		},
		engineRead: (key) => engine(key),
	};

	const ctx: RunContext = { vocab: lookups.vocab, library: lookups.library, env };
	await runFlowEvent(doc, ctx, eventName, trigger);

	return { timeline, durationMs: clock, speed };
};
