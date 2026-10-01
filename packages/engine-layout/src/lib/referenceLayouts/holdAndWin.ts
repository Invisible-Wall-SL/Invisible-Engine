import {
	TAP_ARM_AFTER_SIGNAL_PARAM,
	TAP_DIM_ALPHA_PARAM,
	TAP_TO_CONTINUE_PARAM,
} from '../tapToContinue';
import type { LayoutDoc, LayoutNode, LayoutType, NodeOverride, Scene } from '../types';
import { engineSkeletonLayout, type EngineSkeletonBoard } from './engineSkeleton';

/**
 * The Hold and Win reference layout (design `docs/design/hold-and-win.md` §5–§6, Phase 6) — ONE
 * scene set that makes all three reference games: Grand (column letters), Super Hotfire Diamonds
 * (3×3, a wheel) and 3 Pots of Egypt (pots). Every piece a preset does not use draws nothing (a pot
 * whose meter the config lacks, letters without a column-letters board end, a wheel without
 * prizes), so no preset needs its own screens.
 *
 * Built on the shared engine skeleton (loading, background, base board, overlays, buy screens,
 * HUD) minus the free-spin screens — the feature is the respins, not free spins (a hybrid adds them
 * back with "Add missing screens" from another kind, or by hand). Screens, in layer order:
 *
 * - `respinBackground` — the feature's backdrop (artist art; the coded `Background` shows the
 *   feature background while the game type is `respin`).
 * - `basegame` — the reel grid and the MESSAGE HOST: the `infoBar` every engine toast draws in
 *   ("UNLOCKED: PAYER", "PAYER ACTIVE", "MINI JACKPOT …"). The base game stays mounted under the
 *   respin board for the whole feature, so this one host serves both; a second host in a feature
 *   screen would draw every toast twice.
 * - `jackpotBar`, `pots` — on screen in the base game and the feature alike (a pot fills in the
 *   base game; the jackpot table is always shown).
 * - the feature (`role: 'mode'`, `modeId: 'holdAndWin'` — mounted while the mode is on the stack):
 *   `respinBoard` (frame art over the coded respin board), `respinCounter` (+ the active
 *   modifiers), `totalWinBar`, `letters`, `wheel`, `featureIntro`, `featureOutro`, `jackpotWin`.
 * - `luckySpin` — the base-game Lucky Spin banner.
 *
 * The intro, outro and wheel HOLD the round like the free-spin intro/outro: a flow shows them
 * around their beat (`showContainer` … `showContainer{awaitComplete}` … `hideContainer`). The Lucky
 * Spin and jackpot-win screens follow the coded banner instead (`luckySpinShow` / `jackpotWinShow`),
 * which the same beat sets whichever path presents it.
 *
 * Everything is placed AROUND the board, never on it, and the board's rows (3) are the same in
 * every preset — so the 3×3 Hotfire board (narrower) fits the same layout as 5×3; pass its shape as
 * `board`. Two arrangements: wide (desktop/landscape) puts the counter and the total either side of
 * the board, tall (tablet/portrait) stacks them above and below.
 */

/** The 5×3 board of Grand and 3 Pots of Egypt (`SYMBOL_SIZE = 120`, `REEL_PADDING = 0.53`). */
export const HOLD_AND_WIN_BOARD: EngineSkeletonBoard = {
	reels: 5,
	rows: 3,
	cellSize: 120,
	reelPadding: 0.53,
};

/** Super Hotfire Diamonds' 3×3 board — the `collector` preset. */
export const HOLD_AND_WIN_HOTFIRE_BOARD: EngineSkeletonBoard = { ...HOLD_AND_WIN_BOARD, reels: 3 };

export const HOLD_AND_WIN_MODE = 'holdAndWin';

/**
 * The authored screen that draws each coded banner beat. While the flow shows one (the screen is
 * mounted) the game's coded banner for that beat steps aside, so the two never draw together; with
 * the screen unmounted the coded banner plays exactly as before.
 */
export const HOLD_AND_WIN_BANNER_SCREENS = {
	luckySpin: 'luckySpin',
	jackpot: 'jackpotWin',
} as const;

/** The meters of the Pots preset (`holdAndWinPresets.ts`) — one pot each. */
const POT_METERS = ['red', 'blue', 'green'] as const;

type Spot = { dx: number; dy: number; scale?: number };
type Arrangement = 'wide' | 'tall';

const ARRANGEMENT: Record<string, Arrangement> = {
	desktop: 'wide',
	landscape: 'wide',
	tablet: 'tall',
	portrait: 'tall',
};

/**
 * Board-relative placement in every layout type. The board is centred in each main box (as the
 * skeleton's reel grid is), so an offset from the box centre is an offset from the board.
 */
const placeIn =
	(sizes: LayoutDoc['mainSizesMap']) =>
	(wide: Spot, tall: Spot = wide) => {
		const at = (type: string, spot: Spot) => {
			const size = sizes[type];
			return {
				x: size.width / 2 + spot.dx,
				y: size.height / 2 + spot.dy,
				...(spot.scale !== undefined ? { scale: { x: spot.scale, y: spot.scale } } : {}),
			};
		};
		const overrides: Partial<Record<LayoutType, NodeOverride>> = {};
		for (const type of Object.keys(sizes)) {
			if (type === 'desktop') continue;
			overrides[type] = at(type, ARRANGEMENT[type] === 'tall' ? tall : wide);
		}
		return { ...at('desktop', wide), overrides };
	};

const instance = (
	id: string,
	label: string,
	componentId: string,
	spot: Pick<LayoutNode, 'x' | 'y' | 'scale' | 'overrides' | 'screenAnchor'>,
	params?: Record<string, unknown>,
): LayoutNode => ({
	id,
	label,
	kind: 'componentInstance',
	componentId,
	...spot,
	...(params ? { params } : {}),
});

const HEADLINE_FILL = 0xffd35c;
const HEADLINE = (text: string) => ({ text, fontSize: 72, fill: HEADLINE_FILL });

const tap = (id: string, armAfterSignal?: string): LayoutNode => ({
	id,
	label: 'Tap to continue',
	kind: 'componentInstance',
	componentId: 'tapToContinue',
	x: 0,
	y: 0,
	params: {
		[TAP_TO_CONTINUE_PARAM]: true,
		[TAP_DIM_ALPHA_PARAM]: 0.5,
		...(armAfterSignal ? { [TAP_ARM_AFTER_SIGNAL_PARAM]: armAfterSignal } : {}),
	},
});

const modeScene = (scene: Omit<Scene, 'role' | 'modeId'>): Scene => ({
	...scene,
	role: 'mode',
	modeId: HOLD_AND_WIN_MODE,
});

/** The skeleton screens the feature replaces. */
const FREE_SPIN_SCENES = new Set(['freeSpinIntro', 'freeSpinCounter', 'freeSpinOutro']);

export function holdAndWinReferenceLayout(
	board: EngineSkeletonBoard = HOLD_AND_WIN_BOARD,
): LayoutDoc {
	const skeleton = engineSkeletonLayout({
		gameType: 'holdAndWin',
		projectKey: 'holdAndWin',
		board,
	});
	const place = placeIn(skeleton.mainSizesMap);
	// The intro/outro are `canvas` screens (their tap dim covers the window), so their text is
	// pinned to the window centre rather than placed in the main box.
	const centred = (id: string, label: string, dy: number, params: Record<string, unknown>) =>
		instance(id, label, 'textBox', { screenAnchor: { x: 0.5, y: 0.5 }, x: 0, y: dy }, params);

	const messageHost = instance(
		'message-host',
		'Messages (engine toasts)',
		'infoBar',
		place({ dx: 0, dy: 235 }, { dx: 0, dy: 340 }),
	);

	const featureScenes: Scene[] = [
		{
			id: 'jackpotBar',
			name: 'Jackpot bar',
			nodes: [
				instance(
					'jackpot-bar',
					'Jackpot bar',
					'jackpotBar',
					place({ dx: 0, dy: -330 }, { dx: 0, dy: -400, scale: 0.75 }),
				),
			],
		},
		{
			id: 'pots',
			name: 'Pots',
			nodes: POT_METERS.map((meter, index) =>
				instance(
					`pot-${meter}`,
					`Pot (${meter})`,
					'potMeter',
					place({ dx: (index - 1) * 160, dy: -235 }, { dx: (index - 1) * 160, dy: -300 }),
					{ meter },
				),
			),
		},
		modeScene({
			id: 'respinBackground',
			name: 'Respin background',
			space: 'background',
			nodes: [],
		}),
		modeScene({ id: 'respinBoard', name: 'Respin board', nodes: [] }),
		modeScene({
			id: 'respinCounter',
			name: 'Respin counter',
			nodes: [
				instance(
					'respin-counter',
					'Respin counter',
					'respinCounter',
					place({ dx: -470, dy: -40 }, { dx: -170, dy: -225, scale: 0.8 }),
				),
				instance(
					'respin-modifiers',
					'Active modifiers',
					'textBox',
					place({ dx: -470, dy: 40 }, { dx: 170, dy: -225 }),
					{ text: '', source: 'activeModifiers', fontSize: 22 },
				),
			],
		}),
		modeScene({
			id: 'totalWinBar',
			name: 'Total win bar',
			nodes: [
				instance(
					'total-win-bar',
					'Total win bar',
					'totalWinBar',
					place({ dx: 490, dy: 0 }, { dx: 0, dy: 250, scale: 0.85 }),
				),
			],
		}),
		modeScene({
			id: 'letters',
			name: 'Letters',
			nodes: [
				instance(
					'letters-strip',
					'Letters',
					'lettersStrip',
					place({ dx: 0, dy: -235 }, { dx: 0, dy: -300 }),
					{ spacing: board.cellSize },
				),
			],
		}),
	];

	const beatScenes: Scene[] = [
		{
			id: 'luckySpin',
			name: 'Lucky Spin intro',
			visibleSource: 'luckySpinShow',
			nodes: [
				instance('lucky-spin-title', 'Lucky Spin', 'textBox', place({ dx: 0, dy: 0 }), {
					...HEADLINE('LUCKY SPIN'),
					source: 'holdAndWinBanner',
				}),
			],
		},
		modeScene({
			id: 'wheel',
			name: 'Wheel',
			nodes: [
				instance('wheel', 'Wheel', 'wheel', place({ dx: 0, dy: 0 }, { dx: 0, dy: 0, scale: 0.9 })),
			],
		}),
		modeScene({
			id: 'featureIntro',
			name: 'Feature intro',
			space: 'canvas',
			alwaysOnTop: true,
			nodes: [
				tap('feature-intro-tap'),
				centred('feature-intro-title', 'Title', -60, HEADLINE('HOLD AND WIN')),
				centred('feature-intro-respins', 'Respins', 40, {
					text: '3',
					source: 'respinsLeft',
					fontSize: 56,
				}),
				centred('feature-intro-modifiers', 'Active modifiers', 110, {
					text: '',
					source: 'activeModifiers',
					fontSize: 28,
				}),
			],
		}),
		modeScene({
			id: 'jackpotWin',
			name: 'Jackpot win',
			alwaysOnTop: true,
			visibleSource: 'jackpotWinShow',
			nodes: [
				instance('jackpot-win-title', 'Jackpot', 'textBox', place({ dx: 0, dy: -40 }), {
					...HEADLINE('GRAND JACKPOT'),
					source: 'holdAndWinBanner',
				}),
				instance('jackpot-win-amount', 'Amount', 'textBox', place({ dx: 0, dy: 50 }), {
					text: '',
					source: 'holdAndWinBannerDetail',
					fontSize: 48,
				}),
			],
		}),
		modeScene({
			id: 'featureOutro',
			name: 'Feature outro',
			space: 'canvas',
			alwaysOnTop: true,
			nodes: [
				tap('feature-outro-tap'),
				centred('feature-outro-title', 'Title', -60, HEADLINE('TOTAL WIN')),
				centred('feature-outro-total', 'Total', 40, {
					text: '',
					source: 'featureTotal',
					fontSize: 64,
				}),
			],
		}),
	];

	const scenes: Scene[] = [];
	for (const scene of skeleton.scenes) {
		if (FREE_SPIN_SCENES.has(scene.id)) continue;
		if (scene.id === 'basegame') {
			scenes.push({ ...scene, nodes: [...scene.nodes, messageHost] }, ...featureScenes);
		} else if (scene.id === 'basegameOverlays') {
			scenes.push(scene, ...beatScenes);
		} else {
			scenes.push(scene);
		}
	}
	return { ...skeleton, scenes };
}
