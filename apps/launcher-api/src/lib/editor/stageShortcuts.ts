/**
 * The editor stage's keyboard map (Rive plan Phase 9a) and the cheat-sheet it shows on `Shift+/`.
 * One table drives both, so the sheet can never list a key the stage ignores. Pure — the canvas
 * reads {@link stageShortcut} in its keydown and applies the action; `check:editor-shortcuts`
 * holds the map.
 *
 * Keys with Ctrl/⌘ belong to the page (undo, clipboard, save), so only ⌘0 / Ctrl+0 is taken here.
 */

export type StageAction =
	| { kind: 'selectParent' }
	| { kind: 'selectFirstChild' }
	| { kind: 'reveal' }
	| { kind: 'fit' }
	| { kind: 'zoomTo100' }
	| { kind: 'zoomBy'; factor: number }
	| { kind: 'nudge'; dx: number; dy: number }
	| { kind: 'toggleMode' }
	| { kind: 'cheatSheet' };

export interface KeyLike {
	key: string;
	shiftKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
}

export const ZOOM_STEP = 1.25;
export const NUDGE_PX = 1;
export const NUDGE_SHIFT_PX = 10;

const ARROWS: Record<string, [number, number]> = {
	ArrowLeft: [-1, 0],
	ArrowRight: [1, 0],
	ArrowUp: [0, -1],
	ArrowDown: [0, 1],
};

/** The stage action a key press asks for, or `null` when the stage leaves it alone. */
export function stageShortcut(e: KeyLike): StageAction | null {
	const mod = e.ctrlKey || e.metaKey;
	if (mod) return !e.altKey && !e.shiftKey && e.key === '0' ? { kind: 'zoomTo100' } : null;
	if (e.altKey) return null;
	const arrow = ARROWS[e.key];
	if (arrow) {
		const step = e.shiftKey ? NUDGE_SHIFT_PX : NUDGE_PX;
		return { kind: 'nudge', dx: arrow[0] * step, dy: arrow[1] * step };
	}
	switch (e.key) {
		case 'Escape':
			return { kind: 'selectParent' };
		case 'Enter':
			return e.shiftKey ? null : { kind: 'selectFirstChild' };
		case 'Tab':
			return e.shiftKey ? null : { kind: 'toggleMode' };
		case '?':
			return { kind: 'cheatSheet' };
		case '+':
		case '=':
			return { kind: 'zoomBy', factor: ZOOM_STEP };
		case '-':
		case '_':
			return { kind: 'zoomBy', factor: 1 / ZOOM_STEP };
	}
	if (e.shiftKey) return null;
	switch (e.key.toLowerCase()) {
		case 'x':
			return { kind: 'reveal' };
		case 'f':
			return { kind: 'fit' };
	}
	return null;
}

interface TargetLike {
	tagName?: string;
	isContentEditable?: boolean;
}

/** A text field, select or editable element has focus: no stage key may fire. */
export function isTypingTarget(t: unknown): boolean {
	const el = t as TargetLike | null;
	if (!el || typeof el !== 'object') return false;
	return (
		el.tagName === 'INPUT' ||
		el.tagName === 'TEXTAREA' ||
		el.tagName === 'SELECT' ||
		el.isContentEditable === true
	);
}

/** `Enter` and `Tab` belong to the stage only when focus is on the page body or inside the stage;
 *  on any focused widget (a button, a tile, a tab) they keep their native meaning. */
export function ownsFocusKeys(
	target: unknown,
	body: unknown,
	stage: { contains(node: never): boolean } | undefined,
): boolean {
	if (target === null || target === undefined || target === body) return true;
	return !!stage && stage.contains(target as never);
}

export interface ShortcutRow {
	keys: string[];
	does: string;
}

/** The cheat-sheet, grouped as it is drawn. The Stage rows are {@link stageShortcut}'s; the rest
 *  are the page's and the Outline's existing keys and gestures. */
export const SHORTCUT_SHEET: { group: string; rows: ShortcutRow[] }[] = [
	{
		group: 'Hierarchy',
		rows: [
			{ keys: ['Esc'], does: 'Select the parent (again: deselect)' },
			{ keys: ['Enter'], does: 'Select the first child' },
			{ keys: ['X'], does: 'Reveal the selection in the Outline' },
			{ keys: ['Shift', 'click'], does: 'Range-select in the Outline / add on the stage' },
			{ keys: ['Ctrl/⌘', 'click'], does: 'Toggle a row in the selection' },
			{ keys: ['Double-click'], does: 'Rename a row' },
			{ keys: ['Right-click'], does: 'Outline row menu' },
		],
	},
	{
		group: 'Stage',
		rows: [
			{ keys: ['F'], does: 'Fit the frame' },
			{ keys: ['Ctrl/⌘', '0'], does: 'Zoom to 100%' },
			{ keys: ['+'], does: 'Zoom in' },
			{ keys: ['-'], does: 'Zoom out' },
			{ keys: ['←↑→↓'], does: `Nudge ${NUDGE_PX}px (Design)` },
			{ keys: ['Shift', '←↑→↓'], does: `Nudge ${NUDGE_SHIFT_PX}px (Design)` },
			{ keys: ['Tab'], does: 'Toggle Design / Animate' },
			{ keys: ['Shift', '/'], does: 'This sheet' },
		],
	},
	{
		group: 'Edit (Screens, Design)',
		rows: [
			{ keys: ['Ctrl/⌘', 'Z'], does: 'Undo' },
			{ keys: ['Ctrl/⌘', 'Shift', 'Z'], does: 'Redo' },
			{ keys: ['Ctrl/⌘', 'C'], does: 'Copy' },
			{ keys: ['Ctrl/⌘', 'X'], does: 'Cut' },
			{ keys: ['Ctrl/⌘', 'V'], does: 'Paste' },
			{ keys: ['Ctrl/⌘', 'D'], does: 'Duplicate' },
			{ keys: ['Delete'], does: 'Delete the selection (locked nodes stay)' },
		],
	},
	{
		// The shared Timeline module's own keys (`$lib/timeline/timeline.js`, which `/rigger` mounts
		// too, so they are handled there rather than in this map). Live while Animate's panel is.
		group: 'Timeline (Animate)',
		rows: [
			{ keys: [',', '.'], does: 'Step a frame back / forward' },
			{ keys: ['Shift', ',', '.'], does: 'Step ten frames' },
			{ keys: ['Space'], does: 'Play / pause' },
			{ keys: ['Shift/Ctrl', 'click'], does: 'Add a key to the selection' },
			{ keys: ['Ctrl/⌘', 'C', 'V'], does: 'Copy the selected keys / paste them at the playhead' },
			{ keys: ['Delete'], does: 'Delete the selected keys' },
			{ keys: ['Ctrl/⌘', 'Z'], does: 'Undo in the timeline' },
		],
	},
];
