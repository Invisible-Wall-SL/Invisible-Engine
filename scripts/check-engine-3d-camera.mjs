// The 3D camera director's pure maths (`packages/engine-3d/src/pure/camera`, `docs/design/3d-games.md`
// Phase 2, animation evaluation §4 / A4–A5): the rigs, the blend between them (and a blend
// interrupted midway), the pull-in against the level's colliders, the seeded trauma shake, the
// camera-relative stick through the live rig, an authored move handed back to a rig, the fixture
// move Blender exported (`tools/blender/ie_camera_move.py --sample`) read through three's glTF
// loader, and the seam's Flow ease enum against the director's.
//
// Run: pnpm check:engine-3d-camera

import { readFileSync } from 'node:fs';

import { loadCameraMoves3d } from '../packages/engine-3d/src/cameraMoves.ts';
import {
	CAMERA_EASES,
	CAMERA_LENS_DEFAULT,
	camera3dOf,
	GHOST_RIG_ID,
	createCameraCollider3d,
	createCameraDirector3d,
	createShake3d,
	defaultCameraRigs3d,
	fromYawPitchRoll,
	horizontalFov,
	lensFov,
	lookAt,
	moveAxes,
	resolveCameraRig3d,
	resolveRig3d,
	rigPosition,
	RIG3D_DEFAULTS,
	sampleArena3d,
	slerp,
	yawPitchOf,
} from '../packages/engine-3d/pure.ts';

let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
	if (ok) passed += 1;
	else failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const angle = (a, b) => {
	const d = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
	return (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI;
};
const body = (over = {}) => ({ x: 0, y: 0, z: 0, vx: 0, vz: 0, yaw: 0, grounded: true, ...over });
const arena = sampleArena3d();

// --- Rotation maths.
{
	const q = fromYawPitchRoll(90, -30);
	const v = yawPitchOf(q);
	check('yaw / pitch round-trip', near(v.yaw, 90) && near(v.pitch, -30), JSON.stringify(v));
	const l = yawPitchOf(lookAt({ x: 0, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }));
	check('a look toward −x is yaw 90 (anticlockwise from above)', near(l.yaw, 90));
	const half = slerp(fromYawPitchRoll(170, 0), fromYawPitchRoll(-170, 0), 0.5);
	check('slerp goes the short way round', near(Math.abs(yawPitchOf(half).yaw), 180, 1e-6));
}

// --- Rigs as data.
{
	const config = camera3dOf(undefined, RIG3D_DEFAULTS);
	check(
		'no camera block ⇒ first person live (the owner, 2026-11-18), the rest beside it, ghost on top',
		config.rigs.map((r) => r.kind).join() === 'firstPerson,follow,orbit,shoulder,fixed,ghost' &&
			config.active === 'firstPerson' &&
			config.rigs.find((r) => r.id === GHOST_RIG_ID)?.priority === 10,
	);
	const fp = config.rigs[0].params;
	check(
		"first person bobs as BattleOTtheYear's HandleHeadBob (0.05 m, 10 rad/s) and clamps the look near ±90°",
		fp.bob.amplitude === 0.05 && fp.bob.frequency === 10 && fp.bob.sway === 0 && fp.maxPitch === 89,
	);
	const follow = config.rigs.find((r) => r.id === 'follow').params;
	check(
		"the default follow is Phase 1a's view",
		follow.pitch === RIG3D_DEFAULTS.pitch &&
			follow.distance === RIG3D_DEFAULTS.distance &&
			follow.fov === RIG3D_DEFAULTS.fov,
	);
	let threw = '';
	try {
		camera3dOf({ rigs: [{ id: 'a', kind: 'dolly' }] });
	} catch (error) {
		threw = String(error.message);
	}
	check(
		'an unknown kind names its path',
		threw.startsWith('arcade.world3d.camera.rigs.0.kind'),
		threw,
	);
	try {
		camera3dOf({ rigs: [{ id: 'r', kind: 'rail', params: { points: [{ x: 0 }] } }] });
		threw = '';
	} catch (error) {
		threw = String(error.message);
	}
	check('a rail of one point is refused', threw.includes('rigs.0.params'), threw);
	const orbit = resolveCameraRig3d(
		{ id: 'o', kind: 'orbit', params: { minPitch: 10, maxPitch: 5, pitch: 90 } },
		'x',
	);
	check(
		'orbit clamps hold max ≥ min and pitch inside',
		orbit.params.maxPitch >= orbit.params.minPitch && orbit.params.pitch <= orbit.params.maxPitch,
	);
}

const rigs = defaultCameraRigs3d(
	resolveRig3d({ smoothing: 0, lookAhead: 0, deadZone: { w: 0, h: 0 } }),
);
const director = (over = {}) =>
	createCameraDirector3d({
		rigs,
		seed: 'gate',
		follow: 'me',
		active: 'follow',
		blend: { blendMs: 600, ease: 'linear' },
		...over,
	});

// --- Follow: places the camera where Phase 1a's rig did.
{
	const d = director();
	const me = body({ x: 3, y: 0, z: -4 });
	const v = d.frame(16, () => me);
	const pivot = { x: 3, y: 1, z: -4 };
	const want = rigPosition(pivot, RIG3D_DEFAULTS);
	check(
		'follow sits where rigPosition puts it',
		dist(v.pose.position, want) < 1e-9,
		JSON.stringify(v.pose.position),
	);
	check(
		'follow looks at the pivot, pitch down',
		near(v.pitch, -RIG3D_DEFAULTS.pitch, 1e-6) && near(v.yaw, 0, 1e-6),
	);
	const deadRigs = defaultCameraRigs3d(
		resolveRig3d({ smoothing: 0, lookAhead: 0, deadZone: { w: 2, h: 2 } }),
	);
	const dz = createCameraDirector3d({ rigs: deadRigs, seed: 's', follow: 'me', active: 'follow' });
	dz.frame(16, () => body());
	const still = dz.frame(16, () => body({ x: 0.8 }));
	const first = rigPosition({ x: 0, y: 1, z: 0 }, RIG3D_DEFAULTS);
	check(
		'a move inside the dead zone keeps the camera still',
		near(still.pose.position.x, first.x, 1e-9),
	);
	const out = dz.frame(16, () => body({ x: 3 }));
	check(
		'past the dead zone the pivot keeps the body on its edge',
		near(out.pose.position.x, first.x + 2, 1e-9),
		String(out.pose.position.x),
	);
	const smoothRigs = defaultCameraRigs3d(
		resolveRig3d({ smoothing: 0.5, deadZone: { w: 0, h: 0 }, lookAhead: 0 }),
	);
	const sm = createCameraDirector3d({
		rigs: smoothRigs,
		seed: 's',
		follow: 'me',
		active: 'follow',
	});
	sm.frame(16, () => body());
	const eased = sm.frame(16, () => body({ x: 10 }));
	check(
		'damping eases toward the body',
		eased.pose.position.x > first.x && eased.pose.position.x < first.x + 10,
	);
}

// --- Switches blend without a pop; an interrupted blend starts from the pose on screen.
{
	const d = director();
	const me = () => body({ x: 2, z: 1 });
	let prev = d.frame(16, me);
	const blendRun = (id, frames) => {
		d.activate(id, { blendMs: 600, ease: 'smooth' });
		let worstMove = 0;
		let worstTurn = 0;
		let fovStep = 0;
		for (let i = 0; i < frames; i++) {
			const v = d.frame(16, me);
			worstMove = Math.max(worstMove, dist(v.pose.position, prev.pose.position));
			worstTurn = Math.max(worstTurn, angle(v.pose.rotation, prev.pose.rotation));
			fovStep = Math.max(fovStep, Math.abs(v.pose.fov - prev.pose.fov));
			prev = v;
		}
		return { worstMove, worstTurn, fovStep, live: d.live };
	};
	for (const [id, label] of [
		['orbit', 'follow → orbit'],
		['shoulder', 'orbit → shoulder'],
		['firstPerson', 'shoulder → first person'],
		['follow', 'first person → follow'],
	]) {
		const r = blendRun(id, 60);
		// A 600 ms smoothstep over ≲ 20 m moves at most ~1.5× the mean step per frame.
		check(
			`${label}: no frame jumps (≤ 0.9 m, ≤ 6°, ≤ 2° FOV)`,
			r.live === id && r.worstMove < 0.9 && r.worstTurn < 6 && r.fovStep < 2,
			JSON.stringify(r),
		);
	}
	const cut = director();
	cut.frame(16, me);
	cut.activate('overview', { ease: 'cut' });
	const v = cut.frame(16, me);
	check(
		'a cut lands on the rig at once',
		!v.blending && dist(v.pose.position, { x: 0, y: 24, z: 24 }) < 1e-9,
	);

	const i = director();
	const a0 = i.frame(16, me);
	i.activate('overview', { blendMs: 1000, ease: 'linear' });
	let last = a0;
	for (let f = 0; f < 30; f++) last = i.frame(16, me);
	check(
		'halfway through a blend it is between the two',
		last.blending && dist(last.pose.position, a0.pose.position) > 1,
	);
	i.activate('orbit', { blendMs: 1000, ease: 'linear' });
	const next = i.frame(16, me);
	check(
		'an interrupted blend starts from the pose on screen (no pop)',
		dist(next.pose.position, last.pose.position) < 0.5 &&
			angle(next.pose.rotation, last.pose.rotation) < 3,
		`${dist(next.pose.position, last.pose.position)} m`,
	);
	check('…and the new rig is live', next.live === 'orbit' && next.blending);
	const pr = createCameraDirector3d({
		rigs: [...rigs, { ...rigs[4], id: 'boss', priority: 5 }],
		seed: 's',
		follow: 'me',
	});
	pr.activate('boss', { ease: 'cut' });
	pr.frame(16, me);
	pr.activate('orbit', { ease: 'cut' });
	check('a higher-priority active rig keeps the screen', pr.frame(16, me).live === 'boss');
	pr.deactivate('boss', { ease: 'cut' });
	check('deactivated, the next active one takes it', pr.frame(16, me).live === 'orbit');
}

// --- The stick maps through the camera on screen.
{
	const d = director();
	const me = () => body();
	d.frame(16, me);
	d.activate('orbit', { ease: 'cut' });
	d.frame(16, me);
	const v = d.frame(16, me, { lookX: -300, lookY: 0, zoom: 0, aiming: false });
	const up = moveAxes(0, 1, v.yaw);
	const f = { x: -Math.sin((v.yaw * Math.PI) / 180), z: -Math.cos((v.yaw * Math.PI) / 180) };
	const lenF = Math.hypot(up.mx, up.mz);
	check(
		'after orbiting, "forward" walks the way the camera looks',
		Math.abs(v.yaw) > 45 && (up.mx * f.x + up.mz * f.z) / lenF > 0.99,
		JSON.stringify({ yaw: v.yaw, up }),
	);
	d.activate('shoulder', { ease: 'cut' });
	const s = d.frame(16, me);
	check(
		'shoulder keeps the heading it took over (no spin)',
		near(s.yaw, v.yaw, 1e-6) && s.aims,
		String(s.yaw),
	);
	let aimed;
	for (let k = 0; k < 20; k++)
		aimed = d.frame(16, me, { lookX: 0, lookY: 0, zoom: 0, aiming: true });
	check(
		'aiming zooms the shoulder FOV in',
		aimed.pose.fov < s.pose.fov - 10,
		`${s.pose.fov} → ${aimed.pose.fov}`,
	);
	d.activate('firstPerson', { ease: 'cut' });
	const eyes = [];
	for (let k = 0; k < 60; k++)
		eyes.push(d.frame(16, () => body({ vx: 0, vz: -5, z: -k * 0.08 })).pose.position.y);
	const bob = Math.max(...eyes) - Math.min(...eyes);
	check('first person bobs while walking', bob > 0.02 && bob < 0.2, String(bob));
	const restEyes = [];
	for (let k = 0; k < 120; k++) restEyes.push(d.frame(16, () => body({ z: -4.8 })).pose.position.y);
	check(
		'…and settles at eye height at rest',
		near(restEyes[restEyes.length - 1], 1.6, 1e-3),
		String(restEyes.at(-1)),
	);
}

// --- First person: the default, level on entry, BOTY's bob, the near plane kept out of walls.
{
	const d = createCameraDirector3d({ rigs, seed: 's', follow: 'me' });
	const v0 = d.frame(16, () => body({ yaw: 16384 }));
	check('with no rig named, first person is live', v0.live === 'firstPerson' && v0.aims);
	check(
		'…at eye height, facing the body',
		near(v0.pose.position.y, 1.6, 1e-9) && near(v0.yaw, 90, 0.01),
	);
	d.activate('follow', { ease: 'cut' });
	d.frame(16, () => body());
	d.activate('firstPerson', { ease: 'cut' });
	const level = d.frame(16, () => body());
	check(
		'entered from follow (looking down 38°) the eyes come up level, the heading kept',
		near(level.pitch, 0, 1e-6) && near(level.yaw, 0, 1e-6),
	);
	const ys = [];
	for (let k = 0; k < 240; k++)
		ys.push(d.frame(16, () => body({ vz: -4, z: -k * 0.064 })).pose.position.y);
	const steady = ys.slice(120);
	let rises = 0;
	for (let k = 1; k < steady.length; k++) if (steady[k - 1] < 1.6 && steady[k] >= 1.6) rises += 1;
	check('the bob runs at 10 rad/s (3 cycles in 1.92 s)', rises === 3, String(rises));
	check(
		'…0.05 m up and down',
		near(Math.max(...steady) - 1.6, 0.05, 2e-3) && near(1.6 - Math.min(...steady), 0.05, 2e-3),
	);
	const wall = [{ kind: 'box', minX: -2, minY: 0, minZ: -1, maxX: 2, maxY: 3, maxZ: -0.3 }];
	const n = createCameraDirector3d({ rigs, seed: 's', follow: 'me', colliders: wall });
	const ahead = n.frame(16, () => body({ head: { x: 0, y: 1.6, z: -0.5 } }));
	check(
		'a head socket inside a wall: the eye stops a near radius short of it',
		near(ahead.pose.position.z, -0.15, 1e-9),
		String(ahead.pose.position.z),
	);
}

// --- The death camera: detach, drift up and back, keep looking at the body; then back.
{
	// The stage points the ghost at where the body fell (`corpse`), the eyes still at the player.
	const ghostRigs = rigs.map((r) => (r.id === GHOST_RIG_ID ? { ...r, target: 'corpse' } : r));
	const d = createCameraDirector3d({
		rigs: ghostRigs,
		seed: 's',
		follow: 'me',
		colliders: arena.colliders,
	});
	const me = () => body({ x: -3, z: 12 });
	const alive = d.frame(16, me);
	const corpse = body({ x: -3, z: 12 });
	const targets = (id) => (id === 'corpse' ? corpse : me());
	d.activate(GHOST_RIG_ID, { ease: 'cut' });
	const first = d.frame(16, targets);
	check(
		'dying cuts to the ghost where the eyes were',
		first.live === GHOST_RIG_ID &&
			dist(first.pose.position, alive.pose.position) < 0.05 &&
			!first.aims,
	);
	let v = first;
	for (let k = 0; k < 100; k++) v = d.frame(16, targets);
	const look = yawPitchOf(lookAt(v.pose.position, { x: -3, y: 0.6, z: 12 }));
	check(
		'…it rises and backs away, looking at the body',
		v.pose.position.y > alive.pose.position.y + 2 &&
			v.pose.position.z > alive.pose.position.z + 2 &&
			near(v.yaw, look.yaw, 0.01) &&
			near(v.pitch, look.pitch, 0.01),
		JSON.stringify(v.pose.position),
	);
	d.deactivate(GHOST_RIG_ID, { blendMs: 400 });
	let back = d.frame(16, me);
	check('respawned, the eyes come back', back.live === 'firstPerson' && back.blending);
	for (let k = 0; k < 30; k++) back = d.frame(16, me);
	check('…to eye height', near(back.pose.position.y, 1.6, 1e-6) && !back.blending);
}

// --- Collision: the sweep, the pull-in fast, the ease out slow.
{
	const c = createCameraCollider3d([
		{ kind: 'box', minX: -1, minY: 0, minZ: 4, maxX: 1, maxY: 3, maxZ: 5 },
	]);
	check('a clear sweep is 1', c.cast({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: -10 }, 0.3) === 1);
	check(
		'a wall stops the sphere a radius short',
		near(c.cast({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 10 }, 0.3), 0.37, 1e-9),
	);
	check(
		'starting inside a collider ignores it',
		c.cast({ x: 0, y: 1, z: 4.5 }, { x: 0, y: 1, z: 10 }, 0.3) === 1,
	);
	const ramp = createCameraCollider3d([
		{ kind: 'ramp', facing: '+x', minX: 0, minY: 0, minZ: -1, maxX: 4, maxY: 2, maxZ: 1 },
	]);
	check(
		'a ray over the low end of a ramp is clear',
		ramp.cast({ x: 0.5, y: 1.2, z: -3 }, { x: 0.5, y: 1.2, z: 3 }, 0) === 1,
	);
	check(
		'the same ray over its high end hits',
		ramp.cast({ x: 3.5, y: 1.2, z: -3 }, { x: 3.5, y: 1.2, z: 3 }, 0) < 1,
	);

	// The arena's 2.5 m tier: standing just north of it, the follow camera behind (+z) hangs over it.
	const d = createCameraDirector3d({
		rigs,
		seed: 's',
		follow: 'me',
		active: 'follow',
		colliders: arena.colliders,
	});
	const open = d.frame(16, () => body({ z: 0 }));
	const pivotOpen = { x: 0, y: 1, z: 0 };
	const byWall = d.frame(16, () => body({ z: -7 }));
	const pivotWall = { x: 0, y: 1, z: -7 };
	const free = dist(open.pose.position, pivotOpen);
	const held = dist(byWall.pose.position, pivotWall);
	check(
		'in the open the camera keeps its distance',
		near(free, RIG3D_DEFAULTS.distance, 1e-6),
		String(free),
	);
	check('by the wall it pulls in at once', held < free * 0.5, `${held} m`);
	const back = [];
	for (let k = 0; k < 30; k++)
		back.push(dist(d.frame(16, () => body({ z: 0 })).pose.position, pivotOpen));
	check(
		'away from the wall it eases back out, slowly',
		back[0] < free * 0.8 && back[0] > held && back.at(-1) > back[0] && back.at(-1) < free,
		JSON.stringify([back[0], back.at(-1)]),
	);
	for (let k = 0; k < 200; k++) d.frame(16, () => body({ z: 0 }));
	check(
		'…and reaches its distance again',
		near(dist(d.frame(16, () => body({ z: 0 })).pose.position, pivotOpen), free, 1e-3),
	);
}

// --- Shake: seeded, decaying, independent of how frames cut the time.
{
	const run = (seed, dts) => {
		const s = createShake3d(seed);
		s.add(0.8, 500);
		const out = [];
		let t = 0;
		for (const dt of dts) {
			const v = s.step(dt);
			t += dt;
			out.push({ t, ...v });
		}
		return out;
	};
	const even = run('room-7', Array(40).fill(12.5));
	const again = run('room-7', Array(40).fill(12.5));
	check('the same seed shakes the same', JSON.stringify(even) === JSON.stringify(again));
	const other = run('room-8', Array(40).fill(12.5));
	check('another seed shakes otherwise', JSON.stringify(even) !== JSON.stringify(other));
	const uneven = run('room-7', Array(20).fill(25));
	check(
		'frame rate does not change the shake at a time',
		uneven.every(
			(u, k) =>
				near(u.yaw, even[2 * k + 1].yaw, 1e-9) && near(u.offset.z, even[2 * k + 1].offset.z, 1e-9),
		),
	);
	const peak = Math.max(...even.slice(0, 8).map((e) => Math.abs(e.yaw) + Math.abs(e.pitch)));
	check('it moves while trauma lasts', peak > 0.1, String(peak));
	check(
		'it is at rest when the time is up',
		even.slice(-1)[0].yaw === 0 && even.slice(-1)[0].offset.x === 0,
	);
	const d1 = director({ seed: 'abc' });
	const d2 = director({ seed: 'abc' });
	d1.frame(16, () => body());
	d2.frame(16, () => body());
	d1.shake(0.5, 300);
	d2.shake(0.5, 300);
	const a = d1.frame(16, () => body());
	const b = d2.frame(16, () => body());
	check(
		'two directors with one seed shake alike',
		JSON.stringify(a.pose) === JSON.stringify(b.pose),
	);
	check(
		'the shake leaves the aim (yaw/pitch) alone',
		near(a.yaw, 0, 1e-9) && near(a.pitch, -RIG3D_DEFAULTS.pitch, 1e-6),
	);
}

// --- An authored move: top priority, blend in, finished, hand back.
{
	const d = director();
	const me = () => body({ z: 4 });
	d.frame(16, me);
	const path = (t) => ({ x: 20 - (t / 1000) * 10, y: 10, z: 0 });
	const move = {
		name: 'intro',
		durationMs: 1000,
		fov: 60,
		sample: (t) => {
			const position = path(t);
			return { position, rotation: lookAt(position, { x: 0, y: 0, z: 0 }) };
		},
	};
	let finished = false;
	const done = d.playMove(move, { blendInMs: 0, blendOutMs: 400 }).then(() => (finished = true));
	const v0 = d.frame(16, me);
	check(
		'a move takes the screen at once with no blend-in',
		v0.live.startsWith('move:intro') && dist(v0.pose.position, path(16)) < 1e-9,
	);
	check('its FOV is the clip camera’s', v0.pose.fov === 60);
	d.activate('orbit', { ease: 'cut' });
	check('a rig activated meanwhile waits under it', d.frame(16, me).live.startsWith('move:'));
	let frames = 0;
	while (!finished && frames < 200) {
		d.frame(16, me);
		await Promise.resolve();
		frames += 1;
	}
	await done;
	check('it finishes after its length', finished && frames >= 58 && frames <= 66, String(frames));
	const after = d.frame(16, me);
	check(
		'then hands back to the rig underneath, blending',
		after.live === 'orbit' && after.blending,
	);
	let prev = after;
	let worst = 0;
	for (let k = 0; k < 30; k++) {
		const v = d.frame(16, me);
		worst = Math.max(worst, dist(v.pose.position, prev.pose.position));
		prev = v;
	}
	check('…without a pop', worst < 1.5 && !prev.blending, String(worst));
	const rel = director();
	rel.frame(16, () => body({ x: 5, z: 5 }));
	rel.playMove(move, { space: 'target' });
	const r = rel.frame(16, () => body({ x: 5, z: 5 }));
	check(
		"space 'target' moves the clip to the followed body",
		dist(r.pose.position, { x: 25 - 0.16, y: 10, z: 5 }) < 1e-9,
	);
	const replaced = director();
	replaced.frame(16, me);
	let firstDone = false;
	replaced.playMove(move).then(() => (firstDone = true));
	replaced.frame(16, me);
	replaced.playMove({ ...move, name: 'intro' }, { blendInMs: 300 });
	await Promise.resolve();
	check('a move replaced by another finishes', firstDone);
	check('…and the new one blends in', replaced.frame(16, me).blending);
}

// --- The fixture moves, as Blender exported them, read the way the game reads them.
{
	const buf = readFileSync(
		new URL('../packages/engine-3d/fixtures/cameras/sample.glb', import.meta.url),
	);
	const moves = await loadCameraMoves3d(
		buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
	);
	check(
		'the fixture holds intro and roundEnd',
		[...moves.keys()].join() === 'intro,roundEnd',
		[...moves.keys()].join(),
	);
	const intro = moves.get('intro');
	check(
		'intro is 4 s at the camera FOV (45°)',
		near(intro.durationMs, 4000) && near(intro.fov, 45, 1e-4),
	);
	const start = intro.sample(0);
	const toOrigin = yawPitchOf(lookAt(start.position, { x: 0, y: 0, z: 0 }));
	const looks = yawPitchOf(start.rotation);
	check(
		"Blender's −Z-forward camera reaches three looking where it was aimed",
		near(looks.yaw, toOrigin.yaw, 0.01) && near(looks.pitch, toOrigin.pitch, 0.01),
		JSON.stringify({ looks, toOrigin }),
	);
	const end = intro.sample(4000);
	const follow = rigPosition({ x: -3, y: 1, z: 12 }, RIG3D_DEFAULTS);
	check(
		'intro ends on the follow rig over the spawn',
		dist(end.position, follow) < 1e-3,
		JSON.stringify(end.position),
	);
	const round = moves.get('roundEnd');
	check(
		'each clip samples its own track (roundEnd starts where it was keyed, not where intro ended)',
		dist(round.sample(0).position, { x: 0, y: 3.5, z: 6 }) < 1e-4,
		JSON.stringify(round.sample(0).position),
	);
	const d = createCameraDirector3d({ rigs, seed: 's', follow: 'me', active: 'follow' });
	const spawn = () => body({ x: -3, z: 12 });
	d.frame(16, spawn);
	let finished = false;
	d.playMove(intro, { blendOutMs: 600 }).then(() => (finished = true));
	let worst = 0;
	let prev = d.frame(16, spawn);
	for (let k = 0; k < 400 && !prev.live.startsWith('follow'); k++) {
		const v = d.frame(16, spawn);
		await Promise.resolve();
		if (k > 0) worst = Math.max(worst, dist(v.pose.position, prev.pose.position));
		prev = v;
	}
	check(
		'the intro plays and hands back to follow without a pop',
		finished && prev.live === 'follow' && worst < 1,
		String(worst),
	);
}

// --- The lens: a FOV is vertical, so a portrait phone keeps a usable view across.
{
	const portrait = 390 / 844;
	const wide = 16 / 9;
	const bare = horizontalFov(45, portrait);
	check(
		'45° on a 390×844 phone is ~22° across without the lens',
		near(bare, 21.7, 0.1),
		String(bare),
	);
	check(
		'landscape and square screens keep the rig FOV',
		[35, 45, 55, 70, 90].every(
			(f) => lensFov(f, wide) === f && lensFov(f, 4 / 3) === f && lensFov(f, 1) === f,
		),
	);
	const held = lensFov(45, portrait);
	check(
		'portrait holds the FOV across the rig shows on a square screen',
		near(horizontalFov(held, portrait), 45, 1e-9) && held < CAMERA_LENS_DEFAULT.maxFov,
		String(held),
	);
	check(
		'…widening the vertical no further than maxFov',
		lensFov(70, portrait) === CAMERA_LENS_DEFAULT.maxFov &&
			horizontalFov(lensFov(70, portrait), portrait) > horizontalFov(70, portrait) + 20,
		String(lensFov(70, portrait)),
	);
	check(
		'an aim zoom stays a zoom in portrait',
		lensFov(35, portrait) < lensFov(55, portrait) - 10,
		`${lensFov(35, portrait)} vs ${lensFov(55, portrait)}`,
	);
	check('no jump at minAspect', near(lensFov(45, 0.999), 45, 0.1), String(lensFov(45, 0.999)));
	check('a rig wider than maxFov is never narrowed', lensFov(110, portrait) === 110);
	check(
		'minAspect 0 turns the lens off',
		lensFov(45, portrait, { minAspect: 0, maxFov: 100 }) === 45,
	);
	check(
		'the lens is authored (arcade.world3d.camera.lens), the default when absent',
		JSON.stringify(camera3dOf({}).lens) === JSON.stringify(CAMERA_LENS_DEFAULT) &&
			JSON.stringify(camera3dOf({ lens: { minAspect: 4 / 3, maxFov: 90 } }).lens) ===
				JSON.stringify({ minAspect: 4 / 3, maxFov: 90 }),
	);
	const d = createCameraDirector3d({
		rigs: defaultCameraRigs3d(RIG3D_DEFAULTS),
		active: 'follow',
		seed: 'lens',
	});
	const me = () => body();
	const land = d.frame(16, me, undefined, wide);
	const port = d.frame(16, me, undefined, portrait);
	check(
		'the director fits the FOV on screen to the screen',
		land.pose.fov === RIG3D_DEFAULTS.fov &&
			near(port.pose.fov, lensFov(RIG3D_DEFAULTS.fov, portrait)),
		`${land.pose.fov} / ${port.pose.fov}`,
	);
	d.activate('firstPerson', { blendMs: 600 });
	let prev = port.pose.fov;
	let step = 0;
	let last = port;
	for (let k = 0; k < 50; k++) {
		last = d.frame(16, me, undefined, portrait);
		step = Math.max(step, Math.abs(last.pose.fov - prev));
		prev = last.pose.fov;
	}
	check(
		'a portrait switch blends the FOV without a pop and lands on the fitted rig FOV',
		step < 2 && last.live === 'firstPerson' && near(last.pose.fov, lensFov(70, portrait)),
		`step ${step}, ${last.pose.fov}`,
	);
}

// --- The seam's Flow enum (`apps/lines/src/game/camera3dFlow.ts`, read at boot) names the eases.
{
	const seam = readFileSync(
		new URL('../apps/lines/src/game/camera3dFlow.ts', import.meta.url),
		'utf8',
	);
	const list = /CAMERA3D_EASES = \[([^\]]*)\]/
		.exec(seam)?.[1]
		.match(/'([^']+)'/g)
		?.map((q) => q.slice(1, -1));
	check(
		"the Flow ease enum equals the director's eases",
		list?.join() === CAMERA_EASES.join(),
		String(list),
	);
}

if (failures.length) {
	console.error(`check:engine-3d-camera — ${failures.length} failed, ${passed} passed`);
	for (const f of failures) console.error(`  ✗ ${f}`);
	process.exit(1);
}
console.log(`check:engine-3d-camera — ${passed} checks passed`);
