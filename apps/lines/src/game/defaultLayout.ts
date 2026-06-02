import type { LayoutDoc, LayoutType, NodeOverride } from 'engine-layout';

import { linesTemplate } from './template';

/**
 * Template-shaped generator for the `lines` LayoutDoc — the engine-truth
 * "import" of the current hand-coded basegame (see
 * `docs/design/invisible-editor.md` §7.2). It derives the board-frame placement
 * from `mainSizesMap` + the `BoardFrame.svelte` constants rather than baking
 * magic literals, then tags each node with the `template` slot it fills. The
 * result is byte-for-byte the layout the game rendered before, now produced
 * from the template instead of a hand-written fixture, so it both proves the
 * model and serves as the offline fallback (`editor-scenes.ts`).
 *
 * `BoardFrame.svelte` places the frame sprites at the resolved
 * `stateGameDerived.boardLayout()` centre — `mainSizes * 0.5` — nudged by
 * `POSITION_ADJUSTMENT`, and scales `boardLayout().width` (= SYMBOL_SIZE 120 ×
 * 5 reels = 600) by `SPRITE_SCALE` for a constant frame size across layouts.
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
		],
		updatedAt: '2026-05-30T00:00:00.000Z',
	};
}
