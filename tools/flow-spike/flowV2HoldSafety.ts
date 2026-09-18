/**
 * Invisible Flow v2 — AUTHORING-TIME HOLD SAFETY harness (`hold-without-release` / `tap-without-hold`).
 *
 *   pnpm --filter flow-spike run v2holdsafety
 *
 * `showContainer{awaitComplete}` blocks the exec chain — and the book pump awaiting it — until the
 * container completes, and there is deliberately NO runtime timeout (a player who walks away
 * mid-free-spin-outro should find the screen still up). So a hold nothing can release is a round that
 * hangs forever, and the only place to catch it is authoring time.
 *
 * Asserted here:
 *   1. the RUNTIME hang is real — the flagged doc genuinely never runs the node after the hold;
 *   2. `hold-without-release` (ERROR) fires on exactly that doc;
 *   3. it does NOT fire when any of the three releases exists, each tested separately:
 *        (a) a tap-to-continue on the container's own scene (`containerTaps[ref] === true`),
 *        (b) a `hideContainer` for it that can still run while the chain is held — including one
 *            reached through a shared FUNCTION — and, the flip side, that a hide sitting DOWNSTREAM
 *            of the hold does not count (it can never run, which is the whole failure mode),
 *        (c) an authored `complete:<id>` event entry;
 *   4. NEVER GUESS — an empty/absent `containerTaps` map produces NO issues at all, so an unsaved or
 *      standalone project is never reddened by a check that has nothing to read;
 *   5. `tap-without-hold` (INFO) fires for a tap surface nothing waits for, and stays silent when a
 *      hold or a `complete:<id>` does wait for it.
 *
 * (3b) is also driven through the interpreter: a hide dispatched on a SECOND event really does
 * release a pending hold, which is why a reachable one counts as a release.
 */

import {
	createContainerMountModel,
	createFlowV2Env,
	runFlowEvent,
	validateFlowDoc,
	type ContainerRef,
	type FlowDoc,
	type FlowIssue,
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
const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const codes = (issues: FlowIssue[]): string =>
	issues.map((i) => `${i.code}:${i.severity}`).join(' | ');
const has = (issues: FlowIssue[], code: string): boolean => issues.some((i) => i.code === code);

const CONTAINERS: ContainerRef[] = [
	{ id: 'base', sceneId: 'basegame', z: 0 },
	{ id: 'intro', sceneId: 'freeSpinIntro', z: 50 },
];
const EMPTY_LIBRARY: FunctionLibraryDoc = { version: 2, functions: [] };
const VOCAB: TemplateVocabulary = {
	templateId: 'book-of',
	structs: [],
	enums: [],
	events: [
		{ name: 'startFs', payload: [] },
		{ name: 'endFs', payload: [] },
	],
	actions: [{ name: 'afterHold', params: [], category: 'effect' }],
	cues: [],
	collections: [],
};

type Extra = { nodes?: FlowDoc['graph']['nodes']; exec?: FlowDoc['graph']['exec'] };

/** startFs → showContainer(intro){awaitComplete} → hideContainer(intro) → afterHold.
 *  The canonical authored shape: the in-chain hide runs AFTER the tap, so it can never be the
 *  release. `extra` splices in whatever release a case is testing. */
const makeDoc = (awaitComplete: boolean, extra: Extra = {}): FlowDoc => ({
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
			...(extra.nodes ?? []),
		],
		exec: [
			{ from: { node: 'onStart', pin: 'exec' }, to: { node: 'showIntro', pin: 'exec' } },
			{ from: { node: 'showIntro', pin: 'exec' }, to: { node: 'hideIntro', pin: 'exec' } },
			{ from: { node: 'hideIntro', pin: 'exec' }, to: { node: 'after', pin: 'exec' } },
			...(extra.exec ?? []),
		],
		data: [],
	},
	containers: CONTAINERS,
});

/** A SECOND chain that hides the held container — the release that CAN run while the hold is pending. */
const EXTERNAL_HIDE: Extra = {
	nodes: [
		{ id: 'onEnd', kind: 'event', pos: { x: 0, y: 200 }, ref: 'endFs' },
		{ id: 'hideExternal', kind: 'hideContainer', pos: { x: 200, y: 200 }, ref: 'intro' },
	],
	exec: [{ from: { node: 'onEnd', pin: 'exec' }, to: { node: 'hideExternal', pin: 'exec' } }],
};

/** The same release, but buried in a shared FUNCTION body — invisible to a graph-only scan. */
const HIDE_FN_LIBRARY: FunctionLibraryDoc = {
	version: 2,
	functions: [
		{
			id: 'fn_dismiss',
			name: 'Dismiss intro',
			requires: {},
			inputs: [{ id: 'exec', dir: 'in', kind: 'exec' }],
			outputs: [{ id: 'exec', dir: 'out', kind: 'exec' }],
			body: {
				nodes: [
					{ id: 'fnEntry', kind: 'functionEntry', pos: { x: 0, y: 0 }, ref: 'fn_dismiss' },
					{ id: 'fnHide', kind: 'hideContainer', pos: { x: 200, y: 0 }, ref: 'intro' },
					{ id: 'fnResult', kind: 'functionResult', pos: { x: 400, y: 0 }, ref: 'fn_dismiss' },
				],
				exec: [
					{ from: { node: 'fnEntry', pin: 'exec' }, to: { node: 'fnHide', pin: 'exec' } },
					{ from: { node: 'fnHide', pin: 'exec' }, to: { node: 'fnResult', pin: 'exec' } },
				],
				data: [],
			},
		},
	],
};
const EXTERNAL_HIDE_VIA_FUNCTION: Extra = {
	nodes: [
		{ id: 'onEnd', kind: 'event', pos: { x: 0, y: 200 }, ref: 'endFs' },
		{ id: 'callDismiss', kind: 'functionCall', pos: { x: 200, y: 200 }, ref: 'fn_dismiss' },
	],
	exec: [{ from: { node: 'onEnd', pin: 'exec' }, to: { node: 'callDismiss', pin: 'exec' } }],
};

/** The HANDOFF shape: a dedicated `complete:<id>` entry the tap dispatcher fires. */
const COMPLETE_ENTRY: Extra = {
	nodes: [{ id: 'onComplete', kind: 'event', pos: { x: 0, y: 400 }, ref: 'complete:intro' }],
};

const makeCtx = () => {
	const mount = createContainerMountModel(CONTAINERS);
	const ran: string[] = [];
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
	console.log('Invisible Flow v2 — authoring-time hold safety\n');

	// --- 1. the hang the check exists for is REAL -----------------------------------------
	console.log('1. the flagged doc genuinely hangs (no tap, no reachable release):');
	{
		const { mount, ran, ctx } = makeCtx();
		let resolved = false;
		void runFlowEvent(makeDoc(true), ctx, 'startFs', {}).then(() => (resolved = true));
		await tick();
		assert(
			'intro mounted and the chain is blocked at the hold',
			mount.isShown('intro') && ran.length === 0,
		);
		assert('the dispatch never resolves — the round would hang forever', !resolved);
		assert('the in-chain hide never runs (so it can never be the release)', mount.isShown('intro'));
	}

	// --- 2. the ERROR fires on exactly that doc --------------------------------------------
	console.log('\n2. hold-without-release (ERROR) fires on the genuine hang:');
	{
		const issues = validateFlowDoc(makeDoc(true), VOCAB, EMPTY_LIBRARY, undefined, {
			base: false,
			intro: false,
		});
		const issue = issues.find((i) => i.code === 'hold-without-release');
		assert(
			'one hold-without-release issue',
			issues.filter((i) => i.code === 'hold-without-release').length === 1,
			codes(issues),
		);
		assert('it is an ERROR', issue?.severity === 'error');
		assert('it points at the show node', issue?.at.on === 'node' && issue.at.node === 'showIntro');
		assert(
			'a doc with no awaitComplete is silent',
			!has(
				validateFlowDoc(makeDoc(false), VOCAB, EMPTY_LIBRARY, undefined, {
					base: false,
					intro: false,
				}),
				'hold-without-release',
			),
		);
	}

	// --- 3. each of the three releases, separately ------------------------------------------
	console.log('\n3. it does NOT fire when a release exists (all three, separately):');
	{
		// (a) the container's own scene carries a tap-to-continue.
		const tapped = validateFlowDoc(makeDoc(true), VOCAB, EMPTY_LIBRARY, undefined, {
			base: false,
			intro: true,
		});
		assert(
			'(a) tap-to-continue on the container ⇒ no error',
			!has(tapped, 'hold-without-release'),
			codes(tapped),
		);

		// (b) a hideContainer on ANOTHER chain, which can still run while the hold is pending.
		const external = validateFlowDoc(
			makeDoc(true, EXTERNAL_HIDE),
			VOCAB,
			EMPTY_LIBRARY,
			undefined,
			{
				base: false,
				intro: false,
			},
		);
		assert(
			'(b) a reachable hideContainer ⇒ no error',
			!has(external, 'hold-without-release'),
			codes(external),
		);

		// (b′) the same hide, inside a shared function body.
		const viaFn = validateFlowDoc(
			makeDoc(true, EXTERNAL_HIDE_VIA_FUNCTION),
			VOCAB,
			HIDE_FN_LIBRARY,
			undefined,
			{ base: false, intro: false },
		);
		assert(
			"(b′) a hide inside a called FUNCTION's body ⇒ no error",
			!has(viaFn, 'hold-without-release'),
			codes(viaFn),
		);

		// (b″) the flip side: the in-chain hide is DOWNSTREAM of the hold, so it is not a release —
		// that is case 2 above, re-stated as the rule it depends on.
		const blocked = validateFlowDoc(makeDoc(true), VOCAB, EMPTY_LIBRARY, undefined, {
			intro: false,
		});
		assert(
			'(b″) a hide DOWNSTREAM of the hold is not counted',
			has(blocked, 'hold-without-release'),
		);

		// (c) the `complete:<id>` handoff entry.
		const handoff = validateFlowDoc(
			makeDoc(true, COMPLETE_ENTRY),
			VOCAB,
			EMPTY_LIBRARY,
			undefined,
			{
				base: false,
				intro: false,
			},
		);
		assert(
			'(c) a complete:<id> event ⇒ no error',
			!has(handoff, 'hold-without-release'),
			codes(handoff),
		);
	}

	// (b) is a release because a hide REALLY does resolve a pending hold — drive it.
	console.log('\n3d. the reachable hide releases the hold at runtime (why it counts):');
	{
		const { mount, ran, ctx } = makeCtx();
		const doc = makeDoc(true, EXTERNAL_HIDE);
		let resolved = false;
		const held = runFlowEvent(doc, ctx, 'startFs', {}).then(() => (resolved = true));
		await tick();
		assert('held before the second event', !resolved && ran.length === 0 && mount.isShown('intro'));
		await runFlowEvent(doc, ctx, 'endFs', {});
		await held;
		assert('the external hide resumed the held chain', resolved && ran.length === 1);
	}

	// --- 4. NEVER GUESS: no map ⇒ no issues --------------------------------------------------
	console.log('\n4. an unresolved container is never guessed at:');
	{
		const noMap = validateFlowDoc(makeDoc(true), VOCAB, EMPTY_LIBRARY);
		assert(
			'no containerTaps argument ⇒ no hold issues',
			!has(noMap, 'hold-without-release') && !has(noMap, 'tap-without-hold'),
			codes(noMap),
		);

		const emptyMap = validateFlowDoc(makeDoc(true), VOCAB, EMPTY_LIBRARY, undefined, {});
		assert(
			'an EMPTY map (unsaved project) ⇒ no hold issues',
			!has(emptyMap, 'hold-without-release') && !has(emptyMap, 'tap-without-hold'),
			codes(emptyMap),
		);

		const otherOnly = validateFlowDoc(makeDoc(true), VOCAB, EMPTY_LIBRARY, undefined, {
			base: false,
		});
		assert(
			'a map that resolved OTHER containers only ⇒ still silent for this one',
			!has(otherOnly, 'hold-without-release'),
			codes(otherOnly),
		);

		assert(
			'and the rest of the validator is unaffected (the doc is otherwise clean)',
			validateFlowDoc(makeDoc(true), VOCAB, EMPTY_LIBRARY).length === 0,
			codes(noMap),
		);
	}

	// --- 5. the mirror: a tap nothing waits for ----------------------------------------------
	console.log('\n5. tap-without-hold (INFO) — an authored tap surface nothing waits for:');
	{
		const issues = validateFlowDoc(makeDoc(false), VOCAB, EMPTY_LIBRARY, undefined, {
			intro: true,
		});
		const issue = issues.find((i) => i.code === 'tap-without-hold');
		assert(
			'one tap-without-hold issue',
			issues.filter((i) => i.code === 'tap-without-hold').length === 1,
			codes(issues),
		);
		assert(
			'it is INFO, not a warning (the tap still emits its signal)',
			issue?.severity === 'info',
		);
		assert('it points at the show node', issue?.at.on === 'node' && issue.at.node === 'showIntro');

		const held = validateFlowDoc(makeDoc(true), VOCAB, EMPTY_LIBRARY, undefined, { intro: true });
		assert('a hold DOES wait for it ⇒ silent', !has(held, 'tap-without-hold'), codes(held));

		const handoff = validateFlowDoc(
			makeDoc(false, COMPLETE_ENTRY),
			VOCAB,
			EMPTY_LIBRARY,
			undefined,
			{
				intro: true,
			},
		);
		assert(
			'a complete:<id> entry waits for it ⇒ silent',
			!has(handoff, 'tap-without-hold'),
			codes(handoff),
		);

		const noTap = validateFlowDoc(makeDoc(false), VOCAB, EMPTY_LIBRARY, undefined, {
			intro: false,
		});
		assert('no tap on the scene ⇒ silent', !has(noTap, 'tap-without-hold'), codes(noTap));
	}

	console.log(`\n${failed ? 'V2 HOLD SAFETY HARNESS: FAILED' : 'V2 HOLD SAFETY HARNESS: PASSED'}`);
	process.exit(failed ? 1 : 0);
};

void main();
