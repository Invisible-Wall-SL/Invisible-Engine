/**
 * Fixture for "`anchor` on a rig means the point of its Bounds frame that lands on (x, y)".
 *
 * `<RigProvider>` used to pivot a rig by the sprite rule — `anchor × requested width/height` — which
 * assumes the art's top-left sits at local (0, 0) and reads a DISPLAY size as a LOCAL offset. A rig's
 * local space is skeleton space (origin at the skeleton origin, y flipped, load-scaled), so
 * `anchor={0.5}` shifted the art by ≈ scale × box/2 and every caller that wanted a centred rig worked
 * around it. The rule now: the anchor picks a point of the authored box (`skeleton.{x,y,width,height}`,
 * the Rigger's Bounds frame), read y-down like a sprite's anchor; no anchor keeps the skeleton origin.
 *
 * Asserts, against a REAL `SkeletonJson` parse (so the `x`/`y`-come-through-undefined premise is
 * tested, not assumed): a centred header at anchor 0.5 is a no-op pivot (parity for every shipped
 * rig), an off-centre header yields the pivot that lands the box centre on (x, y), the load scale the
 * reader baked into the geometry scales that pivot, y is flipped into pixi's y-down local space, the
 * corners land where their anchor says at any display scale, an explicit 0 anchor is read as 0, and a
 * header with a size but no `x`/`y` keeps the origin-centred reading.
 *
 * Run: pnpm --filter launcher-api exec tsx ../../packages/pixi-svelte/fixtures/rigBox.fixture.ts
 */
import assert from 'node:assert/strict';

import { SkeletonJson, type AttachmentLoader } from 'engine-rig';

import { authoredRigBox, type RigBox } from '../../constants-shared/rig.ts';
import { rigAnchorPoint, rigFramePivot } from '../src/lib/rigBox.ts';

/** No skins in these skeletons, so the attachment loader is never consulted. */
const loader = {} as AttachmentLoader;

function parse(header: Record<string, number | string>) {
	const json = new SkeletonJson(loader);
	return json.readSkeletonData({
		skeleton: { spine: '4.2', ...header },
		bones: [{ name: 'root' }],
	});
}

/** The authored box of a parsed header — asserting there IS one, so the callers below type as `RigBox`. */
function boxOf(header: Record<string, number | string>): RigBox {
	const box = authoredRigBox(parse(header));
	if (!box) throw new Error(`no authored box for ${JSON.stringify(header)}`);
	return box;
}

const CENTRE = { x: 0.5, y: 0.5 };

/**
 * Where a skeleton-space point (y UP) is drawn by a pixi container at `pos` with `pivot` and a uniform
 * `scale`, the geometry read at `loadScale`: local = (x·L, −y·L), world = pos + scale·(local − pivot).
 */
function drawn(
	point: { x: number; y: number },
	pos: { x: number; y: number },
	pivot: { x: number; y: number },
	scale: number,
	loadScale: number,
) {
	return {
		x: pos.x + scale * (point.x * loadScale - pivot.x),
		y: pos.y + scale * (-point.y * loadScale - pivot.y),
	};
}

// 1. An external rig editor export: box centred on the origin ⇒ the centre anchor pivots at (0,0) at
//    ANY load scale — byte-parity for every rig that already looked right.
{
	const box = boxOf({ x: -414, y: -546, width: 828, height: 1092 });
	assert.deepEqual(box, { x: -414, y: -546, width: 828, height: 1092 });
	for (const load of [1, 2]) assert.deepEqual(rigFramePivot(box, CENTRE, load), { x: 0, y: -0 });
	// h1's real header is centred to within a header unit (its extent was rounded outwards so
	// the art can never clip) — the pivot carries that sub-pixel truth instead of assuming 0.
	const h1 = boxOf({ x: -613.43, y: -620.56, width: 1225.25, height: 1241.81 });
	const p = rigFramePivot(h1, CENTRE, 1);
	assert.ok(
		Math.abs(p.x) < 1 && Math.abs(p.y) < 1,
		`h1 centre within a header unit: ${p.x},${p.y}`,
	);
}

// 2. A Rigger rig whose root sits at its feet: the measured frame spans x ∈ [-100, 100],
//    y ∈ [0, 300] (y-UP). Its centre is (0, 150) in skeleton space ⇒ pixi-local (0, -150) at
//    load 1 — the pivot that puts the frame's centre, not the feet, on the cell centre.
{
	const box = boxOf({ x: -100, y: 0, width: 200, height: 300 });
	assert.deepEqual(rigFramePivot(box, CENTRE, 1), { x: 0, y: -150 });
	// The symbol bundles load at SYMBOL_RIG_LOAD_SCALE (2): the geometry is twice as big in
	// local space while the header is not, so the pivot doubles with it.
	assert.deepEqual(rigFramePivot(box, CENTRE, 2), { x: 0, y: -300 });
}

// 3. A frame dragged off to the side: x ∈ [50, 250], y ∈ [-20, 80] ⇒ centre (150, 30) ⇒ local
//    (150, -30). Both axes carry, and y flips.
{
	const box = boxOf({ x: 50, y: -20, width: 200, height: 100 });
	assert.deepEqual(rigFramePivot(box, CENTRE, 1), { x: 150, y: -30 });
}

// 4. Every anchor lands ITS frame point on (x, y), whatever the display scale the size fit gives the
//    rig — the pivot is in the rig's local units, so it never reads the requested width/height. The
//    old sprite rule pivoted `anchor × requested size` and missed by ≈ scale × box/2.
{
	const box = boxOf({ x: 50, y: -20, width: 200, height: 100 });
	const pos = { x: 640, y: 360 };
	// Skeleton-space (y-UP) corners of the frame, keyed by the y-DOWN anchor that names them.
	const corners: Array<[{ x: number; y: number }, { x: number; y: number }]> = [
		[
			{ x: 0, y: 0 },
			{ x: 50, y: 80 },
		], // top-left
		[
			{ x: 1, y: 0 },
			{ x: 250, y: 80 },
		], // top-right
		[
			{ x: 0, y: 1 },
			{ x: 50, y: -20 },
		], // bottom-left
		[
			{ x: 1, y: 1 },
			{ x: 250, y: -20 },
		], // bottom-right
		[CENTRE, { x: 150, y: 30 }],
	];
	for (const load of [1, 2])
		for (const scale of [0.25, 1, 3])
			for (const [anchor, point] of corners) {
				const at = drawn(point, pos, rigFramePivot(box, anchor, load), scale, load);
				assert.ok(
					Math.abs(at.x - pos.x) < 1e-9 && Math.abs(at.y - pos.y) < 1e-9,
					`anchor ${JSON.stringify(anchor)} at load ${load}, scale ${scale}: ${at.x},${at.y}`,
				);
			}
	// And the frame is drawn the right way up: at anchor 0 the frame hangs down and right of (x, y).
	const pivot = rigFramePivot(box, { x: 0, y: 0 }, 1);
	const bottomRight = drawn({ x: 250, y: -20 }, pos, pivot, 1, 1);
	assert.deepEqual(bottomRight, { x: pos.x + 200, y: pos.y + 100 });
}

// 5. The anchor is read per axis, and an explicit 0 is 0 — `getPointValues` read `point?.x || default`,
//    which only agreed because its default happened to be 0 too.
{
	assert.deepEqual(rigAnchorPoint(0), { x: 0, y: 0 });
	assert.deepEqual(rigAnchorPoint(0.5), { x: 0.5, y: 0.5 });
	assert.deepEqual(rigAnchorPoint({ x: 0, y: 1 }), { x: 0, y: 1 });
	assert.deepEqual(rigAnchorPoint({ x: 1 }), { x: 1, y: 0 });
}

// 6. Why centring on the frame is NOT the default: stock coded rigs are authored around their
//    origin with setup boxes far off it (headers copied from `apps/lines/static/assets/spines/`),
//    so the centre anchor would move them; an unanchored mount keeps the origin.
{
	const stock: Array<[string, RigBox, { x: number; y: number }]> = [
		['bigwin/mm_bigwin', { x: -200, y: -200, width: 1600, height: 1600 }, { x: 600, y: -600 }],
		[
			'transition/transition',
			{ x: -1756.51, y: -374.21, width: 3422.57, height: 3603.95 },
			{ x: -45.225, y: -1427.765 },
		],
		[
			'fsIntro/fs_screen_number',
			{ x: -130, y: -141.37, width: 260, height: 195 },
			{ x: 0, y: 43.87 },
		],
	];
	for (const [name, box, expected] of stock) {
		const p = rigFramePivot(box, CENTRE, 1);
		assert.ok(
			Math.abs(p.x - expected.x) < 1e-6 && Math.abs(p.y - expected.y) < 1e-6,
			`${name}: centre pivot ${p.x},${p.y}`,
		);
	}
}

// 7. A header with a size but no x/y: `SkeletonJson` leaves them undefined (NOT 0), and the box
//    keeps the origin-centred reading such an export was authored against.
{
	const data = parse({ width: 400, height: 200 });
	assert.equal(data.x, undefined, 'the reader copies a missing x through as undefined');
	assert.equal(data.y, undefined);
	assert.deepEqual(authoredRigBox(data), { x: -200, y: -100, width: 400, height: 200 });
	assert.deepEqual(rigFramePivot({ x: -200, y: -100, width: 400, height: 200 }, CENTRE, 1), {
		x: 0,
		y: -0,
	});
}

// 8. No size at all ⇒ no box: `<RigProvider>` leaves the pivot to `<BaseRigProvider>`'s live-bounds
//    fallback, which applies the same frame-point rule to the bounds it can measure.
assert.equal(authoredRigBox(parse({})), null);
assert.equal(authoredRigBox({ x: 0, y: 0, width: 0, height: 10 }), null);

console.log('rigBox fixture: ok');
