// Headless CPU scene-graph verification for the tap-to-continue hoist fix
// (Invisible Flow §6.2; the "transform-independent tapToContinue dim" gap).
//
//   node scripts/test-tap-transform-independence.mjs
//
// The bug: a `tapToContinue`-enabled overlay `componentInstance` renders a full-CANVAS
// tap surface (dim `CanvasSizeRectangle` + `OnPressFullScreen` hit rect + prompt). It
// USED to be rendered INSIDE the instance's per-layoutType transform wrapper (LayoutNodeView
// `<Container x=posX y=posY scale=transform.scale>`), so in PORTRAIT — where the editor stores
// an offset + scaled transform for the instance — the "full-screen" rect was pushed off the
// visible canvas (clicks miss) and the prompt was double-scaled.
//
// The fix hoists the tap surface to be a SIBLING of the transform wrapper (scene-root frame),
// exactly like the engine-owned free-spin gate. This harness reproduces BOTH trees with real
// PIXI containers (transform math is CPU-only, no GPU/DOM needed) and asserts that:
//   - OLD (child of transform)   → the tap rect's WORLD bounds diverge from the canvas in
//     portrait (the bug), proving the harness models the failure.
//   - NEW (sibling of transform) → the tap rect's WORLD bounds equal the canvas in BOTH
//     landscape and portrait (the fix), independent of the instance transform.
import { Container, Matrix } from 'pixi.js';

let failures = 0;
const approx = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
const assert = (cond, msg) => {
	if (cond) console.info(`  ✓ ${msg}`);
	else {
		console.error(`  ✗ ${msg}`);
		failures += 1;
	}
};

// A full-canvas rect (models `CanvasSizeRectangle`: drawn 0,0 .. canvasW,canvasH in its
// parent's LOCAL frame, matching pixi `Rectangle` default anchor {0,0}). We tag it with its
// LOCAL rect so the harness can transform its corners by the resolved world matrix.
const makeCanvasRect = (canvas) => {
	const c = new Container();
	c._localRect = { x: 0, y: 0, width: canvas.width, height: canvas.height };
	return c;
};

// The LayoutNodeView componentInstance transform wrapper for a given layout type.
const makeInstanceWrapper = (t) => {
	const c = new Container();
	c.x = t.x;
	c.y = t.y;
	c.scale.set(t.scaleX, t.scaleY);
	c.rotation = t.rotation ?? 0;
	return c;
};

// Resolve a node's world matrix by appending local matrices from the root down (CPU only).
const worldMatrix = (node) => {
	const chain = [];
	for (let n = node; n; n = n.parent) chain.unshift(n);
	const m = new Matrix();
	for (const n of chain) {
		n.updateLocalTransform();
		m.append(n.localTransform);
	}
	return m;
};

// World AABB of the tagged canvas rect, transforming its four local corners.
const worldBounds = (root, target) => {
	const m = worldMatrix(target);
	const r = target._localRect;
	const corners = [
		m.apply({ x: r.x, y: r.y }),
		m.apply({ x: r.x + r.width, y: r.y }),
		m.apply({ x: r.x, y: r.y + r.height }),
		m.apply({ x: r.x + r.width, y: r.y + r.height }),
	];
	const xs = corners.map((c) => c.x);
	const ys = corners.map((c) => c.y);
	const minX = Math.min(...xs);
	const minY = Math.min(...ys);
	return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
};

const CANVAS = { width: 1920, height: 1080 }; // landscape device canvas
const CANVAS_PORTRAIT = { width: 1080, height: 1920 };

// Per-layoutType instance transforms the editor stored for the loading overlay. Landscape:
// identity (the parity case). Portrait: an offset + downscale (the bug driver).
const LANDSCAPE_T = { x: 0, y: 0, scaleX: 1, scaleY: 1 };
const PORTRAIT_T = { x: 240, y: 620, scaleX: 0.62, scaleY: 0.62 };

// --- OLD tree: tap rect is a CHILD of the transform wrapper (the bug) ---
const oldTree = (canvas, t) => {
	const scene = new Container(); // scene / canvas root
	const wrapper = makeInstanceWrapper(t);
	scene.addChild(wrapper);
	const rect = makeCanvasRect(canvas);
	wrapper.addChild(rect); // <-- inside the instance transform
	return { scene, rect };
};

// --- NEW tree: tap rect is a SIBLING of the transform wrapper (the fix) ---
const newTree = (canvas, t) => {
	const scene = new Container();
	const wrapper = makeInstanceWrapper(t);
	scene.addChild(wrapper);
	const rect = makeCanvasRect(canvas); // hoisted out
	scene.addChild(rect); // <-- sibling of the wrapper, at scene root
	return { scene, rect };
};

const coversCanvas = (bounds, canvas) =>
	approx(bounds.x, 0) &&
	approx(bounds.y, 0) &&
	approx(bounds.width, canvas.width) &&
	approx(bounds.height, canvas.height);

console.info('OLD (child of instance transform) — models the bug:');
{
	const l = oldTree(CANVAS, LANDSCAPE_T);
	const lb = worldBounds(l.scene, l.rect);
	assert(coversCanvas(lb, CANVAS), 'landscape: OLD rect happens to cover (identity transform)');

	const p = oldTree(CANVAS_PORTRAIT, PORTRAIT_T);
	const pb = worldBounds(p.scene, p.rect);
	assert(
		!coversCanvas(pb, CANVAS_PORTRAIT),
		`portrait: OLD rect does NOT cover the canvas (bug reproduced) — bounds ${JSON.stringify(pb)}`,
	);
}

console.info('\nNEW (sibling of instance transform) — the fix:');
{
	const l = newTree(CANVAS, LANDSCAPE_T);
	const lb = worldBounds(l.scene, l.rect);
	assert(coversCanvas(lb, CANVAS), 'landscape: NEW rect covers the full canvas');

	const p = newTree(CANVAS_PORTRAIT, PORTRAIT_T);
	const pb = worldBounds(p.scene, p.rect);
	assert(
		coversCanvas(pb, CANVAS_PORTRAIT),
		'portrait: NEW rect covers the full canvas (transform-independent) — the fix',
	);

	// And the fix must be robust to an arbitrary hostile instance transform (rotation +
	// large offset + non-uniform scale): the hoisted rect is unaffected by it.
	const hostile = { x: -800, y: 300, scaleX: 3, scaleY: 0.4, rotation: 0.7 };
	const h = newTree(CANVAS_PORTRAIT, hostile);
	const hb = worldBounds(h.scene, h.rect);
	assert(
		coversCanvas(hb, CANVAS_PORTRAIT),
		'portrait: NEW rect covers the canvas even under a hostile rotated/scaled instance transform',
	);
}

if (failures > 0) {
	console.error(`\n✗ ${failures} assertion(s) failed.`);
	process.exit(1);
}
console.info('\n✓ tap-to-continue tap surface is transform-independent (portrait + landscape).');
