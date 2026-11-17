// The 3D view's pure parts (`packages/engine-3d/pure.ts`, `docs/design/3d-games.md` Phase 1): the
// camera rig, the stick → int8 move axes, the camera follow and the offline play loop over
// `motion3d`. No three.js, no DOM: what the `arcade3d` play field computes before it draws.
//
// Run: pnpm check:engine-3d

import {
	createFollow3d,
	createLevel3d,
	createPlay3d,
	MAX_CATCH_UP_MS,
	moveAxes,
	resolveRig3d,
	RIG3D_DEFAULTS,
	rigPosition,
	sampleArena3d,
	yawRadians,
	yawToward,
} from '../packages/engine-3d/pure.ts';
import { BUTTON_JUMP, MOVE_SCALE } from '../packages/engine-mechanics/src/motion3d.js';

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
check('facing +z is 0', yawToward(0, 1) === 0);
check('facing +x is a quarter turn', yawToward(1, 0) === 16384);
check('facing −x is three quarters', yawToward(-1, 0) === 49152);
check('facing −z is half', yawToward(0, -1) === 32768);
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

// --- The camera follow (the arcade camera, in metres).
{
	const rig = resolveRig3d({ smoothing: 0, lookAhead: 0, deadZone: { w: 0, h: 0 } });
	const follow = createFollow3d(rig);
	const body = {
		id: 'p',
		x: 3,
		y: 2,
		z: -4,
		vx: 0,
		vz: 0,
		yaw: 0,
		radius: 0.4,
		height: 1.8,
		kind: 'hero',
	};
	const t = follow.step(16, body);
	check(
		'no smoothing: the target is the body, aimHeight up',
		near(t.x, 3) && near(t.z, -4) && near(t.y, 2 + rig.aimHeight),
	);
	const smooth = createFollow3d(
		resolveRig3d({ smoothing: 0.5, deadZone: { w: 0, h: 0 }, lookAhead: 0 }),
	);
	smooth.step(16, body);
	const moved = smooth.step(16, { ...body, x: 13 });
	check(
		'smoothing: the first frame snaps, the next eases toward the body',
		moved.x > 3 && moved.x < 13,
		String(moved.x),
	);
	const dead = createFollow3d(
		resolveRig3d({ smoothing: 0, lookAhead: 0, deadZone: { w: 2, h: 2 } }),
	);
	dead.step(16, body);
	const inside = dead.step(16, { ...body, x: 3.8 });
	check('a move inside the dead zone keeps the camera still', near(inside.x, 3), String(inside.x));
}

if (failures.length) {
	console.error(`check:engine-3d — ${failures.length} failed:\n  ${failures.join('\n  ')}`);
	process.exit(1);
}
console.log(`check:engine-3d — ${passed} checks passed`);
