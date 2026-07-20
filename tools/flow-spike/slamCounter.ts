/**
 * SLAM × free-spin COUNTER — the PRESENTATION-level harness.
 *
 *   pnpm --filter flow-spike run slamcounter
 *
 * Drives the canonical book-of choreographies (`BOOK_OF_CHOREO` — the artifact `apps/lines` builds
 * `LINES_FLOW_V2_DOC` from) over a real free-spin book-event order through `runFlowEvent`, wired to
 * the GAME's real slam plumbing (`roundSkip` + `awaitCue` / `waitPresentation` /
 * `runBookEventPresentation` from `apps/lines/src/game/unskippablePresentation`) and a faithful copy
 * of the slam-aware container mount.
 *
 * WHY IT MEASURES PRESENTATION, NOT STATE. The counter's state writes are synchronous, so they land
 * correctly no matter what the slam token says — a state-level assertion passes even when the
 * counter is visibly broken. What actually breaks is the counter's PRESENTATION being processed
 * under a tripped token: its cues collapse and a `showContainer{awaitComplete}` on its chain is
 * auto-completed by the slam-aware mount, which the authored chain follows with a `hideContainer`.
 * So every assertion here is about the token state and the observed DURATION of each cue.
 */

import {
	buildChoreo,
	createContainerMountModel,
	createFlowV2Env,
	makeChoreoUid,
	runFlowEvent,
	BOOK_OF_CHOREO,
	BOOK_OF_VOCAB,
	type ContainerMountModel,
	type DataEdge,
	type ExecEdge,
	type FlowDoc,
	type Node,
	type RunContext,
} from 'engine-flow-v2';
import { roundSkip } from 'utils-shared/skipToken';

import {
	awaitCue,
	rearmSlamForSpin,
	runBookEventPresentation,
	waitPresentation,
} from '../../apps/lines/src/game/unskippablePresentation';

let failed = false;
const assert = (label: string, ok: boolean, detail?: string) => {
	if (ok) console.log(`  PASS  ${label}`);
	else {
		failed = true;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	}
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---- the reference v2 doc, built exactly as `apps/lines/flowV2Doc.ts` does -------------------
const nodes: Node[] = [];
const exec: ExecEdge[] = [];
const data: DataEdge[] = [];
const uid = makeChoreoUid();
for (const [event, steps] of Object.entries(BOOK_OF_CHOREO)) {
	const eventId = `on_${event}`;
	nodes.push({ id: eventId, kind: 'event', pos: { x: 0, y: 0 }, ref: event });
	const body = buildChoreo(steps, uid);
	nodes.push(...body.nodes);
	exec.push(...body.exec);
	data.push(...body.data);
	if (body.entry)
		exec.push({ from: { node: eventId, pin: 'exec' }, to: { node: body.entry, pin: 'exec' } });
}
const doc: FlowDoc = {
	version: 2,
	templateId: 'bookOf',
	graph: { nodes, exec, data },
	containers: [
		{ id: 'basegame', sceneId: 'basegame', z: 0 },
		{ id: 'freeSpinCounter', sceneId: 'freeSpinCounter', z: 30 },
	],
};

// ---- the book, in the REAL order (verified against the 10,100 reference books) ----------------
// A free spin's events are `updateFreeSpin` → `reveal` → …, i.e. the counter update LEADS the spin
// it labels. That ordering is the whole point of this harness.
const TOTAL_FS = 12;
type BookEvent = { type: string } & Record<string, unknown>;
const book: BookEvent[] = [
	{ type: 'reveal', gameType: 'basegame' },
	{ type: 'setTotalWin', amount: 0 },
	{ type: 'freeSpinTrigger', totalFs: TOTAL_FS, positions: [] },
	{ type: 'setExpandingSymbol', symbol: 'H1' },
];
for (let spin = 0; spin < TOTAL_FS; spin += 1) {
	book.push({ type: 'updateFreeSpin', amount: spin, total: TOTAL_FS, freeSpinIndex: spin });
	book.push({ type: 'reveal', gameType: 'freegame', freeSpinIndex: spin });
	if (spin % 4 === 3)
		book.push({ type: 'winInfo', wins: [{ symbol: 'H1', kind: 3, win: 100, positions: [] }] });
	book.push({ type: 'setTotalWin', amount: 100 });
}
book.push({ type: 'freeSpinEnd', amount: 1200, winLevel: 3 });

// ---- observation ------------------------------------------------------------------------------
const SLAM_ON = Number(process.env.SLAM_ON ?? '2');
/** The realistic player: presses on EVERY free spin from `SLAM_ON` on, not just once. */
const SLAM_EVERY = Boolean(process.env.SLAM_EVERY);
const CUE_MS = 60;

type CueObservation = { event: string; spin: number; cue: string; ms: number; collapsed: boolean };
type EventObservation = { event: string; spin: number; trippedAtDispatch: boolean };

const cueLog: CueObservation[] = [];
const eventLog: EventObservation[] = [];
const counterWrites: Array<{ current: number; total: number }> = [];
const holdAutoCompleted = new Map<number, boolean>();

let currentEvent = '';
let currentSpin = -1;

const effects: Record<string, (payload: Record<string, unknown>) => unknown> = {
	updateFreeSpinCounter: (payload) => {
		counterWrites.push({
			current: (payload.amount as number) + 1,
			total: payload.total as number,
		});
	},
	setFreeSpinCounterTotal: () => undefined,
	setFreeSpinCounterTotalOnly: () => undefined,
	freeSpinCounterShow: () => undefined,
	freeSpinCounterUpdate: () => undefined,
	revealBoard: async () => {
		// `REARM_AT_REVEAL=1` reproduces the OLD placement (the re-arm inside the `reveal` leaf), so a
		// run against pre-fix `apps/lines` is apples-to-apples rather than "no re-arm at all".
		if (process.env.REARM_AT_REVEAL) rearmSlamForSpin();
		if (currentSpin === SLAM_ON || (SLAM_EVERY && currentSpin >= SLAM_ON))
			setTimeout(() => roundSkip.skip(), 120); // the player slams this spin mid-roll
		await roundSkip.race(wait(400));
	},
	animateWinSymbols: async () => {
		await awaitCue('boardWithAnimateSymbols', wait(300));
	},
	showMessage: async () => undefined,
	winLevelSoundsPlay: () => undefined,
	winLevelSoundsStop: () => undefined,
	setFreeGameType: () => undefined,
	freeSpinIntroShow: () => undefined,
	freeSpinIntroHide: () => undefined,
	enterFreeSpinOutro: () => undefined,
	exitFreeSpinOutro: () => undefined,
	freeSpinOutroCountUp: async () => undefined,
	setSpecialSymbol: () => undefined,
	setTotalWin: () => undefined,
	winShow: () => undefined,
	winHide: () => undefined,
	showWinLine: () => undefined,
	hideWinLine: () => undefined,
	enableSequentialReelStop: () => undefined,
	disableSequentialReelStop: () => undefined,
};

// The slam-aware container mount, copied from `apps/lines/src/game/flowV2Runtime.svelte.ts`.
const rawMount = createContainerMountModel(doc.containers, () => undefined);
const mount: ContainerMountModel = {
	...rawMount,
	awaitComplete: (id) => {
		const held = rawMount.awaitComplete(id);
		const unsubscribe = roundSkip.onSkip(() => void rawMount.complete(id));
		return held.then(() => {
			unsubscribe();
		});
	},
};

const env = createFlowV2Env({
	mount,
	effect: (name) => effects[name],
	broadcast: (cue, payload) => {
		void payload;
		const started = Date.now();
		const event = currentEvent;
		const spin = currentSpin;
		return awaitCue(cue, wait(CUE_MS)).then(() => {
			const ms = Date.now() - started;
			cueLog.push({ event, spin, cue, ms, collapsed: ms < CUE_MS / 2 });
		});
	},
	waitForTimeout: waitPresentation,
	timeScale: () => 1,
	engineRead: () => 0,
});

const ctx: RunContext = { vocab: BOOK_OF_VOCAB, library: { version: 2, functions: [] }, env };

/**
 * Probe the ROUND-BLOCK HOLD an authored counter chain would carry: show the container, then see
 * whether `awaitComplete` resolves on its own (the slam-aware mount auto-completing it) inside a
 * beat. Cannot hang — it is raced against a timer, and `hide` releases any hold left pending.
 */
const probeHold = async (spin: number): Promise<void> => {
	mount.show('freeSpinCounter');
	let autoCompleted = false;
	await Promise.race([
		mount.awaitComplete('freeSpinCounter').then(() => {
			autoCompleted = true;
		}),
		wait(30),
	]);
	holdAutoCompleted.set(spin, autoCompleted);
	mount.hide('freeSpinCounter');
};

const main = async () => {
	console.log(
		`Invisible Flow v2 — slam × free-spin counter PRESENTATION (slam on spin #${SLAM_ON})\n`,
	);

	roundSkip.reset();
	const started = Date.now();
	let settled = false;
	const guard = setTimeout(() => {
		if (!settled) {
			console.error('\nHANG: the round never settled');
			process.exit(1);
		}
	}, 60_000);

	for (const bookEvent of book) {
		currentEvent = bookEvent.type;
		currentSpin = (bookEvent.freeSpinIndex as number | undefined) ?? -1;
		await runBookEventPresentation(bookEvent.type, async () => {
			// Sampled INSIDE the dispatch, i.e. after the per-spin re-arm has had its chance to run.
			eventLog.push({
				event: bookEvent.type,
				spin: currentSpin,
				trippedAtDispatch: roundSkip.isSkipped(),
			});
			if (bookEvent.type === 'updateFreeSpin') await probeHold(currentSpin);
			await runFlowEvent(doc, ctx, bookEvent.type, bookEvent, { bookEvents: book });
		});
	}
	settled = true;
	clearTimeout(guard);
	console.log(`round settled in ${Date.now() - started}ms\n`);

	const updateOf = (spin: number) =>
		eventLog.find((e) => e.event === 'updateFreeSpin' && e.spin === spin);
	const cuesOf = (event: string, spin: number) =>
		cueLog.filter((c) => c.event === event && c.spin === spin);

	console.log('1. the counter state is written once per free spin (never was the bug):');
	const expected = Array.from({ length: TOTAL_FS }, (_, i) => `${i + 1}/${TOTAL_FS}`);
	const observed = counterWrites.map((w) => `${w.current}/${w.total}`);
	assert(
		'12 writes, in order',
		observed.length === expected.length && observed.every((v, i) => v === expected[i]),
		observed.join(' '),
	);

	console.log('\n2. the SLAMMED spin still fast-forwards:');
	const slammedTail = cueLog.filter((c) => c.spin === SLAM_ON && c.event !== 'updateFreeSpin');
	assert(
		`spin #${SLAM_ON} collapsed its post-slam cues`,
		slammedTail.length > 0 && slammedTail.some((c) => c.collapsed),
		slammedTail.map((c) => `${c.cue}:${c.ms}ms`).join(' '),
	);

	console.log('\n3. the spin AFTER the slam is presented with a FRESH token — the regression:');
	const next = SLAM_ON + 1;
	const nextUpdate = updateOf(next);
	assert(
		`spin #${next} dispatched 'updateFreeSpin' with the token UN-tripped`,
		nextUpdate !== undefined && !nextUpdate.trippedAtDispatch,
		nextUpdate ? `trippedAtDispatch=${nextUpdate.trippedAtDispatch}` : 'no dispatch recorded',
	);
	const nextCues = cuesOf('updateFreeSpin', next);
	assert(
		`spin #${next} counter cues were AWAITED, not collapsed`,
		nextCues.length > 0 && nextCues.every((c) => !c.collapsed),
		nextCues.map((c) => `${c.cue}:${c.ms}ms`).join(' '),
	);
	assert(
		`spin #${next} awaitComplete hold was NOT auto-completed`,
		holdAutoCompleted.get(next) === false,
		`autoCompleted=${holdAutoCompleted.get(next)}`,
	);

	console.log('\n4. every LATER free spin is unaffected too:');
	const laterBroken = Array.from({ length: TOTAL_FS }, (_, i) => i)
		.filter((spin) => spin > SLAM_ON)
		.filter(
			(spin) =>
				updateOf(spin)?.trippedAtDispatch !== false || holdAutoCompleted.get(spin) !== false,
		);
	assert(
		'no later spin presented its counter under a tripped token',
		laterBroken.length === 0,
		`spins ${laterBroken.join(',')}`,
	);

	console.log('\n5. the base game is untouched by the per-spin re-arm:');
	const baseEvents = eventLog.filter((e) => e.spin === -1 && e.event === 'reveal');
	assert('the base reveal never re-armed mid-round', baseEvents.length === 1);
	assert('the round settled (no hang)', settled);

	console.log(failed ? '\nFAILED' : '\nOK');
	process.exit(failed ? 1 : 0);
};

void main();
