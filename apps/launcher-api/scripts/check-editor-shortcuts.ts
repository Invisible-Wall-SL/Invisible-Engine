/**
 * The editor stage's keyboard map and its cheat-sheet (Rive plan Phase 9a):
 *   pnpm --filter launcher-api check:editor-shortcuts
 *
 *  1. every key the stage takes, and the modified presses it must leave to the page (Ctrl/⌘ is
 *     undo, clipboard and save; only ⌘0 / Ctrl+0 is the stage's);
 *  2. the typing guard: no stage key fires in an input, textarea, select or editable element, and
 *     `Enter` / `Tab` keep their native meaning on a focused button or link;
 *  3. the sheet lists every stage action, so it can never omit a key the stage answers;
 *  4. a source scan: the canvas runs the map behind the typing guard, before any action.
 */
import { readFileSync } from 'node:fs';
import {
	isTypingTarget,
	NUDGE_PX,
	ownsFocusKeys,
	NUDGE_SHIFT_PX,
	SHORTCUT_SHEET,
	stageShortcut,
	ZOOM_STEP,
	type KeyLike,
} from '../src/lib/editor/stageShortcuts.ts';

let checks = 0;
let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
	checks++;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return;
	failures++;
	console.error(`FAIL  ${label}\n        expected ${e}\n        got      ${a}`);
}

const key = (k: string, mods: Partial<Omit<KeyLike, 'key'>> = {}): KeyLike => ({
	key: k,
	shiftKey: false,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	...mods,
});

// ── 1. the map ─────────────────────────────────────────────────────────────────
check('Esc → select the parent', stageShortcut(key('Escape')), { kind: 'selectParent' });
check('Enter → first child', stageShortcut(key('Enter')), { kind: 'selectFirstChild' });
check('x → reveal', stageShortcut(key('x')), { kind: 'reveal' });
check('X (caps lock) → reveal', stageShortcut(key('X')), { kind: 'reveal' });
check('f → fit', stageShortcut(key('f')), { kind: 'fit' });
check('⌘0 → 100%', stageShortcut(key('0', { metaKey: true })), { kind: 'zoomTo100' });
check('Ctrl+0 → 100%', stageShortcut(key('0', { ctrlKey: true })), { kind: 'zoomTo100' });
check('+ → zoom in', stageShortcut(key('+', { shiftKey: true })), {
	kind: 'zoomBy',
	factor: ZOOM_STEP,
});
check('= → zoom in', stageShortcut(key('=')), { kind: 'zoomBy', factor: ZOOM_STEP });
check('- → zoom out', stageShortcut(key('-')), { kind: 'zoomBy', factor: 1 / ZOOM_STEP });
check('← → nudge 1', stageShortcut(key('ArrowLeft')), { kind: 'nudge', dx: -NUDGE_PX, dy: 0 });
check('↓ → nudge 1', stageShortcut(key('ArrowDown')), { kind: 'nudge', dx: 0, dy: NUDGE_PX });
check('Shift+→ → nudge 10', stageShortcut(key('ArrowRight', { shiftKey: true })), {
	kind: 'nudge',
	dx: NUDGE_SHIFT_PX,
	dy: 0,
});
check('Shift+↑ → nudge 10', stageShortcut(key('ArrowUp', { shiftKey: true })), {
	kind: 'nudge',
	dx: 0,
	dy: -NUDGE_SHIFT_PX,
});
check('Tab → toggle mode', stageShortcut(key('Tab')), { kind: 'toggleMode' });
check('Shift+/ → the sheet', stageShortcut(key('?', { shiftKey: true })), { kind: 'cheatSheet' });

check('Ctrl+X stays the page’s cut', stageShortcut(key('x', { ctrlKey: true })), null);
check('⌘F stays the browser’s find', stageShortcut(key('f', { metaKey: true })), null);
check('Ctrl+Z stays undo', stageShortcut(key('z', { ctrlKey: true })), null);
check('Ctrl+= stays browser zoom', stageShortcut(key('=', { ctrlKey: true })), null);
check(
	'Ctrl+Shift+0 is not the stage’s',
	stageShortcut(key('0', { ctrlKey: true, shiftKey: true })),
	null,
);
check('Ctrl+arrow is not a nudge', stageShortcut(key('ArrowLeft', { ctrlKey: true })), null);
check('Alt+arrow is not a nudge', stageShortcut(key('ArrowLeft', { altKey: true })), null);
check('Shift+Tab moves focus back', stageShortcut(key('Tab', { shiftKey: true })), null);
check('Shift+Enter is free', stageShortcut(key('Enter', { shiftKey: true })), null);
check('Shift+F is free', stageShortcut(key('F', { shiftKey: true })), null);
check('a plain 0 is free', stageShortcut(key('0')), null);
check('other letters are free', stageShortcut(key('q')), null);

// ── 2. the typing guard ────────────────────────────────────────────────────────
check('input', isTypingTarget({ tagName: 'INPUT' }), true);
check('textarea', isTypingTarget({ tagName: 'TEXTAREA' }), true);
check('select', isTypingTarget({ tagName: 'SELECT' }), true);
check('contenteditable', isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true);
check('a div is not typing', isTypingTarget({ tagName: 'DIV', isContentEditable: false }), false);
check('the body is not typing', isTypingTarget({ tagName: 'BODY' }), false);
check('no target', isTypingTarget(null), false);
{
	const body = { tagName: 'BODY' };
	const inStage = { tagName: 'CANVAS' };
	const stage = { contains: (n: never): boolean => n === (inStage as never) };
	check('Enter/Tab are the stage’s from the page body', ownsFocusKeys(body, body, stage), true);
	check('…and from inside the stage', ownsFocusKeys(inStage, body, stage), true);
	check('…and with no target', ownsFocusKeys(null, body, stage), true);
	check('a focused button keeps them', ownsFocusKeys({ tagName: 'BUTTON' }, body, stage), false);
	check(
		'a focused role=button tile keeps them (no Tab trap)',
		ownsFocusKeys({ tagName: 'DIV' }, body, stage),
		false,
	);
	check('an outline row keeps them', ownsFocusKeys({ tagName: 'DIV' }, body, undefined), false);
}

// ── 3. the sheet covers the map ────────────────────────────────────────────────
{
	const stage = SHORTCUT_SHEET.find((g) => g.group === 'Stage')?.rows ?? [];
	const hier = SHORTCUT_SHEET.find((g) => g.group === 'Hierarchy')?.rows ?? [];
	const listed = [...stage, ...hier].map((r) => r.keys.join('+'));
	for (const k of [
		'Esc',
		'Enter',
		'X',
		'F',
		'Ctrl/⌘+0',
		'+',
		'-',
		'←↑→↓',
		'Shift+←↑→↓',
		'Tab',
		'Shift+/',
	])
		check(`the sheet lists ${k}`, listed.includes(k), true);
}

// ── 4. the canvas wiring ───────────────────────────────────────────────────────
{
	const canvas = readFileSync(
		new URL('../src/routes/(app)/editor/EditorCanvas.svelte', import.meta.url),
		'utf8',
	);
	const start = canvas.indexOf('function onKeyDown(');
	const body = canvas.slice(start, canvas.indexOf('function applyStageAction(', start));
	const guard = body.indexOf('isTypingTarget(e.target)');
	check('onKeyDown reads the map', body.includes('stageShortcut(e)'), true);
	check(
		'the typing guard runs before the map',
		guard !== -1 && guard < body.indexOf('stageShortcut(e)'),
		true,
	);
	check('only the canvas on screen answers', body.includes('getClientRects().length === 0'), true);
	check(
		'Enter/Tab defer to any focused widget',
		body.includes('ownsFocusKeys(e.target, document.body, wrap)'),
		true,
	);
}

if (failures > 0) {
	console.error(`\ncheck:editor-shortcuts — ${failures} of ${checks} checks FAILED`);
	process.exit(1);
}
console.log(`check:editor-shortcuts — ${checks} checks passed`);
