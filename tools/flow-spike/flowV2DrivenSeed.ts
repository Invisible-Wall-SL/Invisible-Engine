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
 *      env leaves basegame + hudBar + hudCorners (+ the cue-driven overlays) shown — and NOT the
 *      round-holding free-spin intro/outro, which would leave a full-screen tap surface over idle.
 *   7. The free-spin intro / outro HOLD THE ROUND with no engine gate: against the REAL scaffold
 *      scenes the validator finds a release for every hold, and at runtime `freeSpinTrigger` /
 *      `freeSpinEnd` show their screen, block on it until it completes (the tap), then hide it. The
 *      intro mounts before its show cue; the outro after its (the driver resets the tap-arm latch
 *      there); the outro count-up is tap-to-skip, and the outro is a TWO-STAGE tap — the skip tap
 *      lands the total without dismissing it (its release straddles the tap arming), a second tap
 *      continues. A negative control replays the pre-fix mask, whose skip tap dismissed the outro.
 *
 * Prints PASS/FAIL per assertion + a final `V2 DRIVEN SEED HARNESS: PASSED`.
 */

import {
	BOOK_OF_DRIVEN_SEED_CONTAINER_EVENTS,
	BOOK_OF_DRIVEN_SEED_DOC,
	BOOK_OF_DRIVEN_SEED_LIBRARY,
	BOOK_OF_VOCAB,
	WAYS_DRIVEN_SEED_DOC,
	WAYS_VOCAB,
	awaitCompleteContainerIds,
	createContainerMountModel,
	createFlowV2Env,
	flowOwnsSignal,
	flowScreenDrivingStatus,
	runFlowEvent,
	validateFlowDoc,
	type FlowDoc,
	type FlowV2Env,
	type RunContext,
} from 'engine-flow-v2';
import { bookofReferenceLayout, waysReferenceLayout } from 'engine-layout';

import { collectContainerTaps } from '../../apps/launcher-api/src/lib/containerTaps';
import { createPressStarts } from '../../packages/components-layout/src/pressStarts';
import {
	registerContinuePress,
	runContinuePress,
	topContinuePress,
} from '../../packages/state-shared/src/continuePress';

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
for (const id of ['basegame', 'hudBar', 'hudCorners', 'specialBook', 'freeSpinCounter']) {
	check(`after complete:loading: ${id} is shown`, mount.isShown(id));
}
for (const id of ['freeSpinIntro', 'freeSpinOutro']) {
	check(`after complete:loading: ${id} is NOT shown (no tap surface at idle)`, !mount.isShown(id));
}

// --- 7. The intro / outro hold the round on their own tap -------------------------------------
{
	// Against the REAL scaffold scenes, every `showContainer{awaitComplete}` has a release.
	const holdsReleased = (
		seed: FlowDoc,
		vocab: typeof BOOK_OF_VOCAB,
		scenes: Parameters<typeof collectContainerTaps>[1],
	) => {
		const taps = collectContainerTaps(seed.containers, scenes);
		const holdErrors = validateFlowDoc(
			seed,
			vocab,
			BOOK_OF_DRIVEN_SEED_LIBRARY,
			BOOK_OF_DRIVEN_SEED_CONTAINER_EVENTS,
			taps,
		).filter((i) => i.code === 'hold-without-release');
		for (const e of holdErrors) console.log(`   ${e.code} — ${e.message}`);
		return { taps, holdErrors };
	};
	const book = holdsReleased(doc, BOOK_OF_VOCAB, bookofReferenceLayout().scenes);
	check(
		'book-of scaffold: freeSpinIntro scene can complete itself',
		book.taps.freeSpinIntro === true,
	);
	check(
		'book-of scaffold: freeSpinOutro scene can complete itself',
		book.taps.freeSpinOutro === true,
	);
	check('book-of seed: no hold-without-release against its scaffold', book.holdErrors.length === 0);
	const ways = holdsReleased(WAYS_DRIVEN_SEED_DOC, WAYS_VOCAB, waysReferenceLayout().scenes);
	check('ways seed: no hold-without-release against its scaffold', ways.holdErrors.length === 0);
	check(
		'the seed holds exactly on the intro + outro',
		[...awaitCompleteContainerIds(doc)].sort().join(',') === 'freeSpinIntro,freeSpinOutro',
	);

	// Runtime: each event shows its screen, blocks on it until completed, then hides it.
	const log: string[] = [];
	const payloads: Record<string, Record<string, unknown>> = {};
	const holdMount = createContainerMountModel(
		doc.containers.map((c) => ({ id: c.id, sceneId: c.sceneId, z: c.z })),
		undefined,
		awaitCompleteContainerIds(doc),
	);
	const holdEnv: FlowV2Env = createFlowV2Env({
		mount: {
			...holdMount,
			show: (id) => {
				log.push(`show ${id}`);
				holdMount.show(id);
			},
			hide: (id) => {
				log.push(`hide ${id}`);
				holdMount.hide(id);
			},
		},
		effect: (name) => (payload) => {
			payloads[name] = payload;
		},
		broadcast: (cue) => {
			log.push(`cue ${cue}`);
		},
		waitForTimeout: () => Promise.resolve(),
		timeScale: () => 1,
		engineRead: () => undefined,
	});
	const holdCtx: RunContext = {
		vocab: BOOK_OF_VOCAB,
		library: BOOK_OF_DRIVEN_SEED_LIBRARY,
		env: holdEnv,
	};
	const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

	const holds = async (event: string, screen: string, payload: Record<string, unknown>) => {
		log.length = 0;
		let done = false;
		const run = runFlowEvent(doc, holdCtx, event, payload).then(() => (done = true));
		await settle();
		check(`${event}: ${screen} is shown`, holdMount.isShown(screen));
		check(
			`${event}: the round HOLDS on ${screen}`,
			!done && holdMount.heldContainers().includes(screen),
		);
		holdMount.complete(screen);
		await run;
		check(`${event}: completing ${screen} resumes the chain`, done);
		check(`${event}: ${screen} is hidden afterwards`, !holdMount.isShown(screen));
	};

	await holds('freeSpinTrigger', 'freeSpinIntro', { positions: [], totalFs: 10 });
	check(
		'intro mounts BEFORE its `freeSpinIntroShow` cue',
		log.indexOf('show freeSpinIntro') < log.indexOf('cue freeSpinIntroShow'),
	);

	await holds('freeSpinEnd', 'freeSpinOutro', { amount: 5, winLevel: 3 });
	check(
		'outro mounts AFTER its `freeSpinOutroShow` cue (the driver resets the tap-arm latch there)',
		log.indexOf('cue freeSpinOutroShow') < log.indexOf('show freeSpinOutro'),
	);
	check(
		'outro count-up is TAP TO SKIP (the first tap lands the total)',
		payloads.freeSpinOutroCountUp?.tapToSkip === true,
	);

	// The two-stage tap, end to end: the REAL seed, interpreter and mount latch, with the engine's half
	// of the outro stood in by its pointer surfaces over the REAL press-start tracker and continue-press
	// registry. `FreeSpinOutroDriver` holds `freeSpinOutroCountUp` until the count lands; while it runs,
	// `CountUpInteraction` (tap-only) lands it on pointer-DOWN; landing arms the screen's tap
	// (`TapToContinue` → `PressToContinue`, whose tap completes the screen) and mounts
	// `ContinuePressMask` over everything. `shipped` replays the mask before the fix — every release
	// ran the newest press — as the negative control.
	const outroTaps = async (
		mask: 'fixed' | 'shipped',
		{ slowRelease }: { slowRelease: boolean },
	) => {
		const presses = createPressStarts<number | undefined>();
		let countUpDown: (() => void) | undefined;
		let unregisterTap: (() => void) | undefined;
		const tapMount = createContainerMountModel(
			doc.containers.map((c) => ({ id: c.id, sceneId: c.sceneId, z: c.z })),
			undefined,
			awaitCompleteContainerIds(doc),
		);
		const tapEnv = createFlowV2Env({
			mount: {
				...tapMount,
				hide: (id) => {
					if (id === 'freeSpinOutro') unregisterTap?.();
					tapMount.hide(id);
				},
			},
			effect: (name) =>
				name === 'freeSpinOutroCountUp'
					? (payload) =>
							new Promise<void>((release) => {
								const land = () => {
									countUpDown = undefined;
									unregisterTap = registerContinuePress(() => tapMount.complete('freeSpinOutro'));
									release();
								};
								countUpDown = payload.tapToSkip === true ? land : undefined;
							})
					: undefined,
			broadcast: () => {},
			waitForTimeout: () => Promise.resolve(),
			timeScale: () => 1,
			engineRead: () => undefined,
		});
		const down = () => {
			if (topContinuePress() === undefined) return countUpDown?.();
			if (mask === 'fixed') presses.down(1, topContinuePress());
		};
		const up = () => {
			if (topContinuePress() === undefined) return;
			if (mask === 'shipped') return runContinuePress(topContinuePress());
			const press = presses.up(1);
			if (press) runContinuePress(press.startedOn);
		};

		let done = false;
		const run = runFlowEvent(doc, { ...holdCtx, env: tapEnv }, 'freeSpinEnd', {
			amount: 5,
			winLevel: 3,
		}).then(() => (done = true));
		await settle();
		down();
		if (slowRelease) await settle();
		up();
		await settle();
		const first = { done, held: tapMount.heldContainers().includes('freeSpinOutro') };
		down();
		up();
		await settle();
		const second = { done, shown: tapMount.isShown('freeSpinOutro') };
		if (!done) {
			tapMount.complete('freeSpinOutro');
			await run;
		}
		unregisterTap?.();
		return { first, second };
	};

	for (const slowRelease of [false, true]) {
		const when = slowRelease ? 'released after the hold is reached' : 'a quick tap';
		const fixed = await outroTaps('fixed', { slowRelease });
		check(
			`outro, ${when}: the skip tap lands the total and the round still HOLDS on it`,
			!fixed.first.done && fixed.first.held,
		);
		check(
			`outro, ${when}: a second, fresh tap continues and hides the outro`,
			fixed.second.done && !fixed.second.shown,
		);
		const shipped = await outroTaps('shipped', { slowRelease });
		check(
			`negative control, ${when}: the shipped mask lets the skip tap dismiss the outro`,
			shipped.first.done,
		);
	}
}

// --- 8. The ways seed: same rig, no book mechanic, validates against its OWN vocab -------------
// The point of deriving it rather than hand-writing one: the seed a new project opens on must
// type-check against the palette that project is authored with, or the canvas opens on errors.
{
	const waysIssues = validateFlowDoc(
		WAYS_DRIVEN_SEED_DOC,
		WAYS_VOCAB,
		BOOK_OF_DRIVEN_SEED_LIBRARY,
		BOOK_OF_DRIVEN_SEED_CONTAINER_EVENTS,
	);
	const waysErrors = waysIssues.filter((i) => i.severity === 'error');
	for (const e of waysErrors) console.log(`   ways validation error: ${e.code} — ${e.message}`);
	check('ways seed: validateFlowDoc reports NO errors against WAYS_VOCAB', waysErrors.length === 0);

	check("ways seed: templateId is 'ways'", WAYS_DRIVEN_SEED_DOC.templateId === 'ways');

	// The book mechanic is gone in BOTH shapes it took: whole event chains, and one mid-chain cue.
	const waysRefs = new Set(WAYS_DRIVEN_SEED_DOC.graph.nodes.map((n) => n.ref).filter(Boolean));
	for (const ref of [
		'setSpecialSymbol',
		'expandBookColumns',
		'specialBookReveal',
		'specialBookHide',
		'specialBook',
	]) {
		check(`ways seed: no \`${ref}\` node`, !waysRefs.has(ref));
	}
	check(
		'ways seed: no `specialBook` container',
		!WAYS_DRIVEN_SEED_DOC.containers.some((c) => c.id === 'specialBook'),
	);

	// …and nothing ELSE is gone: it must keep the whole shared lifecycle rig and presentation.
	const bookRefs = new Set(BOOK_OF_DRIVEN_SEED_DOC.graph.nodes.map((n) => n.ref).filter(Boolean));
	const extra = [...waysRefs].filter((r) => !bookRefs.has(r));
	check('ways seed: introduces no ref book-of lacks', extra.length === 0, extra.join(','));
	check(
		'ways seed: still owns `load` (⇒ drives every screen)',
		flowOwnsSignal(WAYS_DRIVEN_SEED_DOC, 'load'),
	);
	for (const ref of ['revealBoard', 'setWinBookEventAmount', 'commitBuyBonus', 'selectBetMode']) {
		check(`ways seed: keeps \`${ref}\``, waysRefs.has(ref));
	}
}

console.log('');
if (failures === 0) console.log('V2 DRIVEN SEED HARNESS: PASSED');
else {
	console.log(`V2 DRIVEN SEED HARNESS: FAILED (${failures} assertion(s))`);
	process.exit(1);
}
