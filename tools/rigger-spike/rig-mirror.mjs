// Rig controls phase C3 — mirror and picker (docs/design/rig-controls.md §5.4, §5.6): the mirror, picker,
// face-board and graph functions pulled out of the SHIPPED view.html, every pose they write played back by
// the REAL engine-rig (SkeletonJson → Skeleton → AnimationState) as a game plays it, and the sidecar they
// keep checked by the COMMITTED `vendor/rigger-controls.js` (C1's schema, fit and renames).
//
// On a synthetic body built half by hand — hips, chest, head, a left arm with a hand, an eye, an IK hand
// control and a pole, images on them (a weighted mesh among them), an IK and a transform — and half by
// the shipped Mirror rig side. Asserted:
//  - pairs come from the names (_l / _r, L_ / R_, left / right, camel-case), the overrides win, the
//    mirror line is the root's x = 0 or a bone's axis;
//  - Mirror rig side makes the right side at the exact mirror of the left: every bone, every image (a
//    region and a weighted mesh, drawn where the game draws them), the IK (its bend) and the transform
//    (its offsets) solving the mirrored way, its controls, limb, set, preset and picker buttons, in a
//    sidecar C1 accepts; the left side and every existing weighted index are untouched;
//  - Mirror pose L → R, R → L and swap at the playhead, under a turned and non-uniformly scaled chest:
//    the game draws each target at the mirror of its source, the source side unchanged at every time,
//    the rest pose of a hand-made (not quite symmetric) rig stays the rest pose, swapping twice is the
//    pose it started from, a key dropped inside an eased segment keeps the curve's shape on both sides;
//  - with an IK half on, its mix is copied and the FK keys are the FK pose's mirror (not the solved
//    one); at full mix the bend is chosen; a control following a space is keyed through its space bone;
//    a locked channel's child still lands; a skipped bone is left;
//  - the picker lays out every control at its setup place, fitted, none overlapping, left on the right
//    as the stage shows it, limbs under their controls, sets at the foot; a box selects its buttons;
//  - the face board makes a gaze box and sliders, or takes the channels' own places;
//  - the graph editor's constraint curves are what engine-rig plays: an IK's mix and softness, a
//    transform's six mixes, a physics mix; easing one transform mix eases only that one;
//  - the irig is plain 4.2 data the strict reader takes.
// Every guard is mutation-checked: a planted mutant of the shipped code must turn its check red, and a
// mutant whose text is no longer in the code fails the run.
//   node tools/rigger-spike/rig-mirror.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { RIG_CORE } from './rig.mjs';

const RIG = await import(RIG_CORE);
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, AnimationState } = RIG;
const { AnimationStateData, Physics, importSpine42Json, writeIrig, readIrig } = RIG;

let checks = 0;
let failed = 0;
const check = (ok, msg) => {
	checks++;
	if (!ok) failed++;
	console.log(`  ${ok ? '✅' : '✗'} ${msg}`);
	return ok;
};
const clone = (o) => JSON.parse(JSON.stringify(o));
const ATLAS = 'page.png\nsize:64,64\nfilter:Linear,Linear\narm\nbounds:0,0,32,16\nhand\nbounds:32,0,16,16\n';
const stub = { getImage: () => ({ width: 64, height: 64 }), setFilters() {}, setWraps() {}, dispose() {} };
function load(doc) {
	const atlas = new TextureAtlas(ATLAS);
	for (const p of atlas.pages) p.setTexture(stub);
	const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(clone(doc));
	return { data, skel: new Skeleton(data), state: new AnimationState(new AnimationStateData(data)) };
}
/** `doc` posed by `anim` at `t` (setup when none), as a game plays it. */
function poseAt(doc, anim, t) {
	const { data, skel, state } = load(doc);
	if (data.defaultSkin) skel.setSkin(data.defaultSkin);
	skel.setToSetupPose();
	if (anim) {
		state.setAnimation(0, anim, false);
		state.update(Math.max(t, Math.fround(t)));
		state.apply(skel);
	}
	skel.updateWorldTransform(Physics.update);
	return skel;
}
// What the mirror measures through, as the page's `poseClipAt` does: the clip at t, of `from` or the doc.
const poser = (doc, anim) => (t, from) => poseAt(from || doc, anim, t);
const W = (b) => ({ a: b.a, b: b.b, c: b.c, d: b.d, x: b.worldX, y: b.worldY });
// The reflection across line L, written here apart from the shipped one: reflected, its y axis turned back.
function reflect(w, L) {
	const r11 = 2 * L.ux * L.ux - 1;
	const r12 = 2 * L.ux * L.uy;
	const r22 = 2 * L.uy * L.uy - 1;
	const dx = w.x - L.x;
	const dy = w.y - L.y;
	return {
		a: r11 * w.a + r12 * w.c,
		c: r12 * w.a + r22 * w.c,
		b: -(r11 * w.b + r12 * w.d),
		d: -(r12 * w.b + r22 * w.d),
		x: L.x + r11 * dx + r12 * dy,
		y: L.y + r12 * dx + r22 * dy,
	};
}
const reflectPt = (p, L) => {
	const r = reflect({ a: 1, b: 0, c: 0, d: 1, x: p[0], y: p[1] }, L);
	return [r.x, r.y];
};
/** The vertical through the root as posed: the root's x = 0. */
const rootLine = (s) => {
	const r = s.bones[0];
	const m = Math.hypot(r.b, r.d);
	return { x: r.worldX, y: r.worldY, ux: r.b / m, uy: r.d / m };
};
const gap = (a, b) =>
	Math.max(
		Math.hypot(a.x - b.x, a.y - b.y),
		10 * Math.hypot(a.a - b.a, a.c - b.c),
		10 * Math.hypot(a.b - b.b, a.d - b.d),
	);
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const mul = (A, B) => ({ a: A.a * B.a + A.b * B.c, b: A.a * B.b + A.b * B.d, c: A.c * B.a + A.d * B.c, d: A.c * B.b + A.d * B.d, x: A.a * B.x + A.b * B.y + A.x, y: A.c * B.x + A.d * B.y + A.y });
const inv = (A) => {
	const det = A.a * A.d - A.b * A.c;
	const a = A.d / det;
	const b = -A.b / det;
	const c = -A.c / det;
	const d = A.a / det;
	return { a, b, c, d, x: -(a * A.x + b * A.y), y: -(c * A.x + d * A.y) };
};
/** A one-value key list's value at `t` on its exact curve (a bezier solved for its time, not sampled). */
function exactAt(keys, t) {
	if (t <= keys[0].time) return keys[0].value;
	let i = 0;
	while (i < keys.length - 1 && keys[i + 1].time <= t) i++;
	if (i === keys.length - 1) return keys[i].value;
	const [k0, k1] = [keys[i], keys[i + 1]];
	if (k0.curve === 'stepped') return k0.value;
	if (!Array.isArray(k0.curve)) return k0.value + ((k1.value - k0.value) * (t - k0.time)) / (k1.time - k0.time);
	const [cx1, cy1, cx2, cy2] = k0.curve;
	const B = (p0, p1, p2, p3, q) => (1 - q) ** 3 * p0 + 3 * (1 - q) ** 2 * q * p1 + 3 * (1 - q) * q * q * p2 + q ** 3 * p3;
	let lo = 0;
	let hi = 1;
	for (let n = 0; n < 60; n++) {
		const m = (lo + hi) / 2;
		if (B(k0.time, cx1, cx2, k1.time, m) < t) lo = m;
		else hi = m;
	}
	return B(k0.value, cy1, cy2, k1.value, (lo + hi) / 2);
}

// ------------------------------------------------------- C1's code, as the page loads it (committed)
const RC = (() => {
	const ctx = { structuredClone };
	vm.createContext(ctx);
	vm.runInContext(
		`${readFileSync(new URL('../../apps/launcher-api/static/rigger/vendor/rigger-controls.js', import.meta.url), 'utf8')}\n;globalThis.__rc = RiggerControls;`,
		ctx,
	);
	return ctx.__rc;
})();

// ----------------------------------------------------------------- the shipped Rigger, sandboxed
const VIEW = readFileSync(
	new URL('../../apps/launcher-api/static/rigger/view.html', import.meta.url),
	'utf8',
).replace(/\r\n/g, '\n');
const TOP = new Map();
for (const m of VIEW.matchAll(/\n(function|const) ([A-Za-z_$][\w$]*)[ (]/g))
	if (!TOP.has(m[2])) TOP.set(m[2], { kind: m[1], at: m.index });
function pull(name) {
	const { kind, at } = TOP.get(name);
	const eol = VIEW.indexOf('\n', at + 1);
	const first = VIEW.slice(at, eol);
	let n = 0;
	for (const c of first) {
		if (c === '{' || c === '[') n++;
		else if (c === '}' || c === ']') n--;
	}
	if (n === 0 && (kind === 'const' || first.includes('{'))) return first;
	const end = VIEW.indexOf(kind === 'const' ? '\n};' : '\n}', at);
	return VIEW.slice(at, end + (kind === 'const' ? 3 : 2));
}
const STUBS = new Set(['markDirty', 'rebuildFromRawDoc', 'buildInspector', 'historyStep', 'renderTimeline']);
const ENTRY = [
	'sideWords',
	'sideOfName',
	'mirrorName',
	'mirrorPairs',
	'mirrorLineBone',
	'mirrorLineOf',
	'mirrorConstraintPairs',
	'mirrorPose',
	'mirrorRigSide',
	'pickerAutoItems',
	'pickerItemsIn',
	'faceBoardItems',
	'graphConFields',
	'GRAPH_CON_CHANS',
	'graphValueAt',
	'setKeyCurveField',
	'constraintOrderClashes',
	'sampleChannel',
	'setupWorlds',
	'worldOf',
];
/** The shipped functions in a fresh context; `mutate` swaps [from, to] text in the pulled source. */
function sandbox(mutate = []) {
	const pulled = [];
	const seen = new Set();
	for (const q = [...ENTRY]; q.length;) {
		const name = q.shift();
		if (seen.has(name) || STUBS.has(name)) continue;
		if (!TOP.has(name)) throw new Error(`${name} not found in view.html`);
		seen.add(name);
		const src = pull(name);
		pulled.push({ at: TOP.get(name).at, src });
		for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\b(\s*\()?/g)) {
			const t = TOP.get(m[1]);
			if (t && (t.kind === 'const' || m[2]) && !seen.has(m[1]) && !STUBS.has(m[1])) q.push(m[1]);
		}
	}
	// In the page's own order, so a constant built from another finds it made.
	let src = pulled
		.sort((a, b) => a.at - b.at)
		.map((p) => p.src)
		.join('\n');
	for (const [from, to] of mutate) {
		if (!src.includes(from)) throw new Error(`mutant: "${from}" is not in the pulled source`);
		src = src.replace(from, to);
	}
	const ui = { RIG, markDirty() {}, renderTimeline() {}, historyStep: (fn) => fn(), animsDirty: false };
	vm.createContext(ui);
	vm.runInContext(`${src}\n;Object.assign(globalThis, { ${ENTRY.join(', ')} });`, ui, {
		filename: 'view.html#rig-mirror',
	});
	return ui;
}
const UI = sandbox();

// --------------------------------------------------------------------------------- the left half
// y up. Hips and chest point up from the root, a head on the chest; a left arm (screen right: the
// character faces the viewer) of two bones and a hand, an eye on the head, an IK hand control under the
// root on the wrist and a pole on the chest; a prop. Images: the body, a region on the upper arm (off its
// axis and turned, so a flip shows), a mesh on the forearm weighted to both arm bones, the hand, the eye.
const LEFT_BONES = [
	{ name: 'root' },
	{ name: 'hips', parent: 'root', y: 100, rotation: 90, length: 30 },
	{ name: 'chest', parent: 'hips', x: 30, length: 60 },
	{ name: 'head', parent: 'chest', x: 60, length: 30 },
	{ name: 'eye_l', parent: 'head', x: 15, y: -8 },
	{ name: 'upper_arm_l', parent: 'chest', x: 50, y: -25, rotation: -100, length: 50 },
	{ name: 'lower_arm_l', parent: 'upper_arm_l', x: 50, rotation: -30, length: 45 },
	{ name: 'hand_l', parent: 'lower_arm_l', x: 45, length: 15 },
	{ name: 'hand_ik_l', parent: 'root' },
	{ name: 'elbow_pole_l', parent: 'chest' },
	{ name: 'prop', parent: 'root', x: 200, y: 60 },
];
function leftDoc() {
	const d = {
		skeleton: { spine: '4.2.0' },
		bones: clone(LEFT_BONES),
		slots: [
			{ name: 'body', bone: 'hips', attachment: 'arm' },
			{ name: 'arm_l', bone: 'upper_arm_l', attachment: 'arm' },
			{ name: 'forearm_l', bone: 'lower_arm_l', attachment: 'arm' },
			{ name: 'hand_l', bone: 'hand_l', attachment: 'hand' },
			{ name: 'head', bone: 'head', attachment: 'hand' },
			{ name: 'eye_l', bone: 'eye_l', attachment: 'hand' },
		],
		skins: [
			{
				name: 'default',
				attachments: {
					body: { arm: { x: 15, width: 30, height: 20 } },
					arm_l: { arm: { x: 25, y: 4, rotation: 5, width: 50, height: 16 } },
					hand_l: { hand: { x: 6, rotation: 20, width: 12, height: 12 } },
					head: { hand: { x: 15, width: 30, height: 30 } },
					eye_l: { hand: { y: 2, scaleX: 0.5, scaleY: 0.5, width: 12, height: 12 } },
				},
			},
		],
		ik: [],
		transform: [],
		animations: {},
	};
	const s = poseAt(d, null, 0);
	const at = (n) => s.findBone(n);
	// the hand control on the wrist, the pole 60 out from the elbow
	const lower = at('lower_arm_l');
	const wrist = [lower.worldX + 45 * lower.a, lower.worldY + 45 * lower.c];
	Object.assign(d.bones.find((b) => b.name === 'hand_ik_l'), { x: r4(wrist[0]), y: r4(wrist[1]) });
	const sh = at('upper_arm_l');
	const mx = (sh.worldX + wrist[0]) / 2;
	const my = (sh.worldY + wrist[1]) / 2;
	const k = 60 / Math.hypot(lower.worldX - mx, lower.worldY - my);
	const pole = { x: lower.worldX + (lower.worldX - mx) * k, y: lower.worldY + (lower.worldY - my) * k };
	at('chest').worldToLocal(pole);
	Object.assign(d.bones.find((b) => b.name === 'elbow_pole_l'), { x: r4(pole.x), y: r4(pole.y) });
	// the forearm mesh: a quad round the forearm, each corner weighted to both arm bones
	const up = at('upper_arm_l');
	const idx = (n) => d.bones.findIndex((b) => b.name === n);
	const corners = [
		[0, -6],
		[45, -6],
		[45, 6],
		[0, 6],
	];
	const verts = [];
	for (const [x, y] of corners) {
		const wp = { x: lower.worldX + lower.a * x + lower.b * y, y: lower.worldY + lower.c * x + lower.d * y };
		const inUp = { ...wp };
		up.worldToLocal(inUp);
		verts.push(2, idx('upper_arm_l'), r4(inUp.x), r4(inUp.y), 0.3, idx('lower_arm_l'), x, y, 0.7);
	}
	d.skins[0].attachments.forearm_l = {
		arm: {
			type: 'mesh',
			uvs: [0, 0, 1, 0, 1, 1, 0, 1],
			triangles: [0, 1, 2, 0, 2, 3],
			vertices: verts,
			hull: 4,
			width: 45,
			height: 12,
		},
	};
	// the arm's IK, off and bent the way the arm is; the hand turning with its control (off)
	const bendOf = (bend) => {
		const t = clone(d);
		t.ik = [{ name: 'arm_ik_l', order: 0, bones: ['upper_arm_l', 'lower_arm_l'], target: 'hand_ik_l', mix: 1, bendPositive: bend }];
		const e = poseAt(t, null, 0).findBone('lower_arm_l');
		return Math.hypot(e.worldX - lower.worldX, e.worldY - lower.worldY);
	};
	d.ik = [{ name: 'arm_ik_l', order: 0, bones: ['upper_arm_l', 'lower_arm_l'], target: 'hand_ik_l', mix: 0, bendPositive: bendOf(true) <= bendOf(false) }];
	d.transform = [
		{ name: 'hand_l_orient', order: 1, bones: ['hand_l'], target: 'hand_ik_l', mixRotate: 0, mixX: 0, mixY: 0, mixScaleX: 0, mixScaleY: 0, mixShearY: 0, rotation: 15, y: 3 },
	];
	return d;
}
const LEFT_CTL = {
	controls: 1,
	rig: 'Body',
	bones: {
		hand_ik_l: { role: 'control', shape: 'square', colour: '#4aa3ff' },
		elbow_pole_l: { role: 'control', shape: 'diamond', size: 8 },
		upper_arm_l: { shape: 'ring', size: 40, sizeIn: 'rig', offset: [5, 3], turn: 20, limits: { rotate: [-130, -40], y: [-30, -20], scaleX: [0.5, 1.5] } },
		head: { shape: 'circle' },
		hips: { shape: 'circle', display: 'stage' },
	},
	limbs: { arm_l: { ik: 'arm_ik_l', fk: ['upper_arm_l', 'lower_arm_l'], control: 'hand_ik_l', pole: 'elbow_pole_l' } },
	sets: { hand_left: ['hand_ik_l', 'elbow_pole_l'] },
	presets: { arm_ik_l: 'twoBoneIk' },
	picker: { items: [{ bone: 'hand_ik_l', at: [0.8, 0.5] }, { limb: 'arm_l', at: [0.8, 0.6] }] },
};
const LEFT = leftDoc();
const NEW_R = ['eye_r', 'upper_arm_r', 'lower_arm_r', 'hand_r', 'hand_ik_r', 'elbow_pole_r'];
const PAIRS = [
	['eye_l', 'eye_r'],
	['upper_arm_l', 'upper_arm_r'],
	['lower_arm_l', 'lower_arm_r'],
	['hand_l', 'hand_r'],
	['hand_ik_l', 'hand_ik_r'],
	['elbow_pole_l', 'elbow_pole_r'],
];
/** The two-sided rig: the left half, its right side made by the shipped Mirror rig side. */
function bodyDoc(ui = UI) {
	const d = clone(LEFT);
	const res = ui.mirrorRigSide(d, clone(LEFT_CTL), 'l');
	return { d, res, ctl: res.error ? null : res.controls(clone(LEFT_CTL)) };
}

// ------------------------------------------------------------------------------------- the guards
const worldVerts = (s, slotName) => {
	const slot = s.findSlot(slotName);
	const att = slot.getAttachment();
	const out = [];
	if (att.uvs && att.computeWorldVertices.length > 4) {
		const n = att.worldVerticesLength;
		const v = new Array(n).fill(0);
		att.computeWorldVertices(slot, 0, n, v, 0, 2);
		for (let i = 0; i < n; i += 2) out.push([v[i], v[i + 1]]);
	} else {
		const v = new Array(8).fill(0);
		att.computeWorldVertices(slot, v, 0, 2);
		for (let i = 0; i < 8; i += 2) out.push([v[i], v[i + 1]]);
	}
	return out;
};
// The worst distance from each point of `a` to its nearest in `b` (a flipped quad lists its corners in
// another order).
const setGap = (a, b) => Math.max(...a.map((p) => Math.min(...b.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])))));
const pairGap = (sNow, sWas, pairs, L) =>
	Math.max(...pairs.map(([src, dst]) => gap(W(sNow.findBone(dst)), reflect(W(sWas.findBone(src)), L))));
const same = (a, b, names) => Math.max(...names.map((n) => gap(W(a.findBone(n)), W(b.findBone(n)))));
const LEFT_NAMES = PAIRS.map(([l]) => l);
const RIGHT_NAMES = PAIRS.map(([, r]) => r);
const CENTRE = ['root', 'hips', 'chest', 'head', 'prop'];

// The act clip: a chest that turns and scales unevenly, a head that turns, an arm on eased keys, the
// hand control moving; the right upper arm already keyed on an eased segment across the playhead.
const EASE = (t0, v0, t1, v1) => [r4(t0 + (t1 - t0) * 0.42), v0, r4(t0 + (t1 - t0) * 0.58), v1];
const ACT = {
	bones: {
		chest: {
			rotate: [{ time: 0, value: 0, curve: EASE(0, 0, 1.2, 25) }, { time: 1.2, value: 25 }],
			scale: [{ time: 0, x: 1, y: 1 }, { time: 1.2, x: 1.15, y: 0.9 }],
		},
		head: { rotate: [{ time: 0, value: 0 }, { time: 1.2, value: -20 }] },
		upper_arm_l: { rotate: [{ time: 0, value: 0, curve: EASE(0, 0, 0.3, 30) }, { time: 0.3, value: 30 }, { time: 1, value: -20 }] },
		lower_arm_l: { rotate: [{ time: 0, value: 0 }, { time: 1.2, value: 40 }] },
		hand_l: { rotate: [{ time: 0, value: 0 }, { time: 1.2, value: -30 }] },
		eye_l: { translate: [{ time: 0, x: 0, y: 0 }, { time: 1.2, x: 2, y: 1 }] },
		hand_ik_l: { translate: [{ time: 0, x: 0, y: 0 }, { time: 1.2, x: 20, y: 30 }] },
		upper_arm_r: { rotate: [{ time: 0.2, value: 10, curve: EASE(0.2, 10, 1, -35) }, { time: 1, value: -35 }] },
	},
};
// The reach clip: the chest turned (evenly scaled), the arm's IK blending in from 0 to full by 0.8 with
// its control moving, the right IK unkeyed; the hand control can follow a chest space.
const REACH = {
	bones: {
		chest: { rotate: [{ time: 0, value: 0 }, { time: 1.2, value: 15 }], scale: [{ time: 0, x: 1, y: 1 }, { time: 1.2, x: 1.1, y: 1.1 }] },
		upper_arm_l: { rotate: [{ time: 0, value: 0 }, { time: 1.2, value: 35 }] },
		hand_ik_l: { translate: [{ time: 0, x: 0, y: 0 }, { time: 1.2, x: -25, y: 20 }] },
	},
	ik: { arm_ik_l: [{ time: 0, mix: 0, softness: 0, bendPositive: LEFT.ik[0].bendPositive, compress: false, stretch: false, curve: [0.3, 0, 0.5, 1, 0.3, 0, 0.5, 0] }, { time: 0.8, mix: 1, softness: 0, bendPositive: LEFT.ik[0].bendPositive, compress: false, stretch: false }] },
};
const withClip = (base, name, clip) => ({ ...clone(base), animations: { [name]: clone(clip) } });

const GUARDS = {
	names(ui) {
		const pairs = [
			['hand_ik_l', 'hand_ik_r'],
			['hand_ik_l_chest', 'hand_ik_r_chest'],
			['L_eye', 'R_eye'],
			['upperArmLeft', 'upperArmRight'],
			['LEFT_wing', 'RIGHT_wing'],
			['arm.l', 'arm.r'],
		];
		return pairs.every(([a, b]) => ui.mirrorName(a) === b && ui.mirrorName(b) === a && ui.sideOfName(a) === 'l' && ui.sideOfName(b) === 'r')
			&& ui.sideOfName('hip_lr') === null && ui.mirrorName('leftover') === 'leftover' && ui.sideOfName('Leftover') === null;
	},
	pairs(ui) {
		const doc = { bones: ['root', 'arm_l', 'arm_r', 'wing_a', 'wing_b', 'tail_l', 'leg_l', 'leg_r'].map((name) => ({ name })) };
		const mp = ui.mirrorPairs(doc, { mirror: { pairs: { wing_a: 'wing_b', leg_r: 'leg_l' } } });
		const has = (l, r) => mp.pairs.some((p) => p.l === l && p.r === r);
		return has('arm_l', 'arm_r') && has('wing_a', 'wing_b') && has('leg_r', 'leg_l') && !has('leg_l', 'leg_r') && mp.unpaired.join() === 'tail_l';
	},
	line(ui) {
		const d = clone(LEFT);
		const Ws = ui.setupWorlds(d);
		const root = ui.mirrorLineOf(Ws.get('root'), 0);
		const hips = ui.mirrorLineOf(Ws.get('hips'), 30);
		return ui.mirrorLineBone(d, null) === 'root' && ui.mirrorLineBone(d, { mirror: { line: 'hips' } }) === 'hips'
			&& Math.abs(root.ux) < 1e-9 && Math.abs(root.uy - 1) < 1e-9 && Math.abs(hips.ux) < 1e-9 && Math.abs(hips.uy - 1) < 1e-9 && Math.abs(hips.y - 100) < 1e-9;
	},
	sideBones(ui) {
		const { d, res } = bodyDoc(ui);
		if (res.error) return false;
		const s = poseAt(d, null, 0);
		const L = rootLine(s);
		return res.bones.slice().sort().join() === NEW_R.slice().sort().join() && pairGap(s, s, PAIRS, L) < 1e-4;
	},
	sideLeftAlone(ui) {
		const { d } = bodyDoc(ui);
		return JSON.stringify(d.bones.slice(0, LEFT.bones.length)) === JSON.stringify(LEFT.bones)
			&& JSON.stringify(d.skins[0].attachments.forearm_l) === JSON.stringify(LEFT.skins[0].attachments.forearm_l);
	},
	sideImages(ui) {
		const { d } = bodyDoc(ui);
		const s = poseAt(d, null, 0);
		const L = rootLine(s);
		const region = setGap(worldVerts(s, 'arm_r'), worldVerts(s, 'arm_l').map((p) => reflectPt(p, L)));
		const ml = worldVerts(s, 'forearm_l').map((p) => reflectPt(p, L));
		const mr = worldVerts(s, 'forearm_r');
		const mesh = Math.max(...mr.map((p, i) => Math.hypot(p[0] - ml[i][0], p[1] - ml[i][1])));
		const eye = setGap(worldVerts(s, 'eye_r'), worldVerts(s, 'eye_l').map((p) => reflectPt(p, L)));
		return region < 1e-3 && mesh < 1e-3 && eye < 1e-3;
	},
	sideSlots(ui) {
		const { d } = bodyDoc(ui);
		const names = d.slots.map((s) => s.name);
		return names.indexOf('arm_r') === names.indexOf('arm_l') + 1 && names.indexOf('forearm_r') === names.indexOf('forearm_l') + 1 && d.slots.find((s) => s.name === 'arm_r').bone === 'upper_arm_r';
	},
	sideConstraints(ui) {
		const { d } = bodyDoc(ui);
		const ik = d.ik.find((c) => c.name === 'arm_ik_r');
		const tc = d.transform.find((c) => c.name === 'hand_r_orient');
		if (!ik || !tc || ui.constraintOrderClashes(d).length) return false;
		// every mix on: the right side solves to the mirror of the left
		const on = clone(d);
		for (const c of on.ik) c.mix = 1;
		for (const c of on.transform) Object.assign(c, { mixRotate: 1, mixX: 1, mixY: 1 });
		const s = poseAt(on, null, 0);
		return ik.bendPositive === !LEFT.ik[0].bendPositive && tc.rotation === -15 && tc.y === -3 && pairGap(s, s, PAIRS, rootLine(s)) < 1e-3;
	},
	sideControls(ui) {
		const { d, ctl } = bodyDoc(ui);
		if (!ctl) return false;
		const doc = { ...ctl, rig: 'Body' };
		return RC.controlsDocProblems(doc).length === 0 && RC.controlsIrigProblems(doc, d).length === 0
			&& JSON.stringify(ctl.limbs.arm_r) === JSON.stringify({ ik: 'arm_ik_r', fk: ['upper_arm_r', 'lower_arm_r'], control: 'hand_ik_r', pole: 'elbow_pole_r' })
			&& ctl.bones.hand_ik_r.shape === 'square' && !ctl.bones.hand_ik_r.colour && ctl.bones.upper_arm_r.shape === 'ring'
			&& ctl.sets.hand_right.join() === 'hand_ik_r,elbow_pole_r' && ctl.presets.arm_ik_r === 'twoBoneIk'
			&& ctl.picker.items.some((it) => it.bone === 'hand_ik_r' && Math.abs(it.at[0] - 0.2) < 1e-9) && ctl.picker.items.some((it) => it.limb === 'arm_r');
	},
	sideDrawOrder(ui) {
		// a clip that draws the arm behind the body, keyed as the Rigger's draw-order editor writes it
		const d = clone(LEFT);
		const names = d.slots.map((x) => x.name);
		const order = ['arm_l', 'forearm_l', 'hand_l', 'body', 'head', 'eye_l'];
		const offsets = order.map((n, pos) => ({ slot: n, offset: pos - names.indexOf(n) })).filter((o) => o.offset).sort((a, b) => names.indexOf(a.slot) - names.indexOf(b.slot));
		d.animations = { swing: { drawOrder: [{ time: 0.5, offsets }] } };
		if (ui.mirrorRigSide(d, null, 'l').error) return false;
		const drawn = (t) => poseAt(d, 'swing', t).drawOrder.map((x) => x.data.name).join();
		return drawn(0.6) === 'arm_l,arm_r,forearm_l,forearm_r,hand_l,hand_r,body,head,eye_l,eye_r' && drawn(0.2) === 'body,arm_l,arm_r,forearm_l,forearm_r,hand_l,hand_r,head,eye_l,eye_r';
	},
	sideZeroScale(ui) {
		// an effect bone hidden at setup by a zero scale, with an image and a child
		const d = clone(LEFT);
		d.bones.push({ name: 'spark_l', parent: 'chest', x: 40, y: -10, rotation: -60, scaleX: 0, scaleY: 0, length: 10 }, { name: 'spark_tip_l', parent: 'spark_l', x: 10, rotation: 15 });
		d.slots.push({ name: 'spark_l', bone: 'spark_l', attachment: 'hand' });
		d.skins[0].attachments.spark_l = { hand: { x: 4, y: 2, rotation: 10, width: 12, height: 12 } };
		let res;
		try {
			res = ui.mirrorRigSide(d, null, 'l');
		} catch {
			return false;
		}
		const r = d.bones.find((b) => b.name === 'spark_r');
		if (res.error || !r || r.scaleX !== 0 || r.scaleY !== 0) return false;
		// shown at full size on both sides, the right is the mirror of the left
		const shown = clone(d);
		for (const b of shown.bones) if (b.scaleX === 0) Object.assign(b, { scaleX: 1, scaleY: 1 });
		const sh = poseAt(shown, null, 0);
		return pairGap(sh, sh, [['spark_l', 'spark_r'], ['spark_tip_l', 'spark_tip_r']], rootLine(sh)) < 1e-4
			&& setGap(worldVerts(sh, 'spark_r'), worldVerts(sh, 'spark_l').map((p) => reflectPt(p, rootLine(sh)))) < 1e-3;
	},
	sideLimits(ui) {
		const { ctl } = bodyDoc(ui);
		const c = ctl.bones.upper_arm_r;
		return c.limits.rotate.join() === '40,130' && c.limits.y.join() === '20,30' && c.limits.scaleX.join() === '0.5,1.5'
			&& c.offset.join() === '5,-3' && c.turn === -20 && bodyDoc(ui).d.bones.filter((b) => /_r$/.test(b.name)).every((b) => Math.abs(b.rotation || 0) <= 180);
	},
	poseLimit(ui) {
		// a limit on the right arm holds what the mirror keys, and the arm is named as off the mirror
		const { d } = bodyDoc(ui);
		const doc = withClip(d, 'act', ACT);
		const lim = { upper_arm_r: [95, 105] };
		const clamp = (n, f, v) => (f === 'rotate' && lim[n] ? Math.min(lim[n][1], Math.max(lim[n][0], v)) : v);
		const res = ui.mirrorPose(doc, null, 'act', 'l2r', 0.6, poser(doc, 'act'), { clamp });
		const r = poseAt(doc, 'act', 0.6).findBone('upper_arm_r').rotation;
		return r >= 95 - 1e-6 && r <= 105 + 1e-6 && res.off.includes('upper_arm_r');
	},
	sideOnce(ui) {
		const { d } = bodyDoc(ui);
		return !!ui.mirrorRigSide(d, null, 'l').error;
	},
	poseL2R(ui) {
		const { d } = bodyDoc(ui);
		const doc = withClip(d, 'act', ACT);
		const was = clone(doc);
		const t = 0.6;
		const before = poseAt(was, 'act', t);
		const res = ui.mirrorPose(doc, null, 'act', 'l2r', t, poser(doc, 'act'));
		if (res.error) return false;
		const after = poseAt(doc, 'act', t);
		let kept = 0;
		for (const u of [0, 0.3, 0.6, 0.9, 1.2]) kept = Math.max(kept, same(poseAt(doc, 'act', u), poseAt(was, 'act', u), [...LEFT_NAMES, ...CENTRE]));
		return pairGap(after, before, PAIRS, rootLine(before)) < 1e-3 && kept < 1e-9 && res.residual < 1e-3;
	},
	poseLine(ui) {
		// the line along the chest as it turns: the right arm takes the left's pose relative to the chest
		const { d } = bodyDoc(ui);
		const doc = withClip(d, 'act', ACT);
		const t = 0.6;
		const before = poseAt(clone(doc), 'act', t);
		const c = before.findBone('chest');
		const m = Math.hypot(c.a, c.c);
		const res = ui.mirrorPose(doc, { controls: 1, rig: 'Body', mirror: { line: 'chest' } }, 'act', 'l2r', t, poser(doc, 'act'));
		const after = poseAt(doc, 'act', t);
		return !res.error && Math.abs(c.a / m) > 0.1 && pairGap(after, before, PAIRS, { x: c.worldX, y: c.worldY, ux: c.a / m, uy: c.c / m }) < 1e-3;
	},
	poseR2L(ui) {
		const { d } = bodyDoc(ui);
		const doc = withClip(d, 'act', ACT);
		const t = 0.6;
		const before = poseAt(clone(doc), 'act', t);
		const res = ui.mirrorPose(doc, null, 'act', 'r2l', t, poser(doc, 'act'));
		const after = poseAt(doc, 'act', t);
		return !res.error && pairGap(after, before, PAIRS.map(([l, r]) => [r, l]), rootLine(before)) < 1e-3 && same(after, before, RIGHT_NAMES) < 1e-9;
	},
	swap(ui) {
		const { d } = bodyDoc(ui);
		const doc = withClip(d, 'act', ACT);
		const was = clone(doc);
		const t = 0.6;
		const before = poseAt(was, 'act', t);
		const L = rootLine(before);
		ui.mirrorPose(doc, null, 'act', 'swap', t, poser(doc, 'act'));
		const after = poseAt(doc, 'act', t);
		const Ls = rootLine(poseAt(d, null, 0));
		const centre = Math.max(...['hips', 'chest', 'head', 'prop'].map((n) => { const ws = W(poseAt(d, null, 0).findBone(n)); return gap(W(after.findBone(n)), mul(reflect(W(before.findBone(n)), L), mul(inv(reflect(ws, Ls)), ws))); }));
		const flipped = Math.max(centre, pairGap(after, before, [...PAIRS, ...PAIRS.map(([l, r]) => [r, l])], L));
		ui.mirrorPose(doc, null, 'act', 'swap', t, poser(doc, 'act'));
		const back = same(poseAt(doc, 'act', t), before, [...LEFT_NAMES, ...RIGHT_NAMES, ...CENTRE]);
		return flipped < 1e-3 && back < 1e-3;
	},
	rest(ui) {
		// a hand-made right side: not quite the mirror of the left
		const { d } = bodyDoc(ui);
		Object.assign(d.bones.find((b) => b.name === 'upper_arm_r'), { x: d.bones.find((b) => b.name === 'upper_arm_r').x + 2 });
		d.bones.find((b) => b.name === 'upper_arm_r').rotation += 4;
		d.bones.find((b) => b.name === 'eye_r').y += 1.5;
		const doc = withClip(d, 'rest', { bones: { head: { rotate: [{ time: 0, value: 0 }] } } });
		const before = poseAt(clone(doc), 'rest', 0);
		const res = ui.mirrorPose(doc, null, 'rest', 'l2r', 0, poser(doc, 'rest'));
		return !res.error && same(poseAt(doc, 'rest', 0), before, [...LEFT_NAMES, ...RIGHT_NAMES, ...CENTRE]) < 1e-3;
	},
	eased(ui) {
		const { d } = bodyDoc(ui);
		const doc = withClip(d, 'act', ACT);
		const was = clone(doc);
		const t = 0.6;
		ui.mirrorPose(doc, null, 'act', 'l2r', t, poser(doc, 'act'));
		const rot = (dd, u) => exactAt(dd.animations.act.bones.upper_arm_r.rotate, u);
		const game = Math.max(...[0.3, 0.45, 0.6, 0.75, 0.9].map((u) => Math.abs(poseAt(doc, 'act', u).findBone('upper_arm_r').rotation - d.bones.find((b) => b.name === 'upper_arm_r').rotation - rot(doc, u))));
		// each side of the new key is the old curve there, stretched to the new value (handles are values)
		const v0 = rot(was, 0.2);
		const v1 = rot(was, 1);
		const oldT = rot(was, t);
		const newT = rot(doc, t);
		let worst = 0;
		for (let i = 1; i < 20; i++) {
			const a = 0.2 + ((t - 0.2) * i) / 20;
			const b = t + ((1 - t) * i) / 20;
			worst = Math.max(worst, Math.abs(rot(doc, a) - (v0 + ((rot(was, a) - v0) * (newT - v0)) / (oldT - v0))));
			worst = Math.max(worst, Math.abs(rot(doc, b) - (v1 + ((rot(was, b) - v1) * (newT - v1)) / (oldT - v1))));
		}
		return worst < 1e-3 && game < 0.6 && Math.abs(poseAt(doc, 'act', 0.1).findBone('upper_arm_r').rotation - poseAt(was, 'act', 0.1).findBone('upper_arm_r').rotation) < 1e-9;
	},
	ikBlend(ui) {
		// the IK half on: its mix copied, and the right arm's FK keys the mirror of the left's FK pose
		const { d } = bodyDoc(ui);
		const doc = withClip(d, 'reach', REACH);
		const t = 0.5;
		const before = poseAt(clone(doc), 'reach', t);
		ui.mirrorPose(doc, null, 'reach', 'l2r', t, poser(doc, 'reach'));
		const after = poseAt(doc, 'reach', t);
		const mixOf = (s, n) => s.ikConstraints.find((c) => c.data.name === n).mix;
		const m = mixOf(before, 'arm_ik_l');
		return m > 0.05 && m < 0.95 && Math.abs(mixOf(after, 'arm_ik_r') - m) < 1e-4 && pairGap(after, before, PAIRS, rootLine(before)) < 3e-3;
	},
	ikBend(ui) {
		// at full mix, with the right IK bent the wrong way: the bend that mirrors the elbow is keyed
		const { d } = bodyDoc(ui);
		d.ik.find((c) => c.name === 'arm_ik_r').bendPositive = LEFT.ik[0].bendPositive;
		const doc = withClip(d, 'reach', REACH);
		const t = 0.9;
		const before = poseAt(clone(doc), 'reach', t);
		const res = ui.mirrorPose(doc, null, 'reach', 'l2r', t, poser(doc, 'reach'));
		const after = poseAt(doc, 'reach', t);
		return res.constraints.includes('ik arm_ik_r') && pairGap(after, before, PAIRS, rootLine(before)) < 1e-3;
	},
	carrier(ui) {
		// the right hand control follows a chest space at the playhead: keyed through its space bone
		const { d, ctl } = bodyDoc(ui);
		const s = poseAt(d, null, 0);
		const hc = s.findBone('hand_ik_r');
		const p = { x: hc.worldX, y: hc.worldY };
		s.findBone('chest').worldToLocal(p);
		d.bones.push({ name: 'hand_ik_r_chest', parent: 'chest', x: r4(p.x), y: r4(p.y), rotation: -90 });
		d.transform.push({ name: 'hand_ik_r_in_chest', order: d.ik.length + d.transform.length, bones: ['hand_ik_r'], target: 'hand_ik_r_chest', mixRotate: 0, mixX: 0, mixY: 0, mixScaleX: 0, mixScaleY: 0, mixShearY: 0 });
		const c = clone(ctl);
		c.limbs.arm_r.spaces = { chest: { bone: 'hand_ik_r_chest', constraint: 'hand_ik_r_in_chest' } };
		const clip = clone(REACH);
		clip.transform = { hand_ik_r_in_chest: [{ time: 0, mixRotate: 1, mixX: 1, mixY: 1, mixScaleX: 0, mixScaleY: 0, mixShearY: 0 }] };
		const doc = withClip(d, 'reach', clip);
		const t = 0.9;
		const before = poseAt(clone(doc), 'reach', t);
		ui.mirrorPose(doc, c, 'reach', 'l2r', t, poser(doc, 'reach'));
		const after = poseAt(doc, 'reach', t);
		const hl = reflect(W(before.findBone('hand_ik_l')), rootLine(before));
		const hr = after.findBone('hand_ik_r');
		return Math.hypot(hr.worldX - hl.x, hr.worldY - hl.y) < 1e-3 && !!doc.animations.reach.bones.hand_ik_r_chest;
	},
	locked(ui) {
		// the right upper arm may not turn: its children still land, and it is named as off
		const { d } = bodyDoc(ui);
		const doc = withClip(d, 'act', ACT);
		const t = 0.6;
		const before = poseAt(clone(doc), 'act', t);
		const res = ui.mirrorPose(doc, null, 'act', 'l2r', t, poser(doc, 'act'), { canKey: (n, ch) => !(n === 'upper_arm_r' && ch === 'rotate') });
		const after = poseAt(doc, 'act', t);
		return pairGap(after, before, PAIRS.filter(([, r]) => r !== 'upper_arm_r'), rootLine(before)) < 1e-3 && res.off.join() === 'upper_arm_r';
	},
	skip(ui) {
		const { d } = bodyDoc(ui);
		const doc = withClip(d, 'act', ACT);
		const res = ui.mirrorPose(doc, null, 'act', 'l2r', 0.6, poser(doc, 'act'), { skip: (n) => (n === 'hand_r' ? 'baked' : null) });
		return res.skipped.some((x) => x.name === 'hand_r') && !doc.animations.act.bones.hand_r && !res.keyed.includes('hand_r');
	},
	picker(ui) {
		const { d, ctl } = bodyDoc(ui);
		const Ws = ui.setupWorlds(d);
		const lay = ui.pickerAutoItems(d, ctl, (n) => ({ x: Ws.get(n).x, y: Ws.get(n).y }), 248);
		const shown = Object.entries(ctl.bones).filter(([, c]) => (c.role === 'control' || c.shape) && c.display !== 'stage').map(([n]) => n);
		const bones = lay.items.filter((it) => it.bone).map((it) => it.bone);
		const at = (k, v) => lay.items.find((it) => it[k] === v).at;
		const w = 248;
		const H = w * lay.aspect;
		const box = (it) => ({ w: Math.min(110, 16 + 5.4 * ((it.bone || it.limb || it.set).length + (it.limb ? 13 : 0))) / w, h: 16 / H });
		let overlap = false;
		for (let i = 0; i < lay.items.length; i++)
			for (let j = i + 1; j < lay.items.length; j++) {
				const a = lay.items[i];
				const b = lay.items[j];
				if (Math.abs(a.at[0] - b.at[0]) < (box(a).w + box(b).w) / 2 - 1e-6 && Math.abs(a.at[1] - b.at[1]) < (box(a).h + box(b).h) / 2 - 1e-6) overlap = true;
			}
		return bones.slice().sort().join() === shown.slice().sort().join() && !bones.includes('hips')
			&& at('bone', 'hand_ik_l')[0] > 0.5 && at('bone', 'hand_ik_r')[0] < 0.5 && at('bone', 'head')[1] < at('bone', 'hand_ik_l')[1]
			&& at('limb', 'arm_l')[1] > at('bone', 'hand_ik_l')[1] && at('set', 'hand_left')[1] > 0.9
			&& !overlap && lay.items.every((it) => it.at[0] - box(it).w / 2 >= -1e-6 && it.at[0] + box(it).w / 2 <= 1 + 1e-6 && it.at[1] - box(it).h / 2 >= -1e-6 && it.at[1] + box(it).h / 2 <= 1 + 1e-6) && lay.aspect >= 0.6 && lay.aspect <= 1.4;
	},
	pickerBox(ui) {
		const { d, ctl } = bodyDoc(ui);
		const Ws = ui.setupWorlds(d);
		const lay = ui.pickerAutoItems(d, ctl, (n) => ({ x: Ws.get(n).x, y: Ws.get(n).y }), 248);
		const right = ui.pickerItemsIn(lay.items, 0.52, 0, 1, 1).sort().join();
		const left = ui.pickerItemsIn(lay.items, 0.48, 1, 0, 0).sort().join();
		return right === 'elbow_pole_l,hand_ik_l,upper_arm_l' && left === 'elbow_pole_r,hand_ik_r,upper_arm_r';
	},
	face(ui) {
		const ch = (id, extra = {}) => ({ id, label: id, tip: '', min: -1, max: 1, rest: 0, drives: [{ bone: 'x', prop: 'x', per: 1 }], ...extra });
		const channels = [ch('jaw', { min: 0 }), ch('gaze_x'), ch('gaze_y'), ch('smile'), { ...ch('mouth'), shapes: { slot: 'm', jaw: 'jaw', rest: 'A', open: {}, talk: [] } }];
		const auto = ui.faceBoardItems(channels, 248);
		const boxes = auto.items.filter((it) => it.kind === 'box');
		const sliders = auto.items.filter((it) => it.kind === 'slider').map((it) => it.ch.id);
		const placed = ui.faceBoardItems(
			channels.map((c) => (c.id === 'gaze_x' ? { ...c, ui: { box: 'gaze', axis: 'x', at: [0.5, 0.3] } } : c.id === 'gaze_y' ? { ...c, ui: { box: 'gaze', axis: 'y' } } : c.id === 'jaw' ? { ...c, ui: { at: [0.5, 0.8], axis: 'y' } } : c)),
			248,
		);
		const pb = placed.items.find((it) => it.kind === 'box');
		const ps = placed.items.find((it) => it.kind === 'slider');
		return boxes.length === 1 && boxes[0].x.id === 'gaze_x' && boxes[0].y.id === 'gaze_y' && sliders.join() === 'jaw,smile'
			&& auto.items.every((it) => it.at.every((v) => v > 0 && v < 1))
			&& placed.items.length === 2 && pb.at.join() === '0.5,0.3' && ps.ch.id === 'jaw' && ps.axis === 'y';
	},
	graph(ui) {
		// constraint curves as the game plays them: an IK's mix and softness, six transform mixes, a physics mix
		const doc = {
			skeleton: { spine: '4.2.0' },
			bones: [{ name: 'root' }, { name: 'a', parent: 'root', length: 20 }, { name: 'b', parent: 'a', x: 20, length: 20 }, { name: 't', parent: 'root', x: 30, y: 10 }],
			ik: [{ name: 'ik', order: 0, bones: ['a', 'b'], target: 't' }],
			transform: [{ name: 'tc', order: 1, bones: ['t'], target: 'a' }],
			physics: [{ name: 'ph', order: 2, bone: 'b', rotate: 1 }],
			animations: {
				g: {
					ik: { ik: [{ time: 0, mix: 0, softness: 0, curve: [0.2, 0, 0.6, 1, 0.5, 0, 0.9, 8] }, { time: 1, mix: 1, softness: 8 }] },
					transform: {
						tc: [
							{ time: 0, mixRotate: 0, mixX: 0.2, mixY: 1, mixScaleX: 0.5, mixScaleY: 0, mixShearY: 1, curve: [0.1, 0, 0.9, 1, 0.4, 0.2, 0.6, 0.9, 0.8, 1, 0.9, 0, 0.3, 0.5, 0.4, 0.5, 0.2, 0, 0.3, 1, 0.5, 1, 0.6, 0] },
							{ time: 1, mixRotate: 1, mixX: 0.9, mixY: 0, mixScaleX: 0.5, mixScaleY: 1, mixShearY: 0 },
						],
					},
					physics: { ph: { mix: [{ time: 0, value: 0.2, curve: [0.5, 0.2, 0.5, 0.9] }, { time: 1, value: 0.9 }] } },
				},
			},
		};
		const a = doc.animations.g;
		const curves = [
			...ui.GRAPH_CON_CHANS.ik.map((c) => ({ ...c, keys: a.ik.ik, fields: ui.graphConFields('ik', 'ik'), live: (s) => s.ikConstraints[0][c.field] })),
			...ui.GRAPH_CON_CHANS.transform.map((c) => ({ ...c, keys: a.transform.tc, fields: ui.graphConFields('transform', 'transform'), live: (s) => s.transformConstraints[0][c.field] })),
			{ ...ui.GRAPH_CON_CHANS.physics.find((c) => c.ch === 'mix'), keys: a.physics.ph.mix, fields: ui.graphConFields('physics', 'mix'), live: (s) => s.physicsConstraints[0].mix },
		];
		let worst = 0;
		for (let i = 0; i <= 20; i++) {
			const t = i / 20;
			const s = poseAt(doc, 'g', t);
			for (const c of curves) worst = Math.max(worst, Math.abs(ui.graphValueAt(c, t) - c.live(s)));
		}
		// easing one transform mix (mixY, its third value) eases only that one, and the game plays it
		const eased = clone(doc);
		const keys = eased.animations.g.transform.tc;
		delete keys[0].curve;
		ui.setKeyCurveField(keys, ui.graphConFields('transform', 'transform'), 2, 0, 'easein');
		const lin = (v0, v1, t) => v0 + (v1 - v0) * t;
		let others = 0;
		let mixY = 0;
		for (let i = 1; i < 10; i++) {
			const t = i / 10;
			const tc = poseAt(eased, 'g', t).transformConstraints[0];
			others = Math.max(others, Math.abs(tc.mixRotate - lin(0, 1, t)), Math.abs(tc.mixX - lin(0.2, 0.9, t)), Math.abs(tc.mixShearY - lin(1, 0, t)));
			mixY = Math.max(mixY, Math.abs(tc.mixY - lin(1, 0, t)));
		}
		return worst < 1e-5 && curves.length === 9 && others < 1e-5 && mixY > 0.05 && Array.isArray(keys[0].curve) && keys[0].curve.length === 24;
	},
};

// --------------------------------------------------------------------------------------- the run
console.log('\nNames, pairs and the line');
check(GUARDS.names(UI), 'a side word swaps in its case: hand_ik_l ⇄ hand_ik_r, hand_ik_l_chest, L_eye, upperArmLeft, LEFT_wing, arm.l; hip_lr and leftover have no side');
check(GUARDS.pairs(UI), 'pairs come from the names; mirror.pairs overrides win (left → right), and a side bone with no other side is named');
check(GUARDS.line(UI), 'the line is the root’s x = 0 by default, or a chosen bone along its length');

console.log('\nMirror rig side (Setup)');
{
	const { d, res, ctl } = bodyDoc();
	console.log(`    made ${res.bones?.join(', ')}; slots ${res.slots?.join(', ')}; ${res.constraints?.join(', ')}`);
	check(GUARDS.sideBones(UI), 'every left bone gets a right one, at the exact mirror of its setup (engine-rig, 1e-4)');
	check(GUARDS.sideLeftAlone(UI), 'the left side is untouched: its bones and its weighted mesh, bone indices and all');
	check(GUARDS.sideImages(UI), 'the images draw mirrored where the game draws them: a turned, off-axis region, a scaled one, a weighted mesh vertex by vertex');
	check(GUARDS.sideSlots(UI), 'a new slot draws just above the one it mirrors, on the mirrored bone');
	check(GUARDS.sideConstraints(UI), 'the IK (its bend) and the transform (its offsets) solve the mirrored way at full mix, every order runs');
	check(GUARDS.sideControls(UI), 'its controls (the colour of their own side), limb, set, preset and picker buttons follow, in a sidecar C1 accepts');
	check(GUARDS.sideDrawOrder(UI), 'a clip that draws the arm behind the body still does, the new arm beside it — its draw-order key rewritten over the new slot list');
	check(GUARDS.sideZeroScale(UI), 'a bone hidden at setup by a zero scale (with an image and a child) is mirrored and keeps its zero scale');
	check(GUARDS.sideLimits(UI), 'a control’s limits are taken across (a turn [−130, −40] becomes [40, 130]), its shape’s offset and turn flipped, a new bone’s turn in −180…180');
	check(GUARDS.sideOnce(UI), 'a second build has nothing to make, and says so');
	const imp = importSpine42Json(clone(d));
	let strict = imp.issues.length === 0;
	try {
		readIrig(writeIrig(imp.doc));
	} catch {
		strict = false;
	}
	check(strict, `the built rig is plain 4.2 data: the irig import drops nothing, the strict reader takes it`);
	const stored = { ...ctl, rig: 'Body', irig: 'mark' };
	const renamed = RC.renameControls(stored, { bone: new Map([['hand_ik_r', 'hand_ctrl_r']]), ik: new Map(), transform: new Map(), path: new Map(), physics: new Map() });
	check(
		RC.fitControls(stored, d).dropped.length === 0 && renamed.picker.items.some((it) => it.bone === 'hand_ctrl_r') && renamed.limbs.arm_r.control === 'hand_ctrl_r',
		'its controls.json round-trips through C1: nothing dropped on read, a rename followed into the picker and the limb',
	);
	const twice = { ...stored, mirror: { pairs: { eye_l: 'eye_r', hand_l: 'eye_r' } } };
	const ghost = { ...stored, picker: { items: [{ limb: 'leg_l', at: [0.5, 0.5] }] } };
	check(
		RC.controlsDocProblems(twice).some((p) => /twice/.test(p)) && RC.controlsDocProblems(ghost).some((p) => /not one of the limbs/.test(p))
			&& RC.controlsDocProblems({ ...stored, mirror: { line: 'hips', pairs: { prop: 'prop' } } }).length === 0,
		'C1 refuses a bone in two mirror pairs and a picker button for a limb that is not there; a line and a centre pair pass',
	);
}

console.log('\nMirror pose (Animate)');
check(GUARDS.poseL2R(UI), 'L → R under a turned, unevenly scaled chest: each right bone drawn at its left’s mirror (1e-3), the left side and the centre unchanged at every time');
check(GUARDS.poseLine(UI), 'with the line along the chest, the mirror follows the chest as it turns');
check(GUARDS.poseR2L(UI), 'R → L the same, the right side unchanged');
check(GUARDS.swap(UI), 'swap: both sides exchanged and the centre bones under the line flipped; swapping again is the pose it started from');
check(GUARDS.rest(UI), 'on a hand-made, not quite symmetric right side the rest pose mirrors to the rest pose');
check(GUARDS.eased(UI), 'a key dropped inside an eased segment: each side of it is the old curve stretched to the new value, and before it nothing moves');
check(GUARDS.ikBlend(UI), 'with the IK half on, its mix is copied and the FK keys mirror the FK pose: the game draws the right arm at the mirror');
check(GUARDS.ikBend(UI), 'at full mix, a right IK bent the wrong way is keyed the bend that mirrors the elbow');
check(GUARDS.carrier(UI), 'a hand control following a chest space is keyed through its space bone, and lands on the mirror');
check(GUARDS.locked(UI), 'a locked turn: the bones under it still land, and the one it held is named as off');
check(GUARDS.skip(UI), 'a skipped bone (a 3D clip’s bake owns it) is left unkeyed and named');
check(GUARDS.poseLimit(UI), 'a limit holds what the mirror keys, and the bone it held is named as off');

console.log('\nThe picker and the face board');
check(GUARDS.picker(UI), 'the automatic layout: one button per control but a stage-only one, the character’s left on the board’s right, the head above the hand, the limb under its control, the set at the foot, none overlapping, each whole on the board');
check(GUARDS.pickerBox(UI), 'a box across either half selects exactly that side’s bone buttons');
check(GUARDS.face(UI), 'the face board: a gaze box from gaze_x / gaze_y and sliders, no mouth shapes; with `ui`, the channels’ own places');

console.log('\nConstraint curves in the graph editor');
check(GUARDS.graph(UI), 'an IK’s mix and softness, a transform’s six mixes and a physics mix draw what engine-rig plays (1e-5); easing one transform mix eases only it');

console.log('\nMutations, each must fail');
const MUTANTS = [
	['names', 'a side word’s case lost', ['w.text === w.text.toUpperCase() ? o.toUpperCase()', 'false ? o.toUpperCase()']],
	['names', 'camel-case words not split', ['!(/[a-z0-9]/.test(run[i - 1]) && /[A-Z]/.test(run[i]))', 'true']],
	['pairs', 'the overrides not read', ['for (const [l, r] of Object.entries((cdoc && cdoc.mirror && cdoc.mirror.pairs) || {}))', 'for (const [l, r] of [])']],
	['line', 'a bone’s line across its length', ['const vx = len > 1e-3 ? W.a : W.b, vy = len > 1e-3 ? W.c : W.d', 'const vx = W.b, vy = W.d']],
	['sideBones', 'the y axis not turned back', ['return { a: M.a, b: -M.b, c: M.c, d: -M.d, x: M.x, y: M.y };', 'return M;']],
	['sideLeftAlone', 'a new bone put before the others', ['doc.bones.push(bone);', 'doc.bones.splice(1, 0, bone);']],
	['sideImages', 'a weighted vertex left on its old bone', ['nv.push(index.get(mapB(name)),', 'nv.push(v[i],']],
	['sideImages', 'an image not flipped', ['} else rehomeAttachment(d, M);', '}']],
	['sideSlots', 'a new slot drawn on top of everything', ['doc.slots.splice(doc.slots.indexOf(s) + 1, 0, copy);', 'doc.slots.push(copy);']],
	['sideConstraints', 'the IK’s bend kept', ['copy.bendPositive = copy.bendPositive === false;', 'copy.bendPositive = copy.bendPositive !== false;']],
	['sideConstraints', 'the transform’s offsets kept', ['if (copy[f]) copy[f] = -copy[f];', 'if (copy[f]) copy[f] = copy[f];']],
	['sideControls', 'the left colour copied', ['delete c.colour;', 'void 0;']],
	['sideDrawOrder', 'draw-order keys left as they were', ['    fr.offsets = faceOrderOffsets(newNames,', '    if (false) fr.offsets = faceOrderOffsets(newNames,']],
	['sideZeroScale', 'a zero scale read as it is', ['const Ws = setupWorlds({ bones: doc.bones.map(sized) })', 'const Ws = setupWorlds(doc)']],
	['sideZeroScale', 'the zero scale not kept', ['for (const k of ["scaleX", "scaleY"]) if (src[k] === 0) bone[k] = 0;', '']],
	['sideLimits', 'the limits copied as they are', ['if (c.limits) for (const [f, r] of Object.entries(c.limits)) c.limits[f] = mirrorLimit(src.name, name, f, r);', '']],
	['sideLimits', 'the shape’s turn kept', ['if (c.turn) c.turn = -c.turn;', '']],
	['poseLimit', 'a limit ignored', ['clamp(n, "rotate", turn) - set.rotation', 'turn - set.rotation']],
	['sideControls', 'the limb not mirrored', ['if (!ik) continue;\n      let n = mirrorName(ln);', 'if (ik) continue;\n      let n = mirrorName(ln);']],
	['poseL2R', 'the shear an uneven parent gives not keyed', ['Math.abs(l.shearY - b.shearY) > 1e-3)', 'false)']],
	['poseLine', 'the line taken from the setup', ['Lf = mirrorLineOf(worldOf(f0.findBone(lineName)), len)', 'Lf = mirrorLineOf(Ws.get(lineName), len)']],
	['swap', 'the centre bones not flipped', ['if (dir === "swap") for (const n of boneDescendantsOf(doc, lineName))', 'if (false) for (const n of boneDescendantsOf(doc, lineName))']],
	['rest', 'the setup difference not kept', ['const C = affMul(Ci, Ws.get(dst));', 'const C = { a: 1, b: 0, c: 0, d: 1, x: 0, y: 0 };']],
	['eased', 'an eased segment not split', ['if (keys[i] && Math.abs(keys[i].time - t) >= LIMB_EPS && i > 0 && Array.isArray(keys[i - 1].curve)) insertKeyOnCurve(', 'if (false) insertKeyOnCurve(']],
	['ikBlend', 'the solved pose keyed as FK', ['want.set(dst, isControl(dst) ? drawn.get(dst) : affMul(mirrorWorld(worldOf(f0.findBone(src)), Lf), C));', 'want.set(dst, drawn.get(dst));']],
	['ikBlend', 'the mixes not copied', ['    keyConstraintOnCurve(doc, animName, x.kind, x.dst, t,', '    if (false) keyConstraintOnCurve(doc, animName, x.kind, x.dst, t,']],
	['ikBend', 'the bend not chosen', ['if (away(g2) < away(g)){', 'if (false){']],
	['carrier', 'the control keyed under its space', ['return l && !limbDataProblem(doc, l.limb) ? limbCarrierAt(doc, animName, l.limb, t) : n;', 'return n;']],
	['locked', 'no second pass under a held parent', ['for (let pass = 0; pass < 8; pass++){', 'for (let pass = 0; pass < 0; pass++){']],
	['skip', 'a skipped bone keyed', ['if (why) skipped.push({ name: dst, why }); else plan.set(dst, src);', 'plan.set(dst, src);']],
	['picker', 'overlapping buttons left', ['for (let pass = 0; pass < 40; pass++){', 'for (let pass = 0; pass < 0; pass++){']],
	['picker', 'a stage-only control on the board', ['&& c.display !== "stage";', ';']],
	['picker', 'a button cut by the board’s edge', ['const inX = (v, i) => Math.min(1 - box[i].w / 2, Math.max(box[i].w / 2, v))', 'const inX = (v, i) => Math.min(0.96, Math.max(0.04, v))']],
	['picker', 'the board upside down', ['((top + foot) / 2 - (p.y - cy) * scale) / H', '((top + foot) / 2 + (p.y - cy) * scale) / H']],
	['pickerBox', 'a box read one way round only', ['const [ax, bx] = x0 < x1 ? [x0, x1] : [x1, x0]', 'const [ax, bx] = [x0, x1]']],
	['face', 'a gaze pair as two sliders', ['const ui = placed ? c.ui : pair ? { box: c.id.slice(0, -2), axis: c.id.slice(-1) } : {};', 'const ui = placed ? c.ui : {};']],
	['face', 'a channel’s own place ignored', ['if (placed){ const at = out.filter((it) => it.at); return { items: at, aspect: Math.min(4, faceBoardAspect(at, w)) }; }', '']],
	['graph', 'an IK’s values out of their curve order', ['(kind === "ik" ? ["mix", "softness"] :', '(kind === "ik" ? ["softness", "mix"] :']],
	['graph', 'a transform’s mixes out of their curve order', ['kind === "transform" ? TC_MIXES :', 'kind === "transform" ? [...TC_MIXES].reverse() :']],
];
for (const [id, what, swap] of MUTANTS) {
	let red;
	let threw = '';
	try {
		red = !GUARDS[id](sandbox([swap]));
	} catch (e) {
		// A mutant whose text is no longer in the shipped code plants nothing: that is a stale check.
		red = !String(e.message).startsWith('mutant:');
		threw = ` (threw: ${String(e.message).slice(0, 60)})`;
	}
	check(red, `${id} ✗ under "${what}"${threw}`);
}

console.log(`\n${failed === 0 ? '✅ PASS' : '✗ FAIL'} — ${checks - failed}/${checks} checks`);
process.exit(failed === 0 ? 0 : 1);
