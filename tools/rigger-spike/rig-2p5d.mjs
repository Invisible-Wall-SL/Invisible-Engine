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
//  - key reduction: under a keys-per-second budget per arm, which the dense bake breaks;
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
//    bake), no key reduction (size), no floor, no step at a flip, no draw-order hysteresis, no angle
//    wrap (the crossfades spin, an angle ends a turn out).
//   node tools/rigger-spike/rig-2p5d.mjs
import { mkdtempSync, rmSync } from 'node:fs';
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
const { bake2p5d, rig2p5dProblems, pose3d, cornerError } = await import(
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

// ── The rigs and the clips ──────────────────────────────────────────────────────────────────────

const HAND_VIEWS = [
	{ attachment: 'hand_front', turn: 0 },
	{ attachment: 'hand_3q_r', turn: 45 },
	{ attachment: 'hand_side_r', turn: 90 },
	{ attachment: 'hand_3q_l', turn: -45 },
	{ attachment: 'hand_side_l', turn: -90 },
];
const rigWith = (elbowDepth) => ({
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
		{ name: 'hand', bone: 'hand_image', attachment: 'hand_front', drawings: HAND_VIEWS },
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

/** A key of the 3D pose: absolute rotate, tilt, twist. */
const k = (time, rotate, tilt = 0, twist = 0) => ({ time, rotate, tilt, twist });
/**
 * Pose keys as per-channel 3D keys (4.2 shape): rotate as an offset from the setup; each angle
 * unwrapped toward the key before it, so a roll keeps counting (360 then 0 holds at 360).
 */
function channels(setupRotate, keys) {
	const out = { rotate: [], tilt: [], twist: [] };
	let prev = null;
	for (const key of keys) {
		const v = { rotate: key.rotate - setupRotate, tilt: key.tilt, twist: key.twist };
		if (prev) for (const c of Object.keys(v)) v[c] += 360 * Math.round((prev[c] - v[c]) / 360);
		for (const c of Object.keys(v)) out[c].push({ time: key.time, value: v[c] });
		prev = v;
	}
	return out;
}
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
			chest: channels(0, CHEST),
			upper_arm: channels(-90, UPPER),
			forearm: channels(0, [
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
			hand: channels(0, [k(0, 0), k(1.0, 0, 0, 30), k(2.6, 0), ...HAND_TURN]),
		},
	},
};
const HINGED_RIG = rigWith(0);
const HINGED = {
	name: 'hinged',
	rig: HINGED_RIG,
	clip: {
		name: 'reach',
		duration: 4.6,
		bones: {
			chest: channels(0, CHEST),
			upper_arm: channels(-90, UPPER),
			forearm: channels(0, [
				k(0, 0),
				k(1.0, 40),
				k(1.5, 40),
				k(2.2, 20),
				k(2.6, 30),
				k(3.6, 0),
				k(4.6, 0),
			]),
			hand: channels(0, [k(0, 0), ...HAND_TURN]),
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
			chest: channels(0, [k(0, 0), k(1, 0, 10), k(3, 0, -10), k(4, 0)]),
			upper_arm: channels(-90, [k(0, -90), k(1.5, -70, 30), k(3, -95, -20), k(4, -90)]),
			forearm: channels(0, [k(0, 20), k(1.5, 40), k(3, 15), k(4, 20)]),
			hand: channels(0, [k(0, 0), k(2, 0, 30), k(4, 0)]),
		},
	},
};
const lin = (rows) => rows.map(([time, value]) => ({ time, value }));
// In-plane 3D scale, translate and depth keys: the root walks (a 2D bone, passed through), the chest
// shifts, turns and at the end spins 400° in the picture (its angle must end back in (−180°, 180°]),
// the upper arm stretches non-uniformly and comes forward in depth while it tilts,
// the forearm slides and squashes.
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
				tilt: lin([
					[0, 0],
					[1.5, 20],
					[3, 0],
				]),
				rotate: lin([
					[0, 0],
					[2, 0],
					[3, 400],
				]),
			},
			upper_arm: {
				rotate: lin([
					[0, 0],
					[1, 40],
					[2, -20],
					[3, 0],
				]),
				tilt: lin([
					[0, 0],
					[1, 60],
					[2, -30],
					[3, 0],
				]),
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
			hand: {
				tilt: lin([
					[0, 0],
					[1.5, 40],
					[3, 0],
				]),
			},
		},
	},
};
/** 4.2 bezier handles from key (t0, v0) to (t1, v1): an ease in-out, or an overshoot. */
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
// Bezier curves on every kind of channel, a stepped tilt (the arm snaps 70° at 2.2 s), and a hand
// twist whose first key comes at 0.5 s (before it, the setup's 0 — then a jump, as in 4.2).
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
				rotate: curve1([
					[0, 0, 'overshoot'],
					[1.5, 10, 'ease'],
					[3, 0],
				]),
				tilt: curve1([
					[0, 0, 'ease'],
					[1.5, 25, 'ease'],
					[3, 0],
				]),
			},
			upper_arm: {
				rotate: curve1([
					[0, 0, 'ease'],
					[1, 50, 'overshoot'],
					[2, 20, 'ease'],
					[3, 0],
				]),
				tilt: curve1([
					[0, 0, 'overshoot'],
					[1, 70, 'ease'],
					[1.8, -40, 'stepped'],
					[2.2, 30, 'ease'],
					[3, 0],
				]),
				twist: curve1([
					[0, 0, 'ease'],
					[3, 90],
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
				tilt: curve1([
					[0, 0, 'ease'],
					[1.2, 80, 'overshoot'],
					[2.4, -30],
					[3, 0],
				]),
				twist: curve1([
					[0.5, 20, 'ease'],
					[2, -20],
				]),
			},
		},
	},
};
const BAKED = ['chest', 'upper_arm', 'forearm', 'hand', 'hand_image'];

// ── The reference: the 3D pose projected, written here apart from the bake ─────────────────────

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

/**
 * Each 3D channel sampled by engine-rig's own timelines: a skeleton with one bone per channel, its
 * keys read by SkeletonJson as a rotate timeline (curves included), so the reference interpolates
 * exactly as a game interpolates a 2D channel. Before a channel's first key: the setup's value.
 */
function sampler(clip) {
	const bones = [{ name: 'root' }];
	const timelines = {};
	const add = (id, keys, value, at) => {
		bones.push({ name: id, parent: 'root' });
		timelines[id] = {
			rotate: keys.map((key) => ({
				time: key.time ?? 0,
				value: value(key),
				...(key.curve === 'stepped'
					? { curve: 'stepped' }
					: key.curve
						? { curve: key.curve.slice(at * 4, at * 4 + 4) }
						: {}),
			})),
		};
	};
	for (const [bone, keys] of Object.entries(clip.bones))
		for (const [ch, list] of Object.entries(keys)) {
			if (ch === 'translate' || ch === 'scale') {
				const rest = ch === 'scale' ? 1 : 0;
				add(`${bone}.${ch}X`, list, (key) => key.x ?? rest, 0);
				add(`${bone}.${ch}Y`, list, (key) => key.y ?? rest, 1);
			} else add(`${bone}.${ch}`, list, (key) => key.value ?? 0, 0);
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
	return (bone, ch, t, rest = 0) => {
		const line = tl.get(`${bone}.${ch}`);
		if (!line) return rest;
		return t < line.frames[0] ? rest : line.getCurveValue(t);
	};
}

/** Every bone's 3D world { m, o } at `t`, an image bone on what it follows, turned back by its drawing. */
function refWorlds(rig, sample, t, turnOf) {
	const out = new Map();
	for (const b of rig.bones) {
		const turn = turnOf(b.name, t);
		if (b.follow) {
			const f = out.get(b.follow);
			out.set(b.name, { m: turn ? mm(f.m, ry(turn)) : f.m, o: f.o });
			continue;
		}
		const ch = (c, rest = 0) => sample(b.name, c, t, rest);
		const sx = (b.scaleX ?? 1) * ch('scaleX', 1);
		const sy = (b.scaleY ?? 1) * ch('scaleY', 1);
		let m = mm(euler((b.rotate ?? 0) + ch('rotate'), ch('tilt'), ch('twist')), [
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
		if (turn) m = mm(m, ry(turn));
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
	for (const keys of Object.values(clip.bones))
		for (const [ch, list] of Object.entries(keys)) {
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

const REGIONS = ['torso', 'upper_arm', 'sleeve', 'forearm', ...HAND_VIEWS.map((v) => v.attachment)];
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

function verify({ rig, clip }, options = {}) {
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
	const times = [...new Set([...uniform, ...near, ...onGrid, 4.0, 4.3, 4.45, 1.4, D])]
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
		if ([4.0, 4.3, 4.45].includes(t)) {
			const [s1, s2] = sing(worldOf(skel, 'hand_image'));
			out.at[t] = { shown, squash: s2 / s1 };
		}
	}
	out.behind.shift();
	out.keys = Object.values(animation.bones).reduce(
		(n, tl) => n + Object.values(tl).reduce((m, keys) => m + keys.length, 0),
		0,
	);
	out.keyFrames = Object.values(report.bones).reduce((n, b) => n + b.keys, 0);
	out.perSecond = out.keyFrames / BAKED.length / D;
	out.bytes = JSON.stringify(animation).length;
	return out;
}

// ── The gate ────────────────────────────────────────────────────────────────────────────────────

const TOL = 1;
/** Key frames per baked bone per second each clip must stay under (measured: the design doc §6). */
// curves: a hand out of the arm's plane through six edge-on moments in 3 s (design §4.3).
const BUDGET = { crossed: 45, hinged: 25, calm: 8, stretch: 12, curves: 55 };
const ANGLES = ['rotate', 'sheary'];
const runs = {};
for (const arm of [CROSSED, HINGED, CALM, STRETCH, CURVES]) {
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
		`${tag} key reduction: at most ${BUDGET[arm.name]} key frames per baked bone per second`,
		v.perSecond <= BUDGET[arm.name],
		v.perSecond.toFixed(1),
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

// Per-channel Euler keys: the bake's 3D pose is engine-rig's sampling of the same keys — bezier,
// stepped and before the first key — and a stepped key bakes to a step (two keys at one time).
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
		'[curves] the bake samples each 3D channel as engine-rig samples a timeline (bezier, stepped, before the first key)',
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
		'[curves] the stepped tilt bakes to a step on the arm and everything under it',
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
	const tilted = {
		...HINGED_RIG,
		bones: HINGED_RIG.bones.map((b) => (b.name === 'forearm' ? { ...b, tilt: 10 } : b)),
	};
	ok(
		'the validator refuses a setup that is not flat',
		rig2p5dProblems(tilted, clip).some((p) => p.includes('flat')),
	);
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
	['no floor for an edge-on card', { floor: 0 }, (m) => m.err > TOL],
	['no step where a card turns through edge-on', { steps: false }, (m) => m.err > TOL],
	['no draw-order hysteresis', { hysteresis: 0 }, (m) => m.behind.length > 2],
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
		`  ${v.perSecond.toFixed(1)} key frames/bone/s, ${v.keys} timeline keys, ${v.bytes} bytes of clip JSON; ${v.result.animation.drawOrder?.length ?? 0} draw-order keys, ${v.sched.length} drawing keys`,
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
