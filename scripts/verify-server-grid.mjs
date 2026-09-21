// Offline fixture for the SERVER-AUTHORITATIVE BOARD (packages/game-config/src/serverGrid.ts).
//
//   node scripts/verify-server-grid.mjs
//
// WHAT IT PROVES. The RGS is authoritative for what it deals and against a real one always will be:
// the partner's boot `config` declares a window and will never follow our Invisible Game Config.
// Sizing the board off the authored doc alone is what let a client draw one board while the math
// scored another. So the board follows the declared window — but a window may be a RECTANGLE, with
// no way to say "column 0 shows three", which is why the rule has two cases and why the second one
// is the dangerous half:
//
//   - the server DECLARES `rowsPerReel` ⇒ used verbatim. Strictly better information than anything
//     authored: it is exactly what each dealt column is clamped to (`clampBoardToGrid`).
//   - the server declares NO step ⇒ it deals `rows` to EVERY column, so an authored step is dropped
//     ALWAYS — not merely when the bounding box disagrees. A matching box is where that is easiest
//     to miss, because it looks like agreement while hiding a scored cell in every short column.
//
// The invariant at the bottom is the one that matters: EVERY column draws exactly what was dealt it.
//
// Parity: with no window the caller skips the reconcile entirely, so an offline game — and any game
// whose server declares nothing — resolves its authored doc unchanged.

import {
	acceptServerWindow,
	reconcileGridDoc,
	gridShapeDiffers,
} from '../packages/game-config/src/serverGrid.ts';
import { resolveGrid } from '../packages/game-config/src/grid.ts';

let failures = 0;
const check = (name, ok, extra = '') => {
	if (!ok) failures += 1;
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
};

const shape = (g) => `${g.reels}x[${g.rows.join(',')}]`;
/** What `activeGrid()` does: reconcile against a captured window, or resolve the doc unchanged. */
const grid = (doc, win) => resolveGrid(win ? reconcileGridDoc(doc, win) : doc);
const TEST6 = { numReels: 5, numRows: [3, 4, 4, 4, 4] };
const DIAMOND = { numReels: 5, numRows: [3, 4, 5, 4, 3] };

// --- PARITY: no window ⇒ the authored grid, untouched -------------------------------------------
{
	const authored = resolveGrid(TEST6);
	const drawn = grid(TEST6, undefined);
	check('no window ⇒ authored stepped grid unchanged', shape(authored) === shape(drawn) && drawn.stepped); // prettier-ignore
	check('no window ⇒ the short column keeps its half-row offset', drawn.rowOffsetForReel(0) === 0.5);
	const flat = grid({ numReels: 5, numRows: [3, 3, 3, 3, 3] }, undefined);
	check('no window ⇒ rectangular board unchanged', shape(flat) === '5x[3,3,3,3,3]' && !flat.stepped);
}

// --- acceptServerWindow: what counts as a usable declaration -------------------------------------
{
	check('accept: a bare rectangle', shape(grid(TEST6, acceptServerWindow({ reels: 5, rows: 4 }))) === '5x[4,4,4,4,4]'); // prettier-ignore
	check('accept: nothing at all ⇒ undefined', acceptServerWindow(undefined) === undefined);
	check('accept: zero reels ⇒ undefined', acceptServerWindow({ reels: 0, rows: 4 }) === undefined);
	check('accept: non-numeric ⇒ undefined', acceptServerWindow({ reels: 'x', rows: 4 }) === undefined);
	for (const [label, rowsPerReel] of [
		['wrong length', [3, 4]],
		['a zero height', [0, 4, 4, 4, 4]],
		['taller than the box', [3, 4, 9, 4, 4]],
		['non-numeric', ['a', 4, 4, 4, 4]],
	]) {
		const win = acceptServerWindow({ reels: 5, rows: 4, rowsPerReel });
		check(`accept: ${label} ⇒ step ignored, window stays rectangular`, win?.rowsPerReel === undefined); // prettier-ignore
		check(`  …and the board draws the safe rectangle`, shape(grid(TEST6, win)) === '5x[4,4,4,4,4]');
	}
}

// --- test6, as our test server actually declares it ----------------------------------------------
{
	const win = acceptServerWindow({ reels: 5, rows: 4, rowsPerReel: [3, 4, 4, 4, 4] });
	const drawn = grid(TEST6, win);
	check('test6: declared step used verbatim', shape(drawn) === '5x[3,4,4,4,4]' && drawn.stepped);
	check('test6: reel 0 draws exactly the 3 cells it is dealt', drawn.rowsForReel(0) === 3);
	check('test6: half-row offset preserved', drawn.rowOffsetForReel(0) === 0.5);
}

// --- THE DANGEROUS HALF: a rectangle-declaring server whose BOX AGREES ---------------------------
{
	const win = acceptServerWindow({ reels: 5, rows: 5 });
	const drawn = grid(DIAMOND, win);
	check('rectangle 5x5 + authored diamond (box MATCHES) ⇒ the rectangle wins',
		shape(drawn) === '5x[5,5,5,5,5]' && !drawn.stepped, shape(drawn));
	check('  …so no column hides a scored cell', [0, 1, 2, 3, 4].every((r) => drawn.rowsForReel(r) === 5)); // prettier-ignore
	const t6 = grid(TEST6, acceptServerWindow({ reels: 5, rows: 4 }));
	check('test6 shape vs a rectangle-declaring server ⇒ step dropped', shape(t6) === '5x[4,4,4,4,4]');
}

// --- a declared step beats a disagreeing authored one --------------------------------------------
{
	const win = acceptServerWindow({ reels: 5, rows: 4, rowsPerReel: [3, 4, 4, 4, 4] });
	check('declared step wins over the authored diamond', shape(grid(DIAMOND, win)) === '5x[3,4,4,4,4]'); // prettier-ignore
}

// --- the gate on rebuilding the reels (what `captureServerGrid()` returns) -----------------------
	const changed = (doc, win) =>
		win ? gridShapeDiffers(resolveGrid(doc), resolveGrid(reconcileGridDoc(doc, win))) : false;
{
	check('capture: no window ⇒ no rebuild', changed(TEST6, undefined) === false);
	check('capture: server declares the authored shape ⇒ no rebuild',
		changed(TEST6, acceptServerWindow({ reels: 5, rows: 4, rowsPerReel: [3, 4, 4, 4, 4] })) === false); // prettier-ignore
	check('capture: rectangular project, same-size rectangular server ⇒ no rebuild',
		changed({ numReels: 5, numRows: [3, 3, 3, 3, 3] }, acceptServerWindow({ reels: 5, rows: 3 })) === false); // prettier-ignore
	check('capture: server grows the box ⇒ rebuild',
		changed({ numReels: 5, numRows: [3, 3, 3, 3, 3] }, acceptServerWindow({ reels: 5, rows: 4 })) === true); // prettier-ignore
	check('capture: server drops the authored step ⇒ rebuild',
		changed(TEST6, acceptServerWindow({ reels: 5, rows: 4 })) === true);
	check('capture: server declares a different step ⇒ rebuild',
		changed(TEST6, acceptServerWindow({ reels: 5, rows: 5, rowsPerReel: [5, 4, 3, 4, 5] })) === true); // prettier-ignore
	check('capture: server declares more reels ⇒ rebuild',
		changed({ numReels: 5, numRows: [3, 3, 3, 3, 3] }, acceptServerWindow({ reels: 6, rows: 3 })) === true); // prettier-ignore
}

// --- THE INVARIANT: every column draws exactly what it was dealt ---------------------------------
{
	const cases = [];
	for (const numRows of [[3, 4, 4, 4, 4], [3, 3, 3, 3, 3], [5, 4, 3, 4, 5], [2, 2, 2, 2, 2]])
		for (const rows of [3, 4, 5])
			for (const reels of [4, 5, 6])
				for (const rowsPerReel of [undefined, [1, 2, 3, 2, 1]])
					cases.push({ numRows, rows, reels, rowsPerReel });

	const bad = cases.filter(({ numRows, rows, reels, rowsPerReel }) => {
		const win = acceptServerWindow({ reels, rows, rowsPerReel });
		const drawn = grid({ numReels: 5, numRows }, win);
		if (drawn.reels !== win.reels) return true;
		return [...Array(drawn.reels).keys()].some(
			(r) => drawn.rowsForReel(r) !== (win.rowsPerReel ? win.rowsPerReel[r] : win.rows),
		);
	});
	check(`every column draws exactly what was dealt (${cases.length} combinations)`,
		bad.length === 0, bad.length ? JSON.stringify(bad[0]) : '');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
