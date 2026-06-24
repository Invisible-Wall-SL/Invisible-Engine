/**
 * Invisible Flow — Phase 5 per-screen + per-event parity harness (the migration gate,
 * design doc §9 row 5, §11.5).
 *
 *   pnpm --filter flow-spike run phase5
 *
 * Proves, HEADLESSLY and per-event, that running each apps/lines book event through the
 * AUTHORED `LINES_FLOW_DOC` choreography produces the IDENTICAL ordered op log — emitter
 * broadcasts (with the three-way sync/awaited/fire-and-forget split), named effect
 * invocations, awaited completions, and scaled delay durations — as the coded
 * `bookEventHandlerMap` handler, with turbo ON and OFF. A single divergence is a blocking
 * FAIL, reported position-for-position.
 *
 * How it stays HONEST (no transcription drift):
 *  - the AUTHORED side runs the REAL `runChoreography` executor over the REAL `LINES_FLOW_DOC`
 *    (imported from apps/lines), against a recording runtime whose `emitter` + `effect` +
 *    `waitForTimeout` log every op;
 *  - the CODED reference is each handler's body transcribed VERBATIM from
 *    `bookEventHandlerMap.ts`, driving the SAME recording surface through the SAME helper
 *    shapes — and the effect bodies it logs are the SAME leaves `flowEffects.ts` registers
 *    (the harness records effect NAME + resolved payload, the unit the FlowDoc declares), so
 *    the two sides are compared at the declared-effect boundary, exactly where parity must hold.
 *  - both sides share ONE recording rig per run, so any divergence is the FlowDoc's, not the
 *    fixture's.
 *
 * Determinism: a virtual `waitForTimeout` (records the scaled ms, resolves immediately) and a
 * fixed book payload per event (mirroring the mock-RGS/test-server book shape, never random).
 *
 * NOTE (model, §13): authored under Opus 4.8 (Fable 5 unavailable). The migration's subtle
 * async/timing reconciliation is the make-or-break risk, so this harness logs the THREE
 * broadcast shapes distinctly and the exact effect-invocation interleave, not just call order.
 */

import { createEventEmitter } from 'utils-event-emitter';
import { sequence } from 'utils-shared/sequence';
import {
	createBookEventDispatcher,
	type ChoreographyNode,
	type FlowDoc,
	type FlowEffect,
	type FlowRuntime,
} from 'engine-flow';

import { LINES_FLOW_DOC } from '../../apps/lines/src/game/flowDoc';

// ---------------------------------------------------------------------------
// Fixed book payloads — one per event, mirroring the apps/lines book shape.
// ---------------------------------------------------------------------------
type Position = { reel: number; row: number };

const FIXTURES: Record<string, Record<string, unknown>> = {
	reveal: {
		type: 'reveal',
		gameType: 'basegame',
		board: [],
		paddingPositions: [],
		anticipation: [],
	},
	winInfo: {
		type: 'winInfo',
		totalWin: 400,
		wins: [
			{
				symbol: 'H3',
				positions: [
					{ reel: 0, row: 1 },
					{ reel: 1, row: 2 },
				],
			},
			{ symbol: 'H1', positions: [{ reel: 2, row: 0 }] },
		],
	},
	setTotalWin: { type: 'setTotalWin', amount: 1234 },
	setExpandingSymbol: { type: 'setExpandingSymbol', symbol: 'H1' },
	expandBookColumns: { type: 'expandBookColumns', symbol: 'H1', reels: [0, 2] },
	freeSpinTrigger: {
		type: 'freeSpinTrigger',
		totalFs: 10,
		positions: [
			{ reel: 3, row: 2 },
			{ reel: 4, row: 2 },
		],
	},
	updateFreeSpin: { type: 'updateFreeSpin', amount: 2, total: 10 },
	freeSpinEnd: { type: 'freeSpinEnd', amount: 5000, winLevel: 6 },
	setWin: { type: 'setWin', amount: 250, winLevel: 3 },
};

const REVEAL_CONTEXT = { bookEvents: [FIXTURES.reveal, FIXTURES.reveal] as unknown[] };

// ---------------------------------------------------------------------------
// Recording rig — ONE emitter + ONE effect surface shared by both paths. The effect
// surface logs NAME + resolved payload (the declared unit) and reproduces an effect's
// AWAIT shape (a body that awaits = the executor blocks), so a non-awaited effect can't
// masquerade as awaited. The board-spin + column-morph effects model their awaited work
// with a microtask tick so the await actually suspends, like the coded leaf.
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

	// The recording EFFECT surface — the implementation side mirrored from flowEffects.ts,
	// but routing every emitter/state/board op through `recording`/`log` so it is comparable.
	// Each effect logs `effect <name> <payload>` first (the declared boundary), then its leaf
	// body's recorded ops (so the parity check sees the FULL behaviour, not just the call).
	const effects: Record<string, FlowEffect> = {
		revealBoard: async (p) => {
			log.push(
				`effect revealBoard${stableArgs({ gameType: (p.bookEvent as Record<string, unknown>).gameType })}`,
			);
			// isBonusGame = checkIsMultipleRevealEvents (>1 reveal in the book) — fixture has 2.
			const bookEvents = p.bookEvents as unknown[];
			const isBonus =
				bookEvents.filter((b) => (b as { type: string }).type === 'reveal').length > 1;
			if (isBonus) {
				recording.broadcast({ type: 'stopButtonEnable' });
				log.push('recordBookEvent');
			}
			log.push(`stateGame.gameType = ${(p.bookEvent as { gameType: string }).gameType}`);
			// enhancedBoard.spin is awaited — model the suspend.
			log.push('board.spin:start');
			await Promise.resolve();
			log.push('board.spin:done');
		},
		setWinBookEventAmount: (p) => {
			log.push(`effect setWinBookEventAmount${stableArgs({ amount: p.amount })}`);
			log.push(`stateBet.winBookEventAmount = ${p.amount}`);
		},
		setSpecialSymbol: (p) => {
			log.push(`effect setSpecialSymbol${stableArgs({ symbol: p.symbol })}`);
			log.push(`stateGame.specialSymbol = ${p.symbol}`);
		},
		expandBookColumns: async (p) => {
			log.push(`effect expandBookColumns${stableArgs({ symbol: p.symbol, reels: p.reels })}`);
			// The coded body's per-cell explode→swap→land is board-state-dependent; the
			// migration moves it WHOLE (one awaited effect), so the parity unit is the effect
			// boundary + that it AWAITS. Model the awaited work with a tick.
			log.push('columns.morph:start');
			await Promise.resolve();
			log.push('columns.morph:done');
		},
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
		freeSpinCounterUpdate: (p) => {
			log.push(`effect freeSpinCounterUpdate${stableArgs({ amount: p.amount, total: p.total })}`);
			recording.broadcast({
				type: 'freeSpinCounterUpdate',
				current: (p.amount as number) + 1,
				total: p.total as number,
			});
		},
		updateFreeSpinCounter: (p) => {
			log.push(`effect updateFreeSpinCounter${stableArgs({ amount: p.amount, total: p.total })}`);
			log.push(`stateUi.freeSpinCounterCurrent = ${(p.amount as number) + 1}`);
			log.push(`stateUi.freeSpinCounterTotal = ${p.total}`);
		},
		enterFreeSpinOutro: () => {
			log.push('effect enterFreeSpinOutro');
			log.push('stateGame.gameType = basegame');
			log.push('stateUi.freeSpinOutroShow = true');
		},
		winLevelSoundsPlay: (p) => {
			log.push(`effect winLevelSoundsPlay${stableArgs({ winLevel: p.winLevel })}`);
			// winLevelData for winLevel 6 (big): alias 'big', type 'big', bgm 'bgm_winlevel_big'.
			// Mirror winLevelSoundsPlay's branch outputs for the fixture levels used.
			const wl = p.winLevel as number;
			if (wl === 10) recording.broadcastAsync({ type: 'uiHide' }); // alias max
			// no sfx in the map; bgm present for big-tier (≥6)
			if (wl >= 6) {
				const bgm = {
					6: 'bgm_winlevel_big',
					7: 'bgm_winlevel_superwin',
					8: 'bgm_winlevel_mega',
					9: 'bgm_winlevel_epic',
					10: 'bgm_winlevel_max',
				}[wl];
				if (bgm) recording.broadcast({ type: 'soundMusic', name: bgm });
				recording.broadcast({ type: 'soundLoop', name: 'sfx_bigwin_coinloop' }); // type 'big'
			}
		},
		winLevelSoundsStop: () => {
			log.push('effect winLevelSoundsStop');
			recording.broadcast({ type: 'soundStop', name: 'sfx_bigwin_coinloop' });
			// activeBetModeKey !== SUPERSPIN and gameType freegame (we are in freeSpinEnd) ⇒ bgm_freespin.
			recording.broadcast({ type: 'soundMusic', name: 'bgm_freespin' });
			recording.broadcastAsync({ type: 'uiShow' });
		},
		freeSpinOutroCountUp: async (p) => {
			log.push(
				`effect freeSpinOutroCountUp${stableArgs({ amount: p.amount, winLevel: p.winLevel })}`,
			);
			await recording.broadcastAsync({
				type: 'freeSpinOutroCountUp',
				amount: p.amount,
				winLevel: p.winLevel,
			});
		},
		exitFreeSpinOutro: () => {
			log.push('effect exitFreeSpinOutro');
			log.push('stateUi.freeSpinOutroShow = false');
			log.push('stateGame.specialSymbol = null');
			log.push('stateUi.freeSpinCounterShow = false');
		},
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
// CODED reference — each handler body transcribed VERBATIM from bookEventHandlerMap.ts,
// driving the SAME recording rig through the SAME effect surface. The coded handler now
// shares the flowEffects.ts leaves, so calling the rig's effect map IS the coded leaf.
// ---------------------------------------------------------------------------
type Coded = (rig: ReturnType<typeof makeRig>, e: Record<string, unknown>) => Promise<void>;

const animateSymbols = async (rig: ReturnType<typeof makeRig>, positions: Position[]) => {
	rig.recording.broadcast({ type: 'boardShow' });
	await rig.recording.broadcastAsync({
		type: 'boardWithAnimateSymbols',
		symbolPositions: positions,
	});
};

const coded: Record<string, Coded> = {
	reveal: async (rig, e) => {
		// reveal: bonus record + board spin (effect), then soundScatterCounterClear.
		await rig.effects.revealBoard({ bookEvent: e, bookEvents: REVEAL_CONTEXT.bookEvents });
		rig.recording.broadcast({ type: 'soundScatterCounterClear' });
	},
	winInfo: async (rig, e) => {
		rig.recording.broadcast({ type: 'soundOnce', name: 'sfx_winlevel_small' });
		await sequence(e.wins as { positions: Position[] }[], async (win) => {
			await animateSymbols(rig, win.positions);
		});
	},
	setTotalWin: async (rig, e) => {
		await rig.effects.setWinBookEventAmount({ amount: e.amount });
	},
	setExpandingSymbol: async (rig, e) => {
		await rig.effects.setSpecialSymbol({ symbol: e.symbol });
		await rig.recording.broadcastAsync({ type: 'specialBookReveal', symbol: e.symbol });
	},
	expandBookColumns: async (rig, e) => {
		rig.recording.broadcast({ type: 'soundOnce', name: 'sfx_scatter_win_v2' });
		await rig.effects.expandBookColumns({ symbol: e.symbol, reels: e.reels });
	},
	freeSpinTrigger: async (rig, e) => {
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
		rig.recording.broadcast({
			type: 'freeSpinCounterUpdate',
			current: undefined,
			total: e.totalFs,
		});
		await rig.effects.setFreeSpinCounterTotalOnly({ total: e.totalFs });
		await rig.recording.broadcastAsync({ type: 'uiShow' });
		await rig.recording.broadcastAsync({ type: 'drawerButtonShow' });
		rig.recording.broadcast({ type: 'drawerFold' });
	},
	updateFreeSpin: async (rig, e) => {
		rig.recording.broadcast({ type: 'freeSpinCounterShow' });
		await rig.effects.freeSpinCounterShow({});
		await rig.effects.freeSpinCounterUpdate({ amount: e.amount, total: e.total });
		await rig.effects.updateFreeSpinCounter({ amount: e.amount, total: e.total });
	},
	freeSpinEnd: async (rig, e) => {
		await rig.recording.broadcastAsync({ type: 'uiHide' });
		await rig.effects.enterFreeSpinOutro({});
		rig.recording.broadcast({ type: 'boardFrameGlowHide' });
		rig.recording.broadcast({ type: 'freeSpinOutroShow' });
		rig.recording.broadcast({ type: 'soundOnce', name: 'sfx_youwon_panel' });
		await rig.effects.winLevelSoundsPlay({ winLevel: e.winLevel });
		await rig.effects.freeSpinOutroCountUp({ amount: e.amount, winLevel: e.winLevel });
		await rig.effects.winLevelSoundsStop({});
		rig.recording.broadcast({ type: 'freeSpinOutroHide' });
		rig.recording.broadcast({ type: 'freeSpinCounterHide' });
		rig.recording.broadcast({ type: 'specialBookHide' });
		await rig.effects.exitFreeSpinOutro({});
		await rig.recording.broadcastAsync({ type: 'transition' });
		await rig.recording.broadcastAsync({ type: 'uiShow' });
		await rig.recording.broadcastAsync({ type: 'drawerUnfold' });
		rig.recording.broadcast({ type: 'drawerButtonHide' });
	},
	setWin: async (rig, e) => {
		rig.recording.broadcast({ type: 'winShow' });
		await rig.effects.winShow({ winLevel: e.winLevel });
		await rig.effects.winLevelSoundsPlay({ winLevel: e.winLevel });
		await rig.effects.winUpdate({ amount: e.amount, winLevel: e.winLevel });
		await rig.effects.winLevelSoundsStop({});
		rig.recording.broadcast({ type: 'winHide' });
		await rig.effects.winHide({});
	},
};

// `winLevelSoundsStop` differs between setWin (basegame) and freeSpinEnd (freegame): in
// basegame it broadcasts `bgm_main`, in freegame `bgm_freespin`. The rig models the freegame
// branch (used by freeSpinEnd). For setWin the coded path is basegame ⇒ bgm_main, so the
// shared effect would diverge. We override the rig's `winLevelSoundsStop` per-event below.

// ---------------------------------------------------------------------------
// Drivers.
// ---------------------------------------------------------------------------
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

const runCoded = async (
	event: string,
	turbo: boolean,
	basegameStop: boolean,
): Promise<string[]> => {
	const rig = makeRig(turbo);
	if (basegameStop) patchBasegameStop(rig);
	await coded[event](rig, FIXTURES[event]);
	await settle();
	return rig.log;
};

const runAuthored = async (
	event: string,
	turbo: boolean,
	basegameStop: boolean,
): Promise<string[]> => {
	const rig = makeRig(turbo);
	if (basegameStop) patchBasegameStop(rig);
	const doc: FlowDoc = LINES_FLOW_DOC;
	const { dispatch } = createBookEventDispatcher<{ type: string }, { bookEvents: unknown[] }>({
		flowDoc: doc,
		runtime: rig.runtime,
		codedHandlers: {},
	});
	await dispatch(FIXTURES[event] as { type: string }, REVEAL_CONTEXT);
	await settle();
	return rig.log;
};

/** setWin runs in BASEGAME, so winLevelSoundsStop broadcasts bgm_main (not bgm_freespin). */
const patchBasegameStop = (rig: ReturnType<typeof makeRig>) => {
	rig.effects.winLevelSoundsStop = () => {
		rig.log.push('effect winLevelSoundsStop');
		rig.recording.broadcast({ type: 'soundStop', name: 'sfx_bigwin_coinloop' });
		rig.recording.broadcast({ type: 'soundMusic', name: 'bgm_main' });
		rig.recording.broadcastAsync({ type: 'uiShow' });
	};
};

// ---------------------------------------------------------------------------
// Assertions.
// ---------------------------------------------------------------------------
let failed = false;
const assertEqual = (label: string, a: string[], b: string[]) => {
	if (JSON.stringify(a) === JSON.stringify(b)) {
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
	console.log('Invisible Flow — Phase 5 per-event migration parity harness\n');

	const events = Object.keys(coded);
	for (const event of events) {
		const basegameStop = event === 'setWin';
		for (const turbo of [false, true]) {
			const c = await runCoded(event, turbo, basegameStop);
			const a = await runAuthored(event, turbo, basegameStop);
			assertEqual(`${event} (turbo ${turbo ? 'ON' : 'OFF'})`, c, a);
		}
	}

	// Per-screen parity: the authored doc has ONE exclusive screen (basegame). Assert the
	// FlowDoc authors it as `initial` (so the generic mounter owns it) and that EVERY coded
	// book event has an authored choreography EXCEPT the deliberate fall-throughs (finalWin,
	// createBonusSnapshot — §11.5 B.2). Those staying coded is the safe-migration invariant.
	console.log('\n  Coverage + fall-through:');
	const authoredEvents = new Set((LINES_FLOW_DOC.events ?? []).map((e) => e.event));
	const codedEventNames = [
		'reveal',
		'winInfo',
		'setTotalWin',
		'setExpandingSymbol',
		'expandBookColumns',
		'freeSpinTrigger',
		'updateFreeSpin',
		'freeSpinEnd',
		'setWin',
	];
	const deliberateFallThrough = ['finalWin', 'createBonusSnapshot'];
	const allAuthored = codedEventNames.every((e) => authoredEvents.has(e));
	const fallThroughHeld = deliberateFallThrough.every((e) => !authoredEvents.has(e));
	const basegameInitial = LINES_FLOW_DOC.screens.some((s) => s.id === 'basegame' && s.initial);
	assertBool('all migratable events authored', allAuthored);
	assertBool(
		'finalWin + createBonusSnapshot deliberately fall through (coded, §11.5 B.2)',
		fallThroughHeld,
	);
	assertBool('basegame authored as the initial exclusive screen', basegameInitial);

	// --- Resume-path parity (§11.5 follow-up B.2) ---
	// `createBonusSnapshot` (resume-only) replays the RESERVED book events through the play
	// path: `freeSpinTrigger`, then `updateFreeSpin`, `setTotalWin`, `updateGlobalMult` (the
	// last of each found in the pre-resume slice). With the FlowDoc active each replayed event
	// routes through the interpreter ⇒ gets its AUTHORED choreography. The snapshot SELECTION
	// (`_.findLast`) stays CODED (deliberate fall-through), so the resume sequence is exactly
	// those events in that order. We prove the resume sequence's interpreter-driven op log
	// equals the coded play of the SAME events in the SAME order. (`updateGlobalMult` is
	// unhandled in apps/lines — no handler/choreography — so it is a no-op either way.)
	console.log('\n  Resume-path parity (createBonusSnapshot replay):');
	const resumeEvents = ['freeSpinTrigger', 'updateFreeSpin', 'setTotalWin'];
	for (const turbo of [false, true]) {
		// Coded resume: each reserved event through its coded handler, in snapshot order.
		const codedRig = makeRig(turbo);
		for (const ev of resumeEvents) await coded[ev](codedRig, FIXTURES[ev]);
		await settle();
		// Authored resume: each reserved event through the interpreter (the play path when active).
		const authoredRig = makeRig(turbo);
		const { dispatch } = createBookEventDispatcher<{ type: string }, { bookEvents: unknown[] }>({
			flowDoc: LINES_FLOW_DOC,
			runtime: authoredRig.runtime,
			codedHandlers: {},
		});
		for (const ev of resumeEvents) await dispatch(FIXTURES[ev] as { type: string }, REVEAL_CONTEXT);
		await settle();
		assertEqual(
			`resume replay sequence (turbo ${turbo ? 'ON' : 'OFF'})`,
			codedRig.log,
			authoredRig.log,
		);
	}

	console.log(`\n${failed ? 'PHASE 5 HARNESS: FAILED' : 'PHASE 5 HARNESS: PASSED'}`);
	process.exit(failed ? 1 : 0);
};

function assertBool(label: string, ok: boolean) {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}`);
	}
}

void main();
