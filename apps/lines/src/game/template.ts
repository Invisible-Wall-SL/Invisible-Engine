import type { GameTemplate } from 'engine-layout';

/**
 * The `lines` game-type template: the scenes it has and the named slots an
 * author may fill (see `docs/design/invisible-editor.md` §7.1). This is the
 * *schema* — `defaultLayout()` fills it with the game's current values, and the
 * editor surfaces the slots as drop targets.
 *
 * Slot kinds:
 *   - `sprite`/`spine`/`text` — artist-owned static scenery (the author owns
 *     the transform).
 *   - `mount` — engine-owned: the editor places only an anchor whose
 *     `bind.component` is `mountComponent`; the game fills it at runtime via
 *     `registerBoundComponents` (see `Game.svelte`). `reelGrid` is the board the
 *     engine fills from `boardLayout()` + symbols — the editor only anchors it.
 *
 * `required` is consumed by save-time validation, which lives launcher-side and
 * is not wired yet (§7.1) — the flags document the contract today.
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
					slotId: 'reelGrid',
					name: 'Reel grid',
					kind: 'mount',
					required: true,
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
