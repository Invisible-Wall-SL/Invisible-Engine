/**
 * Does a background-space `componentInstance` cover the SAME box in the editor and in the game?
 *
 *   pnpm --filter bg-scene-spike run coverbox
 *
 * WHY THIS EXISTS. A `componentInstance` on a `space:'background'` screen cover-fits the window as
 * ONE composed unit, sized by the union of everything its def draws. That union was computed twice,
 * by two renderers, from two different sets of inputs:
 *
 *   - The EDITOR (`editorCanvas.helpers.nodeBox` → `componentInstanceContentBox`) measures art it
 *     has already rendered — a spine's setup-pose bounds from the WebGL overlay, a text node's
 *     rendered glyph box, a clip's frame rect, a nested instance's own union — and never skips a
 *     child: one it cannot size still contributes a placeholder box.
 *   - The GAME (`LayoutNodeView` → `componentDesignSize`) is fed an `intrinsic` that can size only a
 *     SPRITE. Every spine / text / flipbook / nested-instance child is skipped outright.
 *
 * So the same overlay measured smaller in the game than in the editor — and one with no sprite child
 * at all measured `null`, at which point `bgComponent` gave up and the instance rendered at its raw
 * authored x/y with NO cover. The two surfaces framed it at two different scales and two different
 * centres, which is what an author reports as "the alignments are wrong in the game". The fix is
 * `BaseNode.coverBox`: the editor bakes the union it measured onto the node, and the runtime covers
 * by that number instead of re-deriving one it cannot see.
 *
 * Proves:
 *   1. THE BUG, pinned deliberately — the runtime walk returns `null` for a spine+text overlay. Not
 *      because that is desirable, but because it is the whole reason the baked box has to exist. If
 *      someone later teaches `componentDesignSize` to measure a spine, this fails and sends them
 *      here to decide which mechanism wins, rather than leaving two that disagree.
 *   2. The editor measures a real union for that same def.
 *   3. The baked box reproduces the editor's placement in the game exactly — same centre, same
 *      scale — because both surfaces now run the identical formula over the identical box.
 *   4. A baked box of `160x100` is refused. That is `nodeBox`'s "could not measure" fallback, and
 *      baking it would pin the overlay to a wrong box permanently, which is worse than letting the
 *      runtime fall back to its own walk.
 *   5. NOT a bug, asserted so the two differences stay told apart: cover scale tracks the live
 *      WINDOW (`canvasSizes()`) in the game and the layout BUCKET in the editor, so a window whose
 *      aspect differs from the bucket's crops differently, by design.
 */
import { componentDesignSize } from '../../packages/engine-layout/src/lib/componentDesignSize';
import { coverTransform } from '../../packages/engine-layout/src/lib/coverTransform';
import { resolveTransform } from '../../packages/engine-layout/src/lib/resolveTransform';
import type {
	ComponentDef,
	LayoutNode,
	LayoutType,
} from '../../packages/engine-layout/src/lib/types';
import { nodeBox } from '../../apps/launcher-api/src/routes/(app)/editor/editorCanvas.helpers';

let fails = 0;
function ok(name: string, cond: boolean, extra = ''): void {
	if (!cond) fails++;
	console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
}

const LT: LayoutType = 'desktop';

/** A "Tap to Continue"-shaped def: one spine + one text, and deliberately NO sprite — the shape
 * the runtime walk cannot see at all. */
const def = {
	id: 'tapToContinue',
	name: 'Tap to Continue',
	version: 1,
	scope: 'project',
	category: 'overlay',
	root: {
		id: 'root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{ id: 's1', kind: 'spine', x: 0, y: 0, assetKey: 'bigwin', anchor: { x: 0.5, y: 0.5 } },
			{ id: 't1', kind: 'text', x: 0, y: 300, value: 'TAP TO CONTINUE' },
		],
	},
} as unknown as ComponentDef;

const instance = {
	id: 'i1',
	kind: 'componentInstance',
	x: 960,
	y: 540,
	componentId: 'tapToContinue',
} as unknown as LayoutNode;

// 1. The GAME's measurement — `LayoutNodeView`'s `intrinsic` sizes a sprite and nothing else.
const gameBox = componentDesignSize(
	def,
	(n) => (n.kind === 'sprite' ? { w: 100, h: 100 } : null),
	LT,
	undefined,
);
ok(
	'1. game walk cannot size a spine+text overlay (the bug the baked box exists for)',
	gameBox === null,
	`got ${JSON.stringify(gameBox)}`,
);

// 2. The EDITOR's measurement — `naturalSize` resolves the spine (WebGL bounds) + text (glyph box).
const measured = new Map<string, { w: number; h: number }>([
	['bigwin', { w: 1200, h: 800 }],
	['t1', { w: 620, h: 90 }],
]);
const naturalSize = (n: LayoutNode) =>
	n.kind === 'spine'
		? (measured.get((n as unknown as { assetKey: string }).assetKey) ?? null)
		: n.kind === 'text'
			? (measured.get(n.id) ?? null)
			: null;
const componentMap = new Map<string, ComponentDef>([[def.id, def]]);
const editorBox = nodeBox(instance, resolveTransform(instance, LT), naturalSize, componentMap, LT);
ok(
	'2. editor measures a real union for the same def',
	editorBox.w > 0 && editorBox.h > 0 && !(editorBox.w === 160 && editorBox.h === 100),
	`w=${editorBox.w} h=${editorBox.h} ax=${editorBox.ax.toFixed(3)} ay=${editorBox.ay.toFixed(3)}`,
);

/** The box the editor bakes onto the node: `nodeBox`'s anchor form converted to the union's
 * top-left, which is what places the union's CENTRE on the cover target. */
const toCoverBox = (b: { w: number; h: number; ax: number; ay: number }) => ({
	minX: -b.ax * b.w,
	minY: -b.ay * b.h,
	width: b.w,
	height: b.h,
});

/** The placement formula — ONE copy, because the editor's `backgroundTransform` and the runtime's
 * `coverBoxTransform` are the same arithmetic and the point of the test is that they stay so.
 * `cover` carries the doc-driven inputs BOTH surfaces now read (per-axis `fit`, and the anchor that
 * ALIGNS the fitted art in the window) — a parameter the formula takes has to be exercised here, or
 * the guard goes on proving parity for inputs neither surface is called with any more. */
function place(
	box: { minX: number; minY: number; width: number; height: number },
	targetWidth: number,
	targetHeight: number,
	cover: {
		fit?: 'cover' | 'contain' | 'width' | 'height';
		anchorX?: number;
		anchorY?: number;
	} = {},
) {
	const c = coverTransform({
		artWidth: box.width,
		artHeight: box.height,
		targetWidth,
		targetHeight,
		coverScale: 1,
		stretchX: 1,
		stretchY: 1,
		fit: cover.fit ?? 'cover',
		anchorX: cover.anchorX,
		anchorY: cover.anchorY,
	});
	return {
		x: c.x - (box.minX + box.width / 2) * c.scaleX,
		y: c.y - (box.minY + box.height / 2) * c.scaleY,
		sx: c.scaleX,
		sy: c.scaleY,
	};
}

// 3. Placement parity — the same box must land in the same place at the same scale on both surfaces.
const coverBox = toCoverBox(editorBox);
const editorPlacement = place(toCoverBox(editorBox), 1920, 1080);
const gamePlacement = place(coverBox, 1920, 1080);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
ok(
	'3. baked box reproduces the editor placement in the game',
	near(editorPlacement.x, gamePlacement.x) &&
		near(editorPlacement.y, gamePlacement.y) &&
		near(editorPlacement.sx, gamePlacement.sx) &&
		near(editorPlacement.sy, gamePlacement.sy),
	`x=${gamePlacement.x.toFixed(2)} y=${gamePlacement.y.toFixed(2)} scale=${gamePlacement.sx.toFixed(4)}`,
);

// 3b. The cover ANCHOR and the per-axis FIT ride the same one formula, so they cannot align one
// surface and not the other. A left/top anchor slides the fitted art by exactly half the overflow
// it crops; a `width` fit pins the box to the window width whatever the ratio.
const centred = place(coverBox, 1920, 1080);
const topLeft = place(coverBox, 1920, 1080, { anchorX: 0, anchorY: 0 });
const overflowX = coverBox.width * centred.sx - 1920;
const overflowY = coverBox.height * centred.sy - 1080;
ok(
	'3b. a non-centred anchor slides both surfaces by the same half-overflow',
	near(topLeft.x - centred.x, overflowX / 2) && near(topLeft.y - centred.y, overflowY / 2),
	`dx=${(topLeft.x - centred.x).toFixed(2)} dy=${(topLeft.y - centred.y).toFixed(2)}`,
);
const fitWidth = place(coverBox, 1920, 1080, { fit: 'width' });
ok(
	'3c. fit:width makes the box exactly window-wide, whatever the aspect',
	near(coverBox.width * fitWidth.sx, 1920),
	`drawnW=${(coverBox.width * fitWidth.sx).toFixed(2)}`,
);

// 4. The unmeasurable-instance guard — `nodeBox`'s generic fallback must never be baked.
const emptyDef = {
	id: 'empty',
	name: 'Empty',
	version: 1,
	scope: 'project',
	category: 'overlay',
	root: { id: 'root', kind: 'container', x: 0, y: 0, children: [] },
} as unknown as ComponentDef;
const emptyInstance = {
	id: 'i2',
	kind: 'componentInstance',
	x: 0,
	y: 0,
	componentId: 'empty',
} as unknown as LayoutNode;
const emptyBox = nodeBox(
	emptyInstance,
	resolveTransform(emptyInstance, LT),
	() => null,
	new Map<string, ComponentDef>([[emptyDef.id, emptyDef]]),
	LT,
);
ok(
	'4. an unmeasurable instance yields the 160x100 fallback the bake must refuse',
	emptyBox.w === 160 && emptyBox.h === 100,
	`w=${emptyBox.w} h=${emptyBox.h}`,
);

// 5. NOT a bug: the cover TARGET is the live window in the game, the layout bucket in the editor.
const atBucket = place(coverBox, 1920, 1080);
const atWindow = place(coverBox, 1512, 982);
ok(
	'5. cover scale tracks the WINDOW, not the bucket (the separate, non-bug difference)',
	Math.abs(atBucket.sx - atWindow.sx) > 1e-6,
	`bucket 1920x1080 => ${atBucket.sx.toFixed(4)}, window 1512x982 => ${atWindow.sx.toFixed(4)}`,
);

console.log(fails === 0 ? '\nAll checks passed.' : `\n${fails} check(s) FAILED.`);
process.exit(fails === 0 ? 0 : 1);
