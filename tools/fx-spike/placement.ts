/**
 * Invisible FX — Phase 2 (Tier B, Spine-attach) headless harness for the PURE placement +
 * bone-follow logic (`fxModel.client.ts`). The live Spine pixels + the per-frame
 * `updateOwnerPos` ride are NOT browser-verifiable here (authed WebGL), so — exactly as the
 * sibling tools do — we cover the math the stage's bone-follow stands on OFFLINE, in Node:
 *
 *   pnpm --filter fx-spike run placement
 *
 * Proves: (1) the placement mutators (`setPlacementSpace` / `setPlacementBone` /
 * `setPlacementOffset`) are PURE + immutable, edit ONLY `placement` (never the verbatim
 * `config`), and the free↔bone toggle is non-destructive (keeps bone+offset across toggles,
 * drops the bone only when going free); (2) `layerFollowsBone` gates correctly (a `bone`
 * layer with no bone yet does NOT follow — it spawns at origin so the preview never
 * vanishes); (3) `worldToContainerLocal` is the exact affine inverse PixiJS's
 * `Matrix.applyInverse` computes (round-trips a forward transform, handles pan + zoom);
 * (4) `emitterOwnerLocal` puts a free layer at scene-origin+offset and a bone layer at the
 * live bone world point + offset, both mapped into the panned/zoomed container's local space.
 */

import type { EmitterLayer } from 'engine-fx';
import {
	type Affine,
	emitterOwnerLocal,
	layerFollowsBone,
	newLayer,
	setPlacementBone,
	setPlacementOffset,
	setPlacementSpace,
	worldToContainerLocal,
} from '../../apps/launcher-api/src/routes/(app)/fx/fxModel.client';

let failures = 0;
const assert = (cond: boolean, msg: string): void => {
	if (cond) {
		console.log(`  ✓ ${msg}`);
	} else {
		failures++;
		console.error(`  ✗ ${msg}`);
	}
};
const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const close = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

// ---------------------------------------------------------------------------
// 1. Placement mutators are pure, immutable, and never touch `config`.
// ---------------------------------------------------------------------------
console.log('fx placement — mutators');
const base = newLayer('layer-1');
const baseSnapshot = JSON.stringify(base);

const toBone = setPlacementSpace(base, 'bone');
assert(JSON.stringify(base) === baseSnapshot, 'setPlacementSpace does not mutate its input');
assert(base.placement.space === 'free', 'input layer stays free (immutable)');
assert(toBone.placement.space === 'bone', 'result layer is bone-placed');
assert(eq(toBone.config, base.config), 'setPlacementSpace leaves `config` byte-identical');

const onBone = setPlacementBone(toBone, 'torch_tip');
assert(onBone.placement.bone === 'torch_tip', 'setPlacementBone sets the bone name');
assert(onBone.placement.space === 'bone', 'setPlacementBone keeps space=bone');
assert(eq(onBone.config, base.config), 'setPlacementBone leaves `config` byte-identical');

const offX = setPlacementOffset(onBone, 'x', 12);
const offXY = setPlacementOffset(offX, 'y', -34);
assert(eq(offXY.placement.offset, { x: 12, y: -34 }), 'setPlacementOffset accumulates x then y');
assert(onBone.placement.offset === undefined, 'offset edits do not mutate the prior layer');
assert(eq(offXY.config, base.config), 'setPlacementOffset leaves `config` byte-identical');

// free↔bone toggle is non-destructive for bone+offset, but going free drops the bone.
const backFree = setPlacementSpace(offXY, 'free');
assert(backFree.placement.space === 'free', 'toggle back to free');
assert(backFree.placement.bone === undefined, 'going free drops the bone name');
assert(eq(backFree.placement.offset, { x: 12, y: -34 }), 'going free keeps the offset');
const reBone = setPlacementSpace(backFree, 'bone');
assert(eq(reBone.placement.offset, { x: 12, y: -34 }), 'toggling back to bone keeps the offset');

// ---------------------------------------------------------------------------
// 2. layerFollowsBone gating.
// ---------------------------------------------------------------------------
console.log('fx placement — follow gating');
assert(!layerFollowsBone(base), 'a free layer does not follow a bone');
const boneNoName = setPlacementSpace(base, 'bone');
assert(
	!layerFollowsBone(boneNoName),
	'a bone layer with NO bone name does not follow (spawns at origin)',
);
assert(layerFollowsBone(setPlacementBone(boneNoName, 'tip')), 'a bone layer WITH a bone follows');
assert(
	!layerFollowsBone({ ...boneNoName, placement: { space: 'bone', bone: '   ' } } as EmitterLayer),
	'a whitespace-only bone name does not follow',
);

// ---------------------------------------------------------------------------
// 3. worldToContainerLocal is the exact affine inverse (round-trips a forward transform).
// ---------------------------------------------------------------------------
console.log('fx placement — world→container-local inverse');
// A pan+zoom container world transform (scale 2, translate 100/50) — the stage's world.
const world: Affine = { a: 2, b: 0, c: 0, d: 2, tx: 100, ty: 50 };
// Forward-apply a local point, then invert it back — must recover the original.
const localPt = { x: 17, y: -9 };
const worldPt = {
	x: world.a * localPt.x + world.c * localPt.y + world.tx,
	y: world.b * localPt.x + world.d * localPt.y + world.ty,
};
const recovered = worldToContainerLocal(world, worldPt);
assert(
	close(recovered.x, localPt.x) && close(recovered.y, localPt.y),
	'inverse round-trips a forward transform (pan+zoom)',
);
// The world origin maps to local (-tx/scale, -ty/scale) under this transform.
const originLocal = worldToContainerLocal(world, { x: 0, y: 0 });
assert(
	close(originLocal.x, -50) && close(originLocal.y, -25),
	'world origin → expected container-local under pan+zoom',
);
// A rotation+scale transform also inverts correctly.
const rot: Affine = { a: 0, b: 3, c: -3, d: 0, tx: 5, ty: 7 };
const rl = { x: 4, y: 1 };
const rw = {
	x: rot.a * rl.x + rot.c * rl.y + rot.tx,
	y: rot.b * rl.x + rot.d * rl.y + rot.ty,
};
const rr = worldToContainerLocal(rot, rw);
assert(close(rr.x, rl.x) && close(rr.y, rl.y), 'inverse handles a rotation+scale transform');

// ---------------------------------------------------------------------------
// 4. emitterOwnerLocal — free vs bone spawn position.
// ---------------------------------------------------------------------------
console.log('fx placement — emitter owner position');
// Identity container world (no pan/zoom) so owner-local == owner-world for clarity.
const id: Affine = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

// Free layer, no offset → spawns at scene origin (0,0).
const freeOwner = emitterOwnerLocal(base, null, id);
assert(
	close(freeOwner.x, 0) && close(freeOwner.y, 0),
	'free layer with no offset spawns at origin',
);

// Free layer with offset → spawns at the offset.
const freeOffset = setPlacementOffset(base, 'x', 30);
const freeOffLayer = setPlacementOffset(freeOffset, 'y', 40);
const freeOffOwner = emitterOwnerLocal(freeOffLayer, null, id);
assert(close(freeOffOwner.x, 30) && close(freeOffOwner.y, 40), 'free layer spawns at its offset');

// A free layer's offset is in the CENTRED container's OWN local space — it must NOT be
// re-mapped through the world transform (doing so anchored it to the canvas TOP-LEFT, not the
// centre). So under a pan/zoom `world` the owner is STILL just the offset.
const freeOwnerPZ = emitterOwnerLocal(freeOffLayer, null, world);
assert(
	close(freeOwnerPZ.x, 30) && close(freeOwnerPZ.y, 40),
	'free layer ignores the container transform (spawns at the centred scene origin + offset, not the canvas corner)',
);
const freeOriginPZ = emitterOwnerLocal(base, null, world);
assert(
	close(freeOriginPZ.x, 0) && close(freeOriginPZ.y, 0),
	'free + no offset spawns at the scene origin under pan/zoom (not world 0,0)',
);

// Bone layer with a resolved bone world point + offset → bone + offset.
const boneLayer = setPlacementOffset(
	setPlacementBone(setPlacementSpace(base, 'bone'), 'tip'),
	'x',
	5,
);
const boneOwner = emitterOwnerLocal(boneLayer, { x: 200, y: 120 }, id);
assert(
	close(boneOwner.x, 205) && close(boneOwner.y, 120),
	'bone layer spawns at bone world + offset',
);

// Bone layer under a panned/zoomed container → maps into container-local.
const boneOwnerPZ = emitterOwnerLocal(boneLayer, { x: 200, y: 120 }, world);
// expected local = ((205-100)/2, (120-50)/2) = (52.5, 35)
assert(
	close(boneOwnerPZ.x, 52.5) && close(boneOwnerPZ.y, 35),
	'bone owner maps through pan+zoom into container-local',
);

// A bone layer whose bone has not resolved yet (null) falls back to the scene origin+offset
// — the preview keeps spawning instead of vanishing.
const boneUnresolved = emitterOwnerLocal(boneLayer, null, id);
assert(
	close(boneUnresolved.x, 5) && close(boneUnresolved.y, 0),
	'unresolved bone falls back to origin+offset',
);

// ---------------------------------------------------------------------------
console.log('');
if (failures === 0) {
	console.log('fx placement — ALL GREEN');
} else {
	console.error(`fx placement — ${failures} FAILURE(S)`);
	process.exit(1);
}
