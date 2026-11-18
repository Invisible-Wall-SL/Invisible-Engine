import { RAMP_FACINGS, type Collider3dSpec } from 'engine-mechanics/src/motion3d.js';

import type { Vec3 } from '../rig';

/** A face of a convex collider: points with `n·p ≤ d` are inside it (`n` unit length). */
type Plane = { nx: number; ny: number; nz: number; d: number };
type Hull = {
	planes: Plane[];
	minX: number;
	minY: number;
	minZ: number;
	maxX: number;
	maxY: number;
	maxZ: number;
};

/** A box's six faces, plus a ramp's slope (a wedge is its box cut by the slope plane). */
function hullOf(c: Collider3dSpec): Hull {
	const planes: Plane[] = [
		{ nx: 1, ny: 0, nz: 0, d: c.maxX },
		{ nx: -1, ny: 0, nz: 0, d: -c.minX },
		{ nx: 0, ny: 1, nz: 0, d: c.maxY },
		{ nx: 0, ny: -1, nz: 0, d: -c.minY },
		{ nx: 0, ny: 0, nz: 1, d: c.maxZ },
		{ nx: 0, ny: 0, nz: -1, d: -c.minZ },
	];
	if (c.kind === 'ramp') {
		const rise = RAMP_FACINGS.indexOf(c.facing);
		const run = rise < 2 ? c.maxX - c.minX : c.maxZ - c.minZ;
		const s = (c.maxY - c.minY) / run;
		const k = 1 / Math.hypot(1, s);
		// The surface rises from minY on the low edge toward the edge `facing` names (`motion3d` `topUnder`).
		const slope: Record<number, Plane> = {
			0: { nx: -s, ny: 1, nz: 0, d: c.minY - s * c.minX },
			1: { nx: s, ny: 1, nz: 0, d: c.minY + s * c.maxX },
			2: { nx: 0, ny: 1, nz: -s, d: c.minY - s * c.minZ },
			3: { nx: 0, ny: 1, nz: s, d: c.minY + s * c.maxZ },
		};
		const p = slope[rise];
		planes.push({ nx: p.nx * k, ny: p.ny * k, nz: p.nz * k, d: p.d * k });
	}
	return { planes, ...c };
}

export type CameraCollider3d = {
	/**
	 * Sweep a sphere of `radius` from `from` to `to` against the level: the share (0..1) of the way
	 * it travels before touching a collider. A collider the sphere already overlaps at `from` is
	 * ignored, so a pivot pressed against a wall never pins the camera on the pivot.
	 */
	cast(from: Vec3, to: Vec3, radius: number): number;
};

/**
 * The camera's collision query over the level's colliders (`arcade.world3d.level.colliders`, the
 * gameplay collision geometry — never the render meshes). Each collider is a convex hull; the sweep
 * clips the segment against the hull with every face pushed out by the radius (exact on faces, a
 * little generous at edges and corners, which only pulls the camera in earlier). Its own copy of
 * the colliders: the query never touches the simulation's `Level3d`.
 */
export function createCameraCollider3d(colliders: readonly Collider3dSpec[]): CameraCollider3d {
	const hulls = colliders.map(hullOf);
	return {
		cast(from, to, radius) {
			const dx = to.x - from.x;
			const dy = to.y - from.y;
			const dz = to.z - from.z;
			const r = Math.max(0, radius);
			const lo = {
				x: Math.min(from.x, to.x) - r,
				y: Math.min(from.y, to.y) - r,
				z: Math.min(from.z, to.z) - r,
			};
			const hi = {
				x: Math.max(from.x, to.x) + r,
				y: Math.max(from.y, to.y) + r,
				z: Math.max(from.z, to.z) + r,
			};
			let best = 1;
			for (const h of hulls) {
				if (h.maxX < lo.x || h.minX > hi.x || h.maxY < lo.y || h.minY > hi.y) continue;
				if (h.maxZ < lo.z || h.minZ > hi.z) continue;
				let enter = -Infinity;
				let exit = Infinity;
				let miss = false;
				for (const p of h.planes) {
					const start = p.nx * from.x + p.ny * from.y + p.nz * from.z - (p.d + r);
					const along = p.nx * dx + p.ny * dy + p.nz * dz;
					if (along === 0) {
						if (start > 0) {
							miss = true;
							break;
						}
						continue;
					}
					const t = -start / along;
					if (along < 0) enter = Math.max(enter, t);
					else exit = Math.min(exit, t);
					if (enter > exit) {
						miss = true;
						break;
					}
				}
				// `enter` below 0: the sweep starts inside this hull (ignored, see `cast`).
				if (miss || enter < 0 || enter > 1) continue;
				best = Math.min(best, enter);
			}
			return best;
		},
	};
}
