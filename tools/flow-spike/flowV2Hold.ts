/**
 * Invisible Flow v2 — ROUND-BLOCK HOLD harness (`showContainer{awaitComplete}`).
 *
 *   pnpm --filter flow-spike run v2hold
 *
 * Proves, HEADLESSLY, the generic overlay hold that replaces the coded free-spin gates: a
 * `showContainer` node with `awaitComplete` BLOCKS the exec chain after mounting until that
 * container is COMPLETED — the mount model's `complete(id)`, driven by a tap on a `tapToContinue`
 * overlay. The tap RESUMES the SAME chain past the show node, so an author wires the round LINEARLY
 * (show → hide → next) with no separate `complete:<id>` event. Because the game's book pump AWAITS
 * `dispatch(event)`, a blocked chain holds the round until the tap.
 *
 * Asserted:
 *   1. a plain `showContainer` (no flag) does NOT block — the chain runs straight through;
 *   2. a `showContainer{awaitComplete}` blocks: the mount lands, the node AFTER it does not run, and
 *      the dispatch promise stays pending (`heldContainers` reports the held id);
 *   3. `mount.complete(id)` (the tap) RESUMES the chain: the after-node runs LINEARLY and the dispatch
 *      resolves — no complete event needed;
 *   4. the hold is scoped per-container (completing a DIFFERENT container does not release it, and
 *      `complete` returns false for an unheld id);
 *   5. hiding a held container also releases its hold (never leaks);
 *   6. an env WITHOUT `awaitContainerComplete` (a pure recorder) treats the hold as a no-op (never
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
	events: [{ name: 'startFs', payload: [] }],
	actions: [{ name: 'afterHold', params: [], category: 'effect' }],
	cues: [],
	collections: [],
};

/** LINEAR: startFs → showContainer(intro, [awaitComplete]) → hideContainer(intro) → action(afterHold). */
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
			{ id: 'hideIntro', kind: 'hideContainer', pos: { x: 400, y: 0 }, ref: 'intro' },
			{ id: 'after', kind: 'action', pos: { x: 600, y: 0 }, ref: 'afterHold' },
		],
		exec: [
			{ from: { node: 'onStart', pin: 'exec' }, to: { node: 'showIntro', pin: 'exec' } },
			{ from: { node: 'showIntro', pin: 'exec' }, to: { node: 'hideIntro', pin: 'exec' } },
			{ from: { node: 'hideIntro', pin: 'exec' }, to: { node: 'after', pin: 'exec' } },
		],
		data: [],
	},
	containers: CONTAINERS,
});

const makeCtx = (mount = createContainerMountModel(CONTAINERS), ran: string[] = []) => {
	const env = createFlowV2Env({
		mount,
		effect: (name) => (name === 'afterHold' ? () => void ran.push('after') : undefined),
		broadcast: () => {},
		waitForTimeout: () => Promise.resolve(),
		timeScale: () => 1,
		engineRead: () => undefined,
	});
	const ctx: RunContext = { vocab: VOCAB, library: EMPTY_LIBRARY, env };
	return { mount, ran, ctx };
};

const main = async () => {
	console.log('Invisible Flow v2 — round-block hold harness\n');

	// --- 1. no flag → no hold (baseline) ---
	console.log('1. plain showContainer does NOT block:');
	{
		const { mount, ran, ctx } = makeCtx();
		let done = false;
		await runFlowEvent(makeDoc(false), ctx, 'startFs', {}).then(() => (done = true));
		assert('chain ran straight through (after-node fired, intro hidden)', ran.length === 1 && done);
		assert('intro not left mounted', !mount.isShown('intro'));
	}

	// --- 2/3/4/5. awaitComplete → holds until the tap (mount.complete), resumes LINEARLY ---
	console.log('\n2. showContainer{awaitComplete} holds, and the tap resumes the chain linearly:');
	{
		const { mount, ran, ctx } = makeCtx();
		const doc = makeDoc(true);

		// Dispatch WITHOUT awaiting — the book pump would await this; we watch it stay pending.
		let resolved = false;
		const startP = runFlowEvent(doc, ctx, 'startFs', {}).then(() => (resolved = true));
		await tick();
		assert('intro mounted while held', mount.isShown('intro'));
		assert('after-node has NOT run (chain is blocked at the hold)', ran.length === 0);
		assert('the startFs dispatch is still pending', !resolved);
		assert('heldContainers reports the held id', JSON.stringify(mount.heldContainers()) === '["intro"]');

		// A DIFFERENT container completing must not release this hold.
		assert('complete(other) returns false (not held)', mount.complete('other') === false);
		await tick();
		assert('completing a different container does NOT release', ran.length === 0 && !resolved);

		// The tap on THIS container resumes the SAME chain (show → hide → after), no complete event.
		assert('complete(intro) returns true (was held)', mount.complete('intro') === true);
		await startP;
		assert('the tap resumed the chain → after-node ran', ran.length === 1);
		assert('the startFs dispatch resolved', resolved);
		assert('the chain hid the intro linearly', !mount.isShown('intro'));
	}

	// --- 5. hide releases a held container (no leak) ---
	console.log('\n5. hiding a held container releases its hold:');
	{
		const { mount, ran, ctx } = makeCtx();
		// A doc that shows-and-HOLDS but never hides in-chain, so only an external hide can release.
		const doc: FlowDoc = {
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
						awaitComplete: true,
					},
					{ id: 'after', kind: 'action', pos: { x: 400, y: 0 }, ref: 'afterHold' },
				],
				exec: [
					{ from: { node: 'onStart', pin: 'exec' }, to: { node: 'showIntro', pin: 'exec' } },
					{ from: { node: 'showIntro', pin: 'exec' }, to: { node: 'after', pin: 'exec' } },
				],
				data: [],
			},
			containers: CONTAINERS,
		};
		let resolved = false;
		const p = runFlowEvent(doc, ctx, 'startFs', {}).then(() => (resolved = true));
		await tick();
		assert('held (after-node not yet run)', ran.length === 0 && !resolved);
		mount.hide('intro'); // external hide → releases the hold.
		await p;
		assert('hide released the hold → after-node ran', ran.length === 1 && resolved);
	}

	// --- 6. recorder env (no awaitContainerComplete) → hold is a no-op ---
	console.log('\n6. an env without awaitContainerComplete never deadlocks:');
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
		assert('hold resolves immediately (no hook) → after-node ran', ran.length === 1 && done);
	}

	console.log(`\n${failed ? 'V2 HOLD HARNESS: FAILED' : 'V2 HOLD HARNESS: PASSED'}`);
	process.exit(failed ? 1 : 0);
};

void main();
