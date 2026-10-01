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
 * 4. **Every kind resolves to the starter flow + vocabulary it is recorded to** — the pin on the
 *    named fallbacks (`DRIVEN_SEED_FALLBACKS` / `VOCABULARY_FALLBACKS`). `cluster` and `scatter` own
 *    their seeds since 2026-10-01 (they borrowed the Book-of one before); `holdAndWin` follows
 *    `lines` until Hold and Win Phase 5 registers its own. A new kind must be added here, so what it
 *    resolves to is a decision rather than a floor it fell through to.
 * 5. **Every registered starter flow validates against its OWN vocabulary** — every `DRIVEN_SEEDS`
 *    entry is keyed by its `templateId`, that id has a registered vocabulary (not a fallback), and
 *    `validateFlowDoc` finds no error. §1 reaches only the seeds a game kind resolves to; this
 *    reaches every seed.
 */
import { GAME_KINDS } from 'constants-shared/gameKinds';
import {
	BOOK_OF_DRIVEN_SEED_CONTAINER_EVENTS,
	DRIVEN_SEEDS,
	freshDrivenSeedDoc,
	TEMPLATE_VOCABULARIES,
	templateVocabulary,
	validateFlowDoc,
	type FlowDoc,
} from 'engine-flow-v2';
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
for (const gameType of GAME_KINDS) {
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

/** Kind → [starter flow's templateId, vocabulary templateId]. `my-custom-kind` = an author-created
 *  kind (not a built-in id). */
const RESOLVES_TO: Record<string, [string, string]> = {
	lines: ['bookOf', 'bookOf'],
	ways: ['ways', 'ways'],
	cluster: ['cluster', 'cluster'],
	scatter: ['scatter', 'scatter'],
	bookOf: ['bookOf', 'bookOf'],
	holdAndWin: ['bookOf', 'bookOf'],
	'my-custom-kind': ['bookOf', 'bookOf'],
};
for (const kind of GAME_KINDS) {
	check(`4. ${kind}: has a recorded resolution`, kind in RESOLVES_TO);
}
for (const [kind, [seedId, vocabId]] of Object.entries(RESOLVES_TO)) {
	const seeded = freshDrivenSeedDoc(kind).templateId;
	check(`4. ${kind}: starter flow is the ${seedId} seed`, seeded === seedId, seeded);
	const vocab = templateVocabulary(kind).templateId;
	check(`4. ${kind}: vocabulary is ${vocabId}`, vocab === vocabId, vocab);
}
check('4. an absent kind gets the bookOf seed', freshDrivenSeedDoc().templateId === 'bookOf');
check(
	'4. an absent templateId gets the bookOf vocabulary',
	templateVocabulary(undefined).templateId === 'bookOf',
);

for (const [id, seed] of Object.entries(DRIVEN_SEEDS)) {
	check(`5. ${id}: the seed is keyed by its templateId`, seed.templateId === id, seed.templateId);
	check(
		`5. ${id}: has a registered vocabulary of its own`,
		Object.hasOwn(TEMPLATE_VOCABULARIES, id),
	);
	const errors = validateFlowDoc(
		seed,
		templateVocabulary(seed.templateId),
		EMPTY_LIBRARY,
		BOOK_OF_DRIVEN_SEED_CONTAINER_EVENTS,
	).filter((i) => i.severity === 'error');
	check(
		`5. ${id}: the seed validates against its own vocabulary with no error`,
		errors.length === 0,
		errors.map((e) => `${e.code}: ${e.message}`).join(' | '),
	);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
if (fails) process.exitCode = 1;
