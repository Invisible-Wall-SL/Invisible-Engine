import type { GameTemplate } from '../types';

/**
 * The STANDARD reel-game template: the scenes a game built on the shared runtime has, and the
 * named slots an author may fill (see `docs/design/invisible-editor.md` §7.1). This is the
 * *schema* — a game's `defaultLayout()` fills it with current values, the editor surfaces the
 * slots as drop targets, and the launcher seeds/validates against it. It is the built-in
 * **fallback**; an R2 `editor/templates/<gameType>.json` (§7.5) overrides it when present.
 *
 * Parameterised by `gameType` because the screen set is a property of the RUNTIME, not of how a
 * game PAYS: `lines` and `ways` run the identical `_runtime/lines` bundle and mount the identical
 * components, so they differ only in the win model their Game Config declares — which this schema
 * says nothing about. Keeping a per-type copy of the scene list would only let the copies drift.
 * A type whose SCREENS genuinely differ (`bookOf`, which adds a `freegame` screen) declares its
 * own template instead of calling this.
 *
 * Slot kinds:
 *   - `sprite`/`spine`/`text` — artist-owned static scenery (author owns the
 *     transform).
 *   - `mount` — engine-owned: the editor places only an anchor whose
 *     `bind.component` is `mountComponent`; the game fills it at runtime via
 *     `registerBoundComponents`. `reelGrid` is the board the engine fills from
 *     `boardLayout()` + symbols — the editor only anchors it.
 *
 * Returns a FRESH object per call, so one type's template can never be mutated through another's.
 */
export const standardTemplate = (gameType: string): GameTemplate => ({
	gameType,
	version: 1,
	board: { reels: 5, rows: 3, cellSize: 120 },
	// The full screen set the game has, in lifecycle/z order. Mount slots are not
	// `required` (the game renders these from coded components; the editor only
	// anchors + previews them). The HUD is a universal layer appended via
	// `hudScenes()`, so it isn't enumerated here.
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
			// The free-spin reel-house glow — drawn BEHIND the reels (between the background and
			// the board), which is why it sits here in z order. Engine-owned by default: the coded
			// `BoardFrame` sizes itself off `boardLayout()` and plays its own start→idle→exit chain
			// off the `boardFrameGlowShow`/`boardFrameGlowHide` signals, so the editor only anchors
			// it. Put REAL art in this scene — e.g. a spine component whose cues ride the
			// `boardGlowShow`/`boardGlowHide` signals — and the coded glow steps aside entirely
			// (`hasAuthoredBoardGlow`), so a game can author its own free-spin backdrop.
			id: 'boardGlow',
			name: 'Board glow (free spins)',
			slots: [
				{ slotId: 'boardGlow', name: 'Board glow', kind: 'mount', mountComponent: 'BoardFrame' },
			],
		},
		{
			id: 'basegame',
			name: 'Base game',
			slots: [
				// Graphical (sprite) slots are advisory drop targets, never `required` —
				// authors may replace them with free nodes; an unfilled slot renders nothing.
				{ slotId: 'boardFrame', name: 'Board frame', kind: 'sprite' },
				{ slotId: 'boardFrameEdge', name: 'Board frame edge', kind: 'sprite' },
				{
					// Declared so the editor can anchor it, but not yet `required`: the
					// board still renders from coded `Board.svelte`, so `defaultLayout`
					// places no `reelGrid` node. Flip to `required` once the board is
					// migrated to a `mount` placed via `<LayoutScene>`.
					slotId: 'reelGrid',
					name: 'Reel grid',
					kind: 'mount',
					mountComponent: 'ReelGrid',
				},
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
					// VISUAL only — the full-screen press-to-continue GATE is engine-owned
					// (always mounted in `Game.svelte`). Seeding the gate-bundling composer
					// (`FreeSpinIntro`) here would mount a SECOND gate in an authored doc and
					// hang the round (two `waitForResolve` subscribers).
					mountComponent: 'FreeSpinIntroVisual',
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
					// VISUAL only — the GATE is engine-owned (see the intro slot above).
					mountComponent: 'FreeSpinOutroVisual',
				},
			],
		},
	],
});
