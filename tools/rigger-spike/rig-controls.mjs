// The rig controls proof (docs/design/rig-controls.md §7): what an animator's control layer needs from
// the 4.2 format, played by the REAL engine-rig (SkeletonJson → Skeleton → AnimationState, as a game
// plays it). Nothing here changes the runtime; every pose below is ordinary irig data.
//
// Asserted:
//  - ORDER. engine-rig runs ONE constraint per `order` value and none past the count, so a duplicate
//    order silently drops a constraint. On the repo's `W` symbol (path constraint `shake` at order 0,
//    transform `wild_clock2` at 1), ＋ Add IK's `order: ik.length` (0) drops `shake` and moves the
//    bones it drives, and ＋ Add transform's `order: transform.length` (1) leaves the NEW constraint
//    inactive. The next free order across every kind keeps both running.
//  - SETUP MIX 0. A rig carrying an IK at setup mix 0 plays every FK clip exactly as the rig without
//    it, and a crossfade from an IK clip back to an FK clip ends on the FK pose: templates can ship
//    IK without changing a starter clip.
//  - FK → IK MATCH. Keying the IK target at the FK wrist and the bend sign nearest the FK elbow, with
//    a stepped mix 0 → 1, switches without a pop; the other bend sign flips the elbow.
//  - IK → FK MATCH. Keying the chain's FK rotations at the solved pose, with a stepped mix 1 → 0,
//    switches without a pop.
//  - SPACE SWITCH. A hand control following the chest, then a prop, through one transform
//    constraint per space onto a helper "space bone": a stepped key on the new space bone (its world
//    = the control's at the switch) plus stepped mixes switches without a pop, then the control rides
//    the prop rigidly. Without the space bone's key it jumps; with the IK ordered before the space
//    constraints the wrist lags the control.
//  - AIM. A one-bone IK points a bone's length at its target.
//   node tools/rigger-spike/rig-controls.mjs
import { readFileSync } from 'node:fs';
import { RIG_CORE } from './rig.mjs';

const {
	TextureAtlas,
	AtlasAttachmentLoader,
	SkeletonJson,
	Skeleton,
	AnimationState,
	AnimationStateData,
	Physics,
	Vector2,
} = await import(RIG_CORE);

let checks = 0;
let failed = 0;
const check = (ok, msg) => {
	checks++;
	if (!ok) failed++;
	console.log(`  ${ok ? '✅' : '✗'} ${msg}`);
};
const clone = (o) => JSON.parse(JSON.stringify(o));
const stub = {
	getImage: () => ({ width: 1, height: 1 }),
	setFilters() {},
	setWraps() {},
	dispose() {},
};

function load(doc, atlasText = 'page.png\nsize:4,4\nfilter:Linear,Linear\n') {
	const atlas = new TextureAtlas(atlasText);
	for (const p of atlas.pages) p.setTexture(stub);
	const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(clone(doc));
	return {
		data,
		skel: new Skeleton(data),
		state: new AnimationState(new AnimationStateData(data)),
	};
}
/** The skeleton posed by `anim` at `t` (setup when no animation), as a game plays it. */
function poseAt(doc, anim, t, atlasText) {
	const { skel, state } = load(doc, atlasText);
	skel.setToSetupPose();
	if (anim) {
		state.setAnimation(0, anim, false);
		state.update(t);
		state.apply(skel);
	}
	skel.updateWorldTransform(Physics.update);
	return skel;
}
const at = (skel, name) => skel.findBone(name);
const dist = (a, b) => Math.hypot(a.worldX - b.worldX, a.worldY - b.worldY);
const tipOf = (b) => ({
	worldX: b.worldX + b.a * b.data.length,
	worldY: b.worldY + b.c * b.data.length,
});
const angDiff = (a, b) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);
const r4 = (v) => Math.round(v * 1e4) / 1e4;

// -------------------------------------------------------------------------------------------- ORDER
console.log('\n=== constraint order: one constraint per order value (repo rig W) ===');
{
	const dir = 'apps/lines/static/assets/spines/symbols3';
	const w = JSON.parse(readFileSync(`${dir}/W.json`, 'utf8'));
	const atlasText = readFileSync(`${dir}/symbols3.atlas`, 'utf8');
	const total = (d) =>
		['ik', 'transform', 'path', 'physics'].reduce((n, k) => n + (d[k] || []).length, 0);
	const leaf = w.bones.find((b) => b.parent && !w.bones.some((c) => c.parent === b.name)).name;
	const target = w.bones.find((b) => b.name !== 'root' && b.name !== leaf).name;
	const withIk = (order) => {
		const d = clone(w);
		d.ik = [{ name: 'added', order, bones: [leaf], target, mix: 0 }];
		return d;
	};
	const active = (doc, kind, name) => {
		const { skel } = load(doc, atlasText);
		const list = {
			path: skel.pathConstraints,
			transform: skel.transformConstraints,
			ik: skel.ikConstraints,
		}[kind];
		const c = list.find((x) => x.data.name === name);
		return skel._updateCache.includes(c);
	};
	const maxMove = (a, b) => {
		let worst = 0;
		for (const anim of Object.keys(w.animations || {}))
			for (let t = 0; t <= 2; t += 0.05) {
				const p = poseAt(a, anim, t, atlasText);
				const q = poseAt(b, anim, t, atlasText);
				for (const bone of p.bones) worst = Math.max(worst, dist(bone, q.findBone(bone.data.name)));
			}
		return worst;
	};
	check(active(w, 'path', 'shake'), 'as shipped, W runs its path constraint `shake` (order 0)');
	const dup = withIk((w.ik || []).length);
	check(
		!active(dup, 'path', 'shake'),
		`＋ Add IK as shipped (order = ik.length = ${(w.ik || []).length}) drops \`shake\` from the update`,
	);
	const moved = maxMove(w, dup);
	check(
		moved > 1,
		`…and an IK at mix 0 then moves W's bones by up to ${moved.toFixed(1)} units (the lost path constraint)`,
	);
	const free = withIk(total(w));
	check(
		active(free, 'path', 'shake') && active(free, 'ik', 'added'),
		`at the next free order (${total(w)}) both run`,
	);
	check(maxMove(w, free) < 1e-6, 'and an IK at mix 0 there changes no pose');
	const tc = clone(w);
	tc.transform = [
		...(w.transform || []),
		{ name: 'added', order: (w.transform || []).length, bones: [leaf], target },
	];
	check(
		!active(tc, 'transform', 'added'),
		`＋ Add transform as shipped (order = transform.length = ${(w.transform || []).length}) leaves the NEW constraint inactive`,
	);
}

// ------------------------------------------------------------------------------- the synthetic arm
// y up. A chest that bobs, a 2-bone arm, a world-space hand control (the IK target), a prop that
// moves, one helper "space bone" per space the control can follow, and a head that can aim.
const BASE = {
	skeleton: { spine: '4.2.0' },
	bones: [
		{ name: 'root' },
		{ name: 'chest', parent: 'root', y: 100, rotation: 90, length: 60 },
		{ name: 'upper_arm', parent: 'chest', x: 50, y: -20, rotation: 150, length: 60 },
		{ name: 'lower_arm', parent: 'upper_arm', x: 60, rotation: 40, length: 50 },
		{ name: 'hand', parent: 'lower_arm', x: 50, length: 18 },
		{ name: 'head', parent: 'chest', x: 60, length: 30 },
		{ name: 'look', parent: 'root', x: 120, y: 200 },
		{ name: 'prop', parent: 'root', x: 160, y: 60 },
		{ name: 'hand_ctrl', parent: 'root' },
		{ name: 'space_chest', parent: 'chest' },
		{ name: 'space_prop', parent: 'prop' },
	],
	ik: [],
	transform: [],
	animations: {},
};
// The control starts on the wrist, so the setup pose is the same with IK on or off.
{
	const s = poseAt(BASE, null, 0);
	const hand = at(s, 'hand');
	const c = BASE.bones.find((b) => b.name === 'hand_ctrl');
	c.x = r4(hand.worldX);
	c.y = r4(hand.worldY);
}
const elbowSign = (doc) => {
	// Which bend reproduces the setup elbow: a matcher picks it the same way at any frame (below).
	const pick = (bend) => {
		const d = clone(doc);
		d.ik = [
			{
				name: 'arm_ik',
				order: 0,
				bones: ['upper_arm', 'lower_arm'],
				target: 'hand_ctrl',
				mix: 1,
				bendPositive: bend,
			},
		];
		return dist(at(poseAt(d, null, 0), 'lower_arm'), at(poseAt(doc, null, 0), 'lower_arm'));
	};
	return pick(true) <= pick(false);
};
const BEND = elbowSign(BASE);

/** The rig with its control layer: spaces first, then the arm IK, then the aim (`order`). */
function rig({ ikOrder = 2, ikMix = 0 } = {}) {
	const d = clone(BASE);
	d.transform = [
		{
			name: 'in_chest',
			order: ikOrder === 0 ? 1 : 0,
			bones: ['hand_ctrl'],
			target: 'space_chest',
			mixRotate: 0,
			mixX: 0,
			mixY: 0,
			mixScaleX: 0,
			mixScaleY: 0,
			mixShearY: 0,
		},
		{
			name: 'in_prop',
			order: ikOrder === 0 ? 2 : 1,
			bones: ['hand_ctrl'],
			target: 'space_prop',
			mixRotate: 0,
			mixX: 0,
			mixY: 0,
			mixScaleX: 0,
			mixScaleY: 0,
			mixShearY: 0,
		},
	];
	d.ik = [
		{
			name: 'arm_ik',
			order: ikOrder,
			bones: ['upper_arm', 'lower_arm'],
			target: 'hand_ctrl',
			mix: ikMix,
			bendPositive: BEND,
		},
		{ name: 'head_aim', order: 3, bones: ['head'], target: 'look', mix: 0 },
	];
	return d;
}
// An FK clip: the chest bobs, the arm swings, the prop slides.
const FK_CLIP = {
	bones: {
		chest: {
			translate: [
				{ time: 0, y: 0 },
				{ time: 1, y: 30 },
				{ time: 2, y: -10 },
				{ time: 3, y: 0 },
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
		},
	},
};
const TIMES = Array.from({ length: 61 }, (_, i) => i * 0.05);
const worstOver = (a, b, anim, bones) => {
	let worst = 0;
	for (const t of TIMES) {
		const p = poseAt(a, anim, t);
		const q = poseAt(b, anim, t);
		for (const n of bones)
			worst = Math.max(worst, dist(at(p, n), at(q, n)), dist(tipOf(at(p, n)), tipOf(at(q, n))));
	}
	return worst;
};
const ARM = ['upper_arm', 'lower_arm', 'hand'];

// ---------------------------------------------------------------------------------- SETUP MIX 0
console.log('\n=== an IK at setup mix 0 leaves FK clips alone ===');
{
	const plain = clone(BASE);
	plain.animations = { fk: FK_CLIP };
	const carried = rig();
	carried.animations = { fk: FK_CLIP };
	const worst = worstOver(plain, carried, 'fk', ARM);
	check(
		worst < 1e-9,
		`the FK clip plays identically with the IK at mix 0 (worst ${worst.toExponential(1)} units)`,
	);
	// A crossfade from a clip that keys the IK on, back to the FK clip, ends on the FK pose.
	const both = rig();
	both.animations = {
		fk: FK_CLIP,
		reach: {
			ik: { arm_ik: [{ time: 0, mix: 1, bendPositive: BEND }] },
			bones: { hand_ctrl: { translate: [{ time: 0, x: -30, y: 40 }] } },
		},
	};
	const { skel, state } = load(both);
	state.data.defaultMix = 0.2;
	state.setAnimation(0, 'reach', false);
	state.update(0.5);
	state.apply(skel);
	state.setAnimation(0, 'fk', false);
	for (let i = 0; i < 30; i++) state.update(1 / 60);
	skel.setToSetupPose();
	state.apply(skel);
	skel.updateWorldTransform(Physics.update);
	const fkAlone = poseAt(both, 'fk', 0.5);
	const off = Math.max(...ARM.map((n) => dist(tipOf(at(skel, n)), tipOf(at(fkAlone, n)))));
	check(
		off < 1e-3,
		`a 0.2 s crossfade from an IK clip back to the FK clip ends on the FK pose (${off.toExponential(1)} units)`,
	);
}

// ------------------------------------------------------------------------------------ FK → IK
console.log('\n=== FK → IK switch, matched ===');
const T_SWITCH = 1.2;
const T_BACK = 2.2;
/** The FK clip with the IK switched on at T_SWITCH, its target keyed at the FK wrist. */
function fkToIk(bend) {
	const d = rig();
	d.animations = { fk: FK_CLIP };
	const s = poseAt(d, 'fk', T_SWITCH);
	const wrist = at(s, 'hand');
	const c = at(s, 'hand_ctrl');
	const local = c.parent.worldToLocal(new Vector2(wrist.worldX, wrist.worldY));
	const clip = clone(FK_CLIP);
	clip.ik = {
		arm_ik: [
			{ time: 0, mix: 0, bendPositive: BEND, curve: 'stepped' },
			{ time: T_SWITCH, mix: 1, bendPositive: bend },
		],
	};
	clip.bones.hand_ctrl = {
		translate: [
			{ time: 0, x: 0, y: 0, curve: 'stepped' },
			{ time: T_SWITCH, x: r4(local.x - c.data.x), y: r4(local.y - c.data.y) },
		],
	};
	d.animations = { fk: FK_CLIP, switched: clip };
	return d;
}
/** The bend that puts the solved elbow nearest the FK elbow: the matcher's choice. */
function matchedBend() {
	const fk = rig();
	fk.animations = { fk: FK_CLIP };
	const fkElbow = at(poseAt(fk, 'fk', T_SWITCH), 'lower_arm');
	const elbow = (bend) => at(poseAt(fkToIk(bend), 'switched', T_SWITCH), 'lower_arm');
	return dist(elbow(true), fkElbow) <= dist(elbow(false), fkElbow);
}
const SWITCH_BEND = matchedBend();
// Either side of a step: a key time is stored as a float32 (fround(1.2) > 1.2), so a probe at exactly
// the switch time can still be before it.
const popAt = (doc, anim, t, names) => {
	const a = poseAt(doc, anim, t - 1e-4);
	const b = poseAt(doc, anim, t + 1e-4);
	return Math.max(
		...names.map((n) => Math.max(dist(at(a, n), at(b, n)), dist(tipOf(at(a, n)), tipOf(at(b, n))))),
	);
};
{
	const d = fkToIk(SWITCH_BEND);
	const pop = popAt(d, 'switched', T_SWITCH, ARM);
	check(
		pop < 0.05,
		`stepped mix 0 → 1 with the target on the FK wrist: no pop (${pop.toFixed(4)} units across the step, ±0.1 ms)`,
	);
	const s = poseAt(d, 'switched', T_SWITCH + 0.4);
	const reach = dist(at(s, 'hand'), at(s, 'hand_ctrl'));
	check(
		reach < 1e-3,
		`after the switch the wrist holds the control (${reach.toExponential(1)} units) while the chest moves`,
	);
	const flipped = popAt(fkToIk(!SWITCH_BEND), 'switched', T_SWITCH, ARM);
	check(
		flipped > 10,
		`mutation — the other bend sign flips the elbow (${flipped.toFixed(1)} units)`,
	);
}

// ------------------------------------------------------------------------------------ IK → FK
console.log('\n=== IK → FK switch, matched ===');
{
	const d = fkToIk(SWITCH_BEND);
	const s = poseAt(d, 'switched', T_BACK);
	const clip = d.animations.switched;
	clip.ik.arm_ik[1].curve = 'stepped';
	clip.ik.arm_ik.push({ time: T_BACK, mix: 0, bendPositive: SWITCH_BEND });
	for (const n of ['upper_arm', 'lower_arm']) {
		const b = at(s, n);
		const keys = clip.bones[n].rotate.filter((k) => k.time < T_BACK);
		const before = keys[keys.length - 1];
		keys.push({ time: r4(T_BACK - 1e-3), value: before.value, curve: 'stepped' });
		keys.push({ time: T_BACK, value: r4(b.arotation - b.data.rotation) });
		clip.bones[n].rotate = keys;
	}
	const pop = popAt(d, 'switched', T_BACK, ARM);
	check(
		pop < 0.05,
		`stepped mix 1 → 0 with FK keyed at the solved rotations: no pop (${pop.toFixed(4)} units)`,
	);
	const unmatched = clone(d);
	for (const n of ['upper_arm', 'lower_arm'])
		unmatched.animations.switched.bones[n].rotate = FK_CLIP.bones[n].rotate;
	const jump = popAt(unmatched, 'switched', T_BACK, ARM);
	check(jump > 5, `mutation — switching back without the FK keys jumps (${jump.toFixed(1)} units)`);
}

// -------------------------------------------------------------------------------- SPACE SWITCH
console.log('\n=== space switch: chest → prop, through space bones ===');
const T_SPACE = 1.4;
/** IK on, the control in chest space until T_SPACE, then in prop space. */
function spaced({ compensate = true, ikOrder = 2 } = {}) {
	const d = rig({ ikOrder, ikMix: 1 });
	// The chest space bone sits where the control does at setup, so following it changes nothing at 0.
	const s0 = poseAt(d, null, 0);
	const ctrl0 = at(s0, 'hand_ctrl');
	const sc = d.bones.find((b) => b.name === 'space_chest');
	const lc = at(s0, 'chest').worldToLocal(new Vector2(ctrl0.worldX, ctrl0.worldY));
	sc.x = r4(lc.x);
	sc.y = r4(lc.y);
	const mixes = (v) => ({
		mixRotate: v,
		mixX: v,
		mixY: v,
		mixScaleX: 0,
		mixScaleY: 0,
		mixShearY: 0,
	});
	d.transform[0] = { ...d.transform[0], ...mixes(1) };
	const clip = clone(FK_CLIP);
	delete clip.bones.upper_arm;
	delete clip.bones.lower_arm;
	clip.transform = {
		in_chest: [
			{ time: 0, ...mixes(1), curve: 'stepped' },
			{ time: T_SPACE, ...mixes(0) },
		],
		in_prop: [
			{ time: 0, ...mixes(0), curve: 'stepped' },
			{ time: T_SPACE, ...mixes(1) },
		],
	};
	d.animations = { spaced: clip };
	if (compensate) {
		const s = poseAt(d, 'spaced', T_SPACE - 1e-6);
		const ctrl = at(s, 'hand_ctrl');
		const sp = at(s, 'space_prop');
		const l = sp.parent.worldToLocal(new Vector2(ctrl.worldX, ctrl.worldY));
		const rot = sp.worldToLocalRotation(ctrl.getWorldRotationX());
		clip.bones.space_prop = {
			translate: [{ time: T_SPACE, x: r4(l.x - sp.data.x), y: r4(l.y - sp.data.y) }],
			rotate: [{ time: T_SPACE, value: r4(rot - sp.data.rotation) }],
		};
	}
	return d;
}
{
	const d = spaced();
	const pop = popAt(d, 'spaced', T_SPACE, ['hand_ctrl', ...ARM]);
	check(
		pop < 0.05,
		`switching space with the space bone keyed at the control: no pop (${pop.toFixed(4)} units)`,
	);
	let drift = 0;
	let spin = 0;
	const rel = (s) => {
		const p = at(s, 'prop');
		const c = at(s, 'hand_ctrl');
		return {
			l: p.worldToLocal(new Vector2(c.worldX, c.worldY)),
			r: c.getWorldRotationX() - p.getWorldRotationX(),
		};
	};
	const ref = rel(poseAt(d, 'spaced', T_SPACE));
	for (let t = T_SPACE; t <= 3; t += 0.1) {
		const r = rel(poseAt(d, 'spaced', t));
		drift = Math.max(drift, Math.hypot(r.l.x - ref.l.x, r.l.y - ref.l.y));
		spin = Math.max(spin, angDiff(r.r, ref.r));
	}
	check(
		drift < 1e-3 && spin < 1e-3,
		`then the control rides the prop rigidly (drift ${drift.toExponential(1)} units, ${spin.toExponential(1)}°)`,
	);
	const before = poseAt(d, 'spaced', T_SPACE - 0.4);
	const follow = dist(at(before, 'hand'), at(before, 'hand_ctrl'));
	check(
		follow < 1e-3,
		`before the switch the wrist follows the control in chest space (${follow.toExponential(1)} units)`,
	);
	const jump = popAt(spaced({ compensate: false }), 'spaced', T_SPACE, ['hand_ctrl']);
	check(
		jump > 10,
		`mutation — without the space bone's key the control jumps (${jump.toFixed(1)} units)`,
	);
	const lagged = spaced({ ikOrder: 0 });
	const s = poseAt(lagged, 'spaced', 0.8);
	const lag = dist(at(s, 'hand'), at(s, 'hand_ctrl'));
	check(
		lag > 1,
		`mutation — the IK ordered before the space constraints leaves the wrist behind the control (${lag.toFixed(1)} units)`,
	);
}

// ------------------------------------------------------------------------------------------- AIM
console.log('\n=== aim: a one-bone IK ===');
{
	const d = rig();
	d.ik[1].mix = 1;
	d.animations = {
		look: {
			bones: {
				look: {
					translate: [
						{ time: 0, x: 0 },
						{ time: 3, x: -200, y: -50 },
					],
				},
			},
		},
	};
	let worst = 0;
	for (const t of TIMES) {
		const s = poseAt(d, 'look', t);
		const h = at(s, 'head');
		const l = at(s, 'look');
		const want = (Math.atan2(l.worldY - h.worldY, l.worldX - h.worldX) * 180) / Math.PI;
		worst = Math.max(worst, angDiff(h.getWorldRotationX(), want));
	}
	check(
		worst < 1e-3,
		`the head's length points at its target throughout (worst ${worst.toExponential(1)}°)`,
	);
}

console.log(
	failed
		? `\n✗ FAIL — ${failed} of ${checks} checks`
		: `\n✅ PASS — ${checks} checks: one constraint per order, IK at mix 0 changes no FK clip, FK ↔ IK and space switches match without a pop, aim is a one-bone IK`,
);
process.exit(failed ? 1 : 0);
