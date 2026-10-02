/**
 * Offset a spine bone ON TOP of the pose its animation gave it — the bone half of a layout value
 * binding (`engine-layout` `ValueBinding` target `bone`). Pure and runtime-agnostic: the game's
 * `<SpineBone offset>` and the Scene / Component Editor's WebGL preview both pose through this, so
 * "grow the belly bone with the pot level" means the same thing in both.
 *
 * A LEAF module (no Svelte, no PixiJS, no spine import), exported as `pixi-svelte/spineBoneOffset`,
 * so the editor and `engine-layout`'s bare entry can import it without pulling in the barrel.
 *
 * The offset is applied after the animation state poses the skeleton and before its world
 * transform, then UNDONE once the world transform is computed. Undoing is what keeps it from
 * compounding: a channel no animation keys is never re-written by the state, so a multiply left in
 * place would grow the bone every frame.
 *
 * Screen conventions, the same as every other transform an author sets: `y` positive moves DOWN
 * and `rotation` positive turns CLOCKWISE, both inverted into spine's y-up space here (the
 * `<SpineBone>` `y` prop makes the same inversion). `x`/`y` are in the bone's parent space.
 */

/** The bone fields an offset touches — structurally a spine `Bone`. */
export type SpineBonePose = {
	x: number;
	y: number;
	rotation: number;
	scaleX: number;
	scaleY: number;
};

/** Added (`x`, `y`, `rotation` in degrees) or multiplied (`scaleX`, `scaleY`). Absent ⇒ untouched. */
export type SpineBoneOffset = {
	x?: number;
	y?: number;
	rotation?: number;
	scaleX?: number;
	scaleY?: number;
};

/** Apply `offset` to `bone` and return the function that puts the pose back exactly. */
export function applySpineBoneOffset(bone: SpineBonePose, offset: SpineBoneOffset): () => void {
	const base = {
		x: bone.x,
		y: bone.y,
		rotation: bone.rotation,
		scaleX: bone.scaleX,
		scaleY: bone.scaleY,
	};
	if (offset.x !== undefined) bone.x += offset.x;
	if (offset.y !== undefined) bone.y -= offset.y;
	if (offset.rotation !== undefined) bone.rotation -= offset.rotation;
	if (offset.scaleX !== undefined) bone.scaleX *= offset.scaleX;
	if (offset.scaleY !== undefined) bone.scaleY *= offset.scaleY;
	return () => {
		bone.x = base.x;
		bone.y = base.y;
		bone.rotation = base.rotation;
		bone.scaleX = base.scaleX;
		bone.scaleY = base.scaleY;
	};
}

/** True when `offset` would change nothing — the caller can skip the per-frame hook entirely. */
export function isIdentityBoneOffset(offset: SpineBoneOffset): boolean {
	return (
		(offset.x ?? 0) === 0 &&
		(offset.y ?? 0) === 0 &&
		(offset.rotation ?? 0) === 0 &&
		(offset.scaleX ?? 1) === 1 &&
		(offset.scaleY ?? 1) === 1
	);
}
