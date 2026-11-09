/**
 * Offline fixture for `rescaleCanvas` (`docs/design/arcade-4k-builds.md` Phase 2):
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs \
 *     packages/engine-layout/canvasRescale.fixture.ts
 *
 * Pins what a rescale changes and what it must leave alone:
 *   - every canvas box and every layout-profile bucket box multiply;
 *   - a top-level node of a canvas-unit scene (`game`, `standard`, a `canvas` screen that scales
 *     with the window) moves and scales, overrides included, and its children are untouched;
 *   - a plain `canvas` screen (window pixels) and a `background` one (cover) are left alone;
 *   - the numbers that sit outside a node's scale multiply: a reel grid's board nudge, a scene's
 *     world, camera and editor guides;
 *   - the input is not mutated, a ×2 then ×0.5 round trip is the identity, and a doc with no reel
 *     grid is flagged (its coded board does not follow the canvas).
 * Pixel proof that a rescaled game LOOKS the same: `scripts/playtest/canvas-scale-probe.mjs`.
 */

import { DEFAULT_LAYOUT_PROFILE } from '../constants-shared/layoutProfile.ts';
import { rescaleCanvas } from './src/lib/canvasRescale.ts';
import type { LayoutDoc, LayoutNode, Scene } from './src/lib/types.ts';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) console.log(`  ok    ${label}`);
	else {
		failures += 1;
		console.error(`  FAIL  ${label}\n        got      ${a}\n        expected ${e}`);
	}
};

const sprite = (id: string, extra: Partial<LayoutNode> = {}): LayoutNode =>
	({ id, kind: 'sprite', x: 100, y: 50, assetKey: 'a', ...extra }) as LayoutNode;

const doc: Pick<LayoutDoc, 'mainSizesMap' | 'scenes'> = {
	mainSizesMap: { desktop: { width: 1920, height: 1080 }, portrait: { width: 1080, height: 1920 } },
	scenes: [
		{
			id: 'basegame',
			name: 'base',
			nodes: [
				sprite('bg', {
					scale: { x: 0.5, y: 0.5 },
					overrides: { portrait: { x: 10, scale: { x: 2, y: 2 }, alpha: 0.5 } },
				}),
				{
					id: 'group',
					kind: 'container',
					x: 0,
					y: 0,
					children: [sprite('child')],
				} as LayoutNode,
				{
					id: 'board',
					kind: 'reelGrid',
					x: 960,
					y: 540,
					cellSize: 150,
					boardNudgeX: 4,
					boardNudgeY: -6,
				} as LayoutNode,
			],
			world: { w: 4000, h: 1080 },
			camera: { deadZone: { w: 200, h: 100 }, lookAhead: 40, autoScroll: { x: 30, y: 0 } },
			guides: { desktop: { x: [960], y: [540] } },
		} as Scene,
		{ id: 'hud', name: 'hud', space: 'standard', nodes: [sprite('btn')] } as Scene,
		{
			id: 'scaled',
			name: 'scaled',
			space: 'canvas',
			scaleWithWindow: true,
			nodes: [sprite('s')],
		} as Scene,
		{ id: 'corners', name: 'corners', space: 'canvas', nodes: [sprite('logo')] } as Scene,
		{ id: 'back', name: 'back', space: 'background', nodes: [sprite('cover')] } as Scene,
	],
};
const before = JSON.stringify(doc);
const { doc: out, codedBoard } = rescaleCanvas(doc, 2, DEFAULT_LAYOUT_PROFILE);
const node = (scene: string, id: string) =>
	out.scenes.find((s) => s.id === scene)!.nodes.find((n) => n.id === id)!;

console.log('canvas rescale — boxes');
check('canvas boxes double', out.mainSizesMap, {
	desktop: { width: 3840, height: 2160 },
	portrait: { width: 2160, height: 3840 },
});
check(
	'every profile bucket box doubles',
	out.layoutProfile.buckets.map((b) => [b.id, b.box.width, b.box.height]),
	DEFAULT_LAYOUT_PROFILE.buckets.map((b) => [b.id, b.box.width * 2, b.box.height * 2]),
);
check(
	'bucket rules are untouched',
	out.layoutProfile.buckets.map((b) => b.rule),
	DEFAULT_LAYOUT_PROFILE.buckets.map((b) => b.rule),
);

console.log('canvas rescale — nodes');
const bg = node('basegame', 'bg');
check('a node moves and scales', [bg.x, bg.y, bg.scale], [200, 100, { x: 1, y: 1 }]);
check('an override moves and scales, the rest kept', bg.overrides?.portrait, {
	x: 20,
	scale: { x: 4, y: 4 },
	alpha: 0.5,
});
const group = node('basegame', 'group');
check('a node with no scale gets the factor', group.scale, { x: 2, y: 2 });
check(
	'children keep their own numbers',
	group.kind === 'container' && group.children[0],
	sprite('child'),
);
const board = node('basegame', 'board');
check(
	'a reel grid scales through its transform, its nudge directly',
	board.kind === 'reelGrid' && [board.x, board.cellSize, board.boardNudgeX, board.boardNudgeY],
	[1920, 150, 8, -12],
);
check(
	'a standard screen scales',
	[node('hud', 'btn').x, node('hud', 'btn').scale],
	[200, { x: 2, y: 2 }],
);
check('a canvas screen that scales with the window scales', node('scaled', 's').x, 200);
check('a window-pixel canvas screen is left alone', node('corners', 'logo'), sprite('logo'));
check('a background screen is left alone', node('back', 'cover'), sprite('cover'));

console.log('canvas rescale — scene numbers');
const base = out.scenes[0];
check('world doubles', base.world, { w: 8000, h: 2160 });
check('camera distances double', base.camera, {
	deadZone: { w: 400, h: 200 },
	lookAhead: 80,
	autoScroll: { x: 60, y: 0 },
});
check('editor guides double', base.guides, { desktop: { x: [1920], y: [1080] } });

console.log('canvas rescale — contract');
check('the input is not mutated', JSON.stringify(doc) === before, true);
const back = rescaleCanvas(out, 0.5, out.layoutProfile);
check('×2 then ×0.5 is the identity (canvas boxes)', back.doc.mainSizesMap, doc.mainSizesMap);
check('×2 then ×0.5 is the identity (profile)', back.doc.layoutProfile, DEFAULT_LAYOUT_PROFILE);
check(
	'×2 then ×0.5 is the identity (scenes, a missing scale reads as 1)',
	back.doc.scenes.map((s) => s.nodes.map((n) => [n.x, n.y, n.scale?.x ?? 1])),
	doc.scenes.map((s) => s.nodes.map((n) => [n.x, n.y, n.scale?.x ?? 1])),
);
check('a doc with a reel grid is not flagged', codedBoard, false);
check(
	'a doc without one is flagged',
	rescaleCanvas({ ...doc, scenes: doc.scenes.slice(1) }, 2, DEFAULT_LAYOUT_PROFILE).codedBoard,
	true,
);
let threw = false;
try {
	rescaleCanvas(doc, 0, DEFAULT_LAYOUT_PROFILE);
} catch {
	threw = true;
}
check('a zero factor is refused', threw, true);

// A throw exits non-zero without Node's types, which this package does not carry.
if (failures) throw new Error(`${failures} canvas rescale check(s) failed`);
console.log('\n✓ canvas rescale: all checks pass');
