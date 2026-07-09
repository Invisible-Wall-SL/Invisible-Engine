/**
 * Invisible Flow v2 — ROUND-BLOCK HOLD harness (`showContainer{awaitComplete}`).
 *
 *   pnpm --filter flow-spike run v2hold
 *
 * Proves, HEADLESSLY, the generic overlay hold that replaces the coded free-spin gates: a
 * `showContainer` node with `awaitComplete` BLOCKS the exec chain after mounting until that
 * container next completes — i.e. its `complete:<id>` event hides it (a tap on a `tapToContinue`
 * overlay). Because the game's book pump AWAITS `dispatch(event)`, a blocked chain holds the round
 * until the player taps.
 *
 * Asserted:
 *   1. a plain `showContainer` (no flag) does NOT block — the chain runs straight through;
 *   2. a `showContainer{awaitComplete}` blocks: the mount lands, but the node AFTER it does not run
 *      and the dispatch promise stays pending;
 *   3. dispatching the container's `complete:<id>` (its `hideContainer`) RELEASES the hold: the
 *      after-node runs and the original dispatch promise resolves;
 *   4. the hold is scoped per-container (completing a DIFFERENT container does not release it);
 *   5. an env WITHOUT `awaitContainerComplete` (a pure recorder) treats the hold as a no-op (never
 *      deadlocks a headless run).
 */

import {
	createContainerMountModel,
	createFlowV2Env,
	runFlowEvent,
	type ContainerRef,
	type FlowDoc,
	type FunctionLibraryDoc,
	type RunContext,
	type TemplateVocabulary,
} from 'engine-flow-v2';

let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};
// Yield to the microtask queue so an awaited-but-unresolved dispatch settles what it can.
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

const CONTAINERS: ContainerRef[] = [
	{ id: 'base', sceneId: 'basegame', z: 0 },
	{ id: 'intro', sceneId: 'freeSpinIntro', z: 50 },
	{ id: 'other', sceneId: 'otherOverlay', z: 60 },
];
const EMPTY_LIBRARY: FunctionLibraryDoc = { version: 2, functions: [] };
const VOCAB: TemplateVocabulary = {
	templateId: 'book-of',
	structs: [],
	enums: [],
	events: [
		{ name: 'startFs', payload: [] },
		{ name: 'complete:intro', payload: [] },
		{ name: 'complete:other', payload: [] },
	],
	actions: [{ name: 'afterHold', params: [], category: 'effect' }],
	cues: [],
	collections: [],
};

/** startFs → showContainer(intro, [awaitComplete]) → action(afterHold).
 *  complete:intro → hideContainer(intro).  complete:other → hideContainer(other). */
const makeDoc = (awaitComplete: boolean): FlowDoc => ({
	version: 2,
	templateId: 'book-of',
	graph: {
		nodes: [
			{ id: 'onStart', kind: 'event', pos: { x: 0, y: 0 }, ref: 'startFs' },
			{
				id: 'showIntro',
				kind: 'showContainer',
				pos: { x: 200, y: 0 },
				ref: 'intro',
				...(awaitComplete ? { awaitComplete: true } : {}),
			},
			{ id: 'after', kind: 'action', pos: { x: 400, y: 0 }, ref: 'afterHold' },
			{ id: 'onCompleteIntro', kind: 'event', pos: { x: 0, y: 200 }, ref: 'complete:intro' },
			{ id: 'hideIntro', kind: 'hideContainer', pos: { x: 200, y: 200 }, ref: 'intro' },
			{ id: 'onCompleteOther', kind: 'event', pos: { x: 0, y: 400 }, ref: 'complete:other' },
			{ id: 'hideOther', kind: 'hideContainer', pos: { x: 200, y: 400 }, ref: 'other' },
		],
		exec: [
			{ from: { node: 'onStart', pin: 'exec' }, to: { node: 'showIntro', pin: 'exec' } },
			{ from: { node: 'showIntro', pin: 'exec' }, to: { node: 'after', pin: 'exec' } },
			{ from: { node: 'onCompleteIntro', pin: 'exec' }, to: { node: 'hideIntro', pin: 'exec' } },
			{ from: { node: 'onCompleteOther', pin: 'exec' }, to: { node: 'hideOther', pin: 'exec' } },
		],
		data: [],
	},
	containers: CONTAINERS,
});

const main = async () => {
	console.log('Invisible Flow v2 — round-block hold harness\n');

	// --- 1. no flag → no hold (baseline) ---
	console.log('1. plain showContainer does NOT block:');
	{
		const model = createContainerMountModel(CONTAINERS);
		const ran: string[] = [];
		const env = createFlowV2Env({
			mount: model,
			effect: (name) => (name === 'afterHold' ? () => void ran.push('after') : undefined),
			broadcast: () => {},
			waitForTimeout: () => Promise.resolve(),
			timeScale: () => 1,
			engineRead: () => undefined,
		});
		const ctx: RunContext = { vocab: VOCAB, library: EMPTY_LIBRARY, env };
		let done = false;
		await runFlowEvent(makeDoc(false), ctx, 'startFs', {}).then(() => (done = true));
		assert('chain ran straight through (after-node fired)', ran.length === 1 && done);
		assert('intro mounted', model.isShown('intro'));
	}

	// --- 2/3/4. awaitComplete → holds until this container completes ---
	console.log('\n2. showContainer{awaitComplete} holds until complete:<id>:');
	{
		const model = createContainerMountModel(CONTAINERS);
		const ran: string[] = [];
		const env = createFlowV2Env({
			mount: model,
			effect: (name) => (name === 'afterHold' ? () => void ran.push('after') : undefined),
			broadcast: () => {},
			waitForTimeout: () => Promise.resolve(),
			timeScale: () => 1,
			engineRead: () => undefined,
		});
		const ctx: RunContext = { vocab: VOCAB, library: EMPTY_LIBRARY, env };
		const doc = makeDoc(true);

		// Dispatch WITHOUT awaiting — the book pump would await this; we watch it stay pending.
		let resolved = false;
		const startP = runFlowEvent(doc, ctx, 'startFs', {}).then(() => (resolved = true));
		await tick();
		assert('intro mounted while held', model.isShown('intro'));
		assert('after-node has NOT run (chain is blocked)', ran.length === 0);
		assert('the startFs dispatch is still pending', !resolved);

		// A DIFFERENT container completing must not release this hold.
		await runFlowEvent(doc, ctx, 'complete:other', {});
		await tick();
		assert('completing a different container does NOT release the hold', ran.length === 0 && !resolved);

		// Completing THIS container (its hideContainer) releases the hold.
		await runFlowEvent(doc, ctx, 'complete:intro', {});
		await startP;
		assert('complete:intro released the hold → after-node ran', ran.length === 1);
		assert('the startFs dispatch resolved', resolved);
		assert('intro unmounted by its complete edge', !model.isShown('intro'));
	}

	// --- 5. recorder env (no awaitContainerComplete) → hold is a no-op ---
	console.log('\n5. an env without awaitContainerComplete never deadlocks:');
	{
		const ran: string[] = [];
		const recorderEnv = {
			effect: (name: string) => {
				if (name === 'afterHold') ran.push('after');
			},
			broadcast: () => {},
			waitForTimeout: () => Promise.resolve(),
			timeScale: () => 1,
			showContainer: () => {},
			hideContainer: () => {},
			engineRead: () => undefined,
			// awaitContainerComplete intentionally omitted.
		};
		const ctx: RunContext = { vocab: VOCAB, library: EMPTY_LIBRARY, env: recorderEnv };
		let done = false;
		await runFlowEvent(makeDoc(true), ctx, 'startFs', {}).then(() => (done = true));
		assert('hold resolves immediately (no awaitContainerComplete hook) → after-node ran', ran.length === 1 && done);
	}

	console.log(`\n${failed ? 'V2 HOLD HARNESS: FAILED' : 'V2 HOLD HARNESS: PASSED'}`);
	process.exit(failed ? 1 : 0);
};

void main();
