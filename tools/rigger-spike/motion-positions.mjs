// Verify following positions in the 🎥 Motion import (rig-templates §5.8) headlessly, on the SHIPPED
// code: the solve (`rigMotion.ts`, `rigMotion3d.ts`, `rig3dMath.ts`), the real `half-body`,
// `full-body` and `bust-face` templates, the page's own keying (`faceKeyMotion`) and reference line-up
// (`motionRefFit`) pulled out of view.html, the import and its bake (`rig3dImport.ts`), the result read
// by engine-rig — what the GAME shows. The track is the synthetic performer of `performer3d.mjs`, its
// picture moved, bobbed and brought nearer, leaning, its arms longer than the rig's, its face placed
// off its neck. Asserted, in rig units (the shoulders are 280 apart):
//  - without following (Angles only) the rig is off the performer: the precondition that makes the
//    rest mean something;
//  - with it, as the game poses the clip: the shoulders' middle on the performer's; each hand on the
//    wrist of the hand found on it; the eyes' and the mouth's middles on the face across the neck
//    (the neck bends; its base stays on the torso); each elbow bent to
//    the tracked elbow's side and within reach of it; a forearm held toward the camera still drawn in
//    front of the body;
//  - a wrist further than the arm reaches turns the arm as tracked (and is reported); a face further
//    to the side than the neck bends holds the bend at its limit (and is reported);
//  - only the limbs' and the neck's turns change: every other bone's 3D keys are the Angles-only
//    import's; the root's keys are ordinary 2D translates, the neck's translate held at its setup; the
//    Rigger's Animate pose is the game's;
//  - Full body's feet land on the ankles; a Bust's face lands on the face;
//  - the validator refuses a positions map it cannot place a rig with.
//   node tools/rigger-spike/motion-positions.mjs
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESBUILD } from './esbuild.mjs';
import * as P from './performer3d.mjs';
import { RIG_CORE } from './rig.mjs';

const ROOT = new URL('../../', import.meta.url);
const APP = fileURLToPath(new URL('apps/launcher-api/', ROOT));
const esbuild = await import(ESBUILD);
const RIG = await import(RIG_CORE);
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton, AnimationState } = RIG;
const { AnimationStateData, Physics } = RIG;

const dir = mkdtempSync(join(tmpdir(), 'motion-positions-'));
const bundle = async (entry, name) => {
	const out = join(dir, name);
	await esbuild.build({
		entryPoints: [join(APP, entry)],
		bundle: true,
		format: 'esm',
		platform: 'node',
		outfile: out,
		nodePaths: [join(APP, 'node_modules')],
		logLevel: 'error',
	});
	return import(pathToFileURL(out).href);
};
const T = await bundle('src/lib/server/rigTemplates.ts', 'templates.mjs');
const { solveMotion } = await bundle('src/lib/rigMotion.ts', 'motion.mjs');
const I = await bundle('src/lib/rig3dImport.ts', 'import.mjs');

const html = readFileSync(join(APP, 'static/rigger/view.html'), 'utf8');
const src = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
	.map((m) => m[1])
	.join('\n');
function grabFn(name) {
	const at = src.indexOf(`\nfunction ${name}(`);
	if (at === -1) throw new Error(`view.html has no function ${name}`);
	let depth = 0;
	let j = src.indexOf('{', at);
	for (; j < src.length; j++) {
		if (src[j] === '{') depth++;
		else if (src[j] === '}' && --depth === 0) break;
	}
	return src.slice(at, j + 1);
}
function grabConst(name) {
	const m = src.match(new RegExp(`\\nconst ${name} = [^\\n]*`));
	if (!m) throw new Error(`view.html has no const ${name}`);
	return m[0];
}
const F = new Function(
	[
		...['roundN', 'FACE_TIMELINE', 'FACE_FIELD', 'faceClamp'].map(grabConst),
		...[
			'bezierValue',
			'sampleChannel',
			'upsertKey',
			'upsertBoneKey',
			'faceSwapPart',
			'faceOrderStep',
			'faceOrderAt',
			'faceOrderOffsets',
			'drawOrderOfOffsets',
			'faceOrderOfKey',
			'faceOrderValue',
			'faceOrderKeyAt',
			'faceOrderValues',
			'faceKeyOrder',
			'faceAttachmentAt',
			'faceKeyAttachment',
			'faceChannelValue',
			'faceKeyChannel',
			'faceShapePart',
			'faceShapeControls',
			'faceKeyShape',
			'faceKeyMotion',
			'face3dReplaced',
			'motionLineUp',
		].map(grabFn),
		'return { faceKeyMotion, face3dReplaced, motionLineUp };',
	].join('\n'),
)();
/** The page's reference line-up (`motionRefFit`) on a rig's setup pose. */
const refFit = new Function(
	'ctx',
	[
		grabConst('REF_FACE_POINTS'),
		grabFn('motionRefTrack'),
		grabFn('motionRefFit'),
		'const rigTemplate = ctx.tpl, RIG = ctx.RIG; const skeleton = ctx.skel;',
		'const updateWorld = () => skeleton.updateWorldTransform(ctx.RIG.Physics.update);',
		'return motionRefFit({ width: ctx.track.width, height: ctx.track.height, track: motionRefTrack(ctx.track) });',
	].join('\n'),
);
/** The Rigger's Animate-mode pose (view.html `poseAtTime`) of one clip on an engine-rig skeleton. */
const pagePose = new Function(
	[
		...['BONE_AXIS_TIMELINES', 'isVertexAtt', 'isWeightedAtt'].map(grabConst),
		...[
			'bezierValue',
			'sampleChannel',
			'drawOrderOfOffsets',
			'reconstructDrawOrder',
			'poseAtTime',
			'deformLength',
			'deformOffsetsOf',
			'setDeformOffsets',
			'poseDeforms',
			'sampleDeform',
		].map(grabFn),
		'let skeleton = null;',
		'let skeletonData = null;',
		'let clip = null;',
		'const animOf = () => clip;',
		'return (skel, anim, t) => { skeleton = skel; skeletonData = skel.data; clip = anim; poseAtTime("imp", t); };',
	].join('\n'),
)();

let checks = 0;
let fails = 0;
const ok = (label, cond, detail = '') => {
	checks++;
	if (cond) return;
	fails++;
	console.error(`FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};
const FPS = 24;
const DEG = 180 / Math.PI;
const fold = (d) => d - 360 * Math.round(d / 360);
const median = (xs) => {
	const s = [...xs].sort((a, b) => a - b);
	return s.length ? s[s.length >> 1] : NaN;
};
const r1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));

function rigWith(tpl) {
	const regions = tpl.parts.map((p) => ({ name: p.name, w: p.size[0], h: p.size[1] }));
	const { skeleton } = T.templateRig(tpl, regions);
	const names = new Set(regions.map((r) => r.name));
	const has = (slot, part) => names.has(part) && !!skeleton.skins[0].attachments[slot]?.[part];
	const lines = ['page.png', 'size:8192,512', 'filter:Linear,Linear'];
	let x = 0;
	for (const r of regions) {
		lines.push(r.name, `bounds:${x},0,${r.w},${r.h}`);
		x += r.w;
	}
	return {
		tpl,
		skeleton,
		has,
		setup: skeleton.slots.map((s) => s.name),
		atlas: `${lines.join('\n')}\n`,
	};
}
function dataOf(rig, irig) {
	const atlas = new TextureAtlas(rig.atlas);
	const stub = {
		getImage: () => ({ width: 1, height: 1 }),
		setFilters() {},
		setWraps() {},
		dispose() {},
	};
	for (const p of atlas.pages) p.setTexture(stub);
	return new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(
		JSON.parse(JSON.stringify(irig)),
	);
}
function poser(rig, irig) {
	const data = dataOf(rig, irig);
	return (t) => {
		const skel = new Skeleton(data);
		const state = new AnimationState(new AnimationStateData(data));
		state.setAnimation(0, 'imp', false);
		state.update(t);
		state.apply(skel);
		skel.updateWorldTransform(Physics.update);
		return skel;
	};
}
/** The page's line-up of a track on a rig, as the solve reads it, and as a map onto the rig. */
function lineUpOf(rig, track) {
	const skel = new Skeleton(dataOf(rig, rig.skeleton));
	skel.setToSetupPose();
	skel.updateWorldTransform(Physics.update);
	const align = refFit({ tpl: rig.tpl, RIG, skel, track });
	const lineUp = F.motionLineUp(align, track);
	return {
		lineUp,
		toRig: (p) => [
			lineUp.x0 + lineUp.k * p[0] * track.width,
			lineUp.y0 - lineUp.k * p[1] * track.height,
		],
	};
}
/** Import a track into clip `imp` as the page does, following positions or not. */
function import3d(rig, track, follow) {
	const tpl = rig.tpl;
	const lu = lineUpOf(rig, track);
	const solved = solveMotion(
		{ bones: tpl.bones, channels: tpl.channels, motion: tpl.motion },
		track,
		{
			three: true,
			...(follow ? { follow: { lineUp: lu.lineUp, depths: tpl.rig3d.depths } } : {}),
		},
	);
	const { animation, orient } = I.authoringOf(rig.skeleton, null, 'imp');
	F.faceKeyMotion(animation, solved.keys, 0, tpl.channels, rig.has, rig.setup);
	const out = I.importClip3d({
		irig: rig.skeleton,
		doc: null,
		stem: 'hero',
		template: tpl.rig3d,
		clip: 'imp',
		animation,
		orient,
		keys: solved.bones3d,
		at: 0,
		length: solved.length,
		replaced: F.face3dReplaced(tpl),
		keys2d: solved.keys2d,
	});
	return { solved, irig: out.irig, pose: poser(rig, out.irig), toRig: lu.toRig };
}

// ── The performer ──────────────────────────────────────────────────────────────────────────────
// Frames, by what they test: 0–23 settle (the first second is the distance's neutral), 24–40 the
// left forearm toward the camera, 44–56 the right arm held out straight (further than the rig's arm
// reaches), 60–65 the face far off the neck (further to the side than a neck bends).
const N = 72;
const FRONT = [28, 37];
const STRAIGHT = [46, 55];
const FAR = [61, 65];
const within = (i, [a, b]) => i >= a && i < b;
/** The picture's own move: across, a bob, and nearer (scaled about the hips). */
const shot = (t) => ({
	dx: 0.1 * Math.sin((2 * Math.PI * t) / 3),
	dy: 0.03 * Math.sin(2 * Math.PI * t),
	near: 1 + 0.08 * Math.sin((Math.PI * Math.max(0, t - 1)) / 2),
});
const moved = (p, s) => [0.5 + s.near * (p[0] - 0.5) + s.dx, 0.45 + s.near * (p[1] - 0.45) + s.dy];
const poseAt = (i, t) => {
	const w = (2 * Math.PI * t) / 2.5;
	const lean = 14 * Math.sin(w);
	// Toward the camera, eased in and out over four frames (a person takes that long).
	const ease = Math.max(0, Math.min(1, (i - FRONT[0] + 4) / 4, (FRONT[1] + 3 - i) / 4));
	const lower = 15 * Math.sin(w) * (1 - ease) + 55 * ease;
	return {
		body: { lean },
		arms: {
			l: { upper: P.dir(-30 - 10 * Math.sin(w), 10), lower: P.dir(-125 + 10 * Math.sin(w), lower) },
			r: within(i, STRAIGHT)
				? { upper: P.dir(90 + lean, 0), lower: P.dir(90 + lean, 0) }
				: { upper: P.dir(30 + 15 * Math.sin(w), -10), lower: P.dir(105, -20) },
		},
		// Crouched: Full body's legs are shorter against its body than a person's, so a standing
		// performer's ankles are past their reach.
		legs: {
			l: { upper: P.dir(-60), lower: P.dir(40) },
			r: { upper: P.dir(60 + 10 * Math.sin(w)), lower: P.dir(-40) },
		},
	};
};
/**
 * The face's points: eyes and mouth corners at the rig's own spacing, above the shoulders' middle and
 * leaning `lean` degrees as the body does (a head rides its body: its 3D pose leans too), off the
 * neck by `side` across it.
 */
const RIG_PX = 180 / 280;
function faceAt(f, side, lean) {
	const lm = f.pose.landmarks;
	const mid = [(lm[11][0] + lm[12][0]) / 2, (lm[11][1] + lm[12][1]) / 2];
	const [c0, s0] = [Math.cos(lean / DEG), Math.sin(lean / DEG)];
	/** A picture offset given x right and y up, leaning with the body. */
	const lent = (x, y) => [x * c0 - y * s0, -(x * s0 + y * c0)];
	const o = lent(side, (170 * RIG_PX) / P.W);
	const c = [mid[0] + o[0], mid[1] + o[1]];
	const at = (x, y) => {
		const d = lent((x * RIG_PX) / P.W, (y * RIG_PX) / P.H);
		return [c[0] + d[0], c[1] + d[1]];
	};
	const pts = Array.from({ length: 478 }, () => [c[0], c[1]]);
	for (const [k, x, y] of [
		[33, -60, 20],
		[133, -30, 20],
		[362, 30, 20],
		[263, 60, 20],
		[61, -40, -50],
		[291, 40, -50],
	])
		pts[k] = at(x, y);
	return pts;
}
function performer(withFace = true) {
	const track = P.track(N, FPS, (i, t) => ({
		pose: poseAt(i, t),
		opts: { hands: true, ...(withFace ? { face: P.rz(poseAt(i, t).body.lean) } : {}) },
	}));
	track.frames.forEach((f, i) => {
		// A quick shrug of the right shoulder (and its arm with it): 4 cm, twice a second.
		const up = 0.04 * Math.sin(2 * Math.PI * f.t * 2);
		for (const k of [11, 13, 15, 17, 19, 21]) {
			f.pose.landmarks[k] = [
				f.pose.landmarks[k][0],
				f.pose.landmarks[k][1] - up * 0.5,
				f.pose.landmarks[k][2],
			];
			f.pose.world[k] = [f.pose.world[k][0], f.pose.world[k][1] - up, f.pose.world[k][2]];
		}
		if (f.hands) f.hands[1].landmarks = f.hands[1].landmarks.map((p) => [p[0], p[1] - up * 0.5]);
		const s = shot(f.t);
		if (f.face)
			f.face.landmarks = faceAt(
				f,
				(within(i, FAR) ? 0.2 : 0.008) * Math.sin(i / 7) + (within(i, FAR) ? 0.15 : 0),
				poseAt(i, f.t).body.lean,
			);
		f.pose.landmarks = f.pose.landmarks.map((p) => [...moved(p, s), p[2]]);
		// Hand Landmarker's wrist a little off Pose Landmarker's, as on real footage (about 10 rig units).
		for (const h of f.hands ?? [])
			h.landmarks = h.landmarks.map((p) => moved([p[0] + 0.006, p[1] - 0.004], s));
		if (f.face) f.face.landmarks = f.face.landmarks.map((p) => moved(p, s));
	});
	return track;
}

// ── Half body ──────────────────────────────────────────────────────────────────────────────────
const byId = Object.fromEntries(T.RIG_TEMPLATES.map((t) => [t.id, t]));
const HB = rigWith(byId['half-body']);
const track = performer();
const angles = import3d(HB, track, false);
const follow = import3d(HB, track, true);
const pt = (p) => p && [p[0], p[1]];
const mid = (a, b) => a && b && [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const at = (skel, n) => {
	const b = skel.findBone(n);
	return [b.worldX, b.worldY];
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const turnOf = (skel, n) => Math.atan2(skel.findBone(n).c, skel.findBone(n).a) * DEG;
/** A world point in the chest's frame. */
const inChest = (skel, p) => {
	const v = { x: p[0], y: p[1] };
	skel.findBone('chest').worldToLocal(v);
	return [v.x, v.y];
};
const timeOf = (i) => track.frames[i].t + 1e-4;
/** Per frame: the rig's joints and the tracked ones mapped onto it. */
function measure(run) {
	const rows = [];
	for (let i = 0; i < N; i++) {
		const f = track.frames[i];
		const skel = run.pose(timeOf(i));
		const lm = f.pose.landmarks;
		const face = f.face.landmarks;
		const T2 = (p) => run.toRig(p);
		const hand = (s) => T2(f.hands[s === 'l' ? 0 : 1].landmarks[0]);
		rows.push({
			i,
			skel,
			shoulders: dist(
				mid(at(skel, 'upper_arm_l'), at(skel, 'upper_arm_r')),
				T2(mid(lm[11], lm[12])),
			),
			wrist: { l: dist(at(skel, 'hand_l'), hand('l')), r: dist(at(skel, 'hand_r'), hand('r')) },
			eyes: dist(
				mid(at(skel, 'eye_l'), at(skel, 'eye_r')),
				T2(mid(mid(face[33], face[133]), mid(face[362], face[263]))),
			),
			mouth: dist(
				mid(at(skel, 'mouth_corner_l'), at(skel, 'mouth_corner_r')),
				T2(mid(face[61], face[291])),
			),
			elbow: Object.fromEntries(
				['l', 'r'].map((s) => {
					const [sh, el] = s === 'l' ? [12, 14] : [11, 13];
					const S = at(skel, `upper_arm_${s}`);
					const E = at(skel, `lower_arm_${s}`);
					const Wr = at(skel, `hand_${s}`);
					const tS = T2(pt(lm[sh]));
					const tE = T2(pt(lm[el]));
					const side = (a, b, c) =>
						Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
					return [
						s,
						{
							err: dist(E, tE),
							floor: Math.max(0, dist(tE, S) - 190 * skel.findBone('root').scaleX),
							sameSide: side(S, Wr, E) === side(S, Wr, tE) || side(S, Wr, tE) === 0,
							angle: (a, b, c, d) =>
								fold(
									(Math.atan2(b[1] - a[1], b[0] - a[0]) - Math.atan2(d[1] - c[1], d[0] - c[0])) *
										DEG,
								),
							upper: [S, E, tS, tE],
							lower: [E, Wr, tE, T2(pt(lm[s === 'l' ? 16 : 15]))],
						},
					];
				}),
			),
			bend: fold(turnOf(skel, 'neck_upper') - turnOf(skel, 'chest')),
			base: Math.hypot(...sub(inChest(skel, at(skel, 'neck')), [0, 130])),
			// The eyes' and the mouth corners' middle (what the neck bends onto) across the neck.
			across:
				inChest(
					skel,
					mid(
						mid(at(skel, 'eye_l'), at(skel, 'eye_r')),
						mid(at(skel, 'mouth_corner_l'), at(skel, 'mouth_corner_r')),
					),
				)[0] -
				inChest(
					skel,
					T2(
						mid(mid(mid(face[33], face[133]), mid(face[362], face[263])), mid(face[61], face[291])),
					),
				)[0],
			order: skel.drawOrder.map((x) => x.data.name),
		});
	}
	return rows;
}
const A = measure(angles);
const B = measure(follow);
const settled = (i) => i >= 4 && i < N - 2;
const reachable = (i) => settled(i) && !within(i, [STRAIGHT[0] - 2, STRAIGHT[1] + 2]);
const onFace = (i) => settled(i) && !within(i, [FAR[0] - 3, FAR[1] + 3]);
const pick = (rows, keep, get) => rows.filter((r) => keep(r.i)).map(get);

// Angles only is off the performer: what the rest is measured against.
const off = {
	shoulders: median(pick(A, settled, (r) => r.shoulders)),
	wrist: median(pick(A, reachable, (r) => r.wrist.l)),
	eyes: median(pick(A, onFace, (r) => r.eyes)),
};
ok(
	'precondition: Angles only leaves the body, the hands and the face off the performer',
	off.shoulders > 30 && off.wrist > 30 && off.eyes > 30,
	JSON.stringify(off),
);

const worst = (rows, keep, get) => Math.max(...pick(rows, keep, get));
const got = {
	shoulders: worst(B, settled, (r) => r.shoulders),
	wristL: worst(B, reachable, (r) => r.wrist.l),
	wristR: worst(B, reachable, (r) => r.wrist.r),
	base: worst(B, settled, (r) => r.base),
};
console.log(
	`  half body, Angles only → Follow positions (median rig units): shoulders ${r1(off.shoulders)} → ${r1(median(pick(B, settled, (r) => r.shoulders)))}, ` +
		`left wrist ${r1(off.wrist)} → ${r1(median(pick(B, reachable, (r) => r.wrist.l)))}, eyes ${r1(off.eyes)} → ${r1(median(pick(B, onFace, (r) => r.eyes)))}`,
);
ok('the shoulders land on the performer’s (within 2)', got.shoulders < 2, r1(got.shoulders));
ok(
	'each hand lands on its tracked wrist (within 8, the turn keys’ 1°)',
	got.wristL < 8 && got.wristR < 8,
	`${r1(got.wristL)} ${r1(got.wristR)}`,
);
ok('the neck’s base stays on the torso (within 0.5)', got.base < 0.5, r1(got.base));
for (const s of ['l', 'r']) {
	const rows = B.filter((r) => reachable(r.i));
	const side = rows.filter((r) => r.elbow[s].sameSide).length / rows.length;
	ok(`the ${s} elbow bends to the tracked elbow’s side`, side === 1, side.toFixed(3));
	// The floor is the elbow's alone (the tracked elbow further from the shoulder than the rig's upper
	// arm reaches); the hand landing too costs more. Measured: 7 (left) and 21 (right) over it; a
	// plain reach, not choosing the depth, 10 and 35; the depth on the wrong side, 12 and 30.
	const over = median(rows.map((r) => r.elbow[s].err - r.elbow[s].floor));
	ok(
		`the ${s} elbow is as near the tracked one as its length allows (within 25 of its floor)`,
		over < 25,
		r1(over),
	);
}
const front = B.filter((r) => within(r.i, FRONT));
ok(
	'a forearm held toward the camera is still drawn in front of the body',
	front.every((r) => r.order.indexOf('hand_l') > r.order.indexOf('torso')),
);

// Out of reach and past the neck's bend: reported, and held as they should be.
const report = follow.solved.follow;
// Its inner frames: at the segment's edges the smoothed points still lean toward the bent arm.
const straight = B.filter((r) => within(r.i, [STRAIGHT[0] + 2, STRAIGHT[1] - 2]));
ok(
	'a wrist further than the arm reaches is reported…',
	report.limbs.upper_arm_r.outOfReach >= STRAIGHT[1] - STRAIGHT[0],
	JSON.stringify(report.limbs),
);
ok(
	'…and the arm turns as tracked there',
	straight.every((r) => {
		const e = r.elbow.r;
		return Math.abs(e.angle(...e.upper)) < 2 && Math.abs(e.angle(...e.lower)) < 2;
	}),
	straight.map((r) => r1(r.elbow.r.angle(...r.elbow.r.upper))).join(' '),
);
ok(
	'the left arm reaches on every frame',
	report.limbs.upper_arm_l.outOfReach === 0,
	JSON.stringify(report.limbs),
);
const far = B.filter((r) => within(r.i, FAR));
ok(
	'a face further to the side than the neck bends is reported…',
	report.neck.clamped >= FAR[1] - FAR[0],
	JSON.stringify(report.neck),
);
/** A bone's turn about its z on the import's 3D keys at time `t` (the last key at or before it). */
const keyedTurn = (bone, t) => {
	const ks = follow.solved.bones3d[bone]?.orient ?? [];
	const k = [...ks].reverse().find((q) => (q.time ?? 0) <= t + 1e-6) ?? ks[0];
	return k ? 2 * Math.atan2(k.value[3], k.value[0]) * DEG : NaN;
};
const farBend = far.map(
	(r) => keyedTurn('neck', timeOf(r.i)) + keyedTurn('neck_upper', timeOf(r.i)),
);
// Where the neck reaches the face (bent short of its limit), the face's middle lands across it.
const bendAt = (i) => keyedTurn('neck', timeOf(i)) + keyedTurn('neck_upper', timeOf(i));
const reached = B.filter((r) => onFace(r.i) && Math.abs(bendAt(r.i)) < report.neck.limit - 0.5);
const reachMiss = Math.max(...reached.map((r) => Math.abs(r.across)));
ok(
	'the neck reaches the face on most frames (a face off its neck as a person’s is)',
	reached.length >= 0.6 * B.filter((r) => onFace(r.i)).length,
	`${reached.length} of ${B.filter((r) => onFace(r.i)).length}`,
);
ok(
	// The turns' keys hold within 1°: the chest's alone is 3 units at the face.
	'…and there the eyes’ and mouth’s middle lands on the face’s across the neck (within 4)',
	reachMiss < 4,
	r1(reachMiss),
);
ok(
	'…and the neck is held at its limit there',
	farBend.every((d) => Math.abs(Math.abs(d) - report.neck.limit) < 1.5),
	farBend.map(r1).join(' '),
);

// Only the limbs' turns change, through ordinary keys; the Rigger shows what the game plays.
const limbs = new Set([
	'upper_arm_l',
	'lower_arm_l',
	'hand_l',
	'upper_arm_r',
	'lower_arm_r',
	'hand_r',
]);
// The neck bends: it and what hangs from it turn against a bent parent (the head's world turn is
// the face's either way).
const underNeck = new Set(['neck', 'neck_upper', 'head', 'head_image', 'hair_back']);
const same = Object.keys(angles.solved.bones3d).filter(
	(b) =>
		!limbs.has(b) &&
		!underNeck.has(b) &&
		JSON.stringify(angles.solved.bones3d[b]) !== JSON.stringify(follow.solved.bones3d[b]),
);
ok(
	'every bone but the limbs and the neck keeps the Angles-only turns',
	same.length === 0,
	same.join(', '),
);
const anim = follow.irig.animations.imp;
const neckKeys = ['neck', 'neck_upper'].flatMap((b) => follow.solved.keys2d[b]?.translate ?? []);
ok(
	'the root carries plain 2D translate keys, the neck’s held at its setup',
	anim.bones.root.translate.length > 1 &&
		anim.bones.root.translate.every((k) => Number.isFinite(k.x) && Number.isFinite(k.y)) &&
		neckKeys.length > 0 &&
		neckKeys.every((k) => k.x === 0 && k.y === 0),
	JSON.stringify(neckKeys),
);
ok(
	'the neck bends with 3D keys on both its bones',
	['neck', 'neck_upper'].every((b) => follow.solved.bones3d[b]?.orient?.length > 1),
);
ok(
	'the moves the root’s channels made are the fit’s now (not keyed twice)',
	!follow.solved.keys.some((k) => /^(hop|move)$/.test(k[1])),
);
for (const [what, run, rows] of [
	['Angles only', angles, A],
	['Follow positions', follow, B],
]) {
	const data = dataOf(HB, run.irig);
	let far2 = { d: 0 };
	for (let i = 0; i < N; i++) {
		const g = rows[i].skel;
		const page = new Skeleton(data);
		page.setToSetupPose();
		pagePose(page, run.irig.animations.imp, timeOf(i));
		page.updateWorldTransform(Physics.update);
		for (const b of g.bones) {
			const d = dist([b.worldX, b.worldY], at(page, b.data.name));
			if (d > far2.d) far2 = { d, bone: b.data.name, i };
		}
	}
	ok(
		`${what}: the Rigger’s Animate pose is the game’s (every bone within 0.5)`,
		far2.d < 0.5,
		JSON.stringify(far2),
	);
}

// ── Full body and Bust ─────────────────────────────────────────────────────────────────────────
{
	const FB = rigWith(byId['full-body']);
	const fbTrack = performer(false);
	const run = import3d(FB, fbTrack, true);
	const errs = [];
	const anchors = [];
	for (let i = 4; i < N - 2; i++) {
		const skel = run.pose(timeOf(i));
		const lm = fbTrack.frames[i].pose.landmarks;
		if (within(i, [STRAIGHT[0] - 2, STRAIGHT[1] + 2])) continue;
		for (const [s, k] of [
			['l', 28],
			['r', 27],
		])
			errs.push(dist(at(skel, `foot_${s}`), run.toRig(lm[k])));
		const rig = [
			at(skel, 'upper_arm_l'),
			at(skel, 'upper_arm_r'),
			at(skel, 'thigh_l'),
			at(skel, 'thigh_r'),
		];
		const tr = [12, 11, 24, 23].map((k) => run.toRig(lm[k]));
		const mean = (ps) => [
			ps.reduce((a, p) => a + p[0], 0) / 4,
			ps.reduce((a, p) => a + p[1], 0) / 4,
		];
		anchors.push(dist(mean(rig), mean(tr)));
	}
	ok(
		'Full body: the legs reach on every frame',
		['thigh_l', 'thigh_r'].every((b) => run.solved.follow.limbs[b].outOfReach === 0),
		JSON.stringify(run.solved.follow.limbs),
	);
	ok(
		'Full body: the shoulders’ and hips’ middle lands on the performer’s (within 2)',
		Math.max(...anchors) < 2,
		r1(Math.max(...anchors)),
	);
	ok(
		'Full body: the feet land on the ankles (within 8)',
		Math.max(...errs) < 8,
		r1(Math.max(...errs)),
	);
	ok('Full body: no head shift (one drawing, no face)', !run.solved.keys2d.neck);
}
{
	const BF = rigWith(byId['bust-face']);
	const bustTrack = performer();
	const run = import3d(BF, bustTrack, true);
	const errs = [];
	for (let i = 4; i < N - 2; i++) {
		if (!onFace(i)) continue;
		const skel = run.pose(timeOf(i));
		const face = bustTrack.frames[i].face.landmarks;
		const rig = ['eye_l', 'eye_r', 'mouth_corner_l', 'mouth_corner_r'].map((n) => at(skel, n));
		const tr = [mid(face[33], face[133]), mid(face[362], face[263]), face[61], face[291]].map(
			run.toRig,
		);
		const mean = (ps) => [
			ps.reduce((a, p) => a + p[0], 0) / 4,
			ps.reduce((a, p) => a + p[1], 0) / 4,
		];
		errs.push(dist(mean(rig), mean(tr)));
	}
	ok(
		'Bust with face: the face lands on the face (within 2)',
		Math.max(...errs) < 2,
		r1(Math.max(...errs)),
	);
}

// ── The validator ──────────────────────────────────────────────────────────────────────────────
{
	const hb = byId['half-body'];
	const pos = hb.motion.bones3d.positions;
	const withPos = (p) => ({
		...hb,
		motion: { ...hb.motion, bones3d: { ...hb.motion.bones3d, positions: { ...pos, ...p } } },
	});
	ok('half-body: valid', T.rigTemplateProblem(hb) === null, String(T.rigTemplateProblem(hb)));
	const bad = [
		[
			'an anchor hanging from a limb',
			withPos({ root: { bone: 'root', anchors: [{ point: { pose: 16 }, bone: 'hand_l' }] } }),
		],
		['a root that is not the rig’s root', withPos({ root: { ...pos.root, bone: 'hip' } })],
		[
			'a limb that is not a chain',
			withPos({ limbs: [{ ...pos.limbs[0], lower: 'hand_l', end: 'lower_arm_l' }] }),
		],
		[
			'a limb not turned from points',
			withPos({
				limbs: [{ ...pos.limbs[0], upper: 'clavicle_l', lower: 'upper_arm_l', end: 'lower_arm_l' }],
			}),
		],
		['a pole inside its limb', withPos({ limbs: [{ ...pos.limbs[0], pole: 'hand_l' }] })],
		['a neck bone turned in 3D', withPos({ neck: { ...pos.neck, bones: ['head'] } })],
		['a neck that is not a chain', withPos({ neck: { ...pos.neck, bones: ['neck', 'head'] } })],
		[
			'a neck mark not under its top bone',
			withPos({ neck: { ...pos.neck, marks: [{ point: { pose: 11 }, bone: 'chest' }] } }),
		],
		['a neck limit of 0', withPos({ neck: { ...pos.neck, limit: 0 } })],
		[
			'a face point the tracker does not have',
			withPos({ neck: { ...pos.neck, marks: [{ point: { face: [478] }, bone: 'eye_l' }] } }),
		],
	];
	for (const [what, t] of bad) ok(`validator refuses ${what}`, T.rigTemplateProblem(t) !== null);
}

console.log(`${fails ? 'FAIL' : 'ok'}  motion-positions: ${checks - fails}/${checks} checks`);
process.exit(fails ? 1 : 0);
