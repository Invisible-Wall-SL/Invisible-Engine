// Rig controls phase K1 — "constraints you can see" (docs/design/rig-controls.md §4.2–4.4, §4.6): the
// ＋ Add constraint presets, the solve-order list's reorder and the constraint-ownership reader, pulled
// out of the SHIPPED view.html and their output played by the REAL engine-rig (SkeletonJson →
// Skeleton → AnimationState, as a game plays it).
//
// Asserted:
//  - every preset writes a native 4.2 constraint at the next free solve order, beside W's own, and
//    all of them run;
//  - a preset with a NEW control changes no pose (two-bone IK bent either way and under a mirrored
//    parent, aim, look, orient, copy location, copy scale, child of), and then does what it says:
//    the hand reaches the moved control, the bone aims at it, the pupil follows 0.15 of its move,
//    the bone turns / sits / scales / rides with the picked target;
//  - Spline IK lays a 4-bone tail along a path weighted to new controls: the setup pose barely moves,
//    moving the end control bends the chain, and deleting a control keeps the rig loading;
//  - presets refuse what the runtime cannot solve (the root aiming, an IK whose parent is the root,
//    a target inside the chain);
//  - a solve-order move keeps the running list contiguous, engine-rig runs it in the list's order,
//    and it never gains a clash (300 random rigs);
//  - the ownership reader names the channels each running constraint replaces, and the gizmo hint
//    speaks only for those.
// Every guard is mutation-checked: a planted mutant of the shipped code must turn its check red.
//   node tools/rigger-spike/rig-presets.mjs
import { readFileSync } from 'node:fs';
import { RIG_CORE } from './rig.mjs';
import { viewSandbox } from './view-sandbox.mjs';

const RIG = await import(RIG_CORE);
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, AnimationState } = RIG;
const { AnimationStateData, Physics } = RIG;

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
function load(doc, atlasText = ATLAS) {
	const atlas = new TextureAtlas(atlasText);
	for (const p of atlas.pages) p.setTexture(stub);
	const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(clone(doc));
	return {
		data,
		skel: new Skeleton(data),
		state: new AnimationState(new AnimationStateData(data)),
	};
}
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
const dist = (a, b) => Math.hypot(a.worldX - b.worldX, a.worldY - b.worldY);
const tipOf = (b) => ({
	worldX: b.worldX + b.data.length * b.a,
	worldY: b.worldY + b.data.length * b.c,
});
const angDiff = (a, b) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);
/** The largest distance any bone of `before` moved in `after` (bones `after` added are ignored). */
function moved(before, after) {
	let worst = 0;
	for (const b of before.bones) worst = Math.max(worst, dist(b, after.findBone(b.data.name)));
	return worst;
}

// ----------------------------------------------------------------- the shipped Rigger, sandboxed
const ENTRY = [
	'buildConstraintPreset',
	'presetProblem',
	'presetTargetProblem',
	'solveOrderList',
	'moveInSolveOrder',
	'constraintOrderClashes',
	'gainedOrderClashes',
	'constraintOwners',
	'ownedChannelHint',
	'deleteBoneCore',
];
/** The shipped functions in a fresh context; `mutate` swaps [from, to] text in the pulled source. */
const sandbox = (mutate = []) =>
	viewSandbox({
		entry: ENTRY,
		globals: {
			RIG,
			rawDoc: null,
			skeletonData: null,
			skeleton: null,
			selBone: null,
			animMode: false,
			slotsWithPath: () => [],
		},
		stubs: ['rebuildFromRawDoc', 'markDirty', 'buildInspector', 'historyStep'],
		mutate,
		label: 'rig-presets',
	});
const UI = sandbox();
/** Open `doc` in sandbox `ui` (the doc is edited in place by what runs there). */
function openIn(ui, doc) {
	const { data, skel } = load(doc);
	ui.rawDoc = doc;
	ui.skeletonData = data;
	ui.skeleton = skel;
	return doc;
}
/** `doc` with preset `id` added on `bone` toward `target` (null: a new control), and the result. */
function withPreset(doc, id, bone, target = null, ui = UI) {
	const d = openIn(ui, clone(doc));
	const res = ui.buildConstraintPreset(id, bone, target);
	return { doc: d, res, c: res.kind ? d[res.kind].find((c) => c.name === res.name) : null };
}
/** The constraints engine-rig runs, in the order it runs them: ['kind name']. */
function runOrder(doc, atlasText) {
	const { skel } = load(doc, atlasText);
	const kindOf = new Map();
	for (const [kind, list] of [
		['ik', skel.ikConstraints],
		['transform', skel.transformConstraints],
		['path', skel.pathConstraints],
		['physics', skel.physicsConstraints],
	])
		for (const c of list) kindOf.set(c, `${kind} ${c.data.name}`);
	return skel._updateCache.filter((u) => kindOf.has(u)).map((u) => kindOf.get(u));
}
const allOf = (doc) =>
	['ik', 'transform', 'path', 'physics'].flatMap((k) =>
		(doc[k] || []).map((c) => `${k} ${c.name}`),
	);
/** A clip keying `bone` (translate x, y; rotate r; scale s) at t = 1. */
const clip = (doc, bone, key) => {
	doc.animations = doc.animations || {};
	const tl = {};
	if (key.x !== undefined) tl.translate = [{ time: 0 }, { time: 1, x: key.x, y: key.y }];
	if (key.r !== undefined) tl.rotate = [{ time: 0 }, { time: 1, value: key.r }];
	if (key.s !== undefined) tl.scale = [{ time: 0 }, { time: 1, x: key.s, y: key.s }];
	doc.animations.k = { bones: { [bone]: tl } };
	return doc;
};

// --------------------------------------------------------------------------------- a synthetic rig
// y up. A body (mirrored when asked), a 2-bone arm bent either way, a head with a pupil, a 4-bone tail,
// a prop that is turned and scaled (a target for the follow presets) and a cup within the arm's reach.
const RIGDOC = (bend = 1, mirror = false) => ({
	skeleton: { spine: '4.2.0' },
	bones: [
		{ name: 'root' },
		{ name: 'body', parent: 'root', y: 100, ...(mirror ? { scaleX: -1 } : {}) },
		{ name: 'upper_arm', parent: 'body', x: 20, y: 60, rotation: -60, length: 50 },
		{ name: 'lower_arm', parent: 'upper_arm', x: 50, rotation: 70 * bend, length: 45 },
		{ name: 'hand', parent: 'lower_arm', x: 45, length: 15 },
		{ name: 'head', parent: 'body', y: 120, rotation: 10, length: 30 },
		{ name: 'pupil', parent: 'head', x: 12, y: 8 },
		{ name: 'tail1', parent: 'body', x: -20, rotation: 200, length: 30 },
		{ name: 'tail2', parent: 'tail1', x: 30, rotation: 20, length: 30 },
		{ name: 'tail3', parent: 'tail2', x: 30, rotation: 25, length: 25 },
		{ name: 'tail4', parent: 'tail3', x: 25, rotation: 15, length: 20 },
		{ name: 'prop', parent: 'root', x: 140, y: 150, rotation: 30, scaleX: 1.5, scaleY: 0.8 },
		{ name: 'cup', parent: 'root', x: 60, y: 125 },
	],
	slots: [],
	skins: [{ name: 'default', attachments: {} }],
	animations: {},
});

// Each check is a function of a sandbox, so a mutant can be run through the same assertion.
const GUARDS = {};
const guard = (id, fn) => {
	GUARDS[id] = fn;
	return fn(UI, true);
};

console.log('\n=== presets with a new control change no pose, then do what they say ===');
guard('twoBone', (ui, say = false) => {
	let ok = true;
	for (const [bend, mirror] of [
		[1, false],
		[-1, false],
		[1, true],
		[-1, true],
	]) {
		const base = RIGDOC(bend, mirror);
		const { doc, c } = withPreset(base, 'twoBoneIk', 'lower_arm', null, ui);
		const still = moved(poseAt(base, null, 0), poseAt(doc, null, 0));
		clip(doc, c.target, { x: -12, y: 18 });
		const p = poseAt(doc, 'k', 1);
		const reach = dist(tipOf(p.findBone('lower_arm')), p.findBone(c.target));
		const one =
			still < 1e-3 &&
			reach < 1e-3 &&
			c.bones.join() === 'upper_arm,lower_arm' &&
			p.findBone(c.target).parent.data.name === 'root';
		ok &&= one;
		if (say)
			check(
				one,
				`Two-bone IK, arm bent ${bend > 0 ? '+' : '−'}${mirror ? ', mirrored body' : ''}: setup moves ${still.toExponential(1)}, the tip reaches the moved control (${reach.toExponential(1)})`,
			);
	}
	return ok;
});
{
	// the bend sign is what keeps the elbow: the other one flips it
	const base = RIGDOC(1);
	const { doc } = withPreset(base, 'twoBoneIk', 'lower_arm');
	doc.ik[0].bendPositive = !doc.ik[0].bendPositive;
	const flip = moved(poseAt(base, null, 0), poseAt(doc, null, 0));
	check(flip > 10, `…and it matters: the other bend sign moves the elbow ${flip.toFixed(1)} units`);
}
guard('aim', (ui, say = false) => {
	const base = RIGDOC();
	const { doc, c } = withPreset(base, 'aim', 'head', null, ui);
	const still = moved(poseAt(base, null, 0), poseAt(doc, null, 0));
	clip(doc, c.target, { x: 40, y: -25 });
	const p = poseAt(doc, 'k', 1);
	const h = p.findBone('head');
	const t = p.findBone(c.target);
	const want = (Math.atan2(t.worldY - h.worldY, t.worldX - h.worldX) * 180) / Math.PI;
	const off = angDiff(h.getWorldRotationX(), want);
	const ok = still < 1e-3 && off < 1e-3 && c.bones.length === 1;
	if (say)
		check(
			ok,
			`Aim: setup moves ${still.toExponential(1)}; the head points at the moved control (${off.toExponential(1)}°)`,
		);
	return ok;
});
guard('look', (ui, say = false) => {
	const base = RIGDOC();
	const { doc, c } = withPreset(base, 'look', 'pupil', null, ui);
	const still = moved(poseAt(base, null, 0), poseAt(doc, null, 0));
	clip(doc, c.target, { x: 20, y: 10 });
	const p = poseAt(doc, 'k', 1);
	const s = poseAt(base, null, 0);
	const pu = p.findBone('pupil');
	const lx = pu.ax - s.findBone('pupil').ax;
	const ly = pu.ay - s.findBone('pupil').ay;
	const ok =
		still < 1e-3 && Math.abs(lx - 3) < 1e-3 && Math.abs(ly - 1.5) < 1e-3 && c.relative && c.local;
	if (say)
		check(
			ok,
			`Look: setup moves ${still.toExponential(1)}; the control moves (20, 10), the pupil (${lx.toFixed(3)}, ${ly.toFixed(3)}) = 0.15 of it`,
		);
	return ok;
});
guard('follow', (ui, say = false) => {
	let ok = true;
	for (const id of ['orient', 'copyLocation', 'copyScale', 'childOf']) {
		const base = RIGDOC();
		const { doc, c } = withPreset(base, id, 'head', null, ui);
		const still = moved(poseAt(base, null, 0), poseAt(doc, null, 0));
		const s0 = poseAt(doc, null, 0).findBone('head');
		const rot0 = s0.getWorldRotationX();
		const sc0 = s0.getWorldScaleX();
		clip(doc, c.target, { x: 30, y: -20, r: 35, s: 1.4 });
		const p = poseAt(doc, 'k', 1);
		const h = p.findBone('head');
		const t = p.findBone(c.target);
		const want = {
			orient:
				angDiff(h.getWorldRotationX(), t.getWorldRotationX()) < 1e-3 &&
				angDiff(rot0, h.getWorldRotationX()) > 30,
			copyLocation: dist(h, t) < 1e-3,
			copyScale:
				Math.abs(h.getWorldScaleX() - t.getWorldScaleX()) < 1e-4 &&
				Math.abs(h.getWorldScaleX() - sc0) > 0.3,
			childOf: dist(h, t) < 1e-3 && angDiff(h.getWorldRotationX(), t.getWorldRotationX()) < 1e-3,
		}[id];
		const one = still < 1e-3 && want;
		ok &&= one;
		if (say)
			check(one, `${id}: setup moves ${still.toExponential(1)}; then it follows the moved control`);
	}
	return ok;
});

console.log('\n=== presets on a picked target ===');
guard('childOfPicked', (ui, say = false) => {
	const base = RIGDOC();
	const { doc, c } = withPreset(base, 'childOf', 'head', 'prop', ui);
	const still = moved(poseAt(base, null, 0), poseAt(doc, null, 0));
	// rides the prop rigidly: the head's frame in the prop's frame is the same before and after it moves
	const rel = (skel) => {
		const t = skel.findBone('prop');
		const h = skel.findBone('head');
		const p = t.worldToLocal(new RIG.Vector2(h.worldX, h.worldY));
		return [p.x, p.y, h.getWorldRotationX() - t.getWorldRotationX()];
	};
	const r0 = rel(poseAt(doc, null, 0));
	clip(doc, 'prop', { x: 30, y: -20, r: 40 });
	const r1 = rel(poseAt(doc, 'k', 1));
	const drift = Math.max(Math.abs(r0[0] - r1[0]), Math.abs(r0[1] - r1[1]), angDiff(r0[2], r1[2]));
	const ok =
		still < 1e-3 &&
		drift < 1e-3 &&
		c.target === 'prop' &&
		Object.keys(c).some((k) => ['x', 'y', 'rotation'].includes(k));
	if (say)
		check(
			ok,
			`Child of a turned, scaled prop: setup moves ${still.toExponential(1)}; the head rides it (drift ${drift.toExponential(1)})`,
		);
	return ok;
});
{
	const base = RIGDOC();
	const { doc } = withPreset(base, 'copyLocation', 'head', 'prop');
	const p = poseAt(doc, null, 0);
	check(
		dist(p.findBone('head'), p.findBone('prop')) < 1e-3,
		'Copy location on a picked target snaps the bone onto it',
	);
	const two = withPreset(base, 'twoBoneIk', 'lower_arm', 'cup');
	const q = poseAt(two.doc, null, 0);
	const reach = dist(tipOf(q.findBone('lower_arm')), q.findBone('cup'));
	check(
		reach < 1e-3 && two.doc.bones.length === base.bones.length,
		`Two-bone IK on a picked target reaches it (${reach.toExponential(1)}) and adds no bone`,
	);
}

console.log('\n=== Spline IK ===');
guard('spline', (ui, say = false) => {
	const base = RIGDOC();
	const { doc, c, res } = withPreset(base, 'splineIk', 'tail1', null, ui);
	if (!c) {
		if (say) check(false, `Spline IK refused: ${res.error}`);
		return false;
	}
	const ctl = doc.bones.filter((b) => b.name.startsWith('tail1_spline'));
	const s0 = poseAt(base, null, 0);
	const s1 = poseAt(doc, null, 0);
	let chainLen = 0;
	for (const n of c.bones) chainLen += s0.findBone(n).data.length;
	const still = moved(s0, s1);
	const att = doc.skins[0].attachments[c.target][c.target];
	// smooth: at every interior joint the in-handle, the joint and the out-handle lie on one line
	const slot = s1.findSlot(c.target);
	const pa = slot.getAttachment();
	const w = new Array(pa.worldVerticesLength).fill(0);
	pa.computeWorldVertices(slot, 0, pa.worldVerticesLength, w, 0, 2);
	let kink = 0;
	for (let i = 1; i < w.length / 6 - 1; i++) {
		const [ix, iy, px, py, ox, oy] = w.slice(i * 6, i * 6 + 6);
		const l1 = Math.hypot(px - ix, py - iy);
		const l2 = Math.hypot(ox - px, oy - py);
		kink = Math.max(
			kink,
			l1 < 1e-3 || l2 < 1e-3
				? Infinity
				: Math.abs((px - ix) * (oy - py) - (py - iy) * (ox - px)) / (l1 * l2),
		);
	}
	const end = ctl.at(-1).name;
	clip(doc, end, { x: 0, y: -30 });
	const p = poseAt(doc, 'k', 1);
	const tipMove = tipOf(s1.findBone('tail4')).worldY - tipOf(p.findBone('tail4')).worldY;
	const runs = runOrder(doc).includes(`path ${c.name}`);
	const ok =
		c.bones.join() === 'tail1,tail2,tail3,tail4' &&
		ctl.length >= 2 &&
		ctl.length <= 4 &&
		att.vertices.length !== att.vertexCount * 2 &&
		still < 0.02 * chainLen &&
		kink < 1e-6 &&
		tipMove > 5 &&
		runs &&
		!doc.slots.some((s) => ctl.some((b) => b.name === s.bone));
	if (say)
		check(
			ok,
			`Spline IK on a 4-bone tail: ${ctl.length} controls (no slot), a weighted path, smooth through every joint; setup moves ${still.toFixed(3)} of a ${chainLen}-unit chain; moving the end control 30 down moves the tip ${tipMove.toFixed(1)} down`,
		);
	return ok;
});
{
	const { doc } = withPreset(RIGDOC(), 'splineIk', 'tail4');
	const del = clone(doc);
	openIn(UI, del);
	UI.deleteBoneCore(del, del.bones.find((b) => b.name.startsWith('tail1_spline')).name);
	let loads = true;
	try {
		poseAt(del, null, 0);
	} catch {
		loads = false;
	}
	check(
		doc.path[0].bones.join() === 'tail1,tail2,tail3,tail4' && loads,
		'…from the tip it finds the same chain; deleting a control keeps the rig loading',
	);
}

console.log('\n=== presets refuse what the runtime cannot solve ===');
guard('refuse', (ui, say = false) => {
	const d = openIn(ui, RIGDOC());
	const cases = [
		[ui.presetProblem('aim', 'root'), 'the root cannot aim'],
		[ui.presetProblem('twoBoneIk', 'body'), 'Two-bone IK on a child of the root'],
		[ui.presetProblem('splineIk', 'pupil'), 'Spline IK on a 2-bone chain'],
		[ui.presetTargetProblem('twoBoneIk', 'lower_arm', 'hand'), 'a target under the chain'],
		[ui.presetTargetProblem('twoBoneIk', 'lower_arm', 'upper_arm'), 'a target in the chain'],
		[ui.presetTargetProblem('orient', 'head', 'pupil'), 'a target under the bone'],
	];
	const ok =
		cases.every(([why]) => typeof why === 'string') &&
		ui.presetTargetProblem('orient', 'head', 'prop') === null;
	const res = ui.buildConstraintPreset('aim', 'root', null);
	const untouched = !d.ik && d.bones.length === RIGDOC().bones.length;
	if (say)
		check(
			ok && res.error && untouched,
			`refused, the doc untouched: ${cases.map(([why, what]) => `${what} ("${why}")`).join('; ')}`,
		);
	return ok && !!res.error && untouched;
});

console.log('\n=== every preset at the next free order, beside W’s own constraints ===');
{
	const dir = 'apps/lines/static/assets/spines/symbols3';
	const w = JSON.parse(readFileSync(`${dir}/W.json`, 'utf8'));
	const atlasText = readFileSync(`${dir}/symbols3.atlas`, 'utf8');
	const leaf = w.bones.find(
		(b) =>
			b.parent &&
			w.bones.find((p) => p.name === b.parent)?.parent &&
			!w.bones.some((c) => c.parent === b.name),
	).name;
	const ui = UI;
	const d = clone(w);
	const { data, skel } = load(d, atlasText);
	Object.assign(ui, { rawDoc: d, skeletonData: data, skeleton: skel });
	const made = [];
	for (const id of ['twoBoneIk', 'aim', 'orient', 'copyLocation', 'copyScale', 'childOf', 'look']) {
		const r = ui.buildConstraintPreset(id, leaf, null);
		if (r.error) made.push(`${id}: ${r.error}`);
		else made.push(`${r.kind} ${r.name}`);
		const re = load(d, atlasText);
		Object.assign(ui, { skeletonData: re.data, skeleton: re.skel });
	}
	const order = runOrder(d, atlasText);
	const orders = allOf(d)
		.map((k) => [...d.ik, ...d.transform, ...d.path].find((c) => k.endsWith(` ${c.name}`)).order)
		.sort((a, b) => a - b);
	check(
		order.length === allOf(d).length &&
			orders.every((o, i) => o === i) &&
			!made.some((m) => m.includes(':')),
		`all ${order.length} run, orders 0..${orders.length - 1}: ${made.join(', ')}`,
	);
}

console.log('\n=== the solve-order list: drag to reorder ===');
// Random rigs with clashes, random moves: the running list stays contiguous and is what engine-rig
// runs, in order; nothing that ran stops, nothing left out starts.
guard('reorder', (ui, say = false) => {
	let seed = 7;
	const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
	let bad = 0;
	let moves = 0;
	let firstBad = '';
	for (let n = 0; n < 300; n++) {
		const doc = {
			skeleton: { spine: '4.2.0' },
			bones: [{ name: 'root' }],
			slots: [],
			ik: [],
			transform: [],
			physics: [],
		};
		const nb = 3 + Math.floor(rnd() * 4);
		for (let i = 1; i <= nb; i++)
			doc.bones.push({ name: `b${i}`, parent: i === 1 ? 'root' : `b${i - 1}`, x: 10, length: 10 });
		const count = 2 + Math.floor(rnd() * 6);
		for (let i = 0; i < count; i++) {
			const order = rnd() < 0.2 ? Math.floor(rnd() * (count + 2)) : i;
			const k = rnd();
			if (k < 0.33) doc.ik.push({ name: `ik${i}`, order, bones: [`b${nb}`], target: 'b1', mix: 0 });
			else if (k < 0.66)
				doc.transform.push({
					name: `tc${i}`,
					order,
					bones: [`b${nb - 1}`],
					target: 'b1',
					mixRotate: 0,
					mixX: 0,
					mixY: 0,
					mixScaleX: 0,
					mixScaleY: 0,
					mixShearY: 0,
				});
			else doc.physics.push({ name: `ph${i}`, order, bone: `b${nb}`, rotate: 1, mix: 0 });
		}
		const before = clone(doc);
		const list = ui.solveOrderList(doc).filter((e) => !e.why);
		if (!list.length) continue;
		const pick = list[Math.floor(rnd() * list.length)];
		const to = Math.floor(rnd() * list.length);
		const want = list.map((e) => `${e.kind} ${e.c.name}`);
		const from = want.indexOf(`${pick.kind} ${pick.c.name}`);
		want.splice(to, 0, want.splice(from, 1)[0]);
		const did = ui.moveInSolveOrder(doc, pick.kind, pick.c.name, to);
		moves += did ? 1 : 0;
		const run = runOrder(doc);
		const after = ui.solveOrderList(doc).filter((e) => !e.why);
		const okOne =
			did === (from !== to) &&
			JSON.stringify(run) === JSON.stringify(want) &&
			(!did || after.every((e, i) => e.c.order === i)) &&
			ui.gainedOrderClashes(doc, before).length === 0 &&
			JSON.stringify(runOrder(before).sort()) === JSON.stringify([...run].sort());
		if (!okOne) {
			bad++;
			firstBad ||= `${JSON.stringify(want)} vs ${JSON.stringify(run)}`;
		}
	}
	if (say)
		check(
			bad === 0 && moves > 100,
			`${moves} moves on 300 rigs: engine-rig runs the list as dragged, orders 0..R−1, no clash gained, nothing switched on or off${bad ? ` — ${bad} bad, e.g. ${firstBad}` : ''}`,
		);
	return bad === 0;
});

console.log('\n=== what the stage tints, and when the gizmo warns ===');
guard('owners', (ui, say = false) => {
	const base = RIGDOC();
	const { doc } = withPreset(base, 'twoBoneIk', 'lower_arm', null, ui);
	const look = withPreset(doc, 'look', 'pupil', null, ui).doc;
	look.physics = [{ name: 'jig', order: 2, bone: 'tail1', rotate: 1, mix: 1 }];
	openIn(ui, look);
	const skel = poseAt(look, null, 0);
	const own = ui.constraintOwners(skel, look);
	const arm = own.get('upper_arm') || [];
	const hint = ui.ownedChannelHint(own, 'lower_arm', 'rotate');
	const ok =
		arm.length === 1 &&
		arm[0].ch.join() === 'rotate' &&
		!arm[0].adds &&
		own.get('pupil')?.[0].adds === true &&
		own.get('tail1')?.[0].adds === true &&
		typeof hint === 'string' &&
		/lower_arm_ik/.test(hint) &&
		/rotation/.test(hint) &&
		ui.ownedChannelHint(own, 'lower_arm', 'translate') === null &&
		ui.ownedChannelHint(own, 'pupil', 'translate') === null &&
		ui.ownedChannelHint(own, 'tail1', 'rotate') === null;
	look.ik[0].mix = 0;
	const off = ui.constraintOwners(poseAt(look, null, 0), look);
	const ok0 = !off.has('upper_arm');
	if (say)
		check(
			ok && ok0,
			`an IK at mix 1 owns its chain's rotation ("${hint?.slice(0, 70)}…"); its translation, a relative look and a jiggle add to the pose and never warn; at mix 0 it owns nothing`,
		);
	return ok && ok0;
});

// -------------------------------------------------------------------- mutants: each must turn red
console.log('\n=== mutants of the shipped code: each must fail its check ===');
const MUTANTS = [
	['twoBone', 'the other bend sign', ['cross <= 0 ? p.a', 'cross > 0 ? p.a']],
	[
		'twoBone',
		'the control at the bone origin, not its tip',
		[
			'const p = b.parent, tip = aheadOf(b)',
			'const p = b.parent, tip = { x: b.worldX, y: b.worldY }',
		],
	],
	[
		'aim',
		'aim from the parent',
		[
			'bones: [boneName], target: t, mix: 1, compress',
			'bones: [b.parent.data.name], target: t, mix: 1, compress',
		],
	],
	['look', 'no offset for the control’s place', ['if (tidy(-tl.x)) off.x = tidy(-tl.x);', '']],
	['look', 'world, not local', ['relative: true, local: true', 'relative: true, local: false']],
	[
		'childOfPicked',
		'child of with no offsets',
		[
			'const offsets = id === "childOf" ? childOfOffsets(worldOf(b), T) : {};',
			'const offsets = {};',
		],
	],
	[
		'follow',
		'a new control on the world axes',
		[
			'const frameAt = (x, y) => ({ a: b.a, b: b.b, c: b.c, d: b.d, x, y });',
			'const frameAt = (x, y) => ({ a: 1, b: 0, c: 0, d: 1, x, y });',
		],
	],
	[
		'childOfPicked',
		'the rotation offset unsigned',
		[
			'wrapDeg((Math.atan2(B.c, B.a) - Math.atan2(T.c, T.a)) / DEG) * sgn',
			'wrapDeg((Math.atan2(T.c, T.a) - Math.atan2(B.c, B.a)) / DEG) * sgn',
		],
	],
	[
		'childOfPicked',
		'position offset in world space',
		['x: Ti ? Ti.a * B.x + Ti.b * B.y + Ti.x : 0', 'x: B.x - T.x'],
	],
	[
		'spline',
		'the path weighted to one control',
		['const s = u[i] * (K - 1), k0', 'const s = 0, k0'],
	],
	[
		'spline',
		'Catmull-Rom handles dropped',
		['[{ x: p.x - tx, y: p.y - ty }, p, { x: p.x + tx, y: p.y + ty }]', '[p, p, p]'],
	],
	[
		'refuse',
		'the root may aim',
		['if (id === "aim" && !b.parent) return "the root cannot aim";', ''],
	],
	['refuse', 'a target under the chain allowed', ['descendantNames(n).has(targetName)', 'false']],
	[
		'reorder',
		'no re-pack after a move',
		[
			'run.forEach((e, i) => { e.c.order = i; });\n  repackConstraintOrders(doc, left);',
			'run.forEach((e, i) => { e.c.order = i; });',
		],
	],
	[
		'reorder',
		'the left-out ones switched on',
		[
			'repackConstraintOrders(doc, left);\n  return true;',
			'repackConstraintOrders(doc, []);\n  return true;',
		],
	],
	['owners', 'a mix-0 constraint still owns', ['!(mix > 0) ||', '!(mix >= 0) ||']],
	[
		'owners',
		'a relative transform replaces',
		[
			'Math.max(c.mixRotate, c.mixX, c.mixY, c.mixScaleX, c.mixScaleY, c.mixShearY), !!c.data.relative)',
			'Math.max(c.mixRotate, c.mixX, c.mixY, c.mixScaleX, c.mixScaleY, c.mixShearY), false)',
		],
	],
	['owners', 'the hint speaks for every channel', ['!x.adds && x.ch.includes(ch)', 'x.ch.length']],
];
for (const [id, what, swap] of MUTANTS) {
	let red;
	let threw = '';
	try {
		red = !GUARDS[id](sandbox([swap]));
	} catch (e) {
		red = true;
		threw = ` (threw: ${String(e.message).slice(0, 60)})`;
	}
	check(red, `${id} ✗ under "${what}"${threw}`);
}

console.log(`\n${failed === 0 ? '✅ PASS' : '✗ FAIL'} — ${checks - failed}/${checks} checks`);
process.exit(failed === 0 ? 0 : 1);
