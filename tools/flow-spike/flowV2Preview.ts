/**
 * Invisible Flow v2 — Phase 2d PREVIEW harness.
 *
 *   pnpm --filter flow-spike run v2preview
 *
 * Proves the DETERMINISTIC editor preview (`previewFlowEvent`): the book-of reveal flow (stagger the
 * 5 `$engine.reels` at step 120, then set the special symbol + fire the reveal cue) yields the EXACT
 * side-effect timeline with correct virtual-clock `at` stamps — instantly, no real waiting. Also:
 * speed halves every delay, an un-authored event is an empty timeline, and a branch picks then/else
 * off the fixed engine feed.
 *
 * Prints PASS/FAIL per assertion + a final `V2 PREVIEW HARNESS: PASSED`.
 */

import {
	BOOK_OF_VOCAB,
	previewFlowEvent,
	type FlowDoc,
	type FlowPreviewEntry,
	type FunctionDef,
	type FunctionLibraryDoc,
	type TypeRef,
} from 'engine-flow-v2';

let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};

/** A compact, comparable string for one timeline entry. */
const fmt = (e: FlowPreviewEntry): string => {
	switch (e.kind) {
		case 'delay':
			return `delay@${e.at}:${e.ms}`;
		case 'show':
			return `show@${e.at}:${e.container}(${e.z})`;
		case 'hide':
			return `hide@${e.at}:${e.container}`;
		default:
			return `${e.kind}@${e.at}:${e.name}${e.payload ? ` ${JSON.stringify(e.payload)}` : ''}`;
	}
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const REEL: TypeRef = { t: 'struct', name: 'Reel' };
const LIST_REEL: TypeRef = { t: 'list', of: REEL };
const SYMBOL: TypeRef = { t: 'enum', name: 'SymbolName' };

// StaggerStop(reels, step): forEach reels → delay($index × step) → stopReel($item.index).
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
				pos: { x: 200, y: 120 },
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

// event reveal → StaggerStop(reels ← $engine.reels, step=120) → setSpecialSymbol('S') → fireCue.
const REVEAL_DOC: FlowDoc = {
	version: 2,
	templateId: 'bookOf',
	graph: {
		nodes: [
			{ id: 'onReveal', kind: 'event', pos: { x: 0, y: 0 }, ref: 'reveal' },
			{
				id: 'stagger',
				kind: 'functionCall',
				pos: { x: 300, y: 0 },
				ref: 'fn.staggerStop',
				inputs: {
					reels: { kind: 'accessor', path: { on: 'engine', key: 'reels' } },
					step: { kind: 'literal', type: { t: 'ms' }, value: 120 },
				},
			},
			{
				id: 'setSpecial',
				kind: 'action',
				pos: { x: 600, y: 0 },
				ref: 'setSpecialSymbol',
				inputs: { symbol: { kind: 'literal', type: SYMBOL, value: 'S' } },
			},
			{
				id: 'cue',
				kind: 'fireCue',
				pos: { x: 900, y: 0 },
				ref: 'specialBookReveal',
				inputs: { symbol: { kind: 'literal', type: SYMBOL, value: 'S' } },
			},
		],
		exec: [
			{ from: { node: 'onReveal', pin: 'exec' }, to: { node: 'stagger', pin: 'exec' } },
			{ from: { node: 'stagger', pin: 'exec' }, to: { node: 'setSpecial', pin: 'exec' } },
			{ from: { node: 'setSpecial', pin: 'exec' }, to: { node: 'cue', pin: 'exec' } },
		],
		data: [],
	},
	containers: [{ id: 'base', sceneId: 'basegame', z: 0 }],
};

const main = async () => {
	console.log('Invisible Flow v2 — Phase 2d preview harness\n');

	console.log('1. the book-of reveal timeline (5 reels @ step 120, speed 1):');
	{
		const { timeline, durationMs } = await previewFlowEvent(
			REVEAL_DOC,
			{ vocab: BOOK_OF_VOCAB, library: LIBRARY },
			'reveal',
		);
		const got = timeline.map(fmt);
		const expected = [
			'delay@0:0',
			'effect@0:stopReel {"index":0}',
			'delay@0:120',
			'effect@120:stopReel {"index":1}',
			'delay@120:240',
			'effect@360:stopReel {"index":2}',
			'delay@360:360',
			'effect@720:stopReel {"index":3}',
			'delay@720:480',
			'effect@1200:stopReel {"index":4}',
			'effect@1200:setSpecialSymbol {"symbol":"S"}',
			'cue@1200:specialBookReveal {"symbol":"S"}',
		];
		assert(
			'timeline matches the expected stagger sequence + at-stamps',
			eq(got, expected),
			got.join(' | '),
		);
		assert('durationMs is the final virtual clock (1200)', durationMs === 1200, `${durationMs}`);
	}

	console.log('\n2. speed halves every delay (durationMs 600 at speed 2):');
	{
		const { durationMs } = await previewFlowEvent(
			REVEAL_DOC,
			{ vocab: BOOK_OF_VOCAB, library: LIBRARY },
			'reveal',
			{ speed: 2 },
		);
		assert('durationMs halves under turbo', durationMs === 600, `${durationMs}`);
	}

	console.log('\n3. an un-authored event → empty timeline:');
	{
		const { timeline } = await previewFlowEvent(
			REVEAL_DOC,
			{ vocab: BOOK_OF_VOCAB, library: LIBRARY },
			'noSuchEvent',
		);
		assert('no event node → 0 entries', timeline.length === 0, `${timeline.length}`);
	}

	console.log('\n4. a branch picks then/else off the fixed engine feed:');
	{
		// event freeSpinTrigger → branch($engine.isFreeGame == true) → then show / else hide.
		const branchDoc: FlowDoc = {
			version: 2,
			templateId: 'bookOf',
			graph: {
				nodes: [
					{ id: 'onFst', kind: 'event', pos: { x: 0, y: 0 }, ref: 'freeSpinTrigger' },
					{
						id: 'br',
						kind: 'branch',
						pos: { x: 200, y: 0 },
						guard: {
							all: [
								{
									left: { kind: 'accessor', path: { on: 'engine', key: 'isFreeGame' } },
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
					{ from: { node: 'onFst', pin: 'exec' }, to: { node: 'br', pin: 'exec' } },
					{ from: { node: 'br', pin: 'then' }, to: { node: 'showO', pin: 'exec' } },
					{ from: { node: 'br', pin: 'else' }, to: { node: 'hideO', pin: 'exec' } },
				],
				data: [],
			},
			containers: [{ id: 'overlay', sceneId: 'overlay', z: 50 }],
		};
		// FIXED_PREVIEW_ENGINE.isFreeGame === false → else → hide overlay.
		const { timeline } = await previewFlowEvent(
			branchDoc,
			{ vocab: BOOK_OF_VOCAB, library: LIBRARY },
			'freeSpinTrigger',
		);
		assert(
			'guard false → hide overlay (one entry)',
			eq(timeline.map(fmt), ['hide@0:overlay']),
			timeline.map(fmt).join(' | '),
		);
	}

	console.log(`\n${failed ? 'V2 PREVIEW HARNESS: FAILED' : 'V2 PREVIEW HARNESS: PASSED'}`);
	process.exit(failed ? 1 : 0);
};

void main();
