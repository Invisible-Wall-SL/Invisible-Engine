import type { LayoutDoc, LayoutType, NodeOverride } from '../types';
import { hudScenes } from './hud';

/**
 * Minimal "engine-skeleton" reference layout shared by the reel/tumble game kinds
 * (`ways`, `cluster`, `scatter`) — see `docs/design/invisible-editor.md` §19.8.
 *
 * Unlike `lines.ts` / `bookof.ts`, these kinds DON'T ship a filled `import` (they
 * are not in `REFERENCE_LAYOUTS`); they exist only so the editor's "New game from
 * kind" picker can scaffold them. The picker runs the scaffold projection
 * (`engineOwnedOnly`), which DROPS plain artist `sprite`/`spine`/`text` and keeps
 * only the engine pieces — so a skeleton needs just the correct screens + the reel
 * grid + the coded-overlay bind anchors + the HUD. We OMIT the board-frame sprites
 * (artist art the scaffold drops, and whose geometry differs per game) to stay lean.
 *
 * All three games mount the identical engine set (verified in each
 * `apps/<kind>/src/components/Game.svelte`): `Background`, `LoadingScreen`,
 * `Win`, `Transition`, `FreeSpinIntro`, `FreeSpinCounter`, `FreeSpinOutro`. The
 * only per-kind variation is the board shape, so the skeleton is parameterised on
 * the reel grid (`reels`/`rows`/`cellSize`, derived from each game's
 * `constants.ts`).
 *
 * Editor-only + parity-safe: nothing here is consumed by a game runtime.
 */

const MAIN_SIZES_MAP: LayoutDoc['mainSizesMap'] = {
	desktop: { width: 1422, height: 800 },
	tablet: { width: 1000, height: 1000 },
	landscape: { width: 1600, height: 900 },
	portrait: { width: 800, height: 1422 },
};

const ANCHOR_CENTER = { x: 0.5, y: 0.5 };

const boardCentre = (size: { width: number; height: number }) => ({
	x: size.width * 0.5,
	y: size.height * 0.5,
});

const reelGridOverrides: Partial<Record<LayoutType, NodeOverride>> = {
	tablet: boardCentre(MAIN_SIZES_MAP.tablet),
	landscape: boardCentre(MAIN_SIZES_MAP.landscape),
	portrait: boardCentre(MAIN_SIZES_MAP.portrait),
};

/** The board shape a kind's reel grid is scaffolded with (its `constants.ts`). */
export interface EngineSkeletonBoard {
	/** `BOARD_DIMENSIONS.x` (columns). */
	reels: number;
	/** `BOARD_DIMENSIONS.y` (visible rows). */
	rows: number;
	/** `SYMBOL_SIZE` (square cell pitch, px). */
	cellSize: number;
	/** `REEL_PADDING` (horizontal symbol-centre inset). */
	reelPadding?: number;
}

export interface EngineSkeletonOptions {
	gameType: string;
	projectKey: string;
	board: EngineSkeletonBoard;
}

/**
 * Build the engine-skeleton `LayoutDoc` for a reel/tumble kind. The screen list
 * mirrors `bookof.ts` (loading → background → basegame(reelGrid) → basegameOverlays
 * → free-spins → HUD); the reel grid is centred in each layoutType's main box,
 * anchored centre.
 */
export function engineSkeletonLayout({
	gameType,
	projectKey,
	board,
}: EngineSkeletonOptions): LayoutDoc {
	const centre = boardCentre(MAIN_SIZES_MAP.desktop);
	return {
		version: 1,
		projectKey,
		gameType,
		mainSizesMap: MAIN_SIZES_MAP,
		scenes: [
			{
				// Startup splash: the `loader` spine (logo + progress). Bind anchor —
				// the editor previews it from the catalog; the game mounts its coded
				// LoadingScreen regardless (not registered → ignored in-game).
				id: 'loading',
				name: 'Loading / logo',
				space: 'canvas',
				nodes: [
					{
						id: 'loading-screen',
						slotId: 'loadingScreen',
						label: 'Loading screen (logo)',
						kind: 'container',
						x: 0,
						y: 0,
						bind: { component: 'LoadingScreen' },
						children: [],
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
				name: 'Base game',
				nodes: [
					// The reel grid — the game's board params (`BOARD_DIMENSIONS` /
					// `SYMBOL_SIZE` / `REEL_PADDING`). Centred in the main box, anchored
					// centre. The board-frame art is intentionally omitted (artist art the
					// scaffold drops; the frame geometry differs per game).
					{
						id: 'reel-grid',
						label: 'Reel grid',
						kind: 'reelGrid',
						reels: board.reels,
						rows: board.rows,
						cellSize: board.cellSize,
						reelPadding: board.reelPadding,
						anchor: ANCHOR_CENTER,
						x: centre.x,
						y: centre.y,
						zIndex: 1,
						overrides: reelGridOverrides,
					},
				],
			},
			{
				id: 'basegameOverlays',
				name: 'Base game overlays',
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
			{
				id: 'freeSpinIntro',
				name: 'Free-spin intro',
				space: 'canvas',
				nodes: [
					{
						id: 'fs-intro',
						slotId: 'freeSpinIntro',
						label: 'Free-spin intro',
						kind: 'container',
						x: 0,
						y: 0,
						// Props reproduce the original hardcodes so the STANDALONE intro renders
						// unchanged. This is the standalone, board-centred free-spin intro overlay
						// (it self-centres via `FreeSpinAnimation`'s own `<MainContainer>`) and owns
						// the free-spin intro; the props pick its spine/animations/slot.
						bind: {
							component: 'FreeSpinIntro',
							props: {
								introSpine: 'fsIntroNumber',
								introAnimation: 'intro',
								idleAnimation: 'idle',
								slotName: 'slot_number',
							},
						},
						children: [],
					},
				],
			},
			{
				id: 'freeSpinCounter',
				name: 'Free-spin counter',
				space: 'canvas',
				nodes: [
					{
						id: 'fs-counter',
						slotId: 'freeSpinCounter',
						label: 'Free-spin counter',
						kind: 'container',
						x: 0,
						y: 0,
						bind: { component: 'FreeSpinCounter' },
						children: [],
					},
				],
			},
			{
				id: 'freeSpinOutro',
				name: 'Free-spin outro',
				space: 'canvas',
				nodes: [
					{
						id: 'fs-outro',
						slotId: 'freeSpinOutro',
						label: 'Free-spin outro',
						kind: 'container',
						x: 0,
						y: 0,
						bind: { component: 'FreeSpinOutro' },
						children: [],
					},
				],
			},
			// HUD layer (logo/name corners + bottom bar) — universal across game types.
			// Coded `bind` labels (no `readouts`): these kinds don't register the
			// `hudReadout` def, so the parity-safe default keeps them as `UiLabel*` binds.
			...hudScenes(),
		],
		updatedAt: '2026-05-30T00:00:00.000Z',
	};
}
