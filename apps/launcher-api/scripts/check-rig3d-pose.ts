/**
 * Posing a 2.5D rig in the Rigger (docs/design/rig-2p5d.md §9, P3), offline, on the shipped module
 * (`src/lib/rig3dPose.ts`, the page's `vendor/rigger-2p5d.js`):
 *   pnpm --filter launcher-api check:rig3d-pose
 *
 *  1. The turned view: the rig held at its pose at the playhead and seen by a camera turned about
 *     the vertical, as `viewPose` keys it and engine-rig draws it, puts every card where the turned
 *     3D pose projects it (an independent projection: the gate's own matrices), shows the drawing
 *     that faces that camera best and orders the slots by depth.
 *  2. At view 0 the held pose is the clip's own: within the bake's bound of what engine-rig plays
 *     from the clip's bake at the same time (the stage looks the same paused and playing).
 *  3. Angles over quaternions: a key edited by its angles reads them back (continuous past ±180°
 *     and a tilt past 90°), keeps its curve, and a turn of more than 180° is split so the slerp goes
 *     the way the angles go.
 *  4. Editing a 3D clip: a 2D clip made 3D bakes back to itself; a bone turned in 3D keeps its 2D
 *     turns as `orient` keys; a bone the bake comes to own takes its 2D keys into the sidecar, so
 *     its motion survives the bake.
 *  5. Detach: the clip and its transitions leave the sidecar, the irig keeps the bake.
 */
import {
	AnimationState,
	AnimationStateData,
	AtlasAttachmentLoader,
	Physics,
	Skeleton,
	SkeletonJson,
	TextureAtlas,
	type Bone,
} from 'engine-rig';
import {
	anglesOf,
	bake2p5d,
	cornerError,
	keysAt,
	orientOf,
	pose3d,
	type Angles,
	type Frame3d,
	type Held3d,
	type QuatKey,
} from '../src/lib/rig2p5d.ts';
import { clipOf, rig3dIrigProblems, rigOf, withBake, type Rig3dDoc } from '../src/lib/rig3d.ts';
import {
	anglesAt,
	bakeClip3d,
	detachClip3d,
	editClip3d,
	ownedBones,
	sidecarAt,
	turnIn3d,
	viewPose,
	withAngles,
	type ViewPose,
} from '../src/lib/rig3dPose.ts';
import { REGIONS, irigOf, sidecarOf, withTransition } from './lib/rig3dFixture.ts';

let checks = 0;
let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
	checks++;
	if (ok) return;
	failures++;
	console.error(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
}

type Json = Record<string, unknown>;
const DEG = Math.PI / 180;
const BOUND = 1;

// ── The rig, baked as a save bakes it, and engine-rig to draw it ───────────────────────────────
const doc = sidecarOf('H');
const irig0 = irigOf();
const rig0 = rigOf(irig0, doc);
const plan0 = clipOf(rig0, irig0, doc, 'reach');
const irig = withBake(irig0, 'reach', plan0, bake2p5d(rig0, plan0.clip), ['hand_image']);
const rig = rigOf(irig, doc);
const plan = clipOf(rig, irig, doc, 'reach');

const atlas = new TextureAtlas(
	[
		'page.png',
		'size:1024,64',
		'filter:Linear,Linear',
		...REGIONS.flatMap((n, i) => [n, `bounds:${i * 64},0,64,64`]),
		'',
	].join('\n'),
);
atlas.setTextures(() => ({
	getImage: () => ({ width: 1, height: 1 }),
	setFilters() {},
	setWraps() {},
	dispose() {},
}));
const skeletonOf = (d: Json) => {
	const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(
		structuredClone(d),
	);
	return { data, skel: new Skeleton(data) };
};
const { data, skel } = skeletonOf(irig);

/** Pose the skeleton from the irig's clip at `t`, as the Rigger's playhead does. */
function playAt(s: Skeleton, d: typeof data, clip: string, t: number): void {
	s.setToSetupPose();
	const state = new AnimationState(new AnimationStateData(d));
	state.setAnimation(0, clip, false);
	state.update(t);
	state.apply(s);
}

/** What the page holds for the held pose: the sidecar's keys on the bones the bake owns, the skeleton's 2D pose on the rest. */
function heldAt(s: Skeleton, owned: string[], clip: string, t: number): Record<string, Held3d> {
	const held = sidecarAt(doc, clip, t);
	for (const b of s.bones) {
		const n = b.data.name;
		if (owned.includes(n)) continue;
		held[n] = {
			rotate: b.rotation - b.data.rotation,
			depth: 0,
			x: b.x - b.data.x,
			y: b.y - b.data.y,
			scaleX: b.data.scaleX ? b.scaleX / b.data.scaleX : 1,
			scaleY: b.data.scaleY ? b.scaleY / b.data.scaleY : 1,
		};
	}
	return held;
}

/** The page's `applyViewPose`: every keyed bone's local, the draw order, the drawings. */
function applyPose(s: Skeleton, pose: ViewPose): void {
	for (const [n, l] of Object.entries(pose.bones)) {
		const b = s.findBone(n);
		if (!b) continue;
		b.rotation = l.rotation;
		b.x = l.x;
		b.y = l.y;
		b.scaleX = l.scaleX;
		b.scaleY = l.scaleY;
		b.shearX = 0;
		b.shearY = l.shearY;
	}
	if (pose.order) s.drawOrder = pose.order.map((n) => s.findSlot(n)).filter((x) => x !== null);
	for (const [slot, a] of Object.entries(pose.attachments)) s.setAttachment(slot, a);
}

const mm = (p: number[], c: number[]) =>
	Array.from({ length: 9 }, (_, i) => {
		const r = (i / 3) | 0;
		const k = i % 3;
		return p[r * 3] * c[k] + p[r * 3 + 1] * c[3 + k] + p[r * 3 + 2] * c[6 + k];
	});
const ry = (deg: number) => {
	const c = Math.cos(deg * DEG);
	const s = Math.sin(deg * DEG);
	return [c, 0, s, 0, 1, 0, -s, 0, c];
};
const affineOf = (b: Bone) => ({ a: b.a, b: b.b, c: b.c, d: b.d, x: b.worldX, y: b.worldY });
const projected = (f: Frame3d) => ({
	a: f.m[0],
	b: f.m[1],
	c: f.m[3],
	d: f.m[4],
	x: f.o[0],
	y: f.o[1],
});
/** A world frame seen by a camera turned `deg` about the vertical through `pivot` (the root's origin). */
const turned = (f: Frame3d, deg: number, pivot: number[]): Frame3d => {
	const r = ry(deg);
	const o = f.o.map((v, k) => v - pivot[k]);
	return {
		m: mm(r, f.m),
		o: [0, 1, 2].map((k) => r[k * 3] * o[0] + r[k * 3 + 1] * o[1] + r[k * 3 + 2] * o[2] + pivot[k]),
	};
};
const cardOf = (n: string) => rig.bones.find((b) => b.name === n)?.card;
/** n_z of a frame's card normal: 1 facing the viewer. */
const facing = (m: number[]) => {
	const nx = m[3] * m[7] - m[6] * m[4];
	const ny = m[6] * m[1] - m[0] * m[7];
	const nz = m[0] * m[4] - m[3] * m[1];
	return nz / Math.hypot(nx, ny, nz);
};
const DRAWINGS = doc.views?.hand.drawings ?? [];

// ── 1. The turned view ──────────────────────────────────────────────────────────────────────────
let viewWorst = 0;
let viewWorstAt = '';
let drawingOk = true;
let drawingNote = '';
let views = 0;
const owned = plan.owned;
for (const t of [0, 0.5, 1, 1.4, 2])
	for (const deg of [0, 30, -45, 60, 90]) {
		playAt(skel, data, 'reach', t);
		const got = viewPose(rig, heldAt(skel, owned, 'reach', t), deg);
		if (!('pose' in got)) {
			check(`view: ${deg}° at ${t} s is posed`, false, got.problems.join('; '));
			continue;
		}
		views++;
		applyPose(skel, got.pose);
		skel.updateWorldTransform(Physics.update);
		const world = pose3d(rig, plan.clip, t);
		const pivot = world.get('root')?.o ?? [0, 0, 0];
		const handTurn = DRAWINGS.find((d) => d.attachment === got.pose.attachments.hand)?.turn ?? 0;
		for (const b of rig.bones) {
			const card = b.card;
			const f = world.get(b.follow ?? b.name);
			const bone = skel.findBone(b.name);
			if (!card || !f || !bone) continue;
			const target = turned(b.follow ? { m: mm(f.m, ry(handTurn)), o: f.o } : f, deg, pivot);
			const e = cornerError(affineOf(bone), projected(target), card);
			if (e > viewWorst) [viewWorst, viewWorstAt] = [e, `${b.name} @ ${t} s, ${deg}°`];
		}
		// The drawing that faces this camera best (a side turnaround: either face, the front on a tie).
		const hand = turned(world.get('hand') as Frame3d, deg, pivot);
		const score = (turn: number) => {
			const n = facing(mm(hand.m, ry(turn)));
			return Math.abs(n) + (n > 0 ? 1e-9 : 0);
		};
		const best = DRAWINGS.reduce((x, y) => (score(y.turn) > score(x.turn) ? y : x));
		if (score(best.turn) > score(handTurn) + 1e-6) {
			drawingOk = false;
			drawingNote = `${t} s, ${deg}°: shows ${got.pose.attachments.hand}, ${best.attachment} faces the camera better`;
		}
		if (skel.findSlot('hand')?.getAttachment()?.name !== got.pose.attachments.hand) {
			drawingOk = false;
			drawingNote = `${t} s, ${deg}°: engine-rig does not show the chosen drawing`;
		}
	}
check(`view: every turn and time is posed (${views} of 25)`, views === 25);
check(
	`view: engine-rig draws every card where the turned 3D pose projects it (worst ${viewWorst.toFixed(3)} rig units, ${viewWorstAt})`,
	viewWorst < BOUND,
);
check('view: the hand shows the drawing that faces the turned camera best', drawingOk, drawingNote);

// Seen from the side, depth is the stage's x: the forearm, 3 units in front of the arm's card,
// sits 3 units toward +x of where the flat rig would put it.
{
	playAt(skel, data, 'reach', 0);
	const side = viewPose(rig, heldAt(skel, owned, 'reach', 0), 90);
	const front = viewPose(rig, heldAt(skel, owned, 'reach', 0), 0);
	if ('pose' in side && 'pose' in front) {
		applyPose(skel, side.pose);
		skel.updateWorldTransform(Physics.update);
		const fa = skel.findBone('forearm') as Bone;
		const ua = skel.findBone('upper_arm') as Bone;
		const sideGap = fa.worldX - ua.worldX;
		check(
			'view: from the side, a bone set 3 units in front shows 3 units along the stage x',
			Math.abs(sideGap - 3) < 1e-3,
			`gap ${sideGap}`,
		);
	} else check('view: the side view is posed', false);
}

// The arm (on the rig's +x side, in front of the torso at 1 s) goes behind it once the view turns its
// +x side away from the camera.
{
	const orderAt = (deg: number) => {
		playAt(skel, data, 'reach', 1);
		const got = viewPose(rig, heldAt(skel, owned, 'reach', 1), deg);
		return 'pose' in got ? (got.pose.order ?? rig.slots.map((s) => s.name)) : [];
	};
	const before = (o: string[]) => o.indexOf('upper_arm') < o.indexOf('torso');
	check(
		'view: the draw order follows depth as the view turns (the arm goes behind the torso)',
		!before(orderAt(0)) && before(orderAt(90)),
		JSON.stringify([orderAt(0), orderAt(90)]),
	);
}

// A rig whose root sits turned in its setup turns about the vertical all the same, and a live
// constraint (the save refuses one on a 3D clip's bones) does not stop the view from turning.
{
	const tilted = structuredClone(irig);
	(tilted.bones as Json[])[0].rotation = 30;
	tilted.transform = [
		{ name: 'lean', order: 0, bones: ['chest'], target: 'root', mixRotate: 1, mixX: 0, mixY: 0 },
	];
	const rigT = rigOf(tilted, doc);
	const planT = clipOf(rigT, tilted, doc, 'reach');
	const { data: dT, skel: sT } = skeletonOf(tilted);
	let worst = 0;
	let posed = 0;
	for (const deg of [35, -70]) {
		playAt(sT, dT, 'reach', 0.5);
		const got = viewPose(rigT, heldAt(sT, planT.owned, 'reach', 0.5), deg);
		if (!('pose' in got)) continue;
		posed++;
		applyPose(sT, got.pose);
		// Measured with the constraint off: it writes over the timelines, here as in a game.
		for (const c of sT.transformConstraints)
			c.mixRotate = c.mixX = c.mixY = c.mixScaleX = c.mixScaleY = c.mixShearY = 0;
		sT.updateWorldTransform(Physics.update);
		const world = pose3d(rigT, planT.clip, 0.5);
		const pivot = world.get('root')?.o ?? [0, 0, 0];
		for (const n of ['chest', 'upper_arm', 'forearm', 'hand']) {
			const card = rigT.bones.find((b) => b.name === n)?.card;
			const bone = sT.findBone(n);
			if (!card || !bone) continue;
			worst = Math.max(
				worst,
				cornerError(affineOf(bone), projected(turned(world.get(n) as Frame3d, deg, pivot)), card),
			);
		}
	}
	check('view: a rig with a live constraint still turns', posed === 2);
	check(
		`view: a root turned 30° in its setup turns about the vertical (worst ${worst.toFixed(3)} rig units)`,
		posed === 2 && worst < BOUND,
	);
}

// A keyed depth is seen from the side as well as a set one: the forearm keyed 10 further forward.
{
	playAt(skel, data, 'reach', 0);
	const held = heldAt(skel, owned, 'reach', 0);
	held.forearm = { ...held.forearm, depth: 10 };
	const side = viewPose(rig, held, 90);
	if ('pose' in side) {
		applyPose(skel, side.pose);
		skel.updateWorldTransform(Physics.update);
		const gap =
			(skel.findBone('forearm') as Bone).worldX - (skel.findBone('upper_arm') as Bone).worldX;
		check(
			'view: from the side, a keyed depth shows too (3 set + 10 keyed)',
			Math.abs(gap - 13) < 1e-3,
			`gap ${gap}`,
		);
	} else check('view: the side view with a keyed depth is posed', false);
}

// The held pose is the authority for every bone the sidecar keys, also one the bake passes through
// (keyed in the sidecar, flat in its parent's card): the stage's own pose of it may be a stale bake.
{
	const walked: Rig3dDoc = structuredClone(doc);
	const reach = walked.clips?.reach;
	if (reach)
		reach.bones.root = {
			translate: [
				{ time: 0, x: 0, y: 0 },
				{ time: 2, x: 30, y: 0 },
			],
		};
	const ownedW = ownedBones(irig, walked, 'reach');
	playAt(skel, data, 'reach', 1);
	const held = heldAt(skel, ownedW, 'reach', 1);
	Object.assign(held, sidecarAt(walked, 'reach', 1));
	(skel.findBone('root') as Bone).x += 50;
	const got = viewPose(rig, held, 0);
	if ('pose' in got) {
		applyPose(skel, got.pose);
		skel.updateWorldTransform(Physics.update);
		const root = skel.findBone('root') as Bone;
		check(
			'view: a bone the sidecar keys and the bake passes through is put back where its keys hold it',
			ownedW.includes('root') && !got.pose.baked.includes('root') && Math.abs(root.x - 15) < 1e-6,
			`root.x ${root.x}, owned ${ownedW.join()}`,
		);
	} else check('view: the walked rig is posed', false);
}

// ── 2. View 0 is the clip's own pose ────────────────────────────────────────────────────────────
{
	const { data: d2, skel: played } = skeletonOf(irig);
	let worst = 0;
	let worstAt = '';
	let heldWorst = 0;
	let matched = 0;
	for (let i = 0; i <= 40; i++) {
		const t = i / 20;
		playAt(played, d2, 'reach', t);
		played.updateWorldTransform(Physics.update);
		playAt(skel, data, 'reach', t);
		const got = viewPose(rig, heldAt(skel, owned, 'reach', t), 0);
		if (!('pose' in got)) continue;
		applyPose(skel, got.pose);
		skel.updateWorldTransform(Physics.update);
		const world = pose3d(rig, plan.clip, t);
		const handTurn = DRAWINGS.find((x) => x.attachment === got.pose.attachments.hand)?.turn ?? 0;
		// Paused, the hand shows the drawing that faces the viewer best now; playing, the clip's swap
		// waits out its margin and hold — the image bone is then turned back by another drawing's angle.
		const sameDrawing =
			played.findSlot('hand')?.getAttachment()?.name === got.pose.attachments.hand;
		if (sameDrawing) matched++;
		for (const n of owned) {
			const card = cardOf(n);
			const a = skel.findBone(n);
			const b = played.findBone(n);
			if (!card || !a || !b) continue;
			const e =
				n === 'hand_image' && !sameDrawing ? 0 : cornerError(affineOf(a), affineOf(b), card);
			if (e > worst) [worst, worstAt] = [e, `${n} @ ${t} s`];
			const f = world.get(n === 'hand_image' ? 'hand' : n) as Frame3d;
			const target = n === 'hand_image' ? { m: mm(f.m, ry(handTurn)), o: f.o } : f;
			heldWorst = Math.max(heldWorst, cornerError(affineOf(a), projected(target), card));
		}
	}
	check(
		`view 0: the held pose is the 3D pose itself (worst ${heldWorst.toFixed(4)} rig units)`,
		heldWorst < 0.01,
	);
	check(
		`view 0: and within the bake's bound of what engine-rig plays from the clip's bake (worst ${worst.toFixed(3)}, ${worstAt})`,
		worst < BOUND,
	);
	check(
		`view 0: paused and playing show the same drawing nearly all clip long (${matched} of 41 times)`,
		matched >= 36,
	);
}

// ── 3. Angles over quaternions ──────────────────────────────────────────────────────────────────
{
	let rng = 7;
	const rand = () => ((rng = (rng * 16807) % 2147483647) / 2147483647) * 2 - 1;
	let worst = 0;
	for (let i = 0; i < 200; i++) {
		const a0: Angles = { rotate: rand() * 170, tilt: rand() * 80, twist: rand() * 170 };
		const a1: Angles = {
			rotate: a0.rotate + rand() * 80,
			tilt: a0.tilt + rand() * 80,
			twist: a0.twist + rand() * 80,
		};
		let keys = withAngles([], 0, a0);
		keys = withAngles(keys, 1, a1);
		const back = anglesAt(keys, 1);
		const off = Math.max(
			Math.abs(back.rotate - a1.rotate),
			Math.abs(back.tilt - a1.tilt),
			Math.abs(back.twist - a1.twist),
		);
		worst = Math.max(worst, off);
	}
	check(
		`angles: 200 random keys read back their angles (worst ${worst.toExponential(1)}°)`,
		worst < 1e-6,
	);

	const near = (a: Angles, b: Angles) =>
		Math.abs(a.rotate - b.rotate) < 1e-6 &&
		Math.abs(a.tilt - b.tilt) < 1e-6 &&
		Math.abs(a.twist - b.twist) < 1e-6;
	let k = withAngles([], 0, { rotate: 0, tilt: 0, twist: 0 });
	k = withAngles(k, 1, { rotate: 270, tilt: 0, twist: 0 });
	check(
		'angles: a 270° turn is split so the slerp goes the long way, and reads back 270°',
		k.length === 3 && near(anglesAt(k, 1), { rotate: 270, tilt: 0, twist: 0 }),
		JSON.stringify(k.map((x) => [x.time, anglesOf(x.value)])),
	);
	const quarter = anglesAt(k, 0.25);
	check(
		'angles: a quarter of the way through, the bone has turned 67.5° (not the short way, −22.5°)',
		Math.abs(quarter.rotate - 67.5) < 1e-6,
		JSON.stringify(quarter),
	);
	k = withAngles(k, 1, { rotate: 400, tilt: 0, twist: 0 });
	check(
		'angles: a roll keeps counting past 360°',
		Math.abs(anglesAt(k, 1).rotate - 400) < 1e-6,
		JSON.stringify(anglesAt(k, 1)),
	);
	let tilt = withAngles([], 0, { rotate: 10, tilt: 80, twist: 0 });
	tilt = withAngles(tilt, 1, { rotate: 10, tilt: 105, twist: 0 });
	check(
		'angles: a tilt past 90° reads as 105°, not its mirror (75° with rotate and twist turned 180°)',
		near(anglesAt(tilt, 1), { rotate: 10, tilt: 105, twist: 0 }),
		JSON.stringify(anglesAt(tilt, 1)),
	);
	const curved: QuatKey[] = [
		{ time: 0, value: orientOf(0, 0, 0), curve: [0.3, 0.1, 0.7, 0.9] },
		{ time: 1, value: orientOf(40, 0, 0) },
	];
	const edited = withAngles(curved, 0, { rotate: 5, tilt: 20, twist: 0 });
	check(
		"angles: editing a key's angles rewrites its quaternion and keeps its curve",
		edited.length === 2 &&
			JSON.stringify(edited[0].curve) === JSON.stringify(curved[0].curve) &&
			near(anglesOf(edited[0].value), { rotate: 5, tilt: 20, twist: 0 }),
		JSON.stringify(edited[0]),
	);
	const mid = keysAt({ orient: edited }, 0.5).orient;
	check(
		"angles: an edited key's run still slerps (the pose between keys is a unit quaternion)",
		mid !== undefined && Math.abs(Math.hypot(...mid) - 1) < 1e-9,
	);
}

// ── 4. Editing a 3D clip ────────────────────────────────────────────────────────────────────────
{
	// `idle` is a 2D clip: the chest sways 0° → 5°. Here the forearm (set 3 units in front of the arm)
	// also lifts in 2D, so a bone with 2D keys comes to be owned once the chest turns in 3D.
	const LIFT = [
		{ time: 0, x: 0, y: 0 },
		{ time: 1, x: 0, y: 30 },
	];
	const idleOf = (lift: boolean): Json => {
		const out = structuredClone(irig);
		((out.animations as Json).idle as Json).bones = {
			chest: {
				rotate: [
					{ time: 0, value: 0 },
					{ time: 1, value: 5 },
				],
			},
			...(lift ? { forearm: { translate: structuredClone(LIFT) } } : {}),
		};
		return out;
	};
	const plain = { ...doc, clips: {} } as Rig3dDoc;
	/** `idle` made 3D, then its chest tilted 20° at 0.5 s, then baked. */
	const tiltIdle = (base: Json) => {
		const made = editClip3d({ irig: base, doc: plain, clip: 'idle', edit: () => {} });
		const madeIrig = {
			...base,
			animations: { ...(base.animations as Json), idle: made.animation },
		};
		const tilted = editClip3d({
			irig: madeIrig,
			doc: made.doc,
			clip: 'idle',
			edit: (anim, keys) => {
				const orient = turnIn3d(anim, keys, 'chest');
				keys.chest.orient = withAngles(orient, 0.5, { rotate: 2.5, tilt: 20, twist: 0 });
			},
		});
		const irigOut = {
			...madeIrig,
			animations: { ...(madeIrig.animations as Json), idle: tilted.animation },
		};
		return {
			made,
			madeIrig,
			tilted,
			tIrig: irigOut,
			baked: bakeClip3d(irigOut, tilted.doc, 'idle'),
		};
	};
	const base = idleOf(true);
	const { made, madeIrig, tilted, tIrig, baked } = tiltIdle(base);
	const back = bakeClip3d(madeIrig, made.doc, 'idle');
	const bonesOf = (d: Json) => ((d.animations as Json).idle as Json).bones as Json;
	check(
		'edit: 3D from this clip keeps its 2D keys, and it bakes back to the same clip',
		made.doc.clips?.idle !== undefined &&
			JSON.stringify(bonesOf(back.irig)) === JSON.stringify(bonesOf(base)),
		JSON.stringify([bonesOf(back.irig), bonesOf(base)]),
	);
	check(
		'edit: a 3D clip with no 3D keys owns only what was 3D before (the follower)',
		JSON.stringify(ownedBones(madeIrig, made.doc, 'idle')) === JSON.stringify(['hand_image']),
		JSON.stringify(ownedBones(madeIrig, made.doc, 'idle')),
	);
	const chest = tilted.doc.clips?.idle.bones.chest;
	check(
		'edit: a bone turned in 3D keys orient, its 2D turns kept as orient keys (0° at 0 s, 5° at 1 s)',
		!chest?.rotate &&
			chest?.orient?.length === 3 &&
			Math.abs(anglesAt(chest.orient, 1).rotate - 5) < 1e-9 &&
			Math.abs(anglesAt(chest.orient, 0.5).tilt - 20) < 1e-9,
		JSON.stringify(chest),
	);
	check(
		'edit: a bone the bake comes to own (the forearm, at depth under the turned chest) takes its 2D keys into the sidecar',
		JSON.stringify(tilted.doc.clips?.idle.bones.forearm?.translate) === JSON.stringify(LIFT),
		JSON.stringify(tilted.doc.clips?.idle.bones.forearm),
	);
	check(
		'edit: a bone lying flat under the turned chest (the upper arm) keeps its keys in the irig',
		!tilted.doc.clips?.idle.bones.upper_arm,
	);
	const { data: d3, skel: s3 } = skeletonOf(baked.irig);
	const rig3 = rigOf(baked.irig, tilted.doc);
	const plan3 = clipOf(rig3, baked.irig, tilted.doc, 'idle');
	let worst = 0;
	for (let i = 0; i <= 20; i++) {
		const t = i / 20;
		playAt(s3, d3, 'idle', t);
		s3.updateWorldTransform(Physics.update);
		const world = pose3d(rig3, plan3.clip, t);
		for (const n of ['chest', 'upper_arm', 'forearm']) {
			const b = s3.findBone(n);
			const card = rig3.bones.find((x) => x.name === n)?.card;
			if (!b || !card) continue;
			worst = Math.max(worst, cornerError(affineOf(b), projected(world.get(n) as Frame3d), card));
		}
	}
	check(
		`edit: the edited clip bakes within the bound of its 3D pose (worst ${worst.toFixed(3)})`,
		worst < BOUND,
	);
	// The same edit on a forearm that never lifted: at 1 s the two forearms are 30 units apart.
	const still = tiltIdle(idleOf(false)).baked.irig;
	const { data: d4, skel: s4 } = skeletonOf(still);
	playAt(s3, d3, 'idle', 1);
	s3.updateWorldTransform(Physics.update);
	playAt(s4, d4, 'idle', 1);
	s4.updateWorldTransform(Physics.update);
	const fa = s3.findBone('forearm') as Bone;
	const fb = s4.findBone('forearm') as Bone;
	const lift = Math.hypot(fa.worldX - fb.worldX, fa.worldY - fb.worldY);
	check(
		`edit: the forearm's 2D lift survives the bake (${lift.toFixed(2)} units at 1 s, 30 keyed)`,
		Math.abs(lift - 30) < 1,
	);
	// A pose: a clip keyed only at 0 s is held for one check, so it bakes (and the save takes it).
	const pose = editClip3d({
		irig: base,
		doc: plain,
		clip: 'take',
		edit: (_anim, keys) => {
			keys.upper_arm = { orient: withAngles([], 0, { rotate: 0, tilt: 50, twist: 0 }) };
		},
	});
	const poseIrig = { ...base, animations: { ...(base.animations as Json), take: pose.animation } };
	const poseBake = (() => {
		try {
			return bakeClip3d(poseIrig, pose.doc, 'take').bake.baked.includes('upper_arm');
		} catch (e) {
			return (e as Error).message;
		}
	})();
	check(
		'edit: a pose keyed only at 0 s is held one check long, so it bakes',
		(pose.doc.clips?.take.duration ?? 0) > 0 && poseBake === true,
		JSON.stringify([pose.doc.clips?.take.duration, poseBake]),
	);
	check(
		'edit: the edited clip and its 3D data fit the rig (as the save checks them)',
		rig3dIrigProblems(tilted.doc, baked.irig).length === 0 && baked.plan.problems.length === 0,
		rig3dIrigProblems(tilted.doc, baked.irig).join('; '),
	);
	const both = (() => {
		try {
			editClip3d({
				irig: tIrig,
				doc: tilted.doc,
				clip: 'idle',
				edit: (anim) => {
					((anim.bones as Json).chest as Json) = { rotate: [{ time: 0, value: 1 }] };
				},
			});
			return '';
		} catch (e) {
			return (e as Error).message;
		}
	})();
	check(
		'edit: a bone keying both a 3D turn and a 2D rotate is refused',
		/both a 3D turn and a 2D rotate/.test(both),
		both,
	);
}

// ── 5. Detach ───────────────────────────────────────────────────────────────────────────────────
{
	const tdoc = withTransition(doc, 'end');
	const { doc: d, detached } = detachClip3d(tdoc, 'reach');
	check(
		'detach: the clip and every transition from or to it leave the 3D data',
		JSON.stringify(detached) === JSON.stringify(['reach', 'reach_to_wave']) &&
			Object.keys(d.clips ?? {}).join() === 'wave',
		JSON.stringify(detached),
	);
	check(
		'detach: what is left still fits the rig, whose clip keeps its baked keys',
		rig3dIrigProblems(d, irig).length === 0 &&
			JSON.stringify(ownedBones(irig, d, 'reach')) === '[]',
		rig3dIrigProblems(d, irig).join('; '),
	);
	check(
		"detach: the held pose of a detached clip is the irig's alone (no sidecar keys)",
		Object.keys(sidecarAt(d, 'reach', 1)).length === 0,
	);
}

console.log(`${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
