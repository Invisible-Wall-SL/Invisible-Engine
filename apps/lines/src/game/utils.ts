import _ from 'lodash';
import { stateBet, stateUi } from 'state-shared';
import { createPlayBookUtils } from 'utils-book';
import { createGetEmptyPaddedBoard } from 'utils-slots';
import { sequence } from 'utils-shared/sequence';
import { roundSkip } from 'utils-shared/skipToken';

import { boardDimensions } from './gameConfig';
import { getActiveSymbolInfoMap, resolveSymbolSizeRatios, symbolMapGeneration } from './symbolMap';
import { resolveSymbolState } from './symbolCell';
import { eventEmitter } from './eventEmitter';
import type { Bet, BookEvent, BookEventOfType } from './typesBookEvent';
import { bookEventHandlerMap } from './bookEventHandlerMap';
import { setPendingScatterAwardFs } from './flowEffects';
import { getFlowInterpreter } from './flowInterpreterHolder';
import { getFlowV2 } from './flowV2InterpreterHolder';
import { runBookEventPresentation, startsCelebration } from './unskippablePresentation';
import { trackCascadeStep } from './soundBindings';
import {
	explodeSpinWinners,
	explodeWinnersBeforeBoardChange,
	forgetWinCycleWins,
	recordWinCycleWins,
	startWinCycle,
	stopWinCycle,
} from './winSymbolCycle';
import { showAllWinLines, winsOnThisBoard } from './flowEffects';
import { bakedWinLineConfig } from '../editor-scenes';
import { clearSpinHold, holdAfterBigWin } from './freeSpinHold';
import type { RawSymbol, SymbolState } from './types';

// general utils. A function (not a memoised `getEmptyBoard`) so the padded board is sized from the
// CURRENT active config each call — the online config resolves after this module evaluates, so a
// board factory captured at import would freeze to the compiled template's grid.
export const getEmptyBoard = () =>
	createGetEmptyPaddedBoard({ reelsDimensions: boardDimensions() }).getEmptyBoard();
const coded = createPlayBookUtils({ bookEventHandlerMap });

/**
 * Play one book event. When the Invisible Flow interpreter is active (a FlowDoc is authored)
 * it OWNS dispatch — it runs the event's authored choreography or falls through to the coded
 * `bookEventHandlerMap` for an un-authored event, AND lets the macro graph take a `bookEvent`
 * transition (design doc §6.1, §7). ABSENT interpreter (no FlowDoc — the default) ⇒ the coded
 * `playBookEvent` runs unchanged, byte-identical to current `main`.
 */
export const playBookEvent = (
	bookEvent: BookEvent,
	context: { bookEvents: BookEvent[] },
): Promise<void> =>
	// The UNSKIPPABLE carve-out is opened HERE, around the whole dispatch, so it covers whichever of
	// the three paths below drives the event (coded / v1 flow / v2 flow) — the book reveal and the
	// free-spin intro run to completion under a slam on all of them. `startsCelebration` additionally
	// re-arms the slam token before a big win / free-spin outro / retrigger, so those present un-slammed
	// (the same three paths) — celebrations are never fast-forwarded.
	runBookEventPresentation(
		bookEvent.type,
		() => dispatchBookEvent(bookEvent, context),
		startsCelebration(bookEvent),
	);

/**
 * THE RUNNING WIN METER — every `winInfo` moves it, not just the round's closing `setTotalWin`.
 *
 * A `winInfo` already carries `totalWin`: the round's payout INCLUDING this win. On the Play4Fun
 * facade every shipped game runs on, one event is flushed per win, so that figure is a genuine
 * running total — it climbs across a spin's several paying lines AND across every board a cascade
 * scores (`engineFacade`'s `runningTotal` accumulates through the whole chain). Nothing consumed it:
 * the meter was written only by `setTotalWin`, at `gameEnd`, so a five-tumble chain narrated five
 * wins with the Win box reading 0.00 the entire time and then snapping to the total once the board
 * had already settled. `LabelWin` tweens the value, so each step now counts up into the next.
 *
 * Lives at THIS seam — with `recordWinCycleWins` and the all-at-once win lines, for the same reason:
 * a flow-owned `winInfo` never reaches the coded handler map, and the meter has to behave the same
 * on a flow-driven game as on a coded one.
 *
 * FORWARD ONLY. `playBet` zeroes the meter at the start of every round, so within a round the total
 * can only grow; a book that omits `totalWin` (or reports a stale smaller one) would otherwise walk
 * the meter backwards mid-celebration. `setTotalWin` still assigns the closing figure unconditionally
 * — it is the authority on what the round paid, and by then this has usually already reached it.
 */
const advanceWinMeter = (bookEvent: BookEvent): void => {
	if (bookEvent.type !== 'winInfo') return;
	const total = bookEvent.totalWin;
	if (!Number.isFinite(total) || total <= stateBet.winBookEventAmount) return;
	stateBet.winBookEventAmount = total;
};

const dispatchBookEvent = async (
	bookEvent: BookEvent,
	context: { bookEvents: BookEvent[] },
): Promise<void> => {
	// Recorded HERE, ahead of dispatch, so the idle win-symbol cycle sees every spin's wins whichever
	// path presents them — a flow-owned `winInfo` never reaches the coded handler map.
	recordWinCycleWins(bookEvent);

	// Same seam, same reason: the WIN METER climbs with every win, instead of sitting at zero for
	// the whole round and jumping once at `setTotalWin`.
	advanceWinMeter(bookEvent);

	// Same seam, same reason: which rung of the tumble-explosion ladder the next cascade pop plays
	// (and whether the pop is a cascade at all, rather than the board CLEAR that shares its cue).
	// A flow-owned `tumbleBoard` never reaches the coded handler map either, and a flow-driven game
	// has to sound the same as a coded one.
	trackCascadeStep(bookEvent);

	// ALL-AT-ONCE WIN LINES (Symbols State Machine → "Show all win lines at once"): draw EVERY paying
	// line of this event together, up front, and leave them on screen. Placed HERE — the one seam all
	// three dispatch paths cross, the same reason `recordWinCycleWins` lives here — because a
	// flow-owned `winInfo` never reaches the coded handler map, and this mode has to look the same on
	// a flow-driven game as on a coded one. The per-win draws downstream stand down in this mode (the
	// coded handler skips them, the `showWinLine` effect returns early), and nothing hides the set
	// until the next spin. Awaited so the lines are up before the symbols celebrate — the beat order
	// the one-at-a-time narration plays. Off (the default) this is a single boolean read.
	if (bookEvent.type === 'winInfo' && bakedWinLineConfig().line.allAtOnce) {
		await showAllWinLines(winsOnThisBoard(bookEvent, context.bookEvents));
	}

	// Capture the retrigger's extra-spins count for the `freeSpinsAdded` / `freeSpinsAddedText` value
	// sources — universally (ahead of dispatch) so it's populated whichever path presents the retrigger:
	// a flow-owned `freeSpinRetrigger` suppresses the coded handler, so the coded handler alone can't own
	// this. Purely a display value (not load-bearing game state), so a single set point here is safe.
	if (bookEvent.type === 'freeSpinRetrigger') stateUi.freeSpinsAdded = bookEvent.extraFs;

	// Free-spin AWARD line, flow path. When a v2 flow drives the trigger it mounts the intro CONTAINER
	// on `freeSpinTrigger` (a screen takeover), so the award can't be a toast fired there — it must ride
	// the scatter's `winInfo` toast on the base board (`showWinInfoMessage`). That `winInfo` arrives
	// BEFORE `freeSpinTrigger`, so look the awarded count up from the book HERE and stash it for the
	// upcoming `winInfo` dispatch; clear it for every other event so a plain zero-pay entry stays
	// suppressed. The coded (non-flow) path announces the award from its `freeSpinTrigger` handler
	// instead, so this only feeds the flow-owned branch.
	if (bookEvent.type === 'winInfo') {
		const trigger = context.bookEvents.find(
			(e): e is BookEventOfType<'freeSpinTrigger'> => e.type === 'freeSpinTrigger',
		);
		setPendingScatterAwardFs(trigger?.totalFs);
	} else {
		setPendingScatterAwardFs(undefined);
	}

	// Invisible Flow v2 — EVENT OWNERSHIP (the incremental v1→v2 migration mechanism). When a v2 flow
	// authors this event (`ownsEvent`), v2 drives it ALONE and the coded/v1 twin is SUPPRESSED — so a
	// migrated event runs through the flow with NO doubling. Un-owned events fall through unchanged to
	// the v1 interpreter (if a FlowDoc is authored) or the coded handler map (parity). This lets the
	// game hand events to v2 one at a time; with no v2 doc, `getFlowV2()` is undefined ⇒ byte-parity.
	const v2 = getFlowV2();
	if (v2?.ownsEvent(bookEvent.type)) {
		// Confirm which path drove the event — v2 is a PARITY repro of v1 so it looks identical on
		// screen; this console line is how you verify v2 (not v1/coded) actually handled it.
		if (import.meta.env.DEV) console.info(`[flow-v2] drove '${bookEvent.type}'`);
		// Pass the whole event as the trigger + the surrounding book list as `$context.bookEvents`
		// (the `reveal` mechanic reads it for the bonus-game check), matching the coded handler's args.
		await v2.dispatch(bookEvent.type, bookEvent as unknown as Record<string, unknown>, {
			bookEvents: context.bookEvents,
		});
		return;
	}

	const interpreter = getFlowInterpreter();
	if (interpreter) {
		await interpreter.dispatchBookEvent(bookEvent, context);
	} else {
		await coded.playBookEvent(bookEvent, context);
	}
};

export const playBookEvents = async (
	bookEvents: BookEvent[],
	context?: { bookEvents?: BookEvent[] },
): Promise<void> => {
	// v1 OR v2 flow active ⇒ run the SAME serial `sequence()` the coded path uses, routing each event
	// through `playBookEvent` (which hands an event to v2 when it OWNS it, else v1/coded — see above).
	// Neither active ⇒ the coded dispatch, event by event (`coded.playBookEvent` is exactly what
	// `coded.playBookEvents` loops over, so that branch stays byte-identical to deferring to it).
	//
	// The BETWEEN-SPINS HOLD hangs off both branches, after the event's presentation is fully awaited:
	// a big win mid-feature parks the book on its winning board until the player presses SPIN
	// (`freeSpinHold.ts`). Off by default ⇒ both branches are byte-identical to before.
	//
	// THE PER-SPIN POP (Invisible Symbols → "Winning symbols explode") hangs off the TOP of both
	// branches, for the mirror of the hold's reason: a spin's winners have to blow up while the board
	// they were scored on is still the board on screen, i.e. immediately BEFORE the `reveal` /
	// `tumbleBoard` that replaces it. Here rather than at `dispatchBookEvent` because this is the one
	// seam BOTH dispatch branches cross. `playBet`'s `finally` still pops the book's LAST spin, which
	// no board change follows. A no-op for every other event, and one boolean read with the switch
	// off ⇒ both branches are byte-identical to before.
	if (getFlowInterpreter() || getFlowV2()) {
		await sequence(bookEvents, async (bookEvent) => {
			await explodeWinnersBeforeBoardChange(bookEvent);
			await playBookEvent(bookEvent, { ...context, bookEvents });
			await holdAfterBigWin(bookEvent, bookEvents);
		});
		return;
	}
	await sequence(bookEvents, async (bookEvent) => {
		await explodeWinnersBeforeBoardChange(bookEvent);
		await coded.playBookEvent(bookEvent, { ...context, bookEvents });
		await holdAfterBigWin(bookEvent, bookEvents);
	});
};

export const playBet = async (bet: Bet) => {
	// The previous round's idle symbol replay is the FIRST thing a new bet ends — before the reels
	// move, so nothing keeps re-lighting cells the spin is about to overwrite.
	stopWinCycle();
	// …and the wins it replayed are dropped with it, so the per-spin pop at the top of
	// `playBookEvents` cannot open this round by exploding the PREVIOUS one's winning set.
	forgetWinCycleWins();
	// The slam token is scoped to the ROUND — re-armed here and nowhere else (owner direction). A
	// bonus book is ONE round, so a single press fast-forwards every remaining free spin in it
	// straight to the final total, rather than costing the player a press per spin.
	roundSkip.reset();
	stateBet.winBookEventAmount = 0;
	try {
		await playBookEvents(bet.state);
	} finally {
		// ALWAYS re-enable, even if a handler threw: `stopButtonEnable` is what clears the
		// non-persistent turbo `stopButtonClick` set (`ButtonTurbo`). Leaving it unsent on the
		// error path stuck turbo on for the rest of the session. The token is cleared here too so
		// an aborted round cannot leave the board's slam checks reading a stale trip.
		roundSkip.reset();
		// Belt-and-braces: clear the unskippable-presentation button lock. `runBookEventPresentation`
		// balances it with try/finally, so it is already false here on every normal path — but a
		// STUCK-true lock would leave the spin button permanently inert (game unplayable), so force it
		// off at round end where a stale trip is likewise cleared.
		stateUi.unskippablePresentationActive = false;
		// Same belt-and-braces reasoning: a between-spins hold left standing by a handler that threw
		// would leave the button reading SPIN with no book left to resume (`freeSpinHold.ts`).
		clearSpinHold();
		eventEmitter.broadcast({ type: 'stopButtonEnable' });
		// THE POP (Invisible Symbols → "Winning symbols explode"), for the book's LAST spin — the one
		// no `reveal` / `tumbleBoard` follows, so the per-spin seam at the top of `playBookEvents`
		// never reaches it. Every EARLIER spin has already popped there, against its own board; here
		// the winning set that is left blows up TOGETHER, once every win has narrated. In the
		// `finally`, so a slammed or aborted round reaches it too; a spin that paid nothing, or a book
		// whose last spin already popped, broadcasts nothing.
		//
		// AWAITED, and awaited BEFORE the replay starts: the cycle skips cells the pop took off, so
		// starting it first would light seats that are about to vanish. Off (the default) this is one
		// boolean read.
		await explodeSpinWinners();
		// The round is presented; keep its winning SYMBOLS animating on the resting board until the
		// next bet. Deliberately NOT awaited — it runs until `stopWinCycle` above ends it.
		void startWinCycle();
	}
};

// resume bet
const BOOK_EVENT_TYPES_TO_RESERVE_FOR_SNAPSHOT = [
	'updateGlobalMult',
	'freeSpinTrigger',
	'updateFreeSpin',
	'setTotalWin',
];

export const convertTorResumableBet = (betToResume: Bet) => {
	const resumingIndex = Number(betToResume.event);
	const bookEventsBeforeResume = betToResume.state.filter(
		(_, eventIndex) => eventIndex < resumingIndex,
	);
	const bookEventsAfterResume = betToResume.state.filter(
		(_, eventIndex) => eventIndex >= resumingIndex,
	);

	const bookEventToCreateSnapshot: BookEventOfType<'createBonusSnapshot'> = {
		index: 0,
		type: 'createBonusSnapshot',
		bookEvents: bookEventsBeforeResume.filter((bookEvent) =>
			BOOK_EVENT_TYPES_TO_RESERVE_FOR_SNAPSHOT.includes(bookEvent.type),
		),
	};

	const stateToResume = [bookEventToCreateSnapshot, ...bookEventsAfterResume];

	return { ...betToResume, state: stateToResume };
};

/** Parse a `#rrggbb` hex string into a `0xRRGGBB` MULTIPLY tint number (a Pixi `ColorSource`).
 *  Returns undefined for an absent/blank/malformed value, letting a caller fall through to
 *  "no tint" — `#rrggbb` maps directly to the number, so `parseInt(base 16)` is exact. */
export const hexToTintNumber = (hex: string | undefined): number | undefined => {
	if (!hex) return undefined;
	const n = parseInt(hex.replace(/^#/, ''), 16);
	return Number.isNaN(n) ? undefined : n;
};

/** Symbols already reported as having no art — one warning each, not one per frame. */
const warnedMissingArt = new Set<string>();

// other utils
/**
 * Did this symbol AUTHOR art for this state, or is it borrowing someone else's?
 *
 * Asked by the emerge arrival, and the reason is a timing one rather than a rendering one. A beat
 * that waits on an animation is capped so a cell that can never report cannot hang the round — but
 * an INHERITED state is exactly such a cell much of the time (it falls back to `land`, or to the
 * resting `static` art, neither of which need report anything), so an un-authored intro pays the
 * WHOLE cap on every arrival. Sized for authored art, that cap then stops being a guard and becomes
 * the pace: it cost an un-authored cascade step 2650 ms where the shipped slide cost 1500 ms.
 *
 * So the caller spends the long cap only on art someone actually made, and gives everything else
 * the ordinary transit cap. Reuses `resolveSymbolState` rather than re-deciding inheritance, so
 * "authored" here means precisely what the renderer means by it.
 */
export const hasAuthoredSymbolState = (symbolName: string, state: SymbolState): boolean =>
	resolveSymbolState(getActiveSymbolInfoMap()[symbolName], state) === state;

/**
 * THE RESOLVED CELL IS MEMOISED, AND THE MEMO IS ABOUT IDENTITY RATHER THAN SPEED.
 *
 * `Symbol.svelte`/`TumbleSymbol.svelte` hold this behind a `$derived`, and every renderer
 * downstream keys work off the OBJECT it returns: `SymbolFlipbook` re-arms the beat that decides
 * how long a state is held (`$effect(() => { props.symbolInfo; setTimeout(oncomplete, cycleMs) })`)
 * and re-folds the clip it plays. Returning a fresh object for an unchanged symbol therefore does
 * not cost a comparison — it restarts the animation the player is watching.
 *
 * That is not hypothetical. Measured on a live cascading board: ONE spin re-armed the flipbook beat
 * 99 times across ~20 symbols, in five board-wide bursts spaced exactly one explosion-pattern step
 * apart — every column's explode step re-derived every symbol on the board, so each symbol's emerge
 * restarted five times over. Nothing was remounted (zero display objects were created), and the
 * symbol's STATE was assigned exactly once; only the identity churned.
 *
 * The result is a pure function of `(name, state)` — the map is memoised and immutable, the size
 * resolver reads the same baked doc, and nothing mutates what comes back (asserted before this was
 * added). So caching it is safe, and it makes the whole render path immune to upstream churn by
 * construction rather than by every consumer remembering to compare.
 *
 * Keyed by the map GENERATION too, so the live runtime bundle's arrival (`resetSymbolMapCache`)
 * invalidates this in the same breath — otherwise an online game would render the coded template
 * art forever, which is the exact bug that reset exists to prevent.
 */
const symbolInfoMemo = new Map<string, ReturnType<typeof resolveSymbolInfo>>();
let symbolInfoMemoGeneration = -1;

export const getSymbolInfo = ({
	rawSymbol,
	state,
}: {
	rawSymbol: RawSymbol;
	state: SymbolState;
}) => {
	const generation = symbolMapGeneration();
	if (generation !== symbolInfoMemoGeneration) {
		symbolInfoMemo.clear();
		symbolInfoMemoGeneration = generation;
	}
	// `JSON.stringify` rather than a joined string: a symbol name is author-supplied, and any
	// separator character it might legally contain would let two different (name, state) pairs
	// collide onto one another's art.
	const key = JSON.stringify([rawSymbol.name, state]);
	const memoised = symbolInfoMemo.get(key);
	if (memoised) return memoised;
	const resolved = resolveSymbolInfo({ rawSymbol, state });
	symbolInfoMemo.set(key, resolved);
	return resolved;
};

const resolveSymbolInfo = ({
	rawSymbol,
	state,
}: {
	rawSymbol: RawSymbol;
	state: SymbolState;
}) => {
	// Overlay the globally-resolved size (per-cell override > global default > coded), so render
	// components always read a present, resolved `sizeRatios` regardless of the sparse override.
	// `symbolFit` carries the resolver's provenance: `'contain'` (reel-override bounding box) or
	// `'stretch'` (every other path — today's direct width/height).
	// Special-Book states inherit the symbol's EFFECTIVE win binding (which includes any
	// authored Symbols-State-Machine override) unless a book binding is explicitly authored,
	// so the reveal/idle always mirrors the live win art rather than a stale coded default.
	const map = getActiveSymbolInfoMap();

	/**
	 * A symbol the map has never heard of RENDERS NOTHING — it does not take the game down.
	 *
	 * Every lookup below indexes `map[name][state]`, so an unknown name used to throw
	 * "Cannot read properties of undefined" from inside a render, which unmounts the whole board:
	 * the player loses the reels, not one cell. That is a catastrophic response to a cosmetic gap,
	 * and the gap is REACHABLE by ordinary authoring — a config can name a symbol (a multiplier, a
	 * new picture) before anyone binds art for it in the Symbols tool, and the merge in
	 * `getActiveSymbolInfoMap` unions BOTH key sets, so the name exists everywhere except the art.
	 *
	 * `warnOnGameConfigIssues` already reports this at boot as an error. It was detected and not
	 * survivable, which is the worst of both.
	 */
	if (!map[rawSymbol.name]) {
		if (!warnedMissingArt.has(rawSymbol.name)) {
			warnedMissingArt.add(rawSymbol.name);
			console.warn(
				`[symbols] "${rawSymbol.name}" is dealt but has no art bound in /symbols — rendering nothing for it`,
			);
		}
		const resolved = resolveSymbolSizeRatios(rawSymbol.name, state);
		return {
			missingArt: true as const,
			type: undefined,
			assetKey: undefined,
			sizeRatios: { width: resolved.width, height: resolved.height },
			symbolFit: resolved.fit,
		};
	}

	// WHICH STATE this symbol actually draws. The rule lives in `symbolCell.ts`, import-free so it
	// can be exercised offline — see the reasoning there. The short version: an unauthored state
	// used to spread as nothing, and `Symbol.svelte`'s last arm is the SPINE renderer, so it fell
	// through and handed `SpineProvider` an undefined key. `key.match(...)` then threw mid-render and
	// took the board with it. `explosion` is where it bites, because the cascade is the only caller
	// and a project-only symbol (a multiplier) has no coded cell to inherit.
	const resolveState = resolveSymbolState(map[rawSymbol.name], state);
	if (!resolveState) {
		if (!warnedMissingArt.has(rawSymbol.name)) {
			warnedMissingArt.add(rawSymbol.name);
			console.warn(
				`[symbols] "${rawSymbol.name}" has no usable art for "${state}" (and none for "static") — rendering nothing for it`,
			);
		}
		const fallback = resolveSymbolSizeRatios(rawSymbol.name, state);
		return {
			missingArt: true as const,
			type: undefined,
			assetKey: undefined,
			sizeRatios: { width: fallback.width, height: fallback.height },
			symbolFit: fallback.fit,
		};
	}
	const cell = map[rawSymbol.name][resolveState];
	const resolved = resolveSymbolSizeRatios(rawSymbol.name, resolveState);
	return {
		missingArt: false as const,
		...cell,
		sizeRatios: { width: resolved.width, height: resolved.height },
		symbolFit: resolved.fit,
	};
};
