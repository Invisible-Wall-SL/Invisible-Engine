import type { GameTemplate } from '../types';

/**
 * The `lines` game-type template: the scenes it has and the named slots an
 * author may fill (see `docs/design/invisible-editor.md` §7.1). This is the
 * *schema* — a game's `defaultLayout()` fills it with current values, the editor
 * surfaces the slots as drop targets, and the launcher seeds/validates against
 * it. It is the built-in **fallback**; an R2 `editor/templates/lines.json` (§7.5)
 * overrides it when present.
 *
 * Slot kinds:
 *   - `sprite`/`spine`/`text` — artist-owned static scenery (author owns the
 *     transform).
 *   - `mount` — engine-owned: the editor places only an anchor whose
 *     `bind.component` is `mountComponent`; the game fills it at runtime via
 *     `registerBoundComponents`. `reelGrid` is the board the engine fills from
 *     `boardLayout()` + symbols — the editor only anchors it.
 */
export const linesTemplate: GameTemplate = {
	gameType: 'lines',
	version: 1,
	scenes: [
		{
			id: 'basegame',
			name: 'Base game',
			slots: [
				{ slotId: 'boardFrame', name: 'Board frame', kind: 'sprite', required: true },
				{ slotId: 'boardFrameEdge', name: 'Board frame edge', kind: 'sprite', required: true },
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
	],
};
