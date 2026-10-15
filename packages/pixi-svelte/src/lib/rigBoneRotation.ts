/**
 * The Pixi `rotation` that turns a container the way a rig bone is turned on screen, expressed in
 * the container's PARENT frame — the rotation half of `<RigBoneAttach followRotation>`.
 *
 * A LEAF module (no Svelte, no PixiJS, no rig import) so a Node fixture can drive it against a real
 * engine-rig skeleton (`fixtures/rigBoneRotation.fixture.ts`).
 *
 * The bone's x-axis in the rig's local frame is `(a, c)`: RigView poses its skeleton y-down, so
 * that is already Pixi's orientation (the axis RigView turns a slot object to). It is carried
 * through `parent⁻¹ · rig`, because the parent is not always the rig's frame — a binding with a
 * draw slot mounts under that slot's host, which RigView already turns to the slot's bone.
 *
 * Only a rotation is returned, so when that chain MIRRORS (a follower mounted beside a flipped rig
 * rather than inside it) the follower is not mirrored with the bone. It stays upright and turns
 * the way the bone visibly turns, and the flip lands on the axis it was made on, as the editor's
 * `unrotatedScale` reads it: X when the chain's x-axis points backwards, Y otherwise. A follower
 * inside the rig shares the rig's mirror and needs none of this.
 */

/** A 2D affine's linear part in Pixi's layout: `x' = a·x + c·y`, `y' = b·x + d·y`. */
export interface Linear2D {
	a: number;
	b: number;
	c: number;
	d: number;
}

/** A bone's world x-axis; structurally an engine-rig `Bone` (`x' = a·x + b·y`, `y' = c·x + d·y`). */
export interface BoneAxis {
	a: number;
	c: number;
}

export function boneRotationInParent(
	bone: BoneAxis,
	rigWorld: Linear2D,
	parentWorld: Linear2D | null,
): number {
	let { a, b, c, d } = rigWorld;
	const pd = parentWorld ? parentWorld.a * parentWorld.d - parentWorld.b * parentWorld.c : 0;
	if (parentWorld && pd !== 0) {
		const ia = parentWorld.d / pd;
		const ib = -parentWorld.b / pd;
		const ic = -parentWorld.c / pd;
		const id = parentWorld.a / pd;
		[a, b, c, d] = [ia * a + ic * b, ib * a + id * b, ia * c + ic * d, ib * c + id * d];
	}
	if (a * d - b * c < 0 && a < 0) {
		// Mirrored on X: the follower's up-axis tracks the bone's, so a rest pose stays upright.
		const local = Math.atan2(bone.c, bone.a);
		const ux = -Math.sin(local);
		const uy = Math.cos(local);
		return Math.atan2(b * ux + d * uy, a * ux + c * uy) - Math.PI / 2;
	}
	return Math.atan2(b * bone.a + d * bone.c, a * bone.a + c * bone.c);
}
