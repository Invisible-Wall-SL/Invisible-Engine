import type { GameTemplate } from '../types';

/**
 * The `card` game-type template (`docs/design/card-games.md` §9.2, C3): the screens a card game has
 * — the shared runtime's loading and background, the deck pick, the table and the two result
 * screens. No board: the cards are spawned into the table's zones by the runtime's match driver.
 */
export const cardTemplate: GameTemplate = {
	gameType: 'card',
	version: 1,
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
		{ id: 'cardTable', name: 'Table', slots: [] },
		{ id: 'cardDeckPick', name: 'Deck pick', slots: [] },
		{ id: 'cardWon', name: 'Match won', slots: [] },
		{ id: 'cardLost', name: 'Match lost', slots: [] },
	],
};
