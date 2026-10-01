import type { GameTemplate, TemplateScene } from '../types';

import { standardTemplate } from './standard';

const sprite = (slotId: string, name: string) => ({ slotId, name, kind: 'sprite' as const });

const FREE_SPIN_SCENES = new Set(['freeSpinIntro', 'freeSpinCounter', 'freeSpinOutro']);

/**
 * The Hold and Win screens (design `docs/design/hold-and-win.md` §5) the reference layout
 * (`referenceLayouts/holdAndWin.ts`) furnishes. Their engine pieces are kind-gated component
 * instances, not coded mounts, so the slots here are the artist frames around them.
 */
const HOLD_AND_WIN_SCENES: TemplateScene[] = [
	{
		id: 'jackpotBar',
		name: 'Jackpot bar',
		slots: [sprite('jackpotBarFrame', 'Jackpot bar frame')],
	},
	{ id: 'pots', name: 'Pots', slots: [sprite('potsFrame', 'Pots frame')] },
	{
		id: 'respinBackground',
		name: 'Respin background',
		slots: [sprite('respinBackground', 'Respin background')],
	},
	{
		id: 'respinBoard',
		name: 'Respin board',
		slots: [sprite('respinBoardFrame', 'Respin board frame')],
	},
	{ id: 'respinCounter', name: 'Respin counter', slots: [] },
	{ id: 'totalWinBar', name: 'Total win bar', slots: [] },
	{ id: 'letters', name: 'Letters', slots: [] },
	{ id: 'luckySpin', name: 'Lucky Spin intro', slots: [sprite('luckySpinArt', 'Lucky Spin art')] },
	{ id: 'wheel', name: 'Wheel', slots: [sprite('wheelFrame', 'Wheel frame')] },
	{ id: 'featureIntro', name: 'Feature intro', slots: [sprite('featureIntroArt', 'Intro art')] },
	{ id: 'jackpotWin', name: 'Jackpot win', slots: [sprite('jackpotWinArt', 'Jackpot art')] },
	{ id: 'featureOutro', name: 'Feature outro', slots: [sprite('featureOutroArt', 'Outro art')] },
];

/**
 * The `holdAndWin` game-type template — the standard screen set without the free-spin screens,
 * plus the Hold and Win screens. No `board`: the shape is the preset's (5×3, or Super Hotfire
 * Diamonds' 3×3), so pinning one would warn on the other.
 */
export const holdAndWinTemplate: GameTemplate = {
	gameType: 'holdAndWin',
	version: 1,
	scenes: [
		...standardTemplate('holdAndWin').scenes.filter((scene) => !FREE_SPIN_SCENES.has(scene.id)),
		...HOLD_AND_WIN_SCENES,
	],
};
