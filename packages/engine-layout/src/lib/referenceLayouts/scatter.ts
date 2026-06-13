import type { LayoutDoc } from '../types';
import { engineSkeletonLayout } from './engineSkeleton';

/**
 * Engine-skeleton reference layout for the `scatter` kind (see §19.8). Board shape
 * from `apps/scatter/src/game/constants.ts`: `SYMBOL_SIZE = 100`,
 * `BOARD_DIMENSIONS = { x: INITIAL_BOARD.length = 6, y: INITIAL_BOARD[0].length - 2 = 5 }`,
 * `REEL_PADDING = 0.53` → a 6×5 board of 100px cells. Editor-only; consumed only by
 * the scaffold projection, so it carries no artist board frame.
 */
export function scatterReferenceLayout(): LayoutDoc {
	return engineSkeletonLayout({
		gameType: 'scatter',
		projectKey: 'scatter',
		board: { reels: 6, rows: 5, cellSize: 100, reelPadding: 0.53 },
	});
}
