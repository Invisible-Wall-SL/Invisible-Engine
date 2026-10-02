import type { HoldAndWinCellAmount } from 'engine-game';

import { FLIGHT_TARGET_TOTAL, flyTo } from './flights.svelte';

/** The flight kind a coin flying into the win meter reports in `flightArrive`. */
export const FLIGHT_TO_TOTAL = 'toTotal';
/** The flight kind a coin flying into a collector (or a base-game instant-collect special) reports. */
export const FLIGHT_TO_COLLECTOR = 'toCollector';
/** The flight kind a multiplier's beam to each coin it boosts reports (design §4.4 "Beams"). */
export const FLIGHT_BOOST_BEAM = 'boostBeam';
/** The flight kind an add-respins special's "+N" reports flying into the respin counter. */
export const FLIGHT_TO_COUNTER = 'toCounter';
/** The flight kind an upgrade special's beam to each coin it raises reports. */
export const FLIGHT_UPGRADE_BEAM = 'upgradeBeam';

/**
 * THE FEATURE END'S COLLECTION (design §4.3 `holdAndWinEnd` / §4.4) — every tallied coin flies from
 * its cell into the Total Win bar, column by column, top to bottom, staggered, and the beat waits
 * for the last head to land. Each landing broadcasts `flightArrive {flight: 'toTotal', target:
 * 'total', index}` and then calls `onLand(index)` — `index` into the cells in that column order — so
 * the bar's count-up steps on impact.
 *
 * No avoidance: every coin on the board is leaving at once, so there is nothing left to bend around.
 * A slam compresses the volley (`flights.svelte.ts`), never skips it.
 */
export const flyCoinsToTotal = async (
	cells: readonly HoldAndWinCellAmount[],
	onLand?: (index: number) => void,
): Promise<void> => {
	const order = [...cells].sort((a, b) => a.reel - b.reel || a.row - b.row);
	await Promise.all(
		order.map(async (cell, index) => {
			await flyTo({ reel: cell.reel, row: cell.row }, FLIGHT_TARGET_TOTAL, FLIGHT_TO_TOTAL, {
				index,
			});
			onLand?.(index);
		}),
	);
};
