import type { GameTemplate } from '../types';

/**
 * The `arcade` game-type template (`docs/design/game-families.md` §5.1, P10.8): the screens an
 * arcade game has — the shared runtime's loading and background, the play field, its HUD and the
 * round-over screen. No board: the play field is a spawn layer the arcade loop moves.
 */
export const arcadeTemplate: GameTemplate = {
	gameType: 'arcade',
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
		{ id: 'basegame', name: 'Play field', slots: [] },
		{ id: 'arcadeHud', name: 'Score and lives', slots: [] },
		{ id: 'roundOver', name: 'Round over', slots: [] },
	],
};
