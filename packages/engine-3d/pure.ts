/**
 * The parts of the 3D view with no three.js and no DOM: the camera rig, the stick → move axes, the
 * offline play loop over `motion3d`, the placeholder arena. Node imports them for the fixture gate
 * (`scripts/check-engine-3d.mjs`); the seam imports them through the main entry.
 */
export {
	moveAxes,
	resolveRig3d,
	RIG3D_DEFAULTS,
	rigPosition,
	yawRadians,
	yawToward,
	type Rig3d,
	type Vec3,
} from './src/pure/rig';
export { createLevel3d, type Level3d } from 'engine-mechanics/src/motion3d.js';
export { createFollow3d } from './src/pure/follow';
export { createPlay3d, MAX_CATCH_UP_MS, type BodyView3d, type Play3d } from './src/pure/play';
export { sampleArena3d, type LevelSpec3d } from './src/pure/sampleArena';
