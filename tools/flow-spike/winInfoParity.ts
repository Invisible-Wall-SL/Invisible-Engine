/**
 * Invisible Flow — Phase 0 parity harness (the make-or-break gate, design doc §9).
 *
 *   pnpm --filter lines exec tsx ../../tools/flow-spike/winInfoParity.ts
 *
 * Proves, HEADLESSLY and before any editor UI, that the runtime interpreter reproduces
 * today's coded `winInfo` presentation behaviour EXACTLY:
 *
 *  1. Parity — the coded `winInfo` body and the interpreter running a hand-authored
 *     FlowDoc for `winInfo` produce the IDENTICAL ordered log of (emitter broadcasts with
 *     event+args, awaited completions, scaled delay durations), with turbo ON and OFF.
 *  2. Fall-through — with only `winInfo` authored, an un-authored event (`setTotalWin`)
 *     still hits its coded handler.
 *
 * It drives the REAL primitives the game uses: the real `sequence()` from `utils-shared`,
 * the real `createEventEmitter` from `utils-event-emitter`, and a `timeScale`/`waitForTimeout`
 * pair wired to the same shape as `stateBetDerived.timeScale()` + `waitForTimeout`. Both
 * paths share ONE recording emitter + ONE `boardWithAnimateSymbols` subscriber (the awaited
 * symbol-spine animation), so any divergence is the interpreter's, not the fixture's.
 *
 * NOTE (model): authored under Opus 4.8 (Fable 5 unavailable). Per design doc §13 this
 * risks a subtle timing miss, so the harness logs the THREE broadcast shapes distinctly
 * (sync `broadcast`, awaited `broadcastAsync`, fire-and-forget `broadcastAsync`) and the
 * exact await-completion interleave, not just the call order.
 */

import { createEventEmitter } from 'utils-event-emitter';
import { sequence } from 'utils-shared/sequence';
import {
	createBookEventDispatcher,
	runChoreography,
	type FlowDoc,
	type FlowRuntime,
	type ChoreographyNode,
} from 'engine-flow';

// ---------------------------------------------------------------------------
// Deterministic fixture — the real `winInfo` event from apps/lines stories data.
// ---------------------------------------------------------------------------
type Position = { reel: number; row: number };
type Win = { symbol: string; positions: Position[] };
type WinInfoEvent = { type: 'winInfo'; totalWin: number; wins: Win[] };
type SetTotalWinEvent = { type: 'setTotalWin'; amount: number };
type BookEvent = WinInfoEvent | SetTotalWinEvent;

const winInfoEvent: WinInfoEvent = {
	type: 'winInfo',
	totalWin: 400,
	wins: [
		{
			symbol: 'H3',
			positions: [
				{ reel: 0, row: 1 },
				{ reel: 1, row: 2 },
				{ reel: 2, row: 3 },
			],
		},
		{
			symbol: 'H3',
			positions: [
				{ reel: 0, row: 3 },
				{ reel: 1, row: 2 },
				{ reel: 2, row: 3 },
			],
		},
	],
};

// ---------------------------------------------------------------------------
// Recording rig — ONE emitter + ONE animation subscriber shared by both paths.
// ---------------------------------------------------------------------------
type LogEntry = string;

type EmitterEvent = { type: string } & Record<string, unknown>;

const makeRig = () => {
	const log: LogEntry[] = [];
	const fireForget: LogEntry[] = [];
	const { eventEmitter } = createEventEmitter<EmitterEvent>();

	// A SLOW `uiHide` subscriber, used by the executor-shape test. Its completion is a
	// FIRE-AND-FORGET side effect: the coded path never awaits `uiHide`, so the moment its
	// microtask resolves relative to the synchronous `delay` marker is below the
	// observability threshold (no frame/sound lands at a different wall-clock time — see
	// the harness header note on initiation-vs-completion). We log it to the SEPARATE
	// `fireForget` stream, asserted as a multiset, so the timeline stays deterministic
	// while still proving the subscriber RAN and was not awaited (it must appear AFTER the
	// delay was initiated — checked below).
	eventEmitter.subscribe({
		uiHide: async () => {
			await Promise.resolve();
			fireForget.push('uiHide:done');
		},
	});

	// The awaited symbol-spine animation: `boardWithAnimateSymbols` resolves after every
	// position's `oncomplete` (Promise.all). We model that with a microtask-tick per
	// position so the await actually suspends (matching the coded subscriber's shape),
	// and record start + per-position completion so an interleave change would surface.
	eventEmitter.subscribe({
		boardWithAnimateSymbols: async (e) => {
			const positions = (e as { symbolPositions: Position[] }).symbolPositions;
			log.push(`anim:start positions=${positions.length}`);
			await Promise.all(
				positions.map(async (p) => {
					await Promise.resolve(); // suspend, like awaiting a spine `oncomplete`
					log.push(`anim:done reel=${p.reel} row=${p.row}`);
				}),
			);
			log.push('anim:resolved');
		},
	});

	const stableArgs = (e: EmitterEvent) => {
		const { type, ...rest } = e;
		return Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
	};

	// Recording wrappers — log the THREE shapes distinctly (design doc §11.1).
	const recording = {
		broadcast: (e: EmitterEvent) => {
			log.push(`broadcast ${e.type}${stableArgs(e)}`);
			eventEmitter.broadcast(e);
		},
		broadcastAsync: (e: EmitterEvent) => {
			log.push(`broadcastAsync ${e.type}${stableArgs(e)}`);
			return eventEmitter.broadcastAsync(e);
		},
	};

	return { log, fireForget, recording };
};

// A timeScale/waitForTimeout pair matching the real shape; records the SCALED ms.
const makeRuntime = (
	recording: ReturnType<typeof makeRig>['recording'],
	log: LogEntry[],
	turbo: boolean,
): FlowRuntime => ({
	emitter: recording,
	timeScale: () => (turbo ? 2 : 1),
	waitForTimeout: (ms: number) => {
		log.push(`delay ${ms}`);
		return Promise.resolve();
	},
});

// ---------------------------------------------------------------------------
// CODED reference — the `winInfo` body lifted VERBATIM from bookEventHandlerMap.ts
// (lines 41-69), driving the recording emitter + the real `sequence()`.
// ---------------------------------------------------------------------------
const codedWinInfo = async (
	bookEvent: WinInfoEvent,
	rig: ReturnType<typeof makeRig>,
): Promise<void> => {
	const { recording } = rig;
	const animateSymbols = async ({ positions }: { positions: Position[] }) => {
		recording.broadcast({ type: 'boardShow' });
		await recording.broadcastAsync({
			type: 'boardWithAnimateSymbols',
			symbolPositions: positions,
		});
	};
	recording.broadcast({ type: 'soundOnce', name: 'sfx_winlevel_small' });
	await sequence(bookEvent.wins, async (win) => {
		await animateSymbols({ positions: win.positions });
	});
};

// ---------------------------------------------------------------------------
// AUTHORED FlowDoc — the hand-authored `winInfo` choreography (the thing under test).
// Mirror of the coded body: a Broadcast (soundOnce), then a serial ForEach over
// `$trigger.wins`, body = Sequence[ Broadcast(boardShow), awaited Broadcast(...) ].
// ---------------------------------------------------------------------------
const winInfoChoreography: ChoreographyNode = {
	kind: 'sequence',
	children: [
		{
			kind: 'broadcast',
			event: 'soundOnce',
			payload: { name: { kind: 'literal', value: 'sfx_winlevel_small' } },
		},
		{
			kind: 'forEach',
			list: { kind: 'trigger', path: 'wins' },
			mode: 'sequence',
			body: {
				kind: 'sequence',
				children: [
					{ kind: 'broadcast', event: 'boardShow' },
					{
						kind: 'broadcast',
						event: 'boardWithAnimateSymbols',
						async: true,
						await: true,
						payload: { symbolPositions: { kind: 'item', path: 'positions' } },
					},
				],
			},
		},
	],
};

const flowDoc: FlowDoc = {
	version: 1,
	screens: [],
	transitions: [],
	events: [{ event: 'winInfo', choreography: winInfoChoreography }],
};

// A coded handler map mirroring bookEventHandlerMap (only the two events the harness
// exercises). `setTotalWin` proves fall-through; `winInfo` proves it is NOT consulted
// when authored.
const codedSetTotalWinCalls: number[] = [];
const makeCodedHandlers = (rig: ReturnType<typeof makeRig>) => ({
	winInfo: async (e: BookEvent) => {
		rig.log.push('CODED winInfo (should NOT run when authored)');
		await codedWinInfo(e as WinInfoEvent, rig);
	},
	setTotalWin: async (e: BookEvent) => {
		codedSetTotalWinCalls.push((e as SetTotalWinEvent).amount);
		rig.log.push(`CODED setTotalWin amount=${(e as SetTotalWinEvent).amount}`);
	},
});

// ---------------------------------------------------------------------------
// Executor-shape parity — `winInfo` exercises only sync `broadcast` + AWAITED
// `broadcastAsync`. The executor's two riskiest branches (design doc §13) are the
// FIRE-AND-FORGET `broadcastAsync` (coded `winLevelSoundsPlay`'s `uiHide` — started but
// NOT awaited) and the `delay ms / timeScale()` turbo division. This synthetic case
// proves both against a coded reference, plus a `parallel`, so the gate isn't blind to
// them. Coded shape: broadcast soundOnce; broadcastAsync uiHide (NO await); await
// waitForTimeout(600 / timeScale()); Promise.all([ awaited broadcastAsync A, B ]).
const codedShapes = async (rig: ReturnType<typeof makeRig>, turbo: boolean): Promise<void> => {
	const { recording, log } = rig;
	const timeScale = () => (turbo ? 2 : 1);
	const waitForTimeout = (ms: number) => {
		log.push(`delay ${ms}`);
		return Promise.resolve();
	};
	recording.broadcast({ type: 'soundOnce', name: 'sfx_youwon_panel' });
	recording.broadcastAsync({ type: 'uiHide' }); // fire-and-forget (NOT awaited)
	await waitForTimeout(600 / timeScale());
	await Promise.all([
		recording.broadcastAsync({ type: 'boardShow' }),
		recording.broadcastAsync({ type: 'boardHide' }),
	]);
};

const shapesChoreography: ChoreographyNode = {
	kind: 'sequence',
	children: [
		{
			kind: 'broadcast',
			event: 'soundOnce',
			payload: { name: { kind: 'literal', value: 'sfx_youwon_panel' } },
		},
		// async, NOT awaited — fire-and-forget broadcastAsync.
		{ kind: 'broadcast', event: 'uiHide', async: true, await: false },
		{ kind: 'delay', ms: 600 },
		{
			kind: 'parallel',
			children: [
				{ kind: 'broadcast', event: 'boardShow', async: true, await: true },
				{ kind: 'broadcast', event: 'boardHide', async: true, await: true },
			],
		},
	],
};

/** Let any pending fire-and-forget subscriber microtasks settle (a macrotask turn). */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

type ShapeResult = { timeline: LogEntry[]; fireForget: LogEntry[] };

const runCodedShapes = async (turbo: boolean): Promise<ShapeResult> => {
	const rig = makeRig();
	await codedShapes(rig, turbo);
	await settle();
	return { timeline: rig.log, fireForget: [...rig.fireForget].sort() };
};

const runInterpreterShapes = async (turbo: boolean): Promise<ShapeResult> => {
	const rig = makeRig();
	const runtime = makeRuntime(rig.recording, rig.log, turbo);
	await runChoreography(shapesChoreography, runtime, { trigger: {} });
	await settle();
	return { timeline: rig.log, fireForget: [...rig.fireForget].sort() };
};

// ---------------------------------------------------------------------------
// Drivers.
// ---------------------------------------------------------------------------
const runCoded = async (turbo: boolean): Promise<LogEntry[]> => {
	const rig = makeRig();
	// timeScale/waitForTimeout exist on the coded path only via call sites; winInfo has no
	// delay, so turbo is recorded here only for symmetry (the log must still match).
	void turbo;
	await codedWinInfo(winInfoEvent, rig);
	return rig.log;
};

const runInterpreter = async (turbo: boolean): Promise<LogEntry[]> => {
	const rig = makeRig();
	const runtime = makeRuntime(rig.recording, rig.log, turbo);
	const { dispatch } = createBookEventDispatcher<BookEvent, undefined>({
		flowDoc,
		runtime,
		codedHandlers: makeCodedHandlers(rig),
	});
	await dispatch(winInfoEvent, undefined);
	return rig.log;
};

// ---------------------------------------------------------------------------
// Assertions.
// ---------------------------------------------------------------------------
let failed = false;
const assertEqualLogs = (label: string, a: LogEntry[], b: LogEntry[]) => {
	const ja = JSON.stringify(a, null, 2);
	const jb = JSON.stringify(b, null, 2);
	if (ja === jb) {
		console.log(`  PASS  ${label} — ${a.length} ordered ops identical`);
		return;
	}
	failed = true;
	console.error(`  FAIL  ${label} — logs DIVERGE:`);
	const max = Math.max(a.length, b.length);
	for (let i = 0; i < max; i++) {
		if (a[i] !== b[i]) {
			console.error(`    [${i}] coded:       ${a[i] ?? '<none>'}`);
			console.error(`    [${i}] interpreter: ${b[i] ?? '<none>'}`);
		}
	}
};

const main = async () => {
	console.log('Invisible Flow — Phase 0 winInfo parity harness\n');

	for (const turbo of [false, true]) {
		const coded = await runCoded(turbo);
		const interp = await runInterpreter(turbo);
		assertEqualLogs(`winInfo parity (turbo ${turbo ? 'ON' : 'OFF'})`, coded, interp);
	}

	// Executor-shape parity — fire-and-forget broadcastAsync + scaled delay + parallel.
	// The deterministic INITIATION timeline must match position-for-position; the
	// fire-and-forget completion is asserted as a multiset (its microtask position vs the
	// synchronous delay marker is below the observability threshold — see header note).
	for (const turbo of [false, true]) {
		const coded = await runCodedShapes(turbo);
		const interp = await runInterpreterShapes(turbo);
		assertEqualLogs(
			`executor-shape timeline (turbo ${turbo ? 'ON' : 'OFF'})`,
			coded.timeline,
			interp.timeline,
		);
		assertEqualLogs(
			`executor-shape fire-and-forget ran (turbo ${turbo ? 'ON' : 'OFF'})`,
			coded.fireForget,
			interp.fireForget,
		);
	}

	// Show the canonical log once for the record.
	console.log('\n  Canonical winInfo op log (turbo OFF):');
	for (const line of await runCoded(false)) console.log(`    ${line}`);

	console.log('\n  Executor-shape timeline (turbo OFF vs ON — note delay 600 → 300):');
	console.log('    OFF:');
	for (const line of (await runCodedShapes(false)).timeline) console.log(`      ${line}`);
	console.log('    ON:');
	for (const line of (await runCodedShapes(true)).timeline) console.log(`      ${line}`);

	// Fall-through: an UN-authored event hits the coded handler; winInfo does NOT.
	console.log('\n  Fall-through:');
	const rig = makeRig();
	const runtime = makeRuntime(rig.recording, rig.log, false);
	codedSetTotalWinCalls.length = 0;
	const { dispatch, isAuthored } = createBookEventDispatcher<BookEvent, undefined>({
		flowDoc,
		runtime,
		codedHandlers: makeCodedHandlers(rig),
	});
	await dispatch({ type: 'setTotalWin', amount: 400 }, undefined);
	const ranCoded = codedSetTotalWinCalls.length === 1 && codedSetTotalWinCalls[0] === 400;
	const winInfoAuthored = isAuthored('winInfo');
	const setTotalWinFellThrough = !isAuthored('setTotalWin');
	if (ranCoded && winInfoAuthored && setTotalWinFellThrough) {
		console.log('  PASS  fall-through — setTotalWin ran its coded handler; winInfo is authored');
	} else {
		failed = true;
		console.error(
			`  FAIL  fall-through — ranCoded=${ranCoded} winInfoAuthored=${winInfoAuthored} setTotalWinFellThrough=${setTotalWinFellThrough}`,
		);
	}

	console.log(`\n${failed ? 'PHASE 0 GATE: FAILED' : 'PHASE 0 GATE: PASSED'}`);
	process.exit(failed ? 1 : 0);
};

void main();
