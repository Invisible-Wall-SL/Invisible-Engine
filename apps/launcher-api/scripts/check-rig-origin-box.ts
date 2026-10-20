/**
 * Guard that a placed rig's Scene Editor selection box frames the art where the rig is drawn, offline.
 *
 * Run: `pnpm --filter launcher-api run check:rig-origin-box`
 *
 * WHY. A rig placed on a screen sits by its skeleton ORIGIN: the game's `<RigProvider>` (no anchor,
 * pivot 0) and the editor's rig layer (`skeleton.x = t.x`) both put the origin on the node's x/y. The
 * selection box used the rig's box SIZE but centred it on that origin, so a Rigger rig whose art was
 * far from its origin drew in one place and selected in another (the reported widget: art ~950 px
 * left of and ~580 px above its box).
 *
 * Load-bearing rules:
 *
 *  1. **The box sits around the origin exactly as the rig's box does** (`rigOriginAnchor`): its
 *     corners are the rig's box corners drawn the way the renderers draw them — origin at (x, y),
 *     rig y-up flipped to the canvas's y-down, times the node's scale.
 *  2. **A centred box keeps the old centred frame**, so every rig authored around its origin selects
 *     exactly as before.
 *  3. **The node's anchor moves nothing for a rig** (the game never reads it), so it cannot move the
 *     box either.
 *  4. **An authored size fits like the game's `rigSizeScale`**: both dimensions stretch per axis, ONE
 *     dimension scales uniformly, so the other follows the art's aspect.
 *  5. **A nested rig bind (the win / free-spin visual) is drawn by its origin too**, so it frames the
 *     same way.
 *  6. **A resize handle works wherever the origin sits.** A drag measures from the box centre for a
 *     rig (`resizePivot`), so an origin on an edge or outside the box still grows the box the way
 *     the handle is pulled, and the origin moves (`resizeOriginShift`) so the box centre holds
 *     still. Every other node measures from its origin, as before.
 */
import type { LayoutNode, ResolvedTransform } from 'engine-layout';

import { rigOriginAnchor, type RigBox } from 'constants-shared/rig';

import {
	nodeBox,
	nodeCornersWorld,
	resizeOriginShift,
	resizePivot,
	type NaturalSize,
	type NodeBox,
	type Vec2,
} from '../src/routes/(app)/editor/editorCanvas.helpers';

let fails = 0;
const check = (name: string, ok: boolean): void => {
	if (!ok) {
		fails++;
		console.error('FAIL:', name);
	}
};
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

/** The reported widget's box: 975 × 512 with its centre ~(-952, 582) from the origin. */
const WIDGET: RigBox = { x: -1439.5, y: 326, width: 975, height: 512 };
const CENTRED: RigBox = { x: -100, y: -40, width: 200, height: 80 };

const rig = (anchor?: { x: number; y: number }): LayoutNode => ({
	kind: 'spine',
	id: 'r',
	x: 0,
	y: 0,
	assetKey: 'client/project/spines/R_Widget/',
	...(anchor ? { anchor } : {}),
});
/** What the editor's rig layer reports for a ready rig: its size plus where its origin sits. */
const reported = (box: RigBox): NaturalSize => ({
	w: box.width,
	h: box.height,
	...rigOriginAnchor(box),
});

/**
 * The rig's box corners as the renderers draw them: the origin at (x, y), each axis scaled by the
 * node's scale times the fit of an authored size (`rigSizeScale`), y flipped (rig art is y-up).
 */
function drawnFrame(
	box: RigBox,
	t: ResolvedTransform,
): { l: number; r: number; t: number; b: number } {
	let fx = 1;
	let fy = 1;
	if (t.width !== undefined && t.height !== undefined) {
		fx = t.width / box.width;
		fy = t.height / box.height;
	} else if (t.width !== undefined) fx = fy = t.width / box.width;
	else if (t.height !== undefined) fx = fy = t.height / box.height;
	const sx = (t.scale?.x ?? 1) * fx;
	const sy = (t.scale?.y ?? 1) * fy;
	return {
		l: t.x + box.x * sx,
		r: t.x + (box.x + box.width) * sx,
		t: t.y - (box.y + box.height) * sy,
		b: t.y - box.y * sy,
	};
}
function selected(node: LayoutNode, t: ResolvedTransform, box: RigBox): Vec2[] {
	const nat = (): NaturalSize => reported(box);
	return nodeCornersWorld(t, nodeBox(node, t, nat));
}
function framesTheArt(name: string, node: LayoutNode, t: ResolvedTransform, box: RigBox): void {
	const [tl, tr, br, bl] = selected(node, t, box);
	const f = drawnFrame(box, t);
	const ok =
		near(tl.x, f.l) &&
		near(tl.y, f.t) &&
		near(tr.x, f.r) &&
		near(tr.y, f.t) &&
		near(br.x, f.r) &&
		near(br.y, f.b) &&
		near(bl.x, f.l) &&
		near(bl.y, f.b);
	check(
		`${name}: box (${tl.x.toFixed(1)}, ${tl.y.toFixed(1)})–(${br.x.toFixed(1)}, ${br.y.toFixed(1)}) frames the art (${f.l.toFixed(1)}, ${f.t.toFixed(1)})–(${f.r.toFixed(1)}, ${f.b.toFixed(1)})`,
		ok,
	);
}

const at = (extra: Partial<ResolvedTransform> = {}): ResolvedTransform => ({
	x: 640,
	y: 360,
	visible: true,
	...extra,
});

// Rule 1 — the reported case, then under scale.
framesTheArt('widget', rig(), at(), WIDGET);
framesTheArt('widget, scaled', rig(), at({ scale: { x: 0.5, y: 0.75 } }), WIDGET);
{
	const [tl] = selected(rig(), at(), WIDGET);
	check('widget: the box sits up-left of the node, where the art draws', tl.x < 0 && tl.y < 0);
}
// An origin outside the box is a real place for it.
{
	const a = rigOriginAnchor(WIDGET);
	check(
		`widget: origin outside its box (ax ${a.ax.toFixed(3)}, ay ${a.ay.toFixed(3)})`,
		a.ax > 1 && a.ay > 1,
	);
}

// Rule 2 — a centred box is the old centred frame.
{
	const a = rigOriginAnchor(CENTRED);
	check('centred box: origin anchor is (0.5, 0.5)', near(a.ax, 0.5) && near(a.ay, 0.5));
	framesTheArt('centred', rig(), at(), CENTRED);
	const b = nodeBox(rig(), at(), () => reported(CENTRED));
	check(
		'centred box: same frame as before',
		near(b.ax, 0.5) && near(b.ay, 0.5) && b.w === 200 && b.h === 80,
	);
}
// A rig with its root at its feet: the origin is the bottom-centre of its box.
{
	const a = rigOriginAnchor({ x: -50, y: 0, width: 100, height: 300 });
	check('feet-rooted rig: origin at the bottom-centre', near(a.ax, 0.5) && near(a.ay, 1));
}

// Rule 3 — the node's anchor is not read.
framesTheArt('widget, anchor set', rig({ x: 0, y: 0 }), at({ anchor: { x: 0, y: 0 } }), WIDGET);
framesTheArt('centred, anchor set', rig({ x: 1, y: 1 }), at({ anchor: { x: 1, y: 1 } }), CENTRED);

// Rule 4 — sizing.
framesTheArt('widget, both dims', rig(), at({ width: 300, height: 300 }), WIDGET);
framesTheArt('widget, width only', rig(), at({ width: 487.5 }), WIDGET);
framesTheArt('widget, height only', rig(), at({ height: 1024 }), WIDGET);
framesTheArt(
	'widget, width only and scaled',
	rig(),
	at({ width: 390, scale: { x: 2, y: 2 } }),
	WIDGET,
);
{
	const b = nodeBox(rig(), at({ width: 487.5 }), () => reported(WIDGET));
	check(`width only keeps the art's aspect (${b.w} × ${b.h})`, near(b.w, 487.5) && near(b.h, 256));
}
// Not loaded yet: the placeholder box, centred.
{
	const b = nodeBox(rig(), at(), () => null);
	check(
		'unloaded rig: the 160 × 100 placeholder, centred',
		b.w === 160 && b.h === 100 && b.ax === 0.5,
	);
}

// Rule 5 — a nested rig bind inside a component that names a rig.
{
	const bind: LayoutNode = {
		kind: 'container',
		id: 'visual',
		x: 0,
		y: 0,
		bind: { component: 'someVisual' },
		children: [],
	};
	const t = at();
	const box = nodeBox(
		bind,
		t,
		() => reported(WIDGET),
		undefined,
		undefined,
		'client/project/spines/R_Widget/',
	);
	const [tl, , br] = nodeCornersWorld(t, box);
	const f = drawnFrame(WIDGET, t);
	check(
		'nested rig bind: frames the art around its origin',
		near(tl.x, f.l) && near(tl.y, f.t) && near(br.x, f.r) && near(br.y, f.b),
	);
}

// Rule 6 — a resize drag, as `applyScale` runs it: the dragged corner's offset from the pivot is
// the base, the pointer's local delta is added, and the origin then moves by `resizeOriginShift`.
const centre = (q: Vec2[]): Vec2 => ({
	x: (q[0].x + q[2].x) / 2,
	y: (q[0].y + q[2].y) / 2,
});
/** Drag corner `idx` of a scale-1 node by `delta` (local px), uniform like a corner handle. */
function drag(
	node: LayoutNode,
	box: NodeBox,
	t: ResolvedTransform,
	idx: number,
	delta: Vec2,
	axis?: 'x' | 'y',
): { ratio: Vec2; after: ResolvedTransform } {
	const left = -box.w * box.ax;
	const top = -box.h * box.ay;
	const corners = [
		{ x: left, y: top },
		{ x: left + box.w, y: top },
		{ x: left + box.w, y: top + box.h },
		{ x: left, y: top + box.h },
	];
	const pivot = resizePivot(node, box);
	const ref = corners[idx];
	const bx = ref.x - pivot.x;
	const by = ref.y - pivot.y;
	let rx = bx === 0 ? 1 : (bx + delta.x) / bx;
	let ry = by === 0 ? 1 : (by + delta.y) / by;
	if (axis === 'x') ry = 1;
	else if (axis === 'y') rx = 1;
	const scale = { x: t.scale?.x ?? 1, y: t.scale?.y ?? 1 };
	const shift = resizeOriginShift(pivot, scale, { x: rx, y: ry }, t.rotation ?? 0);
	return {
		ratio: { x: rx, y: ry },
		after: {
			...t,
			x: t.x + shift.x,
			y: t.y + shift.y,
			scale: { x: scale.x * rx, y: scale.y * ry },
		},
	};
}
{
	const box = nodeBox(rig(), at(), () => reported(WIDGET));
	// Right edge, pulled 100 px outward: the widget's origin is right of its box (ax ≈ 1.48).
	const r = drag(rig(), box, at(), 1, { x: 100, y: 0 }, 'x');
	check(`widget: pulling the right edge out grows it (×${r.ratio.x.toFixed(3)})`, r.ratio.x > 1);
	const c0 = centre(nodeCornersWorld(at(), box));
	const c1 = centre(nodeCornersWorld(r.after, box));
	check('widget: the box centre holds still while it grows', near(c0.x, c1.x) && near(c0.y, c1.y));
	const [, tr] = nodeCornersWorld(r.after, box);
	check(
		`widget: the dragged edge moves out (right edge ${tr.x.toFixed(1)} past ${nodeCornersWorld(at(), box)[1].x.toFixed(1)})`,
		tr.x > nodeCornersWorld(at(), box)[1].x,
	);
	// Rotated and scaled, a corner drag still holds the centre.
	const tr2 = at({ rotation: 0.6, scale: { x: 0.8, y: 1.3 } });
	const r2 = drag(rig(), box, tr2, 2, { x: 40, y: 25 });
	const d0 = centre(nodeCornersWorld(tr2, box));
	const d1 = centre(nodeCornersWorld(r2.after, box));
	check(
		'widget, rotated + scaled: a corner drag holds the box centre',
		near(d0.x, d1.x) && near(d0.y, d1.y),
	);
}
{
	// A feet-rooted rig: its origin is ON the bottom edge, so measuring from it, the bottom handle
	// had nothing to scale by.
	const feet: RigBox = { x: -50, y: 0, width: 100, height: 300 };
	const box = nodeBox(rig(), at(), () => reported(feet));
	const r = drag(rig(), box, at(), 2, { x: 0, y: 30 }, 'y');
	check(`feet-rooted rig: the bottom handle resizes (×${r.ratio.y.toFixed(3)})`, r.ratio.y > 1);
}
{
	// A centred rig and every other kind keep their old drag: measured from the origin, which stays.
	const box = nodeBox(rig(), at(), () => reported(CENTRED));
	const p = resizePivot(rig(), box);
	check('centred rig: the pivot is its origin', p.x === 0 && p.y === 0);
	const sprite: LayoutNode = { kind: 'sprite', id: 's', x: 0, y: 0, assetKey: 'a' };
	const sp = resizePivot(sprite, { w: 100, h: 50, ax: 0, ay: 0 });
	check('a sprite still measures from its origin', sp.x === 0 && sp.y === 0);
	const shift = resizeOriginShift({ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 1.5, y: 0.5 }, 0.3);
	check('a pivot at the origin moves nothing', shift.x === 0 && shift.y === 0);
}

if (fails) {
	console.error(`\n${fails} rig origin box check(s) failed`);
	process.exit(1);
}
console.log('rig origin box: all checks passed');
