import type { GameTemplate } from '../types';

import { MATCH3_BOARD } from '../referenceLayouts/match3';

/**
 * The `match3` game-type template (`docs/design/game-families.md` §5.1): the screens a match-3
 * game has — the slot runtime's loading and background, the board, its HUD and the two round
 * screens. No free-spin or win-overlay screens: a match-3 board never spins and, in a rules game,
 * never pays.
 */
export const match3Template: GameTemplate = {
	gameType: 'match3',
	version: 1,
	board: { ...MATCH3_BOARD },
	scenes: [
		{
			id: 'loading',
			name: 'Loading / logo',
			slots: [
				{
					slotId: 'loadingScreen',
					name: 'Loading screen (logo)',
					kind: 'mount',
					mountComponent: 'LoadingScreen',
				},
			],
		},
		{
			id: 'background',
			name: 'Background',
			slots: [
				{ slotId: 'background', name: 'Background', kind: 'mount', mountComponent: 'Background' },
			],
		},
		{
			id: 'basegame',
			name: 'Board',
			slots: [
				{ slotId: 'boardFrame', name: 'Board frame', kind: 'sprite' },
				{ slotId: 'reelGrid', name: 'Board', kind: 'mount', mountComponent: 'ReelGrid' },
			],
		},
		{ id: 'match3Hud', name: 'Score and moves', slots: [] },
		{ id: 'roundWon', name: 'Round won', slots: [] },
		{ id: 'roundLost', name: 'Round lost', slots: [] },
	],
};
