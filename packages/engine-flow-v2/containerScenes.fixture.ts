/**
 * Offline fixture for a Flow that names a screen the layout no longer has. Run with tsx:
 *   pnpm --filter launcher-api exec tsx ../../packages/engine-flow-v2/containerScenes.fixture.ts
 *
 * A screen deleted from the Scene Editor (or lost to a bad save) stays in `FlowDoc.containers`, so
 * `showContainer` still mounts it, nothing draws, and a step waiting on it never continues. Live, a
 * game sat on its background forever with no console error. `containersMissingScene` is the one rule
 * the game (boot log) and the launcher (validator, runtime assembly, Publish) read. FIVE claims:
 *
 *  1. THE HELPER REPORTS EXACTLY THE CONTAINERS WHOSE SCENE IS GONE. Containers [a, b, c] against
 *     a layout of [a, c] report [b]; an agreeing pair reports []; a container is judged by its
 *     `sceneId`, not its id.
 *  2. AN UNKNOWN LAYOUT REPORTS NOTHING. An empty scene list is an unsaved project or a boot with no
 *     doc, not a layout with no screens; flagging every container there would be noise.
 *  3. THE VALIDATOR WARNS ON EACH SHOW AND HIDE OF ONE. `container-scene-missing` is a WARNING on the
 *     node (so Publish, which refuses only errors, still ships), in a mode section too, carrying the
 *     section's `mode`.
 *  4. PARITY: no scene ids, an empty list, or an agreeing layout adds no issue at all.
 *  5. `shownSceneIds` IS WHAT A SHOW CAN MOUNT. The backing scene of every declared container a
 *     `showContainer` targets, in any section and inside groups. A declared-only container (the
 *     editor declares every screen), a hide alone and a show of an undeclared container are not
 *     shows, because none of them mounts anything. The game reads it to decide whether the add-on's
 *     Pots screen is the flow's or its own.
 */

import { containersMissingScene, shownSceneIds } from './src/containerScenes.ts';
import { validateFlowDoc } from './src/validate.ts';
import type {
	ContainerRef,
	FlowDoc,
	FunctionLibraryDoc,
	Graph,
	TemplateVocabulary,
} from './src/types.ts';

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

const ids = (containers: ContainerRef[]): string[] => containers.map((c) => c.id);
const ref = (id: string, sceneId = id, z = 0): ContainerRef => ({ id, sceneId, z });

console.log('1. containersMissingScene');
const ABC = [ref('a'), ref('b', 'b', 10), ref('c', 'c', 20)];
check('[a, b, c] against [a, c] reports [b]', ids(containersMissingScene(ABC, ['a', 'c'])), ['b']);
check('an agreeing pair reports []', ids(containersMissingScene(ABC, ['a', 'b', 'c'])), []);
check(
	'extra screens the flow never names are not reported',
	ids(containersMissingScene(ABC, ['c', 'x', 'b', 'a'])),
	[],
);
check('doc order is kept', ids(containersMissingScene([ref('z'), ref('a'), ref('m')], ['a'])), [
	'z',
	'm',
]);
check('judged by sceneId, not id', containersMissingScene([ref('intro', 'fs_intro')], ['intro']), [
	ref('intro', 'fs_intro'),
]);
check('accepts any iterable', ids(containersMissingScene(ABC, new Set(['a', 'c']))), ['b']);

console.log('2. an unknown layout');
check('an empty scene list reports nothing', containersMissingScene(ABC, []), []);
check('an empty Set reports nothing', containersMissingScene(ABC, new Set()), []);

const VOCAB: TemplateVocabulary = {
	templateId: 'book-of',
	structs: [],
	enums: [],
	events: [{ name: 'load', payload: [] }],
	actions: [],
	cues: [],
	collections: [],
	values: [],
};
const LIBRARY: FunctionLibraryDoc = { version: 2, functions: [] };

/** load → show background → hide splash → show loading: the live incident's chain. */
const chain = (prefix: string): Graph => ({
	nodes: [
		{ id: `${prefix}load`, kind: 'event', pos: { x: 0, y: 0 }, ref: 'load' },
		{ id: `${prefix}showBg`, kind: 'showContainer', pos: { x: 200, y: 0 }, ref: 'background' },
		{ id: `${prefix}hideSplash`, kind: 'hideContainer', pos: { x: 400, y: 0 }, ref: 'splash' },
		{ id: `${prefix}showLoading`, kind: 'showContainer', pos: { x: 600, y: 0 }, ref: 'loading' },
	],
	exec: [
		{ from: { node: `${prefix}load`, pin: 'exec' }, to: { node: `${prefix}showBg`, pin: 'exec' } },
		{
			from: { node: `${prefix}showBg`, pin: 'exec' },
			to: { node: `${prefix}hideSplash`, pin: 'exec' },
		},
		{
			from: { node: `${prefix}hideSplash`, pin: 'exec' },
			to: { node: `${prefix}showLoading`, pin: 'exec' },
		},
	],
	data: [],
});
const DOC: FlowDoc = {
	version: 2,
	templateId: 'book-of',
	graph: chain(''),
	modes: { freeSpins: { graph: chain('fs_') } },
	containers: [
		ref('background', 'background'),
		ref('splash', 's_q9iw9aqf', 5),
		ref('loading', 'loading', 10),
	],
};
const ALL_SCENES = ['background', 's_q9iw9aqf', 'loading'];

const missingScene = (sceneIds?: Iterable<string>) =>
	validateFlowDoc(DOC, VOCAB, LIBRARY, undefined, undefined, sceneIds)
		.filter((i) => i.code === 'container-scene-missing')
		.map((i) => ({
			node: i.at.on === 'node' ? i.at.node : '?',
			severity: i.severity,
			...(i.mode ? { mode: i.mode } : {}),
		}));

console.log('3. the validator');
check('the doc is otherwise clean', validateFlowDoc(DOC, VOCAB, LIBRARY), []);
check(
	'every show and hide of a missing screen warns, global and mode sections',
	missingScene(['background']),
	[
		{ node: 'hideSplash', severity: 'warning' },
		{ node: 'showLoading', severity: 'warning' },
		{ node: 'fs_hideSplash', severity: 'warning', mode: 'freeSpins' },
		{ node: 'fs_showLoading', severity: 'warning', mode: 'freeSpins' },
	],
);
const [loadingIssue] = validateFlowDoc(DOC, VOCAB, LIBRARY, undefined, undefined, [
	'background',
	's_q9iw9aqf',
]);
check(
	'the message names the screen and the fix',
	loadingIssue?.message,
	"show container 'showLoading' shows screen 'loading', which is not in this game's layout (Scene Editor) — nothing will draw for it, and any step waiting on it will never continue. Restore the screen in /editor (History…) or remove it from the Flow",
);
const [splashIssue] = validateFlowDoc(DOC, VOCAB, LIBRARY, undefined, undefined, [
	'background',
	'loading',
]);
check(
	'a container whose id is not its scene id names both',
	splashIssue?.message.slice(0, 80),
	"hide container 'hideSplash' hides screen 'splash' (scene 's_q9iw9aqf'), which is",
);

console.log('4. parity');
check('no scene ids: nothing', missingScene(), []);
check('an empty scene list: nothing', missingScene([]), []);
check('an agreeing layout: nothing', missingScene(ALL_SCENES), []);

console.log('5. shownSceneIds');
const sorted = (set: Set<string>): string[] => [...set].sort();
check('a show counts, a hide alone does not', sorted(shownSceneIds(DOC)), [
	'background',
	'loading',
]);
check(
	'a declared-only container is not shown',
	sorted(shownSceneIds({ ...DOC, containers: [...DOC.containers, ref('pots')] })),
	['background', 'loading'],
);
const showOf = (id: string, containerRef: string): Graph => ({
	nodes: [{ id, kind: 'showContainer', pos: { x: 0, y: 0 }, ref: containerRef }],
	exec: [],
	data: [],
});
const BARE: FlowDoc = {
	version: 2,
	templateId: 'book-of',
	graph: showOf('s', 'pots'),
	containers: [],
};
check('a show of an undeclared container mounts nothing', sorted(shownSceneIds(BARE)), []);
check(
	'judged by the container scene, not its id',
	sorted(shownSceneIds({ ...BARE, containers: [ref('pots', 'p_x1')] })),
	['p_x1'],
);
check(
	'a show only in a mode section counts',
	sorted(
		shownSceneIds({
			...BARE,
			graph: { nodes: [], exec: [], data: [] },
			modes: { holdAndWin: { graph: showOf('hw_s', 'pots') } },
			containers: [ref('pots')],
		}),
	),
	['pots'],
);
check(
	'a show inside a group counts',
	sorted(
		shownSceneIds({
			...BARE,
			graph: {
				nodes: [
					{
						id: 'g',
						kind: 'group',
						pos: { x: 0, y: 0 },
						label: 'Pots',
						body: showOf('g_s', 'pots'),
						boundary: [],
					},
				],
				exec: [],
				data: [],
			},
			containers: [ref('pots')],
		}),
	),
	['pots'],
);

console.log(failures === 0 ? '\nAll assertions passed.' : `\n${failures} assertion(s) FAILED.`);
if (failures > 0) throw new Error('container scenes fixture failed');
