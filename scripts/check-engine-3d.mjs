// The 3D view's pure parts (`packages/engine-3d/pure.ts`, `docs/design/3d-games.md` Phase 1): the
// camera rig, the stick → int8 move axes, the offline play loop over
// `motion3d`, and the tier chooser with its caps (runtime eval §5.1, §5.3, step T1). No three.js,
// no DOM: what the `arcade3d` play field computes before it draws.
//
// Run: pnpm check:engine-3d

import {
	autoTier3d,
	CAPS_3D,
	chooseTier3d,
	createLevel3d,
	createPlay3d,
	MAX_CATCH_UP_MS,
	moveAxes,
	playField3d,
	offeredSettings,
	passesUltraGate,
	publishedAtOrAbove,
	publishedForAuto,
	resolveRig3d,
	RIG3D_DEFAULTS,
	rigPosition,
	sampleArena3d,
	yawRadians,
	yawToward,
} from '../packages/engine-3d/pure.ts';
import { BUTTON_JUMP, MOVE_SCALE } from '../packages/engine-mechanics/src/motion3d.js';
import { PINNABLE_TIERS } from '../packages/config-vite/artTierPin.js';
import { MODEL_SCENE_BUDGETS, MODEL_TIERS } from '../packages/constants-shared/modelTiers.ts';

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
	if (ok) passed += 1;
	else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// --- The rig as authored.
const defaults = resolveRig3d(undefined);
check('no rig3d block ⇒ the defaults', JSON.stringify(defaults) === JSON.stringify(RIG3D_DEFAULTS));
check(
	'a string is not a rig',
	JSON.stringify(resolveRig3d('high')) === JSON.stringify(RIG3D_DEFAULTS),
);
const odd = resolveRig3d({
	pitch: 120,
	distance: -3,
	fov: 'wide',
	yaw: 90,
	smoothing: -1,
	deadZone: { w: 2 },
});
check('pitch clamps under straight down', odd.pitch === 89, String(odd.pitch));
check('distance clamps to its floor', odd.distance === 0.5, String(odd.distance));
check('a non-number field falls back', odd.fov === RIG3D_DEFAULTS.fov);
check('yaw is kept as authored', odd.yaw === 90);
check('smoothing never negative', odd.smoothing === 0);
check(
	'dead zone merges per axis',
	odd.deadZone.w === 2 && odd.deadZone.h === RIG3D_DEFAULTS.deadZone.h,
);

// --- Where the camera sits.
const origin = { x: 0, y: 0, z: 0 };
const behind = rigPosition(origin, { pitch: 0, yaw: 0, distance: 10 });
check(
	'yaw 0, pitch 0: behind the target on +z',
	near(behind.x, 0) && near(behind.y, 0) && near(behind.z, 10),
);
const above = rigPosition({ x: 1, y: 2, z: 3 }, { pitch: 90, yaw: 0, distance: 5 });
check('pitch 90: straight above', near(above.x, 1) && near(above.y, 7) && near(above.z, 3, 1e-6));
const side = rigPosition(origin, { pitch: 0, yaw: 90, distance: 4 });
check('yaw 90: on +x', near(side.x, 4) && near(side.z, 0, 1e-9));
const d = rigPosition(origin, { pitch: 38, yaw: 30, distance: 14 });
check('the rig keeps its distance', near(Math.sqrt(d.x ** 2 + d.y ** 2 + d.z ** 2), 14, 1e-9));

// --- The stick, relative to the camera.
const eq = (m, mx, mz) => m.mx === mx && m.mz === mz;
check('no stick ⇒ no move', eq(moveAxes(0, 0, 0), 0, 0));
check('yaw 0: up walks to −z (away from the camera)', eq(moveAxes(0, 1, 0), 0, -MOVE_SCALE));
check('yaw 0: right walks to +x', eq(moveAxes(1, 0, 0), MOVE_SCALE, 0));
const turned = moveAxes(0, 1, 90);
check('yaw 90: up walks to −x', eq(turned, -MOVE_SCALE, 0), JSON.stringify(turned));
const diagonal = moveAxes(1, 1, 0);
check(
	'a diagonal is no faster than a straight line',
	Math.sqrt(diagonal.mx ** 2 + diagonal.mz ** 2) <= MOVE_SCALE + 1 && diagonal.mx === -diagonal.mz,
	JSON.stringify(diagonal),
);
for (const yaw of [0, 37, 90, 180, 271])
	for (const [r, f] of [
		[1, 0],
		[0, 1],
		[-1, 1],
	]) {
		const m = moveAxes(r, f, yaw);
		check(
			`int8 axes at yaw ${yaw}`,
			Number.isInteger(m.mx) &&
				Number.isInteger(m.mz) &&
				Math.abs(m.mx) <= 127 &&
				Math.abs(m.mz) <= 127,
		);
	}

// --- Facing.
// The room's convention (`online3d.js`): 0 looks down −z, anticlockwise seen from above.
check('facing −z is 0', yawToward(0, -1) === 0);
check('facing −x is a quarter turn', yawToward(-1, 0) === 16384);
check('facing +z is half', yawToward(0, 1) === 32768);
check('facing +x is three quarters', yawToward(1, 0) === 49152);
{
	// rotation.y by the yaw turns the model's −z front onto the direction faced.
	for (const [dx, dz] of [
		[1, 0],
		[0, 1],
		[-3, -3],
		[2, -5],
	]) {
		const t = yawRadians(yawToward(dx, dz));
		const fx = -Math.sin(t);
		const fz = -Math.cos(t);
		const len = Math.sqrt(dx * dx + dz * dz);
		check(`rotation.y faces (${dx}, ${dz})`, near(fx, dx / len, 1e-3) && near(fz, dz / len, 1e-3));
	}
}
check('yaw → radians', near(yawRadians(16384), Math.PI / 2));

// --- The offline loop on the placeholder arena.
const arena = sampleArena3d();
const level = createLevel3d(arena);
const still = { mx: 0, mz: 0, yaw: 0, buttons: 0 };
{
	const play = createPlay3d({ level, spawn: arena.spawn });
	for (let i = 0; i < 60; i++) play.advance(1000 / 60, still);
	check(
		'the player lands on the floor at spawn',
		play.player.grounded && near(play.player.y, 0, 1e-6),
		JSON.stringify(play.player),
	);
	check('60 frames at 60 Hz are 60 steps', play.steps === 60, String(play.steps));
	const z0 = play.player.z;
	for (let i = 0; i < 30; i++)
		play.advance(1000 / 60, { ...moveAxes(0, 1, 0), yaw: 0, buttons: 0 });
	check('up walks away from the camera', play.player.z < z0 - 1, `${z0} → ${play.player.z}`);
	let peak = play.player.y;
	play.advance(1000 / 60, { ...still, buttons: BUTTON_JUMP });
	for (let i = 0; i < 90; i++) {
		play.advance(1000 / 60, still);
		peak = Math.max(peak, play.player.y);
	}
	check('Space jumps about 1.5 m', peak > 1.3 && peak < 1.7, String(peak));
	check('and lands', play.player.grounded && near(play.player.y, 0, 1e-6));
	const before = play.steps;
	play.advance(5000, still);
	const caught = play.steps - before;
	check(
		`a long gap catches up at most ${MAX_CATCH_UP_MS} ms`,
		caught >= 14 && caught <= 16,
		String(caught),
	);
	play.advance(10, still);
	play.resync();
	const [view] = play.bodies();
	check(
		'resync drops the time not yet stepped',
		near(view.x, play.player.x) && near(view.z, play.player.z),
	);
}
{
	// Spawned over the pit (x 6..10, z −10..−6): falls past killY and is put back at the spawn.
	const play = createPlay3d({ level, spawn: { x: 8, y: 1, z: -8 } });
	let lowest = Infinity;
	for (let i = 0; i < 400; i++) {
		play.advance(1000 / 60, still);
		lowest = Math.min(lowest, play.player.y);
		if (play.last?.fell) break;
	}
	check(
		'a fall past the death plane respawns',
		play.last?.fell === true && near(play.player.y, 1) && near(play.player.x, 8),
		JSON.stringify(play.player),
	);
	check(
		'…and counts the fall where it happened (the death cam looks there)',
		play.falls === 1 && near(play.fellAt.x, 8) && play.fellAt.y < -12,
		JSON.stringify(play.fellAt),
	);
}
{
	// The south ramp (x −1.5..1.5, z 11 → 5) climbs onto the 2.5 m tier.
	const play = createPlay3d({ level, spawn: { x: 0, y: 0, z: 13 } });
	const up = { ...moveAxes(0, 1, 0), yaw: 0, buttons: 0 };
	for (let i = 0; i < 180; i++) play.advance(1000 / 60, up);
	check(
		'the ramp leads onto the tier',
		play.player.z < 5 && near(play.player.y, 2.5, 1e-6),
		JSON.stringify(play.player),
	);
}
{
	// Interpolation: half a step pending shows the body half way.
	const play = createPlay3d({ level, spawn: arena.spawn });
	for (let i = 0; i < 60; i++) play.advance(1000 / 60, still);
	const walk = { ...moveAxes(1, 0, 0), yaw: 0, buttons: 0 };
	for (let i = 0; i < 20; i++) play.advance(1000 / 60, walk);
	const x1 = play.player.x;
	play.advance(1000 / 120, walk);
	const [mid] = play.bodies();
	check(
		'half a pending step draws between the last two',
		mid.x < x1 + 1e-9 && mid.x > x1 - 0.2,
		`${mid.x} vs ${x1}`,
	);
}

// --- The play field from the config's raw `arcade.world3d` (the block the 3D room reads).
{
	const none = playField3d(undefined);
	check(
		'no world3d block: the placeholder arena',
		none.source === 'placeholder' && none.level.colliders.length > 0,
	);
	const block = {
		level: {
			colliders: [{ kind: 'box', minX: -5, minY: -1, minZ: -5, maxX: 5, maxY: 0, maxZ: 5 }],
			zones: [],
			killY: -8,
		},
		motion: { speed: 7 },
		spawns: [{ x: 1, y: 0, z: 2, yaw: 16384 }],
	};
	const field = playField3d(block);
	check(
		'a world3d block is the level, its first spawn and its motion',
		field.source === 'config' &&
			field.level.colliders.length === 1 &&
			field.level.killY === -8 &&
			field.level.spawn.x === 1 &&
			field.level.spawn.z === 2 &&
			field.level.spawn.yaw === 16384 &&
			field.motion.speed === 7,
		JSON.stringify(field),
	);
	check(
		'the field carries its level built once, for the placeholder and for a config',
		none.built.colliders.length === none.level.colliders.length &&
			field.built.colliders.length === 1 &&
			field.built.killY === -8,
	);
	let threw = '';
	try {
		playField3d({ motion: { gravity: 9.81 } });
	} catch (error) {
		threw = String(error);
	}
	check(
		'a bad world3d block throws, naming the path',
		/arcade\.world3d\.motion\.gravity/.test(threw),
		threw,
	);
	const play = createPlay3d({
		level: field.built,
		spawn: field.level.spawn,
		spec: field.motion,
	});
	check('the player starts facing the spawn yaw', play.player.yaw === 16384);
	for (let i = 0; i < 30; i++) play.advance(1000 / 60, still);
	const x0 = play.player.x;
	for (let i = 0; i < 60; i++)
		play.advance(1000 / 60, { ...moveAxes(1, 0, 0), yaw: 0, buttons: 0 });
	check(
		"the block's motion moves it (speed 7 m/s)",
		play.player.x - x0 > 5 && play.player.x - x0 < 7.01,
		String(play.player.x - x0),
	);
}

// --- The tier chooser (T1).
const GPU = {
	astc: false,
	bc7: true,
	s3tc: true,
	etc2: false,
	maxTextureSize: 16384,
	renderer: 'NVIDIA GeForce RTX 4070',
};
const IGPU = {
	astc: false,
	bc7: false,
	s3tc: true,
	etc2: false,
	maxTextureSize: 8192,
	renderer: 'Intel(R) UHD Graphics 620',
};
const PHONE_GPU = {
	astc: true,
	bc7: false,
	s3tc: false,
	etc2: true,
	maxTextureSize: 4096,
	renderer: 'Apple GPU',
};
const ALL = ['ultra', 'full', 'half', 'quarter'];
const base = (over = {}) => ({ deviceClass: 'desktop', gpu: GPU, published: ALL, ...over });
const phone = (over = {}) => base({ deviceClass: 'phone', gpu: PHONE_GPU, ...over });
const noCompressed = { ...GPU, bc7: false, s3tc: false };

check(
	'the build pin list is MODEL_TIERS',
	JSON.stringify(PINNABLE_TIERS) === JSON.stringify(MODEL_TIERS),
);
check(
	'auto: a desktop is half',
	chooseTier3d(base()).tier === 'half' && chooseTier3d(base()).why === 'auto-desktop',
);
check('auto: a phone is quarter', chooseTier3d(phone()).tier === 'quarter');
check(
	'auto: no compressed textures drops a step',
	chooseTier3d(base({ gpu: noCompressed })).tier === 'quarter' &&
		chooseTier3d(base({ gpu: noCompressed })).why === 'auto-no-compressed-textures',
);
check(
	'auto: a texture limit under 2048 is quarter',
	chooseTier3d(base({ gpu: { ...GPU, maxTextureSize: 1024 } })).why === 'auto-small-gpu',
);
for (const renderer of [
	'Google SwiftShader',
	'llvmpipe (LLVM 15.0.7)',
	'Microsoft Basic Render Driver',
])
	check(
		`auto: software renderer ${renderer} is quarter`,
		chooseTier3d(base({ gpu: { ...GPU, renderer } })).why === 'auto-software-renderer',
	);
{
	const wrong = [];
	for (const deviceClass of ['phone', 'desktop'])
		for (const gpu of [GPU, IGPU, PHONE_GPU, noCompressed, { ...GPU, maxTextureSize: 65536 }]) {
			const t = autoTier3d({ deviceClass, gpu }).tier;
			if (t === 'full' || t === 'ultra') wrong.push(`${deviceClass} ${gpu.renderer} → ${t}`);
			for (const published of [
				ALL,
				['full', 'half'],
				['full', 'quarter'],
				['full', 'ultra', 'half'],
			]) {
				const chosen = chooseTier3d({ deviceClass, gpu, published }).tier;
				if (chosen === 'full' || chosen === 'ultra')
					wrong.push(`${deviceClass} ${gpu.renderer} [${published}] → ${chosen}`);
			}
		}
	check('auto never picks full or ultra', wrong.length === 0, wrong.join('; '));
}
check(
	'a missing tier loads the nearest one above it, never full by accident',
	publishedAtOrAbove('quarter', ['full', 'half']) === 'half',
);
check(
	'a build with only full files loads full',
	publishedAtOrAbove('quarter', ['full']) === 'full',
);
check(
	'auto: a desktop on a full + quarter project loads quarter, not full',
	publishedForAuto('half', ['full', 'quarter']) === 'quarter' &&
		chooseTier3d(base({ published: ['full', 'quarter'] })).tier === 'quarter',
);
check(
	'auto: a phone on a full + half project loads half',
	publishedForAuto('quarter', ['full', 'half']) === 'half',
);
check(
	'auto: a build with only full files loads full',
	publishedForAuto('half', ['full']) === 'full' &&
		publishedForAuto('quarter', ['full', 'ultra']) === 'full',
);
check(
	'a phone on a half-only project loads half',
	chooseTier3d(phone({ published: ['full', 'half'] })).tier === 'half',
);

// Precedence: pin > ?tier= > setting > auto.
check(
	'the pin beats everything',
	chooseTier3d(base({ pin: 'full', forced: 'quarter', setting: 'low' })).tier === 'full' &&
		chooseTier3d(base({ pin: 'full' })).why === 'pin',
);
check(
	'a pinned build offers no Graphics choice',
	chooseTier3d(base({ pin: 'quarter' })).offered.length === 0,
);
check(
	'?tier= beats the setting',
	chooseTier3d(base({ forced: 'quarter', setting: 'high' })).tier === 'quarter',
);
check('a bad ?tier= is ignored', chooseTier3d(base({ forced: 'huge' })).why === 'auto-desktop');
check(
	'the setting beats auto',
	chooseTier3d(base({ setting: 'high' })).tier === 'full' &&
		chooseTier3d(base({ setting: 'low' })).tier === 'quarter',
);
check('setting auto is auto', chooseTier3d(base({ setting: 'auto' })).why === 'auto-desktop');
check('a phone may not choose High', chooseTier3d(phone({ setting: 'high' })).tier === 'quarter');
check('a junk setting is ignored', chooseTier3d(base({ setting: 'max' })).why === 'auto-desktop');

// The Graphics options, and the ultra gate.
const offers = (over) => offeredSettings(base(over));
check(
	'a desktop with a discrete GPU is offered Ultra',
	offers().includes('ultra') && passesUltraGate(base()),
);
check(
	'a phone is offered neither High nor Ultra',
	!offeredSettings(phone()).some((o) => o === 'high' || o === 'ultra'),
);
check(
	'an iGPU without BC7 or ASTC is offered High, not Ultra',
	!offers({ gpu: IGPU }).includes('ultra') && offers({ gpu: IGPU }).includes('high'),
);
check(
	'a software renderer is not offered Ultra',
	!offers({ gpu: { ...GPU, renderer: 'Google SwiftShader' } }).includes('ultra'),
);
check(
	'under 8192 textures is not offered Ultra',
	!offers({ gpu: { ...GPU, maxTextureSize: 4096 } }).includes('ultra'),
);
check(
	'a build without ultra files does not offer Ultra',
	!offers({ published: ['full', 'half', 'quarter'] }).includes('ultra'),
);
check(
	'Ultra where it is not offered falls to auto',
	chooseTier3d(base({ gpu: IGPU, setting: 'ultra' })).why !== 'setting',
);

// The caps table (§5.3).
check(
	'every tier has caps',
	MODEL_TIERS.every((t) => t in CAPS_3D),
);
check(
	'the web tiers cap the 3D pixel ratio',
	CAPS_3D.half.maxPixelRatio === 1.5 && CAPS_3D.quarter.maxPixelRatio === 1,
);
check(
	'full and ultra render at the device ratio',
	CAPS_3D.full.maxPixelRatio === Infinity && CAPS_3D.ultra.maxPixelRatio === Infinity,
);
check(
	'quarter: blob shadows, no MSAA, no shadow map',
	CAPS_3D.quarter.shadows === 'blob' &&
		!CAPS_3D.quarter.antialias &&
		CAPS_3D.quarter.shadowMapSize === 0,
);
check(
	'shadow maps 4096 / 2048 / 1024',
	CAPS_3D.ultra.shadowMapSize === 4096 &&
		CAPS_3D.full.shadowMapSize === 2048 &&
		CAPS_3D.half.shadowMapSize === 1024,
);
check(
	'post-processing only on full and ultra',
	CAPS_3D.half.post === 'none' && CAPS_3D.quarter.post === 'none' && CAPS_3D.full.post !== 'none',
);
check(
	'LOD bias 0.8 / 1 / 1.25 / 1.5',
	MODEL_TIERS.map((t) => CAPS_3D[t].lodBias).join() === '0.8,1,1.25,1.5',
);
check(
	'anisotropy 16 / 8 / 4 / 1',
	MODEL_TIERS.map((t) => CAPS_3D[t].anisotropy).join() === '16,8,4,1',
);
check(
	"the scene budget is the export's",
	MODEL_TIERS.every((t) => CAPS_3D[t].budget === MODEL_SCENE_BUDGETS[t]),
);

if (failures.length) {
	console.error(`check:engine-3d — ${failures.length} failed:\n  ${failures.join('\n  ')}`);
	process.exit(1);
}
console.log(`check:engine-3d — ${passed} checks passed`);
