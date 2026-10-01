/**
 * Invisible Flow v2 — GAME MODES harness (`docs/design/hold-and-win.md` §4.5).
 *
 *   pnpm --filter flow-spike run v2modes
 *
 * Proves, headlessly, against the REAL book-of vocabulary:
 *   1. PARITY — a doc with no `modes` runs every signal on its global graph whatever mode is active,
 *      and its ownership answers are what they were.
 *   2. ACTIVE-MODE-FIRST — a signal the active mode's section handles runs THERE (and only there); a
 *      signal it does not handle falls back to the global graph; ownership follows the active mode.
 *   3. TRANSITIONS — `runFlowModeTransition` runs the matching Mode trigger entries of the mode's own
 *      section, then the global graph's, with `mode` / `cause` / `total` on their data-outs; `exit`,
 *      `resume` and `allFinished` reach only their own entries.
 *   4. Enter mode / Exit mode nodes reach the env with their policy, cause and total.
 *   5. VALIDATION — sections are validated like the global graph, issues carry their `mode`, and the
 *      mode rules (`mode-unset`, `mode-entry-scope`, cross-section `duplicate-id`) fire.
 *   6. Text messages, hide targets and await targets are collected from every section.
 *
 * Prints PASS/FAIL per assertion + a final `V2 MODES HARNESS: PASSED`.
 */

import {
	BOOK_OF_VOCAB,
	collectTextMessages,
	flowOwnsSignal,
	hideContainerIds,
	awaitCompleteContainerIds,
	runFlowEvent,
	runFlowModeTransition,
	validateFlowDoc,
	type FlowDoc,
	type FlowV2Env,
	type FunctionLibraryDoc,
	type Graph,
	type Node,
	type RunContext,
} from 'engine-flow-v2';

const LIBRARY: FunctionLibraryDoc = { version: 2, functions: [] };

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`PASS  ${label}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

const log: string[] = [];
const env: FlowV2Env = {
	effect: (name, payload) => {
		log.push(`effect ${name}${Object.keys(payload).length ? ` ${JSON.stringify(payload)}` : ''}`);
	},
	broadcast: (cue, payload) => {
		log.push(`cue ${cue}${Object.keys(payload).length ? ` ${JSON.stringify(payload)}` : ''}`);
	},
	waitForTimeout: async () => {},
	timeScale: () => 1,
	showContainer: (id) => {
		log.push(`show ${id}`);
	},
	hideContainer: (id) => {
		log.push(`hide ${id}`);
	},
	engineRead: () => undefined,
	enterMode: (id, opts) => {
		log.push(`enterMode ${id} ${JSON.stringify(opts)}`);
	},
	exitMode: (id, total) => {
		log.push(`exitMode ${id ?? '-'} ${total ?? '-'}`);
	},
};

let active = 'basegame';
const ctx: RunContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY, env, activeMode: () => active };
const take = (): string[] => log.splice(0, log.length);

const at = { x: 0, y: 0 };
const signals = (id: string): Node => ({ id, kind: 'gameSignals', pos: at });
const cue = (id: string, ref: string): Node => ({ id, kind: 'fireCue', pos: at, ref });
const graph = (
	nodes: Node[],
	exec: [string, string, string][],
	data: Graph['data'] = [],
): Graph => ({
	nodes,
	exec: exec.map(([from, pin, to]) => ({
		from: { node: from, pin },
		to: { node: to, pin: 'exec' },
	})),
	data,
});

const GLOBAL = graph(
	[
		signals('g.signals'),
		cue('g.reveal', 'boardShow'),
		cue('g.winInfo', 'boardHide'),
		{ id: 'g.onHw', kind: 'modeTrigger', pos: at, modeId: 'holdAndWin' },
		cue('g.onHwCue', 'freeSpinIntroShow'),
		{ id: 'g.done', kind: 'allModesFinished', pos: at },
		cue('g.doneCue', 'winHide'),
	],
	[
		['g.signals', 'reveal', 'g.reveal'],
		['g.signals', 'winInfo', 'g.winInfo'],
		['g.onHw', 'exec', 'g.onHwCue'],
		['g.done', 'exec', 'g.doneCue'],
	],
);

const HW = graph(
	[
		signals('hw.signals'),
		cue('hw.reveal', 'boardFrameGlowShow'),
		{ id: 'hw.enter', kind: 'modeTrigger', pos: at, modeId: 'holdAndWin', on: 'enter' },
		{
			id: 'hw.enterAction',
			kind: 'enterMode',
			pos: at,
			modeId: 'pick',
			inputs: { cause: { kind: 'wire' } },
		},
		{ id: 'hw.exit', kind: 'modeTrigger', pos: at, modeId: 'holdAndWin', on: 'exit' },
		cue('hw.exitCue', 'freeSpinOutroShow'),
		{ id: 'hw.resume', kind: 'modeTrigger', pos: at, modeId: 'holdAndWin', on: 'resume' },
		cue('hw.resumeCue', 'freeSpinCounterShow'),
		{ id: 'hw.queueWheel', kind: 'enterMode', pos: at, modeId: 'wheel', policy: 'queue' },
		{
			id: 'hw.leave',
			kind: 'exitMode',
			pos: at,
			inputs: { total: { kind: 'literal', value: 12.5, type: { t: 'float' } } },
		},
	],
	[
		['hw.signals', 'reveal', 'hw.reveal'],
		['hw.enter', 'exec', 'hw.enterAction'],
		['hw.exit', 'exec', 'hw.exitCue'],
		['hw.resume', 'exec', 'hw.resumeCue'],
		['hw.resumeCue', 'exec', 'hw.queueWheel'],
		['hw.queueWheel', 'exec', 'hw.leave'],
	],
	[{ from: { node: 'hw.enter', pin: 'cause' }, to: { node: 'hw.enterAction', pin: 'cause' } }],
);

const BASE = graph(
	[{ id: 'b.done', kind: 'allModesFinished', pos: at }, cue('b.doneCue', 'boardFrameGlowHide')],
	[['b.done', 'exec', 'b.doneCue']],
);

const FLAT: FlowDoc = { version: 2, templateId: 'bookOf', graph: GLOBAL, containers: [] };
const MODED: FlowDoc = {
	...FLAT,
	modes: { holdAndWin: { graph: HW }, basegame: { graph: BASE } },
};

const main = async (): Promise<void> => {
	console.log('\n1. parity — no modes section');
	for (const mode of ['basegame', 'freeSpins', 'holdAndWin']) {
		active = mode;
		await runFlowEvent(FLAT, ctx, 'reveal', {});
		check(`reveal in ${mode} runs the global graph`, take(), ['cue boardShow']);
	}
	check(
		'ownership is the global graph',
		[
			flowOwnsSignal(FLAT, 'reveal'),
			flowOwnsSignal(FLAT, 'freeSpinEnd'),
			flowOwnsSignal(FLAT, 'reveal', 'holdAndWin'),
		],
		[true, false, true],
	);

	console.log('\n2. active mode first');
	active = 'holdAndWin';
	await runFlowEvent(MODED, ctx, 'reveal', {});
	check('in holdAndWin, reveal runs the mode section ONLY', take(), ['cue boardFrameGlowShow']);
	await runFlowEvent(MODED, ctx, 'winInfo', {});
	check('a signal the section lacks falls back to global', take(), ['cue boardHide']);
	active = 'freeSpins';
	await runFlowEvent(MODED, ctx, 'reveal', {});
	check('a mode with no section uses global', take(), ['cue boardShow']);
	active = 'basegame';
	await runFlowEvent(MODED, ctx, 'reveal', {});
	check('the basegame section does not handle reveal, so global does', take(), ['cue boardShow']);
	const SECTION_ONLY: FlowDoc = {
		...FLAT,
		graph: graph([], []),
		modes: { holdAndWin: { graph: HW } },
	};
	check(
		'a signal handled only in a section is owned only while that mode is on screen',
		[
			flowOwnsSignal(SECTION_ONLY, 'reveal', 'basegame'),
			flowOwnsSignal(SECTION_ONLY, 'reveal', 'holdAndWin'),
			flowOwnsSignal(SECTION_ONLY, 'reveal'),
		],
		[false, true, false],
	);

	console.log('\n3. transitions');
	await runFlowModeTransition(MODED, ctx, {
		kind: 'enter',
		mode: 'holdAndWin',
		cause: 'count',
		payload: { coins: 6 },
	});
	check('enter: the section trigger (cause on its data-out), then the global one', take(), [
		'enterMode pick {"policy":"nest","cause":"count"}',
		'cue freeSpinIntroShow',
	]);
	await runFlowModeTransition(MODED, ctx, { kind: 'exit', mode: 'holdAndWin', total: 40 });
	check('exit reaches only the exit trigger', take(), ['cue freeSpinOutroShow']);
	await runFlowModeTransition(MODED, ctx, { kind: 'resume', mode: 'holdAndWin' });
	check('resume runs its chain, into Enter mode (queue) and Exit mode (total)', take(), [
		'cue freeSpinCounterShow',
		'enterMode wheel {"policy":"queue"}',
		'exitMode - 12.5',
	]);
	await runFlowModeTransition(MODED, ctx, { kind: 'enter', mode: 'freeSpins' });
	check('a mode nobody listens for is a no-op', take(), []);
	await runFlowModeTransition(MODED, ctx, { kind: 'allFinished' });
	check('all finished: the basegame section, then global', take(), [
		'cue boardFrameGlowHide',
		'cue winHide',
	]);
	await runFlowModeTransition(FLAT, ctx, { kind: 'enter', mode: 'holdAndWin' });
	check('a flat doc still runs its global mode trigger', take(), ['cue freeSpinIntroShow']);

	console.log('\n4. validation');
	const issuesOf = (doc: FlowDoc) =>
		validateFlowDoc(doc, BOOK_OF_VOCAB, LIBRARY)
			.filter((i) => i.severity !== 'info')
			.map((i) => `${i.severity} ${i.code}${i.mode ? ` @${i.mode}` : ''}`);
	check('the moded doc is clean', issuesOf(MODED), []);
	const bad: FlowDoc = {
		...FLAT,
		modes: {
			holdAndWin: {
				graph: graph(
					[
						{ id: 'x.unset', kind: 'modeTrigger', pos: at, modeId: '' },
						{ id: 'x.other', kind: 'modeTrigger', pos: at, modeId: 'freeSpins' },
						{ id: 'x.done', kind: 'allModesFinished', pos: at },
						{ id: 'x.enter', kind: 'enterMode', pos: at, modeId: ' ' },
						cue('g.reveal', 'boardShow'),
						{ id: 'x.ghost', kind: 'action', pos: at, ref: 'noSuchAction' },
					],
					[],
				),
			},
		},
	};
	check(
		'mode rules fire, tagged with their section; ids are unique across sections',
		issuesOf(bad).sort(),
		[
			'error mode-unset @holdAndWin',
			'error mode-unset @holdAndWin',
			'error ref-unresolved @holdAndWin',
			'warning duplicate-id',
			'warning mode-entry-scope @holdAndWin',
			'warning mode-entry-scope @holdAndWin',
		],
	);
	check(
		'a global-graph issue carries no mode',
		validateFlowDoc(
			{
				...FLAT,
				graph: graph([{ id: 'ghost', kind: 'action', pos: at, ref: 'noSuchAction' }], []),
			},
			BOOK_OF_VOCAB,
			LIBRARY,
		).map((i) => i.mode ?? 'global'),
		['global'],
	);

	console.log('\n5. collected from every section');
	const withMessage: FlowDoc = {
		...FLAT,
		modes: {
			holdAndWin: {
				graph: graph(
					[
						{
							id: 'm.text',
							kind: 'textMessage',
							pos: at,
							text: 'Respins left',
							place: { x: 0.5, y: 0.1 },
							visibleWhile: 'always',
						},
						{
							id: 'm.show',
							kind: 'showContainer',
							pos: at,
							ref: 'respinIntro',
							awaitComplete: true,
						},
						{ id: 'm.hide', kind: 'hideContainer', pos: at, ref: 'respinIntro' },
					],
					[],
				),
			},
		},
	};
	check(
		'text messages',
		collectTextMessages(withMessage).map((m) => m.key),
		['Respins left'],
	);
	check('hide targets', [...hideContainerIds(withMessage)], ['respinIntro']);
	check('await targets', [...awaitCompleteContainerIds(withMessage)], ['respinIntro']);

	console.log(
		failures === 0 ? '\nV2 MODES HARNESS: PASSED' : `\nV2 MODES HARNESS: ${failures} FAILED`,
	);
	process.exit(failures === 0 ? 0 : 1);
};

void main();
