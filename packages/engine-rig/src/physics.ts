/** How `Skeleton.updateWorldTransform` treats physics constraints this frame. */
export enum Physics {
	/** Physics are not updated or applied. */
	none = 0,
	/** Physics are reset to the current pose. */
	reset = 1,
	/** Physics are stepped and applied. */
	update = 2,
	/** Physics are applied without stepping. */
	pose = 3,
}
