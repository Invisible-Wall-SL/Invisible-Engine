/**
 * Fixture for "the rig bounds I author in the Rigger don't match what the game draws".
 *
 * Every contain-fit consumer read only `skeleton.width/height` and placed the box as if it were
 * centred on the origin. A Rigger rig's Bounds frame is the measured setup-pose extent or a frame
 * the author dragged — rarely centred — so the game drew the box's SIZE right and its PLACE wrong
 * (skeleton origin at the cell centre) while the Rigger showed the box centre there.
 *
 * Asserts, against a REAL `SkeletonJson` parse (so the `x`/`y`-come-through-undefined premise is
 * tested, not assumed): a centred header is a no-op pivot (parity for every shipped rig), an
 * off-centre header yields the pivot that lands the box centre on (x, y), the load scale the
 * reader baked into the geometry scales that pivot, y is flipped into pixi's y-down local space,
 * and a header with a size but no `x`/`y` keeps the origin-centred reading.
 *
 * Run: node --experimental-strip-types packages/pixi-svelte/fixtures/spineBox.fixture.ts
 */
import assert from 'node:assert/strict';

import { SkeletonJson } from '@esotericsoftware/spine-core';

import { authoredSpineBox, type SpineBox } from '../../constants-shared/spine.ts';
import { spineBoxPivot } from '../src/lib/spineBox.ts';

/** No skins in these skeletons, so the attachment loader is never consulted. */
const loader = {} as unknown as ConstructorParameters<typeof SkeletonJson>[0];

function parse(header: Record<string, number | string>) {
	const json = new SkeletonJson(loader);
	return json.readSkeletonData({
		skeleton: { spine: '4.2', ...header },
		bones: [{ name: 'root' }],
	});
}

/** The authored box of a parsed header — asserting there IS one, so the callers below type as `SpineBox`. */
function boxOf(header: Record<string, number | string>): SpineBox {
	const box = authoredSpineBox(parse(header));
	if (!box) throw new Error(`no authored box for ${JSON.stringify(header)}`);
	return box;
}

// 1. A Spine-editor export: box centred on the origin ⇒ pivot (0,0) at ANY load scale —
//    byte-parity for every rig that already looked right.
{
	const box = boxOf({ x: -414, y: -546, width: 828, height: 1092 });
	assert.deepEqual(box, { x: -414, y: -546, width: 828, height: 1092 });
	for (const load of [1, 2]) assert.deepEqual(spineBoxPivot(box, load), { x: 0, y: -0 });
	// h1's real header is centred to within a header unit (its extent was rounded outwards so
	// the art can never clip) — the pivot now carries that sub-pixel truth instead of assuming 0.
	const h1 = boxOf({ x: -613.43, y: -620.56, width: 1225.25, height: 1241.81 });
	const p = spineBoxPivot(h1, 1);
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
	assert.deepEqual(spineBoxPivot(box, 1), { x: 0, y: -150 });
	// The symbol bundles load at SYMBOL_SPINE_LOAD_SCALE (2): the geometry is twice as big in
	// local space while the header is not, so the pivot doubles with it.
	assert.deepEqual(spineBoxPivot(box, 2), { x: 0, y: -300 });
}

// 3. A frame dragged off to the side: x ∈ [50, 250], y ∈ [-20, 80] ⇒ centre (150, 30) ⇒ local
//    (150, -30). Both axes carry, and y flips.
{
	const box = boxOf({ x: 50, y: -20, width: 200, height: 100 });
	assert.deepEqual(spineBoxPivot(box, 1), { x: 150, y: -30 });
}

// 4. A header with a size but no x/y: `SkeletonJson` leaves them undefined (NOT 0), and the box
//    keeps the origin-centred reading such an export was authored against.
{
	const data = parse({ width: 400, height: 200 });
	assert.equal(data.x, undefined, 'the reader copies a missing x through as undefined');
	assert.equal(data.y, undefined);
	assert.deepEqual(authoredSpineBox(data), { x: -200, y: -100, width: 400, height: 200 });
}

// 5. No size at all ⇒ no box (the carrier-rig fallback path stays untouched).
assert.equal(authoredSpineBox(parse({})), null);
assert.equal(authoredSpineBox({ x: 0, y: 0, width: 0, height: 10 }), null);

console.log('spineBox fixture: ok');
