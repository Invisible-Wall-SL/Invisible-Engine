import type { RigBox } from 'constants-shared/rig';

/** A rig `anchor` as given to `<RigProvider>`: one number for both axes, or per axis. */
export type RigAnchor = number | { x?: number; y?: number };

/**
 * An anchor read per axis. A missing axis is 0, an explicit 0 stays 0 — unlike `getPointValues`,
 * which reads every falsy value as its default.
 */
export function rigAnchorPoint(anchor: RigAnchor): { x: number; y: number } {
	if (typeof anchor === 'number') return { x: anchor, y: anchor };
	return { x: anchor.x ?? 0, y: anchor.y ?? 0 };
}

/**
 * The pixi-local pivot that puts the point `anchor` of a skeleton's authored box (the Rigger's Bounds
 * frame) at its container's (x, y).
 *
 * The anchor is read like a sprite's — y DOWN, `(0, 0)` the frame's top-left, `(0.5, 0.5)` its
 * centre — while the box is in skeleton space, y UP with `x`/`y` its bottom-left corner. A
 * `RigView`'s local space is that skeleton space with y FLIPPED (`Skeleton.yDown`), and its geometry
 * already carries the LOAD scale the reader baked in (`parser.scale`) while the header the box comes
 * from stays unscaled — so the point is scaled up and its y negated. It does not depend on the size
 * fit: `rig.scale` scales about the pivot, so the frame point stays on (x, y) at any size.
 *
 * A box centred on the origin (every externally authored rig we ship) yields `(0, 0)` at anchor 0.5:
 * byte-identical to pivoting on the origin.
 */
export function rigFramePivot(
	box: RigBox,
	anchor: { x: number; y: number },
	loadScale: number,
): { x: number; y: number } {
	return {
		x: (box.x + anchor.x * box.width) * loadScale,
		y: -(box.y + (1 - anchor.y) * box.height) * loadScale,
	};
}
