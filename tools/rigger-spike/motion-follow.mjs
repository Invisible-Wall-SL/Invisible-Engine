// Verify that the motion import FOLLOWS the performance (rig templates §5.5) headlessly, on the
// SHIPPED code: the solver is `src/lib/rigMotion.ts`, the templates are the real `half-body` and
// `full-body`, the keys are written by the Controls section's
// helpers pulled out of view.html, and every result is posed by engine-rig's loader and
// AnimationState — so what is asserted is what the GAME shows: each bone's direction in the posed rig
// against the line the performer's limb makes in the picture. Asserted:
//  - the elbow, both ways in the picture: a straight arm keys it straight; a forearm bent inward
//    (the hand in front of the body, what a hanging arm does on 58–100% of real frames) and one bent
//    outward (a raised arm's wave) are keyed, not held at an edge, and the posed forearm points where
//    the picture's does; a forearm folding back past the edge of its reach is held at the edge it came
//    from, never flipped to the other;
//  - mirrored footage: the picture mirrored (the tracker naming the arms by the picture) moves the
//    rig's other arm the mirrored way; the tracker naming them the other way round (a mirrored video,
//    a turned back) is read by the picture and gives the same keys, and the frames are reported;
//  - parent-relative: an upper arm past its range is held at its edge and the forearm still points
//    where the picture's does; a lean turns the arm with it and the arm's own key takes it off; a
//    head held level while the shoulders tilt stays level (its tilt is solved under the twist); a wrist in line with a bent forearm keys no wrist turn;
//  - side-on: shoulders under 0.6 of their spread read no twist (held), not the edge of the range;
//  - an image swap (the ¾ torso) is held at least 0.15 s: a turn hovering at the threshold swaps once;
//  - auto-range: `fitRange` brings the p2 / p98 to the edges at full strength, half-way at ½, leaves
//    a range it fits in, the rest, a side with no room and a saturating top alone, and never
//    stretches; through the solve a face group past its range keeps its shape within it and is
//    reported (off: held at the edge, reported as clipped); a blink past shut stays shut and is not
//    reported lost; a finger past a fist is a fist; on the body, the forearm is solved against its
//    fitted parent and still points where the picture's does;
//  - a hand far from the body's wrists (someone else's) keys no fingers; one at a wrist does.
//   node tools/rigger-spike/motion-follow.mjs
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

const dir = mkdtempSync(join(tmpdir(), 'motion-follow-'));
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
const { HALF_BODY, FULL_BODY, templateRig } = await bundle(
	'src/lib/server/rigTemplates.ts',
	'templates.mjs',
);
const { solveMotion, fitRange, pictureSides } = await bundle('src/lib/rigMotion.ts', 'motion.mjs');

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
		].map(grabFn),
		'return { faceKeyMotion };',
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
const q = JSON.stringify;
// Keys may stray ROTATE_TOLERANCE (1°) from the solved turn, per joint: a posed bone two or three
// joints down is within this of the picture.
const TURN_EPS = 2.5;
const R = Math.PI / 180;
const DEG = 180 / Math.PI;
const FPS = 24;
const EDGE = 0.005;
const fold = (d) => {
	let x = d % 360;
	if (x > 180) x -= 360;
	if (x <= -180) x += 360;
	return x;
};

function rigWith(tpl) {
	const regions = tpl.parts.map((p) => ({ name: p.name, w: p.size[0], h: p.size[1] }));
	const { skeleton } = templateRig(tpl, regions);
	const has = (slot, part) => !!skeleton.skins[0].attachments[slot]?.[part];
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
		atlas: lines.join('\n') + '\n',
	};
}
function poser(rig, anim) {
	const atlas = new TextureAtlas(rig.atlas);
	const stub = {
		getImage: () => ({ width: 1, height: 1 }),
		setFilters() {},
		setWraps() {},
		dispose() {},
	};
	for (const p of atlas.pages) p.setTexture(stub);
	const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(
		JSON.parse(JSON.stringify({ ...rig.skeleton, animations: { a: anim } })),
	);
	return (i) => {
		const skel = new Skeleton(data);
		const state = new AnimationState(new AnimationStateData(data));
		state.setAnimation(0, 'a', false);
		state.update(i / FPS + EDGE);
		state.apply(skel);
		skel.updateWorldTransform(Physics.update);
		return skel;
	};
}
/** Solve, key from 0 through the page's keying path, and pose frame i through engine-rig. */
function keyed(rig, track, opts = {}) {
	const solved = solveMotion(
		{ bones: rig.tpl.bones, channels: rig.tpl.channels, motion: rig.tpl.motion },
		track,
		{ trace: true, ...opts },
	);
	const anim = {};
	F.faceKeyMotion(anim, solved.keys, 0, rig.tpl.channels, rig.has, rig.setup);
	return { solved, anim, at: poser(rig, anim) };
}
/** A bone's world direction toward its child below it (local 0, −1), degrees, y up. */
const downOf = (skel, n) => {
	const b = skel.findBone(n);
	return Math.atan2(-b.d, -b.b) * DEG;
};
/** A bone's world x axis, degrees, y up (the head's level). */
const acrossOf = (skel, n) => {
	const b = skel.findBone(n);
	return Math.atan2(b.c, b.a) * DEG;
};
const valueAt = (solved, id, i) => solved.stages[id]?.smoothed[i];

// ---------------------------------------------------------------- the performer, in metres
// Hips' middle at the origin, y down, z away from the camera; the picture-left side is the
// performer's right (pose points 12, 14, 16). Seen straight on at S pixels per metre.
const W = 640;
const H = 640;
const S = 300;
const UPPER = 0.28;
const FORE = 0.25;
/** A picture direction (degrees, y up, counter-clockwise) as a world step (y down) of `len` metres. */
const step = (a, deg, len) => [
	a[0] + Math.cos(deg * R) * len,
	a[1] - Math.sin(deg * R) * len,
	a[2],
];
/**
 * A frame from the performer's points (`pts` index → [x, y, z] metres), with visibility 0.99 unless
 * `vis` says; `face` adds the eye corners (33 picture-left, 263 picture-right) on a line at `eyes`
 * degrees through `faceAt`.
 */
function frame(i, pts, { vis = {}, eyes = null, faceAt = [0, -0.72], hands = null } = {}) {
	const landmarks = Array(33).fill(null);
	const world = Array(33).fill(null);
	for (const [k, p] of Object.entries(pts)) {
		world[k] = p;
		landmarks[k] = [(W / 2 + p[0] * S) / W, (H / 2 + p[1] * S) / H, vis[k] ?? 0.99];
	}
	const f = { t: i / FPS, pose: { landmarks, world } };
	if (eyes !== null) {
		const lms = Array(478).fill(null);
		const c = [(W / 2 + faceAt[0] * S) / W, (H / 2 + faceAt[1] * S) / H];
		const dx = (Math.cos(eyes * R) * 0.04 * S) / W;
		const dy = (Math.sin(eyes * R) * 0.04 * S) / H;
		lms[33] = [c[0] - dx, c[1] + dy];
		lms[263] = [c[0] + dx, c[1] - dy];
		lms[1] = [c[0], c[1] + 0.01];
		f.face = { landmarks: lms, blend: {} };
	}
	if (hands) f.hands = hands;
	return f;
}
/** The body standing, with the picture-left arm's upper arm at `up` and forearm at `fore` (picture degrees). */
function arm(up, fore, { right = [-90, -90], shoulders = 0 } = {}) {
	const mid = [0, -0.5, 0];
	const half = 0.18;
	const sl = [mid[0] - Math.cos(shoulders * R) * half, mid[1] + Math.sin(shoulders * R) * half, 0];
	const sr = [mid[0] + Math.cos(shoulders * R) * half, mid[1] - Math.sin(shoulders * R) * half, 0];
	const el = step(sl, up, UPPER);
	const wl = step(el, fore, FORE);
	const er = step(sr, right[0], UPPER);
	const wr = step(er, right[1], FORE);
	return {
		0: [0, -0.74, -0.09],
		7: [0.07, -0.72, 0],
		8: [-0.07, -0.72, 0],
		11: sr,
		12: sl,
		13: er,
		14: el,
		15: wr,
		16: wl,
		17: step(wr, right[1], 0.08),
		19: step(wr, right[1], 0.08),
		18: step(wl, fore, 0.08),
		20: step(wl, fore, 0.08),
		23: [0.1, 0, 0],
		24: [-0.1, 0, 0],
	};
}
/** Held 1 s per pose. */
const poses = (list, opts) => {
	const frames = [];
	list.forEach((p, k) => {
		for (let j = 0; j < FPS; j++)
			frames.push(frame(k * FPS + j, typeof p === 'function' ? p(j) : p, opts));
	});
	return { width: W, height: H, frames };
};
const mid = (k) => k * FPS + FPS / 2;
/** The picture's line from point a to b of frame i, degrees, y up. */
const picture = (track, i, a, b) => {
	const p = track.frames[i].pose.landmarks;
	return Math.atan2(-(p[b][1] - p[a][1]) * H, (p[b][0] - p[a][0]) * W) * DEG;
};

const half = rigWith(HALF_BODY);
const full = rigWith(FULL_BODY);

// ---------------------------------------------------------------- 1. the elbow, both ways
// The picture-left arm hanging (−90°), its forearm: straight; 70° and 120° in toward the body (for the
// picture's left arm, counter-clockwise: −20° and +30°); 60° out (−150°); and the arm raised out to the
// side (180°) with the forearm up (90°): a wave.
const ELBOW = [
	['straight', -90, -90, 0],
	['bent in 70°', -90, -20, -70],
	['bent in 120°', -90, 30, -120],
	['bent out 60°', -90, -150, 60],
	['a wave: raised out, forearm up', 180, 90, 90],
];
const elbowTrack = poses(ELBOW.map(([, up, fore]) => arm(up, fore)));
for (const [label, rig, per] of [
	['Half body v2', half, 140],
	['Full body v2', full, 120],
]) {
	const { solved, at } = keyed(rig, elbowTrack);
	ELBOW.forEach(([name, , , bend], k) => {
		const i = mid(k);
		const want = bend / per;
		ok(
			`${label}: ${name} keys the left elbow at ${want.toFixed(2)} (${bend}° ÷ ${per}°)`,
			near(valueAt(solved, 'elbow_l', i), want, 0.02),
			String(valueAt(solved, 'elbow_l', i)),
		);
		const skel = at(i);
		const err = fold(downOf(skel, 'lower_arm_l') - picture(elbowTrack, i, 14, 16));
		ok(
			`${label}: ${name}: the posed forearm points where the picture's does (engine-rig)`,
			Math.abs(err) < TURN_EPS,
			`${err.toFixed(2)}°`,
		);
	});
	ok(
		`${label}: no elbow is reported held at its edge`,
		!solved.clipped.some((c) => c.channel.startsWith('elbow_')),
		q(solved.clipped),
	);
}

// A forearm folding back past the edge of its reach (168°) inward and on round: 150°, 165°, 175°,
// 185°, 175° — held at the edge it came from, never flipped to the outward edge.
{
	const FOLD = [150, 165, 175, 185, 175];
	const track = poses(FOLD.map((b) => arm(-90, -90 + b)));
	const { solved, at } = keyed(half, track);
	const vals = FOLD.map((_, k) => valueAt(solved, 'elbow_l', mid(k)));
	const reach = HALF_BODY.channels.find((c) => c.id === 'elbow_l');
	ok(
		'a forearm folding back past its reach is held at the edge it came from, never flipped',
		vals.every((v) => v < 0) &&
			near(vals[0], -150 / 140, 0.02) &&
			near(vals[1], -165 / 140, 0.02) &&
			near(vals[2], reach.min, 0.01) &&
			near(vals[3], reach.min, 0.01) &&
			near(vals[4], reach.min, 0.01),
		q(vals),
	);
	const raw = solved.stages.elbow_l.raw.filter((v) => v !== null);
	ok(
		'…every frame read inward (no frame on the far side of the fold)',
		raw.every((v) => v < 0),
		q(raw.filter((v) => v >= 0).slice(0, 4)),
	);
	const err = fold(downOf(at(mid(0)), 'lower_arm_l') - picture(track, mid(0), 14, 16));
	ok(
		'…and at 150° the posed forearm points where the picture’s does',
		Math.abs(err) < TURN_EPS,
		String(err),
	);
}

// ---------------------------------------------------------------- 2. mirrored footage
// The elbow track with its right arm doing the wave and the left bending in, then mirrored: x → −x.
const mirrorPts = (pts, swapNames) => {
	const out = {};
	const pair = {
		11: 12,
		12: 11,
		13: 14,
		14: 13,
		15: 16,
		16: 15,
		17: 18,
		18: 17,
		19: 20,
		20: 19,
		23: 24,
		24: 23,
		7: 8,
		8: 7,
	};
	for (const [k, p] of Object.entries(pts)) {
		const to = swapNames ? (pair[k] ?? k) : k;
		out[to] = [-p[0], p[1], p[2]];
	}
	return out;
};
{
	const base = [arm(-90, -20, { right: [-90, -90] }), arm(-90, 30, { right: [0, 90] })];
	const orig = poses(base);
	// The tracker naming the points by the picture (a front-on performer in a mirrored picture): the
	// arm on the picture's left is still 12 → 14 → 16.
	const byPicture = poses(base.map((p) => mirrorPts(p, true)));
	// The tracker naming them by the body (12 on the picture's right).
	const byBody = poses(base.map((p) => mirrorPts(p, false)));
	const a = keyed(half, orig);
	const b = keyed(half, byPicture);
	const c = keyed(half, byBody);
	const v = (s, id, k) => valueAt(s.solved, id, mid(k));
	ok(
		'mirrored: the rig’s left arm does what its right did, mirrored (the elbow and the raise)',
		[0, 1].every(
			(k) =>
				near(v(b, 'elbow_l', k), v(a, 'elbow_r', k), 0.02) &&
				near(v(b, 'elbow_r', k), v(a, 'elbow_l', k), 0.02) &&
				near(v(b, 'arm_l', k), v(a, 'arm_r', k), 0.02),
		),
		q(
			[0, 1].map((k) => [
				v(a, 'elbow_l', k),
				v(a, 'elbow_r', k),
				v(b, 'elbow_l', k),
				v(b, 'elbow_r', k),
			]),
		),
	);
	ok(
		'named the other way round, it is read by the picture: the same keys',
		q(c.solved.keys) === q(b.solved.keys),
		`${c.solved.keys.length} vs ${b.solved.keys.length}`,
	);
	ok(
		'…and those frames are reported; none when named by the picture',
		c.solved.swapped === byBody.frames.length && b.solved.swapped === 0 && a.solved.swapped === 0,
		q([a.solved.swapped, b.solved.swapped, c.solved.swapped]),
	);
	for (const k of [0, 1]) {
		const skel = c.at(mid(k));
		const lm = byBody.frames[mid(k)].pose.landmarks;
		const ang = (p, q2) =>
			Math.atan2(-(lm[q2][1] - lm[p][1]) * H, (lm[q2][0] - lm[p][0]) * W) * DEG;
		// By the body's names, 13 → 15 is the arm on the picture's LEFT here.
		const err = fold(downOf(skel, 'lower_arm_l') - ang(13, 15));
		ok(
			`named the other way round, pose ${k}: the rig’s left forearm follows the picture’s left forearm`,
			Math.abs(err) < TURN_EPS,
			String(err),
		);
	}
	const sided = pictureSides(byBody);
	ok(
		'pictureSides swaps a frame’s points (and world points) where 12 is clearly right of 11',
		sided.swapped === byBody.frames.length &&
			q(sided.track.frames[0].pose.landmarks[12]) === q(byBody.frames[0].pose.landmarks[11]) &&
			q(sided.track.frames[0].pose.world[16]) === q(byBody.frames[0].pose.world[15]),
	);
	// Side-on (shoulders a hair apart) the order wobbles: it keeps the order of the frame before.
	const wobble = {
		width: W,
		height: H,
		frames: [
			frame(0, { 11: [0.18, -0.5, 0], 12: [-0.18, -0.5, 0] }),
			frame(1, { 11: [-0.02, -0.5, 0], 12: [0.02, -0.5, 0] }),
			frame(2, { 11: [-0.18, -0.5, 0], 12: [0.18, -0.5, 0] }),
			frame(3, { 11: [0.02, -0.5, 0], 12: [-0.02, -0.5, 0] }),
		],
	};
	const wobbled = pictureSides(wobble).track.frames.map(
		(f) => f.pose.landmarks[12][0] < f.pose.landmarks[11][0],
	);
	ok(
		'side-on frames keep the order of the frame before (a swap needs the shoulders a quarter apart)',
		q(wobbled) === q([true, false, true, false]),
		q(wobbled),
	);
}

// ---------------------------------------------------------------- 3. parent-relative
{
	// The upper arm swung 100° in across the body (counter-clockwise, for the picture's left arm; the
	// raise reaches 60° that way): held at its edge, and the forearm, hanging straight down in the
	// picture, still points straight down.
	const track = poses([arm(-90, -90), arm(10, -90)]);
	for (const [label, rig] of [['Half body v2', half]]) {
		const { solved, at } = keyed(rig, track);
		const reach = rig.tpl.channels.find((c) => c.id === 'arm_l');
		ok(
			`${label}: an upper arm past its range is held at its edge`,
			near(valueAt(solved, 'arm_l', mid(1)), reach.min, 0.01),
			String(valueAt(solved, 'arm_l', mid(1))),
		);
		const err = fold(downOf(at(mid(1)), 'lower_arm_l') - -90);
		ok(
			`${label}: …and the forearm still points where the picture’s does (solved under its parent)`,
			Math.abs(err) < TURN_EPS,
			String(err),
		);
	}
}
{
	// The shoulders tilted 10° (the twist reads it) and the head held level in the picture: the head
	// stays level — its tilt is solved under the twist. Then the head tilted 8° with level shoulders.
	const level = () => arm(-90, -90);
	const tilted = () => arm(-90 - 10, -90 - 10, { shoulders: 10, right: [-80, -80] });
	const track = poses([level(), level(), tilted(), level()]);
	track.frames.forEach((f, i) => {
		const k = Math.floor(i / FPS);
		const eyes = k === 3 ? 8 : 0;
		Object.assign(
			f,
			frame(i, Object.fromEntries(f.pose.world.map((p, n) => [n, p]).filter(([, p]) => p)), {
				eyes,
			}),
		);
	});
	for (const [label, rig] of [['Half body v2', half]]) {
		const { solved, at } = keyed(rig, track);
		ok(
			`${label}: the shoulders tilted 10° key the twist`,
			near(valueAt(solved, 'twist', mid(2)), 10, 0.3),
			String(valueAt(solved, 'twist', mid(2))),
		);
		const head = (k) => acrossOf(at(mid(k)), 'head');
		ok(
			`${label}: …and the head held level in the picture stays level (head tilt −10 under the twist)`,
			Math.abs(head(2)) < TURN_EPS && near(valueAt(solved, 'head_tilt', mid(2)), -10, 0.3),
			q([head(2), valueAt(solved, 'head_tilt', mid(2))]),
		);
		ok(
			`${label}: the head tilted 8° with the shoulders level tilts 8°`,
			near(head(3), 8, TURN_EPS),
			String(head(3)),
		);
		const err = fold(downOf(at(mid(2)), 'lower_arm_l') - picture(track, mid(2), 14, 16));
		ok(
			`${label}: the arm, hanging along the tilted body, points where the picture’s does`,
			Math.abs(err) < TURN_EPS,
			String(err),
		);
	}
}
{
	// A hand in line with its forearm, bent in 70°: no wrist turn; the posed hand points along it.
	const track = poses([arm(-90, -20)]);
	const { solved, at } = keyed(half, track);
	ok(
		'a hand in line with a bent forearm keys no wrist turn',
		near(valueAt(solved, 'wrist_l', mid(0)), 0, 0.5),
		String(valueAt(solved, 'wrist_l', mid(0))),
	);
	const err = fold(downOf(at(mid(0)), 'hand_l') - picture(track, mid(0), 16, 20));
	ok('…and the posed hand points along it', Math.abs(err) < TURN_EPS, String(err));
}

// ---------------------------------------------------------------- 4. side-on shoulders
{
	// Front-on, then side-on: the shoulders at 0.4 of their spread with the line steeply tilted — no
	// twist is read there (held at the front-on value), not ±12.
	const front = arm(-90, -90);
	const side = { ...front, 11: [0.05, -0.53, 0.15], 12: [-0.02, -0.47, -0.15] };
	const track = poses([front, side]);
	const { solved } = keyed(half, track);
	ok(
		'side-on shoulders read no twist (held), never the edge of the range',
		near(valueAt(solved, 'twist', mid(1)), 0, 0.01) &&
			solved.stages.twist.raw.slice(FPS).every((v) => v === null),
		q([valueAt(solved, 'twist', mid(1))]),
	);
	ok(
		'…nor a shrug (the half-line from the shoulders’ middle is under 0.3 of their spread)',
		solved.stages.shrug_l.raw.slice(FPS).every((v) => v === null) &&
			solved.stages.shrug_l.raw.slice(0, FPS).every((v) => v !== null),
		q(solved.stages.shrug_l.raw.slice(FPS - 1, FPS + 1)),
	);
}
{
	// A hand turning round and round against its forearm (a tracker spinning it, three turns in 3 s):
	// the wrist's reading stays within one gap of its reach (±90° ± 180°), never winding up.
	const spin = Array.from({ length: 72 }, (_, i) => {
		const pts = arm(-90, -90);
		const d = -90 + (i / 72) * 1080;
		const tip = step(pts[16], d, 0.08);
		return frame(i, { ...pts, 18: tip, 20: tip });
	});
	const { solved } = keyed(half, { width: W, height: H, frames: spin });
	const raw = solved.stages.wrist_l.raw.filter((v) => v !== null);
	ok(
		'a hand spun round and round reads within one gap of the wrist’s reach, never winding up',
		raw.length === 72 && raw.every((v) => Math.abs(v) <= 270 + 1e-6),
		`${Math.min(...raw).toFixed(0)}…${Math.max(...raw).toFixed(0)}`,
	);
}

// ---------------------------------------------------------------- 4b. an image swap holds
{
	// The body turned 20° (front torso), then a second of 20° with one-frame blips to 45° (¾), then
	// 40°: the torso swaps to ¾ once, when the turn lasts, never for a blip.
	const turned = (deg) => {
		const c = Math.cos(deg * R);
		const sn = Math.sin(deg * R);
		const pts = arm(-90, -90);
		return {
			...pts,
			11: [0.18 * c, -0.5, 0.18 * sn],
			12: [-0.18 * c, -0.5, -0.18 * sn],
			23: [0.1 * c, 0, 0.1 * sn],
			24: [-0.1 * c, 0, -0.1 * sn],
		};
	};
	const track = {
		width: W,
		height: H,
		frames: Array.from({ length: 72 }, (_, i) =>
			frame(i, turned(i < 24 ? 20 : i < 48 ? (i % 6 === 0 ? 45 : 20) : 40)),
		),
	};
	const { solved } = keyed(half, track);
	const turns = solved.keys.filter((k) => k[1] === 'turn');
	const changes = turns.filter((k, j) => j > 0 && k[2] !== turns[j - 1][2]);
	ok(
		'a torso image swap is held: blips of one frame are not keyed, a lasting turn is (once)',
		changes.length === 1 && near(changes[0][0], 2, 0.1) && changes[0][2] === 0.3,
		q(turns),
	);
}

// ---------------------------------------------------------------- 5. auto-range
{
	const ch = { min: -1, max: 1, rest: 0 };
	const ramp = Array.from({ length: 101 }, (_, i) => -1 + (3 * i) / 100); // −1 … 2
	const f1 = fitRange(ramp, ch, 1);
	const p98 = ramp[98];
	ok(
		'fitRange: the p98 lands on the edge at full strength, the other side (inside) is left alone',
		near(f1.above, 1 / p98, 1e-9) &&
			f1.below === 1 &&
			near(f1.values[98], 1, 1e-9) &&
			near(f1.values[0], -1, 1e-9),
		q({ above: f1.above, below: f1.below }),
	);
	const fh = fitRange(ramp, ch, 0.5);
	ok('…half-way at ½', near(fh.above, 1 - 0.5 * (1 - 1 / p98), 1e-9), String(fh.above));
	ok('…off is nothing', fitRange(ramp, ch, 0) === null);
	ok(
		'…a spread inside the range is left alone (never stretched)',
		fitRange(
			ramp.map((v) => v / 3),
			ch,
			1,
		) === null,
	);
	const jaw = fitRange(
		ramp.map((v) => v - 1),
		{ min: 0, max: 1, rest: 0 },
		1,
	);
	ok('…a side with no room past the rest (a jaw shut) is left alone', jaw === null);
	ok(
		'…the rest stays the rest',
		fitRange([0, ...ramp], { min: -1, max: 1, rest: 0 }, 1).values[0] === 0,
	);
	ok(
		'…a saturating top is left alone (keepTop)',
		fitRange(ramp, ch, 1, { keepTop: true }) === null,
	);
	const both = fitRange(
		ramp.map((v) => v * 1.5 - 0.5),
		ch,
		1,
	);
	ok(
		'…each side on its own',
		both.below < 1 && both.above < 1 && both.below !== both.above,
		q(both && [both.below, both.above]),
	);
}
{
	// Through the solve: a talker whose brows swing past the range at gain 3.
	const blendTrack = (fn) => ({
		width: W,
		height: H,
		frames: Array.from({ length: 96 }, (_, i) => {
			const lms = Array(478).fill(null);
			lms[33] = [0.45, 0.3];
			lms[263] = [0.55, 0.3];
			lms[1] = [0.5, 0.34];
			return { t: i / FPS, face: { landmarks: lms, blend: fn(i) } };
		}),
	});
	const wave = (i) => (i < FPS ? 0 : Math.sin(((i - FPS) / FPS) * Math.PI * 2));
	const brows = blendTrack((i) => ({
		browInnerUp: Math.max(0, wave(i)) * 0.5,
		browDownLeft: Math.max(0, -wave(i)) * 0.5,
		browDownRight: Math.max(0, -wave(i)) * 0.5,
	}));
	const fitted = keyed(half, brows, { gain: { brows: 3 }, fit: { brows: 1 } });
	const off = keyed(half, brows, { gain: { brows: 3 } });
	const vals = fitted.solved.stages.brow_l.clamped.filter((v) => v !== null);
	const top = Math.max(...vals);
	ok(
		'a face group past its range keeps its shape within it (auto-range): its peak at the edge, not a plateau',
		near(top, 1, 0.02) &&
			vals.filter((v) => v >= 1 - 1e-6).length <= Math.ceil(vals.length * 0.02) + 1,
		`top ${top}, at edge ${vals.filter((v) => v >= 1 - 1e-6).length}/${vals.length}`,
	);
	ok(
		'…and is reported as fitted, with its spread and factor',
		fitted.solved.fitted.some((f) => f.channel === 'brow_l' && f.above < 1 && f.hi > 1) &&
			!fitted.solved.clipped.some((c) => c.channel === 'brow_l' && c.share > 0.03),
		q(fitted.solved.fitted.filter((f) => f.channel === 'brow_l')),
	);
	const offVals = off.solved.stages.brow_l.clamped.filter((v) => v !== null);
	ok(
		'off: held at the edge (a plateau) and reported as clipped',
		offVals.filter((v) => v >= 1 - 1e-6).length > vals.length * 0.15 &&
			off.solved.clipped.some((c) => c.channel === 'brow_l' && c.share > 0.1) &&
			!off.solved.fitted.length,
		q(off.solved.clipped.filter((c) => c.channel === 'brow_l')),
	);
	// A blink at gain 2.4 reads past shut: it stays shut, every one, and is not reported lost.
	const blinks = blendTrack((i) => ({ eyeBlinkRight: i >= FPS && i % 12 < 3 ? 0.9 : 0.02 }));
	const b = keyed(half, blinks, { fit: { eyes: 1 } });
	const closed = b.solved.stages.blink_l.clamped.filter((v, i) => i >= FPS && i % 12 === 1);
	ok(
		'a blink past shut stays shut with auto-range on (the top saturates)',
		closed.every((v) => near(v, 1, 1e-6)),
		q(closed.slice(0, 4)),
	);
	ok(
		'…and is not reported as motion lost',
		!b.solved.clipped.some((c) => c.channel === 'blink_l') &&
			!b.solved.fitted.some((f) => f.channel === 'blink_l' && f.above < 1),
		q([b.solved.clipped, b.solved.fitted]),
	);
}
{
	// On the body (auto-range on): the upper arm swung in past its range is scaled into it, and the
	// forearm is solved against that fitted value — it still points where the picture's does.
	const swings = [-90, -20, 0, 10, 5, -40].map((d) => arm(d, -90));
	const track = poses(swings);
	const { solved, at } = keyed(half, track, { fit: { body: 1 } });
	ok(
		'body auto-range scales an upper arm past its range into it (reported)',
		solved.fitted.some((f) => f.channel === 'arm_l' && f.below < 1),
		q(solved.fitted),
	);
	const errs = swings.map((_, k) => fold(downOf(at(mid(k)), 'lower_arm_l') - -90));
	ok(
		'…and the forearm, solved against its fitted parent, still points where the picture’s does',
		errs.every((e) => Math.abs(e) < TURN_EPS),
		q(errs.map((e) => e.toFixed(2))),
	);
}
{
	// A finger past a fist is a fist (the curl saturates), with auto-range on.
	const D = Math.PI / 180;
	const handOf = (flex) => {
		const w = Array(21).fill(null);
		w[0] = [0, 0, 0];
		for (let f = 0; f < 4; f++) {
			let p = [0, -0.09, 0];
			let a = 0;
			w[5 + 4 * f] = p;
			for (const [j, len] of [0.045, 0.027, 0.02].entries()) {
				a += flex * D;
				p = [0, p[1] - Math.cos(a) * len, p[2] + Math.sin(a) * len];
				w[6 + 4 * f + j] = p;
			}
		}
		for (let j = 1; j <= 4; j++) w[j] = [0.03 * j, -0.02 * j, 0];
		return w;
	};
	const pts = arm(-90, -90);
	const wl = pts[16];
	const at = [(W / 2 + wl[0] * S) / W, (H / 2 + wl[1] * S) / H];
	const far = [(W / 2 + 0.5 * S) / W, (H / 2 + 0.3 * S) / H];
	const handAt = (p, flex) => ({
		label: 'Right',
		landmarks: Array.from({ length: 21 }, () => p),
		world: handOf(flex),
	});
	const track = {
		width: W,
		height: H,
		frames: Array.from({ length: 72 }, (_, i) =>
			frame(i, pts, { hands: i < 48 ? [handAt(at, i < 24 ? 0 : 95)] : [handAt(far, 95)] }),
		),
	};
	const { solved } = keyed(half, track, { fit: { hands: 1 } });
	ok(
		'a finger past a fist (3 × 95°) is a fist with auto-range on',
		near(valueAt(solved, 'curl_index_l', mid(1)), 1, 1e-6) &&
			!solved.fitted.some((f) => f.channel === 'curl_index_l' && f.above < 1),
		String(valueAt(solved, 'curl_index_l', mid(1))),
	);
	ok(
		'a hand at the body’s wrist keys the fingers; one far from both wrists (someone else’s) keys none',
		solved.stages.curl_index_l.raw.slice(0, 48).every((v) => v !== null) &&
			solved.stages.curl_index_l.raw.slice(48).every((v) => v === null) &&
			!solved.channels.includes('curl_index_r'),
		q(solved.stages.curl_index_l.raw.slice(46, 50)),
	);
}

console.log(`motion follow: ${checks - fails}/${checks} checks pass`);
process.exit(fails ? 1 : 0);
