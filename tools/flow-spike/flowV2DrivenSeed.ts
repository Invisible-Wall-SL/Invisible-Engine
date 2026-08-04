/**
 * Invisible Flow v2 — DRIVEN NEW-PROJECT SEED harness.
 *
 *   pnpm --filter flow-spike run v2drivenseed
 *
 * Proves, HEADLESSLY over the REAL `engine-flow-v2` modules, that `BOOK_OF_DRIVEN_SEED_DOC` (the doc
 * a fresh project is seeded with) is a genuine fully-flow-driven lifecycle referencing ONLY canonical
 * scaffold scene ids — so a new project shows reel + HUD + free-spins out of the box.
 *
 * Assertions:
 *   1. It DRIVES SCREENS (`flowScreenDrivingStatus.drivesScreens === true`) and is NOT `halfOn`, so
 *      the FIX-1 half-on guard never fires on it.
 *   2. It OWNS `load` (via a wired gameSignals pin), so `<FlowV2Mount>` is the sole screen renderer.
 *   3. Its show/hide set COVERS every screen that must be visible — basegame + hudBar + hudCorners +
 *      the free-spin screens + specialBook — and references ONLY canonical scaffold ids (no Borut
 *      custom ids leaked through).
 *   4. Every `showContainer`/`hideContainer`/`complete:<id>` ref resolves to a declared container
 *      (the `containers` array is complete) — and the loading→game transition exists on BOTH the
 *      `complete:loading` (auto-advance) and `tapToStart` paths.
 *   5. `validateFlowDoc` reports NO errors (warnings tolerated), and it owns every book event it
 *      authors (reveal/winInfo/… via gameSignals) so v2 drives their presentation.
 *   6. Actually MOUNTS at runtime: dispatching `load` then `complete:loading` through a recording
 *      env leaves basegame + hudBar + hudCorners (+ overlays) shown.
 *
 * Prints PASS/FAIL per assertion + a final `V2 DRIVEN SEED HARNESS: PASSED`.
 */

import {
	BOOK_OF_DRIVEN_SEED_CONTAINER_EVENTS,
	BOOK_OF_DRIVEN_SEED_DOC,
	BOOK_OF_DRIVEN_SEED_LIBRARY,
	BOOK_OF_VOCAB,
	createContainerMountModel,
	createFlowV2Env,
	flowOwnsSignal,
	flowScreenDrivingStatus,
	runFlowEvent,
	validateFlowDoc,
	type FlowV2Env,
	type RunContext,
} from 'engine-flow-v2';

let failures = 0;
const check = (label: string, cond: boolean): void => {
	console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
	if (!cond) failures += 1;
};

const doc = BOOK_OF_DRIVEN_SEED_DOC;
const CANONICAL = new Set([
	'loading',
	'basegame',
	'hudBar',
	'hudCorners',
	'specialBook',
	'freeSpinCounter',
	'freeSpinIntro',
	'freeSpinOutro',
	// The buy-bonus takeovers (Phase 3 Step 5) — canonical scenes every reference layout seeds
	// (`buyFeatureScene.ts` / `confirmScene.ts`), shown/hidden by the seed's buy subgraph.
	'buyFeature',
	'buyConfirm',
]);

// --- 1 + 2. Drives screens, not half-on, owns load --------------------------
const status = flowScreenDrivingStatus(doc);
check('drivesScreens === true', status.drivesScreens === true);
check('halfOn === false (FIX-1 guard never fires on the seed)', status.halfOn === false);
check('hasContainerNodes === true', status.hasContainerNodes === true);
check('owns `load` via a wired gameSignals pin', flowOwnsSignal(doc, 'load') === true);

// --- 3. Show set covers the required screens, only canonical ids ------------
const showRefs = new Set(
	doc.graph.nodes.filter((n) => n.kind === 'showContainer').map((n) => n.ref),
);
const hideRefs = new Set(
	doc.graph.nodes.filter((n) => n.kind === 'hideContainer').map((n) => n.ref),
);
for (const id of [
	'basegame',
	'hudBar',
	'hudCorners',
	'specialBook',
	'freeSpinCounter',
	'freeSpinIntro',
	'freeSpinOutro',
	'loading',
]) {
	check(`shows canonical screen: ${id}`, showRefs.has(id));
}
const allContainerRefs = [...showRefs, ...hideRefs];
check(
	'every container ref is a CANONICAL scaffold id (no Borut custom ids)',
	allContainerRefs.every((r) => CANONICAL.has(r)),
);

// --- 4. Container completeness + both loading→game triggers -----------------
const declared = new Set(doc.containers.map((c) => c.id));
check(
	'every show/hide ref is a declared container',
	allContainerRefs.every((r) => declared.has(r)),
);
const completeLoading = doc.graph.nodes.some(
	(n) => n.kind === 'event' && n.ref === 'complete:loading',
);
check('has a `complete:loading` transition (loading-bar auto-advance path)', completeLoading);
check('has a `tapToStart` transition (tap-to-start path)', flowOwnsSignal(doc, 'tapToStart'));
check('hides `loading` on the transition', hideRefs.has('loading'));

// --- 5. Validation + book-event ownership -----------------------------------
const issues = validateFlowDoc(
	doc,
	BOOK_OF_VOCAB,
	BOOK_OF_DRIVEN_SEED_LIBRARY,
	BOOK_OF_DRIVEN_SEED_CONTAINER_EVENTS,
);
const errors = issues.filter((i) => i.severity === 'error');
if (errors.length)
	for (const e of errors) console.log(`   validation error: ${e.code} — ${e.message}`);
check('validateFlowDoc reports NO errors', errors.length === 0);
for (const ev of [
	'reveal',
	'winInfo',
	'setTotalWin',
	'setExpandingSymbol',
	'freeSpinTrigger',
	'updateFreeSpin',
	'freeSpinEnd',
	'setWin',
]) {
	check(`owns book event: ${ev}`, flowOwnsSignal(doc, ev));
}

// --- 6. Runtime mount: load → complete:loading leaves the game shown --------
const mount = createContainerMountModel(
	doc.containers.map((c) => ({ id: c.id, sceneId: c.sceneId, z: c.z })),
);
const noop = () => undefined;
const env: FlowV2Env = createFlowV2Env({
	mount,
	effect: () => noop,
	broadcast: () => Promise.resolve(),
	waitForTimeout: () => Promise.resolve(),
	timeScale: () => 1,
	engineRead: () => undefined,
});
const ctx: RunContext = { vocab: BOOK_OF_VOCAB, library: BOOK_OF_DRIVEN_SEED_LIBRARY, env };

await runFlowEvent(doc, ctx, 'load', {});
check('after `load`: loading is shown', mount.isShown('loading'));
await runFlowEvent(doc, ctx, 'complete:loading', {});
check('after `complete:loading`: loading hidden', !mount.isShown('loading'));
for (const id of [
	'basegame',
	'hudBar',
	'hudCorners',
	'specialBook',
	'freeSpinCounter',
	'freeSpinIntro',
	'freeSpinOutro',
]) {
	check(`after complete:loading: ${id} is shown`, mount.isShown(id));
}

console.log('');
if (failures === 0) console.log('V2 DRIVEN SEED HARNESS: PASSED');
else {
	console.log(`V2 DRIVEN SEED HARNESS: FAILED (${failures} assertion(s))`);
	process.exit(1);
}
