import { linesTemplate } from '../templates/lines';
import type { LayoutDoc, LayoutType, NodeOverride } from '../types';
import { hudScenes } from './hud';

/**
 * Template-shaped generator for the `lines` LayoutDoc — the engine-truth
 * "import" of the current hand-coded basegame (see
 * `docs/design/invisible-editor.md` §7.2). It derives the board-frame placement
 * from `mainSizesMap` + the `BoardFrame.svelte` constants rather than baking
 * magic literals, then tags each node with the `template` slot it fills. The
 * result is the layout the game renders, produced from the template instead of a
 * hand-written fixture — so it both proves the model and serves as the offline
 * fallback (`apps/lines/src/editor-scenes.ts`).
 *
 * Lives in `engine-layout` (not the game) so BOTH the game's `editor-scenes.ts`
 * fallback AND the launcher editor's "Load game scene" picker can produce it
 * without a cross-app import.
 */
const MAIN_SIZES_MAP: LayoutDoc['mainSizesMap'] = {
	desktop: { width: 1422, height: 800 },
	tablet: { width: 1000, height: 1000 },
	landscape: { width: 1600, height: 900 },
	portrait: { width: 800, height: 1422 },
};

const POSITION_ADJUSTMENT = 1.01; // BoardFrame.svelte: applied to boardLayout() x/y
const FRAME_WIDTH = 750; // boardLayout().width(600) * SPRITE_SCALE.width(1.25)
const FRAME_HEIGHT = 432; // boardLayout().width(600) * SPRITE_SCALE.height(0.72)
const ANCHOR_CENTER = { x: 0.5, y: 0.5 };

const frameCentre = (size: { width: number; height: number }) => ({
	x: size.width * 0.5 * POSITION_ADJUSTMENT,
	y: size.height * 0.5 * POSITION_ADJUSTMENT,
});

const frameOverrides: Partial<Record<LayoutType, NodeOverride>> = {
	tablet: frameCentre(MAIN_SIZES_MAP.tablet),
	landscape: frameCentre(MAIN_SIZES_MAP.landscape),
	portrait: frameCentre(MAIN_SIZES_MAP.portrait),
};

const sceneName = (id: string) => linesTemplate.scenes.find((scene) => scene.id === id)?.name ?? id;

export function defaultLayout(gameType: string): LayoutDoc {
	if (gameType !== 'lines') {
		throw new Error(`defaultLayout: unsupported gameType "${gameType}"`);
	}

	const centre = frameCentre(MAIN_SIZES_MAP.desktop);

	return {
		version: 1,
		projectKey: 'lines',
		gameType: 'lines',
		mainSizesMap: MAIN_SIZES_MAP,
		scenes: [
			{
				id: 'basegame',
				name: sceneName('basegame'),
				nodes: [
					{
						id: 'frame-bg',
						slotId: 'boardFrame',
						label: 'Board frame background',
						kind: 'sprite',
						assetKey: 'frame_bg.png',
						anchor: ANCHOR_CENTER,
						x: centre.x,
						y: centre.y,
						width: FRAME_WIDTH,
						height: FRAME_HEIGHT,
						overrides: frameOverrides,
					},
					{
						id: 'frame-edge',
						slotId: 'boardFrameEdge',
						label: 'Board frame edge',
						kind: 'sprite',
						assetKey: 'frame_edge.png',
						anchor: ANCHOR_CENTER,
						x: centre.x,
						y: centre.y,
						width: FRAME_WIDTH,
						height: FRAME_HEIGHT,
						overrides: frameOverrides,
					},
					{
						// Free scenery (no slot): the original layout-driven smoke label.
						id: 'editor-watermark',
						label: 'Editor smoke label',
						kind: 'text',
						text: 'LAYOUT-DRIVEN FRAME',
						anchor: ANCHOR_CENTER,
						x: centre.x,
						y: 200,
						alpha: 0.5,
						style: {
							fontFamily: 'proxima-nova',
							fontSize: 22,
							fontWeight: '600',
							fill: 0xffffff,
						},
						overrides: {
							tablet: { x: frameCentre(MAIN_SIZES_MAP.tablet).x, y: 300 },
							landscape: { x: frameCentre(MAIN_SIZES_MAP.landscape).x, y: 250 },
							portrait: { x: frameCentre(MAIN_SIZES_MAP.portrait).x, y: 500 },
						},
					},
				],
			},
			{
				id: 'basegameOverlays',
				name: sceneName('basegameOverlays'),
				// Mounted at the <App> root: its bind nodes are containers at (0,0)
				// whose bound Win/Transition render their OWN MainContainer internally.
				// `canvas` space = no wrapper, so we don't double-transform them.
				space: 'canvas',
				nodes: [
					{
						id: 'bound-win',
						slotId: 'Win',
						label: 'Win overlay (coded)',
						kind: 'container',
						x: 0,
						y: 0,
						bind: { component: 'Win' },
						children: [],
					},
					{
						id: 'bound-transition',
						slotId: 'Transition',
						label: 'Transition overlay (coded)',
						kind: 'container',
						x: 0,
						y: 0,
						bind: { component: 'Transition' },
						children: [],
					},
				],
			},
			// The HUD layer (logo/name corners + bottom bar) as editor scenes. The
			// game still renders `<UI>` from code today; these become live once the
			// HUD render path (phase 2) consumes them. Shown in the editor now so the
			// HUD is visible + positionable.
			...hudScenes(),
		],
		updatedAt: '2026-05-30T00:00:00.000Z',
	};
}
