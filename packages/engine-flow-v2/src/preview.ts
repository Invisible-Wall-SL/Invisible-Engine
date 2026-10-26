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

import {
	runFlowEvent,
	runFlowStateEntry,
	type FlowStateEntry,
	type FlowV2Env,
	type RunContext,
} from './runtime';
import { createSpawnStore, spawnedIdOf, type SpawnLayerSpec } from './spawn';
import { createFlowState, flowUsesState, stepFlowState } from './state';
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
	| { kind: 'hide'; at: number; container: string }
	/** A `componentInstance` / `waitForState` node reaching a placed instance (§6.3): an input set
	 *  (`name` = the input, with its resolved `value`), a trigger fired, or a wait on a layer's state
	 *  (`name` = `<layer>.state`, `value` = the state) — which resolves at once, as no instance runs
	 *  headlessly. */
	| {
			kind: 'instance';
			at: number;
			instance: string;
			op: 'set' | 'fire' | 'wait';
			name: string;
			value?: unknown;
	  }
	/** A game variable changed (game-families §3.1) — its value after the frame's writes. */
	| { kind: 'var'; at: number; id: string; value: unknown }
	/** A timer ran out (§3.2). */
	| { kind: 'timer'; at: number; timer: string }
	/** A scripted key (`FlowPreviewOptions.inputs`) went down or up. */
	| { kind: 'input'; at: number; action: string; phase: 'down' | 'up' }
	/** A Spawn node (§3.3): the new instance's id, or why the layer refused it. */
	| {
			kind: 'spawn';
			at: number;
			layer: string;
			componentId: string;
			instance?: string;
			refused?: string;
	  }
	/** A Despawn node removed a live instance. */
	| { kind: 'despawn'; at: number; instance: string };

export interface FlowPreviewResult {
	/** The ordered side-effect timeline with virtual-clock `at` stamps. For a doc with variables,
	 *  timers or ticks, a timer, tick or variable entry is stamped at the frame it runs on (as in the
	 *  game: a 125 ms timer runs at 133.33), and a write shows up a frame after it was made, so a
	 *  horizon of 0 shows none. */
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
	/** Override the fixed dispatch context (`$context.*`, e.g. `bookEvents`) — else empty. */
	context?: Record<string, unknown>;
	/** Override the fixed `$engine.<key>` feed (else `FIXED_PREVIEW_ENGINE`). */
	engine?: (key: string) => unknown;
	/**
	 * How far the virtual clock may run (ms) for a doc with variables, timers or ticks: the preview
	 * stops there, or earlier once nothing is waiting and no timer or tick can fire. Default 5000;
	 * held to 0 – 60000.
	 */
	horizonMs?: number;
	/** Keys pressed during the preview, at virtual times (ms), for `onInput` entries. */
	inputs?: { at: number; action: string; phase?: 'down' | 'up' }[];
	/**
	 * The spawn layers the flow's screens place (§3.3, `spawnSpecsOf` of the projected decls): what a
	 * Spawn node may create, under each layer's cap. Absent ⇒ none, so every spawn is refused.
	 */
	spawnLayers?: readonly SpawnLayerSpec[];
}

/** The default `horizonMs`. */
export const PREVIEW_HORIZON_MS = 5000;

/** The frame the preview's clock steps tick and timer entries on (the game's 60 fps). */
export const PREVIEW_FRAME_MS = 1000 / 60;

/** The longest a preview may run (ms): an every-frame tick is one frame of work per 16.7 ms. */
export const PREVIEW_MAX_HORIZON_MS = 60_000;

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
		case 'instance':
			return undefined; // a handle exists only once something spawned it.
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
): Promise<FlowPreviewResult> =>
	flowUsesState(doc)
		? previewOnClock(doc, lookups, eventName, options)
		: previewChain(doc, lookups, eventName, options);

/** The recorder env both previews share; `at()` stamps each entry. */
const recorderEnv = (
	timeline: FlowPreviewEntry[],
	at: () => number,
	speed: number,
	engine: (key: string) => unknown,
	waitForTimeout: FlowV2Env['waitForTimeout'],
	spawnLayers: readonly SpawnLayerSpec[] = [],
): FlowV2Env => {
	// The live set, headless: the same store and rules as the game, nothing drawn. A spawned
	// instance runs no state machine here, so its sets / fires / waits are recorded like a placed one's.
	const live = createSpawnStore();
	for (const spec of spawnLayers) live.declare(spec);
	const withPayload = (payload: Record<string, unknown>) =>
		Object.keys(payload).length > 0 ? { payload } : {};
	return {
		effect: (name, payload) => {
			timeline.push({ kind: 'effect', at: at(), name, ...withPayload(payload) });
		},
		broadcast: (cue, payload) => {
			timeline.push({ kind: 'cue', at: at(), name: cue, ...withPayload(payload) });
		},
		waitForTimeout,
		timeScale: () => speed,
		showContainer: (container, z) => {
			timeline.push({ kind: 'show', at: at(), container, z });
		},
		hideContainer: (container) => {
			timeline.push({ kind: 'hide', at: at(), container });
		},
		engineRead: (key) => engine(key),
		setInstanceInput: (ref, input, value) => {
			timeline.push({
				kind: 'instance',
				at: at(),
				instance: ref.instance,
				op: 'set',
				name: input,
				value,
			});
		},
		fireInstanceTrigger: (ref, trigger) => {
			timeline.push({
				kind: 'instance',
				at: at(),
				instance: ref.instance,
				op: 'fire',
				name: trigger,
			});
		},
		awaitInstanceState: async (ref, layer, state) => {
			timeline.push({
				kind: 'instance',
				at: at(),
				instance: ref.instance,
				op: 'wait',
				name: `${layer}.state`,
				value: state,
			});
		},
		spawn: (layer, componentId, place) => {
			const result = live.spawn(layer, componentId, place);
			timeline.push({
				kind: 'spawn',
				at: at(),
				layer,
				componentId,
				...(result.ok ? { instance: result.instance.id } : { refused: result.reason }),
			});
			return result.ok ? result.instance : undefined;
		},
		despawn: (instance) => {
			const gone = live.despawn(spawnedIdOf(instance) ?? '');
			if (gone) timeline.push({ kind: 'despawn', at: at(), instance: gone.id });
		},
		liveInstances: (layer) => live.live(layer),
		spawnedRef: (instance) => {
			const id = spawnedIdOf(instance);
			return id && live.get(id) ? { container: '', instance: id } : undefined;
		},
	};
};

/**
 * The single-chain preview, for a doc with no variables, timers or ticks (every doc authored before
 * P10.3): delays add up on one clock as the chain awaits them.
 */
const previewChain = async (
	doc: FlowDoc,
	lookups: { vocab: TemplateVocabulary; library: FunctionLibraryDoc },
	eventName: string,
	options: FlowPreviewOptions,
): Promise<FlowPreviewResult> => {
	const speed = options.speed && options.speed > 0 ? options.speed : 1;
	const engine = options.engine ?? ((key: string) => FIXED_PREVIEW_ENGINE[key]);
	const trigger = options.payload ?? samplePayloadForEvent(lookups.vocab, eventName);

	const timeline: FlowPreviewEntry[] = [];
	let clock = 0;
	// Virtual clock: record the START stamp, advance by the (already speed-scaled) ms, resolve
	// on a microtask so ordering reflects genuine async sequencing without real waiting.
	const env = recorderEnv(
		timeline,
		() => clock,
		speed,
		engine,
		async (ms) => {
			const elapsed = Number.isFinite(ms) ? ms : 0;
			timeline.push({ kind: 'delay', at: clock, ms: elapsed });
			clock += elapsed;
			await Promise.resolve();
		},
		options.spawnLayers,
	);

	const ctx: RunContext = { vocab: lookups.vocab, library: lookups.library, env };
	await runFlowEvent(doc, ctx, eventName, trigger, options.context ?? {});

	return { timeline, durationMs: clock, speed };
};

/** A clock reading without the float dust frame sums leave (800.0000000001 ⇒ 800). */
const stamp = (ms: number): number => Math.round(ms * 1e6) / 1e6;

/** Let every chain run on until it waits on the clock (one macrotask drains the microtasks). */
const settle = (): Promise<void> =>
	new Promise((resolve) => {
		const immediate = (globalThis as { setImmediate?: (run: () => void) => void }).setImmediate;
		if (immediate) immediate(() => resolve());
		else if (typeof MessageChannel !== 'undefined') {
			// A browser has no setImmediate, and a nested setTimeout(0) waits 4 ms or more.
			const channel = new MessageChannel();
			channel.port1.onmessage = () => {
				channel.port1.close();
				resolve();
			};
			channel.port2.postMessage(null);
		} else setTimeout(resolve, 0);
	});

/**
 * The VIRTUAL-TIME EVENT QUEUE (game-families §3.2), for a doc with variables, timers or ticks. A
 * Delay is a wait on the queue, not a step of one chain's clock, so chains started by timers, ticks
 * and keys run side by side and each resumes at its own time. The clock moves to whichever comes
 * first — a wait ending, a scripted key, or the next 60 fps frame — and never back. A frame runs
 * `stepFlowState`, exactly as the game's ticker does: the writes since the last frame go out, then
 * the timers and ticks due run, all at the frame's moment. Nothing real passes; the same doc and
 * options give the same timeline every run.
 */
const previewOnClock = async (
	doc: FlowDoc,
	lookups: { vocab: TemplateVocabulary; library: FunctionLibraryDoc },
	eventName: string,
	options: FlowPreviewOptions,
): Promise<FlowPreviewResult> => {
	const speed = options.speed && options.speed > 0 ? options.speed : 1;
	const engine = options.engine ?? ((key: string) => FIXED_PREVIEW_ENGINE[key]);
	const trigger = options.payload ?? samplePayloadForEvent(lookups.vocab, eventName);
	const horizon =
		typeof options.horizonMs === 'number' && Number.isFinite(options.horizonMs)
			? Math.min(Math.max(0, options.horizonMs), PREVIEW_MAX_HORIZON_MS)
			: PREVIEW_HORIZON_MS;

	const timeline: FlowPreviewEntry[] = [];
	let now = 0;
	let seq = 0;
	const queue: { at: number; seq: number; run: () => void }[] = [];
	const schedule = (at: number, run: () => void): void => void queue.push({ at, seq: seq++, run });

	const state = createFlowState(doc);
	const env: FlowV2Env = {
		...recorderEnv(
			timeline,
			() => now,
			speed,
			engine,
			(ms) => {
				const elapsed = Number.isFinite(ms) && ms > 0 ? ms : 0;
				timeline.push({ kind: 'delay', at: now, ms: elapsed });
				return new Promise<void>((resolve) => schedule(now + elapsed, resolve));
			},
			options.spawnLayers,
		),
		state,
	};
	const ctx: RunContext = { vocab: lookups.vocab, library: lookups.library, env };

	const runEntry = (entry: FlowStateEntry): void => {
		if (entry.kind === 'variables') {
			const latest = new Map(entry.batch.map((w) => [w.id, w.value] as const));
			for (const [id, value] of latest) timeline.push({ kind: 'var', at: now, id, value });
		} else if (entry.kind === 'timer') {
			timeline.push({ kind: 'timer', at: now, timer: entry.timer });
		} else if (entry.kind === 'input') {
			timeline.push({ kind: 'input', at: now, action: entry.action, phase: entry.phase });
		}
		void runFlowStateEntry(doc, ctx, entry);
	};

	for (const input of options.inputs ?? []) {
		// A press at no real time would sit at the head of the queue for good.
		if (typeof input.at !== 'number' || !Number.isFinite(input.at)) continue;
		const phase = input.phase ?? 'down';
		schedule(Math.max(0, input.at), () => runEntry({ kind: 'input', action: input.action, phase }));
	}

	void runFlowEvent(doc, ctx, eventName, trigger, options.context ?? {});
	await settle();

	let frame = 0;
	for (;;) {
		const frameEnd = stamp((frame + 1) * PREVIEW_FRAME_MS);
		const nextQueued = queue.reduce((min, q) => Math.min(min, q.at), Infinity);
		if (nextQueued === Infinity && !state.live() && !state.pending()) break;
		if (Math.min(nextQueued, frameEnd) > horizon) break;
		// A wait ending exactly at the frame's end comes after the frame: the time up to it has passed.
		if (nextQueued < frameEnd) {
			now = nextQueued;
			const ready = queue.filter((q) => q.at <= now).sort((a, b) => a.seq - b.seq);
			for (const q of ready) queue.splice(queue.indexOf(q), 1);
			for (const q of ready) q.run();
			await settle();
			continue;
		}
		frame += 1;
		now = frameEnd;
		if (stepFlowState(state, PREVIEW_FRAME_MS, runEntry) > 0) await settle();
	}

	return { timeline, durationMs: Math.min(now, horizon), speed };
};
