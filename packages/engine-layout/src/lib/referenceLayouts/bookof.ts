import type { LayoutDoc, LayoutType, NodeOverride } from '../types';

/**
 * Placed reference layout for the Book of Borut family (`bookOf`) — the
 * engine-truth "import" of the game's current static layout, so the editor's
 * "Load a game scene" picker can open it already laid out. Kept in lock-step
 * with the game's own generator (`Book of Borut/src/game/defaultLayout.ts`).
 *
 * Currently covers the board frame (`frame_bg.png` + `frame_edge.png` — frames
 * in the game's `reelsFrame` atlas) + the coded `Win`/`Transition` mount
 * anchors. Background / FS counter / loading / intro are migrated in later
 * passes and will be added here as they land.
 *
 * Rendering note: the editor only draws these sprites if the active project's
 * R2 holds the matching atlas frames; otherwise they show as correctly-PLACED
 * placeholders. Load it into the Borut project (whose atlas is synced).
 */
const MAIN_SIZES_MAP: LayoutDoc['mainSizesMap'] = {
	desktop: { width: 1422, height: 800 },
	tablet: { width: 1000, height: 1000 },
	landscape: { width: 1600, height: 900 },
	portrait: { width: 800, height: 1422 },
};

const POSITION_ADJUSTMENT = 1.01;
const FRAME_WIDTH = 750;
const FRAME_HEIGHT = 432;
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

export function bookofReferenceLayout(): LayoutDoc {
	const centre = frameCentre(MAIN_SIZES_MAP.desktop);
	return {
		version: 1,
		projectKey: 'borut',
		gameType: 'bookOf',
		mainSizesMap: MAIN_SIZES_MAP,
		scenes: [
			{
				// Mirrors the game's generator (Book of Borut/src/game/defaultLayout.ts).
				// Bind anchors (background, FS counter, intro, outro) show as
				// positionable anchors in the editor; their art renders in-game.
				id: 'background',
				name: 'Background',
				nodes: [
					{ id: 'bg', label: 'Background', kind: 'container', x: 0, y: 0, zIndex: -10, bind: { component: 'Background' }, children: [] },
				],
			},
			{
				id: 'basegame',
				name: 'Base game',
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
				],
			},
			{
				id: 'basegameOverlays',
				name: 'Base game overlays',
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
			{
				id: 'freeSpinCounter',
				name: 'Free-spin counter',
				nodes: [
					{ id: 'fs-counter', label: 'Free-spin counter', kind: 'container', x: 0, y: 0, bind: { component: 'FreeSpinCounter' }, children: [] },
				],
			},
			{
				id: 'freeSpinIntro',
				name: 'Free-spin intro',
				nodes: [
					{ id: 'fs-intro', label: 'Free-spin intro', kind: 'container', x: 0, y: 0, bind: { component: 'FreeSpinIntro' }, children: [] },
				],
			},
			{
				id: 'freeSpinOutro',
				name: 'Free-spin outro',
				nodes: [
					{ id: 'fs-outro', label: 'Free-spin outro', kind: 'container', x: 0, y: 0, bind: { component: 'FreeSpinOutro' }, children: [] },
				],
			},
		],
		updatedAt: '2026-05-30T00:00:00.000Z',
	};
}
