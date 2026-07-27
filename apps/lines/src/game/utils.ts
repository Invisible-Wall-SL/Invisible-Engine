import _ from 'lodash';
import { stateBet } from 'state-shared';
import { createPlayBookUtils } from 'utils-book';
import { createGetEmptyPaddedBoard } from 'utils-slots';
import { sequence } from 'utils-shared/sequence';
import { roundSkip } from 'utils-shared/skipToken';

import { boardDimensions } from './gameConfig';
import { getActiveSymbolInfoMap, resolveSymbolSizeRatios } from './symbolMap';
import { eventEmitter } from './eventEmitter';
import type { Bet, BookEvent, BookEventOfType } from './typesBookEvent';
import { bookEventHandlerMap } from './bookEventHandlerMap';
import { getFlowInterpreter } from './flowInterpreterHolder';
import { getFlowV2 } from './flowV2InterpreterHolder';
import { runBookEventPresentation } from './unskippablePresentation';
import { recordWinCycleWins, startWinCycle, stopWinCycle } from './winSymbolCycle';
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
	// free-spin intro run to completion under a slam on all of them.
	runBookEventPresentation(bookEvent.type, () => dispatchBookEvent(bookEvent, context));

const dispatchBookEvent = async (
	bookEvent: BookEvent,
	context: { bookEvents: BookEvent[] },
): Promise<void> => {
	// Recorded HERE, ahead of dispatch, so the idle win-symbol cycle sees every spin's wins whichever
	// path presents them — a flow-owned `winInfo` never reaches the coded handler map.
	recordWinCycleWins(bookEvent);

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
	// Neither active ⇒ defer entirely to the coded `playBookEvents` (byte-parity with `main`).
	if (getFlowInterpreter() || getFlowV2()) {
		await sequence(bookEvents, async (bookEvent) => {
			await playBookEvent(bookEvent, { ...context, bookEvents });
		});
		return;
	}
	await coded.playBookEvents(bookEvents, context);
};

export const playBet = async (bet: Bet) => {
	// The previous round's idle symbol replay is the FIRST thing a new bet ends — before the reels
	// move, so nothing keeps re-lighting cells the spin is about to overwrite.
	stopWinCycle();
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
		eventEmitter.broadcast({ type: 'stopButtonEnable' });
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

// other utils
export const getSymbolInfo = ({
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
	const resolveState =
		(state === 'bookIntro' || state === 'bookIdle') && !map[rawSymbol.name][state] ? 'win' : state;
	const cell = map[rawSymbol.name][resolveState];
	const resolved = resolveSymbolSizeRatios(rawSymbol.name, resolveState);
	return {
		...cell,
		sizeRatios: { width: resolved.width, height: resolved.height },
		symbolFit: resolved.fit,
	};
};
