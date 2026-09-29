/**
 * Guard the snapshot undo history the `/flow-v2` editor records every edit into.
 *
 * Run: `pnpm --filter launcher-api run check:undo-history`
 *
 * What the page relies on, asserted here:
 *  - a burst of same-key edits (inspector typing, a comment resize) is ONE step, and a pause or a
 *    different key starts a new one;
 *  - a keyless (structural) edit never merges;
 *  - re-reporting the present is a no-op — the page calls `markDirty` after applying an undo so the
 *    undo SAVES, and that call must not itself become a history step or wipe the redo stack;
 *  - a new edit after undo drops the redo branch; the stack is bounded, oldest first.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UndoHistory } from '../src/lib/undoHistory';

function clocked(coalesceMs = 800, limit = 100) {
	let t = 0;
	const h = new UndoHistory('0', { coalesceMs, limit, now: () => t });
	return { h, tick: (ms: number) => (t += ms) };
}

test('same-key edits inside the window coalesce into one step', () => {
	const { h, tick } = clocked();
	h.commit('a', 'inspector:n1');
	tick(100);
	h.commit('ab', 'inspector:n1');
	tick(100);
	h.commit('abc', 'inspector:n1');
	assert.equal(h.undoDepth, 1);
	assert.equal(h.undo(), '0');
	assert.equal(h.canUndo, false);
	assert.equal(h.redo(), 'abc');
});

test('the window is measured from the LAST edit of the burst', () => {
	const { h, tick } = clocked(800);
	for (const s of ['a', 'b', 'c', 'd', 'e']) {
		h.commit(s, 'comment:c1');
		tick(700);
	}
	assert.equal(h.undoDepth, 1);
});

test('a pause or a different key opens a new step', () => {
	const { h, tick } = clocked(800);
	h.commit('a', 'inspector:n1');
	tick(900);
	h.commit('b', 'inspector:n1');
	h.commit('c', 'inspector:n2');
	assert.equal(h.undoDepth, 3);
	assert.deepEqual([h.undo(), h.undo(), h.undo()], ['b', 'a', '0']);
});

test('keyless (structural) edits never merge', () => {
	const { h } = clocked();
	h.commit('a');
	h.commit('b');
	assert.equal(h.undoDepth, 2);
});

test('a keyed edit right after a keyless one does not merge into it', () => {
	const { h } = clocked();
	h.commit('a');
	h.commit('b', 'inspector:n1');
	assert.equal(h.undoDepth, 2);
});

test('re-reporting the present after undo is a no-op and keeps redo', () => {
	const { h } = clocked();
	h.commit('a');
	h.commit('b');
	const snap = h.undo();
	assert.equal(snap, 'a');
	assert.equal(h.commit('a'), false);
	assert.equal(h.canRedo, true);
	assert.equal(h.redo(), 'b');
});

test('undo ends a burst: the next same-key edit is a fresh step', () => {
	const { h } = clocked();
	h.commit('a', 'k');
	h.commit('b');
	h.undo();
	h.commit('a2', 'k');
	assert.equal(h.undoDepth, 2);
	assert.equal(h.undo(), 'a');
});

test('a new edit after undo discards the redo branch', () => {
	const { h } = clocked();
	h.commit('a');
	h.commit('b');
	h.undo();
	h.commit('x');
	assert.equal(h.canRedo, false);
	assert.equal(h.redo(), null);
});

test('history is bounded, dropping the oldest steps', () => {
	const { h } = clocked(800, 3);
	for (const s of ['a', 'b', 'c', 'd', 'e']) h.commit(s);
	assert.equal(h.undoDepth, 3);
	assert.deepEqual([h.undo(), h.undo(), h.undo(), h.undo()], ['d', 'c', 'b', null]);
});

test('reset adopts a baseline and forgets both stacks', () => {
	const { h } = clocked();
	h.commit('a');
	h.undo();
	h.reset('z');
	assert.equal(h.canUndo || h.canRedo, false);
	assert.equal(h.present, 'z');
});
