/**
 * The Pixi `rotation` that turns a container the way a rig bone is turned on screen, expressed in
 * the container's PARENT frame — the rotation half of `<RigBoneAttach followRotation>`.
 *
 * A LEAF module (no Svelte, no PixiJS, no rig import) so a Node fixture can drive it against a real
 * engine-rig skeleton (`fixtures/rigBoneRotation.fixture.ts`).
 *
 * The bone's x-axis in the rig's local frame is `(a, c)`. RigView poses its skeleton y-down, so
 * that vector is already in Pixi's orientation — it is the axis RigView turns a slot object to. It
 * used to be read as `-getWorldRotationX()`, a y-up → y-down flip of a skeleton that is already
 * y-down, so every bone-bound FX or clip turned the opposite way to its bone in the game, while the
 * Rigger and `/symbols` previews (which take the angle of the projected x-axis) turned it the right
 * way.
 *
 * The axis is then carried to world by the rig's transform and back into the parent's frame,
 * because the parent is not always the rig's frame: a binding with a draw slot mounts under that
 * slot's host, which RigView already turns to the slot's bone. Assigning the bone's angle there
 * added the slot bone's rotation on top.
 *
 * Only the axis's DIRECTION is kept — a reflection in the chain turns the attachment rather than
 * mirroring it, the rule the previews' `fxMatrix` applies.
 */

/** A 2D affine's linear part in Pixi's layout: `x' = a·x + c·y`, `y' = b·x + d·y`. */
export interface Linear2D {
	a: number;
	b: number;
	c: number;
	d: number;
}

/** The bone's world x-axis — structurally an engine-rig `Bone` (`x' = a·x + b·y`, `y' = c·x + d·y`). */
export interface BoneAxis {
	a: number;
	c: number;
}

export function boneRotationInParent(
	bone: BoneAxis,
	rigWorld: Linear2D,
	parentWorld: Linear2D | null,
): number {
	let x = rigWorld.a * bone.a + rigWorld.c * bone.c;
	let y = rigWorld.b * bone.a + rigWorld.d * bone.c;
	const det = parentWorld ? parentWorld.a * parentWorld.d - parentWorld.b * parentWorld.c : 0;
	if (parentWorld && det !== 0) {
		const px = (parentWorld.d * x - parentWorld.c * y) / det;
		y = (parentWorld.a * y - parentWorld.b * x) / det;
		x = px;
	}
	return Math.atan2(y, x);
}
