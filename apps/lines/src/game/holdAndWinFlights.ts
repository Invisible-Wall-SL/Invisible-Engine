import type { HoldAndWinCellAmount } from 'engine-game';

import { FLIGHT_TARGET_TOTAL, flyTo } from './flights.svelte';

/** The flight kind a coin flying into the win meter reports in `flightArrive`. */
export const FLIGHT_TO_TOTAL = 'toTotal';

/**
 * THE FEATURE END'S COLLECTION (design §4.3 `holdAndWinEnd` / §4.4) — every tallied coin flies from
 * its cell into the Total Win bar, column by column, top to bottom, staggered, and the beat waits
 * for the last head to land. Each landing broadcasts `flightArrive {flight: 'toTotal', target:
 * 'total', index}`, so an authored count-up or sound can step on impact.
 *
 * No avoidance: every coin on the board is leaving at once, so there is nothing left to bend around.
 * A slam compresses the volley (`flights.svelte.ts`), never skips it.
 */
export const flyCoinsToTotal = async (cells: readonly HoldAndWinCellAmount[]): Promise<void> => {
	const order = [...cells].sort((a, b) => a.reel - b.reel || a.row - b.row);
	await Promise.all(
		order.map((cell, index) =>
			flyTo({ reel: cell.reel, row: cell.row }, FLIGHT_TARGET_TOTAL, FLIGHT_TO_TOTAL, { index }),
		),
	);
};
