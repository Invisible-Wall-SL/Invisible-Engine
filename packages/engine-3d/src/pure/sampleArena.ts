import type { Collider3dSpec, Zone3dSpec } from 'engine-mechanics/src/motion3d.js';

import type { Vec3 } from './rig';

/** A level as data: what `motion3d` `createLevel3d` takes, plus where a player starts. */
export type LevelSpec3d = {
	colliders: Collider3dSpec[];
	zones: Zone3dSpec[];
	cellSize: number;
	killY: number;
	spawn: Vec3;
};

const box = (
	minX: number,
	minY: number,
	minZ: number,
	maxX: number,
	maxY: number,
	maxZ: number,
): Collider3dSpec => ({ kind: 'box', minX, minY, minZ, maxX, maxY, maxZ });

const ramp = (
	facing: '+x' | '-x' | '+z' | '-z',
	minX: number,
	minY: number,
	minZ: number,
	maxX: number,
	maxY: number,
	maxZ: number,
): Collider3dSpec => ({ kind: 'ramp', facing, minX, minY, minZ, maxX, maxY, maxZ });

/**
 * The placeholder arena the `arcade3d` play field shows until levels are data (gameplay
 * evaluation §5: the seeded generator, then the Blender import): a 32 m floor with a pit, border
 * walls, a 2.5 m tier with a ramp on two sides, a stair, a slab to jump onto, pillars and a
 * trampoline. Every surface `motion3d` knows, so a player can try each one.
 */
export function sampleArena3d(): LevelSpec3d {
	return {
		cellSize: 4,
		killY: -12,
		spawn: { x: -3, y: 0, z: 12 },
		colliders: [
			// The floor, round a 4 × 4 m pit at x 6..10, z −10..−6.
			box(-16, -1, -16, 16, 0, -10),
			box(-16, -1, -6, 16, 0, 16),
			box(-16, -1, -10, 6, 0, -6),
			box(10, -1, -10, 16, 0, -6),
			// The border walls.
			box(-17, -1, -17, 17, 2, -16),
			box(-17, -1, 16, 17, 2, 17),
			box(-17, -1, -16, -16, 2, 16),
			box(16, -1, -16, 17, 2, 16),
			// The tier, 2.5 m up, a ramp on its south and east faces.
			box(-5, 0, -5, 5, 2.5, 5),
			ramp('-z', -1.5, 0, 5, 1.5, 2.5, 11),
			ramp('-x', 5, 0, -1.5, 11, 2.5, 1.5),
			// A stair of 0.3 m steps up to a 1.2 m landing.
			box(-14, 0, 6, -12, 0.3, 10),
			box(-12, 0, 6, -10, 0.6, 10),
			box(-10, 0, 6, -8, 0.9, 10),
			box(-8, 0, 6, -6, 1.2, 10),
			// A slab to jump onto from the landing.
			box(-14, 1.8, -4, -9, 2.2, 1),
			// Pillars.
			box(11, 0, 9, 12, 3, 10),
			box(-12, 0, -13, -11, 3, -12),
		],
		zones: [
			{
				kind: 'trampoline',
				minX: 11,
				minY: -0.1,
				minZ: 2,
				maxX: 14,
				maxY: 0.1,
				maxZ: 5,
				height: 5,
			},
		],
	};
}
