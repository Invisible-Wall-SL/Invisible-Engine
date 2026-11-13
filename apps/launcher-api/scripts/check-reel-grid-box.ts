/**
 * Guard that the Scene Editor draws and frames the reel grid where the game draws it, offline.
 *
 * Run: `pnpm --filter launcher-api run check:reel-grid-box`
 *
 * WHY. The box was sized from the node's own `reels`/`rows` and centred on its anchor, while the
 * board preview (`reelGridGeometry`) draws the Game Config's count and moves the cells by the board
 * nudge, so Getting Hot's grid drew its cells a row above its box (#1642). Then the preview itself
 * disagreed with the game: it moved the board by the nudge INSIDE the node's scale, while the game
 * (`boardLayout()`) adds the nudge to the node's x/y outside it. Getting Hot (nudge −79 at scale
 * 2.59) showed its board 126 px higher in the editor than in game.
 *
 *  1. The box is the drawn board: same width, height and top-left as `reelGridGeometry`.
 *  2. The board nudge moves the box with the cells.
 *  3. The Game Config's count, when the canvas has one, sizes the box rather than the node's.
 *  4. An un-nudged board at the default anchor keeps the old centred box.
 *  5. The board's centre lands where the game's resolver puts it (node x/y + the nudge, unscaled),
 *     at scale 1 and at Getting Hot's 2.59, in a nested grid too.
 */
import { resolveReelGridFromNode, type LayoutNode, type ResolvedTransform } from 'engine-layout';

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
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

const SCALE = 2.5938527553883723;
const grid = (extra: Partial<ReelGrid> = {}): ReelGrid => ({
	id: 'reel-grid',
	kind: 'reelGrid',
	reels: 5,
	rows: 3,
	cellSize: 79,
	reelPadding: 0.53,
	anchor: { x: 0.5, y: 0.5 },
	x: 960,
	y: 793,
	...extra,
});
const scaleOf = (node: ReelGrid) => node.scale ?? { x: 1, y: 1 };
const at = (node: ReelGrid): ResolvedTransform => ({
	x: node.x,
	y: node.y,
	anchor: node.anchor,
	scale: scaleOf(node),
});
const left = (b: NodeBox) => -b.ax * b.w;
const top = (b: NodeBox) => -b.ay * b.h;

function framesBoard(label: string, node: ReelGrid, dims?: { reels: number; rows: number }): void {
	const box = reelGridBox(node, node.anchor, dims, scaleOf(node));
	const geo = reelGridGeometry(node, node.anchor, dims, scaleOf(node));
	check(
		label,
		near(box.w, geo.width) &&
			near(box.h, geo.height) &&
			near(left(box), geo.left) &&
			near(top(box), geo.top),
		`box ${box.w}×${box.h} at (${left(box)}, ${top(box)}), board ${geo.width}×${geo.height} at (${geo.left}, ${geo.top})`,
	);
}

/** Where the editor puts the board's centre on the stage: the node, plus its local centre × scale. */
function editorCentre(box: NodeBox, node: ReelGrid): { x: number; y: number } {
	const s = scaleOf(node);
	return {
		x: node.x + (left(box) + box.w / 2) * s.x,
		y: node.y + (top(box) + box.h / 2) * s.y,
	};
}

function landsWhereTheGameDoes(label: string, node: ReelGrid, box: NodeBox): void {
	const game = resolveReelGridFromNode(node, 'desktop');
	if (!game) return check(label, false, 'the game resolver returned nothing');
	const want = { x: game.x + game.boardNudgeX, y: game.y + game.boardNudgeY };
	const got = editorCentre(box, node);
	check(
		label,
		near(got.x, want.x) && near(got.y, want.y),
		`editor (${got.x}, ${got.y}), game (${want.x}, ${want.y})`,
	);
}

console.log('reel grid selection box and board position');

framesBoard('1. the box is the drawn board', grid());

const nudged = grid({ boardNudgeY: -79, boardNudgeX: 12 });
framesBoard('2. a nudged board', nudged);

const config = { reels: 6, rows: 4 };
framesBoard('3. the Game Config count sizes the box', grid(), config);
const sized = reelGridBox(grid(), { x: 0.5, y: 0.5 }, config, undefined);
check('3. 6×4 cells of 79', near(sized.w, 6 * 79) && near(sized.h, 4 * 79));

const plain = reelGridBox(grid(), { x: 0.5, y: 0.5 }, undefined, undefined);
check(
	'4. an un-nudged board keeps the centred box',
	near(plain.w, 395) && near(plain.h, 237) && near(plain.ax, 0.5) && near(plain.ay, 0.5),
);

landsWhereTheGameDoes(
	'5. a nudged board at scale 1 lands where the game draws it',
	nudged,
	reelGridBox(nudged, nudged.anchor, undefined, scaleOf(nudged)),
);
const gettingHot = grid({ boardNudgeY: -79, scale: { x: SCALE, y: SCALE } });
framesBoard('5. Getting Hot (nudge −79 at scale 2.59): the box is the drawn board', gettingHot);
landsWhereTheGameDoes(
	'5. Getting Hot lands where the game draws it (793 − 79, not 793 − 79 × 2.59)',
	gettingHot,
	reelGridBox(gettingHot, gettingHot.anchor, undefined, scaleOf(gettingHot)),
);
landsWhereTheGameDoes(
	'5. a nested reel grid (nodeBox) lands there too',
	gettingHot,
	nodeBox(gettingHot, at(gettingHot), () => null),
);

if (failures) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log('\nall reel grid checks passed');
