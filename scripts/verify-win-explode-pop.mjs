// Offline fixture for the WIN-EXPLOSION POP — Invisible Symbols State Machine → "Winning symbols
// explode" (`winExplode`).
//
//   node scripts/verify-win-explode-pop.mjs
//
// THE BUG IT EXISTS FOR. The pop shipped as the tail of the WIN BEAT: a winning cell played its
// `explosion` and was taken off the board at the end of its own win. But a round presents its wins
// ONE AFTER ANOTHER over the same board (`bookEventHandlerMap.winInfo` → `sequence(bookEvent.wins,
// …)`), and overlapping paylines share cells — `apps/lines/src/game/config.ts` line 1
// (`[0,0,0,0,0]`), line 6 (`[0,0,1,2,2]`) and line 18 (`[0,0,2,0,0]`) all pay on reels 0-1 of row 0.
// So win A popped a cell that win B still had to light; win B set `symbolState = 'win'` on a cell
// that no longer renders, whose `oncomplete` can therefore never fire, and the beat settled only on
// `WIN_BEAT_CAP_MS` — then armed a second unfirable one for the pop. Roughly eight seconds of frozen
// presentation, on a quarter of the reference books' paying events (part 1 counts them).
//
// THE FIX, and what this file proves: the pop is DEFERRED to the end of a SPIN's whole win
// presentation. Every win narrates exactly as it does with the switch OFF; then that spin's
// ACCUMULATED winning cells — deduped by seat, which is the part the shared-cell case turns on —
// play `explosion` together, once, and leave the board.
//
// THE TWO BUGS FOUND IN REVIEW OF THAT FIX, which parts 10 and 11 exist for:
//
//   - A SLAMMED paying spin froze for ~4s. The slam drops the win beat's subscriber promise
//     (`awaitCue` → `slamHold`) and the board handler keeps running DETACHED; its `postWinStatic`
//     revert then landed 50ms INTO the pop that had already started, tore the `explosion` down, and
//     the pop settled only on `WIN_BEAT_CAP_MS`. Structural: the last win's floor lands at
//     `(W-1)·H + WIN_BEAT_MIN_MS` and the pop starts at `W·H`, with the slam hold `H` always under
//     the floor.
//   - The pop fired once per BOOK, not once per SPIN. `playBet` runs once per book while the
//     recorded wins are cleared at every board change, so only the wins after the LAST `reveal` were
//     ever popped — 5255 of 7480 paying spins in `base_books`, 23 of 250 in `bonus_books`.
//
// WHAT IT PROVES, in eleven parts.
//
//   1. THE CORPUS. Shared paying cells are not hypothetical: the real `base_books.ts` is scanned
//      through the REAL `winningPositionsOf`, and the share of `winInfo` events with at least one
//      cell paid by two wins is asserted to be a large minority. This is the fixture's claim that
//      the bug was on the common path, not a corner.
//
//   2. THE NARRATION IS UNTOUCHED. The REAL coded `winInfo` handler drives the REAL
//      `animateSymbols` into the REAL `Board.svelte` win-beat handler, on a virtual clock, over a
//      two-win event that shares cells. Every paying cell of every win must be lit, the round must
//      cost two ordinary win beats (not a cap), and the whole transition log must be IDENTICAL with
//      the pop ON and OFF. The harness's ability to SEE a cap is anchored by a run where the art
//      never reports.
//
//   3. THE POP ITSELF, over the REAL `explodeSpinWinners` + the REAL `boardExplodeWinSymbols`
//      handler: one broadcast, the deduped union of the round's paying cells, one `explosion` per
//      cell, removed on BOTH exits of the bounded race, and nothing at all when the switch is off,
//      when the round paid nothing, or when the cells are already gone.
//
//   4. THE ROUND SEAM. The REAL `playBet` (and the REAL `playBookEvents` it wraps) is evaluated
//      and driven down all four paths — the coded handler map, a v2 flow that OWNS the events, a
//      slammed round, and a round with no win at all — plus a round whose book throws. The pop must
//      run on every one of them, be AWAITED, and land before the resting replay starts. The other
//      seam, the between-spins hold (`freeSpinHold.holdAfterBigWin`), is driven the same way.
//
//   5. THE RENDER GATE. `ReelSymbol.svelte`'s own `removed` derivation and its own `{#if}`
//      condition are evaluated as JavaScript over the whole truth table — the single claim that a
//      removed cell actually stops being drawn.
//
//   6. `boardRemoved()` IS INDEX-ALIGNED WITH `boardRaw()`. Both real, over a ragged board: same
//      column count, same column lengths, cell for cell. Every reader addresses the removal set by
//      position, so this is the premise they all rest on.
//
//   7. THE RESTING REPLAY. The REAL `cycleEntries` is evaluated against a partially removed board:
//      exact entries, not "it mentions the removal set".
//
//   8. THE DEFENSIVE GUARD. The win beat must refuse to re-light a cell that is already off the
//      board, so a future caller cannot reintroduce the stall. Driven, not read.
//
//   9. CONTAINMENT. With the switch OFF nothing anywhere is removed and no pop cue is broadcast;
//      with it ON nothing is removed until the pop runs.
//
//  10. THE SLAMMED SPIN, timed. The REAL `playBet` is driven with the token tripped WHERE A PLAYER
//      TRIPS IT — as the win narrates, because `playBet` resets it before the first book event, so a
//      world built already-skipped is byte-identical to an un-slammed one and proves nothing. One
//      ordinary win with `{win: 300, explosion: 200}` must pop at 600 and finish at 800 (against
//      650/850 unslammed), not 4600; the two-win case must land the same overlap one win later.
//
//  11. ONCE PER PAYING SPIN. Multi-spin books — free spins and a cascade — are driven through the
//      REAL `playBookEvents` with the board REBUILT at every `reveal`/`tumbleBoard` exactly as
//      `createReelSymbols` does, so a pop that fired one event late would be naming the next board's
//      seats. Then the whole reference corpus is replayed A/B through the REAL `recordWinCycleWins`
//      + `explodeSpinWinners`, with and without the per-spin seam, and the pop count is asserted
//      against the number of paying spins.
//
// WHAT IT CANNOT PROVE. Nothing here draws, so what an explosion LOOKS like is out of scope, as is
// whether `WIN_BEAT_CAP_MS` is the right number. `awaitCue` is sliced real but
// `inUnskippablePresentation` is stubbed false (its `depth` counter is module-private and belongs to
// the book-event dispatcher, which is not what is under test); the slam path is therefore exercised
// through the token, not through a celebration window. The win LINE is drawn through stubs — its
// geometry has its own gates — but the handler's real ordering around it is what runs.
//
// Everything under test is SLICED OUT OF THE SHIPPED SOURCE (the modules are runes/Svelte and
// cannot be imported from Node), and the type removal is Node's own `stripTypeScriptTypes`, so a
// rename fails loudly here rather than leaving the fixture quietly asserting nothing.

import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sequence } from '../packages/utils-shared/sequence.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// The repo checks out CRLF on Windows; every slice marker below is written with `\n`.
const read = (path) => readFileSync(join(ROOT, path), 'utf8').replace(/\r\n/g, '\n');

let failures = 0;
let checks = 0;
const check = (label, actual, expected) => {
	checks += 1;
	if (!Object.is(actual, expected)) {
		failures += 1;
		console.log(
			`FAIL  ${label}\n      got=${JSON.stringify(actual)} want=${JSON.stringify(expected)}`,
		);
	}
};

/** Slice `[from, to)` out of the source, or throw with the marker that went missing. */
const sliceBetween = (source, what, from, to) => {
	const start = source.indexOf(from);
	if (start < 0) throw new Error(`${what}: could not find "${from}"`);
	const end = source.indexOf(to, start + from.length);
	if (end < 0) throw new Error(`${what}: could not find "${to}" after it`);
	return source.slice(start, end + to.length);
};

// `stripTypeScriptTypes` is flagged experimental, and the warning would be the loudest line in a
// passing run. Silenced narrowly — anything else Node has to say still gets through.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
	const type = typeof rest[0] === 'string' ? rest[0] : rest[0]?.type;
	if (type === 'ExperimentalWarning' && String(warning).includes('stripTypeScriptTypes')) return;
	emitWarning(warning, ...rest);
};

/** A source slice, as JavaScript this fixture can evaluate. Runes reduce to the identity their
 *  VALUE semantics have outside a component. */
const stripTypes = (what, source) => {
	let js;
	try {
		js = stripTypeScriptTypes(source, { mode: 'strip' });
	} catch (error) {
		throw new Error(`${what}: the slice is not strippable TypeScript — ${error.message}`);
	}
	return js
		.replace(/\$state\.raw\s*\(/g, '(')
		.replace(/\$state\s*\(/g, '(')
		.replace(/\$derived\s*\(/g, '(')
		.replace(/^export /gm, '');
};

// ---------------------------------------------------------------------------
// THE SLICES — every function under test, taken from the shipped file.
// ---------------------------------------------------------------------------

const symbolBeatSource = read('apps/lines/src/game/symbolBeat.ts');
const flowEffectsSource = read('apps/lines/src/game/flowEffects.ts');
const unskippableSource = read('apps/lines/src/game/unskippablePresentation.ts');
const handlerMapSource = read('apps/lines/src/game/bookEventHandlerMap.ts');
const winCycleSource = read('apps/lines/src/game/winSymbolCycle.ts');
const utilsSource = read('apps/lines/src/game/utils.ts');
const freeSpinHoldSource = read('apps/lines/src/game/freeSpinHold.ts');
const gameStateSource = read('packages/engine-game/src/game/gameState.svelte.ts');
const boardSource = read('apps/lines/src/components/Board.svelte');
const reelSymbolSource = read('apps/lines/src/components/ReelSymbol.svelte');

const slices = [
	// The bounded beat and its two constants — the runaway guard the stall used to be paid in.
	sliceBetween(symbolBeatSource, 'awaitSymbolBeat', 'export const awaitSymbolBeat = (', ';\n'),
	sliceBetween(symbolBeatSource, 'WIN_BEAT_CAP_MS', 'export const WIN_BEAT_CAP_MS = ', ';\n'),
	sliceBetween(symbolBeatSource, 'WIN_BEAT_MIN_MS', 'export const WIN_BEAT_MIN_MS = ', ';\n'),
	// …and the budget that picks between them, with the transit cap it floors an un-authored beat
	// at. Sliced rather than restated for the same reason the two caps are: a fixture carrying its
	// own copy would go on asserting a ceiling the game had stopped honouring. It is also what took
	// this whole file out — a new free identifier landed in the handler and the slice threw here, on
	// `main`, before a single claim below could run.
	sliceBetween(symbolBeatSource, 'TRANSIT_BEAT_CAP_MS', 'export const TRANSIT_BEAT_CAP_MS = ', ';\n'), // prettier-ignore
	sliceBetween(symbolBeatSource, 'resolveWinBeatBudget', 'export const resolveWinBeatBudget = (', '\n};\n'), // prettier-ignore
	// The slam policy the coded handler and `animateSymbols` reach every cue through.
	sliceBetween(unskippableSource, 'PLAYER_GATED_CUES', 'export const PLAYER_GATED_CUES', ']);\n'),
	sliceBetween(unskippableSource, 'SLAM_MINIMUM_DISPLAY_CUES', 'export const SLAM_MINIMUM_DISPLAY_CUES', ';\n'), // prettier-ignore
	sliceBetween(unskippableSource, 'SLAM_SYMBOL_HOLD_MS', 'export const SLAM_SYMBOL_HOLD_MS = ', ';\n'), // prettier-ignore
	sliceBetween(unskippableSource, 'SLAM_MESSAGE_HOLD_MS', 'export const SLAM_MESSAGE_HOLD_MS = ', ';\n'), // prettier-ignore
	sliceBetween(unskippableSource, 'slamHold', 'export const slamHold = (', ';\n'),
	sliceBetween(unskippableSource, 'awaitCue', 'export const awaitCue = (', '\n};\n'),
	// The win-symbol leaf every dispatch path funnels through, and the paying-cell slice.
	sliceBetween(flowEffectsSource, 'awaitPresentation', 'const awaitPresentation = (', ';\n'),
	sliceBetween(flowEffectsSource, 'winningPositionsOf', 'export const winningPositionsOf = (', '\n};\n'), // prettier-ignore
	sliceBetween(flowEffectsSource, 'animateSymbols', 'export const animateSymbols = async ({', '\n};\n'), // prettier-ignore
	// The engine's two board publishers, read side by side because part 6 is about their alignment.
	sliceBetween(gameStateSource, 'winDimCellKey', '\tconst winDimCellKey = (', ';\n'),
	sliceBetween(gameStateSource, 'boardRaw', '\tconst boardRaw = () =>', ';\n'),
	sliceBetween(gameStateSource, 'boardRemoved', '\tconst boardRemoved = () =>', ';\n'),
	// The cycle module: the accumulated wins, the spin's winning set, the pop, the rotation.
	sliceBetween(winCycleSource, 'wins', 'let wins: CycleWin[] = [];', ';\n'),
	sliceBetween(winCycleSource, 'winKey', 'const winKey = (win: CycleWin): string =>', ';\n'),
	sliceBetween(winCycleSource, 'refreshWinDim', 'const refreshWinDim = (): void => {', '\n};\n'),
	sliceBetween(winCycleSource, 'REPLACES_THE_BOARD', 'const REPLACES_THE_BOARD', ';\n'),
	sliceBetween(winCycleSource, 'recordWinCycleWins', 'export const recordWinCycleWins = (', '\n};\n'), // prettier-ignore
	sliceBetween(winCycleSource, 'spinWinningPositions', 'const spinWinningPositions = (', '\n};\n'),
	sliceBetween(winCycleSource, 'explodeSpinWinners', 'export const explodeSpinWinners = async (', '\n};\n'), // prettier-ignore
	sliceBetween(winCycleSource, 'explodeWinnersBeforeBoardChange', 'export const explodeWinnersBeforeBoardChange = async (', '\n};\n'), // prettier-ignore
	sliceBetween(winCycleSource, 'forgetWinCycleWins', 'export const forgetWinCycleWins = (', '\n};\n'), // prettier-ignore
	sliceBetween(winCycleSource, 'cycleEntries', 'const cycleEntries = (', '\n};\n'),
	// The round seam itself.
	sliceBetween(utilsSource, 'playBookEvents', 'export const playBookEvents = async (', '\n};\n'),
	sliceBetween(utilsSource, 'playBet', 'export const playBet = async (bet: Bet) => {', '\n};\n'),
	// The other seam.
	sliceBetween(freeSpinHoldSource, 'holdsAfter', 'const holdsAfter = (', '\n};\n'),
	sliceBetween(freeSpinHoldSource, 'holdAfterBigWin', 'export const holdAfterBigWin = async (', '\n};\n'), // prettier-ignore
	// The coded `winInfo` handler — the loop that presents a round's wins one after another.
	`const codedHandlers = {\n${sliceBetween(handlerMapSource, 'winInfo', '\twinInfo: async (bookEvent', '\n\t},\n')}\n};`,
].join('\n\n');

/** The `subscribeOnMount({ … })` argument of `Board.svelte`, by brace balance — the real cue
 *  handlers, including the win beat and the pop. */
const boardHandlersSource = (() => {
	const marker = 'context.eventEmitter.subscribeOnMount(';
	const start = boardSource.indexOf(marker) + marker.length;
	if (start < marker.length) throw new Error('Board.svelte no longer subscribes on mount');
	let depth = 0;
	for (let i = start; i < boardSource.length; i += 1) {
		if (boardSource[i] === '{') depth += 1;
		else if (boardSource[i] === '}') {
			depth -= 1;
			if (depth === 0) return boardSource.slice(start, i + 1);
		}
	}
	throw new Error('could not find the end of the Board cue handlers');
})();
for (const cue of ['boardWithAnimateSymbols', 'boardExplodeWinSymbols']) {
	if (!boardHandlersSource.includes(`${cue}: async (`)) {
		throw new Error(`Board.svelte no longer handles ${cue}`);
	}
}

const runtimeSource = stripTypes(
	'the win-explode slices',
	`${slices}\n\nconst boardHandlers = ${boardHandlersSource};`,
);

// The one constant `Board.svelte` declares outside the handler object and the win beat reads.
const STACKED_WIN_HOLD_MS = Number(
	sliceBetween(boardSource, 'STACKED_WIN_HOLD_MS', 'const STACKED_WIN_HOLD_MS = ', ';\n').match(
		/=\s*(\d+);/,
	)[1],
);

// ---------------------------------------------------------------------------
// THE HARNESS — a virtual clock, a board of reel cells that report like symbols do, and the
// slices above wired to each other exactly as the modules wire them.
// ---------------------------------------------------------------------------

const createClock = () => {
	let now = 0;
	let seq = 0;
	let timers = [];
	const drainMicrotasks = () => new Promise((resolve) => setImmediate(resolve));
	const wait = (ms) =>
		new Promise((resolve) => {
			const delay = typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : 0;
			seq += 1;
			timers.push({ at: now + delay, seq, resolve });
		});
	const run = async (task) => {
		let finished = false;
		const done = task().then(
			(value) => {
				finished = true;
				return value;
			},
			(error) => {
				finished = true;
				throw error;
			},
		);
		// A rejection that is not observed until the loop ends would be an unhandled rejection.
		done.catch(() => {});
		for (let guard = 0; guard < 100000; guard += 1) {
			await drainMicrotasks();
			if (finished) break;
			if (!timers.length) {
				throw new Error('the virtual clock deadlocked: nothing pending and nothing scheduled');
			}
			now = timers.reduce((min, timer) => Math.min(min, timer.at), Number.POSITIVE_INFINITY);
			const due = timers.filter((timer) => timer.at <= now).sort((a, b) => a.seq - b.seq);
			timers = timers.filter((timer) => timer.at > now);
			for (const timer of due) timer.resolve();
		}
		await drainMicrotasks();
		return done;
	};
	return { wait, run, at: () => now };
};

const REELS = 5;
const ROWS = 3;

/**
 * Build one round's world: the board, the emitter, and every sliced function bound to them.
 *
 * `art` maps a symbol STATE to how long its animation takes to report `oncomplete` — `null` is the
 * state bound to art that can never report (no art at all, a spine animation missing from the
 * skeleton), which is the case both bounded races exist for.
 */
const buildRound = ({
	winExplode = false,
	art = { win: 300, explosion: 200 },
	holdAfterBigWinEnabled = false,
	winCycleEnabled = true,
	dimNonWinning = false,
	allAtOnce = false,
	removedSeats = [],
	/** Seats hidden under a stacked picture — they mount no `<Symbol>`, so they can neither draw a
	 *  pop nor report one (docs/design/stacked-picture-mode.md). */
	coveredSeats = [],
	clock = createClock(),
} = {}) => {
	/** Every `symbolState` write, in order, with the virtual time — the round's narration as data. */
	const transitions = [];
	/** Every broadcast, in order. */
	const log = [];

	const makeCell = (reel, row, name) => {
		let state = 'static';
		const cell = {
			rawSymbol: { name },
			winLineColor: undefined,
			removed: removedSeats.some(([r, w]) => r === reel && w === row),
			oncomplete: () => {},
			get symbolState() {
				return state;
			},
			set symbolState(next) {
				state = next;
				transitions.push({ reel, row, state: next, at: clock.at() });
				const beatMs = art[next];
				if (beatMs === undefined || beatMs === null) return;
				// `Symbol.svelte` reports when the state's animation finishes — and a cell that has been
				// taken off the board mounts no renderer, so it cannot report at all.
				void clock.wait(beatMs).then(() => {
					if (cell.removed) return;
					// …AND THE ANIMATION MUST STILL BE THE ONE PLAYING. `ReelSymbol.svelte` forwards
					// `oncomplete` only while the state that armed the beat is still on the cell
					// (`if (props.reelSymbol.symbolState === 'win' | 'explosion')`), and a state write
					// swaps the art out from under the running animation, which then never completes at
					// all. Without this gate the fixture models a cell that reports a beat something else
					// has already taken over — the exact race both bounded waits exist for — so it would
					// pass on a build that freezes for `WIN_BEAT_CAP_MS`.
					if (state !== next) return;
					cell.oncomplete();
				});
			},
		};
		return cell;
	};

	const freshBoard = () =>
		Array.from({ length: REELS }, (_reel, reel) => ({
			reelState: {
				symbols: Array.from({ length: ROWS }, (_row, row) => makeCell(reel, row, `S${reel}${row}`)),
			},
		}));

	const stateGame = { board: freshBoard() };

	/**
	 * What EVERY board replacement does in the game: build fresh cells (`createReelSymbols`, reached
	 * by `prepareToSpin` / `preSpinPadding` / `setSymbolsWithRawSymbols`), so the next board is
	 * un-removed by construction. Without it a fixture that plays a multi-spin book carries the first
	 * spin's removals into the second and can prove nothing about the second's pop.
	 */
	const rebuildBoard = () => {
		stateGame.board = freshBoard();
	};

	const config = {
		winExplode,
		winCycle: { enabled: winCycleEnabled, dimNonWinning, holdAfterBigWin: holdAfterBigWinEnabled },
		winLine: { line: { allAtOnce } },
	};

	let skipped = false;
	const roundSkip = {
		reset: () => {
			skipped = false;
		},
		trip: () => {
			skipped = true;
		},
		isSkipped: () => skipped,
		race: (promise) => (skipped ? Promise.resolve(undefined) : promise.then(() => undefined)),
		wait: (ms) => (skipped ? Promise.resolve() : clock.wait(ms)),
	};

	/** Recorded rather than dropped: which seam ran, and when, is the whole of part 4. */
	const seam = [];
	const eventEmitter = {
		broadcast: (event) => {
			log.push({ type: event.type, at: clock.at() });
		},
		broadcastAsync: async (event) => {
			const entry = { type: event.type, at: clock.at(), event };
			log.push(entry);
			await runtime.boardHandlers[event.type]?.(event);
			entry.done = clock.at();
		},
	};

	const runtime = new Function(
		'waitForResolve',
		'waitForTimeout',
		'sequence',
		'eventEmitter',
		'roundSkip',
		'stateGame',
		'inUnskippablePresentation',
		'bakedWinExplodeEnabled',
		'bakedWinCycleConfig',
		'bakedWinLineConfig',
		'setWinDim',
		'stackedCoverage',
		'stackedWinHoldMs',
		'STACKED_WIN_HOLD_MS',
		'winLineColorForPositions',
		'winLineEnabledForWin',
		'winLinePointsFor',
		'winLineShapeFor',
		'winLineFullPointsFor',
		'winLineColorFor',
		'winLineTextFor',
		'showWinInfoMessage',
		'stateBet',
		'stateUi',
		'stateBetDerived',
		'activeWinLevelIsBig',
		'armSpinHold',
		'clearSpinHold',
		'clearWinPresentation',
		'stopWinCycle',
		'startWinCycle',
		'getFlowInterpreter',
		'getFlowV2',
		'playBookEvent',
		'coded',
		// THE AUTHORED WIN-BEAT CEILING (Invisible Symbols → win beat). Unauthored here, which is the
		// state every project is in until someone sets one, and therefore the behaviour every claim
		// below was written against: `resolveWinBeatBudget` then answers with the coded guard.
		'bakedWinBeatMaxMs',
		// WHICH SYMBOLS AUTHORED A STATE. `false` for everything here: an un-authored state inherits,
		// which is what every project ships with and what these claims measure against.
		'hasAuthoredSymbolState',
		`let show = true;
const context = {
	stateGame,
	eventEmitter,
	stateGameDerived: { enhancedBoard: { stop: () => {}, settle: () => {}, readyToSpinEffect: () => {} } },
};
${runtimeSource}
const stateGameDerived = { boardRaw, boardRemoved };
return {
	boardHandlers,
	codedHandlers,
	animateSymbols,
	winningPositionsOf,
	recordWinCycleWins,
	forgetWinCycleWins,
	explodeSpinWinners,
	explodeWinnersBeforeBoardChange,
	cycleEntries,
	playBet,
	playBookEvents,
	holdAfterBigWin,
	boardRaw,
	boardRemoved,
};`,
	)(
		(arm) => new Promise((resolve) => arm(resolve)),
		(ms) => clock.wait(ms),
		sequence,
		eventEmitter,
		roundSkip,
		stateGame,
		() => false,
		() => config.winExplode,
		() => config.winCycle,
		() => config.winLine,
		() => {},
		() => new Set(coveredSeats.map(([reel, row]) => `${reel}:${row}`)),
		() => undefined,
		STACKED_WIN_HOLD_MS,
		() => undefined,
		() => true,
		() => [],
		() => undefined,
		() => [],
		() => undefined,
		() => ({ amount: '', message: '' }),
		// `showWinInfoMessage` — TRUE, i.e. the ordinary project that authored a win template. It is
		// the coded handler's slammed branch that reads it (`if (shown) await slamHold(400)`), so a
		// stub answering `false` silently deletes the message hold and with it the slam's real timing.
		() => true,
		{ winBookEventAmount: 0 },
		{ unskippablePresentationActive: false, freeSpinsAdded: 0 },
		{ isContinuousBet: () => false },
		() => true,
		(resolve) => seam.push({ what: 'armSpinHold', at: clock.at(), resolve }),
		() => seam.push({ what: 'clearSpinHold', at: clock.at() }),
		() => seam.push({ what: 'clearWinPresentation', at: clock.at() }),
		() => seam.push({ what: 'stopWinCycle', at: clock.at() }),
		() => seam.push({ what: 'startWinCycle', at: clock.at() }),
		() => undefined,
		() => undefined,
		async () => {},
		{ playBookEvent: async () => {} },
		() => undefined,
		() => true,
	);

	return { runtime, clock, stateGame, transitions, log, seam, config, roundSkip, rebuildBoard };
};

/** The cells a win pays on, as `"reel:row"` — the fixture's own reading of a win, used only to
 *  build expectations. What the game lights is always `winningPositionsOf`, evaluated for real. */
const keysOf = (positions) => positions.map(({ reel, row }) => `${reel}:${row}`);

/** A line win across the whole board on one row. `kind` is how many leftmost reels pay. */
const lineWin = (rows, kind, extra = {}) => ({
	symbol: 'H1',
	kind,
	win: 100,
	positions: rows.map((row, reel) => ({ reel, row })),
	...extra,
});

// ---------------------------------------------------------------------------
// 1 — THE CORPUS: shared paying cells are the common case, not a corner.
// ---------------------------------------------------------------------------

console.log('--- 1. overlapping paylines share cells, in the real books ---');

{
	const { runtime } = buildRound();
	const { winningPositionsOf } = runtime;
	const books = (await import('../apps/lines/src/stories/data/base_books.ts')).default;
	let winInfoEvents = 0;
	let sharedEvents = 0;
	let worstShared = 0;
	for (const book of books) {
		for (const event of book.events) {
			if (event.type !== 'winInfo') continue;
			if (!Array.isArray(event.wins) || event.wins.length < 2) {
				winInfoEvents += 1;
				continue;
			}
			winInfoEvents += 1;
			const seen = new Set();
			const shared = new Set();
			for (const win of event.wins) {
				for (const key of keysOf(winningPositionsOf(win))) {
					if (seen.has(key)) shared.add(key);
					seen.add(key);
				}
			}
			if (shared.size) {
				sharedEvents += 1;
				worstShared = Math.max(worstShared, shared.size);
			}
		}
	}
	const share = Math.round((sharedEvents / winInfoEvents) * 100);
	console.log(
		`      ${sharedEvents} of ${winInfoEvents} winInfo events (${share}%) pay a cell twice; ` +
			`worst event shares ${worstShared} cells`,
	);
	check('the reference books really do contain winInfo events at all', winInfoEvents > 1000, true);
	check('…and a large minority of them pay at least one cell twice', share >= 20, true);
	check('…with events that share several cells, not just one', worstShared >= 2, true);
}

// ---------------------------------------------------------------------------
// 2 — THE NARRATION IS UNTOUCHED by turning the pop on.
// ---------------------------------------------------------------------------

console.log('\n--- 2. two wins over the same cells narrate normally, with the pop on ---');

/** One `winInfo` whose two wins share reels 0-1 of row 0 — payline 1 and payline 18 of the real
 *  `config.ts`, which is the exact shape the stall was reported on. */
const sharedCellEvent = {
	type: 'winInfo',
	wins: [lineWin([0, 0, 0, 0, 0], 5), lineWin([0, 0, 2, 0, 0], 5)],
};

/** Present one `winInfo` through the REAL coded handler, and hand back what the board did. */
const presentWinInfo = async (round, bookEvent = sharedCellEvent) => {
	round.runtime.recordWinCycleWins(bookEvent);
	await round.clock.run(() => round.runtime.codedHandlers.winInfo(bookEvent));
	return round;
};

{
	const on = await presentWinInfo(buildRound({ winExplode: true }));
	const off = await presentWinInfo(buildRound({ winExplode: false }));

	const lit = new Set(
		on.transitions.filter((t) => t.state === 'win').map((t) => `${t.reel}:${t.row}`),
	);
	const shouldLight = new Set([
		...keysOf(on.runtime.winningPositionsOf(sharedCellEvent.wins[0])),
		...keysOf(on.runtime.winningPositionsOf(sharedCellEvent.wins[1])),
	]);
	check(
		'every paying cell of every win is lit',
		[...shouldLight].every((key) => lit.has(key)),
		true,
	);
	check('…and the shared cells are lit TWICE, once per win', on.transitions.filter((t) => t.state === 'win').length, 10); // prettier-ignore
	check('…which is more lightings than there are distinct cells', shouldLight.size, 6);

	// THE STALL, as a number. Two wins, each a `WIN_BEAT_MIN_MS` floor over 300ms of art ⇒ 1300.
	// The bug spent `WIN_BEAT_CAP_MS` on the second win and again on its pop.
	check('the round costs two ordinary win beats', on.clock.at(), 1300);
	check('…nowhere near the runaway cap', on.clock.at() < 4000, true);

	// BYTE-IDENTICAL NARRATION. Not "roughly the same" — the same transitions at the same times.
	const shape = (round) =>
		JSON.stringify(round.transitions.map((t) => [t.reel, t.row, t.state, t.at]));
	check('the pop ON narrates exactly what the pop OFF narrates', shape(on), shape(off));
	check('…including the timing', on.clock.at(), off.clock.at());
	check('…and NOTHING is removed during the narration', on.stateGame.board.flatMap((reel) => reel.reelState.symbols).filter((cell) => cell.removed).length, 0); // prettier-ignore
	check('…and no cell is left parked on `explosion`', on.transitions.filter((t) => t.state === 'explosion').length, 0); // prettier-ignore
	check('…every lit cell ends at rest', on.stateGame.board.flatMap((reel) => reel.reelState.symbols).filter((cell) => cell.symbolState === 'postWinStatic').length, 6); // prettier-ignore

	// THE ANCHOR: the harness CAN see a cap. Without this, "1300" proves nothing — a fixture whose
	// clock never advanced would report the same pass.
	const deaf = await presentWinInfo(buildRound({ winExplode: true, art: { win: null } }));
	check('a cell whose win art can never report costs the whole cap, and the fixture sees it', deaf.clock.at(), 8000); // prettier-ignore
}

// ---------------------------------------------------------------------------
// 3 — THE POP: one explosion per cell, after the round, on both exits of the race.
// ---------------------------------------------------------------------------

console.log('\n--- 3. the spin ends on ONE pop over the deduped winning set ---');

{
	const round = await presentWinInfo(buildRound({ winExplode: true }));
	const beforePop = round.clock.at();
	await round.clock.run(() => round.runtime.explodeSpinWinners());

	const pops = round.log.filter((entry) => entry.type === 'boardExplodeWinSymbols');
	check('exactly one pop cue is broadcast for the whole round', pops.length, 1);
	check(
		'…carrying the DEDUPED union of both wins’ paying cells',
		keysOf(pops[0].event.symbolPositions).sort().join(','),
		'0:0,1:0,2:0,2:2,3:0,4:0'.split(',').sort().join(','),
	);
	check('…with no cell named twice', new Set(keysOf(pops[0].event.symbolPositions)).size, 6);

	const exploded = round.transitions.filter((t) => t.state === 'explosion');
	check('every one of them plays `explosion`', exploded.length, 6);
	check('…exactly once, including the cells two wins paid on', new Set(exploded.map((t) => `${t.reel}:${t.row}`)).size, 6); // prettier-ignore
	check('…all in the same beat, not one after another', new Set(exploded.map((t) => t.at)).size, 1);

	const removed = round.stateGame.board.flatMap((reel, reel2) =>
		reel.reelState.symbols.map((cell, row) => (cell.removed ? `${reel2}:${row}` : null)),
	);
	check(
		'…and every one of them is then OFF the board',
		removed.filter(Boolean).sort().join(','),
		'0:0,1:0,2:0,2:2,3:0,4:0',
	);
	check('nothing that did not pay is removed', removed.filter(Boolean).length, 6);
	check('the pop costs one authored explosion, not a cap', round.clock.at() - beforePop, 200);
	check('…and it is the LAST beat: the narration already finished', beforePop, 1300);

	// A SECOND CALL IS A NO-OP — the set is filtered by what is already gone, which is what makes
	// the two seams (`playBet`'s finally and the between-spins hold) safe to both run it.
	const logLength = round.log.length;
	await round.clock.run(() => round.runtime.explodeSpinWinners());
	check('popping a board whose winners are already gone broadcasts nothing', round.log.length, logLength); // prettier-ignore
}

{
	// BOTH EXITS OF THE RACE. A cell bound to art that can never report `oncomplete` pays the cap —
	// and is then just as gone. This is the claim the whole "explode and be gone" contract rests on:
	// a symbol that cannot report must not be left standing for the next spin's clear to pop again.
	const round = await presentWinInfo(buildRound({ winExplode: true, art: { win: 300, explosion: null } })); // prettier-ignore
	const beforePop = round.clock.at();
	await round.clock.run(() => round.runtime.explodeSpinWinners());
	check('an explosion that never reports is bounded by the win-beat cap', round.clock.at() - beforePop, 4000); // prettier-ignore
	check('…and the cell is removed anyway', round.stateGame.board.flatMap((r) => r.reelState.symbols).filter((c) => c.removed).length, 6); // prettier-ignore
	check('…and settled back to rest rather than parked on `explosion`', round.stateGame.board[0].reelState.symbols[0].symbolState, 'postWinStatic'); // prettier-ignore
}

{
	// THE POP'S OWN SETTLE RIDES THE SAME GUARD as the win beat's. A pop sitting out the cap can be
	// overtaken too — the next board's CLEAR names every visible seat — and stamping `postWinStatic`
	// over a `clearReel` it does not own would tear that animation down in turn. The removal is NOT
	// guarded, deliberately: "explode and be gone" is the pop's promise on both exits of the race.
	const round = await presentWinInfo(buildRound({ winExplode: true, art: { win: 300, explosion: null } })); // prettier-ignore
	const cell = round.stateGame.board[0].reelState.symbols[0];
	await round.clock.run(async () => {
		const popping = round.runtime.explodeSpinWinners();
		await round.clock.wait(100);
		cell.symbolState = 'clearReel';
		await popping;
	});
	check('a capped pop leaves a state something else has taken over alone', cell.symbolState, 'clearReel'); // prettier-ignore
	check('…but the cell is gone all the same', cell.removed, true);
	check('…while its co-winners settle as usual', round.stateGame.board[1].reelState.symbols[0].symbolState, 'postWinStatic'); // prettier-ignore
	check('…and are gone too', round.stateGame.board.flatMap((r) => r.reelState.symbols).filter((c) => c.removed).length, 6); // prettier-ignore
}

{
	// THE SWITCH. Off is the default and must broadcast nothing at all.
	const round = await presentWinInfo(buildRound({ winExplode: false }));
	await round.clock.run(() => round.runtime.explodeSpinWinners());
	check('with the pop OFF nothing is broadcast', round.log.filter((e) => e.type === 'boardExplodeWinSymbols').length, 0); // prettier-ignore
	check('…and nothing is removed', round.stateGame.board.flatMap((r) => r.reelState.symbols).filter((c) => c.removed).length, 0); // prettier-ignore
}

{
	// A ROUND THAT PAID NOTHING. No `winInfo` was recorded, so the accumulated set is empty and the
	// pop must not even reach the emitter.
	const round = buildRound({ winExplode: true });
	round.runtime.recordWinCycleWins({ type: 'reveal', board: [] });
	await round.clock.run(() => round.runtime.explodeSpinWinners());
	check('a losing spin broadcasts no pop', round.log.length, 0);
	check('…and costs no time', round.clock.at(), 0);
}

{
	// A STACKED-COVERED cell mounts no `<Symbol>` at all, so it can neither draw the pop nor ever
	// report it — left in, the pop would spend the whole cap on it and end the tall picture's win art
	// early for no picture. It must be skipped outright, not merely un-awaited.
	const round = await presentWinInfo(buildRound({ winExplode: true, coveredSeats: [[2, 2]] }));
	const beforePop = round.clock.at();
	await round.clock.run(() => round.runtime.explodeSpinWinners());
	check('a covered seat is not exploded', round.transitions.filter((t) => t.state === 'explosion' && t.reel === 2 && t.row === 2).length, 0); // prettier-ignore
	check('…and is not removed either — the tall picture still owns it', round.stateGame.board[2].reelState.symbols[2].removed, false); // prettier-ignore
	check('…while its five uncovered co-winners pop as usual', round.transitions.filter((t) => t.state === 'explosion').length, 5); // prettier-ignore
	check('…and the beat is still one explosion long, not a cap', round.clock.at() - beforePop, 200);
}

{
	// A cell the pop already took off is never exploded a second time — the same early return that
	// makes the two seams safe to both run.
	const round = await presentWinInfo(buildRound({ winExplode: true }));
	round.stateGame.board[0].reelState.symbols[0].removed = true;
	const before = round.transitions.length;
	await round.clock.run(() =>
		round.runtime.boardHandlers.boardExplodeWinSymbols({ symbolPositions: [{ reel: 0, row: 0 }] }),
	);
	check('a cell that is already off the board is not exploded again', round.transitions.length, before); // prettier-ignore
}

// ---------------------------------------------------------------------------
// 4 — THE SEAM: the REAL `playBet`, down all four paths.
// ---------------------------------------------------------------------------

console.log('\n--- 4. the round seam pops the book’s last spin, on every dispatch path ---');

/** The shipped `playBet` body, evaluated — the `finally` is what part 4 is about. */
const playBetBody = sliceBetween(
	utilsSource,
	'playBet',
	'export const playBet = async (bet: Bet) => {',
	'\n};\n',
);

{
	// THE ORDER INSIDE `playBet`'s `finally`, read off the REAL body: the pop is awaited, and it is
	// awaited BEFORE the replay starts (the replay skips cells the pop takes off, so the other order
	// would light seats that are about to vanish).
	const popAt = playBetBody.indexOf('await explodeSpinWinners();');
	const cycleAt = playBetBody.indexOf('void startWinCycle();');
	const tryAt = playBetBody.indexOf('await playBookEvents(bet.state);');
	const finallyAt = playBetBody.indexOf('} finally {');
	check('playBet awaits the pop', popAt > -1, true);
	check('…inside the finally, so a throwing or slammed round still reaches it', popAt > finallyAt, true); // prettier-ignore
	check('…after the whole book has been presented', popAt > tryAt, true);
	check('…and before the resting replay starts', popAt < cycleAt, true);
	check('the replay is still not awaited', playBetBody.includes('void startWinCycle();'), true);
}

/**
 * The dispatch paths, driven through the REAL `playBet` with the REAL pops wired to the REAL board.
 *
 * `playBookEvent` / `coded.playBookEvent` are the injection point every dispatch path funnels
 * through in the shipped module: `playBookEvents` picks the coded loop when no flow is registered
 * and the `playBookEvent` loop when one is, and BOTH end in the same `finally`. So each path here is
 * a different pair of `getFlowV2` / dispatcher answers over the same real body.
 *
 * THE SLAM IS A PRESS DURING THE ROUND, not a pre-tripped token. `playBet` calls `roundSkip.reset()`
 * before the first book event (`utils.ts`), so a world built already-skipped is byte-identical to an
 * un-slammed one and a "slammed round" run built that way asserts nothing. The press lands where a
 * player actually slams — as the win is being narrated.
 */
const drivePlayBet = async ({ label, book, flowV2, slammed = false, winExplode = true, art }) => {
	// ONE clock for the whole round: the pops the seams await are the real ones, and they wait on the
	// same virtual time the board's beats do.
	const clock = createClock();
	const world = buildRound({ winExplode, clock, ...(art ? { art } : {}) });
	const order = [];
	const marks = [];
	const dispatched = [];
	const mark = (what) => {
		order.push(what);
		marks.push({ what, at: clock.at() });
	};

	/** Present one book event exactly as both dispatch branches do, and slam on the win. */
	const present = async (via, bookEvent) => {
		dispatched.push(`${via}:${bookEvent.type}`);
		if (bookEvent.type === 'boom') throw new Error('handler blew up');
		if (slammed && bookEvent.type === 'winInfo') world.roundSkip.trip();
		world.runtime.recordWinCycleWins(bookEvent);
		if (bookEvent.type === 'winInfo') await world.runtime.codedHandlers.winInfo(bookEvent);
		// A `reveal` / `tumbleBoard` PRESENTS A NEW BOARD, i.e. fresh cells — so the spin that follows
		// starts un-removed, and this spin's pop has to have happened before now or never.
		if (bookEvent.type === 'reveal' || bookEvent.type === 'tumbleBoard') world.rebuildBoard();
	};

	const play = new Function(
		'stopWinCycle',
		'forgetWinCycleWins',
		'roundSkip',
		'stateBet',
		'stateUi',
		'clearSpinHold',
		'eventEmitter',
		'explodeSpinWinners',
		'explodeWinnersBeforeBoardChange',
		'startWinCycle',
		'getFlowInterpreter',
		'getFlowV2',
		'sequence',
		'playBookEvent',
		'coded',
		'holdAfterBigWin',
		`${stripTypes('the playBet seam', `${sliceBetween(utilsSource, 'playBookEvents', 'export const playBookEvents = async (', '\n};\n')}\n${playBetBody}`)}\nreturn playBet;`,
	)(
		() => order.push('stopWinCycle'),
		world.runtime.forgetWinCycleWins,
		world.roundSkip,
		{ winBookEventAmount: 0 },
		{ unskippablePresentationActive: false },
		() => {},
		{ broadcast: (event) => order.push(`broadcast:${event.type}`) },
		async () => {
			mark('pop:start');
			// The REAL pop, over the REAL board handler and the REAL accumulated wins.
			await world.runtime.explodeSpinWinners();
			mark('pop:done');
		},
		// The REAL per-spin seam, unwrapped — what it DID is read off the board's own cue log, so the
		// marker is pushed only when the seam actually broadcast a pop.
		async (bookEvent) => {
			const before = world.log.length;
			await world.runtime.explodeWinnersBeforeBoardChange(bookEvent);
			if (world.log.length > before) mark(`spinPop:${bookEvent.type}`);
		},
		() => order.push('startWinCycle'),
		() => undefined,
		() => flowV2,
		sequence,
		(bookEvent) => present('flow', bookEvent),
		{ playBookEvent: (bookEvent) => present('coded', bookEvent) },
		async () => {},
	);

	const at = (what) => marks.find((entry) => entry.what === what)?.at;
	try {
		await clock.run(() => play({ state: book }));
	} catch (error) {
		// The seam is in a `finally`, so what it did is still worth asserting on a round that threw.
		error.round = { label, order, marks, dispatched, world, at };
		throw error;
	}
	return { label, order, marks, dispatched, world, at };
};

const winningBook = [
	{ type: 'reveal', board: [] },
	sharedCellEvent,
	{ type: 'setTotalWin', amount: 100 },
];

{
	const coded = await drivePlayBet({ label: 'coded', book: winningBook, flowV2: undefined });
	check('coded path: the coded handler map drove the events', coded.dispatched.join(','), 'coded:reveal,coded:winInfo,coded:setTotalWin'); // prettier-ignore
	check('…the pop ran', coded.order.includes('pop:start'), true);
	check('…it RESOLVED before the replay started', coded.order.indexOf('pop:done') < coded.order.indexOf('startWinCycle'), true); // prettier-ignore
	check('…and the board is emptied of its winners', coded.world.stateGame.board.flatMap((r) => r.reelState.symbols).filter((c) => c.removed).length, 6); // prettier-ignore

	const flow = await drivePlayBet({
		label: 'flow-v2',
		book: winningBook,
		flowV2: { ownsEvent: () => true },
	});
	check('v2 flow path: the flow drove the events', flow.dispatched.join(','), 'flow:reveal,flow:winInfo,flow:setTotalWin'); // prettier-ignore
	check('…the pop ran there too', flow.order.includes('pop:done'), true);
	check('…before the replay', flow.order.indexOf('pop:done') < flow.order.indexOf('startWinCycle'), true); // prettier-ignore
	check('…and emptied the same six seats', flow.world.stateGame.board.flatMap((r) => r.reelState.symbols).filter((c) => c.removed).length, 6); // prettier-ignore

	const slam = await drivePlayBet({
		label: 'slammed',
		book: winningBook,
		flowV2: undefined,
		slammed: true,
	});
	check('slammed round: the pop still runs', slam.order.includes('pop:done'), true);
	check('…and still empties the winners', slam.world.stateGame.board.flatMap((r) => r.reelState.symbols).filter((c) => c.removed).length, 6); // prettier-ignore

	const nothing = await drivePlayBet({
		label: 'no win',
		book: [
			{ type: 'reveal', board: [] },
			{ type: 'setTotalWin', amount: 0 },
		],
		flowV2: undefined,
	});
	check('a round with no win reaches the seam', nothing.order.includes('pop:start'), true);
	check('…and is a no-op there', nothing.world.log.length, 0);
	check('…removing nothing', nothing.world.stateGame.board.flatMap((r) => r.reelState.symbols).filter((c) => c.removed).length, 0); // prettier-ignore

	const off = await drivePlayBet({ label: 'switch off', book: winningBook, flowV2: undefined, winExplode: false }); // prettier-ignore
	check('with the switch OFF the seam broadcasts nothing', off.world.log.filter((e) => e.type === 'boardExplodeWinSymbols').length, 0); // prettier-ignore
	check('…and the board is untouched', off.world.stateGame.board.flatMap((r) => r.reelState.symbols).filter((c) => c.removed).length, 0); // prettier-ignore

	// A HANDLER THAT THREW must still reach the pop — it is in the `finally`, and the round is over
	// either way. (The throw propagates after the finally, exactly as the shipped body intends.)
	const thrown = [];
	let threw;
	try {
		threw = await drivePlayBet({
			label: 'threw',
			book: [{ type: 'reveal', board: [] }, sharedCellEvent, { type: 'boom' }],
			flowV2: undefined,
		});
	} catch (error) {
		thrown.push(error.message);
		threw = error.round;
	}
	check('a round whose book throws still surfaces the error', thrown.join(''), 'handler blew up');
	check('…and still reached the pop, because the seam is in the finally', threw.order.includes('pop:done'), true); // prettier-ignore
	check('…popping the wins it had already narrated', threw.world.stateGame.board.flatMap((r) => r.reelState.symbols).filter((c) => c.removed).length, 6); // prettier-ignore
}

{
	// THE OTHER SEAM — the between-spins hold. It must run the SAME pair in the SAME order, or a
	// held spin and an ordinary one would end differently.
	const holdBody = sliceBetween(
		freeSpinHoldSource,
		'holdAfterBigWin',
		'export const holdAfterBigWin = async (',
		'\n};\n',
	);
	const popAt = holdBody.indexOf('await explodeSpinWinners();');
	const cycleAt = holdBody.indexOf('void startWinCycle();');
	const armAt = holdBody.indexOf('armSpinHold');
	check('the between-spins hold awaits the pop', popAt > -1, true);
	check('…before it starts the replay', popAt < cycleAt, true);
	check('…and before it parks on the press', popAt < armAt, true);

	// Driven: with the hold authored and a big win mid-feature, the real function pops the board.
	const round = await presentWinInfo(
		buildRound({ winExplode: true, holdAfterBigWinEnabled: true }),
	);
	const bookEvents = [
		{ type: 'reveal' },
		{ type: 'setWin', winLevel: 5, amount: 100 },
		{ type: 'reveal' },
	];
	await round.clock.run(async () => {
		const held = round.runtime.holdAfterBigWin(bookEvents[1], bookEvents);
		// Release the parked press once it has been armed.
		// Long enough for the pop's own beat to finish and the hold to park — the assertion below is
		// that the pop had already run by then, not that it raced the release.
		await round.clock.wait(1000);
		round.seam.find((entry) => entry.what === 'armSpinHold').resolve();
		await held;
	});
	check('the hold ran the pop', round.log.filter((e) => e.type === 'boardExplodeWinSymbols').length, 1); // prettier-ignore
	check('…and the pop finished before the press was armed', round.seam.findIndex((e) => e.what === 'startWinCycle') < round.seam.findIndex((e) => e.what === 'armSpinHold'), true); // prettier-ignore
	check('…emptying the round’s winners', round.stateGame.board.flatMap((r) => r.reelState.symbols).filter((c) => c.removed).length, 6); // prettier-ignore
}

// ---------------------------------------------------------------------------
// 5 — THE RENDER GATE, evaluated rather than matched.
// ---------------------------------------------------------------------------

console.log('\n--- 5. a removed cell is really not drawn ---');

{
	const derivation = sliceBetween(
		reelSymbolSource,
		'the removed derivation',
		'const removed = $derived(',
		';\n',
	);
	const ifLine = reelSymbolSource.match(/\n\{#if ([^}]+)\}\n/);
	if (!ifLine) throw new Error('ReelSymbol.svelte no longer opens with an {#if}');
	const gate = new Function(
		'props',
		'covered',
		`${stripTypes('the ReelSymbol removed derivation', derivation)}\nreturn Boolean(${ifLine[1]});`,
	);
	const cell = (removed) => ({ reelSymbol: { removed } });
	check('drawn: not covered, not removed', gate(cell(false), false), true);
	check('undrawn: removed', gate(cell(true), false), false);
	check('undrawn: covered', gate(cell(false), true), false);
	check('undrawn: both', gate(cell(true), true), false);
	check(
		'the gate really reads the cell — a truthy non-boolean removes too',
		gate({ reelSymbol: { removed: 1 } }, false),
		false,
	);
}

{
	// THE FORWARD GATE, evaluated: `ReelSymbol.svelte` hands a renderer's completion to the cell ONLY
	// while the state that armed the beat is still on it. That is the whole reason a beat something
	// else has taken over never reports — and therefore the reason both bounded races exist.
	//
	// KEYED ON THE STATE, never on who is holding the cell. One component draws the board now,
	// whoever is driving it (docs/design/board-cell-continuity.md), and the first cut of that merge
	// asked whether a cascade seat was attached — which is a question about where a cell IS, not
	// about who is waiting on it. The two come apart on one real path: with "let the next spin start
	// as soon as the symbols are back" on, the appear does not await its intro beats, so the settle
	// adopts the cells and detaches every seat while those intros are still playing. Gated on the
	// seat, those completions were swallowed and every arriving symbol sat frozen on its intro for
	// the whole `INTRO_BEAT_CAP_MS`.
	const forward = sliceBetween(
		reelSymbolSource,
		'the oncomplete forward',
		'oncomplete={() => {',
		'\t\t\t}}',
	);
	const body = forward.slice(forward.indexOf('=> {') + 4, forward.lastIndexOf('}}'));
	// The one claim here that cannot be written as a behaviour: a body that consults the seat passes
	// every behavioural claim below, because the seat is attached for all of them.
	// Against the CODE, not the prose: the comment above the forward explains the seat at length,
	// and a guard a paragraph can trip is a guard nobody keeps.
	const forwardCode = body.replace(/\/\/[^\n]*/g, '');
	check('the forward does not ask who is holding the cell', /\bcascade\b/.test(forwardCode), false);
	const gate = new Function(
		'state',
		`let forwarded = 0;
const props = { reelSymbol: { symbolState: state, oncomplete: () => { forwarded += 1; } } };
// The body RETURNS EARLY once it has forwarded, so it runs as its own function rather than inline.
(() => { ${body} })();
return { forwarded, state: props.reelSymbol.symbolState };`,
	);
	// EVERY STATE A BEAT DRIVES reports, whoever armed it — `win` and `explosion` are the reel
	// board's, `clearReel` and `intro` are a cascade step's, and one cell answers for both.
	for (const state of ['win', 'explosion', 'clearReel', 'intro']) {
		check(`a \`${state}\` cell reports its beat`, gate(state).forwarded, 1);
	}
	// …and a state that is NOBODY's beat reports nothing, which is what keeps a settled win beat
	// from being re-fired by a looping clip on a cell that has since moved on.
	for (const state of ['postWinStatic', 'static', 'spin']) {
		check(`a cell that has moved on to \`${state}\` reports nothing`, gate(state).forwarded, 0);
	}
	// `land` is the one state BOTH owners arm: a step's callback settles the cell and resolves its
	// beat; the reel board arms nothing, so its `oncomplete` is the cell's default no-op and the
	// settle IS the behaviour. Doing both is what lets one cell answer for either owner.
	check('a `land` cell reports its beat', gate('land').forwarded, 1);
	check('…and settles itself to `static`', gate('land').state, 'static');

	// AND THE FIXTURE AGREES WITH IT. The harness's cell is what every timing above is measured
	// through, so a cell that reported a beat something else had taken over would make the slam case
	// in part 10 pass on a build that freezes for four seconds.
	const reports = async (armed, takenOverBy) => {
		const round = buildRound({ art: { [armed]: 300 } });
		const cell = round.stateGame.board[0].reelState.symbols[0];
		let reported = 0;
		cell.oncomplete = () => {
			reported += 1;
		};
		await round.clock.run(async () => {
			cell.symbolState = armed;
			if (takenOverBy) {
				await round.clock.wait(100);
				cell.symbolState = takenOverBy;
			}
			await round.clock.wait(500);
		});
		return reported;
	};
	check('the fixture’s cell reports an uninterrupted beat', await reports('win'), 1);
	check('…and reports nothing once something else owns the cell', await reports('win', 'postWinStatic'), 0); // prettier-ignore
	check('…which is exactly what the real gate answers', gate('postWinStatic').forwarded, 0);
	check('…including an explosion the clear took over', await reports('explosion', 'clearReel'), 0);
}

// ---------------------------------------------------------------------------
// 6 — `boardRemoved()` IS INDEX-ALIGNED WITH `boardRaw()`.
// ---------------------------------------------------------------------------

console.log('\n--- 6. the removal set is published by position, beside the raw board ---');

{
	// A RAGGED board — different column lengths — because "same shape" is exactly what a `.map()`
	// over the wrong collection would still satisfy on a square one.
	const round = buildRound();
	const lengths = [2, 5, 3, 4, 1];
	round.stateGame.board = lengths.map((length, reel) => ({
		reelState: {
			symbols: Array.from({ length }, (_unused, row) => ({
				rawSymbol: { name: `S${reel}${row}` },
				removed: (reel + row) % 3 === 0,
			})),
		},
	}));
	const raw = round.runtime.boardRaw();
	const removed = round.runtime.boardRemoved();
	check('same number of columns', removed.length, raw.length);
	check('same column lengths, ragged included', removed.map((c) => c.length).join(','), lengths.join(',')); // prettier-ignore
	check(
		'cell for cell, the flag at [reel][row] describes the symbol at [reel][row]',
		removed
			.flatMap((column, reel) => column.map((flag, row) => (flag ? raw[reel][row].name : null)))
			.filter(Boolean)
			.join(','),
		lengths
			.flatMap((length, reel) =>
				Array.from({ length }, (_unused, row) =>
					(reel + row) % 3 === 0 ? `S${reel}${row}` : null,
				),
			)
			.filter(Boolean)
			.join(','),
	);
	check('an untouched board answers all-false', buildRound().runtime.boardRemoved().flat().filter(Boolean).length, 0); // prettier-ignore
	check('…with one entry per seat all the same', buildRound().runtime.boardRemoved().flat().length, REELS * ROWS); // prettier-ignore
}

// ---------------------------------------------------------------------------
// 7 — THE RESTING REPLAY drops what the pop took off.
// ---------------------------------------------------------------------------

console.log('\n--- 7. the rotation is the wins MINUS the cells that are gone ---');

{
	const round = buildRound({ winExplode: true });
	round.runtime.recordWinCycleWins(sharedCellEvent);
	const full = round.runtime.cycleEntries();
	check('nothing removed ⇒ one entry per win', full.length, 2);
	check('…each tracing its own paying cells', full.map((e) => keysOf(e.positions).join(' ')).join(' | '), '0:0 1:0 2:0 3:0 4:0 | 0:0 1:0 2:2 3:0 4:0'); // prettier-ignore

	// PARTIAL removal: a win whose cells are only half gone keeps the half that is left. This is the
	// off-by-one the old source-grep could not see — a filter on the wrong index would keep the
	// wrong cells rather than none.
	const partial = buildRound({ winExplode: true, removedSeats: [[0, 0], [4, 0]] }); // prettier-ignore
	partial.runtime.recordWinCycleWins(sharedCellEvent);
	check(
		'two seats gone ⇒ both wins keep exactly their surviving cells',
		partial.runtime
			.cycleEntries()
			.map((e) => keysOf(e.positions).join(' '))
			.join(' | '),
		'1:0 2:0 3:0 | 1:0 2:2 3:0',
	);

	// FULLY popped: the rotation is empty, which is what makes `startWinCycle` find nothing and the
	// board simply rest.
	const popped = await presentWinInfo(buildRound({ winExplode: true }));
	await popped.clock.run(() => popped.runtime.explodeSpinWinners());
	check('after the pop the rotation is empty', popped.runtime.cycleEntries().length, 0);

	// …and the pop OFF leaves it whole, which is the byte-parity claim.
	const untouched = await presentWinInfo(buildRound({ winExplode: false }));
	await untouched.clock.run(() => untouched.runtime.explodeSpinWinners());
	check('with the pop off the rotation is untouched', untouched.runtime.cycleEntries().length, 2);
}

// ---------------------------------------------------------------------------
// 8 — THE DEFENSIVE GUARD in the win beat.
// ---------------------------------------------------------------------------

console.log('\n--- 8. the win beat refuses to re-light a cell that is off the board ---');

{
	// The stall, reproduced directly: light a cell that has already been removed. Without the guard
	// this costs `WIN_BEAT_CAP_MS` — the cell draws nothing, so its `oncomplete` never fires.
	const round = buildRound({ winExplode: true, removedSeats: [[2, 1]] });
	await round.clock.run(() =>
		round.runtime.boardHandlers.boardWithAnimateSymbols({
			symbolPositions: [
				{ reel: 2, row: 1 },
				{ reel: 3, row: 1 },
			],
		}),
	);
	check('the beat ends on the surviving cell, not on the cap', round.clock.at(), 650);
	check('…the removed cell was never lit', round.transitions.filter((t) => t.reel === 2).length, 0);
	check('…while its neighbour narrated normally', round.transitions.filter((t) => t.reel === 3).map((t) => t.state).join(','), 'win,postWinStatic'); // prettier-ignore
	check('…and the removed cell is still removed', round.stateGame.board[2].reelState.symbols[1].removed, true); // prettier-ignore

	// The same board WITHOUT the removal — the guard is a difference the fixture can see.
	const alive = buildRound({ winExplode: true });
	await alive.clock.run(() =>
		alive.runtime.boardHandlers.boardWithAnimateSymbols({
			symbolPositions: [
				{ reel: 2, row: 1 },
				{ reel: 3, row: 1 },
			],
		}),
	);
	check('nothing removed ⇒ both cells narrate', alive.transitions.filter((t) => t.state === 'win').length, 2); // prettier-ignore
}

// ---------------------------------------------------------------------------
// 9 — CONTAINMENT: the removal lives in ONE place, behind ONE gate.
// ---------------------------------------------------------------------------

console.log('\n--- 9. the removal is contained in the pop, and the pop behind the switch ---');

{
	// The win beat's own body must not remove anything — asserted on the SLICE, so a removal that
	// escaped the pop handler into the beat is a failure here even if it were gated correctly.
	const beat = sliceBetween(
		boardHandlersSource,
		'the win beat',
		'boardWithAnimateSymbols: async (',
		'\n\t\t},\n',
	);
	check('the win beat removes nothing', beat.includes('.removed = true'), false);
	check('…and explodes nothing', beat.includes("symbolState = 'explosion'"), false);
	check('…but it does refuse a removed cell', beat.includes('if (reelSymbol.removed) return;'), true); // prettier-ignore

	const pop = sliceBetween(
		boardHandlersSource,
		'the pop handler',
		'boardExplodeWinSymbols: async (',
		'\n\t\t},\n',
	);
	// TWO removals, and both of them are the pop's: a winner whose symbol authored no `explosion`
	// leaves immediately (there is no animation to wait on, and lighting one would buy the whole cap
	// for a cell with nothing to show), and every other winner leaves when its beat ends. "Explode
	// and be gone" is the promise either way — a winner left standing is swept by the next board's
	// clear playing `clearReel`, which is the double pop this feature exists to prevent.
	check(
		'the pop handler is the one that removes',
		(pop.match(/\.removed = true/g) ?? []).length,
		2,
	);
	check('…and it is the only place in the component that does', (boardSource.match(/\.removed = true/g) ?? []).length, (pop.match(/\.removed = true/g) ?? []).length); // prettier-ignore
	// The UNCONDITIONAL one — the second — has to sit after the await, so it fires on both exits of
	// the race rather than only on the report. The early one is before it by definition: it is the
	// short-circuit that never races at all.
	check('…on BOTH exits of the race, i.e. after the await rather than inside the arm', pop.lastIndexOf('.removed = true') > pop.indexOf('awaitSymbolBeat('), true); // prettier-ignore
	// Bounded by the AUTHORED ceiling when a project sets one and by the coded guard when it does
	// not — `resolveWinBeatBudget` is the one place that decides which, so "cap each win at N" bounds
	// what a paying cell costs in total rather than only its first half.
	check('…bounded by the win-beat budget', pop.includes('budget.capMs'), true);
	check('…which is the authored ceiling or the coded guard', boardSource.includes('const budget = resolveWinBeatBudget(bakedWinBeatMaxMs());'), true); // prettier-ignore

	// THE GATE is at the broadcaster, so with the switch off the cue never exists. Driven above; here
	// the containment claim: nothing else in the game broadcasts it.
	const broadcasters = [
		read('apps/lines/src/game/winSymbolCycle.ts'),
		read('apps/lines/src/game/flowEffects.ts'),
		read('apps/lines/src/game/bookEventHandlerMap.ts'),
		read('apps/lines/src/game/utils.ts'),
	];
	check(
		'exactly one module broadcasts the pop cue',
		broadcasters.filter((source) => source.includes("type: 'boardExplodeWinSymbols'")).length,
		1,
	);
	const gate = sliceBetween(
		winCycleSource,
		'explodeSpinWinners',
		'export const explodeSpinWinners = async (',
		'\n};\n',
	);
	check('…and it reads the switch before anything else', gate.indexOf('bakedWinExplodeEnabled()') < gate.indexOf('spinWinningPositions()'), true); // prettier-ignore
	check('…returning rather than falling through', /if \(!bakedWinExplodeEnabled\(\)\) return;/.test(gate), true); // prettier-ignore

	// THE BOOK-OF COLUMN MORPH uses the same `explosion` state to explode-then-SWAP and must NOT
	// start vanishing — a removal there would empty the expanded reels.
	const morph = sliceBetween(
		flowEffectsSource,
		'expandBookColumns',
		'\texpandBookColumns: async (payload) => {',
		'\n\t},\n',
	);
	check('the sliced morph really is the one that explodes', morph.includes("symbolState = 'explosion'"), true); // prettier-ignore
	check('…and it explodes without removing', morph.includes('.removed = true'), false);
}

// ---------------------------------------------------------------------------
// 10 — A SLAMMED PAYING SPIN: the detached win beat must not write over the pop.
// ---------------------------------------------------------------------------

console.log('\n--- 10. a slammed paying spin pops on time, not four seconds late ---');

/** One ordinary win — the commonest paying spin there is, and the shape the freeze was reported on. */
const oneWinEvent = { type: 'winInfo', wins: [lineWin([0, 0, 0, 0, 0], 5)] };
const oneWinBook = [
	{ type: 'reveal', board: [] },
	oneWinEvent,
	{ type: 'setTotalWin', amount: 100 },
];

{
	const plain = await drivePlayBet({ label: 'ordinary', book: oneWinBook, flowV2: undefined });
	const slam = await drivePlayBet({
		label: 'slammed',
		book: oneWinBook,
		flowV2: undefined,
		slammed: true,
	});
	console.log(`      unslammed  pop:start@${plain.at('pop:start')}  pop:done@${plain.at('pop:done')}`); // prettier-ignore
	console.log(`      slammed    pop:start@${slam.at('pop:start')}  pop:done@${slam.at('pop:done')}`); // prettier-ignore

	// THE SLAM IS REAL — the anchor for everything below. `playBet` calls `roundSkip.reset()` before
	// the first book event, so a world built already-skipped reports the unslammed numbers exactly and
	// a "slammed round" run built that way asserts nothing at all.
	check('the press really shortens the narration', slam.at('pop:start') < plain.at('pop:start'), true); // prettier-ignore
	check('…to exactly the two slam holds: 200ms on the symbols + 400ms on the message', slam.at('pop:start'), 600); // prettier-ignore
	check('…where the unslammed round spends the win beat’s 650ms floor', plain.at('pop:start'), 650);

	// THE FREEZE. The slam DROPS the win beat's subscriber promise (`awaitCue` → `slamHold`), so
	// `boardWithAnimateSymbols` keeps running detached: its floor lands at 650, fifty milliseconds
	// AFTER the pop started at 600. An unguarded revert there tore the `explosion` down mid-flight,
	// its art never reported, and the pop settled only on `WIN_BEAT_CAP_MS`.
	check('the pop costs its authored explosion, not the runaway cap', slam.at('pop:done') - slam.at('pop:start'), 200); // prettier-ignore
	check('…so the slammed round ends at 800, not 4600', slam.at('pop:done'), 800);
	check('…and the unslammed one is untouched', plain.at('pop:done'), 850);
	check('the spin button is released within a beat of the press, not four seconds later', slam.at('pop:done') < 1000, true); // prettier-ignore

	// The narration as data: the detached beat's revert simply does not happen while the pop owns the
	// cell. `win` at 0, `explosion` at 600, and ONE settle at 800 — no `postWinStatic` at 650.
	const lit = slam.world.transitions.filter((t) => t.reel === 0 && t.row === 0);
	check('the popped cell transitions exactly once per beat', lit.map((t) => `${t.state}@${t.at}`).join(','), 'win@0,explosion@600,postWinStatic@800'); // prettier-ignore
	check('…and it is off the board', slam.world.stateGame.board[0].reelState.symbols[0].removed, true); // prettier-ignore
	check('…as are all five of the winning cells', slam.world.stateGame.board.flatMap((r) => r.reelState.symbols).filter((c) => c.removed).length, 5); // prettier-ignore
}

{
	// STRUCTURAL, NOT A KNIFE-EDGE. The last win's beat settles at `(W-1)·H + WIN_BEAT_MIN_MS` while
	// the pop starts at `W·H`, and the per-win slam hold `H` is 600ms (200 symbols + 400 message) —
	// always under the 650ms floor. So a TWO-win slammed spin lands the same 50ms overlap one win
	// later, and its shared cells make it the worse case.
	const slam = await drivePlayBet({
		label: 'slammed, two wins',
		book: [{ type: 'reveal', board: [] }, sharedCellEvent, { type: 'setTotalWin', amount: 100 }],
		flowV2: undefined,
		slammed: true,
	});
	check('two wins ⇒ the pop starts one slam-hold later', slam.at('pop:start'), 1200);
	check('…and the second win’s floor lands INSIDE it, at 1250', 600 + 650 > 1200, true);
	check('…yet the pop still costs one explosion', slam.at('pop:done') - slam.at('pop:start'), 200);
	check('…ending at 1400, not 5200', slam.at('pop:done'), 1400);
	check('…with every winning cell gone', slam.world.stateGame.board.flatMap((r) => r.reelState.symbols).filter((c) => c.removed).length, 6); // prettier-ignore
	check('…and each exploding exactly once', slam.world.transitions.filter((t) => t.state === 'explosion').length, 6); // prettier-ignore
}

{
	// WITH THE POP OFF a slammed round is untouched — no cue, no removal, and the detached beat still
	// settles its own cell exactly when it always did.
	const off = await drivePlayBet({
		label: 'slammed, switch off',
		book: oneWinBook,
		flowV2: undefined,
		slammed: true,
		winExplode: false,
	});
	check('switch off: nothing is broadcast', off.world.log.filter((e) => e.type === 'boardExplodeWinSymbols').length, 0); // prettier-ignore
	check('…nothing is removed', off.world.stateGame.board.flatMap((r) => r.reelState.symbols).filter((c) => c.removed).length, 0); // prettier-ignore
	// The round itself ends at 600 with the switch off (there is no pop to await), so the clock has
	// to be run past the detached beat's own floor before its settle can be read at all.
	await off.world.clock.run(() => off.world.clock.wait(1000));
	check('…and the detached win beat settles at its floor, as always', off.world.transitions.filter((t) => t.reel === 0 && t.row === 0).map((t) => `${t.state}@${t.at}`).join(','), 'win@0,postWinStatic@650'); // prettier-ignore
}

{
	// THE GUARD IS "the state I SET", not "not the pop's state". The pop is only the FIRST beat that
	// can overtake a detached win beat; the next board's CLEAR is another, and it must be left alone
	// just as firmly — a `postWinStatic` stamped over a `clearReel` tears that animation down and buys
	// the clear its own cap.
	const round = buildRound({ winExplode: true, art: { win: null } });
	const cell = round.stateGame.board[0].reelState.symbols[0];
	await round.clock.run(async () => {
		const beat = round.runtime.boardHandlers.boardWithAnimateSymbols({
			symbolPositions: [{ reel: 0, row: 0 }],
		});
		await round.clock.wait(100);
		cell.symbolState = 'clearReel';
		await beat;
	});
	check('a detached win beat leaves a cell the board clear now owns alone', cell.symbolState, 'clearReel'); // prettier-ignore
	check('…and the beat still ended on its own cap', round.clock.at(), 4000);
}

// ---------------------------------------------------------------------------
// 11 — ONCE PER PAYING SPIN, not once per BOOK.
// ---------------------------------------------------------------------------

console.log('\n--- 11. every paying spin of a book pops, on its own board ---');

/** Two spins, both paying, in ONE book — i.e. ONE `playBet`. The second `reveal` is what the first
 *  spin's pop has to beat: after it, the cells its wins name belong to a different board. */
const twoSpinBook = [
	{ type: 'reveal', board: [] },
	{ type: 'winInfo', wins: [lineWin([0, 0, 0, 0, 0], 5)] },
	{ type: 'setTotalWin', amount: 50 },
	{ type: 'updateFreeSpin', current: 2, total: 10 },
	{ type: 'reveal', board: [] },
	{ type: 'winInfo', wins: [lineWin([2, 2, 2, 2, 2], 5)] },
	{ type: 'setTotalWin', amount: 100 },
];

{
	const round = await drivePlayBet({ label: 'two spins', book: twoSpinBook, flowV2: undefined });

	const pops = round.world.log.filter((entry) => entry.type === 'boardExplodeWinSymbols');
	check('a two-spin book pops TWICE, once per paying spin', pops.length, 2);
	check('…the first naming the first spin’s row', keysOf(pops[0].event.symbolPositions).join(','), '0:0,1:0,2:0,3:0,4:0'); // prettier-ignore
	check('…the second naming the second spin’s row', keysOf(pops[1].event.symbolPositions).join(','), '0:2,1:2,2:2,3:2,4:2'); // prettier-ignore

	// WHERE each one fired: the first at the per-spin seam, BEFORE the `reveal` that replaced its
	// board; the second at `playBet`'s `finally`, because no board change follows it.
	check('the first pop is the per-spin seam', round.order.includes('spinPop:reveal'), true);
	check('…and it lands before the reveal it precedes', round.order.indexOf('spinPop:reveal') < round.order.lastIndexOf('broadcast:stopButtonEnable'), true); // prettier-ignore
	check(
		'the whole round reads: spin 1 pops, spin 2 reveals, round ends, spin 2 pops',
		round.order
			.filter((entry) => entry.startsWith('spinPop') || entry.startsWith('pop:'))
			.join(','),
		'spinPop:reveal,pop:start,pop:done',
	);
	check('…and the dispatch order is untouched', round.dispatched.join(','), 'coded:reveal,coded:winInfo,coded:setTotalWin,coded:updateFreeSpin,coded:reveal,coded:winInfo,coded:setTotalWin'); // prettier-ignore

	// ON THE LIVE BOARD. The first spin's cells were still the board's own cells when they exploded —
	// the fixture rebuilds the board on every `reveal`, exactly as `createReelSymbols` does, so a pop
	// that fired one event later would have named seats belonging to the NEXT board.
	const firstSpin = round.world.transitions.filter((t) => t.at < round.at('pop:start'));
	check('the first spin’s winners played `explosion` while their board was still up', firstSpin.filter((t) => t.state === 'explosion' && t.row === 0).length, 5); // prettier-ignore
	check('…and nothing on the second spin’s row was touched before its own win', firstSpin.filter((t) => t.row === 2 && t.state === 'explosion').length, 0); // prettier-ignore
	check('the second spin’s winners are the ones left removed on the final board', round.world.stateGame.board.flatMap((r, reel) => r.reelState.symbols.map((c, row) => (c.removed ? `${reel}:${row}` : null))).filter(Boolean).join(','), '0:2,1:2,2:2,3:2,4:2'); // prettier-ignore
}

{
	// THE CASCADE is the same question with a different event: a `tumbleBoard` replaces the seats the
	// step just paid on, so the step's winners must pop before it and not at the end of the chain.
	const round = await drivePlayBet({
		label: 'cascade',
		book: [
			{ type: 'reveal', board: [] },
			{ type: 'winInfo', wins: [lineWin([0, 0, 0, 0, 0], 5)] },
			{ type: 'tumbleBoard', explodingSymbols: [], newSymbols: [] },
			{ type: 'winInfo', wins: [lineWin([2, 2, 2, 2, 2], 5)] },
			{ type: 'setTotalWin', amount: 100 },
		],
		flowV2: undefined,
	});
	const pops = round.world.log.filter((entry) => entry.type === 'boardExplodeWinSymbols');
	check('a two-step cascade pops twice', pops.length, 2);
	check('…the first before the tumble that replaced its seats', round.order.includes('spinPop:tumbleBoard'), true); // prettier-ignore
	check('…naming only the step that paid', keysOf(pops[0].event.symbolPositions).join(','), '0:0,1:0,2:0,3:0,4:0'); // prettier-ignore
	check('…and the chain’s last step pops at the round seam', keysOf(pops[1].event.symbolPositions).join(','), '0:2,1:2,2:2,3:2,4:2'); // prettier-ignore
}

{
	// THE ROUND BOUNDARY. `recordWinCycleWins` clears at a board CHANGE, so the last spin's wins
	// outlive the book — and the per-spin seam runs immediately before the NEXT round's first
	// `reveal`, which is where they would be popped a second time. A stacked-COVERED seat is the case
	// that proves the leak is real rather than argued: the pop cannot remove one, so the leftover
	// really is still poppable when the next round opens.
	const round = await presentWinInfo(buildRound({ winExplode: true, coveredSeats: [[2, 2]] }));
	await round.clock.run(() => round.runtime.explodeSpinWinners());
	round.log.length = 0;

	// The next round opens HERE, at its first `reveal`.
	await round.clock.run(() => round.runtime.explodeWinnersBeforeBoardChange({ type: 'reveal' }));
	check(
		'left recorded, the previous round’s leftovers really would pop again',
		round.log.length,
		1,
	);

	round.log.length = 0;
	round.runtime.forgetWinCycleWins();
	await round.clock.run(() => round.runtime.explodeWinnersBeforeBoardChange({ type: 'reveal' }));
	check('…and dropping them at the round boundary is what stops it', round.log.length, 0);
	check('playBet drops them before the book starts', playBetBody.indexOf('forgetWinCycleWins();') > -1 && playBetBody.indexOf('forgetWinCycleWins();') < playBetBody.indexOf('await playBookEvents(bet.state);'), true); // prettier-ignore
}

{
	// NEVER TWICE. A spin whose winners are already gone must not pop again at the round seam, and a
	// non-paying spin in the middle of a book must not pop at all.
	const round = await drivePlayBet({
		label: 'one paying spin of three',
		book: [
			{ type: 'reveal', board: [] },
			{ type: 'setTotalWin', amount: 0 },
			{ type: 'reveal', board: [] },
			{ type: 'winInfo', wins: [lineWin([0, 0, 0, 0, 0], 5)] },
			{ type: 'setTotalWin', amount: 50 },
			{ type: 'reveal', board: [] },
			{ type: 'setTotalWin', amount: 50 },
		],
		flowV2: undefined,
	});
	const pops = round.world.log.filter((entry) => entry.type === 'boardExplodeWinSymbols');
	check('three spins, one of them paying ⇒ exactly ONE pop', pops.length, 1);
	check('…fired by the per-spin seam, not the round seam', round.order.filter((e) => e.startsWith('spinPop')).length, 1); // prettier-ignore
	check('…and the round seam finds nothing left to pop', round.order.filter((e) => e === 'pop:done').length, 1); // prettier-ignore
	check('…the board the round ends on is untouched', round.world.stateGame.board.flatMap((r) => r.reelState.symbols).filter((c) => c.removed).length, 0); // prettier-ignore

	// …AND ON THE FLOW PATH TOO. The seam is on BOTH branches of `playBookEvents`, so a v2 flow that
	// owns every event pops on exactly the same spins.
	const flow = await drivePlayBet({
		label: 'two spins, flow',
		book: twoSpinBook,
		flowV2: { ownsEvent: () => true },
	});
	check('the flow branch pops once per paying spin as well', flow.world.log.filter((e) => e.type === 'boardExplodeWinSymbols').length, 2); // prettier-ignore
	check('…driven by the flow, not the coded map', flow.dispatched.every((entry) => entry.startsWith('flow:')), true); // prettier-ignore

	// THE SWITCH still buys byte-parity across a whole multi-spin book.
	const off = await drivePlayBet({ label: 'two spins, off', book: twoSpinBook, flowV2: undefined, winExplode: false }); // prettier-ignore
	check('with the pop OFF a multi-spin book broadcasts nothing', off.world.log.filter((e) => e.type === 'boardExplodeWinSymbols').length, 0); // prettier-ignore
	check('…and removes nothing', off.world.stateGame.board.flatMap((r) => r.reelState.symbols).filter((c) => c.removed).length, 0); // prettier-ignore
}

{
	// THE CORPUS, A/B. The same REAL `recordWinCycleWins` + REAL `explodeSpinWinners` are driven over
	// every reference book twice: once with the per-spin seam (`explodeWinnersBeforeBoardChange`) and
	// once with the round seam alone, which is what shipped. The difference is the feature's coverage.
	const world = buildRound({ winExplode: true, art: { explosion: 10 } });
	const popsOverCorpus = async (books, perSpinSeam) => {
		let pops = 0;
		let payingSpins = 0;
		let booksMissingAPop = 0;
		for (const book of books) {
			world.log.length = 0;
			world.rebuildBoard();
			// One book is one `playBet`, which drops the previous round's recorded wins before the
			// first event (`forgetWinCycleWins`).
			world.runtime.forgetWinCycleWins();
			let spinPaid = false;
			let paid = 0;
			await world.clock.run(async () => {
				for (const event of book.events) {
					if (perSpinSeam) await world.runtime.explodeWinnersBeforeBoardChange(event);
					if (event.type === 'reveal' || event.type === 'tumbleBoard') {
						if (spinPaid) paid += 1;
						spinPaid = false;
						world.rebuildBoard();
					}
					if (event.type === 'winInfo') spinPaid = true;
					world.runtime.recordWinCycleWins(event);
				}
				await world.runtime.explodeSpinWinners();
			});
			if (spinPaid) paid += 1;
			const broadcast = world.log.filter((entry) => entry.type === 'boardExplodeWinSymbols').length;
			pops += broadcast;
			payingSpins += paid;
			if (broadcast < paid) booksMissingAPop += 1;
		}
		return { pops, payingSpins, booksMissingAPop };
	};

	for (const [label, path, expected] of [
		['base_books', '../apps/lines/src/stories/data/base_books.ts', { payingSpins: 7480, shipped: 5255 }], // prettier-ignore
		['bonus_books', '../apps/lines/src/stories/data/bonus_books.ts', { payingSpins: 250, shipped: 23 }], // prettier-ignore
	]) {
		const books = (await import(path)).default;
		const now = await popsOverCorpus(books, true);
		const shipped = await popsOverCorpus(books, false);
		console.log(
			`      ${label}: ${now.pops}/${now.payingSpins} paying spins pop (was ${shipped.pops}; ` +
				`${now.payingSpins - shipped.pops} were dropped, in ${shipped.booksMissingAPop} books)`,
		);
		check(`${label}: the round seam alone covered only the last spin`, shipped.pops, expected.shipped); // prettier-ignore
		check(`${label}: …and dropped the rest`, expected.payingSpins - expected.shipped > 0, true);
		check(`${label}: the per-spin seam covers every paying spin`, now.pops, expected.payingSpins);
		check(`${label}: …and no book is left short`, now.booksMissingAPop, 0);
		check(`${label}: …never popping more than it paid`, now.pops, now.payingSpins);
	}
}

console.log('');
console.log(failures ? `FAILED — ${failures} of ${checks} checks` : `PASSED — ${checks} checks`);
// `exitCode`, not `process.exit()`: an abrupt exit races Node's own type-stripper teardown on
// Windows and aborts with a libuv assertion AFTER the report has printed, which reads as a failure.
process.exitCode = failures ? 1 : 0;
