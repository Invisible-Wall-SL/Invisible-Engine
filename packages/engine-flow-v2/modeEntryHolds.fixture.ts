/**
 * Offline fixture for `modeEntryHolds` — does entering a mode hold for the player's tap? Run with tsx:
 *   pnpm --filter launcher-api exec tsx ../../packages/engine-flow-v2/modeEntryHolds.fixture.ts
 *
 * The game asks it before a Hold and Win entry: only an entry that holds is presented like the
 * free-spin intro (slam re-armed, button inert), so every flow without a held entry keeps its STOP.
 * SIX claims:
 *
 *  1. A HELD SHOW ON THE MODE'S ENTER CHAIN HOLDS — in the mode's own tab or in Global, inside a
 *     group too.
 *  2. A HELD SHOW ON THE ENTRY EVENT'S CHAIN HOLDS — the chain that runs with the mode on screen:
 *     the tab's when it handles the event, else Global's.
 *  3. THE STARTER FLOW DOES NOT HOLD. The Hold and Win mode tab "＋ Add overlay steps" grafts shows
 *     its screens unheld, so every current game is untouched.
 *  4. ANYTHING ELSE DOES NOT HOLD: an unheld Show, a held Show on the exit chain, on another mode's
 *     enter, off the chain, or on a Global event chain the tab's own handler shadows.
 *  5. A DOC WITH NO MODES ANSWERS FROM GLOBAL ALONE.
 *  6. `signalChainCallsAction` STILL ANSWERS AS BEFORE on the shared walk.
 */

import { holdAndWinModeGraph } from './src/reference/drivenSeed.ts';
import { modeEntryHolds, signalChainCallsAction } from './src/runtime.ts';
import type { FlowDoc, Graph, Node } from './src/types.ts';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

const pos = { x: 0, y: 0 };
const enter = (id: string, modeId = 'holdAndWin', on: 'enter' | 'exit' = 'enter'): Node => ({
	id,
	kind: 'modeTrigger',
	pos,
	modeId,
	on,
});
const show = (id: string, held: boolean): Node => ({
	id,
	kind: 'showContainer',
	pos,
	ref: 'featureIntro',
	...(held ? { awaitComplete: true } : {}),
});
const event = (id: string, ref: string): Node => ({ id, kind: 'event', pos, ref });
const action = (id: string, ref: string): Node => ({ id, kind: 'action', pos, ref });
/** `nodes` wired head to tail. */
const chain = (...nodes: Node[]): Graph => ({
	nodes,
	exec: nodes.slice(1).map((n, i) => ({
		from: { node: nodes[i].id, pin: 'exec' },
		to: { node: n.id, pin: 'exec' },
	})),
	data: [],
});
const merge = (...graphs: Graph[]): Graph => ({
	nodes: graphs.flatMap((g) => g.nodes),
	exec: graphs.flatMap((g) => g.exec),
	data: graphs.flatMap((g) => g.data),
});
const doc = (graph: Graph, tab?: Graph): FlowDoc => ({
	version: 2,
	templateId: 'holdAndWin',
	graph,
	containers: [{ id: 'featureIntro', sceneId: 'featureIntro', z: 10 }],
	...(tab ? { modes: { holdAndWin: { graph: tab } } } : {}),
});
const EMPTY: Graph = { nodes: [], exec: [], data: [] };
const holds = (d: FlowDoc) => modeEntryHolds(d, 'holdAndWin', 'holdAndWinTrigger');

console.log('1. a held Show on the enter chain');
check('in the mode tab', holds(doc(EMPTY, chain(enter('e'), show('s', true)))), true);
check('in Global', holds(doc(chain(enter('e'), show('s', true)), EMPTY)), true);
check(
	'behind the drain and before the screens, as the guide wires it',
	holds(
		doc(
			EMPTY,
			chain(
				enter('e'),
				action('d', 'drainPots'),
				show('s', true),
				{ id: 'h', kind: 'hideContainer', pos, ref: 'featureIntro' },
				show('bg', false),
			),
		),
	),
	true,
);
const grouped: Node = {
	id: 'g',
	kind: 'group',
	pos,
	label: 'Intro',
	body: chain(show('s', true)),
	boundary: [],
};
check('inside a group on the chain', holds(doc(EMPTY, chain(enter('e'), grouped))), true);

console.log('2. a held Show on the entry event chain');
check(
	'the tab handles holdAndWinTrigger',
	holds(doc(EMPTY, chain(event('t', 'holdAndWinTrigger'), show('s', true)))),
	true,
);
check(
	'only Global handles it',
	holds(doc(chain(event('t', 'holdAndWinTrigger'), show('s', true)), EMPTY)),
	true,
);

console.log('3. the starter flow');
check(
	'the grafted Hold and Win tab does not hold',
	holds(doc(EMPTY, holdAndWinModeGraph('hw'))),
	false,
);

console.log('4. anything else');
check('an unheld Show', holds(doc(EMPTY, chain(enter('e'), show('s', false)))), false);
check(
	'a held Show on the exit chain',
	holds(doc(EMPTY, chain(enter('x', 'holdAndWin', 'exit'), show('s', true)))),
	false,
);
check(
	"a held Show on another mode's enter",
	holds(doc(chain(enter('e', 'freeSpins'), show('s', true)), EMPTY)),
	false,
);
check(
	'a held Show off every chain',
	holds(doc(EMPTY, merge(chain(enter('e')), chain(show('s', true))))),
	false,
);
check(
	"a Global chain the tab's own handler shadows",
	holds(
		doc(
			chain(event('t', 'holdAndWinTrigger'), show('s', true)),
			chain(event('t2', 'holdAndWinTrigger'), action('a', 'showRespinBoard')),
		),
	),
	false,
);

console.log('5. no modes');
check(
	'Global answers alone',
	[
		holds(doc(chain(enter('e'), show('s', true)))),
		holds(doc(chain(event('t', 'holdAndWinTrigger'), show('s', true)))),
		holds(doc(EMPTY)),
	],
	[true, true, false],
);

console.log('6. signalChainCallsAction');
const drains = doc(
	EMPTY,
	merge(chain(event('t', 'holdAndWinTrigger'), action('d', 'drainPots')), chain(enter('e'))),
);
check(
	'on the chain, off it, in another mode',
	[
		signalChainCallsAction(drains, 'holdAndWin', 'holdAndWinTrigger', 'drainPots'),
		signalChainCallsAction(drains, 'holdAndWin', 'holdAndWinTrigger', 'showRespinBoard'),
		signalChainCallsAction(drains, 'freeSpins', 'holdAndWinTrigger', 'drainPots'),
	],
	[true, false, false],
);

console.log(
	failures === 0 ? '\nAll modeEntryHolds assertions passed.\n' : `\n${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
