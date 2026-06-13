import type { LayoutDoc } from '../types';
import { engineSkeletonLayout } from './engineSkeleton';

/**
 * Engine-skeleton reference layout for the `ways` kind (see §19.8). Board shape
 * from `apps/ways/src/game/constants.ts`: `SYMBOL_SIZE = 120`,
 * `BOARD_DIMENSIONS = { x: INITIAL_BOARD.length = 5, y: INITIAL_BOARD[0].length - 2 = 3 }`,
 * `REEL_PADDING = 0.53` → a 5×3 board of 120px cells. Editor-only; consumed only
 * by the scaffold projection, so it carries no artist board frame.
 */
export function waysReferenceLayout(): LayoutDoc {
	return engineSkeletonLayout({
		gameType: 'ways',
		projectKey: 'ways',
		board: { reels: 5, rows: 3, cellSize: 120, reelPadding: 0.53 },
	});
}
