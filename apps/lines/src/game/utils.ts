import _ from 'lodash';
import { stateBet } from 'state-shared';
import { createPlayBookUtils } from 'utils-book';
import { createGetEmptyPaddedBoard } from 'utils-slots';
import { sequence } from 'utils-shared/sequence';

import { BOARD_DIMENSIONS } from './constants';
import { getActiveSymbolInfoMap, resolveSymbolSizeRatios } from './symbolMap';
import { eventEmitter } from './eventEmitter';
import type { Bet, BookEvent, BookEventOfType } from './typesBookEvent';
import { bookEventHandlerMap } from './bookEventHandlerMap';
import { getFlowInterpreter } from './flowInterpreterHolder';
import type { RawSymbol, SymbolState } from './types';

// general utils
export const { getEmptyBoard } = createGetEmptyPaddedBoard({ reelsDimensions: BOARD_DIMENSIONS });
const coded = createPlayBookUtils({ bookEventHandlerMap });

/**
 * Play one book event. When the Invisible Flow interpreter is active (a FlowDoc is authored)
 * it OWNS dispatch — it runs the event's authored choreography or falls through to the coded
 * `bookEventHandlerMap` for an un-authored event, AND lets the macro graph take a `bookEvent`
 * transition (design doc §6.1, §7). ABSENT interpreter (no FlowDoc — the default) ⇒ the coded
 * `playBookEvent` runs unchanged, byte-identical to current `main`.
 */
export const playBookEvent = async (
	bookEvent: BookEvent,
	context: { bookEvents: BookEvent[] },
): Promise<void> => {
	const interpreter = getFlowInterpreter();
	if (interpreter) {
		await interpreter.dispatchBookEvent(bookEvent, context);
		return;
	}
	await coded.playBookEvent(bookEvent, context);
};

export const playBookEvents = async (
	bookEvents: BookEvent[],
	context?: { bookEvents?: BookEvent[] },
): Promise<void> => {
	// Interpreter active ⇒ run the SAME serial `sequence()` the coded path uses, routing each
	// event through the interpreter; otherwise defer entirely to the coded `playBookEvents`.
	if (getFlowInterpreter()) {
		await sequence(bookEvents, async (bookEvent) => {
			await playBookEvent(bookEvent, { ...context, bookEvents });
		});
		return;
	}
	await coded.playBookEvents(bookEvents, context);
};

export const playBet = async (bet: Bet) => {
	stateBet.winBookEventAmount = 0;
	await playBookEvents(bet.state);
	eventEmitter.broadcast({ type: 'stopButtonEnable' });
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
