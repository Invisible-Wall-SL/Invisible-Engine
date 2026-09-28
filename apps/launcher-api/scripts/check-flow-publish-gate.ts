/**
 * Guard the Flow publish gate's offline contracts.
 *
 * Run: `pnpm --filter launcher-api run check:flow-publish-gate`
 *
 * 1. **Every game type's scaffold passes its own gate.** A new project is scaffolded with the type's
 *    starter flow (`projectScaffold.ts`) beside the type's engine-owned scenes, and Publish refuses a
 *    flow with validation errors — so a starter that fails against its own scaffold would make every
 *    new game of that type unpublishable out of the box. Validated through `validateFlowV2Against`,
 *    the function the gate itself calls, with the EMPTY library a fresh launcher ships.
 * 2. **The gate sees an exec fan-out** (negative control): the same starter with a second wire out of
 *    one exec-out is an error.
 * 3. **The editor replaces, never adds, a second exec wire** (`addExecEdgeIn`), while a different
 *    out-pin on the same node keeps its own wire.
 */
import { freshDrivenSeedDoc, type FlowDoc } from 'engine-flow-v2';
import { engineOwnedOnly, getFullSceneSet } from 'engine-layout';

import { validateFlowV2Against } from '../src/lib/server/flowV2Validation';
import { addExecEdgeIn } from '../src/routes/(app)/flow-v2/graphOps';

let fails = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
	if (ok) console.log(`  PASS  ${name}`);
	else {
		fails++;
		console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
	}
};

const EMPTY_LIBRARY = { version: 2 as const, functions: [] };
const GAME_TYPES = ['lines', 'bookOf', 'ways', 'cluster', 'scatter'];

for (const gameType of GAME_TYPES) {
	const reference = getFullSceneSet(gameType);
	if (!reference) {
		check(`1. ${gameType}: has a full scene set`, false);
		continue;
	}
	const scenes = engineOwnedOnly(reference).scenes;
	const errors = validateFlowV2Against(
		freshDrivenSeedDoc(gameType),
		scenes,
		null,
		EMPTY_LIBRARY,
	).filter((i) => i.severity === 'error');
	check(
		`1. ${gameType}: the scaffolded starter flow passes the publish gate`,
		errors.length === 0,
		errors.map((e) => `${e.code}: ${e.message}`).join(' | '),
	);
}

const seed: FlowDoc = freshDrivenSeedDoc('ways');
const firstExec = seed.graph.exec[0];
const fanned: FlowDoc = {
	...seed,
	graph: {
		...seed.graph,
		exec: [...seed.graph.exec, { from: firstExec.from, to: seed.graph.exec[1].to }],
	},
};
const waysScenes = engineOwnedOnly(getFullSceneSet('ways')!).scenes;
check(
	'2. a second wire out of one exec-out is refused by the gate',
	validateFlowV2Against(fanned, waysScenes, null, EMPTY_LIBRARY).some(
		(i) => i.code === 'exec-out-fanout' && i.severity === 'error',
	),
);

const graph: FlowDoc['graph'] = {
	nodes: [],
	exec: [
		{ from: { node: 'branch', pin: 'then' }, to: { node: 'a', pin: 'exec' } },
		{ from: { node: 'branch', pin: 'else' }, to: { node: 'b', pin: 'exec' } },
	],
	data: [],
};
const rewired = addExecEdgeIn(graph, { node: 'branch', pin: 'then' }, { node: 'c', pin: 'exec' });
const fromThen = rewired.exec.filter((e) => e.from.node === 'branch' && e.from.pin === 'then');
check(
	'3. drawing a second wire from an exec-out replaces the first',
	fromThen.length === 1 && fromThen[0].to.node === 'c',
	JSON.stringify(fromThen),
);
check(
	'3. …and leaves the node’s other exec-out alone',
	rewired.exec.some((e) => e.from.pin === 'else' && e.to.node === 'b'),
);

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
if (fails) process.exitCode = 1;
