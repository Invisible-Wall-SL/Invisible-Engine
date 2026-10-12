/**
 * The spins-bonus sample `spinsGame.fixture.ts`, `check:spins-modes` and `check:spins-modes-contract`
 * build on: a host with a WAYS bonus (6×4, 5 spins), a CLUSTER bonus (7×7, 4 spins) and a LINES bonus
 * (4×3, 3 spins, three paylines of its own), each a `reels` mode of its own with strips cut from the
 * host's line-paying symbols. The cluster bonus pays its first symbol its own way.
 */

import type { GameConfigDoc, PaddingReels } from './src/types.ts';

export const WAYS_BONUS = 'waysBonus';
export const CLUSTER_BONUS = 'clusterBonus';
export const LINES_BONUS = 'linesBonus';

/** `reels` strips of `length` cells, dealt round-robin from `symbols` in runs of `run` cells, with
 *  a per-reel offset. Runs make a cluster game's boards clump, so its sample spins pay. */
const stripsOf = (
	symbols: string[],
	reels: number,
	length: number,
	run = 1,
): PaddingReels[string] =>
	Array.from({ length: reels }, (_unused, reel) =>
		Array.from({ length }, (_cell, i) => ({
			name: symbols[(Math.floor(i / run) * 3 + reel) % symbols.length],
		})),
	);

/** The host's symbols that pay on a line: a paytable, and neither scatter nor wild. */
const lineSymbolsOf = (doc: Pick<GameConfigDoc, 'symbols'>): string[] =>
	Object.entries(doc.symbols)
		.filter(([, s]) => s.paytable?.length && !s.special_properties?.length)
		.map(([name]) => name)
		.sort();

/** `doc` plus the two spins modes. Not normalized. */
export function withSpinsModes<T extends Pick<GameConfigDoc, 'symbols' | 'paddingReels' | 'modes'>>(
	doc: T,
): T {
	const lines = lineSymbolsOf(doc);
	const cluster = lines.slice(0, 4);
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
					paytable: { [cluster[0]]: [{ '5': 2 }, { '8': 10 }, { '12': 50 }] },
				},
			},
			{
				id: LINES_BONUS,
				board: 'reels',
				gameType: 'linesBonus',
				label: 'Lines bonus',
				counter: 'freeSpins',
				spins: {
					spins: 3,
					winModel: { type: 'lines' },
					numReels: 4,
					numRows: [3, 3, 3, 3],
					paylines: { 1: [1, 1, 1, 1], 2: [0, 0, 0, 0], 3: [2, 2, 2, 2] },
				},
			},
		],
		paddingReels: {
			...doc.paddingReels,
			waysBonus: stripsOf(lines, 6, 24),
			clusterBonus: stripsOf(cluster, 7, 28, 4),
			linesBonus: stripsOf(lines.slice(0, 2), 4, 18, 3),
		},
	};
}
