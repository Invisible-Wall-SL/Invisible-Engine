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
import { getFlowV2 } from './flowV2InterpreterHolder';
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
	} else {
		await coded.playBookEvent(bookEvent, context);
	}
	// Invisible Flow v2 (Phase 4b) — a DEV-gated v2 flow reacts to the event ADDITIVELY: the coded
	// template still runs the mechanic above (reels, wins, state), while the v2 presentation graph
	// drives its containers/cues/effects on top. `dispatch` is a no-op for an un-authored event
	// (parity-safe), so this is inert unless `__IE_FLOW_V2_DOC__` authors a handler for this type.
	// The whole book event is the event's data payload (its fields are the event node's data-outs).
	const v2 = getFlowV2();
	if (v2) await v2.dispatch(bookEvent.type, bookEvent as unknown as Record<string, unknown>);
};

export const playBookEvents = async (
	bookEvents: BookEvent[],
	context?: { bookEvents?: BookEvent[] },
): Promise<void> => {
	// v1 OR v2 flow active ⇒ run the SAME serial `sequence()` the coded path uses, routing each
	// event through `playBookEvent` (which runs the v1/coded mechanic AND the additive v2 dispatch).
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
