// Verify the fingers of a 🎥 Motion import in 3D (rig-templates §5.9) headlessly, on the SHIPPED code:
// the solve (`rigMotion.ts`, `rigMotion3d.ts`), the real `half-body` template, the page's own keying
// (`faceKeyMotion`) and pose (`poseAtTime`) pulled out of view.html, the import and its bake
// (`rig3dImport.ts`), read by engine-rig — what the GAME shows. The performer (`performer3d.mjs`) is
// given a left hand whose fingers curl by known angles: side-on first (the curl bends them across the
// picture), then facing the camera (the curl folds them toward it). Asserted:
//  - the precondition: the 2D import's curl (a shortening along the finger) leaves a side-on hand's
//    bent fingers pointing tens of degrees off the performer's;
//  - in 3D, as the game poses the clip, every segment of every finger and the thumb ends where the
//    performer's direction puts it at the segment's own length — pointing where theirs does in the
//    picture and as short as theirs toward the camera — within 1.5 rig units (the keys' tolerance is
//    1), side-on and facing alike — but for a segment pointing all but straight at the camera, which is
//    drawn a little long (its stretch floored) so the segments after it, held to the same, can be;
//  - the fingers stay 2D bones on the hand: the bake owns none of them, their keys are a turn and a
//    stretch, and the Rigger's Animate pose is the game's;
//  - a frame with no hand, or a hand found away from the wrist (someone else's), holds the fingers' turn
//    on the hand;
//  - the validator refuses a finger map it cannot key.
//   node tools/rigger-spike/motion-fingers.mjs
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

const dir = mkdtempSync(join(tmpdir(), 'motion-fingers-'));
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
		].map(grabFn),
		'return { faceKeyMotion, face3dReplaced };',
	].join('\n'),
)();
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
const r1 = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));

const tpl = T.RIG_TEMPLATES.find((t) => t.id === 'half-body');
const regions = tpl.parts.map((p) => ({ name: p.name, w: p.size[0], h: p.size[1] }));
const { skeleton } = T.templateRig(tpl, regions);
const names = new Set(regions.map((r) => r.name));
const has = (slot, part) => names.has(part) && !!skeleton.skins[0].attachments[slot]?.[part];
const atlasText = (() => {
	const lines = ['page.png', 'size:8192,512', 'filter:Linear,Linear'];
	let x = 0;
	for (const r of regions) {
		lines.push(r.name, `bounds:${x},0,${r.w},${r.h}`);
		x += r.w;
	}
	return `${lines.join('\n')}\n`;
})();
const dataOf = (irig) => {
	const atlas = new TextureAtlas(atlasText);
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
};
const poser = (irig) => {
	const data = dataOf(irig);
	return (t) => {
		const s = new Skeleton(data);
		const st = new AnimationState(new AnimationStateData(data));
		st.setAnimation(0, 'imp', false);
		st.update(t);
		st.apply(s);
		s.updateWorldTransform(Physics.update);
		return s;
	};
};

// ── The performer's left hand ─────────────────────────────────────────────────────────────────
// Frames 0–35 side-on (the knuckles' line toward the camera, a curl bends the fingers across the
// picture), 36–71 facing the camera (the knuckles' line across the picture, a curl folds them toward
// it). Each joint curls the same angle, 0 → 80° and back each 1.5 s. Frames 30–31 no hand, 32–33 a
// hand found 0.15 m off the wrist: near enough to be the performer's hand (not someone else's, as the
// hands are paired), too far to be on that wrist.
const N = 72;
const SIDE_ON = [0, 36];
const LOST = [30, 34];
const within = (i, [a, b]) => i >= a && i < b;
const curlAt = (t) => 80 * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 1.5));
/** Rotate `v` about unit axis `k` by `deg` (Rodrigues). */
const turn = (v, k, deg) => {
	const a = deg / DEG;
	const [c, s] = [Math.cos(a), Math.sin(a)];
	const kv = P.cross(k, v);
	const kd = P.dot(k, v);
	return [0, 1, 2].map((i) => v[i] * c + kv[i] * s + k[i] * kd * (1 - c));
};
const ARM = { upper: P.dir(-25), lower: P.dir(-70) };
const ALONG = P.norm(P.dir(-80));
/** The hand's 21 points about its wrist (rig frame, metres) for a curl and the way it faces. */
function handAt(t, sideOn) {
	const a = ALONG;
	const across = sideOn ? [0, 0, 1] : P.norm(P.cross([0, 0, 1], a));
	const normal = P.norm(P.cross(a, across));
	const th = curlAt(t);
	const out = [[0, 0, 0]];
	// The thumb: from beside the wrist, out toward its side, curling about the palm's normal.
	let at = P.add(P.mul(a, 0.03), P.mul(across, 0.03));
	out.push(at);
	let d = P.norm(P.add(a, P.mul(across, 0.8)));
	for (const len of [0.035, 0.03, 0.025]) {
		d = turn(d, normal, th * 0.4);
		at = P.add(at, P.mul(d, len));
		out.push(at);
	}
	for (const off of [0.025, 0.008, -0.008, -0.024]) {
		at = P.add(P.mul(a, 0.09), P.mul(across, off));
		out.push(at);
		d = a;
		for (const len of [0.045, 0.028, 0.022]) {
			d = turn(d, across, th);
			at = P.add(at, P.mul(d, len));
			out.push(at);
		}
	}
	return out;
}
const pic = (v) => [0.5 + v[0] * 0.5, 0.45 - v[1] * 0.5];
const mp = (v) => [v[0], -v[1], -v[2]];
const truth = [];
const track = P.track(N, FPS, () => ({
	pose: { arms: { l: ARM } },
	opts: { hands: true, face: P.ry(0) },
}));
track.frames.forEach((f, i) => {
	const wrist = P.points({ arms: { l: ARM } })[16];
	const pts = handAt(f.t, within(i, SIDE_ON)).map((v) => P.add(wrist, v));
	truth.push(pts);
	if (within(i, LOST)) {
		if (i < LOST[0] + 2) f.hands = [f.hands[1]];
		else
			f.hands[0] = {
				landmarks: pts.map((v) => pic(P.add(v, [-0.15, 0, 0]))),
				world: pts.map((v) => mp(P.sub(v, wrist))),
			};
		return;
	}
	f.hands[0] = { landmarks: pts.map(pic), world: pts.map((v) => mp(P.sub(v, wrist))) };
});

function importOf(three) {
	const solved = solveMotion(
		{ bones: tpl.bones, channels: tpl.channels, motion: tpl.motion },
		track,
		{ three },
	);
	const irig0 = structuredClone(skeleton);
	irig0.animations = { imp: {} };
	if (!three) {
		F.faceKeyMotion(
			irig0.animations.imp,
			solved.keys,
			0,
			tpl.channels,
			has,
			skeleton.slots.map((s) => s.name),
		);
		return { solved, irig: irig0 };
	}
	const own = I.authoringOf(irig0, null, 'imp');
	F.faceKeyMotion(
		own.animation,
		solved.keys,
		0,
		tpl.channels,
		has,
		skeleton.slots.map((s) => s.name),
	);
	const out = I.importClip3d({
		irig: irig0,
		doc: null,
		stem: 'hero',
		template: tpl.rig3d,
		clip: 'imp',
		animation: own.animation,
		orient: own.orient,
		keys: solved.bones3d,
		at: 0,
		length: solved.length,
		replaced: F.face3dReplaced(tpl),
		keys2d: solved.keys2d,
	});
	return { solved, irig: out.irig, plan: out.plan };
}

// Each segment of the left hand: its bone, the bone (or point) it ends at, its two hand points.
const byName = new Map(tpl.bones.map((b) => [b.name, b]));
const DIGITS = { thumb: 1, index: 5, middle: 9, ring: 13, pinky: 17 };
const SEG3 = {
	thumb: [4, -16],
	index: [0, -16],
	middle: [0, -17],
	ring: [0, -16],
	pinky: [0, -13],
};
const segmentsOf = () =>
	Object.entries(DIGITS).flatMap(([d, base]) =>
		[1, 2, 3].map((n) => ({ d, n, bone: `${d}_${n}_l`, from: base + n - 1, to: base + n })),
	);
const endOf = (skel, s) => {
	if (s.n < 3) {
		const c = skel.findBone(`${s.d}_${s.n + 1}_l`);
		return [c.worldX, c.worldY];
	}
	// The tip: where its image ends (x mirrored on the left: the template's −k · x, k = −1).
	const o = { x: SEG3[s.d][0], y: SEG3[s.d][1] };
	skel.findBone(s.bone).localToWorld(o);
	return [o.x, o.y];
};
const restLength = (s) => {
	if (s.n < 3) {
		const c = byName.get(`${s.d}_${s.n + 1}_l`);
		return Math.hypot(c.x, c.y);
	}
	return Math.hypot(...SEG3[s.d]);
};
/** Per segment and frame: direction error (°) and length error (share of its length) in the picture. */
function errors(irig, frames) {
	const pose = poser(irig);
	const out = [];
	for (const i of frames) {
		const skel = pose(i / FPS + 1e-4);
		const rootScale = skel.findBone('root').scaleX;
		const pts = truth[i];
		for (const s of segmentsOf()) {
			const b = skel.findBone(s.bone);
			const [ex, ey] = endOf(skel, s);
			const got = [ex - b.worldX, ey - b.worldY];
			const v = P.sub(pts[s.to], pts[s.from]);
			const want = [v[0], v[1]];
			const unitLen = Math.hypot(...want) / Math.hypot(...v);
			const angle = Math.abs(
				fold((Math.atan2(got[1], got[0]) - Math.atan2(want[1], want[0])) * DEG),
			);
			// Where it should end: the performer's direction at the rig segment's length, foreshortened as
			// theirs is. A segment with one after it pointing all but at the camera is floored: not held.
			const k = (restLength(s) * rootScale * unitLen) / Math.max(1e-9, Math.hypot(...want));
			const floored = s.n < 3 && unitLen < 0.3;
			const end = floored ? 0 : Math.hypot(got[0] - want[0] * k, got[1] - want[1] * k);
			out.push({ i, bone: s.bone, angle: unitLen > 0.25 ? angle : 0, end, floored });
		}
	}
	return out;
}
const worst = (rows, k) => rows.reduce((a, r) => (r[k] > a[k] ? r : a), { [k]: 0 });
const steady = (i) => i >= 3 && !within(i, [LOST[0] - 1, LOST[1] + 3]) && !within(i, [34, 41]);
const frames = Array.from({ length: N }, (_, i) => i).filter(steady);

// The 2D import's curl on a side-on hand: the precondition.
{
	const flat = importOf(false);
	const curled = frames.filter((i) => within(i, SIDE_ON) && curlAt(i / FPS) > 50);
	const w = worst(errors(flat.irig, curled), 'angle');
	ok(
		'precondition: the 2D curl leaves a side-on hand’s bent fingers pointing far off the performer’s',
		w.angle > 30,
		JSON.stringify(w),
	);
}

const three = importOf(true);
const errs = errors(three.irig, frames);
{
	const share = errs.filter((r) => r.floored).length / errs.length;
	ok(
		'a segment drawn at its floor is the exception (under 10% of the checked segments)',
		share < 0.1,
		share.toFixed(3),
	);
}
for (const [what, keep] of [
	['side-on', (r) => within(r.i, SIDE_ON)],
	['facing the camera', (r) => !within(r.i, SIDE_ON)],
]) {
	const rows = errs.filter(keep);
	const e = worst(rows, 'end');
	ok(
		`${what}: every finger and thumb segment ends where the performer’s direction and depth put it (within 1.5)`,
		e.end < 1.5,
		JSON.stringify(e),
	);
}
{
	// The facing frames really fold toward the camera (a curled segment is short), so the length check means something.
	const folded = errs.filter((r) => !within(r.i, SIDE_ON) && r.bone === 'index_3_l');
	const pose = poser(three.irig);
	const shortest = Math.min(
		...folded.map((r) => {
			const skel = pose(r.i / FPS + 1e-4);
			const s = { d: 'index', n: 3, bone: 'index_3_l' };
			const [ex, ey] = endOf(skel, s);
			const b = skel.findBone(s.bone);
			return (
				Math.hypot(ex - b.worldX, ey - b.worldY) / (restLength(s) * skel.findBone('root').scaleX)
			);
		}),
	);
	ok(
		'facing the camera: a curled fingertip is drawn short (folded toward the camera)',
		shortest < 0.6,
		r1(shortest),
	);
}

// 2D bones on the hand, as the game and the Rigger play them.
const owned = new Set(three.plan.owned);
ok(
	'the bake owns no finger (they stay 2D bones on the hand)',
	!segmentsOf().some((s) => owned.has(s.bone)) && owned.has('hand_l'),
);
const keys = three.irig.animations.imp.bones;
ok(
	'each finger segment is keyed by a turn and a stretch along its length',
	segmentsOf().every((s) => keys[s.bone]?.rotate?.length > 1 && keys[s.bone]?.scale?.length > 1),
);
ok(
	'the curl controls are not keyed in 3D',
	!three.solved.keys.some((k) => /^(curl|thumb|spread)_/.test(k[1])),
);
{
	const data = dataOf(three.irig);
	const game = poser(three.irig);
	let far = { d: 0 };
	for (let i = 0; i < N; i++) {
		const g = game(i / FPS + 1e-4);
		const page = new Skeleton(data);
		page.setToSetupPose();
		pagePose(page, three.irig.animations.imp, i / FPS + 1e-4);
		page.updateWorldTransform(Physics.update);
		for (const s of segmentsOf()) {
			const a = g.findBone(s.bone);
			const b = page.findBone(s.bone);
			const d =
				Math.hypot(a.worldX - b.worldX, a.worldY - b.worldY) +
				100 *
					Math.max(
						Math.abs(a.a - b.a),
						Math.abs(a.b - b.b),
						Math.abs(a.c - b.c),
						Math.abs(a.d - b.d),
					);
			if (d > far.d) far = { d, bone: s.bone, i };
		}
	}
	ok('the Rigger’s Animate pose of the fingers is the game’s', far.d < 0.5, JSON.stringify(far));
}

// No hand, or a hand off the wrist: the fingers hold their turn on the hand.
{
	const rot = keys.index_2_l.rotate;
	const at = (t) => {
		let v = rot[0].value;
		for (const k of rot) if ((k.time ?? 0) <= t + 1e-6) v = k.value;
		const next = rot.find((k) => (k.time ?? 0) > t + 1e-6);
		const prev = [...rot].reverse().find((k) => (k.time ?? 0) <= t + 1e-6);
		if (!next || !prev) return v;
		const u = (t - prev.time) / (next.time - prev.time);
		return prev.value + u * (next.value - prev.value);
	};
	const before = at((LOST[0] - 1) / FPS);
	const held = [LOST[0], LOST[0] + 1, LOST[0] + 2, LOST[0] + 3].map((i) => at(i / FPS));
	ok(
		'a frame with no hand, or a hand found off the wrist, holds the finger’s turn on the hand',
		Math.abs(before) > 10 && held.every((v) => Math.abs(v - before) < 1),
		[before, ...held].map(r1).join(' '),
	);
}

// The validator.
{
	const hb = tpl;
	const fingers = hb.motion.bones3d.fingers;
	const withFingers = (f) => ({
		...hb,
		motion: { ...hb.motion, bones3d: { ...hb.motion.bones3d, fingers: f } },
	});
	ok('half-body: valid', T.rigTemplateProblem(hb) === null, String(T.rigTemplateProblem(hb)));
	const bad = [
		[
			'a finger that is turned in 3D',
			withFingers([{ ...fingers[0], bone: 'hand_l' }, ...fingers.slice(1)]),
		],
		[
			'a finger before its parent segment',
			withFingers([fingers[1], fingers[0], ...fingers.slice(2)]),
		],
		['a finger read on no side', withFingers([{ ...fingers[0], side: 'x' }, ...fingers.slice(1)])],
		[
			'a finger read past the hand’s 21 points',
			withFingers([{ ...fingers[0], to: 21 }, ...fingers.slice(1)]),
		],
		[
			'a finger tip with no rest',
			withFingers(fingers.map((f) => (f.bone === 'index_3_l' ? { ...f, rest: undefined } : f))),
		],
		['a finger keyed twice', withFingers([...fingers, fingers[0]])],
	];
	for (const [what, t] of bad) ok(`validator refuses ${what}`, T.rigTemplateProblem(t) !== null);
}

console.log(`${fails ? 'FAIL' : 'ok'}  motion-fingers: ${checks - fails}/${checks} checks`);
process.exit(fails ? 1 : 0);
