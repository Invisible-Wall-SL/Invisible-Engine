import type { GameTemplate } from '../types';

/**
 * Built-in `bookOf` game-type template (Book of Borut family). Mirrors the
 * current Borut basegame (board frame + coded Win/Transition overlays) and adds
 * the defining book-of `freegame` screen. Built-in **fallback** — an authored
 * R2 `editor/templates/bookof.json` (§7.5) overrides it.
 *
 * `reelGrid` is declared (so the editor can anchor it) but not `required`: the
 * board still renders from the game's coded board, not a placed node.
 */
export const bookofTemplate: GameTemplate = {
	gameType: 'bookOf',
	version: 1,
	board: { reels: 5, rows: 3, cellSize: 120 },
	// The full screen set the game actually has, in lifecycle/z order. Mount slots
	// are NOT `required` — the game still renders these from coded components, so a
	// `defaultLayout`/seed drops only an anchor (the editor previews it from the
	// shared catalog). The HUD (bottom bar + corners) is a universal layer appended
	// at doc-gen time via `hudScenes()`, so it isn't enumerated here.
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
		{
			id: 'basegame',
			name: 'Base game',
			slots: [
				{ slotId: 'boardFrame', name: 'Board frame', kind: 'sprite', required: true },
				{ slotId: 'boardFrameEdge', name: 'Board frame edge', kind: 'sprite', required: true },
				{ slotId: 'reelGrid', name: 'Reel grid', kind: 'mount', mountComponent: 'ReelGrid' },
			],
		},
		{
			id: 'freegame',
			name: 'Free game',
			slots: [
				{ slotId: 'background', name: 'Free-game background', kind: 'sprite' },
				{ slotId: 'boardFrame', name: 'Board frame', kind: 'sprite' },
				{ slotId: 'reelGrid', name: 'Reel grid', kind: 'mount', mountComponent: 'ReelGrid' },
			],
		},
		{
			id: 'basegameOverlays',
			name: 'Base game overlays',
			slots: [
				{ slotId: 'Win', name: 'Win overlay', kind: 'mount', mountComponent: 'Win' },
				{
					slotId: 'Transition',
					name: 'Transition overlay',
					kind: 'mount',
					mountComponent: 'Transition',
				},
			],
		},
		{
			id: 'freeSpinIntro',
			name: 'Free-spin intro',
			slots: [
				{
					slotId: 'freeSpinIntro',
					name: 'Free-spin intro',
					kind: 'mount',
					mountComponent: 'FreeSpinIntro',
				},
			],
		},
		{
			id: 'freeSpinCounter',
			name: 'Free-spin counter',
			slots: [
				{
					slotId: 'freeSpinCounter',
					name: 'Free-spin counter',
					kind: 'mount',
					mountComponent: 'FreeSpinCounter',
				},
			],
		},
		{
			id: 'freeSpinOutro',
			name: 'Free-spin outro',
			slots: [
				{
					slotId: 'freeSpinOutro',
					name: 'Free-spin outro',
					kind: 'mount',
					mountComponent: 'FreeSpinOutro',
				},
			],
		},
	],
};
