// Rig controls phase K2 — FK / IK switches and spaces (docs/design/rig-controls.md §4.3, §4.5, §4.6):
// the limb functions pulled out of the SHIPPED view.html, every key they write played back by the REAL
// engine-rig (SkeletonJson → Skeleton → AnimationState) as a game plays it, and the sidecar they keep
// checked by the COMMITTED `vendor/rigger-controls.js` (C1's schema, fit and renames).
//
// On a synthetic chest that bobs and turns, a two-bone arm, a hand control under the root, a pole on
// the chest and a prop that slides and turns. Asserted:
//  - a limb is made from a 1- or 2-bone IK whose target is outside its chain; a pole or a space's bone
//    must not move with the limb;
//  - ＋ Space adds a space bone where the control is and a transform at mix 0, solved before the IK:
//    the setup pose and every FK clip play exactly as before;
//  - ⇄ To IK at a key: the mix steps 0 → 1 with no jump, the wrist then holds the control as the chest
//    moves, the bend is the one nearest the FK elbow, the pole is keyed on that side, and a switch
//    between keys holds until the next one;
//  - ⇄ To IK over a range: the IK pose equals the FK pose at every key of what moves either side;
//  - ⇄ To FK at a key and over a range: the FK bones keyed at the solved pose, no jump, no spin;
//  - ⇄ Space chest → prop → world → own keys: no jump in place or turn, and between switches the
//    control rides its space rigidly while the wrist follows it;
//  - the gizmo on a control keys the space bone of the space it follows;
//  - the pole keys the bend: across the line it flips, and writes nothing when the IK is off or the
//    arm is straight; before the IK's first key the setup still holds up to it;
//  - eased (bezier) curves: a switch inside one splits it, so what played before plays on; a stretch IK
//    handed back as FK is matched in scale and in the child offset the two-bone solve drops at every
//    key; a space under a reflected prop keeps the control's turn;
//  - the dopesheet puts space bones and switch keys under their control;
//  - the sidecar is one C1 accepts, round-trips, follows renames; the irig is plain 4.2 data.
// Every guard is mutation-checked: a planted mutant of the shipped code must turn its check red.
//   node tools/rigger-spike/rig-limbs.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { RIG_CORE } from './rig.mjs';

const RIG = await import(RIG_CORE);
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, AnimationState } = RIG;
const { AnimationStateData, Physics, importSpine42Json, writeIrig, readIrig, exportSpine42Json } =
	RIG;

let checks = 0;
let failed = 0;
const check = (ok, msg) => {
	checks++;
	if (!ok) failed++;
	console.log(`  ${ok ? '✅' : '✗'} ${msg}`);
	return ok;
};
const clone = (o) => JSON.parse(JSON.stringify(o));
const ATLAS = 'page.png\nsize:4,4\nfilter:Linear,Linear\n';
const stub = {
	getImage: () => ({ width: 1, height: 1 }),
	setFilters() {},
	setWraps() {},
	dispose() {},
};
function load(doc) {
	const atlas = new TextureAtlas(ATLAS);
	for (const p of atlas.pages) p.setTexture(stub);
	const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(clone(doc));
	return {
		data,
		skel: new Skeleton(data),
		state: new AnimationState(new AnimationStateData(data)),
	};
}
/** `doc` posed by `anim` at `t` (setup when no animation), as a game plays it. */
function poseAt(doc, anim, t) {
	const { skel, state } = load(doc);
	skel.setToSetupPose();
	if (anim) {
		state.setAnimation(0, anim, false);
		state.update(t);
		state.apply(skel);
	}
	skel.updateWorldTransform(Physics.update);
	return skel;
}
// What the limb functions measure through, as the page's `poseClipAt` does: a key time is stored as a
// float32 (fround(1.2) > 1.2), so a pose asked for at a key's time is taken at that float32.
const poser = (doc, anim) => (t) => poseAt(doc, anim, Math.max(t, Math.fround(t)));
const at = (s, n) => s.findBone(n);
const dist = (a, b) => Math.hypot(a.worldX - b.worldX, a.worldY - b.worldY);
const tipOf = (b) => ({
	worldX: b.worldX + b.data.length * b.a,
	worldY: b.worldY + b.data.length * b.c,
});
const angDiff = (a, b) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);
const turnOf = (b) => (Math.atan2(b.c, b.a) * 180) / Math.PI;
const r4 = (v) => Math.round(v * 1e4) / 1e4;

// ------------------------------------------------------- C1's code, as the page loads it (committed)
const BUNDLE = readFileSync(
	new URL('../../apps/launcher-api/static/rigger/vendor/rigger-controls.js', import.meta.url),
	'utf8',
);
const RC = (() => {
	const ctx = { structuredClone };
	vm.createContext(ctx);
	vm.runInContext(`${BUNDLE}\n;globalThis.__rc = RiggerControls;`, ctx);
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
const STUBS = new Set(['markDirty', 'rebuildFromRawDoc', 'buildInspector', 'historyStep']);
const ENTRY = [
	'limbProblem',
	'limbForIk',
	'limbBoneProblem',
	'limbsOfBone',
	'limbOfIk',
	'limbSpaceAt',
	'limbCarrierAt',
	'limbMatchTimes',
	'keyBoneAtWorld',
	'switchLimb',
	'switchLimbSpace',
	'keyBendFromPole',
	'orderLimbLayer',
	'addLimbSpace',
	'groupLimbTracks',
	'limbCarrierBone',
	'constraintOrderClashes',
	'sampleChannel',
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
		pulled.push(src);
		for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\b(\s*\()?/g)) {
			const t = TOP.get(m[1]);
			if (t && (t.kind === 'const' || m[2]) && !seen.has(m[1]) && !STUBS.has(m[1])) q.push(m[1]);
		}
	}
	let src = pulled.join('\n');
	for (const [from, to] of mutate) {
		if (!src.includes(from)) throw new Error(`mutant: "${from}" is not in the pulled source`);
		src = src.replace(from, to);
	}
	const ui = {
		RIG,
		rawDoc: null,
		skeleton: null,
		controlsDoc: null,
		curAnim: null,
		animTime: 0,
		markDirty() {},
		historyStep: (fn) => fn(),
	};
	vm.createContext(ui);
	vm.runInContext(`${src}\n;Object.assign(globalThis, { ${ENTRY.join(', ')} });`, ui, {
		filename: 'view.html#rig-limbs',
	});
	return ui;
}
const UI = sandbox();

// --------------------------------------------------------------------------------- a synthetic rig
// y up. A chest that bobs and turns, a two-bone arm, a hand control under the root on the wrist, a
// pole on the chest off the elbow, and a prop that slides and turns.
function baseDoc() {
	const d = {
		skeleton: { spine: '4.2.0' },
		bones: [
			{ name: 'root' },
			{ name: 'chest', parent: 'root', y: 100, rotation: 90, length: 60 },
			{ name: 'upper_arm', parent: 'chest', x: 50, y: -20, rotation: 150, length: 60 },
			{ name: 'lower_arm', parent: 'upper_arm', x: 60, rotation: 40, length: 50 },
			{ name: 'hand', parent: 'lower_arm', x: 50, length: 18 },
			{ name: 'head', parent: 'chest', x: 60, length: 30 },
			{ name: 'prop', parent: 'root', x: 160, y: 60 },
			{ name: 'hand_ctrl', parent: 'root' },
			{ name: 'elbow_pole', parent: 'chest' },
		],
		ik: [],
		transform: [],
		animations: {},
	};
	const s = poseAt(d, null, 0);
	const hand = at(s, 'hand');
	const elbow = at(s, 'lower_arm');
	const shoulder = at(s, 'upper_arm');
	const c = d.bones.find((b) => b.name === 'hand_ctrl');
	c.x = r4(hand.worldX);
	c.y = r4(hand.worldY);
	// The pole 60 out from the elbow, away from the shoulder → wrist line, in the chest's frame.
	const mx = (shoulder.worldX + hand.worldX) / 2;
	const my = (shoulder.worldY + hand.worldY) / 2;
	const ox = elbow.worldX - mx;
	const oy = elbow.worldY - my;
	const k = 60 / Math.hypot(ox, oy);
	const chest = at(s, 'chest');
	const p = { x: elbow.worldX + ox * k, y: elbow.worldY + oy * k };
	chest.worldToLocal(p);
	const pole = d.bones.find((b) => b.name === 'elbow_pole');
	pole.x = r4(p.x);
	pole.y = r4(p.y);
	// The arm's IK, off, bent the way the setup arm is.
	const pick = (bend) => {
		const t = clone(d);
		t.ik = [
			{
				name: 'arm_ik',
				order: 0,
				bones: ['upper_arm', 'lower_arm'],
				target: 'hand_ctrl',
				mix: 1,
				bendPositive: bend,
			},
		];
		return dist(at(poseAt(t, null, 0), 'lower_arm'), elbow);
	};
	d.ik = [
		{
			name: 'arm_ik',
			order: 0,
			bones: ['upper_arm', 'lower_arm'],
			target: 'hand_ctrl',
			mix: 0,
			bendPositive: pick(true) <= pick(false),
		},
	];
	d.animations = { fk: clone(FK_CLIP) };
	return d;
}
const FK_CLIP = {
	bones: {
		chest: {
			translate: [
				{ time: 0, y: 0 },
				{ time: 1, y: 30 },
				{ time: 2, y: -10 },
				{ time: 3, y: 0 },
			],
			rotate: [
				{ time: 0, value: 0 },
				{ time: 1.5, value: 12 },
				{ time: 3, value: 0 },
			],
		},
		upper_arm: {
			rotate: [
				{ time: 0, value: 0 },
				{ time: 1.5, value: -70 },
				{ time: 3, value: 10 },
			],
		},
		lower_arm: {
			rotate: [
				{ time: 0, value: 0 },
				{ time: 1.5, value: 50 },
				{ time: 3, value: -20 },
			],
		},
		prop: {
			translate: [
				{ time: 0, x: 0 },
				{ time: 3, x: -80, y: 40 },
			],
			rotate: [
				{ time: 0, value: 0 },
				{ time: 3, value: 40 },
			],
		},
	},
};
const ARM = ['upper_arm', 'lower_arm', 'hand'];
const LIMB = () => ({
	ik: 'arm_ik',
	fk: ['upper_arm', 'lower_arm'],
	control: 'hand_ctrl',
	pole: 'elbow_pole',
});
const setupOf = (doc) => {
	const { skel } = load(doc);
	skel.setToSetupPose();
	skel.updateWorldTransform(Physics.none);
	return skel;
};
/** The rig with the limb's three spaces added by the shipped ＋ Space, in `ui`. */
function spacedRig(ui) {
	const doc = baseDoc();
	const limb = LIMB();
	ui.rawDoc = doc;
	limb.spaces = {};
	for (const [space, parent] of [
		['chest', 'chest'],
		['world', 'root'],
		['prop', 'prop'],
	]) {
		const res = ui.addLimbSpace(limb, space, parent, setupOf(doc));
		if (res.error) throw new Error(`＋ Space ${space}: ${res.error}`);
		limb.spaces[space] = { bone: res.bone, constraint: res.constraint };
	}
	return { doc, limb };
}
// The worst move of `names` (origins and tips) between two poses.
const worst = (p, q, names) =>
	Math.max(
		...names.map((n) => Math.max(dist(at(p, n), at(q, n)), dist(tipOf(at(p, n)), tipOf(at(q, n))))),
	);
// Across a step at `t`: the worst move of `names` between t − 0.1 ms and t + 0.1 ms.
const popAt = (doc, anim, t, names) =>
	worst(poseAt(doc, anim, t - 1e-4), poseAt(doc, anim, t + 1e-4), names);
const turnPopAt = (doc, anim, t, name) =>
	angDiff(
		turnOf(at(poseAt(doc, anim, t - 1e-4), name)),
		turnOf(at(poseAt(doc, anim, t + 1e-4), name)),
	);
const ikMix = (doc, anim, t) =>
	poseAt(doc, anim, t).ikConstraints.find((c) => c.data.name === 'arm_ik').mix;
const sideOf = (a, b, p) =>
	Math.sign(
		(b.worldX - a.worldX) * (p.worldY - a.worldY) - (b.worldY - a.worldY) * (p.worldX - a.worldX),
	);
const near = (a, b, e) => Math.abs(a - b) <= e;

// Key the pole of `doc` at `t` mirrored across the shoulder → control line (the other side).
function mirrorPole(ui, doc, t) {
	const p = poseAt(doc, 'fk', t + 1e-5);
	const a = at(p, 'upper_arm');
	const b = at(p, 'hand_ctrl');
	const q = at(p, 'elbow_pole');
	const lx = b.worldX - a.worldX;
	const ly = b.worldY - a.worldY;
	const u = ((q.worldX - a.worldX) * lx + (q.worldY - a.worldY) * ly) / (lx * lx + ly * ly);
	const fx = a.worldX + lx * u;
	const fy = a.worldY + ly * u;
	ui.keyBoneAtWorld(doc, 'fk', p, 'elbow_pole', t, 2 * fx - q.worldX, 2 * fy - q.worldY);
}

const GUARDS = {};
const guard = (id, fn) => {
	GUARDS[id] = fn;
	return fn(UI, true);
};
const say = (on, ok, msg) => (on ? check(ok, msg) : ok);

console.log('\n=== a limb, its pole and its spaces ===');
guard('limb', (ui, s = false) => {
	const doc = baseDoc();
	let ok = say(s, ui.limbProblem(doc, 'arm_ik') === null, 'the arm IK can be a limb');
	ok &&= say(
		s,
		JSON.stringify(ui.limbForIk(doc, 'arm_ik')) ===
			JSON.stringify({ ik: 'arm_ik', fk: ['upper_arm', 'lower_arm'], control: 'hand_ctrl' }),
		'its chain is the FK side and its target the control',
	);
	const inChain = clone(doc);
	inChain.ik[0].target = 'hand';
	ok &&= say(
		s,
		/moves with the chain/.test(ui.limbProblem(inChain, 'arm_ik') || ''),
		'refused: a target that moves with the chain',
	);
	const three = clone(doc);
	three.ik[0].bones = ['chest', 'upper_arm', 'lower_arm'];
	ok &&= say(s, !!ui.limbProblem(three, 'arm_ik'), 'refused: a 3-bone IK');
	const limb = LIMB();
	ok &&= say(
		s,
		!!ui.limbBoneProblem(doc, limb, 'lower_arm') && !!ui.limbBoneProblem(doc, limb, 'hand'),
		'a pole or space bone cannot move with the chain',
	);
	ok &&= say(
		s,
		ui.limbBoneProblem(doc, limb, 'prop') === null &&
			ui.limbBoneProblem(doc, limb, 'chest') === null,
		'the chest and a prop can',
	);
	const retargeted = clone(doc);
	retargeted.ik[0].target = 'prop';
	const res = ui.switchLimb(retargeted, 'fk', limb, 'ik', 1, null, poser(retargeted, 'fk'));
	ok &&= say(
		s,
		/now reaches "prop"/.test(res.error || '') && !retargeted.animations.fk.ik,
		'a limb whose IK now reaches another bone is refused, writing nothing',
	);
	return ok;
});

guard('spaces', (ui, s = false) => {
	const before = baseDoc();
	const { doc, limb } = spacedRig(ui);
	const a = setupOf(before);
	const b = setupOf(doc);
	const setupMove = worst(a, b, [...ARM, 'hand_ctrl', 'chest', 'prop', 'head']);
	let ok = say(
		s,
		setupMove < 1e-9,
		`＋ Space ×3 leaves the setup pose alone (${setupMove.toExponential(1)} units)`,
	);
	let fkMove = 0;
	for (let t = 0; t <= 3; t += 0.1)
		fkMove = Math.max(
			fkMove,
			worst(poseAt(before, 'fk', t), poseAt(doc, 'fk', t), [...ARM, 'hand_ctrl']),
		);
	ok &&= say(
		s,
		fkMove < 1e-9,
		`and the FK clip plays as before (${fkMove.toExponential(1)} units)`,
	);
	let off = 0;
	for (const sp of Object.values(limb.spaces)) {
		off = Math.max(
			off,
			dist(at(b, sp.bone), at(b, 'hand_ctrl')),
			angDiff(turnOf(at(b, sp.bone)), turnOf(at(b, 'hand_ctrl'))),
		);
	}
	ok &&= say(s, off < 1e-3, `each space bone sits where the control is (${off.toExponential(1)})`);
	const parents = Object.fromEntries(
		Object.entries(limb.spaces).map(([k, sp]) => [
			k,
			doc.bones.find((x) => x.name === sp.bone).parent,
		]),
	);
	ok &&= say(
		s,
		parents.chest === 'chest' && parents.world === 'root' && parents.prop === 'prop',
		'under the chest, the root and the prop',
	);
	const tcs = Object.values(limb.spaces).map((sp) =>
		doc.transform.find((c) => c.name === sp.constraint),
	);
	ok &&= say(
		s,
		tcs.every(
			(c, i) =>
				c &&
				c.bones.length === 1 &&
				c.bones[0] === 'hand_ctrl' &&
				c.target === Object.values(limb.spaces)[i].bone &&
				!c.local &&
				!c.relative &&
				['mixRotate', 'mixX', 'mixY', 'mixScaleX', 'mixScaleY', 'mixShearY'].every(
					(f) => c[f] === 0,
				),
		),
		'each a world, absolute transform from the control to its space bone, at mix 0',
	);
	const { skel } = load(doc);
	const cache = skel._updateCache;
	const ikAt = cache.indexOf(skel.ikConstraints[0]);
	ok &&= say(
		s,
		ikAt >= 0 &&
			skel.transformConstraints.every((c) => cache.indexOf(c) >= 0 && cache.indexOf(c) < ikAt),
		'engine-rig solves every space before the IK',
	);
	ok &&= say(s, ui.constraintOrderClashes(doc).length === 0, 'no order clash');
	const n = doc.bones.length;
	const again = ui.addLimbSpace(limb, 'chest', 'chest', setupOf(doc));
	const inArm = ui.addLimbSpace(limb, 'elbow', 'lower_arm', setupOf(doc));
	ok &&= say(
		s,
		!!again.error && !!inArm.error && doc.bones.length === n,
		'refused, writing nothing: a space twice, or one in the arm',
	);
	// A rig that already carries a free space bone for the control (a template's) has it reused; one
	// something hangs on is not.
	const t = baseDoc();
	t.bones.push(
		{ name: 'hand_ctrl_chest', parent: 'chest', x: 3, y: 4 },
		{ name: 'hand_ctrl_world', parent: 'root' },
	);
	t.slots = [{ name: 'busy', bone: 'hand_ctrl_world' }];
	ui.rawDoc = t;
	const l = LIMB();
	const chest = ui.addLimbSpace(l, 'chest', 'chest', setupOf(t));
	const world = ui.addLimbSpace(l, 'world', 'root', setupOf(t));
	ok &&= say(
		s,
		chest.bone === 'hand_ctrl_chest' &&
			world.bone !== 'hand_ctrl_world' &&
			t.bones.length === baseDoc().bones.length + 3,
		`a free hand_ctrl_chest is reused; a hand_ctrl_world with a slot on it is not (${world.bone} is made)`,
	);
	return ok;
});

console.log('\n=== ⇄ To IK ===');
const T_IK = 1.2;
guard('toIk', (ui, s = false) => {
	const { doc, limb } = spacedRig(ui);
	mirrorPole(ui, doc, T_IK); // the pole on the wrong side: the switch must move it
	const plain = clone(doc);
	const res = ui.switchLimb(doc, 'fk', limb, 'ik', T_IK, null, poser(doc, 'fk'));
	let ok = say(
		s,
		!res.error && res.times.length === 1 && res.times[0] === T_IK,
		'switches at the playhead',
	);
	ok &&= say(
		s,
		ikMix(doc, 'fk', T_IK - 5e-4) === 0 &&
			ikMix(doc, 'fk', T_IK - 1e-4) === 0 &&
			ikMix(doc, 'fk', T_IK + 1e-4) === 1,
		'the mix steps 0 → 1 at the switch (it holds 0 right up to it)',
	);
	let held = 0;
	for (const t of [0.3, 0.8, 1.1])
		held = Math.max(held, worst(poseAt(plain, 'fk', t), poseAt(doc, 'fk', t), ARM));
	ok &&= say(
		s,
		held < 1e-9,
		`before it the clip plays FK as it did (${held.toExponential(1)} units)`,
	);
	const pop = popAt(doc, 'fk', T_IK, ARM);
	ok &&= say(s, pop < 0.05, `no jump across the switch (${pop.toFixed(4)} units)`);
	let reach = 0;
	for (const t of [1.6, 2.2, 2.9]) {
		const p = poseAt(doc, 'fk', t);
		reach = Math.max(reach, dist(tipOf(at(p, 'lower_arm')), at(p, 'hand_ctrl')));
	}
	ok &&= say(
		s,
		reach < 1e-3,
		`then the wrist holds the control while the chest moves (${reach.toExponential(1)} units)`,
	);
	const flipped = clone(doc);
	const key = flipped.animations.fk.ik.arm_ik.find((k) => Math.abs(k.time - T_IK) < 1e-4);
	key.bendPositive = !key.bendPositive;
	const other = popAt(flipped, 'fk', T_IK, ARM);
	ok &&= say(
		s,
		other > 10,
		`the other bend would flip the elbow (${other.toFixed(1)} units): the nearest was keyed`,
	);
	const p = poseAt(doc, 'fk', T_IK + 1e-4);
	ok &&= say(
		s,
		sideOf(at(p, 'upper_arm'), at(p, 'hand_ctrl'), at(p, 'elbow_pole')) ===
			sideOf(at(p, 'upper_arm'), at(p, 'hand_ctrl'), at(p, 'lower_arm')),
		'the pole is keyed on the elbow’s side',
	);
	// A switch between keys holds until the next one: an FK stretch keyed later keeps its own start.
	const { doc: d2, limb: l2 } = spacedRig(ui);
	d2.animations.fk.ik = {
		arm_ik: [
			{
				time: 2.6,
				mix: 0,
				softness: 0,
				bendPositive: d2.ik[0].bendPositive,
				compress: false,
				stretch: false,
			},
		],
	};
	ui.switchLimb(d2, 'fk', l2, 'ik', T_IK, null, poser(d2, 'fk'));
	ok &&= say(
		s,
		ikMix(d2, 'fk', 2.0) === 1 && ikMix(d2, 'fk', 2.7) === 0,
		'a switch before a later key holds until it',
	);
	// A blend keyed before the switch still plays up to it.
	const { doc: d3, limb: l3 } = spacedRig(ui);
	const k = (time, mix) => ({
		time,
		mix,
		softness: 0,
		bendPositive: d3.ik[0].bendPositive,
		compress: false,
		stretch: false,
	});
	d3.animations.fk.ik = { arm_ik: [k(0.4, 0), k(2.6, 1)] };
	ui.switchLimb(d3, 'fk', l3, 'ik', 1.6, null, poser(d3, 'fk'));
	const ramp = ikMix(d3, 'fk', 1.0);
	ok &&= say(
		s,
		near(ramp, 0.6 / 2.2, 1e-4) && ikMix(d3, 'fk', 2.2) === 1,
		`a mix blend keyed before the switch still plays up to it (${ramp.toFixed(4)} at 1.0 s)`,
	);
	return ok;
});

guard('toIkRange', (ui, s = false) => {
	const { doc, limb } = spacedRig(ui);
	const plain = clone(doc);
	const res = ui.switchLimb(doc, 'fk', limb, 'ik', 0.6, 2.4, poser(doc, 'fk'));
	const want = [0.6, 1, 1.5, 2, 2.4];
	let ok = say(
		s,
		!res.error && want.every((t) => res.times.includes(t)),
		`matched at every key in range, the chest's too (${res.times.join(', ')})`,
	);
	let off = 0;
	for (const t of want)
		off = Math.max(off, worst(poseAt(plain, 'fk', t + 1e-6), poseAt(doc, 'fk', t + 1e-6), ARM));
	ok &&= say(
		s,
		off < 2e-3,
		`at each of them the IK pose is the FK pose (${off.toExponential(1)} units)`,
	);
	let between = 0;
	for (let t = 0.65; t < 2.4; t += 0.05)
		between = Math.max(between, worst(poseAt(plain, 'fk', t), poseAt(doc, 'fk', t), ARM));
	ok &&= say(
		s,
		between < 10,
		`and between them it stays near (${between.toFixed(2)} units at worst)`,
	);
	const pop = popAt(doc, 'fk', 0.6, ARM);
	ok &&= say(s, pop < 0.05, `no jump where it switches (${pop.toFixed(4)} units)`);
	return ok;
});

console.log('\n=== ⇄ To FK ===');
const T_FK = 2.2;
guard('toFk', (ui, s = false) => {
	const { doc, limb } = spacedRig(ui);
	ui.switchLimb(doc, 'fk', limb, 'ik', T_IK, null, poser(doc, 'fk'));
	const ik = clone(doc);
	const res = ui.switchLimb(doc, 'fk', limb, 'fk', T_FK, null, poser(doc, 'fk'));
	let ok = say(s, !res.error, 'switches back at the playhead');
	ok &&= say(
		s,
		ikMix(doc, 'fk', 2.0) === 1 && ikMix(doc, 'fk', T_FK + 1e-4) === 0,
		'the mix holds 1, then steps to 0',
	);
	const pop = popAt(doc, 'fk', T_FK, ARM);
	ok &&= say(
		s,
		pop < 0.05,
		`no jump across it: the FK bones are keyed where the IK put them (${pop.toFixed(4)} units)`,
	);
	const unmatched = popAt(ik, 'fk', T_FK, ARM);
	const ikOff = clone(ik);
	ikOff.animations.fk.ik.arm_ik.push({
		...ikOff.animations.fk.ik.arm_ik.at(-1),
		time: T_FK,
		mix: 0,
	});
	ikOff.animations.fk.ik.arm_ik.at(-2).curve = 'stepped';
	const jump = popAt(ikOff, 'fk', T_FK, ARM);
	ok &&= say(
		s,
		unmatched < 0.05 && jump > 5,
		`without the FK keys the arm would jump (${jump.toFixed(1)} units)`,
	);
	// An arm keyed only at 0 and 3: the FK run before the IK plays as it did after the switch back.
	const { doc: d2, limb: l2 } = spacedRig(ui);
	for (const n of ['upper_arm', 'lower_arm']) d2.animations.fk.bones[n].rotate.splice(1, 1);
	const fkOnly = clone(d2);
	ui.switchLimb(d2, 'fk', l2, 'ik', T_IK, null, poser(d2, 'fk'));
	ui.switchLimb(d2, 'fk', l2, 'fk', T_FK, null, poser(d2, 'fk'));
	let kept = 0;
	for (const t of [0.3, 0.7, 1.1])
		kept = Math.max(kept, worst(poseAt(fkOnly, 'fk', t), poseAt(d2, 'fk', t), ARM));
	ok &&= say(
		s,
		kept < 1e-6 && popAt(d2, 'fk', T_FK, ARM) < 0.05,
		`and the FK run before the IK plays as it did (${kept.toExponential(1)} units)`,
	);
	return ok;
});

guard('toFkRange', (ui, s = false) => {
	const { doc, limb } = spacedRig(ui);
	ui.switchLimb(doc, 'fk', limb, 'ik', 0, null, poser(doc, 'fk'));
	// Clean up in IK: the hand moved by its control, off the FK arc.
	const c = doc.animations.fk.bones.hand_ctrl.translate;
	const base = c[0];
	c.push(
		{ time: 1, x: r4(base.x + 20), y: r4(base.y - 30) },
		{ time: 2, x: r4(base.x - 25), y: r4(base.y + 10) },
	);
	const ik = clone(doc);
	const res = ui.switchLimb(doc, 'fk', limb, 'fk', 0, 3, poser(doc, 'fk'));
	const want = [0, 1, 1.5, 2, 3];
	let ok = say(
		s,
		!res.error && want.every((t) => res.times.includes(t)),
		`matched at every key of the clip (${res.times.join(', ')})`,
	);
	let off = 0;
	for (const t of want)
		off = Math.max(
			off,
			worst(poseAt(ik, 'fk', Math.min(3, t + 1e-6)), poseAt(doc, 'fk', Math.min(3, t + 1e-6)), ARM),
		);
	ok &&= say(s, off < 2e-3, `the FK pose is the IK pose at each (${off.toExponential(1)} units)`);
	let between = 0;
	for (let t = 0.05; t < 3; t += 0.05)
		between = Math.max(between, worst(poseAt(ik, 'fk', t), poseAt(doc, 'fk', t), ARM));
	ok &&= say(
		s,
		between < 25,
		`and turns the short way between them (${between.toFixed(2)} units at worst)`,
	);
	ok &&= say(
		s,
		[0.5, 1.7, 2.9].every((t) => ikMix(doc, 'fk', t) === 0),
		'the IK is off over the clip',
	);
	return ok;
});

console.log('\n=== ⇄ Space: chest → prop → world → own keys ===');
const SW = [
	[0.8, 'chest'],
	[1.4, 'prop'],
	[2.0, 'world'],
	[2.6, null],
];
function spaceRun(ui) {
	const { doc, limb } = spacedRig(ui);
	ui.switchLimb(doc, 'fk', limb, 'ik', 0.2, null, poser(doc, 'fk'));
	const out = [];
	for (const [t, to] of SW) out.push(ui.switchLimbSpace(doc, 'fk', limb, to, t, poser(doc, 'fk')));
	return { doc, limb, out };
}
// Bone `name` in the frame of bone `frame` (null: the world) at `t`: { x, y, r }.
const relTo = (doc, t, name, frame) => {
	const p = poseAt(doc, 'fk', t);
	const b = at(p, name);
	if (!frame) return { x: b.worldX, y: b.worldY, r: turnOf(b) };
	const f = at(p, frame);
	const l = f.worldToLocal({ x: b.worldX, y: b.worldY });
	return { x: l.x, y: l.y, r: turnOf(b) - turnOf(f) };
};
const drift = (doc, from, to, name, frame) => {
	const ref = relTo(doc, from + 1e-4, name, frame);
	let d = 0;
	let spin = 0;
	for (let t = from + 0.05; t < to - 0.01; t += 0.05) {
		const r = relTo(doc, t, name, frame);
		d = Math.max(d, Math.hypot(r.x - ref.x, r.y - ref.y));
		spin = Math.max(spin, angDiff(r.r, ref.r));
	}
	return { d, spin };
};
guard('space', (ui, s = false) => {
	const { doc, limb, out } = spaceRun(ui);
	let ok = say(
		s,
		out.every((r) => !r.error),
		`four switches (${out.map((r) => r.carrier).join(' → ')})`,
	);
	const { doc: ikOnly, limb: l0 } = spacedRig(ui);
	ui.switchLimb(ikOnly, 'fk', l0, 'ik', 0.2, null, poser(ikOnly, 'fk'));
	let run = 0;
	for (const t of [0.3, 0.5, 0.75])
		run = Math.max(
			run,
			worst(poseAt(ikOnly, 'fk', t), poseAt(doc, 'fk', t), ['hand_ctrl', ...ARM]),
		);
	ok &&= say(
		s,
		run < 1e-6,
		`the run before the first switch plays as it did, though its control is keyed again later (${run.toExponential(1)} units)`,
	);
	let pop = 0;
	let turn = 0;
	for (const [t] of SW) {
		pop = Math.max(pop, popAt(doc, 'fk', t, ['hand_ctrl', ...ARM]));
		turn = Math.max(turn, turnPopAt(doc, 'fk', t, 'hand_ctrl'));
	}
	ok &&= say(
		s,
		pop < 0.05 && turn < 0.05,
		`no jump at any switch (${pop.toFixed(4)} units, ${turn.toFixed(4)}°)`,
	);
	const frames = [
		[0.8, 1.4, 'chest'],
		[1.4, 2.0, 'prop'],
		[2.0, 2.6, null],
		[2.6, 3.0, null],
	];
	let worstDrift = 0;
	let worstSpin = 0;
	for (const [a, b, f] of frames) {
		const r = drift(doc, a, b, 'hand_ctrl', f);
		worstDrift = Math.max(worstDrift, r.d);
		worstSpin = Math.max(worstSpin, r.spin);
	}
	ok &&= say(
		s,
		worstDrift < 1e-3 && worstSpin < 1e-3,
		`between switches the control rides the chest, the prop, the world, then holds its own key (drift ${worstDrift.toExponential(1)} units, ${worstSpin.toExponential(1)}°)`,
	);
	const rides = drift(doc, 1.4, 2.0, 'hand_ctrl', null).d;
	ok &&= say(s, rides > 5, `(on the prop it really moves: ${rides.toFixed(1)} units in the world)`);
	// Wherever the arm can reach it (the prop carries it out of reach for a while), the wrist is on it.
	let follow = 0;
	let reached = 0;
	for (let t = 1.45; t < 2.0; t += 0.05) {
		const p = poseAt(doc, 'fk', t);
		if (dist(at(p, 'upper_arm'), at(p, 'hand_ctrl')) > 109.9) continue;
		reached++;
		follow = Math.max(follow, dist(tipOf(at(p, 'lower_arm')), at(p, 'hand_ctrl')));
	}
	ok &&= say(
		s,
		reached > 0 && follow < 1e-3,
		`the wrist follows the control in prop space where it can reach it (${follow.toExponential(1)} units, ${reached} frames)`,
	);
	const spaces = [0.5, 1.0, 1.7, 2.3, 2.8].map((t) => ui.limbSpaceAt(doc, 'fk', limb, t));
	ok &&= say(
		s,
		JSON.stringify(spaces) === JSON.stringify([null, 'chest', 'prop', 'world', null]),
		`the space it follows: ${spaces.map((x) => x ?? 'own keys').join(', ')}`,
	);
	const twice = ui.switchLimbSpace(doc, 'fk', limb, 'prop', 1.7, poser(doc, 'fk'));
	const unknown = ui.switchLimbSpace(doc, 'fk', limb, 'sword', 1.7, poser(doc, 'fk'));
	const own = ui.switchLimbSpace(doc, 'fk', limb, null, 2.8, poser(doc, 'fk'));
	ok &&= say(
		s,
		!!twice.error && !!unknown.error && !!own.error,
		'refused: the space it already follows, one it has not, or its own keys where it follows them',
	);
	// Each switch held the carrier's old curve with a STEPPED key just before it.
	const holds = [];
	for (const [t, to] of SW) {
		const carrier = to == null ? 'hand_ctrl' : limb.spaces[to].bone;
		const ch = doc.animations.fk.bones[carrier] || {};
		for (const keys of [ch.translate || [], ch.rotate || []])
			holds.push(keys.find((k) => Math.abs(k.time - (t - 1e-3)) < 1e-6));
	}
	ok &&= say(
		s,
		holds.every((k) => k && k.curve === 'stepped'),
		'each switch holds the old curve with a stepped key a millisecond before',
	);
	// A control whose rotation is locked: back to its own keys keys its place only.
	{
		const { doc: d, limb: l } = spacedRig(ui);
		ui.switchLimb(d, 'fk', l, 'ik', 0.2, null, poser(d, 'fk'));
		ui.switchLimbSpace(d, 'fk', l, 'prop', 1.4, poser(d, 'fk'));
		ui.switchLimbSpace(d, 'fk', l, null, 2.6, poser(d, 'fk'), false);
		const rot = (d.animations.fk.bones.hand_ctrl.rotate || []).some(
			(k) => Math.abs(k.time - 2.6) < 1e-4,
		);
		ok &&= say(s, !rot, 'with the control’s turn locked, back to its own keys keys no turn');
	}
	return ok;
});

guard('carrier', (ui, s = false) => {
	const { doc, limb } = spaceRun(ui);
	ui.rawDoc = doc;
	ui.controlsDoc = { controls: 1, rig: 'hero', limbs: { arm: limb } };
	ui.curAnim = 'fk';
	const carrierAt = (t) => {
		ui.animTime = t;
		ui.skeleton = poseAt(doc, 'fk', t);
		return ui.limbCarrierBone(ui.skeleton.findBone('hand_ctrl')).data.name;
	};
	const names = [1.0, 1.7, 2.3, 2.8].map(carrierAt);
	let ok = say(
		s,
		JSON.stringify(names) ===
			JSON.stringify(['hand_ctrl_chest', 'hand_ctrl_prop', 'hand_ctrl_world', 'hand_ctrl']),
		`the gizmo on the control keys ${names.join(', ')}`,
	);
	// What the drag then does: the carrier moved 15, −10 in the world moves the control so.
	const t = 1.7;
	const moved = (name) => {
		const d = clone(doc);
		const p = poseAt(d, 'fk', t);
		const c = at(p, 'hand_ctrl');
		ui.keyBoneAtWorld(d, 'fk', p, name, t, c.worldX + 15, c.worldY - 10);
		const q = at(poseAt(d, 'fk', t + 1e-6), 'hand_ctrl');
		return Math.hypot(q.worldX - c.worldX - 15, q.worldY - c.worldY + 10);
	};
	const viaCarrier = moved(names[1]);
	const viaControl = moved('hand_ctrl');
	ok &&= say(
		s,
		viaCarrier < 1e-3 && viaControl > 10,
		`keying the space bone moves the control (${viaCarrier.toExponential(1)} off); keying the control itself would not (${viaControl.toFixed(1)} off)`,
	);
	const half = clone(doc);
	half.animations.fk.transform[limb.spaces.prop.constraint].push({
		time: 2.9,
		mixRotate: 0.5,
		mixX: 0.5,
		mixY: 0.5,
		mixScaleX: 0,
		mixScaleY: 0,
		mixShearY: 0,
	});
	ok &&= say(
		s,
		ui.limbSpaceAt(half, 'fk', limb, 2.95) === null,
		'a space at half mix is not one the control follows',
	);
	return ok;
});

console.log('\n=== the pole keys the bend ===');
guard('pole', (ui, s = false) => {
	const { doc, limb } = spacedRig(ui);
	ui.switchLimb(doc, 'fk', limb, 'ik', T_IK, null, poser(doc, 'fk'));
	const track = () => JSON.stringify(doc.animations.fk.ik);
	const bend0 = doc.animations.fk.ik.arm_ik.at(-1).bendPositive;
	let before = track();
	let ok = say(
		s,
		ui.keyBendFromPole(doc, 'fk', limb, T_IK, poser(doc, 'fk')) === bend0 && track() === before,
		'after ⇄ To IK the pole already says the bend: nothing to key',
	);
	// Move the pole across the shoulder → target line.
	const mirror = (t) => mirrorPole(ui, doc, t);
	const elbowSide = (t) => {
		const p = poseAt(doc, 'fk', t);
		return sideOf(at(p, 'upper_arm'), at(p, 'hand_ctrl'), at(p, 'lower_arm'));
	};
	const poleSide = (t) => {
		const p = poseAt(doc, 'fk', t);
		return sideOf(at(p, 'upper_arm'), at(p, 'hand_ctrl'), at(p, 'elbow_pole'));
	};
	const sideBefore = elbowSide(1.95);
	mirror(2.0);
	const flip = ui.keyBendFromPole(doc, 'fk', limb, 2.0, poser(doc, 'fk'));
	ok &&= say(
		s,
		flip === !bend0 &&
			elbowSide(2.0 + 1e-4) === poleSide(2.0 + 1e-4) &&
			elbowSide(1.95) === sideBefore,
		'across the line it keys the other bend: the elbow follows the pole there, not before (stepped)',
	);
	mirror(2.6);
	const back = ui.keyBendFromPole(doc, 'fk', limb, 2.6, poser(doc, 'fk'));
	ok &&= say(s, back === bend0 && elbowSide(2.6 + 1e-4) === poleSide(2.6 + 1e-4), 'and back again');
	before = track();
	ok &&= say(
		s,
		ui.keyBendFromPole(doc, 'fk', limb, 0.5, poser(doc, 'fk')) === null && track() === before,
		'with the IK off it keys nothing',
	);
	// The IK at half mix, the pole across: the other bend cannot bring the elbow over — nothing is keyed.
	{
		const { doc: d, limb: l } = spacedRig(ui);
		ui.switchLimb(d, 'fk', l, 'ik', T_IK, null, poser(d, 'fk'));
		const keys = d.animations.fk.ik.arm_ik;
		keys.push({
			time: 0.3,
			mix: 0.5,
			softness: 0,
			bendPositive: d.ik[0].bendPositive,
			compress: false,
			stretch: false,
		});
		keys.sort((a, b) => a.time - b.time);
		for (const k of keys) k.curve = 'stepped';
		mirrorPole(ui, d, 0.3);
		const was = JSON.stringify(d.animations.fk.ik);
		ok &&= say(
			s,
			ui.keyBendFromPole(d, 'fk', l, 0.3, poser(d, 'fk')) === null &&
				JSON.stringify(d.animations.fk.ik) === was,
			'at half mix, where the other bend cannot bring the elbow across, it keys nothing',
		);
	}
	// Setup mix 1, the clip's first IK key at 2 s: a bend keyed before it keeps the setup up to it.
	{
		const { doc: d, limb: l } = spacedRig(ui);
		d.ik[0].mix = 1;
		d.animations.fk.ik = {
			arm_ik: [
				{
					time: 2,
					mix: 0,
					softness: 0,
					bendPositive: d.ik[0].bendPositive,
					compress: false,
					stretch: false,
				},
			],
		};
		mirrorPole(ui, d, 0.15);
		const was = [0.5, 1.0, 1.9].map((t) => ikMix(d, 'fk', t));
		const bent = ui.keyBendFromPole(d, 'fk', l, 0.15, poser(d, 'fk'));
		const now = [0.5, 1.0, 1.9].map((t) => ikMix(d, 'fk', t));
		ok &&= say(
			s,
			bent === !d.ik[0].bendPositive && was.every((m) => m === 1) && now.every((m) => m === 1),
			`a bend keyed before the IK’s first key keeps the setup up to it (mix ${now.join(', ')})`,
		);
	}
	// A straight arm: the control out of reach, the pole across — either bend draws the same.
	const p = poseAt(doc, 'fk', 2.8 + 1e-5);
	const c = at(p, 'hand_ctrl');
	ui.keyBoneAtWorld(doc, 'fk', p, 'hand_ctrl', 2.8, c.worldX - 400, c.worldY - 300);
	mirror(2.8);
	before = track();
	ok &&= say(
		s,
		ui.keyBendFromPole(doc, 'fk', limb, 2.8, poser(doc, 'fk')) === null && track() === before,
		'with the arm straight it keys nothing',
	);
	return ok;
});

console.log('\n=== eased curves, stretch, a reflected space ===');
// Bezier handles are absolute (time, value): a key put into an eased segment must split the cubic.
const fr = (t) => Math.max(t, Math.fround(t));
guard('eased', (ui, s = false) => {
	// On the curve itself (the page's exact sampler, `sampleChannel`) the split changes nothing; in the
	// game each half is sampled at ten points of its own, so the shorter one draws it a little differently.
	const curveGap = (a, b, fields, times) =>
		Math.max(
			...times.map((t) =>
				Math.max(
					...fields.map((f) =>
						Math.abs(ui.sampleChannel(a, t, fields)[f] - ui.sampleChannel(b, t, fields)[f]),
					),
				),
			),
		);
	let ok = true;
	{
		// an eased IK mix blend, then ⇄ To IK in its middle
		const { doc, limb } = spacedRig(ui);
		const k = (time, mix, curve) => ({
			time,
			mix,
			softness: 0,
			bendPositive: doc.ik[0].bendPositive,
			compress: false,
			stretch: false,
			...(curve ? { curve } : {}),
		});
		doc.animations.fk.ik = { arm_ik: [k(0.4, 0, [1.2, 0, 1.8, 1, 1.2, 0, 1.8, 0]), k(2.6, 1)] };
		const plain = clone(doc);
		ui.switchLimb(doc, 'fk', limb, 'ik', 1.6, null, poser(doc, 'fk'));
		const times = [0.6, 1.0, 1.3, 1.55, 1.59];
		const exact = curveGap(
			plain.animations.fk.ik.arm_ik,
			doc.animations.fk.ik.arm_ik,
			['mix', 'softness'],
			times,
		);
		let dm = 0;
		let dp = 0;
		for (const t of times) {
			dm = Math.max(dm, Math.abs(ikMix(plain, 'fk', t) - ikMix(doc, 'fk', t)));
			dp = Math.max(dp, worst(poseAt(plain, 'fk', t), poseAt(doc, 'fk', t), ARM));
		}
		ok &&= say(
			s,
			exact < 1e-5 && dm < 5e-3 && dp < 0.3,
			`an eased IK mix blend plays on up to the switch: the curve split exactly (${exact.toExponential(1)}), in the game within its ten-point sampling (mix ${dm.toExponential(1)}, arm ${dp.toFixed(3)} units)`,
		);
	}
	{
		// an eased space blend into the chest, then ⇄ to the prop in its middle
		const { doc, limb } = spacedRig(ui);
		ui.switchLimb(doc, 'fk', limb, 'ik', 0.1, null, poser(doc, 'fk'));
		const up = [0.6, 0, 1.0, 1];
		const flat = [0.6, 0, 1.0, 0];
		const mixes = (v, curve) => ({
			mixRotate: v,
			mixX: v,
			mixY: v,
			mixScaleX: 0,
			mixScaleY: 0,
			mixShearY: 0,
			...(curve ? { curve } : {}),
		});
		doc.animations.fk.transform = {
			[limb.spaces.chest.constraint]: [
				{ time: 0.2, ...mixes(0, [...up, ...up, ...up, ...flat, ...flat, ...flat]) },
				{ time: 1.2, ...mixes(1) },
			],
		};
		const plain = clone(doc);
		ui.switchLimbSpace(doc, 'fk', limb, 'prop', 0.9, poser(doc, 'fk'));
		const times = [0.3, 0.5, 0.7, 0.85, 0.895];
		const tc = limb.spaces.chest.constraint;
		const exact = curveGap(
			plain.animations.fk.transform[tc],
			doc.animations.fk.transform[tc],
			['mixRotate', 'mixX', 'mixY', 'mixScaleX', 'mixScaleY', 'mixShearY'],
			times,
		);
		let d = 0;
		for (const t of times)
			d = Math.max(d, worst(poseAt(plain, 'fk', t), poseAt(doc, 'fk', t), ['hand_ctrl', ...ARM]));
		ok &&= say(
			s,
			exact < 1e-5 && d < 0.3,
			`an eased space blend plays on up to the switch: the curve split exactly (${exact.toExponential(1)}), in the game ${d.toFixed(3)} units`,
		);
	}
	{
		// eased FK keys, an IK window from 0.5 to 1.3 inside them: the FK run before it is kept
		const { doc, limb } = spacedRig(ui);
		doc.animations.fk.bones.upper_arm.rotate = [
			{ time: 0, value: 0, curve: [0.5, 0, 1.0, -70] },
			{ time: 1.5, value: -70 },
			{ time: 3, value: 10 },
		];
		doc.animations.fk.bones.lower_arm.rotate = [
			{ time: 0, value: 0, curve: [0.4, 0, 1.1, 50] },
			{ time: 1.5, value: 50 },
			{ time: 3, value: -20 },
		];
		const plain = clone(doc);
		ui.switchLimb(doc, 'fk', limb, 'ik', 0.5, null, poser(doc, 'fk'));
		ui.switchLimb(doc, 'fk', limb, 'fk', 1.3, null, poser(doc, 'fk'));
		const times = [0.1, 0.25, 0.4, 0.49];
		const exact = Math.max(
			...['upper_arm', 'lower_arm'].map((n) =>
				curveGap(
					plain.animations.fk.bones[n].rotate,
					doc.animations.fk.bones[n].rotate,
					['value'],
					times,
				),
			),
		);
		let d = 0;
		for (const t of times)
			d = Math.max(d, worst(poseAt(plain, 'fk', t), poseAt(doc, 'fk', t), ARM));
		const back = popAt(doc, 'fk', 1.3, ARM);
		ok &&= say(
			s,
			exact < 1e-3 && d < 0.6 && back < 0.05,
			`eased FK keys before an IK window play on: the curve split exactly (${exact.toExponential(1)}°), in the game within its ten-point sampling (${d.toFixed(3)} units); the switch back does not jump (${back.toFixed(4)})`,
		);
	}
	return ok;
});

guard('stretch', (ui, s = false) => {
	const { doc, limb } = spacedRig(ui);
	doc.ik[0].stretch = true;
	doc.bones.find((b) => b.name === 'lower_arm').y = 8; // a child offset the stretching solve drops
	ui.switchLimb(doc, 'fk', limb, 'ik', 0, null, poser(doc, 'fk'));
	for (const k of doc.animations.fk.ik.arm_ik) k.stretch = true;
	// the control pulled out of reach at 1 s only
	const p = poseAt(doc, 'fk', 1);
	const sh = at(p, 'upper_arm');
	const c = at(p, 'hand_ctrl');
	const dx = c.worldX - sh.worldX;
	const dy = c.worldY - sh.worldY;
	const k = 160 / Math.hypot(dx, dy);
	const ctl = doc.bones.find((b) => b.name === 'hand_ctrl');
	const keys = doc.animations.fk.bones.hand_ctrl.translate;
	keys.push(
		{ time: 1, x: r4(sh.worldX + dx * k - ctl.x), y: r4(sh.worldY + dy * k - ctl.y) },
		{ time: 1.6, x: keys[0].x, y: keys[0].y },
	);
	const ik = clone(doc);
	const stretched = at(poseAt(ik, 'fk', 1), 'upper_arm').ascaleX;
	const res = ui.switchLimb(doc, 'fk', limb, 'fk', 0, 3, poser(doc, 'fk'));
	let off = 0;
	for (const t of res.times)
		off = Math.max(off, worst(poseAt(ik, 'fk', fr(t)), poseAt(doc, 'fk', fr(t)), ARM));
	return say(
		s,
		stretched > 1.05 && off < 2e-3,
		`a stretch IK handed back as FK over the clip matches it at every key, stretched at 1 s (${stretched.toFixed(3)}) or not (${off.toExponential(1)} units)`,
	);
});

guard('reflect', (ui, s = false) => {
	const { doc, limb } = spacedRig(ui);
	doc.bones.find((b) => b.name === 'prop').scaleX = -1;
	ui.switchLimb(doc, 'fk', limb, 'ik', 0.2, null, poser(doc, 'fk'));
	const r = ui.switchLimbSpace(doc, 'fk', limb, 'prop', 1.4, poser(doc, 'fk'));
	const turn = turnPopAt(doc, 'fk', 1.4, 'hand_ctrl');
	const pop = popAt(doc, 'fk', 1.4, ['hand_ctrl']);
	return say(
		s,
		!r.error && turn < 0.05 && pop < 0.05,
		`under a mirrored prop the control keeps its place and turn (${pop.toFixed(4)} units, ${turn.toFixed(4)}°)`,
	);
});

console.log('\n=== the dopesheet ===');
guard('group', (ui, s = false) => {
	const { limb } = spacedRig(ui);
	const cdoc = { limbs: { arm: limb } };
	const rows = [
		{ kind: 'bone', name: 'chest' },
		{ kind: 'bone', name: 'hand_ctrl_prop' },
		{ kind: 'bone', name: 'upper_arm' },
		{ kind: 'ik', name: 'arm_ik' },
		{ kind: 'transform', name: 'hand_ctrl_in_prop' },
		{ kind: 'bone', name: 'hand_ctrl' },
		{ kind: 'slot', name: 'body' },
	];
	const label = (r) => (r.under ? '↳' : '') + r.kind + ':' + r.name;
	const got = ui.groupLimbTracks(rows, cdoc).map(label).join(' ');
	const want =
		'bone:chest bone:upper_arm bone:hand_ctrl ↳bone:hand_ctrl_prop ↳ik:arm_ik ↳transform:hand_ctrl_in_prop slot:body';
	let ok = say(s, got === want, `space bones and switch keys under their control: ${got}`);
	const headless = ui
		.groupLimbTracks(
			rows.filter((r) => r.name !== 'hand_ctrl'),
			cdoc,
		)
		.map(label)
		.join(' ');
	ok &&= say(
		s,
		headless ===
			'bone:chest bone:hand_ctrl ↳bone:hand_ctrl_prop ↳ik:arm_ik ↳transform:hand_ctrl_in_prop bone:upper_arm slot:body',
		`a control with no keys gets a row where its group starts: ${headless}`,
	);
	ok &&= say(
		s,
		ui.groupLimbTracks(rows, null) === rows,
		'a rig with no limbs keeps its rows as they are',
	);
	return ok;
});

console.log('\n=== what is saved ===');
{
	const { doc, limb } = spaceRun(UI);
	UI.switchLimb(doc, 'fk', limb, 'fk', 2.9, null, poser(doc, 'fk'));
	const sidecar = {
		controls: 1,
		rig: 'hero',
		bones: {
			hand_ctrl: { role: 'control', shape: 'square' },
			elbow_pole: { role: 'control', shape: 'diamond', size: 8 },
			...Object.fromEntries(Object.values(limb.spaces).map((sp) => [sp.bone, { role: 'helper' }])),
		},
		limbs: { arm_ik: limb },
	};
	const checked = RC.checkedControls(clone(sidecar), 'hero', doc);
	check(
		checked.problems.length === 0,
		`C1 accepts the limb, its pole and spaces (${checked.problems.join('; ') || 'no problems'})`,
	);
	check(
		JSON.stringify(JSON.parse(JSON.stringify(checked.doc))) === JSON.stringify(checked.doc),
		'and it round-trips through JSON',
	);
	const fit = RC.fitControls(clone(sidecar), doc);
	check(
		fit.dropped.length === 0 && JSON.stringify(fit.doc.limbs) === JSON.stringify(sidecar.limbs),
		'C1’s lenient read keeps it whole on the rig it was saved with',
	);
	const renames = {
		bone: new Map([[limb.spaces.prop.bone, 'prop_space']]),
		ik: new Map(),
		transform: new Map(),
		path: new Map(),
		physics: new Map(),
	};
	const renamed = RC.renameControls(clone(sidecar), renames);
	check(renamed.limbs.arm_ik.spaces.prop.bone === 'prop_space', 'a renamed space bone is followed');
	const gone = clone(doc);
	gone.bones = gone.bones.filter((b) => b.name !== limb.spaces.prop.bone);
	gone.transform = gone.transform.filter((c) => c.name !== limb.spaces.prop.constraint);
	delete gone.animations.fk.bones[limb.spaces.prop.bone];
	delete gone.animations.fk.transform[limb.spaces.prop.constraint];
	const dropped = RC.fitControls(clone(sidecar), gone).doc.limbs.arm_ik;
	check(
		!!dropped && !dropped.spaces.prop && !!dropped.spaces.chest,
		'a deleted space goes alone, the limb stays',
	);
	const imp = importSpine42Json(clone(doc));
	check(
		imp.issues.length === 0,
		`the switched rig is plain 4.2 data: the irig import drops nothing (${imp.issues.length} issues)`,
	);
	let strict = true;
	try {
		readIrig(writeIrig(imp.doc));
	} catch {
		strict = false;
	}
	check(strict, 'and the strict irig reader takes it');
	const back = exportSpine42Json(imp.doc);
	let same = 0;
	for (let t = 0; t <= 3; t += 0.1)
		same = Math.max(
			same,
			worst(poseAt(doc, 'fk', t), poseAt(back, 'fk', t), [...ARM, 'hand_ctrl']),
		);
	check(same < 1e-6, `and plays the same once written as irig (${same.toExponential(1)} units)`);
}

// -------------------------------------------------------------------- mutants: each must turn red
console.log('\n=== mutants of the shipped code: each must fail its check ===');
const MUTANTS = [
	[
		'limb',
		'a target in the chain accepted',
		[
			'if (boneLineage(doc, c.target).some((b) => c.bones.includes(b))) return "its target moves with the chain";',
			'',
		],
	],
	[
		'limb',
		'a pole in the limb accepted',
		[
			'const hit = [...(limb.fk || []), limb.control].find((n) => n && line.includes(n));',
			'const hit = null;',
		],
	],
	[
		'spaces',
		'the space solved after the IK',
		['orderLimbLayer(rawDoc, Object.assign(', 'void (rawDoc, Object.assign('],
	],
	[
		'spaces',
		'a space switched on at setup',
		[
			'{ bones: [limb.control], target: bone }, SPACE_MIXES(0)',
			'{ bones: [limb.control], target: bone }, SPACE_MIXES(1)',
		],
	],
	[
		'spaces',
		'a ready space bone not reused',
		[
			'ready && ready.parent === parentName && freeSpaceBone(rawDoc, base) ? base :',
			'false ? base :',
		],
	],
	[
		'spaces',
		'a used bone taken as a space bone',
		['|| (doc.slots || []).some((s) => s.bone === name)', ''],
	],
	[
		'spaces',
		'a space bone at its parent’s origin',
		['parentName, worldOf(ctl), setup', 'parentName, setup.findBone(parentName), setup'],
	],
	[
		'toIk',
		'the farther bend keyed',
		['if (!best || d < best.d) best = { b, d };', 'if (!best || d > best.d) best = { b, d };'],
	],
	[
		'toIk',
		'the control not keyed on the wrist',
		[
			'keyBoneAtWorld(doc, animName, m.s, limbCarrierAt(doc, animName, limb, m.t), m.t, m.wrist.x, m.wrist.y, undefined, first);',
			'void 0;',
		],
	],
	[
		'toIk',
		'the mix ramps up to the switch',
		[
			'insertKeyOnCurve(keys, hold, curvedOf(kind), constraintSetupValues(kind, c)).curve = "stepped";',
			'insertKeyOnCurve(keys, hold, curvedOf(kind), constraintSetupValues(kind, c));',
		],
	],
	[
		'toIk',
		'a blend keyed before the switch cut',
		['key[f] = roundN(v1 + (v2 - v1) * u, 6);', 'key[f] = roundN(v1, 6);'],
	],
	[
		'toIk',
		'a switch that does not hold until the next key',
		[
			'if (keys.some((x) => x.time > t + LIMB_EPS)) k.curve = "stepped"; else delete k.curve;',
			'delete k.curve;',
		],
	],
	['toIk', 'the pole not keyed', ['if (limb.pole) keyPoleAt(', 'if (false) keyPoleAt(']],
	[
		'toIkRange',
		'the bones above the limb not matched',
		['for (const x of boneLineage(doc, n)) bones.add(x);', 'bones.add(n);'],
	],
	['toFk', 'the FK bones not keyed', ['upsertBoneKey(cb.rotate, m.t, { value: v });', 'void v;']],
	[
		'toFk',
		'the FK bones keyed at their own turn',
		['turn: b.arotation - b.data.rotation', 'turn: b.rotation - b.data.rotation'],
	],
	[
		'toFk',
		'the FK run before the IK reshaped',
		['if (first) holdBeforeSwitch(cb.rotate, m.t, { value: 0 });', ''],
	],
	[
		'toFkRange',
		'the turn keyed the long way',
		[
			'const v = roundN(ref + wrapDeg(b.turn - ref), 4);',
			'const v = roundN(b.turn + (last.has(b.name) ? 360 : 0), 4);',
		],
	],
	[
		'space',
		'the run before the switch reshaped',
		['if (hold) holdBeforeSwitch(cb.translate, t, { x: 0, y: 0 });', ''],
	],
	[
		'space',
		'the new space bone not keyed',
		[
			'keyBoneAtWorld(doc, animName, s, carrier, t, c.worldX, c.worldY, to != null || keepTurn ? boneWorldAngle(c) : undefined, true);',
			'void carrier;',
		],
	],
	[
		'space',
		'the control’s turn not kept',
		['to != null || keepTurn ? boneWorldAngle(c) : undefined', 'undefined'],
	],
	[
		'space',
		'the space it left kept on',
		['if (name !== to && mixOf(sp) < 1e-6) continue;', 'if (name !== to) continue;'],
	],
	[
		'carrier',
		'the gizmo keys the control',
		[
			'return (l && skeleton.findBone(limbCarrierAt(rawDoc, curAnim, l.limb, animTime))) || b;',
			'return b;',
		],
	],
	[
		'carrier',
		'a half-mixed space followed',
		[
			'Math.min(at.values.mixRotate, at.values.mixX, at.values.mixY) >= 0.999',
			'Math.min(at.values.mixRotate, at.values.mixX, at.values.mixY) >= 0.4',
		],
	],
	[
		'pole',
		'the bend keyed off the pole’s side',
		[
			'if (side(bonePoint(pose(t).findBone(ik.bones[1]))) === want) return !at.values.bendPositive;',
			'if (side(bonePoint(pose(t).findBone(ik.bones[1]))) !== want) return !at.values.bendPositive;',
		],
	],
	[
		'pole',
		'a bend it could not change left keyed',
		['if (had) a.ik[ik.name] = had;', 'if (false) a.ik[ik.name] = had;'],
	],
	[
		'pole',
		'a bend keyed when the pole already says it',
		['if (elbow === want) return at.values.bendPositive;', ''],
	],
	[
		'pole',
		'a straight arm read as bent',
		['return Math.abs(d) < 1e-3 * L ? 0 : Math.sign(d);', 'return Math.sign(d);'],
	],
	[
		'limb',
		'a retargeted IK switched as the limb',
		['if (ik.target !== limb.control) return', 'if (false) return'],
	],
	[
		'space',
		'its own keys switched to where it follows them',
		[
			'if (to == null && Object.values(spaces).every((sp) => mixOf(sp) < 1e-6)) return',
			'if (false) return',
		],
	],
	[
		'space',
		'a hold that ramps',
		[
			'insertKeyOnCurve(keys, at, Object.keys(setup), setup).curve = "stepped";',
			'insertKeyOnCurve(keys, at, Object.keys(setup), setup);',
		],
	],
	['space', 'a locked turn keyed', ['to != null || keepTurn ?', 'true ?']],
	[
		'pole',
		'a key before the first one ramps from the setup',
		['if (!prev){ if (next) key.curve = "stepped"; }', 'if (!prev){}'],
	],
	[
		'eased',
		'an eased segment not split',
		['if (eased && [0, 1, 2, 3].every((n) => typeof before[c + n] === "number")){', 'if (false){'],
	],
	[
		'stretch',
		'scale keyed only where it stretched',
		['if (keyed(b.name, "stretched")){', 'if (b.stretched){'],
	],
	[
		'stretch',
		'the dropped child offset not keyed',
		['if (keyed(b.name, "moved")){', 'if (false){'],
	],
	[
		'reflect',
		'a mirrored parent read as turned',
		['k = p.a * p.d - p.b * p.c < 0 ? -1 : 1;', 'k = 1;'],
	],
	[
		'group',
		'the group not moved under its control',
		['    if (t.kind === "bone" && members.has(t.name)) place(t.name);\n', '\n'],
	],
	[
		'group',
		'no row for a control without keys',
		['out.push({ kind: "bone", name: c }); place(c);', 'place(c);'],
	],
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
