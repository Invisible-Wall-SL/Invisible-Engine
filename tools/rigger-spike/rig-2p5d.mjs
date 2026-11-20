// The 2.5D rig's make-or-break gate (docs/design/rig-2p5d.md): an arm keyed in 3D is baked into
// ordinary irig v1 timelines (`rig-2p5d-bake.mjs`), read by the strict irig reader, loaded and played
// by the REAL engine-rig (SkeletonJson → Skeleton → AnimationState, as a game plays it), and every
// bone's world 2D frame is compared with the orthographic projection of the 3D reference — computed
// here, independently of the bake — at dense sample times.
//
// The motion: a chest turning; an arm that reaches toward the camera, is held exactly edge-on, swings
// round through edge-on and behind the body (with a depth wobble across the torso), rolls through
// edge-on twice; then a hand that turns 45°, 90° and −50° on a still arm, showing drawings by angle
// (its image bone hangs from the chest and follows the hand). Two arms:
//  - CROSSED, the stress case: the elbow and wrist leave the upper arm's plane (the forearm tilts and
//    twists, the elbow sits 4 units in front of the upper arm's card, the wrist twists);
//  - HINGED, the template rule: the elbow and wrist bend in the upper arm's plane.
// Asserted:
//  - every card corner of every bone within 1 rig unit (1 px at scale 1) of the 3D projection, on a
//    1 kHz grid and densely around every edge-on crossing — the floor included — for both arms;
//  - the parent really is edge-on (a projected determinant of ~0, held), and crosses it;
//  - the baked clip is ordinary data: the strict irig reader accepts it; only 4.2 timelines;
//  - key reduction: under a keys-per-second budget per arm, which the dense bake breaks;
//  - draw order from depth: what engine-rig draws is the bake's order, consistent with depth past the
//    hysteresis, and the arm goes behind the torso and back once each way despite the wobble;
//  - drawings by angle: engine-rig shows the drawing the bake chose; at 45° the ¾ drawing is shown
//    and drawn unsquashed, at 90° the side one, at −50° the other ¾; no swap flickers;
//  - mutations, each must fail: no shear, parent-local projection, keys only at the 3D keys (no dense
//    bake), no key reduction (size), no floor, no step at a flip, no draw-order hysteresis.
//   node tools/rigger-spike/rig-2p5d.mjs
import { RIG_CORE } from './rig.mjs';
import { bake, cornerError } from './rig-2p5d-bake.mjs';

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
	{ name: 'hand_front', turn: 0 },
	{ name: 'hand_3q_r', turn: 45 },
	{ name: 'hand_side_r', turn: 90 },
	{ name: 'hand_3q_l', turn: -45 },
	{ name: 'hand_side_l', turn: -90 },
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
		{ name: 'forearm', bone: 'forearm', attachment: 'forearm' },
		{ name: 'hand', bone: 'hand_image', attachment: 'hand_front', variants: HAND_VIEWS },
	],
});
const k = (time, rotate, tilt = 0, twist = 0) => ({ time, rotate, tilt, twist });
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
			chest: CHEST,
			upper_arm: UPPER,
			forearm: [
				k(0, 0),
				k(1.0, 40, 20),
				k(1.5, 40, 20),
				k(2.2, 20, -10),
				k(2.6, 30),
				k(3.0, 30),
				k(3.3, 30, 0, -60),
				k(3.6, 0),
				k(4.6, 0),
			],
			hand: [k(0, 0), k(1.0, 0, 0, 30), k(2.6, 0), ...HAND_TURN],
		},
	},
};
const HINGED = {
	name: 'hinged',
	rig: rigWith(0),
	clip: {
		name: 'reach',
		duration: 4.6,
		bones: {
			chest: CHEST,
			upper_arm: UPPER,
			forearm: [k(0, 0), k(1.0, 40), k(1.5, 40), k(2.2, 20), k(2.6, 30), k(3.6, 0), k(4.6, 0)],
			hand: [k(0, 0), ...HAND_TURN],
		},
	},
};
// A calm clip on the hinged arm, for what everyday 3D motion costs: a sway, a lift toward the
// camera and back, a small hand turn, nothing edge-on.
const CALM = {
	name: 'calm',
	rig: rigWith(0),
	clip: {
		name: 'reach',
		duration: 4,
		bones: {
			chest: [k(0, 0), k(1, 0, 10), k(3, 0, -10), k(4, 0)],
			upper_arm: [k(0, -90), k(1.5, -70, 30), k(3, -95, -20), k(4, -90)],
			forearm: [k(0, 20), k(1.5, 40), k(3, 15), k(4, 20)],
			hand: [k(0, 0), k(2, 0, 30), k(4, 0)],
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
const fromQuat = ([w, x, y, z]) => [
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
/** The design's orientation: rotate about z, then tilt (tip toward the viewer) about y, then twist about x. */
const euler = (rot, tilt, twist) => mm(mm(rz(rot), ry(-tilt)), rx(twist));
function refLocal(bone, clip, t) {
	const keys = clip.bones[bone.name];
	const at = (key) => euler(key.rotate ?? bone.rotate ?? 0, key.tilt, key.twist);
	if (!keys) return euler(bone.rotate ?? 0, 0, 0);
	if (t <= keys[0].time) return at(keys[0]);
	const j = keys.findIndex((key) => key.time > t);
	if (j === -1) return at(keys[keys.length - 1]);
	const u = (t - keys[j - 1].time) / (keys[j].time - keys[j - 1].time);
	const a = toQuat(at(keys[j - 1]));
	let b = toQuat(at(keys[j]));
	let dot = a.reduce((s, v, i) => s + v * b[i], 0);
	if (dot < 0) [b, dot] = [b.map((v) => -v), -dot];
	const th = Math.acos(Math.min(1, dot));
	const q =
		th < 1e-6
			? a.map((v, i) => v + (b[i] - v) * u)
			: a.map((v, i) => (v * Math.sin((1 - u) * th) + b[i] * Math.sin(u * th)) / Math.sin(th));
	const n = Math.hypot(...q);
	return fromQuat(q.map((v) => v / n));
}
/** Every bone's 3D world { m, o } at `t`, an image bone on what it follows, turned back by its drawing. */
function refWorlds(rig, clip, t, turnOf) {
	const out = new Map();
	for (const b of rig.bones) {
		const turn = turnOf(b.name, t);
		if (b.follow) {
			const f = out.get(b.follow);
			out.set(b.name, { m: turn ? mm(f.m, ry(turn)) : f.m, o: f.o });
			continue;
		}
		let m = refLocal(b, clip, t);
		if (turn) m = mm(m, ry(turn));
		const o = [b.x ?? 0, b.y ?? 0, b.depth ?? 0];
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

// ── engine-rig ──────────────────────────────────────────────────────────────────────────────────

const REGIONS = ['torso', 'upper_arm', 'forearm', ...HAND_VIEWS.map((v) => v.name)];
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

/** Load the baked file as a game does and return a player that advances it to each time asked. */
function player(json, animation) {
	const atlas = new TextureAtlas(ATLAS);
	for (const p of atlas.pages) p.setTexture(stub);
	const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(
		JSON.parse(json),
	);
	const skel = new Skeleton(data);
	const state = new AnimationState(new AnimationStateData(data));
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

// ── One bake, verified ──────────────────────────────────────────────────────────────────────────

const HYSTERESIS = 6;

function verify({ rig, clip }, options = {}) {
	const { doc, report, swaps, orderAt } = bake(rig, clip, options);
	const json = JSON.stringify(doc);
	const card = Object.fromEntries(rig.bones.map((b) => [b.name, b.card]));
	const sched = swaps.get('hand_image');
	const viewAt = (t) => {
		let v = sched[0].variant;
		for (const e of sched) if (e.time <= t) v = e.variant;
		return v;
	};
	const turnOf = (name, t) => (name === 'hand_image' ? viewAt(t).turn : 0);
	const worldsAt = (t) => refWorlds(rig, clip, t, turnOf);

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
	const near = flips.flatMap(({ t }) =>
		[1e-5, 3e-5, 1e-4, 3e-4, 1e-3, 2e-3, 4e-3].flatMap((d) => [t - d, t + d]),
	);
	// The bake picks the draw order on its 120 Hz grid: depth is checked just after each of those times.
	const onGrid = new Set(Array.from({ length: Math.floor(D * 120) }, (_, i) => i / 120 + 1e-6));
	const times = [...new Set([...uniform, ...near, ...onGrid, 4.0, 4.3, 4.45, 1.4])]
		.filter((t) => t >= 0 && t <= D && !flips.some((f) => Math.abs(f.t - t) < 2e-6))
		.sort((a, b) => a - b);

	const play = player(json, clip.name);
	const out = {
		doc,
		json,
		report,
		sched,
		flips,
		err: 0,
		worst: null,
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
			const still = refWorlds(rig, clip, t, () => 0);
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
		if (out.shownOk && shown !== viewAt(t).name) {
			out.shownOk = false;
			out.shownDetail = `t=${t.toFixed(4)} engine-rig shows ${shown}, the bake chose ${viewAt(t).name}`;
		}
		if ([4.0, 4.3, 4.45].includes(t)) {
			const [s1, s2] = sing(worldOf(skel, 'hand_image'));
			out.at[t] = { shown, squash: s2 / s1 };
		}
	}
	out.behind.shift();
	const anim = doc.animations[clip.name];
	out.keys = Object.values(anim.bones).reduce(
		(n, tl) => n + Object.values(tl).reduce((m, keys) => m + keys.length, 0),
		0,
	);
	out.keyFrames = Object.values(report.bones).reduce((n, b) => n + b.keys, 0);
	out.perSecond = out.keyFrames / BAKED.length / D;
	out.bytes = JSON.stringify(anim).length;
	return out;
}

// ── The gate ────────────────────────────────────────────────────────────────────────────────────

const TOL = 1;
/** Key frames per baked bone per second each clip must stay under (measured: the design doc §6). */
const BUDGET = { crossed: 45, hinged: 25, calm: 8 };
const runs = {};
for (const arm of [CROSSED, HINGED, CALM]) {
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
	const anim = v.doc.animations[arm.clip.name];
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
	const unmet = Object.entries(v.report.bones).filter(([, b]) => b.unmet);
	ok(
		`${tag} the bake met its tolerance on every run of keys`,
		!unmet.length,
		JSON.stringify(unmet),
	);
	ok(
		`${tag} key reduction: at most ${BUDGET[arm.name]} key frames per baked bone per second`,
		v.perSecond <= BUDGET[arm.name],
		v.perSecond.toFixed(1),
	);
	if (arm === CALM) continue;
	ok(`${tag} the upper arm is held exactly edge-on`, v.minDet < 1e-9, `min |det| ${v.minDet}`);
	const upperFlips = v.flips.filter((f) => f.name === 'upper_arm').length;
	ok(
		`${tag} the upper arm turns through edge-on (swing round, roll)`,
		upperFlips >= 3,
		`${upperFlips}`,
	);
	ok(`${tag} engine-rig draws the order the bake keyed`, v.orderOk, v.orderDetail);
	ok(`${tag} the draw order follows depth past the hysteresis`, v.orderDepthOk, v.orderDepthDetail);
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

// Mutations, on the stress arm: every step the design names must be needed.
const MUTATIONS = [
	['no shear (rotate + scale only)', { shear: false }, (m) => m.err > TOL],
	['parent-local projection instead of world', { project: 'local' }, (m) => m.err > TOL],
	['keys only at the 3D keys (no dense bake)', { dense: false }, (m) => m.err > TOL],
	['no key reduction', { reduce: false }, (m) => m.perSecond > BUDGET.crossed],
	['no floor for an edge-on card', { floor: false }, (m) => m.err > TOL],
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

const fmt = (n) => (Number.isFinite(n) ? n.toFixed(3) : String(n));
for (const [name, v] of Object.entries(runs)) {
	console.log(
		`rig-2p5d [${name}]: ${v.flips.length} edge-on crossings; max corner error ${fmt(v.err)} (worst ${JSON.stringify(v.worst)})`,
	);
	for (const [bone, b] of Object.entries(v.report.bones))
		console.log(
			`  ${bone.padEnd(11)} ${String(b.keys).padStart(4)} key frames (dense ${b.dense}), ${b.steps} steps, ${v.report.timelineKeys[bone]} timeline keys`,
		);
	console.log(
		`  ${v.perSecond.toFixed(1)} key frames/bone/s, ${v.keys} timeline keys, ${v.bytes} bytes of clip JSON; ${v.doc.animations.reach.drawOrder?.length ?? 0} draw-order keys, ${v.sched.length} drawing keys`,
	);
}
for (const { label, m } of mutated)
	console.log(
		`  mutation ${label}: err ${fmt(m.err)}, ${m.perSecond.toFixed(1)} key frames/bone/s, behind ×${m.behind.length}`,
	);
console.log(`${checks - fails}/${checks} checks passed`);
if (fails) process.exit(1);
