/**
 * Invisible Flow — Phase 2 win-presentation-transitions harness (flow-driven-game §2, §7).
 *
 *   pnpm --filter flow-spike run phase2
 *
 * Proves, HEADLESSLY and against the REAL engine-flow interpreter over the REAL
 * `LINES_FLOW_WIN_DOC` (imported from apps/lines), the owner-approved win-branch split:
 *  - BIG win + FREE-SPIN INTRO become EXCLUSIVE screen nodes reached by guarded `bookEvent`
 *    transitions; their presentation is the screen's `enter` choreography (lifted VERBATIM);
 *  - SMALL win stays a FEED-DRIVEN overlay (the `setWin` event choreography), no screen swap.
 *
 * The crux it guards (§6.1 orthogonality): `dispatchBookEvent` runs the per-event choreography
 * AND fires a `bookEvent` transition INDEPENDENTLY. So per case EXACTLY ONE path must present
 * (no double-fire). This harness drives the real `createFlowInterpreter` and asserts:
 *
 *  A. BIG-win `setWin` ⇒ `basegame → bigWin`, and the combined op log equals the CODED `setWin`
 *     presentation (the lifted `bigWin.enter`) — the event choreography itself is a no-op.
 *  B. SMALL-win `setWin` ⇒ STAYS `basegame` (guard rejects the transition), and the op log
 *     equals the small overlay presentation (no double-fire).
 *  C. `freeSpinTrigger` ⇒ `basegame → freeSpinIntro`, op log equals the CODED freeSpinTrigger
 *     presentation (the lifted `freeSpinIntro.enter`); the event stays AUTHORED as a no-op so
 *     it never falls through to its coded handler (no double-present, §6.1).
 *  D. `complete` (tap) returns each win screen → `basegame`.
 *  E. Guard correctness — the `in [6..10]` tier list selects big vs small at every boundary.
 *  F. Parity — the default `LINES_FLOW_DOC` authors ZERO transitions (the win-branch is inert
 *     by default), and `normalizeFlowDoc(LINES_FLOW_WIN_DOC)` round-trips idempotently.
 *
 * Reuses the Phase-5 recording rig (the SAME effect surface flowEffects.ts registers, routed
 * through a log) so the bigWin/freeSpinIntro `enter` op log is comparable to the coded
 * reference position-for-position. Determinism: a virtual `waitForTimeout` (records scaled ms).
 */

import { createEventEmitter } from 'utils-event-emitter';
import { sequence } from 'utils-shared/sequence';
import {
	createFlowInterpreter,
	normalizeFlowDoc,
	type FlowEffect,
	type FlowRuntime,
	type MountableScene,
} from 'engine-flow';

import { LINES_FLOW_DOC, LINES_FLOW_WIN_DOC } from '../../apps/lines/src/game/flowDoc';

// ---------------------------------------------------------------------------
// Fixed book payloads — mirroring the apps/lines book shape (never random).
// ---------------------------------------------------------------------------
type Position = { reel: number; row: number };

const FIXTURES = {
	setWinBig: { type: 'setWin', amount: 5000, winLevel: 6 },
	setWinSmall: { type: 'setWin', amount: 250, winLevel: 3 },
	freeSpinTrigger: {
		type: 'freeSpinTrigger',
		totalFs: 10,
		positions: [
			{ reel: 3, row: 2 },
			{ reel: 4, row: 2 },
		],
	},
} as const;

const CONTEXT = { bookEvents: [] as unknown[] };

// ---------------------------------------------------------------------------
// Recording rig — ONE emitter + ONE effect surface (mirrored from flowEffects.ts), routed
// through a log so the op order is observable. Lifted from the Phase-5 rig (the SAME leaves).
// ---------------------------------------------------------------------------
type EmitterEvent = { type: string } & Record<string, unknown>;

const stableArgs = (rest: Record<string, unknown>) =>
	Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';

const makeRig = (turbo: boolean) => {
	const log: string[] = [];
	const { eventEmitter } = createEventEmitter<EmitterEvent>();

	const recording = {
		broadcast: (e: EmitterEvent) => {
			const { type, ...rest } = e;
			log.push(`broadcast ${type}${stableArgs(rest)}`);
			eventEmitter.broadcast(e);
		},
		broadcastAsync: (e: EmitterEvent) => {
			const { type, ...rest } = e;
			log.push(`broadcastAsync ${type}${stableArgs(rest)}`);
			return eventEmitter.broadcastAsync(e);
		},
	};

	const effects: Record<string, FlowEffect> = {
		// --- setWin / bigWin presentation leaves ---
		winShow: (p) => {
			log.push(`effect winShow${stableArgs({ winLevel: p.winLevel })}`);
			log.push('stateUi.winShow = true');
			log.push(`stateUi.bigWinShow = ${(p.winLevel as number) >= 6}`);
		},
		winUpdate: async (p) => {
			log.push(`effect winUpdate${stableArgs({ amount: p.amount, winLevel: p.winLevel })}`);
			await recording.broadcastAsync({ type: 'winUpdate', amount: p.amount, winLevel: p.winLevel });
		},
		winHide: () => {
			log.push('effect winHide');
			log.push('stateUi.winShow = false');
			log.push('stateUi.bigWinShow = false');
		},
		winLevelSoundsPlay: (p) => {
			log.push(`effect winLevelSoundsPlay${stableArgs({ winLevel: p.winLevel })}`);
			const wl = p.winLevel as number;
			if (wl === 10) recording.broadcastAsync({ type: 'uiHide' });
			if (wl >= 6) {
				const bgm = {
					6: 'bgm_winlevel_big',
					7: 'bgm_winlevel_superwin',
					8: 'bgm_winlevel_mega',
					9: 'bgm_winlevel_epic',
					10: 'bgm_winlevel_max',
				}[wl];
				if (bgm) recording.broadcast({ type: 'soundMusic', name: bgm });
				recording.broadcast({ type: 'soundLoop', name: 'sfx_bigwin_coinloop' });
			}
		},
		// setWin runs in BASEGAME ⇒ winLevelSoundsStop broadcasts bgm_main (not bgm_freespin).
		winLevelSoundsStop: () => {
			log.push('effect winLevelSoundsStop');
			recording.broadcast({ type: 'soundStop', name: 'sfx_bigwin_coinloop' });
			recording.broadcast({ type: 'soundMusic', name: 'bgm_main' });
			recording.broadcastAsync({ type: 'uiShow' });
		},
		// --- freeSpinTrigger / freeSpinIntro presentation leaves ---
		setFreeSpinCounterTotal: (p) => {
			log.push(`effect setFreeSpinCounterTotal${stableArgs({ total: p.total })}`);
			log.push(`stateUi.freeSpinCounterTotal = ${p.total}`);
		},
		freeSpinIntroShow: () => {
			log.push('effect freeSpinIntroShow');
			log.push('stateUi.freeSpinIntroShow = true');
		},
		setFreeGameType: () => {
			log.push('effect setFreeGameType');
			log.push('stateGame.gameType = freegame');
		},
		freeSpinIntroHide: () => {
			log.push('effect freeSpinIntroHide');
			log.push('stateUi.freeSpinIntroShow = false');
		},
		freeSpinCounterShow: () => {
			log.push('effect freeSpinCounterShow');
			log.push('stateUi.freeSpinCounterShow = true');
		},
		setFreeSpinCounterTotalOnly: (p) => {
			log.push(`effect setFreeSpinCounterTotalOnly${stableArgs({ total: p.total })}`);
			log.push(`stateUi.freeSpinCounterTotal = ${p.total}`);
		},
	};

	const runtime: FlowRuntime = {
		emitter: recording,
		timeScale: () => (turbo ? 2 : 1),
		waitForTimeout: (ms) => {
			log.push(`delay ${ms}`);
			return Promise.resolve();
		},
		effect: (name) => effects[name],
	};

	return { log, runtime, recording, effects };
};

// ---------------------------------------------------------------------------
// CODED reference — the setWin + freeSpinTrigger presentation transcribed VERBATIM from
// bookEventHandlerMap.ts, driving the SAME rig. The bigWin/freeSpinIntro `enter` op log must
// match these (the presentation was LIFTED, not re-derived).
// ---------------------------------------------------------------------------
const animateSymbols = async (rig: ReturnType<typeof makeRig>, positions: Position[]) => {
	rig.recording.broadcast({ type: 'boardShow' });
	await rig.recording.broadcastAsync({
		type: 'boardWithAnimateSymbols',
		symbolPositions: positions,
	});
};

const codedSetWin = async (rig: ReturnType<typeof makeRig>, e: Record<string, unknown>) => {
	rig.recording.broadcast({ type: 'winShow' });
	await rig.effects.winShow({ winLevel: e.winLevel });
	await rig.effects.winLevelSoundsPlay({ winLevel: e.winLevel });
	await rig.effects.winUpdate({ amount: e.amount, winLevel: e.winLevel });
	await rig.effects.winLevelSoundsStop({});
	rig.recording.broadcast({ type: 'winHide' });
	await rig.effects.winHide({});
};

const codedFreeSpinTrigger = async (
	rig: ReturnType<typeof makeRig>,
	e: Record<string, unknown>,
) => {
	rig.recording.broadcast({ type: 'soundOnce', name: 'sfx_scatter_win_v2' });
	await animateSymbols(rig, e.positions as Position[]);
	rig.recording.broadcast({ type: 'soundOnce', name: 'sfx_superfreespin' });
	await rig.recording.broadcastAsync({ type: 'uiHide' });
	await rig.recording.broadcastAsync({ type: 'transition' });
	await rig.effects.setFreeSpinCounterTotal({ total: e.totalFs });
	rig.recording.broadcast({ type: 'freeSpinIntroShow' });
	await rig.effects.freeSpinIntroShow({});
	rig.recording.broadcast({ type: 'soundOnce', name: 'jng_intro_fs' });
	rig.recording.broadcast({ type: 'soundMusic', name: 'bgm_freespin' });
	await rig.recording.broadcastAsync({ type: 'freeSpinIntroUpdate', totalFreeSpins: e.totalFs });
	await rig.effects.setFreeGameType({});
	rig.recording.broadcast({ type: 'freeSpinIntroHide' });
	await rig.effects.freeSpinIntroHide({});
	rig.recording.broadcast({ type: 'boardFrameGlowShow' });
	rig.recording.broadcast({ type: 'freeSpinCounterShow' });
	await rig.effects.freeSpinCounterShow({});
	rig.recording.broadcast({ type: 'freeSpinCounterUpdate', current: undefined, total: e.totalFs });
	await rig.effects.setFreeSpinCounterTotalOnly({ total: e.totalFs });
	await rig.recording.broadcastAsync({ type: 'uiShow' });
	await rig.recording.broadcastAsync({ type: 'drawerButtonShow' });
	rig.recording.broadcast({ type: 'drawerFold' });
};

// ---------------------------------------------------------------------------
// Interpreter driver — the REAL `createFlowInterpreter` over `LINES_FLOW_WIN_DOC`.
// ---------------------------------------------------------------------------
const scenes: Record<string, MountableScene> = {
	basegame: { id: 'basegame', space: 'game' },
	bigWin: { id: 'bigWin', space: 'canvas' },
	freeSpinIntro: { id: 'freeSpinIntro', space: 'canvas' },
};

// CODED fall-through handlers — a spy per win event that records IT RAN. In the REAL game
// `codedHandlers` is `bookEventHandlerMap` (a full presentation per event); if the win doc ever
// DROPPED a win event, dispatch would fall through to one of these AND the screen swap's `enter`
// would present too — a DOUBLE-present (§6.1). Wiring spies here proves the win events stay
// AUTHORED (the dispatcher never reaches the coded handler), so exactly one path presents.
const makeCodedSpies = (firedCoded: string[]) => ({
	setWin: async () => {
		firedCoded.push('setWin');
	},
	freeSpinTrigger: async () => {
		firedCoded.push('freeSpinTrigger');
	},
});

const makeInterp = (
	rig: ReturnType<typeof makeRig>,
	setChanges: string[][],
	firedCoded: string[] = [],
) =>
	createFlowInterpreter<{ type: string }, { bookEvents: unknown[] }>({
		flowDoc: LINES_FLOW_WIN_DOC,
		runtime: rig.runtime,
		resolveScene: (id) => scenes[id],
		onActiveScreensChange: (ids) => setChanges.push([...ids]),
		codedHandlers: makeCodedSpies(firedCoded),
	});

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// Assertions.
// ---------------------------------------------------------------------------
let failed = false;
const eqJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) {
		console.log(`  PASS  ${label}`);
	} else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};

const assertEqual = (label: string, a: string[], b: string[]) => {
	if (eqJson(a, b)) {
		console.log(`  PASS  ${label} — ${a.length} ordered ops identical`);
		return;
	}
	failed = true;
	console.error(`  FAIL  ${label} — DIVERGE:`);
	const max = Math.max(a.length, b.length);
	for (let i = 0; i < max; i++) {
		if (a[i] !== b[i]) {
			console.error(`    [${i}] coded:    ${a[i] ?? '<none>'}`);
			console.error(`    [${i}] authored: ${b[i] ?? '<none>'}`);
		}
	}
};

const main = async () => {
	console.log('Invisible Flow — Phase 2 win-presentation-transitions harness\n');

	for (const turbo of [false, true]) {
		const tag = `turbo ${turbo ? 'ON' : 'OFF'}`;

		// --- A. BIG win ⇒ basegame → bigWin, op log == coded setWin presentation (no double-fire) ---
		console.log(`A. BIG-win setWin ⇒ swap to bigWin, lifted presentation (${tag}):`);
		{
			const rig = makeRig(turbo);
			const setChanges: string[][] = [];
			const firedCoded: string[] = [];
			const interp = makeInterp(rig, setChanges, firedCoded);
			await interp.start();
			rig.log.length = 0;

			await interp.dispatchBookEvent(FIXTURES.setWinBig, CONTEXT);
			await settle();

			assert(
				`BIG win LAYERS bigWin over the persistent base (${tag})`,
				eqJson(interp.activeScreenIds, ['basegame', 'bigWin']),
			);
			assert(
				`onActiveScreensChange snapshotted basegame → +bigWin (${tag})`,
				eqJson(setChanges, [['basegame', 'bigWin']]),
			);
			assert(
				`setWin stayed authored — coded handler did NOT fire (no double-present) (${tag})`,
				firedCoded.length === 0,
				JSON.stringify(firedCoded),
			);

			const coded = makeRig(turbo);
			await codedSetWin(coded, FIXTURES.setWinBig);
			await settle();
			assertEqual(`bigWin.enter op log == coded setWin presentation (${tag})`, coded.log, rig.log);
		}

		// --- B. SMALL win ⇒ STAYS basegame, op log == small overlay (no double-fire) ---
		console.log(`B. SMALL-win setWin ⇒ stays basegame, feed-driven overlay (${tag}):`);
		{
			const rig = makeRig(turbo);
			const setChanges: string[][] = [];
			const interp = makeInterp(rig, setChanges);
			await interp.start();
			rig.log.length = 0;

			await interp.dispatchBookEvent(FIXTURES.setWinSmall, CONTEXT);
			await settle();

			assert(
				`active set STAYS just basegame (${tag})`,
				eqJson(interp.activeScreenIds, ['basegame']),
			);
			assert(`no screen swap fired (${tag})`, setChanges.length === 0);

			const coded = makeRig(turbo);
			await codedSetWin(coded, FIXTURES.setWinSmall);
			await settle();
			assertEqual(
				`small-win event-choreography op log == overlay presentation (${tag})`,
				coded.log,
				rig.log,
			);
		}

		// --- C. freeSpinTrigger ⇒ basegame → freeSpinIntro, op log == coded presentation ---
		console.log(`C. freeSpinTrigger ⇒ swap to freeSpinIntro, lifted presentation (${tag}):`);
		{
			const rig = makeRig(turbo);
			const setChanges: string[][] = [];
			const firedCoded: string[] = [];
			const interp = makeInterp(rig, setChanges, firedCoded);
			await interp.start();
			rig.log.length = 0;

			await interp.dispatchBookEvent(FIXTURES.freeSpinTrigger, CONTEXT);
			await settle();

			assert(
				`freeSpinTrigger LAYERS freeSpinIntro over the persistent base (${tag})`,
				eqJson(interp.activeScreenIds, ['basegame', 'freeSpinIntro']),
			);
			assert(
				`onActiveScreensChange snapshotted basegame → +freeSpinIntro (${tag})`,
				eqJson(setChanges, [['basegame', 'freeSpinIntro']]),
			);
			// THE no-double-fire guard: freeSpinTrigger is an AUTHORED no-op event (not dropped),
			// so dispatch does NOT fall through to the coded handler — only the screen swap presents.
			assert(
				`freeSpinTrigger stayed authored — coded handler did NOT fire (no double-present) (${tag})`,
				firedCoded.length === 0,
				JSON.stringify(firedCoded),
			);

			const coded = makeRig(turbo);
			await codedFreeSpinTrigger(coded, FIXTURES.freeSpinTrigger);
			await settle();
			assertEqual(
				`freeSpinIntro.enter op log == coded freeSpinTrigger presentation (${tag})`,
				coded.log,
				rig.log,
			);
		}

		// --- D. complete (tap) returns each win screen → basegame ---
		console.log(`D. complete (tap) returns each win screen → basegame (${tag}):`);
		{
			// bigWin --complete--> basegame (handoff dismisses the overlay; base persists throughout)
			const rig1 = makeRig(turbo);
			const c1: string[][] = [];
			const i1 = makeInterp(rig1, c1);
			await i1.start();
			await i1.dispatchBookEvent(FIXTURES.setWinBig, CONTEXT);
			await settle();
			rig1.log.length = 0;
			c1.length = 0;
			const tapped1 = await i1.completeActiveScreen();
			assert(
				`bigWin --complete--> dismissed, base remains (${tag})`,
				tapped1 && eqJson(i1.activeScreenIds, ['basegame']) && eqJson(c1, [['basegame']]),
			);

			// freeSpinIntro --complete--> basegame
			const rig2 = makeRig(turbo);
			const c2: string[][] = [];
			const i2 = makeInterp(rig2, c2);
			await i2.start();
			await i2.dispatchBookEvent(FIXTURES.freeSpinTrigger, CONTEXT);
			await settle();
			c2.length = 0;
			const tapped2 = await i2.completeActiveScreen();
			assert(
				`freeSpinIntro --complete--> dismissed, base remains (${tag})`,
				tapped2 && eqJson(i2.activeScreenIds, ['basegame']) && eqJson(c2, [['basegame']]),
			);

			// On basegame a further tap is a no-op (no complete edge from basegame).
			const noEdge = await i2.completeActiveScreen();
			assert(
				`basegame tap ⇒ no-op (no complete edge) (${tag})`,
				!noEdge && eqJson(i2.activeScreenIds, ['basegame']),
			);
		}

		// --- E. Guard correctness across the tier boundary (5 ⇒ small, 6 ⇒ big) ---
		console.log(`E. guard selects big vs small at the tier boundary (${tag}):`);
		{
			const rigBoundaryHigh = makeRig(turbo);
			const iHigh = makeInterp(rigBoundaryHigh, []);
			await iHigh.start();
			await iHigh.dispatchBookEvent({ type: 'setWin', amount: 9, winLevel: 6 }, CONTEXT);
			await settle();
			assert(
				`winLevel 6 (lowest big tier) ⇒ swaps to bigWin (${tag})`,
				iHigh.activeScreenId === 'bigWin',
			);

			const rigBoundaryLow = makeRig(turbo);
			const iLow = makeInterp(rigBoundaryLow, []);
			await iLow.start();
			await iLow.dispatchBookEvent({ type: 'setWin', amount: 9, winLevel: 5 }, CONTEXT);
			await settle();
			assert(
				`winLevel 5 (highest small/medium) ⇒ stays basegame (${tag})`,
				iLow.activeScreenId === 'basegame',
			);

			const rigTop = makeRig(turbo);
			const iTop = makeInterp(rigTop, []);
			await iTop.start();
			await iTop.dispatchBookEvent({ type: 'setWin', amount: 9, winLevel: 10 }, CONTEXT);
			await settle();
			assert(`winLevel 10 (MAX) ⇒ swaps to bigWin (${tag})`, iTop.activeScreenId === 'bigWin');
		}
	}

	// --- F. Parity + bake contract (turbo-independent) ---
	console.log('\nF. Parity — default doc inert + normalize round-trip:');
	{
		assert(
			'default LINES_FLOW_DOC authors ZERO transitions (win-branch inert by default, §7)',
			LINES_FLOW_DOC.transitions.length === 0,
		);
		assert(
			'default LINES_FLOW_DOC authors only the basegame screen (no bigWin/freeSpinIntro nodes)',
			eqJson(
				LINES_FLOW_DOC.screens.map((s) => s.id),
				['basegame'],
			),
		);
		// The win doc keeps BOTH win events AUTHORED (never dropped) so dispatch never falls
		// through to a coded handler and double-presents alongside the screen swap (§6.1): setWin
		// is BRANCHED (small overlay vs big no-op) and freeSpinTrigger is an authored NO-OP (the
		// freeSpinIntro screen owns its presentation). Confirm the orthogonality invariant at the
		// data level.
		const winEvents = new Set((LINES_FLOW_WIN_DOC.events ?? []).map((e) => e.event));
		assert(
			'win doc keeps freeSpinTrigger AUTHORED (no-op) so it does NOT fall through to coded',
			winEvents.has('freeSpinTrigger'),
		);
		assert(
			'win doc keeps setWin in events (branched — small overlay vs big no-op)',
			winEvents.has('setWin'),
		);
		const setWinEntry = (LINES_FLOW_WIN_DOC.events ?? []).find((e) => e.event === 'setWin');
		assert(
			'win doc setWin choreography is a branch (the no-double-fire guard)',
			setWinEntry?.choreography.kind === 'branch',
		);
		const fsEntry = (LINES_FLOW_WIN_DOC.events ?? []).find((e) => e.event === 'freeSpinTrigger');
		assert(
			'win doc freeSpinTrigger choreography is an empty sequence (no-op — the screen presents)',
			fsEntry?.choreography.kind === 'sequence' &&
				(fsEntry.choreography as { children: unknown[] }).children.length === 0,
		);

		// normalizeFlowDoc round-trips idempotently (the bake contract, §7/§12).
		const once = normalizeFlowDoc(JSON.parse(JSON.stringify(LINES_FLOW_WIN_DOC)));
		const twice = normalizeFlowDoc(JSON.parse(JSON.stringify(once)));
		assert(
			'normalizeFlowDoc(LINES_FLOW_WIN_DOC) is idempotent (bake round-trip)',
			eqJson(once, twice),
		);
		assert(
			'normalize preserves the 3 screens + 4 transitions + branched setWin',
			once.screens.length === 3 &&
				once.transitions.length === 4 &&
				(once.events ?? []).find((e) => e.event === 'setWin')?.choreography.kind === 'branch',
		);
	}

	console.log(`\n${failed ? 'PHASE 2 HARNESS: FAILED' : 'PHASE 2 HARNESS: PASSED'}`);
	process.exit(failed ? 1 : 0);
};

void main();
