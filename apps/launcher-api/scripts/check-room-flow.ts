/**
 * A FLOW BROUGHT BACK TO ITS START FOR ANOTHER ROOM (`apps/lines` `game/roomFlow.ts`: what a leave
 * for a new room on the same page runs, `game/online.ts` `showRoom`), on the package's own
 * interpreter and on a flow that is NOT Salmons' seed: a win screen that HOLDS its chain, a mode
 * with a start-up handler of its own, a second `complete:` handler above the splash, a variable
 * and a timer. Run:
 *   pnpm --filter launcher-api check:room-flow
 */
import assert from 'node:assert/strict';

import { restartFlow, startupCue, type RoomFlow } from '../../lines/src/game/roomFlow.ts';
import { createFlowV2Env } from '../../../packages/engine-flow-v2/src/env.ts';
import { createContainerMountModel } from '../../../packages/engine-flow-v2/src/mount.ts';
import { runFlowEvent, type RunContext } from '../../../packages/engine-flow-v2/src/runtime.ts';
import { createFlowState } from '../../../packages/engine-flow-v2/src/state.ts';
import type {
	ExecEdge,
	FlowDoc,
	Node,
	TemplateVocabulary,
} from '../../../packages/engine-flow-v2/src/types.ts';

let passed = 0;
const checkLive = async (name: string, fn: () => Promise<void>) => {
	await fn();
	passed++;
	console.log(`  ok  ${name}`);
};

const at = { x: 0, y: 0 };
const event = (id: string, ref: string): Node => ({ id, kind: 'event', ref, pos: at });
const show = (id: string, ref: string, awaitComplete = false): Node => ({
	id,
	kind: 'showContainer',
	ref,
	...(awaitComplete ? { awaitComplete: true } : {}),
	pos: at,
});
const hide = (id: string, ref: string): Node => ({ id, kind: 'hideContainer', ref, pos: at });
const chain = (...ids: string[]): ExecEdge[] =>
	ids.slice(1).map((to, i) => ({
		from: { node: ids[i], pin: 'exec' },
		to: { node: to, pin: 'exec' },
	}));
const VOCAB: TemplateVocabulary = {
	templateId: 'room-flow',
	structs: [],
	enums: [],
	events: ['load', 'gameWon', 'complete:splash', 'complete:intro'].map((name) => ({
		name,
		payload: [],
	})),
	actions: [],
	cues: [],
	collections: [],
	values: [],
};
/** A flow handle as the game builds one, on the package's own interpreter. */
const handleOf = (doc: FlowDoc) => {
	const mount = createContainerMountModel(doc.containers);
	const state = createFlowState(doc);
	let mode = 'basegame';
	const ctx: RunContext = {
		vocab: VOCAB,
		library: { version: 2, functions: [] },
		env: createFlowV2Env({
			state,
			mount,
			effect: () => undefined,
			broadcast: () => undefined,
			waitForTimeout: () => Promise.resolve(),
			timeScale: () => 1,
			engineRead: () => undefined,
		}),
		activeMode: () => mode,
	};
	const owned = new Set(doc.graph.nodes.filter((n) => n.kind === 'event').map((n) => n.ref));
	const unmounted: string[][] = [];
	return {
		state,
		mount,
		setMode: (next: string) => (mode = next),
		mode: () => mode,
		unmounted,
		shown: () => mount.ordered().map((c) => c.id),
		flow: {
			ordered: () => mount.ordered(),
			containers: doc.containers,
			mount,
			state,
			ownsEvent: (name) => owned.has(name),
			dispatch: (name, payload) => runFlowEvent(doc, ctx, name, payload),
		} satisfies RoomFlow,
		game: {
			unmount: () => unmounted.push(mount.ordered().map((c) => c.id)),
			resetModes: () => (mode = 'basegame'),
			roomValues: () => state.write('phase', 'waiting'),
			complete: async () => {
				const [top] = mount.heldContainers();
				return top !== undefined && mount.complete(top);
			},
		},
	};
};
const turns = async () => {
	for (let i = 0; i < 200; i++) await Promise.resolve();
};
const CONTAINERS = [
	{ id: 'game', sceneId: 'game', z: 0 },
	{ id: 'bonusHud', sceneId: 'bonusHud', z: 50 },
	{ id: 'won', sceneId: 'won', z: 80 },
	{ id: 'late', sceneId: 'late', z: 85 },
	{ id: 'later', sceneId: 'later', z: 90 },
	{ id: 'splash', sceneId: 'splash', z: 100 },
	{ id: 'intro', sceneId: 'intro', z: 110 },
];
const doc: FlowDoc = {
	version: 2,
	templateId: 'room-flow',
	containers: CONTAINERS,
	graph: {
		nodes: [
			event('load', 'load'),
			show('showSplash', 'splash'),
			event('splashDone', 'complete:splash'),
			hide('hideSplash', 'splash'),
			show('showGame', 'game'),
			show('showIntro', 'intro'),
			event('introDone', 'complete:intro'),
			hide('hideIntro', 'intro'),
			event('won', 'gameWon'),
			show('showWon', 'won', true),
			show('showLate', 'late', true),
			show('showLater', 'later'),
			{ id: 'clock', kind: 'startTimer', timer: 'clock', pos: at },
		],
		exec: [
			...chain('load', 'showSplash'),
			...chain('splashDone', 'hideSplash', 'showGame', 'showIntro'),
			...chain('introDone', 'hideIntro'),
			...chain('won', 'showWon', 'showLate', 'showLater'),
		],
		data: [],
	},
	modes: {
		bonus: {
			graph: {
				nodes: [event('bonusSplashDone', 'complete:splash'), show('showBonusHud', 'bonusHud')],
				exec: chain('bonusSplashDone', 'showBonusHud'),
				data: [],
			},
		},
	},
	variables: [
		{ id: 'count', type: 'int', initial: 0, scope: 'game' },
		{ id: 'phase', type: 'string', initial: '', scope: 'game', server: 'phase' },
	],
};

await checkLive(
	'another room on the same page: a flow with a hold, a mode and two completions is back at its start',
	async () => {
		const h = handleOf(doc);
		await h.flow.dispatch('load', {});
		await h.flow.dispatch('complete:splash', {});
		await h.flow.dispatch('complete:intro', {});
		assert.deepEqual(h.shown(), ['game'], 'a boot ends on the game');
		// The game is won in a bonus mode: the win screen holds its chain, a counter counted, a
		// timer runs.
		void h.flow.dispatch('gameWon', {});
		await turns();
		h.setMode('bonus');
		h.state.write('count', 7);
		h.state.startTimer('clock', 1000, true);
		assert.deepEqual(h.shown(), ['game', 'won']);
		assert.deepEqual(h.mount.heldContainers(), ['won']);

		// The start-up's event is the splash's (what `load` shows), not the intro's, which is
		// above it and shown only by the splash's completion.
		assert.equal(startupCue(doc, h.flow), 'complete:splash');
		const { chain: started } = await restartFlow(h.flow, doc, h.game);
		await started;
		await turns();
		// What a boot shows once its splash ends, in the base game: not the win screen, not what
		// its released chain showed (`late`, which held it again, and `later`), not the bonus
		// mode's own answer (`bonusHud`).
		assert.deepEqual(h.shown(), ['game', 'intro']);
		assert.deepEqual(h.unmounted, [[]], 'the game unmounts once, with nothing shown');
		assert.equal(h.mode(), 'basegame');
		assert.equal(h.state.read('count'), 0);
		assert.equal(h.state.read('phase'), 'waiting', 'the room’s value, written after the reset');
		assert.equal(h.state.timerRunning('clock'), false);
		assert.deepEqual(h.mount.heldContainers(), []);
	},
);

await checkLive(
	'…and a flow whose `load` holds its splash is completed as a boot completes it',
	async () => {
		const held: FlowDoc = {
			version: 2,
			templateId: 'room-flow',
			containers: CONTAINERS,
			graph: {
				nodes: [
					event('load', 'load'),
					show('showSplash', 'splash', true),
					hide('hideSplash', 'splash'),
					show('showGame', 'game'),
				],
				exec: chain('load', 'showSplash', 'hideSplash', 'showGame'),
				data: [],
			},
		};
		const h = handleOf(held);
		void h.flow.dispatch('load', {});
		await turns();
		h.mount.complete('splash');
		await turns();
		assert.deepEqual(h.shown(), ['game']);
		assert.equal(startupCue(held, h.flow), undefined);
		const { chain: started } = await restartFlow(h.flow, held, h.game);
		await started;
		assert.deepEqual(h.shown(), ['game']);
	},
);

console.log(`check:room-flow — ${passed} checks passed`);
