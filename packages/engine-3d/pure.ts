/**
 * The parts of the 3D view with no three.js and no DOM: the camera rig, the stick → move axes, the
 * offline play loop over `motion3d`, the placeholder arena, the tier chooser and its caps table. Node imports them for the fixture gate
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
export { MODEL_TIERS, type ModelTierId } from 'constants-shared/modelTiers';
export { createLevel3d, type Level3d } from 'engine-mechanics/src/motion3d.js';
export { world3dOf, type World3d } from 'engine-mechanics/src/online3d.js';
export { createFollow3d } from './src/pure/follow';
export {
	DEFAULT_LOOK,
	LOOK_MODEL_ID,
	lookFor3d,
	looksOf3d,
	type Attach3d,
	type Look3d,
} from './src/pure/looks';
export {
	clipLibraries3d,
	lodDistances,
	lodNameOf,
	MAX_OUTLINE_M,
	modelAt3d,
	TOON3D_DEFAULTS,
	toonOf,
	type ModelAt3d,
	type Toon3d,
} from './src/pure/models';
export {
	createRoomView3d,
	type RoomPlayer3d,
	type RoomState3d,
	type RoomView3d,
	type Stick3d,
} from './src/pure/roomView';
export { createPlay3d, MAX_CATCH_UP_MS, type BodyView3d, type Play3d } from './src/pure/play';
export {
	playField3d,
	sampleArena3d,
	type LevelSpec3d,
	type PlayField3d,
} from './src/pure/sampleArena';
export {
	autoTier3d,
	CAPS_3D,
	chooseTier3d,
	GRAPHICS_SETTING_TIER,
	isSoftwareRenderer,
	MIN_TEXTURE_SIZE_ABOVE_QUARTER,
	MIN_TEXTURE_SIZE_ULTRA,
	offeredSettings,
	passesUltraGate,
	publishedAtOrAbove,
	publishedForAuto,
	type Caps3d,
	type GraphicsSetting3d,
	type Gpu3d,
	type TierChoice3d,
	type TierInput3d,
	type TierWhy3d,
} from './src/pure/tier';
