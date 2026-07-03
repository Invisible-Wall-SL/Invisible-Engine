/**
 * Invisible Flow — Phase 9 / §11.8 step 6 full-chain harness (design doc §11.7 — the ship gate).
 *
 *   pnpm --filter flow-spike run valuechain
 *
 * Proves, HEADLESSLY, that a `value` binding edge SURVIVES the whole deploy→bake→register→interpreter
 * chain intact — the audit's claim (every serializer is a pass-through; the only normalizer is
 * engine-flow's `normalizeFlowDoc`, which handles the `value` case since step 1) turned into a
 * green assertion, so a silent drop that looks fine in `/flow` but ships nothing can't regress.
 *
 * It models the SAME chain `phase6Pipeline.ts` does, faithful to the real launcher + game code:
 *   - EXPORT   — `flowExport.ts#exportEditorFlow` re-normalizes via `normalizeFlowDoc` (deploy/flow.json).
 *   - BAKE     — `bake-editor-doc.mjs` embeds the exported `flow` VERBATIM (`flow = fd`), gated only by
 *                the hand-rolled `isAuthoredFlow` copy (reads screens/events lengths, never triggers).
 *   - REGISTER — `editor-scenes.ts#bakedFlowDoc()` returns the baked `flow` verbatim (typed FlowDoc).
 *   - RUNTIME  — `flowRuntime.svelte.ts#loadFlowDoc()` → `createFlowInterpreter` → `resolveValueSource`.
 *
 * Checks:
 *  1. A `value` edge survives export/bake (the serialize contract) idempotently, `producer` + `sink` intact.
 *  2. After the FULL chain, the interpreter's `resolveValueSource(sinkInstanceId, sinkSource)` returns the
 *     `producer` feed (the override), and an UNWIRED display returns its own `source` (parity).
 *  3. A PARTIAL value trigger (missing `sink.instanceId`) is DROPPED by the chain's normalize, without
 *     corrupting the valid sibling — the same drop-partials discipline `normalize.ts` enforces.
 *  4. A doc whose ONLY authored content is a value edge (screens present, no events) still bakes + activates
 *     (the `isAuthoredFlow` gate keys on screens, which a producer-host + display screen provide).
 */

import {
	createFlowInterpreter,
	isAuthoredFlow,
	normalizeFlowDoc,
	type FlowDoc,
	type FlowRuntime,
} from 'engine-flow';

// ---------------------------------------------------------------------------
// Chain model — identical shape to phase6Pipeline.ts (kept faithful to the real code).
// ---------------------------------------------------------------------------

/** EXPORT (`flowExport.ts`) + the bake's embed gate (`bake-editor-doc.mjs` `flow = fd`, gated by
 *  `isAuthoredFlow`). Returns the baked-bundle `flow` slot, JSON-roundtripped as the bake embeds it. */
const exportThenBake = (authoredFromR2: unknown): FlowDoc | undefined => {
	const exported = normalizeFlowDoc(authoredFromR2, 'lines'); // deploy/flow.json (the serialize contract)
	if (!isAuthoredFlow(exported)) return undefined; // bake omits `flow`
	return JSON.parse(JSON.stringify(exported)) as FlowDoc; // embedded in baked-editor-bundle.json
};

/** REGISTER (`editor-scenes.ts#bakedFlowDoc`) + RUNTIME resolution (`flowRuntime.svelte.ts#loadFlowDoc`,
 *  baked slot with no dev hook). A pass-through — the baked `flow` is returned verbatim. */
const loadFlowDoc = (bakedFlow: FlowDoc | undefined): FlowDoc | undefined => bakedFlow;

const makeRuntime = (): FlowRuntime => ({
	emitter: { broadcast: () => {}, broadcastAsync: () => Promise.resolve([]) },
	timeScale: () => 1,
	waitForTimeout: () => Promise.resolve(),
});

const buildInterpreter = (flowDoc: FlowDoc | undefined) =>
	createFlowInterpreter<{ type: string }, unknown>({
		flowDoc,
		runtime: makeRuntime(),
		resolveScene: () => undefined,
		codedHandlers: {},
	});

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------
let failures = 0;
const check = (label: string, cond: boolean) => {
	if (cond) {
		console.info(`  ✓ ${label}`);
	} else {
		failures++;
		console.error(`  ✖ ${label}`);
	}
};

console.info('\nInvisible Flow — Phase 9 value-edge full-chain (§11.7)\n');

// An authored FlowDoc with a producer-host base game + a HUD display, and a value edge rebinding the
// HUD "win" readout to the `totalWin` feed. The shape the owner authors in /flow + saves to R2.
const authored: FlowDoc = {
	version: 1,
	projectKey: 'lines',
	screens: [{ id: 'basegame', initial: true }, { id: 'hud' }],
	transitions: [
		{
			id: 't_value',
			from: 'basegame',
			to: 'hud',
			trigger: {
				kind: 'value',
				producer: 'totalWin',
				sink: { instanceId: 'inst_win', source: 'win' },
			},
			fromPin: 'basegame::produces:totalWin',
			toPin: 'inst_win::value:win',
		},
	],
};

// 1. The value edge survives export/bake (serialize contract) idempotently.
console.info('1. export/bake — the value edge survives the serialize contract');
const baked = exportThenBake(JSON.parse(JSON.stringify(authored)));
check('authored doc with a value edge bakes a non-empty `flow` slot', !!baked);
const bakedEdge = baked?.transitions.find((t) => t.id === 't_value');
check(
	'the value trigger survives export/bake with producer + sink intact',
	bakedEdge?.trigger.kind === 'value' &&
		bakedEdge.trigger.producer === 'totalWin' &&
		bakedEdge.trigger.sink.instanceId === 'inst_win' &&
		bakedEdge.trigger.sink.source === 'win',
);
check(
	're-normalizing the baked slot is idempotent (canonical)',
	JSON.stringify(normalizeFlowDoc(baked, 'lines')) === JSON.stringify(baked),
);
check(
	'the authoring-only fromPin/toPin also survive (editor re-render on reload)',
	bakedEdge?.fromPin === 'basegame::produces:totalWin' &&
		bakedEdge?.toPin === 'inst_win::value:win',
);

// 2. After the FULL chain, the interpreter resolves the override; an unwired display keeps its source.
console.info(
	'\n2. register→runtime — resolveValueSource returns the override after the full chain',
);
const shipped = buildInterpreter(loadFlowDoc(baked));
check('shipped interpreter is ACTIVE (baked value-edge doc)', shipped.isActive);
check(
	'the rebound display resolves to the producer feed (totalWin)',
	shipped.resolveValueSource('inst_win', 'win') === 'totalWin',
);
check(
	'an UNWIRED display resolves to its own source verbatim (parity)',
	shipped.resolveValueSource('inst_balance', 'balance') === 'balance',
);

// 3. A partial value trigger is dropped by the chain, without corrupting the valid sibling.
console.info('\n3. partial value trigger ⇒ dropped by the chain (parity §11.6)');
const withPartial = exportThenBake({
	version: 1,
	screens: [{ id: 'basegame', initial: true }, { id: 'hud' }],
	transitions: [
		// missing sink.instanceId ⇒ dropped
		{
			id: 't_partial',
			from: 'basegame',
			to: 'hud',
			trigger: { kind: 'value', producer: 'totalWin', sink: { source: 'win' } },
		},
		// valid ⇒ survives. Producer (`bet`) DIFFERS from the sink source (`balance`) so a genuine
		// rebind is distinguishable from a source==producer coincidence.
		{
			id: 't_good',
			from: 'basegame',
			to: 'hud',
			trigger: {
				kind: 'value',
				producer: 'bet',
				sink: { instanceId: 'inst_bal', source: 'balance' },
			},
		},
	],
});
const survivingIds = (withPartial?.transitions ?? []).map((t) => t.id).sort();
check(
	'the partial value edge is dropped; the valid sibling survives',
	JSON.stringify(survivingIds) === JSON.stringify(['t_good']),
);
const partialInterp = buildInterpreter(loadFlowDoc(withPartial));
check(
	'the dropped edge does NOT rebind its would-be sink (falls back to source)',
	partialInterp.resolveValueSource('inst_win', 'win') === 'win',
);
check(
	'the valid sibling edge DOES rebind after the chain (balance → bet, a real override)',
	partialInterp.resolveValueSource('inst_bal', 'balance') === 'bet',
);

// 4. A value-edge-only authored doc (screens present, no events) still ships + activates.
console.info('\n4. value-edge-only doc (screens, no events) still ships');
const valueOnly = exportThenBake({
	version: 1,
	screens: [{ id: 'basegame', initial: true }, { id: 'hud' }],
	transitions: authored.transitions,
	events: [],
});
check('a value-edge-only doc bakes a `flow` slot (screens satisfy isAuthoredFlow)', !!valueOnly);
check(
	'and the shipped interpreter resolves its override',
	buildInterpreter(loadFlowDoc(valueOnly)).resolveValueSource('inst_win', 'win') === 'totalWin',
);

// ---------------------------------------------------------------------------
console.info(
	failures === 0
		? '\nPHASE 9 VALUE-CHAIN: PASSED — value edge ships intact; partials dropped.\n'
		: `\nPHASE 9 VALUE-CHAIN: ${failures} FAILURE(S).\n`,
);
process.exit(failures === 0 ? 0 : 1);
