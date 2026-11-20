/**
 * The Rigger's stage for a 2.5D rig (docs/design/rig-2p5d.md §9, P3b), offline, on the shipped
 * module (`src/lib/rig3dView.ts`, the page's `vendor/rigger-2p5d.js`):
 *   pnpm --filter launcher-api check:rig3d-view
 *
 *  1. The turned view: the rig held at its pose at the playhead and seen by a camera turned about
 *     the vertical, as `viewPose` keys it and engine-rig draws it, puts every card where the turned
 *     3D pose projects it (an independent projection: the gate's own matrices), shows the drawing
 *     that faces that camera best and orders the slots by depth; a set and a keyed depth seen from
 *     the side, a root turned in its setup, a live constraint, a bone the bake passes through.
 *  2. At view 0 the held pose is the clip's own: within the bake's bound of what engine-rig plays
 *     from the clip's bake at the same time.
 *  3. The gizmo in 3D: a ring turns the bone about its own axis (along its length) or the stage's,
 *     an arrow moves it along its own axis or the stage's (the depth arrow too), on the rig as drawn —
 *     turned by the view, under a parent turned in 3D and scaled; its frames are where the stage
 *     draws the bones; a ring seen edge-on is kept round enough to grab, and a drag keeps the grabbed
 *     point under the cursor.
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
	anglesAlong,
	anglesOf,
	bake2p5d,
	cornerError,
	orientAlong,
	orientOf,
	pose3d,
	type Frame3d,
} from '../src/lib/rig2p5d.ts';
import { clipOf, rigOf, withBake, type Rig3dDoc } from '../src/lib/rig3d.ts';
import {
	alongAxis,
	gizmoAxes3d,
	heldFrames,
	heldOf,
	moveBone,
	ringNearest,
	ringOnScreen,
	ringFollow,
	rotationOf,
	turnBone,
	viewFrame,
	viewPose,
	type Held3d,
	type ViewPose,
} from '../src/lib/rig3dView.ts';
import { REGIONS, irigOf, sidecarOf } from './lib/rig3dFixture.ts';

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

/** A clip's 3D keys held at `t`, per bone the 3D data keys (what the page reads from it). */
const sidecarAt = (d: Rig3dDoc, clip: string, t: number): Record<string, Held3d> =>
	Object.fromEntries(
		Object.entries(d.clips?.[clip]?.bones ?? {}).map(([b, k]) => [b, heldOf(k, t)]),
	);
/** What the page holds for the held pose: the 3D keys on the bones the bake owns, the skeleton's 2D pose on the rest. */
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
	const ownedW = clipOf(rigOf(irig, walked), irig, walked, 'reach').owned;
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

// ── 3. The gizmo in 3D ──────────────────────────────────────────────────────────────────────────
{
	const near = (a: readonly number[], b: readonly number[], eps = 1e-9) =>
		a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < eps);
	const mm3 = (p: readonly number[], c: readonly number[]) =>
		Array.from({ length: 9 }, (_, i) => {
			const r = (i / 3) | 0;
			const k = i % 3;
			return p[r * 3] * c[k] + p[r * 3 + 1] * c[3 + k] + p[r * 3 + 2] * c[6 + k];
		});
	/** The gate's own turn of `deg` about unit `axis` (Rodrigues). */
	const rot = (axis: readonly number[], deg: number) => {
		const [x, y, z] = axis;
		const c = Math.cos(deg * DEG);
		const s = Math.sin(deg * DEG);
		const k = 1 - c;
		return [
			c + x * x * k,
			x * y * k - z * s,
			x * z * k + y * s,
			y * x * k + z * s,
			c + y * y * k,
			y * z * k - x * s,
			z * x * k - y * s,
			z * y * k + x * s,
			c + z * z * k,
		];
	};
	// The arm keyed in 3D, under a chest turned in 3D and drawn wider (unevenly, in 3D), the view turned 30°.
	const scaled = structuredClone(rig);
	const chestBone = scaled.bones.find((b) => b.name === 'chest');
	if (chestBone) chestBone.scaleX = 1.3;
	const VIEW = 30;
	const held = (arm: Held3d): Record<string, Held3d> => ({
		chest: { orient: orientOf(10, 25, 5), depth: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 },
		upper_arm: arm,
	});
	const q0 = orientOf(30, 20, 10);
	const arm0: Held3d = { orient: q0, depth: 4, x: 3, y: -2, scaleX: 1, scaleY: 1 };
	const f0 = heldFrames(scaled, held(arm0), VIEW);
	const armF = f0.get('upper_arm') as Frame3d;
	const chestF = f0.get('chest') as Frame3d;
	const setup = scaled.bones.find((b) => b.name === 'upper_arm')?.rotate ?? 0;
	const AXES = [
		['x', [1, 0, 0]],
		['y', [0, 1, 0]],
		['z', [0, 0, 1]],
	] as const;
	let turnOk = true;
	let turnNote = '';
	for (const space of ['local', 'view'] as const) {
		const axes = gizmoAxes3d(armF.m, space, VIEW);
		for (const [k] of AXES) {
			const q = turnBone(q0, setup, chestF.m, axes[k], 23);
			const f = heldFrames(scaled, held({ ...arm0, orient: q }), VIEW).get('upper_arm') as Frame3d;
			const want = mm3(rot(axes[k], 23), rotationOf(armF.m));
			if (!near(rotationOf(f.m), want, 1e-9) || !near(f.o, armF.o, 1e-9)) {
				turnOk = false;
				turnNote = `${space} ${k}: ${JSON.stringify(rotationOf(f.m).map((v) => +v.toFixed(4)))} vs ${JSON.stringify(want.map((v) => +v.toFixed(4)))}`;
			}
		}
	}
	check(
		'gizmo: each ring turns the bone 23° about its own axis or the stage’s, as drawn (a parent turned in 3D and scaled, the view turned)',
		turnOk,
		turnNote,
	);
	// The frames the gizmo works on are where the stage draws the bones: the held pose turned by the view.
	{
		playAt(skel, data, 'reach', 1);
		const heldNow = heldAt(skel, owned, 'reach', 1);
		const got = viewPose(rig, heldNow, VIEW);
		let worst = 0;
		if ('pose' in got) {
			applyPose(skel, got.pose);
			skel.updateWorldTransform(Physics.update);
			const frames = heldFrames(rig, heldNow, VIEW);
			for (const b of rig.bones) {
				if (b.follow) continue;
				const f = frames.get(b.name);
				const bone = skel.findBone(b.name);
				if (f && bone)
					worst = Math.max(worst, Math.hypot(bone.worldX - f.o[0], bone.worldY - f.o[1]));
			}
		}
		check(
			`gizmo: its frames are where the stage draws each bone, the view turned (worst ${worst.toFixed(4)} rig units)`,
			'pose' in got && worst < 0.01,
		);
	}
	// A bone whose length runs along its −y (a template's): its local x arrow lies along its length, its
	// twist ring turns it about its length and its tilt ring brings its tip toward the viewer.
	{
		const along = -90;
		const ax = gizmoAxes3d([1, 0, 0, 0, 1, 0, 0, 0, 1], 'local', 0, along);
		const twisted = turnBone(orientOf(0, 0, 0), 0, viewFrame(0), ax.x, 25);
		const tipped = turnBone(orientOf(0, 0, 0), 0, viewFrame(0), [-ax.y[0], -ax.y[1], -ax.y[2]], 25);
		const tw = anglesAlong(twisted, along);
		const ti = anglesAlong(tipped, along);
		check(
			'gizmo: on a bone lying along −y, local x is its length; the twist ring twists it, the tilt ring tilts it (in the bone panel’s terms)',
			Math.abs(ax.x[1] + 1) < 1e-12 &&
				Math.abs(tw.twist - 25) < 1e-9 &&
				Math.abs(tw.tilt) < 1e-9 &&
				Math.abs(ti.tilt - 25) < 1e-9 &&
				Math.abs(ti.twist) < 1e-9,
			JSON.stringify({ x: ax.x, tw, ti }),
		);
		check(
			'gizmo: …and the turn it keys is the one the bone panel keys (`orientAlong`)',
			(() => {
				const p = orientAlong(0, 25, 0, along);
				const s = p.reduce((sum, v, i) => sum + v * tipped[i], 0) < 0 ? -1 : 1;
				return Math.max(...p.map((v, i) => Math.abs(v - s * tipped[i]))) < 1e-12;
			})(),
		);
	}
	// The local turn about the bone's own −y is its tilt (the tip toward the viewer).
	const tilted = turnBone(orientOf(0, 0, 0), 0, viewFrame(0), [0, -1, 0], 40);
	check(
		'gizmo: a turn of 40° about the bone’s own −y is a tilt of 40° (its tip toward the viewer)',
		Math.abs(anglesOf(tilted).tilt - 40) < 1e-9 && Math.abs(anglesOf(tilted).rotate) < 1e-9,
		JSON.stringify(anglesOf(tilted)),
	);
	let moveOk = true;
	let moveNote = '';
	for (const space of ['local', 'view'] as const) {
		const axes = gizmoAxes3d(armF.m, space, VIEW);
		for (const [k] of AXES) {
			const off = moveBone(chestF.m, axes[k], 17);
			const moved: Held3d = {
				...arm0,
				x: arm0.x + off[0],
				y: arm0.y + off[1],
				depth: arm0.depth + off[2],
			};
			const f = heldFrames(scaled, held(moved), VIEW).get('upper_arm') as Frame3d;
			const want = armF.o.map((v, i) => v + 17 * axes[k][i]);
			if (!near(f.o, want, 1e-9)) {
				moveOk = false;
				moveNote = `${space} ${k}: ${JSON.stringify(f.o)} vs ${JSON.stringify(want)}`;
			}
		}
	}
	check(
		'gizmo: each arrow moves the bone 17 along its own axis or the stage’s, as drawn (x, y and depth offsets in the parent’s frame)',
		moveOk,
		moveNote,
	);
	const rootMove = moveBone(viewFrame(VIEW), [1, 0, 0], 10);
	check(
		'gizmo: a root’s drawn parent is the view: a move along the stage’s x is x and depth in the rig',
		near(rootMove, [10 * Math.cos(VIEW * DEG), 0, 10 * Math.sin(VIEW * DEG)], 1e-9),
		JSON.stringify(rootMove),
	);
	check(
		'gizmo: at the front view the stage’s depth arrow points at the viewer (not dragged); turned, it shows',
		alongAxis(gizmoAxes3d(armF.m, 'view', 0).z, [5, 5]) === null &&
			alongAxis(gizmoAxes3d(armF.m, 'view', VIEW).z, [5, 0]) !== null,
	);
	check(
		'gizmo: a drag along an arrow drawn at half its length keeps the point under the cursor (10 along → 20 along the axis)',
		Math.abs((alongAxis([0.5, 0, Math.sqrt(0.75)], [10, 7]) ?? 0) - 20) < 1e-9,
	);
	const at = (u: number, m: number[]) => [
		m[0] * Math.cos(u) + m[1] * Math.sin(u),
		m[2] * Math.cos(u) + m[3] * Math.sin(u),
	];
	const circle = ringOnScreen([0, 0, 1], 50);
	check(
		'gizmo: a ring about the view axis is drawn a circle of its radius',
		[0, 1, 2, 3].every((k) => Math.abs(Math.hypot(...at(k, circle)) - 50) < 1e-9),
	);
	const edge = ringOnScreen([1, 0, 0], 50);
	const extent = (m: number[], dir: number[]) =>
		Math.max(
			...Array.from({ length: 360 }, (_, k) => {
				const p = at((k * Math.PI) / 180, m);
				return p[0] * dir[0] + p[1] * dir[1];
			}),
		);
	check(
		'gizmo: a ring seen edge-on (about the stage’s x) is drawn a thin ellipse along its line, a quarter as wide as long',
		Math.abs(extent(edge, [0, 1]) - 50) < 1e-6 && Math.abs(extent(edge, [1, 0]) - 12.5) < 1e-6,
		JSON.stringify([extent(edge, [0, 1]), extent(edge, [1, 0])]),
	);
	const slant = [0.3, 0.5, Math.sqrt(1 - 0.34)];
	const sm = ringOnScreen(slant, 50);
	check(
		'gizmo: a ring seen slanted is drawn as it projects (each drawn point the drawing of a point of the 3D ring)',
		Array.from({ length: 24 }, (_, k) => {
			const p = at((k * Math.PI) / 12, sm);
			const z = -(slant[0] * p[0] + slant[1] * p[1]) / slant[2];
			return Math.abs(Math.hypot(p[0], p[1], z) - 50) < 1e-6;
		}).every(Boolean),
	);
	// Dragged a degree at a time along its drawing from the point grabbed (the cursor a little off the
	// ring on the way, as whole pixels put it), a ring turns as far as it is dragged to: 30°.
	for (const [label, m] of [
		['round', circle],
		['edge-on', edge],
		['slanted', sm],
	] as const) {
		const grab = ringNearest(m, at(0.4, m));
		let u = grab.u;
		for (let k = 1; k <= 30; k++) {
			const p = at(0.4 + (k * Math.PI) / 180, m);
			const off = k < 30 ? [k % 2 ? 0.4 : -0.4, -0.3] : [0, 0];
			u = ringFollow(m, u, [p[0] + off[0], p[1] + off[1]]);
		}
		const total = ((u - grab.u) * 180) / Math.PI;
		check(
			`gizmo: a ${label} ring dragged 30° along its drawing turns 30° (${total.toFixed(3)}°)`,
			Math.abs(total - 30) < 0.5 && grab.dist < 1e-6,
		);
	}
	// The way a drawn ring turns is the way its 3D ring turns the bone: +u is a right-hand turn.
	const u0 = 0.7;
	const p0 = at(u0, sm);
	const p1 = at(u0 + 0.01, sm);
	const q3 = (p: number[]) => [p[0], p[1], -(slant[0] * p[0] + slant[1] * p[1]) / slant[2]];
	const turnedP = rot(slant, 0.01 / DEG);
	const by = q3(p0);
	const want1 = [0, 1, 2].map(
		(r) => turnedP[r * 3] * by[0] + turnedP[r * 3 + 1] * by[1] + turnedP[r * 3 + 2] * by[2],
	);
	check(
		'gizmo: a drawn ring’s +angle is a right-hand turn about its axis (the bone turns the way the ring is dragged)',
		near(q3(p1), want1, 1e-6),
		JSON.stringify([q3(p1), want1]),
	);
}

console.log(`${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
