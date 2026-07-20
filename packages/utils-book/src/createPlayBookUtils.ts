import { sequence } from 'utils-shared/sequence';

import type { BookEventHandlerMap, GetBookEventFromMap, GetBookEventContextFromMap } from './types';

export function createPlayBookUtils<TBookEventHandlerMap extends BookEventHandlerMap<any, any>>({
	bookEventHandlerMap,
	debug,
}: {
	bookEventHandlerMap: TBookEventHandlerMap;
	debug?: boolean;
}) {
	type TBookEvent = GetBookEventFromMap<TBookEventHandlerMap>;
	type BookEventContextFromMap = GetBookEventContextFromMap<TBookEventHandlerMap>;
	type BookEventContextFromMapWithoutBookEvents = Omit<BookEventContextFromMap, 'bookEvents'>;
	type BookEventContextOfBookEvents = { bookEvents: TBookEvent[] };
	type TBookEventContext = BookEventContextFromMapWithoutBookEvents & BookEventContextOfBookEvents;

	/**
	 * A slam (`roundSkip`) never SKIPS a book event — every event still runs, so no win, balance
	 * update or state write can be lost. What it removes is the TIME: each handler's waits and
	 * player-gated holds resolve at once and land on their final value. So `playBookEvents` keeps
	 * running the full serial `sequence` either way, and each handler is still AWAITED in full —
	 * racing a handler here would let a detached `reveal` keep spinning the reels underneath the
	 * `winInfo` that follows it.
	 */
	const playBookEvent = async (bookEvent: TBookEvent, bookEventContext: TBookEventContext) => {
		const bookEventHandler = bookEventHandlerMap?.[bookEvent.type];
		if (bookEventHandler) {
			if (debug) console.log(bookEvent);
			await bookEventHandler(bookEvent, bookEventContext);
		} else {
			console.error('Missing bookEventHandler in "bookEventHandlerMap" for: ', bookEvent);
		}
	};

	const playBookEvents = async (
		bookEvents: TBookEvent[],
		bookEventContext?: BookEventContextFromMapWithoutBookEvents,
	) => {
		const finalBookEventContext =
			bookEventContext || ({} as BookEventContextFromMapWithoutBookEvents);

		await sequence(bookEvents, async (bookEvent) => {
			await playBookEvent(bookEvent, { ...finalBookEventContext, bookEvents });
		});
	};

	return {
		playBookEvent,
		playBookEvents,
	};
}
