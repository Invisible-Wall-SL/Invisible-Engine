/**
 * Guard that the Scene Editor's reel grid selection box frames the board where the board is drawn,
 * offline.
 *
 * Run: `pnpm --filter launcher-api run check:reel-grid-box`
 *
 * WHY. The box was sized from the node's own `reels`/`rows` and centred on its anchor, while the
 * board preview (`reelGridGeometry`) draws the Game Config's count and moves the cells by the board
 * nudge. Getting Hot's grid (boardNudgeY −79 = one cell) drew its cells a whole row above its box.
 *
 *  1. The box is the drawn board: same width, height and top-left as `reelGridGeometry`.
 *  2. The board nudge moves the box with the cells.
 *  3. The Game Config's count, when the canvas has one, sizes the box rather than the node's.
 *  4. An un-nudged board at the default anchor keeps the old centred box.
 */
import type { LayoutNode, ResolvedTransform } from 'engine-layout';

import {
	nodeBox,
	reelGridBox,
	reelGridGeometry,
	type NodeBox,
} from '../src/routes/(app)/editor/editorCanvas.helpers';

type ReelGrid = Extract<LayoutNode, { kind: 'reelGrid' }>;

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
	if (ok) console.log(`  ✓ ${label}`);
	else {
		failures++;
		console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
	}
}
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

const grid = (extra: Partial<ReelGrid> = {}): ReelGrid => ({
	id: 'reel-grid',
	kind: 'reelGrid',
	reels: 5,
	rows: 3,
	cellSize: 79,
	reelPadding: 0.53,
	anchor: { x: 0.5, y: 0.5 },
	x: 960,
	y: 567,
	...extra,
});
const at = (node: ReelGrid): ResolvedTransform => ({
	x: node.x,
	y: node.y,
	anchor: node.anchor,
	scale: { x: 2.59, y: 2.59 },
});
const left = (b: NodeBox) => -b.ax * b.w;
const top = (b: NodeBox) => -b.ay * b.h;

function framesBoard(label: string, node: ReelGrid, dims?: { reels: number; rows: number }): void {
	const box = reelGridBox(node, node.anchor, dims);
	const geo = reelGridGeometry(node, node.anchor, dims);
	check(
		label,
		near(box.w, geo.width) &&
			near(box.h, geo.height) &&
			near(left(box), geo.left) &&
			near(top(box), geo.top),
		`box ${box.w}×${box.h} at (${left(box)}, ${top(box)}), board ${geo.width}×${geo.height} at (${geo.left}, ${geo.top})`,
	);
}

console.log('reel grid selection box');

framesBoard('1. the box is the drawn board', grid());

const nudged = grid({ boardNudgeY: -79, boardNudgeX: 12 });
framesBoard('2. a nudged board (Getting Hot: −79 = one cell up)', nudged);
const nb = nodeBox(nudged, at(nudged), () => null);
check(
	'2. nodeBox (a nested reel grid) moves with the nudge too',
	near(top(nb), -237 / 2 - 79) && near(left(nb), -395 / 2 + 12),
	`top ${top(nb)}, left ${left(nb)}`,
);

const config = { reels: 6, rows: 4 };
framesBoard('3. the Game Config count sizes the box', grid(), config);
const sized = reelGridBox(grid(), { x: 0.5, y: 0.5 }, config);
check('3. 6×4 cells of 79', near(sized.w, 6 * 79) && near(sized.h, 4 * 79));

const plain = reelGridBox(grid(), { x: 0.5, y: 0.5 }, undefined);
check(
	'4. an un-nudged board keeps the centred box',
	near(plain.w, 395) && near(plain.h, 237) && near(plain.ax, 0.5) && near(plain.ay, 0.5),
);

if (failures) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log('\nall reel grid box checks passed');
