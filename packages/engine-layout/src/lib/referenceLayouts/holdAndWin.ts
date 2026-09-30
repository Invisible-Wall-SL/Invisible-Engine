import type { LayoutDoc } from '../types';
import { engineSkeletonLayout } from './engineSkeleton';

/**
 * Engine-skeleton reference layout for the `holdAndWin` kind (§19.8): a 5×3 base board, so the kind
 * appears in the "New game from kind" picker and scaffolds a playable lines-shaped project. Cells
 * are the shared runtime's (`engine-game` `SYMBOL_SIZE = 120`, `REEL_PADDING = 0.53`). A
 * placeholder — Hold and Win Phase 6 (`docs/design/hold-and-win.md`) replaces it with the real
 * template (respin board, counter, jackpot bar, total bar).
 */
export function holdAndWinReferenceLayout(): LayoutDoc {
	return engineSkeletonLayout({
		gameType: 'holdAndWin',
		projectKey: 'holdAndWin',
		board: { reels: 5, rows: 3, cellSize: 120, reelPadding: 0.53 },
	});
}
