/**
 * Guard that a placed rig's Scene Editor selection box frames the art where the rig is drawn, offline.
 *
 * Run: `pnpm --filter launcher-api run check:rig-origin-box`
 *
 * WHY. A rig placed on a screen sits by its skeleton ORIGIN: the game's `<RigProvider>` (no
 * anchor, pivot 0) and the editor's rig layer (`placedRigTransform`) both put the origin on the
 * node's x/y. The selection box used the rig's box SIZE but centred it on that origin, so a Rigger
 * rig whose art was far from its origin drew in one place and selected in another (the reported
 * widget: art ~950 px left of and ~580 px above its box; rule 7 says what that turned out to be).
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
 *  7. **The rig layer draws the origin where the box and the game put it** (`placedRigTransform`),
 *     in a `canvas` and a `game` screen. In a `canvas` screen that folds in the node's
 *     `screenAnchor`, as the box and `LayoutNodeView` do through `anchoredPosition`. The layer read
 *     the raw x/y there, so the reported `R_Widget` (centred, screen anchor 0.5/0.5, x 0, y −15)
 *     drew half a window up-left of its box even after ⊕ Centre origin: that, not the rig, was the
 *     reported offset.
 *  8. **A rig on a `standard` (HUD) screen draws where its box is, and where the game draws it**,
 *     with the HUD the active screen and with it behind a game screen. The box (`nodeTransform` →
 *     `standardToWorld`) and the rig layer (`placedRigTransform`) both fit the standard box into the
 *     frame the way `<MainContainer standard>` does, `align` included. The Scene Editor's frame IS
 *     the standard box, so that fit is the identity there on either screen; a standard box that does
 *     not fill the frame is checked too, and the raw x/y the layer read before is caught by it.
 */
import {
	anchoredPosition,
	type LayoutNode,
	type ResolvedTransform,
	type Scene,
} from 'engine-layout';

import { rigOriginAnchor, type RigBox } from 'constants-shared/rig';

import {
	nodeBox,
	nodeCornersWorld,
	placedRigTransform,
	resizeOriginShift,
	resizePivot,
	standardToWorld,
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

// Rule 7 — the rig layer draws the origin where the box is framed. The box's world transform is
// `nodeTransform`'s: `anchoredPosition` in a `canvas` screen (the rule the game's `LayoutNodeView`
// places by), the main-box mapping in a `game` one.
{
	const FRAME = { w: 1920, h: 1080 };
	const MAIN = {
		scale: 0.75,
		toWorld: (p: Vec2): Vec2 => ({ x: 240 + p.x * 0.75, y: 90 + p.y * 0.75 }),
	};
	const HUD = { box: { width: FRAME.w, height: FRAME.h }, align: undefined };
	const boxWorld = (t: ResolvedTransform, space: Scene['space']): ResolvedTransform => {
		if (space === 'game') {
			const s = MAIN.scale;
			return {
				...t,
				...MAIN.toWorld(t),
				scale: { x: (t.scale?.x ?? 1) * s, y: (t.scale?.y ?? 1) * s },
			};
		}
		return { ...t, ...anchoredPosition(t, space, FRAME.w, FRAME.h) };
	};
	type Placed = { x: number; y: number; scaleX: number; scaleY: number };
	const drawnBy = (t: ResolvedTransform, p: Placed): ResolvedTransform => ({
		...t,
		x: p.x,
		y: p.y,
		scale: { x: p.scaleX, y: p.scaleY },
	});
	const drawsInItsBox = (
		t: ResolvedTransform,
		space: Scene['space'],
		box: RigBox,
		place: (t: ResolvedTransform) => Placed,
	): boolean => {
		const [tl, , br] = nodeCornersWorld(
			boxWorld(t, space),
			nodeBox(rig(), t, () => reported(box)),
		);
		const f = drawnFrame(box, drawnBy(t, place(t)));
		return near(tl.x, f.l) && near(tl.y, f.t) && near(br.x, f.r) && near(br.y, f.b);
	};
	const shipped =
		(space: Scene['space']) =>
		(t: ResolvedTransform): Placed =>
			placedRigTransform(t, space, FRAME.w, FRAME.h, MAIN, HUD);
	// The reported node: R_Widget after ⊕ Centre origin, on a canvas screen anchored at its centre.
	const R_WIDGET: RigBox = { x: -487.5, y: -256, width: 975, height: 512 };
	const anchored = at({ x: 0, y: -15, screenAnchor: { x: 0.5, y: 0.5 } });
	check(
		'R_Widget, canvas, screen anchor 0.5/0.5: drawn inside its box',
		drawsInItsBox(anchored, 'canvas', R_WIDGET, shipped('canvas')),
	);
	{
		const p = placedRigTransform(anchored, 'canvas', FRAME.w, FRAME.h, MAIN, HUD);
		check(
			`R_Widget: its origin is the window centre less 15 px, as in the game (${p.x}, ${p.y})`,
			p.x === 960 && p.y === 525,
		);
	}
	// The old rule (the raw x/y) must fail this gate, or the gate proves nothing.
	check(
		'the raw x/y the layer used is caught',
		!drawsInItsBox(anchored, 'canvas', R_WIDGET, (t) => ({
			x: t.x,
			y: t.y,
			scaleX: t.scale?.x ?? 1,
			scaleY: t.scale?.y ?? 1,
		})),
	);
	const cases: [string, ResolvedTransform, Scene['space']][] = [
		[
			'canvas, anchored bottom-right, scaled',
			at({ x: -200, y: -100, screenAnchor: { x: 1, y: 1 }, scale: { x: 0.5, y: 0.5 } }),
			'canvas',
		],
		['canvas, no screen anchor', at(), 'canvas'],
		['game, scaled', at({ scale: { x: 1.5, y: 1.5 } }), 'game'],
	];
	for (const [name, t, space] of cases) {
		for (const [boxName, box] of [
			['widget', WIDGET],
			['centred', CENTRED],
		] as const) {
			check(
				`${boxName}, ${name}: drawn inside its box`,
				drawsInItsBox(t, space, box, shipped(space)),
			);
		}
	}
}

// Rule 8 — a rig on a `standard` (HUD) screen. The game wraps the screen in `<MainContainer
// standard>`: the standard box fitted into the window by `min(W / w, H / h)` about the window
// centre, then shifted to the edge its `align` asks for. Modelled here from that component, not
// from the editor's helper, so the box and the rig layer are both held to the game.
{
	const MAIN = { scale: 1, toWorld: (p: Vec2): Vec2 => p };
	const inGame = (
		t: ResolvedTransform,
		std: { width: number; height: number },
		align: Scene['align'],
		frame: { w: number; h: number },
	): { x: number; y: number; s: number } => {
		const s = Math.min(frame.w / std.width, frame.h / std.height);
		const dx =
			align?.horizontal === 'left'
				? -frame.w / 2 + (std.width * s) / 2
				: align?.horizontal === 'right'
					? frame.w / 2 - (std.width * s) / 2
					: 0;
		const dy =
			align?.vertical === 'top'
				? -frame.h / 2 + (std.height * s) / 2
				: align?.vertical === 'bottom'
					? frame.h / 2 - (std.height * s) / 2
					: 0;
		return {
			x: dx + frame.w / 2 + s * (t.x - std.width / 2),
			y: dy + frame.h / 2 + s * (t.y - std.height / 2),
			s,
		};
	};
	const hud = at({ x: 1500, y: 980, scale: { x: 0.8, y: 0.8 } });
	// The Scene Editor renders every screen, the HUD active or behind a game one, against the frame
	// the standard box sizes (`standardBox={frameSize}`, `frameWidth={frameSize.width}`).
	const editorFrame = { w: 1920, h: 1080 };
	const editorBox = { width: 1920, height: 1080 };
	const cases: [
		string,
		{ w: number; h: number },
		{ width: number; height: number },
		Scene['align'],
	][] = [
		['the HUD active', editorFrame, editorBox, undefined],
		[
			'the HUD behind a game screen, bottom-aligned',
			editorFrame,
			editorBox,
			{ vertical: 'bottom' },
		],
		[
			'a standard box narrower than the frame',
			{ w: 1920, h: 1080 },
			{ width: 1080, height: 1080 },
			undefined,
		],
		[
			'a narrower box hugging the right',
			{ w: 1920, h: 1080 },
			{ width: 1080, height: 1080 },
			{ horizontal: 'right' },
		],
		[
			'a shorter box hugging the top',
			{ w: 1080, h: 1920 },
			{ width: 1080, height: 1080 },
			{ vertical: 'top' },
		],
		[
			'a shorter box hugging the bottom',
			{ w: 1080, h: 1920 },
			{ width: 1080, height: 1080 },
			{ vertical: 'bottom' },
		],
	];
	const drawnAt = (
		frame: { w: number; h: number },
		std: { width: number; height: number },
		align: Scene['align'],
	) => placedRigTransform(hud, 'standard', frame.w, frame.h, MAIN, { box: std, align });
	for (const [name, frame, std, align] of cases) {
		const game = inGame(hud, std, align, frame);
		const box = standardToWorld(hud, std, align, frame.w, frame.h);
		const drawn = drawnAt(frame, std, align);
		check(
			`standard, ${name}: the box sits where the game draws the rig (${box.x}, ${box.y})`,
			near(box.x, game.x) && near(box.y, game.y) && near(box.scale?.x ?? 1, 0.8 * game.s),
		);
		check(
			`standard, ${name}: the rig draws where the game does (${drawn.x}, ${drawn.y})`,
			near(drawn.x, game.x) &&
				near(drawn.y, game.y) &&
				near(drawn.scaleX, 0.8 * game.s) &&
				near(drawn.scaleY, 0.8 * game.s),
		);
		for (const [boxName, rb] of [
			['widget', WIDGET],
			['centred', CENTRED],
		] as const) {
			const [tl, , br] = nodeCornersWorld(
				box,
				nodeBox(rig(), hud, () => reported(rb)),
			);
			const f = drawnFrame(rb, {
				...hud,
				x: drawn.x,
				y: drawn.y,
				scale: { x: drawn.scaleX, y: drawn.scaleY },
			});
			check(
				`${boxName}, standard, ${name}: drawn inside its box`,
				near(tl.x, f.l) && near(tl.y, f.t) && near(br.x, f.r) && near(br.y, f.b),
			);
		}
	}
	{
		const p = drawnAt(editorFrame, editorBox, { vertical: 'bottom' });
		check(
			`standard in the Scene Editor: the fit is the identity on either screen (${p.x}, ${p.y})`,
			p.x === 1500 && p.y === 980 && p.scaleX === 0.8 && p.scaleY === 0.8,
		);
	}
	// The raw x/y the layer used must fail where the fit is not the identity, or rule 8 proves
	// nothing about it.
	const narrow = inGame(hud, { width: 1080, height: 1080 }, undefined, { w: 1920, h: 1080 });
	check(
		'the raw x/y the layer used is caught for a standard box narrower than the frame',
		!near(hud.x, narrow.x) || !near(hud.y, narrow.y),
	);
}

if (fails) {
	console.error(`\n${fails} rig origin box check(s) failed`);
	process.exit(1);
}
console.log('rig origin box: all checks passed');
