/**
 * The spins-bonus sample both `spinsGame.fixture.ts` and `check:spins-modes` build on: the committed
 * lines default with a WAYS bonus (6×4, 5 spins) and a CLUSTER bonus (7×7, 4 spins), each a `reels`
 * mode of its own with strips cut from the base game's symbols.
 */

import type { GameConfigDoc, PaddingReels } from './src/types.ts';

export const WAYS_BONUS = 'waysBonus';
export const CLUSTER_BONUS = 'clusterBonus';

/** `reels` strips of `length` cells, dealt round-robin from `symbols` with a per-reel offset. */
const stripsOf = (symbols: string[], reels: number, length: number): PaddingReels[string] =>
	Array.from({ length: reels }, (_unused, reel) =>
		Array.from({ length }, (_cell, i) => ({ name: symbols[(i * 3 + reel) % symbols.length] })),
	);

/** `doc` (the lines default) plus the two spins modes. Not normalized. */
export function withSpinsModes(doc: GameConfigDoc): GameConfigDoc {
	const lineSymbols = ['H1', 'H2', 'H3', 'H4', 'L1', 'L2', 'L3', 'L4', 'L5'];
	return {
		...doc,
		modes: [
			...(doc.modes ?? []),
			{
				id: WAYS_BONUS,
				board: 'reels',
				gameType: 'waysBonus',
				label: 'Ways bonus',
				counter: 'freeSpins',
				spins: {
					spins: 5,
					winModel: { type: 'ways', direction: 'ltr', minKind: 3 },
					numReels: 6,
					numRows: [4, 4, 4, 4, 4, 4],
				},
			},
			{
				id: CLUSTER_BONUS,
				board: 'reels',
				gameType: 'clusterBonus',
				label: 'Cluster bonus',
				counter: 'freeSpins',
				spins: {
					spins: 4,
					winModel: { type: 'cluster', minCluster: 5, adjacency: 'orthogonal' },
					numReels: 7,
					numRows: [7, 7, 7, 7, 7, 7, 7],
					paytable: { H1: [{ '5': 2 }, { '8': 10 }, { '12': 50 }] },
				},
			},
		],
		paddingReels: {
			...doc.paddingReels,
			waysBonus: stripsOf(lineSymbols, 6, 24),
			clusterBonus: stripsOf(['H1', 'H2', 'L1', 'L2'], 7, 28),
		},
	};
}
