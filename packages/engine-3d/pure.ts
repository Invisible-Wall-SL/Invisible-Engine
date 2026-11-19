/**
 * The parts of the 3D view with no three.js and no DOM: the camera rig and its director (`src/pure/camera`), the stick → move axes, the
 * offline play loop over `motion3d`, the placeholder arena, the tier chooser and its caps table, the
 * touch controls' stick, look and buttons. Node imports them for the fixture gate
 * (`scripts/check-engine-3d.mjs`); the seam imports them through the main entry.
 */
export {
	CAMERA_FAR_M,
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
export { groundUnder3d, type Ground3d } from './src/pure/ground';
export {
	createQuality3d,
	qualityLadder3d,
	render3dPin,
	RENDER3D_PINS,
	type Quality3d,
	type Quality3dLevel,
} from './src/pure/quality';
export {
	createAnimGraph3d,
	gradientBand,
	maskBones,
	type AnimFrame3d,
	type AnimGraph3d,
	type CharacterAnim3D,
	type ClipMeta3d,
	type Contribution,
	type Mask3d,
	type SmBlend2D,
	type SmBlend2DPoint,
	type SmLayer3d,
	type SmLayerMode3d,
	type SmState3d,
} from './src/pure/animGraph';
export { animDocsOf3d, validateCharacterAnim3d, type AnimIssue3d } from './src/pure/animDoc';
export {
	createCharacterInputs3d,
	DOUBLE_JUMP_MS,
	JUMP_CLIMB_MS,
	ROOM_TRIGGERS3D,
	VELOCITY_TC_MS,
	type CharacterInputs3d,
	type CharacterSample3d,
} from './src/pure/characterInputs';
export { BUTTONS3D, motionFor3d } from 'engine-mechanics/src/online3d.js';
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
	GRAPHICS_SETTING_LABELS,
	GRAPHICS_SETTING_TIER,
	graphicsSettingOf,
	isSoftwareRenderer,
	MIN_TEXTURE_SIZE_ABOVE_QUARTER,
	MIN_TEXTURE_SIZE_ULTRA,
	offeredSettings,
	passesUltraGate,
	publishedAtOrAbove,
	publishedForAuto,
	publishedTiersOf,
	type Caps3d,
	type GraphicsSetting3d,
	type Gpu3d,
	type TierChoice3d,
	type TierInput3d,
	type TierWhy3d,
} from './src/pure/tier';
export * from './src/pure/camera';
export {
	createTouch3d,
	mergeSticks3d,
	STICK_DEAD_ZONE,
	STICK_RUN_AT,
	TOUCH_LOOK_GAIN,
	touchLayout3d,
	type Touch3d,
	type TouchButton3d,
	type TouchButtonId3d,
	type TouchFrame3d,
	type TouchLayout3d,
	type TouchView3d,
} from './src/pure/touch';
