/**
 * Invisible Flow — Phase 6 pipeline-wiring harness (the ship gate, design doc §9 row 6, §10).
 *
 *   pnpm --filter flow-spike run phase6
 *
 * Proves, HEADLESSLY, the export→deploy→bake→register round-trip that makes a FlowDoc SHIP:
 * a doc authored online survives the SAME serialize contract the export/bake use
 * (`normalizeFlowDoc`), lands in the baked-bundle `flow` slot, and is what the game's
 * `loadFlowDoc()` returns — driving an ACTIVE interpreter; an ABSENT baked flow ⇒ `loadFlowDoc()`
 * returns `undefined` ⇒ the interpreter is INERT ⇒ the coded mounting + `bookEventHandlerMap`
 * run, byte-identical to current `main` (the §7 fall-through invariant, RULE 8).
 *
 * It models the EXACT runtime resolution `apps/lines/src/game/flowRuntime.svelte.ts#loadFlowDoc`
 * implements — dev hooks first, then the baked `BakedBundle.flow` slot — and the
 * `editor-scenes.ts#bakedFlowDoc()` runtime→baked→undefined gate, then drives the REAL
 * `engine-flow` interpreter to assert active-vs-inert. It uses the REAL `LINES_FLOW_DOC`
 * (the committed apps/lines fixture) as the authored doc, so the same doc that ships is tested.
 *
 * Checks:
 *  1. EXPORT/BAKE serialize contract — the authored doc survives `normalizeFlowDoc` (what the
 *     export writes to deploy/ + the bake embeds) idempotently, with all screens/events intact.
 *  2. REGISTER — baked PRESENT ⇒ `loadFlowDoc()` returns the doc ⇒ interpreter `isActive`.
 *  3. FALL-THROUGH — baked ABSENT (the checked-in `doc:null` placeholder) ⇒ `loadFlowDoc()`
 *     returns undefined ⇒ interpreter inert (no FlowDoc) ⇒ coded path.
 *  4. EMPTY flow — an authored-but-empty doc (no screens/transitions/events) is treated as
 *     absent by the bake's `authored` gate, so the bundle omits `flow` (parity).
 *  5. DEV-HOOK precedence — a `__IE_FLOW_DOC__`/`__IE_FLOW_LINES__` override wins over the baked
 *     slot (the live-verify escape hatch), and a hook with NO baked doc still activates.
 *  6. TRANSITIONS-ONLY — a degenerate doc (only edges, referencing screens that don't exist) is
 *     un-authored: the bake omits `flow` AND the interpreter is inert, the SAME `isAuthoredFlow`
 *     gate on both sides so the ship gate never diverges from `isActive` (parity, §7).
 */

import { createEventEmitter } from 'utils-event-emitter';
import {
	createFlowInterpreter,
	isAuthoredFlow,
	normalizeFlowDoc,
	type FlowDoc,
	type FlowRuntime,
} from 'engine-flow';

import { LINES_FLOW_DOC } from '../../apps/lines/src/game/flowDoc';

// ---------------------------------------------------------------------------
// Model of the ship chain — kept faithful to the real launcher + game code.
// ---------------------------------------------------------------------------

/** Mirror of `apps/launcher-api/src/lib/server/flowExport.ts#exportEditorFlow` + the bake's
 *  embed gate: read the authored doc, normalize it (the deploy/bake serialize contract), and
 *  embed it as `BakedBundle.flow` ONLY when authored. Returns the baked-bundle `flow` slot.
 *  Uses the REAL `isAuthoredFlow` — the SAME gate the interpreter's `isActive` keys on, so a
 *  transitions-only (degenerate) doc bakes no slot AND runs inert, never diverging (§7). */
const exportThenBake = (authoredFromR2: unknown): FlowDoc | undefined => {
	const exported = normalizeFlowDoc(authoredFromR2, 'lines'); // deploy/flow.json
	if (!isAuthoredFlow(exported)) return undefined; // bake omits `flow`
	// The bake JSON-roundtrips the embedded doc into baked-editor-bundle.json; reproduce that.
	return JSON.parse(JSON.stringify(exported)) as FlowDoc;
};

/** Mirror of `apps/lines/src/editor-scenes.ts#bakedFlowDoc()` (the baked-bundle gate) +
 *  `flowRuntime.svelte.ts#loadFlowDoc()` (dev hooks first, then baked). */
const loadFlowDoc = (opts: {
	bakedFlow: FlowDoc | undefined;
	devOverride?: FlowDoc;
	devLines?: boolean;
}): FlowDoc | undefined => {
	if (opts.devOverride) return opts.devOverride;
	if (opts.devLines) return LINES_FLOW_DOC;
	return opts.bakedFlow;
};

// ---------------------------------------------------------------------------
// Minimal recording runtime — the interpreter only needs these to be active.
// ---------------------------------------------------------------------------
type EmitterEvent = { type: string } & Record<string, unknown>;

const makeRuntime = (): FlowRuntime => {
	const { eventEmitter } = createEventEmitter<EmitterEvent>();
	return {
		emitter: {
			broadcast: (e) => eventEmitter.broadcast(e),
			broadcastAsync: (e) => eventEmitter.broadcastAsync(e),
		},
		timeScale: () => 1,
		waitForTimeout: () => Promise.resolve(),
		effect: () => Promise.resolve(),
	};
};

const buildInterpreter = (flowDoc: FlowDoc | undefined) =>
	createFlowInterpreter<EmitterEvent, unknown>({
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

console.info('\nInvisible Flow — Phase 6 pipeline round-trip\n');

// 1. EXPORT/BAKE serialize contract — authored doc survives normalize idempotently.
console.info('1. export/bake serialize contract');
const baked = exportThenBake(JSON.parse(JSON.stringify(LINES_FLOW_DOC)));
check('authored LINES_FLOW_DOC produces a non-empty baked `flow` slot', !!baked);
check(
	're-normalizing the baked slot is idempotent (canonical)',
	JSON.stringify(normalizeFlowDoc(baked, 'lines')) === JSON.stringify(baked),
);
check(
	'every authored event survives the round-trip',
	(baked?.events?.length ?? 0) === (LINES_FLOW_DOC.events?.length ?? 0),
);
check(
	'every authored screen survives the round-trip',
	(baked?.screens?.length ?? 0) === (LINES_FLOW_DOC.screens?.length ?? 0),
);

// 2. REGISTER — baked PRESENT ⇒ loadFlowDoc returns it ⇒ interpreter active.
console.info('\n2. register — baked present ⇒ interpreter active');
const loadedFromBake = loadFlowDoc({ bakedFlow: baked });
check('loadFlowDoc() returns the baked doc', loadedFromBake === baked);
check('interpreter built from the baked doc is ACTIVE', buildInterpreter(loadedFromBake).isActive);

// 3. FALL-THROUGH — baked ABSENT (the doc:null placeholder) ⇒ undefined ⇒ inert/coded.
console.info('\n3. fall-through — baked absent ⇒ interpreter inert (coded path, §7)');
const loadedNoBake = loadFlowDoc({ bakedFlow: undefined });
check('loadFlowDoc() returns undefined with no baked flow', loadedNoBake === undefined);
check('interpreter with no FlowDoc is INERT', !buildInterpreter(loadedNoBake).isActive);

// 4. EMPTY flow — authored-but-empty ⇒ bake omits `flow` ⇒ absent ⇒ inert.
console.info('\n4. empty authored flow ⇒ bake omits `flow` (parity)');
const emptyBaked = exportThenBake({ version: 1, screens: [], transitions: [], events: [] });
check('an empty authored doc bakes NO `flow` slot', emptyBaked === undefined);
check(
	'interpreter is inert for an empty authored doc',
	!buildInterpreter(loadFlowDoc({ bakedFlow: emptyBaked })).isActive,
);

// 5. DEV-HOOK precedence — overrides win over the baked slot; hook-only still activates.
console.info('\n5. dev-hook escape hatches');
const adHoc: FlowDoc = normalizeFlowDoc(
	{ version: 1, screens: [], transitions: [], events: LINES_FLOW_DOC.events?.slice(0, 1) ?? [] },
	'lines',
);
check(
	'__IE_FLOW_DOC__ override wins over the baked slot',
	loadFlowDoc({ bakedFlow: baked, devOverride: adHoc }) === adHoc,
);
check(
	'__IE_FLOW_LINES__ activates with NO baked doc',
	buildInterpreter(loadFlowDoc({ bakedFlow: undefined, devLines: true })).isActive,
);

// 6. TRANSITIONS-ONLY doc ⇒ degenerate ⇒ treated as un-authored (no slot) ⇒ inert.
console.info('\n6. transitions-only doc ⇒ un-authored (parity)');
const transitionsOnly = exportThenBake({
	version: 1,
	screens: [],
	transitions: [{ id: 't', from: 'a', to: 'b', trigger: { kind: 'complete' } }],
	events: [],
});
check('a transitions-only doc bakes NO `flow` slot', transitionsOnly === undefined);
check(
	'interpreter is inert for a transitions-only doc',
	!buildInterpreter(loadFlowDoc({ bakedFlow: transitionsOnly })).isActive,
);

// ---------------------------------------------------------------------------
console.info(
	failures === 0
		? '\nPHASE 6 PIPELINE: PASSED — FlowDoc ships via bake; absent ⇒ inert/coded.\n'
		: `\nPHASE 6 PIPELINE: ${failures} FAILURE(S).\n`,
);
process.exit(failures === 0 ? 0 : 1);
