import type { LayoutDoc } from '../types';
import { engineSkeletonLayout } from './engineSkeleton';

/**
 * Engine-skeleton reference layout for the `cluster` kind (see §19.8). Board shape
 * from `apps/cluster/src/game/constants.ts`: `SYMBOL_SIZE = 80`,
 * `BOARD_DIMENSIONS = { x: INITIAL_BOARD.length = 7, y: INITIAL_BOARD[0].length - 2 = 7 }`,
 * `REEL_PADDING = 0.53` → a 7×7 board of 80px cells. Editor-only; consumed only by
 * the scaffold projection, so it carries no artist board frame.
 */
export function clusterReferenceLayout(): LayoutDoc {
	return engineSkeletonLayout({
		gameType: 'cluster',
		projectKey: 'cluster',
		board: { reels: 7, rows: 7, cellSize: 80, reelPadding: 0.53 },
	});
}
