/**
 * Invisible Flow v2 — Phase 4a RUNTIME harness (design `invisible-flow-v2-schema.md` §10).
 *
 *   pnpm --filter flow-spike run v2runtime
 *
 * Proves, HEADLESSLY, the DEDICATED v2 interpreter (`runFlowEvent`) against the REAL
 * `engine-flow-v2` runtime — no editor, no game, no compile-to-v1. It hand-encodes the same
 * BOOK-OF vocabulary the schema/collapse harnesses use + a `StaggerStop(reels, step)` function
 * whose body drives the reel-stagger via a `compute`-fed DYNAMIC delay:
 *
 *     event reveal(reels) ─exec→ functionCall StaggerStop(reels, step=120) ─exec→ fireCue specialBookReveal
 *
 *   StaggerStop body:
 *     functionEntry ─exec→ forEach($input.reels)
 *                             ├─body→ delay(ms = $index × $input.step) ─exec→ stopReel($item.index)
 *                             └─done→ functionResult
 *
 * A MOCK `FlowV2Env` RECORDS an ordered log of every effect / broadcast / delay / show / hide
 * call (delay records the RESOLVED ms; timeScale = 1). With reels = [{index:0},{index:1},
 * {index:2}] and step = 120 the recorded order MUST be:
 *
 *     delay 0, stopReel(0), delay 120, stopReel(1), delay 240, stopReel(2), broadcast specialBookReveal
 *
 * i.e. function recursion + forEach + compute-driven dynamic delays + the trailing cue all fire
 * in the right order. Two extra asserts: a `branch` picks then/else off a guard, and a
 * `parallel` forEach fires all iterations without ordering.
 *
 * Prints PASS/FAIL per assertion + a final `V2 RUNTIME HARNESS: PASSED`.
 */

import {
	runFlowEvent,
	type FlowDoc,
	type FlowV2Env,
	type FunctionDef,
	type FunctionLibraryDoc,
	type RunContext,
	type TemplateVocabulary,
	type TypeRef,
} from 'engine-flow-v2';

// ---------------------------------------------------------------------------
// 1. The book-of TemplateVocabulary (mirrors flowV2Schema.ts / flowV2Collapse.ts).
// ---------------------------------------------------------------------------

const REEL: TypeRef = { t: 'struct', name: 'Reel' };
const LIST_REEL: TypeRef = { t: 'list', of: REEL };

const BOOK_OF_VOCAB: TemplateVocabulary = {
	templateId: 'book-of',
	structs: [{ name: 'Reel', fields: [{ name: 'index', type: { t: 'int' } }] }],
	enums: [{ name: 'SymbolName', values: ['H1', 'H2', 'H3', 'L1', 'L2', 'S'] }],
	events: [{ name: 'reveal', payload: [{ name: 'reels', type: LIST_REEL }] }],
	actions: [
		{ name: 'stopReel', params: [{ name: 'index', type: { t: 'int' } }], category: 'command' },
	],
	cues: [{ name: 'specialBookReveal', payload: [] }],
	collections: [{ name: 'reels', of: REEL }],
};

// ---------------------------------------------------------------------------
// 2. StaggerStop(reels, step): forEach reels → delay($index × step) → stopReel($item.index).
//    The body reads its inputs via `$input.*`; the delay's ms is WIRED from the compute out.
// ---------------------------------------------------------------------------

const STAGGER_STOP: FunctionDef = {
	id: 'fn.staggerStop',
	name: 'StaggerStop',
	inputs: [
		{ id: 'exec', dir: 'in', kind: 'exec' },
		{ id: 'reels', dir: 'in', kind: 'data', dataType: LIST_REEL, label: 'reels' },
		{ id: 'step', dir: 'in', kind: 'data', dataType: { t: 'ms' }, label: 'step' },
	],
	outputs: [{ id: 'exec', dir: 'out', kind: 'exec' }],
	body: {
		nodes: [
			{ id: 'entry', kind: 'functionEntry', pos: { x: -200, y: 0 }, ref: 'fn.staggerStop' },
			{
				id: 'each',
				kind: 'forEach',
				pos: { x: 0, y: 0 },
				mode: 'sequence',
				inputs: { in: { kind: 'accessor', path: { on: 'input', name: 'reels' } } },
			},
			{
				id: 'mul',
				kind: 'compute',
				pos: { x: 200, y: 100 },
				compute: {
					op: 'mul',
					a: { kind: 'accessor', path: { on: 'index' } },
					b: { kind: 'accessor', path: { on: 'input', name: 'step' } },
				},
			},
			{ id: 'wait', kind: 'delay', pos: { x: 200, y: 0 }, inputs: { ms: { kind: 'wire' } } },
			{
				id: 'stop',
				kind: 'action',
				pos: { x: 400, y: 0 },
				ref: 'stopReel',
				inputs: { index: { kind: 'accessor', path: { on: 'item', member: 'index' } } },
			},
			{ id: 'result', kind: 'functionResult', pos: { x: 600, y: 0 }, ref: 'fn.staggerStop' },
		],
		exec: [
			{ from: { node: 'entry', pin: 'exec' }, to: { node: 'each', pin: 'exec' } },
			{ from: { node: 'each', pin: 'body' }, to: { node: 'wait', pin: 'exec' } },
			{ from: { node: 'wait', pin: 'exec' }, to: { node: 'stop', pin: 'exec' } },
			{ from: { node: 'each', pin: 'done' }, to: { node: 'result', pin: 'exec' } },
		],
		data: [{ from: { node: 'mul', pin: 'out' }, to: { node: 'wait', pin: 'ms' } }],
	},
	requires: { actions: ['stopReel'], structs: ['Reel'], collections: ['reels'] },
};

const LIBRARY: FunctionLibraryDoc = { version: 2, functions: [STAGGER_STOP] };

// ---------------------------------------------------------------------------
// 3. The FlowDoc: reveal → StaggerStop(reels, step=120) → fireCue specialBookReveal.
// ---------------------------------------------------------------------------

const STAGGER_DOC: FlowDoc = {
	version: 2,
	templateId: 'book-of',
	graph: {
		nodes: [
			{ id: 'onReveal', kind: 'event', pos: { x: 0, y: 0 }, ref: 'reveal' },
			{
				id: 'stagger',
				kind: 'functionCall',
				pos: { x: 300, y: 0 },
				ref: 'fn.staggerStop',
				inputs: {
					reels: { kind: 'wire' },
					step: { kind: 'literal', type: { t: 'ms' }, value: 120 },
				},
			},
			{ id: 'cue', kind: 'fireCue', pos: { x: 600, y: 0 }, ref: 'specialBookReveal' },
		],
		exec: [
			{ from: { node: 'onReveal', pin: 'exec' }, to: { node: 'stagger', pin: 'exec' } },
			{ from: { node: 'stagger', pin: 'exec' }, to: { node: 'cue', pin: 'exec' } },
		],
		data: [{ from: { node: 'onReveal', pin: 'reels' }, to: { node: 'stagger', pin: 'reels' } }],
	},
	containers: [{ id: 'base', sceneId: 'basegame', z: 0 }],
};

// ---------------------------------------------------------------------------
// A recording FlowV2Env. Each side effect appends a stable, comparable log entry.
// ---------------------------------------------------------------------------

type LogEntry = string;

const makeRecordingEnv = (engine: Record<string, unknown> = {}) => {
	const log: LogEntry[] = [];
	const env: FlowV2Env = {
		async effect(name, payload) {
			// e.g. stopReel(0) — key on the single declared param when present.
			const args = Object.values(payload);
			log.push(`${name}(${args.map((v) => JSON.stringify(v)).join(',')})`);
		},
		async broadcast(cue, payload) {
			const extra = Object.keys(payload).length ? ` ${JSON.stringify(payload)}` : '';
			log.push(`broadcast ${cue}${extra}`);
		},
		async waitForTimeout(ms) {
			log.push(`delay ${ms}`);
			// Real await so ordering reflects genuine async sequencing (not a synchronous fake).
			await Promise.resolve();
		},
		timeScale: () => 1,
		showContainer(id, z) {
			log.push(`show ${id}@${z}`);
		},
		hideContainer(id) {
			log.push(`hide ${id}`);
		},
		engineRead: (key) => engine[key],
	};
	return { env, log };
};

// ---------------------------------------------------------------------------
// Assertions.
// ---------------------------------------------------------------------------

let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};

const eqLog = (a: LogEntry[], b: LogEntry[]) => JSON.stringify(a) === JSON.stringify(b);

const main = async () => {
	console.log('Invisible Flow v2 — Phase 4a runtime harness\n');

	// --- 1. the stagger flow: recursion + forEach + compute-driven dynamic delays + cue ---
	console.log('1. StaggerStop — recursion + forEach + compute-driven dynamic delays + cue:');
	{
		const { env, log } = makeRecordingEnv();
		const ctx: RunContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY, env };
		await runFlowEvent(STAGGER_DOC, ctx, 'reveal', {
			reels: [{ index: 0 }, { index: 1 }, { index: 2 }],
		});

		const expected: LogEntry[] = [
			'delay 0',
			'stopReel(0)',
			'delay 120',
			'stopReel(1)',
			'delay 240',
			'stopReel(2)',
			'broadcast specialBookReveal',
		];
		assert(
			'recorded order matches the expected stagger sequence',
			eqLog(log, expected),
			log.join(' | '),
		);
	}

	// --- 2. an un-authored event falls through to a no-op (parity-safe) ---
	console.log('\n2. an un-authored event is a no-op:');
	{
		const { env, log } = makeRecordingEnv();
		const ctx: RunContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY, env };
		await runFlowEvent(STAGGER_DOC, ctx, 'noSuchEvent', {});
		assert(
			'no event node for `noSuchEvent` → zero recorded calls',
			log.length === 0,
			log.join(' | '),
		);
	}

	// --- 3. a branch picks then/else off a guard (and show/hide go through the env) ---
	console.log('\n3. branch — guard picks the then/else exec-out; show/hide via the env:');
	{
		// event gate(big:bool) → branch(all: $trigger.big == true) → then: show overlay / else: hide overlay.
		const branchDoc: FlowDoc = {
			version: 2,
			templateId: 'book-of',
			graph: {
				nodes: [
					{ id: 'onGate', kind: 'event', pos: { x: 0, y: 0 }, ref: 'gate' },
					{
						id: 'br',
						kind: 'branch',
						pos: { x: 200, y: 0 },
						guard: {
							all: [
								{
									left: { kind: 'accessor', path: { on: 'engine', key: 'bigWin' } },
									op: 'eq',
									right: { kind: 'literal', type: { t: 'bool' }, value: true },
								},
							],
						},
					},
					{ id: 'showO', kind: 'showContainer', pos: { x: 400, y: -60 }, ref: 'overlay' },
					{ id: 'hideO', kind: 'hideContainer', pos: { x: 400, y: 60 }, ref: 'overlay' },
				],
				exec: [
					{ from: { node: 'onGate', pin: 'exec' }, to: { node: 'br', pin: 'exec' } },
					{ from: { node: 'br', pin: 'then' }, to: { node: 'showO', pin: 'exec' } },
					{ from: { node: 'br', pin: 'else' }, to: { node: 'hideO', pin: 'exec' } },
				],
				data: [],
			},
			containers: [
				{ id: 'base', sceneId: 'basegame', z: 0 },
				{ id: 'overlay', sceneId: 'overlay', z: 50 },
			],
		};
		const gateVocab: TemplateVocabulary = {
			...BOOK_OF_VOCAB,
			events: [...BOOK_OF_VOCAB.events, { name: 'gate', payload: [] }],
		};

		// guard TRUE → then → showContainer(overlay@50).
		{
			const { env, log } = makeRecordingEnv({ bigWin: true });
			await runFlowEvent(branchDoc, { vocab: gateVocab, library: LIBRARY, env }, 'gate', {});
			assert(
				'guard TRUE → show overlay at its z (50)',
				eqLog(log, ['show overlay@50']),
				log.join(' | '),
			);
		}
		// guard FALSE → else → hideContainer(overlay).
		{
			const { env, log } = makeRecordingEnv({ bigWin: false });
			await runFlowEvent(branchDoc, { vocab: gateVocab, library: LIBRARY, env }, 'gate', {});
			assert('guard FALSE → hide overlay', eqLog(log, ['hide overlay']), log.join(' | '));
		}
	}

	// --- 4. a parallel forEach fires every iteration (order-agnostic) ---
	console.log('\n4. parallel forEach — every iteration fires (delay 0, no ordering assumed):');
	{
		// event reveal(reels) → forEach parallel → stopReel($item.index).
		const parallelDoc: FlowDoc = {
			version: 2,
			templateId: 'book-of',
			graph: {
				nodes: [
					{ id: 'onReveal', kind: 'event', pos: { x: 0, y: 0 }, ref: 'reveal' },
					{
						id: 'each',
						kind: 'forEach',
						pos: { x: 200, y: 0 },
						mode: 'parallel',
						inputs: { in: { kind: 'wire' } },
					},
					{
						id: 'stop',
						kind: 'action',
						pos: { x: 400, y: 0 },
						ref: 'stopReel',
						inputs: { index: { kind: 'accessor', path: { on: 'item', member: 'index' } } },
					},
				],
				exec: [
					{ from: { node: 'onReveal', pin: 'exec' }, to: { node: 'each', pin: 'exec' } },
					{ from: { node: 'each', pin: 'body' }, to: { node: 'stop', pin: 'exec' } },
				],
				data: [{ from: { node: 'onReveal', pin: 'reels' }, to: { node: 'each', pin: 'in' } }],
			},
			containers: [{ id: 'base', sceneId: 'basegame', z: 0 }],
		};
		const { env, log } = makeRecordingEnv();
		await runFlowEvent(parallelDoc, { vocab: BOOK_OF_VOCAB, library: LIBRARY, env }, 'reveal', {
			reels: [{ index: 0 }, { index: 1 }, { index: 2 }],
		});
		const sorted = [...log].sort();
		assert(
			'all three stopReel calls fired (0,1,2), no delay in a parallel body',
			eqLog(sorted, ['stopReel(0)', 'stopReel(1)', 'stopReel(2)']),
			log.join(' | '),
		);
	}

	console.log(`\n${failed ? 'V2 RUNTIME HARNESS: FAILED' : 'V2 RUNTIME HARNESS: PASSED'}`);
	process.exit(failed ? 1 : 0);
};

void main();
