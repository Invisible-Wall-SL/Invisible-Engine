/**
 * Offline fixture for the REEL CULL — which cells of a rolling or resting reel are drawn.
 *
 *   pnpm check:all --only reelCull
 *
 * Pins: while a reel rolls, at every offset of the strip, exactly the cells that overlap the window
 * are drawn — none pops in or out at an edge, which is what culling a cell's centre at the window
 * edge did once per pitch on every reel; no two cells `rows + 2` apart are ever drawn together (the
 * pool of views in `ReelPaddingPool.svelte` relies on it); at rest only the window's own rows are
 * drawn, never the padding rows seated half a row outside.
 */

import { cellDrawn } from './reelCull.ts';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.log(`  FAIL ${label}\n       expected ${e}\n       actual   ${a}`);
};

const pitch = 100;
const rows = 3;
const top = 0;
const bottom = rows * pitch;
const cells = [-3, -2, -1, 0, 1, 2, 3, 4, 5];
const centre = (offset: number, cell: number) => offset + cell * pitch + pitch / 2;

let overlapMismatches = 0;
let pooledTogether = 0;
for (let offset = 0; offset < pitch; offset += 0.5) {
	const drawn = cells.filter((cell) => cellDrawn(centre(offset, cell), top, bottom, pitch / 2));
	const overlapping = cells.filter((cell) => {
		const y = centre(offset, cell);
		return y + pitch / 2 > top && y - pitch / 2 < bottom;
	});
	if (JSON.stringify(drawn) !== JSON.stringify(overlapping)) overlapMismatches += 1;
	for (const cell of drawn) if (drawn.includes(cell + rows + 2)) pooledTogether += 1;
}
check(
	'rolling: at every offset, exactly the cells overlapping the window are drawn',
	overlapMismatches,
	0,
);
check('rolling: no two cells rows + 2 apart are drawn together', pooledTogether, 0);

check(
	'at rest: only the window rows are drawn, not the padding rows half a row outside',
	cells.filter((cell) => cellDrawn(centre(0, cell), top, bottom, 0)),
	[0, 1, 2],
);
check(
	'rolling, seated: the padding rows exactly a half row outside stay undrawn',
	cells.filter((cell) => cellDrawn(centre(0, cell), top, bottom, pitch / 2)),
	[0, 1, 2],
);

check(
	'the centre rule alone misses the cell part-way in at the top (the pop the margin fixes)',
	cells.filter((cell) => cellDrawn(centre(40, cell), top, bottom, 0)),
	[0, 1, 2],
);
check(
	'with the margin that cell is drawn',
	cells.filter((cell) => cellDrawn(centre(40, cell), top, bottom, pitch / 2)),
	[-1, 0, 1, 2],
);

if (failures) {
	console.log(`\nreelCull: ${failures} check(s) FAILED`);
	throw new Error('reelCull fixture failed');
}
console.log('\nreelCull: all checks passed');
