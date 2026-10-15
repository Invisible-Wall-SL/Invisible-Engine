/**
 * Fixture for "the FX on the bone looks right in the Rigger but has a different orientation in
 * the game".
 *
 * `<RigBoneAttach followRotation>` took `-getWorldRotationX()` — a y-up → y-down flip of a
 * skeleton RigView already poses y-down — so a bone-bound FX turned the opposite way to its bone
 * (only 0° and 180° agreed). Under a slot binding it also added the slot host's own rotation.
 *
 * Asserts, against a REAL engine-rig skeleton posed y-down the way RigView poses it:
 * - the attachment's world x-axis points along the bone's on-screen x-axis — unslotted, in a
 *   fitted rig, in a rig flipped on X, and under a slot host on the same or another bone;
 * - the angle equals the Rigger preview's (a y-up skeleton projected into a y-down canvas, read as
 *   the angle of the projected x-axis, as `fxMatrix` reads it);
 * - the old formula disagrees with both at 90°.
 *
 * Run: pnpm --filter launcher-api exec tsx ../../packages/pixi-svelte/fixtures/rigBoneRotation.fixture.ts
 */
import { Skeleton, SkeletonJson, type AttachmentLoader, type Bone } from 'engine-rig';

import { boneRotationInParent } from '../src/lib/rigBoneRotation.ts';

type Affine = { a: number; b: number; c: number; d: number; tx: number; ty: number };

const RAD = Math.PI / 180;

/** `node:assert` has no types in this package (no `@types/node`), so a throw does its job. */
function check(ok: boolean, message: string): void {
	if (!ok) throw new Error(message);
}

/** No skins, so the attachment loader is never consulted. */
const loader = {} as AttachmentLoader;

function pose(rootRotation: number, armRotation: number, yDown: boolean): Bone {
	const data = new SkeletonJson(loader).readSkeletonData({
		skeleton: { spine: '4.2' },
		bones: [
			{ name: 'root', rotation: rootRotation },
			{ name: 'arm', parent: 'root', x: 100, rotation: armRotation },
		],
	});
	const skeleton = new Skeleton(data);
	skeleton.yDown = yDown;
	skeleton.updateWorldTransform(2);
	return skeleton.findBone('arm')!;
}

/** Pixi `m1 · m2`. */
function mul(m1: Affine, m2: Affine): Affine {
	return {
		a: m1.a * m2.a + m1.c * m2.b,
		b: m1.b * m2.a + m1.d * m2.b,
		c: m1.a * m2.c + m1.c * m2.d,
		d: m1.b * m2.c + m1.d * m2.d,
		tx: m1.a * m2.tx + m1.c * m2.ty + m1.tx,
		ty: m1.b * m2.tx + m1.d * m2.ty + m1.ty,
	};
}

const identity: Affine = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
const trs = (x: number, y: number, rotation: number, sx: number, sy: number): Affine => ({
	a: Math.cos(rotation) * sx,
	b: Math.sin(rotation) * sx,
	c: -Math.sin(rotation) * sy,
	d: Math.cos(rotation) * sy,
	tx: x,
	ty: y,
});
/** The matrix RigView's `placeSlotObject` gives a slot host on `bone`. */
const slotHost = (bone: Bone): Affine => ({
	a: bone.a,
	b: bone.c,
	c: -bone.b,
	d: -bone.d,
	tx: bone.worldX,
	ty: bone.worldY,
});

function angleDiff(x: number, y: number): number {
	const d = Math.atan2(Math.sin(x - y), Math.cos(x - y));
	return Math.abs(d);
}

/** The attachment's world x-axis must point the way the bone's does on screen. */
function assertRides(bone: Bone, rigWorld: Affine, parentWorld: Affine, label: string): number {
	const rotation = boneRotationInParent(bone, rigWorld, parentWorld);
	const child = mul(parentWorld, trs(0, 0, rotation, 1, 1));
	const boneAxis = {
		x: rigWorld.a * bone.a + rigWorld.c * bone.c,
		y: rigWorld.b * bone.a + rigWorld.d * bone.c,
	};
	const got = Math.atan2(child.b, child.a);
	const want = Math.atan2(boneAxis.y, boneAxis.x);
	check(
		angleDiff(got, want) < 1e-6,
		`${label}: attachment axis ${got / RAD}° vs bone ${want / RAD}°`,
	);
	return rotation;
}

const ANGLES = [0, 30, 90, 135, -60, 180, 270];

for (const root of [0, 45]) {
	for (const arm of ANGLES) {
		const bone = pose(root, arm, true);
		const label = `root ${root}° arm ${arm}°`;

		// Unslotted: the attachment's parent IS the rig's frame (RiggedEffect's `fxParent`/`fxLocal`).
		const unslotted = assertRides(bone, identity, identity, `${label}, unslotted`);
		const onScreen = Math.atan2(bone.c, bone.a);
		check(angleDiff(unslotted, onScreen) < 1e-12, `${label}: matches the slot-object angle`);

		// Rigger parity: same pose, y-up, projected into a y-down canvas, angle of the x-axis.
		const up = pose(root, arm, false);
		const L = 100;
		const rigger = Math.atan2(
			-(up.worldY + up.c * L) + up.worldY,
			up.worldX + up.a * L - up.worldX,
		);
		check(
			angleDiff(unslotted, rigger) < 1e-6,
			`${label}: game ${unslotted / RAD}° vs Rigger ${rigger / RAD}°`,
		);

		// A rig fitted into a cell (translate + uniform scale), the attachment under it.
		const fitted = trs(320, 180, 0, 0.4, 0.4);
		assertRides(bone, fitted, mul(fitted, trs(0, 0, 0, 1.5, 1.5)), `${label}, fitted`);

		// A rig flipped on X: the attachment inherits the flip and still lines up with the bone.
		const flipped = trs(320, 180, 0, -0.4, 0.4);
		assertRides(bone, flipped, flipped, `${label}, flipped X`);

		// A draw-slot binding: the parent is the slot host RigView turns to the slot's bone.
		const sameSlot = assertRides(
			bone,
			fitted,
			mul(fitted, slotHost(bone)),
			`${label}, slot on bone`,
		);
		check(angleDiff(sameSlot, 0) < 1e-6, `${label}: slot on the same bone adds no rotation`);
		const other = pose(root, 0, true);
		assertRides(bone, fitted, mul(fitted, slotHost(other)), `${label}, slot on another bone`);

		// A sibling host (the parent is the rig's parent, not the rig).
		assertRides(bone, fitted, identity, `${label}, sibling`);
	}
}

// The old formula: right at 0°/180°, mirrored everywhere else.
const quarter = pose(0, 90, true);
const old = -quarter.getWorldRotationX() * RAD;
const fixed = boneRotationInParent(quarter, identity, identity);
check(angleDiff(old, fixed) > 3, 'the old -getWorldRotationX() formula is 180° off at 90°');
check(
	angleDiff(fixed, -90 * RAD) < 1e-6,
	'a bone turned 90° CCW turns the attachment -90° in Pixi',
);

console.log('rigBoneRotation fixture: all assertions passed');
