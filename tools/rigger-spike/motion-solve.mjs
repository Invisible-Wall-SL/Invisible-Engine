// Verify the motion import's solve (rig templates T5 / T7b) headlessly, on the SHIPPED code: the
// solver is `apps/launcher-api/src/lib/rigMotion.ts`, the templates and their motion maps are the
// real `bust-face` and `full-body`, the keys are written by the `faceKeyMotion` helper pulled out of
// view.html, and every result is posed by the engine-rig loader and AnimationState — so a fixed
// track is checked as the GAME would play it. No MediaPipe and no network: the tracks are built here
// from known poses. Asserted:
//  - face: a blink closes then reopens both eyelids; a mouth open keys mouth_A with the jaw dropped
//    by the video (not by the shape); an eye line turned 10° tilts the head 10°; a head turned and
//    nodded in its 3D pose (the face's transformation matrix) slides the face across and up the head,
//    and a face coming nearer scales the whole bust; gaze x and y keyed at different times both land
//    on the pupils —
//    every amount from the template's own gains and travel, read against the performer's neutral
//    (the first second of the track is a resting face);
//  - the import row's gains: the eyes gain decides how far a drawn closed eye reads, and leaves the
//    brows alone; a performer whose open eyes already score high rests open, and a performance that
//    starts mid-expression reads right once its neutral is a chosen resting moment;
//  - body: a straight arm raised to the side turns the upper arm to it and leaves the elbow straight
//    (the solve takes off the turn the parent already carries); a leg swung 20° steps the thigh
//    20°; the hips moving across and up move and hop the root by the rig-scaled amount;
//  - an arm crossing the body is beyond the template's range: held at its edge and reported;
//  - a low-visibility point is a gap, held from the frame before (no NaN);
//  - a child is solved against its parent's HELD value where the parent is a gap: hips out of sight
//    under a lean, or a shoulder out of sight under a raised arm, do not jump the arm or forearm;
//  - frames with nothing in them are counted, and a channel never seen is named, not keyed;
//  - key reduction keeps far fewer keys than frames, within the tolerance on the plateaus;
//  - keying replaces the imported channels' keys under the import only, at the playhead.
//   node tools/rigger-spike/motion-solve.mjs
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ESBUILD } from './esbuild.mjs';
import { RIG_CORE } from './rig.mjs';

const ROOT = new URL('../../', import.meta.url);
const APP = fileURLToPath(new URL('apps/launcher-api/', ROOT));
const esbuild = await import(ESBUILD);
const RIG = await import(RIG_CORE);
const {
	TextureAtlas,
	AtlasAttachmentLoader,
	SkeletonJson,
	Skeleton,
	AnimationState,
	AnimationStateData,
	Physics,
} = RIG;

const dir = mkdtempSync(join(tmpdir(), 'motion-solve-'));
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
const { BUST_FACE, FULL_BODY, templateRig, rigTemplateList } = await bundle(
	'src/lib/server/rigTemplates.ts',
	'templates.mjs',
);
const { solveMotion } = await bundle('src/lib/rigMotion.ts', 'motion.mjs');

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
			'faceKeyAttachment',
			'faceKeyChannel',
			'faceShapePart',
			'faceShapeControls',
			'faceKeyShape',
			'faceKeyMotion',
		].map(grabFn),
		'return { faceKeyMotion, faceKeyChannel };',
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
const near = (a, b, eps) => Math.abs(a - b) <= eps;
const EDGE = 0.005;

function rigWith(tpl) {
	const regions = tpl.parts.map((p) => ({ name: p.name, w: p.size[0], h: p.size[1] }));
	const { skeleton } = templateRig(tpl, regions);
	const has = (slot, part) => !!skeleton.skins[0].attachments[slot]?.[part];
	const lines = ['page.png', 'size:4096,256', 'filter:Linear,Linear'];
	let x = 0;
	for (const r of regions) {
		lines.push(r.name, `bounds:${x},0,${r.w},${r.h}`);
		x += r.w;
	}
	return { skeleton, has, atlas: lines.join('\n') + '\n' };
}
function play(rig, anim, t) {
	const atlas = new TextureAtlas(rig.atlas);
	const stub = {
		getImage: () => ({ width: 1, height: 1 }),
		setFilters() {},
		setWraps() {},
		dispose() {},
	};
	for (const p of atlas.pages) p.setTexture(stub);
	const doc = { ...rig.skeleton, animations: { m: anim } };
	const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(
		JSON.parse(JSON.stringify(doc)),
	);
	const skel = new Skeleton(data);
	const state = new AnimationState(new AnimationStateData(data));
	state.setAnimation(0, 'm', false);
	state.update(t);
	state.apply(skel);
	skel.updateWorldTransform(Physics.update);
	return skel;
}
const off = (skel, bone, prop) => {
	const b = skel.findBone(bone);
	return prop === 'rotate' ? b.rotation - b.data.rotation : b[prop] - b.data[prop];
};
const shown = (skel, slot) => skel.findSlot(slot).getAttachment()?.name ?? null;
/** World direction a → b between two bones' origins, degrees. */
const dirOf = (skel, a, b) => {
	const p = skel.findBone(a);
	const q = skel.findBone(b);
	return (Math.atan2(q.worldY - p.worldY, q.worldX - p.worldX) * 180) / Math.PI;
};
const angNear = (a, b, eps) => Math.abs(((a - b + 540) % 360) - 180) <= eps;

const summary = (tpl) => rigTemplateList().find((t) => t.id === tpl.id);
ok(
	'the template list carries bones and the motion map',
	!!summary(BUST_FACE).motion?.face && summary(FULL_BODY).bones.length > 0,
);

// ---------------------------------------------------------------- face (bust-face)
const FPS = 24;
const ft = (i) => i / FPS;
/**
 * Face Landmarker's transformation matrix (column-major) for a head turned `yaw`° toward the
 * picture's right, nodded `pitch`° up, `far` cm from the camera: column 2 is where the face's front
 * points, the translation is in front of the camera (−z).
 */
function headMatrix(yaw, pitch, far) {
	const r = Math.PI / 180;
	const front = [
		Math.sin(yaw * r) * Math.cos(pitch * r),
		Math.sin(pitch * r),
		Math.cos(yaw * r) * Math.cos(pitch * r),
	];
	const right = [Math.cos(yaw * r), 0, -Math.sin(yaw * r)];
	const up = [
		front[1] * right[2] - front[2] * right[1],
		front[2] * right[0] - front[0] * right[2],
		front[0] * right[1] - front[1] * right[0],
	];
	return [...right, 0, ...up, 0, ...front, 0, 0, 0, -far, 1];
}
function faceFrame(i, { blend = {}, tilt = 0, yaw = 0, pitch = 0, far = 50 } = {}) {
	const lm = Array(478).fill(null);
	const mid = [0.5, 0.45];
	const rot = (p) => {
		const a = (-tilt * Math.PI) / 180; // y is DOWN in the picture: a counter-clockwise turn is −
		const dx = p[0] - mid[0];
		const dy = p[1] - mid[1];
		return [
			mid[0] + dx * Math.cos(a) - dy * Math.sin(a),
			mid[1] + dx * Math.sin(a) + dy * Math.cos(a),
		];
	};
	lm[33] = rot([0.4, 0.45]);
	lm[263] = rot([0.6, 0.45]);
	lm[1] = rot([0.5, 0.55]);
	return { t: ft(i), face: { landmarks: lm, blend, matrix: headMatrix(yaw, pitch, far) } };
}
const BLINK = { 10: 0.3, 11: 0.8, 12: 1, 13: 0.8, 14: 0.3 };
/** A resting second before the performance, which the solve reads as the performer's neutral. */
const LEAD = FPS;
const JAW_OPEN = 0.2;
const GAZE_OUT = 0.4;
const GAZE_UP = 0.3;
const TURN_YAW = 10;
const NOD_PITCH = 6;
/** A face 45 cm away after a resting 50: ln(50 / 45) ≈ 10.5% nearer. */
const NEAR_FAR = 45;
const faceTrack = {
	width: 640,
	height: 640,
	frames: Array.from({ length: 72 + LEAD }, (_, j) => {
		const i = j - LEAD;
		if (i === 70 || i === 71) return { t: ft(j), face: null };
		const b = { browDownLeft: 0.3, browDownRight: 0.3 };
		if (i < 0) return faceFrame(j, { blend: b });
		if (BLINK[i] !== undefined) b.eyeBlinkLeft = b.eyeBlinkRight = BLINK[i];
		if (i >= 20 && i <= 30) b.jawOpen = JAW_OPEN;
		if (i === 40) b.mouthSmileLeft = b.mouthSmileRight = 0.9;
		if (i >= 2 && i <= 14) b.browInnerUp = b.browOuterUpRight = (0.8 * (i - 2)) / 12 / 1.6;
		if (i >= 15 && i <= 18) b.browInnerUp = b.browOuterUpRight = 0.5;
		if (i >= 66 && i <= 68) b.eyeBlinkLeft = 1;
		if (i >= 54 && i <= 58) {
			b.eyeLookOutLeft = GAZE_OUT;
			b.eyeLookInRight = GAZE_OUT;
		}
		if (i >= 61 && i <= 65) b.eyeLookUpLeft = b.eyeLookUpRight = GAZE_UP;
		return faceFrame(j, {
			blend: b,
			tilt: i >= 34 && i <= 44 ? 10 : 0,
			yaw: i >= 46 && i <= 52 ? TURN_YAW : 0,
			pitch: i >= 46 && i <= 52 ? NOD_PITCH : 0,
			far: i >= 56 && i <= 62 ? NEAR_FAR : 50,
		});
	}),
};
const face = solveMotion(summary(BUST_FACE), faceTrack);
/** The template's own numbers: an entry's gain, a drive's travel, a value held in its range. */
const gainOf = (id) => BUST_FACE.motion.face.entries.find((e) => e.channel === id).gain;
const perOf = (id, bone, prop) =>
	BUST_FACE.channels.find((c) => c.id === id).drives.find((d) => d.bone === bone && d.prop === prop)
		.per;
const inRange = (id, v) => {
	const c = BUST_FACE.channels.find((x) => x.id === id);
	return Math.min(c.max, Math.max(c.min, v));
};
ok(
	'the neutral is the resting first second',
	!!face.neutral && near(face.neutral[0], 0, 1e-9) && face.neutral[1] < 1 + 1e-9,
	JSON.stringify(face.neutral),
);
{
	const rig = rigWith(BUST_FACE);
	const at = 1.5;
	const anim = {};
	// A key the import must leave alone (before it) and one it must replace (under it).
	F.faceKeyChannel(
		anim,
		BUST_FACE.channels.find((c) => c.id === 'head_tilt'),
		7,
		0.5,
		rig.has,
	);
	F.faceKeyChannel(
		anim,
		BUST_FACE.channels.find((c) => c.id === 'head_tilt'),
		-7,
		at + 0.6,
		rig.has,
	);
	const n = F.faceKeyMotion(anim, face.keys, at, BUST_FACE.channels, rig.has);
	const pose = (i) => play(rig, anim, at + ft(i + LEAD) + EDGE);
	ok('face keys were written', n === face.keys.length && n > 0, `${n} / ${face.keys.length}`);
	ok(
		'blink: open before',
		shown(pose(7), 'eyelid_l') === null && shown(pose(7), 'eyelid_r') === null,
	);
	ok(
		'blink: both eyelids closed at the peak',
		shown(pose(12), 'eyelid_l') === 'eyelid_l_closed' &&
			shown(pose(12), 'eyelid_r') === 'eyelid_r_closed',
		`${shown(pose(12), 'eyelid_l')} ${shown(pose(12), 'eyelid_r')}`,
	);
	ok('blink: open again after', shown(pose(17), 'eyelid_l') === null);
	ok(
		'mouth: rest before',
		shown(pose(17), 'mouth') === 'mouth_rest',
		String(shown(pose(17), 'mouth')),
	);
	ok(
		'mouth: open shows mouth_A',
		shown(pose(25), 'mouth') === 'mouth_A',
		String(shown(pose(25), 'mouth')),
	);
	// The video's jawOpen × the jaw's gain opens the jaw, not mouth_A's own amount (all of it).
	const jawWant = perOf('jaw', 'jaw', 'y') * inRange('jaw', JAW_OPEN * gainOf('jaw'));
	ok(
		'mouth: jaw dropped by the video, not the shape',
		near(off(pose(25), 'jaw', 'y'), jawWant, 0.4) &&
			Math.abs(jawWant - perOf('jaw', 'jaw', 'y')) > 2,
		`${off(pose(25), 'jaw', 'y')} for ${jawWant}`,
	);
	ok('mouth: a one-frame smile is not keyed', !face.keys.some((k) => k[2] === 'mouth_smile'));
	const widest = Math.min(...[...Array(36).keys()].map((i) => off(pose(i), 'jaw', 'y')));
	ok('mouth: no frame opens the jaw past the video', widest >= jawWant - 0.3, String(widest));
	// The brow swaps to "up" on the frame its value crosses 0.6, not on the next kept key.
	const y = (i) => off(pose(i), 'brow_l', 'y');
	const crossY = [...Array(19).keys()].find(
		(i) => y(i) >= 0.6 * perOf('brow_l', 'brow_l', 'y') - 1e-6,
	);
	const crossImg = [...Array(19).keys()].find((i) => shown(pose(i), 'brow_l') === 'brow_l_up');
	ok(
		'brow: swaps to up where it crosses',
		crossY !== undefined && crossImg !== undefined && Math.abs(crossY - crossImg) <= 1,
		`value ${crossY}, image ${crossImg}`,
	);
	ok(
		'wink: the performer’s left eye closes the picture-right eyelid',
		shown(pose(67), 'eyelid_r') === 'eyelid_r_closed' && shown(pose(67), 'eyelid_l') === null,
		`${shown(pose(67), 'eyelid_l')} ${shown(pose(67), 'eyelid_r')}`,
	);
	ok('mouth: rest after', shown(pose(34), 'mouth') === 'mouth_rest');
	// The filter's release tail is all that is left four frames on: under 3% of the travel.
	ok(
		'jaw: closed after',
		near(off(pose(34), 'jaw', 'y'), 0, 0.03 * Math.abs(perOf('jaw', 'jaw', 'y'))),
		String(off(pose(34), 'jaw', 'y')),
	);
	ok(
		'tilt: the head turns 10° with the eye line',
		near(off(pose(40), 'head', 'rotate'), 10, 0.3),
		String(off(pose(40), 'head', 'rotate')),
	);
	ok(
		'tilt: level before',
		near(off(pose(30), 'head', 'rotate'), 0, 0.3),
		String(off(pose(30), 'head', 'rotate')),
	);
	// The head's 3D turn and nod in degrees, × their gains (degrees of a full turn / nod).
	const turnWant =
		perOf('head_turn', 'face', 'x') * inRange('head_turn', TURN_YAW * gainOf('head_turn'));
	const nodWant =
		perOf('head_pitch', 'face', 'y') * inRange('head_pitch', NOD_PITCH * gainOf('head_pitch'));
	ok(
		'turn: the face slides across the head with its 3D turn',
		near(off(pose(49), 'face', 'x'), turnWant, 0.3) && turnWant > 5,
		`${off(pose(49), 'face', 'x')} for ${turnWant}`,
	);
	ok(
		'turn: the nose slides further, the back hair the other way (parallax)',
		off(pose(49), 'nose', 'x') > 0.25 * perOf('head_turn', 'nose', 'x') &&
			off(pose(49), 'hair_back', 'x') < 0.25 * perOf('head_turn', 'hair_back', 'x'),
		`${off(pose(49), 'nose', 'x')} ${off(pose(49), 'hair_back', 'x')}`,
	);
	ok(
		'nod: the face slides up the head with its 3D nod',
		near(off(pose(49), 'face', 'y'), nodWant, 0.3) && nodWant > 3,
		`${off(pose(49), 'face', 'y')} for ${nodWant}`,
	);
	ok(
		'turn and nod: level before and after',
		near(off(pose(40), 'face', 'x'), 0, 0.3) && near(off(pose(60), 'face', 'y'), 0, 0.3),
		`${off(pose(40), 'face', 'x')} ${off(pose(60), 'face', 'y')}`,
	);
	// ln(50 / 45) through the approach's own gain and travel: the bust scales as the face did.
	const nearWant =
		1 +
		perOf('approach', 'root', 'scaleY') *
			inRange('approach', Math.log(50 / NEAR_FAR) * gainOf('approach'));
	ok(
		'nearer: the whole bust scales as the face came nearer, and back',
		near(1 + off(pose(59), 'root', 'scaleY'), nearWant, 0.01) &&
			near(1 + off(pose(59), 'root', 'scaleX'), nearWant, 0.01) &&
			nearWant > 1.08 &&
			near(off(pose(40), 'root', 'scaleY'), 0, 0.01),
		`${1 + off(pose(59), 'root', 'scaleY')} for ${nearWant}`,
	);
	// gaze x: the mean of out-left and in-right, × the gain; gaze y: the mean of both ups, × the gain.
	const gxWant = perOf('gaze_x', 'pupil_l', 'x') * inRange('gaze_x', GAZE_OUT * gainOf('gaze_x'));
	const gyWant = perOf('gaze_y', 'pupil_r', 'y') * inRange('gaze_y', GAZE_UP * gainOf('gaze_y'));
	const g1 = pose(56);
	ok(
		'gaze x lands while y stays',
		near(off(g1, 'pupil_l', 'x'), gxWant, 0.3) && near(off(g1, 'pupil_l', 'y'), 0, 0.3),
		`${off(g1, 'pupil_l', 'x')}, ${off(g1, 'pupil_l', 'y')} for ${gxWant}`,
	);
	const g2 = pose(63);
	ok(
		'gaze y lands while x stays',
		near(off(g2, 'pupil_r', 'y'), gyWant, 0.3) && near(off(g2, 'pupil_r', 'x'), 0, 0.3),
		`${off(g2, 'pupil_r', 'x')}, ${off(g2, 'pupil_r', 'y')} for ${gyWant}`,
	);
	ok('a key before the import is kept', near(off(play(rig, anim, 0.5), 'head', 'rotate'), 7, 0.01));
	ok(
		'a key under the import is replaced',
		!anim.bones.head.rotate.some((k) => Math.abs(k.time - (at + 0.6)) < 1e-4 && k.value === -7),
	);
	ok('the two empty frames are counted', face.untracked === 2, String(face.untracked));
	ok('nothing left unseen on the face', face.unseen.length === 0, face.unseen.join());
	const tilts = face.keys.filter((k) => k[1] === 'head_tilt').length;
	ok('tilt keys are reduced', tilts > 0 && tilts <= 16, `${tilts} keys for ${72 + LEAD} frames`);
	ok(
		'every key time is inside the track',
		face.keys.every((k) => k[0] >= 0 && k[0] <= face.length + 1e-9),
	);
}

// ---------------------------------------------------------------- body (full-body)
const STAND = {
	7: [0.52, 0.22],
	8: [0.48, 0.22],
	11: [0.55, 0.35],
	12: [0.45, 0.35],
	13: [0.55, 0.48],
	14: [0.45, 0.48],
	15: [0.55, 0.6],
	16: [0.45, 0.6],
	23: [0.53, 0.6],
	24: [0.47, 0.6],
	25: [0.53, 0.75],
	26: [0.47, 0.75],
	27: [0.53, 0.9],
	28: [0.47, 0.9],
};
function poseFrame(i, change = {}, shift = [0, 0], vis = {}) {
	const lm = Array(33).fill(null);
	for (const [k, p] of Object.entries({ ...STAND, ...change }))
		lm[k] = [p[0] + shift[0], p[1] + shift[1], vis[k] ?? 0.99];
	return { t: ft(i), pose: { landmarks: lm } };
}
const r20 = (20 * Math.PI) / 180;
const leg = [0.15 * Math.sin(r20), 0.15 * Math.cos(r20)];
const bodyTrack = {
	width: 1000,
	height: 1000,
	frames: Array.from({ length: 50 }, (_, i) => {
		if (i === 48) return { t: ft(i), pose: null };
		if (i >= 10 && i <= 20)
			return poseFrame(
				i,
				{ 14: [0.32, 0.35], 16: [0.2, 0.35] },
				[0, 0],
				i === 15 ? { 16: 0.1 } : {},
			);
		if (i >= 24 && i <= 34)
			return poseFrame(i, {
				26: [0.47 + leg[0], 0.6 + leg[1]],
				28: [0.47 + 2 * leg[0], 0.6 + 2 * leg[1]],
			});
		if (i >= 36 && i <= 43) return poseFrame(i, {}, [0.05, -0.04]);
		if (i >= 44 && i <= 46) return poseFrame(i, { 7: [0.5, 0.22], 8: [0.501, 0.235] });
		return poseFrame(i);
	}),
};
const body = solveMotion(summary(FULL_BODY), bodyTrack);
{
	const rig = rigWith(FULL_BODY);
	const anim = {};
	F.faceKeyMotion(anim, body.keys, 0, FULL_BODY.channels, rig.has);
	const pose = (i) => play(rig, anim, ft(i) + EDGE);
	const a = pose(16);
	ok(
		'arm: the upper arm points out to the side',
		angNear(dirOf(a, 'upper_arm_l', 'lower_arm_l'), 180, 2),
		String(dirOf(a, 'upper_arm_l', 'lower_arm_l')),
	);
	ok(
		'arm: the forearm carries on straight',
		angNear(dirOf(a, 'lower_arm_l', 'hand_l'), 180, 2),
		String(dirOf(a, 'lower_arm_l', 'hand_l')),
	);
	ok(
		'arm: the other arm still hangs',
		angNear(dirOf(a, 'upper_arm_r', 'lower_arm_r'), -90, 2),
		String(dirOf(a, 'upper_arm_r', 'lower_arm_r')),
	);
	ok(
		'arm: down again after',
		angNear(dirOf(pose(23), 'upper_arm_l', 'lower_arm_l'), -90, 2),
		String(dirOf(pose(23), 'upper_arm_l', 'lower_arm_l')),
	);
	ok(
		'gap: the hidden wrist is held, not NaN',
		body.keys.every((k) => Number.isFinite(k[2]) || typeof k[2] === 'string') &&
			angNear(dirOf(pose(15), 'lower_arm_l', 'hand_l'), 180, 3),
		String(dirOf(pose(15), 'lower_arm_l', 'hand_l')),
	);
	ok(
		'side-on: overlapping ears are a gap, the head holds level',
		near(off(pose(45), 'head', 'rotate'), 0, 1),
		String(off(pose(45), 'head', 'rotate')),
	);
	const s = pose(29);
	ok(
		'step: the thigh swings 20°',
		angNear(dirOf(s, 'thigh_l', 'shin_l'), -70, 1.5),
		String(dirOf(s, 'thigh_l', 'shin_l')),
	);
	ok(
		'step: the knee stays straight',
		angNear(dirOf(s, 'shin_l', 'foot_l'), -70, 1.5),
		String(dirOf(s, 'shin_l', 'foot_l')),
	);
	// The torso is 250 px for 190 rig units: 50 px across = 38, 40 px up = 30.4. Between keys the
	// reduction may sit within its tolerance; the plateau's peak is a turning point, so it is exact.
	const m = pose(40);
	const across = Math.max(...[37, 38, 39, 40, 41, 42].map((i) => off(pose(i), 'root', 'x')));
	ok('root: moves across with the hips', near(across, 38, 1), String(across));
	ok(
		'root: hops up with the hips',
		near(off(m, 'root', 'y'), 30.4, 1),
		String(off(m, 'root', 'y')),
	);
	ok(
		'root: back after',
		near(off(pose(47), 'root', 'x'), 0, 1) && near(off(pose(47), 'root', 'y'), 0, 1),
	);
	ok('the empty frame is counted', body.untracked === 1, String(body.untracked));
	ok('nothing clipped in range', body.clipped.length === 0, JSON.stringify(body.clipped));
	ok(
		'arm keys are reduced',
		body.keys.filter((k) => k[1] === 'arm_l').length <= 12,
		String(body.keys.filter((k) => k[1] === 'arm_l').length),
	);
	ok(
		'hop and move share their key times',
		JSON.stringify(body.keys.filter((k) => k[1] === 'hop').map((k) => k[0])) ===
			JSON.stringify(body.keys.filter((k) => k[1] === 'move').map((k) => k[0])),
	);
}

// An arm crossing the body: past the template's range, held at its edge and reported.
{
	const track = {
		width: 1000,
		height: 1000,
		frames: Array.from({ length: 24 }, (_, i) =>
			i >= 6 ? poseFrame(i, { 14: [0.58, 0.35], 16: [0.7, 0.35] }) : poseFrame(i),
		),
	};
	const r = solveMotion(summary(FULL_BODY), track);
	const c = r.clipped.find((x) => x.channel === 'arm_l');
	ok(
		'crossing: reported past the range',
		!!c && near(c.share, 18 / 24, 0.01),
		JSON.stringify(r.clipped),
	);
	const last = r.keys.filter((k) => k[1] === 'arm_l').at(-1);
	ok('crossing: held at the range edge', last && near(last[2], -0.3, 1e-6), JSON.stringify(last));
}

// A performer leaning 15° with one arm held out, whose hips drop below visibility for four frames:
// the lean is a gap there and is held, so the arm must be solved against the held lean, not zero.
{
	const lean = (-15 * Math.PI) / 180;
	const turn = ([x, y]) => [
		0.5 + (x - 0.5) * Math.cos(lean) - (y - 0.6) * Math.sin(lean),
		0.6 + (x - 0.5) * Math.sin(lean) + (y - 0.6) * Math.cos(lean),
	];
	const upper = { ...STAND, 14: [0.32, 0.35], 16: [0.2, 0.35] };
	const leaned = Object.fromEntries([7, 8, 11, 12, 13, 14, 15, 16].map((k) => [k, turn(upper[k])]));
	const track = {
		width: 1000,
		height: 1000,
		frames: Array.from({ length: 24 }, (_, i) =>
			poseFrame(i, leaned, [0, 0], i >= 10 && i <= 13 ? { 23: 0.1, 24: 0.1 } : {}),
		),
	};
	const r = solveMotion(summary(FULL_BODY), track);
	const rig = rigWith(FULL_BODY);
	const anim = {};
	F.faceKeyMotion(anim, r.keys, 0, FULL_BODY.channels, rig.has);
	const arm = (i) => dirOf(play(rig, anim, ft(i) + EDGE), 'upper_arm_l', 'lower_arm_l');
	ok(
		'hips gap: the held arm keeps its world direction while the lean is held',
		[11, 12].every((i) => angNear(arm(i), arm(6), 1)),
		`${arm(6)} → ${arm(11)}, ${arm(12)}`,
	);
}

// The arm held out straight, the shoulder below visibility for four frames while the elbow and wrist
// stay seen: the upper arm is held, so the forearm must not take its whole turn on as its own.
{
	const track = {
		width: 1000,
		height: 1000,
		frames: Array.from({ length: 24 }, (_, i) =>
			poseFrame(
				i,
				{ 14: [0.32, 0.35], 16: [0.2, 0.35] },
				[0, 0],
				i >= 10 && i <= 13 ? { 12: 0.1 } : {},
			),
		),
	};
	const r = solveMotion(summary(FULL_BODY), track);
	const rig = rigWith(FULL_BODY);
	const anim = {};
	F.faceKeyMotion(anim, r.keys, 0, FULL_BODY.channels, rig.has);
	const fore = (i) => dirOf(play(rig, anim, ft(i) + EDGE), 'lower_arm_l', 'hand_l');
	ok(
		'shoulder gap: the forearm carries on straight while the upper arm is held',
		[11, 12].every((i) => angNear(fore(i), 180, 2)),
		`${fore(6)} → ${fore(11)}, ${fore(12)}`,
	);
}

// The import row's gains, against the neutral. A drawn closed eye scores about 0.4 over its open
// 0.05: the eyes gain decides how far it reads, and the brows do not follow it.
{
	const rig = rigWith(BUST_FACE);
	const eyesTrack = (open, closed, brow = 0) => ({
		width: 640,
		height: 640,
		frames: Array.from({ length: LEAD + 12 }, (_, j) => {
			const shut = j >= LEAD + 4 && j <= LEAD + 7;
			const v = shut ? closed : open;
			return faceFrame(j, {
				blend: { eyeBlinkLeft: v, eyeBlinkRight: v, browInnerUp: shut ? brow : 0 },
			});
		}),
	});
	const solved = (track, opts) => {
		const anim = {};
		F.faceKeyMotion(
			anim,
			solveMotion(summary(BUST_FACE), track, opts).keys,
			0,
			BUST_FACE.channels,
			rig.has,
		);
		return anim;
	};
	const lid = (anim, j) => shown(play(rig, anim, ft(j) + EDGE), 'eyelid_l');
	const drawn = eyesTrack(0.05, 0.4, 0.2);
	const half = solved(drawn, { gain: { eyes: 0.5 } });
	const full = solved(drawn, { gain: { eyes: 1 } });
	ok(
		'eyes gain ½: a drawn closed eye reads half-closed',
		lid(half, LEAD + 6) === 'eyelid_l_half',
		String(lid(half, LEAD + 6)),
	);
	ok(
		'eyes gain 1: a drawn closed eye reads closed',
		lid(full, LEAD + 6) === 'eyelid_l_closed',
		String(lid(full, LEAD + 6)),
	);
	const brow = (anim) => off(play(rig, anim, ft(LEAD + 6) + EDGE), 'brow_l', 'y');
	ok(
		'the eyes gain leaves the brows alone',
		near(brow(half), brow(full), 1e-6) && brow(full) > 1,
		`${brow(half)} ${brow(full)}`,
	);
	// A performer whose open eyes already score 0.3 (heavy lids, looking down) rests open.
	const heavy = solved(eyesTrack(0.3, 0.75));
	ok(
		'read against the neutral: eyes that rest at 0.3 rest open',
		lid(heavy, LEAD + 1) === null,
		String(lid(heavy, LEAD + 1)),
	);
	ok(
		'…and still close for the blink',
		lid(heavy, LEAD + 6) === 'eyelid_l_closed',
		String(lid(heavy, LEAD + 6)),
	);
	// A take that starts with the eyes squeezed shut: the first second is no neutral, a chosen one is.
	const squeezed = {
		width: 640,
		height: 640,
		frames: Array.from({ length: 3 * LEAD }, (_, j) =>
			faceFrame(j, {
				blend: {
					eyeBlinkRight: j < LEAD ? 0.8 : j >= 2 * LEAD + 4 && j <= 2 * LEAD + 7 ? 0.8 : 0.05,
					eyeBlinkLeft: 0.05,
				},
			}),
		),
	};
	const late = solved(squeezed, { neutral: 1.5 });
	const early = solved(squeezed);
	ok(
		'a chosen neutral: a later blink closes the lid',
		lid(late, 2 * LEAD + 6) === 'eyelid_l_closed',
		String(lid(late, 2 * LEAD + 6)),
	);
	ok(
		'…which the squeezed first second hid',
		lid(early, 2 * LEAD + 6) !== 'eyelid_l_closed',
		String(lid(early, 2 * LEAD + 6)),
	);
	ok(
		'a chosen neutral is read around that moment',
		JSON.stringify(solveMotion(summary(BUST_FACE), squeezed, { neutral: 1.5 }).neutral) ===
			JSON.stringify([1.25, 1.75]),
		JSON.stringify(solveMotion(summary(BUST_FACE), squeezed, { neutral: 1.5 }).neutral),
	);
}

// A take whose very first frame has the head tilted and turned (a performer settling in): the rest
// of its first second is level, so the neutral is level and the take is not read 8° off.
{
	const track = {
		width: 640,
		height: 640,
		frames: Array.from({ length: LEAD + 12 }, (_, j) =>
			faceFrame(j, { tilt: j === 0 ? 8 : 0, yaw: j === 0 ? 12 : 0, pitch: j === 0 ? 9 : 0 }),
		),
	};
	const r = solveMotion(summary(BUST_FACE), track, { trace: true });
	const late = (id) => Math.max(...r.stages[id].keyed.slice(LEAD).map(Math.abs));
	ok(
		'a tilted first frame does not tilt the take: it is read against the neutral',
		late('head_tilt') < 0.5,
		String(late('head_tilt')),
	);
	ok(
		'…nor turn or nod it',
		late('head_turn') < 0.05 && late('head_pitch') < 0.05,
		`${late('head_turn')} ${late('head_pitch')}`,
	);
}

// Only gaze x imported over a gaze y the author keyed: both write the pupils' translate timeline, so
// the import keys x and leaves the authored y curve where it was, at every time it was keyed.
{
	const rig = rigWith(BUST_FACE);
	const ch = (id) => BUST_FACE.channels.find((c) => c.id === id);
	const anim = {};
	for (const [at, v] of [
		[0.2, 0.4],
		[0.6, -0.4],
		[1.2, 0],
	])
		F.faceKeyChannel(anim, ch('gaze_y'), v, at, rig.has);
	const y = (a, t) => off(play(rig, a, t + EDGE), 'pupil_l', 'y');
	const x = (a, t) => off(play(rig, a, t + EDGE), 'pupil_l', 'x');
	const before = structuredClone(anim);
	F.faceKeyMotion(
		anim,
		[
			[0, 'gaze_x', 0.3],
			[0.8, 'gaze_x', 0.3],
		],
		0,
		BUST_FACE.channels,
		rig.has,
	);
	const times = [0.2, 0.4, 0.6, 0.8, 1];
	ok(
		'gaze x alone: the authored gaze y keeps its curve under the import',
		times.every((t) => near(y(anim, t), y(before, t), 0.01)),
		times.map((t) => `${t}: ${y(before, t).toFixed(2)} → ${y(anim, t).toFixed(2)}`).join(', '),
	);
	const gx = 0.3 * ch('gaze_x').drives.find((d) => d.bone === 'pupil_l').per;
	ok(
		'gaze x alone: x is the imported value over the import',
		times.every((t) => t >= 0.8 || near(x(anim, t), gx, 0.01)),
		times.map((t) => x(anim, t).toFixed(2)).join(', '),
	);
}

// Three channels chained through two timelines (a and b share one bone's translate, b and c another):
// all three are keyed at the same times, though a and c share no timeline with each other.
{
	const drive = (bone, prop) => ({ bone, prop, per: 1 });
	const chans = [
		['a', [drive('p1', 'x')]],
		['b', [drive('p1', 'y'), drive('p2', 'x')]],
		['c', [drive('p2', 'y')]],
	].map(([id, drives]) => ({ id, label: id, min: -100, max: 100, rest: 0, drives }));
	const tpl = {
		bones: [
			{ name: 'root' },
			...['p1', 'p2'].map((name) => ({ name, parent: 'root', x: 0, y: 0 })),
		],
		channels: chans,
		motion: {
			body: {
				smooth: 0,
				minVisibility: 0.5,
				scale: { from: 23, to: 11, rig: 100 },
				entries: [
					{ kind: 'root', channel: 'a', point: 0, axis: 'x' },
					{ kind: 'root', channel: 'b', point: 1, axis: 'y' },
					{ kind: 'root', channel: 'c', point: 2, axis: 'y' },
				],
			},
		},
	};
	const ramp = (i, from, to) => Math.min(1, Math.max(0, (i - from) / (to - from))) * 0.2;
	const track = {
		width: 1000,
		height: 1000,
		frames: Array.from({ length: 30 }, (_, i) => {
			const lm = Array(33).fill(null);
			lm[0] = [0.5 + ramp(i, 2, 8), 0.5, 0.99];
			lm[1] = [0.5, 0.5 + ramp(i, 10, 16), 0.99];
			lm[2] = [0.5, 0.5 + ramp(i, 18, 25), 0.99];
			lm[11] = [0.5, 0.3, 0.99];
			lm[23] = [0.5, 0.6, 0.99];
			return { t: ft(i), pose: { landmarks: lm } };
		}),
	};
	const r = solveMotion(tpl, track, { face: false });
	const at = (id) => JSON.stringify(r.keys.filter((k) => k[1] === id).map((k) => k[0]));
	ok(
		'chained timelines: every channel is keyed at the same times',
		r.keys.length > 0 && at('a') === at('b') && at('b') === at('c'),
		`a ${at('a')} | b ${at('b')} | c ${at('c')}`,
	);
}

// A track with no pose at all names every body channel unseen and keys nothing.
{
	const r = solveMotion(summary(FULL_BODY), {
		width: 10,
		height: 10,
		frames: [
			{ t: 0, pose: null },
			{ t: 0.1, pose: null },
		],
	});
	ok('no body: nothing keyed', r.keys.length === 0);
	ok(
		'no body: every mapped channel unseen',
		r.unseen.length === FULL_BODY.motion.body.entries.length,
		r.unseen.join(),
	);
}
// A face-only template ignores pose frames; a body-only one ignores faces.
ok(
	'face template ignores a pose track',
	solveMotion(summary(BUST_FACE), bodyTrack).keys.length === 0,
);
ok(
	'body template ignores a face track',
	solveMotion(summary(FULL_BODY), faceTrack).keys.length === 0,
);

console.log(`motion solve: ${checks - fails}/${checks} checks pass`);
if (fails) process.exit(1);
