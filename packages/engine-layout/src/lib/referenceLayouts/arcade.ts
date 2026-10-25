import { TAP_DIM_ALPHA_PARAM, TAP_TO_CONTINUE_PARAM } from '../tapToContinue';
import type { ComponentDef, LayoutDoc, LayoutNode, Scene } from '../types';

/**
 * The ARCADE scene set (`docs/design/game-families.md` §5.1, P10.8) — what "New game from kind"
 * scaffolds for an arcade project, and what puts `arcade` in Game Maker's kind list. It is also the
 * catcher / dodger sample (§9 #6): its starter flow (`engine-flow-v2` `ARCADE_DRIVEN_SEED_DOC`) plays
 * on these screens with the {@link ARCADE_SAMPLE_COMPONENTS}.
 *
 * Engine pieces only, like the match-3 set: binds, component instances and the spawn layer, all of
 * which the scaffold keeps (`engineOwnedOnly`). The screens are the ones the starter flow shows
 * (`ARCADE_SCREENS`):
 *
 *   - `loading` — the loading bar; its tap completes the screen and starts the game;
 *   - `background` — the coded background;
 *   - `basegame` — the play field: the spawn layer `field` at the screen's origin, which the arcade
 *     loop moves (its space is the field's: 0, 0 top-left, the config's `arcade.field` in size);
 *   - `arcadeHud` — Score and Lives, each a Text Box fed by the starter flow's variable;
 *   - `roundOver` — a dimmed tap-to-continue with its line; the flow holds the round on the tap.
 *
 * There is no reel grid and no slot HUD: an arcade game has no board and no wallet (§2.3).
 */

const MAIN_SIZES_MAP: LayoutDoc['mainSizesMap'] = {
	desktop: { width: 1422, height: 800 },
	tablet: { width: 1000, height: 1000 },
	landscape: { width: 1600, height: 900 },
	portrait: { width: 800, height: 1422 },
};

/** The sample's spawn layer: its id, what it may spawn and how many at once. */
export const ARCADE_FIELD = {
	id: 'field',
	cap: 48,
} as const;

/**
 * A placeholder body: a flat shape centred on the instance's origin, as a body's `x` / `y` is its
 * centre. `round` draws it as a disc. The owner swaps these for the Salmons art (S0).
 */
const placeholder = (
	id: string,
	name: string,
	w: number,
	h: number,
	color: number,
	round = false,
): ComponentDef => ({
	id,
	name,
	version: 1,
	scope: 'project',
	category: 'ui',
	params: [],
	root: {
		id: `${id}-root`,
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: `${id}-shape`,
				kind: 'rect',
				x: -w / 2,
				y: -h / 2,
				width: w,
				height: h,
				color,
				...(round ? { borderRadius: Math.min(w, h) / 2 } : {}),
			},
		],
	},
});

/**
 * The sample's spawnable components, written into a new arcade project as its own components (a
 * scaffold write, create-only). Sizes match the bodies the seed config gives them.
 */
export const ARCADE_SAMPLE_COMPONENTS: readonly ComponentDef[] = [
	placeholder('arcadeSalmon', 'Salmon (placeholder)', 90, 44, 0xfa8072),
	placeholder('arcadeBear', 'Bear (placeholder)', 92, 92, 0x6b4423, true),
	placeholder('arcadeHook', 'Hook (placeholder)', 24, 70, 0xb0b8c0),
	placeholder('arcadeFish', 'Fish (placeholder)', 44, 44, 0xffd166, true),
];

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
const readout = (key: string, caption: string, x: number): LayoutNode[] => [
	textBox(`ar-${key}-caption`, `${caption} caption`, x, 40, { text: caption, fontSize: 28 }),
	textBox(`ar-${key}-value`, caption, x, 78, { text: '0', source: `var:${key}`, fontSize: 44 }),
];

export function arcadeReferenceLayout(): LayoutDoc {
	return {
		version: 1,
		projectKey: 'arcade',
		gameType: 'arcade',
		mainSizesMap: MAIN_SIZES_MAP,
		scenes: [
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
				name: 'Play field',
				role: 'basegame',
				nodes: [
					{
						id: ARCADE_FIELD.id,
						label: 'Play field',
						kind: 'spawnLayer',
						x: 0,
						y: 0,
						spawnable: ARCADE_SAMPLE_COMPONENTS.map((def) => def.id),
						placement: 'free',
						cap: ARCADE_FIELD.cap,
					},
				],
			},
			{
				id: 'arcadeHud',
				name: 'Score and lives',
				nodes: [...readout('score', 'SCORE', 60), ...readout('lives', 'LIVES', 1222)],
			},
			roundOver(),
		],
		updatedAt: '2026-10-25T00:00:00.000Z',
	};
}

function roundOver(): Scene {
	return {
		id: 'roundOver',
		name: 'Round over',
		space: 'canvas',
		alwaysOnTop: true,
		nodes: [
			{
				id: 'roundOver-tap',
				label: 'Tap to continue',
				kind: 'componentInstance',
				componentId: 'tapToContinue',
				x: 0,
				y: 0,
				params: { [TAP_TO_CONTINUE_PARAM]: true, [TAP_DIM_ALPHA_PARAM]: 0.6 },
			},
			{
				...textBox('roundOver-text', 'Message', 0, 0, {
					text: 'CAUGHT! Tap to swim again',
					fontSize: 64,
					boxWidth: 1000,
					align: 'center',
				}),
				screenAnchor: { x: 0.5, y: 0.5 },
			},
		],
	};
}
