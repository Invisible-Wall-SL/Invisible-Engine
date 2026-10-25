import { TAP_DIM_ALPHA_PARAM, TAP_TO_CONTINUE_PARAM } from '../tapToContinue';
import type { LayoutDoc, LayoutNode, LayoutType, NodeOverride, Scene } from '../types';
import { hudScenes } from './hud';

/**
 * The MATCH-3 scene set (`docs/design/game-families.md` §5.1, P10.5) — what "New game from kind"
 * scaffolds for a match-3 project, and what puts `match3` in Game Maker's kind list.
 *
 * Engine pieces only, like the reel-kind skeleton (`engineSkeleton.ts`): the scaffold keeps
 * engine-owned nodes (`engineOwnedOnly`), so every node here is a bind, the reel grid or a component
 * instance. The board is the slot board that never spins: a `reelGrid` the shared runtime fills and
 * the match-3 input surface sits on. The screens are the ones the starter flow shows
 * (`engine-flow-v2` `MATCH3_SCREENS`):
 *
 *   - `loading` — the loading bar; its tap completes the screen and starts the game;
 *   - `background` — the coded background;
 *   - `basegame` — the board;
 *   - `match3Hud` — Score, Moves and Target, each a Text Box fed by the starter flow's variable
 *     (`var:<id>`), so it reads a plain number, never a currency;
 *   - `roundWon` / `roundLost` — a dimmed tap-to-continue with its line of text; the flow holds the
 *     round on the tap and then deals a new board.
 *
 * There is no slot HUD (spin, bet, balance): a rules-decided game has no wallet (§2.3).
 *
 * The RGS-decided game (P10.6) has its own set, {@link match3RgsReferenceLayout}.
 */

const MAIN_SIZES_MAP: LayoutDoc['mainSizesMap'] = {
	desktop: { width: 1422, height: 800 },
	tablet: { width: 1000, height: 1000 },
	landscape: { width: 1600, height: 900 },
	portrait: { width: 800, height: 1422 },
};

/** The board a match-3 project is scaffolded with: the seed config's 7 × 7 grid. */
export const MATCH3_BOARD = { reels: 7, rows: 7, cellSize: 96 } as const;

const centre = (size: { width: number; height: number }) => ({
	x: size.width * 0.5,
	y: size.height * 0.5,
});

const reelGridOverrides: Partial<Record<LayoutType, NodeOverride>> = {
	tablet: centre(MAIN_SIZES_MAP.tablet),
	landscape: centre(MAIN_SIZES_MAP.landscape),
	portrait: centre(MAIN_SIZES_MAP.portrait),
};

const textBox = (
	id: string,
	label: string,
	x: number,
	y: number,
	params: Record<string, unknown>,
): LayoutNode => ({
	id,
	label,
	kind: 'componentInstance',
	componentId: 'textBox',
	x,
	y,
	params,
});

/** One HUD readout: its caption, and its value fed by the starter flow's variable. */
const readout = (key: string, caption: string, y: number): LayoutNode[] => [
	textBox(`m3-${key}-caption`, `${caption} caption`, 150, y, { text: caption, fontSize: 30 }),
	textBox(`m3-${key}-value`, caption, 150, y + 42, {
		text: '0',
		source: `var:${key}`,
		fontSize: 48,
	}),
];

/** A round-over screen: the dim that takes the tap, and its line of text. */
const roundOver = (id: string, name: string, line: string): Scene => ({
	id,
	name,
	space: 'canvas',
	alwaysOnTop: true,
	nodes: [
		{
			id: `${id}-tap`,
			label: 'Tap to continue',
			kind: 'componentInstance',
			componentId: 'tapToContinue',
			x: 0,
			y: 0,
			params: { [TAP_TO_CONTINUE_PARAM]: true, [TAP_DIM_ALPHA_PARAM]: 0.6 },
		},
		{
			...textBox(`${id}-text`, 'Message', 0, 0, {
				text: line,
				fontSize: 64,
				boxWidth: 1000,
				align: 'center',
			}),
			screenAnchor: { x: 0.5, y: 0.5 },
		},
	],
});

/** The screens both match-3 sets share: the loading bar, the background and the 7 × 7 board. */
function boardScenes(): Scene[] {
	const board = centre(MAIN_SIZES_MAP.desktop);
	return [
		{
			id: 'loading',
			name: 'Loading / logo',
			role: 'loading',
			space: 'canvas',
			nodes: [
				{
					id: 'loading-bar',
					slotId: 'loadingScreen',
					label: 'Loading bar',
					kind: 'componentInstance',
					componentId: 'loadingBar',
					x: 0,
					y: 0,
				},
			],
		},
		{
			id: 'background',
			name: 'Background',
			space: 'canvas',
			nodes: [
				{
					id: 'bg',
					slotId: 'background',
					label: 'Background',
					kind: 'container',
					x: 0,
					y: 0,
					zIndex: -10,
					bind: { component: 'Background' },
					children: [],
				},
			],
		},
		{
			id: 'basegame',
			name: 'Board',
			role: 'basegame',
			nodes: [
				{
					id: 'reel-grid',
					label: 'Board',
					kind: 'reelGrid',
					reels: MATCH3_BOARD.reels,
					rows: MATCH3_BOARD.rows,
					cellSize: MATCH3_BOARD.cellSize,
					anchor: { x: 0.5, y: 0.5 },
					x: board.x,
					y: board.y,
					zIndex: 1,
					overrides: reelGridOverrides,
				},
			],
		},
	];
}

export function match3ReferenceLayout(): LayoutDoc {
	return {
		version: 1,
		projectKey: 'match3',
		gameType: 'match3',
		mainSizesMap: MAIN_SIZES_MAP,
		scenes: [
			...boardScenes(),
			{
				id: 'match3Hud',
				name: 'Score and moves',
				nodes: [
					...readout('score', 'SCORE', 200),
					...readout('movesLeft', 'MOVES', 360),
					...readout('target', 'TARGET', 520),
				],
			},
			roundOver('roundWon', 'Round won', 'GOAL REACHED! Tap to play again'),
			roundOver('roundLost', 'Round lost', 'OUT OF MOVES. Tap to try again'),
		],
		updatedAt: '2026-10-24T00:00:00.000Z',
	};
}

/**
 * The RGS-DECIDED match-3 scene set (`docs/design/game-families.md` P10.6): the server deals every
 * board and prices every win, so the game has a wallet and the slot HUD. The screens are the ones
 * its starter flow shows (`engine-flow-v2` `MATCH3_RGS_SCREENS`):
 *
 *   - `loading`, `background`, `basegame` — as the rules set's;
 *   - `match3Hud` — one readout, MOVES, a Text Box fed `var:movesLeft` (no score, no target: the win
 *     is money, shown on the HUD's win label);
 *   - `hudBar` / `hudCorners` — the standard slot HUD ({@link hudScenes}): balance, win and bet, and
 *     the spin, menu and bet buttons. Spin places the bet that opens a round.
 *
 * No round-over screens: a round ends when the server says so, and the win is the HUD's.
 */
export function match3RgsReferenceLayout(): LayoutDoc {
	return {
		version: 1,
		projectKey: 'match3',
		gameType: 'match3',
		mainSizesMap: MAIN_SIZES_MAP,
		scenes: [
			...boardScenes(),
			{
				id: 'match3Hud',
				name: 'Moves',
				nodes: readout('movesLeft', 'MOVES', 360),
			},
			...hudScenes(),
		],
		updatedAt: '2026-10-25T00:00:00.000Z',
	};
}
