import type { SpineBox } from 'constants-shared/spine';

/**
 * The pixi-local pivot that puts the CENTRE of a skeleton's authored box at its container's (x, y).
 *
 * A `Spine`'s local space is the skeleton's world space with y FLIPPED (`Skeleton.yDown`), and its
 * geometry already carries the LOAD scale the reader baked in (`parser.scale`) — while the header
 * the box comes from stays unscaled. So the centre is scaled up and its y negated. A centred box
 * (every Spine-editor rig we ship) yields `(0, 0)`: byte-identical to pivoting on the origin.
 */
export function spineBoxPivot(box: SpineBox, loadScale: number): { x: number; y: number } {
	return {
		x: (box.x + box.width / 2) * loadScale,
		y: -(box.y + box.height / 2) * loadScale,
	};
}
