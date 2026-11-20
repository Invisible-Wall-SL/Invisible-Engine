// The 2.5D rig's make-or-break gate (docs/design/rig-2p5d.md), on the SHIPPED bake: an arm keyed in 3D
// is baked by `apps/launcher-api/src/lib/rig2p5d.ts` into ordinary irig v1 timelines, read by the
// strict irig reader, loaded and played by the REAL engine-rig (SkeletonJson → Skeleton →
// AnimationState, as a game plays it), and every bone's world 2D frame is compared with the
// orthographic projection of the 3D reference — computed here, independently of the bake: its own
// matrices, and each 3D channel sampled by engine-rig's own timelines — at dense sample times.
//
// The motion: a chest turning; an arm that reaches toward the camera, is held exactly edge-on, swings
// round through edge-on and behind the body (with a depth wobble across the torso), rolls through
// edge-on twice; then a hand that turns 45°, 90° and −50° on a still arm, showing drawings by angle
// (its image bone hangs from the chest and follows the hand). A sleeve mesh is weighted across the
// elbow. Two arms:
//  - CROSSED, the stress case: the elbow and wrist leave the upper arm's plane (the forearm tilts and
//    twists, the elbow sits 4 units in front of the upper arm's card, the wrist twists);
//  - HINGED, the template rule: the elbow and wrist bend in the upper arm's plane.
// Plus CALM (everyday motion), STRETCH (in-plane 3D scale, translate and depth keys under a moving
// root) and CURVES (bezier keys on every kind of channel, a stepped key, a first key after 0).
// Asserted:
//  - every card corner of every bone within 1 rig unit (1 px at scale 1) of the 3D projection, on a
//    1 kHz grid and densely around every edge-on crossing and stepped key — the floor included;
//  - the weighted sleeve's vertices within 1 rig unit of its 3D skin, projected (§4.6);
//  - the parent really is edge-on (a projected determinant of ~0, held), and crosses it;
//  - the baked clip is ordinary data: the strict irig reader accepts it; only 4.2 timelines;
//  - key reduction: under a key-frames and a timeline-keys per-second budget per arm, which the
//    dense bake and straight runs (no bezier) break; every curve a 4.2 bezier (four numbers per
//    value, its time handles inside its run);
//  - draw order from depth: what engine-rig draws is the bake's order, consistent with depth past the
//    hysteresis, and the arm goes behind the torso and back once each way despite the wobble;
//  - drawings by angle: engine-rig shows the drawing the bake chose; at 45° the ¾ drawing is shown
//    and drawn unsquashed, at 90° the side one, at −50° the other ¾; no swap flickers;
//  - per-channel Euler keys: the bake's 3D pose matches engine-rig's sampling of the same keys
//    (bezier, stepped, before the first key), and a stepped key bakes to a step;
//  - each clip ends with its angles in (−180°, 180°]; a crossfade between two baked clips through
//    AnimationState is continuous and does not spin;
//  - a clip with no 3D keys bakes to itself; the validator refuses a constraint at a non-zero mix on
//    a baked bone (or one it hangs from), and the bake refuses what the validator refuses;
//  - mutations, each must fail: no shear, parent-local projection, keys only at the 3D keys (no dense
//    bake), no key reduction (size), straight runs only (size), no floor, no step at a flip, no
//    draw-order hysteresis, bezier handles written as progress (the `orient` keys' convention), a run's
//    error measured in its bone's local space (on the stress arm, and under a parent drawn at ×3), a
//    step written as one key, no angle wrap (the crossfades spin, an angle ends a turn out).
//   node tools/rigger-spike/rig-2p5d.mjs
import { mkdtempSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESBUILD } from './esbuild.mjs';
import { RIG_CORE } from './rig.mjs';

const APP = fileURLToPath(new URL('../../apps/launcher-api/', import.meta.url));
const esbuild = await import(ESBUILD);
const dir = mkdtempSync(join(tmpdir(), 'rig-2p5d-'));
const outfile = join(dir, 'rig2p5d.mjs');
await esbuild.build({
	entryPoints: [join(APP, 'src/lib/rig2p5d.ts')],
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile,
	logLevel: 'error',
});
const { bake2p5d, rig2p5dProblems, pose3d, cornerError, orientOf, anglesOf } = await import(
	pathToFileURL(outfile).href
);
rmSync(dir, { recursive: true, force: true });

const {
	TextureAtlas,
	AtlasAttachmentLoader,
	SkeletonJson,
	Skeleton,
	AnimationState,
	AnimationStateData,
	Physics,
	readIrig,
} = await import(RIG_CORE);

let checks = 0;
let fails = 0;
const ok = (label, cond, detail = '') => {
	checks++;
	if (cond) return;
	fails++;
	console.error(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};

// ── The reference's matrices (written here apart from the bake, also used to author the clips) ──

const R = Math.PI / 180;
/** Rotation matrices (row-major) about x, y, z. */
const rx = (d) => [
	1,
	0,
	0,
	0,
	Math.cos(d * R),
	-Math.sin(d * R),
	0,
	Math.sin(d * R),
	Math.cos(d * R),
];
const ry = (d) => [
	Math.cos(d * R),
	0,
	Math.sin(d * R),
	0,
	1,
	0,
	-Math.sin(d * R),
	0,
	Math.cos(d * R),
];
const rz = (d) => [
	Math.cos(d * R),
	-Math.sin(d * R),
	0,
	Math.sin(d * R),
	Math.cos(d * R),
	0,
	0,
	0,
	1,
];
const mm = (p, c) =>
	Array.from({ length: 9 }, (_, i) => {
		const r = (i / 3) | 0;
		const col = i % 3;
		return p[r * 3] * c[col] + p[r * 3 + 1] * c[3 + col] + p[r * 3 + 2] * c[6 + col];
	});
const mv = (m, v) =>
	[0, 1, 2].map((r) => m[r * 3] * v[0] + m[r * 3 + 1] * v[1] + m[r * 3 + 2] * v[2]);
/** The design's orientation: rotate about z, then tilt (tip toward the viewer) about y, then twist about x. */
const euler = (rot, tilt, twist) => mm(mm(rz(rot), ry(-tilt)), rx(twist));
/** A rotation matrix's unit quaternion [w, x, y, z] (Shepperd), and back. */
function toQuat(m) {
	const [a, b, c, d, e, f, g, h, i] = m;
	const tr = a + e + i;
	if (tr > 0) {
		const s = Math.sqrt(tr + 1) * 2;
		return [s / 4, (h - f) / s, (c - g) / s, (d - b) / s];
	}
	if (a > e && a > i) {
		const s = Math.sqrt(1 + a - e - i) * 2;
		return [(h - f) / s, s / 4, (b + d) / s, (c + g) / s];
	}
	if (e > i) {
		const s = Math.sqrt(1 + e - a - i) * 2;
		return [(c - g) / s, (b + d) / s, s / 4, (f + h) / s];
	}
	const s = Math.sqrt(1 + i - a - e) * 2;
	return [(d - b) / s, (c + g) / s, (f + h) / s, s / 4];
}
const fromQuat = (q) => {
	const n = Math.hypot(...q);
	const [w, x, y, z] = q.map((v) => v / n);
	return [
		1 - 2 * (y * y + z * z),
		2 * (x * y - w * z),
		2 * (x * z + w * y),
		2 * (x * y + w * z),
		1 - 2 * (x * x + z * z),
		2 * (y * z - w * x),
		2 * (x * z - w * y),
		2 * (y * z + w * x),
		1 - 2 * (x * x + y * y),
	];
};
/** Slerp along the shorter arc (the gate's own); `u` past 1 goes on along the arc. */
function slerpRef(qa, qb, u) {
	const a = qa.map((v) => v / Math.hypot(...qa));
	let b = qb.map((v) => v / Math.hypot(...qb));
	let dot = a.reduce((s, v, i) => s + v * b[i], 0);
	if (dot < 0) [b, dot] = [b.map((v) => -v), -dot];
	const th = Math.acos(Math.min(1, dot));
	return th < 1e-6
		? a.map((v, i) => v + (b[i] - v) * u)
		: a.map((v, i) => (v * Math.sin((1 - u) * th) + b[i] * Math.sin(u * th)) / Math.sin(th));
}

// ── The rigs and the clips ──────────────────────────────────────────────────────────────────────

const HAND_VIEWS = [
	{ attachment: 'hand_front', turn: 0 },
	{ attachment: 'hand_3q_r', turn: 45 },
	{ attachment: 'hand_side_r', turn: 90 },
	{ attachment: 'hand_3q_l', turn: -45 },
	{ attachment: 'hand_side_l', turn: -90 },
];
/** A full turnaround's back drawings (design §4.7). */
const BACK_VIEWS = [
	{ attachment: 'hand_3q_back_r', turn: 135 },
	{ attachment: 'hand_back', turn: 180 },
	{ attachment: 'hand_3q_back_l', turn: -135 },
];
const rigWith = (elbowDepth, turnaround = 'side') => ({
	turnaround,
	bones: [
		{ name: 'root' },
		{ name: 'chest', parent: 'root', card: { x0: -90, x1: 90, h: 130 } },
		{
			name: 'upper_arm',
			parent: 'chest',
			x: 80,
			y: 100,
			rotate: -90,
			length: 120,
			card: { x0: 0, x1: 120, h: 18 },
		},
		{
			name: 'forearm',
			parent: 'upper_arm',
			x: 120,
			depth: elbowDepth,
			length: 100,
			card: { x0: 0, x1: 100, h: 15 },
		},
		{ name: 'hand', parent: 'forearm', x: 100, length: 40, card: { x0: 0, x1: 40, h: 16 } },
		{
			name: 'hand_image',
			parent: 'chest',
			follow: 'hand',
			length: 40,
			card: { x0: 0, x1: 40, h: 16 },
		},
	],
	slots: [
		{ name: 'torso', bone: 'chest', attachment: 'torso' },
		{ name: 'upper_arm', bone: 'upper_arm', attachment: 'upper_arm' },
		{ name: 'sleeve', bone: 'upper_arm', attachment: 'sleeve' },
		{ name: 'forearm', bone: 'forearm', attachment: 'forearm' },
		{
			name: 'hand',
			bone: 'hand_image',
			attachment: 'hand_front',
			drawings: turnaround === 'full' ? [...HAND_VIEWS, ...BACK_VIEWS] : HAND_VIEWS,
		},
	],
});
/**
 * The sleeve over the elbow, in setup: three columns along the arm, the middle one weighted half to
 * each bone. Each influence's point lies inside that bone's card (so its error is bounded by the
 * card's corners), at z = 0 in its card plane.
 */
const SLEEVE = [100, 120, 140].flatMap((x) =>
	[-12, 12].map((y) => ({
		x,
		y,
		w:
			x === 100
				? [['upper_arm', 1, x, y]]
				: x === 140
					? [['forearm', 1, x - 120, y]]
					: [
							['upper_arm', 0.5, x, y],
							['forearm', 0.5, x - 120, y],
						],
	})),
);
/** The hull, in order round the sleeve, and its triangles. */
const SLEEVE_HULL = [0, 2, 4, 5, 3, 1];
const SLEEVE_TRIANGLES = [0, 2, 1, 2, 3, 1, 2, 4, 3, 4, 5, 3];

/** A key of the 3D pose: absolute rotate, tilt, twist, and how it runs to the next key. */
const k = (time, rotate, tilt = 0, twist = 0, run) => ({ time, rotate, tilt, twist, run });
/** 4.2 bezier handles over a key run's progress (0 → 1): an ease in-out, or an overshoot. */
const progress = (t0, t1, run) =>
	run === 'ease'
		? [t0 + (t1 - t0) / 3, 0, t1 - (t1 - t0) / 3, 1]
		: [t0 + (t1 - t0) / 4, 1.4, t1 - (t1 - t0) / 4, 1.3];
/**
 * Pose keys as orientation keys: each a quaternion (the gate's own, from its matrices) of the turn
 * from the setup, and a curve over the slerp's progress where the key names one.
 */
function orient(setupRotate, keys) {
	return keys.map((key, i) => {
		const next = keys[i + 1];
		const out = {
			time: key.time,
			value: toQuat(euler(key.rotate - setupRotate, key.tilt, key.twist)),
		};
		if (key.run === 'stepped') out.curve = 'stepped';
		else if (key.run && next) out.curve = progress(key.time, next.time, key.run);
		return out;
	});
}
const lin = (rows) => rows.map(([time, value]) => ({ time, value }));
const CHEST = [k(0, 0), k(0.8, 0, 15), k(1.2, 0), k(2.7, 0), k(3.2, 0, 15), k(3.6, 0), k(4.6, 0)];
const UPPER = [
	k(0, -90),
	// Reach toward the camera…
	k(1.0, -30, 75),
	k(1.2, -30, 89.9),
	// …held exactly edge-on (its card's normal in the picture plane)…
	k(1.3, -30, 90),
	k(1.5, -30, 90),
	// …swing round through edge-on, wobble across the torso's depth, go behind it and come back…
	k(1.7, -30, 105),
	k(1.95, -30, 3),
	k(1.99, -30, -3),
	k(2.03, -30, 3),
	k(2.07, -30, -3),
	k(2.2, -30, -50),
	k(2.6, -60, 10),
	// …and roll a full turn about its own length (edge-on at 90° and 270°).
	k(3.0, -60, 10, 90),
	k(3.25, -60, 10, 180),
	k(3.45, -75, 5, 270),
	k(3.6, -90, 0, 360),
	k(4.6, -90),
];
// The hand turns on a still arm: 45° (held), 90°, −50°.
const HAND_TURN = [
	k(3.6, 0),
	k(3.9, 0, 45),
	k(4.1, 0, 45),
	k(4.3, 0, 90),
	k(4.45, 0, -50),
	k(4.6, 0),
];
const CROSSED = {
	name: 'crossed',
	rig: rigWith(4),
	clip: {
		name: 'reach',
		duration: 4.6,
		bones: {
			chest: { orient: orient(0, CHEST) },
			upper_arm: { orient: orient(-90, UPPER) },
			forearm: {
				orient: orient(0, [
					k(0, 0),
					k(1.0, 40, 20),
					k(1.5, 40, 20),
					k(2.2, 20, -10),
					k(2.6, 30),
					k(3.0, 30),
					k(3.3, 30, 0, -60),
					k(3.6, 0),
					k(4.6, 0),
				]),
			},
			hand: { orient: orient(0, [k(0, 0), k(1.0, 0, 0, 30), k(2.6, 0), ...HAND_TURN]) },
		},
	},
};
const HINGED_RIG = rigWith(0);
// The elbow is a hinge: the forearm keys a plain 2D rotate in the upper arm's plane.
const HINGED = {
	name: 'hinged',
	rig: HINGED_RIG,
	clip: {
		name: 'reach',
		duration: 4.6,
		bones: {
			chest: { orient: orient(0, CHEST) },
			upper_arm: { orient: orient(-90, UPPER) },
			forearm: {
				rotate: lin([
					[0, 0],
					[1.0, 40],
					[1.5, 40],
					[2.2, 20],
					[2.6, 30],
					[3.6, 0],
					[4.6, 0],
				]),
			},
			hand: { orient: orient(0, [k(0, 0), ...HAND_TURN]) },
		},
	},
};
// A calm clip on the hinged arm, for what everyday 3D motion costs: a sway, a lift toward the
// camera and back, a small hand turn, nothing edge-on.
const CALM = {
	name: 'calm',
	rig: HINGED_RIG,
	clip: {
		name: 'calm',
		duration: 4,
		bones: {
			chest: { orient: orient(0, [k(0, 0), k(1, 0, 10), k(3, 0, -10), k(4, 0)]) },
			upper_arm: {
				orient: orient(-90, [k(0, -90), k(1.5, -70, 30), k(3, -95, -20), k(4, -90)]),
			},
			forearm: {
				rotate: lin([
					[0, 20],
					[1.5, 40],
					[3, 15],
					[4, 20],
				]),
			},
			hand: { orient: orient(0, [k(0, 0), k(2, 0, 30), k(4, 0)]) },
		},
	},
};
// In-plane 3D scale, translate and depth keys: the root walks (a 2D bone, passed through), the chest
// shifts, turns and at the end spins 400° in the picture (keyed every 100°, since a slerp takes the
// shorter arc; its angle must end back in (−180°, 180°]), the upper arm stretches non-uniformly and
// comes forward in depth while it tilts, the forearm slides and squashes.
const STRETCH = {
	name: 'stretch',
	rig: HINGED_RIG,
	clip: {
		name: 'stretch',
		duration: 3,
		bones: {
			root: {
				translate: [
					{ time: 0, x: 0, y: 0 },
					{ time: 3, x: 60, y: 10 },
				],
			},
			chest: {
				translate: [
					{ time: 0, x: 0, y: 0 },
					{ time: 1.5, x: 40, y: -25 },
					{ time: 3, x: 0, y: 0 },
				],
				orient: orient(0, [
					k(0, 0),
					k(1.5, 0, 20),
					k(2, 0, 40 / 3),
					k(2.25, 100, 10),
					k(2.5, 200, 20 / 3),
					k(2.75, 300, 10 / 3),
					k(3, 400),
				]),
			},
			upper_arm: {
				orient: orient(-90, [k(0, -90), k(1, -50, 60), k(2, -110, -30), k(3, -90)]),
				scale: [
					{ time: 0, x: 1, y: 1 },
					{ time: 1, x: 1.3, y: 0.7 },
					{ time: 2, x: 0.8, y: 1.25 },
					{ time: 3, x: 1, y: 1 },
				],
				depth: lin([
					[0, 0],
					[1.5, 30],
					[3, 0],
				]),
			},
			forearm: {
				rotate: lin([
					[0, 0],
					[1, 50],
					[2, 20],
					[3, 0],
				]),
				translate: [
					{ time: 0, x: 0, y: 0 },
					{ time: 1.5, x: 12, y: 4 },
					{ time: 3, x: 0, y: 0 },
				],
				scale: [
					{ time: 0, x: 1, y: 1 },
					{ time: 1.5, x: 0.85, y: 1.2 },
					{ time: 3, x: 1, y: 1 },
				],
			},
			hand: { orient: orient(0, [k(0, 0), k(1.5, 0, 40), k(3, 0)]) },
		},
	},
};
/** 4.2 bezier handles from key (t0, v0) to (t1, v1) in value: an ease in-out, or an overshoot. */
const bez = (t0, v0, t1, v1, kind) =>
	kind === 'ease'
		? [t0 + (t1 - t0) / 3, v0, t1 - (t1 - t0) / 3, v1]
		: [t0 + (t1 - t0) / 4, v0 + (v1 - v0) * 1.4, t1 - (t1 - t0) / 4, v1 + (v1 - v0) * 0.3];
/** Rows [time, value, curve?] as 4.2 keys, a curve naming how the key runs to the next. */
const curve1 = (rows) =>
	rows.map(([time, value, kind], i) => {
		const next = rows[i + 1];
		const key = { time, value };
		if (kind === 'stepped') key.curve = 'stepped';
		else if (kind && next) key.curve = bez(time, value, next[0], next[1], kind);
		return key;
	});
/** Rows [time, x, y, curve?] as 4.2 two-value keys (four handle numbers per value). */
const curve2 = (rows) =>
	rows.map(([time, x, y, kind], i) => {
		const next = rows[i + 1];
		const key = { time, x, y };
		if (kind && next)
			key.curve = [
				...bez(time, x, next[0], next[1], kind),
				...bez(time, y, next[0], next[2], kind),
			];
		return key;
	});
// Curves on every kind of key: eased and overshooting orientation keys (the overshoot slerps past
// the next key and back), a stepped orientation key (the arm snaps at 2.2 s), a hand whose first
// key comes at 0.5 s (before it, the setup — then a jump, as in 4.2), and bezier translate, rotate,
// scale and depth keys.
const CURVES = {
	name: 'curves',
	rig: HINGED_RIG,
	clip: {
		name: 'curves',
		duration: 3,
		bones: {
			root: {
				translate: curve2([
					[0, 0, 0, 'ease'],
					[1.5, 50, -20, 'overshoot'],
					[3, 0, 0],
				]),
			},
			chest: {
				orient: orient(0, [k(0, 0, 0, 0, 'overshoot'), k(1.5, 10, 25, 0, 'ease'), k(3, 0)]),
			},
			upper_arm: {
				orient: orient(-90, [
					k(0, -90, 0, 0, 'overshoot'),
					k(1, -40, 70, 30, 'ease'),
					k(1.8, -55, -40, 50, 'stepped'),
					k(2.2, -70, 30, 66, 'ease'),
					k(3, -90, 0, 90),
				]),
				depth: curve1([
					[0, 0, 'ease'],
					[1.5, 20, 'ease'],
					[3, 0],
				]),
			},
			forearm: {
				rotate: curve1([
					[0, 10, 'overshoot'],
					[1.5, 60, 'ease'],
					[3, 10],
				]),
				scale: curve2([
					[0, 1, 1, 'ease'],
					[1.5, 1.2, 0.8, 'ease'],
					[3, 1, 1],
				]),
			},
			hand: {
				orient: orient(0, [
					k(0.5, 0, 0, 20, 'ease'),
					k(1.2, 0, 80, 0, 'overshoot'),
					k(2.4, 0, -30, -20),
					k(3, 0),
				]),
			},
		},
	},
};
// The hand turns past its side view on a still arm: to 135° (held), then right round to 180° (held).
// On a side turnaround it shows a front-half drawing mirrored (as a card's back is); on a full one,
// its back drawings.
const turnClip = (rig) => ({
	rig,
	probes: [1.2, 2.1],
	clip: {
		name: 'turn',
		duration: 2.4,
		bones: {
			hand: {
				orient: orient(0, [
					k(0, 0),
					k(0.6, 0, 90),
					k(1.0, 0, 135),
					k(1.4, 0, 135),
					k(1.8, 0, 180),
					k(2.4, 0, 180),
				]),
			},
		},
	},
});
const TURN_SIDE = { name: 'turn-side', ...turnClip(rigWith(0, 'side')) };
const TURN_FULL = { name: 'turn-full', ...turnClip(rigWith(0, 'full')) };
const BAKED = ['chest', 'upper_arm', 'forearm', 'hand', 'hand_image'];

// ── The reference: the 3D pose projected ────────────────────────────────────────────────────────

/**
 * Each 3D channel sampled by engine-rig's own timelines: a skeleton with one bone per channel, its
 * keys read by SkeletonJson as a rotate timeline (curves included), so the reference interpolates
 * exactly as a game interpolates a 2D channel. Orientation keys become a timeline of their index
 * (key i has value i, its curve shifted by i), so engine-rig samples each run's progress and the gate
 * slerps. Before a channel's first key: the setup's value.
 */
function sampler(clip) {
	const bones = [{ name: 'root' }];
	const timelines = {};
	const add = (id, keys, value, curveOf) => {
		bones.push({ name: id, parent: 'root' });
		timelines[id] = {
			rotate: keys.map((key, i) => {
				const curve =
					key.curve === 'stepped' ? 'stepped' : key.curve ? curveOf(key.curve, i) : undefined;
				return { time: key.time ?? 0, value: value(key, i), ...(curve ? { curve } : {}) };
			}),
		};
	};
	for (const [bone, keys] of Object.entries(clip.bones))
		for (const [ch, list] of Object.entries(keys)) {
			if (ch === 'orient')
				add(
					`${bone}.orient`,
					list,
					(_, i) => i,
					(c, i) => [c[0], c[1] + i, c[2], c[3] + i],
				);
			else if (ch === 'translate' || ch === 'scale') {
				const rest = ch === 'scale' ? 1 : 0;
				add(
					`${bone}.${ch}X`,
					list,
					(key) => key.x ?? rest,
					(c) => c.slice(0, 4),
				);
				add(
					`${bone}.${ch}Y`,
					list,
					(key) => key.y ?? rest,
					(c) => c.slice(4, 8),
				);
			} else
				add(
					`${bone}.${ch}`,
					list,
					(key) => key.value ?? 0,
					(c) => c.slice(0, 4),
				);
		}
	const data = new SkeletonJson(
		new AtlasAttachmentLoader(new TextureAtlas(ATLAS)),
	).readSkeletonData({
		skeleton: {},
		bones,
		slots: [],
		skins: [],
		animations: { s: { bones: timelines } },
	});
	const tl = new Map(
		data.findAnimation('s').timelines.map((t) => [data.bones[t.boneIndex].name, t]),
	);
	const sample = (bone, ch, t, rest = 0) => {
		const line = tl.get(`${bone}.${ch}`);
		if (!line) return rest;
		return t < line.frames[0] ? rest : line.getCurveValue(t);
	};
	/** A bone's turn from its setup at `t` (a quaternion), or null when it keys none. */
	const spin = (bone, t) => {
		const keys = clip.bones[bone]?.orient;
		if (!keys) return null;
		if (t < (keys[0].time ?? 0)) return [1, 0, 0, 0];
		let i = 0;
		while (i + 1 < keys.length && (keys[i + 1].time ?? 0) <= t) i++;
		if (i === keys.length - 1 || keys[i].curve === 'stepped') return keys[i].value;
		return slerpRef(keys[i].value, keys[i + 1].value, sample(bone, 'orient', t) - i);
	};
	return { sample, spin };
}

/** Every bone's 3D world { m, o } at `t`, an image bone on what it follows, turned back by its drawing. */
function refWorlds(rig, S, t, turnOf) {
	const out = new Map();
	for (const b of rig.bones) {
		const turnBack = turnOf(b.name, t);
		if (b.follow) {
			const f = out.get(b.follow);
			out.set(b.name, { m: turnBack ? mm(f.m, ry(turnBack)) : f.m, o: f.o });
			continue;
		}
		const ch = (c, rest = 0) => S.sample(b.name, c, t, rest);
		const q = S.spin(b.name, t);
		const sx = (b.scaleX ?? 1) * ch('scaleX', 1);
		const sy = (b.scaleY ?? 1) * ch('scaleY', 1);
		let m = mm(mm(rz(b.rotate ?? 0), q ? fromQuat(q) : rz(ch('rotate'))), [
			sx,
			0,
			0,
			0,
			sy,
			0,
			0,
			0,
			1,
		]);
		if (turnBack) m = mm(m, ry(turnBack));
		const o = [
			(b.x ?? 0) + ch('translateX'),
			(b.y ?? 0) + ch('translateY'),
			(b.depth ?? 0) + ch('depth'),
		];
		if (!b.parent) out.set(b.name, { m, o });
		else {
			const p = out.get(b.parent);
			const po = mv(p.m, o);
			out.set(b.name, { m: mm(p.m, m), o: [po[0] + p.o[0], po[1] + p.o[1], po[2] + p.o[2]] });
		}
	}
	return out;
}
const pic = (w) => ({ a: w.m[0], b: w.m[1], c: w.m[3], d: w.m[4], x: w.o[0], y: w.o[1] });
const det = (A) => A.a * A.d - A.b * A.c;
const sing = (A) => {
	const p = A.a * A.a + A.c * A.c;
	const r = A.b * A.b + A.d * A.d;
	const q = A.a * A.b + A.c * A.d;
	const s1 = Math.sqrt((p + r) / 2 + Math.hypot((p - r) / 2, q));
	return [s1, Math.abs(det(A)) / s1];
};
/** Where a clip's channels jump (independently of the bake): a stepped key, a first key off the setup. */
function jumpTimes(clip) {
	const out = [];
	const unitQ = (q) => q.map((v) => v / Math.hypot(...q));
	const same = (x, y) =>
		Math.abs(unitQ(x).reduce((sum, v, i) => sum + v * unitQ(y)[i], 0)) >= 1 - 1e-12;
	for (const keys of Object.values(clip.bones))
		for (const [ch, list] of Object.entries(keys)) {
			if (ch === 'orient') {
				if ((list[0].time ?? 0) > 0 && !same(list[0].value, [1, 0, 0, 0])) out.push(list[0].time);
				list.forEach((key, i) => {
					const next = list[i + 1];
					if (next && key.curve === 'stepped' && !same(key.value, next.value)) out.push(next.time);
				});
				continue;
			}
			const rest = ch === 'scale' ? 1 : 0;
			const vals = (key) =>
				ch === 'translate' || ch === 'scale' ? [key.x ?? rest, key.y ?? rest] : [key.value ?? 0];
			if ((list[0].time ?? 0) > 0 && vals(list[0]).some((v) => v !== rest)) out.push(list[0].time);
			list.forEach((key, i) => {
				const next = list[i + 1];
				if (next && key.curve === 'stepped' && vals(next).join() !== vals(key).join())
					out.push(next.time);
			});
		}
	return out;
}

// ── engine-rig ──────────────────────────────────────────────────────────────────────────────────

const REGIONS = [
	'torso',
	'upper_arm',
	'sleeve',
	'forearm',
	...[...HAND_VIEWS, ...BACK_VIEWS].map((v) => v.attachment),
];
const ATLAS = [
	'page.png',
	'size:1024,64',
	'filter:Linear,Linear',
	...REGIONS.flatMap((n, i) => [n, `bounds:${i * 64},0,64,64`]),
	'',
].join('\n');
const stub = {
	getImage: () => ({ width: 1, height: 1 }),
	setFilters() {},
	setWraps() {},
	dispose() {},
};
const store = (v) => Number(v.toPrecision(7));

/** The baked rig as an irig v1 file: the 2D setup the bake keyed against, the cards as regions. */
function docOf(rig, bakes) {
	const { setup } = bakes[0].result;
	const cards = new Map(rig.bones.map((b) => [b.name, b.card]));
	const index = new Map(rig.bones.map((b, i) => [b.name, i]));
	const region = (c) => ({ x: (c.x0 + c.x1) / 2, y: 0, width: c.x1 - c.x0, height: c.h * 2 });
	const sleeve = {
		type: 'mesh',
		uvs: SLEEVE.flatMap((v) => [(v.x - 100) / 40, (v.y + 12) / 24]),
		triangles: SLEEVE_TRIANGLES,
		vertices: SLEEVE.flatMap((v) => [
			v.w.length,
			...v.w.flatMap(([bone, weight, x, y]) => [index.get(bone), x, y, weight]),
		]),
		hull: SLEEVE_HULL.length,
		width: 40,
		height: 24,
	};
	return {
		irig: 1,
		skeleton: { hash: 'rig-2p5d', importedFrom: '4.2', x: -400, y: -400, width: 800, height: 800 },
		bones: rig.bones.map((b) => {
			const s = setup[b.name];
			return {
				name: b.name,
				...(b.parent ? { parent: b.parent } : {}),
				length: b.length ?? 0,
				x: store(s.x),
				y: store(s.y),
				rotation: store(s.rotation),
				...(store(s.scaleX) !== 1 ? { scaleX: store(s.scaleX) } : {}),
				...(store(s.scaleY) !== 1 ? { scaleY: store(s.scaleY) } : {}),
			};
		}),
		slots: rig.slots.map((s) => ({ name: s.name, bone: s.bone, attachment: s.attachment })),
		skins: [
			{
				name: 'default',
				attachments: Object.fromEntries(
					rig.slots.map((s) => {
						if (s.name === 'sleeve') return [s.name, { sleeve }];
						const r = region(cards.get(s.bone));
						const names = s.drawings ? s.drawings.map((d) => d.attachment) : [s.attachment];
						return [s.name, Object.fromEntries(names.map((n) => [n, r]))];
					}),
				),
			},
		],
		animations: Object.fromEntries(bakes.map(({ name, result }) => [name, result.animation])),
	};
}

/** Load the baked file as a game does: its skeleton and an AnimationState. */
function load(json, defaultMix = 0) {
	const atlas = new TextureAtlas(ATLAS);
	for (const p of atlas.pages) p.setTexture(stub);
	const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(
		JSON.parse(json),
	);
	const stateData = new AnimationStateData(data);
	stateData.defaultMix = defaultMix;
	return { skel: new Skeleton(data), state: new AnimationState(stateData) };
}
/** A player that advances one clip to each time asked. */
function player(json, animation) {
	const { skel, state } = load(json);
	state.setAnimation(0, animation, false);
	let now = 0;
	return (t) => {
		state.update(t - now);
		now = t;
		state.apply(skel);
		skel.updateWorldTransform(Physics.update);
		return skel;
	};
}
const worldOf = (skel, name) => {
	const b = skel.findBone(name);
	return { a: b.a, b: b.b, c: b.c, d: b.d, x: b.worldX, y: b.worldY };
};
/** The sleeve's skinned vertices as engine-rig computes them, and as its 3D skin projects. */
function sleeveError(skel, ref) {
	const slot = skel.findSlot('sleeve');
	const verts = new Float32Array(SLEEVE.length * 2);
	slot.getAttachment().computeWorldVertices(slot, 0, verts.length, verts, 0, 2);
	let e = 0;
	SLEEVE.forEach((v, i) => {
		let x = 0;
		let y = 0;
		for (const [bone, weight, lx, ly] of v.w) {
			const A = pic(ref.get(bone));
			x += weight * (A.a * lx + A.b * ly + A.x);
			y += weight * (A.c * lx + A.d * ly + A.y);
		}
		e = Math.max(e, Math.hypot(verts[i * 2] - x, verts[i * 2 + 1] - y));
	});
	return Number.isNaN(e) ? Infinity : e;
}

// ── One bake, verified ──────────────────────────────────────────────────────────────────────────

const HYSTERESIS = 6;

function verify({ rig, clip, probes = [4.0, 4.3, 4.45] }, options = {}) {
	const t0 = performance.now();
	const result = bake2p5d(rig, clip, options);
	const ms = performance.now() - t0;
	const { animation, report, drawings, orderAt } = result;
	const doc = docOf(rig, [{ name: clip.name, result }]);
	const json = JSON.stringify(doc);
	const card = Object.fromEntries(rig.bones.map((b) => [b.name, b.card]));
	const sched = drawings.hand;
	const viewAt = (t) => {
		let v = sched[0];
		for (const e of sched) if (e.time <= t) v = e;
		return v;
	};
	const turnOf = (name, t) => (name === 'hand_image' ? viewAt(t).turn : 0);
	const sample = sampler(clip);
	const worldsAt = (t) => refWorlds(rig, sample, t, turnOf);

	// Where the reference turns through edge-on, found on a 1 kHz grid and bisected.
	const D = clip.duration;
	const uniform = Array.from({ length: Math.floor(D * 1000) }, (_, i) => i / 1000 + 0.000317);
	const sides = uniform.map((t) => {
		const w = worldsAt(t);
		return BAKED.map((n) => det(pic(w.get(n))) >= -1e-12);
	});
	const flips = [];
	BAKED.forEach((name, n) => {
		for (let i = 1; i < uniform.length; i++) {
			if (sides[i][n] === sides[i - 1][n]) continue;
			let [lo, hi] = [uniform[i - 1], uniform[i]];
			while (hi - lo > 1e-9) {
				const mid = (lo + hi) / 2;
				if (det(pic(worldsAt(mid).get(name))) >= -1e-12 === sides[i - 1][n]) lo = mid;
				else hi = mid;
			}
			flips.push({ name, t: hi });
		}
	});
	const jumps = jumpTimes(clip);
	const edges = [...flips.map((f) => f.t), ...jumps];
	const near = edges.flatMap((t) =>
		[1e-5, 3e-5, 1e-4, 3e-4, 1e-3, 2e-3, 4e-3].flatMap((d) => [t - d, t + d]),
	);
	// The bake picks the draw order on its 120 Hz grid: depth is checked just after each of those times.
	const onGrid = new Set(Array.from({ length: Math.floor(D * 120) }, (_, i) => i / 120 + 1e-6));
	const times = [...new Set([...uniform, ...near, ...onGrid, ...probes, 1.4, D])]
		.filter((t) => t >= 0 && t <= D && !edges.some((e) => Math.abs(e - t) < 5e-6))
		.sort((a, b) => a - b);

	const play = player(json, clip.name);
	const out = {
		doc,
		json,
		result,
		report,
		sched,
		flips,
		ms,
		err: 0,
		worst: null,
		meshErr: 0,
		meshWorst: null,
		minDet: Infinity,
		orderOk: true,
		orderDetail: '',
		orderDepthOk: true,
		orderDepthDetail: '',
		behind: [],
		shownOk: true,
		shownDetail: '',
		at: {},
	};
	let prevBehind = null;
	for (const t of times) {
		const skel = play(t);
		const ref = worldsAt(t);
		for (const name of BAKED) {
			const e = cornerError(worldOf(skel, name), pic(ref.get(name)), card[name]);
			if (!(e <= out.err)) {
				out.err = Number.isNaN(e) ? Infinity : Math.max(out.err, e);
				out.worst = { name, t: +t.toFixed(5), e };
			}
		}
		const me = sleeveError(skel, ref);
		if (!(me <= out.meshErr)) [out.meshErr, out.meshWorst] = [me, +t.toFixed(5)];
		out.minDet = Math.min(out.minDet, Math.abs(det(pic(ref.get('upper_arm')))));
		const drawn = skel.drawOrder.map((s) => s.data.name);
		if (out.orderOk && drawn.join() !== orderAt(t).join()) {
			out.orderOk = false;
			out.orderDetail = `t=${t.toFixed(4)} engine-rig ${drawn} vs bake ${orderAt(t)}`;
		}
		if (onGrid.has(t)) {
			// A card's depth is its bone's, before any drawing is turned to face the viewer. Adjacent
			// cards are never further out of depth order than the hysteresis, so any two are never further
			// than the hysteresis times how many places apart they are.
			const still = refWorlds(rig, sample, t, () => 0);
			const z = Object.fromEntries(
				rig.slots.map((s) => {
					const w = still.get(s.bone);
					return [s.name, w.m[6] * ((card[s.bone].x0 + card[s.bone].x1) / 2) + w.o[2]];
				}),
			);
			const h = options.hysteresis ?? HYSTERESIS;
			for (let i = 0; i < drawn.length; i++)
				for (let j = i + 1; j < drawn.length; j++)
					if (out.orderDepthOk && z[drawn[i]] > z[drawn[j]] + (j - i) * h + 1e-6) {
						out.orderDepthOk = false;
						out.orderDepthDetail = `t=${t.toFixed(4)} ${drawn[i]} (z ${z[drawn[i]].toFixed(1)}) drawn under ${drawn[j]} (z ${z[drawn[j]].toFixed(1)})`;
					}
		}
		const behind = drawn.indexOf('upper_arm') < drawn.indexOf('torso');
		if (behind !== prevBehind) out.behind.push(+t.toFixed(3));
		prevBehind = behind;
		const shown = skel.findSlot('hand').getAttachment()?.name;
		if (out.shownOk && shown !== viewAt(t).attachment) {
			out.shownOk = false;
			out.shownDetail = `t=${t.toFixed(4)} engine-rig shows ${shown}, the bake chose ${viewAt(t).attachment}`;
		}
		if (probes.includes(t)) {
			const w = worldOf(skel, 'hand_image');
			const [s1, s2] = sing(w);
			out.at[t] = { shown, squash: s2 / s1, mirrored: det(w) < 0 };
		}
	}
	out.behind.shift();
	out.keys = Object.values(animation.bones).reduce(
		(n, tl) => n + Object.values(tl).reduce((m, keys) => m + keys.length, 0),
		0,
	);
	out.keyFrames = Object.values(report.bones).reduce((n, b) => n + b.keys, 0);
	out.perSecond = out.keyFrames / BAKED.length / D;
	out.timelinePerSecond =
		Object.values(report.timelineKeys).reduce((n, k) => n + k, 0) / BAKED.length / D;
	out.bytes = JSON.stringify(animation).length;
	out.gzip = gzipSync(JSON.stringify(animation)).length;
	return out;
}

// ── The gate ────────────────────────────────────────────────────────────────────────────────────

const TOL = 1;
/**
 * Key frames, and timeline keys, per baked bone per second each clip must stay under (measured: the
 * design doc §6). curves: a hand out of the arm's plane through the arm's edge-on moments (§4.3).
 */
const BUDGET = {
	crossed: 16,
	hinged: 10,
	calm: 2.5,
	stretch: 4.5,
	curves: 20,
	'turn-side': 2.5,
	'turn-full': 2.5,
};
const TIMELINE_BUDGET = {
	crossed: 45,
	hinged: 30,
	calm: 7,
	stretch: 14,
	curves: 52,
	'turn-side': 6,
	'turn-full': 4,
};
/** Every curve a 4.2 bezier: four numbers per value, its time handles inside its run. */
function badCurves(animation, baked) {
	const bad = [];
	for (const [bone, timelines] of Object.entries(animation.bones)) {
		if (!baked.includes(bone)) continue;
		for (const [name, keys] of Object.entries(timelines))
			keys.forEach((key, i) => {
				if (!key.curve) return;
				const next = keys[i + 1];
				const values = name === 'translate' || name === 'scale' ? 2 : 1;
				const c = key.curve;
				const inside = (x) => next && x >= key.time && x <= next.time;
				const ok =
					Array.isArray(c) &&
					c.length === 4 * values &&
					c.every(Number.isFinite) &&
					c.every((x, j) => j % 2 || inside(x));
				if (!ok) bad.push(`${bone}.${name}[${i}] ${JSON.stringify(c)}`);
			});
	}
	return bad;
}
const ANGLES = ['rotate', 'sheary'];
const runs = {};
for (const arm of [CROSSED, HINGED, CALM, STRETCH, CURVES, TURN_SIDE, TURN_FULL]) {
	const v = verify(arm);
	runs[arm.name] = v;
	const tag = `[${arm.name}]`;
	let refused = null;
	try {
		readIrig(v.json);
	} catch (e) {
		refused = e;
	}
	ok(`${tag} the strict irig reader accepts the baked rig`, !refused, String(refused));
	const anim = v.result.animation;
	const kinds = new Set(Object.values(anim.bones).flatMap((tl) => Object.keys(tl)));
	ok(
		`${tag} the clip is ordinary 4.2 timelines (rotate, translate, scale, sheary, drawOrder, attachment)`,
		[...kinds].every((x) => ['rotate', 'translate', 'scale', 'sheary'].includes(x)) &&
			Object.keys(anim).every((x) => ['bones', 'drawOrder', 'slots'].includes(x)),
		[...kinds].join(', '),
	);
	ok(
		`${tag} every card corner within ${TOL} unit of the 3D projection (engine-rig, ${v.flips.length} edge-on crossings sampled densely)`,
		v.err <= TOL,
		JSON.stringify(v.worst),
	);
	ok(
		`${tag} the weighted sleeve within ${TOL} unit of its 3D skin, projected`,
		v.meshErr <= TOL,
		`${v.meshErr} at t=${v.meshWorst}`,
	);
	ok(
		`${tag} the bake met its tolerance on every run of keys`,
		!v.report.unmet.length,
		JSON.stringify(v.report.unmet.slice(0, 3)),
	);
	ok(
		`${tag} key reduction: at most ${BUDGET[arm.name]} key frames and ${TIMELINE_BUDGET[arm.name]} timeline keys per baked bone per second`,
		v.perSecond <= BUDGET[arm.name] && v.timelinePerSecond <= TIMELINE_BUDGET[arm.name],
		`${v.perSecond.toFixed(1)}, ${v.timelinePerSecond.toFixed(1)}`,
	);
	const curved = Object.entries(anim.bones)
		.filter(([n]) => v.result.baked.includes(n))
		.flatMap(([, tl]) => Object.values(tl).flat())
		.filter((key) => key.curve).length;
	const bad = badCurves(anim, v.result.baked);
	ok(
		`${tag} the runs are 4.2 beziers where a curve serves (four numbers per value, time handles inside the run)`,
		curved > 0 && !bad.length,
		`${curved} curved keys; ${bad.slice(0, 3).join('; ')}`,
	);
	const ends = Object.entries(anim.bones)
		.filter(([n]) => v.result.baked.includes(n))
		.flatMap(([n, tl]) =>
			ANGLES.filter((c) => tl[c]).map((c) => [`${n}.${c}`, tl[c][tl[c].length - 1].value]),
		)
		.filter(([, value]) => !(value > -180 && value <= 180));
	ok(
		`${tag} every baked angle ends in (−180°, 180°]`,
		!ends.length,
		ends.map(([n, x]) => `${n} ${x}`).join(', '),
	);
	if (arm === CROSSED || arm === HINGED) {
		ok(`${tag} the upper arm is held exactly edge-on`, v.minDet < 1e-9, `min |det| ${v.minDet}`);
		const upperFlips = v.flips.filter((f) => f.name === 'upper_arm').length;
		ok(
			`${tag} the upper arm turns through edge-on (swing round, roll)`,
			upperFlips >= 3,
			`${upperFlips}`,
		);
		ok(`${tag} engine-rig draws the order the bake keyed`, v.orderOk, v.orderDetail);
		ok(
			`${tag} the draw order follows depth past the hysteresis`,
			v.orderDepthOk,
			v.orderDepthDetail,
		);
		ok(
			`${tag} the arm goes behind the torso and back once each way despite the wobble`,
			v.behind.length === 2,
			`changes at ${v.behind.join(', ')}`,
		);
		ok(`${tag} engine-rig shows the drawing the bake chose`, v.shownOk, v.shownDetail);
		ok(
			`${tag} at 45° the ¾ drawing shows`,
			v.at[4.0]?.shown === 'hand_3q_r',
			JSON.stringify(v.at[4.0]),
		);
		// Unsquashed within the bake's tolerance over the card (0.71 if the drawing were not turned back).
		ok(
			`${tag} …drawn unsquashed (σ2/σ1 ≥ 0.98)`,
			v.at[4.0]?.squash >= 0.98,
			JSON.stringify(v.at[4.0]),
		);
		ok(
			`${tag} at 90° the side drawing shows`,
			v.at[4.3]?.shown === 'hand_side_r',
			JSON.stringify(v.at[4.3]),
		);
		ok(
			`${tag} at −50° the other ¾ drawing shows`,
			v.at[4.45]?.shown === 'hand_3q_l',
			JSON.stringify(v.at[4.45]),
		);
		const gaps = v.sched.slice(1).map((e, i) => e.time - v.sched[i].time);
		ok(
			`${tag} no drawing swap flickers (≥ 50 ms apart)`,
			gaps.every((g) => g >= 0.05),
			gaps.map((g) => g.toFixed(3)).join(' '),
		);
	}
}

// The turnaround (chosen per rig before it is drawn): past the side view a side turnaround shows a
// front-half drawing mirrored, as a card's back is (the other side's ¾ at 135°, the front at 180°);
// a full turnaround shows its back drawings, unmirrored. Either way the drawing faces the viewer
// square (σ2/σ1 ≥ 0.98), and engine-rig shows what the bake chose.
for (const [name, at135, at180, mirrored] of [
	['turn-side', 'hand_3q_l', 'hand_front', true],
	['turn-full', 'hand_3q_back_r', 'hand_back', false],
]) {
	const v = runs[name];
	for (const [t, want, angle] of [
		[1.2, at135, '135°'],
		[2.1, at180, '180°'],
	]) {
		const got = v.at[t] ?? {};
		ok(
			`[${name}] at ${angle} ${want} shows, ${mirrored ? '' : 'un'}mirrored and square`,
			got.shown === want && got.mirrored === mirrored && got.squash >= 0.98,
			JSON.stringify(got),
		);
	}
	ok(`[${name}] engine-rig shows the drawing the bake chose`, v.shownOk, v.shownDetail);
}

// A rig's own tolerance (rig3d.json) is the bake's, unless an option given to the bake overrides it.
{
	const tight = verify({ ...CALM, name: 'calm-tight', rig: { ...HINGED_RIG, tolerance: 0.15 } });
	runs['calm, rig tolerance 0.15'] = tight;
	ok(
		'[calm] a rig tolerance of 0.15 bakes within it, with more keys',
		tight.err <= 0.2 && tight.keyFrames > runs.calm.keyFrames,
		`err ${tight.err.toFixed(3)}, ${tight.keyFrames} vs ${runs.calm.keyFrames} key frames`,
	);
	const overridden = bake2p5d({ ...HINGED_RIG, tolerance: 0.15 }, CALM.clip, { tolerance: 0.45 });
	ok(
		"…and a tolerance given to the bake wins over the rig's",
		JSON.stringify(overridden.animation) === JSON.stringify(runs.calm.result.animation),
	);
}

// Angles for the graph editor: `orientOf` is the design's Rz(rotate) · Ry(−tilt) · Rx(twist)
// (checked against the gate's own matrices), and `anglesOf` reads a quaternion back as the reading
// nearest the previous key's, so a tilt past 90° and a roll past 180° stay continuous; at tilt 90°
// (gimbal lock) it keeps the previous twist; with no previous key, |tilt| ≤ 90°.
{
	const triples = [
		[0, 0, 0],
		[30, 45, -60],
		[-120, 89, 170],
		[200, -70, 30],
		[10, 105, 0],
		[60, 10, 270],
		[-75, 5, 400],
	];
	let worstMatrix = 0;
	let worstBack = 0;
	for (const [a, b, c] of triples) {
		const mine = fromQuat(orientOf(a, b, c));
		const ref = euler(a, b, c);
		worstMatrix = Math.max(worstMatrix, ...mine.map((x, i) => Math.abs(x - ref[i])));
		const back = anglesOf(orientOf(a, b, c), { rotate: a + 4, tilt: b - 4, twist: c + 4 });
		worstBack = Math.max(
			worstBack,
			Math.abs(back.rotate - a),
			Math.abs(back.tilt - b),
			Math.abs(back.twist - c),
		);
	}
	ok('orientOf is Rz(rotate) · Ry(−tilt) · Rx(twist)', worstMatrix < 1e-12, String(worstMatrix));
	ok(
		'anglesOf reads the angles back nearest the previous key (tilt 105°, twist 270° and 400°)',
		worstBack < 1e-6,
		String(worstBack),
	);
	const locked = anglesOf(orientOf(-30, 90, 25), { rotate: 0, tilt: 90, twist: 40 });
	const lockedBack = fromQuat(orientOf(locked.rotate, locked.tilt, locked.twist));
	ok(
		'…at gimbal lock it keeps the twist and the orientation',
		locked.twist === 40 && lockedBack.every((x, i) => Math.abs(x - euler(-30, 90, 25)[i]) < 1e-9),
		JSON.stringify(locked),
	);
	let seed = 7;
	const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
	let worstFree = 0;
	let tiltOk = true;
	for (let i = 0; i < 200; i++) {
		const q = [rand(), rand(), rand(), rand()];
		const a = anglesOf(q);
		tiltOk &&= Math.abs(a.tilt) <= 90;
		const back = fromQuat(orientOf(a.rotate, a.tilt, a.twist));
		const want = fromQuat(q);
		worstFree = Math.max(worstFree, ...back.map((x, j) => Math.abs(x - want[j])));
	}
	ok(
		'…and any orientation round-trips, |tilt| ≤ 90° with no previous key',
		worstFree < 1e-9 && tiltOk,
		String(worstFree),
	);
}

// In-plane 3D scale and translate keys: they reach the file as the non-uniform scale and the
// translation they are, and the root's own 2D keys pass through as they were written.
{
	const anim = runs.stretch.result.animation;
	const scale = anim.bones.upper_arm?.scale ?? [];
	ok(
		'[stretch] the upper arm is baked with a non-uniform scale',
		scale.some((key) => Math.abs(key.x - key.y) > 0.3),
		JSON.stringify(scale.slice(0, 3)),
	);
	ok(
		'[stretch] the root (no 3D keys) keeps its own 2D keys',
		!runs.stretch.result.baked.includes('root') &&
			JSON.stringify(anim.bones.root) ===
				JSON.stringify({ translate: STRETCH.clip.bones.root.translate }),
		JSON.stringify(anim.bones.root),
	);
}

// Orientation keys and curves: the bake's 3D pose is the gate's slerp at the progress engine-rig
// samples, and every other channel engine-rig's own sampling — bezier, stepped, before the first key —
// and a stepped orientation key bakes to a step (two keys at one time).
{
	const { rig, clip } = CURVES;
	const sample = sampler(clip);
	const jumps = jumpTimes(clip);
	let worst = 0;
	let at = 0;
	for (let i = 0; i <= clip.duration * 2000; i++) {
		const t = i / 2000 + 0.0000713;
		if (t > clip.duration || jumps.some((j) => Math.abs(j - t) < 1e-6)) continue;
		const mine = pose3d(rig, clip, t);
		const ref = refWorlds(rig, sample, t, () => 0);
		for (const name of BAKED) {
			const e = cornerError(
				pic(mine.get(name)),
				pic(ref.get(name)),
				rig.bones.find((b) => b.name === name).card,
			);
			if (e > worst) [worst, at] = [e, t];
		}
	}
	ok(
		'[curves] the bake samples its keys as engine-rig samples a timeline (slerp progress, bezier, stepped, before the first key)',
		worst < 1e-3,
		`${worst} units at t=${at}`,
	);
	ok(
		'[curves] the clip has a stepped key and a late first key',
		jumps.length >= 2,
		jumps.join(', '),
	);
	const anim = runs.curves.result.animation;
	const stepped = ['upper_arm', 'forearm', 'hand'].filter((n) =>
		Object.values(anim.bones[n] ?? {}).some((keys) =>
			keys.some((key, i) => i > 0 && key.time === 2.2 && keys[i - 1].time === 2.2),
		),
	);
	ok(
		'[curves] the stepped orientation key bakes to a step on the arm and everything under it',
		stepped.length === 3,
		stepped.join(', '),
	);
}

// A clip with no 3D keys bakes to itself: every key passes through as written, nothing is added.
{
	const flat = {
		bones: HINGED_RIG.bones.filter((b) => !b.follow),
		slots: HINGED_RIG.slots.filter((s) => !s.drawings),
	};
	const bones = {
		chest: {
			rotate: curve1([
				[0, 0, 'ease'],
				[1, 15, 'stepped'],
				[2, -5],
			]),
		},
		upper_arm: {
			rotate: curve1([
				[0, 0],
				[1, 40, 'overshoot'],
				[2, 0],
			]),
			translate: curve2([
				[0, 0, 0, 'ease'],
				[2, 5, -3],
			]),
			scale: [
				{ time: 0, x: 1, y: 1 },
				{ time: 2, x: 1.1, y: 0.9 },
			],
		},
	};
	const r = bake2p5d(flat, { name: 'wave', duration: 2, bones });
	ok(
		'a clip with no 3D keys bakes to itself',
		!r.baked.length && JSON.stringify(r.animation) === JSON.stringify({ bones }),
		JSON.stringify(r.animation).slice(0, 300),
	);
}

// Constraints: one that writes a baked bone (or a bone it hangs from) at a non-zero mix during the
// clip would overwrite the bake after the timelines, so it is refused; one keyed to 0 for the clip,
// at mix 0, or on a bone the clip does not bake, is not.
{
	const { clip } = HINGED;
	const withLeg = {
		...HINGED_RIG,
		bones: [...HINGED_RIG.bones, { name: 'leg', parent: 'root', rotate: -90, length: 100 }],
	};
	const ik = (mix, bones = ['upper_arm', 'forearm']) => ({
		...withLeg,
		constraints: [{ name: 'arm_ik', bones, mix }],
	});
	const keyed = (keys) => ({ ...clip, constraints: { arm_ik: keys } });
	const refuses = (rig, c) => rig2p5dProblems(rig, c).some((p) => p.includes('arm_ik'));
	ok('the validator refuses an IK at mix 1 on baked bones', refuses(ik(1), clip));
	ok('…and on a bone a baked bone hangs from (the root)', refuses(ik(1, ['root']), clip));
	ok(
		'…and one keyed up from 0 during the clip',
		refuses(
			ik(0),
			keyed([
				{ time: 0, mix: 0 },
				{ time: 2, mix: 1 },
			]),
		),
	);
	ok('…but not one at mix 0', !refuses(ik(0), clip));
	ok('…nor one keyed to 0 from the clip start', !refuses(ik(1), keyed([{ time: 0, mix: 0 }])));
	ok('…nor one on a bone the clip does not bake', !refuses(ik(1, ['leg']), clip));
	let threw = '';
	try {
		bake2p5d(ik(1), clip);
	} catch (e) {
		threw = String(e);
	}
	ok('the bake refuses what the validator refuses', threw.includes('arm_ik'), threw);
	const says = (rig, c, text) => rig2p5dProblems(rig, c).some((x) => x.includes(text));
	ok(
		'the validator refuses drawings by angle before the turnaround is chosen',
		says({ ...HINGED_RIG, turnaround: undefined }, clip, 'choose the rig'),
	);
	ok(
		'…a back drawing on a side turnaround',
		says({ ...rigWith(0, 'full'), turnaround: 'side' }, clip, 'needs a full turnaround'),
	);
	ok(
		'…a full turnaround with no back drawings',
		says({ ...HINGED_RIG, turnaround: 'full' }, clip, 'needs back drawings'),
	);
	ok(
		'…a bone keyed by both orientation and 2D rotate',
		says(
			HINGED_RIG,
			{
				...clip,
				bones: {
					...clip.bones,
					forearm: { ...clip.bones.forearm, orient: [{ value: [1, 0, 0, 0] }] },
				},
			},
			'not both',
		),
	);
	ok('…and a rig tolerance of 0', says({ ...HINGED_RIG, tolerance: 0 }, clip, 'tolerance'));
}

// A crossfade between two baked clips through AnimationState blends their 2D locals: from the end of
// the reach (after its full roll) and from its middle (behind the body), to the calm clip, over 0.25 s.
// Continuous: sampled ten times finer, the largest step a card corner takes shrinks with the step (a
// jump would not) — every card but the hand's image, whose frame jumps by design at each of the
// from-clip's drawing swaps (the mix blends that jump; measured below). No spin: no card turns further during the mix than the two poses differ by, beyond
// 90° (a 360° shear difference would turn it a full turn).
const MIX = 0.25;
function crossfade(wrap, from) {
	const doc = docOf(HINGED_RIG, [
		{ name: HINGED.clip.name, result: bake2p5d(HINGED_RIG, HINGED.clip, { wrap }) },
		{ name: CALM.clip.name, result: bake2p5d(HINGED_RIG, CALM.clip, { wrap }) },
	]);
	const json = JSON.stringify(doc);
	const card = Object.fromEntries(HINGED_RIG.bones.map((b) => [b.name, b.card]));
	const corners = (skel) =>
		BAKED.filter((n) => n !== 'hand_image').flatMap((n) => {
			const w = worldOf(skel, n);
			const c = card[n];
			return [c.x0, c.x1].flatMap((x) =>
				[-c.h, c.h].map((y) => [w.a * x + w.b * y + w.x, w.c * x + w.d * y + w.y]),
			);
		});
	const angles = (skel) =>
		BAKED.flatMap((n) => {
			const w = worldOf(skel, n);
			return [Math.atan2(w.c, w.a), Math.atan2(w.d, w.b)];
		});
	const turn = (a, b) => {
		const d = b - a;
		return Math.abs(d - 2 * Math.PI * Math.round(d / (2 * Math.PI)));
	};
	const fade = (dt) => {
		const { skel, state } = load(json, MIX);
		state.setAnimation(0, HINGED.clip.name, false);
		state.update(from);
		state.apply(skel);
		skel.updateWorldTransform(Physics.update);
		state.setAnimation(0, CALM.clip.name, false);
		let prev = corners(skel);
		let prevAngles = angles(skel);
		const start = prevAngles;
		const travel = start.map(() => 0);
		let most = 0;
		for (let i = 0; i < Math.round((MIX + 0.05) / dt); i++) {
			state.update(dt);
			state.apply(skel);
			skel.updateWorldTransform(Physics.update);
			const now = corners(skel);
			const a = angles(skel);
			most = Math.max(most, ...now.map((p, j) => Math.hypot(p[0] - prev[j][0], p[1] - prev[j][1])));
			a.forEach((x, j) => (travel[j] += turn(prevAngles[j], x)));
			prev = now;
			prevAngles = a;
		}
		return {
			most,
			spin: Math.max(...travel.map((x, j) => x - turn(start[j], prevAngles[j]))) / R,
		};
	};
	const coarse = fade(0.001);
	const fine = fade(0.0001);
	return { coarse: coarse.most, fine: fine.most, spin: coarse.spin };
}
const fadeEnd = crossfade(true, HINGED.clip.duration + 0.05);
const fadeMid = crossfade(true, 2.0);
/** Measured, not asserted: a crossfade that starts just before the reach turns edge-on (§7). */
const fadeEdge = crossfade(true, 1.45);
for (const [label, f] of [
	['from the end of the reach', fadeEnd],
	['from the middle of the reach', fadeMid],
]) {
	ok(
		`crossfade ${label} to calm is continuous (a 0.1 ms step moves a corner ≤ 0.25 × a 1 ms step)`,
		f.fine <= 0.25 * f.coarse,
		`${f.fine.toFixed(4)} vs ${f.coarse.toFixed(4)} units`,
	);
	ok(
		`crossfade ${label} to calm does not spin (no card turns 90° beyond the poses' difference)`,
		f.spin < 90,
		`${f.spin.toFixed(1)}°`,
	);
}

// Mutations, on the stress arm: every step the design names must be needed.
const MUTATIONS = [
	['no shear (rotate + scale only)', { shear: false }, (m) => m.err > TOL],
	['parent-local projection instead of world', { project: 'local' }, (m) => m.err > TOL],
	['keys only at the 3D keys (no dense bake)', { dense: false }, (m) => m.err > TOL],
	['no key reduction', { reduce: false }, (m) => m.perSecond > BUDGET.crossed],
	['straight runs only (no bezier)', { curves: false }, (m) => m.perSecond > BUDGET.crossed],
	['no floor for an edge-on card', { floor: 0 }, (m) => m.err > TOL],
	['no step where a card turns through edge-on', { steps: false }, (m) => m.err > TOL],
	['no draw-order hysteresis', { hysteresis: 0 }, (m) => m.behind.length > 2],
	[
		'bezier handles written as progress 0 → 1 (as `orient` keys hold theirs), not values',
		{ curveSpace: 'progress' },
		(m) => m.err > TOL,
	],
	[
		"a run's error measured in its bone's local space, not the world",
		{ measure: 'local' },
		(m) => m.err > TOL,
	],
	['a step written as one key, not two at one time', { stepPairs: false }, (m) => m.err > TOL],
];
const mutated = [];
for (const [label, opts, failed] of MUTATIONS) {
	const m = verify(CROSSED, opts);
	mutated.push({ label, m });
	ok(
		`mutation fails: ${label}`,
		failed(m),
		`err ${m.err.toFixed(3)}, ${m.perSecond.toFixed(1)} key frames/bone/s, behind ×${m.behind.length}`,
	);
}
// Measured in a bone's local space, a run's error leaves out what its parents scale it by: the calm
// clip with the chest drawn at ×3 holds the tolerance measured in the world, not measured locally.
{
	const SCALED = {
		...CALM,
		rig: {
			...HINGED_RIG,
			bones: HINGED_RIG.bones.map((b) => (b.name === 'chest' ? { ...b, scaleX: 3, scaleY: 3 } : b)),
		},
	};
	const world = verify(SCALED);
	const local = verify(SCALED, { measure: 'local' });
	mutated.push({ label: 'local-space error, a parent drawn at ×3 ([calm])', m: local });
	ok(
		'[calm, chest at ×3] every card corner within the tolerance (0.45), measured in the world',
		world.err <= 0.46 && !world.report.unmet.length,
		`${world.err}`,
	);
	ok(
		"mutation fails: a run's error measured in its bone's local space ([calm, chest at ×3])",
		local.err > TOL,
		`err ${local.err.toFixed(3)}`,
	);
}

// Without the angle wrap a crossfade spins (shearY mixes linearly), and an angle ends turns away.
const noWrapEnd = crossfade(false, HINGED.clip.duration + 0.05);
const noWrapMid = crossfade(false, 2.0);
ok(
	'mutation fails: no angle wrap (a crossfade from the end or the middle spins)',
	noWrapEnd.spin >= 90 && noWrapMid.spin >= 90,
	`end ${noWrapEnd.spin.toFixed(1)}°, middle ${noWrapMid.spin.toFixed(1)}°`,
);
const unwrapped = bake2p5d(STRETCH.rig, STRETCH.clip, { wrap: false }).animation.bones.chest.rotate;
ok(
	'mutation fails: no angle wrap ([stretch]: the chest ends a turn out of (−180°, 180°])',
	unwrapped[unwrapped.length - 1].value > 180,
	JSON.stringify(unwrapped.slice(-2)),
);

const fmt = (n) => (Number.isFinite(n) ? n.toFixed(3) : String(n));
for (const [name, v] of Object.entries(runs)) {
	console.log(
		`rig-2p5d [${name}]: ${v.flips.length} edge-on crossings; max corner error ${fmt(v.err)} (worst ${JSON.stringify(v.worst)}); sleeve ${fmt(v.meshErr)}; bake ${v.ms.toFixed(0)} ms`,
	);
	for (const [bone, b] of Object.entries(v.report.bones))
		console.log(
			`  ${bone.padEnd(11)} ${String(b.keys).padStart(4)} key frames (dense ${b.dense}), ${b.steps} steps, ${v.report.timelineKeys[bone]} timeline keys`,
		);
	console.log(
		`  ${v.perSecond.toFixed(1)} key frames/bone/s, ${v.keys} timeline keys (${v.timelinePerSecond.toFixed(1)}/bone/s), ${v.bytes} bytes of clip JSON (${v.gzip} gzipped); ${v.result.animation.drawOrder?.length ?? 0} draw-order keys, ${v.sched.length} drawing keys`,
	);
}
for (const [label, f] of [
	['crossfade from the end', fadeEnd],
	['crossfade from the middle', fadeMid],
	['crossfade from just before an edge-on step', fadeEdge],
	['crossfade from the end, no angle wrap', noWrapEnd],
	['crossfade from the middle, no angle wrap', noWrapMid],
])
	console.log(
		`  ${label}: largest corner step ${f.coarse.toFixed(3)} units per 1 ms, ${f.fine.toFixed(4)} per 0.1 ms; spin ${f.spin.toFixed(1)}°`,
	);
for (const { label, m } of mutated)
	console.log(
		`  mutation ${label}: err ${fmt(m.err)}, ${m.perSecond.toFixed(1)} key frames/bone/s, behind ×${m.behind.length}`,
	);
console.log(`${checks - fails}/${checks} checks passed`);
if (fails) process.exit(1);
